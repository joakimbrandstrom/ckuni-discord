# Local home-server deployment

## Recommended topology

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
bot:3000  ---> PostgreSQL (private podman network)
```

The rest of the home server can stay behind VPN/Tailscale. No router port-forward is required for CK UNI Discord.

## Requirements

- Linux server with podman Engine + Compose plugin
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
podman compose up -d --build
```

The bot is available only on the server loopback interface:

```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

It is intentionally **not** available at `http://<server-lan-ip>:3000`.

### First public test with Quick Tunnel

```bash
podman compose --profile quick-tunnel up -d --build
podman compose logs cloudflared-quick
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
```

Then start:

```bash
podman compose --profile tunnel up -d --build
```

See [`CLOUDFLARE_TUNNEL.md`](CLOUDFLARE_TUNNEL.md) for the full setup and troubleshooting guide.

## Start automatically after a server reboot

The long-running services already use `restart: unless-stopped` in `compose.yaml`. Keep the
`migrate` service at `restart: "no"`: it is a one-shot dependency that should complete before the
bot starts, not a daemon.

For a rootless Podman deployment, use the included user-level systemd unit so the complete Compose
project is started at boot:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/ckuni-discord.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ckuni-discord.service
```

The included unit assumes the repository is cloned to:

```text
~/ckuni-discord
```

If the repository is elsewhere, edit `WorkingDirectory=` in
`~/.config/systemd/user/ckuni-discord.service` before enabling it.

Rootless user services normally start when the user logs in. Enable systemd lingering so the CK UNI
service starts during boot and continues to run without an interactive login:

```bash
sudo loginctl enable-linger "$USER"
```

Verify the configuration:

```bash
systemctl --user is-enabled ckuni-discord.service
systemctl --user status ckuni-discord.service
loginctl show-user "$USER" -p Linger
podman compose --profile tunnel ps
```

Expected values include `enabled` and `Linger=yes`.

The unit starts the permanent tunnel profile with:

```bash
podman compose --profile tunnel up -d
```

and uses `podman compose --profile tunnel stop` during a clean systemd shutdown. Using `stop`
keeps the Compose containers and networks defined instead of removing them with `down`.

Test the complete boot path with a server reboot. After reconnecting:

```bash
systemctl --user status ckuni-discord.service
podman compose --profile tunnel ps
journalctl --user -u ckuni-discord.service -b
```

The PostgreSQL data remains persistent across container and host restarts because it is stored in the
named `postgres_data` volume.

## Deploy new commits from `main` automatically

The included user-level systemd timer can poll `origin/main` without exposing SSH or a webhook to
the internet. A deployment runs only from a clean `main` checkout and only accepts fast-forward
updates. Before updating the checkout, it creates and validates a private PostgreSQL backup.

Install the deployment driver and timer:

```bash
mkdir -p ~/.local/libexec ~/.config/systemd/user
install -m755 deploy/ckuni-discord-auto-deploy \
  ~/.local/libexec/ckuni-discord-auto-deploy
install -m755 backup-postgres.sh \
  ~/.local/libexec/ckuni-discord-backup-postgres
install -m644 deploy/systemd/ckuni-discord-deploy.service \
  deploy/systemd/ckuni-discord-deploy.timer \
  ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ckuni-discord-deploy.timer
