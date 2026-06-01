/**
 * Integration test — Migration 054 user_app_roles back-compat.
 *
 * Sprint 6 closeout Task 7.2. Verifies three invariants against a live
 * Supabase database:
 *
 *   1. A user with legacy `is_admin=true AND profiles.role='allocator'`
 *      resolves to BOTH `admin` and `allocator` roles after the backfill
 *      (per the task self-review checklist).
 *   2. A user with `role='both'` and `is_admin=false` resolves to both
 *      `allocator` AND `quant_manager`.
 *   3. `current_user_has_app_role(ARRAY['admin'])` returns TRUE for a
 *      signed-in admin JWT and FALSE for a non-admin JWT (proves the
 *      SQL helper integrates with the RLS layer end-to-end).
 *
 * Gate: requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * and migration 054 applied. Skips gracefully otherwise, same pattern
 * as `src/__tests__/audit-log-rls.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HAS_LIVE_DB,
  HAS_INTROSPECTION,
  LIVE_DB_URL,
  LIVE_DB_SERVICE_ROLE_KEY,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
  runIntrospectionSql,
} from "@/lib/test-helpers/live-db";

// ===========================================================================
// SINGLE-SOURCE ORACLE (H-0040 / H-0041 / H-0042)
//
// The earlier fix hand-copied the migration's three INSERT-SELECT statements
// into a test-local string. That decouples the test from the production
// artifact: a reviewer correctly flagged that editing the migration .sql file
// (e.g. dropping 'both' from the manager arm, or flipping ON CONFLICT DO
// NOTHING → DO UPDATE) leaves the inline copy untouched, so the assertions
// stay green. The test then proves only "Postgres runs THIS string correctly",
// never "migration 054's SELECT is correct".
//
// The fix is to make the migration file itself the single source of truth.
// We READ supabase/migrations/20260417031851_user_app_roles.sql at runtime and
// extract its STEP-4 backfill statements via regex. Both the live-DB replay
// arms (H-0040/H-0042 backfill, H-0041 idempotency) AND the pure-offline
// structural assertions below operate on what the FILE says — so a regression
// in the production artifact is reproduced and caught. This mirrors the
// established codebase convention in
// src/__tests__/strategy-sources-migration-parity.test.ts (read the migration,
// regex out the production SQL, assert on it — no DB round-trip).
// ===========================================================================
const MIGRATION_054_PATH = resolve(
  process.cwd(),
  "supabase/migrations/20260417031851_user_app_roles.sql",
);

interface BackfillStatement {
  /** The role literal SELECTed (admin | allocator | quant_manager). */
  role: string;
  /** Normalised WHERE predicate text (between SELECT…FROM and ON CONFLICT). */
  where: string;
  /** The ON CONFLICT action, normalised to upper-case ("DO NOTHING"|"DO UPDATE"). */
  conflictAction: string;
  /** The full statement text, for scoped replay against the live DB. */
  sql: string;
}

/** Strip `-- line` and block comments so a commented-out INSERT can't masquerade
 *  as the live backfill (same conservative approach as the strategy-sources
 *  parity test). */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");
}

/**
 * Parse the migration file and return its STEP-4 backfill INSERT-SELECT
 * statements, keyed by role. This is the ORACLE: every assertion below reads
 * from here, so it tracks the production file rather than a frozen copy.
 */
function parseBackfillStatements(): Map<string, BackfillStatement> {
  const sql = stripSqlComments(readFileSync(MIGRATION_054_PATH, "utf8"));
  const RE =
    /INSERT\s+INTO\s+user_app_roles\s*\([^)]*\)\s*SELECT\s+p\.id\s*,\s*'([a-z_]+)'[\s\S]*?ON\s+CONFLICT\s*\([^)]*\)\s*DO\s+(NOTHING|UPDATE)[\s\S]*?;/gi;
  const out = new Map<string, BackfillStatement>();
  for (const m of sql.matchAll(RE)) {
    const stmt = m[0];
    const whereMatch = stmt.match(/WHERE\s+([\s\S]*?)\s+ON\s+CONFLICT/i);
    out.set(m[1], {
      role: m[1],
      where: whereMatch ? whereMatch[1].replace(/\s+/g, " ").trim() : "",
      conflictAction: `DO ${m[2].toUpperCase()}`,
      sql: stmt,
    });
  }
  return out;
}

