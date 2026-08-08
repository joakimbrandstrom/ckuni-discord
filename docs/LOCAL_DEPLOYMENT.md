# Local home-server deployment

## Recommended topology

```text
Internet
  |
  v
Public HTTPS hostname
  |
  v
Tunnel / reverse proxy
  |
  v
ckuni-discord:3000
  |
  v
PostgreSQL (private Docker network)
```

## Requirements

- Linux server with Docker Engine + Compose plugin
- DNS name such as `bot.example.com`
- Public HTTPS path via your existing reverse proxy or a tunnel

## Deploy

```bash
git clone <your-repository-url>
cd ckuni-discord
cp .env.example .env
$EDITOR .env
docker compose up -d --build
```

Inspect:

```bash
docker compose ps
docker compose logs -f bot
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

## Upgrade

```bash
git pull
docker compose up -d --build
```

Database migrations run automatically when the bot container starts.

## Backup

The important persistent data is the `postgres_data` volume. Back up PostgreSQL regularly using `pg_dump` or a volume-aware backup system.

Example logical backup:

```bash
docker compose exec -T postgres pg_dump -U ckuni ckuni > ckuni-$(date +%F).sql
```

## Tunnel/reverse proxy

Forward public HTTPS traffic to `http://<server-ip>:3000`.

Do not forward port `5432` from the router.
