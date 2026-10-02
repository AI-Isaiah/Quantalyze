import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * SECOND, STANDALONE vitest project — the seam-breaker real-Redis lane
 * (Phase 140.2 / SEAMCORE-09).
 *
 * WHY A SEPARATE CONFIG RATHER THAN A NEW GLOB IN `vitest.config.ts`
 * -----------------------------------------------------------------
 * `src/lib/resilient-fetch.ts` constructs its Upstash client at MODULE SCOPE
 * from `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, and roughly
 * twenty files in the main suite DELETE those two variables precisely to
 * exercise the core's unconfigured path. A lane that needs them SET therefore
 * cannot share an environment with the main sharded run. `.github/workflows/
 * ci.yml`'s `frontend-test:` job already carries a warning of exactly this
 * shape ("DO NOT add NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env
 * to this job"); this config is the same precedent, inverted.
 *
 * `include` is `tests/redis/**` and NOTHING else — a path `vitest.config.ts`
 * deliberately does not glob, so the main sharded run is byte-unaffected and
 * the shards never attempt a lane whose two containers do not exist there.
 *
 * ⚠️ DELIBERATE DIVERGENCE FROM `140.2-PATTERNS.md`, recorded so nobody
 * "corrects" it back. PATTERNS gives this lane's home as `tests/integration/**`
 * on the grounds that it is "already in the vitest include list". That is the
 * exact property being avoided: being inside the main include list is what
 * would drag this lane into the sharded run.
 *
 * USAGE
 *   docker compose -f docker-compose.redis-test.yml up -d
 *   npm run test:redis
 */
export default defineConfig({
  test: {
    // `node`, not the repo-default `jsdom`. jsdom buys nothing here and its
    // `DOMException`/`Response` divergences from the Node runtime are a
    // documented hazard on this seam (analytics-client.ts:148-155).
    environment: "node",
    include: ["tests/redis/**/*.test.ts"],
    // R-7 drives TWO real ~32 s recovery waits against a real timer — fake
    // timers are forbidden in this lane because the Lua reads `now` from the
    // client's `Date.now()` while the Redis-side TTLs are real, and stubbing
    // one half produces confidently wrong results.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // One file, sharing one real keyspace. Never run it in parallel with
    // itself.
    fileParallelism: false,
    // Coverage is OFF, and must stay off. `frontend-coverage` merges the two
    // shards' blob reports and enforces the ratchet thresholds on the merged
    // numbers; a third blob from this lane would shift the denominator and
    // invalidate the baseline.
    coverage: { enabled: false },
  },
  resolve: {
    // Same `@` -> src alias as vitest.config.ts.
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
