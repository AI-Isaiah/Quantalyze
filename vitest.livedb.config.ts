import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { liveDbLaneCorpus } from "./scripts/live-db-lane-corpus.mjs";
import { readLaneEnvOrNull } from "./vitest.livedb.globalsetup";

/**
 * FOURTH, STANDALONE vitest project — THE LIVE-DB LANE
 * (Phase 164.9 plan 08, ROADMAP criterion 13 / `[164.9-CREDENTIALED-TESTS-RED-AND-UNGATED]`).
 *
 * ── THE FOUR CLAIMS THIS HEADER OWES ITS READER ─────────────────────────────
 *
 * 1. THE HOST. This lane targets the LOCAL SUPABASE STACK booted by
 *    `scripts/local-stack/run.sh up`, and never the shared project — because the
 *    phase it was built in exists to remove assertions against a project this
 *    repo does not own, so standing a NEW lane up there would add a global
 *    assertion surface at the very moment the phase is removing them, while the
 *    local stack is per-run isolated by construction (a fresh database every
 *    run), which is the property the rest of this phase spends whole plans
 *    manufacturing for gates that cannot have it.
 *
 * 2. IT CONSUMES NO SECRET AND NO REPOSITORY VARIABLE — every credential it uses
 *    is minted by the stack it just booted and handed over through
 *    `scripts/local-stack/.stack-env`, so the lane runs identically on a fork
 *    pull request, which is what earns its CI job the `frontend` aggregator's
 *    STRICT arm with no tolerance, the same reasoning the seam-breaker lane
 *    already records for itself.
 *
 * 3. THE NON-WIDENING FENCE. ⛔ This lane runs the DERIVED live-DB corpus and
 *    nothing else, and its selection must NEVER be widened — it is the exact
 *    INVERSE of the shards' prohibition on live-DB credentials, and setting
 *    those two variables is safe HERE and only here precisely because nothing
 *    but the gated corpus ever executes under them.
 *
 * 4. THE STATED COST. ⛔ A local-stack lane cannot catch drift that exists only
 *    on the shared project, and that loss is recorded here rather than
 *    discovered later: repo-versus-shared-project ledger and function-body drift
 *    is owned by VAC-08 (a step of the `sql-tests` job) and repo-versus-production
 *    body drift by VAC-04 (a step of `migration-drift-check.yml`), so this lane
 *    is not a substitute for either and never reports on their subject.
 *
 * ── WHY A SEPARATE CONFIG AND NOT CREDENTIALS ON THE SHARDS ─────────────────
 * The obvious fix — hand the two live-DB variables to the sharded unit run — is
 * forbidden IN THE SHARD JOB'S OWN WORDS, because it would un-skip this whole
 * class inside the shards, move the merged report's denominator and invalidate a
 * ratchet baseline measured with the class skipped. That baseline backs a
 * BLOCKING gate. So the class gets its own invocation instead.
 *
 * ⛔ AND THIS CONFIG DECLARES NO REPORTING CONFIGURATION OF THAT KIND AT ALL, and
 * the lane is never invoked with the flag that would turn it on. A second
 * denominator would corrupt the merged ratchet exactly as credentials on the
 * shards would — the same hazard reached by a different road. Two sibling lane
 * configs carry the rule as an explicit `false`; this one carries it by
 * declaring nothing, so a search for the concept over this file returns zero.
 *
 * ── THE REFUSALS LIVE IN `globalSetup`, ON PURPOSE ─────────────────────────
 * ⛔ This checkout's Supabase CLI context is linked to PRODUCTION, so before the
 * lane boots anything it asks the stack runner where it would start and refuses
 * hard on this repository's own `supabase/` directory. That check, and the
 * absent-stack refusal, live in `vitest.livedb.globalsetup.ts` rather than in
 * this file's body — a config body is executed by any tool that merely
 * ENUMERATES this repo's vitest configs, so a throw here reads as an unrelated
 * job's mystery error. Measured; see that file's header.
 *
 * ── USAGE (CI pastes this VERBATIM — a wrapped run is a different run) ──────
 *   bash scripts/local-stack/run.sh up
 *   npm run test:live-db
 *   bash scripts/local-stack/run.sh down
 */

