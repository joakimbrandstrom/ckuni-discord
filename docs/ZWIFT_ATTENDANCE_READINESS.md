# Advisory Zwift attendance: readiness assessment (#65)

Assessed 2026-10-16. **Blocked: provider/data rights, verified identity and leader review are not
ready.** This PR records the investigation and implementation boundary; it does not complete the
suggestions feature. Keep #65 open until the prerequisites below are implemented and tested.

## Reconcile issue status with actual behavior

[Manual attendance #12](https://github.com/joakimbrandstrom/ckuni-discord/issues/12) and
[Winter Cup #14](https://github.com/joakimbrandstrom/ckuni-discord/issues/14) are both closed on
GitHub, but their described workflows are not implemented at the inspected `main` baseline
(`31ca55a`). Closed tracker state is not evidence that the dependency is usable.

| Existing code | Confirmed behavior | Missing prerequisite |
| --- | --- | --- |
| `migrations/001_init.sql` | `ride_participants.status` records RSVP and nullable `attended_at` stores attendance | Separate self-report, suggested and final attendance states; audited decisions |
| `src/rides/repository.ts` `setParticipant` | Going/maybe/declined signup | Signup is not participation evidence |
| `src/rides/repository.ts` `markAttendance` | Directly sets attendance and forces going; currently no Discord caller | Completed-ride guard, leader authorization, confirm/reject/correct/manual-add UI and audit trail |
| `src/rides/repository.ts` `getLeaderboard` | Counts stored `attended_at` values at 10 points each | Season model, configurable Winter Cup rules, finalization and eligibility semantics |
| `src/discord/interactions.ts` | Signup buttons and leaderboard, no `/attendance` handler | Member self-report and leader review foundation described by #12 |
| `src/integrations/zwift/profile.ts` | Permission-gated lookup only | Verified ownership and consented Discord-to-rider mapping; a lookup is not a link |

Current attendance/leaderboard records are retained. Do not migrate them into inferred external
attendance or describe the present leaderboard as a completed seasonal Winter Cup implementation.

## Event-specific evidence assessment

The [provider assessment](ZWIFT_INTEGRATION.md#candidate-assessment-2026-10-16) includes the two
user-supplied candidates, zpdatafetch and @dofek/zwift. Neither establishes an approved source of
CK UNI event-specific participant evidence. ZwiftPower race results may cover some race entrants;
coverage, source authorization, event/subgroup identity and rights to match/store evidence still
require direct verification. The documented Zwiftracing authorization model merits separate
evaluation, but ratings and a roster do not prove a specific event was ridden.

There is no verified coverage matrix for CK UNI social rides, workouts, meetups or Club events.
An unsupported event type must produce no positive suggestion. No live requests or account sign-in
were used in this assessment. Browser-visible results and technical client capability are not proof
of permission to automate attendance matching.

## Required implementation order

1. Deliver #12's manual foundation first: post-completion member self-report, authorized leader
   review, explicit confirm/reject/manual-add/correction actions and durable previous/new state,
   actor, source and timestamp. Exclude spontaneous-channel posts from official ride eligibility.
2. Define a permitted event-evidence capability distinct from generic race results. Document
   authorization, supported event/subgroup types, exact ID semantics, completion/participation
   meaning, observation and fetch times, coverage, retention and downstream matching rights.
3. Deliver verified identity/consent under #63, including unique ownership, revocation, account
   deletion and an audit policy that minimizes retained personal data. Never match names alone.
4. Add an append-only migration for **suggestions**, separate from RSVP, self-report and final
   confirmation. A suggestion carries ride/event ID, verified mapping reference, source/rationale,
   observation/fetch time and uncertainty. It does not set `attended_at` or invoke `markAttendance`.
5. Present suggestions in the same leader review flow. Record each confirm/reject/manual correction
   with previous/new state and operator. Repeated imports deduplicate by source/evidence identity;
   leader overrides remain authoritative and must not be undone by refreshes. Preserve correction
   history according to the agreed privacy/retention policy.
6. Derive participation scoring only from final confirmed eligible attendance. Corrections must
   remove/recompute the prior contribution. Implement seasonal/configurable scoring under #14
   rather than silently changing the existing fixed-point leaderboard in this integration.

There is deliberately no `ZWIFT_ATTENDANCE_ENABLED` switch yet: no deployable suggestions path
exists to enable. Provider `attendance` capability remains false; event/results/profile lookups
do not write attendance. Wire a separate disabled-by-default gate only after these foundations pass.

## Evidence rejection rules and future tests

| Input/scenario | Required outcome |
| --- | --- |
| Signup, general activity overlap, online/world state | No positive suggestion |
| Exact permitted event evidence + unique verified opted-in mapping | Advisory suggestion only; no points |
| Wrong event/subgroup, stale/delayed evidence, unsupported event, missing timestamp | No positive assertion; show uncertainty/unavailability |
| Duplicate names, conflicting identities, unverified or revoked mapping | No identity match or positive assertion |
| Partial result roster, rider absent from results, provider outage | Never mark absent; preserve manual workflow |
| Repeat evidence import or leader decision retry | No duplicate suggestions, audit events or scoring contributions |
| Leader confirms/rejects/manual-adds/corrects | Authorized and auditable; manual override survives import refresh |
| Correction after finalization | Recompute only confirmed participation points, including removals |
| Spontaneous `#spontan-rides` post | No automatic scoring or official attendance record |

These are future acceptance scenarios, not claims of executed attendance tests. This iteration's
tests cover provider failure/permission boundaries and keep the existing manual persistence,
leaderboard and publication tests running; no external evidence changes attendance today.
