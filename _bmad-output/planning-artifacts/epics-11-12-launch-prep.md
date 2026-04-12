---
# Epics 11–14 — Legal, Launch, and Business Scaling
# Appended separately due to file size; part of the same epic breakdown as epics.md
---

## Epic 11: Legal & Compliance

Privacy policy and terms of service are published at stable public URLs, in-app consent checkboxes are wired into the signup flow, and data processing agreements with all hosting providers are activated. A hard prerequisite for App Store submission and for collecting any user data.

---

### Story 11.1: Privacy Policy

As an **operator**,
I want a GDPR-compliant privacy policy published at a stable public URL,
So that we satisfy GDPR Art. 13, Apple App Store requirements, Google Play requirements, and Polish law before any user data is collected.

**Why:** Without a published privacy policy we cannot submit to either app store — it is a hard technical rejection criterion. GDPR Art. 13 applies from the moment the first user registers; UODO specifically audited mobile app developers in 2024.

**Acceptance Criteria:**

**Given** the policy is being drafted
**When** the content is written
**Then** it covers:
- Identity and contact of the data controller (company name, address, email)
- All data categories collected (email, password hash, GPS, photos, push token, device metadata)
- Purpose and legal basis for each category (contract / consent / legitimate interest)
- Retention periods per data type
- All third-party processors named: Neon, Cloudflare R2, Vercel, Railway, Anthropic, Mapbox, Expo / FCM / APNs
- EU→US transfer safeguard for US processors (Anthropic SCCs / EU-US DPF)
- All GDPR user rights: access (Art. 15), rectification (Art. 16), erasure (Art. 17), restriction (Art. 18), portability (Art. 20), objection (Art. 21), consent withdrawal, UODO complaint right
- Photo processing note: incidental faces/licence plates processed solely for OCR price extraction, raw photos not retained after extraction
- Statement that the service is not directed at children under 16
- One-liner on the locale preference cookie (name, purpose, 1-year expiry) — no separate cookie page required

**Given** the policy is written
**When** it is reviewed
**Then** it has been reviewed by a qualified Polish lawyer with GDPR experience before publication

**Given** the policy is approved
**When** it is published
**Then** it is accessible at stable public URLs (e.g. `litro.pl/polityka-prywatnosci` / `litro.pl/en/privacy`)
**And** it is linked from the mobile app Settings screen
**And** it is linked from the web app footer
**And** the URL is entered in Apple App Store Connect and Google Play Console

---

### Story 11.2: Terms of Service

As an **operator**,
I want a terms of service document published at a stable public URL,
So that we comply with Ustawa o swiadczeniu uslug droga elektroniczna Art. 8 and Ustawa o prawach konsumenta Art. 12.

**Why:** Polish law requires a regulamin to be published before users begin using an electronic service — without it the user contract is legally incomplete. Omitting mandatory consumer pre-contractual disclosures extends the withdrawal right from 14 days to 12 months.

**Acceptance Criteria:**

**Given** the terms are being drafted
**When** the content is written
**Then** it covers:
- Full legal identity of the operator (Mateusz Mikina, personal address, contact email — no NIP/KRS required for an individual operating a free app; add NIP when JDG is registered)
- Scope of services offered
- Technical requirements (minimum OS version, permissions required)
- Prohibition on fraudulent or unlawful content submissions
- Account creation and termination procedure
- Complaint procedure with 14-day response commitment
- Right of withdrawal disclosure and statutory withdrawal form reference
- Withdrawal waiver clause for immediate-execution digital services (with explicit user acknowledgement at signup — see Story 11.3)
- Licence grant from users for submitted photos and price data (non-exclusive, royalty-free, worldwide licence to store, display, and distribute within the service)
- Account suspension and termination rules
- Limitation of liability (to the extent permitted by Polish consumer law)
- Governing law (Polish) and jurisdiction (Polish courts)
- Regulamin change procedure: 14-day advance notice before changes take effect; users who do not accept may terminate
- ODR platform reference (ec.europa.eu/consumers/odr) for EU consumers

