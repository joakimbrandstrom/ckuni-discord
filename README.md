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
- Cloudflare Tunnel ingress with no router port-forward
- Cloudflare Quick Tunnel profile for the first test
- `/health` and `/ready` endpoints
- Optional `/strava connect` OAuth flow
- Strava webhook receiver and basic VirtualRide → CK UNI ride matching
- Encrypted Strava access/refresh tokens at rest
- `/leaderboard` based on confirmed CK UNI attendance

## Architecture

```text
Discord / Strava
      |
      v
Cloudflare HTTPS
      |
      v
Cloudflare Tunnel (outbound-only)
      |
      v
cloudflared container
      |
      v
CK UNI bot (Fastify/TypeScript) ---> PostgreSQL
```

Discord remains the UI. Zwift remains the place where the ride happens. Strava is only used for opt-in activity data. The rest of the home server can remain behind VPN/Tailscale.

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
```

Do not commit `.env`.

## 3. Start locally

```bash
docker compose up -d --build
```

The bot is deliberately bound only to the server's loopback interface:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

It should not be reachable directly through the server's LAN IP.

## 4. Register Discord commands

```bash
docker compose run --rm bot node dist/src/discord/register-commands.js
```

Or during development:

```bash
npm install
npm run commands:register
```

## 5. First public test — no domain required

Start the Cloudflare Quick Tunnel profile:

```bash
docker compose --profile quick-tunnel up -d --build
docker compose logs cloudflared-quick
```

Copy the generated URL, for example:

```text
https://random-words.trycloudflare.com
```

Set the Discord application's Interactions Endpoint URL to:

```text
https://random-words.trycloudflare.com/discord/interactions
```

Then test `/ping` in Discord.

Quick Tunnel is development-only and the hostname changes when recreated.

## 6. Permanent Cloudflare Tunnel

After the first test works, create a remotely-managed Cloudflare Tunnel and route your chosen public hostname to:

```text
http://bot:3000
```

Put the tunnel token and hostname in `.env`:

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
PUBLIC_BASE_URL=https://bot.your-domain.example
```

Start:

```bash
docker compose --profile tunnel up -d --build
```

No router port-forward is needed. PostgreSQL remains private and the bot's host port remains loopback-only.

See [`docs/CLOUDFLARE_TUNNEL.md`](docs/CLOUDFLARE_TUNNEL.md) for the exact Cloudflare setup and troubleshooting steps, and [`docs/LOCAL_DEPLOYMENT.md`](docs/LOCAL_DEPLOYMENT.md) for home-server operations.

## Discord commands

### Create and edit a ride

```text
/ride create
/ride edit id:12
```

The bot opens a Swedish form for the ride details. After submission it posts a ride card with
`Jag kommer` and `Kanske` buttons and creates a Discord Scheduled Event. Ride Leaders and
administrators can edit upcoming rides; the existing card and Scheduled Event are updated.

### List upcoming rides

```text
/ride list
```

### Cancel a ride

```text
/ride cancel id:12
```

Ride Leaders and administrators can cancel a scheduled ride. The bot marks its existing ride card
as cancelled, disables its participation buttons and cancels the Discord Scheduled Event.

### Manage ride templates

```text
/ride mall-spara
/ride mall-lista
/ride mall-skapa id:3
/ride mall-redigera id:3
/ride mall-inaktivera id:3
```

Templates keep the reusable title, duration, ride type and optional ride details. Creating a ride
from a template asks only for its start time and optional Zwift link.

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
- `ride_templates`
- `ride_participants`
- `strava_connections`
- `activities`
- `schema_migrations`

SQL migrations live in [`migrations/`](migrations/).

## Security

- No router port-forward is required for the recommended deployment.
- The bot publishes port 3000 only on `127.0.0.1` for local diagnostics.
- Cloudflare Tunnel reaches `bot:3000` through Docker's private network.
- PostgreSQL is not published by Compose.
- Discord interaction signatures are verified with Ed25519 before commands are processed.
- Strava tokens are encrypted using AES-256-GCM.
- `.env` is ignored by Git.
- Strava is opt-in per athlete.

Read [`SECURITY.md`](SECURITY.md) before putting this on a permanent public hostname.

## Roadmap

GitHub Issues are the source of truth for the project roadmap.

1. **[v0.1 Deployment & Discord MVP](https://github.com/joakimbrandstrom/ckuni-discord/issues/20)** — deploy the home-server stack, connect Discord, validate the complete ride flow, harden reminders and add Ride Leader/Admin permissions.
2. **[v0.2 Pilot & UX](https://github.com/joakimbrandstrom/ckuni-discord/issues/21)** — improve ride creation/editing, add templates and run a real CK UNI pilot with 5–10 riders.
3. **[v0.3 Strava & Attendance](https://github.com/joakimbrandstrom/ckuni-discord/issues/22)** — harden opt-in Strava integration, privacy controls, manual attendance and activity matching.
4. **[v0.4 Winter Cup & Community](https://github.com/joakimbrandstrom/ckuni-discord/issues/23)** — seasons, participation scoring, weekly recaps, achievements and Discord interest roles.

Future backlog includes [quick spontaneous rides](https://github.com/joakimbrandstrom/ckuni-discord/issues/18) and [outdoor club rides](https://github.com/joakimbrandstrom/ckuni-discord/issues/19).

Priorities are encoded in issue titles: `P0` = required for the first deployment, `P1` = pilot/MVP usability, `P2` = Strava/attendance, `P3` = community features, and `P4` = future digital-clubhouse expansion.

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
npm run coverage
npm run typecheck
npm run check
npm run build
```

Run `npm run format` to apply Biome formatting and safe lint fixes. Mutation testing is
available through `npm run mutation`; its HTML report is written to `reports/mutation/`. The
focused mutation suite covers deterministic ride, authorization, state-signing, and encryption
logic and runs weekly or on demand in GitHub Actions rather than blocking every pull request.

The test suite uses Node's built-in test runner through `tsx`. HTTP tests use
`Fastify.inject()`, so they do not open a network port. PostgreSQL integration
tests run when `TEST_DATABASE_URL` is set; they apply the real migrations before
testing ride lifecycle, participation, attendance, leaderboard, and Strava
activity matching behavior:

```bash
TEST_DATABASE_URL=postgres://ckuni:password@localhost:5432/ckuni_test \
  npm run test:integration
```

CI provides an isolated PostgreSQL service for these tests. A separate smoke
job builds the production image, starts it with the Compose PostgreSQL and
migration services, and probes both `/health` and `/ready`.

## License

MIT.
