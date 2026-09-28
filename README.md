# Silnik Księgowy JDG — Framework Testowy Playwright dla ager.pl

[![Playwright Tests](https://img.shields.io/badge/playwright-v1.50.0-green.svg)](https://playwright.dev/)
[![Dostępność](https://img.shields.io/badge/a11y-WCAG%202.1%20AA%20(Axe--core)-blue.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/)
[![Środowisko Docelowe](https://img.shields.io/badge/%C5%9Brodowisko-https%3A%2F%2Fager.pl%20(Demo)-orange.svg)](https://ager.pl)
[![Domenowe Niezmienniki](https://img.shields.io/badge/precyzja-Decimal%20ROUND__HALF__UP-blueviolet)](README.md)
[![Bezpieczeństwo](https://img.shields.io/badge/sie%C4%87-Circuit%20Breaker-success)](README.md)

Repozytorium stanowi **żywy, samodzielnie uruchamialny framework testów E2E i testów kontraktowych API** oparty na frameworku Playwright (TypeScript/Node.js).
Framework weryfikuje publiczne środowisko demonstracyjne **[https://ager.pl](https://ager.pl)** — silnik księgowy dla polskiej jednoosobowej działalności gospodarczej (JDG).

> [!IMPORTANT]
> **Środowisko ager.pl jest instancją demonstracyjną:** Wszelkie operacje wykonywane przez niniejszy zestaw testów operują **wyłącznie na danych syntetycznych** (syntetyczne identyfikatory NIP, sztuczne dane kontrahentów, kontrolowane tokeny sesji).
>
> **Zastrzeżenie edukacyjno-badawcze:** Projekt służy celom badawczo-edukacyjnym. Nie stanowi komercyjnego oprogramowania księgowego i nie zastępuje doradztwa podatkowego.

---

## 1. Szybki Start

Wymagania: Node.js >= 18.

```bash
# 1. Klonowanie repozytorium
git clone https://github.com/sepawid/tfplaywright.git
cd tfplaywright

# 2. Instalacja zależności (Playwright, Axe-core, TypeScript)
npm install

# 3. Instalacja silnika przeglądarki Chromium
npx playwright install --with-deps chromium

# 4. Wykonanie testów tylko-do-odczytu (smoke + API contracts)
npm test:smoke
npm test:api

# 5. Pełny zestaw E2E z mutacjami (wymaga DEMO_SECRET)
DEMO_SECRET=<sekret> npm run test:e2e
```

### Dostępne Skrypty npm

| Polecenie | Zakres | Środowisko |
| :--- | :--- | :--- |
| `npm test` | Pełny zestaw: smoke + ui + api + e2e | `https://ager.pl` |
| `npm run test:smoke` | Health, OpenAPI, Circuit Breaker (7 testów) | `https://ager.pl` |
| `npm run test:ui` | Responsywność RWD + audyt WCAG 2.1 AA (Axe-core) | `https://ager.pl` |
| `npm run test:api` | Kontrakty API, bramki autoryzacji, walidacja nagłówków | `https://ager.pl` |
| `npm run test:e2e` | **Pełny cykl życia faktury** z mutacjami (wymaga `DEMO_SECRET`) | `https://ager.pl` |
| `npm run test:local-analysis` | Analiza kodu z prywatnego repo (wymaga `TEST_DATABASE_URL`) | Lokalny PostgreSQL |
| `npm run report` | Interaktywny raport HTML z ostatniego uruchomienia | Lokalny serwer |
| `npm run typecheck` | Ścisła weryfikacja typów TypeScript (`tsc --noEmit`) | Kompilator TS |

---

## 2. Architektura Frameworka

```text
tfplaywright/
├── .github/workflows/
│   └── playwright.yml               # CI: read-only smoke (zawsze) + mutujące E2E (tylko push/dispatch)
├── assets/                           # Zanonimizowane dowody wizualne z zarejestrowanych przebiegów
├── playwright.config.ts              # Centralna konfiguracja: 5 projektów (smoke, ui, api, e2e, local-analysis)
├── package.json                      # Zależności i 8 skryptów wykonawczych
├── tsconfig.json                     # Ścisła konfiguracja TypeScript (ESNext/Bundler)
└── tests/
    ├── fixtures/
    │   ├── base.fixture.ts           # Fixtura z dynamicznym Circuit Breakerem per-request
    │   └── db-helper.ts              # Klient PostgreSQL dla testów głębokich niezmienników
    ├── specs/
    │   ├── smoke/
    │   │   ├── public_smoke.spec.ts    # Health, OpenAPI, ładowanie UI, 404
    │   │   └── circuit_breaker.spec.ts # 7 negatywnych testów bariery sieciowej
    │   ├── ui/
    │   │   └── responsive_breakpoints.spec.ts  # RWD + audyt Axe-core WCAG 2.1 AA
    │   ├── api/
    │   │   └── public_api_demo.spec.ts # 5 testów: autoryzacja, idempotencja, usunięty endpoint, synthetic-session 403
    │   └── e2e/
    │       └── live_synthetic_invoice.spec.ts  # 8-krokowy cykl życia faktury (GOLDEN-003)
    └── local_analysis/
        ├── api_accounting_vertical_slice.spec.ts  # Cykl życia szkicu + niezmienniki finansowe (PostgreSQL)
        └── invoices_vertical_slice.spec.ts        # Przekrój UI → API → PostgreSQL
```

### Projekty Playwright

| Projekt | Katalog | Mutuje dane? | Wymaga sekretu? |
| :--- | :--- | :--- | :--- |
| `smoke` | `tests/specs/smoke/` | ❌ Nie | ❌ |
| `ui` | `tests/specs/ui/` | ❌ Nie | ❌ |
| `api` | `tests/specs/api/` | ❌ Nie (testuje odrzucenia) | ❌ |
| `e2e` | `tests/specs/e2e/` | ✅ Tak (syntetyczne dane) | ✅ `DEMO_SECRET` |
| `local-analysis` | `tests/local_analysis/` | ⚠️ Wymaga lokalnej bazy | ✅ `TEST_DATABASE_URL` |

---

## 3. Zabezpieczenie: Dynamiczny Circuit Breaker

Kluczowym elementem frameworka jest **Circuit Breaker** w [`tests/fixtures/base.fixture.ts`](tests/fixtures/base.fixture.ts) — bariera chroniąca przed przypadkowym uderzeniem operacjami mutującymi w nieautoryzowane środowiska.

### Jak działa?

1. **Biała lista:** Mutacje (`POST`, `PUT`, `DELETE`, `PATCH`) dozwolone wyłącznie do `127.0.0.1`, `localhost` i `ager.pl`.
2. **Bezwzględna blokada obcych domen:** Każde żądanie do zewnętrznej domeny jest przerywane z wyjątkiem `[CIRCUIT BREAKER]` **przed nawiązaniem połączenia sieciowego**.
3. **Ochrona przed przekierowaniami HTTP 307:** `maxRedirects: 0` + `redirect: 'error'` blokują podążanie za nagłówkami `Location` przy mutacjach.
4. **Pokrycie kanałów:**
   - Playwright `request.post()`, `request.fetch()`,
   - Konteksty `page.request` i `page.context().request`,
   - `playwright.request.newContext()`,
   - Globalny procesowy `globalThis.fetch` (Node.js),
   - Żądania z przeglądarki (`page.route` → `abort('blockedbyclient')`).
5. **Projekt smoke:** W projekcie `smoke` **wszystkie mutacje są zablokowane** niezależnie od hosta — nawet `localhost`.

### Dlaczego to ważne?

Test Playwright z pełną przeglądarką ma potencjalnie nieograniczony dostęp sieciowy. Bez Circuit Breakera jeden błąd w URL-u testu mógłby spowodować wysłanie `POST` do systemu bankowego, bramki płatności lub produkcyjnego API. Bariera działa na zasadzie **fail-closed** — nieznane hosty są domyślnie zablokowane.

---

## 4. Testy E2E — Pełny Cykl Życia Faktury (GOLDEN-003)

Plik [`tests/specs/e2e/live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) realizuje **8-krokowy test cyklu życia faktury** na żywym środowisku:

| Krok | Co testuje | Metoda HTTP | Kluczowa asercja |
| :--- | :--- | :--- | :--- |
| **1** | Uzyskanie syntetycznej tożsamości | `POST /api/v1/demo/synthetic-session` | Token `synthetic-demo-[48 hex]`, rola przydzielona server-side |
| **2** | Utworzenie szkicu faktury (GOLDEN-003) | `POST /api/v1/invoices` | Status `201`, `DRAFT`, kwoty `1000.00 / 230.00 / 1230.00` |
| **3** | Walidacja strukturalna i obliczeniowa | `POST /validate` | `STRUCTURALLY_VALID`, fingerprint SHA-256 (64 znaki) |
| **4** | Zatwierdzenie faktury przez właściciela | `POST /request-approval` | Status `APPROVED`, numer `FV/YYYY/MM/NNNN` |
| **5** | Przeładowanie stanu (API + UI) | `GET /invoices/{id}` + `page.reload()` | Faktura widoczna w tabeli po odświeżeniu przeglądarki |
| **6** | Uzgodnienie kwot (niezmiennik finansowy) | `GET /invoices/{id}` | `net + VAT = gross` w groszach (100000 + 23000 = 123000) |
| **7** | Odmowa dostępu | `GET /invoices/{id}` bez tokenu | `401 AUTHENTICATION_REQUIRED`, nieistniejący ID → `404` |
| **8** | Idempotencja i konflikt payloadu | `POST /request-approval` (replay) | Ten sam wynik 200; zmieniony payload → `409 IDEMPOTENCY_KEY_CONFLICT` |

### Co test dowodzi?

- Przejścia stanów `DRAFT → STRUCTURALLY_VALID → APPROVED` działają prawidłowo na żywym serwerze.
- Kwoty `Decimal` są poprawnie obliczane i niezmiennik `netto + VAT = brutto` jest zachowany.
- Po odświeżeniu przeglądarki (`page.reload()`) faktura jest persystentna — nie jest iluzją stanu React.
- Bramki autoryzacji HTTP odrzucają zapytania bez tokenu.
- Mechanizm idempotencji chroni przed duplikacją zapisów **i** wykrywa zmianę payloadu.

### Czego test NIE dowodzi?

- Poprawności wyzwalaczy PostgreSQL (`invoice_immutable_guard`) — wymaga testu z `TEST_DATABASE_URL`.
- Poprawności reguł RLS na poziomie bazy danych.
- Że reguły podatkowe są zgodne z aktualnym stanem prawnym (wymaga audytu ludzkiego).
- Działania na bazach innych niż PostgreSQL.

---

## 5. Testy Kontraktowe API (Read-Only)

Plik [`tests/specs/api/public_api_demo.spec.ts`](tests/specs/api/public_api_demo.spec.ts) weryfikuje **5 kontraktów API** bez żadnych mutacji:

| ID | Opis | Oczekiwany wynik |
| :--- | :--- | :--- |
| `TC-API-01` | `GET /api/v1/invoices` bez `Authorization` | `401` + `AUTHENTICATION_REQUIRED` |
| `TC-API-02` | `GET /api/v1/invoices` z fałszywym tokenem Bearer | `401` + `AUTHENTICATION_REQUIRED` |
| `TC-API-03` | `POST /validate` bez `Idempotency-Key` | `400` + `VALIDATION_FAILED` |
| `TC-API-04` | `POST /api/v1/demo/session` (stary, usunięty endpoint) | `404` lub `405` (NIGDY 200/500) |
| `TC-API-05` | `POST /api/v1/demo/synthetic-session` bez/z fałszywym `X-Demo-Secret` | `403` + `FORBIDDEN` |

> [!WARNING]
> **Reguła: HTTP 500 jest zawsze FAIL.** Testy nigdy nie akceptują statusu 500 jako poprawnego wyniku. Jeśli serwer zwraca 500 zamiast oczekiwanego kodu błędu, test pada i sygnalizuje problem w backendzie.

---

## 6. Bezpieczeństwo Dostępu Testowego

Stary endpoint `POST /api/v1/demo/session` — który pozwalał **każdemu publicznie wybrać sobie rolę** (OWNER, ACCOUNTANT) — został **trwale usunięty** (test `TC-API-04` weryfikuje to na żywo).

Nowy mechanizm:
- `POST /api/v1/demo/synthetic-session` — chroniony nagłówkiem `X-Demo-Secret` (porównanie `secrets.compare_digest`).
- Rola jest przydzielana **server-side** (zawsze `OWNER`) — żądanie nie zawiera pola `role`.
- Endpoint jest ukryty (`include_in_schema=False`) — nie pojawia się w OpenAPI.
- Bez prawidłowego sekretu zwraca `403 FORBIDDEN` (test `TC-API-05`).

---

## 7. Pipeline CI — Rozdzielenie Read-Only od Mutacji

Plik [`.github/workflows/playwright.yml`](.github/workflows/playwright.yml) implementuje **dwupoziomowy pipeline:**

```text
┌─────────────────────────────────────────────────────────┐
│ ZAWSZE (push + pull_request + workflow_dispatch)        │
│                                                         │
│  ✓ TypeScript typecheck                                 │
│  ✓ Smoke tests (health, OpenAPI, UI, Circuit Breaker)   │
│  ✓ API contract tests (autoryzacja, idempotencja, 403)  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ TYLKO push do main + workflow_dispatch (NIGDY w PR)     │
│                                                         │
│  ✓ E2E mutujące (live_synthetic_invoice.spec.ts)        │
│    → wymaga secrets.DEMO_SECRET w repozytorium          │
│    → tworzy syntetyczne dane na ager.pl                 │
│    → pomijane automatycznie jeśli sekret niedostępny    │
└─────────────────────────────────────────────────────────┘
```

**Dlaczego?** Pull requesty od zewnętrznych współpracowników (`pull_request`) nie mają dostępu do `secrets.DEMO_SECRET`. Bezpieczne jest uruchomienie testów read-only w każdym PR, ale mutujące E2E dopuszczamy dopiero po merge do `main` (zaufane zdarzenie).

---

## 8. Matryca Asercji: Ryzyko → Niezmiennik → Test → Granica Dowodu

| Ryzyko | Niezmiennik | Plik i ID | Asercja | Granica dowodu |
| :--- | :--- | :--- | :--- | :--- |
| Niedostępność usługi demo | Dostępność `/health` i frontend | [`public_smoke.spec.ts`](tests/specs/smoke/public_smoke.spec.ts) `TC-SMOKE-01..04` | `200` + JSON, OpenAPI poprawny, UI renderuje React | ✅ Dowodzi dostępności. ❌ Nie dowodzi poprawności kalkulacji. |
| Wyciek mutacji do sieci | Blokada zewnętrznych POST/PUT/DELETE | [`circuit_breaker.spec.ts`](tests/specs/smoke/circuit_breaker.spec.ts) `TC-CB-01..07` | 7 testów: rzut wyjątku Circuit Breakera | ✅ Bezpieczeństwo harnessu Playwright. ❌ Nie dowodzi firewalla OS. |
| Błędy dostępności | WCAG 2.1 AA | [`responsive_breakpoints.spec.ts`](tests/specs/ui/responsive_breakpoints.spec.ts) `TC-UI-02` | `@axe-core/playwright` → 0 naruszeń | ✅ Brak algorytmicznych naruszeń. ❌ Nie zastępuje testu z niewidomym użytkownikiem. |
| UI nieczytelny na mobile | Responsywność RWD | [`responsive_breakpoints.spec.ts`](tests/specs/ui/responsive_breakpoints.spec.ts) `TC-UI-01` | Breakpointy 1024/720px, cele dotykowe ≥44×44px | ✅ CSS w Chromium. ❌ Nie testuje iOS/Safari. |
| Dostęp bez autoryzacji | Wymóg tokenu (INV-060) | [`public_api_demo.spec.ts`](tests/specs/api/public_api_demo.spec.ts) `TC-API-01..02` | `401 AUTHENTICATION_REQUIRED` | ✅ Bramki HTTP. ❌ Nie testuje RLS w PostgreSQL. |
| Duplikacja zapisów | Idempotency-Key (INV-030) | [`public_api_demo.spec.ts`](tests/specs/api/public_api_demo.spec.ts) `TC-API-03` | `400` bez `Idempotency-Key` | ✅ Walidacja nagłówka. ❌ Nie testuje retencji kluczy w DB. |
| Publiczny dostęp do sesji | Usunięcie `POST /demo/session` | [`public_api_demo.spec.ts`](tests/specs/api/public_api_demo.spec.ts) `TC-API-04` | `404` lub `405` (NIGDY 200) | ✅ Endpoint niedostępny. |
| Wydanie tokenu bez sekretu | `X-Demo-Secret` wymagany | [`public_api_demo.spec.ts`](tests/specs/api/public_api_demo.spec.ts) `TC-API-05` | `403 FORBIDDEN` | ✅ Bramka sekretu. ❌ Nie testuje timing-safe porównania. |
| **Błąd w cyklu życia faktury** | **DRAFT→VALID→APPROVED** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 1–4** | Statusy HTTP 200/201, przejścia stanów | ✅ Przejścia na żywym serwerze. ❌ Nie testuje wyzwalaczy DB. |
| **Float drift / błędy zaokrągleń** | **net + VAT = gross (Decimal)** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 6** | `100000 + 23000 = 123000` (grosze) | ✅ Niezmiennik na żywym API. ❌ Nie testuje NUMERIC w PostgreSQL. |
| **Iluzja stanu w React** | **Persystencja po reload()** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 5** | Faktura widoczna po `page.reload()` | ✅ Dane z API, nie z cache. |
| **Duplikacja przy retransmisji** | **Idempotencja zatwierdzenia** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 8** | Replay 200, zmieniony payload 409 | ✅ Idempotencja + wykrycie konfliktu. |
| **Odmowa między firmami** | **Izolacja danych** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 7** | `401` bez tokenu, `404` na obcy ID | ✅ Bramki HTTP. ❌ Nie testuje RLS. |

---

## 9. Zrzuty Ekranu i Dowody Wizualne

Zanonimizowane materiały dowodowe z zarejestrowanych przebiegów testowych w katalogu [`assets/`](assets/):

### Zrzut 01: Zatwierdzona Faktura i Re-fetch po Odświeżeniu
Weryfikacja trwałości danych po `page.reload()` — eliminacja iluzji stanu w pamięci React:
![Zatwierdzona faktura i persystencja w PostgreSQL](assets/01_approved_invoice_persistence.png)

### Zrzut 02: Formularz Wystawienia Szkicu Faktury (GOLDEN-003)
Formularz rejestracji szkicu z syntetycznymi danymi (NIP Modulo-11, usługi programistyczne, stawka VAT 23%):
![Formularz wystawienia szkicu](assets/02_draft_creation_golden_003.png)

### Zrzut 03: Kontrolowana Odmowa w Trybie Demonstracyjnym
Blokada mutacji w demonstracyjnym UI w przypadku braku aktywnej tożsamości testowej (INV-061):
![Kontrolowana odmowa w trybie demo](assets/03_controlled_demo_refusal.png)

---

## 10. Drabina Dowodowa (Evidence Ladder)

Wiarygodność inżynieryjna wymaga jasnego rozróżnienia pomiędzy tym, co dany test udowadnia, a czego nie:

```text
Poziom 1: Testy Jednostkowe Domeny
└── W prywatnym repozytorium jdg_nc_app (248+ testów)
└── Precyzja Decimal, algorytmy NIP Modulo-11, walidatory domeny
└── Nie są dostępne w tym publicznym repozytorium

Poziom 2: Testy Integracyjne PostgreSQL
└── W prywatnym repozytorium jdg_nc_app (146+ testów)
└── RLS, wyzwalacze append-only, migracje Alembic, audyt
└── Wybrane przykłady w tests/local_analysis/ (wymagają TEST_DATABASE_URL)

Poziom 3: Testy Read-Only Czarnej Skrzynki (smoke + api)
└── To repozytorium: smoke/ i api/ uruchamiane na żywo przeciwko ager.pl
└── Dowodzą: dostępność, kontrakty OpenAPI, bramki autoryzacji, usunięte endpointy
└── NIE mogą odczytać stanu bazy ani wyzwalaczy

Poziom 4: Testy E2E z Mutacjami (GOLDEN-003 live lifecycle)
└── To repozytorium: e2e/ uruchamiane przeciwko ager.pl (z DEMO_SECRET)
└── Dowodzą: cykl życia faktury, niezmiennik netto+VAT=brutto, persystencja
└── po reload(), idempotencja, izolacja dostępu
└── NIE mogą zweryfikować stanu PostgreSQL ani wyzwalaczy bezpośrednio

Poziom 5: CI z Zielonymi Statusami (Potwierdzenie Właściciela)
└── Prywatne repo jdg_nc_app: PR #1 SHA d4776d7 — oba kroki zielone
└── Status potwierdzony przez właściciela (CI niezweryfikowalny publicznie)
└── Bez dostępu do prywatnych logów, artefaktów ani tokenów
```

> [!NOTE]
> **Poziomy 1–2 i 5 nie są samodzielnie weryfikowalne z tego publicznego repo.** Pliki w `tests/local_analysis/` pokazują rzeczywisty kod testów z prywatnego repozytorium, ale nie uruchomią się bez lokalnego PostgreSQL i kodu aplikacji.

---

## 11. Powiązanie z Prywatnym Repozytorium

To publiczne repozytorium jest **prezentacją** — kod źródłowy aplikacji znajduje się w prywatnym `sepawid/jdg_nc_app`.

| Aspekt | Prywatne `jdg_nc_app` | Publiczne `tfplaywright` |
| :--- | :--- | :--- |
| Kod aplikacji (Python/FastAPI) | ✅ Kanoniczne źródło | ❌ Niedostępny |
| Frontend (React/TypeScript) | ✅ Kanoniczne źródło | ❌ Niedostępny |
| Migracje Alembic (PostgreSQL) | ✅ 18 migracji | ❌ Niedostępne |
| Testy jednostkowe domeny | ✅ 248+ testów | ❌ Niedostępne |
| Testy integracyjne DB | ✅ 146+ testów | ⚠️ Przykłady w `local_analysis/` |
| Testy E2E Playwright (czarna skrzynka) | ❌ | ✅ **Kanoniczne źródło** |
| Circuit Breaker | ❌ | ✅ **Kanoniczne źródło** |
| CI weryfikacja ager.pl | ❌ | ✅ **GitHub Actions** |

---

## 12. Zmienne Środowiskowe

| Zmienna | Wymagana? | Opis |
| :--- | :--- | :--- |
| `PLAYWRIGHT_BASE_URL` | ❌ (domyślnie `https://ager.pl`) | Bazowy URL docelowego serwera |
| `DEMO_SECRET` | ✅ dla `test:e2e` | Sekret do endpointu `/api/v1/demo/synthetic-session` |
| `DEMO_TEST_TOKEN` | ⚠️ alternatywa `DEMO_SECRET` | Alias sekretu (obsługiwany dla kompatybilności) |
| `TEST_DATABASE_URL` | ✅ dla `test:local-analysis` | Connection string PostgreSQL (`postgresql://...`) |
| `ALLOW_DEMO_MUTATIONS` | ❌ (domyślnie `true`) | Ustawienie na `false` blokuje mutacje na ager.pl |

---

## 13. Licencja i Prawa Autorskie

Projekt udostępniany na licencji MIT w celach edukacyjnych i demonstracyjnych.
Prawa autorskie: Sebastian <sepawid@users.noreply.github.com>.
