# iOS Testing Strategy — Options Analysis

**Date:** 2026-05-09
**Status:** unresolved — pick an approach before App Store submission
**Context:** Founder is on Windows 11 and doesn't own an iPhone. The mobile app (React Native / Expo) targets both Android and iOS. Android dogfooding is straightforward (founder's own device); iOS needs an explicit tooling decision.

---

## What we actually need to validate on iOS

Most of the app is React Native, so it works the same on both platforms. The risks specific to iOS:

| Risk | Where it shows up |
|---|---|
| **Safe-area insets** (notch, dynamic island, home indicator) | Every screen that uses absolute positioning, especially welcome carousel and map header |
| **Modal `presentationStyle`** | Welcome carousel, soft sign-up sheet, all bottom sheets |
| **Push-notification certs + permissions** | Premium-alerts loop (price-rise + expiry warnings) — needs APNs cert wired correctly |
| **Camera + photo library permissions** | The contribution flow; camera and library prompts have different UX on iOS vs Android |
| **Location permissions** | Map screen — iOS permission dialog text + "Allow Once" semantic differ |
| **Status bar styling** | Per-screen `<StatusBar>` config; iOS doesn't have a backgroundColor concept |
| **Haptic feedback** | If used (capture button, etc.) — iOS Haptic engine quality differs from Android vibrator |
| **Dark mode handling** | iOS users flip dark mode at OS level; need to verify the app reads system colour-scheme correctly |
| **Apple Sign In** | Already implemented, but never tested end-to-end on a real iPhone |
| **App Store review rejection risks** | Privacy strings in `Info.plist`, third-party SDK disclosure, in-app purchase handling (none in our case) |

---

## Options

### Option A — Borrowed iPhone (cheapest, lowest reach)

**What:** ask a friend or family member to install the app via Expo Go (dev) or a TestFlight invite (release builds), and test the app for you.

**Cost:** €0
**Coverage:** spot-checks; depends on tester's diligence and the iOS version of their device
**Limitations:** no real-time iteration during dev, no ability to reproduce edge cases on demand, hard to debug from the other side of a phone call
**When this is enough:** never on its own — but useful as a reality check on top of one of the paid options below

### Option B — Cloud iOS device farm (BrowserStack App Live, Sauce Labs, AWS Device Farm, LambdaTest)

**What:** rent real iOS devices remotely. Upload an Expo .ipa build (or load Expo Go), interact with the device through the browser. Multiple iOS versions / device models available on demand.

**Cost (representative as of 2026):**
- BrowserStack App Live — ~€30/mo, can pause subscription
- Sauce Labs Real Device Cloud — ~€50/mo
- AWS Device Farm — pay-per-minute, ~€0.20/min, suits low usage
- LambdaTest App Live — ~€20/mo

**Coverage:** real iPhones, multiple iOS versions, usable for visual smoke tests and reproducing reported bugs
**Limitations:** push notifications may not fire reliably (the device is a shared rental), no SIM-card-bound features (calls / SMS), keyboard interactions can lag, latency makes camera flow awkward to test
**When this fits:** ~weekly pre-release validation pass; debugging specific iOS-only bugs reported by testers; verifying screenshots for App Store listing

### Option C — Cloud Mac + iOS Simulator (MacInCloud, MacStadium, AWS EC2 Mac)

**What:** rent a remote macOS machine. Run Xcode, attach the iOS Simulator, run the app from Expo on the simulator. Full developer-tooling environment for iOS dev.

**Cost:**
- MacInCloud Pay-As-You-Go — ~€1/hr, no commitment
- MacStadium — ~€80/mo for a dedicated Mac Mini
- AWS EC2 Mac — billed per 24h ($1.083 /hr min, ~€26/day)

**Coverage:** full Xcode access, can run the iOS Simulator (a virtual iPhone — close to real but not identical), debug push notifications via Apple's tooling, build and submit to App Store directly
**Limitations:** Simulator ≠ real device for haptics, push notifications (need a real device with an APNs token), camera (synthetic), GPS (mocked); also Mac rentals are not cheap if used continuously
**When this fits:** when you need full developer tooling — Xcode-driven debugging, App Store submission via Transporter, profiling. Pair with Option B for real-device validation.

