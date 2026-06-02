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
  // M-0269: controls the route's existence-disambiguation SELECT in the
  // helper-not_found branch — true ⇒ row exists (already in target state),
  // false ⇒ row genuinely missing.
  leadExists: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: STATE.authUser }, error: null }),
    },
    // withAdminAuth uses this user-scoped client for auth.getUser(). The
    // route's audit now rides the service path (logAuditEventAsUser on the
    // admin client); the minimal rpc stub stays as a safety net.
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
  // M-0269: the route disambiguates a helper not_found via this existence
  // check (kept in the for_quants_leads service-role chokepoint).
  leadExists: async () => STATE.leadExists,
}));

const auditEmissions: Array<{
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
}> = [];

// B4b: the acting-admin id passed to the service-path emit
// (logAuditEventAsUser). A revert to the user-JWT logAuditEvent wrapper leaves
// this empty, so the happy-path assertion below fails loudly.
const auditServiceActors: string[] = [];

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>(
    "@/lib/audit",
  );
  return {
    ...actual,
    // B4b: the route reverted to logAuditEventAsUser (service path). Stub
    // logAuditEvent as a no-op so a regression that reverts the emit back to
    // the user-JWT wrapper drops the lead.process row and fails the
    // happy-path length assertion loudly.
    logAuditEvent: () => {},
    // The route emission (lead.process / lead.unprocess) AND withAdminAuth's
    // admin.access.denied both ride this service-path wrapper. Capture the
    // event into auditEmissions (the 403 test filters to the route's own
    // actions) and the acting-admin id into auditServiceActors.
    logAuditEventAsUser: (
      _admin: unknown,
      actingUserId: string,
      event: {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata?: Record<string, unknown>;
      },
    ) => {
      auditServiceActors.push(actingUserId);
      auditEmissions.push({
        action: event.action,
        entity_type: event.entity_type,
        entity_id: event.entity_id,
        metadata: event.metadata ?? {},
      });
    },
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
  STATE.leadExists = true;
  auditEmissions.length = 0;
  auditServiceActors.length = 0;
});

describe("POST /api/admin/for-quants-leads/process — C-0037", () => {
  it("returns 403 when caller is authenticated but not an admin (no lead.process audit)", async () => {
    STATE.isAdminResult = false;
    const { POST } = await import("./route");
    const res = await POST(makeReq({ id: VALID_UUID }));
    expect(res.status).toBe(403);
    // No route-level emission should land. withAdminAuth's admin.access.denied
    // DOES ride logAuditEventAsUser (captured into auditEmissions), so we
    // filter to the route's own actions to pin the contract that mutation-site
    // emission only happens AFTER the role gate succeeds.
    expect(
      auditEmissions.filter(
        (e) => e.action === "lead.process" || e.action === "lead.unprocess",
      ),
    ).toHaveLength(0);
    expect(STATE.markCalls).toHaveLength(0);
    expect(STATE.unmarkCalls).toHaveLength(0);
  });

  it("returns 400 when id is not a UUID (validated in withAdminAuth before the limiter, no helper call)", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    // B15b: the uuid check now lives in the route's Zod schema, which
    // withAdminAuth runs BEFORE consuming a rate-limit token. The wrapper
    // returns `{ error: "Invalid request body", issues: [...] }`; the issues
    // array names the uuid failure. A regression that drops the schema would
    // let markLeadProcessed run on a bad id (STATE.markCalls below), so this
    // still fails loudly if the validation is removed.
    const body = await res.json();
    expect(JSON.stringify(body.issues ?? body)).toMatch(/uuid/i);
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
    // B4b: the emit rides the service path with the explicit acting-admin id
    // (JWT-immune). A revert to the user-JWT logAuditEvent wrapper leaves
    // auditServiceActors empty and fails here.
    expect(auditServiceActors).toEqual([STATE.authUser!.id]);

    expect(STATE.markCalls).toEqual([VALID_UUID]);
    expect(STATE.unmarkCalls).toHaveLength(0);
  });

  // M-0269: the conditional UPDATE returns 0 rows == "not_found" for BOTH a
  // missing row and a row already in the target state. The route disambiguates
  // with an existence SELECT so a retried/double-submitted POST that already
  // succeeded gets an idempotent 200, not a spurious admin-facing error.
  it("M-0269 — helper not_found + row exists (already in target state) → 200 idempotent no-op", async () => {
    STATE.markResult = { ok: false, reason: "not_found" };
    STATE.leadExists = true;
    const { POST } = await import("./route");
    const res = await POST(makeReq({ id: VALID_UUID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, noop: true });
  });

  it("M-0269 — helper not_found + row missing (genuinely absent) → 404", async () => {
    STATE.markResult = { ok: false, reason: "not_found" };
    STATE.leadExists = false;
    const { POST } = await import("./route");
    const res = await POST(makeReq({ id: VALID_UUID }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Lead not found");
  });
});
