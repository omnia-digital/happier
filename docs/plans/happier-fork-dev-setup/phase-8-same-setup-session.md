# OH-45: Start a fresh session from a sidebar row

Add the requested plus action and identical three-dot/right-click menu action through the existing row action owner. Capture the clicked row, even when another session is selected. Open the existing editable New Session flow; creating a session still requires its normal confirmation. Cancel must not mutate the source.

## Canonical owners and decisions

Session Info already implements Same Setup at `app/(app)/session/[id]/info.tsx` through `buildNewSessionTempDataFromSessionConfiguration`, `deriveSessionAuthoringSnapshot`, the one-shot tempData/dataId channel and `buildNewSessionLaunchRouteParams`. Extract/reuse that seed/navigation decision for both entry points rather than maintaining another settings-copy policy. Do not reuse `buildNewSessionSourceContextNavigation` unchanged: it attaches a replay recipe, which this blank-session action must not do.

Sidebar renderable metadata is intentionally thin. Resolve full source metadata only on the user's action through the existing exact-server hydration owner, `sync.ensureSessionVisibleForMessageRoute`. Capture the row/session/server authority and verify the authoritative result before seeding. Trace and correct its activated explicit-server fast path at the canonical owner if it can return an active-Home record for the wrong server. Do not add per-row requests, another hydration transport or silent defaults from an unrelated session. Account/server changes across the await must not change the source or launch authority.

Preserve the existing seed's available agent/backend/profile/model/permission/MCP/connected-service/terminal/mode/config choices and resolved machine/directory/worktree context. Its intentionally blank prompt, absent replay/resume/automation, unavailable environment overrides and omitted Windows launch choices retain their current New Session semantics; document the exact available/unsupported field disposition from source. Do not invent values the old session did not retain. The user can review/edit the resulting draft.

Use current readable-source and canonical spawn-target availability for shared/restricted rows. Do not mutate a source merely to create a separate session, or silently substitute another machine when the intended target is unavailable. Keep existing Archive, status, selection, agent/machine identity, hover actions and narrow layout intact. Expose one handler/action identity to the row plus and canonical menu so OH-50 can later attach a shortcut without another path.

## Tasks and acceptance

- [x] 🟢 Read full OH-45 and trace existing Same Setup seed, row menu extension and route hydration owners. Discovery is recorded in Linear. First coherent source checkpoint `80db658d1a` fixes the canonical hydration fast path: a fully hydrated active-Home record with the same ID cannot bypass explicit foreign-server hydration. The deciding test failed before the correction; all 24 hydration tests now pass (`/tmp/happier-oh45-hydration-green.log`). Remaining row/seed/action work continues.
- [ ] 🔴 Reproduce clicked-versus-selected thin-row hydration and explicit foreign-server collision behavior through current owners. Add deciding blank-draft/config/context/cancel/restricted availability tests before production changes.
- [ ] 🟡 Implement the complete seed/navigation/action corridor, preserving source settings and all existing row controls. Checkpoint and push coherent steps before long tests.
- [ ] 🟡 Run focused/adjacent source checks, current UI typecheck, independent review and existing isolated Chrome flow where runnable. Use the canonical test framework; no hosted credentials or active native app automation.
- [ ] 🟡 Native macOS plus/menu/right-click and cancellation acceptance remains pending. Only native hotkey QA is explicitly deferred. Do not mark OH-45 Done from source or browser checks alone.

Root owns execution docs and Linear. The existing selected Sol/high lane handles implementation after classification; preserve cumulative counters (initially zero). Other agents retain OH-14 and OH-12 work. Serialize only actual staging/commit/push collisions, not unrelated source edits.
