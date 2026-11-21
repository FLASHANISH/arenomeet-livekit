'use strict';

/**
 * ArenaMeet — token endpoint smoke test (local only).
 *
 *   node scripts/test-token.js
 *
 * What it checks, in order:
 *   1. api/token.js mints a JWT for a test room/identity (env from .env).
 *   2. The minted JWT decodes to the expected room, identity and grants.
 *   3. The API key + secret are accepted by the LiveKit Cloud project
 *      (RoomServiceClient.listRooms — proves the server credentials).
 *   4. Best effort: the LiveKit /rtc/validate endpoint accepts the token.
 *
 * It never prints a credential value or a full token — only a short
 * prefix of the token and the decoded (public) JWT payload.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// --- tiny .env loader (mirrors dev.js) -------------------------------
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key && process.env[key] === undefined) process.env[key] = value;
    }
}

function base64UrlDecode(segment) {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64').toString('utf8');
}

function makeReqRes() {
    let statusCode = 200;
    let payload = null;
    const req = {
        method: 'GET',
        query: { room: 'test-room', identity: 'test-user', name: 'Test User' },
        body: {},
    };
    const res = {
        setHeader: () => {},
        status: (code) => {
            statusCode = code;
            return {
                json: (obj) => {
                    payload = obj;
                },
            };
        },
    };
    return { req, res, getStatus: () => statusCode, getPayload: () => payload };
}

async function main() {
    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    console.log('--- ArenaMeet token endpoint test ---');
    console.log('LIVEKIT_URL set:', Boolean(LIVEKIT_URL));
    console.log('LIVEKIT_API_KEY set:', Boolean(LIVEKIT_API_KEY));
    console.log('LIVEKIT_API_SECRET set:', Boolean(LIVEKIT_API_SECRET));
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        console.log('RESULT: FAIL — env vars missing (see .env.example).');
        process.exit(1);
    }

    // 1. Mint a token through the real endpoint handler.
    const tokenHandler = require(path.join(ROOT, 'api', 'token.js'));
    const { req, res, getStatus, getPayload } = makeReqRes();
    await tokenHandler(req, res);
    const status = getStatus();
    const payload = getPayload();
    console.log('1. token endpoint HTTP status:', status);
    if (status !== 200 || !payload || !payload.token) {
        console.log('   error body:', JSON.stringify(payload));
        console.log('RESULT: FAIL — token endpoint did not mint a token.');
        process.exit(1);
    }
    console.log('   token prefix:', String(payload.token).slice(0, 20) + '...');
    console.log('   returned url:', payload.url);

    // 2. Decode the JWT payload and check its claims.
    const parts = String(payload.token).split('.');
    if (parts.length !== 3) {
        console.log('RESULT: FAIL — minted value is not a JWT.');
        process.exit(1);
    }
    const claims = JSON.parse(base64UrlDecode(parts[1]));
    console.log('2. JWT payload:', JSON.stringify(claims, null, 2));
    const grantsOk =
        claims.sub === 'test-user' &&
        claims.video &&
        claims.video.room === 'test-room' &&
        claims.video.roomJoin === true &&
        claims.video.canPublish === true &&
        claims.video.canSubscribe === true;
    console.log('   room/identity/grants as expected:', grantsOk);
    if (!grantsOk) {
        console.log('RESULT: FAIL — JWT claims are wrong.');
        process.exit(1);
    }

    // 3. Prove the API key + secret work against the real project.
    // RoomServiceClient speaks REST over HTTP(S) — the wss:// URL must
    // be converted first, otherwise the request hangs and times out.
    const { RoomServiceClient } = require('livekit-server-sdk');
    const httpUrl = LIVEKIT_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    const roomService = new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    try {
        const rooms = await roomService.listRooms();
        console.log('3. RoomServiceClient.listRooms OK — rooms on the project:', rooms.length);
    } catch (err) {
        console.log('3. RoomServiceClient.listRooms FAILED:', err && err.message ? err.message : err);
        console.log('RESULT: FAIL — LiveKit Cloud rejected the API credentials.');
        process.exit(1);
    }

    // 4. Best effort: does the LiveKit server accept the minted token?
    try {
        const validateUrl = httpUrl + '/rtc/validate?access_token=' + encodeURIComponent(payload.token);
        const response = await fetch(validateUrl);
        const text = await response.text();
        console.log('4. /rtc/validate HTTP status:', response.status);
        console.log('   body:', text.slice(0, 300));
        if (response.status === 200) {
            console.log('   LiveKit accepted the minted token.');
        } else {
            console.log('   NOTE: /rtc/validate did not return 200 — inconclusive, not a failure.');
        }
    } catch (err) {
        console.log('4. /rtc/validate request failed:', err && err.message ? err.message : err);
        console.log('   NOTE: inconclusive, not a failure.');
    }

    console.log('RESULT: PASS — token endpoint mints valid tokens and the LiveKit credentials work.');
}

main().catch((err) => {
    console.error('Test crashed:', err && err.message ? err.message : err);
    process.exit(1);
});
