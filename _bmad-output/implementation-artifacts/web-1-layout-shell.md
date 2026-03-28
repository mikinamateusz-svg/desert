# Story web-1 — Web Layout Shell: Navbar, Footer, i18n Routing

**Status:** review
**Epic:** web — Web App — Public Site & Content
**Story ID:** web-1
**Created:** 2026-03-28

---

## User Story

As a **public user**,
I want a consistent, navigable website shell on every page,
So that I can easily explore the site, switch language, and find legal/contact information.

**Why:** The public map page exists but looks like a raw prototype with no navigation, no footer, and no brand presence. Adding a proper shell converts the tool into a website — increasing trust and discoverability.

---

## Acceptance Criteria

- **AC1 — Sticky navbar:** Given any page, when the user scrolls, then the navbar remains pinned to the top and all navigation links are accessible

- **AC2 — Active nav link:** Given the user is on a specific page, when they view the navbar, then the current page link is visually highlighted

- **AC3 — Language switcher:** Given a user on any page, when they click PL/EN/UK in the navbar or footer, then the interface language switches immediately and persists across page navigation

- **AC4 — Mobile menu:** Given a user on a mobile viewport, when they tap the hamburger icon, then a slide-down menu appears with all nav links and language switcher

- **AC5 — Footer links:** Given any page, when the user scrolls to the bottom, then they see links to About, Contact, Pricing, Privacy policy, and Terms of service

- **AC6 — i18n routing:** Given a user with EN or UK locale, when they navigate to content pages, then the URL reflects the locale prefix (/en/about, /uk/about, etc.) and all text is in the correct language

---

## Technical Architecture

### Locale Detection

Locale is determined by priority:
1. `locale` cookie (set by `/api/set-locale?l=XX` route handler)
2. `Accept-Language` header fallback
3. Default: `pl`

The `detectLocale(acceptLanguage, cookieLocale?)` function in `lib/i18n.ts` implements this. All Server Components call it on each request.

### Route Structure

- PL content pages: `/o-nas`, `/kontakt`, `/cennik`, `/polityka-prywatnosci`, `/regulamin`
- EN content pages: `/en/about`, `/en/contact`, `/en/pricing`, `/en/privacy`, `/en/terms`
- UK content pages: `/uk/about`, `/uk/contact`, `/uk/pricing`, `/uk/privacy`, `/uk/terms`
- Map is always at `/` regardless of locale (language determined by cookie)

### Lang Switching

`GET /api/set-locale?l=XX` — sets `locale` cookie (1 year, `lax`, path `/`) and redirects back to the same page (same-origin referer validation; falls back to `/`).

### Navbar

Client Component (`'use client'`) — uses `usePathname()` for active link detection. Receives `locale` and `t` props from the layout Server Component. Sticky `h-16`, z-index 50.

### Layout

`app/layout.tsx` is an async Server Component. Reads locale from cookies + Accept-Language on every request, sets `<html lang>`, renders `<Navbar>`. The map page sets its own height to `calc(100dvh - 64px)` to fill the viewport below the navbar.

---

## File List

- `apps/web/app/layout.tsx` — async Server Component; reads locale, renders Navbar, sets html lang
- `apps/web/components/Navbar.tsx` — `'use client'`; sticky header, mobile menu, lang switcher, usePathname active highlight
- `apps/web/components/Footer.tsx` — Server Component; 4-col grid with locale-prefixed links
- `apps/web/middleware.ts` — Next.js middleware; matcher config only (no active logic)
- `apps/web/app/api/set-locale/route.ts` — GET handler; validates locale, sets cookie, same-origin redirect
- `apps/web/lib/i18n.ts` — expanded; detectLocale with cookie override, localeToHtmlLang, full Translations interface (nav, footer, station, sidebar, about, contact, pricing, legal), pl/en/uk values
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — web epic added

---

## Dev Agent Record

### Completion Notes

- `detectLocale` extended to accept optional `cookieLocale` param; cookie takes precedence over Accept-Language
- Navbar is `'use client'` using `usePathname()` for active-link highlight — avoids unreliable `x-invoke-path` server header approach
- `/api/set-locale` validates referer is same-origin before redirecting to prevent open redirect (CWE-601); falls back to `/` for external or malformed referers
- Map always lives at `/`; locale-prefixed routes only cover content pages
- `middleware.ts` is a stub (matcher config only) — locale is read directly from cookies in Server Components

### Change Log

- 2026-03-28: Story created and implemented
- 2026-03-28: Code review patches applied — active nav (usePathname), open redirect fix, dead middleware cleanup
