# OH-52: Host cleanup ownership and proof discovery

## Bounded purpose

Discover the smallest host-owned safe cleanup implementation for phase10 slice3 while its independent Preferences/foreground autoarchive slice proceeds. This pass changes only this report; it does not implement cleanup or remove any real resource.

## Acceptance and boundaries

- Trace creation-time claims from UI/CLI checkout materialization through actual session ID binding and durable machine-owned storage. A path or linked PR alone is not ownership; existing unclaimed checkouts must stay safe.
- Trace authenticated machine/session/archive authority and how the host can freshly verify archive state and all other session/worktree/process users without a new broad parallel inventory.
- Identify canonical Git/filesystem owners and exact non-force primitives for independently eligible worktree, local branch and empty exclusively claimed temporary directory removal. Preserve remote branches.
- Establish actual pushed/integrated proof for later commits and squash/rebase merges; missing provider head/remote/process/ownership proof means a useful skip, not deletion.
- Inventory immediately-before-mutation checks, path/symlink races, ignored/untracked/modified/unpublished data, protected/default/main/shared resources, offline/retry and partial outcomes.
- Report macOS/Windows/Linux differences honestly. No remote commands, installs, services, provider writes, account preference changes or daily native interaction.
- Propose decisive disposable-repository tests, auth/lifecycle seams and source decomposition; do not manufacture new claims or implement before the canonical lifecycle is understood.

## Tracking

- [ ] 🟡 Source corridor, ownership inventory and reachable gaps.
- [ ] 🔴 Concrete implementation seams and deciding test recipe, with source references.
- [ ] 🔴 Independent root review and integration with slice2 constraints.

Routing selected actual Sol/high, zero failed cycles. Root owns Linear, tasks and phase9; the bounded worker owns this report. Full OH-52 remains In Progress.
