import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser',
  use: {
    baseURL: 'http://127.0.0.1:4177',
    channel: 'chrome'
  },
  webServer: {
    command: 'npx pnpm@9.15.4 run preview:e2e',
    port: 4177,
    reuseExistingServer: !process.env.CI
  }
});
