# ArenaMeet

Real-time video meetings in the browser. No account, no download —
pick a room name and meet.

ArenaMeet is a clean-room build: every page, stylesheet and script in
this package was written for this project. The video engine is
[LiveKit](https://livekit.io) (client and server SDKs, Apache-2.0),
used as a dependency. The code is proprietary software, licensed under
the [ArenaMeet Licence](LICENSE.md) — copyright © 2026 Anish Kumar
(FLASHANISH).

## Features

- Join a meeting by room name — no account, no sign-up
- HD video grid with active-speaker highlight
- Microphone / camera toggle, screen sharing
- In-call chat (LiveKit data tracks)
- Leave and rejoin, call timer, participant count, copy room link
- Works on desktop and mobile browsers (Chrome, Edge, Firefox, Safari)
- Landing page, new-room page and privacy page included

## How it works

- `/` serves the landing page, `/newroom` the room-creation page,
  `/privacy` the privacy policy, `/join/<room>` the meeting room.
- `/api/token` is a serverless function that mints a short-lived
  LiveKit join token (6 hours) for the requested room. It reads the
  LiveKit credentials from environment variables only — the API secret
  never leaves the server.
- The browser then connects straight to LiveKit Cloud for audio,
  video, screen share and chat. No media passes through this app's
  server.

## Quick start (local)

```bash
npm install
cp .env.example .env   # fill in your own values (see below)
node dev.js            # http://localhost:3000
node scripts/test-token.js   # mints a real token and checks the credentials
```

Environment variables (see `.env.example`):

| Variable | What it is |
| --- | --- |
| `LIVEKIT_URL` | Your LiveKit Cloud project URL (`wss://....livekit.cloud`) |
| `LIVEKIT_API_KEY` | LiveKit project API key |
| `LIVEKIT_API_SECRET` | LiveKit project API secret (shown once at creation) |

## Deploy

See [DEPLOY.md](DEPLOY.md) for the Vercel deploy steps and the LiveKit
free-plan setup.

## Licence

ArenaMeet is proprietary software under the [ArenaMeet
Licence](LICENSE.md). One purchase = one licence = one end product.

- **Redistribution is prohibited.** The buyer may not redistribute,
  resell or share the code. Leaked copies can be reported — the seller
  can file a DMCA takedown with the host and report the listing to
  Envato.

## Free-plan limits to know about

- **LiveKit Cloud Build plan**: 5,000 WebRTC minutes per month,
  100 concurrent connections, 50 GB egress. When the minutes run out,
  new calls are refused until the allowance resets on the 1st of the
  next month — there is no overage billing on this plan.
- **Vercel Hobby**: the token function runs well inside the free
  serverless limits (one tiny request per join).

## Project layout

```
api/
  token.js            join-token endpoint (LiveKit)
public/
  views/              landing.html, newroom.html, privacy.html, RoomLiveKit.html
  css/                base.css (tokens), site.css, RoomLiveKit.css
  js/                 site.js, RoomLiveKit.js, livekit-client.umd.min.js
  images/             logo.svg, am-mc.png, background.jpg
scripts/
  test-token.js       token endpoint smoke test (needs real credentials)
dev.js                dependency-free local dev server
vercel.json           Vercel rewrites + function settings
```