**Given** the terms are written
**When** they are reviewed
**Then** they have been reviewed by a qualified Polish lawyer before publication

**Given** the terms are approved
**When** they are published
**Then** they are accessible at `litro.pl/regulamin` (PL) and `litro.pl/en/terms` (EN)
**And** they are linked from the mobile app Settings screen and the web app footer

---

### Story 11.3: In-App Consent at Signup

As a **driver**,
I want to explicitly accept the terms and privacy policy when I create an account,
So that my consent is recorded and the operator satisfies both Polish consumer law and GDPR requirements.

**Why:** GDPR requires freely given, specific, informed, and unambiguous consent. Polish consumer law requires pre-contractual disclosure and explicit withdrawal waiver acknowledgement before the service starts. Currently the signup flow has neither — this is a legal gap that must be closed before any public user registers.

**Acceptance Criteria:**

**Given** a user reaches the registration screen
**When** the form is displayed
**Then** two mandatory checkboxes appear before the submit button:
  1. "Akceptuje Regulamin i Polityke prywatnosci" (with linked terms) — required to submit
  2. "Wyrazam zgode na natychmiastowe rozpoczecie swiadczenia uslugi i przyjmuje do wiadomosci, ze trace prawo do odstapienia od umowy" — required to submit

**Given** both checkboxes are checked and the form is submitted
**When** the user record is created
**Then** the timestamp of consent and the semantic version of the accepted documents (e.g. "terms-v1.0, privacy-v1.0") are stored with the user record

**Given** the terms or privacy policy are updated to a new version
**When** a user with an older accepted version logs in
**Then** they are shown a prompt to re-accept before continuing — consent version is compared to current document version

**Given** a user does not check both required checkboxes
**When** they attempt to submit the registration form
**Then** the form does not submit and the unchecked checkbox(es) are highlighted as required

---

### Story 11.4: Data Processing Agreements with Hosting Providers

As an **operator**,
I want active DPAs in place with every processor that handles personal data,
So that we satisfy GDPR Art. 28 before any user data flows through those processors.

**Why:** GDPR Art. 28 requires a written contract with every data processor. Without DPAs we are in breach from the moment the first user registers.

**Acceptance Criteria:**

**Given** the list of processors
**When** DPA status is verified and activated for each
**Then** the following are confirmed in place:
- **Neon** — DPA activated in Neon console (Settings > Legal)
- **Cloudflare R2** — DPA confirmed active on current Cloudflare plan
- **Vercel** — Data Processing Addendum accepted in Vercel team Settings > Legal
- **Railway** — DPA requested and confirmed via Railway account settings or support
- **Anthropic** — already incorporated via Commercial Terms acceptance (anthropic.com/legal/data-processing-addendum); document the reference, no further action needed
- **Expo / FCM / APNs** — covered by Google and Apple developer agreements; no separate action needed

**Given** all DPAs are confirmed
**When** internal documentation is prepared
**Then** a Record of Processing Activities (ROPA) spreadsheet is created listing: processor, data categories shared, transfer mechanism (SCCs / adequacy decision for US processors), and DPA reference URL — satisfying GDPR Art. 30

---

### Story 11.5: App Store Privacy Declarations

As an **operator**,
I want the Apple Privacy Nutrition Label and Google Data Safety form completed accurately before submission,
So that the app can be submitted to both stores and users can see transparent data disclosures.

**Why:** Both stores block submission until these declarations are complete. They must match the privacy policy exactly — mismatches are a common rejection reason.

**Prerequisites:** Story 11.1 complete.

**Acceptance Criteria:**

