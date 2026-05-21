import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for GET /api/account/export/latest — audit-2026-05-07 C-0025
 * closeout.
 *
 * Coverage:
 *   - 401 unauth (no audit emission, no storage list).
 *   - 404 when the user has no prior export (no audit, no signing,
 *     no new job/rate-limit consumption).
 *   - 200 + signed URL when an export exists (audit emitted as
 *     `account.export_resigned`, NOT `account.export`).
 *   - Negative assertion: no rate-limit consumption (checkLimit never
 *     called) and no new export job side-effect (no upload, no bundle
 *     assembly RPC).
 *   - Cache-Control: `private, no-store` on every response.
 */

vi.mock("server-only", () => ({}));

const USER_ID = "00000000-0000-0000-0000-000000000001";

const STATE = vi.hoisted(() => ({
  authUser: null as { id: string; email: string } | null,
  // Storage list mock — array of FileObject-like entries.
  listResult: { data: [], error: null } as {
    data: Array<{ name: string; created_at: string }> | null;
    error: { message: string } | null;
  },
  // What prefix path was passed to .list()
  listPathSeen: null as string | null,
  signedUrlResult: {
    data: { signedUrl: "https://example.com/signed" },
    error: null,
  } as {
    data: { signedUrl: string } | null;
    error: { message: string } | null;
  },
  signedUrlObjectKey: null as string | null,
  uploadCalls: 0,
  // Negative assertion: track whether checkLimit was invoked at all.
  checkLimitCalls: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: STATE.authUser }, error: null }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (_bucket: string) => ({
        list: async (
          path: string,
          _opts: Record<string, unknown>,
        ) => {
          STATE.listPathSeen = path;
          return STATE.listResult;
        },
        createSignedUrl: async (key: string) => {
          STATE.signedUrlObjectKey = key;
          return STATE.signedUrlResult;
        },
        upload: async () => {
          STATE.uploadCalls += 1;
          return { error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  exportLimiter: {
    resetUsedTokens: async () => {},
  },
  checkLimit: async () => {
    STATE.checkLimitCalls += 1;
    return { success: true, retryAfter: 0 };
  },
  getClientIp: (headers: Headers) =>
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown",
}));

const auditEmissions: Array<{
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
}> = [];

vi.mock("@/lib/audit", () => ({
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
}));

import { GET } from "./route";

function buildRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.com/api/account/export/latest", {
    method: "GET",
    headers: {
      origin: "https://example.com",
      ...headers,
    },
  });
}

beforeEach(() => {
  STATE.authUser = { id: USER_ID, email: "alice@test" };
  STATE.listResult = { data: [], error: null };
  STATE.listPathSeen = null;
  STATE.signedUrlResult = {
    data: { signedUrl: "https://example.com/signed" },
    error: null,
  };
  STATE.signedUrlObjectKey = null;
  STATE.uploadCalls = 0;
  STATE.checkLimitCalls = 0;
  auditEmissions.length = 0;
});

describe("GET /api/account/export/latest — audit-2026-05-07 C-0025", () => {
  it("returns 401 when unauthenticated, no audit, no storage list", async () => {
    STATE.authUser = null;
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(auditEmissions).toHaveLength(0);
    // List should NOT have been attempted — auth gates everything.
    expect(STATE.listPathSeen).toBeNull();
  });

  it("returns 404 with code 'no_prior_export' when the user has no prior export", async () => {
    STATE.listResult = { data: [], error: null };
    const res = await GET(buildRequest());
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.code).toBe("no_prior_export");
    expect(body.error).toMatch(/Run \/api\/account\/export first/);
    // No audit emission for an absent bundle.
    expect(auditEmissions).toHaveLength(0);
    // No signing attempt either.
    expect(STATE.signedUrlObjectKey).toBeNull();
  });

  it("returns 200 + signed URL when a prior export exists; emits account.export_resigned audit", async () => {
    STATE.listResult = {
      data: [
        { name: "abc-123.json", created_at: "2026-05-20T12:00:00.000Z" },
      ],
      error: null,
    };
    const res = await GET(
      buildRequest({
        "x-forwarded-for": "203.0.113.7",
        "user-agent": "Mozilla/5.0 test",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.signed_url).toBe("https://example.com/signed");
    expect(body.bundle_created_at).toBe("2026-05-20T12:00:00.000Z");

    // Listed under the caller's prefix (storage RLS foldername[1]=user_id).
    expect(STATE.listPathSeen).toBe(USER_ID);
    // Signed the reconstructed full key.
    expect(STATE.signedUrlObjectKey).toBe(`${USER_ID}/abc-123.json`);

    // Audit emitted as `account.export_resigned` — NOT `account.export`,
    // because no bundle was assembled on this path.
    const resigned = auditEmissions.find(
      (e) => e.action === "account.export_resigned",
    );
    expect(resigned).toBeTruthy();
    expect(resigned?.entity_id).toBe(USER_ID);
    expect(resigned?.metadata.object_key_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(resigned?.metadata.ip).toBe("203.0.113.7");
    expect(resigned?.metadata.user_agent).toBe("Mozilla/5.0 test");
    // Distinct from the fresh-export action.
    expect(
      auditEmissions.find((e) => e.action === "account.export"),
    ).toBeUndefined();
  });

  it("does NOT consume a rate-limit token, does NOT queue a new export job", async () => {
    STATE.listResult = {
      data: [
        { name: "abc-123.json", created_at: "2026-05-20T12:00:00.000Z" },
      ],
      error: null,
    };
    const res = await GET(buildRequest());
    expect(res.status).toBe(200);

    // Pin the C-0025 contract: this route MUST NOT invoke checkLimit
    // (no token consumed) and MUST NOT upload (no new bundle minted).
    expect(STATE.checkLimitCalls).toBe(0);
    expect(STATE.uploadCalls).toBe(0);
  });
});
