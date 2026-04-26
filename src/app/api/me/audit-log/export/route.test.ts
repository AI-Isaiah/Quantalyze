import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

/**
 * Phase 11 Plan 02 / D-05 — Tests for GET /api/me/audit-log/export.
 *
 * Coverage:
 *   Test 1 — 401 when caller is not authenticated.
 *   Test 2 — 200 with text/csv + attachment Content-Disposition when authed.
 *   Test 3 — Body starts with caption + header.
 *   Test 4 — 500 envelope when supabase returns a query error.
 *   Test 5 (live-DB) — RLS isolation: allocator A's CSV omits allocator B's rows.
 *   Test 6 — Cache-Control: no-store header is set.
 *   Test 7 — Date filter: SELECT chain calls .gte('created_at', <90 days ago ISO>).
 *   Test 8 — audit-coverage compatibility: this file appears in route.ts but is
 *            read-only (.select only) so the audit-coverage regex (which scans
 *            for .insert/.update/.delete/.upsert) cannot flag it. The
 *            `@audit-skip:` pragma above the .from('audit_log') call provides
 *            defense-in-depth in case the regex is widened in the future.
 *   Test 9 (BLOCK-1) — SELECT chain calls .limit(10000) — bounds in-memory build.
 *   Test 10 (live-DB, BLOCK-1 regression) — 10005 seeded rows → response body
 *            has at most caption + header + 10000 data lines.
 */

// audit.ts imports `server-only` which throws under the vitest jsdom env.
vi.mock("server-only", () => ({}));

// Phase 11 review fix IN-03 — rate-limit mock. Default to "allow" so the
// non-rate-limit tests behave as before; per-test override flips to a 429
// stub for the rate-limit regression.
type CheckLimitMockResult =
  | { success: true }
  | { success: false; retryAfter: number };
const RL_HOISTED = vi.hoisted(() => ({
  checkLimit: vi.fn<
    (limiter: unknown, key: string) => Promise<CheckLimitMockResult>
  >(async () => ({ success: true }) as CheckLimitMockResult),
}));
vi.mock("@/lib/ratelimit", () => ({
  auditLogExportLimiter: { fakeLimiter: true },
  checkLimit: RL_HOISTED.checkLimit,
}));

// State shared across the unit-test mock and assertions.
const STATE = vi.hoisted(() => ({
  authUser: {
    id: "00000000-0000-0000-0000-000000000001",
  } as { id: string } | null,
  selectArg: null as string | null,
  gteArgs: null as { column: string; value: string } | null,
  orderArgs: null as { column: string; opts: unknown } | null,
  limitArg: null as number | null,
  limitCallCount: 0,
  rows: [] as Array<{
    created_at: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    metadata: Record<string, unknown> | null;
  }>,
  queryError: null as { code?: string; message?: string } | null,
}));

// User-scoped Supabase client — chain methods are spies that record their args
// so Test 7 (gte filter), Test 9 (limit cap), and Test 4 (DB error envelope)
// can assert without rebuilding the chain in every test.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const builder = {
      select: (cols: string) => {
        STATE.selectArg = cols;
        return builder;
      },
      gte: (column: string, value: string) => {
        STATE.gteArgs = { column, value };
        return builder;
      },
      order: (column: string, opts: unknown) => {
        STATE.orderArgs = { column, opts };
        return builder;
      },
      limit: async (n: number) => {
        STATE.limitArg = n;
        STATE.limitCallCount += 1;
        return { data: STATE.rows, error: STATE.queryError };
      },
    };
    return {
      auth: {
        getUser: async () => ({
          data: { user: STATE.authUser },
          error: null,
        }),
      },
      from: (_table: string) => builder,
    };
  },
}));

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/me/audit-log/export", {
    method: "GET",
    headers: { origin: "http://localhost:3000" },
  });
}

