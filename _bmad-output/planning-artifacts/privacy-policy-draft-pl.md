# Polityka Prywatnosci — Litro

*Ostatnia aktualizacja: [DATA]*

---

## 1. Kim jestesmy

Administratorem Twoich danych osobowych jest **Mateusz Mikina**, zamieszkaly w Polsce (dalej: „Administrator", „my").

Kontakt w sprawie danych osobowych: **privacy@litro.pl**

Litro to aplikacja mobilna i serwis internetowy do porownywania cen paliw na stacjach w Polsce, oparty na danych spolecznosciowych (zgloszeniach uzytkownikow) i sztucznej inteligencji (automatyczne odczytywanie cen ze zdjec tablic cenowych).

---

## 2. Jakie dane zbieramy

| Kategoria | Dane | Kiedy zbierane |
|---|---|---|
| **Dane konta** | adres e-mail, nazwa wyswietlana, haslo (zaszyfrowane) | rejestracja |
| **Logowanie spolecznosciowe** | identyfikator Google lub Apple (nie haslo do tych serwisow) | logowanie przez Google/Apple |
| **Lokalizacja GPS** | wspolrzedne geograficzne (szerokosc, dlugosc) | korzystanie z mapy, przesylanie zdjecia ceny |
| **Zdjecia tablic cenowych** | fotografie tablic z cenami paliw na stacjach | dobrowolne zgloszenie ceny |
| **Dane urzadzenia** | system operacyjny, model urzadzenia, token powiadomien push (Expo) | instalacja i korzystanie z aplikacji |
| **Dane o aktywnosciach** | preferencje typu paliwa, historia zgloszen, ustawienia powiadomien | korzystanie z aplikacji |

### Czego NIE zbieramy
- Nie zbieramy danych biometrycznych.
- Nie zbieramy danych o platnosc iach lub danych kart platniczych.
- Nie profilujemy uzytkownikow w celach reklamowych.
- Nie sprzedajemy danych osobowych osobom trzecim.

---

## 3. W jakim celu i na jakiej podstawie prawnej przetwarzamy dane

| Cel przetwarzania | Podstawa prawna (RODO) | Dane |
|---|---|---|
| **Swiadczenie uslugi** — wyswietlanie mapy stacji, cen paliw, obsluga konta | Art. 6(1)(b) — wykonanie umowy | konto, lokalizacja, zgloszenia |
| **Przetwarzanie zdjec OCR** — automatyczne odczytywanie cen ze zdjec tablic cenowych | Art. 6(1)(b) — wykonanie umowy | zdjecia, GPS (tymczasowo) |
| **Powiadomienia push** — alerty o zmianach cen | Art. 6(1)(a) — zgoda | token push, preferencje |
| **Bezpieczenstwo i integralnosc danych** — wykrywanie naduzyc, moderacja zgloszen | Art. 6(1)(f) — uzasadniony interes | dane konta, zgloszenia, wskaznik zaufania |
| **Analityka zagregowana** — statystyki cen paliw dla regionow (bez danych osobowych) | Art. 6(1)(f) — uzasadniony interes | dane zagregowane i zanonimizowane |
| **Obowiazki prawne** — odpowiedzi na zadania organow, dokumentacja podatkowa | Art. 6(1)(c) — obowiazek prawny | dane konta, faktury |

---

## 4. Zdjecia i przetwarzanie OCR

Zdjecia tablic cenowych sa przetwarzane przez sztuczna inteligencje wylacznie w celu odczytania cen paliw. System nie rozpoznaje osob, pojazdow ani tablic rejestracyjnych. Wspolrzedne GPS sa usuwane z bazy po dopasowaniu stacji. Zdjecia sa przechowywane na serwerze w regionie UE przez 30 dni do celow audytu, a nastepnie automatycznie usuwane.

---

## 5. Dane spolecznosciowe (zgloszenia cen)

Przesylajac zgloszenie ceny, udzielasz nam nieodplatnej licencji na wykorzystanie odczytanych cen w ramach uslugi Litro. Ceny sa wyswietlane anonimowo — inni uzytkownicy nie widza, kto zglosil dana cene.

Twoje zgloszenia sa przechowywane w naszej bazie danych. Po usunieciu konta, zgloszenia zostaja zanonimizowane (powiazanie z Twoim kontem jest usuwane), ale dane cenowe pozostaja w systemie do celow statystycznych.

---

## 6. Komu udostepniamy dane

Nie sprzedajemy Twoich danych osobowych. Udostepniamy dane wylacznie nastepujacym kategoriom podmiotow:

| Podmiot | Cel | Dane | Lokalizacja |
|---|---|---|---|
| **Anthropic (Claude AI)** | przetwarzanie OCR zdjec | zdjecia tablic cenowych | USA (SCC) |
| **Cloudflare R2** | przechowywanie zdjec | zdjecia | UE |
| **Railway** | hosting serwera API | dane konta, zgloszenia | USA (SCC) |
| **Vercel** | hosting strony internetowej | dane sesji, IP | USA (SCC) |
| **Neon** | baza danych | wszystkie dane w bazie | UE |
| **Upstash** | cache Redis | cache cen, tokeny sesji | UE |
| **Expo (Meta)** | powiadomienia push | tokeny push | USA (SCC) |
| **Google / Apple** | logowanie spolecznosciowe | identyfikator konta | USA (SCC) |

