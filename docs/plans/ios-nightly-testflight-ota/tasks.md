# Tasks

## Josh: accounts (checked against Apple and Expo docs on 2026-11-09)

| # | Task | Status |
| --- | --- | --- |
| A1 | Choose the bundle ID before registering anything (App IDs cannot be renamed) | 🔴 |
| A2 | Apple Developer Program, Organization if Omnia Digital is a legal entity (needs D-U-N-S); note the Team ID | 🔴 |
| A3 | Register the explicit App ID with Push Notifications on; leave Associated Domains off | 🔴 |
| A4 | App Store Connect app record for that bundle ID; note its numeric Apple ID | 🔴 |
| A5 | App Store Connect API Team key with the Admin role; keep the `.p8`, Key ID and Issuer ID | 🔴 |
| A6 | TestFlight internal group with Josh and automatic distribution; install TestFlight on the iPhone | 🔴 |
| A7 | Expo organization, the project, and a robot user with an access token | 🔴 |
| A8 | Hand back the IDs, the token and the `.p8` securely (not in Git or chat) | 🔴 |

## Engineering

| # | Task | Status |
| --- | --- | --- |
| E1 | Replace upstream identity in `appProjectConfig.cjs`, the `publicdev` variant and `eas.json` | 🔴 Needs A1–A7 |
| E2 | Fork URL scheme and check return-to-app flows | 🔴 |
| E3 | Native-change check for local builds against the last nightly's fingerprint | 🔴 |
| E4 | `ios_nightly` job in `omnia-production.yml` with explicit secrets | 🔴 |
| E5 | Actor guard decision and change | 🔴 |
| E6 | Visible failure signal for the iOS lane | 🔴 |
| E7 | `eas credentials -p ios` once with Josh (certificate, profile, APNs key, ASC key) | 🔴 Needs Josh |
| E8 | First run: TestFlight build on the iPhone, then an OTA that applies to it | 🔴 |
| E9 | Docs: `docs/fork-development.md` iOS section and `docs/fork-production.md` | 🔴 |
