import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The real backend with the scripted model (ENV=test MODEL_OVERRIDE=e2e, backend/src/agent/e2e.py)
// on a throwaway data dir, serving the built frontend: the same single-URL setup as `make run`.
const port = 8765;
const dataDir = mkdtempSync(join(tmpdir(), "pydantic-chat-e2e-"));

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `uv run uvicorn src.app:create_app --factory --port ${port}`,
    cwd: "../backend",
    env: {
      ENV: "test",
      MODEL_OVERRIDE: "e2e",
      DATA_DIR: dataDir,
      MODELS_FILE: "tests/models.json",
      // No MCP server or web search: the local backend/mcp.json and keys stay out of the run.
      MCP_CONFIG_PATH: join(dataDir, "mcp.json"),
      TAVILY_API_KEY: "",
      LANGFUSE_PUBLIC_KEY: "",
      LANGFUSE_SECRET_KEY: "",
      PYDANTIC_AI_NO_BANNER: "1",
    },
    url: `http://127.0.0.1:${port}/api/models`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
