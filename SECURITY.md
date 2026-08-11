# Security

## Secrets

Never commit:

- Discord bot token
- Cloudflare Tunnel token
- Strava client secret
- Strava access/refresh tokens
- PostgreSQL password
- token encryption key
- Strava state signing secret

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

Current externally reachable application routes through the tunnel are:

- `POST /discord/interactions`
- `GET /health`
- `GET /ready`
- `GET /strava/oauth/callback`
- `GET /strava/webhook`
- `POST /strava/webhook`

`/health` and `/ready` return only generic state and no database details or credentials.

Do not place an interactive Cloudflare Access login in front of Discord interactions or Strava callbacks; those machine-to-machine callers cannot complete an interactive login flow. If additional edge filtering is added later, ensure these callback routes remain reachable by Discord/Strava.

## Discord

All incoming Discord interactions are verified using the request signature, timestamp, exact raw request body and the application's Ed25519 public key.

Requests that fail signature verification must not be processed.

## Strava

Strava connections are opt-in. Access and refresh tokens are encrypted with AES-256-GCM before being written to PostgreSQL.

Generate the encryption key with:

```bash
openssl rand -base64 32
```

Generate a state signing secret with:

```bash
openssl rand -hex 32
```

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
