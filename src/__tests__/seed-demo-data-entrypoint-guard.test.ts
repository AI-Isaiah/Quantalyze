/**
 * M-0846 (audit-2026-05-07 / reverify-2026-05-25) — seed-demo-data entry-point
 * guard regression.
 *
 * `scripts/seed-demo-data.ts` ends with:
 *
 *     if (isScriptEntryPoint()) { main().catch(...) }
 *
 * where `isScriptEntryPoint()` returns false when `process.env.VITEST` (or
 * `VITEST_WORKER_ID`) is set. This guard is load-bearing for safety:
 * `src/__tests__/seed-integrity.test.ts` imports the module's pure helpers,
 * and `main()` — if it ran at import time — would construct a service-role
 * Supabase client and WIPE the live test project (`qmnijlgmdhviwzwfyzlc`).
 *
 * The guard itself is module-private (not exported), so we cannot unit-test
 * the predicate directly. Instead we assert its OBSERVABLE contract: importing
 * the module under vitest must NOT invoke `createClient` (the first thing
 * `main()` does after its env-validation throws) and must NOT throw. We mock
 * `@supabase/supabase-js` so a regression that let `main()` run at import would
 * be caught here as a `createClient` call — without ever touching a real DB.
 *
 * If a future edit broke the guard (e.g. dropped the VITEST check, or the argv
 * heuristic started matching under tsx's `.js` cache), `main()` would either
 * throw on the missing-env guard (caught as a thrown import) or — worse, if env
 * happens to be set — call createClient. Both are asserted against.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createClientSpy = vi.fn(() => {
  throw new Error(
    "M-0846: createClient was invoked at module import — the seed script " +
      "entry-point guard let main() run under vitest. This would WIPE the " +
      "live test Supabase project.",
  );
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientSpy,
}));

describe("seed-demo-data entry-point guard (M-0846)", () => {
  beforeEach(() => {
    createClientSpy.mockClear();
    // Force a fresh module load so we observe import-time side effects even
    // though sibling suites (seed-integrity.test.ts) already imported it in
    // this worker process.
    vi.resetModules();
  });

  it("VITEST env is set in this runner (precondition for the guard)", () => {
    // The guard short-circuits on process.env.VITEST || VITEST_WORKER_ID.
    // If neither were set the test would be vacuous, so pin the precondition.
    expect(
      Boolean(process.env.VITEST) || Boolean(process.env.VITEST_WORKER_ID),
    ).toBe(true);
  });

  it("importing the module does NOT invoke createClient (main() did not run)", async () => {
    await expect(import("../../scripts/seed-demo-data")).resolves.toBeDefined();
    expect(createClientSpy).not.toHaveBeenCalled();
  });

  it("the imported module still exposes its pure helpers (guard did not break the export surface)", async () => {
    const mod = await import("../../scripts/seed-demo-data");
    // Spot-check a couple of the exports seed-integrity.test.ts depends on —
    // proves the guard skips main() WITHOUT short-circuiting module evaluation.
    expect(Array.isArray(mod.STRATEGY_PROFILES)).toBe(true);
    expect(typeof mod.generatePortfolioAnalyticsJSONB).toBe("function");
    expect(createClientSpy).not.toHaveBeenCalled();
  });
});
