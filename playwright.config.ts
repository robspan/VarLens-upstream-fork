import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30000,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  retries: 0
})