**SCC** = Standardowe Klauzule Umowne (Standard Contractual Clauses) zgodnie z decyzja Komisji Europejskiej, zapewniajace odpowiedni poziom ochrony danych przy transferach poza EOG.

---

## 7. Przekazywanie danych poza EOG

Czesc naszych dostawcow uslug ma siedzibe w USA. W kazdym takim przypadku stosujemy Standardowe Klauzule Umowne (SCC) zatwierdzone przez Komisje Europejska jako zabezpieczenie transferu danych. Dotyczy to: Railway (hosting), Vercel (hosting WWW), Anthropic (OCR), Expo (powiadomienia push), Google i Apple (logowanie).

Tam, gdzie to mozliwe, wybieramy regiony UE dla przechowywania danych (Neon — baza danych, Upstash — Redis, Cloudflare R2 — zdjecia).

---

## 8. Jak dlugo przechowujemy dane

| Dane | Okres przechowywania |
|---|---|
| **Dane konta** | do momentu usuniec ia konta, a nastepnie zanonimizowane |
| **Zgloszenia cen** | bezterminowo (zanonimizowane po usunieciu konta) |
| **Zdjecia tablic** | 30 dni od przeslania, nastepnie automatycznie usuwane |
| **Wspolrzedne GPS ze zgloszen** | usuwane natychmiast po dopasowaniu stacji |
| **Token push** | do momentu wyrejestrowania tokenu lub usuniecai konta |
| **Preferencje powiadomien** | do momentu zmiany lub usuniecia konta |
| **Historia zgod** | bezterminowo (obowiazek dokumentacyjny RODO) |
| **Dane do faktur** | 5 lat od konca roku podatkowego (Ordynacja podatkowa) |

---

## 9. Twoje prawa

Na podstawie RODO przysluguja Ci nastepujace prawa:

| Prawo | Opis | Jak skorzystac |
|---|---|---|
| **Dostep** (art. 15) | Mozesz dowiedziec sie, jakie dane o Tobie przetwarzamy | Eksport danych w aplikacji (Konto → Eksportuj dane) |
| **Sprostowanie** (art. 16) | Mozesz poprawic nieprawidlowe dane | Edycja profilu w aplikacji lub kontakt: privacy@litro.pl |
| **Usuniecie** (art. 17) | Mozesz zadac usuniecia swoich danych | Usuniecie konta w aplikacji (Konto → Usun konto) |
| **Ograniczenie** (art. 18) | Mozesz zadac ograniczenia przetwarzania | Kontakt: privacy@litro.pl |
| **Przenoszenie** (art. 20) | Mozesz pobrac swoje dane w formacie elektronicznym | Eksport danych w aplikacji |
| **Sprzeciw** (art. 21) | Mozesz wniesc sprzeciw wobec przetwarzania na podst. uzasadnionego interesu | Kontakt: privacy@litro.pl |
| **Cofniecie zgody** | Mozesz cofnac zgode w kazdym momencie (bez wplywu na zgodnosc z prawem przetwarzania dokonanego przed cofnieciem) | Ustawienia powiadomien w aplikacji lub Konto → Zgody |

### Skarga do organu nadzorczego

Masz prawo wniesc skarge do Prezesa Urzedu Ochrony Danych Osobowych (UODO):

Urzad Ochrony Danych Osobowych
ul. Stawki 2, 00-193 Warszawa
www.uodo.gov.pl

---

## 10. Pliki cookie i technologie sledzace

### Strona internetowa (litro.pl)

| Typ | Cel | Podstawa |
|---|---|---|
| **Niezbedne** | dzialanie strony, sesja logowania | uzasadniony interes |
| **Analityczne** | analiza ruchu na stronie | zgoda |

Nie stosujemy plikow cookie reklamowych ani nie wyswietlamy reklam targetowanych.

Zgodnie z art. 173 Prawa telekomunikacyjnego, pliki cookie wymagajace zgody sa instalowane dopiero po jej wyrazeniu przez uzytkownika.

### Aplikacja mobilna

Aplikacja nie uzywa plikow cookie. Przechowujemy lokalnie na urzadzeniu:
- preferencje typu paliwa (AsyncStorage)
- token sesji logowania (SecureStore)
- kolejke zgloszen offline (SQLite)

---

## 11. Bezpieczenstwo danych

Stosujemy nastepujace srodki ochrony danych:
- szyfrowanie transmisji (HTTPS/TLS)
- szyfrowane przechowywanie hasel (bcrypt)
- kontrola dostepu oparta na rolach (RBAC)
- automatyczne wykrywanie naduzyc i podejrzanych wzorcow zgloszen
- regularne kopie zapasowe bazy danych
- ograniczenie dostepu do danych wylacznie do upowaznionych osob

---

## 12. Dzieci

Litro jest przeznaczone dla osob, ktore ukonczyly **16 lat**. Nie zbieramy swiadomie danych osobowych osob ponizej 16 roku zycia. Jezeli dowiem y sie, ze zebralismy dane osoby ponizej 16 lat, niezwlocznie je usun iemy.

---

## 13. Zmiany polityki

O istotnych zmianach niniejszej polityki poinformujemy Cie poprzez:
- powiadomienie w aplikacji
- e-mail (jezeli podales adres e-mail)

Aktualna wersja polityki jest zawsze dostepna pod adresem: https://litro.pl/polityka-prywatnosci

---

## 14. Kontakt

W sprawach zwiazanych z ochrona danych osobowych:

**E-mail:** privacy@litro.pl
**Adres:** [adres korespondencyjny Administratora]