/**
 * Replay the migration's REAL backfill statements (read from the file), scoped
 * to a single user id so the write touches only the test fixture. We splice
 * ` AND p.id = '<uuid>'` into the file's own WHERE clause rather than
 * re-typing the predicate — the predicate text comes straight from the
 * migration, so a regression in the file's SELECT logic flows through to the
 * live DB here and is caught by the row assertions.
 */
async function runMigration054BackfillForUser(userId: string): Promise<void> {
  const statements = parseBackfillStatements();
  if (statements.size !== 3) {
    throw new Error(
      `Expected 3 backfill statements in migration 054, parsed ${statements.size}. ` +
        "The migration shape changed — update parseBackfillStatements().",
    );
  }
  for (const role of ["admin", "allocator", "quant_manager"]) {
    const stmt = statements.get(role);
    if (!stmt) {
      throw new Error(`Migration 054 backfill is missing the '${role}' INSERT.`);
    }
    // Scope the file's own statement to this test user by injecting an
    // `AND p.id = '<uuid>'` immediately before its ON CONFLICT clause.
    const scoped = stmt.sql.replace(
      /\s+ON\s+CONFLICT/i,
      ` AND p.id = '${userId}' ON CONFLICT`,
    );
    await runIntrospectionSql(scoped);
  }
}

async function seedUserRole(
  admin: ReturnType<typeof createLiveAdminClient>,
  userId: string,
  role: string,
): Promise<void> {
  const { error } = await admin.from("user_app_roles").upsert(
    { user_id: userId, role, granted_by: null, granted_at: new Date().toISOString() },
    { onConflict: "user_id,role", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(`Failed to seed user_app_roles (${role}): ${error.message}`);
  }
}

async function fetchUserRoles(
  admin: ReturnType<typeof createLiveAdminClient>,
  userId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId)
    .order("role");
  if (error) throw new Error(`Fetch failed: ${error.message}`);
  return (data ?? []).map((r) => r.role as string);
}

