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

# 4. Wykonanie testów tylko-do-odczytu (smoke + UI + API contracts)
npm run test:smoke
npm run test:ui
npm run test:api

# 5. Pełny zestaw E2E z mutacjami (wymaga DEMO_SECRET i jawnego ALLOW_DEMO_MUTATIONS=true)
ALLOW_DEMO_MUTATIONS=true DEMO_SECRET=<sekret> npm run test:e2e
```

### Dostępne Skrypty npm

| Polecenie | Zakres | Środowisko |
| :--- | :--- | :--- |
| `npm test` | Domyślny zestaw tylko do odczytu: smoke + ui + api | `https://ager.pl` |
| `npm run test:smoke` | Health, OpenAPI, Circuit Breaker (7 testów) | `https://ager.pl` |
| `npm run test:ui` | Responsywność RWD + audyt WCAG 2.1 AA (Axe-core) | `https://ager.pl` |
| `npm run test:api` | Kontrakty API, bramki autoryzacji, walidacja nagłówków | `https://ager.pl` |
| `npm run test:e2e` | **Pełny cykl życia faktury** z mutacjami (wymaga `DEMO_SECRET` i `ALLOW_DEMO_MUTATIONS=true`) | `https://ager.pl` |
| `npm run test:local-analysis` | Analiza kodu z prywatnego repo (wymaga `TEST_DATABASE_URL`) | Lokalny PostgreSQL |
| `npm run report` | Interaktywny raport HTML z ostatniego uruchomienia | Lokalny serwer |
| `npm run typecheck` | Ścisła weryfikacja typów TypeScript (`tsc --noEmit`) | Kompilator TS |

---

## 2. Architektura Frameworka

```text
tfplaywright/
├── .github/workflows/
│   └── playwright.yml               # CI: 2-poziomowy pipeline (read-only + live-mutating w environment: live-demo)
├── assets/                           # Zanonimizowane dowody wizualne z zarejestrowanych przebiegów
├── scripts/
│   ├── verify_test_results.js       # Bramka jakości Zero-Skipped: wymusza zasadę skip != pass
│   └── sanitize_artifacts.py        # Sanityzacja raportów i trace.zip przed publikacją w publicznych artefaktach
├── playwright.config.ts              # Centralna konfiguracja: 5 projektów (smoke, ui, api, e2e, local-analysis)
├── package.json                      # Zależności i skrypty wykonawcze
├── tsconfig.json                     # Ścisła konfiguracja TypeScript (ESNext/Bundler)
└── tests/
    ├── fixtures/
    │   ├── base.fixture.ts           # Fixtura z dynamicznym Circuit Breakerem (opt-in dla ager.pl)
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
    │       └── live_synthetic_invoice.spec.ts  # Cykl życia faktury (Krok 0–8 + 0b gotowość /health/ready, tryb serial, GOLDEN-003, unikalny profil runId)
    └── local_analysis/
        ├── api_accounting_vertical_slice.spec.ts  # Cykl życia szkicu + niezmienniki finansowe (PostgreSQL)
        └── invoices_vertical_slice.spec.ts        # Przekrój UI → API → PostgreSQL
```

### Projekty Playwright

| Projekt | Katalog | Mutuje dane? | Wymaga sekretu? | Domyślnie włączony? |
| :--- | :--- | :--- | :--- | :--- |
| `smoke` | `tests/specs/smoke/` | ❌ Nie | ❌ | ✅ Tak (`npm test`) |
| `ui` | `tests/specs/ui/` | ❌ Nie | ❌ | ✅ Tak (`npm test`) |
| `api` | `tests/specs/api/` | ❌ Nie (testuje odrzucenia) | ❌ | ✅ Tak (`npm test`) |
| `e2e` | `tests/specs/e2e/` | ✅ Tak (syntetyczne dane) | ✅ `DEMO_SECRET` | ⚠️ Strictly Opt-In (`ALLOW_DEMO_MUTATIONS=true`) |
| `local-analysis` | `tests/local_analysis/` | ⚠️ Wymaga lokalnej bazy | ✅ `TEST_DATABASE_URL` | ❌ Ręcznie (`test:local-analysis`) |

