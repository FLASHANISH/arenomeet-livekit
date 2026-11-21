'use strict';

/**
 * ArenaMeet (LiveKit edition) — minimal local dev server.
 *
 * Serves public/ as the site root, applies the same rewrites as
 * vercel.json, and runs api/token.js for /api/token.
 *
 *   node dev.js            # http://localhost:3000
 *   PORT=4000 node dev.js  # http://localhost:4000
 *
 * Reads .env from this folder (LIVEKIT_URL, LIVEKIT_API_KEY,
 * LIVEKIT_API_SECRET). No third-party dependencies.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

// --- tiny .env loader (no dotenv dependency) -------------------------
const envPath = path.join(__dirname, '.env');
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

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

function rewritePath(pathname) {
    if (pathname === '/') return '/views/landing.html';
    if (pathname === '/join' || pathname === '/join/') return '/views/RoomLiveKit.html';
    if (pathname.startsWith('/join/')) return '/views/RoomLiveKit.html';
    if (pathname === '/privacy') return '/views/privacy.html';
    if (pathname === '/newroom') return '/views/newroom.html';
    return pathname;
}

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
}

function serveFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (err, data) => {
        if (err) {
            sendJson(res, 404, { error: 'Not found' });
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

const tokenHandler = require('./api/token.js');

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/token') {
        // Shape the request like Vercel does: parsed query + JSON body.
        req.query = Object.fromEntries(url.searchParams.entries());
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            try {
                req.body = raw ? JSON.parse(raw) : {};
            } catch (err) {
                req.body = {};
            }
            // Minimal res shim: the handler only uses status().json() and setHeader().
            const resShim = {
                setHeader: (name, value) => res.setHeader(name, value),
                status: (code) => ({
                    json: (obj) => sendJson(res, code, obj),
                }),
            };
            Promise.resolve(tokenHandler(req, resShim)).catch((err) => {
                console.error('token handler error:', err && err.message ? err.message : err);
                if (!res.headersSent) sendJson(res, 500, { error: 'Could not create a join token' });
            });
        });
        return;
    }

    const rewritten = rewritePath(url.pathname);
    const safePath = path.normalize(path.join(ROOT, rewritten));
    if (!safePath.startsWith(ROOT)) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
    }
    fs.stat(safePath, (err, stat) => {
        if (err || !stat.isFile()) {
            sendJson(res, 404, { error: 'Not found' });
            return;
        }
        serveFile(res, safePath);
    });
});

server.listen(PORT, () => {
    const configured = Boolean(
        process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET,
    );
    console.log('ArenaMeet dev server: http://localhost:' + PORT);
    console.log('LiveKit token endpoint: ' + (configured ? 'configured' : 'NOT configured (check .env)'));
});
