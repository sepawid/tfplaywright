import { test, expect } from '../../fixtures/base.fixture';

test.describe('Public Smoke Verification (https://ager.pl)', () => {
  test('TC-SMOKE-01: Endpoint /health zwraca status 200 i deklarację local-demo-only', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('status', 'local-demo-only');
    // Weryfikacja opcjonalnego nagłówka skrótu gita, jeśli występuje w środowisku
    const shaHeader = response.headers()['x-app-git-sha'];
    if (shaHeader) {
      expect(shaHeader).toMatch(/^[0-9a-fA-F]{7,40}$|^unknown$/);
    }
  });

  test('TC-SMOKE-02: Specyfikacja OpenAPI /openapi.json jest dostępna publicznie i spójna', async ({ request }) => {
    const response = await request.get('/openapi.json');
    expect(response.status()).toBe(200);
    const spec = await response.json();
    expect(spec).toHaveProperty('openapi');
    expect(spec.info).toHaveProperty('title');
    expect(spec.paths).toHaveProperty('/api/v1/invoices');
    expect(spec.paths).toHaveProperty('/api/v1/synthetic-drafts/{draft_id}/validate');
  });

  test('TC-SMOKE-03: Strona główna serwuje demonstracyjny interfejs użytkownika React', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Księgowość|JDG/i);

    const openPanelBtn = page.getByRole('button', { name: /otwórz panel księgowy/i });
    await expect(openPanelBtn).toBeVisible();
    await openPanelBtn.click();

    // Weryfikacja widoczności trwałego bannera informującego o trybie demonstracyjnym
    const banner = page.getByTestId('persistent-demo-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/tryb demo/i);
  });

  test('TC-SMOKE-04: Odpytanie o nieistniejący zasób zwraca poprawny kod 404', async ({ request }) => {
    const response = await request.get('/api/v1/non-existent-resource-endpoint');
    expect(response.status()).toBe(404);
  });
});
