# Discord setup

## Create the application

1. Open the Discord Developer Portal.
2. Create an application named `CK UNI Cycling` or similar.
3. Copy the **Application ID** and **Public Key** into `.env`.
4. Open the Bot section and create/reset the bot token.
5. Put the token in `.env` as `DISCORD_BOT_TOKEN`.

## Install the bot in the CK UNI server

The application needs the bot scope and application commands.

Recommended bot permissions for V0.1:

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

Create Discord roles such as `Ride Leader` and `Admin`, copy their role IDs, and configure
`DISCORD_RIDE_LEADER_ROLE_ID` and `DISCORD_ADMIN_ROLE_ID`. Members with either role can create,
edit and cancel rides and manage ride templates. Other members can list rides and use the
participation buttons.

If both role ID settings are empty, ride management is intentionally open to every server member
for local development and testing. Configure at least one role ID before running a controlled
pilot.
