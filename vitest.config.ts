import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import os from "os";

// CI-flake mitigation (2026-05-20, per HANDOVER-CI-FLAKES-2026-05-20.md).
// GitHub Actions runners have 4 logical cores; Vitest's default worker
// pool oversubscribes them under heavy RTL renders, so individual tests
// hit the 5s default timeout — outcomes.test.tsx (200-row truncation),
// ScenarioCommitDrawer focus chain, StrategyTable sparkline stroke-attr,
// deletion-requests retry-after assertions. All pass in isolation;
// failures rotate across shards as worker contention shifts. Capping
// maxThreads to (cpus - 1) leaves headroom for the test orchestrator
// and removes the contention floor without losing parallelism on bigger
// dev machines.
const MAX_THREADS = Math.max(1, os.cpus().length - 1);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Vitest 4.x: maxWorkers is the top-level cap on parallel workers
    // (replaces the 3.x `poolOptions.threads.maxThreads` shape).
    maxWorkers: MAX_THREADS,
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/a11y/**/*.test.ts",
      "tests/visual/**/*.test.ts",
      "tests/visual/**/*.test.tsx",
      // Phase 18 / FIX-04 — TS↔Python parity test reads both
      // src/lib/admin/pii-scrub.ts and analytics-service/services/redact.py
      // via fs.readFileSync to enforce denylist parity across runtimes.
      "tests/lib/**/*.test.ts",
      // Phase 19 / BACKBONE-05 + BACKBONE-10 — integration tests for
      // (a) thin-adapter outbound /process-key fetch shape (headers + body)
      //     across the 7 converted routes when the unified-backbone flag is on
      // (b) auto-rollback cron + Sentry env-tag smoke
      // both globs share the `tests/integration/` directory so a single
      // `vitest run` invocation picks them up alongside the unit suite.
      "tests/integration/**/*.test.ts",
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
