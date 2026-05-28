import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * H-0318 — GET /api/strategies/draft (the no-[id] "most recent wizard
 * draft" lookup used by WizardClient's Resume banner).
 *
 * Pre-fix this route had ZERO co-located tests. The handler gates on
 * `.eq('user_id', uid).eq('source','wizard').eq('status','draft')`. If a
 * regression drops either the `source='wizard'` or `status='draft'`
 * filter, the GET would return a pending_review / approved / legacy-draft
 * row to the wizard's Resume banner — causing the wizard to overwrite a
 * published strategy.
 *
 * To make the assertion meaningful (not a tautology), the supabase mock
 * MODELS the DB: it only returns the configured row when BOTH the
 * `source='wizard'` AND `status='draft'` filters were applied AND the
 * row itself satisfies them. A regression that omits a filter, or a row
 * that fails one, resolves to `null` — exactly as Postgres would.
 *
 * The route is wrapped by the REAL withAuth, so `@/lib/supabase/server`
 * is stubbed to return an authenticated user (approval gate is globally
 * no-op'd in src/test-setup.ts).
 */

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const {
  TEST_USER,
  rateLimitResult,
  draftRowState,
  observed,
} = vi.hoisted(() => ({
  TEST_USER: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" },
  rateLimitResult: { success: true as boolean, retryAfter: 0 },
  // The candidate row the DB holds. The mock returns it only if it
  // satisfies the wizard-draft predicate AND the route applied the
  // matching filters.
  draftRowState: {
    row: null as Record<string, unknown> | null,
  },
  observed: {
    table: null as string | null,
    filters: [] as Array<[string, unknown]>,
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_USER }, error: null }),
    },
    from: (table: string) => {
      observed.table = table;
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          observed.filters.push([col, val]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => {
          // Model Postgres: the row comes back only if the route applied
          // BOTH discriminating filters AND the row satisfies them.
          const appliedWizard = observed.filters.some(
            ([c, v]) => c === "source" && v === "wizard",
          );
          const appliedDraft = observed.filters.some(
            ([c, v]) => c === "status" && v === "draft",
          );
          const row = draftRowState.row;
          if (!row) return { data: null, error: null };
          const rowMatches =
            appliedWizard &&
            appliedDraft &&
            row.source === "wizard" &&
            row.status === "draft";
          return { data: rowMatches ? row : null, error: null };
        },
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => rateLimitResult,
  isRateLimitMisconfigured: (rl: { success: boolean; reason?: string }) =>
    rl.success === false && rl.reason === "ratelimit_misconfigured",
}));

function makeReq(): NextRequest {
  return new NextRequest("http://localhost:3000/api/strategies/draft", {
    method: "GET",
    headers: { ...VALID_ORIGIN },
  });
}

const WIZARD_DRAFT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Resume me",
  source: "wizard",
  status: "draft",
};

describe("GET /api/strategies/draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    draftRowState.row = null;
    observed.table = null;
    observed.filters = [];
  });

  it("returns the wizard draft when one exists for the user", async () => {
    draftRowState.row = { ...WIZARD_DRAFT };

    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.draft).toMatchObject({
      id: WIZARD_DRAFT.id,
      source: "wizard",
      status: "draft",
    });

    // The query must be scoped to this user + the wizard-draft predicate.
    expect(observed.table).toBe("strategies");
    expect(observed.filters).toContainEqual(["user_id", TEST_USER.id]);
    expect(observed.filters).toContainEqual(["source", "wizard"]);
    expect(observed.filters).toContainEqual(["status", "draft"]);
  });

  it("returns draft:null when the only row is a legacy (non-wizard) draft", async () => {
    // A manual/imported draft must NOT surface in the wizard Resume
    // banner. The source='wizard' filter is what excludes it.
    draftRowState.row = {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Legacy manual draft",
      source: "manual",
      status: "draft",
    };

    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect((await res.json()).draft).toBeNull();
  });

  it("returns draft:null when the wizard row has been promoted to pending_review", async () => {
    // Once a wizard draft is submitted for review it must never reappear
    // in the Resume banner — resuming would let the wizard overwrite a
    // strategy already in the review pipeline. The status='draft' filter
    // is what excludes it.
    draftRowState.row = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Already submitted",
      source: "wizard",
      status: "pending_review",
    };

    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect((await res.json()).draft).toBeNull();
  });

  it("returns draft:null when no row exists", async () => {
    draftRowState.row = null;

    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect((await res.json()).draft).toBeNull();
  });

  it("returns 429 with Retry-After when rate-limited", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 23;

    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("23");
    const body = await res.json();
    expect(body.draft).toBeNull();
    expect(body.error).toBe("Too many requests");
  });
});
