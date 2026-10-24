# Session actions and machine customization

Every investigation and implementation has an owning OH issue before it starts. Continue on the existing feature branch and hosted-account UI-only Mac development stack. Preserve the installed app, CLI/daemon and existing sessions. Embedded Terminal and iOS remain deferred. Necessary test/fixture updates no longer require approval globally (OH-51); meaningful coverage is still required.

## OH-18: Archive the hovered session with A

Use the canonical keyboard command/provider, the existing row hover lifecycle and session action execution. Plain A targets the hovered eligible session, even when another session is selected. It always opens Archive confirmation, independent of a skip-confirmation preference, and retains an active-session Stop safeguard. Capture the target at confirmation open. Enter belongs only to that dialog, Escape cancels, and repeat/pending dispatch cannot archive twice.

Clear the hover target on leave, scroll, filtering, row unmount and inactive list. Do not capture typing, composition, editor/terminal controls or an unrelated menu/modal. Reuse the tooltip/help owner for discoverability. Preserve mouse/menu Archive behavior. Avoid a per-row global keydown listener or a second action/confirmation implementation.

- [x] 🟢 Implemented and pushed through `7e3871a598` using the canonical provider, hover owner, action executor and modal. A returns unhandled when there is no eligible hover; it remains available without enabling unrelated single-key commands.
- [x] 🟢 Owner regressions cover forced confirmation, captured target, active Stop, repeat/pending, stale hover, editable/menu exclusions and disabled/rebound commands. Owner 69 tests and adjacent 46 tests passed; UI typecheck passed.
- [x] 🟢 Independent review found Enter incorrectly confirmed even when Cancel was focused. Meaningful RED/GREEN corrected the actual Radix dialog: Confirm receives initial focus, Enter on explicitly focused Cancel cancels. Final dialog lane passes 8 tests. Root independently replayed actual dialog, metadata and Settings boundaries: 4 suites / 23 tests pass.
- [ ] 🟡 Native foreground A/Enter and A/Escape acceptance is explicitly deferred by Josh: **Keep working on source; defer native hotkey QA**. Do not interrupt the user's app or count DOM event injection as physical-key acceptance.

## OH-47: Machine display customization

Investigate existing machine settings, rename/display-name resolution, icon metadata and local/synced preference boundaries before selecting the implementation. Provide a discoverable label/icon editor and reset to defaults, apply consistently to Pinned/ordinary rows and machine groups, and persist across restart. Identity remains server plus machine ID even if labels match. Agent/workspace identity remains independent.

- [x] 🟢 Reuse existing metadata display-name Rename. Four icon choices and Reset are in machine detail; icons are local preferences keyed by server plus machine ID, labels use existing synced metadata. Reset clears the icon only after successful label reset.
- [x] 🟢 Pushed row/group/detail/settings identity and machine pickers/context chips through `0ed70d2d7f`. Generic navigation/placeholders remain generic. Agent-input name-only contract lacks machine ID and is not given an invented identity.
- [x] 🟢 Independent review corrected explicit rename/reset intent to preserve concurrent names, then Inbox successor-label/predecessor-icon and approval missing-session-server scope mismatches. Astra correction `19dfe8b315` plus complete fixture `a69c3ac1ea` are pushed; root independently replayed all four affected suites / 20 tests, including rendered replacement identity and all three approval scope fallbacks. Integrated UI typecheck passes. Counters: 2 failed Sol review cycles, 0 failed Astra cycles.
- [x] 🟢 Latest OH-47 icon-color source is pushed in `270b230f62`: Automatic/Blue/Purple/Red through local preference/shared glyph owners. Focused 110 tests, adjacent 35 tests, expanded platform contrast 4 tests and final integrated UI typecheck pass (overlapping counts). Root independently replayed 10 deciding color/save-load/reset/subscription/contrast cases across four suites, with 98 unrelated cases intentionally filtered. No remaining source finding in this corridor; native acceptance is still required. See phase 6.
- [ ] 🟡 Native multi-machine customization/reset and restart persistence using reversible display choices.

## Current gates

OH-19 and OH-48 development acceptance are complete and the integrated UI typecheck is green at `1c5450f7f0`. OH-17's reviewed source is complete, but physical foreground keyboard acceptance remains open. OH-16 has a fresh successful real active stop/archive lifecycle; inactive/keyboard checks and the disposition of its old unrootcaused failure remain open. OH-50 expands the full menu hotkey inventory later and must share OH-18's Archive path rather than replace it. Broader OH-14 repository/custom order and all release/platform tasks remain required.

