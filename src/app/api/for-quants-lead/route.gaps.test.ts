import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Gap-coverage tests for POST /api/for-quants-lead.
 *
 * The companion `route.test.ts` covers happy path, validation, CSRF,
 * 429, 503, Sentry coverage, and notify markers. This file pins three
 * branches the original suite did not exercise:
 *
 *   1. G9.B.15 — when the client IP is "unknown" (no x-real-ip /
 *      x-forwarded-for), the rate-limit bucket MUST be scoped by a
 *      user-agent hash. Pre-fix, every no-IP caller shared one bucket
 *      so a single attacker could DoS every other no-IP visitor.
 *   2. G9.B.16 — fieldErrors must surface MULTIPLE issues for one
 *      field (e.g., email both invalid format AND too long). Pre-fix
 *      only the first issue per field was returned; this test pins
 *      that contract end-to-end.
 *   3. G9.B.5 — the `wizard_context` insert column is OMITTED from
 *      the payload when the caller passes null / no value, so the
 *      common landing-page path stays green even on a fresh DB
 *      where migration 031 hasn't applied. Pre-fix the route always
 *      wrote the column.
 *
 * Each gap is its own describe() block so a regression localizes
 * blame without scrolling through unrelated assertions.
 */

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void Promise.resolve().then(() => cb());
    },
  };
});

const dbState = vi.hoisted(
  (): {
    inserted: Array<Record<string, unknown>>;
    updates: Array<{ id: string; payload: Record<string, unknown> }>;
  } => ({ inserted: [], updates: [] }),
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert(payload: Record<string, unknown>) {
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
        return {
          eq: (_col: string, leadId: string) => {
            dbState.updates.push({ id: leadId, payload });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    }),
  }),
}));

vi.mock("@/lib/email", () => ({
  escapeHtml: (s: string) => s,
  notifyFounderGeneric: vi.fn(async () => {
    /* clean send */
  }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: () => {},
  captureMessage: () => {},
}));

/**
 * Capture every identifier the route hands to checkLimit so tests can
 * assert the bucket-key shape (G9.B.15). The original route.test.ts
 * intentionally stubs checkLimit without recording the identifier; this
 * file's mock is purpose-built for asserting it.
 */
const rlState = vi.hoisted(
  (): { identifiers: string[] } => ({ identifiers: [] }),
);

vi.mock("@/lib/ratelimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ratelimit")>(
    "@/lib/ratelimit",
  );
  return {
    ...actual,
    checkLimit: vi.fn(async (_limiter: unknown, identifier: string) => {
      rlState.identifiers.push(identifier);
      return { success: true };
    }),
  };
});

const VALID_PAYLOAD = {
  name: "Jane Doe",
  firm: "Acme Quant",
  email: "jane@acme.example",
};

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

describe("POST /api/for-quants-lead — gap coverage", () => {
  beforeEach(() => {
    dbState.inserted = [];
    dbState.updates = [];
    rlState.identifiers = [];
    process.env.ADMIN_EMAIL = "founder-stub@example.test";
    vi.resetModules();
  });

  describe("rate-limit bucket scoping when IP is unknown (G9.B.15)", () => {
    it("uses `for-quants-lead:unknown:<ua-hash>` as the bucket key when no IP headers are present", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest(VALID_PAYLOAD, {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (FixtureBot/1.0)",
        }),
      );
      expect(res.status).toBe(200);
      expect(rlState.identifiers).toHaveLength(1);
      const key = rlState.identifiers[0];
      // Shape is documented in route.ts:192-195 — UA-hashed suffix
      // when IP is "unknown" so one no-ip attacker can't DoS every
      // other no-ip caller.
      expect(key).toMatch(/^for-quants-lead:unknown:[a-f0-9]+$/);
    });

    it("two different user-agents on missing IP produce different bucket keys", async () => {
      const { POST } = await import("./route");
      await POST(
        makeRequest(VALID_PAYLOAD, {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (FixtureBotA/1.0)",
        }),
      );
      await POST(
        makeRequest(VALID_PAYLOAD, {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (FixtureBotB/2.0)",
        }),
      );
      expect(rlState.identifiers).toHaveLength(2);
      // Different UAs MUST land in different buckets (the load-bearing
      // property of G9.B.15: stripping IP must not equal sharing a
      // bucket with every other no-IP caller).
      expect(rlState.identifiers[0]).not.toBe(rlState.identifiers[1]);
    });

    it("uses `for-quants-lead:<ip>` (no UA suffix) when x-real-ip is set", async () => {
      const { POST } = await import("./route");
      await POST(
        makeRequest(VALID_PAYLOAD, {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-real-ip": "203.0.113.42",
          "user-agent": "Mozilla/5.0 (UA-shouldnt-matter)",
        }),
      );
      expect(rlState.identifiers).toEqual(["for-quants-lead:203.0.113.42"]);
    });
  });

  describe("fieldErrors emits ALL issues per field (G9.B.16)", () => {
    it("returns multiple messages for email when both `email()` and `max(320)` reject", async () => {
      const { POST } = await import("./route");
      // Build a non-email string that's also longer than 320 chars,
      // so Zod's chain raises BOTH issues for `email`. Pre-fix the
      // server stored only the first; the user fixed length, retried,
      // then saw "invalid email" and had to fix-and-retry again.
      const longInvalid = "not-an-email-".repeat(40); // > 320 chars, still invalid format
      expect(longInvalid.length).toBeGreaterThan(320);
      const res = await POST(
        makeRequest({
          name: "Jane",
          firm: "Acme",
          email: longInvalid,
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        fieldErrors: Record<string, string[]>;
      };
      expect(Array.isArray(body.fieldErrors.email)).toBe(true);
      // Both rules should have fired — the post-fix contract is that
      // every Zod issue per field is returned, not just the first.
      expect(body.fieldErrors.email.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("wizard_context insert payload omission (G9.B.5)", () => {
    it("OMITS the wizard_context column from the insert payload when caller passes null", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({ ...VALID_PAYLOAD, wizard_context: null }),
      );
      expect(res.status).toBe(200);
      expect(dbState.inserted).toHaveLength(1);
      // Pre-fix the route always set `wizard_context: parsed.wizard_context`
      // (= null) on the insert. On a fresh DB where migration 031 hadn't
      // applied yet, that 500'd every landing-page lead with `column
      // "wizard_context" does not exist`. Post-fix the key is omitted
      // entirely when wizard_context is null/absent.
      expect("wizard_context" in dbState.inserted[0]).toBe(false);
    });

    it("OMITS wizard_context when the caller does not pass the field at all", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest(VALID_PAYLOAD));
      expect(res.status).toBe(200);
      expect(dbState.inserted).toHaveLength(1);
      expect("wizard_context" in dbState.inserted[0]).toBe(false);
    });

    it("INCLUDES wizard_context when the caller passes a populated object (in-wizard lead)", async () => {
      const { POST } = await import("./route");
      const wizardCtx = {
        draft_strategy_id: null,
        step: "csv_upload" as const,
        wizard_session_id: "sess-abcdef-1234",
      };
      const res = await POST(
        makeRequest({ ...VALID_PAYLOAD, wizard_context: wizardCtx }),
      );
      expect(res.status).toBe(200);
      expect(dbState.inserted[0].wizard_context).toMatchObject(wizardCtx);
    });
  });
});
