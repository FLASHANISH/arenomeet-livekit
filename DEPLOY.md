# Deploying ArenaMeet on Vercel

ArenaMeet runs as a static site + one small serverless function on
Vercel, with video calls carried by LiveKit Cloud. No server of your
own, no card needed on the free plans.

## What you need

- This package, pushed to a Git repository.
- A Vercel account (free Hobby plan is enough).
- A LiveKit Cloud project on the free **Build** plan ($0/month, no
  card). From the LiveKit dashboard (Project -> Settings -> Keys) you
  need:
  - `LIVEKIT_URL` — the project's WebSocket URL (`wss://....livekit.cloud`)
  - `LIVEKIT_API_KEY` — the project's API key
  - `LIVEKIT_API_SECRET` — the project's API secret (shown once at creation)

## Deploy steps

1. Push this folder to a GitHub repository. `.env` is git-ignored
   and must never be committed.
2. In Vercel: **Add New -> Project -> Import** the repository.
   - Framework preset: **Other** (no build step).
   - Root directory: the repository root.
   - No build command, no output directory override.
3. Before the first deploy, add the environment variables
   (Project Settings -> Environment Variables, all environments):
   - `LIVEKIT_URL`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
4. Deploy. Vercel gives you a `https://<project>.vercel.app` URL.
5. Test: open the URL, type a room name, join — then open the same
   room link in a second browser/device and check both sides see each
   other.

## How it works

- `/` serves the landing page (`public/views/landing.html`).
- `/join/?room=<name>` or `/join/<name>` serves the room page
  (`public/views/RoomLiveKit.html`).
- `/newroom` serves the room-creation page, `/privacy` the privacy
  policy.
- `/api/token` is a serverless function that mints a short-lived
  LiveKit join token (6 hours) for the requested room. It reads the
  LiveKit credentials from environment variables and nothing else;
  the API secret never leaves the server.
- The browser then connects straight to LiveKit Cloud for audio,
  video, screen share and chat. No media passes through Vercel.

## Licence

ArenaMeet is proprietary software under the [ArenaMeet
Licence](LICENSE.md). One purchase = one licence = one end product.
There is no activation step and no licence key to enter — the buyer
installs the code and uses it. Redistribution, resale or sharing of
the code is prohibited by the licence terms. If a leaked copy is
found, the seller can file a DMCA takedown with the host serving it
and report the listing to Envato.

## Free-plan limits to know about

- **LiveKit Cloud Build plan**: 5,000 WebRTC minutes per month,
  100 concurrent connections, 50 GB egress. When the minutes run out,
  new calls are refused until the allowance resets on the 1st of the
  next month — there is no overage billing on this plan.
- **Vercel Hobby**: the token function runs well inside the free
  serverless limits (one tiny request per join).

## Local development

```bash
npm install
cp .env.example .env   # fill in your own values
node dev.js            # http://localhost:3000
node scripts/test-token.js   # mints a real token and checks the credentials
```

Local notes:

- The dev server mirrors the Vercel rewrites and runs `api/token.js`
  locally.

## If a join fails

- "Video service is not configured" — one of the three LiveKit
  environment variables is missing in Vercel (or in `.env` locally).
  Redeploy after adding them; changing env vars needs a redeploy to
  take effect.
- Camera/mic permission denied — the join still succeeds, muted.
  Allow camera/mic in the browser and rejoin.
- The room page needs HTTPS (or localhost) for camera/mic access.
  Vercel provides HTTPS by default; plain `http://` on a public host
  will not grant camera access.
