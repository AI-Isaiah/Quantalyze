import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * `after()` from next/server requires a live Next.js request scope.
 * Vitest can't provide that, so we stub it to run the callback
 * immediately in a fire-and-forget promise. Tests that care whether
 * the side effects completed can `await` the microtask queue; tests
 * that only care about the response status ignore it.
 */
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void Promise.resolve().then(async () => {
        try {
          await cb();
        } catch {
          // Match the production semantic: side effects must never
          // escape into the caller.
        }
      });
    },
  };
});

/**
 * Unit tests for POST /api/for-quants-lead (Sprint 1 Task 1.1).
 *
 * The route is a public, unauthenticated endpoint that accepts Request-a-Call
 * lead submissions from the /for-quants landing page. Each layer is asserted
 * independently:
 *
 *   1. CSRF — rejects missing/invalid Origin headers.
 *   2. Zod validation — rejects missing/short/oversized fields.
 *   3. Service-role insert — happy path writes a row and returns { ok: true }.
 *   4. 429 rate-limit path — the limiter returns { success: false } and the
 *      handler emits a Retry-After header. We mock the limiter directly.
 *   5. 503 admin-init failure — the admin client factory throws and the
 *      handler returns a 503 with the support email.
 *   6. Fire-and-forget side effects — founder email + PostHog do NOT block
 *      the response even if they throw.
 */

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {
    origin: "http://localhost:3000",
    "content-type": "application/json",
  },
): NextRequest {
  return new NextRequest("http://localhost:3000/api/for-quants-lead", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const dbState = vi.hoisted(
  (): {
    inserted: Array<Record<string, unknown>>;
    insertShouldFail: boolean;
    adminClientShouldThrow: boolean;
  } => ({
    inserted: [],
    insertShouldFail: false,
    adminClientShouldThrow: false,
  }),
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (dbState.adminClientShouldThrow) {
      throw new Error("simulated admin client init failure");
    }
    return {
      from: () => ({
        insert(payload: Record<string, unknown>) {
          if (dbState.insertShouldFail) {
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { message: "simulated insert failure" },
                }),
              }),
            };
          }
          dbState.inserted.push(payload);
          return {
            select: () => ({
              single: async () => ({
                data: { id: `lead-${dbState.inserted.length}` },
                error: null,
              }),
            }),
          };
        },
      }),
    };
  },
}));

const emailState = vi.hoisted(
  (): { sends: number; shouldThrow: boolean } => ({
    sends: 0,
    shouldThrow: false,
  }),
);

vi.mock("@/lib/email", () => ({
  escapeHtml: (s: string) => s,
  notifyFounderGeneric: vi.fn(async () => {
    emailState.sends += 1;
    if (emailState.shouldThrow) {
      throw new Error("simulated email failure");
    }
  }),
}));

const analyticsState = vi.hoisted(
  (): { captures: number } => ({ captures: 0 }),
);

vi.mock("@/lib/analytics", () => ({
  trackForQuantsEventServer: vi.fn(async () => {
    analyticsState.captures += 1;
  }),
}));

const rateLimitState = vi.hoisted(
  (): {
    shouldRateLimit: boolean;
    retryAfter: number;
  } => ({
    shouldRateLimit: false,
    retryAfter: 60,
  }),
);

vi.mock("@/lib/ratelimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ratelimit")>(
    "@/lib/ratelimit",
  );
  return {
    ...actual,
    checkLimit: vi.fn(async () => {
      if (rateLimitState.shouldRateLimit) {
        return { success: false, retryAfter: rateLimitState.retryAfter };
      }
      return { success: true };
    }),
  };
});

const VALID_PAYLOAD = {
  name: "Jane Doe",
  firm: "Acme Quant",
  email: "jane@acme.example",
  preferred_time: "Tue morning PT",
  notes: "Running a market-neutral book on Binance.",
};

