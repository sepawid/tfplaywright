/**
 * KOD DO ANALIZY — NIE JEST SAMODZIELNIE URUCHAMIALNY W TYM REPOZYTORIUM
 *
 * Źródło: sepawid/jdg_nc_app @ commit d4776d7
 * Rola: Testy integracyjne API i bazy danych PostgreSQL (Cross-Layer & Invariant Tests):
 * 1. Pełny cykl życia szkicu: DRAFT -> odmowa zatwierdzenia 409 -> walidacja 200 -> zatwierdzenie 200.
 * 2. Weryfikacja kwot i sum w tabeli invoice (precyzja Decimal) oraz powiązań ze zdarzeniami audytowymi.
 * 3. Weryfikacja niezmienności (Append-Only): PostgreSQL trigger blokuje UPDATE i DELETE na zatwierdzonej fakturze.
 * 4. Izolacja wielotenantowa (INV-060 / INV-061): próba zatwierdzenia szkicu innej firmy zwraca 404 (brak ujawnienia metadanych),
 *    pozostawiając obcy szkic nienaruszonym.
 * 5. Ochrona Circuit Breaker na poziomie APIRequestContext i blokada przekierowań (307 redirect guard).
 */

import { test, expect } from '../../fixtures/base.fixture';
import { createIsolatedDbClient } from '../../fixtures/db-helper';
import { Client } from 'pg';
import * as crypto from 'crypto';

