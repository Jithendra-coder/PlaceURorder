import { defineConfig } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const localBaseURL = "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: externalBaseURL ?? localBaseURL },
  workers: 1,
  webServer: externalBaseURL ? undefined : {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: localBaseURL,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
