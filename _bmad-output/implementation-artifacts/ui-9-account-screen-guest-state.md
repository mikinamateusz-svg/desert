# Story UI-9: Account Screen — Guest State & Action Order

## Status
review

## Story

As a **guest (not logged in)**,
I want the account screen to clearly show I'm not signed in and give me a direct path to log in,
So that I understand my status and can sign in without hunting for an entry point.

## Why

Currently the account screen shows guests an avatar with initials derived from the word "Guest", making the UI look like a logged-in profile. This is misleading. There is also no way to reach the login screen once onboarding is complete — guests are stuck in guest mode forever unless they reinstall. Additionally, the action order is inconsistent with user expectations and the Ukrainian locale label shows "UK" (which reads as United Kingdom).

## Acceptance Criteria

**AC1 — Guest identity state:**
Given I am not signed in,
When I open the account screen,
Then I see a placeholder icon (no avatar with initials) and the text "Not signed in" — no fake identity is shown.

**AC2 — Sign In entry point:**
Given I am not signed in,
When I open the account screen,
Then I see a "Sign In" button that navigates to `/(auth)/login`.

**AC3 — Logged-in state unchanged:**
Given I am signed in,
When I open the account screen,
Then I see my avatar with initials and display name / email as before — no regression.

**AC4 — Sign Out for logged-in users:**
Given I am signed in,
When I open the account screen,
Then I see "Sign Out" (not "Sign In") — correct action for my auth state.

**AC5 — Action order:**
The account screen actions appear in this order for all users:
1. Language selector
2. Sign In (guest) / Sign Out (logged in)
3. Send Feedback
4. Privacy Settings
5. Download My Data
6. Delete My Account

**AC6 — Download My Data hidden for guests:**
Given I am not signed in,
When I open the account screen,
Then "Download My Data" is not shown (no data to export).

**AC7 — Delete My Account hidden for guests:**
Given I am not signed in,
When I open the account screen,
Then "Delete My Account" is not shown (no account to delete).

## Tasks

- [ ] Task 1: Update guest identity section in `account.tsx`
  - [ ] 1a: Replace avatar+initials with a neutral placeholder icon when `!accessToken`
  - [ ] 1b: Show "Not signed in" label when `!accessToken`

- [ ] Task 2: Add Sign In / Sign Out toggle
  - [ ] 2a: When `!accessToken` — render "Sign In" button → `router.push('/(auth)/login')`
  - [ ] 2b: When `accessToken` — render "Sign Out" button (existing `logout` handler)

- [ ] Task 3: Reorder actions per AC5
  - [ ] 3a: Language selector first
  - [ ] 3b: Sign In / Sign Out second
  - [ ] 3c: Send Feedback third
  - [ ] 3d: Privacy Settings fourth
  - [ ] 3e: Download My Data fifth (hidden for guests — AC7)
  - [ ] 3f: Delete My Account last (hidden for guests — AC8)

## Dev Notes

- `account.tsx` is the only file that needs layout changes
- `/(auth)/login` route already exists — no new screens needed
- Guest placeholder icon: use a simple `👤` or an SF Symbol / MaterialIcon person outline — match existing icon style in the codebase
- `SUPPORTED_LOCALES` and locale keys (`uk`) don't change — only the display label string changes
- i18n keys to update: `account.language.uk` in all three locale files

## File List
- apps/mobile/app/(app)/account.tsx (modified)
