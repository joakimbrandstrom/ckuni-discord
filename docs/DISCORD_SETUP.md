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
docker compose run --rm bot node dist/src/discord/register-commands.js
```

Commands:

- `/ping`
- `/ride create`
- `/ride list`
- `/ride cancel`
- `/strava connect`
- `/leaderboard`

## Suggested CK UNI server permissions

Create a Discord role such as `Ride Leader`. V0.1 allows any member to create rides; role-based authorization is on the roadmap. If you want a controlled pilot, limit visibility/use of the rides channel to the test group first.
