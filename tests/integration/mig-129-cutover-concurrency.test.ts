/**
 * Migration 129 — cutover_strategy_metrics_keys_atomic concurrency coverage.
 *
 * audit-2026-05-07 round 2 Block E Task E.2 — P2047 (CRITICAL).
 *
 * Why this exists
 * ---------------
 * The migration-129 RPC body does:
 *
 *     SELECT metrics_json INTO v_snapshot
 *       FROM strategy_analytics
 *      WHERE strategy_id = p_strategy_id
 *      FOR UPDATE;
 *
 * The `FOR UPDATE` clause takes a row lock that is held for the rest of the
 * transaction. Two callers that target the SAME strategy_id must be
 * serialized — caller B must wait until caller A commits before its own
 * SELECT proceeds.
 *
 * The SQL self-test at supabase/tests/test_cutover_strategy_metrics_keys_atomic.sql
 * cannot exercise this — a single psql session is one transaction and one
 * connection, so it cannot prove the lock actually blocks a concurrent
 * writer. This file uses TWO independent Supabase service-role clients to
 * issue concurrent calls and asserts the observable serialization.
 *
 * Two scenarios are covered:
 *   1. Concurrent RPC calls on the SAME strategy — both succeed, the
 *      second sees moved=0 (the first stripped the keys), no duplicate
 *      rows in strategy_analytics_series.
 *   2. Concurrent RPC calls on DIFFERENT strategies — both succeed
 *      independently with moved=1 each (they hold different row locks
 *      and never contend).
 *
 * Skip-guard
 * ----------
 * Gated on SUPABASE_TEST_URL + SUPABASE_TEST_SERVICE_ROLE_KEY (the same
 * env vars as tests/integration/cron-flag-monitor-rollback-e2e.test.ts).
 * Local /ship runs without those env vars skip the entire describe block.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const HAS_TEST_SUPABASE =
  Boolean(process.env.SUPABASE_TEST_URL) &&
  Boolean(process.env.SUPABASE_TEST_SERVICE_ROLE_KEY);

describe.skipIf(!HAS_TEST_SUPABASE)(
  "Migration 129 — cutover_strategy_metrics_keys_atomic concurrency (P2047)",
  () => {
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;

    // Track seed rows for cleanup. Use distinct UUIDs per test run to avoid
    // collision with parallel CI runs.
    const seedUserIds: string[] = [];
    const seedApiKeyIds: string[] = [];
    const seedStrategyIds: string[] = [];

    beforeAll(async () => {
      const { createClient } = await import("@supabase/supabase-js");
      // Two independent service-role clients so each RPC call goes through
      // its own underlying HTTP connection / Postgres session — required
      // for the FOR UPDATE lock test to be meaningful.
      clientA = createClient(
        process.env.SUPABASE_TEST_URL!,
        process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );
      clientB = createClient(
        process.env.SUPABASE_TEST_URL!,
        process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );
    });

    afterAll(async () => {
      // Order matches FK chain: strategy_analytics_series → strategy_analytics
      // → strategies → api_keys → profiles → auth.users. Use service-role
      // client A; both clients hit the same DB.
      if (seedStrategyIds.length > 0) {
        await clientA
          .from("strategy_analytics_series")
          .delete()
          .in("strategy_id", seedStrategyIds);
        await clientA
          .from("strategy_analytics")
          .delete()
          .in("strategy_id", seedStrategyIds);
        await clientA.from("strategies").delete().in("id", seedStrategyIds);
      }
      if (seedApiKeyIds.length > 0) {
        await clientA.from("api_keys").delete().in("id", seedApiKeyIds);
      }
      if (seedUserIds.length > 0) {
        await clientA.from("profiles").delete().in("id", seedUserIds);
        for (const uid of seedUserIds) {
          await clientA.auth.admin.deleteUser(uid);
        }
      }
    });

    /**
     * Seed a strategy with strategy_analytics.metrics_json containing the
     * given keys. Returns { userId, apiKeyId, strategyId } and registers
     * each for afterAll cleanup.
     */
    async function seedStrategyWithMetrics(
      metrics: Record<string, unknown>,
      labelSuffix: string,
    ): Promise<{ userId: string; apiKeyId: string; strategyId: string }> {
      // Create an auth user first; profiles has FK on auth.users(id).
      const email = `mig129-${labelSuffix}-${crypto.randomUUID()}@quantalyze.test`;
      const created = await clientA.auth.admin.createUser({
        email,
        password: `Test${crypto.randomUUID()}!`,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw new Error(
          `Seed: createUser failed: ${created.error?.message ?? "no user"}`,
        );
      }
      const userId = created.data.user.id;
      seedUserIds.push(userId);

      // profiles row (on_auth_user_created trigger may insert a default;
      // upsert with our desired display_name is safe).
      const profIns = await clientA
        .from("profiles")
        .upsert(
          { id: userId, display_name: `mig129-${labelSuffix}`, email },
          { onConflict: "id" },
        );
      if (profIns.error) {
        throw new Error(`Seed: profile upsert failed: ${profIns.error.message}`);
      }

      // api_keys row (required FK target for strategies.api_key_id, but
      // we only need any active row for the same user).
      const apiKeyRes = await clientA
        .from("api_keys")
        .insert({
          user_id: userId,
          exchange: "binance",
          label: `mig129-${labelSuffix}`,
          api_key_encrypted: "test-only:not-a-real-secret",
          is_active: true,
          kek_version: 1,
        })
        .select("id")
        .single();
      if (apiKeyRes.error || !apiKeyRes.data) {
        throw new Error(
          `Seed: api_key insert failed: ${apiKeyRes.error?.message ?? "no row"}`,
        );
      }
      const apiKeyId = apiKeyRes.data.id as string;
      seedApiKeyIds.push(apiKeyId);

      // strategies row — status 'published' so the RPC sees a real strategy.
      const strategyRes = await clientA
        .from("strategies")
        .insert({
          user_id: userId,
          api_key_id: apiKeyId,
          name: `mig129 ${labelSuffix} strategy`,
          status: "published",
          strategy_types: [],
          subtypes: [],
          markets: [],
          supported_exchanges: ["binance"],
        })
        .select("id")
        .single();
      if (strategyRes.error || !strategyRes.data) {
        throw new Error(
          `Seed: strategy insert failed: ${strategyRes.error?.message ?? "no row"}`,
        );
      }
      const strategyId = strategyRes.data.id as string;
      seedStrategyIds.push(strategyId);

      // strategy_analytics row with the test metrics_json payload.
      const analyticsRes = await clientA.from("strategy_analytics").insert({
        strategy_id: strategyId,
        computation_status: "complete",
        metrics_json: metrics,
      });
      if (analyticsRes.error) {
        throw new Error(
          `Seed: strategy_analytics insert failed: ${analyticsRes.error.message}`,
        );
      }

      return { userId, apiKeyId, strategyId };
    }

    /**
     * Test 1 — Concurrent cutover on the SAME strategy.
     *
     * Seed a strategy whose metrics_json contains both a heavy key
     * (daily_returns_grid) and a non-allowlist key (sharpe). Issue two
     * concurrent RPC calls from independent clients via Promise.all.
     *
     * Asserts:
     *   * Both calls return without error (one waits via the FOR UPDATE
     *     row lock and completes only after the first commits).
     *   * The COMBINED `moved` count is exactly 1 — the second caller's
     *     snapshot, taken after the first committed, no longer contains
     *     the heavy key, so moved=0 for it.
     *   * strategy_analytics_series has exactly ONE row for kind=
     *     daily_returns_grid (UPSERT, not duplicate insert).
     *   * metrics_json no longer has daily_returns_grid (stripped by the
     *     first call; second call's `metrics_json - allowlist` is a no-op
     *     because the key is already gone).
     *   * Non-allowlist key (sharpe) is preserved.
     *
     * Pre-mig-129 FAIL state: without FOR UPDATE, both callers race the
     * snapshot. Both see daily_returns_grid present, both upsert the
     * sibling row, both try to strip — but the second commit's `metrics_json -
     * keys` overwrites the first. The race can manifest as
     * strategy_analytics_series.payload being stale (the loser of the race
     * wrote first), or — more catastrophically pre-128/129 — the strip
     * removes a key that the analytics_runner just rewrote with a fresh
     * payload.
     */
    it(
      "test_concurrent_cutover_same_strategy_serializes",
      async () => {
        const heavyPayload = [{ d: "2026-01-01", r: 0.01 }];
        const { strategyId } = await seedStrategyWithMetrics(
          {
            daily_returns_grid: heavyPayload,
            sharpe: 1.5,
            cagr: 0.2,
          },
          "same-strategy",
        );

        const [resA, resB] = await Promise.all([
          clientA.rpc("cutover_strategy_metrics_keys_atomic", {
            p_strategy_id: strategyId,
          }),
          clientB.rpc("cutover_strategy_metrics_keys_atomic", {
            p_strategy_id: strategyId,
          }),
        ]);

        // Neither call errored. (The serialization is transparent to the
        // caller — the loser just waits, then proceeds.)
        expect(resA.error, `clientA error: ${resA.error?.message}`).toBeNull();
        expect(resB.error, `clientB error: ${resB.error?.message}`).toBeNull();

        // Exactly one of the two calls moved the heavy key; the other
        // saw moved=0 because by then the key was already stripped.
        const movedA = (resA.data as { moved: number } | null)?.moved ?? -1;
        const movedB = (resB.data as { moved: number } | null)?.moved ?? -1;
        expect(movedA + movedB).toBe(1);
        expect([movedA, movedB].sort()).toEqual([0, 1]);

        // strategy_analytics_series — exactly ONE row for the heavy key
        // (UPSERT, not duplicate insert from the racing pair).
        const seriesRows = await clientA
          .from("strategy_analytics_series")
          .select("payload")
          .eq("strategy_id", strategyId)
          .eq("kind", "daily_returns_grid");
        expect(seriesRows.error).toBeNull();
        expect(seriesRows.data).toHaveLength(1);
        expect(seriesRows.data?.[0]?.payload).toEqual(heavyPayload);

        // metrics_json: heavy key stripped, non-allowlist preserved.
        const metricsRow = await clientA
          .from("strategy_analytics")
          .select("metrics_json")
          .eq("strategy_id", strategyId)
          .single();
        expect(metricsRow.error).toBeNull();
        const metrics = metricsRow.data?.metrics_json as Record<string, unknown>;
        expect(metrics).toBeDefined();
        expect("daily_returns_grid" in metrics).toBe(false);
        expect(metrics.sharpe).toBe(1.5);
        expect(metrics.cagr).toBe(0.2);
      },
      60_000,
    );

    /**
     * Test 2 — Concurrent cutover on DIFFERENT strategies proceeds in
     * parallel (each holds its own row lock; no contention).
     *
     * Two distinct strategies, both seeded with daily_returns_grid. Both
     * calls should return moved=1, and both sibling rows should exist.
     * This pins the invariant that the row-level FOR UPDATE does NOT
     * over-block — strategy-A's cutover does not stall strategy-B's
     * unrelated cutover.
     */
    it(
      "test_concurrent_cutover_different_strategies_run_in_parallel",
      async () => {
        const seed1 = await seedStrategyWithMetrics(
          { daily_returns_grid: [{ d: "2026-01-01", r: 0.01 }] },
          "diff1",
        );
        const seed2 = await seedStrategyWithMetrics(
          { daily_returns_grid: [{ d: "2026-01-02", r: 0.02 }] },
          "diff2",
        );

        const [res1, res2] = await Promise.all([
          clientA.rpc("cutover_strategy_metrics_keys_atomic", {
            p_strategy_id: seed1.strategyId,
          }),
          clientB.rpc("cutover_strategy_metrics_keys_atomic", {
            p_strategy_id: seed2.strategyId,
          }),
        ]);

        expect(res1.error, `seed1 error: ${res1.error?.message}`).toBeNull();
        expect(res2.error, `seed2 error: ${res2.error?.message}`).toBeNull();
        expect((res1.data as { moved: number }).moved).toBe(1);
        expect((res2.data as { moved: number }).moved).toBe(1);

        // Each strategy got its own sibling row.
        for (const sid of [seed1.strategyId, seed2.strategyId]) {
          const sib = await clientA
            .from("strategy_analytics_series")
            .select("strategy_id")
            .eq("strategy_id", sid)
            .eq("kind", "daily_returns_grid");
          expect(sib.error).toBeNull();
          expect(sib.data).toHaveLength(1);
        }
      },
      60_000,
    );

    /**
     * Test 3 — Concurrent UPDATE on strategy_analytics.metrics_json is
     * serialized behind the cutover's FOR UPDATE.
     *
     * Client A starts the RPC (which acquires the row lock and starts
     * doing work). Client B issues an UPDATE on the same
     * strategy_analytics row. The UPDATE must wait until A's RPC commits.
     * This pins the P2047 invariant from the writer side: the runner
     * cannot mutate metrics_json mid-cutover.
     *
     * Implementation note: we can't directly observe Postgres lock waits
     * from the JS client, but we CAN observe the post-condition: B's
     * update completed AFTER A's commit, so B's value lands on top of
     * the stripped state. The test asserts that B's update fields are
     * present in metrics_json AND that the heavy key A stripped is still
     * absent (i.e., B did not race A; B saw A's stripped state and
     * merged its update on top).
     */
    it(
      "test_concurrent_writer_serializes_behind_cutover_lock",
      async () => {
        const { strategyId } = await seedStrategyWithMetrics(
          {
            daily_returns_grid: [{ d: "2026-01-01", r: 0.01 }],
            sharpe: 1.0,
          },
          "writer-race",
        );

        // Kick off A and B concurrently.
        // A: cutover RPC (acquires FOR UPDATE on the row).
        // B: UPDATE that sets sharpe to a sentinel value the runner might
        //    have written. PostgREST update under service-role waits on
        //    the row lock the same way a runner connection would.
        const [rpcRes, updateRes] = await Promise.all([
          clientA.rpc("cutover_strategy_metrics_keys_atomic", {
            p_strategy_id: strategyId,
          }),
          clientB
            .from("strategy_analytics")
            .update({
              metrics_json: {
                daily_returns_grid: [{ d: "2026-01-01", r: 0.99 }],
                sharpe: 2.5,
              },
            })
            .eq("strategy_id", strategyId),
        ]);

        expect(rpcRes.error, `rpc error: ${rpcRes.error?.message}`).toBeNull();
        expect(
          updateRes.error,
          `update error: ${updateRes.error?.message}`,
        ).toBeNull();

        // The two valid serial orderings:
        //
        //   (a) A first, then B: A strips daily_returns_grid (moved=1).
        //       B's UPDATE overwrites metrics_json with the new full
        //       object, putting daily_returns_grid BACK with the runner's
        //       fresh payload.
        //   (b) B first, then A: B writes the new full object. A reads
        //       it under FOR UPDATE, strips daily_returns_grid (moved=1),
        //       leaving only sharpe=2.5.
        //
        // The ONLY invalid outcome would be a torn read/write: A's
        // snapshot was stale and stripped a key whose payload was B's
        // freshly-computed value, leaving the sibling with a stale
        // payload that doesn't match metrics_json's stripped state. We
        // can't observe that from the client side directly, but we CAN
        // assert that moved=1 (the FOR UPDATE held the lock, so A saw a
        // consistent snapshot) and that final state is one of (a)/(b).
        const moved = (rpcRes.data as { moved: number } | null)?.moved ?? -1;
        expect(moved).toBe(1);

        const finalRow = await clientA
          .from("strategy_analytics")
          .select("metrics_json")
          .eq("strategy_id", strategyId)
          .single();
        expect(finalRow.error).toBeNull();
        const finalMetrics = finalRow.data?.metrics_json as Record<
          string,
          unknown
        >;
        // Either valid serial ordering must leave sharpe at 2.5 (Tx B's write):
        //   - A-before-B: cutover runs first (daily_returns_grid moved into sibling,
        //     stripped from metrics_json), then B writes sharpe=2.5 → final state
        //     has sharpe=2.5 and NO daily_returns_grid.
        //   - B-before-A: B writes sharpe=2.5 first, then cutover sees the
        //     post-B metrics_json, moves any heavy keys present → final state
        //     also has sharpe=2.5 and NO daily_returns_grid (cutover strips it).
        // Either way, after both transactions commit, daily_returns_grid MUST
        // be absent and sharpe MUST be 2.5. The earlier dual-`orderingA/B`
        // construction was logically `sharpe===2.5` because the daily_returns_grid
        // half cancelled out via OR — the assertion below pins both invariants
        // explicitly so a future regression that leaves daily_returns_grid in
        // metrics_json fails the test instead of passing silently.
        expect(finalMetrics.sharpe).toBe(2.5);
        expect("daily_returns_grid" in finalMetrics).toBe(false);
      },
      60_000,
    );
  },
);
