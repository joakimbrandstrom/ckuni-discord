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
- `/ride mall-skapa`
- `/ride mall-redigera`
- `/ride mall-inaktivera`
- `/strava connect`
- `/leaderboard`

## Suggested CK UNI server permissions

Create Discord roles named `Ledare` and `System Admin`, copy their role IDs, and configure
`DISCORD_RIDE_LEADER_ROLE_ID` and `DISCORD_ADMIN_ROLE_ID`. Members with either role can create,
edit and cancel rides and manage ride templates. Other members can list rides and use the
participation buttons.

If both role ID settings are empty, ride management is intentionally open to every server member
for local development and testing. Configure at least one role ID before running a controlled
pilot.

### Recommended channel structure

Create these channels manually in Discord; the bot does not bootstrap or manage server channels.

```text
💬 Community
  #allmänt

ℹ️ Information
  #välkommen
  #annonseringar

🚴 Cycling
  #zwift-rides
  #spontan-rides
  🔊 Zwift Ride

🔒 Ledare
  #snack
  🔊 Röst
```

### `#zwift-rides`: official CK UNI Zwift rides

This is the publication channel for structured rides that a `Ledare` has already created as a
Zwift Club Event. The leader manually copies its URL and details into `/ride create`. The bot never
creates a Zwift event and does not scrape Zwift.

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

### `#spontan-rides`: informal coordination

This channel is intentionally just Discord chat. `CK UNI Rider` may view it, send messages and add
reactions. Riders may paste a Zwift event or Meetup link when they have one, but no link or special
format is required. Do not add bot cards, Scheduled Events, reminders, attendance, leaderboard
credit or a `/ride quick` workflow.

Give `Gäst` read-only access for the pilot: allow **View Channel** and **Read Message History**, but
deny **Send Messages**, **Add Reactions** and **Use Application Commands** in this channel. A guest
can therefore see informal coordination without joining it. `Ledare` and `System Admin` can
moderate normally.

Suggested channel topic:

> Spontana och informella cykelpass. Skriv när, var och ungefär vilket tempo – svara eller reagera om du vill haka på. Ingen officiell CK UNI-aktivitet.

Suggested pinned message:

> **Spontanpass**
>
> Skriv ett vanligt meddelande med när du tänker köra, typ av pass och ungefärligt tempo. Lägg gärna
> till en Zwift- eller Meetup-länk om du har en. Andra cyklister svarar eller reagerar direkt i
> kanalen. Pass här är informella: boten skapar inget passkort eller evenemang, skickar inga
> påminnelser och räknar inte deltagandet i topplistor.
