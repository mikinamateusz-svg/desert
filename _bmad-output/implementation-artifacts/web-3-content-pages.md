# Story web-3 — Content Pages: About, Contact, Pricing, Legal

**Status:** review
**Epic:** web — Web App — Public Site & Content
**Story ID:** web-3
**Created:** 2026-03-28

---

## User Story

As a **public user**,
I want informational pages (about, contact, pricing, legal) on the site,
So that I can learn about the service, contact the team, and find legal documents.

**Why:** Without these pages the site looks unfinished and untrustworthy. They're also required for app store submissions and GDPR compliance.

---

## Acceptance Criteria

- **AC1 — About page:** `/o-nas` renders a hero section, "How it works" steps, "Why Litro" feature list, and a CTA to download the app — all SSR, no JS required

- **AC2 — Contact page:** `/kontakt` renders a contact form (name, email, subject, message) with a `mailto:` action for now, plus contact info sidebar

- **AC3 — Pricing page:** `/cennik` renders a 3-tier comparison table (Driver/free, Pro/coming soon, Fleet/contact us) with feature lists per tier

- **AC4 — Legal stubs:** `/polityka-prywatnosci` and `/regulamin` render stub documents with an amber "document in preparation" notice, plus basic content sections

- **AC5 — Full i18n:** All pages render in PL, EN, or UK based on locale cookie; locale-prefixed routes exist for EN and UK (/en/about, /en/contact, /en/pricing, /en/privacy, /en/terms and /uk/ equivalents)

- **AC6 — Shared components:** EN/UK locale pages are thin wrappers that render a shared `*PageContent` component with a hardcoded locale prop — no JSX duplication across locale variants

- **AC7 — Navbar + footer on all pages:** Every content page includes the standard Navbar (from layout) and Footer with locale-correct links

---

## Technical Architecture

### Shared Component Pattern

Each page type has:
- A shared content component in `components/pages/` accepting `{ locale, t }` props
- A PL route page in `app/{slug}/page.tsx` that detects locale from cookies and renders the content component
- EN/UK thin wrappers in `app/en/{slug}/page.tsx` and `app/uk/{slug}/page.tsx` that hardcode their locale

Example:
```
components/pages/AboutPageContent.tsx   ← all JSX here
app/o-nas/page.tsx                      ← detects locale, renders <AboutPageContent>
app/en/about/page.tsx                   ← <AboutPageContent locale="en" t={translations.en} />
app/uk/about/page.tsx                   ← <AboutPageContent locale="uk" t={translations.uk} />
```

### Translations

All content strings are in `lib/i18n.ts` under the relevant section (`about`, `contact`, `pricing`, `legal`). Feature lists for pricing tiers are in `pricing.features.{free,pro,fleet}` as `string[]` — not hardcoded in the component.

### Legal Pages

The legal pages contain basic stub content (cookie policy, data controller, user obligations) with an amber notice that full documents are in preparation. This is sufficient for the current PoC / pre-launch phase.

### Contact Form

Uses `<form action="mailto:...">` for now — no backend form handler. The form opens the user's email client. A proper server-side handler will be added when email infrastructure is in place.

---

## File List

### Shared content components
- `apps/web/components/pages/AboutPageContent.tsx`
- `apps/web/components/pages/ContactPageContent.tsx`
- `apps/web/components/pages/PricingPageContent.tsx`
- `apps/web/components/pages/PrivacyPageContent.tsx`
- `apps/web/components/pages/TermsPageContent.tsx`

### PL route pages
- `apps/web/app/o-nas/page.tsx`
- `apps/web/app/kontakt/page.tsx`
- `apps/web/app/cennik/page.tsx`
- `apps/web/app/polityka-prywatnosci/page.tsx`
- `apps/web/app/regulamin/page.tsx`

### EN locale pages
- `apps/web/app/en/about/page.tsx`
- `apps/web/app/en/contact/page.tsx`
- `apps/web/app/en/pricing/page.tsx`
- `apps/web/app/en/privacy/page.tsx`
- `apps/web/app/en/terms/page.tsx`

### UK locale pages
- `apps/web/app/uk/about/page.tsx`
- `apps/web/app/uk/contact/page.tsx`
- `apps/web/app/uk/pricing/page.tsx`
- `apps/web/app/uk/privacy/page.tsx`
- `apps/web/app/uk/terms/page.tsx`

### Modified
- `apps/web/lib/i18n.ts` — added about/contact/pricing/legal translation sections and pricing.features arrays

---

## Dev Agent Record

### Completion Notes

- Privacy and Terms pages include locale-conditional content blocks (PL/EN/UK rendered inline with conditionals) since the legal text differs across languages
- Pricing feature lists initially hardcoded per-locale in the component; moved into `i18n.ts` under `pricing.features` in the code review pass
- Footer locale links use English slugs for EN routes (`/en/about` not `/en/o-nas`) and Ukrainian slugs for UK routes (`/uk/about`) to match Navbar conventions
- `mailto:` contact form is an intentional stub — no backend handler needed at this stage

### Change Log

- 2026-03-28: Story created and implemented
- 2026-03-28: Code review patch D2 — pricing feature lists moved from hardcoded component arrays into i18n.ts pricing.features
