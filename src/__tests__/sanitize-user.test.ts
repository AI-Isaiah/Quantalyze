/**
 * Integration test — Migration 055 sanitize_user RPC.
 *
 * Sprint 6 closeout Task 7.3. Verifies three invariants against a live
 * Supabase database:
 *
 *   1. IDEMPOTENCY: calling sanitize_user twice on the same user is a
 *      no-op on the second call. The second call returns 0 rows mutated.
 *   2. AUDIT TRAIL PRESERVED: any audit_log rows attributed to the
 *      sanitized user survive the sanitize. The migration 049 deny
 *      policies enforce this at the DB layer; this test is a
 *      belt-and-suspenders assertion that the sanitize_user RPC doesn't
 *      somehow bypass the deny.
 *   3. API KEYS PURGED: every api_keys row owned by the user is deleted.
 *      The row IS the credential — no anonymization short of DELETE is
 *      defensible.
 *
 * Plus a cross-table cascade sanity: if a user has a pending deletion
 * request AND a strategy with pending intro, the sanitize should
 * succeed (blocking or cascading per the migration 055 per-table
 * matrix — blocking would surface as an RPC error).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * and migration 055 applied. Skips gracefully otherwise.
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

// H-0031: the non-service-role-caller negative test needs an anon-key
// client to prove the EXECUTE grant (migration 055 REVOKEs from
// PUBLIC/anon/authenticated, GRANTs only to service_role) actually
// blocks a non-privileged caller. Gate on the anon key separately so a
// CI lane with the service key but no anon key skips just that one case
// rather than failing.
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const HAS_ANON = Boolean(ANON_KEY && SUPABASE_URL);

async function seedApiKey(
  admin: ReturnType<typeof createLiveAdminClient>,
  userId: string,
  label: string,
): Promise<string> {
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      user_id: userId,
      exchange: "binance",
      label,
      api_key_encrypted: "ct",
      dek_encrypted: "dct",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedApiKey failed: ${error?.message}`);
  }
  return data.id;
}

async function seedAuditRow(
  admin: ReturnType<typeof createLiveAdminClient>,
  userId: string,
  marker: string,
): Promise<string> {
  const { data, error } = await admin
    .from("audit_log")
    .insert({
      user_id: userId,
      action: `__sanitize_test_${marker}`,
      entity_type: "test_probe",
      entity_id: crypto.randomUUID(),
      metadata: { marker },
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedAuditRow failed: ${error?.message}`);
  }
  return data.id;
}

describe("Migration 055 — sanitize_user RPC", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "idempotent: double-call leaves the user fully sanitized with no errors",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[]; apiKeyIds: string[] } = {
        userIds: [],
        apiKeyIds: [],
      };

      try {
        const userId = await createTestUser(
          admin,
          `sanitize-idem-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        await seedApiKey(admin, userId, "idem-key");

        // First call — BOOLEAN contract (migration 055 I4 fix):
        // TRUE means this invocation did the anonymize.
        const { data: firstResult, error: firstErr } = await admin.rpc(
          "sanitize_user",
          { p_user_id: userId },
        );
        expect(firstErr).toBeNull();
        expect(firstResult).toBe(true);

        // Profile should now be anonymized
        const { data: profile } = await admin
          .from("profiles")
          .select("display_name, email")
          .eq("id", userId)
          .single();
        expect(profile?.display_name).toBe("[deleted]");
        expect(profile?.email).toBeNull();

        // Second call — idempotent no-op; returns FALSE (not first run).
        const { data: secondResult, error: secondErr } = await admin.rpc(
          "sanitize_user",
          { p_user_id: userId },
        );
        expect(secondErr).toBeNull();
        expect(secondResult).toBe(false);

        // Profile still anonymized (unchanged)
        const { data: profileAfter } = await admin
          .from("profiles")
          .select("display_name, email")
          .eq("id", userId)
          .single();
        expect(profileAfter?.display_name).toBe("[deleted]");
        expect(profileAfter?.email).toBeNull();
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "H-0032: idempotent re-run across the PURGE/ANONYMIZE matrix — second call is FALSE and re-mutates nothing",
    async () => {
      // H-0032: the minimal idempotency test above only seeds an
      // api_key. A regression in the re-run guard (e.g. the sentinel
      // probe `display_name = '[deleted]'` flips to `IS DISTINCT FROM`,
      // or the early FALSE return is dropped) would still pass that test
      // because there's only one row and nothing left to re-mutate on
      // the second call. This test seeds across SEVERAL of the per-table
      // matrix rows — PURGE (api_keys, user_favorites, user_notes,
      // investor_attestations, user_app_roles) AND ANONYMIZE
      // (strategies) — then double-calls and asserts:
      //   1. First call → TRUE, profile sentinel set, PURGE tables empty.
      //   2. Second call → FALSE (the re-run guard fires) with NO error
      //      (the per-table DELETE/UPDATE guards are not re-entered in a
      //      way that throws), and the state is byte-identical to after
      //      the first call. A re-fire of the PURGE statements would
      //      still "succeed" against empty tables, so the FALSE-return is
      //      NOT a sufficient oracle on its own: a regression that moves
      //      the `v_already_sanitized` short-circuit to the END of the
      //      body (RETURN FALSE *after* re-running every UPDATE/DELETE and
      //      re-emitting the gdpr.sanitize_user audit row) would still
      //      satisfy `second === false`. The load-bearing oracle for "the
      //      body did not re-enter" is therefore the audit-row count: the
      //      migration emits exactly ONE `gdpr.sanitize_user` audit_log row
      //      per *successful* (TRUE) run, and audit_log is PRESERVE — so a
      //      no-op second call MUST leave the count at exactly 1. This is
      //      the re-run audit-attribution probe H-0032 calls out as
      //      missing.
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: {
        userIds: string[];
        strategyIds: string[];
      } = { userIds: [], strategyIds: [] };
      // audit_log is PRESERVE (migration 049 deny + sanitize never touches
      // it), so the user-delete cascade does NOT remove the
      // gdpr.sanitize_user rows this test asserts on. Track + purge them via
      // the service-role bypass, mirroring the audit-trail test below.
      const auditIds: string[] = [];

      try {
        const userId = await createTestUser(
          admin,
          `sanitize-idem-matrix-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        // PURGE-matrix seeds.
        await seedApiKey(admin, userId, "idem-matrix-key");

        const { data: strat, error: stratErr } = await admin
          .from("strategies")
          .insert({ user_id: userId, name: "Idem matrix strategy" })
          .select("id")
          .single();
        if (stratErr || !strat) {
          throw new Error(`strategies seed: ${stratErr?.message}`);
        }
        cleanup.strategyIds.push(strat.id);

        const { error: favErr } = await admin
          .from("user_favorites")
          .insert({ user_id: userId, strategy_id: strat.id });
        if (favErr) throw new Error(`user_favorites seed: ${favErr.message}`);

        const { error: noteErr } = await admin
          .from("user_notes")
          .insert({ user_id: userId, content: "idem matrix note" });
        if (noteErr) throw new Error(`user_notes seed: ${noteErr.message}`);

        const { error: attErr } = await admin
          .from("investor_attestations")
          .insert({ user_id: userId, version: "v1" });
        if (attErr) throw new Error(`investor_attestations seed: ${attErr.message}`);

        const { error: roleErr } = await admin
          .from("user_app_roles")
          .insert({ user_id: userId, role: "allocator" });
        if (roleErr) throw new Error(`user_app_roles seed: ${roleErr.message}`);

        // First call — anonymize.
        const { data: first, error: firstErr } = await admin.rpc(
          "sanitize_user",
          { p_user_id: userId },
        );
        expect(firstErr).toBeNull();
        expect(first).toBe(true);

        // Helper: count rows in a PURGE table for this user.
        const countFor = async (
          table: string,
          col = "user_id",
        ): Promise<number | null> => {
          const { count } = await admin
            .from(table)
            .select(col, { count: "exact", head: true })
            .eq(col, userId);
          return count;
        };

        // PURGE tables emptied after the first call.
        expect(await countFor("api_keys")).toBe(0);
        expect(await countFor("user_favorites")).toBe(0);
        expect(await countFor("user_notes")).toBe(0);
        expect(await countFor("investor_attestations")).toBe(0);
        expect(await countFor("user_app_roles")).toBe(0);

        // Strategy ANONYMIZED (row survives, name scrubbed).
        const { data: stratAfter } = await admin
          .from("strategies")
          .select("id, name")
          .eq("id", strat.id)
          .single();
        expect(stratAfter?.id).toBe(strat.id);
        expect(stratAfter?.name).not.toBe("Idem matrix strategy");

        const { data: profile } = await admin
          .from("profiles")
          .select("display_name")
          .eq("id", userId)
          .single();
        expect(profile?.display_name).toBe("[deleted]");

        // RE-RUN AUDIT-ATTRIBUTION PROBE (H-0032). A successful (TRUE)
        // sanitize emits exactly ONE `gdpr.sanitize_user` audit_log row
        // attributed to the target. Capture the post-first-call set so we
        // can both (a) assert the count and (b) clean it up afterwards.
        const sanitizeAuditRows = async (): Promise<
          { id: string }[]
        > => {
          const { data, error } = await admin
            .from("audit_log")
            .select("id")
            .eq("user_id", userId)
            .eq("action", "gdpr.sanitize_user");
          if (error) throw new Error(`audit_log read: ${error.message}`);
          return data ?? [];
        };
        const afterFirstAudit = await sanitizeAuditRows();
        for (const r of afterFirstAudit) auditIds.push(r.id);
        expect(afterFirstAudit.length).toBe(1);

        // Second call — the re-run guard MUST short-circuit to FALSE with
        // no error. If the guard regressed, the per-table mutations would
        // re-enter; the FALSE return is the proof they did not.
        const { data: second, error: secondErr } = await admin.rpc(
          "sanitize_user",
          { p_user_id: userId },
        );
        expect(secondErr).toBeNull();
        expect(second).toBe(false);

        // State is unchanged after the no-op second call.
        expect(await countFor("api_keys")).toBe(0);
        expect(await countFor("user_favorites")).toBe(0);
        expect(await countFor("user_notes")).toBe(0);
        expect(await countFor("investor_attestations")).toBe(0);
        expect(await countFor("user_app_roles")).toBe(0);
        const { data: stratAfter2 } = await admin
          .from("strategies")
          .select("id, name")
          .eq("id", strat.id)
          .single();
        expect(stratAfter2?.name).toBe(stratAfter?.name);
        const { data: profileAfter2 } = await admin
          .from("profiles")
          .select("display_name")
          .eq("id", userId)
          .single();
        expect(profileAfter2?.display_name).toBe("[deleted]");

        // The decisive H-0032 oracle: the no-op second call must NOT have
        // re-emitted a gdpr.sanitize_user audit row. Still exactly ONE,
        // and it is the SAME row captured after the first call. A
        // regression where the re-run short-circuit no longer guards the
        // body (the function re-runs every UPDATE/DELETE + re-fires the
        // audit emission, yet still RETURNs FALSE at the end) goes
        // undetected by the FALSE-return assertion alone but trips here:
        // the count becomes 2.
        const afterSecondAudit = await sanitizeAuditRows();
        expect(afterSecondAudit.length).toBe(1);
        expect(afterSecondAudit[0]?.id).toBe(afterFirstAudit[0]?.id);
      } finally {
        // audit_log is PRESERVE — purge the gdpr.sanitize_user rows this
        // test created via the service-role bypass (migration 049 denies
        // UPDATE/DELETE through PostgREST, service-role is bypassed for
        // cleanup) so they don't leak into the live DB.
        for (const id of auditIds) {
          await admin.from("audit_log").delete().eq("id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "organization owner: sanitize succeeds, org survives with created_by=NULL, other members remain (C1 regression)",
    async () => {
      // Prior bug: `UPDATE organizations SET created_by = NULL` raised
      // not_null_violation because migration 006 declared created_by
      // as NOT NULL. Migration 057 drops the NOT NULL; this test
      // guards that the sanitize completes and the org row is intact.
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const orgIds: string[] = [];

      try {
        const ownerId = await createTestUser(
          admin,
          `sanitize-org-owner-${ts}@test.sec`,
        );
        const secondMemberId = await createTestUser(
          admin,
          `sanitize-org-member-${ts}@test.sec`,
        );
        cleanup.userIds.push(ownerId, secondMemberId);

        // Seed an organization owned by `ownerId` with `secondMemberId`
        // as a non-owner member. Unique slug to avoid collision across
        // test runs.
        const slug = `org-c1-${ts}-${Math.random().toString(36).slice(2, 8)}`;
        const { data: org, error: orgErr } = await admin
          .from("organizations")
          .insert({
            name: `C1 Probe Org ${ts}`,
            slug,
            created_by: ownerId,
          })
          .select("id, created_by")
          .single();
        if (orgErr || !org) {
          throw new Error(`organizations seed: ${orgErr?.message}`);
        }
        orgIds.push(org.id);
        expect(org.created_by).toBe(ownerId);

        const { error: memErr } = await admin
          .from("organization_members")
          .insert([
            { organization_id: org.id, user_id: ownerId, role: "owner" },
            { organization_id: org.id, user_id: secondMemberId, role: "member" },
          ]);
        if (memErr) {
          throw new Error(`organization_members seed: ${memErr.message}`);
        }

        // Sanitize the owner. Before migration 057 this call would fail
        // with not_null_violation on organizations.created_by. After
        // 057, the UPDATE sets created_by=NULL and returns TRUE.
        const { data: firstRun, error: rpcErr } = await admin.rpc(
          "sanitize_user",
          { p_user_id: ownerId },
        );
        expect(rpcErr).toBeNull();
        expect(firstRun).toBe(true);

        // Organization row still exists with created_by = NULL
        const { data: orgAfter, error: orgReadErr } = await admin
          .from("organizations")
          .select("id, created_by, name, slug")
          .eq("id", org.id)
          .single();
        expect(orgReadErr).toBeNull();
        expect(orgAfter?.id).toBe(org.id);
        expect(orgAfter?.created_by).toBeNull();
        expect(orgAfter?.slug).toBe(slug);

        // The other member's membership is intact. The owner's own
        // membership was purged by sanitize (PURGE per migration 055
        // matrix), so only the second member remains.
        const { data: membersAfter, error: mReadErr } = await admin
          .from("organization_members")
          .select("user_id, role")
          .eq("organization_id", org.id);
        expect(mReadErr).toBeNull();
        const memberIds = (membersAfter ?? []).map((m) => m.user_id);
        expect(memberIds).toContain(secondMemberId);
        expect(memberIds).not.toContain(ownerId);
      } finally {
        // Clean up the organization (FK cascades wipe the remaining
        // organization_members row). Users deleted by the cleanup
        // helper.
        for (const id of orgIds) {
          await admin.from("organizations").delete().eq("id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "audit trail preserved: audit_log rows survive sanitize_user",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      const auditIds: string[] = [];

      try {
        const userId = await createTestUser(
          admin,
          `sanitize-audit-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        // Seed two audit rows for this user
        auditIds.push(await seedAuditRow(admin, userId, `pre-${ts}-1`));
        auditIds.push(await seedAuditRow(admin, userId, `pre-${ts}-2`));

        // Run sanitize
        const { error: rpcErr } = await admin.rpc("sanitize_user", {
          p_user_id: userId,
        });
        expect(rpcErr).toBeNull();

        // Audit rows must still exist AND still attribute to userId
        // (the attribution is the whole point of the trail — the row
        // references a now-anonymized profiles row, but the user_id
        // FK is preserved).
        const { data: rows, error: readErr } = await admin
          .from("audit_log")
          .select("id, user_id, action")
          .in("id", auditIds);
        expect(readErr).toBeNull();
        expect(rows?.length).toBe(2);
        for (const row of rows ?? []) {
          expect(row.user_id).toBe(userId);
        }
      } finally {
        // Clean up audit rows via the service-role bypass — migration
        // 049 denies UPDATE/DELETE via PostgREST but service-role is
        // bypassed for cleanup scripts; if the REVOKE is enforced the
        // rows will leak as documented in the helper warn path.
        for (const id of auditIds) {
          await admin.from("audit_log").delete().eq("id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "api_keys purged: zero rows remain for the user after sanitize",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };

      try {
        const userId = await createTestUser(
          admin,
          `sanitize-keys-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        // Seed two keys
        await seedApiKey(admin, userId, "key-1");
        await seedApiKey(admin, userId, "key-2");

        const { count: before } = await admin
          .from("api_keys")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        expect(before).toBe(2);

        const { error: rpcErr } = await admin.rpc("sanitize_user", {
          p_user_id: userId,
        });
        expect(rpcErr).toBeNull();

        const { count: after } = await admin
          .from("api_keys")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);
        expect(after).toBe(0);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "cascade: user with a pending contact_request (intro) + strategy is sanitized without error",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: {
        userIds: string[];
        strategyIds: string[];
      } = { userIds: [], strategyIds: [] };

      try {
        // Create manager (strategy owner) + allocator (contact_request
        // originator). We sanitize the allocator — the contact_request
        // row preserves per the matrix.
        const managerId = await createTestUser(
          admin,
          `sanitize-manager-${ts}@test.sec`,
        );
        const allocatorId = await createTestUser(
          admin,
          `sanitize-allocator-${ts}@test.sec`,
        );
        cleanup.userIds.push(managerId, allocatorId);

        const { data: strategy, error: sErr } = await admin
          .from("strategies")
          .insert({ user_id: managerId, name: "Cascade probe strategy" })
          .select("id")
          .single();
        if (sErr || !strategy) {
          throw new Error(`strategy seed: ${sErr?.message}`);
        }
        cleanup.strategyIds.push(strategy.id);

        // Seed the contact_request (pending intro)
        const { data: cr, error: crErr } = await admin
          .from("contact_requests")
          .insert({
            allocator_id: allocatorId,
            strategy_id: strategy.id,
            message: "pending probe intro",
            status: "pending",
          })
          .select("id")
          .single();
        if (crErr || !cr) {
          throw new Error(`contact_request seed: ${crErr?.message}`);
        }

        // Sanitize the allocator. The per-table matrix says
        // contact_requests are PRESERVED (cross-party audit), so the
        // call must succeed — NOT throw a FK-cascade error.
        const { error: rpcErr } = await admin.rpc("sanitize_user", {
          p_user_id: allocatorId,
        });
        expect(rpcErr).toBeNull();

        // Contact request still exists
        const { data: crAfter, error: crReadErr } = await admin
          .from("contact_requests")
          .select("id, allocator_id, status")
          .eq("id", cr.id)
          .maybeSingle();
        expect(crReadErr).toBeNull();
        expect(crAfter?.id).toBe(cr.id);
        expect(crAfter?.allocator_id).toBe(allocatorId);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  // ----------------------------------------------------------------
  // H-0031 — negative-path / "what should fail" coverage.
  //
  // The five tests above all exercise the happy path (seed → sanitize →
  // assert). Rule 9 (tests encode intent, including what SHOULD fail)
  // was unanswered: there was no test for NULL input, a non-existent
  // user, or an unauthorized (non-service-role) caller. The migration
  // body pins the CORRECT behavior for each:
  //   - NULL p_user_id     → RAISE EXCEPTION (ERRCODE invalid_parameter_value).
  //   - non-existent user  → no error, RETURN FALSE (nothing to anonymize).
  //   - non-service caller → permission denied (EXECUTE granted to
  //                          service_role only; REVOKEd from anon/authenticated).
  // ----------------------------------------------------------------
  it.skipIf(!HAS_LIVE_DB)(
    "H-0031: NULL p_user_id raises an error (does NOT silently succeed)",
    async () => {
      const admin = createLiveAdminClient();
      const { data, error } = await admin.rpc("sanitize_user", {
        p_user_id: null,
      });
      // The RPC RAISEs 'sanitize_user: p_user_id is required'. A silent
      // success (or a benign FALSE) on NULL input would be a contract
      // regression — sanitize must never be a no-op on a malformed call
      // that an orchestrator could misread as "done".
      expect(error).not.toBeNull();
      expect(error?.message ?? "").toMatch(/p_user_id is required/i);
      // No boolean result on the error path.
      expect(data).toBeNull();
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "H-0031: a random non-existent user_id returns FALSE with no error (no-op, not a crash)",
    async () => {
      const admin = createLiveAdminClient();
      // A UUID that has no profiles row. The probe finds no row →
      // v_already_sanitized IS NULL → RETURN FALSE. This MUST be a clean
      // no-op (FALSE, no error), not an exception — an Art. 17 worker
      // re-driving a deleted request must not crash on a vanished user.
      const ghostId = crypto.randomUUID();
      const { data, error } = await admin.rpc("sanitize_user", {
        p_user_id: ghostId,
      });
      expect(error).toBeNull();
      expect(data).toBe(false);
    },
    30_000,
  );

  it.skipIf(!(HAS_LIVE_DB && HAS_ANON))(
    "H-0031: a non-service-role (anon) caller is denied EXECUTE on sanitize_user",
    async () => {
      // Migration 055 REVOKEs EXECUTE from PUBLIC/anon/authenticated and
      // GRANTs only to service_role. An anon-key client (no privileged
      // grant) MUST be rejected — proving the SECURITY DEFINER function
      // cannot be invoked to anonymize an arbitrary user by an
      // unprivileged caller. We use a freshly-seeded real user as the
      // target so the denial is about the CALLER's privilege, not a
      // missing target.
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };
      try {
        const userId = await createTestUser(
          admin,
          `sanitize-anon-deny-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await anon.rpc("sanitize_user", {
          p_user_id: userId,
        });
        // PostgREST surfaces the missing EXECUTE grant as a permission
        // error (42501 / "permission denied for function"). The exact
        // code can vary by PostgREST version, so we assert an error IS
        // present and that it reads as a privilege/permission denial —
        // never a success.
        expect(error).not.toBeNull();
        expect(
          `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase(),
        ).toMatch(/permission denied|not.*(allowed|permitted)|42501|pgrst/i);

        // Belt-and-suspenders: the target user must NOT have been
        // sanitized by the denied call (display_name unchanged).
        const { data: profile } = await admin
          .from("profiles")
          .select("display_name")
          .eq("id", userId)
          .single();
        expect(profile?.display_name).not.toBe("[deleted]");
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it.skipIf(HAS_LIVE_DB)(
    "advertises skip reason when live DB is unavailable",
    () => {
      advertiseLiveDbSkipReason("sanitize-user");
      expect(true).toBe(true);
    },
  );
});