test.describe('API Accounting & Database Vertical Slice (Local Isolated Only)', () => {
  let db: Client;
  const businessId = crypto.randomUUID();
  const actorId = crypto.randomUUID();
  const token = 'synthetic-http-token';
  const draftId = crypto.randomUUID();

  // Druga firma dla dowodu izolacji wielotenantowej (Cross-Business Non-Disclosure)
  const businessBId = crypto.randomUUID();
  const actorBId = crypto.randomUUID();
  const tokenB = 'synthetic-http-token-b';
  const draftBId = crypto.randomUUID();

  test.beforeAll(async () => {
    db = await createIsolatedDbClient();

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tokenBHash = crypto.createHash('sha256').update(tokenB).digest('hex');

    await db.query('BEGIN');
    // 1. Profil biznesowy, tożsamość i członkostwo (OWNER) dla Business A
    await db.query(`INSERT INTO business_profile (id) VALUES ($1)`, [businessId]);
    await db.query(`INSERT INTO local_identity (id, token_hash, active) VALUES ($1, $2, true)`, [actorId, tokenHash]);
    await db.query(`INSERT INTO business_membership (identity_id, business_profile_id, role, active) VALUES ($1, $2, 'OWNER', true)`, [actorId, businessId]);

    // 2. Profil biznesowy, tożsamość i członkostwo (OWNER) dla obcej firmy Business B (izolacja tenantów)
    await db.query(`INSERT INTO business_profile (id) VALUES ($1)`, [businessBId]);
    await db.query(`INSERT INTO local_identity (id, token_hash, active) VALUES ($1, $2, true)`, [actorBId, tokenBHash]);
    await db.query(`INSERT INTO business_membership (identity_id, business_profile_id, role, active) VALUES ($1, $2, 'OWNER', true)`, [actorBId, businessBId]);

    // 3. Zweryfikowane polisy (wymóg SyntheticApprovalService)
    for (const policyId of ['POLICY-040', 'POLICY-041', 'POLICY-044', 'POLICY-050', 'POLICY-053']) {
      await db.query(`
        INSERT INTO policy_gate_record (policy_identifier, effective_from, effective_to, status)
        VALUES ($1, '2024-01-01', NULL, 'VERIFIED')
        ON CONFLICT DO NOTHING
      `, [policyId]);
    }

    // 4. Konfiguracja RLS i utworzenie kompletnego szkicu faktury w Business A (zgodnego z GOLDEN-003, początkowo w statusie DRAFT)
    await db.query(`SELECT set_config('jdg.business_profile_id', $1, true)`, [businessId]);
    await db.query(`
      INSERT INTO synthetic_draft (
        id, business_profile_id, created_by, issue_date, sale_date, currency,
        content_fingerprint, structural_status, seller_name, seller_nip,
        buyer_name, buyer_nip, buyer_address
      ) VALUES ($1, $2, $3, '2026-08-23', '2026-08-01', 'PLN', $4, 'DRAFT', 'Synthetic Seller', '1111111111', 'Synthetic Buyer', '2222222222', 'Synthetic Address')
    `, [draftId, businessId, actorId, '0'.repeat(64)]);

    // Utworzenie pozycji szkicu A (1000.00 PLN netto, VAT STANDARD 23%)
    const lineId = crypto.randomUUID();
    await db.query(`
      INSERT INTO synthetic_draft_line (
        id, synthetic_draft_id, line_number, description, quantity, unit_price_net, vat_rate_code
      ) VALUES ($1, $2, 1, 'Synthetic service', 1.0000, 1000.00, 'STANDARD')
    `, [lineId, draftId]);

    // 5. Utworzenie autentycznego, istniejącego szkicu w obcej firmie Business B
    await db.query(`SELECT set_config('jdg.business_profile_id', $1, true)`, [businessBId]);
    await db.query(`
      INSERT INTO synthetic_draft (
        id, business_profile_id, created_by, issue_date, sale_date, currency,
        content_fingerprint, structural_status, seller_name, seller_nip,
        buyer_name, buyer_nip, buyer_address
      ) VALUES ($1, $2, $3, '2026-08-23', '2026-08-01', 'PLN', $4, 'STRUCTURALLY_VALID', 'Company B Seller', '3333333333', 'Company B Buyer', '4444444444', 'Company B Address')
    `, [draftBId, businessBId, actorBId, 'e'.repeat(64)]);

    const lineBId = crypto.randomUUID();
    await db.query(`
      INSERT INTO synthetic_draft_line (
        id, synthetic_draft_id, line_number, description, quantity, unit_price_net, vat_rate_code
      ) VALUES ($1, $2, 1, 'Company B service', 1.0000, 500.00, 'STANDARD')
    `, [lineBId, draftBId]);

    // Przywrócenie kontekstu sesji do Business A
    await db.query(`SELECT set_config('jdg.business_profile_id', $1, true)`, [businessId]);

    await db.query('COMMIT');
  });

  test.afterAll(async () => {
    await db.end();
  });

  test('TC-API-SLICE-01: Pełny przekrój pionowy: DRAFT -> odmowa zatwierdzenia 409 -> jawna walidacja API 200 -> zatwierdzenie API 200 -> weryfikacja kwot w PostgreSQL -> trigger immutability', async ({ request }) => {
    // KROK 1: Próba zatwierdzenia szkicu w statusie DRAFT kończy się błędem 409 INVALID_STATE_TRANSITION
    const unvalidatedResponse = await request.post(`/api/v1/synthetic-drafts/${draftId}/request-approval`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Idempotency-Key': `vertical-slice-pre-${crypto.randomUUID()}`,
      },
    });
    expect(unvalidatedResponse.status()).toBe(409);
    const unvalBody = await unvalidatedResponse.json();
    expect(unvalBody.error?.code).toBe('INVALID_STATE_TRANSITION');

    // KROK 2: Jawne, autoryzowane przejście DRAFT -> STRUCTURALLY_VALID przez API walidacji
    const validateResponse = await request.post(`/api/v1/synthetic-drafts/${draftId}/validate`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Idempotency-Key': `vertical-slice-val-${crypto.randomUUID()}`,
      },
    });
    expect(validateResponse.status()).toBe(200);
    const valBody = await validateResponse.json();
    expect(valBody.structural_status).toBe('STRUCTURALLY_VALID');
    expect(valBody.content_fingerprint).toHaveLength(64);
    expect(valBody.net_total).toBe('1000.00');
    expect(valBody.vat_total).toBe('230.00');
    expect(valBody.gross_total).toBe('1230.00');

    // KROK 3: Wywołanie endpointu zatwierdzenia z autoryzacją i kluczem idempotencji
    const response = await request.post(`/api/v1/synthetic-drafts/${draftId}/request-approval`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Idempotency-Key': `vertical-slice-${crypto.randomUUID()}`,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.number).toBe('FV/0001/08/2026');
    expect(body.status).toBe('APPROVED');
    expect(body.invoice_id).toBeDefined();

    // KROK 4: Weryfikacja stanu w bazie danych PostgreSQL (kwoty groszowe Decimal i relacje)
    const invoiceRes = await db.query(
      `SELECT id, number, net_total, vat_total, gross_total, currency FROM invoice WHERE id = $1`,
      [body.invoice_id]
    );
    expect(invoiceRes.rows).toHaveLength(1);
    const inv = invoiceRes.rows[0];
    expect(inv.number).toBe('FV/0001/08/2026');
    expect(inv.net_total).toBe('1000.00');
    expect(inv.vat_total).toBe('230.00');
    expect(inv.gross_total).toBe('1230.00');
    expect(inv.currency).toBe('PLN');

    // Weryfikacja skutków księgowych
    const effectRes = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM approved_synthetic_accounting_effect WHERE synthetic_draft_id = $1`,
      [draftId]
    );
    expect(effectRes.rows[0].cnt).toBe(1);

    // Weryfikacja precyzyjnego zdarzenia audytu (SYNTHETIC_INVOICE_APPROVED powiązanego z konkretnym invoice.id)
    const auditRes = await db.query(
      `SELECT event_type, entity_type, entity_id, result FROM audit_event WHERE entity_id = $1 AND event_type = 'SYNTHETIC_INVOICE_APPROVED'`,
      [body.invoice_id]
    );
    expect(auditRes.rows).toHaveLength(1);
    expect(auditRes.rows[0].entity_type).toBe('invoice');
    expect(auditRes.rows[0].result).toBe('SUCCEEDED');

    // KROK 5: Weryfikacja niezmienności (PostgreSQL trigger invoice_immutable_guard z SAVEPOINT)
    await db.query('BEGIN');
    try {
      await db.query(`SELECT set_config('jdg.business_profile_id', $1, true)`, [businessId]);

      // Próba UPDATE chroniona SAVEPOINT
      await db.query('SAVEPOINT sp_update');
      let updateBlocked = false;
      try {
        await db.query(`UPDATE invoice SET net_total = 2000.00 WHERE id = $1`, [body.invoice_id]);
      } catch (err: any) {
        updateBlocked = true;
        expect(err.message).toContain('DOCUMENT_IMMUTABLE');
        await db.query('ROLLBACK TO SAVEPOINT sp_update');
      }
      expect(updateBlocked, 'Próba UPDATE zatwierdzonej faktury musi zostać zablokowana przez trigger!').toBe(true);

      // Próba DELETE chroniona osobnym SAVEPOINT
      await db.query('SAVEPOINT sp_delete');
      let deleteBlocked = false;
      try {
        await db.query(`DELETE FROM invoice WHERE id = $1`, [body.invoice_id]);
      } catch (err: any) {
        deleteBlocked = true;
        expect(err.message).toContain('DOCUMENT_IMMUTABLE');
        await db.query('ROLLBACK TO SAVEPOINT sp_delete');
      }
      expect(deleteBlocked, 'Próba DELETE zatwierdzonej faktury musi zostać zablokowana przez trigger!').toBe(true);

    } finally {
      await db.query('ROLLBACK');
    }
  });

  test('TC-API-SLICE-02: Ochrona per-request w projekcie API blokuje wywołania mutujące pod adresy zewnętrzne i publiczne', async ({ request }) => {
    // [SANITYZACJA PUBLICZNA / PUBLIC REDACTION: usunięto nazwę domeny prywatnej ze ścieżki testowej]
    // Nawet gdy baseURL to lokalny port 8001, próba wykonania POST pod zewnętrzny adres rzuca błąd przed siecią
    await expect(
      request.post('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'POST https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);

    await expect(
      request.fetch('https://chroniona-domena-zewnetrzna.pl/api/v1/invoices', { method: 'POST', data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'FETCH POST https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices' is strictly forbidden/);
  });

  test('TC-API-SLICE-03: Negatywna autoryzacja 404 Non-Disclosure przy próbie zatwierdzenia ISTNIEJĄCEGO szkicu obcej firmy (INV-061)', async ({ request }) => {
    // Aktor firmy A (token) próbuje zatwierdzić istniejący w bazie szkic firmy B (draftBId)
    const response = await request.post(`/api/v1/synthetic-drafts/${draftBId}/request-approval`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Idempotency-Key': `cross-business-${crypto.randomUUID()}`,
      },
    });

    // Zgodnie z INV-061 i RLS: endpoint zwraca 404 zamiast 403, nie ujawniając istnienia obcego szkicu
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe('RESOURCE_NOT_FOUND');

    // Dowód w PostgreSQL: obcy szkic pozostał nienaruszony
    await db.query(`SELECT set_config('jdg.business_profile_id', $1, true)`, [businessBId]);

    // 1. Brak wpisu skutków księgowych dla szkicu firmy B
    const effectRes = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM approved_synthetic_accounting_effect WHERE synthetic_draft_id = $1`,
      [draftBId]
    );
    expect(effectRes.rows[0].cnt).toBe(0);

    // 2. Brak jakiejkolwiek faktury utworzonej w tabeli invoice dla firmy B
    const invoiceCountRes = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM invoice WHERE business_profile_id = $1`,
      [businessBId]
    );
    expect(invoiceCountRes.rows[0].cnt).toBe(0);

    // 3. Status strukturalny szkicu firmy B pozostał nienaruszony
    const draftStatusRes = await db.query(
      `SELECT structural_status FROM synthetic_draft WHERE id = $1`,
      [draftBId]
    );
    expect(draftStatusRes.rows[0].structural_status).toBe('STRUCTURALLY_VALID');

    // Przywrócenie sesji do Business A
    await db.query(`SELECT set_config('jdg.business_profile_id', $1, true)`, [businessId]);
  });

  test('TC-API-SLICE-04: Negatywna autoryzacja 404 dla całkowicie NIEISTNIEJĄCEGO identyfikatora UUID szkicu', async ({ request }) => {
    const nonExistentDraftId = crypto.randomUUID();
    const response = await request.post(`/api/v1/synthetic-drafts/${nonExistentDraftId}/request-approval`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Idempotency-Key': `non-existent-${crypto.randomUUID()}`,
      },
    });

    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe('RESOURCE_NOT_FOUND');
  });

  test('TC-API-SLICE-05: Zabezpieczenie przed ominięciem Circuit Breaker przez redirect 307 (Playwright maxRedirects=0 oraz global fetch redirect=error)', async ({ request }) => {
    // [SANITYZACJA PUBLICZNA / PUBLIC REDACTION: usunięto nazwę domeny prywatnej ze ścieżki testowej]
    // 1. Weryfikacja Playwright request: lokalny endpoint zwracający 307 do chronionego adresu rzuca wyjątek Circuit Breaker i nie podąża za przekierowaniem
    await expect(
      request.post('/api/v1/test-redirect-to-external', { data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'POST.*' received redirect \(HTTP 307\) to protected target 'https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices'!/);

    // 2. Weryfikacja metody fetch w APIRequestContext z maxRedirects=0
    await expect(
      request.fetch('/api/v1/test-redirect-to-external', { method: 'POST', data: { dummy: 'payload' } })
    ).rejects.toThrow(/\[CIRCUIT BREAKER\] Mutating API call 'FETCH POST.*' received redirect \(HTTP 307\) to protected target 'https:\/\/chroniona-domena-zewnetrzna\.pl\/api\/v1\/invoices'!/);

    // 3. Weryfikacja globalnego Node.js fetch: redirect='error' odrzuca próbę automatycznego przekierowania mutacji
    await expect(
      globalThis.fetch('http://127.0.0.1:8001/api/v1/test-redirect-to-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dummy: 'payload' }),
      })
    ).rejects.toThrow();
  });
});
