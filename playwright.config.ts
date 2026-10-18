import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "apps/web/e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3081",
    ...devices["Desktop Chrome"],
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  webServer: {
    command: "npm run start",
    url: process.env.TEST_BASE_URL || "http://127.0.0.1:3081",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: "3081",
      NEXT_PORT: "3080",
      API_PORT: "8080",
      ORBICART_WEB_URL: "http://127.0.0.1:3080",
      CONJURE_API_URL: "http://127.0.0.1:8080",
      PYTHON_API_URL: "http://127.0.0.1:8080",
      CLIENT_URL: "http://127.0.0.1:3081",
      APP_ORIGIN: "http://127.0.0.1:3081",
      STORES_LIVE: "false",
      MOCK_ORDER_SANDBOX: "off",
      STRIPE_SECRET_KEY: "",
      LLM_API_KEY: "",
      GEMINI_API_KEY: "",
      ELEVENLABS_API_KEY: "",
      SELENIUM_ENABLED: "false",
      XAI_API_KEY: "",
    },
  },
});
