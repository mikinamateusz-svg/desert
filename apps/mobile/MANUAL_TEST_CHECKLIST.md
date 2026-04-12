# Mobile App Manual Test Checklist — Phase 1

Run through this checklist before each release. Each section maps to a Phase 1 epic.

## Epic 1: User Registration & Authentication

- [ ] **Guest launch** — App opens without crashing, shows loading splash, then map with fuel pins
- [ ] **Sign up (email)** — Create account with email/password, verify terms checkbox validation, confirm redirect to map
- [ ] **Sign up (Google)** — Google sign-in button works, account created, redirected to map
- [ ] **Sign up (Apple)** — Apple sign-in button works (iOS only)
- [ ] **Login** — Existing user can log in with email/password
- [ ] **Login error** — Wrong credentials show error message (not crash)
- [ ] **Onboarding sheet** — First-time guest sees soft sign-up sheet, can dismiss
- [ ] **Fuel picker** — First launch after sign-up shows fuel type picker, selection persists
- [ ] **Account screen** — Can navigate to account page, see user info
- [ ] **Sign out** — User can sign out and return to guest state

## Epic 2: Station Map & Price Discovery

- [ ] **Map loads** — Map renders with station pins showing price labels
- [ ] **GPS location** — Map centres on user's GPS location (or Warsaw fallback)
- [ ] **Location denied** — Banner shown when GPS denied, map still works with default area
- [ ] **Fuel type pills** — Tapping each fuel pill (95, 98, ON, ON+, LPG) updates pin prices
- [ ] **Pin colours** — Pins show green/amber/red/grey based on relative price tier
- [ ] **Pin tap → detail sheet** — Tapping a pin opens station detail sheet with name, address, prices
- [ ] **Station detail prices** — Detail sheet shows correct fuel prices with badges
- [ ] **Navigate button** — "Nawiguj" button opens Google Maps directions
- [ ] **Detail sheet dismiss** — Swiping down or tapping X closes the sheet
- [ ] **Cheapest in view** — Trophy button finds and selects the cheapest station in viewport
- [ ] **No stations toast** — Cheapest button in empty area shows "Brak stacji z cenami w widoku" toast
- [ ] **GPS recentre** — Location FAB flies back to user's GPS position
- [ ] **Map panning** — Panning the map loads/shows stations in the new area

## Epic 3: Photo Contribution Pipeline

- [ ] **Camera access** — Add Price FAB requests camera permission if not granted
- [ ] **Photo capture** — Camera opens, photo can be taken
- [ ] **Submission flow** — Photo is uploaded, confirmation shown to user
- [ ] **Guest gate** — Guest user tapping Add Price sees sign-up prompt
- [ ] **Offline queue** — Photo taken without connectivity queues locally (verify queue badge)

## Epic 4: Admin & Data Integrity (Mobile-side)

- [ ] **Error banner** — Network error shows error banner, auto-dismisses after 4s
- [ ] **Report incorrect price** — User can flag a price as incorrect (if implemented)

## Cross-cutting

- [ ] **Language** — App shows Polish text (PL locale)
- [ ] **No crashes** — No crashes during normal use across all flows above
- [ ] **Loading states** — Splash screen shows progress stages (GPS → stations → prices → done)
- [ ] **Splash timeout** — Splash dismisses after 8s even if data doesn't load
