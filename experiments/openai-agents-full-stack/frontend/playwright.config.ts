import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The real backend with a scripted model (backend/tests/e2e_app.py) on a throwaway
// database, serving the built frontend: the same single-URL setup as `make run`.
const port = 8765;
const dbPath = join(mkdtempSync(join(tmpdir(), "agent-chat-e2e-")), "app.db");

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `uv run uvicorn tests.e2e_app:create_e2e_app --factory --port ${port}`,
    cwd: "../backend",
    env: { DB_PATH: dbPath },
    url: `http://127.0.0.1:${port}/api/sessions`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
