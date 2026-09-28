/**
 * KOD DO ANALIZY — NIE JEST SAMODZIELNIE URUCHAMIALNY W TYM REPOZYTORIUM
 *
 * Źródło: sepawid/jdg_nc_app @ commit d4776d7
 * Rola: Testy responsywności UI oraz audyt dostępności WCAG 2.1:
 * 1. Progi responsywne: Desktop vs Tablet (1024px vs 1023px) oraz Tablet vs Mobile (720px vs 719px).
 * 2. Rozmiar celu dotykowego linków nawigacji dolnej (WCAG 2.5.5 >= 44x44 px).
 * 3. Zautomatyzowany skan dostępności (@axe-core/playwright) dla reguł wcag2a oraz wcag2aa.
 */

import { test, expect } from '../../fixtures/base.fixture';

test.describe('UI Responsive Breakpoints & Accessibility (Local Vite)', () => {
  test('TC-UI-01: Weryfikacja progów responsywności 1023/1024 px oraz 719/720 px z wejściem do panelu', async ({ page }) => {
    await page.goto('/');

    const enterDashboardBtn = page.getByRole('button', { name: /otwórz panel księgowy/i });
    await expect(enterDashboardBtn).toBeVisible();
    await enterDashboardBtn.click();

    await expect(page.getByTestId('persistent-demo-banner')).toBeVisible();

    // A. Granica Tablet vs Desktop (1023px vs 1024px)
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.locator('.menubtn')).toBeHidden();
    await expect(page.locator('.sidebar-nav')).toBeVisible();

    await page.setViewportSize({ width: 1023, height: 800 });
    await expect(page.locator('.menubtn')).toBeVisible();

    await page.locator('.menubtn').click();
    await expect(page.locator('.sidebar-nav')).toHaveClass(/is-open/);
    // Klikamy w obszar scrim poza górnym bannerem demo i poza bocznym panelem drawer
    await page.locator('.scrim').click({ position: { x: 500, y: 300 } });
    await expect(page.locator('.sidebar-nav')).not.toHaveClass(/is-open/);

    // B. Granica Smartphone vs Tablet (719px vs 720px)
    await page.setViewportSize({ width: 720, height: 800 });
    await expect(page.locator('.bottomnav')).toBeHidden();

    await page.setViewportSize({ width: 719, height: 800 });
    await expect(page.locator('.bottomnav')).toBeVisible();

    // Weryfikacja celu dotykowego linku .bottomnav a (WCAG 2.5.5 >= 44x44 px)
    const firstTab = page.locator('.bottomnav a').first();
    const box = await firstTab.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('TC-UI-02: Dostępność WCAG 2.1 (Axe-core scan) na widoku demonstracyjnym', async ({ page }) => {
    await page.goto('/');
    const enterDashboardBtn = page.getByRole('button', { name: /otwórz panel księgowy/i });
    await enterDashboardBtn.click();
    await expect(page.getByTestId('persistent-demo-banner')).toBeVisible();

    const AxeBuilder = (await import('@axe-core/playwright')).default;
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});
