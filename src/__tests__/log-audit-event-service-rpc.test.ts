/**
 * Integration test — Migration 058 `log_audit_event_service` RPC runtime
 * grants + NULL-guard behavior.
 *
 * Sprint 6 closeout Task 7.1b. Verifies three invariants against a live
 * Supabase database at RUNTIME (not just at migration apply time):
 *
 *   1. `service_role` JWT can EXECUTE the RPC and writes land in
 *      audit_log with the caller-supplied user_id. This is the positive
 *      path — without it, the Python cross-service emission path is DOA.
 *
 *   2. `authenticated` JWT cannot EXECUTE the RPC. Migration 058's
 *      REVOKE chain locks EXECUTE to service_role only. An
 *      `authenticated` call must surface as an RPC-layer permission
 *      error — this is the attribution-spoof gate ADR-0023 §8 (A1)
 *      commits to. The migration's DO block asserts the grant state at
 *      apply time via `has_function_privilege`; this test asserts the
 *      runtime behavior of an actual authenticated JWT call.
 *
 *   3. The RPC rejects NULL / missing user_id with
 *      `invalid_parameter_value` (SQLSTATE 22023). Migration 058 raises
 *      this EXCEPTION explicitly for p_user_id, p_action, p_entity_type,
 *      p_entity_id — the TS + Python wrappers both guard above this,
 *      but the RPC itself is the last line of defense.
 *
 * Why these aren't covered by the migration's self-verify DO block alone
 * ----------------------------------------------------------------------
 * Migration 058 asserts `has_function_privilege('authenticated', ...)`
 * returns FALSE at apply time. That's a static grant check — it proves
 * the REVOKE statement was recorded in pg_proc, but it does NOT exercise
 * the actual PostgREST authorization flow. A future migration that
 * silently re-grants EXECUTE (e.g., a sweeping `GRANT ALL ON ALL
 * FUNCTIONS ... TO authenticated`) would pass the static check but
 * break the runtime gate. This test exercises the runtime behavior.
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * and migration 058 applied. Skips gracefully otherwise.
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

describe("Migration 058 — log_audit_event_service RPC runtime gates", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "service_role can call log_audit_event_service and the row lands in audit_log",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const auditIds: string[] = [];

      try {
        const userId = await createTestUser(
          admin,
          `audit-svc-positive-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        const entityId = crypto.randomUUID();
        const action = `__audit_svc_positive_${ts}`;

        const { data: rowId, error: rpcErr } = await admin.rpc(
          "log_audit_event_service",
          {
            p_user_id: userId,
            p_action: action,
            p_entity_type: "test_probe",
            p_entity_id: entityId,
            p_metadata: { marker: `positive-${ts}` },
          },
        );
        expect(rpcErr).toBeNull();
        expect(typeof rowId).toBe("string");
        if (typeof rowId === "string") {
          auditIds.push(rowId);
        }

        // Verify the row landed with the caller-supplied user_id.
        const { data: reread } = await admin
          .from("audit_log")
          .select("id, user_id, action, entity_type, entity_id")
          .eq("id", rowId as string)
          .single();
        expect(reread?.user_id).toBe(userId);
        expect(reread?.action).toBe(action);
        expect(reread?.entity_type).toBe("test_probe");
        expect(reread?.entity_id).toBe(entityId);
      } finally {
        // Cleanup — audit_log deny policies block service-role DELETE
        // via PostgREST, so these rows leak. Marker-prefix isolation
        // keeps runs non-interfering.
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "authenticated JWT cannot EXECUTE log_audit_event_service (attribution-spoof gate)",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const email = `audit-svc-authed-${ts}@test.sec`;
      const password = `AuditSvcAuthed${ts}!`;

      try {
        const userId = await createTestUser(admin, email, password);
        cleanup.userIds.push(userId);

        // Sign in as a plain authenticated user via password grant.
        // Some Supabase projects disable password grant — skip the arm
        // rather than fail the whole suite if the signin doesn't land.
        const signInClient = createClient(
          LIVE_DB_URL!,
          LIVE_DB_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );
        const {
          data: { session },
          error: signInErr,
        } = await signInClient.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr || !session) {
          console.warn(
            "[log-audit-event-service-rpc] skipping authed-denial arm — signInWithPassword failed:",
            signInErr?.message,
          );
          return;
        }

        // Build an authenticated-role client by attaching the JWT on
        // every PostgREST request. This mirrors the pattern used in
        // audit-log-rls.test.ts.
        const authedClient = createClient(
          LIVE_DB_URL!,
          LIVE_DB_SERVICE_ROLE_KEY!,
          {
            auth: { persistSession: false },
            global: {
              headers: { Authorization: `Bearer ${session.access_token}` },
            },
          },
        );

        // Attempt to call the RPC with a spoofed user_id. The EXECUTE
        // grant is service_role only; PostgREST MUST surface a permission
        // error. Two possible failure shapes per migration 058:
        //   (a) RPC returns an error with code 42501 (insufficient
        //       privilege) or a message containing "permission denied".
        //   (b) RPC errors on "function ... does not exist" — which
        //       happens when authenticated doesn't have USAGE on the
        //       schema OR the function visibility is revoked such that
        //       the authenticated role can't even see it.
        // Either proves the spoof gate holds. What MUST NOT happen is a
        // successful insert with a caller-chosen user_id.
        const spoofedUserId = crypto.randomUUID();
        const { data, error } = await authedClient.rpc(
          "log_audit_event_service",
          {
            p_user_id: spoofedUserId,
            p_action: `__audit_svc_spoof_${ts}`,
            p_entity_type: "test_probe",
            p_entity_id: crypto.randomUUID(),
            p_metadata: { marker: `spoof-${ts}` },
          },
        );

        expect(error).not.toBeNull();
        expect(data).toBeNull();
        // Message should indicate permission or function-not-found.
        const msg = (error?.message ?? "").toLowerCase();
        expect(msg).toMatch(
          /permission denied|not allowed|insufficient|does not exist|could not find the function|not found/,
        );

        // Defense-in-depth: no audit_log row was written with the spoofed
        // user_id. An empty result confirms the RPC never ran.
        const { data: probe } = await admin
          .from("audit_log")
          .select("id")
          .eq("user_id", spoofedUserId)
          .limit(1);
        expect(probe ?? []).toEqual([]);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "log_audit_event_service rejects NULL p_user_id with invalid_parameter_value",
    async () => {
      const admin = createLiveAdminClient();
      // service_role is the caller — the NULL-guard check fires BEFORE
      // the INSERT, so no auth-level denial can shadow the parameter
      // validation failure.
      const { data, error } = await admin.rpc("log_audit_event_service", {
        p_user_id: null,
        p_action: `__audit_svc_null_${Date.now()}`,
        p_entity_type: "test_probe",
        p_entity_id: crypto.randomUUID(),
        p_metadata: {},
      });
      expect(data).toBeNull();
      expect(error).not.toBeNull();
      // SQLSTATE 22023 = invalid_parameter_value. supabase-js surfaces
      // this as `error.code === "22023"` OR embeds it in the message.
      const msg = (error?.message ?? "").toLowerCase();
      const code = error?.code ?? "";
      expect(
        code === "22023" ||
          msg.includes("required") ||
          msg.includes("invalid_parameter") ||
          msg.includes("p_user_id"),
      ).toBe(true);
    },
    15_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "log_audit_event_service rejects empty p_action with invalid_parameter_value",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };

      try {
        const userId = await createTestUser(
          admin,
          `audit-svc-empty-action-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        const { data, error } = await admin.rpc("log_audit_event_service", {
          p_user_id: userId,
          p_action: "",
          p_entity_type: "test_probe",
          p_entity_id: crypto.randomUUID(),
          p_metadata: {},
        });
        expect(data).toBeNull();
        expect(error).not.toBeNull();
        const msg = (error?.message ?? "").toLowerCase();
        expect(msg.includes("required") || msg.includes("p_action")).toBe(true);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("log-audit-event-service-rpc");
    expect(true).toBe(true);
  });
});
