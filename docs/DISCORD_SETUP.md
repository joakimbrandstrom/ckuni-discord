# Discord setup

## Create the application

1. Open the Discord Developer Portal.
2. Create an application named `CK UNI Cycling` or similar.
3. Copy the **Application ID** and **Public Key** into `.env`.
4. Open the Bot section and create/reset the bot token.
5. Put the token in `.env` as `DISCORD_BOT_TOKEN`.

## Install the bot in the CK UNI server

The application needs the bot scope and application commands.

Recommended bot permissions for v0.2:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Events

Avoid Administrator unless you have a specific reason.

## Guild ID

Enable Developer Mode in Discord, right-click the CK UNI server and copy its server ID. Set it as `DISCORD_GUILD_ID`.

Guild commands are used in development because registration updates appear quickly.

## Automatic welcome messages

Use the existing `#välkommen` channel under **Information**. The bot does not create or rename
Discord channels. To copy an ID, enable **User Settings → Advanced → Developer Mode**, right-click
the channel and select **Copy Channel ID**.

Copy the IDs for the four existing text channels into `.env`:

```dotenv
DISCORD_WELCOME_CHANNEL_ID=...
DISCORD_ANNOUNCEMENTS_CHANNEL_ID=...
DISCORD_ZWIFT_RIDE_CHANNEL_ID=...
DISCORD_GENERAL_CHANNEL_ID=...
```

`DISCORD_WELCOME_CHANNEL_ID` enables the feature and selects where the message is sent. The other
three IDs create clickable channel references in the message. If the feature is enabled, all four
values must be configured.

In **Discord Developer Portal → Bot → Privileged Gateway Intents**, enable **Server Members
Intent**. In `#välkommen`, give the bot **View Channel**, **Send Messages** and **Embed Links**.

The Gateway connection is outbound from the existing bot process. It needs no new listening port,
router rule or Cloudflare Tunnel change; Cloudflare Tunnel remains only for incoming HTTP traffic.
Only members who join after the Gateway client has started receive the automatic message.

## Interaction endpoint

After the public HTTPS endpoint works, configure the application's Interactions Endpoint URL as:

```text
https://bot.example.com/discord/interactions
```

Discord will validate the endpoint by sending a signed PING interaction. This application verifies the signature and answers with PONG.

## Register commands

```bash
podman compose run --rm bot node dist/src/discord/register-commands.js
```

Commands:

- `/ping`
- `/ride create`
- `/ride list`
- `/ride edit`
- `/ride cancel`
- `/ride mall-spara`
- `/ride mall-lista`
- `/ride mall-redigera`
- `/ride mall-inaktivera`
- `/strava connect`
- `/leaderboard`

`/ride mall-skapa` remains registered temporarily for backwards compatibility. The normal flow is
to choose a template by name through `/ride create`.

## Suggested CK UNI server permissions

Create Discord roles named `Ledare` and `System Admin`, copy their role IDs, and configure
`DISCORD_RIDE_LEADER_ROLE_ID` and `DISCORD_ADMIN_ROLE_ID`. Members with either role can create,
edit and cancel rides and manage ride templates. Other members can list rides and use the
participation buttons.

If both role ID settings are empty, ride management is intentionally open to every server member
for local development and testing. Configure at least one role ID before running a controlled
pilot.

### Existing channel structure

The bot uses the server's existing channels and does not bootstrap or manage them.

```text
💬 Community
  #allmänt

🔊 Röstkanaler
  Zwift Ride 1
  Zwift Ride 2

ℹ️ Information
  #välkommen
  #annonseringar

🚴 Cykling
  #zwift-ride
  #spontan-rides

🔒 Ledare
  #snack
  Röst
```

### `#zwift-ride`: official CK UNI Zwift rides

This is the publication channel for structured rides that a `Ledare` has already created as a
Zwift Club Event. The bot never creates a Zwift event and does not scrape Zwift.

The normal leader flow is:

1. Create the CK UNI Club Event in Zwift Companion and copy its URL.
2. Run `/ride create` in `#zwift-ride`.
3. Select an active template by name, choose `Kopiera senaste passet`, or choose `Skapa nytt pass`.
4. Enter the changing information. Dates use `ÅÅÅÅ-MM-DD`, times use `TT:mm` in `TIMEZONE`, normally
   `Europe/Stockholm`.
5. For a new ride, choose `Lägg till detaljer` to enter the Zwift URL, description, route/world,
   pace/workout, and notes in separate fields. No special prefixes or free-text syntax are needed.
6. Review the ephemeral preview and its destination channel.
7. Select `Publicera`. Until this confirmation there is no public card, Scheduled Event, or ride
   record.

Drafts are private to their creator, stored in PostgreSQL, and expire after 24 hours. If Discord
only completes part of publication, the preview offers a retry that reuses the saved message and
event IDs. `/ride mall-skapa id:<nummer>` remains registered temporarily for backwards
compatibility, but leaders should normally select templates by name through `/ride create`.

Recommended overrides:

| Role | View channel | Send messages | Use application commands | Read history |
| --- | --- | --- | --- | --- |
| `CK UNI Rider` | Allow | Deny | Allow | Allow |
| `Gäst` | Allow | Deny | Allow | Allow |
| `Ledare` | Allow | Allow | Allow | Allow |
| `System Admin` | Allow | Allow | Allow | Allow |
| CK UNI bot | Allow | Allow | Allow | Allow |

Normal members need application-command and button access so they can list rides and select
`Jag kommer` or `Kanske`; denying ordinary messages keeps the channel focused. Discord role IDs in
the bot configuration remain the authoritative protection for create, edit, cancel and templates.

Suggested channel topic:

> Officiella CK UNI-pass på Zwift. Ledare publicerar pass; välj Jag kommer eller Kanske på passkortet.

### `#spontan-rides`: informal ride coordination

This channel is normal Discord chat for spontaneous ride suggestions. Members may paste a Zwift
event or Meetup link when they have one, but no link or special format is required. The bot does not
create cards, Scheduled Events or reminders for spontaneous suggestions.

Recommended overrides:

| Role | View channel | Send messages | Add reactions |
| --- | --- | --- | --- |
| `CK UNI Rider` | Allow | Allow | Allow |
| `Gäst` | Allow | Deny | Deny |
| `Ledare` | Allow | Allow | Allow |
| `System Admin` | Allow | Allow | Allow |

Suggested channel topic:

> Spontana cykelpass och sällskap. Skriv tid, upplägg och eventuell Zwift- eller Meetup-länk.

Keep `#allmänt` for general club discussion so ride coordination does not displace normal community
chat.

### Voice channels

`Zwift Ride 1` and `Zwift Ride 2` under **Röstkanaler** are used for communication during group
rides. `Röst` under **Ledare** remains the leaders' voice channel.
