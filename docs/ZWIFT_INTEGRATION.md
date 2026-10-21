# Optional Zwift integration (#60)

## Decision and current capabilities

The default is disabled, with no live adapter, network requests, credentials, or member account
requirement. Enabling the flag alone does not enable data access. Manual ride creation, signups,
reminders and CK UNI attendance/scoring remain independent of Zwift availability.

The typed boundary supports event details, results and minimal optional profiles independently.
Missing fields are explicit `null`; responses include source, fetch/observation timestamps and
source-reported/unknown confidence. Presence, attendance and verified identity are separate
capabilities and currently unsupported. Synthetic providers live only in test fixtures and require
explicit test injection; they cannot be selected through environment variables.

## Configuration

| Variable | Default | Validation |
| --- | --- | --- |
| `ZWIFT_ENABLED` | `false` | literal `true` or `false` |
| `ZWIFT_PROVIDER` | `none` | only `none` until an adapter is approved |
| `ZWIFT_RESULTS_ENABLED` | `false` | literal `true` or `false`, also requires master flag |
| `ZWIFT_PROFILES_ENABLED` | `false` | literal `true` or `false`, also requires master flag |
| `ZWIFT_TIMEOUT_MS` | `1000` | integer 10–1500 |
| `ZWIFT_CACHE_TTL_MS` | `60000` | integer 0–300000 |
| `ZWIFT_MIN_INTERVAL_MS` | `5000` | integer 1000–3600000 |

One lookup may be active per service. A shared per-process request interval bounds all consumers;
transient errors impose exponential cooldown (max five minutes), with adapter Retry-After respected
up to one hour. No automatic retry delays a Discord response. Successful event/results responses
use a maximum 100-entry TTL cache with a 1 MiB serialized-data budget and a 256 KiB per-response
limit (larger valid responses are served without caching); profiles are not cached.
Multi-replica deployments must introduce
a shared provider request budget before enabling a live adapter. Timeouts abort the adapter and
return even if it ignores cancellation; live adapters must honor the signal for resource cleanup.
Logs contain categorical outcomes only, never credentials, member IDs or upstream error bodies.

Event links are parsed locally against exact HTTPS hosts and numeric event paths. Only the stable
ID crosses the provider boundary. Query parameters are discarded from the canonical reference;
there is no redirect resolver or arbitrary-URL fetcher. Unknown link formats require an explicit
allowlist change rather than probing a host. Existing manual input behavior is initially preserved;
consumers opt into strict event URL validation.

## Ride creation preview (#61)

With `ZWIFT_ENABLED=true`, new or changed event links in draft forms and ride edits must pass the
allowlist and are stored/published in canonical form without query parameters. An unchanged legacy
link is allowed so that unrelated edits remain possible. With the integration disabled, existing
manual command validation remains unchanged.
The private draft preview adds source, fetch/observation times, availability, missing fields and
title/start/duration discrepancies if an approved event provider is available. Times show the
configured zone's UTC offset, including Stockholm DST. All values remain leader-editable through
the existing forms; suggestions never overwrite draft or template fields. Unavailable lookups
retain explicit Publicera and the existing idempotent publication/reconciliation path. Previously
stored unsupported links show a manual fallback rather than preventing publication.

## Results lookup (#62)

`/zwift results url:<event link>` or `/zwift results ride:<CK UNI ride ID>` is registered only when
both `ZWIFT_ENABLED` and `ZWIFT_RESULTS_ENABLED` are true. Re-run `npm run commands:register` after
changing flags. Requests are acknowledged privately before lookup and restricted to CK UNI guild
members. A missing or unapproved provider gives a clear unavailable response. Results retain
source category/rank semantics, show at most ten unique entries, collapse identical duplicate
entries and reject conflicting entries for the same rider. Empty/unpublished data is not presented
as proof that nobody attended. Category ordering groups source rankings rather than inventing an
overall placement. No results command writes attendance or points. Public recap publishing is
deferred; this iteration only supplies private, on-demand results.

