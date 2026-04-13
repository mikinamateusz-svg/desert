# Polityka Prywatności — Litro

*Ostatnia aktualizacja: [DATA]*

---

## 1. Kim jesteśmy

Administratorem Twoich danych osobowych jest **Mateusz Mikina**, zamieszkały w Polsce (dalej: „Administrator", „my").

Inspektor Ochrony Danych (IOD): **privacy@litro.pl**

Litro to aplikacja mobilna i serwis internetowy do porównywania cen paliw na stacjach w Polsce, oparty na danych społecznościowych (zgłoszeniach użytkowników) i sztucznej inteligencji (automatyczne odczytywanie cen ze zdjęć tablic cenowych).

---

## 2. Jakie dane zbieramy

| Kategoria | Dane | Kiedy zbierane |
|---|---|---|
| **Dane konta** | adres e-mail, nazwa wyświetlana, hasło (zaszyfrowane) | rejestracja |
| **Logowanie społecznościowe** | identyfikator Google lub Apple (nie hasło do tych serwisów) | logowanie przez Google/Apple |
| **Lokalizacja GPS** | współrzędne geograficzne (szerokość, długość) | korzystanie z mapy, przesyłanie zdjęcia ceny |
| **Zdjęcia tablic cenowych** | fotografie tablic z cenami paliw na stacjach | dobrowolne zgłoszenie ceny |
| **Dane urządzenia** | system operacyjny, model urządzenia, token powiadomień push (Expo) | instalacja i korzystanie z aplikacji |
| **Dane o aktywnościach** | preferencje typu paliwa, historia zgłoszeń, ustawienia powiadomień | korzystanie z aplikacji |

### Czego NIE zbieramy
- Nie zbieramy danych biometrycznych.
- Nie zbieramy danych o płatnościach lub danych kart płatniczych.
- Nie profilujemy użytkowników w celach reklamowych.
- Nie sprzedajemy danych osobowych osobom trzecim.

---

## 3. W jakim celu i na jakiej podstawie prawnej przetwarzamy dane

| Cel przetwarzania | Podstawa prawna (RODO) | Dane |
|---|---|---|
| **Świadczenie usługi** — wyświetlanie mapy stacji, cen paliw, obsługa konta | Art. 6(1)(b) — wykonanie umowy | konto, lokalizacja, zgłoszenia |
| **Przetwarzanie zdjęć OCR** — automatyczne odczytywanie cen ze zdjęć tablic cenowych | Art. 6(1)(a) — zgoda (dobrowolne przesłanie zdjęcia) | zdjęcia, GPS (tymczasowo) |
| **Powiadomienia push** — alerty o zmianach cen | Art. 6(1)(a) — zgoda | token push, preferencje |
| **Bezpieczeństwo i integralność danych** — wykrywanie nadużyć, moderacja zgłoszeń | Art. 6(1)(f) — uzasadniony interes | dane konta, zgłoszenia, wskaźnik zaufania |
| **Analityka zagregowana** — statystyki cen paliw dla regionów (bez danych osobowych) | Art. 6(1)(f) — uzasadniony interes | dane zagregowane i zanonimizowane |
| **Obowiązki prawne** — odpowiedzi na żądania organów | Art. 6(1)(c) — obowiązek prawny | dane konta |

---

## 4. Zdjęcia i przetwarzanie OCR

Zdjęcia tablic cenowych są przetwarzane przez sztuczną inteligencję wyłącznie w celu odczytania cen paliw. System nie rozpoznaje osób, pojazdów ani tablic rejestracyjnych. Współrzędne GPS są usuwane z bazy po dopasowaniu stacji. Zdjęcia są przechowywane na serwerze w regionie UE przez 30 dni do celów audytu, a następnie automatycznie usuwane.

---

## 5. Dane społecznościowe (zgłoszenia cen)

Przesyłając zgłoszenie ceny, udzielasz nam nieodpłatnej licencji na wykorzystanie odczytanych cen w ramach usługi Litro. Ceny są wyświetlane anonimowo — inni użytkownicy nie widzą, kto zgłosił daną cenę.

Twoje zgłoszenia są przechowywane w naszej bazie danych. Po usunięciu konta, Twoje dane osobowe (e-mail, nazwa) są usuwane, a zgłoszenia cenowe pozostają w systemie w formie spseudonimizowanej do celów statystycznych.

---

## 6. Komu udostępniamy dane

Nie sprzedajemy Twoich danych osobowych. Udostępniamy dane wyłącznie następującym kategoriom podmiotów:

| Podmiot | Cel | Dane | Lokalizacja |
|---|---|---|---|
| **Anthropic (Claude AI)** | przetwarzanie OCR zdjęć | zdjęcia tablic cenowych | USA (SCC) |
| **Cloudflare R2** | przechowywanie zdjęć | zdjęcia | UE |
| **Railway** | hosting serwera API | dane konta, zgłoszenia | USA (SCC) |
| **Vercel** | hosting strony internetowej | dane sesji, IP | USA (SCC) |
| **Neon** | baza danych | wszystkie dane w bazie | UE |
| **Upstash** | cache Redis | cache cen, tokeny sesji | UE |
| **Expo (Meta)** | powiadomienia push | tokeny push | USA (SCC) |
| **Google / Apple** | logowanie społecznościowe | identyfikator konta | USA (SCC) |