**Given** the privacy policy is finalised
**When** the Apple App Store Connect App Privacy section is completed
**Then** data types declared include: Precise Location (required, linked to user, app functionality); Photos (user-submitted, linked to user); Contact Info / Email (required, linked to user); User ID (linked to user); Device ID / Push Token (linked to user, notifications); Crash data (not linked to user, analytics)
**And** "Data Not Used for Tracking" is declared (no cross-app advertising SDKs at launch)

**Given** the privacy policy is finalised
**When** the Google Play Data Safety form is submitted
**Then** all data types match the Apple declarations
**And** "Data can be deleted by users" is checked (account deletion flow — FR18)
**And** "Data is encrypted in transit" is checked (HTTPS throughout)
**And** the form is submitted and shows as approved before the production release is opened

---

## Epic 12: App Store & Go-to-Market Launch Preparation

The app is live on both the Apple App Store and Google Play under Mateusz's personal developer accounts (Individual enrollment — no D-U-N-S, no company required), reachable at a custom domain, with production builds complete and all store listings localised in Polish, English, and Ukrainian. Migration to a business account (Story 12.2) is deferred until JDG or company registration.

---

### Story 12.1: Custom Domain Acquisition and DNS Setup

As an **operator**,
I want the app reachable at a custom domain with working email addresses,
So that we satisfy app store support URL requirements, present a professional brand, and have working addresses for legal correspondence.

**Why:** App stores require a support URL and privacy policy URL on a real domain — not a Vercel deployment URL. Legal documents must be permanently reachable at stable URLs. Contact addresses (privacy@, kontakt@) must work for GDPR compliance.

**Acceptance Criteria:**

**Given** a domain is selected and purchased
**When** DNS is configured via the registrar
**Then** the apex domain points to Vercel via A record `76.76.21.21`
**And** `www` points to Vercel via CNAME `cname.vercel-dns.com`
**And** Vercel automatically provisions and renews the SSL certificate once DNS propagates
**And** all app subdomains (admin., partner., fleet.) are configured in Vercel and DNS

**Given** DNS is live
**When** email forwarding is configured
**Then** `kontakt@litro.pl` and `privacy@litro.pl` forward to the owner's mailbox (e.g. via ImprovMX)
**And** MX records are correct so inbound mail is delivered

**Given** the domain is live
**When** the web app, mobile app settings, and all legal documents are checked
**Then** every public URL uses the custom domain — no references to `*.vercel.app` remain in user-facing surfaces

**Pre-launch DNS note:** Domain `litro.pl` is registered (OVH) and configured in Cloudflare + Vercel, but DNS records are currently **removed** to keep the site hidden until launch. Before going public, re-add in Cloudflare DNS:
- A record: `@` → `76.76.21.21` (DNS only, no proxy)
- CNAME: `www` → `cname.vercel-dns.com` (DNS only, no proxy)

---

### Story 12.2: Account Migration to JDG / Company *(Deferred — trigger: JDG registration)*

As an **operator**,
I want all infrastructure transferred to a business account when the business entity is established,
So that the JDG or company — not a personal account — owns the code, infrastructure, and billing going forward.

**Why:** Launching as an individual is the right call at MVP. When the product takes off and a JDG (or sp. z o.o.) is registered, the infrastructure and store accounts must follow — a personal account closure or billing failure would take down production with no recovery path. This is not a pre-launch blocker; it becomes relevant when formalising the business.

**Trigger:** Execute this story when JDG is registered (first milestone) or sp. z o.o. is formed (second milestone).

**Acceptance Criteria:**

**Given** a business entity (JDG or sp. z o.o.) is registered
**When** account migration is executed
**Then** the following are transferred from personal to business accounts:
- **GitHub** — organisation created; repository transferred; CI/CD deploy tokens updated
- **Vercel** — team created under business account; all projects transferred; custom domain re-verified
- **Railway** — project transferred to business workspace; all env vars confirmed intact
- **Neon** — project transferred to business organisation account; connection strings re-verified
- **Upstash** — team account created; Redis databases transferred
- **Cloudflare R2** — billing confirmed under business account
- **Apple Developer** — re-enroll as Organisation (D-U-N-S required); app transferred to new account
- **Google Play** — transfer app to business developer account

