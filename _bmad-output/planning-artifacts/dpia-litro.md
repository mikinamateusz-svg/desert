# Ocena Skutkow dla Ochrony Danych (DPIA)
## Litro — aplikacja do porownywania cen paliw

*Data sporzadzenia: [DATA]*
*Administrator: Mateusz Mikina*
*IOD: privacy@litro.pl*

Niniejsza ocena jest sporzadzona zgodnie z art. 35 RODO.

---

## 1. Opis przetwarzania

### 1.1 Charakter uslugi
Litro to aplikacja mobilna i serwis WWW do porownywania cen paliw na stacjach w Polsce. Uzytkownicy moga przegladac ceny na mapie oraz dobrowolnie przesylac zdjecia tablic cenowych, ktore sa przetwarzane przez sztuczna inteligencje (OCR) w celu automatycznego odczytania cen.

### 1.2 Kategorie danych osobowych

| Dane | Zrodlo | Okres przechowywania |
|---|---|---|
| E-mail, nazwa wyswietlana | rejestracja | do usuniecia konta |
| Wspolrzedne GPS | urzadzenie uzytkownika | usuwane po dopasowaniu stacji |
| Zdjecia tablic cenowych | aparat uzytkownika | 30 dni, potem usuwane |
| Token push (Expo) | urzadzenie | do wyrejestrowania |
| Preferencje paliwa, historia zgloszen | aktywnosc w aplikacji | do usuniecia konta |

### 1.3 Kategorie osob, ktorych dane dotycza
- Kierowcy (uzytkownicy aplikacji) — osoby fizyczne, 16+
- Osoby trzecie przypadkowo uchwycone na zdjeciach (twarze, tablice rejestracyjne) — dane NIE sa wyodrebniane ani przechowywane

### 1.4 Odbiorcy danych
Podmioty przetwarzajace wymienione w Polityce Prywatnosci sekcja 6 (Anthropic, Cloudflare, Railway, Vercel, Neon, Upstash, Expo, Google, Apple). Transfery poza EOG zabezpieczone SCC.

---

## 2. Ocena koniecznosci i proporcjonalnosci

| Pytanie | Odpowiedz |
|---|---|
| Czy przetwarzanie jest konieczne do celu? | Tak — GPS jest niezbedny do wyswietlenia najblizszych stacji; zdjecia sa jedynym sposobem na masowe pozyskiwanie cen od uzytkownikow. |
| Czy mozna osiagnac cel mniejsza iloscia danych? | GPS jest usuwany natychmiast po dopasowaniu stacji. Zdjecia usuwane po 30 dniach. Zakres danych jest minimalny. |
| Jaka jest podstawa prawna? | Konto i mapa: art. 6(1)(b) umowa. Zdjecia OCR i powiadomienia: art. 6(1)(a) zgoda. Bezpieczenstwo: art. 6(1)(f) uzasadniony interes. |
| Czy osoby, ktorych dane dotycza, sa informowane? | Tak — Polityka Prywatnosci dostepna przy rejestracji (obowiazkowy checkbox) i pod adresem litro.pl/polityka-prywatnosci. |
| Jak realizowane sa prawa osob? | Eksport danych, usuniecie konta, cofniecie zgody — dostepne w aplikacji. Sprzeciw i ograniczenie — przez e-mail do IOD. |

---

## 3. Ocena ryzyka

### 3.1 Ryzyko: Nieuprawniony dostep do danych lokalizacyjnych

| | |
|---|---|
| **Prawdopodobienstwo** | Niskie |
| **Skutek** | Sredni (ujawnienie wzorcow przemieszczania sie) |
| **Srodki zaradcze** | GPS usuwany z bazy natychmiast po dopasowaniu stacji. Transmisja szyfrowana (TLS). Kontrola dostepu (RBAC). Dane lokalizacyjne nie sa przechowywane dluzej niz kilka sekund. |
| **Ryzyko rezydualne** | Niskie |

### 3.2 Ryzyko: Dane osobowe osob trzecich na zdjeciach (twarze, tablice rejestracyjne)

| | |
|---|---|
| **Prawdopodobienstwo** | Srednie (zdjecia tablic cenowych moga przypadkowo uchwyci c otoczenie) |
| **Skutek** | Niski (system OCR nie wyodrebnia tych danych) |
| **Srodki zaradcze** | OCR analizuje wylacznie tekst cenowy — nie rozpoznaje osob ani pojazdow. Zdjecia usuwane automatycznie po 30 dniach. Dostep do zdjec ograniczony do zespolu operacyjnego (moderacja). |
| **Ryzyko rezydualne** | Niskie |

### 3.3 Ryzyko: Wyciek bazy danych (e-mail, historia zgloszen)

| | |
|---|---|
| **Prawdopodobienstwo** | Niskie |
| **Skutek** | Sredni (ujawnienie adresow e-mail i historii zgloszen cenowych) |
| **Srodki zaradcze** | Baza danych w regionie UE (Neon). Hasla zaszyfrowane (bcrypt). Kontrola dostepu oparta na rolach. Automatyczne wykrywanie naduzyc. Po usunieciu konta dane sa pseudonimizowane. |
| **Ryzyko rezydualne** | Niskie |

### 3.4 Ryzyko: Transfer danych do USA (dostawcy uslug)

| | |
|---|---|
| **Prawdopodobienstwo** | — (transfer ma miejsce) |
| **Skutek** | Niski (dane chronione SCC, dostawcy to duze firmy z wlasna infrastruktura bezpieczenstwa) |
| **Srodki zaradcze** | SCC z kazdym dostawca USA. Wybor regionow UE tam, gdzie to mozliwe (Neon, Upstash, Cloudflare R2). Minimalizacja danych przesylanych do USA. |
| **Ryzyko rezydualne** | Niskie |

### 3.5 Ryzyko: Przetwarzanie danych dzieci (ponizej 16 lat)

| | |
|---|---|
| **Prawdopodobienstwo** | Niskie |
| **Skutek** | Wysoki (naruszenie art. 8 RODO) |
| **Srodki zaradcze** | Polityka prywatnosci i regulamin okreslaja minimalny wiek 16 lat. Aplikacja nie jest skierowana do dzieci (tematyka: paliwa, stacje benzynowe). Brak mechanizmu weryfikacji wieku (standard rynkowy — Waze, Yanosik rowniez nie weryfikuja). |
| **Ryzyko rezydualne** | Niskie |

---

## 4. Podsumowanie

| Ryzyko | Ocena przed srodkami | Srodki zaradcze | Ryzyko rezydualne |
|---|---|---|---|
| Dostep do GPS | Srednie | Natychmiastowe usuwanie GPS | Niskie |
| Dane osob trzecich na zdjeciach | Srednie | OCR nie wyodrebnia, zdjecia usuwane po 30 dn. | Niskie |
| Wyciek bazy | Srednie | Szyfrowanie, RBAC, pseudonimizacja | Niskie |
| Transfer do USA | Srednie | SCC, minimalizacja, regiony UE | Niskie |
| Dane dzieci | Srednie | Deklaracja 16+, tematyka aplikacji | Niskie |

**Wniosek:** Ryzyka rezydualne sa niskie po zastosowaniu srodkow zaradczych. Przetwarzanie moze byc kontynuowane.

---

## 5. Zatwierdzenie

| | |
|---|---|
| **Sporzadzil** | Mateusz Mikina (Administrator / IOD) |
| **Data** | [DATA] |
| **Nastepny przeglad** | [DATA + 12 miesiecy] |
