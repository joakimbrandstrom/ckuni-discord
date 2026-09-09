# Azure production deployment

The Azure deployment keeps PostgreSQL on a private VNet subnet and exposes only the Container App's
HTTPS ingress. The bot and migration job share one user-assigned managed identity for ACR pulls and
versionless Key Vault secret references.

```text
GitHub Actions (OIDC) -> Azure Container Registry
                                  |
                                  +-> Container Apps migration job
                                  |
                                  +-> Container App -> Discord
                                           |
                                           +-> PostgreSQL Flexible Server (private VNet)
```

The Container App is fixed at one replica because the application currently runs its reminder loop
inside the web process. Do not increase `maxReplicas` until that worker has been separated or given
distributed locking.

## Resources

[`infra/main.bicep`](../infra/main.bicep) deploys:

- `vnet-ckuni-prod` with dedicated `/27` Container Apps and `/28` PostgreSQL subnets
- PostgreSQL 17 Flexible Server, Burstable `Standard_B1ms`, 32 GiB storage, and seven-day backups
- an external Consumption workload-profile Container Apps environment
- `ca-ckuni-discord` with `/health` liveness and `/ready` readiness probes
- the manual `caj-ckuni-migrate` Container Apps Job
- an ACR Basic registry with its admin account disabled
- a Key Vault containing `postgres-password`, `database-url`, and `discord-bot-token`
- a user-assigned managed identity with `AcrPull` and `Key Vault Secrets User`
- a Log Analytics workspace capped at 1 GiB/day

PostgreSQL has no public endpoint. ACR and Key Vault retain public service endpoints; access remains
identity-based, and ACR Basic does not support a private endpoint.

## Prerequisites

- Azure CLI with an authenticated subscription
- permission to create resources and role assignments in the production resource group
- the Discord values described in [Discord setup](DISCORD_SETUP.md)
- an empty `rg-ckuni-prod` resource group in Sweden Central

Create the resource group if it does not exist:

```bash
az group create --name rg-ckuni-prod --location swedencentral
```

## Bootstrap

The bootstrap is intentionally two-phase. ACR must exist before the first application image can be
pushed, while the Container App and job must reference an image that already exists.

Export deployment parameters in the current shell. Optional role and channel IDs may be omitted.
The parameter file reads these variables directly; it does not write them to disk.

```bash
export POSTGRES_ADMINISTRATOR_PASSWORD='...'
export DISCORD_APPLICATION_ID='...'
export DISCORD_PUBLIC_KEY='...'
export DISCORD_BOT_TOKEN='...'
export DISCORD_GUILD_ID='...'

export DISCORD_RIDE_LEADER_ROLE_ID='...'
export DISCORD_ADMIN_ROLE_ID='...'
export DISCORD_WELCOME_CHANNEL_ID='...'
export DISCORD_ANNOUNCEMENTS_CHANNEL_ID='...'
export DISCORD_ZWIFT_RIDE_CHANNEL_ID='...'
export DISCORD_GENERAL_CHANNEL_ID='...'
```

Create the foundation and capture the generated globally unique registry name:

```bash
ACR_NAME=$(az deployment group create \
  --name ckuni-prod \
  --resource-group rg-ckuni-prod \
  --template-file infra/main.bicep \
  --parameters infra/prod.bicepparam \
  --query properties.outputs.registryName.value \
  --output tsv)
```

Build the bootstrap image in ACR, then create the workloads from that image:

```bash
az acr build \
  --registry "$ACR_NAME" \
  --image ckuni-discord:bootstrap \
  .

BOOTSTRAP_DIGEST=$(az acr repository show \
  --name "$ACR_NAME" \
  --image ckuni-discord:bootstrap \
  --query digest \
  --output tsv)
BOOTSTRAP_IMAGE="$ACR_NAME.azurecr.io/ckuni-discord@$BOOTSTRAP_DIGEST"

az deployment group create \
  --name ckuni-prod \
  --resource-group rg-ckuni-prod \
  --template-file infra/main.bicep \
  --parameters infra/prod.bicepparam \
  --parameters \
    deployWorkloads=true \
    containerImage="$BOOTSTRAP_IMAGE"
```