**SCC** = Standardowe Klauzule Umowne (Standard Contractual Clauses) zgodnie z decyzją Komisji Europejskiej, zapewniające odpowiedni poziom ochrony danych przy transferach poza EOG.

---

## 7. Przekazywanie danych poza EOG

Część naszych dostawców usług ma siedzibę w USA. W każdym takim przypadku stosujemy Standardowe Klauzule Umowne (SCC) zatwierdzone przez Komisję Europejską jako zabezpieczenie transferu danych. Dotyczy to: Railway (hosting), Vercel (hosting WWW), Anthropic (OCR), Expo (powiadomienia push), Google i Apple (logowanie).

Tam, gdzie to możliwe, wybieramy regiony UE dla przechowywania danych (Neon — baza danych, Upstash — Redis, Cloudflare R2 — zdjęcia).

---

## 8. Jak długo przechowujemy dane

| Dane | Okres przechowywania |
|---|---|
| **Dane konta** | do momentu usunięcia konta, a następnie zanonimizowane |
| **Zgłoszenia cen** | bezterminowo (zanonimizowane po usunięciu konta) |
| **Zdjęcia tablic cenowych** | 30 dni od przesłania, następnie automatycznie usuwane |
| **Współrzędne GPS ze zgłoszeń** | usuwane natychmiast po dopasowaniu stacji |
| **Token push** | do momentu wyrejestrowania tokenu lub usunięcia konta |
| **Preferencje powiadomień** | do momentu zmiany lub usunięcia konta |
| **Historia zgód** | bezterminowo (obowiązek dokumentacyjny RODO) |

---

## 9. Twoje prawa

Na podstawie RODO przysługują Ci następujące prawa:

| Prawo | Opis | Jak skorzystać |
|---|---|---|
| **Dostęp** (art. 15) | Możesz dowiedzieć się, jakie dane o Tobie przetwarzamy | Eksport danych w aplikacji |
| **Sprostowanie** (art. 16) | Możesz poprawić nieprawidłowe dane | Edycja profilu w aplikacji lub kontakt: privacy@litro.pl |
| **Usunięcie** (art. 17) | Możesz żądać usunięcia swoich danych | Usunięcie konta w aplikacji |
| **Ograniczenie** (art. 18) | Możesz żądać ograniczenia przetwarzania | Kontakt: privacy@litro.pl |
| **Przenoszenie** (art. 20) | Możesz pobrać swoje dane w formacie elektronicznym | Eksport danych w aplikacji |
| **Sprzeciw** (art. 21) | Możesz wnieść sprzeciw wobec przetwarzania na podst. uzasadnionego interesu | Kontakt: privacy@litro.pl |
| **Cofnięcie zgody** | Możesz cofnąć zgodę w każdym momencie (bez wpływu na zgodność z prawem przetwarzania dokonanego przed cofnięciem) | Ustawienia w aplikacji |

### Skarga do organu nadzorczego

Masz prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych (UODO):

Urząd Ochrony Danych Osobowych
ul. Stawki 2, 00-193 Warszawa
www.uodo.gov.pl

---

## 10. Pliki cookie i dane lokalne

Strona internetowa litro.pl używa wyłącznie niezbędnych plików cookie (sesja, działanie strony). Nie stosujemy plików cookie reklamowych ani analitycznych.

Aplikacja mobilna nie używa plików cookie. Przechowuje lokalnie na urządzeniu preferencje użytkownika, token sesji oraz kolejkę zgłoszeń offline.

---

## 11. Bezpieczeństwo danych

Stosujemy odpowiednie środki techniczne i organizacyjne w celu ochrony Twoich danych osobowych przed nieautoryzowanym dostępem, utratą lub zniszczeniem. Obejmują one m.in. szyfrowanie transmisji danych (HTTPS/TLS), kryptograficzne zabezpieczenie haseł (bcrypt), kontrolę dostępu opartą na rolach (RBAC) oraz mechanizmy automatycznego wykrywania nadużyć.

---

## 12. Dzieci

Litro jest przeznaczone dla osób, które ukończyły **16 lat**. Nie zbieramy świadomie danych osobowych osób poniżej 16 roku życia. Jeżeli dowiemy się, że zebraliśmy dane osoby poniżej 16 lat, niezwłocznie je usuniemy.

---

## 13. Zmiany polityki

O istotnych zmianach niniejszej polityki poinformujemy Cię z wyprzedzeniem. Aktualna wersja polityki jest zawsze dostępna pod adresem: https://litro.pl/polityka-prywatnosci

---

## 14. Kontakt

W sprawach związanych z ochroną danych osobowych: **privacy@litro.pl**
