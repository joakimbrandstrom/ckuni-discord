# Cloudflare Tunnel deployment

This is the recommended ingress model for running CK UNI Discord on a home server that otherwise stays behind VPN/Tailscale.

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
bot:3000  ----> postgres:5432

Host/LAN access to the bot is limited to 127.0.0.1:3000.
PostgreSQL has no published host port.
```

No router port-forward is required. Do not expose port 3000 or 5432 on the router.

## Fastest test: Quick Tunnel

Cloudflare Quick Tunnels are intended for development/testing and do not require a Cloudflare account, domain, DNS change or tunnel token.

1. Prepare `.env` for PostgreSQL and Discord:

   ```bash
   cp .env.example .env
   $EDITOR .env
   ```

2. Start the stack with the `quick-tunnel` profile:

   ```bash
   podman compose --profile quick-tunnel up -d --build
   ```

3. Check the containers:

   ```bash
   podman compose --profile quick-tunnel ps
   ```

4. Verify the bot locally from the server:

   ```bash
   curl http://127.0.0.1:3000/health
   curl http://127.0.0.1:3000/ready
   ```

5. Get the temporary public URL:

   ```bash
   podman compose logs cloudflared-quick
   ```

   Look for a URL similar to:

   ```text
   https://random-words.trycloudflare.com
   ```

6. In the Discord Developer Portal, set the **Interactions Endpoint URL** to:

   ```text
   https://random-words.trycloudflare.com/discord/interactions
   ```

7. Register the commands if you have not already done so:

   ```bash
   podman compose run --rm bot node dist/src/discord/register-commands.js
   ```

8. Run `/ping` in the CK UNI Discord server.

Quick Tunnel URLs change when the tunnel is recreated. Use this only to prove the end-to-end Discord flow.

To stop the Quick Tunnel stack:

```bash
podman compose --profile quick-tunnel down
```

## Permanent setup: remotely-managed tunnel

Use this after `/ping` works.

### 1. Create the tunnel

In the Cloudflare dashboard:

1. Go to **Networking > Tunnels**.
2. Create a Cloudflare Tunnel, for example `ckuni-discord`.
3. Open the tunnel and choose **Add a replica**.
4. Copy the tunnel token from the generated `cloudflared` command. The token is the long `eyJ...` value.
5. Put the token only in the server's `.env`:

   ```dotenv
   CLOUDFLARE_TUNNEL_TOKEN=eyJ...
   ```

Never commit the real token. Anyone who has this token can run a connector for the tunnel.

### 2. Add the published application route

Under the tunnel's routes, add a **Published application**.

Example:

```text
Hostname: bot.your-domain.example
Service:  http://bot:3000
```

`bot` is the podman Compose service name. Because `cloudflared` and `bot` share the default Compose network, Cloudflare Tunnel can reach it directly without publishing the bot port to the LAN.

Cloudflare creates/proxies the DNS route for the selected hostname.

### 3. Configure the application URL

Update `.env`:

```dotenv
PUBLIC_BASE_URL=https://bot.your-domain.example
```

Start the permanent tunnel profile:

```bash
podman compose --profile tunnel up -d --build
```

Check:

```bash
podman compose --profile tunnel ps
podman compose logs -f cloudflared
```

### 4. Configure Discord

Set the Discord application's Interactions Endpoint URL to:

```text
https://bot.your-domain.example/discord/interactions
```

Discord validates the endpoint using a signed interaction. The CK UNI backend verifies Discord's Ed25519 signature before processing interactions.

### 5. Configure Strava later

Once Discord is stable, use the same hostname for Strava:

```text
OAuth callback: https://bot.your-domain.example/strava/oauth/callback
Webhook:        https://bot.your-domain.example/strava/webhook
```

Do not make Strava part of the first `/ping` and `/ride create` test.

## Network exposure

The base Compose file intentionally publishes the application only on loopback:

```text
127.0.0.1:3000 -> bot:3000
```

This means another device on the LAN cannot connect directly to `server-ip:3000`.

The tunnel reaches the bot internally through podman networking:

```text
cloudflared -> http://bot:3000
```

PostgreSQL is only reachable inside the podman network.

Your existing VPN/Tailscale setup can therefore remain unchanged for SSH, dashboards and other internal services.

## Public paths

The public hostname is intended for the bot API only. Current routes are:

```text
POST /discord/interactions
GET  /strava/oauth/callback
GET  /strava/webhook
POST /strava/webhook
GET  /health
GET  /ready
```

`/health` and `/ready` return only generic status information and no credentials or database details.

For the first pilot, rely on application authentication/signature verification and Cloudflare's proxy/DDoS protection. Do not put Cloudflare Access login in front of the Discord or Strava callback paths because those external services cannot complete an interactive Access login.

## Troubleshooting

### Tunnel starts but Cloudflare returns 502

Check that the bot is healthy:

```bash
podman compose ps
podman compose logs bot
```

Then test name resolution/connectivity from the `cloudflared` service by confirming the published application Service URL is exactly:

```text
http://bot:3000
```

Do not use `localhost:3000` for the permanent containerized tunnel: inside the `cloudflared` container, `localhost` means the `cloudflared` container itself.

### Discord rejects the endpoint

Check:

```bash
podman compose logs -f bot cloudflared
```

Confirm the endpoint ends in:

```text
/discord/interactions
```

and that `DISCORD_PUBLIC_KEY` matches the same Discord application.

### The Quick Tunnel URL stopped working

Quick Tunnel hostnames are temporary. Restart it and copy the new URL:

```bash
podman compose --profile quick-tunnel restart cloudflared-quick
podman compose logs cloudflared-quick
```

Then update the Discord Interactions Endpoint URL.
