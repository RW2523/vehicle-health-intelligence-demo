import { defineConfig } from "@playwright/test";

// End-to-end tests for the six demo sessions. Starts the API and the web app if they are not already running
// (reuses them when they are). Set VHI_PYTHON to the backend virtualenv's python if it is not on PATH.
const PY = process.env.VHI_PYTHON || "python3";
const WEB = process.env.E2E_BASE_URL || "http://localhost:3000";
const PIN = process.env.E2E_PRESENTER_PIN;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB,
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    // With VHI_PRESENTER_PIN set on the API, pages act as the presenter's browser: the PIN is stored in the app, which
    // sends it only to its own API (a header on every request would also reach Google Fonts, whose CORS preflight
    // then fails). The tests' own API calls carry it through the request fixture in e2e/demo.spec.ts.
    storageState: PIN ? { cookies: [], origins: [{ origin: new URL(WEB).origin, localStorage: [{ name: "vhi.presenterPin", value: PIN }] }] } : undefined,
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: `${PY} -m uvicorn vhi.main:app --host 127.0.0.1 --port 8000`,
          cwd: "../backend",
          url: "http://127.0.0.1:8000/api/health",
          reuseExistingServer: true,
          timeout: 600_000,
        },
        {
          command: "npm run start",
          url: WEB,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