const REPO_ROOT = __dirname;

// Derived at config-evaluation time, so a spec gated on the live-DB symbol
// tomorrow is picked up without anyone editing a list. ⛔ Never a filename glob
// (most of this corpus follows no naming convention) and never a text search
// (this repo has a MEASURED grep-blind file carrying a deliberate NUL byte).
const include: string[] = liveDbLaneCorpus();
if (include.length === 0) {
  throw new Error(
    "LIVE-DB LANE REFUSED: the derived corpus is EMPTY. A lane with nothing in it must never " +
      "report a clean run. See scripts/live-db-lane-corpus.mjs.",
  );
}

// ⚠️ May be null while a tool is merely enumerating configs with no stack
// running. That is NOT tolerated at RUN time: `globalSetup` throws on it before
// a single spec loads, so an absent stack fails the lane instead of skipping it.
const lane = readLaneEnvOrNull();

export default defineConfig({
  test: {
    // `node`, not the repo-default `jsdom`. These specs drive supabase-js over
    // real HTTP; a DOM buys nothing and jsdom's `Response`/`DOMException`
    // divergences from the Node runtime are a documented hazard on this seam.
    environment: "node",
    include,
    globalSetup: ["vitest.livedb.globalsetup.ts"],
    // ⛔ RESTATED, NOT INHERITED. This is a standalone ROOT config, so it
    // inherits nothing — including the env-restore fence the shared setup file
    // installs, whose absence is this repo's known CI-only ordering defect.
    setupFiles: ["src/test-setup.ts"],
    unstubGlobals: true,
    unstubEnvs: true,
    // The live-DB gate variables, minted by the stack booted moments ago.
    // ⭐ `VITEST_LIVE_DB_INTENDED` is the shared setup's OPT-IN SENTINEL: that
    // setup THROWS when both credentials are present without it, because a tool
    // wrapper once auto-loaded a dotenv file into a child vitest process and
    // silently turned skipped suites into real writes. This lane is the
    // intentional case the sentinel exists to admit — declared here so the
    // opt-in is a decision on the record and not an inherited accident.
    env: {
      ...(lane
        ? {
            NEXT_PUBLIC_SUPABASE_URL: lane.API_URL,
            SUPABASE_SERVICE_ROLE_KEY: lane.SERVICE_ROLE_KEY,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: lane.ANON_KEY,
          }
        : {}),
      VITEST_LIVE_DB_INTENDED: "1",
    },
    // Real sign-in round trips and real row writes are slower than a unit test
    // by an order of magnitude.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One stack, one database, shared by every file here. Never run them in
    // parallel with each other.
    fileParallelism: false,
    // ⛔ An empty run is the silent-green this lane exists to eliminate: if the
    // include list ever resolves to nothing, vitest must say so rather than
    // exit 0. (The derivation above throws first; this is the second control.)
    passWithNoTests: false,
    // ⭐ THE EXECUTION ARTIFACT (Phase 164.9, the ledger round arising from plan
    // 08 and its fix round). `default` first, so the output a developer reads is
    // unchanged; the second reporter ADDITIONALLY writes
    // `.live-db-lane-execution.json`, which `scripts/live-db-execution-ledger.mjs`
    // compares against the committed execution ledger. It observes the run at its
    // end — it selects no test, skips no test, and cannot change an outcome.
    //
    // ⛔ THIS IS NOT THE REPORTING CONFIGURATION THE HEADER ABOVE REFUSES. That
    // refusal is about COVERAGE: a third coverage blob would shift the merged
    // ratchet's denominator and invalidate a baseline backing a BLOCKING gate.
    // This reporter emits no coverage of any kind. Coverage stays undeclared in
    // this file, so a search for THAT concept over it still returns zero.
    reporters: [
      "default",
      [
        "./scripts/live-db-execution-reporter.mjs",
        { outputFile: ".live-db-lane-execution.json" },
      ],
    ],
  },
  resolve: {
    // Same `@` -> src alias as vitest.config.ts.
    alias: {
      "@": resolve(REPO_ROOT, "src"),
    },
  },
});
