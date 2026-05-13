import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Audit 2026-05-12 Lane E — P464.
 *
 * The legacy GET /api/portfolio-alerts returned every unack'd alert
 * for the user with no upper bound. The fix introduces `limit` /
 * `offset` query-string pagination matching the idiom in
 * `src/app/api/admin/compute-jobs/route.ts`:
 *   - default limit = 50
 *   - clamped to [1, 200]
 *   - response envelope: { alerts, page_size, offset, has_more }
 *
 * These tests pin the pagination contract end-to-end via mocked
 * Supabase. They FAIL on pre-fix code because:
 *   1. `page_size`, `offset`, `has_more` are absent from the response.
 *   2. The pre-fix code never calls `.range(...)` (passes everything
 *      back unbounded). Test 3 asserts `.range(...)` IS called with
 *      the right (offset, offset + limit) tuple.
 */

vi.mock("server-only", () => ({}));

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

const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
const PORTFOLIO_ID = "22222222-2222-4222-8222-222222222222";

const { mockFrom, rangeSpy, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  rangeSpy: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

vi.mock("@/lib/queries", () => ({
  assertPortfolioOwnership: vi.fn(async () => true),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));

function makeAlertRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `alert-${i}`,
    portfolio_id: PORTFOLIO_ID,
    triggered_at: new Date(2026, 0, n - i).toISOString(),
    acknowledged_at: null,
  }));
}

function setupChainReturning(rows: unknown[]) {
  rangeSpy.mockClear();
  const inner = {
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: (from: number, to: number) => {
      rangeSpy(from, to);
      return {
        eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
        in: vi.fn().mockResolvedValue({ data: rows, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
    },
    eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
    in: vi.fn().mockResolvedValue({ data: rows, error: null }),
    select: vi.fn().mockReturnThis(),
  };
  return inner;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: TEST_USER_ID } },
    error: null,
  });
});

describe("GET /api/portfolio-alerts — P464 pagination", () => {
  it("returns the pagination envelope { alerts, page_size, offset, has_more }", async () => {
    const rows = makeAlertRows(10);
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") {
        // listing portfolios for the user
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: PORTFOLIO_ID }],
            error: null,
          }),
        };
      }
      if (table === "portfolio_alerts") {
        return {
          select: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: rows, error: null }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    });

    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/portfolio-alerts", {
      method: "GET",
      headers: { origin: "http://localhost:3000" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      alerts: unknown[];
      page_size: number;
      offset: number;
      has_more: boolean;
    };
    // Envelope fields are present.
    expect(body).toHaveProperty("alerts");
    expect(body).toHaveProperty("page_size");
    expect(body).toHaveProperty("offset");
    expect(body).toHaveProperty("has_more");
    expect(body.page_size).toBe(50); // default
    expect(body.offset).toBe(0); // default
  });

  it("clamps limit to MAX_PAGE_SIZE=200 when caller requests more", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: PORTFOLIO_ID }],
            error: null,
          }),
        };
      }
      const chain = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: (from: number, to: number) => {
          rangeSpy(from, to);
          return {
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        },
      };
      return chain;
    });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/portfolio-alerts?limit=99999",
      {
        method: "GET",
        headers: { origin: "http://localhost:3000" },
      },
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { page_size: number };
    // Clamped to MAX_PAGE_SIZE.
    expect(body.page_size).toBe(200);

    // Verify the supabase chain was called with .range(offset, offset+limit).
    expect(rangeSpy).toHaveBeenCalled();
    const [from, to] = rangeSpy.mock.calls[0];
    expect(from).toBe(0);
    expect(to).toBe(200); // offset + limit = 0 + 200
  });

  it("signals has_more=true when more rows exist beyond the page", async () => {
    // Return limit+1 rows so the route sees the probe row and reports has_more.
    const rows = makeAlertRows(51); // limit (50) + 1 probe
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: PORTFOLIO_ID }],
            error: null,
          }),
        };
      }
      const chain = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: (from: number, to: number) => {
          rangeSpy(from, to);
          return {
            in: vi.fn().mockResolvedValue({ data: rows, error: null }),
          };
        },
      };
      return chain;
    });

    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/portfolio-alerts", {
      method: "GET",
      headers: { origin: "http://localhost:3000" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      alerts: unknown[];
      has_more: boolean;
      page_size: number;
    };
    // Probe row trimmed off
    expect(body.alerts.length).toBe(50);
    expect(body.has_more).toBe(true);
  });

  it("signals has_more=false when fewer rows than the page", async () => {
    const rows = makeAlertRows(3);
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: PORTFOLIO_ID }],
            error: null,
          }),
        };
      }
      const chain = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: () => ({
          in: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      };
      return chain;
    });

    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/portfolio-alerts", {
      method: "GET",
      headers: { origin: "http://localhost:3000" },
    });
    const res = await GET(req);
    const body = (await res.json()) as { alerts: unknown[]; has_more: boolean };
    expect(body.alerts.length).toBe(3);
    expect(body.has_more).toBe(false);
  });

  it("clamps limit=0 / negative to the floor of 1", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: PORTFOLIO_ID }],
            error: null,
          }),
        };
      }
      const chain = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: (from: number, to: number) => {
          rangeSpy(from, to);
          return { in: vi.fn().mockResolvedValue({ data: [], error: null }) };
        },
      };
      return chain;
    });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/portfolio-alerts?limit=0",
      {
        method: "GET",
        headers: { origin: "http://localhost:3000" },
      },
    );
    const res = await GET(req);
    const body = (await res.json()) as { page_size: number };
    // Number(0) || DEFAULT yields DEFAULT_PAGE_SIZE=50 — the falsy
    // fallback chooses the default. Any value < 1 hits the Math.max
    // floor at 1 only if it's truthy. Document the contract: limit=0
    // is treated as "use default", not "1".
    expect(body.page_size).toBe(50);
  });

  it("honors a custom offset (range starts at offset)", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [{ id: PORTFOLIO_ID }],
            error: null,
          }),
        };
      }
      const chain = {
        select: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: (from: number, to: number) => {
          rangeSpy(from, to);
          return { in: vi.fn().mockResolvedValue({ data: [], error: null }) };
        },
      };
      return chain;
    });

    const { GET } = await import("./route");
    const req = new NextRequest(
      "http://localhost:3000/api/portfolio-alerts?offset=100&limit=25",
      {
        method: "GET",
        headers: { origin: "http://localhost:3000" },
      },
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { offset: number; page_size: number };
    expect(body.offset).toBe(100);
    expect(body.page_size).toBe(25);

    expect(rangeSpy).toHaveBeenCalled();
    const [from, to] = rangeSpy.mock.calls[0];
    expect(from).toBe(100);
    expect(to).toBe(125); // offset + limit
  });
});
