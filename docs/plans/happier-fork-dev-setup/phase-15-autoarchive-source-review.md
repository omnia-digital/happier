# OH-52: Autoarchive source boundary review

## Basis and scope

Independently review coherent slice2 through `f1f8bc0530`, against phase10 and OH-52. Source slice1 is accepted; slice3a creation custody is separate moving work. Author has focused UI30, protocol history1, UI types and locale integrity green. No real provider, archive, cleanup, native or daily-state actions.

Review the full affected corridor: account preferences, catalog/warm/shell metadata projection, current local work eligibility, qualified fresh provider reads, foreground five-minute scheduling and concurrency, current Home/account/association guards, canonical archive admission/deadline, confirmed history and retry, manual/bulk neighbors, and old-client/server behavior. Assess actual owner-level test value rather than mock call counts.

## Highest risks and QA coverage

- No archive with zero/partial/draft/unknown/inaccessible PRs, current activity/pending work, changed association, disabled preference, hidden app or stale account.
- Stable remote merge is eventually detected without interaction; bounded queued work cancels and does not duplicate, deadlock or disturb global session synchronization.
- 409/failed archive never records successful history or triggers cleanup. Confirmed archive plus history failure remains understandable/retryable; disabling future automation does not lose audit completion.
- Preserve manual/bulk archive, selection/history, unknown metadata and older clients; do not claim atomic encrypted metadata/archive updates or restart durability without proof.

## Tasks

- [ ] 🟡 Independent source/test review; high-confidence findings with deciding evidence only.
- [ ] 🔴 Root adjudication, focused corrections and required checks.
- [ ] 🔴 Composed isolated Preferences/provider fixture/archive/history receipt, then rendered inspection.

Routing selects actual Sol/high. Root adjudicated the catalog hydration finding below as the first failed Sol boundary (Sol 1 / Astra 0); individual observations in this same review are not separate failed iterations. Reviewer owns this report only and may run existing focused tests. Author owns fixes/tests. Root owns Linear, tasks, phase9 and final verdict. No source edits in the review lane.

## Independent boundary result

**Corrections required at `f1f8bc0530`.** The new observer cannot discover ordinary warm/cold inactive catalog sessions before metadata hydration. This is an introduced functional failure in the opted-in automation, not a native/provider credential gap. The author acknowledged the producer/consumer mismatch and is correcting it; moving uncommitted corrections are not yet accepted evidence.

Observed basis: phase10's slice2 intent, checkpoint `f1f8bc0530`, review started at `375b074e84`, with separate slice3a custody work subsequently checkpointed as `bff0ac12e2`. The working tree also contains author-owned observer/info/tests/locale corrections and unrelated host-custody work. No production/test files were edited by this reviewer.

### P1 — Metadata eligibility blocks the metadata loader itself

At the reviewed checkpoint, `sessionAutoArchiveObserver.ts:154–164` calls full `assessSessionAutoArchiveCandidate` before scheduling a candidate. `attempt` also requires `candidateCurrent` at line77, before `ensureMetadata` at line84. That current check requires an existing full session, matching catalog/full links and full work proof.

The actual warm producer `sessionSnapshot.ts:247–260` reconstructs PR associations but deliberately omits `agentActivityCounts`; `sessionAutoArchiveEligibility.ts:38–40` requires `metadata.agentActivityCounts.live === 0`. A warm linked row therefore fails before the loader can obtain that field. A cold row without decrypted metadata fails the earlier metadata gate. Catalog hydration defaults to eager four/background zero (`sync/store/hooks.ts:218` and the existing hydration priority owner); opening another session is not a guaranteed discovery path for older inactive rows.

Derived user impact: with automation enabled, the five-minute timer can repeatedly inspect these unchanged rows without ever fetching their metadata or checking their merged PRs. The feature only works for sessions already hydrated by another consumer. This violates the required catalog-based foreground automation and recovery behavior.

The correction belongs at the existing observer/canonical metadata owner: use a catalog-only gate for bounded metadata demand, then require fresh full metadata and all existing work/link/account checks before provider reads and archive admission. Do not change global eager hydration tuning or infer missing activity as idle. The deciding regression must start with the actual warm/cache and cold snapshot producers, use metadata-only hydration outside the eager window, and observe qualified reads/absence of unsafe archive through the real observer. A fixture prefilled with the missing proof fields cannot falsify this defect. The author has acknowledged this finding; root accepted it as material and within plan.