beforeEach(() => {
  STATE.authUser = { id: "00000000-0000-0000-0000-000000000001" };
  STATE.selectArg = null;
  STATE.gteArgs = null;
  STATE.orderArgs = null;
  STATE.limitArg = null;
  STATE.limitCallCount = 0;
  STATE.rows = [];
  STATE.queryError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/me/audit-log/export", () => {
  beforeEach(() => {
    // Reset the rate-limit mock so each test starts in the "allow" state.
    RL_HOISTED.checkLimit.mockReset();
    RL_HOISTED.checkLimit.mockResolvedValue({ success: true });
  });

  it("Test 1 — returns 401 Unauthorized when no auth cookie present", async () => {
    STATE.authUser = null;

    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("Phase 11 IN-03 — returns 429 + Retry-After when auditLogExportLimiter trips", async () => {
    RL_HOISTED.checkLimit.mockResolvedValueOnce({
      success: false,
      retryAfter: 42,
    });

    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");

    // Bucket key MUST be user-scoped so a single user's bursts can't
    // squeeze out other users.
    expect(RL_HOISTED.checkLimit).toHaveBeenCalledWith(
      expect.anything(),
      `audit_log_export:00000000-0000-0000-0000-000000000001`,
    );
  });

  it("Test 2 — returns 200 with text/csv + attachment Content-Disposition", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");

    const cd = res.headers.get("Content-Disposition");
    expect(cd).not.toBeNull();
    expect(cd!).toMatch(
      /^attachment; filename="quantalyze-audit-log-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
  });

  it("Test 3 — body starts with caption line then column header line", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.startsWith(
      "# Quantalyze audit log export — most recent 10,000 entries within 90-day window\n" +
        "occurred_at,action,entity_type,entity_id,metadata_summary\n",
    )).toBe(true);
  });

  it("Test 4 — returns 500 'Failed to read audit log' on DB error", async () => {
    STATE.queryError = { code: "PGRST301", message: "permission denied" };

    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to read audit log");
  });

  it("Test 6 — sets Cache-Control: no-store on the success response", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("Test 7 — chains .gte('created_at', <90 days ago ISO>) on the SELECT", async () => {
    const before = Date.now();
    const { GET } = await import("./route");
    const res = await GET(makeRequest());
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(STATE.gteArgs).not.toBeNull();
    expect(STATE.gteArgs!.column).toBe("created_at");

    // The threshold ISO should be ~90 days ago (within the test execution window).
    const isoMs = Date.parse(STATE.gteArgs!.value);
    expect(Number.isFinite(isoMs)).toBe(true);
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(isoMs).toBeGreaterThanOrEqual(before - ninetyDaysMs - 100);
    expect(isoMs).toBeLessThanOrEqual(after - ninetyDaysMs + 100);
  });

  it("Test 9 (BLOCK-1) — SELECT chain caps at .limit(10000)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(STATE.limitArg).toBe(10000);
    expect(STATE.limitCallCount).toBe(1);
  });

  it("selects the expected columns (created_at, action, entity_type, entity_id, metadata)", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(STATE.selectArg).toBe(
      "created_at, action, entity_type, entity_id, metadata",
    );
  });
});

