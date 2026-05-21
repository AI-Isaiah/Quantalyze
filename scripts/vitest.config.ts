/**
 * Vitest config scoped to `scripts/`. The root `vitest.config.ts`
 * intentionally excludes `scripts/**` from default test runs
 * (scripts are CLI helpers, not part of the app's runtime), so the
 * colocated `scripts/*.test.ts` files need their own entry point.
 *
 * Audit C-0291 (CHAIN-8) added a colocated regression suite for
 * `check-gdpr-export-coverage.ts`. Invoke it via:
 *
 *   npx vitest run --config scripts/vitest.config.ts --no-coverage
 *
 * The config is deliberately minimal — node env, no react plugin,
 * no jsdom — because the scripts are pure Node.js.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/**/*.test.ts"],
    // No setup files needed; the scripts have no React / DOM deps.
    coverage: {
      enabled: false,
    },
  },
});
