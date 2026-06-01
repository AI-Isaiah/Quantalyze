/**
 * Integration test — migration 028 cross-tenant api_key_id trigger.
 *
 * Verifies that the BEFORE INSERT/UPDATE trigger on `strategies` blocks
 * attempts to link one user's api_keys row to another user's strategy.
 * The trigger function (`check_strategy_api_key_ownership`) is SECURITY
 * DEFINER so it fires even for the service_role client — which is what
 * we use here to simulate the attack without needing an authenticated
 * browser session.
 *
 * Gate: requires `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 * env vars. Skips gracefully when absent (CI without live DB).
 *
 * Why this test exists
 * --------------------
 * All 3 AI eng reviewers (Claude subagent, Codex, Grok) independently
 * flagged this as a CRITICAL live attack vector in the pre-migration
 * code. The migration adds a DB-level enforcement; this test proves
 * the enforcement works at runtime.
 *
 * Run locally:
 *   export NEXT_PUBLIC_SUPABASE_URL=...
 *   export SUPABASE_SERVICE_ROLE_KEY=...
 *   npx vitest run src/lib/migration-028-tenant-check.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "./test-helpers/live-db";

interface TestRow {
  userIdA: string;
  userIdB: string;
  keyIdB: string;
  strategyIdA: string | null;
}

function cleanupRowToLiveDbRow(row: TestRow) {
  return {
    strategyIds: row.strategyIdA ? [row.strategyIdA] : [],
    apiKeyIds: row.keyIdB ? [row.keyIdB] : [],
    userIds: [row.userIdA, row.userIdB].filter(
      (id, i, arr) => id && arr.indexOf(id) === i,
    ),
  };
}

describe("Migration 028 — cross-tenant api_key_id trigger", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "blocks INSERT of strategy with another user's api_key_id",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const row: TestRow = {
        userIdA: "",
        userIdB: "",
        keyIdB: "",
        strategyIdA: null,
      };

      try {
        row.userIdA = await createTestUser(admin, `tenant-a-${ts}@test.sec`);
        row.userIdB = await createTestUser(admin, `tenant-b-${ts}@test.sec`);

        // User B creates an api_keys row
        const { data: keyData, error: keyErr } = await admin
          .from("api_keys")
          .insert({
            user_id: row.userIdB,
            exchange: "binance",
            label: "B's key",
            api_key_encrypted: "ciphertext",
            dek_encrypted: "dek",
          })
          .select("id")
          .single();

        if (keyErr || !keyData) {
          throw new Error(`Failed to create test key: ${keyErr?.message}`);
        }
        row.keyIdB = keyData.id;

        // Attempt the attack: User A creates a strategy linked to B's key
        const { data: stratData, error: stratErr } = await admin
          .from("strategies")
          .insert({
            user_id: row.userIdA,
            name: "Alpha Centauri", // from STRATEGY_NAMES enum
            api_key_id: row.keyIdB, // ← the cross-tenant assignment
          })
          .select("id")
          .single();

        if (stratData) {
          // If the INSERT succeeded, the trigger is broken. Capture the row
          // id so cleanup can remove it, then fail loudly.
          row.strategyIdA = stratData.id;
          throw new Error(
            "SECURITY REGRESSION: migration 028 trigger did not block " +
              "cross-tenant api_key_id assignment. User A's strategy was " +
              "created linked to User B's api_keys row.",
          );
        }

        // Expected: INSERT is rejected with the insufficient_privilege error
        // message raised by check_strategy_api_key_ownership().
        expect(stratErr).not.toBeNull();
        expect(stratErr!.message).toMatch(/does not belong to user|insufficient_privilege|migration 028/i);
      } finally {
        await cleanupLiveDbRow(admin, cleanupRowToLiveDbRow(row));
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "blocks UPDATE of strategy.api_key_id to another user's key",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const row: TestRow = {
        userIdA: "",
        userIdB: "",
        keyIdB: "",
        strategyIdA: null,
      };

      try {
        row.userIdA = await createTestUser(admin, `update-a-${ts}@test.sec`);
        row.userIdB = await createTestUser(admin, `update-b-${ts}@test.sec`);

        // User B's key
        const { data: keyData } = await admin
          .from("api_keys")
          .insert({
            user_id: row.userIdB,
            exchange: "binance",
            label: "B's key",
            api_key_encrypted: "ciphertext",
            dek_encrypted: "dek",
          })
          .select("id")
          .single();
        row.keyIdB = keyData!.id;

        // User A creates a strategy with NO api_key_id — passes the trigger
        const { data: stratData, error: stratErr } = await admin
          .from("strategies")
          .insert({
            user_id: row.userIdA,
            name: "Black Swan",
          })
          .select("id")
          .single();

        expect(stratErr).toBeNull();
        expect(stratData).not.toBeNull();
        row.strategyIdA = stratData!.id;

        // Attack: UPDATE to point at B's key
        const { error: updateErr } = await admin
          .from("strategies")
          .update({ api_key_id: row.keyIdB })
          .eq("id", row.strategyIdA);

        expect(updateErr).not.toBeNull();
        expect(updateErr!.message).toMatch(/does not belong to user|insufficient_privilege|migration 028/i);
      } finally {
        await cleanupLiveDbRow(admin, cleanupRowToLiveDbRow(row));
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "allows INSERT of strategy with matching own api_key_id",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const row: TestRow = {
        userIdA: "",
        userIdB: "", // unused in this test
        keyIdB: "",
        strategyIdA: null,
      };

      try {
        row.userIdA = await createTestUser(admin, `self-a-${ts}@test.sec`);

        // User A's own key
        const { data: keyData } = await admin
          .from("api_keys")
          .insert({
            user_id: row.userIdA,
            exchange: "okx",
            label: "A's own key",
            api_key_encrypted: "ciphertext",
            dek_encrypted: "dek",
          })
          .select("id")
          .single();
        row.keyIdB = keyData!.id; // parked in keyIdB slot for cleanup reuse

        // User A creates a strategy linked to their OWN key — must succeed
        const { data: stratData, error: stratErr } = await admin
          .from("strategies")
          .insert({
            user_id: row.userIdA,
            name: "Crystal Ball",
            api_key_id: row.keyIdB,
          })
          .select("id")
          .single();

        expect(stratErr).toBeNull();
        expect(stratData).not.toBeNull();
        row.strategyIdA = stratData!.id;
      } finally {
        await cleanupLiveDbRow(admin, cleanupRowToLiveDbRow(row));
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "allows INSERT of strategy with NULL api_key_id",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const row: TestRow = {
        userIdA: "",
        userIdB: "",
        keyIdB: "",
        strategyIdA: null,
      };

      try {
        row.userIdA = await createTestUser(admin, `null-a-${ts}@test.sec`);

        // Strategy with no api_key_id — trigger early-returns, no check
        const { data: stratData, error: stratErr } = await admin
          .from("strategies")
          .insert({
            user_id: row.userIdA,
            name: "Dark Matter",
          })
          .select("id")
          .single();

        expect(stratErr).toBeNull();
        expect(stratData).not.toBeNull();
        row.strategyIdA = stratData!.id;
      } finally {
        await cleanupLiveDbRow(admin, cleanupRowToLiveDbRow(row));
      }
    },
    30_000,
  );

  // --------------------------------------------------------------------------
  // Migration 029 STEP 3 — `FOR SHARE` lock + ON DELETE SET NULL safety net.
  //
  // Why this test exists (H-0462)
  // -----------------------------
  // Migration 029 added `FOR SHARE` on the trigger's EXISTS lookup against
  // public.api_keys to close a concurrent-DELETE race: a strategy INSERT that
  // links key K could commit in one session while another session is mid-DELETE
  // of K. The 029 docblock (lines 26-29) is explicit that the `FOR SHARE` lock
  // is belt-and-suspenders — "today the FK ON DELETE SET NULL catches this race
  // by accident, but future migrations that make the FK deferrable would reopen
  // it." That accidental safety net is the load-bearing contract that keeps the
  // race benign in production right now, and it had ZERO coverage.
  //
  // This test pins that contract: deleting an api_keys row that a strategy
  // points at must NULL the strategy's api_key_id (ON DELETE SET NULL) and leave
  // the strategy row intact — it must NOT cascade-delete the strategy, NOT
  // RESTRICT/error, and NOT leave a now-dangling api_key_id. If a future
  // migration flips the FK to ON DELETE CASCADE / RESTRICT / NO ACTION (or drops
  // it), this test goes red. The trigger itself does NOT fire on the resulting
  // SET NULL (api_key_id IS NULL early-returns), so a passing INSERT followed by
  // a key DELETE is the exact production sequence the 029 race concerns.
  //
  // Scope note: genuinely exercising the `FOR SHARE` *lock blocking* a
  // concurrent open DELETE transaction (Tx1 = uncommitted strategy INSERT
  // holding the share lock, Tx2 = DELETE blocked on it) requires two
  // long-lived raw Postgres sessions holding open BEGIN/COMMIT transactions.
  // The PostgREST data API and the Management-API SQL endpoint both autocommit
  // every call, so neither can hold a lock across statements. That lock-timing
  // assertion is infra-deferred (needs a raw `pg` connection pair). What is
  // testable here — and what makes the race safe today — is the SET NULL
  // outcome, which is asserted below.
  it.skipIf(!HAS_LIVE_DB)(
    "ON DELETE SET NULL: deleting a linked api_keys row NULLs strategy.api_key_id and keeps the strategy",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const row: TestRow = {
        userIdA: "",
        userIdB: "",
        keyIdB: "",
        strategyIdA: null,
      };

      try {
        row.userIdA = await createTestUser(admin, `ondelete-a-${ts}@test.sec`);

        // User A's own key.
        const { data: keyData, error: keyErr } = await admin
          .from("api_keys")
          .insert({
            user_id: row.userIdA,
            exchange: "okx",
            label: "A's key (to be deleted)",
            api_key_encrypted: "ciphertext",
            dek_encrypted: "dek",
          })
          .select("id")
          .single();
        if (keyErr || !keyData) {
          throw new Error(`Failed to create test key: ${keyErr?.message}`);
        }
        row.keyIdB = keyData.id; // parked in keyIdB slot for cleanup reuse

        // User A links a strategy to their own key — passes the 028/029 trigger.
        const { data: stratData, error: stratErr } = await admin
          .from("strategies")
          .insert({
            user_id: row.userIdA,
            name: "Event Horizon",
            api_key_id: row.keyIdB,
          })
          .select("id, api_key_id")
          .single();

        expect(stratErr).toBeNull();
        expect(stratData).not.toBeNull();
        expect(stratData!.api_key_id).toBe(row.keyIdB);
        row.strategyIdA = stratData!.id;

        // Delete the linked key. This is the second half of the 029 race: the
        // key K the strategy points at goes away.
        const { error: delErr } = await admin
          .from("api_keys")
          .delete()
          .eq("id", row.keyIdB);
        expect(delErr).toBeNull();
        row.keyIdB = ""; // key is gone; nothing to clean up there.

        // Contract: the strategy MUST still exist (FK is SET NULL, not CASCADE,
        // not RESTRICT) and its api_key_id MUST be NULL (not the now-deleted id,
        // not a dangling reference).
        const { data: afterData, error: afterErr } = await admin
          .from("strategies")
          .select("id, api_key_id")
          .eq("id", row.strategyIdA)
          .maybeSingle();

        expect(afterErr).toBeNull();
        // maybeSingle returns null if the row was cascade-deleted — that is the
        // regression we are guarding against (CASCADE instead of SET NULL).
        expect(afterData).not.toBeNull();
        expect(afterData!.id).toBe(row.strategyIdA);
        expect(afterData!.api_key_id).toBeNull();
      } finally {
        await cleanupLiveDbRow(admin, cleanupRowToLiveDbRow(row));
      }
    },
    30_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("migration-028-tenant-check");
    expect(true).toBe(true);
  });
});
