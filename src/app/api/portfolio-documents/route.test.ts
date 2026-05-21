import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for /api/portfolio-documents (GET + POST).
 *
 * Closes audit-2026-05-07 finding C-0105: the route shipped without a
 * co-located test, so its four contractually significant paths were
 * never pinned:
 *   1. 401 when unauthenticated (withAuth gate).
 *   2. 404 cross-tenant deny via assertPortfolioOwnership — the only
 *      thing preventing a logged-in user from listing OR writing
 *      documents on another user's portfolio.
 *   3. 400 on invalid `doc_type` — DOC_TYPES is a closed enum
 *      ("contract" | "note" | "factsheet" | "founder_update" | "other");
 *      anything else must be rejected before the insert hits the DB.
 *   4. 200 happy path with valid input — proves the insert payload and
 *      the response envelope `{ document }` stay stable.
 *
 * Regressions on any of these paths would re-open the cross-tenant
 * surface (worst case) or silently break the docs UI (best case).
 */

// audit.ts pulls in "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

// audit.ts schedules the RPC via next/server's `after()`. Pass it
// through synchronously so the mocked supabase rpc surface settles
// before the test assertions run.
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

const PORTFOLIO_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const STRATEGY_ID = "00000000-0000-0000-0000-bbbbbbbbbbbb";
const TEST_USER_ID = "00000000-0000-0000-0000-cccccccccccc";
const DOCUMENT_ID = "00000000-0000-0000-0000-dddddddddddd";

const {
  mockFrom,
  mockGetUser,
  mockGetPublicUrl,
  mockAssertOwnership,
  mockLogAuditEvent,
} = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(),
  mockGetPublicUrl: vi.fn(),
  mockAssertOwnership: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    storage: {
      from: (_bucket: string) => ({
        getPublicUrl: mockGetPublicUrl,
      }),
    },
  }),
}));

