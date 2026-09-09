param location string
param environmentName string
param containerAppName string
param migrationJobName string
param infrastructureSubnetId string
param workloadIdentityId string
param registryServer string
param containerImage string
param databaseUrlSecretUri string
param discordBotTokenSecretUri string
param discordApplicationId string
param discordPublicKey string
param discordGuildId string
param discordRideLeaderRoleId string
param discordAdminRoleId string
param discordWelcomeChannelId string
param discordAnnouncementsChannelId string
param discordZwiftRideChannelId string
param discordGeneralChannelId string
param tags object

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${environmentName}'
  location: location
  tags: tags
  properties: {
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
    workspaceCapping: {
      dailyQuotaGb: 1
    }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: infrastructureSubnetId
      internal: false
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: false
  }
}

var sharedSecrets = [
  {
    identity: workloadIdentityId
    keyVaultUrl: databaseUrlSecretUri
    name: 'database-url'
  }
  {
    identity: workloadIdentityId
    keyVaultUrl: discordBotTokenSecretUri
    name: 'discord-bot-token'
  }
]

var requiredEnvironmentVariables = [
  {
    name: 'NODE_ENV'
    value: 'production'
  }
  {
    name: 'PORT'
    value: '3000'
  }
  {
    name: 'LOG_LEVEL'
    value: 'info'
  }
  {
    name: 'TIMEZONE'
    value: 'Europe/Stockholm'
  }
  {
    name: 'DATABASE_URL'
    secretRef: 'database-url'
  }
  {
    name: 'DISCORD_APPLICATION_ID'
    value: discordApplicationId
  }
  {
    name: 'DISCORD_PUBLIC_KEY'
    value: discordPublicKey
  }
  {
    name: 'DISCORD_BOT_TOKEN'
    secretRef: 'discord-bot-token'
  }
  {
    name: 'DISCORD_GUILD_ID'
    value: discordGuildId
  }
]

var optionalEnvironmentVariables = [
  {
    name: 'DISCORD_RIDE_LEADER_ROLE_ID'
    value: discordRideLeaderRoleId
  }
  {
    name: 'DISCORD_ADMIN_ROLE_ID'
    value: discordAdminRoleId
  }
  {
    name: 'DISCORD_WELCOME_CHANNEL_ID'
    value: discordWelcomeChannelId
  }
  {
    name: 'DISCORD_ANNOUNCEMENTS_CHANNEL_ID'
    value: discordAnnouncementsChannelId
  }
  {
    name: 'DISCORD_ZWIFT_RIDE_CHANNEL_ID'
    value: discordZwiftRideChannelId
  }
  {
    name: 'DISCORD_GENERAL_CHANNEL_ID'
    value: discordGeneralChannelId
  }
]

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: containerAppName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${workloadIdentityId}': {}
    }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        allowInsecure: false
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          identity: workloadIdentityId
          server: registryServer
        }
      ]
      secrets: sharedSecrets
    }
    template: {
      containers: [
        {
          name: 'ckuni-discord'
          image: containerImage
          env: concat(requiredEnvironmentVariables, optionalEnvironmentVariables)
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/ready'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource migrationJob 'Microsoft.App/jobs@2025-01-01' = {
  name: migrationJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${workloadIdentityId}': {}
    }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          identity: workloadIdentityId
          server: registryServer
        }
      ]
      replicaRetryLimit: 0
      replicaTimeout: 600
      secrets: sharedSecrets
      triggerType: 'Manual'
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: containerImage
          command: [
            'node'
            'dist/src/db/migrate.js'
          ]
          env: requiredEnvironmentVariables
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
    }
  }
}

output url string = 'https://${app.properties.configuration.ingress.fqdn}'
