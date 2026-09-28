/**
 * KOD DO ANALIZY — NIE JEST SAMODZIELNIE URUCHAMIALNY W TYM REPOZYTORIUM
 *
 * Źródło: sepawid/jdg_nc_app @ commit d4776d7
 * Rola: Zestaw negatywnych testów sprawdzających barierę Circuit Breaker:
 * 1. Blokada bezpośrednich wywołań mutujących request.post i request.fetch.
 * 2. Blokada mutacji inicjowanych z kodu przeglądarki (page.route abort: blockedbyclient).
 * 3. Blokada wywołań mutujących pod pełne zewnętrzne adresy URL na poziomie pojedynczych zapytań.
 * 4. Ochrona globalnego Node.js globalThis.fetch przed wyciekiem do sieci poza loopback.
 * 5. Ochrona dynamicznie tworzonych kontekstów playwright.request.newContext oraz page.request.
 */

import { test, expect } from '../../fixtures/base.fixture';

test.describe('Circuit Breaker Negative Verification (public-smoke)', () => {
  test('TC-CB-01: Kontrolowana próba POST przez request.post zostaje zablokowana i rzuca błąd Circuit Breakera', async ({ request }) => {
    // Poprawna asercja Playwright: obietnica zwracana przez request.post(...) przekazywana jest bezpośrednio do expect()
    await expect(
      request.post('/api/v1/invoices', { data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'POST.*strictly forbidden/);
  });

  test('TC-CB-02: Kontrolowana próba POST przez request.fetch zostaje zablokowana i rzuca błąd Circuit Breakera', async ({ request }) => {
    // Weryfikacja domknięcia luki omijania przez ogólne request.fetch(url, { method: 'POST' })
    await expect(
      request.fetch('/api/v1/invoices', { method: 'POST', data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'FETCH POST.*strictly forbidden/);
  });

  test('TC-CB-03: Próba wysłania żądania POST z poziomu przeglądarki jest blokowana (blockedbyclient)', async ({ page, verifyPageMutationBlocked }) => {
    await page.goto('/');

    // Użycie helpera rejestrującego sondę przed wywołaniem akcji (brak fałszywego czerwonego testu)
    await verifyPageMutationBlocked(async () => {
      await page.evaluate(async () => {
        try {
          await fetch('/api/v1/invoices', { method: 'POST', body: '{}' });
        } catch {
          // Oczekiwany błąd sieciowy
        }
      });
    });
  });

  test('TC-CB-04: Bezwzględna blokada żądania POST pod pełny zewnętrzny adres URL na poziomie każdego zapytania', async ({ request }) => {
    // [SANITYZACJA PUBLICZNA / PUBLIC REDACTION: zanonimizowano nazwę domeny prywatnej do syntetycznego adresu 'https://chroniona-domena-zewnetrzna.pl']
    // Nawet jeśli test nie jest w projekcie smoke, wywołanie chronionego URL rzuca błąd przed wyjściem na sieć
    await expect(
      request.post('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'POST https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);

    await expect(
      request.fetch('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { method: 'POST', data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'FETCH POST https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);

    await expect(
      request.post('https://untrusted-external-domain.com/webhook', { data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'POST https:\/\/untrusted-external-domain\.com\/webhook' is strictly forbidden/);
  });

  test('TC-CB-05: Globalny procesowy fetch w Node.js blokuje mutacje pod adresy zewnętrzne i chronione', async () => {
    // [SANITYZACJA PUBLICZNA / PUBLIC REDACTION: zanonimizowano nazwę domeny prywatnej do syntetycznego adresu 'https://chroniona-domena-zewnetrzna.pl']
    // Bezpośrednie wywołanie globalThis.fetch w Node.js rzuca błąd przed wykonaniem zapytania sieciowego
    await expect(
      globalThis.fetch('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { method: 'POST', body: '{}' })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Global mutating fetch 'POST https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);

    await expect(
      globalThis.fetch('https://external-api.com/delete', { method: 'DELETE' })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Global mutating fetch 'DELETE https:\/\/external-api\.com\/delete' is strictly forbidden/);
  });

  test('TC-CB-06: Osobny kontekst API utworzony przez playwright.request.newContext() jest również chroniony', async ({ playwright }) => {
    // [SANITYZACJA PUBLICZNA / PUBLIC REDACTION: zanonimizowano nazwę domeny prywatnej do syntetycznego adresu 'https://chroniona-domena-zewnetrzna.pl']
    // Nawet gdy test tworzy zupełnie nowy kontekst API poza fixturą request, wywołania mutujące są blokowane
    const customContext = await playwright.request.newContext();
    await expect(
      customContext.post('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'POST https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);

    await expect(
      customContext.fetch('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { method: 'POST', data: {} })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'FETCH POST https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);
  });

  test('TC-CB-07: Kontekst page.request oraz page.context().request jest objęty ochroną Circuit Breaker', async ({ page }) => {
    // [SANITYZACJA PUBLICZNA / PUBLIC REDACTION: zanonimizowano nazwę domeny prywatnej do syntetycznego adresu 'https://chroniona-domena-zewnetrzna.pl']
    // APIRequestContext dostępny przez instancję page oraz context jest opakowany i blokuje mutacje
    await expect(
      page.request.post('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'POST https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);

    await expect(
      page.context().request.post('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'POST https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);

    await expect(
      page.request.fetch('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { method: 'DELETE' })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'FETCH DELETE https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);
  });
});
