import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'https://ager.pl';

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
  ],
});
