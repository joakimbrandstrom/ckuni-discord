# CK UNI Discord

Digital clubhouse for CK UNI cycling: Discord community, Zwift group rides and optional Strava activity matching.

## What V0.1 includes

- HTTP-based Discord interactions — no Gateway/WebSocket process required
- `/ping`
- `/ride create`, `/ride list`, `/ride cancel`
- Join / Maybe buttons with live participant counts
- Discord Scheduled Event creation for each ride
- Automatic 24-hour and 30-minute reminders
- PostgreSQL persistence
- Docker Compose deployment for a home server
- `/health` and `/ready` endpoints
- Optional `/strava connect` OAuth flow
- Strava webhook receiver and basic VirtualRide → CK UNI ride matching
- Encrypted Strava access/refresh tokens at rest
- `/leaderboard` based on confirmed CK UNI attendance

## Architecture

```text
Discord ─────┐
             ├── HTTPS ──> CK UNI bot (Fastify/TypeScript) ──> PostgreSQL
Strava ──────┘                         │
                                      └── Discord REST API
```

Discord remains the UI. Zwift remains the place where the ride happens. Strava is only used for opt-in activity data.

## 1. Create the Discord application

Follow [`docs/DISCORD_SETUP.md`](docs/DISCORD_SETUP.md).

You will need:

- Application ID
- Public Key
- Bot Token
- Guild/server ID

## 2. Configure the server

```bash
cp .env.example .env
```

Edit `.env`. At minimum set:

```dotenv
POSTGRES_PASSWORD=...
DATABASE_URL=postgres://ckuni:...@postgres:5432/ckuni
DISCORD_APPLICATION_ID=...
DISCORD_PUBLIC_KEY=...
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
PUBLIC_BASE_URL=https://bot.example.com
```

Do not commit `.env`.

## 3. Start locally

```bash
docker compose up -d --build
```

Check:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

## 4. Register Discord commands

The easiest way is to run the registration script from the bot container:

```bash
docker compose run --rm bot node dist/src/discord/register-commands.js
```

Or during development:

```bash
npm install
npm run commands:register
```

## 5. Expose HTTPS

Discord must reach:

```text
POST https://bot.example.com/discord/interactions
```

Strava later needs:

```text
GET/POST https://bot.example.com/strava/webhook
GET      https://bot.example.com/strava/oauth/callback
```

A reverse proxy or tunnel is recommended. Do **not** expose PostgreSQL to the internet.

See [`docs/LOCAL_DEPLOYMENT.md`](docs/LOCAL_DEPLOYMENT.md).

## Discord commands

### Create a ride

```text
/ride create title:"CK UNI Tuesday Tempo" date:2026-11-10 time:19:00 duration:75 type:intervals zwift_url:https://...
```

The bot posts a ride card with `Join` and `Maybe` buttons and creates a Discord Scheduled Event.

### List upcoming rides

```text
/ride list
```

### Cancel a ride

```text
/ride cancel id:12
```

Only the creator can cancel it in V0.1.

### Connect Strava

```text
/strava connect
```

Strava is optional. See [`docs/STRAVA_SETUP.md`](docs/STRAVA_SETUP.md).

### Leaderboard

```text
/leaderboard
```

V0.1 awards 10 points per confirmed CK UNI ride. The intent is participation, not FTP or speed.

## Data model

- `users`
- `rides`
- `ride_participants`
- `strava_connections`
- `activities`
- `schema_migrations`

SQL migrations live in [`migrations/`](migrations/).

## Security

- Discord interaction signatures are verified with Ed25519 before commands are processed.
- Strava tokens are encrypted using AES-256-GCM.
- `.env` is ignored by Git.
- PostgreSQL is not published by Compose.
- Strava is opt-in per athlete.

Read [`SECURITY.md`](SECURITY.md) before putting this on a public URL.

## Roadmap

1. Improve ride creation UX with Discord modals.
2. Ride leader/admin roles.
3. Manual attendance override.
4. Winter Cup seasons and configurable scoring.
5. Achievements such as Winter Warrior and Tuesday Streak.
6. Outdoor rides using the same `/ride` model.
7. Better Strava activity matching and deauthorization handling.

## Development

```bash
npm install
npm run db:migrate
npm run commands:register
npm run dev
```

Run checks:

```bash
npm test
npm run typecheck
npm run build
```

## License

MIT.
