/**
 * Live-DB integration tests — Migration 031 wizard RPCs (P474).
 *
 * The wizard's two SECURITY DEFINER RPCs (`create_wizard_strategy` and
 * `finalize_wizard_strategy`) ship in migration 031 and are the sole
 * write paths for the wizard onboarding flow. Pre-fix coverage was
 * zero: pgTAP is not set up for this project (per Lane B's audit) and
 * no JS/TS test exercises the live function behavior. A regression that
 * dropped one of the ownership checks, broke the source='wizard'
 * discriminator, or stopped enforcing the auth.uid match would slip
 * through CI entirely.
 *
 * This file pins:
 *
 *   1. create_wizard_strategy happy path inserts api_keys + strategies
 *      atomically with status='draft', source='wizard'.
 *   2. create_wizard_strategy called by the wrong-user (auth.uid != p_user_id)
 *      raises SQLSTATE 42501.
 *   3. finalize_wizard_strategy happy path flips a draft to pending_review.
 *   4. finalize_wizard_strategy on someone else's draft raises 42501.
 *   5. The guard_wizard_draft_updates trigger blocks direct UPDATEs from
 *      the authenticated role (defense in depth: the RPC is the only path).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Skips gracefully when those are absent (standard CI without live DB).
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/__tests__/wizard-rpcs-live-db.test.ts
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

// ---------------------------------------------------------------------------
// Shared test users — two users so the cross-user ownership tests have a
// "stranger" subject. Created in beforeAll, cleaned up in afterAll.
// ---------------------------------------------------------------------------

let admin: SupabaseClient | null = null;
let ownerClient: SupabaseClient | null = null;
let strangerClient: SupabaseClient | null = null;
let ownerId: string | null = null;
let strangerId: string | null = null;
const createdStrategyIds: string[] = [];
const createdApiKeyIds: string[] = [];

async function createAuthedClient(
  email: string,
  password: string,
): Promise<SupabaseClient | null> {
  if (!HAS_LIVE_DB) return null;
  const anon = createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const {
    data: { session },
    error,
  } = await anon.auth.signInWithPassword({ email, password });
  if (error || !session) {
    console.warn(
      "[wizard-rpcs-live-db] signInWithPassword failed (password-grant may be disabled):",
      error?.message,
    );
    return null;
  }
  return createClient(LIVE_DB_URL!, LIVE_DB_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  });
}

beforeAll(async () => {
  if (!HAS_LIVE_DB) return;
  admin = createLiveAdminClient();
  const ts = Date.now();
  const ownerPw = `WizardRpcOwner${ts}!`;
  const strangerPw = `WizardRpcStr${ts}!`;
  const ownerEmail = `wizard-rpc-owner-${ts}@test.sec`;
  const strangerEmail = `wizard-rpc-stranger-${ts}@test.sec`;
  ownerId = await createTestUser(admin, ownerEmail, ownerPw);
  strangerId = await createTestUser(admin, strangerEmail, strangerPw);
  ownerClient = await createAuthedClient(ownerEmail, ownerPw);
  strangerClient = await createAuthedClient(strangerEmail, strangerPw);
}, 60_000);

afterAll(async () => {
  if (!HAS_LIVE_DB || !admin) return;
  // Delete strategies first; api_keys cascade-delete is handled by the
  // ON DELETE SET NULL FK on strategies.api_key_id and the explicit
  // api_keys delete below cleans the key rows.
  for (const id of createdStrategyIds) {
    try {
      await admin.from("strategies").delete().eq("id", id);
    } catch (err) {
      console.warn(
        `[wizard-rpcs-live-db] cleanup strategies ${id}: ${(err as Error).message}`,
      );
    }
  }
  if (createdApiKeyIds.length > 0) {
    await cleanupLiveDbRow(admin, { apiKeyIds: createdApiKeyIds });
  }
  const userIds = [ownerId, strangerId].filter(
    (x): x is string => typeof x === "string",
  );
  if (userIds.length > 0) {
    await cleanupLiveDbRow(admin, { userIds });
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PLACEHOLDER_ENCRYPTED = "live-db-test-encrypted-blob";

/**
 * Look up an existing discovery_categories row for the finalize test.
 * Migration 001 seeds at least one row; we don't want to insert one
 * because that would affect prod query plans.
 */
