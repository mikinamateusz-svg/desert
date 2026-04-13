# Ocena Skutków dla Ochrony Danych (DPIA)
## Litro — aplikacja do porównywania cen paliw

*Data sporządzenia: [DATA]*
*Administrator: Mateusz Mikina*
*IOD: privacy@litro.pl*

Niniejsza ocena jest sporządzona zgodnie z art. 35 RODO. Inspektor Ochrony Danych został skonsultowany zgodnie z art. 35(2) RODO.

---

## 1. Opis przetwarzania

### 1.1 Charakter usługi
Litro to aplikacja mobilna i serwis WWW do porównywania cen paliw na stacjach w Polsce. Użytkownicy mogą przeglądać ceny na mapie oraz dobrowolnie przesyłać zdjęcia tablic cenowych, które są przetwarzane przez sztuczną inteligencję (OCR) w celu automatycznego odczytania cen.

### 1.2 Skala przetwarzania
- Szacunkowa liczba użytkowników na starcie: do 1 000
- Szacunkowa liczba zgłoszeń dziennie: do 100
- Zasięg geograficzny: Polska (region łódzki na starcie)

### 1.3 Kategorie danych osobowych

| Dane | Źródło | Okres przechowywania |
|---|---|---|
| E-mail, nazwa wyświetlana | rejestracja | do usunięcia konta |
| Współrzędne GPS | urządzenie użytkownika | usuwane po przetworzeniu zgłoszenia |
| Zdjęcia tablic cenowych | aparat użytkownika | 30 dni, potem usuwane |
| Token push (Expo) | urządzenie | do wyrejestrowania |
| Preferencje paliwa, historia zgłoszeń | aktywność w aplikacji | do usunięcia konta |
| Wskaźnik zaufania (trust score) | obliczany przez system | do usunięcia konta |
| Status shadow ban | decyzja systemu/administratora | do usunięcia konta |

### 1.4 Kategorie osób, których dane dotyczą
- Kierowcy (użytkownicy aplikacji) — osoby fizyczne, 16+
- Osoby trzecie przypadkowo uchwycone na zdjęciach (twarze, tablice rejestracyjne) — dane NIE są wyodrębniane ani przechowywane

### 1.5 Odbiorcy danych
Podmioty przetwarzające wymienione w Polityce Prywatności sekcja 6 (Anthropic, Cloudflare, Railway, Vercel, Neon, Upstash, Expo, Google, Apple). Transfery poza EOG zabezpieczone SCC.

---

## 2. Ocena konieczności i proporcjonalności

| Pytanie | Odpowiedź |
|---|---|
| Czy przetwarzanie jest konieczne do celu? | Tak — GPS jest niezbędny do wyświetlenia najbliższych stacji; zdjęcia są jedynym sposobem na masowe pozyskiwanie cen od użytkowników. |
| Czy można osiągnąć cel mniejszą ilością danych? | GPS jest usuwany po przetworzeniu zgłoszenia. Zdjęcia usuwane po 30 dniach. Zakres danych jest minimalny. |
| Jaka jest podstawa prawna? | Konto i mapa: art. 6(1)(b) umowa. Zdjęcia OCR i powiadomienia: art. 6(1)(a) zgoda. Bezpieczeństwo: art. 6(1)(f) uzasadniony interes. |
| Czy osoby, których dane dotyczą, są informowane? | Tak — Polityka Prywatności dostępna przy rejestracji (obowiązkowy checkbox) i pod adresem litro.pl/polityka-prywatnosci. |
| Jak realizowane są prawa osób? | Eksport danych, usunięcie konta, cofnięcie zgody — dostępne w aplikacji. Sprzeciw i ograniczenie — przez e-mail do IOD. |

---

## 3. Ocena ryzyka

### 3.1 Ryzyko: Nieuprawniony dostęp do danych lokalizacyjnych

| | |
|---|---|
| **Prawdopodobieństwo** | Niskie |
| **Skutek** | Średni (ujawnienie wzorców przemieszczania się) |
| **Środki zaradcze** | GPS usuwany z bazy po przetworzeniu zgłoszenia (dopasowanie do stacji). Transmisja szyfrowana (TLS). Kontrola dostępu (RBAC). |
| **Ryzyko rezydualne** | Niskie |

### 3.2 Ryzyko: Dane osobowe osób trzecich na zdjęciach (twarze, tablice rejestracyjne)

| | |
|---|---|
| **Prawdopodobieństwo** | Średnie (zdjęcia tablic cenowych mogą przypadkowo uchwycić otoczenie) |
| **Skutek** | Niski (system OCR nie wyodrębnia tych danych) |
| **Środki zaradcze** | OCR analizuje wyłącznie tekst cenowy — nie rozpoznaje osób ani pojazdów. Zdjęcia usuwane automatycznie po 30 dniach. Dostęp do zdjęć ograniczony do zespołu operacyjnego (moderacja). |
| **Ryzyko rezydualne** | Niskie |

