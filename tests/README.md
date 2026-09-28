# Architektura Testów i Zestaw Dowodowy E2E

> [!WARNING]
> **KOD DO ANALIZY ARCHITEKTONICZNEJ — NIE JEST SAMODZIELNIE URUCHAMIALNY W TYM REPOZYTORIUM**  
> Kod umieszczony w katalogu `tests/` został wyeksportowany z prywatnego repozytorium `sepawid/jdg_nc_app` (commit `d4776d7`).  
> Testy te nie posiadają w tym repozytorium fałszywych atrap (mocków) udających zielone wyniki — do rzeczywistego wykonania wymagają one pełnego ekosystemu: backendu FastAPI, silnika migracji Alembic oraz tymczasowej instancji bazy danych PostgreSQL z aktywnym mechanizmem Row-Level Security (RLS) i wyzwalaczami immutability.

---

## 1. Struktura Katalogu Testów

```text
tests/
├── fixtures/
│   ├── base.fixture.ts      # Rozszerzenie Playwright o barierę sieciową (Circuit Breaker)
│   └── db-helper.ts         # Klient PostgreSQL z weryfikacją loopbacku i zasady Fail-Closed
├── specs/
│   ├── ui/
│   │   ├── invoices_vertical_slice.spec.ts  # Pełny przekrój UI: demo, READ_ONLY, cykl GOLDEN-003, idempotencja
│   │   └── responsive_breakpoints.spec.ts   # Progi responsywności (1024/1023, 720/719) oraz audyt WCAG 2.1
│   ├── api/
│   │   └── api_accounting_vertical_slice.spec.ts # Integracja API + PostgreSQL: walidacja, zatwierdzenie, RLS, immutability
│   └── smoke/
│       └── circuit_breaker.spec.ts          # Zestaw negatywny weryfikujący szczelność blokady sieciowej
└── README.md                # Niniejszy przewodnik techniczny
```

---

## 2. Rola i Działanie Fixtur

### A. `fixtures/base.fixture.ts` — Bariera Sieciowa (Circuit Breaker)
Chroni przed przypadkowym wysłaniem mutujących żądań sieciowych (`POST`, `PUT`, `DELETE`, `PATCH`) poza ściśle zdefiniowane środowisko lokalne:
1. **Inspekcja URL (Loopback Only):** Dozwolonym celem mutacji jest wyłącznie interfejs zwrotny `127.0.0.1` lub `localhost`. Każdy inny adres jest bezwzględnie blokowany z błędem runtime.
2. **Wielopoziomowe opakowanie Proxy:**
   - `page.route('**', ...)`: Abortuje próby mutacji z poziomu kodu przeglądarki (`blockedbyclient`).
   - `request` i `playwright.request.newContext()`: Proxy na `APIRequestContext` blokuje metody mutujące oraz `fetch()`.
   - `globalThis.fetch`: Podmieniony procesowy fetch w Node.js blokuje mutacje i wymusza `redirect: 'error'`.
3. **Ochrona przed przekierowaniem (Redirect Guard):** Wyłącza automatyczne śledzenie przekierowań (`maxRedirects: 0`), uniemożliwiając ominięcie blokady przez odpowiedź HTTP 307 wskazującą na zewnętrzny host.

### B. `fixtures/db-helper.ts` — Bezpieczny Dostęp do Bazy (Fail-Closed)
Zapewnia, że testy mogą komunikować się wyłącznie z dedykowaną, jednorazową bazą danych:
1. **Weryfikacja hosta:** Odrzuca adresy inne niż `localhost` i `127.0.0.1`.
2. **Weryfikacja nazwy bazy:** Wymaga obecności ciągu `test` lub `e2e` w nazwie bazy danych (np. `jdg_e2e_run_...`). W przypadku podania bazy domyślnej lub produkcyjnej następuje natychmiastowe przerwanie wykonania.

---

## 3. Dlaczego Testy Wymagają Prawdziwej Bazy i Aplikacji?

W architekturze systemu JDG przyjęto zasadę **braku atrap domenowych w testach E2E**:
1. **Determinizm kwot monetarnych:** Wartości netto, VAT i brutto są przeliczane po stronie backendu na typie `Decimal` z zaokrągleniem `ROUND_HALF_UP`. Testy nie weryfikują zamockowanych odpowiedzi JSON, lecz sprawdzają, czy baza danych i backend zwróciły i zapisały dokładne wartości groszowe.
2. **Izolacja danych (RLS):** Test `TC-API-SLICE-03` udowadnia, że zapytanie o szkic faktury innej firmy zwraca `404 Not Found` (zgodnie z `INV-061`), a wiersze obcego tenanta pozostają nienaruszone. Tego zachowania nie da się rzetelnie udowodnić bez rzeczywistego silnika PostgreSQL i polityk RLS.
3. **Wyzwalacze Niezmienności (Append-Only):** Test `TC-API-SLICE-01` wykonuje bezpośrednie zapytania `UPDATE` oraz `DELETE` z poziomu bazy danych w transakcji z `SAVEPOINT`, dowodząc, że wyzwalacz `invoice_immutable_guard` wyrzuca wyjątek `DOCUMENT_IMMUTABLE`.

---

## 4. Weryfikacja i Dowód Wykonania

W prywatnym środowisku źródłowym testy uruchamiane są skryptem orkiestrującym:
```bash
bash scripts/tests/run_e2e_playwright.sh
```
Skrypt ten:
1. Weryfikuje kryptograficzny handshake tożsamości testowej.
2. Tworzy jednorazową bazę danych w PostgreSQL (np. `jdg_e2e_run_...`).
3. Aplikuje komplet migracji Alembic.
4. Uruchamia serwer backendu FastAPI na porcie 8001 oraz serwer frontendu Vite na porcie 5173 (loopback `127.0.0.1`).
5. Wykonuje zestaw testów Playwright i po ich zakończeniu bezwzględnie niszczy tymczasową bazę danych.
