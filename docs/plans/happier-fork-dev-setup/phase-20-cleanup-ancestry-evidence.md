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

## Execution evidence

First RED: three existing merge/squash/rebase cases failed on missing ancestry evidence. Expanded RED: 18 of 24 disposable cases failed on missing evidence and effective-remote/ref/config drift. Initial implementation passes 23 of 24; the byte-preservation case exposed an actual nested `getGitSnapshot` index refresh through exact PR lookup. Root accepted a scoped canonical read-only snapshot correction; it is in progress. No cleanup executor or deletion-ready resource decision exists.

Resumed source verification: current focused suite reproduced an index-write failure (24 pass/1 fail), and an added intermediate assertion isolated it to the provider snapshot path rather than the initial worktree evidence read. Git's documented `diff.autoRefreshIndex` defaults to true and refreshes stat-only index entries. Disabling it only in the existing cleanup read arguments resolves that deciding failure without changing ordinary SCM refresh. Focused regression1 passes, full disposable suite25 passes (`/tmp/happier-oh52-ancestry-current-final.log`), and CLI workspace typecheck passes (`/tmp/happier-oh52-ancestry-current-types.log`). No assertion was weakened.

This remains a partial source checkpoint, not delivered automatic cleanup: the preflight has no live cleanup consumer/executor and every resource still skips for independent blockers. Under the updated constitution, do not add more dormant cleanup infrastructure or a privileged observer by inference. Complete host-user visibility cannot be established with current permissions; a materially different cleanup authority needs a human decision. Windows/Linux execution and the unavailable 0.3 port remain unverified. Existing work is preserved for that decision.
