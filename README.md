# CK UNI Discord

Digital clubhouse for CK UNI cycling: Discord community, official ride signups and reminders,
with CK UNI-owned attendance and leaderboard data. Zwift hosts the actual events.

CK UNI Discord does not integrate with Strava or require members to link external fitness accounts.
There is no unofficial Zwift API or scraping dependency. This release removes the integration and
includes the database retirement migration. Existing installations must follow the
[retirement upgrade notes](docs/LOCAL_DEPLOYMENT.md#strava-retirement-upgrade); production deployment
and provider-side cleanup remain operator actions.

## What v0.2 includes

- HTTP-based Discord interactions, plus an optional outbound Gateway connection for member joins
- `/ping`
- `/ride create`, `/ride edit`, `/ride list`, `/ride cancel`
- Join / Maybe buttons with live participant counts
- Discord Scheduled Event creation for each ride
- Automatic 24-hour and 30-minute reminders
- PostgreSQL persistence
- Optional automatic welcome messages with links to the server's existing channels
- podman Compose deployment for a home server
- Cloudflare Tunnel ingress with no router port-forward
- Cloudflare Quick Tunnel profile for the first test
- `/health` and `/ready` endpoints
- `/leaderboard` based on confirmed CK UNI attendance

## Architecture

The disabled-by-default [optional Zwift provider boundary](docs/ZWIFT_INTEGRATION.md) supports
future permitted event/results/profile lookups. No live provider is configured or required.

```text
Discord interactions
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
            |
            +---> Discord Gateway (optional, outbound-only member events)
```

Discord owns community interaction, official ride publication, signups and reminders. CK UNI owns
attendance decisions and leaderboard data in PostgreSQL. Zwift remains the place where the actual
event happens; leaders create events there and share their links in Discord. The rest of the home
server can remain behind VPN/Tailscale.

Commands, buttons and forms continue to use signed HTTP interactions. The optional Gateway client
only receives member events used by automatic welcome messages.

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

To enable automatic welcome messages, also set the four existing channel IDs:

```dotenv
DISCORD_WELCOME_CHANNEL_ID=...
DISCORD_ANNOUNCEMENTS_CHANNEL_ID=...
DISCORD_ZWIFT_RIDE_CHANNEL_ID=...
DISCORD_GENERAL_CHANNEL_ID=...
```

Do not commit `.env`.

## 3. Start locally

```bash
podman compose up -d --build
```

The bot is deliberately bound only to the server's loopback interface:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

It should not be reachable directly through the server's LAN IP.

## 4. Register Discord commands

```bash
podman compose run --rm bot node dist/src/discord/register-commands.js
```

Or during development:

```bash
npm install
npm run commands:register
```

## 5. First public test — no domain required

Start the Cloudflare Quick Tunnel profile:

```bash
podman compose --profile quick-tunnel up -d --build
podman compose logs cloudflared-quick
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

Put the tunnel token in `.env`:

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
```

Start:

```bash
podman compose --profile tunnel up -d --build
```

No router port-forward is needed. PostgreSQL remains private and the bot's host port remains loopback-only.

See [`docs/CLOUDFLARE_TUNNEL.md`](docs/CLOUDFLARE_TUNNEL.md) for the exact Cloudflare setup and troubleshooting steps, and [`docs/LOCAL_DEPLOYMENT.md`](docs/LOCAL_DEPLOYMENT.md) for home-server operations.

## Discord commands

### Create and edit a ride

```text
/ride create
/ride edit id:12
```

The intended leader flow is:

1. Create the official event in Zwift Companion.
2. Copy the Zwift event URL.
3. Run `/ride create` in Discord.
4. Select a common template or `Kopiera senaste`.
5. Verify the proposed date and time.
6. Paste the Zwift URL.
7. Review the private preview.
8. Select `Publicera`.

Up to three common templates appear as direct mobile-friendly buttons. Other templates remain in
the `Andra mallar` dropdown. A scheduled template proposes its next weekday and time in the
configured CK UNI timezone. Copying the latest official ride preserves its reusable details,
clears its old Zwift URL and proposes the next weekly occurrence. The leader can always adjust the
date and time before continuing.

Each form step is saved as a PostgreSQL draft and followed by a preview. Nothing public is created
until the leader selects `Publicera`. The confirmation creates the ride, adds the leader as going,
posts the card with `Jag kommer` and `Kanske`, and creates the Discord Scheduled Event. A partial
Discord failure can be retried without reposting completed steps. Zwift remains the source of truth;
Discord does not create the Zwift event, call a Zwift API, scrape Zwift or store Zwift credentials.
The pasted event URL is the only integration point.

Ride Leaders and administrators can edit upcoming rides with `/ride edit`; the existing card and
Scheduled Event are updated.

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
/ride mall-redigera id:3
/ride mall-inaktivera id:3
```

Templates keep the reusable title, duration, ride type and optional ride details. In the existing
template form, add these optional lines under `Schema, snabbval och detaljer`:

```text
Veckotid: tisdag 18:00
Snabbval: 1
Beskrivning: Fyra intervallblock
```

`Veckotid` sets the normal weekly start. `Snabbval` pins the template as a direct button; its number
sets ordering. Omit either line for a manually scheduled or non-pinned template. Use `/ride create`
and select the template by name to create a ride from it. The older `/ride mall-skapa id:3` command
is temporarily available for backwards compatibility and opens the same draft and preview flow.

### Optional Zwift lookups

Optional `/zwift results` lookup is described in the
[Zwift integration guide](docs/ZWIFT_INTEGRATION.md#results-lookup-62). It is disabled by default
and requires a permitted results provider; no live adapter is included.

### Leaderboard

```text
/leaderboard
```

The current leaderboard awards 10 points per stored attendance record
(`ride_participants.attended_at IS NOT NULL`). The intent is participation, not FTP or speed.
Existing attendance storage and leaderboard behavior are preserved by the retirement; signup alone
does not mark attendance. There is no new member or leader attendance UI in this cleanup.

### Planned attendance flow (#12)

[Manual attendance #12](https://github.com/joakimbrandstrom/ckuni-discord/issues/12) will provide
the post-ride flow for official CK UNI rides:

1. A signed-up member selects `Jag var med` after the ride to report participation.
2. A leader reviews the reports and confirms or removes members, or adds missing participants.
3. The leader finalizes attendance, which is the basis for the CK UNI leaderboard and Winter Cup.

This is desired behavior, not a currently available UI. Spontaneous rides in `#spontan-rides` are
excluded from official attendance, leaderboard scoring and Winter Cup.

## Data model

- `users`
- `rides`
- `ride_templates`
- `ride_drafts`
- `ride_participants`
- `schema_migrations`

SQL migrations live in [`migrations/`](migrations/). They are append-only. Migration
`005_ride_template_scheduling.sql` adds nullable weekly schedule fields plus quick-create ordering;
existing templates remain valid and continue to use manual date/time entry. The earlier
`004_remove_strava.sql` drops the retired activity and connection tables while preserving
`ride_participants.attended_at`. See the upgrade notes before migrating an existing database.

## Security

- No router port-forward is required for the recommended deployment.
- The bot publishes port 3000 only on `127.0.0.1` for local diagnostics.
- Cloudflare Tunnel reaches `bot:3000` through podman's private network.
- PostgreSQL is not published by Compose.
- Discord interaction signatures are verified with Ed25519 before commands are processed.
- `.env` is ignored by Git.

Read [`SECURITY.md`](SECURITY.md) before putting this on a permanent public hostname.

## Roadmap

GitHub Issues are the source of truth for the project roadmap.

1. **[v0.1 Deployment & Discord MVP](https://github.com/joakimbrandstrom/ckuni-discord/issues/20)** — deploy the home-server stack, connect Discord, validate the complete ride flow, harden reminders and add Ride Leader/Admin permissions.
2. **[v0.2 Pilot & UX](https://github.com/joakimbrandstrom/ckuni-discord/issues/21)** — improve ride creation/editing, add templates and run a real CK UNI pilot with 5–10 riders.
3. **[v0.3 Attendance & Winter Cup](https://github.com/joakimbrandstrom/ckuni-discord/issues/22)** - CK UNI-owned attendance through [#12](https://github.com/joakimbrandstrom/ckuni-discord/issues/12), with [Winter Cup #14](https://github.com/joakimbrandstrom/ckuni-discord/issues/14) moving into this theme for seasons and participation scoring.
4. **[v0.4 Community](https://github.com/joakimbrandstrom/ckuni-discord/issues/23)** - community follow-on work such as weekly recaps, achievements and Discord interest roles.

Spontaneous ride suggestions use normal messages and reactions in `#spontan-rides`; the bot does
not create cards, events or reminders for them. Future backlog includes
[outdoor club rides](https://github.com/joakimbrandstrom/ckuni-discord/issues/19).

Before inviting riders, complete the [v0.2 pilot checklist](docs/PILOT_CHECKLIST.md).

Priorities are encoded in issue titles: `P0` = required for the first deployment, `P1` = pilot/MVP usability, `P2` = attendance/Winter Cup, `P3` = community features, and `P4` = future digital-clubhouse expansion.

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
focused mutation suite covers deterministic ride and authorization
logic and runs weekly or on demand in GitHub Actions rather than blocking every pull request.

The scoped npm override for `typed-rest-client@2.3.1` replaces its vulnerable `qs@6.15.1`
pin with `qs@6.16.0`. This dependency comes from Stryker; remove the override when Stryker
adopts a REST-client release that already uses a fixed `qs` version. `npm audit` checks
both production and development dependencies.

The test suite uses Node's built-in test runner through `tsx`. HTTP tests use
`Fastify.inject()`, so they do not open a network port. PostgreSQL integration
tests run when `TEST_DATABASE_URL` is set; they apply the real migrations before
testing ride lifecycle, participation, attendance and leaderboard behavior:

```bash
TEST_DATABASE_URL=postgres://ckuni:password@localhost:5432/ckuni_test \
  npm run test:integration
```

CI provides an isolated PostgreSQL service for these tests. A separate smoke
job builds the production image, starts it with the Compose PostgreSQL and
migration services, and probes both `/health` and `/ready`.

## License

MIT.
