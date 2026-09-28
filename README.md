# Silnik Księgowy JDG — Framework Testowy Playwright dla ager.pl

[![Playwright Tests](https://img.shields.io/badge/playwright-v1.50.0-green.svg)](https://playwright.dev/)
[![Dostępność](https://img.shields.io/badge/a11y-WCAG%202.1%20AA%20(Axe--core)-blue.svg)](https://www.w3.org/WAI/standards-guidelines/wcag/)
[![Środowisko Docelowe](https://img.shields.io/badge/%C5%9Brodowisko-https%3A%2F%2Fager.pl%20(Demo)-orange.svg)](https://ager.pl)
[![Domenowe Niezmienniki](https://img.shields.io/badge/precyzja-Decimal%20ROUND__HALF__UP-blueviolet)](README.md)
[![Bezpieczeństwo](https://img.shields.io/badge/sie%C4%87-Circuit%20Breaker-success)](README.md)

Repozytorium stanowi **żywy, samodzielnie uruchamialny framework testów E2E i testów kontraktowych API** oparty na frameworku Playwright (TypeScript/Node.js).  
Framework został zaprojektowany do automatycznej weryfikacji publicznego środowiska demonstracyjnego **[https://ager.pl](https://ager.pl)** oraz demonstracji wzorców inżynieryjnych weryfikacji aplikacji księgowej dla jednoosobowej działalności gospodarczej (JDG).

> [!IMPORTANT]
> **Środowisko ager.pl jest instancją demonstracyjną:** Zgodnie z deklaracją właściciela środowisko `https://ager.pl` jest publicznym demonstratorem UI/API. Wszelkie operacje wykonywane przez niniejszy zestaw testów operują **wyłącznie na danych syntetycznych** (syntetyczne identyfikatory NIP, sztuczne dane kontrahentów, demonstracyjne tokeny sesji).
>
> **Zastrzeżenie edukacyjno-badawcze:** Projekt służy celom badawczo-edukacyjnym. Nie stanowi komercyjnego oprogramowania księgowego i nie zastępuje doradztwa podatkowego.

---

## 1. Szybki Start (Uruchomienie w 60 Sekund)

Framework jest w pełni niezależny i gotowy do natychmiastowego uruchomienia na maszynie z Node.js (>= 18):

```bash
# 1. Klonowanie repozytorium
git clone https://github.com/sepawid/tfplaywright.git
cd tfplaywright

# 2. Instalacja zależności (Playwright, Axe-core, TypeScript)
npm install

# 3. Instalacja silnika przeglądarki Chromium
npx playwright install --with-deps chromium

# 4. Wykonanie pełnego zestawu testów przeciwko ager.pl
npm test
```

### Dostępne Skrypty npm

| Polecenie npm | Zakres Wykonania | Środowisko Docelowe |
| :--- | :--- | :--- |
| `npm test` | Uruchamia pełny zestaw testów (smoke, ui, api) | `https://ager.pl` |
| `npm run test:smoke` | Testy zdrowia (`/health`), specyfikacji OpenAPI i 7 testów Circuit Breakera | `https://ager.pl` |
| `npm run test:ui` | Testy responsywności (desktop/tablet/mobile) i audyt dostępności WCAG 2.1 AA | `https://ager.pl` |
| `npm run test:api` | Testy kontraktów API, bramek autoryzacji i walidacji nagłówków | `https://ager.pl` |
| `npm run report` | Otwiera interaktywny raport HTML z ostatniego uruchomienia (`playwright show-report`) | Lokalny serwer WWW |
| `npm run typecheck` | Ścisła weryfikacja typów TypeScript (`tsc --noEmit`) | Kompilator TS |

---

## 2. Architektura Frameworka i Projekty Testowe

```text
tfplaywright/
├── .github/workflows/
│   └── playwright.yml            # Zautomatyzowany rurociąg CI weryfikujący ager.pl
├── assets/                       # Dowody wizualne z zarejestrowanych przebiegów
├── playwright.config.ts          # Centralna konfiguracja środowisk i reporterów
├── package.json                  # Definicje zależności i skryptów wykonawczych
├── tsconfig.json                 # Ścisła konfiguracja kompilatora TypeScript (ESNext/Bundler)
└── tests/
    ├── fixtures/
    │   ├── base.fixture.ts       # Fixtura z dynamicznym Circuit Breakerem per-request
    │   └── db-helper.ts          # Bezpieczny klient PostgreSQL dla testów głębokich niezmienników
    └── specs/
        ├── smoke/
        │   ├── public_smoke.spec.ts    # Health check, OpenAPI spec, ładowanie UI, 404
        │   └── circuit_breaker.spec.ts # 7 negatywnych testów bariery sieciowej (TC-CB-01..07)
        ├── ui/
        │   ├── responsive_breakpoints.spec.ts # Progi responsywności i skan Axe-core WCAG 2.1 AA
        │   └── invoices_vertical_slice.spec.ts # Przekrój UI -> API z asercjami na PostgreSQL
        └── api/
            ├── public_api_demo.spec.ts # Kontrakty API, odmowa autoryzacji, walidacja Idempotency-Key
            └── api_accounting_vertical_slice.spec.ts # Cykl życia szkicu i niezmienniki finansowe
```

---

## 3. Zabezpieczenia: Dynamiczny Circuit Breaker

Kluczowym elementem architektonicznym frameworka jest **Circuit Breaker** zaimplementowany w [`tests/fixtures/base.fixture.ts`](tests/fixtures/base.fixture.ts).  
Zapobiega on przypadkowemu uderzeniu operacjami mutującymi (`POST`, `PUT`, `DELETE`, `PATCH`) w nieautoryzowane środowiska zewnętrzne lub stagingowe:

1. **Biała lista dozwolonych hostów:** Operacje mutujące mogą być kierowane wyłącznie do interfejsu loopback (`127.0.0.1`, `localhost`) oraz zadeklarowanego demonstratora `ager.pl`.
2. **Bezwzględna blokada domen obcych:** Każde żądanie skierowane do zewnętrznych domen (np. systemy bankowe, bramki płatności, nieznane webhooks) jest natychmiast przerywane z wyjątkiem `[CIRCUIT BREAKER] ... strictly forbidden` przed nawiązaniem połączenia sieciowego.
3. **Ochrona przed wyciekiem przez przekierowania HTTP 307:** Wymuszenie `maxRedirects: 0` oraz `redirect: 'error'` blokuje automatyczne podążanie za nagłówkami `Location` przy żądaniach mutujących.
4. **Pokrycie kanałów wykonawczych:** Zabezpieczeniem objęte są:
   - Playwright `request.post()`, `request.fetch()`,
   - Konteksty `page.request` oraz `page.context().request`,
   - Niezależne instancje tworzone przez `playwright.request.newContext()`,
   - Globalny procesowy `globalThis.fetch` w środowisku Node.js,
   - Żądania emitowane przez kod JavaScript w przeglądarce (`page.route` abort).

---

## 4. Matryca Asercji: Ryzyko ➔ Niezmiennik ➔ Asercja ➔ Granica Dowodu

Poniższa tabela przedstawia mapowanie ryzyk biznesowych na konkretne testy w kodzie:

| Ryzyko biznesowe / techniczne | Chroniony niezmiennik | Plik i ID testu | Obserwowana asercja (UI / API / SQL) | Granice dowodu (Co dany test dowodzi, a czego NIE) |
| :--- | :--- | :--- | :--- | :--- |
| **Niedostępność publicznej usługi demo** | Dostępność serwisu i poprawność nagłówków | [`public_smoke.spec.ts`](tests/specs/smoke/public_smoke.spec.ts)<br>`TC-SMOKE-01..03` | `GET /health` zwraca `200` i `{"status":"local-demo-only"}`. `GET /openapi.json` zwraca poprawny schemat. `GET /` serwuje UI z trwałym bannerem demo. | **Dowodzi:** Usługa działa, serwuje frontend i backend.<br>**Nie dowodzi:** Poprawności zaawansowanych kalkulacji podatkowych. |
| **Przypadkowy wyciek żądań mutujących do sieci** | Blokada wywołań zewnętrznych (Circuit Breaker) | [`circuit_breaker.spec.ts`](tests/specs/smoke/circuit_breaker.spec.ts)<br>`TC-CB-01..07` | 7 testów negatywnych potwierdza rzucenie błędu Circuit Breakera przy próbie wysłania mutacji pod nieautoryzowany adres URL lub w projekcie smoke. | **Dowodzi:** Bezpieczeństwa harnessu testowego Playwright.<br>**Nie dowodzi:** Zabezpieczeń sieciowych na poziomie firewalla OS. |
| **Błędy dostępności dla użytkowników czytników** | Zgodność ze standardem WCAG 2.1 AA | [`responsive_breakpoints.spec.ts`](tests/specs/ui/responsive_breakpoints.spec.ts)<br>`TC-UI-02` | Zautomatyzowany audyt `@axe-core/playwright` (`wcag2a`, `wcag2aa`) na żywym widoku zwraca dokładnie `0` naruszeń. | **Dowodzi:** Braku naruszeń wykrywanych algorytmicznie przez axe-core.<br>**Nie dowodzi:** Pełnej użyteczności w manualnym teście z niewidomym użytkownikiem. |
| **Nieczytelność UI na urządzeniach mobilnych** | Responsywność widoku (RWD) | [`responsive_breakpoints.spec.ts`](tests/specs/ui/responsive_breakpoints.spec.ts)<br>`TC-UI-01` | Weryfikacja progów 1024/1023px (desktop/tablet drawer) oraz 720/719px (bottom nav). Sprawdzenie celu dotykowego linków (WCAG 2.5.5 >= 44x44 px). | **Dowodzi:** Poprawności zachowania stylów CSS i breakpointów w silniku Chromium.<br>**Nie dowodzi:** Działania na fizycznych urządzeniach iOS/Safari (WebKit). |
| **Dostęp do danych bez autoryzacji** | Wymóg uwierzytelnienia (INV-060) | [`public_api_demo.spec.ts`](tests/specs/api/public_api_demo.spec.ts)<br>`TC-API-01..02` | Zapytanie `GET /api/v1/invoices` bez nagłówka `Authorization` lub z niepoprawnym tokenem zwraca `401 AUTHENTICATION_REQUIRED`. | **Dowodzi:** Bramki HTTP FastAPI odrzucają nieautoryzowane zapytania.<br>**Nie dowodzi:** Wewnętrznych reguł RLS na tabelach bazy danych. |
| **Brak idempotencji i duplikacja zapisów** | Wymóg nagłówka Idempotency-Key (INV-030) | [`public_api_demo.spec.ts`](tests/specs/api/public_api_demo.spec.ts)<br>`TC-API-03` | `POST /api/v1/synthetic-drafts/{id}/validate` bez nagłówka `Idempotency-Key` jest natychmiast odrzucany z kodem `400` lub `422`. | **Dowodzi:** FastAPI waliduje obecność nagłówka idempotencji.<br>**Nie dowodzi:** Czasu retencji kluczy w bazie danych. |
| **Błędy zaokrągleń monetarnych (Float Drift)** | Precyzja `Decimal` i reguła `Netto + VAT = Brutto` | [`api_accounting_vertical_slice.spec.ts`](tests/specs/api/api_accounting_vertical_slice.spec.ts)<br>`TC-API-SLICE-01` | Weryfikacja bezpośrednio w tabeli `invoice` w PostgreSQL: `net_total = '1000.00'`, `vat_total = '230.00'`, `gross_total = '1230.00'`. | **Wymaga:** `TEST_DATABASE_URL` (lokalna baza PostgreSQL). Zdalny test czarnoskrzynkowy z natury nie ma i nie powinien mieć dostępu do portu bazy. |
| **Modyfikacja zatwierdzonej faktury** | Niezmienność zapisów (Append-Only) | [`api_accounting_vertical_slice.spec.ts`](tests/specs/api/api_accounting_vertical_slice.spec.ts)<br>`TC-API-SLICE-01` | Wyzwalacz PostgreSQL `invoice_immutable_guard` blokuje operacje `UPDATE` i `DELETE` z błędem `DOCUMENT_IMMUTABLE`. | **Wymaga:** `TEST_DATABASE_URL`. Dowód wykonywany w środowisku z bezpośrednim dostępem do PostgreSQL. |

---

## 5. Zrzuty Ekranu i Dowody Wizualne

Zanonimizowane materiały dowodowe z zarejestrowanych przebiegów testowych znajdują się w katalogu [`assets/`](assets/):

### Zrzut 01: Zatwierdzona Faktura i Re-fetch po Odświeżeniu
Weryfikacja trwałości danych w teście `TC-UI-SLICE-02` po wykonaniu `page.reload()` (eliminacja iluzji stanu w pamięci podręcznej React):
![Zatwierdzona faktura i persystencja w PostgreSQL](assets/01_approved_invoice_persistence.png)

### Zrzut 02: Formularz Wystawienia Szkicu Faktury (GOLDEN-003)
Formularz rejestracji szkicu faktury wypełniony syntetycznymi danymi (NIP Modulo-11, usługi programistyczne, stawka VAT 23%):
![Formularz wystawienia szkicu](assets/02_draft_creation_golden_003.png)

### Zrzut 03: Kontrolowana Odmowa w Trybie Demonstracyjnym
Blokada mutacji w demonstracyjnym UI w przypadku braku aktywnej tożsamości testowej (kod `INV-061`):
![Kontrolowana odmowa w trybie demo](assets/03_controlled_demo_refusal.png)

---

## 6. Uczciwe Rozgraniczenie Odpowiedzialności (Evidence Ladder)

Wiarygodność inżynieryjna wymaga jasnego rozróżnienia pomiędzy tym, co można udowodnić testem zdalnym przeciwko `ager.pl`, a co wymaga testu integracyjnego w środowisku lokalnym:

```text
Poziom 1: Testy Jednostkowe (Domain Unit Tests)
└── Wykonywane w prywatnym repozytorium jdg_nc_app (233 testy, precyzja Decimal, algorytmy NIP, domena)

Poziom 2: Testy Wewnętrzne Bazy Danych (PostgreSQL Invariants & Triggers)
└── Wykonywane lokalnie lub w CI z bazą postgres-test (RLS, append-only triggers, audyt)
└── W tym repozytorium: specs/invariants/ uruchamiane automatycznie przy zdefiniowanym TEST_DATABASE_URL

Poziom 3: Testy Zdalne Czarnej Skrzynki (Public E2E & Smoke na ager.pl)
└── Wykonywane przez niniejsze repozytorium tfplaywright na żywo przeciwko https://ager.pl
└── Dowodzą: renderowania DOM, responsywności, braku naruszeń WCAG 2.1 AA, kontraktów OpenAPI i bramek autoryzacji HTTP
```

---

## 7. Licencja i Prawa Autorskie

Projekt udostępniany na licencji MIT w celach edukacyjnych i demonstracyjnych.  
Prawa autorskie: Sebastian <sepawid@users.noreply.github.com>.
