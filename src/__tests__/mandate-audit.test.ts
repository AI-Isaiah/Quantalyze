import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  cleanupLiveDbRow,
  signInAsTestUser,
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
  // H-0038: record the created user id for afterEach cleanup. The shared
  // signInAsTestUser helper creates + signs in + (via this callback) tracks.
  const trackForCleanup = (userId: string) => {
    testUserId = userId;
  };

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
      const { client: userClient, userId } = await signInAsTestUser(
        admin,
        "mandate-audit",
        trackForCleanup,
      );

      // Directly invoke the RPC that logAuditEvent() wraps — this is the
      // contract the route handler depends on.
      const { error: auditErr } = await userClient.rpc("log_audit_event", {
        p_action: "mandate_preference.update",
        p_entity_type: "allocator_preference_mandate",
        p_entity_id: userId,
        p_metadata: { fields: ["max_weight"], self_edit: true },
      });
      expect(auditErr).toBeNull();

      // log_audit_event is SECURITY DEFINER and synchronous, but give
      // PostgREST a 250ms serialization grace window.
      await new Promise((r) => setTimeout(r, 250));

      const { data, error: selErr } = await admin
        .from("audit_log")
        .select("action, entity_type, entity_id, user_id, metadata")
        .eq("entity_id", userId)
        .eq("action", "mandate_preference.update")
        .order("created_at", { ascending: false })
        .limit(1);
      expect(selErr).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].action).toBe("mandate_preference.update");
      expect(data![0].entity_type).toBe("allocator_preference_mandate");
      // M-0013: user_id is SERVER-SET by log_audit_event (SECURITY DEFINER,
      // keyed on auth.uid()), NOT taken from the client payload — the test
      // never passes p_user_id, so a row whose user_id matches the
      // authenticated caller proves the function stamps auth.uid() itself.
      expect(data![0].user_id).toBe(userId);
      // M-0013: the audited PAYLOAD (metadata column) is the load-bearing
      // content — it's what forensic review reads. A regression that drops
      // {fields, self_edit} from the SECURITY DEFINER body would leave the
      // four columns above intact but silently empty the audit trail's
      // detail. Assert the payload round-trips verbatim.
      const metadata = data![0].metadata as Record<string, unknown> | null;
      expect(metadata).not.toBeNull();
      expect(metadata).toMatchObject({
        fields: ["max_weight"],
        self_edit: true,
      });
    },
    60_000,
  );
});
