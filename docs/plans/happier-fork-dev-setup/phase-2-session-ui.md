# Session sidebar menu implementation plan

**Goal:** OH-15 makes a session's right-click open the same menu as its three-dot button, without navigating or changing the action target.

**Architecture:** Reuse `SessionItem`'s existing `moreMenuOpen`, `moreMenuItems`, `handleMoreMenuSelect` and `DropdownMenu`. Add the desktop/web context-menu event at the existing row boundary. Keep native mobile long-press and its action list unchanged.

**Tech stack:** React Native Web, React, TypeScript, existing DropdownMenu/FloatingOverlay and Vitest UI testkit.

**Spec:** [OH-15](https://linear.app/omniachurchapps/issue/OH-15/open-the-session-three-dot-menu-on-sidebar-right-click), plus the user's explicit request for the same menu. OH-6's reviewed UI-only development baseline is complete; terminal QA is explicitly deferred. Packaged release gates remain separate.

## Design and constraints

Reusing the existing dropdown is the direct way to guarantee parity. A second context-menu builder would create competing action lists; simulating a click on the three-dot element would depend on incidental DOM mounting. Neither is needed. Anchor the opened dropdown to its existing trigger and preserve its established keyboard dismissal/focus behavior.

- Keep current actions, order, capability/busy checks and target server/session intact.
- Suppress browser context menu and row navigation for right-click only; ordinary row activation still works.
- Do not modify existing tests, shared account settings, installed clients or daemons.
- Cover selected/unselected and restricted rows; preserve native touch long-press.
- Use the current validated source stack for live Mac QA; no separate release artifact.

## Task OH-15

**Files:** production `apps/ui/sources/components/sessions/shell/SessionItem.tsx`; new focused `SessionItem.rightClick.test.tsx` in the same folder. Reuse `sessionShellTestHelpers` and canonical `@/dev/testkit` boundaries.

- [x] 🟢 Added the interaction regression: unselected row opens its existing dropdown, prevents default/propagation, does not navigate, and Rename targets the row/server. Meaningful RED observed before production edits; minimal GREEN checkpoint `823c59ce7d` pushed.
- [x] 🟢 Three new cases cover restricted selected/shared row parity, normal activation after dismissal, and native mobile long-press without a desktop handler. Only the new test file was edited; final tested checkpoint `0ed0585e79` pushed.
- [x] 🟢 Production change reuses existing dropdown state/actions with a web-only context-menu handler; no menu, DOM lookup, persistence or policy owner added.
- [x] 🟢 Four relevant files pass (23 tests), plus UI typecheck. The first typecheck exposed nullable test lookups, corrected in the new test only before the successful rerun. Original root-suite failures remain separately tracked.
- [x] 🟢 Native app full page reload with Fast Refresh disabled: unselected right-click preserves the other selected route; same ten action IDs/labels/order as three-dot before/after reload; Escape removes the menu; Rename updates only the clicked scratch row, then restores through three-dot. Ordinary click selects the row and selected-row right-click works. Private screenshot `/tmp/happier-oh15-right-click.jpg` inspected, not published. Shared/restricted state is covered in the real canonical availability path in host tests; no suitable hosted view-only scratch session was available for live QA.
- [x] 🟢 Independent review found no material introduced defect at `0ed0585e79` and independently passed the same 23 tests (`/tmp/happier-oh15-review-tests.log`). Existing handled clipboard warning is unchanged. Restricted-row host coverage is sufficient for this shared-owner development boundary; exact keyboard-origin focus return remains unobserved. Native mouse right-click acceptance is complete.

## Current state

OH-15 implementation, native QA and independent review are complete. The setup branch is already based on fork `dev` and contains the validated Metro/process fixes. Continue on this existing feature branch to keep the live source stack coherent. Fetched parent `dev` remains `e7c3bd5584`; HEAD comparison reports 32 parent commits absent from this branch. The pending parent batch remains unmerged while its compatibility checks are open.

## Next: OH-16 hover Archive

**Goal:** Add an Archive icon alongside existing hover actions, retaining their functionality and canonical archive semantics.

**Approach:** Consume `SessionActionTarget.canArchive`, current mutating/archiving state and `handleMoreMenuSelect(SESSION_ACTION_ARCHIVE_ID)`. Use canonical themed archive icon, localized label and tooltip primitive. Keep existing confirmation preferences and stop/archive safeguards; OH-18 separately requires a confirmation for its keyboard shortcut.

- [x] 🟢 New `SessionItem.hoverArchive.test.tsx` observed meaningful RED, then 3/3 GREEN for eligible/restricted/archived, active stop safeguard, inactive server targeting and focus/busy behavior. Existing tests unchanged.
- [x] 🟢 Pushed `e4fa63e1d6`: Archive uses canonical availability, mutation state, action handler and PressableSurface tooltip/focus owner; row focus exposes controls and blur preserves child focus. Other controls remain.
- [x] 🟢 Six relevant files / 41 tests and UI typecheck pass. Logs `/tmp/happier-oh16-{red,focused-green,adjacent-tests,typecheck}.log`. Independent review reran 3/3 (`/tmp/happier-oh16-independent-tests.log`) and found no introduced source defect.
- [ ] 🟡 Full-reload native QA: active/inactive scratch sessions, stop/confirmation safeguard, correct target/no navigation, pointer tooltip and keyboard reachability. Restricted/shared path uses deterministic owner tests when no safe hosted test fixture exists; report the live coverage limit.
- [ ] 🟡 Independent review, documented results, Linear readback and commit/push. No daily-use release claim.

Native result remains partial: full reload/HMR opt-out confirmed; Archive and its tooltip render, and Cancel on the active QA1 stop confirmation leaves it active/unarchived. Confirming the action then displays **Failed to archive session**; live CLI readback remains active/unarchived. The earlier QA PID is absent and old daemon logs have no corresponding stop entry, so runtime/response tracing is required before assigning cause or changing source. Do not force archive or replace the daily CLI/daemon. Keyboard commands cannot prove focus while `document.hasFocus()` and native window focus are false; user assistance was requested. OH-16 stays open. Josh subsequently prioritized the machine sidebar work in OH-14/OH-19, documented in phase 3.
