import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/a11y/**/*.test.ts",
      "tests/visual/**/*.test.ts",
      "tests/visual/**/*.test.tsx",
    ],
    setupFiles: ["src/test-setup.ts"],
    // Coverage tracking — measurement only, NOT a CI gate yet.
    // Thresholds are intentionally low (60%) to establish a floor; the
    // ## Test Coverage section in CLAUDE.md tracks 80% as the target.
    // CI gating is a separate decision (see PR D scope item #2).
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        "**/*.config.{ts,js,mjs,cjs}",
        "**/*.d.ts",
        "**/types.ts",
        "**/types/**",
        "src/test-setup.ts",
        "e2e/**",
        "tests/**",
        "playwright.config.ts",
        "supabase/**",
        "scripts/**",
        "node_modules/**",
        ".next/**",
        "coverage/**",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
