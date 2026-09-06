# Security

## Secrets

Never commit:

- Discord bot token
- Cloudflare Tunnel token
- PostgreSQL password

Keep these in `.env` on the host or migrate to a secret manager later.

A Cloudflare Tunnel token is sensitive: anyone who has it can run a connector for that tunnel. Rotate it if it may have been exposed.

## Public exposure

The recommended home-server deployment uses Cloudflare Tunnel. `cloudflared` establishes the connection outbound from the server, so no router port-forward or public origin IP is required.

The application is bound on the host only to:

```text
127.0.0.1:3000
```

The `cloudflared` container reaches the bot directly over podman networking at:

```text
http://bot:3000
```

PostgreSQL has no published host port and must remain private.

The Strava-free release exposes these application routes through the tunnel:

- `POST /discord/interactions`
- `GET /health`
- `GET /ready`

`/health` and `/ready` return only generic state and no database details or credentials.

Do not place an interactive Cloudflare Access login in front of Discord interactions; Discord cannot
complete an interactive login flow. If additional edge filtering is added later, ensure the
interaction endpoint remains reachable by Discord.

## Discord

All incoming Discord interactions are verified using the request signature, timestamp, exact raw request body and the application's Ed25519 public key.

Requests that fail signature verification must not be processed.

## Data ownership and retirement

CK UNI owns attendance and leaderboard data. The architecture has no Strava dependency,
fitness-account linking, unofficial APIs or scraping. Member attendance reporting and leader review
are planned in #12, not provided by this removal release.

Existing deployments must follow the [retirement upgrade notes](docs/LOCAL_DEPLOYMENT.md#strava-retirement-upgrade).
Removing application routes or database tables does not retire a provider-side webhook subscription
or revoke access grants. Operators must retire the subscription, revoke provider access and remove
retired deployment configuration, including the encryption key and `PUBLIC_BASE_URL`.

Backups can retain historic activity data, connection records and encrypted tokens after live tables
are dropped. Protect them as sensitive data and apply the operator's retention/deletion policy;
the migration does not purge backups. These notes do not establish that production retirement or
provider-side cleanup has been completed.

## Home-server boundary

Keep administration paths behind the existing VPN/Tailscale setup:

- SSH
- podman daemon/socket
- dashboards and monitoring
- database access
- other home services

The CK UNI bot should be the only service exposed through its dedicated Cloudflare hostname.

## Reporting

Do not open a public issue containing credentials or access tokens. Rotate any secret that may have been exposed.
