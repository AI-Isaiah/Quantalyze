import { describe, it, expect, vi } from "vitest";

/**
 * Phase 140.5-01 / SEAMPROSE-04 — the harness restores state between tests.
 *
 * WHAT THIS FILE IS. DEF-16-1 — this repo's known CI-only failure cause, where
 * a suite passes on local Node 25 and fails on CI Node 22 — is an ORDERING
 * defect: a global or an env var set by one test survives into the next, so the
 * verdict depends on which file the worker ran first. Measured at 140.5
 * planning: 81 files call `vi.stubGlobal` (38 with no local cleanup) and 54
 * assign `process.env.X =` directly (38 with no restore), against a
 * `src/test-setup.ts` whose only `afterEach` called `cleanup()`.
 *
 * The remedy is coverage-law ROW 1 — a config flag and one setup-file
 * `afterEach`, inherited by every test file without an edit — but a row-1
 * mechanism nobody can see fail is indistinguishable from no mechanism. This
 * file is the seeing. It is an ORDINARY test, not a structural contract, so it
 * is deliberately NOT registered in `CONTRACT_GUARDS`; it runs in every suite
 * run like any other.
 *
 * HOW IT WORKS. Vitest executes the tests within one file in declaration order,
 * so test 1 dirties the two kinds of shared state and test 2 asserts the
 * harness cleaned both. The two halves need two DIFFERENT mechanisms and that
 * is the point:
 *
 *   - the GLOBAL half is restored by `unstubGlobals: true` in
 *     `vitest.config.ts`, which runs BEFORE each test and — unlike a
 *     setup-file hook — cannot be shadowed by a file-local `afterEach`;
 *   - the ENV half is restored by the snapshot in `src/test-setup.ts`.
 *     `unstubEnvs` does NOT cover it: that option restores only what
 *     `vi.stubEnv()` recorded, and the 54 files above assign to `process.env`
 *     directly (verified against the installed vitest 4.1.10 typings,
 *     RESEARCH §2). A test that removed the snapshot and kept `unstubEnvs`
 *     would still be green without this file.
 *
 * Ledger rows SC-HARNESS-1 (flip `unstubGlobals` to `false`) and SC-ENV-1
 * (delete the env snapshot-restore) each redden exactly one of the two
 * assertions in test 2 — run and pasted in `140.5-VALIDATION.md`, so this
 * canary is known to be falsifiable in both polarities rather than assumed to
 * be.
 *
 * ⚠️ `vi.stubGlobal` IS THE SANCTIONED IDIOM HERE AND NOWHERE ELSE. The
 * standing constraint is `vi.spyOn` + `restoreAllMocks`, never `vi.stubGlobal`
 * (DEF-16-1). This file's SUBJECT is whether a stubbed global is restored, so
 * it must create one; nothing here depends on the leak, it proves the leak is
 * closed. New code elsewhere still uses `vi.spyOn`.
 */

/**
 * Names chosen so nothing else in the repo can define them, and so a grep for
 * either name lands on this file. Neither exists on `globalThis` or in the
 * environment before test 1 runs — asserted, not assumed, because "it is gone
 * afterwards" is worth nothing if it was never there.
 */
const CANARY_GLOBAL = "__seamproseLeakCanary__";
const CANARY_ENV = "__SEAMPROSE_LEAK_CANARY__";

function globalCanary(): unknown {
  return (globalThis as unknown as Record<string, unknown>)[CANARY_GLOBAL];
}

describe("[140.5-01 / SEAMPROSE-04] the harness restores globals and env between tests", () => {
  it("test 1 — dirties both a global and process.env, exactly as 119 files do", () => {
    // Precondition, asserted: the state really is absent before we dirty it.
    expect(CANARY_GLOBAL in globalThis).toBe(false);
    expect(process.env[CANARY_ENV]).toBeUndefined();

    vi.stubGlobal(CANARY_GLOBAL, "leaked-global");
    // A DIRECT assignment, not `vi.stubEnv` — this is the half no vitest
    // option covers and the reason the snapshot in test-setup.ts exists.
    process.env[CANARY_ENV] = "leaked-env";

    expect(globalCanary()).toBe("leaked-global");
    expect(process.env[CANARY_ENV]).toBe("leaked-env");
  });

  it("test 2 — sees neither, because the harness restored both", () => {
    expect(
      CANARY_GLOBAL in globalThis,
      `A global stubbed in the previous test survived into this one. ` +
        `\`unstubGlobals: true\` is missing from vitest.config.ts (or was ` +
        `turned off). That is DEF-16-1's exact mechanism: with 81 files ` +
        `calling vi.stubGlobal, the suite's verdict starts depending on the ` +
        `order the worker happened to run files in, which is why this repo ` +
        `has a class of failures that reproduce only on CI's Node 22.`,
    ).toBe(false);

    expect(
      process.env[CANARY_ENV],
      `An env var assigned directly in the previous test survived into this ` +
        `one. The snapshot-restore in src/test-setup.ts is missing or no ` +
        `longer covers additions. \`unstubEnvs\` does NOT close this half — ` +
        `it restores only what vi.stubEnv() recorded, and 54 test files ` +
        `assign to process.env directly.`,
    ).toBeUndefined();
  });
});
