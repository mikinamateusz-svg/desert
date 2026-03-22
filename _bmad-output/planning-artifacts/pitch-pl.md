# Desert — Pitch dla Zespołu

## Część 1: Problem

Każdy, kto tankuje auto, zna to uczucie.

Wjeżdżasz na stację. Widzisz cenę. I masz w głowie jedno pytanie: *czy tu jest taniej, czy drożej niż gdzie indziej?*

Nie wiesz. Nie masz jak wiedzieć. Możesz zgadywać — na podstawie ostatniego tankowania sprzed tygodnia, albo reklamy przy drodze, którą minąłeś może kilkanaście kilometrów wcześniej. Ale pewności nie masz żadnej.

Polacy tankują ponad **700 milionów razy rocznie**. Za każdym razem podejmują decyzję finansową bez żadnych danych. Na rynku, gdzie różnica między najtańszą a najdroższą stacją w promieniu kilku kilometrów potrafi wynosić 30–40 groszy na litrze.

Przy 50-litrowym zbiorniku — to 15–20 złotych. W skali roku — kilkaset złotych w błoto. Za nic.

Dane są. Problem polega na tym, że nikt ich dotąd nie zebrał w sposób, który działałby **w czasie rzeczywistym i w skali**.

---

## Część 2: Mechanizm

### Dlaczego crowdsourcing działa — i dlaczego tu zadziała szczególnie dobrze

Desert buduje bazę cen paliw poprzez crowdsourcing. Użytkownicy robią zdjęcie tablicy z cenami podczas tankowania — aplikacja robi resztę.

Ale zanim powiesz "kolejna aplikacja do raportowania" — jest kilka rzeczy, które trzeba zrozumieć.

**Po pierwsze: czas zgłoszenia.**

Użytkownik robi zdjęcie *podczas* tankowania. Nie idzie specjalnie na stację, żeby coś zgłosić. On już tam jest — zapłacił, odczekał, teraz czeka aż bak się napełni. Ma 90 sekund i nic do roboty. To jest ten moment. Zero dodatkowego wysiłku.

**Po drugie: psychologia.**

Aplikacje oparte na crowdsourcingu zazwyczaj giną z jednego powodu — koszt kontrybucji jest za wysoki, a nagroda zbyt abstrakcyjna. Desert to odwraca.

Koszt kontrybucji: 10 sekund. Jedno zdjęcie, dotknięcie "wyślij".

Nagroda: *natychmiastowa* i *osobista*. Zaraz po zgłoszeniu widzisz aktualne ceny na pobliskich stacjach. Czy zapłaciłeś dużo, czy mało? Teraz wiesz. To nie jest odległa "wartość dla społeczności" — to informacja, która mówi ci coś o tobie.

Do tego działa **efekt wzajemności** — dane, które widzisz, ktoś zgłosił dla ciebie. Naturalna chęć odwzajemnienia jest silna i dobrze udokumentowana.

A na koniec — **rywalizacja**. Rankingi kontrybucji w aplikacji tworzą element gry. Nie chodzi o wielkie nagrody. Chodzi o to, żeby być w top 10 na swojej ulicy. To wystarczy.

**Efekt sieciowy jest tutaj asymetryczny na naszą korzyść.** Przy 500 aktywnych kontrybutorow w Warszawie — mamy aktualną cenę prawie każdej stacji. Bariera wejścia dla konkurencji rośnie wykładniczo z każdym miesiącem działania.

---

## Część 3: Model

### Skąd są pieniądze

Desert nie jest aplikacją z jednym źródłem przychodów. Mamy trzy strumienie — każdy niezależny, każdy skalowalny.

**Strumień 1: Stacje i promocje**

Stacja benzynowa, która ma aktualnie najniższą cenę w okolicy, chce żebyś o tym wiedział. Desert staje się kanałem, przez który ta informacja trafia do użytkownika dokładnie w momencie, kiedy ona ma dla niego znaczenie — przy wyborze miejsca do tankowania.

Formaty: wyróżnione pozycje na mapie, banery promocji, powiadomienia push do użytkowników w promieniu. Nie reklama — **precyzyjny marketing w punkcie decyzji zakupowej**. Sieci mają budżety. Wiemy, że je wydają — dziś wydają je na billboardy przy autostradach.

**Strumień 2: Dane**

Zebrane, zwalidowane, historyczne dane cen paliw — to wartościowy surowiec. Nabywcy: fundusze towarowe, biura analityczne, firmy paliwowe śledzące benchmarki rynkowe, ubezpieczyciele, konsultanci strategiczni.

Dane sprzedawane w formie anonimowego agregatu — bez żadnych danych osobowych, w pełnej zgodności z GDPR. Model API: miesięczna subskrypcja lub dostęp per-endpoint.

**Strumień 3: Floty**

Firmy z flotami pojazdów wydają na paliwo dziesiątki lub setki tysięcy złotych miesięcznie. Desert daje im coś, czego nie mają: **widoczność w czasie rzeczywistym** — gdzie tankują ich kierowcy, ile płacą, jak to wypada na tle rynku.

Moduł flotowy to subskrypcja B2B. Decyzja zakupowa leży po stronie managera floty lub CFO — to krótki cykl sprzedaży z powtarzalnym przychodem.

---

## Część 4: Teraz, Polska, Ten Zespół

### Dlaczego to ma sens właśnie tu i właśnie teraz

**Polska jest idealnym rynkiem startowym.**

Około 33 miliony zarejestrowanych pojazdów. Wysoka gęstość infrastruktury paliwowej — ponad 8 000 stacji w stosunkowo małym obszarze geograficznym. Ceny paliw są tu realnym tematem społecznym — medialnym, politycznym, codziennym. Polacy są na to wrażliwi bardziej niż wiele innych narodów w Europie.

A jednocześnie: **rynek jest pusty**. Nie ma lokalnego gracza z aktualną, zwalidowaną bazą cen. Są aplikacje — niekompletne, nieaktualne, oparte na manualnym raportowaniu które działa przez dwa tygodnie i potem umiera. Desert to rozwiązuje mechanizmem, nie apelami do obywatelskości.

**Okno technologiczne jest teraz.**

OCR na poziomie umożliwiającym wiarygodną ekstrakcję cen ze zdjęcia — to nowe. Jeszcze dwa lata temu kosztowałoby wielokrotnie więcej i dawało gorsze wyniki. Dziś koszt jednego przetworzenia obrazu to ułamek grosza. Proof of concept to potwierdził: 80% skuteczności na normalnych zdjęciach, 100% na wyraźnych.

**PoC jest zrobiony.**

Nie rozmawiamy o hipotezie. Architektura jest zaprojektowana, technologia jest zwalidowana, pipeline działa. To, co przed nami, to budowa produktu — nie eksperyment.

---

*Desert — wiedzieć co płacisz. Zanim zapłacisz.*