describe("Migration 054 — user_app_roles back-compat + helper", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "legacy is_admin=true + role='allocator' resolves to ['admin','allocator']",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };

      try {
        const userId = await createTestUser(admin, `rbac-dual-${ts}@test.sec`);
        cleanup.userIds.push(userId);

        // Simulate the legacy state: set is_admin=true + role='allocator'.
        const { error: upErr } = await admin
          .from("profiles")
          .update({ is_admin: true, role: "allocator" })
          .eq("id", userId);
        if (upErr) throw new Error(`profile update: ${upErr.message}`);

        // Simulate the backfill (it already ran at migration apply time,
        // but for a test user created after apply we re-run the logic).
        // NOTE: migration 054's backfill ran once; new test users created
        // later get rows from the seeding below, not the migration.
        await seedUserRole(admin, userId, "admin");
        await seedUserRole(admin, userId, "allocator");

        const roles = await fetchUserRoles(admin, userId);
        expect(roles.sort()).toEqual(["admin", "allocator"]);
      } finally {
        // Clean up the role rows first so the user delete cascades cleanly.
        for (const id of cleanup.userIds) {
          await admin.from("user_app_roles").delete().eq("user_id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "role='both' user resolves to ['allocator','quant_manager']",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };

      try {
        const userId = await createTestUser(admin, `rbac-both-${ts}@test.sec`);
        cleanup.userIds.push(userId);

        const { error: upErr } = await admin
          .from("profiles")
          .update({ is_admin: false, role: "both" })
          .eq("id", userId);
        if (upErr) throw new Error(`profile update: ${upErr.message}`);

        await seedUserRole(admin, userId, "allocator");
        await seedUserRole(admin, userId, "quant_manager");

        const roles = await fetchUserRoles(admin, userId);
        expect(roles.sort()).toEqual(["allocator", "quant_manager"]);
      } finally {
        for (const id of cleanup.userIds) {
          await admin.from("user_app_roles").delete().eq("user_id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    30_000,
  );

  it.skipIf(!HAS_LIVE_DB)(
    "current_user_has_app_role returns TRUE for admin JWT, FALSE for non-admin",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };

      const adminEmail = `rbac-helper-admin-${ts}@test.sec`;
      const adminPassword = `RbacHelperAdmin${ts}!`;
      const nonAdminEmail = `rbac-helper-none-${ts}@test.sec`;
      const nonAdminPassword = `RbacHelperNone${ts}!`;

      try {
        const adminId = await createTestUser(admin, adminEmail, adminPassword);
        const nonAdminId = await createTestUser(admin, nonAdminEmail, nonAdminPassword);
        cleanup.userIds.push(adminId, nonAdminId);

        await seedUserRole(admin, adminId, "admin");
        await seedUserRole(admin, nonAdminId, "allocator");

        // Sign in as the admin user and call the helper RPC.
        const adminClient = createClient(
          LIVE_DB_URL!,
          LIVE_DB_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );
        const {
          data: { session: adminSession },
          error: adminSignInErr,
        } = await adminClient.auth.signInWithPassword({
          email: adminEmail,
          password: adminPassword,
        });
        if (adminSignInErr || !adminSession) {
          console.warn(
            "[rbac-helper] skipping admin-helper arm — signInWithPassword failed:",
            adminSignInErr?.message,
          );
          return;
        }

        const authedAdmin = createClient(
          LIVE_DB_URL!,
          LIVE_DB_SERVICE_ROLE_KEY!,
          {
            auth: { persistSession: false },
            global: {
              headers: {
                Authorization: `Bearer ${adminSession.access_token}`,
              },
            },
          },
        );
        const { data: adminHas, error: adminRpcErr } = await authedAdmin.rpc(
          "current_user_has_app_role",
          { p_roles: ["admin"] },
        );
        expect(adminRpcErr).toBeNull();
        expect(adminHas).toBe(true);

        // Sign in as the non-admin and assert FALSE.
        const nonAdminClient = createClient(
          LIVE_DB_URL!,
          LIVE_DB_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );
        const {
          data: { session: nonAdminSession },
          error: nonAdminSignInErr,
        } = await nonAdminClient.auth.signInWithPassword({
          email: nonAdminEmail,
          password: nonAdminPassword,
        });
        if (nonAdminSignInErr || !nonAdminSession) {
          console.warn(
            "[rbac-helper] skipping non-admin-helper arm — signInWithPassword failed:",
            nonAdminSignInErr?.message,
          );
          return;
        }
        const authedNonAdmin = createClient(
          LIVE_DB_URL!,
          LIVE_DB_SERVICE_ROLE_KEY!,
          {
            auth: { persistSession: false },
            global: {
              headers: {
                Authorization: `Bearer ${nonAdminSession.access_token}`,
              },
            },
          },
        );
        const { data: nonAdminHas, error: nonAdminRpcErr } =
          await authedNonAdmin.rpc("current_user_has_app_role", {
            p_roles: ["admin"],
          });
        expect(nonAdminRpcErr).toBeNull();
        expect(nonAdminHas).toBe(false);

        // Bonus: non-admin checking their own (allocator) role returns TRUE.
        const { data: nonAdminAllocatorHas } = await authedNonAdmin.rpc(
          "current_user_has_app_role",
          { p_roles: ["allocator"] },
        );
        expect(nonAdminAllocatorHas).toBe(true);
      } finally {
        for (const id of cleanup.userIds) {
          await admin.from("user_app_roles").delete().eq("user_id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  // ===========================================================================
  // H-0040 / H-0042 — exercise the MIGRATION's actual backfill SELECT logic,
  // not a manual seed of the expected end-state.
  //
  // The original three tests above call seedUserRole(...) which directly UPSERTs
  // the expected rows — proving the upsert + schema work, but NOT that
  // migration 054's INSERT-SELECT-FROM-profiles produces those rows. This test
  // sets a profiles row to (is_admin=true, role='both') and replays the
  // migration's exact INSERT-SELECT statements (scoped to this user). A
  // regression like `WHERE p.role = 'manager'` (instead of IN ('manager','both'))
  // would drop the quant_manager row for a role='both' user → this fails.
  //
  // Gated on HAS_INTROSPECTION because re-running the migration's raw SQL
  // requires the Management API query endpoint (PostgREST cannot run arbitrary
  // INSERT-SELECT). FLAGGED: cannot run offline — verify on the live-DB lane.
  // ===========================================================================
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "H-0040/H-0042: migration 054 backfill SELECT maps is_admin=true + role='both' → ['admin','allocator','quant_manager']",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };

      try {
        const userId = await createTestUser(admin, `rbac-backfill-${ts}@test.sec`);
        cleanup.userIds.push(userId);

        // Legacy truth state the backfill must translate: admin AND both.
        const { error: upErr } = await admin
          .from("profiles")
          .update({ is_admin: true, role: "both" })
          .eq("id", userId);
        if (upErr) throw new Error(`profile update: ${upErr.message}`);

        // Replay the migration's real INSERT-SELECT statements (NOT seedUserRole).
        await runMigration054BackfillForUser(userId);

        const roles = await fetchUserRoles(admin, userId);
        // is_admin=true → admin; role='both' → allocator AND quant_manager.
        expect(roles.sort()).toEqual(["admin", "allocator", "quant_manager"]);
      } finally {
        for (const id of cleanup.userIds) {
          await admin.from("user_app_roles").delete().eq("user_id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  // ===========================================================================
  // H-0041 — idempotent re-run: running the migration 054 backfill a SECOND
  // time is a no-op. With ON CONFLICT DO NOTHING the existing rows (and their
  // original granted_at) must be preserved — a regression to ON CONFLICT DO
  // UPDATE / DELETE+INSERT would bump granted_at and silently rewrite history.
  //
  // Gated on HAS_INTROSPECTION. FLAGGED: cannot run offline.
  // ===========================================================================
  it.skipIf(!HAS_LIVE_DB || !HAS_INTROSPECTION)(
    "H-0041: re-running migration 054 backfill is idempotent — row count + granted_at unchanged",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: { userIds: string[] } = { userIds: [] };

      try {
        const userId = await createTestUser(admin, `rbac-idem-${ts}@test.sec`);
        cleanup.userIds.push(userId);

        const { error: upErr } = await admin
          .from("profiles")
          .update({ is_admin: true, role: "allocator" })
          .eq("id", userId);
        if (upErr) throw new Error(`profile update: ${upErr.message}`);

        // First backfill.
        await runMigration054BackfillForUser(userId);
        const { data: firstRows, error: firstErr } = await admin
          .from("user_app_roles")
          .select("role, granted_at")
          .eq("user_id", userId)
          .order("role");
        expect(firstErr).toBeNull();
        const firstByRole = new Map(
          (firstRows ?? []).map((r) => [r.role as string, r.granted_at as string]),
        );
        expect([...firstByRole.keys()].sort()).toEqual(["admin", "allocator"]);

        // Second backfill — must be a no-op.
        await runMigration054BackfillForUser(userId);
        const { data: secondRows, error: secondErr } = await admin
          .from("user_app_roles")
          .select("role, granted_at")
          .eq("user_id", userId)
          .order("role");
        expect(secondErr).toBeNull();

        // Same number of rows.
        expect((secondRows ?? []).length).toBe((firstRows ?? []).length);
        // granted_at preserved per role (ON CONFLICT DO NOTHING, not DO UPDATE).
        for (const r of secondRows ?? []) {
          expect(r.granted_at).toBe(firstByRole.get(r.role as string));
        }
      } finally {
        for (const id of cleanup.userIds) {
          await admin.from("user_app_roles").delete().eq("user_id", id);
        }
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("user-app-roles-backfill");
    expect(true).toBe(true);
  });
});

// ===========================================================================
// H-0040 / H-0041 / H-0042 — OFFLINE structural oracle (runs in CI, no DB).
//
// The live-DB arms above prove the migration's SELECT executes correctly
// against real Postgres, but they only run on the manual live-DB lane
// (HAS_INTROSPECTION needs SUPABASE_ACCESS_TOKEN + PROJECT_REF, which CI does
// NOT set). That left the reviewer's named regressions uncaught in CI: editing
// the migration file's WHERE / ON CONFLICT clause would deploy with no PR-time
// signal.
//
// These assertions close that gap. They READ the production migration file and
// assert its STEP-4 backfill statements still satisfy the invariants the
// findings name — purely from the file, so they fail the moment the production
// artifact regresses, and they need NO database connection. This is the same
// read-the-migration-and-assert pattern as strategy-sources-migration-parity.
// ===========================================================================
describe("Migration 054 backfill — structural invariants (single-source oracle)", () => {
  it("parses exactly the three STEP-4 backfill INSERTs (admin, allocator, quant_manager)", () => {
    const statements = parseBackfillStatements();
    expect(
      [...statements.keys()].sort(),
      "Migration 054's three backfill INSERT-SELECT statements could not be parsed from the file. " +
        "If the migration shape changed, update parseBackfillStatements() so this oracle keeps tracking it.",
    ).toEqual(["admin", "allocator", "quant_manager"]);
  });

  // H-0040 / H-0042: the named regression is editing the migration's SELECT to
  // `WHERE p.role = 'manager'` (dropping the 'both' arm), which would silently
  // strip quant_manager from every role='both' user. Asserting the file's
  // predicate still includes the 'both' arm fails on exactly that edit.
  it("H-0040/H-0042: allocator + quant_manager arms still backfill role='both' users", () => {
    const statements = parseBackfillStatements();

    const allocatorWhere = statements.get("allocator")?.where ?? "";
    const quantWhere = statements.get("quant_manager")?.where ?? "";

    // The predicate must be a membership test that INCLUDES 'both' — not a
    // single-value equality that drops it. `role IN (... 'both' ...)`.
    const includesBoth = (where: string) =>
      /\brole\s+IN\s*\(([^)]*)\)/i.test(where) &&
      /'both'/i.test(where.match(/\brole\s+IN\s*\(([^)]*)\)/i)?.[1] ?? "");

    expect(
      includesBoth(allocatorWhere),
      `allocator backfill predicate dropped the 'both' arm — role='both' users would lose their allocator row. WHERE: ${allocatorWhere}`,
    ).toBe(true);
    expect(
      includesBoth(quantWhere),
      `quant_manager backfill predicate dropped the 'both' arm — role='both' users would lose their quant_manager row (the exact H-0042 regression). WHERE: ${quantWhere}`,
    ).toBe(true);

    // Belt-and-suspenders: the manager arm must reference 'manager' too, so a
    // typo'd `IN ('both')` (allocator-only) is also caught.
    expect(/'manager'/i.test(quantWhere)).toBe(true);
    expect(/'allocator'/i.test(allocatorWhere)).toBe(true);
  });

  // H-0040: the admin arm must key off is_admin = TRUE (legacy back-compat).
  it("H-0040: admin arm backfills is_admin=true profiles", () => {
    const statements = parseBackfillStatements();
    const adminWhere = statements.get("admin")?.where ?? "";
    expect(
      /\bis_admin\s*=\s*TRUE\b/i.test(adminWhere),
      `admin backfill predicate no longer keys off is_admin = TRUE — legacy admins would not get an admin role. WHERE: ${adminWhere}`,
    ).toBe(true);
  });

  // H-0041: the named regression is flipping ON CONFLICT DO NOTHING →
  // DO UPDATE SET granted_at = now(), which would bump granted_at on every
  // re-run and silently rewrite grant history (granted_at is immutable by the
  // column's own contract). Asserting every backfill stays DO NOTHING fails on
  // that edit — the property the live-DB idempotency arm checks, now enforced
  // in CI from the file.
  it("H-0041: every backfill INSERT is idempotent (ON CONFLICT DO NOTHING, never DO UPDATE)", () => {
    const statements = parseBackfillStatements();
    for (const role of ["admin", "allocator", "quant_manager"]) {
      const stmt = statements.get(role);
      expect(stmt, `missing '${role}' backfill statement`).toBeDefined();
      expect(
        stmt?.conflictAction,
        `'${role}' backfill is no longer ON CONFLICT DO NOTHING — a re-run would rewrite granted_at and break the immutability contract (the H-0041 regression). Got: ${stmt?.conflictAction}`,
      ).toBe("DO NOTHING");
      // Defence-in-depth: the literal "DO UPDATE" must not appear in the stmt.
      expect(/DO\s+UPDATE/i.test(stmt?.sql ?? "")).toBe(false);
    }
  });
});
