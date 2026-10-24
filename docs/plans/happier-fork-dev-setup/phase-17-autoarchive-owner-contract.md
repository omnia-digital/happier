# OH-52: Preserve existing owner controls during autoarchive

## Reopened source boundary

The source2 boundary through `5705bd9957` is reopened. Mapping authenticated v2 `share:null` to global `accessLevel:admin` makes the new observer eligible, but violates the UI's existing owner convention: absent access level means owner, while a role describes a share. Actual session info then hides PR editing, fork and handoff, drops owner identity in action contexts, and changes permission delegation. The passing producer/transport checks did not cover those consumers. Do not patch only one button or relax shared-session permissions.

## Required correction and proof

- [ ] 🔴 Reproduce the actual owned snapshot/by-id producer to owner action/PR editing consumer regression. Include known shared view/edit/admin and missing legacy role cases.
- [ ] 🔴 Preserve the canonical owner/access contract across actual list and route hydration. Derive autoarchive permission from scoped authenticated evidence without turning ordinary owner records into shared-admin records or inventing ownership for unknown data.
- [ ] 🔴 Preserve existing foreground, work, qualified provider, metadata, account lifetime and dispatch guards. Audit affected consumers, then run meaningful focused owner/autoarchive/compatibility checks and UI types.
- [ ] 🔴 Independent root review and isolated composed Chrome remain required after the source correction. No daily app, provider/account preference, native installation or resource deletion.

Router assessment ESCALATE selects actual Astra/high after the second failed Sol source2 boundary. Retain OH-52 cumulative2failedSol/0Astra; preserve the Astra lane. The previous bounded acceptance report is historical evidence, not current acceptance. The earlier Chrome attempt failed fixture Corepack setup before authentication/provider/archive and remains separate from this product regression.

Root owns Linear, tasks and phase9. The correction worker owns this phase and exact coordinated source/test paths. The prior author pauses overlapping source while retaining its isolated Chrome fixture. Feature-branch exact checkpoints must be committed and pushed without changing other workers' work.
