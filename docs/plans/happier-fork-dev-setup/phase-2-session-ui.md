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

- [ ] 🔴 Add an interaction regression: unselected row context-menu event opens its existing dropdown, prevents native default/propagation, does not navigate, and a representative action still targets that row/server.
- [ ] 🔴 Cover parity with the three-dot entry point, keyboard dismissal/ordinary activation, restricted actions, and unchanged native mobile handling. Run the new slice and verify meaningful RED before production edits.
- [ ] 🟡 Add the minimal web context-menu handler at the row boundary; reuse the existing dropdown state and actions. Avoid a separate menu, DOM lookup, state owner or persistence.
- [ ] 🟡 Run the new regression and adjacent row/action-menu tests; run UI typecheck at the integrated boundary. Preserve and report unrelated baseline failures.
- [ ] 🟡 Reload the actual native dev app from current Metro source. In scratch rows, verify right-click/three-dot parity, no navigation, Escape, and a representative reversible action on the intended session. Never exercise actions on unrelated work sessions.
- [ ] 🟡 Independently review the integrated change and deciding QA evidence. Update OH-15 from actual results and commit/push each completed step with context.

## Current state

Planning/discovery complete; implementation not started. The setup branch is already based on fork `dev` and contains the validated Metro/process fixes. Continue on this existing feature branch to keep the live source stack coherent. Fetched parent `dev` remains `e7c3bd5584`; HEAD comparison reports 32 parent commits absent from this branch. The pending parent batch remains unmerged while its compatibility checks are open.
