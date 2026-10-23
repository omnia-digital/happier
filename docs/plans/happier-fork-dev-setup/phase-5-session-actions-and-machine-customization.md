# Session actions and machine customization

Every investigation and implementation has an owning OH issue before it starts. Continue on the existing feature branch and hosted-account UI-only Mac development stack. Preserve the installed app, CLI/daemon and existing sessions. Embedded Terminal and iOS remain deferred. Necessary test/fixture updates no longer require approval globally (OH-51); meaningful coverage is still required.

## OH-18: Archive the hovered session with A

Use the canonical keyboard command/provider, the existing row hover lifecycle and session action execution. Plain A targets the hovered eligible session, even when another session is selected. It always opens Archive confirmation, independent of a skip-confirmation preference, and retains an active-session Stop safeguard. Capture the target at confirmation open. Enter belongs only to that dialog, Escape cancels, and repeat/pending dispatch cannot archive twice.

Clear the hover target on leave, scroll, filtering, row unmount and inactive list. Do not capture typing, composition, editor/terminal controls or an unrelated menu/modal. Reuse the tooltip/help owner for discoverability. Preserve mouse/menu Archive behavior. Avoid a per-row global keydown listener or a second action/confirmation implementation.

- [ ] 🔴 Add meaningful owner regressions for hovered versus selected, forced confirmation, target capture, cancel/Enter, active Stop, permissions/busy/repeat, stale hover and editable/menu exclusions.
- [ ] 🟡 Implement through the consumed canonical owners; update existing canonical documentation where needed.
- [ ] 🟡 Focused/adjacent suites and UI typecheck; independent user-visible boundary review.
- [ ] 🟡 Full-reload native foreground A/Enter and A/Escape on dedicated scratch sessions only; record any focus/tool prerequisite without bypassing capabilities.

## OH-47: Machine display customization

Investigate existing machine settings, rename/display-name resolution, icon metadata and local/synced preference boundaries before selecting the implementation. Provide a discoverable label/icon editor and reset to defaults, apply consistently to Pinned/ordinary rows and machine groups, and persist across restart. Identity remains server plus machine ID even if labels match. Agent/workspace identity remains independent.

- [ ] 🔴 Establish canonical owners, existing capabilities and persistence constraints; choose the smallest coherent extension and deciding regressions.
- [ ] 🟡 Implement label/icon/reset UI and all consumed machine identity surfaces without an alternate identity resolver.
- [ ] 🟡 Owner/persistence/adjacent checks, typecheck and independent review.
- [ ] 🟡 Native multi-machine customization/reset and restart persistence using reversible display choices.

## Current gates

OH-19 and OH-48 development acceptance are complete and the integrated UI typecheck is green at `1c5450f7f0`. OH-17's reviewed source is complete, but physical foreground keyboard acceptance remains open. OH-16 has a fresh successful real active stop/archive lifecycle; inactive/keyboard checks and the disposition of its old unrootcaused failure remain open. OH-50 expands the full menu hotkey inventory later and must share OH-18's Archive path rather than replace it. Broader OH-14 repository/custom order and all release/platform tasks remain required.
