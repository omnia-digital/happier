# OH-52: Read-only exact-current ancestry evidence

## Contract

Implement the reviewed phase18 ancestry-only increment through existing phase16 Git/provider/daemon owners. Exact current source `C` must satisfy existing fresh qualified merged/non-draft PR and live source publication policy, and be an ancestor of a live permitted target `T` under the raw Git graph. For this first increment, permit only the current remote default branch. Squash/rebase without reachable original source, missing objects/history, deleted source publication and uncertain identity remain unproven. No fetch, cleanup executor, capability or removal.

## Tasks

- [ ] 🔴 Real disposable bare-origin/linked-worktree REDs cover ordinary/later empty commits, fresh versus stale/rewritten target, source movement, wrong host/repo, effective multiple/rewritten remote URLs, missing/incomplete/grafted/replaced graph and unavailable/contradictory provider evidence.
- [ ] 🔴 Extend the existing evidence owner with a discriminated exact-source/live-default-target ancestry result. Preserve `atMergeSourceHead:unproven`; do not imply immutable provider snapshot semantics. Query live refs together, use already-local objects only, disable replacement interpretation/lazy acquisition/optional writes, and fail closed for unsupported controls/unsafe Git environment overrides.
- [ ] 🔴 Recheck local identity and effective fetch/push configuration around observation. Avoid mixing facts from multiple PRs/targets; unproven evidence retains an explicit blocker. Remove only `integration_snapshot_unproven` when the new proof is valid; keep every other independent skip and all resource decisions skipped.
- [ ] 🔴 Run focused canonical disposable tests and CLI/protocol checks as affected, self-review and exact commit/push for independent root review. Assert refs, working data and config remain unchanged; no deletion or capability becomes reachable.

Source anchors: `operations/cleanupPreflight.ts`, `repository.ts`, `readHostWorktreeCleanupPreflight.ts`, and their existing tests. No additional provider polling, cache, RPC or session inventory. Source3b preflight remains accepted through `e31e0359aa`; phase18 report is accepted as discovery only through `7ad9ff8d46`, including root's fresh independent nine-outcome Git probe at `happier-oh52-root-integration-probe-42vvv7km`.

Actual Astra/high owns this increment; retain cumulative OH-52 2failedSol/0Astra. Root owns Linear/tasks/phase9. UI/browser and existing evidence remain other workers' scope. No real checkout/provider/account/native/service mutation; disposable Git fixtures only.
