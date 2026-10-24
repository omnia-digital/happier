# OH-52: Read-only host cleanup preflight

## Boundary

Implement a read-only decision over an existing verified phase14 worktree claim. The output will describe independent worktree and local-branch eligibility or an explicit skip reason. This slice performs no cleanup, remote mutation, provider write, new machine capability, service action, or operation on a real checkout.

The caller supplies only the claim's account, machine, active Home, release ring and launch nonce, plus the session being considered. The host reads the durable bound claim and current source evidence. A path, PR, or session ID supplied by a caller cannot become a claim. Missing provider, publication, inventory, or process proof must remain a skip. Windows and Linux process completeness is not assumed from macOS observations.

## Deciding facts and implementation order

1. Preserve exact Git worktree identity and bytes through the existing checkout identity, porcelain worktree parser, status and repository owners. Capture tracked/staged/untracked/ignored, locked/prunable registration, operation state, default/protected branch state and all relevant refs without mutating them.
2. Require a fresh provider-qualified, merged, non-draft PR whose source head equals the current local branch HEAD and whose repository identity matches the claim. Require a real matching publication on the expected remote; a stale tracking ref or a deleted source branch is not proof. Merge, squash and rebase can pass under the same exact-head/publication rule. Later local commits, remote movement and wrong repository skip.
3. Read fresh archived/inactive owner-session and other visible session/marker/process users through canonical owners. If the current source cannot prove exhaustive absence of other host users, retain `process_visibility_unknown` and do not return a deletion-ready decision.
4. RED/GREEN in disposable bare-origin and linked-worktree fixtures; fake only provider and authenticated server boundaries. Test each skip without modifying real resources. Check final result against races that a later executor must revalidate.

## Status

- [ ] 🔴 Source-owner and contract inventory; record actual limitations here before edits.
- [ ] 🔴 Exact Git and publication read-only proof with disposable fixtures.
- [ ] 🔴 Session/process visibility and per-resource decision shape, with honest unknown state.
- [ ] 🔴 Focused tests, types, source review, and pushed checkpoint for independent root review.

Source3a custody was accepted through `1e5c2af051`; phase13 is the source map, not a cleanup authorization. Root owns Linear/tasks/phase9 and integration review. This source3b slice stops before any removal or capability execution.
