/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": src } },
  server: {
    // FastAPI is the only server: the dev server proxies the API to it.
    proxy: { "/api": "http://127.0.0.1:8000" },
    // The reducer tests read the backend's recorded event fixtures.
    fs: { allow: [".", "../backend/tests/fixtures"] },
  },
  // One local app: highlight.js grammars make a large bundle, and that is fine here.
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/api/schema.gen.ts", "src/components/ui/**", "src/test/**", "src/**/*.test.*"],
    },
  },
});
