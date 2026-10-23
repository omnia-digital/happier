# Machine identity and grouping implementation plan

**Goal:** Make the machine hosting a session obvious in the compact sidebar and provide a machine-grouped view, starting with the Pinned-list problem in Josh's 2026-10-23 screenshot.

**Tracked work:** [OH-19](https://linear.app/omniachurchapps/issue/OH-19/show-the-host-machine-on-session-cards-and-in-the-session-detail-header) owns row/header identity and Preferences; [OH-14](https://linear.app/omniachurchapps/issue/OH-14/organize-sessions-by-project-across-machines-with-custom-order-and-a) owns machine grouping and the broader later cross-machine project/custom-order work. Every implementation, investigation and verification step belongs to an OH issue before it starts.

## Design

Keep agent icons, status indicators, title, pin/tag/menu/Archive actions and selection intact. Add a small machine glyph and readable machine identifier to every sidebar row, including Pinned; use a tooltip/accessibility label for its full name. A generic glyph alone would not distinguish two Macs. Reuse the canonical machine display target and name resolution, including replacement identities and server scope; missing data must not show a different machine's name.

Show the selected session's machine icon and readable name beside its existing title/type badge without opening Info. Switching sessions updates that identity. Keep title, workspace subtitle and Info available, and let long names truncate with an accessible full name.

Use the existing Preferences and local settings owners for a default-on row machine indicator. This is a fork-app display preference, so it need not change the hosted account or old installed client's UI. Toggling it changes rows immediately and persists after restart; it does not hide the header identity.

For machine grouping, add a discoverable view-menu choice using the existing projection and ordering infrastructure. Preserve the original project/date/folder/pin order when switching back. Key machine groups by server plus canonical machine ID, never just host name. Keep unknown hosts explicit. Do not reclassify the machine view as completed cross-machine repository grouping: the rest of OH-14 remains required.

## OH-19 execution

- [x] 🟢 Added new focused regressions for default-on/missing metadata, preference persistence, header identity and preserved controls, using canonical testkit. No preexisting tests or assertions edited. Tooltip RED/GREEN checks and 107 adjacent UI checks pass through `4363ad3bb6`.
- [x] 🟢 Carried resolved machine identity through the existing row model/projection with existing canonical reachability resolution and virtualized presentation inputs. Native rows show three distinct machines, including Pinned. No per-row RPC or new registry.
- [x] 🟢 Added a localized local default-on Session preference. Native off/on updates rows immediately; each value survives full WebView reload. The installed client's hosted settings remain unchanged.
- [x] 🟢 Header identity uses existing SessionView presentation beside the type badge. Native selection across Vader---MBP, Cassians-Mac-mini and Josh-PC updates correctly; row preference off leaves header identity visible. Full-name tooltips observed for header and row; More/Tag/Archive controls remain visible on hover.
- [ ] 🟡 Run relevant owner tests and UI typecheck, then full-reload native QA for multi-machine rows, Pinned, toggle/restart, session switching and narrow/long-name layout. Independently review before ticket closeout; commit AND push tested steps.

## OH-14 machine view execution

- Discovery complete: add a local display projection in `useSessionListViewState` after the canonical ordered/pinned/indexed data and before folder presentation. Mode off returns the original data unchanged. Do not widen synced grouping enums understood by the installed client.
- Bucket individual sessions by server and canonical machine identity within existing top-level bands. Reconstruct project/folder/date/shared lineage inside each machine; moving entire project subtrees is incorrect when an unknown-machine session shares a path with another host.
- Carry machine headers through the view/index unions, nested collapse, focused folders, search pruning and drag/drop interpretation. Preserve source-relative order and action targets. New machine-view structural reordering must either use valid canonical ordering semantics or be explicitly unavailable in that view while the original view retains all ordering controls; never persist fake machine workspace keys.
- Deciding coverage includes same-name machines across servers, known/unknown sessions sharing paths, Pinned/shared/inactive scopes, folder focus/search/collapse, each session appearing once, and original → machine → original view switching without organization/order writes. The broader cross-machine repository equivalence and custom-order acceptance remains open.

- [ ] 🔴 Trace both legacy/indexed session-list projections, current view menu, group headers, folder/pin scopes and custom ordering before changing grouping. Add a new deciding regression for two machines with multiple projects and duplicate host names across server scopes.
- [ ] 🟡 Add the machine view through the canonical grouping owner and view state. Preserve all sessions, folders, pinning, actions and stable per-view ordering; no parallel store or inferred repository equivalence.
- [ ] 🟡 Verify switching machine view on/off preserves existing custom order and survives reload. Exercise the real native sidebar with at least two connected machines. Keep the broader OH-14 acceptance open until repository equivalence and all ordering requirements are implemented and verified.

## Current state

OH-19 identifiers and tooltip correction are pushed through `4363ad3bb6`. The full-reloaded native app shows 27 machine indicators including Pinned across three machines; local preference off/on and reload persistence, header independence, cross-machine selection and full-name hover tooltips passed. A corrective checkpoint preserves the existing workspace subtitle contract. Screenshot `/tmp/happier-oh19-machine-identity-final.jpg` was inspected locally and is private; it is not committed or uploaded. Full native app restart and independent source review remain in progress. UI typecheck currently reports three existing row fixtures missing the two new required fields, and precise user approval to update those fixtures is pending. No existing assertions have been changed.

OH-14 owner/consumer discovery is complete and machine-view implementation is next. OH-16 remains open with a live archive failure and foreground keyboard QA outstanding; its pushed implementation is preserved. OH-15 and the OH-6 UI-only development baseline remain complete. Original installed app, CLI/daemon, hosted account and disabled Embedded Terminal are retained. No release, merge or daily-use cutover is implied.
