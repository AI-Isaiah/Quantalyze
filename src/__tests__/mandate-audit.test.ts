import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

/**
 * MANDATE-08 — audit coverage live-DB test.
 *
 * Covers the RPC contract the route handler's logAuditEvent() wraps. The
 * route-layer invocation is separately covered by Task 4's unit tests
 * (src/app/api/preferences/route.test.ts TC1) via the rpcCalls spy; this
 * test drives the RPC directly to confirm the audit_log row lands with
 * the expected shape.
 *
 * Gate: HAS_LIVE_DB. Skips gracefully otherwise.
 */

advertiseLiveDbSkipReason("mandate-audit");

describe("MANDATE-08: mandate_preference.update audit coverage", () => {
  let admin: SupabaseClient;
  let testUserId: string | null = null;
  const TEST_PASSWORD = "MandateAuditTest!-9f2c";

  beforeAll(() => {
    if (HAS_LIVE_DB) admin = createLiveAdminClient();
  });

  afterEach(async () => {
    if (HAS_LIVE_DB && testUserId) {
      await cleanupLiveDbRow(admin, { userIds: [testUserId] });
      testUserId = null;
    }
  });

  it.skipIf(!HAS_LIVE_DB)(
    "log_audit_event RPC called by authenticated client with mandate_preference.update writes an audit_log row",
    async () => {
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!anonKey) {
        throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY required");
      }
      const email = `mandate-audit-${Date.now()}@test.local`;
      testUserId = await createTestUser(admin, email, TEST_PASSWORD);

      const userClient = createClient(LIVE_DB_URL!, anonKey);
      const { error: authErr } = await userClient.auth.signInWithPassword({
        email,
        password: TEST_PASSWORD,
      });
      expect(authErr).toBeNull();

      // Directly invoke the RPC that logAuditEvent() wraps — this is the
      // contract the route handler depends on.
      const { error: auditErr } = await userClient.rpc("log_audit_event", {
        p_action: "mandate_preference.update",
        p_entity_type: "allocator_preference_mandate",
        p_entity_id: testUserId,
        p_metadata: { fields: ["max_weight"], self_edit: true },
      });
      expect(auditErr).toBeNull();

      // log_audit_event is SECURITY DEFINER and synchronous, but give
      // PostgREST a 250ms serialization grace window.
      await new Promise((r) => setTimeout(r, 250));

      const { data, error: selErr } = await admin
        .from("audit_log")
        .select("action, entity_type, entity_id, user_id, metadata")
        .eq("entity_id", testUserId!)
        .eq("action", "mandate_preference.update")
        .order("created_at", { ascending: false })
        .limit(1);
      expect(selErr).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].action).toBe("mandate_preference.update");
      expect(data![0].entity_type).toBe("allocator_preference_mandate");
      expect(data![0].user_id).toBe(testUserId);
    },
    60_000,
  );
});
