# Local home-server deployment

## Recommended topology

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
bot:3000  ---> PostgreSQL (private Docker network)
```

The rest of the home server can stay behind VPN/Tailscale. No router port-forward is required for CK UNI Discord.

## Requirements

- Linux server with Docker Engine + Compose plugin
- Git
- Discord application credentials
- For the permanent setup: a Cloudflare-managed domain/hostname and a remotely-managed Cloudflare Tunnel

For the very first test, Cloudflare Quick Tunnel can be used without a domain or Cloudflare token.

## Deploy

```bash
git clone https://github.com/joakimbrandstrom/ckuni-discord.git
cd ckuni-discord
cp .env.example .env
$EDITOR .env
```

### Local-only stack

```bash
docker compose up -d --build
```

The bot is available only on the server loopback interface:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

It is intentionally **not** available at `http://<server-lan-ip>:3000`.

### First public test with Quick Tunnel

```bash
docker compose --profile quick-tunnel up -d --build
docker compose logs cloudflared-quick
```

Copy the generated `https://....trycloudflare.com` URL and use:

```text
https://....trycloudflare.com/discord/interactions
```

as the Discord Interactions Endpoint URL.

### Permanent Cloudflare Tunnel

Create a remotely-managed tunnel and configure a Published application route:

```text
Public hostname: bot.your-domain.example
Service URL:     http://bot:3000
```

Put the tunnel token in `.env`:

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
PUBLIC_BASE_URL=https://bot.your-domain.example
```

Then start:

```bash
docker compose --profile tunnel up -d --build
```

See [`CLOUDFLARE_TUNNEL.md`](CLOUDFLARE_TUNNEL.md) for the full setup and troubleshooting guide.

## Inspect

```bash
docker compose ps
docker compose logs -f bot
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

For a permanent tunnel:

```bash
docker compose --profile tunnel ps
docker compose logs -f cloudflared
```

## Upgrade

Without Tunnel profile:

```bash
git pull
docker compose up -d --build
```

With the permanent Tunnel profile:

```bash
git pull
docker compose --profile tunnel up -d --build
```

Database migrations run automatically when the bot container starts.

## Backup

The important persistent data is the `postgres_data` volume. Back up PostgreSQL regularly using `pg_dump` or a volume-aware backup system.

Example logical backup:

```bash
docker compose exec -T postgres pg_dump -U ckuni ckuni > ckuni-$(date +%F).sql
```

## Firewall / VPN

Do not create router port forwards for this application.

Keep these private:

- PostgreSQL `5432`
- SSH
- Docker daemon/socket
- server administration interfaces
- other home services

The only public path into CK UNI Discord should be through Cloudflare's HTTPS edge and the outbound Cloudflare Tunnel.
