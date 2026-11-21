'use strict';

/**
 * ArenaMeet — LiveKit room client.
 *
 * Replaces the old self-hosted SFU room client. The join flow is:
 *   1. Read the room name from `?room=` or from the `/join/<room>` path.
 *   2. Ask for a display name (prefilled from the last visit).
 *   3. Fetch a short-lived join token from `/api/token`.
 *   4. Connect to the LiveKit room with the livekit-client SDK.
 *
 * No media ever touches our own server: audio/video/screen go straight
 * from the browser to LiveKit Cloud. Chat rides on LiveKit data tracks.
 *
 * Supported join-link parameters (same shape as the old direct links):
 *   ?room=<name>&name=<display name>&autojoin=1&audio=0&video=0
 */

(function () {
    const SDK = window.LivekitClient;
    const CHAT_TOPIC = 'chat';
    const MAX_NAME_LENGTH = 64;
    const VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]*$/;

    const $ = (id) => document.getElementById(id);
    const grid = $('videoGrid');
    const joinOverlay = $('joinOverlay');
    const leftScreen = $('leftScreen');
    const joinError = $('joinError');
    const toastEl = $('toast');

    let room = null;
    let roomName = '';
    let displayName = '';
    let identity = '';
    let callStartAt = 0;
    let timerHandle = null;
    let toastHandle = null;

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------

    function showToast(message, ms) {
        toastEl.textContent = message;
        toastEl.hidden = false;
        clearTimeout(toastHandle);
        toastHandle = setTimeout(() => {
            toastEl.hidden = true;
        }, ms || 4000);
    }

    function showJoinError(message) {
        joinError.textContent = message;
        joinError.hidden = false;
    }

    function clearJoinError() {
        joinError.textContent = '';
        joinError.hidden = true;
    }

    function initialsFor(name) {
        const parts = String(name || '?')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        const first = parts[0] ? parts[0][0] : '?';
        const second = parts[1] ? parts[1][0] : '';
        return (first + second).toUpperCase();
    }

    function formatDuration(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
    }

    function startTimer() {
        callStartAt = Date.now();
        stopTimer();
        timerHandle = setInterval(() => {
            const seconds = Math.floor((Date.now() - callStartAt) / 1000);
            $('callTimer').textContent = formatDuration(seconds);
        }, 1000);
    }

    function stopTimer() {
        if (timerHandle) {
            clearInterval(timerHandle);
            timerHandle = null;
        }
        $('callTimer').textContent = '00:00';
    }

    function getOrCreateIdentity() {
        try {
            const stored = window.sessionStorage.getItem('am-identity');
            if (stored && VALUE_RE.test(stored)) return stored;
            const generated =
                'user-' +
                Array.from(window.crypto.getRandomValues(new Uint8Array(6)))
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('');
            window.sessionStorage.setItem('am-identity', generated);
            return generated;
        } catch (err) {
            return 'user-' + Math.random().toString(36).slice(2, 10);
        }
    }

    function getStoredDisplayName() {
        try {
            return window.localStorage.getItem('am-display-name') || '';
        } catch (err) {
            return '';
        }
    }

    function storeDisplayName(name) {
        try {
            window.localStorage.setItem('am-display-name', name);
        } catch (err) {
            // Private mode etc. — the name just won't be remembered.
        }
    }

    function readRoomName() {
        const params = new URLSearchParams(window.location.search);
        const fromQuery = (params.get('room') || '').trim();
        if (fromQuery) return decodeURIComponent(fromQuery);
        const match = window.location.pathname.match(/^\/join\/([^/?#]+)/);
        if (match) return decodeURIComponent(match[1]);
        return '';
    }

    function updateParticipantCount() {
        const remoteCount = room ? room.remoteParticipants.size : 0;
        $('participantCountValue').textContent = String(remoteCount + 1);
        $('aloneHint').hidden = remoteCount !== 0;
    }

    // ------------------------------------------------------------------
    // Video tiles
    // ------------------------------------------------------------------

    function tileIdFor(participantIdentity, source) {
        return 'tile-' + participantIdentity + '-' + source;
    }

    function createTile(participant, source, labelText) {
        const tile = document.createElement('div');
        tile.className = 'lk-tile';
        tile.id = tileIdFor(participant.identity, source);
        tile.dataset.participant = participant.identity;
        tile.dataset.source = source;
        if (source === 'screen_share') tile.classList.add('lk-tile-screen');

        const video = document.createElement('video');
        video.className = 'lk-video';
        video.autoplay = true;
        video.playsInline = true;
        video.muted = participant.isLocal;
        tile.appendChild(video);

        const avatar = document.createElement('div');
        avatar.className = 'lk-avatar';
        avatar.textContent = initialsFor(labelText);
        tile.appendChild(avatar);

        const label = document.createElement('div');
        label.className = 'lk-tile-label';
        const nameEl = document.createElement('span');
        nameEl.className = 'lk-tile-name';
        nameEl.textContent = labelText;
        const micEl = document.createElement('span');
        micEl.className = 'lk-tile-mic';
        micEl.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        label.appendChild(nameEl);
        label.appendChild(micEl);
        tile.appendChild(label);

        grid.appendChild(tile);
        return tile;
    }

    function getOrCreateTile(participant, source) {
        const isScreen = source === SDK.Track.Source.ScreenShare;
        const key = isScreen ? 'screen_share' : 'camera';
        let tile = document.getElementById(tileIdFor(participant.identity, key));
        if (tile) return tile;
        const labelText = isScreen
            ? (participant.name || participant.identity) + "'s screen"
            : participant.name || participant.identity;
        return createTile(participant, key, labelText);
    }

    function removeTile(participantIdentity, source) {
        const key = source === SDK.Track.Source.ScreenShare ? 'screen_share' : 'camera';
        const tile = document.getElementById(tileIdFor(participantIdentity, key));
        if (tile) tile.remove();
    }

    function attachTrack(track, participant) {
        if (track.kind === SDK.Track.Kind.Video) {
            const tile = getOrCreateTile(participant, track.source);
            const video = tile.querySelector('video');
            track.attach(video);
            tile.classList.remove('lk-cam-off');
            return;
        }
        // Audio: attach to a dedicated (invisible) audio element.
        const audioId = 'audio-' + participant.identity;
        let audio = document.getElementById(audioId);
        if (!audio) {
            audio = document.createElement('audio');
            audio.id = audioId;
            audio.autoplay = true;
            audio.playsInline = true;
            document.body.appendChild(audio);
        }
        track.attach(audio);
    }

    function detachTrack(track, participant) {
        track.detach();
        if (track.kind === SDK.Track.Kind.Video) {
            const tile = document.getElementById(
                tileIdFor(
                    participant.identity,
                    track.source === SDK.Track.Source.ScreenShare ? 'screen_share' : 'camera',
                ),
            );
            if (tile) {
                tile.classList.add('lk-cam-off');
                const video = tile.querySelector('video');
                if (video) video.removeAttribute('src');
            }
        }
    }

    function refreshTileMic(participant) {
        const tile = document.getElementById(tileIdFor(participant.identity, 'camera'));
        if (!tile) return;
        const micEl = tile.querySelector('.lk-tile-mic');
        if (!micEl) return;
        const audioPub = participant.getTrackPublication(SDK.Track.Source.Microphone);
        const muted = !audioPub || audioPub.isMuted || !audioPub.track;
        micEl.innerHTML = muted
            ? '<i class="fa-solid fa-microphone-slash"></i>'
            : '<i class="fa-solid fa-microphone"></i>';
        micEl.classList.toggle('lk-muted', muted);
    }

    function handleExistingPublications(participant) {
        let hasVideo = false;
        participant.trackPublications.forEach((publication) => {
            if (publication.kind === SDK.Track.Kind.Video) hasVideo = true;
            if (publication.track) attachTrack(publication.track, participant);
            if (publication.kind === SDK.Track.Kind.Video && !publication.track) {
                // Camera published but no local track yet (e.g. muted) — show the avatar tile.
                getOrCreateTile(participant, publication.source).classList.add('lk-cam-off');
            }
        });
        if (!hasVideo) {
            // Joined with camera off (or audio-only): still show the avatar tile
            // so the participant is visible in the grid instead of missing.
            getOrCreateTile(participant, SDK.Track.Source.Camera).classList.add('lk-cam-off');
        }
        refreshTileMic(participant);
    }

    function markSpeaking(identities) {
        document.querySelectorAll('.lk-tile').forEach((tile) => {
            tile.classList.toggle('lk-speaking', identities.includes(tile.dataset.participant));
        });
    }

    // ------------------------------------------------------------------
    // Chat (LiveKit data tracks)
    // ------------------------------------------------------------------

    function appendChatMessage(name, text, isOwn) {
        const messages = $('chatMessages');
        const row = document.createElement('div');
        row.className = 'lk-chat-msg' + (isOwn ? ' lk-chat-own' : '');
        const head = document.createElement('div');
        head.className = 'lk-chat-head';
        const nameEl = document.createElement('span');
        nameEl.className = 'lk-chat-name';
        nameEl.textContent = name;
        const timeEl = document.createElement('span');
        timeEl.className = 'lk-chat-time';
        timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        head.appendChild(nameEl);
        head.appendChild(timeEl);
        const body = document.createElement('div');
        body.className = 'lk-chat-text';
        body.textContent = text;
        row.appendChild(head);
        row.appendChild(body);
        messages.appendChild(row);
        messages.scrollTop = messages.scrollHeight;
    }

    function sendChatMessage(text) {
        if (!room || !text) return;
        const payload = { type: 'chat', name: displayName, text, ts: Date.now() };
        try {
            room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(payload)), {
                reliable: true,
                topic: CHAT_TOPIC,
            });
        } catch (err) {
            showToast('Message could not be sent.');
            return;
        }
        appendChatMessage(displayName, text, true);
    }

    // ------------------------------------------------------------------
    // Controls
    // ------------------------------------------------------------------

    function setControlState(button, enabled, onTitle, offTitle) {
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.classList.toggle('lk-off', !enabled);
        button.title = enabled ? onTitle : offTitle;
    }

    function bindControls() {
        $('micBtn').addEventListener('click', async () => {
            if (!room) return;
            const enabled = !room.localParticipant.isMicrophoneEnabled;
            try {
                await room.localParticipant.setMicrophoneEnabled(enabled);
            } catch (err) {
                showToast('Could not access the microphone.');
                return;
            }
            setControlState($('micBtn'), enabled, 'Mute microphone', 'Unmute microphone');
            refreshTileMic(room.localParticipant);
        });

        $('camBtn').addEventListener('click', async () => {
            if (!room) return;
            const enabled = !room.localParticipant.isCameraEnabled;
            try {
                await room.localParticipant.setCameraEnabled(enabled);
            } catch (err) {
                showToast('Could not access the camera.');
                return;
            }
            setControlState($('camBtn'), enabled, 'Turn camera off', 'Turn camera on');
            const tile = document.getElementById(tileIdFor(room.localParticipant.identity, 'camera'));
            if (tile) tile.classList.toggle('lk-cam-off', !enabled);
        });

        $('screenBtn').addEventListener('click', async () => {
            if (!room) return;
            const sharing = room.localParticipant.isScreenShareEnabled;
            try {
                await room.localParticipant.setScreenShareEnabled(!sharing);
            } catch (err) {
                if (err && err.name === 'NotAllowedError') {
                    showToast('Screen share was cancelled.');
                    return;
                }
                showToast('Could not start screen share.');
                return;
            }
            setControlState($('screenBtn'), !sharing, 'Stop sharing screen', 'Share screen');
        });

        const toggleChat = () => {
            const panel = $('chatPanel');
            const open = panel.hidden;
            panel.hidden = !open;
            setControlState($('chatBtn'), open, 'Hide chat', 'Show chat');
            if (open) $('chatInput').focus();
        };
        $('chatBtn').addEventListener('click', toggleChat);
        $('toggleChatBtnTop').addEventListener('click', toggleChat);
        $('closeChatBtn').addEventListener('click', toggleChat);

        $('chatForm').addEventListener('submit', (event) => {
            event.preventDefault();
            const input = $('chatInput');
            const text = input.value.trim();
            if (!text) return;
            sendChatMessage(text.slice(0, 1000));
            input.value = '';
        });

        $('shareRoomBtn').addEventListener('click', async () => {
            const url = window.location.href;
            try {
                await navigator.clipboard.writeText(url);
                showToast('Room link copied.');
            } catch (err) {
                window.prompt('Copy the room link:', url);
            }
        });

        $('leaveBtn').addEventListener('click', leaveRoom);
        $('rejoinBtn').addEventListener('click', () => window.location.reload());
    }

    async function leaveRoom() {
        stopTimer();
        if (room) {
            try {
                await room.disconnect();
            } catch (err) {
                // Already disconnected — nothing to do.
            }
            room = null;
        }
        grid.innerHTML = '';
        leftScreen.hidden = false;
    }

    // ------------------------------------------------------------------
    // Join
    // ------------------------------------------------------------------

    async function fetchToken() {
        const params = new URLSearchParams({
            room: roomName,
            identity,
            name: displayName,
        });
        const response = await fetch('/api/token?' + params.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
            let message = 'Could not join the room. Please try again.';
            if (response.status === 503) {
                message = 'Video service is not configured yet. Please try again later.';
            } else if (response.status === 400) {
                message = 'This room name is not valid. Please go back and try another name.';
            }
            throw new Error(message);
        }
        return response.json();
    }

    async function joinRoom(startWithMic, startWithCam) {
        clearJoinError();
        $('joinBtn').disabled = true;
        $('joinBtn').textContent = 'Joining...';
        try {
            const { token, url } = await fetchToken();
            if (!token || !url) throw new Error('Could not join the room. Please try again.');

            room = new SDK.Room({ adaptiveStream: true, dynacast: true });

            room.on(SDK.RoomEvent.ParticipantConnected, (participant) => {
                handleExistingPublications(participant);
                updateParticipantCount();
            });
            room.on(SDK.RoomEvent.ParticipantDisconnected, (participant) => {
                removeTile(participant.identity, SDK.Track.Source.Camera);
                removeTile(participant.identity, SDK.Track.Source.ScreenShare);
                const audio = document.getElementById('audio-' + participant.identity);
                if (audio) audio.remove();
                updateParticipantCount();
            });
            room.on(SDK.RoomEvent.LocalTrackPublished, (publication) => {
                if (publication.track) attachTrack(publication.track, room.localParticipant);
                refreshTileMic(room.localParticipant);
            });
            room.on(SDK.RoomEvent.LocalTrackUnpublished, (publication) => {
                if (publication.track) detachTrack(publication.track, room.localParticipant);
            });
            room.on(SDK.RoomEvent.TrackSubscribed, (track, publication, participant) => {
                attachTrack(track, participant);
                refreshTileMic(participant);
            });
            room.on(SDK.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
                detachTrack(track, participant);
            });
            room.on(SDK.RoomEvent.TrackMuted, (publication, participant) => {
                if (publication.kind === SDK.Track.Kind.Video) {
                    const tile = document.getElementById(
                        tileIdFor(
                            participant.identity,
                            publication.source === SDK.Track.Source.ScreenShare
                                ? 'screen_share'
                                : 'camera',
                        ),
                    );
                    if (tile) tile.classList.add('lk-cam-off');
                }
                refreshTileMic(participant);
            });
            room.on(SDK.RoomEvent.TrackUnmuted, (publication, participant) => {
                if (publication.kind === SDK.Track.Kind.Video) {
                    const tile = document.getElementById(
                        tileIdFor(
                            participant.identity,
                            publication.source === SDK.Track.Source.ScreenShare
                                ? 'screen_share'
                                : 'camera',
                        ),
                    );
                    if (tile) tile.classList.remove('lk-cam-off');
                }
                refreshTileMic(participant);
            });
            room.on(SDK.RoomEvent.DataReceived, (payload, participant, kind, topic) => {
                if (topic !== CHAT_TOPIC || !participant) return;
                try {
                    const data = JSON.parse(new TextDecoder().decode(payload));
                    if (data && data.type === 'chat' && typeof data.text === 'string') {
                        appendChatMessage(participant.name || participant.identity, data.text, false);
                    }
                } catch (err) {
                    // Ignore malformed chat payloads.
                }
            });
            room.on(SDK.RoomEvent.ActiveSpeakersChanged, (speakers) => {
                markSpeaking(speakers.map((p) => p.identity));
            });
            room.on(SDK.RoomEvent.ConnectionStateChanged, (state) => {
                const status = $('connectionStatus');
                status.className = 'lk-status';
                if (state === SDK.ConnectionState.Connected) {
                    status.classList.add('lk-status-ok');
                    status.title = 'Connected';
                    $('reconnectBanner').hidden = true;
                } else if (state === SDK.ConnectionState.Reconnecting) {
                    status.classList.add('lk-status-warn');
                    status.title = 'Reconnecting';
                    $('reconnectBanner').hidden = false;
                } else {
                    status.classList.add('lk-status-bad');
                    status.title = 'Disconnected';
                }
            });
            room.on(SDK.RoomEvent.Disconnected, () => {
                stopTimer();
                if (!leftScreen.hidden) return;
                showToast('You were disconnected from the room.');
            });

            await room.connect(url, token);

            // Publish local camera/mic. A denied permission joins muted
            // instead of failing the whole join.
            let micOn = startWithMic;
            let camOn = startWithCam;
            try {
                await room.localParticipant.setMicrophoneEnabled(startWithMic);
            } catch (err) {
                micOn = false;
                showToast('Microphone is off — permission was not granted.');
            }
            try {
                await room.localParticipant.setCameraEnabled(startWithCam);
            } catch (err) {
                camOn = false;
                showToast('Camera is off — permission was not granted.');
            }

            // Local tiles (camera + screen share when it appears).
            const localTile = getOrCreateTile(room.localParticipant, SDK.Track.Source.Camera);
            if (!camOn) localTile.classList.add('lk-cam-off');
            const micPub = room.localParticipant.getTrackPublication(SDK.Track.Source.Microphone);
            if (micPub && micPub.track) attachTrack(micPub.track, room.localParticipant);
            const camPub = room.localParticipant.getTrackPublication(SDK.Track.Source.Camera);
            if (camPub && camPub.track) attachTrack(camPub.track, room.localParticipant);
            room.remoteParticipants.forEach(handleExistingPublications);

            setControlState($('micBtn'), micOn, 'Mute microphone', 'Unmute microphone');
            setControlState($('camBtn'), camOn, 'Turn camera off', 'Turn camera on');
            refreshTileMic(room.localParticipant);
            updateParticipantCount();
            startTimer();

            joinOverlay.hidden = true;
            document.title = 'ArenaMeet - ' + roomName;
        } catch (err) {
            showJoinError(err && err.message ? err.message : 'Could not join the room. Please try again.');
            if (room) {
                try {
                    await room.disconnect();
                } catch (ignored) {
                    // Ignore cleanup errors.
                }
                room = null;
            }
        } finally {
            $('joinBtn').disabled = false;
            $('joinBtn').textContent = 'Join room';
        }
    }

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------

    function init() {
        if (!SDK || !SDK.Room) {
            showJoinError('The video library failed to load. Check your connection and refresh the page.');
            $('joinBtn').disabled = true;
            return;
        }

        roomName = readRoomName();
        if (!roomName || !VALUE_RE.test(roomName)) {
            showJoinError('No room name was given. Go back home and pick a room name first.');
            $('joinBtn').disabled = true;
            $('displayNameInput').disabled = true;
            return;
        }

        identity = getOrCreateIdentity();
        $('roomNameLabel').textContent = roomName;
        $('joinRoomName').textContent = roomName;

        const params = new URLSearchParams(window.location.search);
        const nameFromLink = (params.get('name') || '').trim();
        const storedName = getStoredDisplayName();
        $('displayNameInput').value = nameFromLink || storedName;
        if (params.get('audio') === '0') $('joinMicToggle').checked = false;
        if (params.get('video') === '0') $('joinCamToggle').checked = false;

        bindControls();

        $('joinBtn').addEventListener('click', () => {
            const name = $('displayNameInput').value.trim().slice(0, MAX_NAME_LENGTH);
            if (!name || !VALUE_RE.test(name)) {
                showJoinError('Please enter your name (letters, numbers, spaces and dashes).');
                return;
            }
            displayName = name;
            storeDisplayName(name);
            joinRoom($('joinMicToggle').checked, $('joinCamToggle').checked);
        });

        $('displayNameInput').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') $('joinBtn').click();
        });

        window.addEventListener('beforeunload', () => {
            if (room) room.disconnect();
        });

        // Direct join links: ?name=Alex&autojoin=1
        if (params.get('autojoin') === '1' && (nameFromLink || storedName)) {
            const name = (nameFromLink || storedName).slice(0, MAX_NAME_LENGTH);
            if (VALUE_RE.test(name)) {
                displayName = name;
                storeDisplayName(name);
                joinRoom($('joinMicToggle').checked, $('joinCamToggle').checked);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
