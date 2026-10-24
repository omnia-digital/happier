# OH-4: Browser build fidelity and failure evidence

## Scope and observed basis

Keep isolated browser verification accurate and reusable through the existing test harness. This supports the original development-process goal and current OH-52/OH-59/OH-60 gates; it does not authorize changes to the daily app or services.

- `uiWebExport.ts` fingerprints UI app/source/assets/config inputs, including tests, but omits internal workspace inputs. Metro explicitly resolves `@happier-dev/*` exports to workspace sources in `metro.config.js`. A workspace-only change can therefore leave a persisted browser export reusable. Reproduce this with disposable fixtures before correcting the canonical fingerprint.
- Test-only UI edits currently invalidate that fingerprint although those modules are not normal runtime inputs. Establish the relevant exclusion with actual import/source evidence; keep real app, configuration, asset and workspace changes observable.
- `uiWeb.ts` catches the original export failure and falls back to Metro. If both fail, only the Metro error survives. OH-59's targeted GPU run failed in setup after 836 seconds; its logs do not establish the original export exception. Preserve both causes without removing fallback or changing timeouts.
- OH-52's separate diagnostic trace-on runs complete metadata assertions/body and fixture-stop receipts, then fail a 30-second Playwright teardown. The incomplete trace ZIP suggests trace finalization; the worker is testing that hypothesis separately. Do not attribute it to export caching or app behavior without deciding evidence.

## Design constraints

- Extend the existing fingerprint/cache, workspace-resolution and failure owners. No parallel server, build cache, process manager or browser harness.
- Discover existing workspace metadata/resolution helpers before inventing a dependency registry. Track actual runtime inputs conservatively and deterministically; avoid rebuilding for unrelated test/output changes. Include meaningful dependency/configuration changes required for bundle fidelity.
- Preserve named namespaces, cache manifests, ownership leases, finite budgets, configured export/Metro selection and old reports. Invalidate obsolete fingerprints through the existing version convention.
- Tests use disposable roots and owned fixture processes. Do not touch live source mtimes to demonstrate invalidation, edit node_modules, delete artifacts, restart services or change shared accounts.
- Source-inspected omissions are not proof that an accepted earlier run loaded stale code. Audit only affected evidence; do not discard unrelated valid gates.

## Tasks and deciding validation

- [ ] 🔴 Reproduce workspace-input omission and test-only invalidation in the canonical fingerprint with isolated fixture roots; trace actual Metro source inputs and package configuration.
- [ ] 🔴 Correct the existing fingerprint with narrow canonical ownership, and test unchanged reuse, runtime source/config/dependency invalidation, test/output stability and absent-input handling.
- [ ] 🔴 Preserve export plus Metro failure evidence; test export success, fallback success, both failures and fallback-disabled behavior without running a full app build for each.
- [ ] 🔴 Relevant tests/types, independent source review and one justified affected browser replay. Existing GPU/native/additional-host gaps stay explicit until actually exercised.

Routing recommends Sol/high for the future bounded worker, zero failed review cycles. Dispatch follows the current PR-link source/QA handoff; root owns Linear, tasks and integration verification.
