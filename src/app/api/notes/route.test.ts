import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// audit.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. Pass through
// synchronously so emission is observable + doesn't throw outside a
// request scope under vitest.
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

const PORTFOLIO_ID = "pppppppp-pppp-pppp-pppp-pppppppppppp";

const { TEST_USER, mockFrom, mockRpc, authResult } = vi.hoisted(() => {
  const user = { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" };
  return {
    TEST_USER: user,
    mockFrom: vi.fn(),
    mockRpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    authResult: {
      data: { user: user as { id: string } | null },
      error: null,
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => authResult,
    },
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

function makeGetReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/notes");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: "GET" });
}

function makePatchReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/notes", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authResult.data = { user: TEST_USER };
  });

  it("returns note content for valid portfolio", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: { content: "My notes", updated_at: "2026-04-11T00:00:00Z" },
              error: null,
            }),
          }),
        }),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("My notes");
  });

  it("returns 404 when no note exists", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: { code: "PGRST116" } }),
          }),
        }),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(404);
  });

  it("returns 401 for unauthenticated user", async () => {
    authResult.data = { user: null };

    const { GET } = await import("./route");
    const res = await GET(makeGetReq({ portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authResult.data = { user: TEST_USER };
  });

  it("upserts note content", async () => {
    // Ownership check
    const portfolioCheck = vi.fn().mockResolvedValue({
      data: { id: PORTFOLIO_ID },
      error: null,
    });
    const upsertResult = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({
          data: { updated_at: "2026-04-11T00:00:00Z" },
          error: null,
        }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: portfolioCheck,
              }),
            }),
          }),
        };
      }
      if (table === "user_notes") {
        return { upsert: upsertResult };
      }
      return {};
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchReq({ content: "Updated note", portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated_at).toBeDefined();
  });

  it("rejects content over 100KB", async () => {
    const { PATCH } = await import("./route");
    const bigContent = "x".repeat(101 * 1024);
    const res = await PATCH(makePatchReq({ content: bigContent, portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("100 KB");
  });

  it("returns 403 for foreign portfolio", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "portfolios") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchReq({ content: "test", portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(403);
  });

  it("returns 401 for unauthenticated user", async () => {
    authResult.data = { user: null };

    const { PATCH } = await import("./route");
    const res = await PATCH(makePatchReq({ content: "test", portfolio_id: PORTFOLIO_ID }));

    expect(res.status).toBe(401);
  });
});