## Coverage and evidence

| Corridor | Observed result and limit |
| --- | --- |
| Preference scope/defaults and copy | Two independent false-default account settings use the existing registry and `useSettingMutable`; copy identifies Home scope, foreground cadence, unavailable cleanup and retained remote branches. Author's settings/type/i18n checks are supporting claims, not independently repeated here. Cleanup execution is explicitly dormant slice3 work. |
| Local work and permission gates | Eligibility checks inactive numeric presence, explicit idle/count zero, zero pending/blocked count, no pending activation/request flags, no live subagents, access and pending archive. Qualified provider evidence is required for every persisted association; absent/draft/open/closed/unknown/mismatched results do not qualify. Current focused replay passes. |
| Producer → hydration → observer | FAIL at reviewed checkpoint, as above. Warm association persistence is present; its completeness differs from full metadata. Current dirty fix is not yet a passed boundary. |
| Foreground cadence, queue and retry | Actual observer tests cover stable-row remote merge on cadence, hidden suspension, bounded queued retirement when disabled, repeated recheck coalescing, account/link changes during provider reads and 409. Timer resets the checked-row set, queue rechecks eligibility, and disabled/hidden scope prevents new reads. No separate provider-status cache or archive timeout was introduced. |
| Archive/history ownership | Automatic calls use `archiveSessionWithPendingState` → `sessionArchiveWithServerScope`, with the existing deadline and server 409 guard. `afterSessionArchiveConfirmed` is one post-success seam; failed/409 requests do not append history. Reason completion deliberately continues after disabling future automation. Captured Home/account is checked around the encrypted metadata writer and readback. |
| Manual/bulk neighboring behavior | Existing stop/archive, bulk action and server-scoped projection checks pass; no stop call was added to automation. Cleanup preference alone causes no provider/archive work. |
| Reason visibility and durability | The encrypted history schema preserves qualified links and idempotently appends by confirmed archive timestamp. A failed reason write has default-on telemetry and same-account foreground retry. The queue is in memory: app/process restart can lose an unsaved reason; this limitation and non-atomic server archive/encrypted reason are already explicit phase10 constraints. Read-only reason/skip UI is moving author work, not accepted rendered proof. |
| Old-client/server and stopped/offline behavior | Additive settings/metadata preserve existing formats. Missing modern work proof fails closed; missing/inaccessible/unsupported exact provider reads cannot qualify. Offline provider/archive failure is retried through foreground cadence/resume. No deployed older CLI, older relay, live provider or native runtime was exercised in this review. |

Independent commands, all via `hstack-exec`:

- UI Vitest observer + eligibility + server-scoped archive: **32/32 PASS**, 11.03 s. This includes two dirty author follow-up tests beyond the checkpoint's stated30. The observer uses the real store, classifier, observer, pending admission and archive operation, but stubs `sessionScmPullRequestGet`, `getSyncSingleton().patchSessionMetadataWithRetry` and metadata hydration; it does not prove the actual snapshot/hydration or encrypted write pipeline. These internal stubs explain why the producer mismatch escaped the green suite.
- UI Vitest stop/archive lifecycle + bulk execution + snapshot metadata reuse: **45/45 PASS**, 10.52 s (15 + 21 + 9). The snapshot suite confirms warm/full metadata are distinct and routes requiring full metadata hydrate through the canonical owner. This is regression support, not a composed autoarchive pass.

## Open deciding check in this boundary

Archive setup scope remains an investigation, not a ranked finding: final candidate validation precedes awaited archive setup and `apiSocket.request` endpoint credential lookup. The automatic reason's captured account guard currently protects the post-success metadata write, while the request owner's server-generation check runs after response. The author was asked for a held real credential-resolution check that switches the same Home to another account/same-ID session before release and observes actual dispatch/local publication. Provider-held and response-held tests do not exercise that gap. Do not convert this source question into a finding or assume it safe until the actual owner result is reconciled.

Required next action: author checkpoints the catalog correction with actual warm/cold producer → observer proof and resolves the held credential case; reviewer checks that focused delta. Root then adjudicates this source boundary. Composed isolated Preferences → provider reads → archive → persisted visible reason remains pending, separate from source checks. Host resource cleanup, real providers, installed/native clients and daily activity are outside this review and remain unverified.