---

## 3. Zabezpieczenie: Dynamiczny Circuit Breaker

Kluczowym elementem frameworka jest **Circuit Breaker** w [`tests/fixtures/base.fixture.ts`](tests/fixtures/base.fixture.ts) — bariera chroniąca przed przypadkowym uderzeniem operacjami mutującymi w nieautoryzowane środowiska.

### Jak działa?

1. **Izolacja lokalna:** Mutacje (`POST`, `PUT`, `DELETE`, `PATCH`) są dozwolone na interfejsach lokalnych `127.0.0.1` oraz `localhost`.
2. **Ścisły Opt-In dla `ager.pl`:** Wszelkie mutacje na środowisku demonstracyjnym `https://ager.pl` są **domyślnie zablokowane**. Odblokowanie wymaga jawnej flagi `ALLOW_DEMO_MUTATIONS=true` oraz ważnego tokenu sesji syntetycznej (`DEMO_SECRET`).
3. **Bezpieczne ścieżki negatywne:** Jawnie dozwolone są wybrane ścieżki sond negatywnych (testujące odrzucenia `403`/`404`/`400`: `/api/v1/demo/session`, `/api/v1/demo/synthetic-session` oraz `/validate`), co pozwala na weryfikację odmów bez ryzyka mutacji.
4. **Bezwzględna blokada obcych domen:** Każde żądanie mutujące do obcej domeny jest natychmiast przerywane błędem `[CIRCUIT BREAKER]` **przed otwarciem socketu sieciowego**.
5. **Ochrona przed przekierowaniami HTTP 307:** `maxRedirects: 0` + `redirect: 'error'` blokują podążanie za nagłówkami `Location` przy mutacjach.
6. **Pokrycie kanałów:**
   - Playwright `request.post()`, `request.fetch()`,
   - Konteksty `page.request` i `page.context().request`,
   - `playwright.request.newContext()`,
   - Globalny procesowy `globalThis.fetch` (Node.js),
   - Żądania z przeglądarki (`page.route` → `abort('blockedbyclient')`).
7. **Projekt smoke:** W projekcie `smoke` **wszystkie mutacje są zablokowane** niezależnie od hosta — nawet `localhost`.

### Dlaczego to ważne?

Test Playwright z pełną przeglądarką ma potencjalnie nieograniczony dostęp sieciowy. Bez Circuit Breakera jeden błąd w URL-u testu mógłby spowodować wysłanie `POST` do systemu bankowego, bramki płatności lub produkcyjnego API. Bariera działa na zasadzie **fail-closed** — nieznane hosty i operacje bez jawnej zgody są zablokowane.

---

## 4. Testy E2E — Pełny Cykl Życia Faktury (GOLDEN-003)

