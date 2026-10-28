import { defineConfig } from '@playwright/test';

// BASE_URL points the tests at a deployed preview. Without it they start the page locally.
const baseURL = process.env.BASE_URL?.startsWith('http') ? process.env.BASE_URL : process.env.BASE_URL ? `https://${process.env.BASE_URL}` : undefined;
const port = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.e2e.ts',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: baseURL ?? `http://localhost:${port}`,
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: baseURL ? undefined : { command: 'npx tsx scripts/serve.ts', url: `http://localhost:${port}`, reuseExistingServer: !process.env.CI },
});
