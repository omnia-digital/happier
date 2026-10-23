# Hotkeys and sidebar corrections

All work is owned by an existing Linear task before it starts. This continues the macOS UI-only path with the hosted account and installed CLI/daemon; iOS and Embedded Terminal remain deferred.

## OH-17: Command-number session navigation

Use one canonical list of currently visible, selectable session navigation entries for both numbered hints and navigation. Support Command+1 through Command+9 on macOS. Holding Command reveals those same numbers; key release, blur, hidden/inactive list and unmount clear the held state. Filtering, grouping, Pinned, collapse and custom order determine the displayed order. Skip headers and duplicate session targets.

Extend the existing keyboard command/provider and discoverability owners. Preserve composer typing, editor/terminal shortcuts and modal/menu ownership; derive the exact context policy from existing command metadata rather than adding a second keyboard dispatcher. Hints should fit existing row layout without replacing machine identity, status or actions. Virtualized rows consume the changed presentation through the existing extraData owner.

- [ ] 🔴 New owner-level tests distinguish hints/navigation using the same visible ordering, held/released Command and blur cleanup, filtered/collapsed/reordered rows, and editable/modal exclusions.
- [ ] 🟡 Implement through the canonical keyboard and list presentation corridor; preserve all existing behavior and tests.
- [ ] 🟡 Focused/adjacent tests, typecheck, independent review and native held-key/navigation acceptance. Native focus must be observed; no OS capability bypass. The three OH-19 fixture approvals remain pending and must not be bypassed.

## OH-48: Empty Active workspaces after pinning

Correct the canonical section/group projection so pinning its last unpinned Active session removes that workspace's now-empty Active structural headers. Mixed workspaces retain remaining sessions, collapsed groups remain valid, and unpin restores the original workspace/folder/order association. Preserve saved organization data and Pinned access. Reconcile legacy/indexed and machine-view/folder consumers instead of hiding one renderer.

- [ ] 🔴 Reproduce the actual pin/unpin projection with new deciding regressions, including all/mixed pinned, collapsed and folder cases.
- [ ] 🟡 Correct the owning projection and materially affected consumers without deleting organization data or changing existing tests.
- [ ] 🟡 Relevant tests/typecheck, independent review and a reversible native scratch-session pin/unpin replay; no real work session mutations.

## OH-16: Active archive failure

The previous native failure remains unattributed at the stop-RPC boundary. The runner exited, but the hosted active flag remained true for several minutes and the session stayed unarchived. Capture correlated stop RPC and archive HTTP outcomes in a dedicated scratch reproduction before changing source. Preserve current services and canonical deadlines; do not force archive, increase timeouts speculatively or upgrade the daily CLI. Inactive archive and keyboard focus remain separate deciding checks.

## OH-12: New upstream update

Parent `dev` is now `a487b2ec48`, adding macOS window-frame persistence. There are 33 parent commits absent from this feature branch. Review the new commit against fork startup/cleanup and its focused Rust tests before selecting any integration; the rest of the pending batch still needs mixed-version validation. No blind parent merge or upstream identity adoption.

## Current state

OH-14 machine view and OH-19 identities are pushed and natively exercised, but their broader ordering and fixture/typecheck closeout remain open. Five additional project requests OH-45 through OH-49 are now included in the live backlog: prefilled new session, folder order clarity, machine customization, empty Active headers and Inbox clarity. Keep all requested outcomes; this batch does not replace that backlog.