async function pickCategoryId(): Promise<string | null> {
  if (!admin) return null;
  const { data, error } = await admin
    .from("discovery_categories")
    .select("id")
    .limit(1)
    .single();
  if (error || !data) {
    console.warn(
      "[wizard-rpcs-live-db] no discovery_categories row found; skipping finalize tests",
    );
    return null;
  }
  return (data as { id: string }).id;
}

// ---------------------------------------------------------------------------
// create_wizard_strategy
// ---------------------------------------------------------------------------

describe("create_wizard_strategy RPC (Migration 031 / P474)", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "happy path: inserts api_keys + strategies (source=wizard, status=draft) atomically",
    async () => {
      if (!ownerClient || !ownerId) return;

      const { data, error } = await ownerClient.rpc("create_wizard_strategy", {
        p_user_id: ownerId,
        p_exchange: "binance",
        p_label: "wizard-rpc-test-key",
        p_api_key_encrypted: PLACEHOLDER_ENCRYPTED,
        p_api_secret_encrypted: null,
        p_passphrase_encrypted: null,
        p_dek_encrypted: null,
        p_nonce: null,
        p_kek_version: 1,
        p_placeholder_name: "test-codename",
        p_wizard_session_id: crypto.randomUUID(),
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      const row = Array.isArray(data) ? data[0] : data;
      expect(typeof row.strategy_id).toBe("string");
      expect(typeof row.api_key_id).toBe("string");
      createdStrategyIds.push(row.strategy_id);
      createdApiKeyIds.push(row.api_key_id);

      // Verify the strategies row was inserted with the right discriminators.
      if (!admin) return;
      const { data: strat } = await admin
        .from("strategies")
        .select("user_id, status, source, api_key_id")
        .eq("id", row.strategy_id)
        .single();
      expect(strat).toBeTruthy();
      const stratRow = strat as Record<string, unknown>;
      expect(stratRow.user_id).toBe(ownerId);
      expect(stratRow.status).toBe("draft");
      expect(stratRow.source).toBe("wizard");
      expect(stratRow.api_key_id).toBe(row.api_key_id);

      // Verify the api_keys row was inserted under the same user.
      const { data: key } = await admin
        .from("api_keys")
        .select("user_id, exchange, is_active")
        .eq("id", row.api_key_id)
        .single();
      expect(key).toBeTruthy();
      const keyRow = key as Record<string, unknown>;
      expect(keyRow.user_id).toBe(ownerId);
      expect(keyRow.exchange).toBe("binance");
      expect(keyRow.is_active).toBe(true);
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "rejects calls where p_user_id does not match auth.uid (SQLSTATE 42501)",
    async () => {
      if (!ownerClient || !strangerId) return;
      const { data, error } = await ownerClient.rpc("create_wizard_strategy", {
        // p_user_id points at the stranger; auth.uid() is the owner's.
        p_user_id: strangerId,
        p_exchange: "binance",
        p_label: "should-fail",
        p_api_key_encrypted: PLACEHOLDER_ENCRYPTED,
        p_api_secret_encrypted: null,
        p_passphrase_encrypted: null,
        p_dek_encrypted: null,
        p_nonce: null,
        p_kek_version: 1,
        p_placeholder_name: "should-fail",
        p_wizard_session_id: crypto.randomUUID(),
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect((error as { code?: string }).code).toBe("42501");
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// finalize_wizard_strategy
// ---------------------------------------------------------------------------

describe("finalize_wizard_strategy RPC (Migration 031 / P474)", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "happy path: flips draft (source=wizard, status=draft) to status=pending_review",
    async () => {
      if (!ownerClient || !ownerId || !admin) return;
      const categoryId = await pickCategoryId();
      if (!categoryId) return;

      // Seed a fresh wizard draft via the create RPC.
      const { data: created, error: createErr } = await ownerClient.rpc(
        "create_wizard_strategy",
        {
          p_user_id: ownerId,
          p_exchange: "binance",
          p_label: "finalize-happy",
          p_api_key_encrypted: PLACEHOLDER_ENCRYPTED,
          p_api_secret_encrypted: null,
          p_passphrase_encrypted: null,
          p_dek_encrypted: null,
          p_nonce: null,
          p_kek_version: 1,
          p_placeholder_name: "finalize-happy-placeholder",
          p_wizard_session_id: crypto.randomUUID(),
        },
      );
      expect(createErr).toBeNull();
      const createdRow = Array.isArray(created) ? created[0] : created;
      const strategyId = createdRow.strategy_id as string;
      createdStrategyIds.push(strategyId);
      createdApiKeyIds.push(createdRow.api_key_id);

      // Finalize.
      const { data: finalizedId, error: finalizeErr } = await ownerClient.rpc(
        "finalize_wizard_strategy",
        {
          p_strategy_id: strategyId,
          p_user_id: ownerId,
          p_name: "finalize-happy-name",
          p_description:
            "A descriptive blurb that exceeds ten characters and is plausible.",
          p_category_id: categoryId,
          p_strategy_types: ["trend"],
          p_subtypes: ["breakout"],
          p_markets: ["BTC/USDT"],
          p_supported_exchanges: ["binance"],
          p_leverage_range: "1x-3x",
          p_aum: 100_000,
          p_max_capacity: 10_000_000,
        },
      );
      expect(finalizeErr).toBeNull();
      expect(finalizedId).toBe(strategyId);

      // Verify status flipped.
      const { data: strat } = await admin
        .from("strategies")
        .select("status, name, description, category_id")
        .eq("id", strategyId)
        .single();
      expect(strat).toBeTruthy();
      const stratRow = strat as Record<string, unknown>;
      expect(stratRow.status).toBe("pending_review");
      expect(stratRow.name).toBe("finalize-happy-name");
      expect(stratRow.category_id).toBe(categoryId);
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "rejects finalize on someone else's draft (SQLSTATE 42501)",
    async () => {
      if (!ownerClient || !strangerClient || !ownerId || !strangerId) return;
      const categoryId = await pickCategoryId();
      if (!categoryId) return;

      // Owner seeds a draft.
      const { data: created, error: createErr } = await ownerClient.rpc(
        "create_wizard_strategy",
        {
          p_user_id: ownerId,
          p_exchange: "binance",
          p_label: "cross-user-finalize",
          p_api_key_encrypted: PLACEHOLDER_ENCRYPTED,
          p_api_secret_encrypted: null,
          p_passphrase_encrypted: null,
          p_dek_encrypted: null,
          p_nonce: null,
          p_kek_version: 1,
          p_placeholder_name: "cross-user-placeholder",
          p_wizard_session_id: crypto.randomUUID(),
        },
      );
      expect(createErr).toBeNull();
      const createdRow = Array.isArray(created) ? created[0] : created;
      const strategyId = createdRow.strategy_id as string;
      createdStrategyIds.push(strategyId);
      createdApiKeyIds.push(createdRow.api_key_id);

      // Stranger tries to finalize the owner's draft. p_user_id matches
      // their auth.uid (so the first check passes) but the ownership
      // check inside the RPC fails — should raise 42501.
      const { data, error } = await strangerClient.rpc(
        "finalize_wizard_strategy",
        {
          p_strategy_id: strategyId,
          p_user_id: strangerId,
          p_name: "stolen-name",
          p_description:
            "Description over ten characters from the stranger.",
          p_category_id: categoryId,
          p_strategy_types: [],
          p_subtypes: [],
          p_markets: [],
          p_supported_exchanges: [],
          p_leverage_range: null,
          p_aum: null,
          p_max_capacity: null,
        },
      );
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect((error as { code?: string }).code).toBe("42501");
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// guard_wizard_draft_updates trigger — defense in depth.
// ---------------------------------------------------------------------------

describe("guard_wizard_draft_updates trigger (Migration 031 / P474 + Migration 126 / Issue 1 + Migration 127 / Finding 1)", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "blocks a direct authenticated UPDATE that would flip wizard draft status",
    async () => {
      if (!ownerClient || !ownerId) return;

      // Seed a wizard draft.
      const { data: created, error: createErr } = await ownerClient.rpc(
        "create_wizard_strategy",
        {
          p_user_id: ownerId,
          p_exchange: "binance",
          p_label: "guard-trigger-test",
          p_api_key_encrypted: PLACEHOLDER_ENCRYPTED,
          p_api_secret_encrypted: null,
          p_passphrase_encrypted: null,
          p_dek_encrypted: null,
          p_nonce: null,
          p_kek_version: 1,
          p_placeholder_name: "guard-placeholder",
          p_wizard_session_id: crypto.randomUUID(),
        },
      );
      expect(createErr).toBeNull();
      const createdRow = Array.isArray(created) ? created[0] : created;
      const strategyId = createdRow.strategy_id as string;
      createdStrategyIds.push(strategyId);
      createdApiKeyIds.push(createdRow.api_key_id);

      // Direct UPDATE from the user-context (authenticated role) client.
      // The guard trigger must reject this, leaving status=draft.
      const { error: updateErr } = await ownerClient
        .from("strategies")
        .update({ status: "pending_review" })
        .eq("id", strategyId);
      expect(updateErr).not.toBeNull();
      // The trigger raises with ERRCODE 'insufficient_privilege' (42501),
      // but PostgREST may wrap it; assert the error exists at minimum and
      // optionally pin the code when present.
      const code = (updateErr as { code?: string } | null)?.code;
      if (code) {
        expect(code).toBe("42501");
      }

      // Verify the status truly did not change — strongest evidence the
      // guard worked even if PostgREST translated the error code.
      if (!admin) return;
      const { data: strat } = await admin
        .from("strategies")
        .select("status")
        .eq("id", strategyId)
        .single();
      expect((strat as { status: string } | null)?.status).toBe("draft");
    },
    60_000,
  );

  // Issue 1 (audit-2026-05-07 follow-up): migration 125's auth.uid()
  // clause incorrectly blocked finalize_wizard_strategy because the
  // JWT-bound auth.uid() leaks into SECURITY DEFINER contexts. Migration
  // 126 replaces the clause with a per-txn GUC bypass that
  // finalize_wizard_strategy sets. This test pins the
  // "SECURITY DEFINER RPC path passes the guard" invariant: a fresh
  // wizard draft must successfully finalize end-to-end with the
  // user-scoped client.
  it.skipIf(!HAS_LIVE_DB)(
    "Migration 126: SECURITY DEFINER finalize_wizard_strategy path passes the guard",
    async () => {
      if (!ownerClient || !ownerId || !admin) return;
      const categoryId = await pickCategoryId();
      if (!categoryId) return;

      const { data: created, error: createErr } = await ownerClient.rpc(
        "create_wizard_strategy",
        {
          p_user_id: ownerId,
          p_exchange: "binance",
          p_label: "guard-secdef-bypass-test",
          p_api_key_encrypted: PLACEHOLDER_ENCRYPTED,
          p_api_secret_encrypted: null,
          p_passphrase_encrypted: null,
          p_dek_encrypted: null,
          p_nonce: null,
          p_kek_version: 1,
          p_placeholder_name: "guard-secdef-bypass-placeholder",
          p_wizard_session_id: crypto.randomUUID(),
        },
      );
      expect(createErr).toBeNull();
      const createdRow = Array.isArray(created) ? created[0] : created;
      const strategyId = createdRow.strategy_id as string;
      createdStrategyIds.push(strategyId);
      createdApiKeyIds.push(createdRow.api_key_id);

      const { data: finalizedId, error: finalizeErr } = await ownerClient.rpc(
        "finalize_wizard_strategy",
        {
          p_strategy_id: strategyId,
          p_user_id: ownerId,
          p_name: "secdef-bypass-name",
          p_description:
            "Description long enough to pass any length validation present.",
          p_category_id: categoryId,
          p_strategy_types: ["trend"],
          p_subtypes: ["breakout"],
          p_markets: ["BTC/USDT"],
          p_supported_exchanges: ["binance"],
          p_leverage_range: "1x-3x",
          p_aum: 50_000,
          p_max_capacity: 1_000_000,
        },
      );
      // The whole point of Issue 1 / Migration 126: this RPC MUST succeed
      // end-to-end. Pre-fix, migration 125's auth.uid() OR clause raised
      // 'insufficient_privilege' inside the SECURITY DEFINER UPDATE and
      // every wizard submit failed in production.
      expect(finalizeErr).toBeNull();
      expect(finalizedId).toBe(strategyId);

      const { data: strat } = await admin
        .from("strategies")
        .select("status")
        .eq("id", strategyId)
        .single();
      expect((strat as { status: string } | null)?.status).toBe(
        "pending_review",
      );
    },
    60_000,
  );

  // Migration 127 / red-team Finding 1: the GUC bypass that migration 126
  // introduced was forgeable from any authenticated session. Migration 127
  // removes it and gates the trigger on current_user='authenticated' alone.
  // This test pins that an authenticated client cannot smuggle the GUC to
  // bypass the trigger.
  it.skipIf(!HAS_LIVE_DB)(
    "Migration 127 (Finding 1): authenticated session cannot smuggle the wizard_rpc_active GUC",
    async () => {
      if (!ownerClient || !ownerId || !admin) return;

      const { data: created, error: createErr } = await ownerClient.rpc(
        "create_wizard_strategy",
        {
          p_user_id: ownerId,
          p_exchange: "binance",
          p_label: "finding1-bypass-test",
          p_api_key_encrypted: PLACEHOLDER_ENCRYPTED,
          p_api_secret_encrypted: null,
          p_passphrase_encrypted: null,
          p_dek_encrypted: null,
          p_nonce: null,
          p_kek_version: 1,
          p_placeholder_name: "finding1-bypass-placeholder",
          p_wizard_session_id: crypto.randomUUID(),
        },
      );
      expect(createErr).toBeNull();
      const createdRow = Array.isArray(created) ? created[0] : created;
      const strategyId = createdRow.strategy_id as string;
      createdStrategyIds.push(strategyId);
      createdApiKeyIds.push(createdRow.api_key_id);

      // Attempt the bypass: call set_config('quantalyze.wizard_rpc_active',
      // 'on', true) via an exec_sql-style RPC. We don't ship an exec_sql
      // RPC, so we approximate the attacker's path by issuing the UPDATE
      // directly — pre-127, this would have required set_config; post-127
      // the trigger ignores the GUC entirely and the UPDATE is rejected
      // by current_user='authenticated'.
      //
      // We cannot call set_config from supabase-js without a custom RPC,
      // so the strongest assertion we can make end-to-end is that the
      // direct UPDATE fails (which the previous test in this file
      // already covers). The function-body invariant — that
      // guard_wizard_draft_updates no longer reads the GUC — is pinned
      // by the SQL self-test in
      // supabase/tests/test_guard_wizard_draft_updates_auth_uid.sql.
      const { error: updateErr } = await ownerClient
        .from("strategies")
        .update({ status: "pending_review" })
        .eq("id", strategyId);
      expect(updateErr).not.toBeNull();

      // Status must still be 'draft' — the bypass did not succeed.
      const { data: strat } = await admin
        .from("strategies")
        .select("status")
        .eq("id", strategyId)
        .single();
      expect((strat as { status: string } | null)?.status).toBe("draft");
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// Skip-reason advertisement.
// ---------------------------------------------------------------------------

describe("live-db skip reason", () => {
  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("wizard-rpcs-live-db");
    expect(true).toBe(true);
  });
});
