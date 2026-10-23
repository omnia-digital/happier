# Card layout, composer mode and repository grouping

Continue macOS-first source work under the current OH tasks. The existing hosted account, installed clients/daemon and active native window remain intact. Native hotkey QA is explicitly deferred; other native acceptance remains required. All source changes need meaningful RED/GREEN and independent review; tests/fixtures do not need separate approval.

## OH-54: Agent and machine identity placement

Move the existing agent icon from the title's left edge into the row's right-side identity group: agent, machine glyph, optional machine label, then existing remaining indicators/actions. Reuse the OH-47 glyph/color owner. Add local default-on **Show machine labels on session cards**, independent of the existing machine-identity visibility setting. Preserve the detail header's separate identity. Label-off rows retain icon, full-name hover/focus tooltip and accessible name. Propagate virtualized presentation inputs through the current extraData/row-model owner; preserve Pinned/ordinary/grouped rows, selection, status, title space and controls.

- [ ] 🔴 Trace canonical row/preference/identity owners and establish deciding layout, icon-only, tooltip/focus, persistence and virtualization regressions.
- [ ] 🟡 Implement the complete source corridor, focused/adjacent checks, typecheck, independent review and pushed checkpoint.
- [ ] 🟡 Native multi-machine/custom appearance/narrow layout/restart acceptance remains pending separately.

## OH-53: Composer Build/Planning presentation

Rename only the existing relevant user-facing Default mode to Build; underlying provider mode values and availability stay unchanged. Active chip shows a distinct Build icon or recognizable Planning/checklist icon without persistent text. Reuse the mode selector, icon and tooltip owners; hover/focus and accessibility expose the current mode. Picker choices retain labels and switching behavior.

- [ ] 🔴 Trace the actual mode descriptor/picker and labels; add deciding icon-only/tooltip/focus/switching tests.
- [ ] 🟡 Implement through those owners, validate adjacent consumers/typecheck, independent review and push.
- [ ] 🟡 Native both-mode switching/compact layout/hover/focus acceptance remains pending.

## OH-14: Repository-view implementation design

Complete source-backed design from the phase-3 discovery before production edits. Required outcome remains equivalent repositories across machines plus persistent manual session ordering, alongside Original/Machine views. Workspace-subgroup order alone must not silently replace session ordering. Folders, pins, shared access, original action targets and server/account boundaries remain valid.

Known facts: installed CLI 0.2.16 supports existing SCM snapshots with root/remotes/worktrees, but list metadata lacks repo identity and snapshots are ephemeral/expensive. Reuse the SCM owner for explicit discovery and persisted scoped associations; do not fetch from each row. Current machine-path SCM service lacks explicit server input, so establish the transport/cache scope before extending it. Origin host/full namespace/repo and nondefault port are identity inputs; never basename or any common upstream. Unknown SSH aliases/local remotes need a predictable separate/manual path. Resolve project projection, ordering, folder/drag behavior and lifecycle together, without a parallel organization store.

- [ ] 🟡 Astra/high reviews the design against actual owners and proposes the smallest complete implementation; root decides routine mechanisms under the authorized outcome, asking only for an unresolved product/authority tradeoff.
- [ ] 🔴 Implement all required owners and deciding equivalent-repo, alias/worktree, same-basename, scope, persistence/order, folder/action and view-roundtrip regressions.
- [ ] 🟡 Validate source, independent review, native workflow and restart; keep OH-14 In Progress until the full requirement is proven.

## Inventory and routing

Refreshed project now also contains OH-59 machine monitoring; it remains open and must be read before implementation. Other open tasks retain their original scope. Parent `dev` fetched this continuation is unchanged at `a487b2ec48`; no blind merge.

Selected lanes: OH-54 Sol/high (0 failures); OH-53 Luna/medium (0 failures); OH-14 design Astra/high (0 failures in this remaining-repository workstream). The route executor remains unable to start due to invalid `model_routing` transport; use matching native workers when available and disclose failures. Root owns these execution docs; workers coordinate only actual source hunks and serialized staging/commit/push transactions.