## Profile lookup and identity gate (#63)

`ZWIFT_ENABLED=true` plus `ZWIFT_PROFILES_ENABLED=true` registers private `/zwift profile rider:<ID>`,
`/zwift privacy` and `/zwift unlink`. A profile lookup requires an approved capable provider and an
explicit `visibility: permitted` response. That value means the returned fields may be displayed
to CK UNI members, **not merely that the provider's service account can access them**. Adapters
must null out individual fields that cannot be redistributed. Country/category/level/name are
optional; power, FTP, weight, activity history and other fields are discarded by the boundary.
Profile lookups do not assert ownership or associate a Discord user with the rider.

There is no verified-ownership mechanism from an approved provider, so linking remains unavailable.
`/zwift link` is not registered and forged/stale invocations explicitly decline the claim. No
mapping migration is created: there is nothing to consent to, retain or delete in PostgreSQL.
`/zwift unlink` is an idempotent no-op explaining this state; it never claims to delete upstream
or Discord-held data. `/zwift privacy` explains the lookup-only model. Profile responses are not
cached, written to the database, or included in lookup logs. Private Discord responses still follow
Discord's own data policies; source-side request logs follow the provider's terms.

Before adding verified linking: document a provider-authorized proof bound to the requesting
Discord user, expiry/replay protection, explicit consent, a uniqueness constraint on rider and
Discord IDs, and transactional claim/revocation. Add an append-only migration with consent time,
minimal mapping, audit policy and account-deletion cascade; test duplicate claims, consent
revocation and removal through the user-deletion flow. Until then, no persisted association can
be impersonated and presence/attendance cannot use a lookup as an identity match.

## Candidate assessment (2026-10-16)

Sources reviewed:

- [Zwift legal](https://www.zwift.com/terms) and
  [Terms of Service](https://support.zwift.com/en_us/terms-of-service-HJt7VBYyH).
  Terms restrict unauthorized automated access and scraping. Public visibility is not a grant
  of third-party collection or redistribution rights.
- [ZwiftPower FAQ](https://support.zwift.com/en_us/zwiftpower-faq-BJhCucmDv): browser-accessible
  results do not establish an authorized bot API or complete participation coverage.
- User-suggested [zpdatafetch](https://github.com/puckdoug/zpdatafetch): Python client documents
  ZwiftPower results/signups/rankings using account credentials. Its `zdata` component explicitly
  uses an unofficial Zwift API for profiles, activities and riders in worlds. Its `zrdata` component
  documents a separately authorized Zwiftracing API and rate limits; evaluate directly with that
  provider for results coverage and redistribution rights. Zwift Status is service health, not rider
  presence. No dependency added; library licensing does not grant source-data access rights.
- User-suggested [@dofek/zwift](https://www.npmjs.com/package/@dofek/zwift), README v0.1.67:
  explicitly unofficial/private game-client endpoints, password sign-in, observed game-client
  headers and no supported public contract. Documented methods cover profiles/activities/fitness
  data, not a permitted events/results/presence API. No dependency added.

No reviewed candidate establishes permission for this bot's intended data use. This is an access
decision, not a claim that the underlying data cannot technically be retrieved.

## Gate for a live adapter

Record the authorizing provider/terms version or written authorization, permitted endpoints and
fields, event types/coverage, identity semantics, consent, display/redistribution rights, retention,
rate limits, authentication and revocation before enabling operations. A provider may support only
one operation. Runtime-validate all responses; map upstream errors to normalized unavailable states.
Use server-side secrets only for an explicitly authorized integration. Do not collect member Zwift
passwords, automate accounts, impersonate a game client, scrape, or create/edit Club events.

Never treat signup, presence, generic activity overlap or absence from results as attendance proof.
Final CK UNI leader-confirmed attendance is the only scoring authority. Strava remains retired.

## Validation

`npm run typecheck`, `npm run check`, `npm test`, `npm run build`.
Provider tests use synthetic fixtures and do not call Zwift or Discord.
