/**
 * KOD DO ANALIZY — NIE JEST SAMODZIELNIE URUCHAMIALNY W TYM REPOZYTORIUM
 *
 * Źródło: sepawid/jdg_nc_app @ commit d4776d7
 * Rola: Kompleksowy test E2E weryfikujący pionowy przekrój (Vertical Slice) UI -> API -> PostgreSQL:
 * 1. Kontrolowana odmowa w publicznym trybie demonstracyjnym (blokada sieciowa + banner INV-061).
 * 2. Odmowa zapisu dla roli READ_ONLY (zachowanie formularza w UI, 404 w API, 0 rekordów w PostgreSQL).
 * 3. Pełny cykl referencyjny GOLDEN-003: formularz -> walidacja -> zatwierdzenie -> page.reload()
 *    oraz bezpośrednia asercja na tabelach invoice, approved_synthetic_accounting_effect,
 *    document_version i synthetic_draft w bazie PostgreSQL.
 * 4. Idempotencja (Idempotency-Key): powtórzenie żądania nie tworzy drugiego rekordu w bazie;
 *    zmiana zawartości generuje nowy klucz.
 */

import { test, expect } from '../../fixtures/base.fixture';
import { createIsolatedDbClient } from '../../fixtures/db-helper';
import { Client } from 'pg';
import * as crypto from 'crypto';

