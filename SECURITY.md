# Security

## Secrets

Never commit:

- Discord bot token
- Strava client secret
- Strava access/refresh tokens
- PostgreSQL password
- token encryption key
- Strava state signing secret

Keep these in `.env` on the host or migrate to a secret manager later.

## Public exposure

Only expose the HTTP application through HTTPS. PostgreSQL must remain private.

Recommended external paths:

- `POST /discord/interactions`
- `GET /health`
- `GET /ready` (optional; can be kept internal)
- `GET /strava/oauth`
- `GET /strava/oauth/callback`
- `GET/POST /strava/webhook`

## Discord

All incoming Discord interactions are verified using the request signature, timestamp, exact raw request body and the application's Ed25519 public key.

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

## Reporting

Do not open a public issue containing credentials or access tokens. Rotate any secret that may have been exposed.
