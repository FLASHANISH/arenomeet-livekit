'use strict';

/**
 * ArenaMeet — LiveKit access-token endpoint.
 *
 * Vercel serverless function (Node.js). Mints a short-lived LiveKit
 * join token for a room and returns it together with the LiveKit
 * Cloud URL the browser should connect to.
 *
 * Credentials come ONLY from environment variables — nothing secret
 * is stored in this file or in the repository:
 *   LIVEKIT_URL        wss://<project>.livekit.cloud   (safe to expose to the browser)
 *   LIVEKIT_API_KEY    LiveKit project API key         (server-side only)
 *   LIVEKIT_API_SECRET LiveKit project API secret      (server-side only)
 *
 * Behaviour when the service is not configured: the endpoint answers
 * 503 with a generic message. It never leaks whether a variable is
 * missing, and it never echoes a secret.
 */

const { AccessToken } = require('livekit-server-sdk');

const MAX_VALUE_LENGTH = 64;
// Room names, identities and display names: letters, digits, space,
// underscore, dot and dash. Must start with a letter or digit.
const VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\-]*$/;

function cleanValue(value) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, MAX_VALUE_LENGTH);
}

function getParams(req) {
    const query = req.query && typeof req.query === 'object' ? req.query : {};
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return { ...query, ...body };
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        return res.status(503).json({ error: 'Video service is not configured' });
    }

    const params = getParams(req);
    const room = cleanValue(params.room);
    const identity = cleanValue(params.identity);
    const displayName = cleanValue(params.name || params.displayName) || identity;

    if (!room || !VALUE_RE.test(room)) {
        return res.status(400).json({ error: 'Invalid room name' });
    }
    if (!identity || !VALUE_RE.test(identity)) {
        return res.status(400).json({ error: 'Invalid identity' });
    }
    if (!displayName || !VALUE_RE.test(displayName)) {
        return res.status(400).json({ error: 'Invalid display name' });
    }

    try {
        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
            identity,
            name: displayName,
            // Tokens live for one call session; a fresh token is minted per join.
            ttl: 6 * 60 * 60,
        });
        token.addGrant({
            roomJoin: true,
            room,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
            canUpdateOwnMetadata: true,
        });

        return res.status(200).json({
            token: await token.toJwt(),
            url: LIVEKIT_URL,
        });
    } catch (err) {
        console.error('token mint failed:', err && err.message ? err.message : err);
        return res.status(500).json({ error: 'Could not create a join token' });
    }
};