systemctl --user start ckuni-discord-deploy.service
```

The timer checks for updates about every two minutes. Each new target commit is deployed with the
permanent tunnel profile, database migrations, a production image rebuild, local health and
readiness checks, a registered Cloudflare connection, and Discord command registration. After the
backup completes, the old bot is stopped before the checkout changes or migrations run. The
successful commit is recorded only after all checks pass, so a failed deployment is retried on the
next timer activation.

The deployment service uses `KillMode=process` so rootless Podman containers remain running after
the short-lived deployment process exits. The containers continue to be managed by the separate
`ckuni-discord.service` at boot and shutdown.

By default, state and backups are stored outside the Git checkout:

```text
~/.local/state/ckuni-discord/deployed-sha
~/.local/state/ckuni-discord/backups/
```

Override non-secret paths by creating `~/.config/ckuni-discord/deploy.env` with absolute paths:

```dotenv
CKUNI_REPO=/home/example/ckuni-discord
CKUNI_STATE_DIR=/home/example/.local/state/ckuni-discord
CKUNI_BACKUP_DIR=/mnt/backups/ckuni-discord
CKUNI_PUBLIC_READY_URL=https://bot.example.com/ready
```

`CKUNI_PUBLIC_READY_URL` is required. It must use the public Cloudflare hostname so a successful
deployment proves that the tunnel reaches the ready application, not only that the local container
is running.

Do not put Discord, PostgreSQL or Cloudflare credentials in this file. They remain in the
deployment checkout's ignored `.env` file.

Inspect automatic deployments with:

```bash
systemctl --user status ckuni-discord-deploy.timer
systemctl --user status ckuni-discord-deploy.service
journalctl --user -u ckuni-discord-deploy.service
```

Stop the timer before planned maintenance:

```bash
systemctl --user disable --now ckuni-discord-deploy.timer
```

The updater deliberately does not reset, rebase, merge divergent history or roll back failed
database migrations. It stops on a dirty checkout or divergent `main` branch for operator review.
Backups are not deleted automatically; monitor disk usage and apply an appropriate retention policy.
Because merged code and migrations execute on the server, protect `main` and require reviewed pull
requests.

The driver, backup helper and unit files are copied outside the checkout so they cannot change while
a deployment is running. If a later release changes those files, rerun the installation commands
above to update the installed copies.

## Inspect

```bash
podman compose ps
podman compose logs -f bot
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/ready
```

For a permanent tunnel:

```bash
podman compose --profile tunnel ps
podman compose logs -f cloudflared
```

## Upgrade

For the Strava removal release, complete the retirement procedure below rather than upgrading with
the old bot still running.

Without Tunnel profile:

```bash
git pull
podman compose up -d --build
```

With the permanent Tunnel profile:

```bash
git pull
podman compose --profile tunnel up -d --build
```

Compose runs database migrations through the `migrate` service; the bot depends on its successful
completion before starting.

### Strava retirement upgrade

These are operator steps for the removal release, not a record of a completed production change.
This release includes the runtime removal and the new database migration. Verify that all deployed
processes use this release before resuming traffic.

The new `004_remove_strava.sql` migration drops `activities` and `strava_connections`, including
stored activity data and encrypted connection tokens. It preserves `ride_participants.attended_at`
and the existing attendance-based leaderboard. It does not introduce the attendance UI planned in
[#12](https://github.com/joakimbrandstrom/ckuni-discord/issues/12).

1. Schedule downtime and take a verified database backup before migrating. Dropping these tables is
   irreversible without restoring a pre-migration backup; restarting the old image is not a rollback.
2. Stop the old bot **before any migration runs**, including any other replica or process using this
   database. For the documented Compose deployment, use `podman compose stop bot`. Keep it stopped
   while preparing the removal release; the old code must not run against the retired schema.
3. Retire the provider-side Strava webhook subscription and revoke the application's provider access
   grants/tokens. Complete this cleanup while the required administrative access is still available.
   Dropping local tables does not perform either provider-side action.
4. Remove retired settings from deployment `.env` files, secret stores and environment overrides:
   `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_VERIFY_TOKEN`, `STRAVA_STATE_SECRET`,
   `STRAVA_API_BASE_URL`, `TOKEN_ENCRYPTION_KEY` and `PUBLIC_BASE_URL`. The encryption key and runtime
   base URL were exclusively for the retired integration. Keep the public hostname configured in
   Cloudflare and the Discord Interactions Endpoint URL; neither requires `PUBLIC_BASE_URL`.
5. Deploy the removal release using the appropriate upgrade command above. Check the `migrate`
   service logs and `schema_migrations` to verify `004_remove_strava.sql` completed before accepting
   the deployment. If migration fails, keep the old bot stopped and investigate before proceeding.
6. Re-register Discord commands from the new release using
   `podman compose run --rm bot node dist/src/discord/register-commands.js` so Discord removes the
   retired command. Verify `/ping`, official ride signups/reminders, `/leaderboard`, `/health` and
   `/ready`, and confirm that previously stored attendance remains intact.
7. Record the deployed version, migration result and provider-side retirement separately in the
   operator's rollout record. Documentation and repository tests do not prove production completion.

Historic database backups can still contain activity data and connection records, including
encrypted tokens. Retiring live tables or removing the deployment encryption key does not purge
those backups or copies of old secrets. Restrict access and apply the operator's retention/deletion
policy. Restoring an old backup reintroduces retired data and requires the retirement procedure again
before serving traffic with the removal release.

## Backup

The important persistent data is the `postgres_data` volume. Back up PostgreSQL regularly using `pg_dump` or a volume-aware backup system.

Example logical backup:

```bash
podman compose exec -T postgres pg_dump -U ckuni ckuni > ckuni-$(date +%F).sql
```

## Firewall / VPN

Do not create router port forwards for this application.

Keep these private:

- PostgreSQL `5432`
- SSH
- podman daemon/socket
- server administration interfaces
- other home services

The only public path into CK UNI Discord should be through Cloudflare's HTTPS edge and the outbound Cloudflare Tunnel.