### 3.3 Ryzyko: Wyciek bazy danych (e-mail, historia zgłoszeń)

| | |
|---|---|
| **Prawdopodobieństwo** | Niskie |
| **Skutek** | Średni (ujawnienie adresów e-mail i historii zgłoszeń cenowych) |
| **Środki zaradcze** | Baza danych w regionie UE (Neon). Hasła zaszyfrowane (bcrypt). Kontrola dostępu oparta na rolach. Automatyczne wykrywanie nadużyć. Po usunięciu konta dane są pseudonimizowane. |
| **Ryzyko rezydualne** | Niskie |

### 3.4 Ryzyko: Transfer danych do USA (dostawcy usług)

| | |
|---|---|
| **Prawdopodobieństwo** | Pewne (transfer ma miejsce w ramach normalnej pracy systemu) |
| **Skutek** | Niski (dane chronione SCC, dostawcy to duże firmy z własną infrastrukturą bezpieczeństwa) |
| **Środki zaradcze** | SCC z każdym dostawcą USA. Wybór regionów UE tam, gdzie to możliwe (Neon, Upstash, Cloudflare R2). Minimalizacja danych przesyłanych do USA. |
| **Ryzyko rezydualne** | Niskie |

### 3.5 Ryzyko: Przetwarzanie danych dzieci (poniżej 16 lat)

| | |
|---|---|
| **Prawdopodobieństwo** | Niskie |
| **Skutek** | Wysoki (naruszenie art. 8 RODO) |
| **Środki zaradcze** | Polityka prywatności i regulamin określają minimalny wiek 16 lat. Aplikacja nie jest skierowana do dzieci (tematyka: paliwa, stacje benzynowe). Brak mechanizmu weryfikacji wieku (standard rynkowy — Waze, Yanosik również nie weryfikują). |
| **Ryzyko rezydualne** | Średnie (brak technicznej weryfikacji wieku) |

### 3.6 Ryzyko: Przetwarzanie zdjęć przez dostawcę AI (Anthropic)

| | |
|---|---|
| **Prawdopodobieństwo** | Niskie |
| **Skutek** | Średni (zdjęcia mogą zawierać przypadkowe dane osobowe osób trzecich) |
| **Środki zaradcze** | Anthropic deklaruje, że nie wykorzystuje danych z API do trenowania modeli. Zdjęcia przesyłane przez szyfrowane API. Zdjęcia usuwane z serwera Litro po 30 dniach. Przetwarzanie ograniczone do ekstrakcji tekstu cenowego. |
| **Ryzyko rezydualne** | Niskie |

### 3.7 Ryzyko: Shadow ban bez możliwości odwołania

| | |
|---|---|
| **Prawdopodobieństwo** | Niskie (dotyczy wyłącznie użytkowników z wzorcami nadużyć) |
| **Skutek** | Niski (użytkownik traci możliwość zgłaszania cen, ale zachowuje dostęp do przeglądania) |
| **Środki zaradcze** | Automatyczne wykrywanie na podstawie obiektywnych wzorców (duplikaty, ceny poza zakresem rynkowym). Decyzje podlegają przeglądowi administratora w kolejce moderacji. Użytkownik może skontaktować się z IOD w sprawie ograniczenia konta. |
| **Ryzyko rezydualne** | Niskie |

---

## 4. Podsumowanie

| Ryzyko | Ocena przed środkami | Środki zaradcze | Ryzyko rezydualne |
|---|---|---|---|
| Dostęp do GPS | Średnie | Usuwanie GPS po przetworzeniu | Niskie |
| Dane osób trzecich na zdjęciach | Średnie | OCR nie wyodrębnia, zdjęcia usuwane po 30 dn. | Niskie |
| Wyciek bazy | Średnie | Szyfrowanie, RBAC, pseudonimizacja | Niskie |
| Transfer do USA | Średnie | SCC, minimalizacja, regiony UE | Niskie |
| Dane dzieci | Średnie | Deklaracja 16+, tematyka aplikacji | Średnie |
| Przetwarzanie przez AI | Średnie | Brak trenowania na danych API, szyfrowanie | Niskie |
| Shadow ban | Niskie | Kolejka moderacji, kontakt z IOD | Niskie |

**Wniosek:** Ryzyka rezydualne są niskie lub średnie po zastosowaniu środków zaradczych. Jedyne ryzyko rezydualne ocenione jako średnie (dane dzieci) wynika z braku technicznej weryfikacji wieku, co jest standardem rynkowym w tej kategorii aplikacji. Przetwarzanie może być kontynuowane.

---

## 5. Zatwierdzenie

| | |
|---|---|
| **Sporządził** | Mateusz Mikina (Administrator / IOD) |
| **Data** | [DATA] |
| **Następny przegląd** | [DATA + 12 miesięcy] |

Niniejsza ocena będzie aktualizowana w przypadku istotnych zmian w przetwarzaniu danych (nowe kategorie danych, nowi odbiorcy, zmiana skali przetwarzania).
