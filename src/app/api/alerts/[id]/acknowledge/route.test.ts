import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/alerts/[id]/acknowledge — the in-app critical-banner
 * ack path (audit-2026-05-07 C-0073).
 *
 * Pins the contract:
 *   - 401 when unauthenticated (no audit fires)
 *   - 404 when the alert exists but is not owned by the caller
 *     (cross-tenant deny — no audit fires)
 *   - 204 on the happy path WITH an alert.acknowledge audit emission
 *     whose metadata.source pins to "in_app_banner" (NOT "in_app_list" —
 *     that label belongs to the sibling PATCH /api/portfolio-alerts path
 *     and a regression that swaps the labels would lose forensic
 *     attribution between the two ack surfaces).
 *   - no audit fires when the update returns an error (500 path).
 */

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. Pass through
// synchronously so emission is observable via STATE.rpcCalls.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

const ALERT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PORTFOLIO_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEST_USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const STATE = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  ownedPortfolios: [] as Array<{ id: string }>,
  alertRow: null as
    | { id: string; acknowledged_at: string | null; alert_type: string }
    | null,
  lookupError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: STATE.authUser },
        error: null,
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from: (table: string) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: async () => ({
              data: STATE.ownedPortfolios,
              error: null,
            }),
          }),
        };
      }
      if (table === "portfolio_alerts") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                maybeSingle: async () => ({
                  data: STATE.alertRow,
                  error: STATE.lookupError,
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              in: async () => ({ error: STATE.updateError }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  }),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

vi.mock("@/lib/analytics/usage-events", () => ({
  trackUsageEventServer: vi.fn(),
}));

function makeReq() {
  return new NextRequest(
    `http://localhost:3000/api/alerts/${ALERT_ID}/acknowledge`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
    },
  );
}

function ctx(id: string = ALERT_ID) {
  return { params: Promise.resolve({ id }) };
}

async function drain() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  STATE.authUser = { id: TEST_USER_ID };
  STATE.ownedPortfolios = [{ id: PORTFOLIO_ID }];
  STATE.alertRow = {
    id: ALERT_ID,
    acknowledged_at: null,
    alert_type: "drawdown_breach",
  };
  STATE.lookupError = null;
  STATE.updateError = null;
  STATE.rpcCalls = [];
});

describe("POST /api/alerts/[id]/acknowledge — audit emission contract (C-0073)", () => {
  it("returns 401 and emits no audit when unauthenticated", async () => {
    STATE.authUser = null;
    const { POST } = await import("./route");
    const res = await POST(makeReq(), ctx());
    expect(res.status).toBe(401);

    await drain();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("returns 404 + no audit when the alert is not owned by the caller (cross-tenant deny)", async () => {
    // The route's `maybeSingle` is scoped to portfolioIds owned by the
    // caller — a foreign alert id resolves to null, NOT a row.
    STATE.alertRow = null;
    const { POST } = await import("./route");
    const res = await POST(makeReq(), ctx());
    expect(res.status).toBe(404);

    await drain();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });

  it("emits alert.acknowledge with metadata.source='in_app_banner' on 204 happy path", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(), ctx());
    expect(res.status).toBe(204);

    await drain();

    const audit = STATE.rpcCalls.find((c) => c.name === "log_audit_event");
    expect(audit).toBeDefined();
    expect(audit!.args).toMatchObject({
      p_action: "alert.acknowledge",
      p_entity_type: "alert",
      p_entity_id: ALERT_ID,
    });
    // metadata.source pins to in_app_banner so this path can be forensically
    // distinguished from the sibling /api/portfolio-alerts PATCH which
    // emits the same action with source='in_app_list'. A regression that
    // swaps the source labels would lose the per-surface attribution.
    expect(audit!.args.p_metadata).toMatchObject({
      source: "in_app_banner",
      alert_type: "drawdown_breach",
    });
  });

  it("does NOT emit the audit event when the UPDATE fails (500 path)", async () => {
    STATE.updateError = { message: "db unavailable" };
    const { POST } = await import("./route");
    const res = await POST(makeReq(), ctx());
    expect(res.status).toBe(500);

    await drain();
    expect(
      STATE.rpcCalls.filter((c) => c.name === "log_audit_event"),
    ).toHaveLength(0);
  });
});
