import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30000,
  use: {
    trace: 'on-first-retry'
  },
  retries: 0
})