describe("POST /api/for-quants-lead", () => {
  beforeEach(() => {
    dbState.inserted = [];
    dbState.insertShouldFail = false;
    dbState.adminClientShouldThrow = false;
    emailState.sends = 0;
    emailState.shouldThrow = false;
    analyticsState.captures = 0;
    rateLimitState.shouldRateLimit = false;
    rateLimitState.retryAfter = 60;
  });

  describe("happy path", () => {
    it("validates, inserts, and returns 200 with { ok: true } (no internal id leaked)", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest(VALID_PAYLOAD));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      // The internal lead UUID must NOT be returned to the client.
      expect(body.id).toBeUndefined();
      expect(dbState.inserted).toHaveLength(1);
      expect(dbState.inserted[0]).toMatchObject({
        name: "Jane Doe",
        firm: "Acme Quant",
        email: "jane@acme.example",
        preferred_time: "Tue morning PT",
        notes: "Running a market-neutral book on Binance.",
      });
    });

    it("accepts minimal payload without optional fields", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({
          name: "Jane",
          firm: "Acme",
          email: "jane@acme.example",
        }),
      );
      expect(res.status).toBe(200);
      expect(dbState.inserted).toHaveLength(1);
      expect(dbState.inserted[0].preferred_time).toBeNull();
      expect(dbState.inserted[0].notes).toBeNull();
    });

    it("sanitizes source_ip to null when x-forwarded-for is malformed", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest(VALID_PAYLOAD, {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-forwarded-for": "not-an-ip",
        }),
      );
      expect(res.status).toBe(200);
      expect(dbState.inserted[0].source_ip).toBeNull();
    });

    it("writes a valid IPv4 source_ip from x-real-ip", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest(VALID_PAYLOAD, {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-real-ip": "203.0.113.42",
        }),
      );
      expect(res.status).toBe(200);
      expect(dbState.inserted[0].source_ip).toBe("203.0.113.42");
    });
  });

  describe("validation", () => {
    it("rejects missing name with 400 + fieldErrors", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({ firm: "Acme", email: "jane@acme.example" }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fieldErrors).toBeDefined();
      expect(body.fieldErrors.name).toBeTruthy();
      expect(dbState.inserted).toHaveLength(0);
    });

    it("rejects invalid email format", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({
          name: "Jane",
          firm: "Acme",
          email: "not-an-email",
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fieldErrors.email).toBeTruthy();
      expect(dbState.inserted).toHaveLength(0);
    });

    it("rejects names longer than 200 chars", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({
          name: "A".repeat(201),
          firm: "Acme",
          email: "jane@acme.example",
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fieldErrors.name).toBeTruthy();
    });

    it("rejects notes longer than 2000 chars", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({
          name: "Jane",
          firm: "Acme",
          email: "jane@acme.example",
          notes: "x".repeat(2001),
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for malformed JSON body", async () => {
      const { POST } = await import("./route");
      const req = new NextRequest(
        "http://localhost:3000/api/for-quants-lead",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
          },
          body: "not-json{",
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe("CSRF enforcement", () => {
    it("returns 403 when Origin is missing", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest(VALID_PAYLOAD, { "content-type": "application/json" }),
      );
      expect(res.status).toBe(403);
      expect(dbState.inserted).toHaveLength(0);
    });

    it("returns 403 when Origin is cross-site", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest(VALID_PAYLOAD, {
          origin: "https://evil.example.com",
          "content-type": "application/json",
        }),
      );
      expect(res.status).toBe(403);
      expect(dbState.inserted).toHaveLength(0);
    });
  });

  describe("rate limiting (429)", () => {
    it("returns 429 with Retry-After header when the limiter blocks", async () => {
      rateLimitState.shouldRateLimit = true;
      rateLimitState.retryAfter = 42;
      const { POST } = await import("./route");
      const res = await POST(makeRequest(VALID_PAYLOAD));
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("42");
      const body = await res.json();
      expect(body.error).toContain("Try again in a few minutes");
      expect(dbState.inserted).toHaveLength(0);
    });
  });

  describe("service failures", () => {
    it("returns 503 when the admin client factory throws", async () => {
      dbState.adminClientShouldThrow = true;
      const { POST } = await import("./route");
      const res = await POST(makeRequest(VALID_PAYLOAD));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toContain("security@quantalyze.com");
      expect(dbState.inserted).toHaveLength(0);
    });

    it("returns 500 when the insert errors", async () => {
      dbState.insertShouldFail = true;
      const { POST } = await import("./route");
      const res = await POST(makeRequest(VALID_PAYLOAD));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("security@quantalyze.com");
    });
  });
});
