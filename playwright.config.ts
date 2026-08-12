import { defineConfig } from '@playwright/test';

const E2E_PORT = '4174';
const SERVER_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 2,
  reporter: process.env.CI === undefined ? 'list' : 'github',
  use: {
    baseURL: SERVER_URL,
    screenshot: 'only-on-failure',
    trace: process.env.CI === undefined ? 'retain-on-failure' : 'on-first-retry',
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${E2E_PORT}`,
    url: SERVER_URL,
    reuseExistingServer: false,
  },
});
