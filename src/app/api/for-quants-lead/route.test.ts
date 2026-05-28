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
    /**
     * Production `after()` runs the callback after the response is
     * sent and propagates errors to Vercel error monitoring + Sentry.
     * The route's own try/catch wrappers (route.ts:after callback)
     * are the contract under test — they MUST swallow side-effect
     * failures so the response is never poisoned. Pre-fix, this mock
     * wrapped cb() in its own try/catch, which was redundant AND
     * silenced the route's console.warn so tests couldn't observe
     * whether the inner try/catch ran. G9.B.13 — let exceptions
     * surface here so a regression in the route's resilience is
     * visible to tests instead of being masked by the mock.
     */
    after: (cb: () => void | Promise<void>) => {
      void Promise.resolve().then(() => cb());
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
    /** audit-2026-05-07 G9.B.7 / migration 115 — capture every
     *  notify-marker update the route makes inside its after()
     *  callback so regression tests can pin attempted/succeeded/error
     *  semantics without touching the production admin client. */
    updates: Array<{ id: string; payload: Record<string, unknown> }>;
    /**
     * Inject a Postgres-shaped response error on the next .update().eq()
     * call. supabase-js does NOT throw on Postgres errors (42703 column
     * missing, 42501 RLS denied, etc.) — it returns `{ error }` on the
     * response object. Pre-fix, the route's `try/catch` around marker
     * writes only caught network throws, so DB-level errors slipped
     * through silently. The test extension consumes one queued error
     * per call so the fix can be pinned end-to-end.
     */
    updateResponseErrorQueue: Array<{ message: string }>;
  } => ({
    inserted: [],
    insertShouldFail: false,
    adminClientShouldThrow: false,
    updates: [],
    updateResponseErrorQueue: [],
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
        update(payload: Record<string, unknown>) {
          // audit-2026-05-07 G9.B.7 — return a thenable that resolves
          // on `.eq("id", <leadId>)` so the route's `await admin.from(
          // "for_quants_leads").update({...}).eq("id", leadId)` chain
          // captures the marker write into dbState.updates.
          return {
            eq: (_col: string, leadId: string) => {
              dbState.updates.push({ id: leadId, payload });
              const responseError = dbState.updateResponseErrorQueue.shift();
              if (responseError) {
                return Promise.resolve({ data: null, error: responseError });
              }
              return Promise.resolve({ data: null, error: null });
            },
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
    // PR-2 (2026-05-28): getClientIp now requires VERCEL=1 for x-real-ip
    // to be trusted (defends against header spoofing on self-hosted
    // deploys). The test suite simulates a Vercel-edge request so x-real-ip
    // behavior matches prod.
    process.env.VERCEL = "1";
    dbState.inserted = [];
    dbState.insertShouldFail = false;
    dbState.adminClientShouldThrow = false;
    dbState.updates = [];
    dbState.updateResponseErrorQueue = [];
    // audit-2026-05-07 G9.B.7 (migration 115): the route now
    // short-circuits the founder-notify path when ADMIN_EMAIL is
    // unset, writing notify_error='ADMIN_EMAIL unset' instead of
    // calling notifyFounderGeneric. The local test runner inherits
    // an empty ADMIN_EMAIL by default, so set a stub here to keep
    // every test in this file on the "configured" code path.
    // Tests that specifically need the unset path opt-out by
    // setting process.env.ADMIN_EMAIL = "" inside the it() block.
    process.env.ADMIN_EMAIL = "founder-stub@example.test";
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
    it("validates, inserts, and returns 200 with { ok: true } (no internal id leaked, no idempotency_key until PR-5)", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest(VALID_PAYLOAD));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      // The internal lead UUID must NOT be returned to the client.
      expect(body.id).toBeUndefined();
      // G9.B.17 was scoped to return an opaque idempotency_key here,
      // but the red-team specialist (conf 9/10) flagged that without
      // the server-side UNIQUE constraint that lives in PR-5, the
      // token did the OPPOSITE of what its docblock claimed for the
      // only failure mode where idempotency matters (concurrent
      // retries both insert + both email + both receive same token).
      // The token was dropped from the response; PR-5 will re-add it
      // alongside the UNIQUE (lower(email), date_trunc('day',
      // created_at)) constraint that ACTUALLY enforces dedup.
      expect(body.idempotency_key).toBeUndefined();
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
   * G9.B.3 regression batch — the test docblock at the top of this
   * file claimed "Fire-and-forget side effects — founder email +
   * PostHog do NOT block the response even if they throw" but no
   * test actually exercised the throwing path. These tests close
   * that gap: the lead row MUST still land and the response MUST
   * still be 200 even when the side-effect helpers reject.
   */
  describe("fire-and-forget side-effect resilience (G9.B.3)", () => {
    it("returns 200 + inserts the lead even when notifyFounderGeneric throws", async () => {
      emailState.shouldThrow = true;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const { POST } = await import("./route");
        const res = await POST(makeRequest(VALID_PAYLOAD));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(dbState.inserted).toHaveLength(1);
        await flushMicrotasks();
        // The route's own try/catch wraps notifyFounderGeneric and
        // emits a console.warn with the [for-quants-lead] founder
        // notify failed prefix. Pre-fix this was claimed but never
        // asserted.
        expect(
          warnSpy.mock.calls.some((args) =>
            String(args[0]).includes("founder notify failed"),
          ),
        ).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("returns 200 + 1 row + Sentry capture when notifyFounderGeneric throws (G9.B.3 joined contract)", async () => {
      // Joined contract: a non-blocking failure path must (a) not
      // poison the response, (b) leave evidence in Sentry AND warn
      // logs for ops. Pre-fix this was claimed in the docblock but
      // never tested in one shot.
      emailState.shouldThrow = true;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const { POST } = await import("./route");
        const res = await POST(makeRequest(VALID_PAYLOAD));
        expect(res.status).toBe(200);
        expect(dbState.inserted).toHaveLength(1);
        await flushMicrotasks();
        expect(
          sentryState.captures.some((c) => c.stage === "founder_notify"),
        ).toBe(true);
        expect(
          warnSpy.mock.calls.some((args) =>
            String(args[0]).includes("founder notify failed"),
          ),
        ).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
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

  /**
   * audit-2026-05-07 G9.B.7 (PR-1b extension, migration 115)
   * — notify-attempt markers regression. The founder CRM uses the
   *   predicate `notify_attempted_at IS NOT NULL AND
   *   notify_succeeded_at IS NULL` to surface stuck-pending-notify
   *   rows. These tests pin the route's after() callback writes so a
   *   future refactor that drops a marker (or writes the success
   *   marker before the send) is caught here, not in production.
   */
  describe("notify-attempt markers (G9.B.7 / migration 115)", () => {
    it("clean send → writes notify_attempted_at AND notify_succeeded_at, no notify_error", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest(VALID_PAYLOAD));
      expect(res.status).toBe(200);
      await flushMicrotasks();

      const updatesForLead = dbState.updates.filter(
        (u) => u.id === "lead-1",
      );
      const attempted = updatesForLead.find(
        (u) => "notify_attempted_at" in u.payload,
      );
      const succeeded = updatesForLead.find(
        (u) => "notify_succeeded_at" in u.payload,
      );
      const errored = updatesForLead.find(
        (u) => "notify_error" in u.payload,
      );

      expect(attempted).toBeDefined();
      expect(typeof attempted!.payload.notify_attempted_at).toBe("string");
      expect(succeeded).toBeDefined();
      expect(typeof succeeded!.payload.notify_succeeded_at).toBe("string");
      expect(errored).toBeUndefined();
    });

    it("notifyFounderGeneric throws → writes notify_attempted_at + notify_error, NO notify_succeeded_at", async () => {
      emailState.shouldThrow = true;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const { POST } = await import("./route");
        const res = await POST(makeRequest(VALID_PAYLOAD));
        expect(res.status).toBe(200);
        await flushMicrotasks();

        const updatesForLead = dbState.updates.filter(
          (u) => u.id === "lead-1",
        );
        const attempted = updatesForLead.find(
          (u) => "notify_attempted_at" in u.payload,
        );
        const succeeded = updatesForLead.find(
          (u) => "notify_succeeded_at" in u.payload,
        );
        const errored = updatesForLead.find(
          (u) => "notify_error" in u.payload,
        );

        expect(attempted).toBeDefined();
        expect(succeeded).toBeUndefined(); // pair-with-attempted predicate fires → CRM badge
        expect(errored).toBeDefined();
        expect(errored!.payload.notify_error).toMatch(/simulated email failure/);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("ADMIN_EMAIL unset → writes notify_attempted_at + notify_error='ADMIN_EMAIL unset', NO notify_succeeded_at, helper never invoked", async () => {
      const prev = process.env.ADMIN_EMAIL;
      process.env.ADMIN_EMAIL = "";
      try {
        vi.resetModules();
        const sendsBefore = emailState.sends;
        const { POST } = await import("./route");
        const res = await POST(makeRequest(VALID_PAYLOAD));
        expect(res.status).toBe(200);
        await flushMicrotasks();

        const updatesForLead = dbState.updates.filter(
          (u) => u.id === "lead-1",
        );
        const attempted = updatesForLead.find(
          (u) => "notify_attempted_at" in u.payload,
        );
        const succeeded = updatesForLead.find(
          (u) => "notify_succeeded_at" in u.payload,
        );
        const errored = updatesForLead.find(
          (u) => "notify_error" in u.payload,
        );

        expect(attempted).toBeDefined();
        expect(succeeded).toBeUndefined();
        expect(errored).toBeDefined();
        expect(errored!.payload.notify_error).toBe("ADMIN_EMAIL unset");
        // notifyFounderGeneric MUST NOT be called when ADMIN_EMAIL is
        // unset — the early-return short-circuits the send so the
        // helper's lazy "no admin email" warning doesn't fire either.
        expect(emailState.sends).toBe(sendsBefore);
      } finally {
        if (prev === undefined) {
          delete process.env.ADMIN_EMAIL;
        } else {
          process.env.ADMIN_EMAIL = prev;
        }
      }
    });
  });

  /**
   * audit-2026-05-07 specialist regression — `founderEmailMissingWarned`
   * MUST be a once-per-process flag, not once-per-request. A regression
   * that flipped the guard from `if (!founderEmailMissingWarned)` to
   * always-fire would spam Sentry with thousands of duplicate
   * captures the moment the misconfig hit. Pre-fix the suite only
   * called POST once with ADMIN_EMAIL='' so the load-bearing "second
   * call MUST NOT re-capture" semantic was unverified.
   */
  describe("once-per-process founder_email_unset flag", () => {
    it("captures founder_email_unset exactly once across multiple POSTs on the same warm instance", async () => {
      const prev = process.env.ADMIN_EMAIL;
      process.env.ADMIN_EMAIL = "";
      try {
        // Reset the module so the in-memory `founderEmailMissingWarned`
        // flag starts at false for this test, simulating a cold start.
        vi.resetModules();
        const { POST } = await import("./route");
        await POST(makeRequest(VALID_PAYLOAD));
        await POST(makeRequest(VALID_PAYLOAD));
        await POST(makeRequest(VALID_PAYLOAD));
        await flushMicrotasks();
        const captures = sentryState.captures.filter(
          (c) => c.stage === "founder_email_unset",
        );
        expect(captures).toHaveLength(1);
      } finally {
        if (prev === undefined) {
          delete process.env.ADMIN_EMAIL;
        } else {
          process.env.ADMIN_EMAIL = prev;
        }
      }
    });
  });

  /**
   * audit-2026-05-07 specialist regression — supabase-js returns
   * Postgres errors (42703 column missing, 42501 RLS denied, …) on
   * the response object as `{ error }`, NOT as a thrown exception.
   * Pre-fix the route's `try/catch` around the four marker-write
   * blocks only caught network-level throws, so DB-level errors
   * during the rolling-deploy window (new code, old schema) would
   * slip through silently with NO console.warn. Post-fix the route
   * captures the response error explicitly and warns. This test
   * pins the warn AND the contract that the email send still
   * happens AND the response remains 200.
   */
  describe("marker-write response-error visibility (specialist regression)", () => {
    it("logs a warn AND still sends the founder email AND returns 200 when notify_attempted_at update returns a response error", async () => {
      // Queue ONE response error — only the notify_attempted_at update
      // (the FIRST .update().eq() in after()) sees it. The subsequent
      // notify_succeeded_at update gets a clean response. This pins the
      // load-bearing claim: a marker-write failure must NEVER block the
      // actual email send, and the response must remain 200.
      dbState.updateResponseErrorQueue.push({
        message:
          'column "notify_attempted_at" of relation "for_quants_leads" does not exist',
      });
      const sendsBefore = emailState.sends;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const { POST } = await import("./route");
        const res = await POST(makeRequest(VALID_PAYLOAD));
        expect(res.status).toBe(200);
        await flushMicrotasks();

        // Email send MUST have happened.
        expect(emailState.sends).toBe(sendsBefore + 1);

        // Warn for the failed attempted-marker write MUST have fired.
        const calls = warnSpy.mock.calls.map((args) => args.join(" "));
        const warnedAttempted = calls.some((c) =>
          c.includes("notify_attempted_at marker write failed"),
        );
        expect(warnedAttempted).toBe(true);

        // The success marker MUST still be written (post-error
        // operation continues — single failed marker doesn't unwind
        // subsequent writes).
        const updatesForLead = dbState.updates.filter(
          (u) => u.id === "lead-1",
        );
        const succeeded = updatesForLead.find(
          (u) => "notify_succeeded_at" in u.payload,
        );
        expect(succeeded).toBeDefined();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