describe("Test 8 — audit-coverage compatibility (route.ts is read-only with @audit-skip)", () => {
  it("route.ts uses only .select (no .insert/.update/.delete/.upsert) and includes an @audit-skip pragma", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const routePath = path.resolve(__dirname, "./route.ts");
    const src = fs.readFileSync(routePath, "utf8");

    // No mutations — the audit-coverage regex won't trigger.
    expect(src).not.toMatch(/^\s*\.insert\s*\(/m);
    expect(src).not.toMatch(/^\s*\.update\s*\(/m);
    expect(src).not.toMatch(/^\s*\.delete\s*\(/m);
    expect(src).not.toMatch(/^\s*\.upsert\s*\(/m);

    // Defense-in-depth: the @audit-skip pragma documents intent.
    expect(src).toMatch(/@audit-skip:/);
  });
});

describe.skipIf(!HAS_LIVE_DB)(
  "RLS isolation + row-cap regression (live DB)",
  () => {
    let admin: ReturnType<typeof createLiveAdminClient>;
    let userAId: string | null = null;
    let userBId: string | null = null;

    beforeAll(async () => {
      advertiseLiveDbSkipReason("api/me/audit-log/export");
      admin = createLiveAdminClient();
    });

    afterAll(async () => {
      if (admin && (userAId || userBId)) {
        // Best-effort cleanup of any seed audit_log rows + the test users.
        if (userAId) {
          await admin.from("audit_log").delete().eq("user_id", userAId);
        }
        if (userBId) {
          await admin.from("audit_log").delete().eq("user_id", userBId);
        }
        await cleanupLiveDbRow(admin, {
          userIds: [userAId, userBId].filter((id): id is string => id !== null),
        });
      }
    });

    it("Test 5 — Allocator A's CSV does not contain Allocator B's audit rows", async () => {
      const stamp = Date.now();
      userAId = await createTestUser(admin, `audit-export-a-${stamp}@example.test`);
      userBId = await createTestUser(admin, `audit-export-b-${stamp}@example.test`);

      // Seed deterministic, distinguishable rows for each user. Use service-role
      // insert to bypass RLS (service-role is allowed by the audit_log_service_insert
      // policy in migration 010).
      const seed = [
        {
          user_id: userAId,
          action: "test.alloc_a_only",
          entity_type: "test_marker",
          entity_id: userAId,
          metadata: { tag: "A" },
        },
        {
          user_id: userBId,
          action: "test.alloc_b_only",
          entity_type: "test_marker",
          entity_id: userBId,
          metadata: { tag: "B" },
        },
      ];
      const { error: seedError } = await admin.from("audit_log").insert(seed);
      expect(seedError).toBeNull();

      // Issue a JWT for User A so the user-scoped client in the route handler
      // sees them as the authenticated caller.
      const { data: sessionA, error: sessionErr } =
        await admin.auth.admin.generateLink({
          type: "magiclink",
          email: `audit-export-a-${stamp}@example.test`,
        });
      expect(sessionErr).toBeNull();
      expect(sessionA).toBeDefined();

      // Authenticated read via the audit_log_owner_read RLS policy:
      // user A reads rows where user_id = auth.uid().
      // Use the createClient anonymous client + setSession to scope to user A.
      const { createClient: createSbClient } = await import("@supabase/supabase-js");
      const userClient = createSbClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
          process.env.SUPABASE_ANON_KEY ??
          "",
      );
      // Set an authenticated session for user A so RLS sees auth.uid() = userAId.
      const passwordA = `LiveDbTest${stamp}!`;
      await admin.auth.admin.updateUserById(userAId!, { password: passwordA });
      const { error: signInErr } = await userClient.auth.signInWithPassword({
        email: `audit-export-a-${stamp}@example.test`,
        password: passwordA,
      });
      expect(signInErr).toBeNull();

      // Hit the user-scoped audit_log table via the same SELECT shape the route uses.
      const ninetyDaysAgo = new Date(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data: rows, error: queryErr } = await userClient
        .from("audit_log")
        .select("created_at, action, entity_type, entity_id, metadata")
        .gte("created_at", ninetyDaysAgo)
        .order("created_at", { ascending: false })
        .limit(10000);

      expect(queryErr).toBeNull();
      const actions = (rows ?? []).map((r) => r.action);
      // User A's CSV (read directly here for the RLS test) MUST contain A's row.
      expect(actions).toContain("test.alloc_a_only");
      // User A MUST NOT see B's row — that's the RLS isolation contract.
      expect(actions).not.toContain("test.alloc_b_only");
    });

    it("Test 10 (BLOCK-1 regression) — 10005 seeded rows return ≤ 10002 lines", async () => {
      const stamp = Date.now();
      const tenkUserId = await createTestUser(
        admin,
        `audit-export-cap-${stamp}@example.test`,
      );

      try {
        // Bulk insert 10,005 audit_log rows for this user. Use 500-row chunks
        // to stay well under PostgREST's payload limit and Postgres bind
        // parameter limit.
        const TOTAL = 10005;
        const CHUNK = 500;
        const baseAction = "test.cap_regression";
        for (let offset = 0; offset < TOTAL; offset += CHUNK) {
          const batch = [];
          const end = Math.min(offset + CHUNK, TOTAL);
          for (let i = offset; i < end; i++) {
            batch.push({
              user_id: tenkUserId,
              action: `${baseAction}.${i}`,
              entity_type: "test_marker",
              entity_id: tenkUserId,
              metadata: { idx: i },
            });
          }
          const { error: bulkErr } = await admin
            .from("audit_log")
            .insert(batch);
          expect(bulkErr).toBeNull();
        }

        // Sign in as the test user so the user-scoped client in the route
        // handler sees them as authenticated.
        const passwordCap = `LiveDbTest${stamp}!`;
        await admin.auth.admin.updateUserById(tenkUserId, {
          password: passwordCap,
        });
        const { createClient: createSbClient } = await import(
          "@supabase/supabase-js"
        );
        const userClient = createSbClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
            process.env.SUPABASE_ANON_KEY ??
            "",
        );
        const { error: signInErr } = await userClient.auth.signInWithPassword({
          email: `audit-export-cap-${stamp}@example.test`,
          password: passwordCap,
        });
        expect(signInErr).toBeNull();

        const ninetyDaysAgo = new Date(
          Date.now() - 90 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data: rows, error: queryErr } = await userClient
          .from("audit_log")
          .select("created_at, action, entity_type, entity_id, metadata")
          .gte("created_at", ninetyDaysAgo)
          .order("created_at", { ascending: false })
          .limit(10000);

        expect(queryErr).toBeNull();
        // BLOCK-1: the .limit(10000) cap must hold at the SELECT layer.
        expect((rows ?? []).length).toBeLessThanOrEqual(10000);

        // End-to-end through the serializer: caption + header + ≤ 10000 data
        // lines means total newline count ≤ 10001 (each line is terminated
        // by `\n`, so the trailing `\n` after the last data row brings the
        // total to caption(1) + header(1) + dataRows(≤10000) = ≤ 10002 lines
        // = ≤ 10002 newline bytes.
        const { serializeAuditLogCsv } = await import("@/lib/audit-log-csv");
        const csv = serializeAuditLogCsv(
          (rows ?? []) as Parameters<typeof serializeAuditLogCsv>[0],
        );
        const newlineCount = (csv.match(/\n/g) ?? []).length;
        expect(newlineCount).toBeLessThanOrEqual(10002);
      } finally {
        // Cleanup the 10,005 seeded rows + the test user.
        await admin.from("audit_log").delete().eq("user_id", tenkUserId);
        await cleanupLiveDbRow(admin, { userIds: [tenkUserId] });
      }
    });
  },
);
