/**
 * The `*.test.ts` files that run on the LOCAL-STACK LANE — a booted Supabase CLI
 * stack (`scripts/local-stack/run.sh up`), not the sharded unit run.
 *
 * ONE list, TWO consumers, so the two can never disagree:
 *   * `vitest.config.ts` — the jsdom project's `exclude`. These files need
 *     PostgREST + GoTrue over HTTP, which the sharded `frontend-test` job does not
 *     have; left in, they would redden every shard.
 *   * `vitest.local-stack.config.ts` — that config's entire `include`. This is the
 *     lane's own invocation, run by the `frontend-local-stack` CI job after it boots
 *     the stack.
 *
 * ⚠️ THIS LIST IS A THIRD FILE SET, and it deliberately breaks the two-way
 * "complementary by construction" rule `vitest.node-env.ts` states for the
 * jsdom/node split. The main run's coverage is therefore
 * `INCLUDE − NODE_ENV_TEST_FILES − LOCAL_STACK_LANE_FILES`, and these files are
 * covered by the lane job instead. That is the whole point: a file here does NOT
 * run in the shards.
 *
 * ⛔ WHICH MAKES THE OMISSION DANGEROUS, so it is pinned. A file listed here and
 * NOT run by a CI job that boots the lane is a file that runs NOWHERE — the exact
 * shape of `src/__tests__/csv-finalize-rpc.test.ts`'s tombstone (six live-DB cases
 * that skipped silently in every shard for months). `src/__tests__/
 * local-stack-lane-wiring.test.ts` runs in the ordinary shards and asserts that
 * every entry here is named by a `ci.yml` job which is wired into the `frontend`
 * aggregator's `needs:` list AND its result loop.
 *
 * ADDING A FILE. Only if it genuinely needs the booted stack. Everything that can
 * be asserted without one belongs in the shards, where it runs on every push.
 */
export const LOCAL_STACK_LANE_FILES: string[] = [
  // VAC-07 / Phase 164.5 criterion 6 — two concurrent csv-finalize POSTs on one
  // never-classified wizard session, driven from two clients with separate access
  // tokens.
  "src/__tests__/csv-finalize-concurrent-never-classified.test.ts",
];
