# OH-52: Fresh integration proof discovery

## Boundary

Establish a source-backed design for proving that the exact current published local commit is integrated before any future cleanup. Phase16 deliberately proves only current PR state/publication and keeps `integration_snapshot_unproven`. This discovery cannot remove that blocker without stronger evidence. No executor, provider write, daily app/service action or real checkout mutation.

## Work

- [ ] 🔴 Inspect canonical Git/provider/read contracts and the existing local `origin-integration-v3` policy as reference; reuse applicable owners and identify assumption differences.
- [ ] 🔴 Verify primary provider contracts for merged source identity, merge commit and commit-associated PR reads, including later source-branch movement, deletion, forks and merge/squash/rebase. Current head plus merged state alone is insufficient.
- [ ] 🔴 Define a conservative proof using fresh provider and target Git facts, with exact current-head and publication checks and immediate revalidation requirements. Distinguish normal ancestry from squash/rebase proof; unsupported cases stay unknown.
- [ ] 🔴 Record decisive disposable or public read-only evidence, limitations, minimal source seams and a test matrix for independent root review. Do not weaken source3b blockers or implement deletion.

Root inspected `/Users/Josh/bin/cleanup-all-worktrees` read-only: its policy accepts fresh origin ancestry, or exact source head/repository from commit-associated merged PRs plus the PR merge commit reachable in a fresh permitted target. It observes only current-UID open paths with lsof, which is not exhaustive cross-account host proof for Happier. No cleanup tool was run. Its useful principles are reference, not automatically a guarantee for this app's broader resource ownership and process requirements.

Router selects actual Astra/high for this bounded discovery; retain OH-52 cumulative2failedSol/0Astra. Root owns Linear/tasks/phase9; the worker owns this discovery report. Other workers retain UI/browser and existing CLI source ownership; this task is report-only until reviewed.
