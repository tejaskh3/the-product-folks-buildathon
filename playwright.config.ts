// Browser tests for /play, the paywall and the way back from checkout. Every /api call is
// answered by e2e/fakeApi.ts, so no model credit, database or payment is touched. Signed-in
// tests sign a Clerk test user into the dev instance (see e2e/global.setup.ts). Run with:
//   npm run e2e
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Diagrams and the landing page animate; reduced motion keeps the tests steady.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
    { name: "phone", use: { ...devices["Pixel 7"] }, dependencies: ["setup"] },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/pricing`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