**Given** migration is complete
**When** CI/CD runs a full deployment cycle
**Then** all pipelines complete successfully with no downtime

---

### Story 12.3: Apple Developer Program Enrollment

As an **operator**,
I want an Apple Developer Program individual account enrolled and the App ID configured,
So that we can submit the iOS app to the App Store and enable Sign In with Apple.

**Why:** Apple Developer Program ($99/year) is required for App Store submission and for Sign In with Apple (mandatory when offering any third-party login). Enrolling as an Individual (not Organisation) means no D-U-N-S number is needed — enrollment can be completed same-day. The listing will show "Mateusz Mikina" as the developer name; this can be changed to a company name later when a JDG or sp. z o.o. is registered (Story 12.2).

**Acceptance Criteria:**

**Given** a personal Apple ID exists for the developer
**When** Apple Developer Program enrollment is completed at developer.apple.com/programs/enroll
**Then** enrollment is as an **Individual** (no D-U-N-S required, no business verification, completes same-day)
**And** the $99/year fee is paid

**Given** the developer account is active
**When** the App ID is configured in App Store Connect
**Then** the `com.litro.app` App ID is registered
**And** "Sign In with Apple" capability is enabled on the App ID
**And** the EAS `APPLE_APP_BUNDLE_ID` env var is set in Railway (`com.litro.app`)
**And** a distribution certificate and provisioning profile are generated and stored securely

---

### Story 12.4: Google Play Developer Account Setup

As an **operator**,
I want a Google Play Developer organisation account registered,
So that we can publish the Android app to the Play Store.

**Why:** Google Play requires a one-time $25 registration fee. New developer accounts have a mandatory **2-week waiting period** before publishing to the production track (Google policy as of April 2025 — cannot be expedited). This story must be completed at least 3 weeks before the intended Android launch date.

**Acceptance Criteria:**

**Given** a personal Google account exists for the developer
**When** Play Console registration is completed at play.google.com/console/signup
**Then** registration is as an **Individual** account (personal Google account — no business verification required)
**And** the $25 one-time fee is paid
**And** the 2-week waiting period is noted and factored into the launch calendar — **start this as early as possible, it cannot be expedited**

**Given** the account is verified and the waiting period has elapsed
**When** the app is being prepared for submission
**Then** target Android API level 35 is set via `expo-build-properties` in `app.json` (`targetSdkVersion: 35`)
**And** the Data Safety form (Story 11.5) and IARC content rating questionnaire are complete
**And** the IARC rating result is confirmed as appropriate for all ages (expected: Everyone / PEGI 3)

**Given** the custom domain is live (Story 12.1)
**When** the domain email is set up
**Then** the public developer profile email is updated from `mikinamateusz@gmail.com` to `kontakt@litro.pl` via Play Console > Store presence > Store settings (requires OTP verification)

---

### Story 12.5: Store Listing Assets

As an **operator**,
I want all store listing assets — screenshots, descriptions, and graphics — prepared in Polish, English, and Ukrainian,
So that the app listing is complete and localised on both stores before submission.

**Why:** Both stores require screenshots and metadata before submission. Screenshots showing the real app UI in the local language are the primary conversion driver on the listing page. Metadata must be localised across PL, EN, and UK to reach the full intended audience in Poland.

**Acceptance Criteria:**

**Given** the app UI is stable
**When** screenshots are captured
**Then** for **Apple App Store**:
- iPhone 6.9" screenshots at 1320x2868 px (or 1290x2796 px) — required
- iPad 13" screenshots at 2064x2752 px — required if iPad is supported
- 2-10 screenshots per locale, portrait orientation
- Three locale sets: PL, EN, UK — each showing the app UI in that language