Run the initial migration and wait for it to succeed before configuring Discord traffic:

```bash
run_initial_migration() {
  local execution_name status
  execution_name=$(az containerapp job start \
    --name caj-ckuni-migrate \
    --resource-group rg-ckuni-prod \
    --query name \
    --output tsv)

  for _ in {1..60}; do
    status=$(az containerapp job execution show \
      --name caj-ckuni-migrate \
      --resource-group rg-ckuni-prod \
      --job-execution-name "$execution_name" \
      --query properties.status \
      --output tsv)

    case "$status" in
      Succeeded) return 0 ;;
      Failed|Stopped|Degraded|Unknown) return 1 ;;
    esac

    sleep 10
  done

  echo "Migration execution $execution_name timed out"
  return 1
}

run_initial_migration
```

Read the public endpoints from the deployment outputs:

```bash
az deployment group show \
  --name ckuni-prod \
  --resource-group rg-ckuni-prod \
  --query properties.outputs
```

## GitHub OIDC

Create a Microsoft Entra application/service principal with a federated credential whose subject is:

```text
repo:joakimbrandstrom/ckuni-discord:environment:production
```

Give that service principal these assignments:

- `Contributor` on `rg-ckuni-prod`, for Container App and job updates
- `AcrPush` on the generated registry, for image pushes

Create a protected GitHub environment named `production`, then add these environment variables:

```text
AZURE_CLIENT_ID
AZURE_TENANT_ID
AZURE_SUBSCRIPTION_ID
AZURE_CONTAINER_REGISTRY
```

These identifiers are not credentials. The workflow exchanges GitHub's short-lived OIDC token for
Azure access and stores no client secret.

[`deploy-production.yml`](../.github/workflows/deploy-production.yml) runs only after a successful
`push` CI run on `main`. It builds and pushes a commit-SHA tag, resolves that tag to an immutable image
digest, updates and waits for the migration job, and deploys the app only after migrations succeed.
Configure required reviewers on the `production` environment if deployments need manual approval.

## Verify and cut over

Set `APP_URL` to the `containerAppUrl` deployment output and run:

```bash
curl --fail "$APP_URL/health"
curl --fail "$APP_URL/ready"
```

Set the Discord Interactions Endpoint URL to the `discordInteractionsUrl` output. Then verify `/ping`,
ride creation, Join/Maybe responses, persistence, Scheduled Event creation, and reminders before
stopping the home-hosted bot and removing its Cloudflare Tunnel.

## Operations

Application delivery updates image references but deliberately does not give the GitHub principal
permission to create role assignments or rewrite production secrets. To reconcile merged Bicep
changes, export the deployment parameters again, preserve the currently deployed image, and rerun the
resource-group deployment:

```bash
CURRENT_IMAGE=$(az containerapp show \
  --name ca-ckuni-discord \
  --resource-group rg-ckuni-prod \
  --query 'properties.template.containers[0].image' \
  --output tsv)

az deployment group create \
  --name ckuni-prod \
  --resource-group rg-ckuni-prod \
  --template-file infra/main.bicep \
  --parameters infra/prod.bicepparam \
  --parameters deployWorkloads=true containerImage="$CURRENT_IMAGE"
```

Use versionless Key Vault references so Container Apps can observe newer secret versions. Secret
rotation is still an operator action; update the corresponding Key Vault secret and restart or deploy
a revision when immediate pickup is required.

Before a destructive migration, take and verify a database backup. The migration job is transactional
per migration file, but application rollback does not reverse schema or data changes.

Storage autogrow is disabled to keep the development-tier database within the intended cost envelope.
Monitor PostgreSQL storage usage and increase `storageSizeGB` deliberately before free space becomes
critical; Flexible Server storage cannot be reduced later.
