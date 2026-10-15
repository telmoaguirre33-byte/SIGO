import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".", testMatch: "scanner.spec.mjs", workers: 1, timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4174", headless: true, screenshot: "only-on-failure" },
  reporter: [["list"], ["json", { outputFile: "test-results/minorista-browser.json" }]],
  webServer: { command: "npx vite --config tests/minorista/vite.config.mjs", cwd: fileURLToPath(new URL("../..", import.meta.url)), url: "http://127.0.0.1:4174/tests/minorista/index.html", reuseExistingServer: false },
});