**Then** for **Google Play**:
- Phone screenshots at 1080x1920 px portrait, minimum 2 per locale, maximum 8
- Feature graphic at 1024x500 px — mandatory for all Play Store listings
- High-res icon at 512x512 px PNG

**Given** screenshots are ready
**When** metadata is written per locale
**Then** for **Apple App Store** (per locale, 3 locales):
- App Name: 30 chars max (e.g. "Litro – Ceny paliw" / "Litro – Fuel Prices")
- Subtitle: 30 chars max
- Keywords: 100 chars total, comma-separated
- Promotional Text: 170 chars max (can be updated without a new build submission)
- Description: 4,000 chars max

**Then** for **Google Play** (per locale, 3 locales):
- Title: 30 chars max
- Short Description: 80 chars max (appears in search results)
- Full Description: 4,000 chars max (keywords embedded naturally — no separate keyword field)

---

### Story 12.6: iOS Production Build and App Store Submission

As an **operator**,
I want the iOS app submitted to the Apple App Store and approved for public download,
So that iPhone users in Poland can find and install Litro.

**Why:** The App Store is the only distribution channel for consumer iOS apps. First submissions often receive one rejection round; building in buffer time prevents launch delays.

**Prerequisites:** Stories 11.1, 11.2, 11.3, 12.1, 12.3, 12.5 complete.

**Acceptance Criteria:**

**Given** all prerequisites are complete
**When** the production EAS build is triggered (`eas build -p ios --profile production`)
**Then** the build completes successfully
**And** all `EXPO_PUBLIC_*` env vars are set in the EAS `production` profile
**And** NSLocationWhenInUseUsageDescription and NSCameraUsageDescription strings clearly describe the actual use (not generic)
**And** a TestFlight internal build is installed and smoke-tested on a real iPhone before submission

**Given** the build passes smoke testing
**When** the app is submitted via `eas submit -p ios`
**Then** the submission includes: privacy policy URL, support URL (both on custom domain), all App Privacy data type declarations (Story 11.5), age rating, and all localised metadata (Story 12.5)
**And** working demo account credentials are provided for Apple reviewers

**Given** the submission is reviewed
**When** Apple approves the app
**Then** it is released to PL/EN/UK App Store storefronts
**And** the App Store URL is recorded and added to the website and marketing materials

**Given** Apple rejects the submission
**When** the rejection reason is received
**Then** the specific issue is addressed within 2 business days and the app is resubmitted

---

### Story 12.7: Android Production Build and Google Play Submission

As an **operator**,
I want the Android app published on Google Play and available for public download,
So that Android users in Poland can find and install Litro.

**Why:** Android has the majority market share in Poland. The 2-week new-account waiting period (Story 12.4) means this timeline must be planned ahead of the iOS submission.

**Prerequisites:** Stories 11.1, 11.2, 11.3, 12.1, 12.4, 12.5 complete. Google Play account waiting period elapsed.

**Acceptance Criteria:**

**Given** all prerequisites are complete
**When** the production EAS build is triggered (`eas build -p android --profile production`)
**Then** the build produces an `.aab` (Android App Bundle — APK is not accepted for new Play Store apps)
**And** the build targets Android API level 35 (`targetSdkVersion: 35` via `expo-build-properties`)
**And** all `EXPO_PUBLIC_*` env vars are set in the EAS `production` profile

**Given** the AAB is ready
**When** it is uploaded to Google Play Console
**Then** it is uploaded to the internal testing track first and smoke-tested on a real Android device
**And** after passing smoke testing it is promoted to the production track
**And** the Data Safety form is complete and approved (Story 11.5)
**And** the IARC content rating questionnaire is complete
**And** all localised store listing metadata is entered for PL, EN, UK (Story 12.5)
**And** the privacy policy URL and `kontakt@litro.pl` support email are entered

**Given** the production release is submitted for review
**When** Google approves the app
**Then** it is rolled out to 100% of eligible users in Poland
**And** the Play Store URL is recorded and added to the website and marketing materials
