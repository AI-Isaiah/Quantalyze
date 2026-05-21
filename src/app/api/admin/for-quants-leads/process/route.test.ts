import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * audit-2026-05-07 C-0037 — co-located route coverage for
 * /api/admin/for-quants-leads/process. The finding flagged this route as
 * having no test alongside it. The handler is wrapped by `withAdminAuth`
 * (CSRF + auth + admin-role gate) and emits a `lead.process` /
 * `lead.unprocess` audit event on the success path.
 *
 * Cases pinned here:
 *   1. 403 when the caller is authenticated but NOT an admin (the
 *      `withAdminAuth` non-admin denial branch). No audit emission on
 *      the success-path action — the wrapper's `admin.access.denied`
 *      audit is the wrapper's responsibility, not this route's.
 *   2. 400 when the `id` body field is not a UUID (route-level
 *      `isUuid` guard).
 *   3. 200 + `lead.process` audit emission on the default body
 *      (`unprocess` omitted ⇒ markLeadProcessed path).
 *
 * The route file itself is NOT modified by this test. The audit module
 * is mocked at the boundary (`logAuditEvent`) so we observe the emission
 * shape without going near `after()` / Supabase RPC plumbing.
 */

vi.mock("server-only", () => ({}));

const STATE = vi.hoisted(() => ({
  authUser: { id: "00000000-0000-0000-0000-0000000000aa" } as
    | { id: string }
    | null,
  isAdminResult: true,
  markResult: { ok: true } as { ok: true } | { ok: false; reason: "not_found" } | { ok: false; reason: "unknown" },
  unmarkResult: { ok: true } as { ok: true } | { ok: false; reason: "not_found" } | { ok: false; reason: "unknown" },
  markCalls: [] as string[],
  unmarkCalls: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: STATE.authUser }, error: null }),
    },
    // logAuditEvent uses this client — mocked at the boundary below, but
    // a minimal rpc stub keeps it safe if a future change adds a direct
    // call from the route.
    rpc: async () => ({ data: null, error: null }),
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => STATE.isAdminResult,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // Used by withAdminAuth on the non-admin denial branch
    // (admin.access.denied audit). Returning a stub `from()` chain is
    // sufficient — the denial audit is emitted via logAuditEventAsUser
    // which we mock at the boundary too.
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "row-id" }, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/for-quants-leads-admin", () => ({
  markLeadProcessed: async (id: string) => {
    STATE.markCalls.push(id);
    return STATE.markResult;
  },
  unmarkLeadProcessed: async (id: string) => {
    STATE.unmarkCalls.push(id);
    return STATE.unmarkResult;
  },
}));

const auditEmissions: Array<{
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
}> = [];

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>(
    "@/lib/audit",
  );
  return {
    ...actual,
    logAuditEvent: (
      _client: unknown,
      event: {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata?: Record<string, unknown>;
      },
    ) => {
      auditEmissions.push({
        action: event.action,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        metadata: event.metadata ?? {},
      });
    },
    // The withAdminAuth wrapper also calls logAuditEventAsUser on the
    // non-admin denial branch. Stub it so the 403 test does not bleed
    // a row into auditEmissions[] (we only assert on the route's own
    // emissions).
    logAuditEventAsUser: () => {},
  };
});

const VALID_UUID = "11111111-2222-4333-8444-555555555555";

function makeReq(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/admin/for-quants-leads/process",
    {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  STATE.authUser = { id: "00000000-0000-0000-0000-0000000000aa" };
  STATE.isAdminResult = true;
  STATE.markResult = { ok: true };
  STATE.unmarkResult = { ok: true };
  STATE.markCalls = [];
  STATE.unmarkCalls = [];
  auditEmissions.length = 0;
});

describe("POST /api/admin/for-quants-leads/process — C-0037", () => {
  it("returns 403 when caller is authenticated but not an admin (no lead.process audit)", async () => {
    STATE.isAdminResult = false;
    const { POST } = await import("./route");
    const res = await POST(makeReq({ id: VALID_UUID }));
    expect(res.status).toBe(403);
    // No route-level emission should land — withAdminAuth's
    // admin.access.denied is mocked out via logAuditEventAsUser stub
    // above. This pins the contract that mutation-site emission only
    // happens AFTER the role gate succeeds.
    expect(
      auditEmissions.filter(
        (e) => e.action === "lead.process" || e.action === "lead.unprocess",
      ),
    ).toHaveLength(0);
    expect(STATE.markCalls).toHaveLength(0);
    expect(STATE.unmarkCalls).toHaveLength(0);
  });

  it("returns 400 when id is not a UUID (no audit emission, no helper call)", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/uuid/i);
    expect(auditEmissions).toHaveLength(0);
    expect(STATE.markCalls).toHaveLength(0);
    expect(STATE.unmarkCalls).toHaveLength(0);
  });

  it("returns 200 + emits lead.process audit on the default body (unprocess omitted)", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ id: VALID_UUID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, unprocessed: false });

    // Helper-indirection blind-spot anchor (see route comment T4-C1):
    // the audit grep-coverage test cannot see this emission because the
    // mutation lives in markLeadProcessed. This assertion is the
    // canonical co-located proof that the route emits at the user-intent
    // site.
    expect(auditEmissions).toHaveLength(1);
    expect(auditEmissions[0]).toMatchObject({
      action: "lead.process",
      entity_type: "for_quants_lead",
      entity_id: VALID_UUID,
    });

    expect(STATE.markCalls).toEqual([VALID_UUID]);
    expect(STATE.unmarkCalls).toHaveLength(0);
  });
});