## OH-50: Complete menu shortcut coverage

OH-50 is now In Progress after the recovered source/browser action gate. Actual routed lane is Sol/high, zero failed cycles. The full issue, rather than the screenshot alone, defines the inventory: every actionable canonical right-click/three-dot command, conditional opposite-state variants, nested reminder choices/management, copy information, Same Setup, draft delete, fork/stop/archive, move and other reachable context actions. `buildSessionRowMoreMenuItems` owns composition, `useSessionRowActionMenu` owns execution, and `apps/ui/sources/keyboard` owns bindings/labels/matching.

Extend those owners rather than another action/target registry. Direct main-command shortcuts and displayed hints must share definitions with dispatch. An open menu targets its own row even if another is selected; outside it, use existing predictable hover/focus authority. Preserve A's forced Archive confirmation and Enter/Escape through OH-18's existing path, all permission/availability/busy/typing/editor/terminal/unrelated-modal guards, repeat suppression and platform/collision behavior. Choice-requiring shortcuts open the existing chooser/submenu. Dynamic saved presets do not need infinitely many global combinations; their reachable menu-local activation must have honest hints from the same keyboard-navigation owner and must not silently drop nested commands. Do not substitute generic arrow navigation for the requested direct main-command shortcuts.

First work is exhaustive inventory/binding allocation and deciding REDs, followed by complete source/adjacent/type/browser verification. Only native HOTKEY QA is explicitly user-deferred; root owns docs/Linear and no active native app is focused/reloaded. Source work must preserve existing UI actions and all other lanes' changes.

First vertical WIP `c2ecdc3f73` is pushed: registered direct commands, shared menu hints/execution, owned-menu context and row target precedence. Focused checks pass at its checkpoint; complete dynamic submenu navigation, actual row/provider interaction, full adjacent/type/browser gates remain open. SessionsList keyboard hunks were staged separately from the concurrent foreign-folder action work. No complete OH-50 behavior or native acceptance is claimed.

### OH-17 integration discovery

The current settings owner filters commands without `settingsTitleKey`; the nine numbered commands are consequently absent from Settings and cannot be disabled/rebound there. The generated keyboard reference also parses only literal single-quoted command IDs and silently omits the mapped numbered commands, while its platform formatter does not identify macOS-only bindings. Correct this existing registry/settings/documentation corridor rather than hand-editing generated output or keeping a second list of binding facts. Add deciding regression coverage and regenerate the canonical reference. This is the second material Sol implementation/review discovery after the already corrected More-menu ownership finding; preserve cumulative attempt counters and use the recommended stronger lane for the closeout.

Correction `ce2edd860c` adds all nine localized Settings commands, tests disable/rebind/reset, and generates the reference using bounded TypeScript AST parsing rather than executing registry code. The canonical generated reference contains 43 commands with platform scopes; account-scoped preference copy is corrected. UI keyboard/Settings 76 tests, docs 46 tests, content checks, UI typecheck and the production docs build (459 static pages) pass. Root independently replayed the four generator regressions. Cumulative OH-17 counters remain 2 failed Sol cycles, 0 failed Astra cycles; correction ran in Astra/high.

Native event-injection QA showed all nine hints and release cleanup. The CLI constructs KeyboardEvent `code` from its `key` argument, so canonical numbered bindings require tool key `Digit1` etc rather than `1`; earlier nonnavigation with key `1` was not a valid product failure. Selection changed concurrently, and Josh subsequently explicitly deferred native hotkey QA. No physical-keyboard or navigation PASS is claimed. Source/review and platform acceptance remain separate.

## Compatibility and release disposition

These are pushed development changes, not a merge, packaged release or daily-use cutover. Existing hosted services and installed clients are preserved. Icon preferences introduce no machine wire field. Optional 0.3 checkout destinations are absent, so no 0.3 port completion is claimed. Parent `dev` was fetched again this session; the selectively adopted macOS frame correction remains separate from the unintegrated mixed-version batch. Broader OH-14 organization/custom order, remaining OH tasks, native acceptance and release/platform gates remain open.
