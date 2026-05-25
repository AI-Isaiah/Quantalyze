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
    it("uses `for-quants-lead:unknown:<ua-hash>` as the per-UA bucket key AND a `_aggregate` cap when no IP headers are present", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest(VALID_PAYLOAD, {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (FixtureBot/1.0)",
        }),
      );
      expect(res.status).toBe(200);
      // Two checkLimit calls when IP is unknown: per-UA AND aggregate.
      // Per-UA fairness alone leaves the route open to a UA-rotating
      // botnet; the aggregate cap is the red-team-specialist regression.
      expect(rlState.identifiers).toHaveLength(2);
      expect(rlState.identifiers[0]).toMatch(
        /^for-quants-lead:unknown:[a-f0-9]+$/,
      );
      expect(rlState.identifiers[1]).toBe(
        "for-quants-lead:unknown:_aggregate",
      );
    });

    it("two different user-agents on missing IP produce different per-UA bucket keys (BOTH share the aggregate cap)", async () => {
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
      // Each request emits TWO checkLimit calls: per-UA + aggregate.
      // Order: [reqA-perUA, reqA-aggregate, reqB-perUA, reqB-aggregate].
      expect(rlState.identifiers).toHaveLength(4);
      // Different UAs MUST land in different per-UA buckets (the
      // load-bearing property of G9.B.15: stripping IP must not equal
      // sharing a bucket with every other no-IP caller).
      expect(rlState.identifiers[0]).not.toBe(rlState.identifiers[2]);
      // Both requests MUST share the same aggregate cap key (the
      // red-team property: rotating UAs cannot bypass the global
      // unknown-IP ceiling).
      expect(rlState.identifiers[1]).toBe(
        "for-quants-lead:unknown:_aggregate",
      );
      expect(rlState.identifiers[3]).toBe(
        "for-quants-lead:unknown:_aggregate",
      );
    });

    it("uses `for-quants-lead:<ip>` (no UA suffix, no aggregate cap) when x-real-ip is set", async () => {
      const { POST } = await import("./route");
      await POST(
        makeRequest(VALID_PAYLOAD, {
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "x-real-ip": "203.0.113.42",
          "user-agent": "Mozilla/5.0 (UA-shouldnt-matter)",
        }),
      );
      // Known-IP path: ONE checkLimit call. Aggregate cap is scoped
      // to the unknown-IP family because real visitors with IPs are
      // already scoped per-IP and don't need a second ceiling.
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

  /**
   * M-0315 — wizard_context schema negative cases.
   *
   * WIZARD_CONTEXT_SCHEMA whitelists the wizard step enum, bounds
   * wizard_session_id to length 8..64, and requires draft_strategy_id to
   * be a UUID. The existing suites cover the happy path (populated
   * object) and the null/omitted omission contract, but NOT the negative
   * cases. Without these, a schema regression (e.g. loosening the enum to
   * z.string(), or dropping the length/uuid bounds) would silently admit
   * arbitrary values into the founder triage queue.
   *
   * The route flattens Zod issues to `field -> message[]` keyed on the
   * dotted issue path, so a wizard_context.step issue surfaces under the
   * "wizard_context.step" field key. We assert the 400 + the keyed field
   * AND that the bad row never reached the insert (the queue stays clean).
   */
  describe("wizard_context schema rejects invalid values (M-0315)", () => {
    it("step='unknown_step' → 400 with a wizard_context.step field error and no insert", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({
          ...VALID_PAYLOAD,
          wizard_context: {
            step: "unknown_step",
            wizard_session_id: "sess-abcdef-1234",
          },
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        fieldErrors: Record<string, string[]>;
      };
      expect(body.fieldErrors["wizard_context.step"]).toBeDefined();
      expect(body.fieldErrors["wizard_context.step"].length).toBeGreaterThanOrEqual(
        1,
      );
      // A rejected step value must never land in the triage queue.
      expect(dbState.inserted).toHaveLength(0);
    });

    it("wizard_session_id length 7 (below min 8) → 400 and no insert", async () => {
      const { POST } = await import("./route");
      const shortId = "1234567"; // 7 chars, below min(8)
      expect(shortId.length).toBe(7);
      const res = await POST(
        makeRequest({
          ...VALID_PAYLOAD,
          wizard_context: {
            step: "csv_upload",
            wizard_session_id: shortId,
          },
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        fieldErrors: Record<string, string[]>;
      };
      expect(
        body.fieldErrors["wizard_context.wizard_session_id"],
      ).toBeDefined();
      expect(dbState.inserted).toHaveLength(0);
    });

    it("wizard_session_id length 65 (above max 64) → 400 and no insert", async () => {
      const { POST } = await import("./route");
      const longId = "x".repeat(65); // 65 chars, above max(64)
      expect(longId.length).toBe(65);
      const res = await POST(
        makeRequest({
          ...VALID_PAYLOAD,
          wizard_context: {
            step: "csv_upload",
            wizard_session_id: longId,
          },
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        fieldErrors: Record<string, string[]>;
      };
      expect(
        body.fieldErrors["wizard_context.wizard_session_id"],
      ).toBeDefined();
      expect(dbState.inserted).toHaveLength(0);
    });

    it("draft_strategy_id that is not a UUID → 400 and no insert", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({
          ...VALID_PAYLOAD,
          wizard_context: {
            draft_strategy_id: "not-a-uuid",
            step: "csv_upload",
            wizard_session_id: "sess-abcdef-1234",
          },
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        fieldErrors: Record<string, string[]>;
      };
      expect(
        body.fieldErrors["wizard_context.draft_strategy_id"],
      ).toBeDefined();
      expect(dbState.inserted).toHaveLength(0);
    });
  });

  /**
   * Red-team specialist regression — same-person retries with different
   * casing must canonicalize to the same DB row form so PR-5's future
   * UNIQUE (lower(email), date_trunc('day', created_at)) constraint
   * dedupes correctly. The lowercase transform happens at the Zod
   * schema layer so all downstream consumers (DB row, future PR-5
   * UNIQUE, eventual idempotency token re-introduction) see the same
   * canonical form.
   *
   * The original idempotency_key contract was REVERTED in this PR after
   * the red-team flagged that without server-side UNIQUE the token did
   * the OPPOSITE of what its docblock claimed (concurrent retries got
   * the same token but BOTH inserted + BOTH emailed the founder). The
   * lowercase fix stays because PR-5 needs it.
   */
  describe("email canonicalization (red-team regression)", () => {
    it("inserts the lowercase email regardless of caller casing", async () => {
      const { POST } = await import("./route");
      const res = await POST(
        makeRequest({
          ...VALID_PAYLOAD,
          email: "Jane.DOE@Acme.Example",
        }),
      );
      expect(res.status).toBe(200);
      expect(dbState.inserted).toHaveLength(1);
      // Row email MUST be lowercase — matches the future PR-5 UNIQUE
      // constraint shape `lower(email)`.
      expect(dbState.inserted[0].email).toBe("jane.doe@acme.example");
    });

    it("two retries with different email casing both store the canonical lowercase form", async () => {
      const { POST } = await import("./route");
      await POST(
        makeRequest({ ...VALID_PAYLOAD, email: "JANE@ACME.EXAMPLE" }),
      );
      await POST(
        makeRequest({ ...VALID_PAYLOAD, email: "jane@acme.example" }),
      );
      // Both DB rows store the canonical lowercase form so PR-5's
      // future UNIQUE (lower(email), date_trunc('day', created_at))
      // constraint will collapse them to one row server-side. Until
      // PR-5 lands, we still get two rows here — that's accepted.
      expect(dbState.inserted).toHaveLength(2);
      expect(dbState.inserted[0].email).toBe("jane@acme.example");
      expect(dbState.inserted[1].email).toBe("jane@acme.example");
    });
  });
});
