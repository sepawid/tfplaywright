import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'https://ager.pl';
const isMutatingAllowed = process.env.ALLOW_DEMO_MUTATIONS === 'true';

export default defineConfig({
  testDir: './tests/specs',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['junit', { outputFile: 'playwright-report/results.xml' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // W domyślnym przebiegu (npx playwright test) uruchamiane są WYŁĄCZNIE testy tylko do odczytu:
  // smoke, ui oraz api. Projekt mutujący 'e2e' jest strictly opt-in (ALLOW_DEMO_MUTATIONS=true).
  projects: [
    {
      name: 'smoke',
      testDir: './tests/specs/smoke',
      use: {
        ...devices['Desktop Chrome'],
        baseURL,
      },
    },
    {
      name: 'ui',
      testDir: './tests/specs/ui',
      use: {
        ...devices['Desktop Chrome'],
        baseURL,
      },
    },
    {
      name: 'api',
      testDir: './tests/specs/api',
      use: {
        baseURL,
      },
    },
    ...(isMutatingAllowed
      ? [
          {
            name: 'e2e',
            testDir: './tests/specs/e2e',
            use: {
              ...devices['Desktop Chrome'],
              baseURL,
            },
          },
        ]
      : []),
    {
      name: 'local-analysis',
      testDir: './tests/local_analysis',
      use: {
        baseURL,
      },
    },
  ],
});
