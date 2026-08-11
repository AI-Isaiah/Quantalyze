import { defineConfig, defaultExclude } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import os from "os";
import { NODE_ENV_TEST_FILES } from "./vitest.node-env";

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

// The whole suite, shared by both projects below (each one narrows it — the
// jsdom project by excluding the node list, the node project by being that
// list).
const INCLUDE = [
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
  // B25 — RuleTester fixtures for the local eslint-plugin-quantalyze rules
  // live next to the rules they exercise (plugin self-containment) and are
  // run as part of the normal vitest suite.
  "tools/eslint-plugin-quantalyze/tests/**/*.test.ts",
];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Vitest 4.x: maxWorkers is the top-level cap on parallel workers
    // (replaces the 3.x `poolOptions.threads.maxThreads` shape).
    maxWorkers: MAX_THREADS,
    // Phase 140.5-01 / SEAMPROSE-04 — restore stubbed globals and stubbed env
    // vars BEFORE each test. DEF-16-1, this repo's known CI-only failure cause
    // (green on local Node 25, red on CI Node 22), is an ORDERING defect: 81
    // files call `vi.stubGlobal` and 38 of them never clean up, so with the
    // threads pool sharing one `globalThis` per worker the suite's verdict
    // depends on which file the worker happened to run first.
    //
    // Config rather than an `afterEach` in src/test-setup.ts, deliberately: the
    // config option runs BEFORE each test and cannot be shadowed by a
    // file-local `afterEach`, whereas a setup-file hook can. Coverage-law row 1
    // either way — every test file inherits it with no edit.
    //
    // ⚠️ `unstubEnvs` covers ONLY vars set through `vi.stubEnv()`. The 54 files
    // that assign `process.env.X =` directly are covered by the snapshot
    // restore in src/test-setup.ts, which is a SEPARATE mechanism; neither one
    // makes the other redundant. `src/test-setup.leak-canary.test.ts` fails if
    // either is removed (ledger rows SC-HARNESS-1 and SC-ENV-1).
    unstubGlobals: true,
    unstubEnvs: true,
    // ⚠️ EMPTY ON PURPOSE — the projects below own the file sets, and this
    // must stay empty for them to. `extends: true` merges a project's config
    // into this one with vite's `mergeConfig`, which CONCATENATES arrays
    // instead of replacing them: with `INCLUDE` here, the node project's
    // include resolves to `INCLUDE ∪ NODE_ENV_TEST_FILES` and it runs the
    // whole suite — MEASURED, 791 files in the node project and 2,736 red
    // `document is not defined`. Scalars (`environment`) DO override, which is
    // why the node project can still flip that one.
    include: [],
    setupFiles: ["src/test-setup.ts"],
    // Two projects, split ONLY by test environment. jsdom stays the default
    // and keeps everything except the explicit opt-in list in
    // vitest.node-env.ts; that list is the node project. Both `extends: true`,
    // so the react plugin, the `@` alias and every option above (setupFiles,
    // the unstub pair) are inherited rather than restated — a project that
    // forgot `setupFiles` would silently lose the env-restore fence, and one
    // that forgot the plugin could not transform JSX at all.
    //
    // WHY. Building a jsdom per file is the largest single cost in a run:
    // MEASURED at 987s of the 1289s of CPU a green parallel run burns, and 291
    // of the 791 files never touch a DOM. Same tests, same assertions, no
    // window.
    //
    // ⚠️ The two file sets are COMPLEMENTARY by construction — the node list
    // is the node project's include and the jsdom project's exclude. Keep it
    // that way: overlap runs a file twice (inflating the test count and the
    // coverage denominator), a gap drops it silently.
    //
    // ⚠️ `defaultExclude` must be spread back in. Setting `exclude` REPLACES
    // vitest's default (node_modules, dist, .idea, …) rather than adding to
    // it, and without it the jsdom project walks node_modules.
    //
    // CI-COMPAT, verified rather than assumed (2026-08-12): `--shard=N/2`
    // still partitions the union of both projects, `--reporter=blob` writes
    // one report per shard, and `vitest run --merge-reports --coverage` merges
    // them and enforces the thresholds below on the full-suite numbers.
    // Coverage is a ROOT option, not a project one, so the split does not
    // fragment it.
    projects: [
      {
        extends: true,
        test: {
          name: "jsdom",
          include: INCLUDE,
          exclude: [...defaultExclude, ...NODE_ENV_TEST_FILES],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: NODE_ENV_TEST_FILES,
        },
      },
    ],
    // Coverage tracking — GATED in CI by the `frontend-coverage` job
    // (.github/workflows/ci.yml), which since 2026-07-02 MERGES the two
    // vitest shards' blob reports (`vitest run --merge-reports --coverage`)
    // and fails if any full-suite metric drops below the thresholds below
    // (the shards themselves run with these thresholds zeroed on the CLI —
    // a lone shard sees only half the files). Thresholds are a RATCHET: set a few points under measured
    // actual (2026-06-20: lines 85.2 / statements 83.3 / functions 77.4 /
    // branches 75.5) so a real regression trips the gate but normal noise
    // does not. When actual climbs durably, raise these to match. See the
    // ## Test Coverage section in CLAUDE.md (target 80) and tech-debt #11.
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
        lines: 82,
        functions: 74,
        branches: 72,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
