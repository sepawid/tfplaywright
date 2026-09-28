# Silnik Księgowy JDG — Prezentacja Architektury i Dowodów Testowych (Playwright & PostgreSQL)

[![Status](https://img.shields.io/badge/status-zapisany%20przebieg%20lokalny%20%2B%20potwierdzenie%20CI-informational)](README.md)
[![Domenowe Niezmienniki](https://img.shields.io/badge/precyzja-Decimal%20ROUND__HALF__UP-blueviolet)](README.md)
[![Zakres Prawny](https://img.shields.io/badge/regu%C5%82a-GOLDEN--003%20(w%C4%85ski%20zakres)-orange)](README.md)
[![Bezpiecze%C5%84stwo](https://img.shields.io/badge/sie%C4%87-Circuit%20Breaker%20(Loopback%20Only)-success)](README.md)

Repozytorium stanowi publiczną, statyczną prezentację architektoniczną oraz techniczną dokumentację dowodową silnika księgowego dla jednoosobowej działalności gospodarczej (JDG) w Polsce.  
Przygotowano je specjalnie z myślą o recenzentach QA i inżynierach oprogramowania, aby umożliwić szczegółową analizę rzeczywistego kodu testów Playwright, założeń niezmienniczych, matrycy ryzyk oraz dwupoziomowej ochrony integralności danych.

> [!IMPORTANT]
> **Charakter publikacji:** Niniejsze repozytorium **nie jest kopią kompletnego kodu aplikacji ani działającym środowiskiem live demo**. Stanowi ono wyselekcjonowaną wizytówkę inżynieryjną, zawierającą rzeczywisty kod testowy wyeksportowany z prywatnego repozytorium `sepawid/jdg_nc_app` (commit `d4776d7`), udokumentowane wyniki wykonania oraz zanonimizowane dowody wizualne.
> 
> **Zastrzeżenie edukacyjno-prawne:** Projekt służy celom badawczo-edukacyjnym. Nie stanowi oprogramowania księgowego dopuszczonego do obrotu gospodarczego i nie zastępuje doradztwa podatkowego. Wszystkie prezentowane dane (kontrahenci, NIP, adresy, kwoty) są w 100% syntetyczne.

---

## 1. „Zacznij tutaj” — Ścieżka Czytania na 3–5 Minut

Jeśli masz tylko kilka minut na recenzję, zapoznaj się z poniższymi kluczowymi elementami:

1. **Zrozum problem i granicę dowodu ([Sekcja 2](#2-problem-ksi%C4%99gowy-i-zakres-referencyjny-golden-003)):** Poznaj specyfikę polskiego podatku VAT w JDG oraz to, czym dokładnie jest syntetyczny przypadek referencyjny `GOLDEN-003` (a czego celowo nie dotyka).
2. **Zobacz przepływ danych i regułę `Decimal` ([Sekcja 3](#3-diagram-przep%C5%82ywu-danych-i-separacja-odpowiedzialno%C5%9Bci)):** Zwróć uwagę, że interfejs użytkownika (React 19) nie wykonuje żadnych obliczeń kwot — wszystkie wartości finansowe wyliczane są deterministycznie w backendzie (`Decimal`).
3. **Obejrzyj dowody wizualne ([Sekcja 4](#4-przebieg-scenariusza-i-dowody-wizualne)):** Zobacz zrzut `01` po wymuszonym `page.reload()`, zrzut `02` z danymi wejściowymi oraz zrzut `03` z kontrolowaną odmową w trybie demo (`INV-061`).
4. **Przeanalizuj tabelę asercji ([Sekcja 5](#5-matryca-asercji-ryzyko-%E2%9E%94-niezmiennik-%E2%9E%94-asercja-%E2%9E%94-granica-dowodu)):** Sprawdź mapowanie: jakie ryzyko biznesowe bada dany test, co dokładnie weryfikuje asercja w Playwright/SQL i czego dany test celowo **nie** dowodzi.
5. **Przejrzyj kod testów w katalogu [`tests/`](tests/):** Rzeczywisty kod specyfikacji i fixtur (w tym Circuit Breaker uniemożliwiający wyciek zapytań poza loopback).

---

## 2. Problem Księgowy i Zakres Referencyjny GOLDEN-003

### A. Realny Problem w Samodzielnej Księgowości JDG
W polskich realiach podatkowych jednoosobowej działalności gospodarczej kluczowymi wyzwaniami oprogramowania są:
1. **Determinizm obliczeń:** Niedopuszczalność stosowania typów zmiennoprzecinkowych (`float`/`double`), które w obliczeniach monetarnych wprowadzają błędy zaokrągleń groszowych.
2. **Rekoncyliacja nagłówka i pozycji:** Rygorystyczny wymóg, aby `Suma(Netto) + Suma(VAT) = Brutto` oraz by sumy pozycji wierszy zgadzały się co do grosza z sumarycznymi polami faktury przed jej zatwierdzeniem.
3. **Niezmienność po zatwierdzeniu (Append-Only):** Zgodnie z ustawą o rachunkowości i przepisami podatkowymi, zatwierdzony dokument księgowy nie może podlegać edycji ani usunięciu. Wszelkie korekty muszą odbywać się poprzez wystawienie sformalizowanego dokumentu korygującego z zachowaniem pełnego audytu.
4. **Izolacja podmiotów i poufność:** Wielotenantowość wymaga, aby zapytanie o zasób innej firmy nie tylko kończyło się odmową, ale również nie ujawniało faktu istnienia takiego zasobu (ochrona przed enumeracją identyfikatorów).

### B. Definicja Przypadku Referencyjnego `GOLDEN-003`
Przypadek `GOLDEN-003` to minimalny, kanoniczny przypadek testowy weryfikujący poprawność wdrożenia pionowego przekroju aplikacji:
- **Kierunek transakcji:** Sprzedaż krajowa,
- **Waluta:** Polski Złoty (PLN),
- **Forma opodatkowania:** Zasady ogólne (skala podatkowa),
- **Zawartość dokumentu:** 1 pozycja usługowa, kwota netto `1 000,00 PLN`, stawka podstawowa 23% VAT (`STANDARD`), podatek VAT `230,00 PLN`, kwota brutto `1 230,00 PLN`,
- **Identyfikatory:** Syntetyczny sprzedawca (NIP poprawny algorytmicznie Modulo-11), syntetyczny nabywca.

### C. Co Celowo Zostało Wyłączone z Zakresu (Explicit Non-Scope)
Przypadek `GOLDEN-003` celowo **nie obejmuje**:
- Mechanizmu Podzielonej Płatności (MPP / Split payment),
- Transakcji wewnątrzwspólnotowych (WNT / WDT) oraz procedury OSS,
- Walut obcych i przeliczeń tabel kursowych NBP,
- Faktur korygujących (korekt pozycji i danych formalnych),
- Płatności gotówkowych powyżej ustawowego limitu 15 000 PLN,
- Odwrotnego obciążenia oraz procedury marży.

---

## 3. Diagram Przepływu Danych i Separacja Odpowiedzialności

Aplikacja wykorzystuje ścisły podział odpowiedzialności (Clean / Hexagonal Architecture):

```text
 ┌─────────────────────────────────────────────────────────────┐
 │                  Warstwa Prezentacji (UI)                   │
 │   React 19 / TypeScript (wyłącznie odczyt i formatowanie)   │
 │   - Selektor ról to jedynie przełącznik widoku (Demo UI)    │
 │   - BEZWZGLĘDNY ZAKAZ: kalkulacji kwot podatków w UI        │
 └──────────────────────────────┬──────────────────────────────┘
                                │ HTTP / OpenAPI Client (JSON)
                                │ (Kwoty jako stringi Decimal, Idempotency-Key)
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                  Interfejs API (FastAPI)                    │
 │   - Bramka autoryzacji: weryfikacja nagłówka Bearer         │
 │   - Bramka idempotencji: sprawdzenie Idempotency-Key        │
 │   - Schematy Pydantic: walidacja NIP i formatów wejściowych │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                     Warstwa Aplikacji                       │
 │   - Koordynacja przypadków użycia (use cases)               │
 │   - Granice transakcji bazodanowej (BEGIN / COMMIT)         │
 │   - Generowanie zdarzeń audytowych (audit_event)            │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                     Warstwa Domenowa                        │
 │   - JEDYNE MIEJSCE OBLICZEŃ MONETARNYCH (Python Decimal)    │
 │   - Deterministyczne zaokrąglenia ROUND_HALF_UP             │
 │   - Niezmiennik: Netto + VAT = Brutto                       │
 │   - Maszyna stanów: DRAFT ➔ STRUCTURALLY_VALID ➔ APPROVED   │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                Baza Danych (PostgreSQL 16)                  │
 │   - Row-Level Security (RLS) egzekwowane na business_profile│
 │   - Triggery blokujące modyfikację (invoice_immutable_guard)│
 │   - Kryptograficzny skrót treści (SHA-256 fingerprint)      │
 └─────────────────────────────────────────────────────────────┘
```

### Punkty Wymuszenia Niezmienników
- **Gdzie powstają kwoty?** Wyłącznie w domenie backendu. Interfejs użytkownika przekazuje wyłącznie jednostkową cenę netto wpisaną przez użytkownika. Obliczenie podatku VAT (23%), kwoty brutto oraz sumarycznych wartości dokumentu następuje w Pythonie przy użyciu `Decimal(str)` z polityką `ROUND_HALF_UP`.
- **Gdzie egzekwowana jest autoryzacja?** Kontrolka wyboru roli w nagłówku UI (`role-select`) służy wyłącznie do demonstracji stanu widoku (`Widok (Demo UI)`). Faktyczna kontrola uprawnień i przynależności do firmy (`business_profile_id`) jest egzekwowana przez zależności FastAPI oraz mechanizm Row-Level Security w silniku PostgreSQL.

---

## 4. Przebieg Scenariusza i Dowody Wizualne

Wszystkie zrzuty ekranu pochodzą z rzeczywistego, zautomatyzowanego przebiegu testów Playwright w wyizolowanym środowisku lokalnym. Zostały one zanonimizowane pod kątem prywatnych domen i danych identyfikacyjnych.

### Zrzut 01: Zatwierdzona Faktura i Persystencja w PostgreSQL
Stan tabeli faktur po poprawnym przejściu cyklu życia dokumentu i wywołaniu `page.reload()` w teście `TC-UI-SLICE-02`:
- **Wymuszone odświeżenie strony:** Kluczowy moment dowodowy — wykonanie `page.reload()` zmusza klienta do ponownego pobrania stanu przez `GET /api/v1/invoices` z bazy danych, co eliminuje iluzję poprawności wynikającą ze stanu w pamięci podręcznej Reacta (`useState`).
- **Zweryfikowane dane:** Oficjalny numer `FV/0001/08/2026`, status `ZATWIERDZONA`, kontrahent `Firma Testowa Sp. z o.o.`, rekoncyliacja kwot: netto `1 000,00 PLN`, VAT `230,00 PLN`, brutto `1 230,00 PLN`.

![Zatwierdzona faktura i persystencja w PostgreSQL](assets/01_approved_invoice_persistence.png)

---

### Zrzut 02: Formularz Wystawienia Szkicu (Przypadek GOLDEN-003)
Formularz rejestracji nowej faktury wypełniony w sesji, w której aktywna jest **kontrolowana tożsamość testowa Właściciela** (`__EPHEMERAL_TEST_IDENTITY__`):
- Wprowadzone dane syntetyczne: NIP `2222222222`, data wystawienia i sprzedaży `2026-08-01`, opis `Usługi programistyczne`, ilość `1.0000`, cena netto `1000.00`, stawka VAT `STANDARD` (23%).

![Formularz wystawienia szkicu](assets/02_draft_creation_golden_003.png)

---

### Zrzut 03: Kontrolowana Odmowa w Publicznym Trybie Demo
Zachowanie aplikacji w przypadku próby edycji w trybie demonstracyjnym (brak aktywnej tożsamości testowej):
- **Bariera UI:** Formularz wyświetla ostrzeżenie o braku uprawnień i **bezwzględnie blokuje emisję żądania sieciowego HTTP do API**, co potwierdza asercja testowa `expect(invoicePostDispatched).toBe(false)`.
- **Komunikat ochronny:** Interfejs prezentuje czytelny banner blokady z kodem `INV-061` oraz informacją o trybie demonstracyjnym.

![Kontrolowana odmowa w trybie demo](assets/03_controlled_demo_refusal.png)

---

> [!NOTE]
> **Informacja o pominięciu pliku wideo:**  
> Nagranie wideo zostało celowo pominięte w publicznej prezentacji. W początkowych klatkach rejestratora przeglądarki występowały elementy identyfikacyjne infrastruktury lokalnej. Zgodnie z zasadą minimalizacji i ochrony prywatności, niniejsza dokumentacja opiera się na zweryfikowanych statycznych zrzutach ekranu oraz kodzie testów, co stanowi w pełni deterministyczny i bezpieczny materiał dowodowy.

---

## 5. Matryca Asercji: Ryzyko ➔ Niezmiennik ➔ Asercja ➔ Granica Dowodu

Poniższa tabela stanowi serce technicznej weryfikacji. Łączy ryzyka księgowe i bezpieczeństwa z konkretnymi testami w kodzie:

| Ryzyko biznesowe / księgowe | Chroniony niezmiennik | Plik i ID testu | Dane wejściowe | Obserwowana asercja (UI, API lub SQL) | Czego ten test NIE dowodzi (Granice dowodu) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Błędy zaokrągleń i dryf zmiennoprzecinkowy** | `Netto + VAT = Brutto` (wyliczenie w `Decimal`) | [`api_accounting_vertical_slice.spec.ts`](tests/specs/api/api_accounting_vertical_slice.spec.ts)<br>`TC-API-SLICE-01` | Netto `1000.00`, VAT `23%` (STANDARD) | API zwraca `200 OK`, a zapytanie SQL do tabeli `invoice` potwierdza: `net_total = '1000.00'`, `vat_total = '230.00'`, `gross_total = '1230.00'`. | Nie dowodzi poprawności dla stawek zwolnionych (ZW) ani zaokrągleń w fakturach wielopozycyjnych (`LEGAL-CHECK-002`). |
| **Nieuprawniona modyfikacja zatwierdzonej faktury** | Niezmienność zatwierdzonych zapisów (Append-Only) | [`api_accounting_vertical_slice.spec.ts`](tests/specs/api/api_accounting_vertical_slice.spec.ts)<br>`TC-API-SLICE-01` | Próba wykonania SQL `UPDATE invoice` oraz `DELETE FROM invoice` w transakcji | Wyzwalacz PostgreSQL `invoice_immutable_guard` rzuca błąd `DOCUMENT_IMMUTABLE`, operacja jest cofana do `SAVEPOINT`. | Nie zastępuje audytu uprawnień na poziomie bazy danych (np. użytkownik `postgres` z uprawnieniami superusera mógłby wyłączyć trigger). |
| **Ujawnienie istnienia danych innej firmy (Enumeracja)** | Izolacja tenantów i ochrona przed ujawnieniem (`INV-060`, `INV-061`) | [`api_accounting_vertical_slice.spec.ts`](tests/specs/api/api_accounting_vertical_slice.spec.ts)<br>`TC-API-SLICE-03` | Token Firmy A próbuje zatwierdzić istniejący szkic Firmy B | Endpoint zwraca `404 Not Found` (zamiast `403`), a zapytanie SQL potwierdza 0 wierszy skutków księgowych i nienaruszony stan szkicu B. | Nie dowodzi odporności na ataki czasowe (timing attacks) na poziomie zapytań indeksowych bazy danych. |
| **Przejście szkicu do zatwierdzenia bez walidacji** | Prawidłowość maszyny stanów dokumentu | [`api_accounting_vertical_slice.spec.ts`](tests/specs/api/api_accounting_vertical_slice.spec.ts)<br>`TC-API-SLICE-01` | Próba zatwierdzenia szkicu bezpośrednio ze stanu `DRAFT` | Endpoint `/request-approval` natychmiast zwraca `409 Conflict` z kodem błędu `INVALID_STATE_TRANSITION`. | Nie dowodzi poprawności walidacji specyficznych polskich kodów GTU czy procedur szczególnych KSeF. |
| **Duplikacja dokumentów przy ponowieniu żądania** | Deterministyczna idempotencja (`INV-030`) | [`invoices_vertical_slice.spec.ts`](tests/specs/ui/invoices_vertical_slice.spec.ts)<br>`TC-UI-SLICE-03` | Dwa żądania z identycznym nagłówkiem `Idempotency-Key` i payloadem | Oba żądania zwracają `201 Created` z identycznym `id`, a zapytanie SQL `SELECT count(*)` zwraca dokładnie `1` wiersz. | Nie dowodzi zachowania przy wygaśnięciu okna retencji kluczy idempotencji w bazie danych. |
| **Zapis danych przez rolę bez uprawnień do edycji** | Egzekwowanie uprawnień RBAC w operacjach mutujących | [`invoices_vertical_slice.spec.ts`](tests/specs/ui/invoices_vertical_slice.spec.ts)<br>`TC-UI-SLICE-01` | Tożsamość `READ_ONLY` próbuje zapisać szkic w formularzu UI | Interfejs zachowuje wprowadzone dane w formularzu i wyświetla błąd `404`, a baza danych potwierdza brak utworzenia wiersza w `synthetic_draft`. | Nie dowodzi odporności w przypadku uszkodzenia powiązań członkostwa w tabeli `business_membership`. |
| **Utrata danych lub iluzja zapisu w pamięci klienta** | Persystencja bazodanowa i re-fetch po odświeżeniu | [`invoices_vertical_slice.spec.ts`](tests/specs/ui/invoices_vertical_slice.spec.ts)<br>`TC-UI-SLICE-02` | Zatwierdzenie faktury w UI, a następnie wywołanie `page.reload()` | Po pełnym przeładowaniu przeglądarki tabela odczytuje z API numer `FV/0001/08/2026` i status `ZATWIERDZONA`. | Nie weryfikuje odporności na brak łączności sieciowej w trakcie trwania zapytania `GET`. |
| **Przypadkowy wyciek żądań mutujących poza loopback** | Bariera sieciowa Circuit Breaker | [`circuit_breaker.spec.ts`](tests/specs/smoke/circuit_breaker.spec.ts)<br>`TC-CB-01` do `TC-CB-07` | Wywołania mutujące `POST`/`PUT`/`DELETE` pod adresy zewnętrzne lub w projekcie smoke | Playwright rzuca wyjątek `[CIRCUIT BREAKER] ... strictly forbidden` przed nawiązaniem połączenia sieciowego. | Ochrona dotyczy procesu Node.js i przeglądarki testowej Playwright; nie zastępuje zapory sieciowej (firewalla) na poziomie systemu operacyjnego. |
| **Bariery dostępności dla użytkowników czytników** | Zgodność ze standardem WCAG 2.1 AA | [`responsive_breakpoints.spec.ts`](tests/specs/ui/responsive_breakpoints.spec.ts)<br>`TC-UI-02` | Zautomatyzowany skan `@axe-core/playwright` na widoku panelu | Asercja `expect(accessibilityScanResults.violations).toEqual([])` potwierdza brak naruszeń `wcag2a` oraz `wcag2aa`. | Automatyczny skan axe-core pokrywa ok. 30–40% problemów dostępności; nie zastępuje manualnego testu z użytkownikiem czytnika ekranu. |

---

## 6. Fixtury i Infrastruktura Testowa

Rzeczywisty kod fixtur znajduje się w katalogu [`tests/fixtures/`](tests/fixtures/). Kluczowe mechanizmy architektoniczne obejmują:

### A. Kryptograficzna Tożsamość Testowa (`__EPHEMERAL_TEST_IDENTITY__`)
Zamiast powolnego i zawodnego symulowania klikania w formularz logowania na ekranie:
1. Skrypt orkiestrujący testy generuje kryptograficznie bezpieczny token losowy.
2. Skrót SHA-256 tokenu jest wstrzykiwany bezpośrednio do tabeli `local_identity` tymczasowej bazy danych z przypisaniem roli (`OWNER` lub `READ_ONLY`) w transakcji `beforeAll`.
3. Fixtura Playwright wstrzykuje token do pamięci kontekstu przeglądarki przez `page.addInitScript()`.
4. Klient HTTP aplikacji dołącza nagłówek `Authorization: Bearer <token>`, co pozwala na natychmiastowe i deterministyczne testowanie ról bez naruszania izolacji.

### B. Jednorazowa Baza PostgreSQL na Każdy Przebieg
Każdy bieg testowy (`run_e2e_playwright.sh`) tworzy dedykowaną, izolowaną bazę danych w lokalnym PostgreSQL:
- Baza otrzymuje losową nazwę ze znacznikiem czasu i PID (np. `jdg_e2e_run_36460285008_...`).
- Aplikowany jest pełny łańcuch migracji Alembic.
- Po zakończeniu testów baza jest bezwzględnie usuwana (`DROP DATABASE`), co gwarantuje 100% brak zanieczyszczeń między uruchomieniami.

### C. Bariera Sieciowa Circuit Breaker
Implementacja w [`base.fixture.ts`](tests/fixtures/base.fixture.ts) zapobiega przypadkowemu uderzeniu w zewnętrzne środowiska produkcyjne lub stagingowe:
- Weryfikuje każdy docelowy adres URL — dozwolone do operacji mutujących (`POST`, `PUT`, `DELETE`, `PATCH`) są wyłącznie adresy `127.0.0.1` oraz `localhost`.
- Opakowuje metody `request.post()`, `request.fetch()`, `page.route()` oraz globalny `globalThis.fetch`.
- Wymusza `maxRedirects: 0` oraz `redirect: 'error'`, uniemożliwiając ominięcie barier za pomocą nagłówka HTTP 307.

---

## 7. Zestawienie Dowodów: Co Zostało Sprawdzone, a Czego Brak

Wiarygodność inżynieryjna wymaga precyzyjnego oddzielenia twardych dowodów od obszarów niezweryfikowanych:

| Kategoria dowodu | Zakres i metoda weryfikacji | Obserwowany wynik | Status weryfikacji |
| :--- | :--- | :--- | :--- |
| **Lokalne testy jednostkowe domeny** | `uv run pytest tests/unit` (233 testy) | Czas: ~1.2s. 100% PASS. Testy precyzji `Decimal`, sumowania VAT i algorytmu NIP. | ✅ Zweryfikowane lokalnie |
| **Lokalne testy integracyjne** | `uv run pytest tests/integration` (146 testów) | Czas: ~4.5s. 100% PASS. RLS, autoryzacja, wyzwalacze PostgreSQL. | ✅ Zweryfikowane lokalnie |
| **Lokalne testy E2E Playwright** | `bash scripts/tests/run_e2e_playwright.sh` (12 testów: 7 UI + 5 API) | Czas: ~18s. 100% PASS w Chromium na jednorazowej bazie PostgreSQL. | ✅ Zweryfikowane lokalnie |
| **CI: Weryfikacja jakości (check-all)** | GitHub Actions Job `verify` na PR #1 (`d4776d7`) | Formatowanie, lintery, analiza granic architektonicznych, testy jednostkowe i integracyjne. | ✅ Potwierdzone przez właściciela |
| **CI: Testy przeglądarkowe (test-e2e)** | GitHub Actions Job `verify` na PR #1 (`d4776d7`) | Playwright Chromium, Vite i PostgreSQL w runnerze GitHub Actions. | ✅ Potwierdzone przez właściciela |
| **Samodzielne uruchomienie w tym repozytorium** | Brak backendu FastAPI i bazy w publicznym repo | Próba uruchomienia `npm test` w tym repozytorium nie jest skonfigurowana. | ❌ Ograniczenie publicznego repo |
| **Live Demo w Internecie** | Brak publicznej instancji serwera | Brak działającego backendu w chmurze — prezentacja ma charakter statyczny. | ❌ Celowo wyłączone |
| **Wysyłka do KSeF / Urzędu Skarbowego** | Brak integracji z produkcyjnym środowiskiem MF | Aplikacja nie posiada uprawnień ani certyfikatów do wysyłki e-faktur do KSeF. | ❌ Celowo wyłączone |

---

## 8. Ograniczenia i Status Prawno-Podatkowy

1. **Status Reguły `LEGAL-CHECK-002` (Zaokrąglenia Wielopozycyjne):**
   - Przepisy ustawy o VAT dopuszczają dwie metody sumowania podatku na fakturze: metodę sumowania pozycji wierszy lub metodę kalkulacji od sumy wartości sprzedaży netto w danych stawkach.
   - W przypadku specyficznych kombinacji groszowych w fakturach wielopozycyjnych obie metody mogą dawać różnicę 1 grosza. W systemie zaimplementowano metodę sumowania wierszy, jednak status pełnej zgodności ze wszystkimi interpretacjami KIS oznaczono jako otwarty punkt audytowy (`LEGAL-CHECK-002`).
2. **Zasada Fail-Closed w Logice Księgowej:**
   - W przypadku wykrycia nieobsługiwanej stawki podatkowej, niespójności sum kontrolnych kontrahenta lub braku jednoznacznej reguły podatkowej, silnik odmawia zatwierdzenia dokumentu (`Fail-Closed`). System nie podejmuje prób zgadywania intencji użytkownika.
3. **Charakter Badawczy i Edukacyjny:**
   - Oprogramowanie powstało jako platforma badawcza czystej architektury i niezmienników finansowych. Nie może być traktowane jako substytut licencjonowanego systemu ERP/FK.
