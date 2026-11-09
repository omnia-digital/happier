# iOS nightly: TestFlight and OTA

Josh, 2026-11-09: "Set up iOS nightly via TestFlight + OTA; I'll create the Apple and Expo
accounts." Owned by OH-8. Builds on the desktop nightly in
[nightly-omnia-release-auto-install](../nightly-omnia-release-auto-install/plan.md).

## Goal

On each night the desktop nightly releases a commit, publish an Expo OTA update to the
installed Omnia iOS app. Only when native code changed, also build and submit a TestFlight
build, which installs through the TestFlight app.

## Findings (origin/dev 5db19cc03d)

- Upstream already has this in `.github/workflows/publish-ui-mobile-dev.yml`: a
  credential-free OTA prepare, an OTA publish, and iOS build plus TestFlight submit. Its
  nightly is gated off on the fork.
- OTA compatibility is a runtime-version pin. Only the `publicdev` variant uses a
  fingerprint runtime; every other variant uses a fixed `0.2.9-native`.
- The pipeline pins its own "canonical" fingerprint into OTAs and **local** builds only.
  EAS **cloud** builds carry Expo's raw fingerprint, so OTAs would never apply to them and
  the native-change check would rebuild every night.
- `eas_local` already runs on hosted `macos-26`, free for this public repo. Cassian is not
  needed. Local mode has no native-change check, so it would rebuild and submit nightly.
- `release_actor_guard` rejects `andorcassian`, which is the fork's usual actor.
- Expo identity, the `publicdev` bundle ID and all `eas.json` submit profiles are
  upstream's and must be replaced in checked-in files. Environment-only overrides change
  the fingerprint and would split OTA and binary hashes.
- The app needs one App ID with Push Notifications. No extensions, app groups or custom
  keychain groups. Associated Domains are off for `publicdev`.
- The fork has no `release-shared` environment yet (only `copilot`).

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Variant | Keep `APP_ENV=publicdev`, replace its identity in place | Only it uses the fingerprint runtime; a new variant would fall back to a fixed runtime and an OTA could crash a binary missing a native module |
| Builder | `eas_local` on hosted `macos-26` | Matches the OTA's canonical fingerprint; no EAS build quota |
| Native-change check | Compare the canonical fingerprint with the last nightly's, build only when it differs | Local mode has none; without it every night uploads a TestFlight build |
| Secrets | Explicit `secrets:` map with `EXPO_TOKEN` and `APPLE_API_PRIVATE_KEY`, as `release-shared` environment secrets limited to `dev` | The fork forwards no secrets implicitly to reusable workflows |
| Actor guard | Decide with Josh during implementation | The desktop avoided it by publishing with `GITHUB_TOKEN` |
| URL scheme | A fork-specific `happier-…` scheme | Two apps declaring `happier://` collide; the app accepts any `happier*` scheme |
| Failure signal | Surface iOS failures in the nightly | Upstream marks iOS jobs `continue-on-error` |

## Blocked on Josh

The account checklist in [tasks.md](tasks.md). Nothing can be signed, published or
submitted until it is done.

## Open risks

- The hosted server's OAuth return list and mTLS default may only allow `happier://`, so
  return-to-app flows may reject the fork scheme. Unverified.
- Push from the hosted server works only if enhanced push security stays off on the Omnia
  Expo project. Unverified.
- Whether an Expo robot with the Developer role can submit is unverified.