vi.mock("@/lib/queries", () => ({
  assertPortfolioOwnership: mockAssertOwnership,
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

function makeGet(url: string) {
  return new NextRequest(url, {
    method: "GET",
    headers: { origin: "http://localhost:3000" },
  });
}

function makePost(body: unknown) {
  return new NextRequest("http://localhost:3000/api/portfolio-documents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Build a relationship_documents chain that captures the insert payload
 * (so 200 happy-path tests can assert the row shape) and returns a
 * single inserted row.
 */
function relationshipDocumentsChain(): {
  chain: unknown;
  insertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn();
  const chain = {
    insert: (payload: Record<string, unknown>) => {
      insertSpy(payload);
      return {
        select: () => ({
          single: async () => ({
            data: { id: DOCUMENT_ID, ...payload },
            error: null,
          }),
        }),
      };
    },
    select: () => ({
      eq: () => ({
        order: async () => ({
          data: [{ id: DOCUMENT_ID, portfolio_id: PORTFOLIO_ID }],
          error: null,
        }),
      }),
    }),
  };
  return { chain, insertSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: TEST_USER_ID } },
    error: null,
  });
  mockAssertOwnership.mockResolvedValue(true);
  mockGetPublicUrl.mockReturnValue({
    data: { publicUrl: "https://example.test/public/file.pdf" },
  });
});

describe("GET /api/portfolio-documents — C-0105 auth + ownership", () => {
  it("returns 401 when the caller is not authenticated (withAuth gate)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const { GET } = await import("./route");
    const res = await GET(
      makeGet(
        `http://localhost:3000/api/portfolio-documents?portfolio_id=${PORTFOLIO_ID}`,
      ),
    );

    expect(res.status).toBe(401);
    // The ownership check must NEVER run on an unauthenticated request
    // — if it does, a future refactor that flips the order would call
    // the DB on every public hit.
    expect(mockAssertOwnership).not.toHaveBeenCalled();
  });

  it("returns 404 cross-tenant when assertPortfolioOwnership rejects (defense against UUID enumeration)", async () => {
    // Caller is authed but does NOT own the requested portfolio.
    // Pre-fix-style regressions that drop this guard would leak every
    // document row for the targeted portfolio.
    mockAssertOwnership.mockResolvedValue(false);

    const { GET } = await import("./route");
    const res = await GET(
      makeGet(
        `http://localhost:3000/api/portfolio-documents?portfolio_id=${PORTFOLIO_ID}`,
      ),
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/portfolio not found/i);
    // No supabase.from('relationship_documents') call should occur
    // when ownership fails — otherwise the deny path still leaks data
    // through error/timing channels.
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("POST /api/portfolio-documents — C-0105 validation + ownership + happy path", () => {
  it("returns 401 when the caller is not authenticated (withAuth gate)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const { POST } = await import("./route");
    const res = await POST(
      makePost({
        portfolio_id: PORTFOLIO_ID,
        title: "Q1 factsheet",
        doc_type: "factsheet",
        file_path: "portfolios/abc/q1.pdf",
      }),
    );

    expect(res.status).toBe(401);
    expect(mockAssertOwnership).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 400 when doc_type is not in DOC_TYPES (closed-enum guard)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makePost({
        portfolio_id: PORTFOLIO_ID,
        title: "Sneaky payload",
        // Not a member of DOC_TYPES = ['contract','note','factsheet','founder_update','other'].
        // A regression that drops this guard would let arbitrary
        // strings reach the DB column and break downstream filters
        // that group by doc_type.
        doc_type: "malicious",
        file_path: "portfolios/abc/file.pdf",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid doc_type/i);
    // The 400 must fire BEFORE the ownership check so we don't
    // probe the portfolios table on garbage input.
    expect(mockAssertOwnership).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 404 cross-tenant deny when assertPortfolioOwnership rejects", async () => {
    mockAssertOwnership.mockResolvedValue(false);

    const { POST } = await import("./route");
    const res = await POST(
      makePost({
        portfolio_id: PORTFOLIO_ID,
        title: "Cross-tenant probe",
        doc_type: "contract",
        file_path: "portfolios/victim/contract.pdf",
      }),
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/portfolio not found/i);
    // No insert + no audit row on a deny — otherwise the attacker
    // gets a writeable surface OR a forensic trail full of bogus
    // entries from the failed cross-tenant probe.
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 200 with { document } on the happy path and persists the audit + storage public URL", async () => {
    const docsChain = relationshipDocumentsChain();
    mockFrom.mockImplementation((table: string) => {
      if (table === "relationship_documents") return docsChain.chain;
      throw new Error(`unexpected from(${table})`);
    });

    const { POST } = await import("./route");
    const res = await POST(
      makePost({
        portfolio_id: PORTFOLIO_ID,
        title: "Q1 factsheet",
        doc_type: "factsheet",
        file_path: "portfolios/me/q1.pdf",
        strategy_id: STRATEGY_ID,
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: { id: string } };
    expect(body.document).toBeDefined();
    expect(body.document.id).toBe(DOCUMENT_ID);

    // Insert payload pins the persistence contract: portfolio_id,
    // strategy_id, title, doc_type, file_path, file_url (resolved
    // from storage), file_name=title, uploaded_by=auth user.
    expect(docsChain.insertSpy).toHaveBeenCalledTimes(1);
    expect(docsChain.insertSpy).toHaveBeenCalledWith({
      portfolio_id: PORTFOLIO_ID,
      strategy_id: STRATEGY_ID,
      title: "Q1 factsheet",
      doc_type: "factsheet",
      file_path: "portfolios/me/q1.pdf",
      file_url: "https://example.test/public/file.pdf",
      file_name: "Q1 factsheet",
      uploaded_by: TEST_USER_ID,
    });

    // Audit row pins the forensic-trail contract:
    // portfolio_document.create with the doc_type/strategy_id/portfolio_id
    // metadata. A regression that drifts the action label would
    // orphan these rows from the audit dashboard's filters.
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const [, event] = mockLogAuditEvent.mock.calls[0] as [
      unknown,
      {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata: Record<string, unknown>;
      },
    ];
    expect(event.action).toBe("portfolio_document.create");
    expect(event.entity_type).toBe("portfolio_document");
    expect(event.entity_id).toBe(DOCUMENT_ID);
    expect(event.metadata).toEqual({
      portfolio_id: PORTFOLIO_ID,
      strategy_id: STRATEGY_ID,
      doc_type: "factsheet",
    });
  });
});
