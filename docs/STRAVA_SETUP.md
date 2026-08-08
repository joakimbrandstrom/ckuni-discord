# Strava integration

Strava is optional. Discord rides work without it.

## Why per-user OAuth

Every CK UNI member explicitly connects their own Strava account. The application does not depend on Strava Club member/activity endpoints.

## Register a Strava API application

Create a Strava API application and configure its callback domain to match `PUBLIC_BASE_URL`.

Add to `.env`:

```dotenv
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
STRAVA_VERIFY_TOKEN=...
STRAVA_STATE_SECRET=...
TOKEN_ENCRYPTION_KEY=...
```

Generate secrets:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

## OAuth

A member runs:

```text
/strava connect
```

The bot returns a private signed URL. OAuth requests `read,activity:read`.

Callback:

```text
https://bot.example.com/strava/oauth/callback
```

Tokens are encrypted before storage.

## Webhook

Callback URL:

```text
https://bot.example.com/strava/webhook
```

Strava validates the callback with a GET request containing `hub.challenge`, `hub.mode`, and `hub.verify_token`.

The POST handler accepts activity events and athlete deauthorization events.

Create the webhook subscription after the public callback is reachable:

```bash
npm run strava:webhook:create
```

Strava allows one webhook subscription per application, which covers all athletes who authorize the app.

V0.1 activity matching uses:

- connected athlete
- `VirtualRide`
- activity start within ±30 minutes of a CK UNI ride
- member was `going` or `maybe`

A match marks attendance and makes it available to `/leaderboard`.

## API base URL

The default in this repository is the current V3 base URL:

```text
https://www.strava.com/api/v3
```

Strava announced a future move to `https://api-v3.strava.com`, so the base URL is configurable with `STRAVA_API_BASE_URL` rather than hard-coded throughout the application.

## 2026 Club API change

This project intentionally does not depend on Strava Club Activities, Club Members or Club Admins APIs. Strava announced those endpoints will be removed on 1 September 2026. Each Discord member connects individually instead.
