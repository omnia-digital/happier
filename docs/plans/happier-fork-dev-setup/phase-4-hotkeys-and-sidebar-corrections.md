# Hotkeys and sidebar corrections

All work is owned by an existing Linear task before it starts. This continues the macOS UI-only path with the hosted account and installed CLI/daemon; iOS and Embedded Terminal remain deferred.

## OH-17: Command-number session navigation

Use one canonical list of currently visible, selectable session navigation entries for both numbered hints and navigation. Support Command+1 through Command+9 on macOS. Holding Command reveals those same numbers; key release, blur, hidden/inactive list and unmount clear the held state. Filtering, grouping, Pinned, collapse and custom order determine the displayed order. Skip headers and duplicate session targets.

Extend the existing keyboard command/provider and discoverability owners. Preserve composer typing, editor/terminal shortcuts and modal/menu ownership; derive the exact context policy from existing command metadata rather than adding a second keyboard dispatcher. Hints should fit existing row layout without replacing machine identity, status or actions. Virtualized rows consume the changed presentation through the existing extraData owner.

- [x] 🟢 New owner-level coverage passes for numbered order, held/released Command, blur/visibility cleanup, editable/modal exclusions and virtualized row presentation. Pushed `d4c65d1e8f`, `8912695325`, `3b3aa426ab`; existing tests/support remain byte-identical.
- [ ] 🟡 Canonical keyboard registry/provider and rendered list drive both hints and navigation. Focused new tests 9/9, provider 16/16, list 89/89 and adjacent row/virtualization 23/23 pass. These are overlapping suites, not an additive total.
- [ ] 🟡 Independent review found a material menu ownership gap: the actual search=false More dropdown supplies neither the synthetic role=menu target nor an editable focus target, allowing Command+number underneath it. Author correction and a new real-owner regression are in progress. Native held-key/navigation acceptance requires an observed foreground window; it remains hidden/unfocused. The three OH-19 fixture/typecheck approvals remain pending and must not be bypassed. The attempted locale verifier lacked its required translations argument and was not a passing check.

## OH-48: Empty Active workspaces after pinning

Correct the canonical section/group projection so pinning its last unpinned Active session removes that workspace's now-empty Active structural headers. Mixed workspaces retain remaining sessions, collapsed groups remain valid, and unpin restores the original workspace/folder/order association. Preserve saved organization data and Pinned access. Reconcile legacy/indexed and machine-view/folder consumers instead of hiding one renderer.

- [x] 🟢 New deciding regressions cover all/mixed pinned, collapsed and saved-folder cases. Independent review reproduced two global Attention/Working promotion errors in the first correction; three additional regressions observed RED then GREEN.
- [x] 🟢 Final correction `156174e3c8` classifies source workspace membership before global placement and removes only the corresponding post-placement header object references. Saved organization and unpinned source members are retained. Independent re-review reran both original failing probes and the new tests successfully; six adjacent suites / 102 tests pass.
- [x] 🟢 Native replay uses only two dedicated scratch sessions and their new saved QA folder. Group by machine: one pinned retains the mixed workspace/folder; both pinned remove the Active workspace/folder headers; reload and unpin restore the assigned session and folder with the other session still Pinned. Original layout: the same final pin removes the Active workspace/folder headers and retains both Pinned rows after a full reload; unpin restores the assigned folder/session. Collapsing the populated QA folder hides its session while retaining valid workspace/folder headers and the other Pinned session; expanding restores it. Both scratch sessions were unpinned and Group by machine restored afterward. Clicking the folder title separately exercised folder focus, then Clear folder focus restored the whole sidebar. No real work session mutations. The private native screenshot was inspected, not published.
- [ ] 🟡 Native behavior and independent source review pass, but integrated UI typecheck still has the three pending OH-19 fixture updates. This prevents declaring the integrated app gate green; no tests/support were changed without approval.

## OH-16: Active archive failure

