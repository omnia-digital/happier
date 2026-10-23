# Sidebar clarity and remaining machine appearance

Continue the authorized macOS source work on the existing branch, with each change owned by its OH issue. Native hotkey QA is explicitly deferred. Preserve existing clients, hosted account settings, sidebar actions and unrelated work. Use canonical owners and meaningful RED/GREEN for behavior fixes; no separate approval for fixtures or tests.

## OH-46: Folder order

Inspect the actual menu, ordering rules and visible index. Establish what Folders first and Mixed with sessions do in Custom order and date modes, whether choices persist, and how users can discover the dependency and change a mixed order. Existing menu copy already mentions the date-mode lock; do not assume it is missing or redesign ordering without evidence.

- [x] 🟢 Source discovery established Custom mixed interleaving, date-mode forced Folders first and existing local persistence. Existing projection tests cover both modes.
- [x] 🟢 RED reproduced misleading enabled Folders first with a handler that ignores all folder-sort selections in date modes. Pushed `1b93cf17b5` corrects sidebar and Session Settings, explains date-mode lock and project/folder scope/manual dragging in Original layout. Existing preference/ordering algorithms and machine view are preserved; returning to Custom restores saved Mixed.
- [x] 🟢 Author adjacent 113 tests and typecheck pass. Root independently reviewed the delta and replayed five deciding menu/settings cases (44 unrelated tests intentionally filtered), all pass. Native folder/restart acceptance is not run, not waived by the separate hotkey deferral.
- [ ] 🟡 Native representative folder/session ordering and restart acceptance remains a distinct gate; do not interrupt the user's active app.

## OH-47: Remaining icon color acceptance

Latest Linear acceptance includes a chosen icon color for recognizing machines without text labels. Canonical Inbox/approval identity corrections are pushed in `19dfe8b315`/`a69c3ac1ea` and independently verified (20 tests); the subsequent color correction is pushed in `270b230f62`.

- [x] 🟢 Existing shared glyph consumes scalar local server+machine color. Palette Automatic/Blue/Purple/Red reuses existing theme accents that measure at least 3:1 on eight actual light/dark ordinary/selected/hovered surfaces, with iOS accent coverage. Automatic preserves caller foreground. No agent/status/name recoloring or new wire field.
- [x] 🟢 Real MMKV-boundary save/load verifies independent server/machine choices and resetting only the selected override; real store/hook coverage proves unrelated machine changes do not rerender the scalar subscriber. Machine-detail color-only Reset is enabled. RED also reproduced interactive pickers during pending synced reset; both pickers now disable/guard through that existing busy lifecycle. Failed name reset retains icon/color choices.
- [x] 🟢 Source controls/review and relevant checks complete: author focused 110, adjacent 35, expanded contrast 4 and integrated UI typecheck pass (overlapping totals). Root independently reviewed the diff and replayed 10 deciding cases across four suites; 98 unrelated tests intentionally filtered. Counters remain 2 failed Sol review cycles / 0 failed Astra cycles.
- [ ] 🟡 Native multi-machine customization/reset and full restart remain pending, not waived by the explicit hotkey deferral. OH-47 stays In Progress. Label-free right-side card layout remains OH-54.

## Remaining backlog coverage

The refreshed project inventory also includes OH-53 (icon-only Build/Planning), OH-54 (right-side agent/machine layout and optional labels), OH-55 (stable/dev names and icons), OH-56 (Command+K title/content search), OH-57 (session status colors/badges), and OH-58 (ticket links/status). These are not implemented by the earlier sidebar batch. OH-14 broader grouping/order and OH-45/49/50/52 remain open too. Read each full current issue before its source work; no inferred completion from neighboring changes.

Routing: OH-46 classified Sol/high, attempt counters 0/0/0. OH-17 and OH-18 assessment accurately included native acceptance as missing/user-deferred; the advisory stronger-lane result does not authorize interfering with the app or turn a deferred check into a product defect.