test.describe('UI Accounting Vertical Slice (Chromium + Local Isolated PostgreSQL)', () => {
  let db: Client;
  const businessId = crypto.randomUUID();
  const ownerActorId = crypto.randomUUID();
  const ownerToken = `synthetic-owner-token-${crypto.randomUUID()}`;
  const readOnlyActorId = crypto.randomUUID();
  const readOnlyToken = `synthetic-readonly-token-${crypto.randomUUID()}`;

  test.beforeAll(async () => {
    db = await createIsolatedDbClient();

    const ownerHash = crypto.createHash('sha256').update(ownerToken).digest('hex');
    const readOnlyHash = crypto.createHash('sha256').update(readOnlyToken).digest('hex');

    await db.query('BEGIN');

    // 1. Profil biznesowy
    await db.query(`INSERT INTO business_profile (id) VALUES ($1)`, [businessId]);

    // 2. Tożsamość i członkostwo: OWNER
    await db.query(
      `INSERT INTO local_identity (id, token_hash, active) VALUES ($1, $2, true)`,
      [ownerActorId, ownerHash]
    );
    await db.query(
      `INSERT INTO business_membership (identity_id, business_profile_id, role, active) VALUES ($1, $2, 'OWNER', true)`,
      [ownerActorId, businessId]
    );

    // 3. Tożsamość i członkostwo: READ_ONLY
    await db.query(
      `INSERT INTO local_identity (id, token_hash, active) VALUES ($1, $2, true)`,
      [readOnlyActorId, readOnlyHash]
    );
    await db.query(
      `INSERT INTO business_membership (identity_id, business_profile_id, role, active) VALUES ($1, $2, 'READ_ONLY', true)`,
      [readOnlyActorId, businessId]
    );

    // 4. Pinned verified policy gate records (GOLDEN-003 requirements)
    for (const policyId of ['POLICY-040', 'POLICY-041', 'POLICY-044', 'POLICY-050', 'POLICY-053']) {
      await db.query(
        `
        INSERT INTO policy_gate_record (policy_identifier, effective_from, effective_to, status)
        VALUES ($1, '2024-01-01', NULL, 'VERIFIED')
        ON CONFLICT DO NOTHING
      `,
        [policyId]
      );
    }

    await db.query('COMMIT');
  });

  test.afterAll(async () => {
    await db.end();
  });

  test('TC-UI-SLICE-00: Granica publicznego demo: brak tożsamości blokuje wysłanie formularza do API, a selektor ról jest oznaczony jako Demo UI', async ({
    page,
  }) => {
    // Brak wstrzyknięcia tożsamości testowej -> publiczny tryb demo
    await page.goto('/');
    const enterDashboardBtn = page.getByRole('button', { name: /otwórz panel księgowy/i });
    if (await enterDashboardBtn.isVisible()) {
      await enterDashboardBtn.click();
    }

    // Weryfikacja: selektor ról wyraźnie wskazuje na perspektywę demonstracyjną UI, a nie uwierzytelnienie
    const roleSwitcher = page.getByTestId('role-switcher-container');
    await expect(roleSwitcher).toBeVisible();
    await expect(roleSwitcher).toContainText('Widok (Demo UI):');
    const roleSelect = page.locator('#role-select');
    await expect(roleSelect.locator('option[value="OWNER"]')).toHaveText('Właściciel (Demo UI)');

    // Otwarcie modalu wystawiania faktury
    const newDraftBtn = page.getByTestId('new-draft-button');
    await expect(newDraftBtn).toBeVisible();
    await newDraftBtn.click();

    // Weryfikacja ostrzeżenia o braku tożsamości w modalu
    await expect(page.getByTestId('demo-mode-warning')).toBeVisible();

    // Nasłuchiwanie na żądania sieciowe: sprawdzamy, czy żadne żądanie POST do /api/v1/invoices nie zostanie wyemitowane
    let invoicePostDispatched = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/invoices') && req.method() === 'POST') {
        invoicePostDispatched = true;
      }
    });

    // Próba wysłania formularza w trybie demo
    await page.getByTestId('submit-draft-button').click();

    // Weryfikacja: żądanie sieciowe NIE zostało wysłane
    expect(invoicePostDispatched).toBe(false);

    // Weryfikacja: modal wyświetla czytelny komunikat blokady demo (INV-061)
    const errorBanner = page.getByTestId('modal-error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('Tryb demonstracyjny');
    await expect(errorBanner).toContainText('INV-061');

    await page.getByTestId('cancel-draft-button').click();
    await expect(page.getByTestId('input-buyer-name')).toBeHidden();
  });

  test('TC-UI-SLICE-01: Odmowa zapisu dla roli READ_ONLY: komunikat błędu 404, formularz zachowany, brak wierszy w DB', async ({
    page,
  }) => {
    // Wstrzykujemy tożsamość READ_ONLY w pamięci przeglądarki
    await page.addInitScript(
      ({ token, role }) => {
        (window as any).__EPHEMERAL_TEST_IDENTITY__ = { token, role };
      },
      { token: readOnlyToken, role: 'READ_ONLY' as const }
    );

    await page.goto('/');
    const enterDashboardBtn = page.getByRole('button', { name: /otwórz panel księgowy/i });
    if (await enterDashboardBtn.isVisible()) {
      await enterDashboardBtn.click();
    }

    // Otwarcie modalu nowej faktury
    const newDraftBtn = page.getByTestId('new-draft-button');
    await expect(newDraftBtn).toBeVisible();
    await newDraftBtn.click();

    // Wypełnienie formularza
    await page.getByTestId('input-buyer-name').fill('Firma Testowa Sp. z o.o.');
    await page.getByTestId('input-buyer-nip').fill('2222222222');
    await page.getByTestId('input-buyer-address').fill('ul. Prosta 1, 00-001 Warszawa');
    await page.getByTestId('input-item-desc').fill('Konsultacje odmowne');
    await page.getByTestId('input-item-qty').fill('1.0000');
    await page.getByTestId('input-item-net').fill('500.00');

    // Kliknięcie Zapisz szkic
    await page.getByTestId('submit-draft-button').click();

    // Weryfikacja: modal pozostaje otwarty, wyświetla banner błędu 404
    const errorBanner = page.getByTestId('modal-error-banner');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('404');

    // Weryfikacja nienaruszalności wpisanych danych w formularzu
    await expect(page.getByTestId('input-buyer-name')).toHaveValue('Firma Testowa Sp. z o.o.');
    await expect(page.getByTestId('input-buyer-nip')).toHaveValue('2222222222');
    await expect(page.getByTestId('input-item-desc')).toHaveValue('Konsultacje odmowne');

    // Anulowanie modalu
    await page.getByTestId('cancel-draft-button').click();
    await expect(page.getByTestId('input-buyer-name')).toBeHidden();

    // Asercja bezpośrednia w PostgreSQL: ani jeden szkic nie powstał
    const res = await db.query(
      'SELECT count(*)::int as cnt FROM synthetic_draft WHERE business_profile_id = $1',
      [businessId]
    );
    expect(res.rows[0].cnt).toBe(0);
  });

  test('TC-UI-SLICE-02: Pełny cykl w Chromium: Utwórz szkic GOLDEN-003 -> Zatwierdź -> page.reload() -> Weryfikacja kwot i numeru z PostgreSQL', async ({
    page,
  }) => {
    // Wstrzykujemy tożsamość OWNER w pamięci przeglądarki
    await page.addInitScript(
      ({ token, role }) => {
        (window as any).__EPHEMERAL_TEST_IDENTITY__ = { token, role };
      },
      { token: ownerToken, role: 'OWNER' as const }
    );

    await page.goto('/');
    const enterDashboardBtn = page.getByRole('button', { name: /otwórz panel księgowy/i });
    if (await enterDashboardBtn.isVisible()) {
      await enterDashboardBtn.click();
    }

    // Otwarcie modalu wystawiania faktury
    const newDraftBtn = page.getByTestId('new-draft-button');
    await expect(newDraftBtn).toBeVisible();
    await newDraftBtn.click();

    // Wypełnienie formularza danymi GOLDEN-003
    await page.getByTestId('input-buyer-name').fill('Firma Testowa Sp. z o.o.');
    await page.getByTestId('input-buyer-nip').fill('2222222222');
    await page.getByTestId('input-buyer-address').fill('ul. Prosta 1, 00-001 Warszawa');
    await page.getByTestId('input-issue-date').fill('2026-08-01');
    await page.getByTestId('input-sale-date').fill('2026-08-01');
    await page.getByTestId('input-item-desc').fill('Usługi programistyczne');
    await page.getByTestId('input-item-qty').fill('1.0000');
    await page.getByTestId('input-item-net').fill('1000.00');
    await page.getByTestId('select-item-rate').selectOption('STANDARD');

    // Zapisanie szkicu przez API
    await page.getByTestId('submit-draft-button').click();

    // Modal zostaje zamknięty po sukcesie
    await expect(page.getByTestId('input-buyer-name')).toBeHidden();

    // Weryfikacja pojawienia się szkicu w tabeli
    const statusBadge = page.getByTestId('invoice-status-badge').first();
    await expect(statusBadge).toBeVisible();
    await expect(statusBadge).toHaveText(/SZKIC/);

    const buyerName = page.getByTestId('invoice-buyer-name').first();
    await expect(buyerName).toHaveText('Firma Testowa Sp. z o.o.');

    await expect(page.getByTestId('invoice-net-total').first()).toHaveText('1 000,00');
    await expect(page.getByTestId('invoice-vat-total').first()).toHaveText('230,00');
    await expect(page.getByTestId('invoice-gross-total').first()).toHaveText('1 230,00');

    // Kliknięcie "Zatwierdź" w UI (inicjuje: validateSyntheticDraft -> requestSyntheticApproval -> reload z API)
    const approveBtn = page.getByTestId('approve-button').first();
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // Po zatwierdzeniu status zmienia się na ZATWIERDZONA, a numer z bazy na FV/0001/08/2026
    await expect(statusBadge).toHaveText('ZATWIERDZONA');
    const invoiceNumber = page.getByTestId('invoice-number').first();
    await expect(invoiceNumber).toHaveText('FV/0001/08/2026');

    // Odświeżenie strony (page.reload()) w celu dowodu persystencji z bazy PostgreSQL (brak stanu w mocku)
    await page.reload();

    // Po odświeżeniu aplikacja ładuje zatwierdzoną fakturę bezpośrednio z PostgreSQL
    await expect(page.getByTestId('invoice-number').first()).toHaveText('FV/0001/08/2026');
    await expect(page.getByTestId('invoice-status-badge').first()).toHaveText('ZATWIERDZONA');
    await expect(page.getByTestId('invoice-buyer-name').first()).toHaveText('Firma Testowa Sp. z o.o.');
    await expect(page.getByTestId('invoice-net-total').first()).toHaveText('1 000,00');
    await expect(page.getByTestId('invoice-vat-total').first()).toHaveText('230,00');
    await expect(page.getByTestId('invoice-gross-total').first()).toHaveText('1 230,00');

    // Bezpośrednie dowody audytowe i finansowe w PostgreSQL:
    // 1. Tabela invoice zawiera zatwierdzony rekord z prawidłowymi kwotami
    const invDbRes = await db.query(
      `SELECT number, net_total, vat_total, gross_total, currency, issue_date
       FROM invoice WHERE business_profile_id = $1`,
      [businessId]
    );
    expect(invDbRes.rows.length).toBe(1);
    expect(invDbRes.rows[0].number).toBe('FV/0001/08/2026');
    expect(invDbRes.rows[0].net_total).toBe('1000.00');
    expect(invDbRes.rows[0].vat_total).toBe('230.00');
    expect(invDbRes.rows[0].gross_total).toBe('1230.00');
    expect(invDbRes.rows[0].currency).toBe('PLN');

    // 2. Tabela approved_synthetic_accounting_effect wiąże szkic z fakturą
    const effectRes = await db.query(
      `SELECT count(*)::int as cnt FROM approved_synthetic_accounting_effect WHERE business_profile_id = $1`,
      [businessId]
    );
    expect(effectRes.rows[0].cnt).toBe(1);

    // 3. Wersja dokumentu powiązana z fakturą ma status APPROVED
    const docVerRes = await db.query(
      `SELECT dv.status
       FROM document_version dv
       JOIN invoice inv ON inv.document_version_id = dv.id
       WHERE inv.business_profile_id = $1`,
      [businessId]
    );
    expect(docVerRes.rows.length).toBe(1);
    expect(docVerRes.rows[0].status).toBe('APPROVED');

    // 4. Rekord źródłowy synthetic_draft jest zamrożony w statusie STRUCTURALLY_VALID
    const draftDbRes = await db.query(
      `SELECT structural_status FROM synthetic_draft WHERE business_profile_id = $1`,
      [businessId]
    );
    expect(draftDbRes.rows.length).toBe(1);
    expect(draftDbRes.rows[0].structural_status).toBe('STRUCTURALLY_VALID');
  });

  test('TC-UI-SLICE-03: Ponowienie z tym samym Idempotency-Key nie tworzy drugiego rekordu w bazie PostgreSQL', async ({
    request,
  }) => {
    const replayKey = `replay-test-key-${crypto.randomUUID()}`;
    const payload = {
      issue_date: '2026-08-01',
      sale_date: '2026-08-01',
      currency: 'PLN',
      counterparty_snapshot: {
        legal_name: 'Firma Druga Sp. z o.o.',
        nip: '2222222222',
        address: 'ul. Prosta 1, Warszawa',
      },
      lines: [
        {
          line_number: 1,
          description: 'Usługa powtórzona',
          quantity: '1.0000',
          unit: 'usł.',
          unit_price_net: '500.00',
          vat_rate_code: 'STANDARD',
        },
      ],
    };

    // Pierwsze żądanie
    const res1 = await request.post('/api/v1/invoices', {
      headers: {
        'Authorization': `Bearer ${ownerToken}`,
        'Idempotency-Key': replayKey,
      },
      data: payload,
    });
    expect(res1.status()).toBe(201);
    const draft1Id = (await res1.json()).id;

    // Drugie żądanie - IDENTYCZNY klucz i payload
    const res2 = await request.post('/api/v1/invoices', {
      headers: {
        'Authorization': `Bearer ${ownerToken}`,
        'Idempotency-Key': replayKey,
      },
      data: payload,
    });
    expect(res2.status()).toBe(201);
    const draft2Id = (await res2.json()).id;
    expect(draft2Id).toBe(draft1Id);

    // Asercja bezpośrednia w PostgreSQL: dokładnie 1 wiersz dla draft1Id
    const draftCountRes = await db.query(
      'SELECT count(*)::int as cnt FROM synthetic_draft WHERE business_profile_id = $1 AND id = $2',
      [businessId, draft1Id]
    );
    expect(draftCountRes.rows[0].cnt).toBe(1);
  });

  test('TC-UI-SLICE-04: Po zmianie treści formularza powstaje nowa próba z nowym Idempotency-Key, a ponowienie identycznego żądania zachowuje klucz', async ({
    page,
  }) => {
    // Wstrzykujemy tożsamość OWNER w pamięci przeglądarki
    await page.addInitScript(
      ({ token, role }) => {
        (window as any).__EPHEMERAL_TEST_IDENTITY__ = { token, role };
      },
      { token: ownerToken, role: 'OWNER' as const }
    );

    await page.goto('/');
    const enterDashboardBtn = page.getByRole('button', { name: /otwórz panel księgowy/i });
    if (await enterDashboardBtn.isVisible()) {
      await enterDashboardBtn.click();
    }

    const newDraftBtn = page.getByTestId('new-draft-button');
    await expect(newDraftBtn).toBeVisible();
    await newDraftBtn.click();

    // Zbieranie wysłanych kluczy Idempotency-Key
    const interceptedKeys: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/invoices') && req.method() === 'POST') {
        const key = req.headers()['idempotency-key'];
        if (key) interceptedKeys.push(key);
      }
    });

    // Wypełniamy formularz danymi z UJEMNĄ ceną netto (-10.00), aby wymusić błąd walidacji 422 i zatrzymać modal otwarty
    await page.getByTestId('input-buyer-name').fill('Firma Próbna Sp. z o.o.');
    await page.getByTestId('input-buyer-nip').fill('2222222222');
    await page.getByTestId('input-buyer-address').fill('ul. Próbna 1, Warszawa');
    await page.getByTestId('input-item-desc').fill('Usługa wstępna');
    await page.getByTestId('input-item-qty').fill('1.0000');
    await page.getByTestId('input-item-net').fill('-10.00');

    // 1. Pierwsza próba (zwróci 422)
    await page.getByTestId('submit-draft-button').click();
    await expect(page.getByTestId('modal-error-banner')).toBeVisible();
    expect(interceptedKeys.length).toBe(1);
    const key1 = interceptedKeys[0];

    // 2. Ponowienie IDENTYCZNEGO żądania (bez dotykania jakichkolwiek pól)
    await page.getByTestId('submit-draft-button').click();
    await expect(page.getByTestId('modal-error-banner')).toBeVisible();
    expect(interceptedKeys.length).toBe(2);
    const key2 = interceptedKeys[1];
    // Identyczna treść -> zachowany dokładnie ten sam klucz idempotencji
    expect(key2).toBe(key1);

    // 3. Modyfikacja treści formularza (poprawiamy cenę netto na poprawną 100.00)
    await page.getByTestId('input-item-net').fill('100.00');
    await page.getByTestId('submit-draft-button').click();

    // Sukces: modal znika po poprawnym zapisie szkicu
    await expect(page.getByTestId('input-buyer-name')).toBeHidden();
    expect(interceptedKeys.length).toBe(3);
    const key3 = interceptedKeys[2];

    // Zmieniona treść -> wygenerowany NOWY klucz idempotencji
    expect(key3).not.toBe(key1);
  });
});