The previous native failure remains unattributed at the stop-RPC boundary. The runner exited, but the hosted active flag remained true for several minutes and the session stayed unarchived. Capture correlated stop RPC and archive HTTP outcomes in a dedicated scratch reproduction before changing source. Preserve current services and canonical deadlines; do not force archive, increase timeouts speculatively or upgrade the daily CLI. Inactive archive and keyboard focus remain separate deciding checks.

Fresh dedicated QA4 succeeded: Cancel caused no archive request; confirmed hover Archive at 12:38:58.261 PDT received the real daemon stop at 12:39:00.197, SIGTERM/normal child exit, durable exit and strict stopped status by 12:39:01.590. The scoped archive request returned HTTP 200; hosted readback is inactive, archived at 12:39:02.252, pending zero, and the row disappeared while the other scratch selection was retained. Daemon log lines 14412–14427 in the existing pid-50180 log correlate the stop. This is a fresh success, not a root-cause claim for the old failure. The temporary request probe disappeared naturally when Rust watching recreated the scoped app; no probe remains in the new window.

## OH-12: New upstream update

Parent `dev` is now `a487b2ec48`, adding macOS window-frame persistence. Its independently reviewed six-file change was selectively adopted in pushed `d0ab118fb5`, preserving the primary author and recording the source SHA without a coauthor trailer. The parent hash is not an ancestor; graph counts still include this equivalent adoption. The rest of the pending batch still needs mixed-version validation. No blind parent merge or upstream identity adoption.

The locked offline native Rust window-frame test passed against the actual scoped target cache: window recreation, process restart, off-screen recovery and menu-bar startup. Logs: `/tmp/happier-oh12-macos-window-frame-test.log`; docs typecheck passed in `/tmp/happier-oh12-docs-types.log`. Independent stack lifecycle/identity checks passed 21/21. Product-level same-process tray destruction/reopen remains unverified. Rust watching automatically rebuilt/restarted the scoped dev app; the original installed app and daemon remain preserved. No optional 0.3 destination exists, so the port portion is unavailable rather than complete.

## Current state

OH-14 machine view and OH-19 identities are pushed and natively exercised, but their broader ordering and fixture/typecheck closeout remain open. Five additional project requests OH-45 through OH-49 are now included in the live backlog: prefilled new session, folder order clarity, machine customization, empty Active headers and Inbox clarity. Keep all requested outcomes; this batch does not replace that backlog.

## Subsequent closeout and global policy

Josh approved the three OH-19 fixture updates, then explicitly removed the approval requirement globally. Exactly two defaults (`machineLabel: null`, `showMachineIdentity: true`) were added to the shared row factory and the activity-time/loading-title literals. Assertions and expectations are unchanged. `yarn --cwd apps/ui typecheck` now passes, as do five affected row suites / 49 tests. Logs: `/tmp/happier-oh19-approved-fixture-{typecheck,tests}.log`. Earlier pending-approval/typecheck observations above are historical and superseded by these results. The original root suite remains failed separately; this is not a full-suite or release claim.

OH-17's menu correction is pushed as `077d313e42`: the provider observes the existing canonical Escape/popover layer registry rather than querying DOM or adding per-row listeners. A new regression exercises the actual searchless DropdownMenu. Adjacent provider/escape/dropdown/popover/i18n suites pass 83/83; independent finding-delta review passed 9/9 and found no remaining source blocker. Physical foreground keyboard acceptance remains open. Source locale integrity passed; the earlier pre-write JSON-map verifier usage error is not treated as success.

OH-51 owns the global instruction update. Codex and Claude instruction files were updated and read back on the current Mac, Cassian Mac mini and Josh-PC. The Mac files retain mode 0600; the PC's two discovered Admin-profile files retain all preexisting bytes with the policy appended. The exact new policy explicitly supersedes older project/global confirmation rules while preserving meaningful coverage and underlying defect diagnosis. The requested persistent preference was saved through the supported ad-hoc memory note mechanism. OH-51 is Done.
