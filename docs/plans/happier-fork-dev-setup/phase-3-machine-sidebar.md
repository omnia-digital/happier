# Machine identity and grouping implementation plan

**Goal:** Make the machine hosting a session obvious in the compact sidebar and provide a machine-grouped view, starting with the Pinned-list problem in Josh's 2026-10-23 screenshot.

**Tracked work:** [OH-19](https://linear.app/omniachurchapps/issue/OH-19/show-the-host-machine-on-session-cards-and-in-the-session-detail-header) owns row/header identity and Preferences; [OH-14](https://linear.app/omniachurchapps/issue/OH-14/organize-sessions-by-project-across-machines-with-custom-order-and-a) owns machine grouping and the broader later cross-machine project/custom-order work. Every implementation, investigation and verification step belongs to an OH issue before it starts.

## Design

Keep agent icons, status indicators, title, pin/tag/menu/Archive actions and selection intact. Add a small machine glyph and readable machine identifier to every sidebar row, including Pinned; use a tooltip/accessibility label for its full name. A generic glyph alone would not distinguish two Macs. Reuse the canonical machine display target and name resolution, including replacement identities and server scope; missing data must not show a different machine's name.

Show the selected session's machine icon and readable name beside its existing title/type badge without opening Info. Switching sessions updates that identity. Keep title, workspace subtitle and Info available, and let long names truncate with an accessible full name.

Use the existing Preferences and local settings owners for a default-on row machine indicator. This is a fork-app display preference, so it need not change the hosted account or old installed client's UI. Toggling it changes rows immediately and persists after restart; it does not hide the header identity.

For machine grouping, add a discoverable view-menu choice using the existing projection and ordering infrastructure. Preserve the original project/date/folder/pin order when switching back. Key machine groups by server plus canonical machine ID, never just host name. Keep unknown hosts explicit. Do not reclassify the machine view as completed cross-machine repository grouping: the rest of OH-14 remains required.

## OH-19 execution

- [ ] 🔴 Add new focused regressions for default-on/missing metadata, multiple machines including Pinned, preference off/on/persistence, header identity/session switching and preserved row controls. Reuse canonical UI testkit; no preexisting test edits.
- [ ] 🟡 Carry the resolved machine identity through the existing row model/projection, preserving narrow subscriptions and stable unchanged rows. Render the machine glyph/name without per-row RPCs or a new machine registry.
- [ ] 🟡 Add the local default-on preference to the canonical settings registry and Session preferences route; localize new labels across existing locales. Wire immediate row updates and persisted reload behavior.
- [ ] 🟡 Render header identity through existing ChatHeaderView/SessionView presentation; card preference does not control it.
- [ ] 🟡 Run relevant owner tests and UI typecheck, then full-reload native QA for multi-machine rows, Pinned, toggle/restart, session switching and narrow/long-name layout. Independently review before ticket closeout; commit AND push tested steps.

## OH-14 machine view execution

- [ ] 🔴 Trace both legacy/indexed session-list projections, current view menu, group headers, folder/pin scopes and custom ordering before changing grouping. Add a new deciding regression for two machines with multiple projects and duplicate host names across server scopes.
- [ ] 🟡 Add the machine view through the canonical grouping owner and view state. Preserve all sessions, folders, pinning, actions and stable per-view ordering; no parallel store or inferred repository equivalence.
- [ ] 🟡 Verify switching machine view on/off preserves existing custom order and survives reload. Exercise the real native sidebar with at least two connected machines. Keep the broader OH-14 acceptance open until repository equivalence and all ordering requirements are implemented and verified.

## Current state

Priority and scope recorded before source changes. OH-16 remains open with a live archive failure and foreground keyboard QA outstanding; its pushed implementation is preserved. OH-15 and the OH-6 UI-only development baseline remain complete. Original installed app, CLI/daemon, hosted account and disabled Embedded Terminal are retained. No release, merge or daily-use cutover is implied.
