import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { LOCAL_STACK_LANE_FILES } from "./vitest.local-stack-files";

/**
 * THIRD, STANDALONE vitest project — the local-stack lane (Phase 164.5 / VAC-07).
 *
 * WHY A SEPARATE CONFIG RATHER THAN A GLOB IN `vitest.config.ts`
 * -------------------------------------------------------------
 * The files in `LOCAL_STACK_LANE_FILES` drive real HTTP against a booted Supabase
 * CLI stack — PostgREST, GoTrue, Postgres — started by `scripts/local-stack/run.sh
 * up`. The sharded `frontend-test` job has no such stack, so a shared glob would
 * redden every shard. Precedent, and the same shape inverted: `vitest.redis.config.ts`
 * exists because ~20 files in the main suite DELETE the two Upstash variables its
 * lane needs SET.
 *
 * ⛔ AND THE FILES MUST NOT SKIP WHEN THE STACK IS ABSENT. That is the other half of
 * the arrangement and the reason this lane is a separate INVOCATION rather than an
 * env-gate: an env-gated live-DB spec inside the shards is exactly
 * `src/__tests__/csv-finalize-rpc.test.ts`, six cases that skipped silently in every
 * CI shard over a DROPped function. Coverage that cannot execute is worse than
 * absent coverage. Here, an absent lane is a THROWN, named failure and a non-zero
 * exit — see the `beforeAll` in each lane spec.
 *
 * USAGE
 *   bash scripts/local-stack/run.sh up
 *   npm run test:local-stack
 *   bash scripts/local-stack/run.sh down
 *
 * CI: the `frontend-local-stack` job in `.github/workflows/ci.yml` runs exactly that
 * sequence and is wired into the `frontend` aggregator in BOTH its `needs:` list and
 * its result loop.
 */
export default defineConfig({
  test: {
    // `node`, not the repo-default `jsdom`. These specs invoke route handlers and
    // supabase-js; a DOM buys nothing and jsdom's `Response`/`DOMException`
    // divergences from the Node runtime are a documented hazard on this seam.
    environment: "node",
    include: LOCAL_STACK_LANE_FILES,
    // ⛔ RESTATED, NOT INHERITED. This is a standalone ROOT config, not a project of
    // `vitest.config.ts`, so it inherits NOTHING — and that file says the price in
    // its own words: "a project that forgot `setupFiles` would silently lose the
    // env-restore fence". The fence exists because DEF-16-1, this repo's known
    // CI-only failure class, is an ORDERING defect from unrestored `process.env` and
    // `globalThis` writes. `fileParallelism: false` below puts every lane file in ONE
    // worker process, so a direct `process.env.X =` in the first file reaches the
    // second — latent while the lane holds one file, live on the next one added.
    setupFiles: ["src/test-setup.ts"],
    unstubGlobals: true,
    unstubEnvs: true,
    // The lane boots a real stack and creates real auth users; sign-in round trips
    // and the concurrent POSTs are slower than a unit test by an order of magnitude.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // One stack, one database, shared by every file here. Never run them in
    // parallel with each other.
    fileParallelism: false,
    // ⛔ An empty run is the silent-green this lane exists to eliminate: if the
    // include list ever resolves to nothing, vitest must say so rather than exit 0.
    passWithNoTests: false,
    // Coverage is OFF and must stay off. `frontend-coverage` merges the two shards'
    // blob reports and enforces the ratchet thresholds on the merged numbers; a
    // third blob from this lane would shift the denominator and invalidate the
    // baseline. (Same rule as `vitest.redis.config.ts`.)
    coverage: { enabled: false },
  },
  resolve: {
    // Same `@` -> src alias as vitest.config.ts.
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
