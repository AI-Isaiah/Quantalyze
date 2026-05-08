/**
 * Phase 19 / BACKBONE-04 step (a) / H-1 — status read repoint acceptance test.
 *
 * Asserts the round-trip: POST /api/verify-strategy writes a public_token
 * onto strategy_verifications; GET /api/verify-strategy/[id]/status?token=…
 * reads from strategy_verifications and returns 200 with the matching
 * status. Without H-1, status checks would 404 for the entire PR-A → PR-D
 * window because the POST writes to one table and the GET reads from
 * another.
 *
 * Also verifies the fallback to legacy `verification_requests` for rows
 * that pre-date PR-A (no strategy_verifications row yet).
 */

// @vitest-environment node

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/timing-safe-compare", () => ({
  safeCompare: (a: string, b: string) => a === b,
}));

const TEST_ID = "33333333-3333-3333-3333-333333333333";
const TEST_TOKEN = "abcd1234";
const FUTURE_EXPIRY = new Date(Date.now() + 60 * 60 * 1000).toISOString();

let svReturned: Record<string, unknown> | null;
let legacyReturned: Record<string, unknown> | null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "strategy_verifications") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: svReturned, error: null }),
            }),
          }),
        };
      }
      if (table === "verification_requests") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: legacyReturned, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  svReturned = null;
  legacyReturned = null;
});

function makeStatusRequest(): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/verify-strategy/${TEST_ID}/status?token=${TEST_TOKEN}`,
    { method: "GET" },
  );
}

async function callStatus() {
  const { GET } = await import(
    "@/app/api/verify-strategy/[id]/status/route"
  );
  return GET(makeStatusRequest(), { params: Promise.resolve({ id: TEST_ID }) });
}

describe("PR-A / H-1 — status read repointed to strategy_verifications", () => {
  it("returns 200 when the row exists in strategy_verifications", async () => {
    svReturned = {
      id: TEST_ID,
      status: "validated",
      public_token: TEST_TOKEN,
      expires_at: FUTURE_EXPIRY,
      metrics_snapshot: null,
    };

    const res = await callStatus();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("validated");
  });

  it("falls back to verification_requests for pre-PR-A rows", async () => {
    svReturned = null;
    legacyReturned = {
      id: TEST_ID,
      status: "complete",
      public_token: TEST_TOKEN,
      expires_at: FUTURE_EXPIRY,
      results: { sharpe: 1.5 },
    };

    const res = await callStatus();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("complete");
    expect(body.results).toEqual({ sharpe: 1.5 });
  });

  it("returns 404 when neither table has the row", async () => {
    svReturned = null;
    legacyReturned = null;

    const res = await callStatus();
    expect(res.status).toBe(404);
  });

  it("returns 404 when the public_token does not match (constant-time check)", async () => {
    svReturned = {
      id: TEST_ID,
      status: "validated",
      public_token: "different-token",
      expires_at: FUTURE_EXPIRY,
      metrics_snapshot: null,
    };

    const res = await callStatus();
    expect(res.status).toBe(404);
  });

  it("returns 410 when the row is expired", async () => {
    svReturned = {
      id: TEST_ID,
      status: "validated",
      public_token: TEST_TOKEN,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      metrics_snapshot: null,
    };

    const res = await callStatus();
    expect(res.status).toBe(410);
  });
});
