using './main.bicep'

param location = 'swedencentral'
param environment = 'prod'
param deployWorkloads = false

param postgresAdministratorPassword = readEnvironmentVariable('POSTGRES_ADMINISTRATOR_PASSWORD')
param discordApplicationId = readEnvironmentVariable('DISCORD_APPLICATION_ID')
param discordPublicKey = readEnvironmentVariable('DISCORD_PUBLIC_KEY')
param discordBotToken = readEnvironmentVariable('DISCORD_BOT_TOKEN')
param discordGuildId = readEnvironmentVariable('DISCORD_GUILD_ID')

param discordRideLeaderRoleId = readEnvironmentVariable('DISCORD_RIDE_LEADER_ROLE_ID', '')
param discordAdminRoleId = readEnvironmentVariable('DISCORD_ADMIN_ROLE_ID', '')
param discordWelcomeChannelId = readEnvironmentVariable('DISCORD_WELCOME_CHANNEL_ID', '')
param discordAnnouncementsChannelId = readEnvironmentVariable('DISCORD_ANNOUNCEMENTS_CHANNEL_ID', '')
param discordZwiftRideChannelId = readEnvironmentVariable('DISCORD_ZWIFT_RIDE_CHANNEL_ID', '')
param discordGeneralChannelId = readEnvironmentVariable('DISCORD_GENERAL_CHANNEL_ID', '')
