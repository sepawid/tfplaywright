# Architektura Testów i Zestaw Dowodowy E2E

Katalog `tests/` zawiera kompletną strukturę testów systemu JDG — łącząc **żywe testy czarnej skrzynki** uruchamiane przeciwko instancji demonstracyjnej [https://ager.pl](https://ager.pl) z **kodem weryfikacji głębokich niezmienników bazy danych** wyeksportowanym z prywatnego repozytorium źródłowego `sepawid/jdg_nc_app`.

---

## 1. Dwa Światy Testów: `specs/` vs `local_analysis/`

Repozytorium rozróżnia dwa niezależne poziomy weryfikacji:

| Obszar | Środowisko docelowe | Zależności zewnętrzne | Tryb wykonania |
| :--- | :--- | :--- | :--- |
| **`tests/specs/`** | Żywe środowisko **`https://ager.pl`** | Brak (wystarczy Node.js + Chromium) | **Samodzielnie uruchamialne** (`npm test`, `npm run test:e2e`) |
| **`tests/local_analysis/`** | Lokalny silnik PostgreSQL | Backend FastAPI, migracje Alembic, baza z RLS | Wymaga `TEST_DATABASE_URL` (`npm run test:local-analysis`) |

```text
tests/
├── fixtures/
│   ├── base.fixture.ts      # Rozszerzenie Playwright o dynamiczny Circuit Breaker (opt-in dla ager.pl)
│   └── db-helper.ts         # Klient PostgreSQL z weryfikacją loopbacku i zasady Fail-Closed
├── specs/                   # TESTY ŻYWE (URUCHAMIALNE NA AGER.PL)
│   ├── smoke/
│   │   ├── public_smoke.spec.ts    # Dostępność /health, OpenAPI, renderowanie UI, obsługa 404
│   │   └── circuit_breaker.spec.ts # 7 testów negatywnych potwierdzających szczelność Circuit Breakera
│   ├── ui/
│   │   └── responsive_breakpoints.spec.ts # Progi RWD (1024/720px) + audyt dostępności WCAG 2.1 AA (Axe-core)
│   ├── api/
│   │   └── public_api_demo.spec.ts # 5 kontraktów API: brak autoryzacji, fałszywy token, usunięty /demo/session
│   └── e2e/
│       └── live_synthetic_invoice.spec.ts # Cykl życia faktury (Krok 0–8 + 0b gotowość /health/ready, tryb serial, GOLDEN-003, izolacja runId)
└── local_analysis/          # KOD REFERENCYJNY Z PRYWATNEGO REPOZYTORIUM
    ├── api_accounting_vertical_slice.spec.ts  # Cykl życia szkicu + niezmienniki finansowe (PostgreSQL)
    └── invoices_vertical_slice.spec.ts        # Przekrój UI → API → PostgreSQL (RLS, immutability)
```

---

## 2. Rola i Działanie Fixtur

### A. `fixtures/base.fixture.ts` — Dynamiczny Circuit Breaker
Chroni przed przypadkowym wysłaniem mutujących żądań sieciowych (`POST`, `PUT`, `DELETE`, `PATCH`) poza ściśle zdefiniowane środowiska:
1. **Reguła domyślna:** Mutacje dozwolone wyłącznie do interfejsu zwrotnego `127.0.0.1` lub `localhost`.
2. **Opt-in dla ager.pl:** Mutacje na demonstracyjnym środowisku `https://ager.pl` są **domyślnie zablokowane**. Ich wykonanie wymaga jawnego ustawienia zmiennej `ALLOW_DEMO_MUTATIONS=true` oraz przekazania tokenu sesji syntetycznej (`DEMO_SECRET`).
3. **Bezwzględna blokada obcych domen:** Każde żądanie mutujące do obcej domeny rzuca błąd `[CIRCUIT BREAKER]` przed nawiązaniem połączenia.
4. **Wielopoziomowa ochrona kanałów:**
   - `page.route('**', ...)`: Blokada z poziomu przeglądarki (`blockedbyclient`).
   - `request` i `playwright.request.newContext()`: Proxy na `APIRequestContext` blokujące metody mutujące oraz `fetch()`.
   - `globalThis.fetch`: Podmieniony procesowy fetch w Node.js z wymuszeniem `redirect: 'error'`.
5. **Ochrona przed przekierowaniem (Redirect Guard):** Wyłącza automatyczne śledzenie przekierowań (`maxRedirects: 0`), uniemożliwiając ominięcie blokady przez HTTP 307.

### B. `fixtures/db-helper.ts` — Bezpieczny Dostęp do Bazy (Fail-Closed)
Zapewnia, że testy integracyjne mogą komunikować się wyłącznie z dedykowaną, jednorazową bazą danych:
1. **Weryfikacja hosta:** Odrzuca adresy inne niż `localhost` i `127.0.0.1`.
2. **Weryfikacja nazwy bazy:** Wymaga obecności ciągu `test` lub `e2e` w nazwie bazy danych (np. `jdg_e2e_run_...`). W przypadku podania bazy domyślnej lub produkcyjnej następuje natychmiastowe przerwanie wykonania.

---

## 3. Dlaczego Część Testów Wymaga Prawdziwej Bazy (`local_analysis`)?

W architekturze systemu JDG przyjęto zasadę **braku atrap domenowych w testach głębokich**:
1. **Determinizm kwot monetarnych:** Wartości netto, VAT i brutto są przeliczane po stronie backendu na typie `Decimal` z zaokrągleniem `ROUND_HALF_UP`. Testy nie weryfikują zamockowanych odpowiedzi JSON, lecz sprawdzają, czy baza danych i backend zapisały dokładne wartości groszowe (`NUMERIC(12, 2)`).
2. **Izolacja danych (RLS):** Test dowodzi, że zapytanie o szkic faktury innej firmy zwraca `404 Not Found` (zgodnie z `INV-061`), a wiersze obcego tenanta pozostają nienaruszone. Tego zachowania nie da się rzetelnie udowodnić bez silnika PostgreSQL z aktywną polityką `FORCE ROW LEVEL SECURITY`.
3. **Wyzwalacze Niezmienności (Append-Only):** Test wykonuje bezpośrednie zapytania `UPDATE` oraz `DELETE` z poziomu bazy danych w transakcji z `SAVEPOINT`, dowodząc, że wyzwalacz `invoice_immutable_guard` wyrzuca wyjątek `DOCUMENT_IMMUTABLE`.

---

## 4. Wykonanie Testów

### Testy żywe przeciwko `https://ager.pl`:
```bash
# Szybkie testy dymne i walidacja Circuit Breakera
npm run test:smoke

# Responsywność RWD i audyt dostępności WCAG 2.1 AA
npm run test:ui

# Kontrakty API (tylko do odczytu)
npm run test:api

# Domyślny zestaw bezpieczny (smoke + ui + api)
npm test

# Pełny cykl życia faktury E2E (wymaga sekretu i zgody na mutacje)
ALLOW_DEMO_MUTATIONS=true DEMO_SECRET="twój-sekret" npm run test:e2e
```

### Testy analizy lokalnej (wymagają bazy PostgreSQL z migracjami):
```bash
TEST_DATABASE_URL="postgresql://user:pass@127.0.0.1:5432/jdg_test" npm run test:local-analysis
```

---

## 5. Rygor Jakościowy w CI: Zero-Skipped i Sanityzacja Artefaktów

Wszystkie przebiegi w GitHub Actions podlegają automatycznym bramkom jakości:
- **`scripts/verify_test_results.js`:** Weryfikuje raport JUnit XML i wymusza zasadę **skip != pass**. Żaden test nie może zostać pominięty (`skipped === 0`).
- **`scripts/sanitize_artifacts.py`:** Przeszukuje wygenerowane raporty HTML oraz archiwa śladów `trace.zip`, bezpowrotnie maskując wszelkie wrażliwe tokeny sesji i nagłówki autoryzacyjne przed publikacją w publicznych artefaktach CI.
