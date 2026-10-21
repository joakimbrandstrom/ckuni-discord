# Opt-in Zwift online status: feasibility decision (#64)

Assessed 2026-10-16. **Decision: do not enable rider presence or live polling.** No reviewed source
establishes permission for CK UNI's requested member-presence use. This does not mean the data is
technically impossible to retrieve; it means the access, disclosure and freshness contract remains
unverified. Issue #64 explicitly allows a research-only outcome when no compliant source is found.

## Evidence and candidates

| Source | What is documented | What remains unverified |
| --- | --- | --- |
| [Zwift terms](https://www.zwift.com/terms) / [support terms](https://support.zwift.com/en_us/terms-of-service-HJt7VBYyH) | Restrictions on unauthorized applications/automated access and scraping | An authorized third-party presence interface, redistribution rights, consent semantics, rate limits and freshness |
| [zpdatafetch](https://github.com/puckdoug/zpdatafetch) README | `zdata` describes an unofficial credential-based API, including active worlds and riders in a world | Permission to use it for this bot, permission to disclose status to a club, bounded freshness and opt-out handling |
| [@dofek/zwift](https://www.npmjs.com/package/@dofek/zwift) README v0.1.67 | Private game-client API, password sign-in, profiles/activities/fitness data; unsupported observed headers | No documented presence operation or authorized presence contract |
| ZwiftPower / Zwiftracing | Results and rider ratings are candidate capabilities, not presence evidence | Neither reviewed material establishes a live opted-in club-member presence feed |
| Zwift Status (also described by `zsdata` in zpdatafetch) | Service incidents/components | Service health is not whether a rider is online |

These are documentation findings, not successful live API tests. No account was authenticated and
no private endpoint was called. A library's MIT license does not authorize collection of service
data. User-supplied IDs, profile lookup and a name match do not verify ownership or provide consent.

## Implementation outcome

- `presence` remains unsupported in the provider capability model.
- No `/zwift online` command, roster scan, scheduler or world/location storage is introduced.
- Profile lookups remain lookup-only; there is no verified identity mapping to enumerate safely.
- Existing manual ride creation, membership, attendance and points remain available independently.

There is no opt-out or stale-state processing to test until an approved implementation exists;
provider/guild/profile permission boundaries are already tested in the foundation and profile PRs.

## Conditions for revisiting

1. Obtain documented provider permission for querying and disclosing each proposed status field to
   CK UNI members. Record endpoint, data rights, quotas, authorization and upstream revocation.
2. Establish verified rider ownership and separate explicit **presence** consent. Linking a profile
   must not silently opt a rider into online-status sharing. Opt-out must remove the member from
   both requests and responses immediately, including cached snapshots.
3. Define evidence semantics: `riding` only from a current explicit provider observation; `offline`
   only when the source positively reports it. Omission, failure and stale evidence mean `unknown`.
   Agree a source-specific maximum age; show observation time and age, not just local fetch time.
4. Use on-demand, rate-limited snapshots, not high-frequency polling. Query only consented, verified
   identities; prohibit arbitrary-member searches. Keep world, route, coordinates and location out
   of requests/display/persistence unless a separate requirement and permission justify them.
5. Add tests for opt-out before/during requests, guild authorization, stale/unknown states,
   incomplete rosters, provider failures, shared quotas and immediate cache invalidation.

See the [provider access assessment](ZWIFT_INTEGRATION.md#candidate-assessment-2026-10-16).
