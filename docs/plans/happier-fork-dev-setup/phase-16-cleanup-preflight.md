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

- [x] 🟢 Source-owner and contract inventory. Canonical Git identity/status/worktree parsers, PR get, durable claim and V2 session readers identified; no exhaustive host process or branch-protection owner exists in this corridor.
- [ ] 🟡 Exact Git and publication read-only proof with disposable fixtures; normal/squash/rebase history matrix remains.
- [ ] 🟡 Session/process visibility and per-resource decision shape. Fresh bound archived session plus both visible list scopes are read; other accounts/processes remain unknown and every resource stays skipped.
- [ ] 🔴 Focused tests, types, source review, and pushed checkpoint for independent root review.

Source3a custody was accepted through `1e5c2af051`; phase13 is the source map, not a cleanup authorization. Root owns Linear/tasks/phase9 and integration review. This source3b slice stops before any removal or capability execution.

## Source observations during implementation

- `repository.ts` now uses actual linked checkout identity, realpaths, NUL porcelain status with staged/modified/untracked/ignored paths, and canonical worktree registration. Locked and prunable tokens are preserved by the existing parser. A clean status is only an observation; no removal permission is produced.
- `pullRequestOperations.ts` exact `get` rereads the provider and validates the linked PR identity. GitHub CLI's published `gh pr view --json` contract includes `headRepository` ([official field list](https://cli.github.com/manual/gh_pr_view)); REST has the source repository in `head.repo.full_name`. The canonical summary now preserves that optional field. An absent source repository, a fork source against the linked base repository, or GitLab payload without source identity skips. No provider registration or write is needed.
- Publication checks the live remote source ref and symbolic default HEAD with `git ls-remote`, not a stale remote-tracking ref. The exact source repo must match fetch and push remote identity. Deleted source refs skip because the current summary has no immutable deleted-branch publication proof. The local branch HEAD is re-read around the provider/remote lookups; a later executor still has to revalidate at its mutation boundary.
- `readHostWorktreeCleanupPreflight` reads only a bound claim under the supplied Home/server/ring/machine/nonce and the account returned by the authenticated server profile. It requires the fresh V2 session to be archived, inactive, and machine/Home/path-consistent. Ordinary and archived visible sessions are paged; missing metadata/cursor/requests are incomplete. Since other accounts, unrelated processes and branch protection are not exhaustively observable here, observed worktree and local-branch decisions are always skipped. This is source evidence, not a cleanup capability.
- Focused CLI tests and CLI typecheck passed after the canonical protocol build and bundled workspace declaration sync. Tests use disposable bare-origin and linked-worktree resources; provider/server boundaries are fixtures. No daily app, provider, or real checkout was changed.
