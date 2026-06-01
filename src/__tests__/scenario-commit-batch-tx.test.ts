/**
 * Live-DB integration test — Migration 082 commit_scenario_batch SECURITY DEFINER RPC
 * (Phase 10 / SCENARIO-07 — H4 + M7 verification).
 *
 * Verifies migration 082 shipped the SECURITY DEFINER RPC that the Plan 07
 * POST /api/allocator/scenario/commit route delegates to for the H4 single-tx
 * invariant (CONTEXT D-09 — single Postgres transaction).
 *
 *   T_RPC_PRESENT             : pg_proc.prosecdef = t for commit_scenario_batch
 *   T_RPC_SEARCH_PATH         : proconfig includes 'search_path=public'
 *   T_RPC_AUTH_GUARD_STRING   : prosrc contains the literal "auth.uid() <> p_allocator_id"
 *   T_RPC_GRANT_AUTHENTICATED : has_function_privilege('authenticated', ..., 'EXECUTE') = t
 *   T_RPC_NO_GRANT_ANON       : has_function_privilege('anon', ..., 'EXECUTE') = f
 *   T_RPC_NO_GRANT_PUBLIC     : has_function_privilege('public', ..., 'EXECUTE') = f
 *   T_RPC_RETURN_SHAPE_OK     : single voluntary_remove diff → ok=true + recorded[]
 *   T_RPC_SINGLE_TX_ROLLBACK  : (H4 flagship) row-2 conflict rolls back row-1 — no
 *                               match_decisions / bridge_outcomes leak through
 *   T_RPC_OWNERSHIP_GUARD_BLOCKS : per-row holding_ref ownership probe rejects
 *                                  un-owned holding refs
 *   T_RPC_AUTH_UID_MISMATCH   : caller's auth.uid() <> p_allocator_id → RAISES
 *   T_RPC_STRATEGY_GATE       : voluntary_add for non-published strategy is rejected
 *   T_RPC_VA_HAPPY            : voluntary_add for published strategy → ok=true,
 *                               match_decisions kind='voluntary_add' + bridge_outcomes
 *                               kind='allocated' with strategy_id set
 *   T_RPC_VR_BO_NULL_STRATEGY : voluntary_remove → bridge_outcomes strategy_id IS NULL
 *   T_RPC_M7_REUSE_FIRST_INSERT : (M7) bridge_recommended for a NEW tuple → INSERT
 *   T_RPC_M7_REUSE_SECOND_REUSES: (M7) same tuple again → SELECT-then-reuse, no new
 *                                  match_decision row INSERTed (count stays the same)
 *
 * Pattern: admin client for fixture setup (match_decisions has admin/service-role
 * RLS only); the RPC itself is invoked via admin.rpc() with explicit p_allocator_id.
 * For T_RPC_AUTH_UID_MISMATCH we exercise the path via a non-service-role client.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
 *       (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF for prosecdef introspection).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  HAS_INTROSPECTION,
  createLiveAdminClient,
  runIntrospectionSql,
  advertiseLiveDbSkipReason,
  LIVE_DB_URL,
} from "@/lib/test-helpers/live-db";
import type { SupabaseClient } from "@supabase/supabase-js";

const STRATEGY_PUBLISHED = "00000000-0000-0000-0000-000000001090";
const STRATEGY_DRAFT = "00000000-0000-0000-0000-000000001091";
const STRATEGY_M7 = "00000000-0000-0000-0000-000000001092";

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HAS_ANON_KEY = Boolean(ANON_KEY);

describe("migration 082 — commit_scenario_batch SECURITY DEFINER RPC (live-DB)", () => {
  advertiseLiveDbSkipReason("scenario-commit-batch-tx");

  let admin: SupabaseClient;
  // userClientA: signed in as allocator A — used for RPC calls so auth.uid() is set
  let userClientA: SupabaseClient;
  // userClientB: signed in as allocator B — used to test cross-tenant rejection
  let userClientB: SupabaseClient;
  let allocatorAId: string;
  let allocatorAEmail: string;
  let allocatorAPassword: string;
  let allocatorBId: string;
  let allocatorBEmail: string;
  let allocatorBPassword: string;
  const trackedMatchDecisionIds: string[] = [];
  const trackedBridgeOutcomeIds: string[] = [];

  beforeAll(async () => {
    if (!HAS_LIVE_DB) return;
    admin = createLiveAdminClient();
    const ts = Date.now();

    // Allocator A — primary fixture allocator
    allocatorAEmail = `phase10-rpc-A-${ts}@test.local`;
    allocatorAPassword = `LiveDbTest${ts}!`;
    const aResult = await admin.auth.admin.createUser({
      email: allocatorAEmail,
      password: allocatorAPassword,
      email_confirm: true,
    });
    if (aResult.error || !aResult.data.user) {
      throw new Error(
        `Failed to create allocator A: ${aResult.error?.message}`,
      );
    }
    allocatorAId = aResult.data.user.id;
    await admin
      .from("profiles")
      .upsert(
        { id: allocatorAId, display_name: allocatorAEmail },
        { onConflict: "id" },
      );

    // Allocator B — used to test cross-tenant ownership/auth.uid() mismatch
    allocatorBEmail = `phase10-rpc-B-${ts}@test.local`;
    allocatorBPassword = `LiveDbTest${ts}!`;
    const bResult = await admin.auth.admin.createUser({
      email: allocatorBEmail,
      password: allocatorBPassword,
      email_confirm: true,
    });
    if (bResult.error || !bResult.data.user) {
      throw new Error(
        `Failed to create allocator B: ${bResult.error?.message}`,
      );
    }
    allocatorBId = bResult.data.user.id;
    await admin
      .from("profiles")
      .upsert(
        { id: allocatorBId, display_name: allocatorBEmail },
        { onConflict: "id" },
      );

    // Build user-scoped Supabase clients for both allocators (anon key + signInWithPassword).
    // The RPC is gated on auth.uid() = p_allocator_id; calling via the service-role client
    // would fire the v_caller IS NULL branch of the guard. The route layer always invokes
    // with a real authenticated session; tests must mirror that contract.
    if (HAS_ANON_KEY) {
      userClientA = createClient(LIVE_DB_URL!, ANON_KEY!);
      const signInA = await userClientA.auth.signInWithPassword({
        email: allocatorAEmail,
        password: allocatorAPassword,
      });
      if (signInA.error) {
        throw new Error(
          `Failed to sign in allocator A: ${signInA.error.message}`,
        );
      }
      userClientB = createClient(LIVE_DB_URL!, ANON_KEY!);
      const signInB = await userClientB.auth.signInWithPassword({
        email: allocatorBEmail,
        password: allocatorBPassword,
      });
      if (signInB.error) {
        throw new Error(
          `Failed to sign in allocator B: ${signInB.error.message}`,
        );
      }
    }

    // Seed strategies — published (happy paths) + draft (gate path) + M7 anchor
    const seed = await admin.from("strategies").upsert(
      [
        {
          id: STRATEGY_PUBLISHED,
          user_id: allocatorAId,
          name: "Phase10 RPC published (synthetic)",
          status: "published",
        },
        {
          id: STRATEGY_DRAFT,
          user_id: allocatorAId,
          name: "Phase10 RPC draft (synthetic)",
          status: "draft",
        },
        {
          id: STRATEGY_M7,
          user_id: allocatorAId,
          name: "Phase10 RPC M7 reuse anchor (synthetic)",
          status: "published",
        },
      ],
      { onConflict: "id" },
    );
    if (seed.error) {
      throw new Error(`Failed to seed strategies: ${seed.error.message}`);
    }
    await admin.from("strategy_analytics").upsert(
      [
        { strategy_id: STRATEGY_PUBLISHED, returns_series: [] },
        { strategy_id: STRATEGY_DRAFT, returns_series: [] },
        { strategy_id: STRATEGY_M7, returns_series: [] },
      ],
      { onConflict: "strategy_id" },
    );

    // Seed api_keys (FK target for allocator_holdings.api_key_id NOT NULL) for both
    // allocators. The encrypted column carries a sentinel value — no decrypt is
    // performed in this test path.
    const apiKeyAId = "00000000-0000-0000-0000-000000001095";
    const apiKeyBId = "00000000-0000-0000-0000-000000001096";
    await admin.from("api_keys").upsert(
      [
        {
          id: apiKeyAId,
          user_id: allocatorAId,
          exchange: "binance",
          label: "Phase10 RPC test (synthetic)",
          api_key_encrypted: "test-only:not-a-real-secret",
          is_active: true,
          kek_version: 1,
        },
        {
          id: apiKeyBId,
          user_id: allocatorBId,
          exchange: "okx",
          label: "Phase10 RPC test B (synthetic)",
          api_key_encrypted: "test-only:not-a-real-secret",
          is_active: true,
          kek_version: 1,
        },
      ],
      { onConflict: "id" },
    );

    // Seed allocator_holdings rows so the RPC's ownership probe (which JOINs against
    // (venue, symbol, holding_type) parsed from the diff's holding_ref via
    // parse_holding_ref) succeeds. Note: allocator_holdings has NO scope_ref column
    // by design — the canonical scope columns are (venue, symbol, holding_type).
    const today = new Date().toISOString().slice(0, 10);
    const holdingsRes = await admin.from("allocator_holdings").upsert(
      [
        {
          allocator_id: allocatorAId,
          api_key_id: apiKeyAId,
          asof: today,
          venue: "binance",
          symbol: "BTC",
          holding_type: "spot",
          side: "long",
          quantity: 1,
          value_usd: 100,
          mark_price: 100,
        },
        {
          allocator_id: allocatorAId,
          api_key_id: apiKeyAId,
          asof: today,
          venue: "binance",
          symbol: "ETH",
          holding_type: "spot",
          side: "long",
          quantity: 1,
          value_usd: 100,
          mark_price: 100,
        },
        {
          allocator_id: allocatorBId,
          api_key_id: apiKeyBId,
          asof: today,
          venue: "okx",
          symbol: "SOL",
          holding_type: "spot",
          side: "long",
          quantity: 1,
          value_usd: 50,
          mark_price: 50,
        },
      ],
      { onConflict: "allocator_id,venue,symbol,asof" },
    );
    if (holdingsRes.error) {
      throw new Error(
        `Failed to seed allocator_holdings: ${holdingsRes.error.message}`,
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (!HAS_LIVE_DB) return;
    if (trackedBridgeOutcomeIds.length > 0) {
      await admin
        .from("bridge_outcomes")
        .delete()
        .in("id", trackedBridgeOutcomeIds);
    }
    if (trackedMatchDecisionIds.length > 0) {
      await admin
        .from("match_decisions")
        .delete()
        .in("id", trackedMatchDecisionIds);
    }
    // Clean any rows the RPC created that we did not track explicitly
    await admin
      .from("bridge_outcomes")
      .delete()
      .in("allocator_id", [allocatorAId, allocatorBId]);
    await admin
      .from("match_decisions")
      .delete()
      .in("allocator_id", [allocatorAId, allocatorBId]);
    await admin
      .from("allocator_holdings")
      .delete()
      .in("allocator_id", [allocatorAId, allocatorBId]);
    await admin
      .from("api_keys")
      .delete()
      .in("user_id", [allocatorAId, allocatorBId]);
    await admin
      .from("strategy_analytics")
      .delete()
      .in("strategy_id", [STRATEGY_PUBLISHED, STRATEGY_DRAFT, STRATEGY_M7]);
    await admin
      .from("strategies")
      .delete()
      .in("id", [STRATEGY_PUBLISHED, STRATEGY_DRAFT, STRATEGY_M7]);
    await admin.auth.admin.deleteUser(allocatorAId);
    await admin.auth.admin.deleteUser(allocatorBId);
  }, 60_000);

  // ===========================================================================
  // RPC introspection cases (Management API)
  // ===========================================================================

  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_RPC_PRESENT: pg_proc.prosecdef = t for commit_scenario_batch",
    async () => {
      const rows = await runIntrospectionSql<{ prosecdef: boolean }>(
        "SELECT prosecdef FROM pg_proc WHERE proname='commit_scenario_batch'",
      );
      expect(rows.length).toBe(1);
      expect(rows[0].prosecdef).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_RPC_SEARCH_PATH: proconfig includes search_path=public",
    async () => {
      const rows = await runIntrospectionSql<{ cfg: string | null }>(
        "SELECT array_to_string(proconfig, ',') AS cfg FROM pg_proc WHERE proname='commit_scenario_batch'",
      );
      expect(rows.length).toBe(1);
      expect(rows[0].cfg).toMatch(/search_path=public/);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_RPC_AUTH_GUARD_STRING: prosrc contains 'auth.uid() <> p_allocator_id'",
    async () => {
      const rows = await runIntrospectionSql<{ prosrc: string }>(
        "SELECT prosrc FROM pg_proc WHERE proname='commit_scenario_batch'",
      );
      expect(rows.length).toBe(1);
      expect(rows[0].prosrc).toMatch(/auth\.uid\(\) <> p_allocator_id/);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_RPC_GRANT_AUTHENTICATED: authenticated has EXECUTE",
    async () => {
      const rows = await runIntrospectionSql<{ has_priv: boolean }>(
        "SELECT has_function_privilege('authenticated', 'public.commit_scenario_batch(uuid, jsonb, text, text, text)', 'EXECUTE') AS has_priv",
      );
      expect(rows.length).toBe(1);
      expect(rows[0].has_priv).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_RPC_NO_GRANT_ANON: anon does NOT have EXECUTE",
    async () => {
      const rows = await runIntrospectionSql<{ has_priv: boolean }>(
        "SELECT has_function_privilege('anon', 'public.commit_scenario_batch(uuid, jsonb, text, text, text)', 'EXECUTE') AS has_priv",
      );
      expect(rows.length).toBe(1);
      expect(rows[0].has_priv).toBe(false);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "T_RPC_NO_GRANT_PUBLIC: public role does NOT have EXECUTE",
    async () => {
      const rows = await runIntrospectionSql<{ has_priv: boolean }>(
        "SELECT has_function_privilege('public', 'public.commit_scenario_batch(uuid, jsonb, text, text, text)', 'EXECUTE') AS has_priv",
      );
      expect(rows.length).toBe(1);
      expect(rows[0].has_priv).toBe(false);
    },
    30_000,
  );

  // ===========================================================================
  // RPC behavioral cases
  // ===========================================================================

  it.skipIf(!HAS_LIVE_DB)(
    "T_RPC_RETURN_SHAPE_OK: single voluntary_remove diff returns {ok:true, recorded:[...]}",
    async () => {
      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [
            {
              kind: "voluntary_remove",
              holding_ref: "holding:binance:BTC:spot",
              rejection_reason: "underperforming_peers",
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      expect(error).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = data as any;
      expect(result?.ok).toBe(true);
      expect(Array.isArray(result?.recorded)).toBe(true);
      expect(result?.recorded.length).toBe(1);
      expect(result?.recorded[0].kind).toBe("voluntary_remove");
      expect(result?.recorded[0].index).toBe(0);
      expect(result?.recorded[0].match_decision_id).toBeTruthy();
      expect(result?.recorded[0].bridge_outcome_id).toBeTruthy();
      trackedMatchDecisionIds.push(
        result.recorded[0].match_decision_id as string,
      );
      trackedBridgeOutcomeIds.push(
        result.recorded[0].bridge_outcome_id as string,
      );
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "T_RPC_SINGLE_TX_ROLLBACK: (H4) row-2 conflict rolls back row-1 — no partial state",
    async () => {
      // Snapshot counts before the call
      const before = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId);
      const beforeCount = before.count ?? 0;

      // Two diffs: (1) valid voluntary_remove for owned holding ETH (would succeed
      // standalone); (2) voluntary_remove for an UN-OWNED holding_ref → ownership
      // probe RAISES → entire batch rolls back.
      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [
            {
              kind: "voluntary_remove",
              holding_ref: "holding:binance:ETH:spot",
              rejection_reason: "timing_wrong",
            },
            {
              kind: "voluntary_remove",
              holding_ref: "holding:does-not-exist:NONE:spot",
              rejection_reason: "mandate_conflict",
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      // Either error is non-null (Supabase surfaces RAISE EXCEPTION as PG error)
      // or data is the error envelope; both are acceptable per Plan 07's
      // expected envelope.
      expect(
        error !== null ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((data as any)?.ok === false && (data as any)?.errors?.length > 0),
      ).toBe(true);

      // Snapshot AFTER — ZERO new rows should exist
      const after = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId);
      expect(after.count).toBe(beforeCount);
    },
    30_000,
  );

  // ---------------------------------------------------------------------------
  // M-0018 — TRUE single-tx rollback: row-0 INSERTs, row-1 fails AFTER it.
  //
  // T_RPC_SINGLE_TX_ROLLBACK (above) injects the failure via an UN-OWNED
  // holding_ref, which the per-row ownership probe rejects BEFORE any INSERT
  // executes — so it proves "pre-flight validation works", NOT "an executed
  // INSERT was rolled back". This case constructs a batch where row-0 is a
  // fully valid bridge_recommended that DOES INSERT a match_decision + a
  // bridge_outcome, and row-1 reuses the SAME (allocator, holding, strategy)
  // tuple. Per the M7 reuse logic, row-1 reuses row-0's match_decision_id and
  // then attempts a SECOND bridge_outcomes INSERT for the same
  // (allocator_id, match_decision_id) → violates
  // bridge_outcomes_allocator_match_decision_unique (23505) AFTER row-0's
  // INSERTs already ran. The single-tx guarantee requires row-0's committed
  // INSERTs to be rolled back, leaving counts unchanged. THIS exercises the
  // executed-INSERT-rollback path the pre-flight failure cannot reach.
  // ---------------------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "M-0018: row-1 unique-violation AFTER row-0's INSERT rolls BOTH back (true single-tx atomicity, not pre-flight)",
    async () => {
      // Start from a clean slate for the M7 tuple so row-0 is genuinely new.
      await admin
        .from("bridge_outcomes")
        .delete()
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7);
      await admin
        .from("match_decisions")
        .delete()
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7);

      const beforeMd = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7);
      const beforeMdCount = beforeMd.count ?? 0;
      const beforeBo = await admin
        .from("bridge_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7);
      const beforeBoCount = beforeBo.count ?? 0;

      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [
            // row-0: valid bridge_recommended → INSERTs md + bridge_outcome.
            {
              kind: "bridge_recommended",
              holding_ref: "holding:binance:BTC:spot",
              strategy_id: STRATEGY_M7,
              percent_allocated: 4,
            },
            // row-1: SAME tuple → reuses row-0's md, then a 2nd bridge_outcome
            // INSERT for the same (allocator_id, match_decision_id) → 23505,
            // raised AFTER row-0's INSERTs already executed in this tx.
            {
              kind: "bridge_recommended",
              holding_ref: "holding:binance:BTC:spot",
              strategy_id: STRATEGY_M7,
              percent_allocated: 6,
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );

      // The batch must FAIL (RAISE surfaced as PG error, or an ok=false
      // envelope) — a partial success would mean row-0 leaked.
      expect(
        error !== null ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((data as any)?.ok === false && (data as any)?.errors?.length > 0),
      ).toBe(true);

      // CRITICAL: row-0's executed INSERTs must be rolled back. Counts for the
      // M7 tuple return to baseline — NOT baseline+1. If the RPC committed
      // row-0 before row-1 failed (no single-tx guarantee) these would be
      // beforeCount+1.
      const afterMd = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7);
      expect(afterMd.count).toBe(beforeMdCount);
      const afterBo = await admin
        .from("bridge_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7);
      expect(afterBo.count).toBe(beforeBoCount);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "T_RPC_OWNERSHIP_GUARD_BLOCKS: cross-tenant holding_ref → RAISE; nothing inserted",
    async () => {
      const before = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId);
      const beforeCount = before.count ?? 0;

      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [
            {
              kind: "voluntary_remove",
              holding_ref: "holding:okx:SOL:spot", // Allocator B owns this
              rejection_reason: "mandate_conflict",
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      expect(
        error !== null ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data as any)?.ok === false,
      ).toBe(true);

      const after = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId);
      expect(after.count).toBe(beforeCount);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB || !HAS_ANON_KEY)(
    "T_RPC_AUTH_UID_MISMATCH: caller's auth.uid() <> p_allocator_id → REJECT",
    async () => {
      // Allocator A is signed in on userClientA. Calling the RPC with
      // p_allocator_id = allocatorBId triggers the auth.uid() <> p_allocator_id
      // branch of the guard inside the RPC body — must RAISE EXCEPTION before
      // any INSERT.
      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorBId,
          p_diffs: [
            {
              kind: "voluntary_remove",
              holding_ref: "holding:okx:SOL:spot",
              rejection_reason: "timing_wrong",
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      // The auth.uid() guard RAISES with ERRCODE 42501 (insufficient_privilege).
      expect(error).not.toBeNull();
      expect(
        error?.code === "42501" ||
          error?.message?.includes("auth.uid() <> p_allocator_id"),
      ).toBe(true);
      expect(data).toBeNull();
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "T_RPC_STRATEGY_GATE: voluntary_add for status='draft' strategy → REJECT",
    async () => {
      const before = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId);
      const beforeCount = before.count ?? 0;

      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [
            {
              kind: "voluntary_add",
              strategy_id: STRATEGY_DRAFT,
              percent_allocated: 5,
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      expect(
        error !== null ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data as any)?.ok === false,
      ).toBe(true);

      const after = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId);
      expect(after.count).toBe(beforeCount);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "T_RPC_VA_HAPPY: voluntary_add for published strategy → match_decisions(kind=voluntary_add) + bridge_outcomes(kind=allocated, strategy_id=NEW)",
    async () => {
      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [
            {
              kind: "voluntary_add",
              strategy_id: STRATEGY_PUBLISHED,
              percent_allocated: 7.5,
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      expect(error).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = data as any;
      expect(result?.ok).toBe(true);
      const mdId = result.recorded[0].match_decision_id as string;
      const boId = result.recorded[0].bridge_outcome_id as string;
      trackedMatchDecisionIds.push(mdId);
      trackedBridgeOutcomeIds.push(boId);

      // Verify the inserted match_decision shape
      const { data: md } = await admin
        .from("match_decisions")
        .select("kind, strategy_id, original_holding_ref, original_strategy_id")
        .eq("id", mdId)
        .single();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mdRow = md as any;
      expect(mdRow?.kind).toBe("voluntary_add");
      expect(mdRow?.strategy_id).toBe(STRATEGY_PUBLISHED);
      expect(mdRow?.original_holding_ref).toBeNull();
      expect(mdRow?.original_strategy_id).toBeNull();

      // Verify the inserted bridge_outcome shape
      const { data: bo } = await admin
        .from("bridge_outcomes")
        .select("kind, strategy_id, percent_allocated")
        .eq("id", boId)
        .single();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const boRow = bo as any;
      expect(boRow?.kind).toBe("allocated");
      expect(boRow?.strategy_id).toBe(STRATEGY_PUBLISHED);
      expect(Number(boRow?.percent_allocated)).toBe(7.5);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "T_RPC_VR_BO_NULL_STRATEGY: voluntary_remove → bridge_outcomes strategy_id IS NULL",
    async () => {
      // ETH was already toggled in a rollback test above; clean up first to
      // avoid (allocator_id, match_decision_id) unique collisions.
      await admin
        .from("bridge_outcomes")
        .delete()
        .eq("allocator_id", allocatorAId)
        .eq("kind", "rejected");
      await admin
        .from("match_decisions")
        .delete()
        .eq("allocator_id", allocatorAId)
        .eq("kind", "voluntary_remove");

      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [
            {
              kind: "voluntary_remove",
              holding_ref: "holding:binance:ETH:spot",
              rejection_reason: "underperforming_peers",
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      expect(error).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = data as any;
      expect(result?.ok).toBe(true);
      const boId = result.recorded[0].bridge_outcome_id as string;
      trackedMatchDecisionIds.push(
        result.recorded[0].match_decision_id as string,
      );
      trackedBridgeOutcomeIds.push(boId);

      const { data: bo } = await admin
        .from("bridge_outcomes")
        .select("strategy_id, kind, rejection_reason")
        .eq("id", boId)
        .single();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const boRow = bo as any;
      expect(boRow?.strategy_id).toBeNull(); // H1 — voluntary_remove keeps strategy_id NULL
      expect(boRow?.kind).toBe("rejected");
      expect(boRow?.rejection_reason).toBe("underperforming_peers");
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "T_RPC_M7_REUSE_FIRST_INSERT: (M7) bridge_recommended for NEW (allocator, holding, strategy) → INSERT new match_decisions row",
    async () => {
      // Use BTC + STRATEGY_M7 — fresh tuple. Cleanup any prior md for this tuple.
      await admin
        .from("bridge_outcomes")
        .delete()
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7);
      await admin
        .from("match_decisions")
        .delete()
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7);

      const before = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7)
        .eq("kind", "bridge_recommended");
      expect(before.count).toBe(0);

      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [
            {
              kind: "bridge_recommended",
              holding_ref: "holding:binance:BTC:spot",
              strategy_id: STRATEGY_M7,
              percent_allocated: 4,
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      expect(error).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = data as any;
      expect(result?.ok).toBe(true);
      trackedMatchDecisionIds.push(
        result.recorded[0].match_decision_id as string,
      );
      trackedBridgeOutcomeIds.push(
        result.recorded[0].bridge_outcome_id as string,
      );

      const after = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7)
        .eq("kind", "bridge_recommended");
      expect(after.count).toBe(1);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "T_RPC_M7_REUSE_SECOND_REUSES: (M7) same (allocator, holding, strategy) tuple → REUSE existing match_decision; no new row",
    async () => {
      // The previous test created a bridge_recommended for (A, BTC, STRATEGY_M7).
      // Calling the RPC again with the same tuple should REUSE that match_decision
      // (count stays at 1) and INSERT a NEW bridge_outcome that references the
      // reused match_decision_id.
      const beforeMd = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7)
        .eq("kind", "bridge_recommended");

      // Get the existing match_decision id for assertion
      const { data: existing } = await admin
        .from("match_decisions")
        .select("id")
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7)
        .eq("kind", "bridge_recommended")
        .single();
      const existingMdId = (existing as { id: string }).id;

      // Cleanup the bridge_outcome from the previous test so the new INSERT
      // doesn't violate (allocator_id, match_decision_id) UNIQUE.
      await admin
        .from("bridge_outcomes")
        .delete()
        .eq("allocator_id", allocatorAId)
        .eq("match_decision_id", existingMdId);

      const { data, error } = await userClientA.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "commit_scenario_batch" as any,
        {
          p_allocator_id: allocatorAId,
          p_diffs: [
            {
              kind: "bridge_recommended",
              holding_ref: "holding:binance:BTC:spot",
              strategy_id: STRATEGY_M7,
              percent_allocated: 6,
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      expect(error).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = data as any;
      expect(result?.ok).toBe(true);
      // The reused match_decision_id should equal the existing one
      expect(result.recorded[0].match_decision_id).toBe(existingMdId);
      trackedBridgeOutcomeIds.push(
        result.recorded[0].bridge_outcome_id as string,
      );

      // Verify count of bridge_recommended match_decisions is UNCHANGED
      const afterMd = await admin
        .from("match_decisions")
        .select("id", { count: "exact", head: true })
        .eq("allocator_id", allocatorAId)
        .eq("strategy_id", STRATEGY_M7)
        .eq("kind", "bridge_recommended");
      expect(afterMd.count).toBe(beforeMd.count);
    },
    30_000,
  );
});