### Option D — TestFlight + external testers (production path, requires Apple Developer)

**What:** once Apple Developer enrolled (~€99/year), use EAS Build to produce iOS .ipa, push to TestFlight via EAS Submit, invite testers (up to 10,000 via public link). Real iPhones, real users, real network conditions.

**Cost:** €99/year + already-paying EAS / Expo subscription
**Coverage:** real-world iOS validation across many device models + iOS versions; users report bugs back via TestFlight
**Limitations:** requires Apple Developer enrollment (deferred per `project_deferred.md`); turnaround on a TestFlight build is slow (~30 min Apple review for first build, then near-instant); no real-time debugging — feedback loop is "build → upload → wait → ask tester to repro"
**When this fits:** the production validation path. Useful from the moment Apple Developer is enrolled. Works hand-in-hand with B or C — A/B for engineering iteration, D for real-world validation.

### Option E — Hire an iOS QA tester for a one-off pass

**What:** post a job on Upwork / Fiverr / similar, hire someone with an iPhone to test the launch build, screen-record, and report bugs against a checklist you provide.

**Cost:** ~€20-50 per session
**Coverage:** real iPhone, real human, follows your test plan
**Limitations:** one-shot — doesn't replace ongoing iteration; quality varies wildly; turnaround ~24-48h
**When this fits:** pre-launch sanity check just before App Store submission. Also useful when a major release lands and no one in your circle owns an iPhone.

---

## Recommended mix

For a solo / small-team launch:

| Phase | What to use | Why |
|---|---|---|
| **Pre-Apple-Developer** (now) | Borrowed iPhone (A) for the rare hands-on check | Cheap, no commitment until enrollment is done |
| **Once Apple Developer enrolled** | Cloud Mac for occasional Xcode work (C) + TestFlight for iteration (D) | Pay-as-you-go cloud Mac avoids the €99/mo commitment of MacStadium; TestFlight gives real iOS validation |
| **For ongoing pre-release smoke tests** | BrowserStack App Live (B) at ~€30/mo, pausable | Cheap month-to-month; multiple iOS versions for regression checks |
| **Right before App Store submission** | Hire an iOS QA tester for a one-off pass (E) | €20-50 buys a real human running through a launch checklist on a real iPhone — cheap insurance |

**Don't try to cover every option.** Pick A + (B or C) + D as your default; add E for the launch milestone.

---

## What needs to happen first

1. **Apple Developer enrollment** — currently deferred per `project_deferred.md`. Without it, no TestFlight, no .ipa builds, no App Store. €99/year. Ideally enroll the company entity (DUNS number required) rather than personal — but personal is faster if speed wins.
2. **APNs certificate** for push notifications — generated through Apple Developer console; EAS Build pulls it during iOS builds. Premium-alerts loop won't work on iOS without this.
3. **`Info.plist` privacy strings** — every iOS permission (camera, photo library, location, notifications) needs a human-readable purpose string. Expo `app.json` handles most of these but worth auditing before submission.
4. **iOS-specific UX audit** of welcome carousel, map header, modals, FABs — once we can run the app on iOS, walk every screen and note safe-area / status-bar issues.

---

## Decision log (to fill in as we make choices)

| Date | Decision | Rationale |
|---|---|---|
| _pending_ | Pick option B vs C as primary pre-launch validation | _to decide once Apple Developer is enrolled_ |
| _pending_ | Apple Developer enrollment — personal vs company | _company preferred long-term; personal acceptable for first launch (per memory `project_accounts.md` we're already on personal accounts everywhere)_ |

---

## Related items

- [`project_ios_testing.md`](../../.claude/projects/c--Users-Mateusz-projects-desert/memory/project_ios_testing.md) — memory pointer for future sessions
- [`project_deferred.md`](../../.claude/projects/c--Users-Mateusz-projects-desert/memory/project_deferred.md) — Apple Developer enrollment + Railway `APPLE_APP_BUNDLE_ID` deferral
- [`project_accounts.md`](../../.claude/projects/c--Users-Mateusz-projects-desert/memory/project_accounts.md) — all infra is on personal accounts; affects which Apple Developer entity to enroll
