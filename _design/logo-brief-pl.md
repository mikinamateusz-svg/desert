# Logo litro — brief dla designera

## Co potrzebujemy
1. **Mark** (sam znak) — SVG, kolor
2. **Wersja monochromatyczna znaku** — SVG, jednokolorowy
3. **Rekomendacja koloru tła launchera** (amber / krem / ink) — jedno zdanie w przekazaniu

## Czym się nie zajmujemy w tej rundzie
- Wordmark — mamy własny, na razie zostawiamy
- Lockup, launcher icon, splash, favicony, rozmiary platformowe — wygenerujemy po naszej stronie z dostarczonego SVG

## Kolory marki — dokładnie te hexy, bez przybliżeń
- `#f59e0b` (amber) — kolor przewodni
- `#1a1a1a` (ink) — wersje mono, kontrast na amber
- tła: `#ffffff` · `#f4f4f4` · `#fdf6ee` (krem)

## Nie używać
Zarezerwowane dla sygnałów cenowych w aplikacji:
`#1a9641` · `#66bd63` · `#f5c542` · `#f46d43` · `#d7191c` · `#94a3b8`

Szczególnie `#f5c542` — chłodny złoty leżący blisko amber, zamuliłby markę.

## Launcher icon — co znak musi uwzględnić w designie
- Znak musi mieścić się w **okręgu wpisanym w wewnętrzne ~80% kwadratu**. Wszystko poza może być przycięte przez maskę Androida (Pixel — zaokrąglony prostokąt, Samsung — squircle, OnePlus — kropla, Xiaomi — okrąg).
- Brak krytycznych detali przy krawędziach.
- Tło launchera — rekomendacja w jednym zdaniu (amber / krem / ink), wybierz to, co najlepiej eksponuje znak.

## Czytelność
Znak musi być rozpoznawalny w 16×16 px (favicon). Jeśli w tym rozmiarze wygląda jak plama — uprościć.

## Format dostarczenia
- SVG, bez osadzonych rastrów ani clip-path tricków
- Hexy w SVG dokładnie z listy powyżej
