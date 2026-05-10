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

const sentryState = vi.hoisted(
  (): { captures: Array<{ stage: string; message?: string }> } => ({
    captures: [],
  }),
);

vi.mock("@sentry/nextjs", () => ({
  captureException: (_err: unknown, ctx: { tags: { stage: string } }) => {
    sentryState.captures.push({ stage: ctx.tags.stage });
  },
  captureMessage: (
    message: string,
    ctx: { tags: { stage: string }; level: string },
  ) => {
    sentryState.captures.push({ stage: ctx.tags.stage, message });
  },
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
    sentryState.captures = [];
  });

  /**
   * Helper: drain the microtask queue so fire-and-forget after()
   * callbacks (founder notify + dynamic-imported Sentry capture) have
   * a chance to run before the assertion checks them. Two awaits cover
   * the chained promise (after → import('@sentry/nextjs').then(...)).
   */
  async function flushMicrotasks(): Promise<void> {
    // The chain is: after() → cb-wrapped promise → captureFailure →
    // import('@sentry/nextjs').then(captureException). Each `then`
    // costs one microtask hop; mocked imports add a queueMicrotask
    // step too. Four awaits is comfortably more than enough but
    // cheap — vitest finishes a single test in <100ms either way.
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  describe("happy path", () => {
    it("validates, inserts, and returns 200 with { ok: true } (no internal id leaked)", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest(VALID_PAYLOAD));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      // The internal lead UUID must NOT be returned to the client.
      expect(body.id).toBeUndefined();
      // G9.B.17: opaque idempotency token returned so retries dedupe.
      expect(typeof body.idempotency_key).toBe("string");
      expect(body.idempotency_key).toMatch(/^[a-f0-9]{32}$/);
      expect(dbState.inserted).toHaveLength(1);
      expect(dbState.inserted[0]).toMatchObject({
        name: "Jane Doe",
        firm: "Acme Quant",
        email: "jane@acme.example",
        preferred_time: "Tue morning PT",
        notes: "Running a market-neutral book on Binance.",
      });
    });

    /**
     * G9.B.17 — same email submitted twice the same day must produce
     * the same idempotency_key so a client can dedupe a flaky network
     * retry. Different email or different day yields a different key.
     */
    it("returns the same idempotency_key for the same email on the same day (G9.B.17)", async () => {
      const { POST } = await import("./route");
      const res1 = await POST(makeRequest(VALID_PAYLOAD));
      const res2 = await POST(makeRequest(VALID_PAYLOAD));
      const body1 = await res1.json();
      const body2 = await res2.json();
      expect(body1.idempotency_key).toBe(body2.idempotency_key);

      const res3 = await POST(
        makeRequest({ ...VALID_PAYLOAD, email: "other@acme.example" }),
      );
      const body3 = await res3.json();
      expect(body3.idempotency_key).not.toBe(body1.idempotency_key);
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
      // G9.B.16: fieldErrors is an array per field.
      expect(Array.isArray(body.fieldErrors.name)).toBe(true);
      expect(body.fieldErrors.name.length).toBeGreaterThan(0);
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
      expect(body.fieldErrors.email[0]).toBeTruthy();
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
      expect(body.fieldErrors.name[0]).toBeTruthy();
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

    /**
     * G9.B.4 regression — the `wizard_context.step` enum used to only
     * include the API-branch keys (connect_key, sync_preview, metadata,
     * submit). CSV-branch leads (csv_upload, csv_preview, csv_submit)
     * were silently 400'd by Zod. The enum is now sourced from
     * WIZARD_STEP_KEYS which `satisfies readonly WizardStepKey[]` so any
     * future drift fails at typecheck. This test fires every CSV-branch
     * key through the full POST handler to lock the contract end-to-end.
     */
    it("accepts CSV-branch wizard_context.step values (G9.B.4)", async () => {
      const { POST } = await import("./route");
      for (const step of ["csv_upload", "csv_preview", "csv_submit"]) {
        const res = await POST(
          makeRequest({
            ...VALID_PAYLOAD,
            wizard_context: {
              draft_strategy_id: null,
              step,
              wizard_session_id: "sess-1234",
            },
          }),
        );
        expect(res.status, `step=${step}`).toBe(200);
      }
      expect(dbState.inserted).toHaveLength(3);
      expect(dbState.inserted[0].wizard_context).toMatchObject({
        step: "csv_upload",
      });
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

    /**
     * G9.B.12 — body size limit. Pre-fix, `await req.json()` ran
     * before the Zod field caps, so an attacker could send a 100MB
     * body and burn Lambda memory before Zod ever rejected it. Now
     * the route reads raw text and rejects > 8KB with 413 before any
     * JSON.parse allocation happens.
     */
    it("rejects bodies larger than 8KB with 413 (G9.B.12)", async () => {
      const { POST } = await import("./route");
      const big = JSON.stringify({
        name: "Jane",
        firm: "Acme",
        email: "jane@acme.example",
        notes: "x".repeat(9000),
      });
      const req = new NextRequest(
        "http://localhost:3000/api/for-quants-lead",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
          },
          body: big,
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toMatch(/too large/i);
      expect(dbState.inserted).toHaveLength(0);
    });

    it("rejects bodies whose Content-Length declares > 8KB with 413 (G9.B.12)", async () => {
      const { POST } = await import("./route");
      const req = new NextRequest(
        "http://localhost:3000/api/for-quants-lead",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
            "content-length": "1048576",
          },
          body: JSON.stringify(VALID_PAYLOAD),
        },
      );
      const res = await POST(req);
      expect(res.status).toBe(413);
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

  /**
   * G9.B.6 regression — every failure path must reach Sentry, not
   * just console. Pre-fix the route logged via console.error/warn
   * only and Vercel runtime logs are not alerted on.
   */
  describe("Sentry coverage (G9.B.6)", () => {
    it("captures admin_init failures in Sentry", async () => {
      dbState.adminClientShouldThrow = true;
      const { POST } = await import("./route");
      await POST(makeRequest(VALID_PAYLOAD));
      await flushMicrotasks();
      expect(sentryState.captures.some((c) => c.stage === "admin_init")).toBe(
        true,
      );
    });

    it("captures db_insert failures in Sentry", async () => {
      dbState.insertShouldFail = true;
      const { POST } = await import("./route");
      await POST(makeRequest(VALID_PAYLOAD));
      await flushMicrotasks();
      expect(sentryState.captures.some((c) => c.stage === "db_insert")).toBe(
        true,
      );
    });

    it("captures founder_notify failures in Sentry", async () => {
      emailState.shouldThrow = true;
      const { POST } = await import("./route");
      const res = await POST(makeRequest(VALID_PAYLOAD));
      expect(res.status).toBe(200);
      await flushMicrotasks();
      expect(
        sentryState.captures.some((c) => c.stage === "founder_notify"),
      ).toBe(true);
    });
  });

  /**
   * G9.B.7 regression — notifyFounderGeneric silently returns early
   * when ADMIN_EMAIL is unset. Pre-fix: every lead landed in the DB
   * but the founder was never notified and there was no Sentry
   * breadcrumb. Post-fix: the route detects the misconfig itself and
   * surfaces it via Sentry once per process while still returning 200.
   */
  describe("missing ADMIN_EMAIL warning (G9.B.7)", () => {
    it("captures founder_email_unset in Sentry when ADMIN_EMAIL is empty + still returns 200", async () => {
      const prev = process.env.ADMIN_EMAIL;
      process.env.ADMIN_EMAIL = "";
      try {
        // Reset the module so the once-per-process flag in route.ts
        // doesn't leak between tests. Next.js route files can't export
        // a test-only reset helper, so vi.resetModules + a fresh import
        // is the supported workaround.
        vi.resetModules();
        const { POST } = await import("./route");
        const res = await POST(makeRequest(VALID_PAYLOAD));
        expect(res.status).toBe(200);
        await flushMicrotasks();
        expect(
          sentryState.captures.some(
            (c) => c.stage === "founder_email_unset",
          ),
        ).toBe(true);
      } finally {
        if (prev === undefined) {
          delete process.env.ADMIN_EMAIL;
        } else {
          process.env.ADMIN_EMAIL = prev;
        }
      }
    });
  });
});
