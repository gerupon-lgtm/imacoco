import { defineConfig, devices } from '@playwright/test'

const browserChannel = process.platform === 'win32' ? { channel: 'msedge' as const } : {}
const devServerCommand = `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run dev -- --host 127.0.0.1 --port 4173`

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  reporter: 'line',
  webServer: {
    command: devServerCommand,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['iPhone 13'],
    browserName: 'chromium',
    ...browserChannel
  }
})
