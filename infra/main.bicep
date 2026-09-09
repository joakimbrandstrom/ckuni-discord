targetScope = 'resourceGroup'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short deployment environment name used in tags.')
param environment string = 'prod'

@description('Create the Container App and migration job after the first image has been pushed to ACR.')
param deployWorkloads bool = false

@description('Existing image to deploy. Required when deployWorkloads is true.')
param containerImage string = ''

@secure()
@description('PostgreSQL administrator password.')
param postgresAdministratorPassword string

@description('Discord application ID.')
param discordApplicationId string

@description('Discord Ed25519 public key.')
param discordPublicKey string

@secure()
@description('Discord bot token.')
param discordBotToken string

@description('Discord guild ID.')
param discordGuildId string

@description('Optional Discord Ride Leader role ID.')
param discordRideLeaderRoleId string = ''

@description('Optional Discord administrator role ID.')
param discordAdminRoleId string = ''

@description('Optional Discord welcome channel ID.')
param discordWelcomeChannelId string = ''

@description('Optional Discord announcements channel ID.')
param discordAnnouncementsChannelId string = ''

@description('Optional Discord Zwift ride channel ID.')
param discordZwiftRideChannelId string = ''

@description('Optional Discord general channel ID.')
param discordGeneralChannelId string = ''

param vnetName string = 'vnet-ckuni-prod'
param containerAppsSubnetName string = 'snet-aca'
param postgresSubnetName string = 'snet-postgres'
param containerAppsEnvironmentName string = 'cae-ckuni-prod'
param containerAppName string = 'ca-ckuni-discord'
param migrationJobName string = 'caj-ckuni-migrate'
param postgresServerName string = 'psql-ckuni-prod-${take(uniqueString(subscription().id, resourceGroup().id), 8)}'
param postgresDatabaseName string = 'ckuni'
param postgresAdministratorLogin string = 'ckuni'
param registryName string = 'acrckuniprod${take(uniqueString(subscription().id, resourceGroup().id), 8)}'
param keyVaultName string = 'kv-ckuni-prod-${take(uniqueString(subscription().id, resourceGroup().id), 8)}'
param workloadIdentityName string = 'mi-ckuni-prod'

var tags = {
  application: 'ckuni-discord'
  environment: environment
  managedBy: 'bicep'
}

resource workloadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: workloadIdentityName
  location: location
  tags: tags
}

module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    vnetName: vnetName
    containerAppsSubnetName: containerAppsSubnetName
    postgresSubnetName: postgresSubnetName
    privateDnsZoneName: '${environment}.private.postgres.database.azure.com'
    tags: tags
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    serverName: postgresServerName
    databaseName: postgresDatabaseName
    administratorLogin: postgresAdministratorLogin
    administratorPassword: postgresAdministratorPassword
    delegatedSubnetResourceId: network.outputs.postgresSubnetId
    privateDnsZoneResourceId: network.outputs.privateDnsZoneId
    tags: tags
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    registryName: registryName
    pullIdentityPrincipalId: workloadIdentity.properties.principalId
    tags: tags
  }
}

var databaseUrl = 'postgresql://${postgresAdministratorLogin}:${uriComponent(postgresAdministratorPassword)}@${postgres.outputs.fqdn}:5432/${postgresDatabaseName}?sslmode=require'

module keyVault 'modules/keyvault.bicep' = {
  name: 'key-vault'
  params: {
    location: location
    keyVaultName: keyVaultName
    workloadIdentityPrincipalId: workloadIdentity.properties.principalId
    postgresPassword: postgresAdministratorPassword
    databaseUrl: databaseUrl
    discordBotToken: discordBotToken
    tags: tags
  }
}

module containerApps 'modules/container-apps.bicep' = if (deployWorkloads) {
  name: 'container-apps'
  params: {
    location: location
    environmentName: containerAppsEnvironmentName
    containerAppName: containerAppName
    migrationJobName: migrationJobName
    infrastructureSubnetId: network.outputs.containerAppsSubnetId
    workloadIdentityId: workloadIdentity.id
    registryServer: registry.outputs.loginServer
    containerImage: containerImage
    databaseUrlSecretUri: keyVault.outputs.databaseUrlSecretUri
    discordBotTokenSecretUri: keyVault.outputs.discordBotTokenSecretUri
    discordApplicationId: discordApplicationId
    discordPublicKey: discordPublicKey
    discordGuildId: discordGuildId
    discordRideLeaderRoleId: discordRideLeaderRoleId
    discordAdminRoleId: discordAdminRoleId
    discordWelcomeChannelId: discordWelcomeChannelId
    discordAnnouncementsChannelId: discordAnnouncementsChannelId
    discordZwiftRideChannelId: discordZwiftRideChannelId
    discordGeneralChannelId: discordGeneralChannelId
    tags: tags
  }
}

output registryName string = registry.outputs.name
output registryLoginServer string = registry.outputs.loginServer
output keyVaultName string = keyVault.outputs.name
output postgresServerName string = postgres.outputs.name
output containerAppUrl string = deployWorkloads ? containerApps!.outputs.url : ''
output discordInteractionsUrl string = deployWorkloads ? '${containerApps!.outputs.url}/discord/interactions' : ''
