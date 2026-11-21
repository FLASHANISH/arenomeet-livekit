'use strict';

/**
 * ArenaMeet — landing / new-room page behaviour (original work).
 *
 * - Room forms: validate the room name, then go to /join/<room>.
 * - New-room page: generates a random room name on load.
 * - FAQ: accordion (button toggles the answer).
 */

(function () {
    var VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]*$/;
    var MAX_ROOM_LENGTH = 64;

    function $(id) {
        return document.getElementById(id);
    }

    function showError(form, message) {
        var error = form.querySelector('.form-error');
        if (error) {
            error.textContent = message;
            error.hidden = false;
        }
    }

    function clearError(form) {
        var error = form.querySelector('.form-error');
        if (error) {
            error.textContent = '';
            error.hidden = true;
        }
    }

    function goToRoom(roomName) {
        window.location.href = '/join/' + encodeURIComponent(roomName);
    }

    // Room forms (landing hero, creation panel, new-room page).
    document.querySelectorAll('[data-room-form]').forEach(function (form) {
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            clearError(form);
            var input = form.querySelector('input[type="text"]');
            var roomName = (input.value || '').trim().slice(0, MAX_ROOM_LENGTH);
            if (!roomName || !VALUE_RE.test(roomName)) {
                showError(
                    form,
                    'Pick a room name using letters, numbers, spaces and dashes (up to 64 characters).',
                );
                input.focus();
                return;
            }
            goToRoom(roomName);
        });
    });

    // Random room name for the new-room page.
    var WORDS_A = ['arena', 'squad', 'nova', 'apex', 'orbit', 'pixel', 'turbo', 'cosmic'];
    var WORDS_B = ['meet', 'room', 'call', 'hub', 'lounge', 'studio', 'den', 'base'];

    function randomRoomName() {
        var a = WORDS_A[Math.floor(Math.random() * WORDS_A.length)];
        var b = WORDS_B[Math.floor(Math.random() * WORDS_B.length)];
        var n = Math.floor(100 + Math.random() * 900);
        return a + '-' + b + '-' + n;
    }

    var newRoomInput = $('newRoomName');
    if (newRoomInput && !newRoomInput.value) {
        newRoomInput.value = randomRoomName();
    }

    var regenerateBtn = $('regenerateRoomBtn');
    if (regenerateBtn && newRoomInput) {
        regenerateBtn.addEventListener('click', function () {
            newRoomInput.value = randomRoomName();
            newRoomInput.focus();
        });
    }

    // FAQ accordion.
    document.querySelectorAll('.faq-q').forEach(function (button) {
        button.addEventListener('click', function () {
            var item = button.closest('.faq-item');
            var answer = item.querySelector('.faq-a');
            var mark = button.querySelector('.faq-mark');
            var isOpen = !answer.hidden;
            answer.hidden = isOpen;
            button.setAttribute('aria-expanded', String(!isOpen));
            if (mark) mark.textContent = isOpen ? '+' : '–';
        });
    });
})();