Plik [`tests/specs/e2e/live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) realizuje **pełny cykl życia faktury (Krok 0–8)** na żywym środowisku:

| Krok | Co testuje | Metoda HTTP | Kluczowa asercja |
| :--- | :--- | :--- | :--- |
| **0** | Weryfikacja wersji aplikacji i rejestracja SHA | `GET /health` | Status `200`, nagłówek `X-App-Git-Sha`, zapis do `app-sha.txt` |
| **1** | Uzyskanie syntetycznej tożsamości | `POST /api/v1/demo/synthetic-session` | Token `synthetic-demo-[48 hex]`, rola przydzielona server-side |
| **2** | Utworzenie szkicu faktury (GOLDEN-003) | `POST /api/v1/invoices` | Status `201`, `DRAFT`, kwoty `1000.00 / 230.00 / 1230.00` |
| **3** | Walidacja strukturalna i obliczeniowa | `POST /validate` | `STRUCTURALLY_VALID`, fingerprint SHA-256 (64 znaki) |
| **4** | Zatwierdzenie faktury przez właściciela | `POST /request-approval` | Status `APPROVED`, numer `FV/YYYY/MM/NNNN` |
| **5** | Przeładowanie stanu (API + UI) | `GET /invoices/{id}` + `page.reload()` | Faktura widoczna w tabeli po odświeżeniu przeglądarki |
| **6** | Uzgodnienie kwot (niezmiennik finansowy) | `GET /invoices/{id}` | `net + VAT = gross` w groszach (100000 + 23000 = 123000) |
| **7** | Odmowa dostępu | `GET /invoices/{id}` bez tokenu | `401 AUTHENTICATION_REQUIRED`, nieistniejący ID → `404` |
| **8** | Idempotencja i konflikt payloadu | `POST /request-approval` (replay) | Ten sam wynik 200; zmieniony payload → `409 IDEMPOTENCY_KEY_CONFLICT` |

### Izolacja Danych i Dynamiczne Profile Syntetyczne

Każde uruchomienie testu generuje unikalny identyfikator przebiegu:
```typescript
const runId = crypto.randomUUID().slice(0, 8);
```
Identyfikator ten jest wstrzykiwany w nazwę nabywcy i pozycje faktury (`Nabywca Syntetyczny ${runId}`). Zapobiega to kolizjom identyfikatorów przy współbieżnych lub wielokrotnych uruchomieniach testów na instancji demonstracyjnej.

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

Plik [`.github/workflows/playwright.yml`](.github/workflows/playwright.yml) implementuje **dwupoziomowy pipeline bezpieczeństwa:**

```text
┌─────────────────────────────────────────────────────────┐
│ POZIOM 1: read-only                                     │
│ Wyzwalacze: push + pull_request + workflow_dispatch     │
│                                                         │
│  ✓ Skan bezpieczeństwa gitleaks (pełna historia git)    │
│  ✓ Weryfikacja typów TypeScript (tsc --noEmit)          │
│  ✓ Smoke tests (health, OpenAPI, UI, Circuit Breaker)   │
│  ✓ Kontrakty API (brak tokenu, fałszywy Bearer, 403)    │
│  ✓ Odczyt i rejestracja nagłówka X-App-Git-Sha          │
│  ✓ Weryfikacja Zero-Skipped (scripts/verify_test_results)│
│  ✓ Sanityzacja raportów (scripts/sanitize_artifacts)    │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼ (sukces Poziomu 1)
┌─────────────────────────────────────────────────────────┐
│ POZIOM 2: live-mutating (environment: live-demo)        │
│ Wyzwalacze: push do main LUB dispatch(run_mutating=true)│
│                                                         │
│  ✓ Dostęp do secrets.DEMO_SECRET w GitHub Environment   │
│  ✓ Ściśle kontrolowane ALLOW_DEMO_MUTATIONS=true        │
│  ✓ Pełny cykl życia faktury E2E (Krok 0–8, GOLDEN-003)  │
│  ✓ Unikalny runId profilu syntetycznego (brak kolizji)  │
│  ✓ Weryfikacja Zero-Skipped (scripts/verify_test_results)│
│  ✓ Sanityzacja raportów i archiwów trace.zip            │
└─────────────────────────────────────────────────────────┘
```

### Dlaczego dwupoziomowy pipeline?

- **Ochrona sekretów i środowiska:** Pull requesty z zewnętrznych gałęzi / forków nie mają dostępu do `secrets.DEMO_SECRET` ani środowiska `environment: live-demo`. Wykonują wyłącznie Poziom 1 (read-only).
- **Zasada Zero-Skipped (`skip != pass`):** W procesach CI pominięcie testu z powodu braku konfiguracji nie może być traktowane jako sukces. Skrypt `verify_test_results.js` bezwzględnie weryfikuje raport JUnit XML i odrzuca build, jeśli `skipped > 0`.
- **Sanityzacja artefaktów:** Skrypt `sanitize_artifacts.py` eliminuje ryzyko przypadkowego ujawnienia tokenów `synthetic-demo-*` czy sekretów w publicznie pobieranych archiwach zip z raportami Playwright.

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
| **Błąd w cyklu życia faktury** | **DRAFT→VALID→APPROVED** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 1–4** | Statusy HTTP 200/201, przejścia stanów | ✅ Dowodzi przejść stanów w live UI/API. ❌ Nie dowodzi wyzwalaczy PostgreSQL. |
| **Float drift / błędy zaokrągleń** | **net + VAT = gross (Decimal)** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 6** | `100000 + 23000 = 123000` (grosze) | ✅ Dowodzi niezmiennika na żywym API. ❌ Nie dowodzi typów NUMERIC w PostgreSQL. |
| **Iluzja stanu w React** | **Persystencja po reload()** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 5** | Faktura widoczna w tabeli po `page.reload()` | ✅ Dowodzi persystencji danych po odświeżeniu strony. |
| **Duplikacja przy retransmisji** | **Idempotencja zatwierdzenia** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 8** | Replay 200, zmieniony payload 409 | ✅ Dowodzi idempotencji API i wykrywania kolizji klucza. |
| **Odmowa między firmami (HTTP)** | **Bramka autoryzacji HTTP** | [`live_synthetic_invoice.spec.ts`](tests/specs/e2e/live_synthetic_invoice.spec.ts) **Krok 7** | `401` bez tokenu, `404` na obcy ID | ✅ Dowodzi bramek HTTP w FastAPI. ❌ Nie dowodzi RLS w PostgreSQL. |
| **Naruszenie zatwierdzonej faktury (Immutability)** | **Append-only w bazie (`invoice_immutable_guard`)** | Test integracyjny `test_prevent_approved_invoice_mutation` oraz `test_v4_005b_approval_and_posting.py` (w `jdg_nc_app`) | Wyzwalacz PostgreSQL rzuca wyjątek na UPDATE/DELETE | ✅ **Dowód w teście integracyjnym PostgreSQL.** ❌ Playwright widzi tylko odrzucenie HTTP. |
| **Wyciek danych między firmami (DB)** | **PostgreSQL Row Level Security (FORCE RLS)** | Testy integracyjne `test_v4_002_rls.py::test_cross_business_sql_matrix_denies_read_and_mutation` i `test_v4_005b_rls.py` (w `jdg_nc_app`) | Zapytania SQL bez pasującego `jdg.business_profile_id` zwracają 0 wierszy | ✅ **Dowód w teście integracyjnym PostgreSQL.** ❌ Playwright nie testuje bezpośrednio SQL RLS. |

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
└── Nienaruszalność (Immutability): wyzwalacz invoice_immutable_guard
    (test_invoice_approval_vulnerabilities.py::test_prevent_approved_invoice_mutation)
└── Izolacja RLS: PostgreSQL FORCE ROW LEVEL SECURITY
    (test_v4_002_rls.py::test_cross_business_sql_matrix_denies_read_and_mutation)
└── Wyzwalacze append-only, migracje Alembic, audyt bez mutacji
└── Wybrane przykłady w tests/local_analysis/ (wymagają TEST_DATABASE_URL)

Poziom 3: Testy Read-Only Czarnej Skrzynki (smoke + api)
└── To repozytorium: smoke/ i api/ uruchamiane na żywo przeciwko ager.pl
└── Dowodzą: dostępność, kontrakty OpenAPI, bramki autoryzacji HTTP 401/403, usunięte endpointy
└── NIE mogą odczytać stanu bazy ani wyzwalaczy

Poziom 4: Testy E2E z Mutacjami (GOLDEN-003 live lifecycle)
└── To repozytorium: e2e/ (Run 36481489810, SHA 24702c2) przeciwko ager.pl
└── Dowodzą: pełny cykl życia faktury w live UI/API, niezmiennik netto+VAT=brutto,
    persystencja w UI po page.reload(), ochrona idempotencji
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
| `ALLOW_DEMO_MUTATIONS` | ❌ (domyślnie `false`) | Wymaga jawnego `true`, aby odblokować mutacje na `ager.pl` |

---

## 13. Licencja i Prawa Autorskie

Projekt udostępniany na licencji MIT w celach edukacyjnych i demonstracyjnych.
Prawa autorskie: Sebastian <sepawid@users.noreply.github.com>.
