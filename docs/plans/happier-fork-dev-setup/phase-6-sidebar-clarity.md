# Sidebar clarity and remaining machine appearance

Continue the authorized macOS source work on the existing branch, with each change owned by its OH issue. Native hotkey QA is explicitly deferred. Preserve existing clients, hosted account settings, sidebar actions and unrelated work. Use canonical owners and meaningful RED/GREEN for behavior fixes; no separate approval for fixtures or tests.

## OH-46: Folder order

Inspect the actual menu, ordering rules and visible index. Establish what Folders first and Mixed with sessions do in Custom order and date modes, whether choices persist, and how users can discover the dependency and change a mixed order. Existing menu copy already mentions the date-mode lock; do not assume it is missing or redesign ordering without evidence.

- [ ] 🟡 Read the menu, ordering owner, persistence and current tests; identify deciding user-visible cases.
- [ ] 🔴 Reproduce any no-op, misleading selection/disabled feedback or ordering/persistence defect. Correct the smallest coherent owner with meaningful coverage, preserving machine view and custom order.
- [ ] 🟡 Update existing discoverability/documentation where evidence requires it, run focused/adjacent checks and typecheck, independent review, commit and push.
- [ ] 🟡 Native representative folder/session ordering and restart acceptance remains a distinct gate; do not interrupt the user's active app.

## OH-47: Remaining icon color acceptance

Latest Linear acceptance includes a chosen icon color for recognizing machines without text labels. Icon shape and label work alone does not satisfy this requirement. Final canonical Inbox/approval identity corrections currently run on Astra/high; finish that bounded delta before layering appearance state.

- [ ] 🔴 Reuse the existing local server+machine preference owner and shared glyph. Choose a bounded theme-aware color palette with sensible automatic default, persist/reset and retain readable selected/hovered states. Avoid arbitrary unvalidated color strings or a second identity owner.
- [ ] 🔴 Cover real local persistence, server/machine isolation, reset and shared glyph rendering; preserve leaf subscription scope and existing labels/tooltips.
- [ ] 🟡 Discoverable machine-detail color control, independent review, relevant suites/typecheck and native multi-machine/restart acceptance.

## Remaining backlog coverage

The refreshed project inventory also includes OH-53 (icon-only Build/Planning), OH-54 (right-side agent/machine layout and optional labels), OH-55 (stable/dev names and icons), OH-56 (Command+K title/content search), OH-57 (session status colors/badges), and OH-58 (ticket links/status). These are not implemented by the earlier sidebar batch. OH-14 broader grouping/order and OH-45/49/50/52 remain open too. Read each full current issue before its source work; no inferred completion from neighboring changes.

Routing: OH-46 classified Sol/high, attempt counters 0/0/0. OH-17 and OH-18 assessment accurately included native acceptance as missing/user-deferred; the advisory stronger-lane result does not authorize interfering with the app or turn a deferred check into a product defect.
