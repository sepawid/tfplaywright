import { test, expect } from '../../fixtures/base.fixture';
import * as crypto from 'crypto';

test.describe('Live Synthetic Invoice Full Flow (UI + API against ager.pl)', () => {
  const demoSecret = process.env.DEMO_SECRET || process.env.DEMO_TEST_TOKEN;

  test.beforeAll(() => {
    if (!demoSecret) {
      throw new Error(
        '[SECURITY GATE ERROR] DEMO_SECRET jest wymagany do uruchomienia testów E2E z mutacjami. ' +
        'Pominięcie testu na zaufanej gałęzi jest niedozwolone — brak sekretu musi kończyć się błędem CI.'
      );
    }
  });

  let authToken: string;
  let businessId: string;
  let createdDraftId: string;
  let approvedInvoiceId: string;
  let approvedInvoiceNumber: string;

  // Unikalne klucze idempotencji dla każdego kroku
  const runId = crypto.randomUUID().slice(0, 8);
  const createIdempotencyKey = `e2e-create-${runId}`;
  const validateIdempotencyKey = `e2e-validate-${runId}`;
  const approveIdempotencyKey = `e2e-approve-${runId}`;

  // 1. Syntetyczna tożsamość
  test('Krok 1: Uzyskanie syntetycznej tożsamości demonstracyjnej przez kontrolowany nagłówek X-Demo-Secret', async ({
    request,
  }) => {
    const response = await request.post('/api/v1/demo/synthetic-session', {
      headers: {
        'X-Demo-Secret': demoSecret!,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('token');
    expect(body).toHaveProperty('business_id');
    expect(body.token).toMatch(/^synthetic-demo-[a-f0-9]{48}$/);

    authToken = body.token;
    businessId = body.business_id;
  });

  // 2. Utworzenie szkicu (GOLDEN-003)
  test('Krok 2: Utworzenie szkicu faktury sprzedaży (GOLDEN-003) z nagłówkiem Idempotency-Key', async ({ request }) => {
    const payload = {
      issue_date: '2026-08-25',
      sale_date: '2026-08-25',
      counterparty_snapshot: {
        legal_name: 'Testowy Nabywca Sp. z o.o.',
        nip: '9876543210',
        address: 'ul. Demonstracyjna 42, 00-001 Warszawa',
        country_code: 'PL',
      },
      seller_snapshot: {
        legal_name: 'Moja Firma JDG (Demo)',
        nip: '5252248481',
      },
      currency: 'PLN',
      payment_method: 'TRANSFER',
      lines: [
        {
          line_number: 1,
          description: 'Usługi doradztwa technologicznego (Syntetyczny przebieg GOLDEN-003)',
          quantity: '1.0000',
          unit: 'szt.',
          unit_price_net: '1000.00',
          vat_rate_code: 'STANDARD',
        },
      ],
    };

    const response = await request.post('/api/v1/invoices', {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Idempotency-Key': createIdempotencyKey,
      },
      data: payload,
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body).toHaveProperty('id');
    expect(body.status).toBe('DRAFT');
    expect(body.net_total).toBe('1000.00');
    expect(body.vat_total).toBe('230.00');
    expect(body.gross_total).toBe('1230.00');

    createdDraftId = body.id;
  });

  // 3. Walidacja szkicu
  test('Krok 3: Walidacja strukturalna i obliczeniowa szkicu faktury (/validate)', async ({ request }) => {
    const response = await request.post(`/api/v1/synthetic-drafts/${createdDraftId}/validate`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Idempotency-Key': validateIdempotencyKey,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.structural_status).toBe('STRUCTURALLY_VALID');
    expect(body.net_total).toBe('1000.00');
    expect(body.vat_total).toBe('230.00');
    expect(body.gross_total).toBe('1230.00');
    expect(body.content_fingerprint).toHaveLength(64);
  });

  // 4. Zatwierdzenie
  test('Krok 4: Zatwierdzenie faktury przez właściciela (przejście ze szkicu do niezmiennej faktury)', async ({
    request,
  }) => {
    const response = await request.post(`/api/v1/synthetic-drafts/${createdDraftId}/request-approval`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Idempotency-Key': approveIdempotencyKey,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('APPROVED');
    expect(body).toHaveProperty('invoice_id');
    expect(body).toHaveProperty('number');
    expect(body.number).toMatch(/^FV\/\d{4}\/\d{2}\/\d{4}$/);

    approvedInvoiceId = body.invoice_id;
    approvedInvoiceNumber = body.number;
  });

  // 5. Przeładowanie (API + UI z bezwzględną asercją DOM)
  test('Krok 5: Przeładowanie stanu w API i bezwzględna weryfikacja widoku UI po odświeżeniu', async ({
    request,
    page,
  }) => {
    // 5a. Weryfikacja API
    const apiRes = await request.get(`/api/v1/invoices/${createdDraftId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    expect(apiRes.status()).toBe(200);
    const invoiceData = await apiRes.json();
    expect(invoiceData.status).toBe('APPROVED');
    expect(invoiceData.number).toBe(approvedInvoiceNumber);
    expect(invoiceData.approved_at).not.toBeNull();

    // 5b. Weryfikacja UI — faktyczny mechanizm tożsamości aplikacji (window.__EPHEMERAL_TEST_IDENTITY__)
    // oraz nawigacja do widoku dashboardu (sessionStorage 'ager-view-mode')
    await page.addInitScript(
      ({ token }) => {
        (window as any).__EPHEMERAL_TEST_IDENTITY__ = { role: 'OWNER', token };
        sessionStorage.setItem('ager-view-mode', 'dashboard');
      },
      { token: authToken }
    );

    await page.goto('/');
    await page.reload();

    // Bezwzględna asercja: wiersz zatwierdzonej faktury MUSI być widoczny w tabeli UI.
    // Brak numeru faktury w UI to bezwzględny FAIL (żadnych warunków if/catch).
    const invoiceRow = page.locator(`[data-testid="invoice-row-${createdDraftId}"]`);
    await expect(invoiceRow).toBeVisible({ timeout: 10000 });
    await expect(invoiceRow.locator('[data-testid="invoice-number"]')).toHaveText(approvedInvoiceNumber);
    await expect(invoiceRow.locator('[data-testid="invoice-status-badge"]')).toContainText('ZATWIERDZONA');
    await expect(invoiceRow.locator('[data-testid="invoice-gross-total"]')).toContainText('1 230,00');
  });

  // 6. Uzgodnienie kwot (Niezmiennik finansowy Decimal)
  test('Krok 6: Uzgodnienie kwot i weryfikacja niezmiennika (netto + VAT = brutto)', async ({ request }) => {
    const response = await request.get(`/api/v1/invoices/${createdDraftId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status()).toBe(200);
    const inv = await response.json();

    const netCents = Math.round(parseFloat(inv.net_total) * 100);
    const vatCents = Math.round(parseFloat(inv.vat_total) * 100);
    const grossCents = Math.round(parseFloat(inv.gross_total) * 100);

    // Precyzyjne uzgodnienie groszy: 100000 + 23000 = 123000
    expect(netCents + vatCents).toBe(grossCents);
    expect(inv.net_total).toBe('1000.00');
    expect(inv.vat_total).toBe('230.00');
    expect(inv.gross_total).toBe('1230.00');
  });

  // 7. Odmowa (Bramki autoryzacji i integralności)
  test('Krok 7: Odmowa dostępu — brak tokenu, próba odczytu obcego ID (401 / 404)', async ({ request }) => {
    // 7a. Brak nagłówka Authorization na chronionym zasobie -> 401
    const unauthGet = await request.get(`/api/v1/invoices/${createdDraftId}`);
    expect(unauthGet.status()).toBe(401);
    const unauthBody = await unauthGet.json();
    expect(unauthBody.error.code).toBe('AUTHENTICATION_REQUIRED');

    // 7b. Próba zatwierdzenia bez autoryzacji -> 401
    const unauthApprove = await request.post(`/api/v1/synthetic-drafts/${createdDraftId}/request-approval`, {
      headers: {
        'Idempotency-Key': 'unauth-key-12345',
      },
    });
    expect(unauthApprove.status()).toBe(401);

    // 7c. Nieistniejący ID dokumentu -> 404 (brak ujawnienia stanu)
    const randomId = crypto.randomUUID();
    const notFoundRes = await request.get(`/api/v1/invoices/${randomId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    expect(notFoundRes.status()).toBe(404);
  });

  // 8. Idempotencja (Powtórzenie tego samego Idempotency-Key zwraca identyczny wynik)
  test('Krok 8: Idempotencja operacji zatwierdzenia i konflikt przy zmianie payloadu', async ({ request }) => {
    // 8a. Powtórzenie identycznego żądania zatwierdzenia z tym samym Idempotency-Key zwraca ten sam wynik 200
    const replayApprove = await request.post(`/api/v1/synthetic-drafts/${createdDraftId}/request-approval`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Idempotency-Key': approveIdempotencyKey,
      },
    });

    expect(replayApprove.status()).toBe(200);
    const replayBody = await replayApprove.json();
    expect(replayBody.invoice_id).toBe(approvedInvoiceId);
    expect(replayBody.number).toBe(approvedInvoiceNumber);

    // 8b. Użycie tego samego Idempotency-Key z innym payloadem przy tworzeniu faktury zwraca 409 IDEMPOTENCY_KEY_CONFLICT
    const conflictingCreate = await request.post('/api/v1/invoices', {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Idempotency-Key': createIdempotencyKey, // ten sam klucz co w Kroku 2
      },
      data: {
        issue_date: '2026-08-25',
        sale_date: '2026-08-25',
        counterparty_snapshot: {
          legal_name: 'INNY NABYWCA SP. Z O.O.', // zmiana danych!
          nip: '1111111111',
          address: 'ul. Inna 1, 00-002 Kraków',
        },
        lines: [
          {
            line_number: 1,
            description: 'Zmieniona pozycja',
            quantity: '2.0000',
            unit: 'szt.',
            unit_price_net: '500.00',
            vat_rate_code: 'STANDARD',
          },
        ],
      },
    });

    expect(conflictingCreate.status()).toBe(409);
    const conflictBody = await conflictingCreate.json();
    expect(conflictBody.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });
});
