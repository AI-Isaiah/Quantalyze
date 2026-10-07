/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * WR-01 / SFH F1 (DOMAINONE review round 1, founder decision D-17): a founder
 * email that was SKIPPED (no Resend client, or no PLATFORM_EMAIL sender) must
 * be recorded as NOT sent. Pre-fix `notifyFounderGeneric` returned normally on
 * both skips, so the route stamped `notify_succeeded_at` and the CRM's "stuck
 * pending notify" predicate (attempted IS NOT NULL AND succeeded IS NULL)
 * never fired, for a security report as much as for a sales lead.
 *
 * Unlike route.test.ts, this file does NOT mock `@/lib/email`: the skip is a
 * property of the real `send()` primitive, and a mocked helper could not tell
 * us whether the route reads it. Resend is genuinely unconfigured here.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

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
    from: (table: string) => ({
      insert(payload: Record<string, unknown>) {
        if (table === "for_quants_leads") dbState.inserted.push(payload);
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
          eq: (_col: string, id: string) => {
            if (table === "for_quants_leads") {
              dbState.updates.push({ id, payload });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    }),
  }),
}));

const resendState = vi.hoisted(
  (): { sent: number } => ({ sent: 0 }),
);

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: async () => {
        resendState.sent += 1;
        return { data: { id: "resend-id" }, error: null };
      },
    };
  },
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

vi.mock("@/lib/ratelimit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ratelimit")>(
    "@/lib/ratelimit",
  );
  return { ...actual, checkLimit: vi.fn(async () => ({ success: true })) };
});

const SKIP_REASON =
  "Founder email not sent: Resend or PLATFORM_EMAIL not configured";

const REQUEST_CALL = {
  name: "Jane Doe",
  firm: "Acme Quant",
  email: "jane@acme.example",
  preferred_time: "Tue morning PT",
  notes: "Running a market-neutral book.",
};

const CONTACT_FORM = {
  source: "contact_form",
  name: "Sam Researcher",
  email: "sam@lab.example",
  topic: "security",
  message: "I found something in the share-link flow.",
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/for-quants-lead", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function markersFor(id: string) {
  const forLead = dbState.updates.filter((u) => u.id === id);
  return {
    succeeded: forLead.find((u) => "notify_succeeded_at" in u.payload),
    errored: forLead.find((u) => "notify_error" in u.payload),
  };
}

/** Distinct lead rows per test: each POST gets its own id via the insert count. */
describe("POST /api/for-quants-lead — a skipped founder email is recorded as NOT sent (WR-01)", () => {
  beforeEach(() => {
    process.env.VERCEL = "1";
    dbState.inserted = [];
    dbState.updates = [];
    resendState.sent = 0;
    sentryState.captures = [];
    vi.stubEnv("ADMIN_EMAIL", "founder-stub@example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe.each([
    ["request_call", REQUEST_CALL],
    ["contact_form", CONTACT_FORM],
  ])("%s with no Resend client", (_source, payload) => {
    beforeEach(() => {
      vi.stubEnv("RESEND_API_KEY", "");
      vi.stubEnv("PLATFORM_EMAIL", "sender@example.com");
    });

    it("writes notify_error, never notify_succeeded_at, and the client still sees stored", async () => {
      const { POST } = await import("./route");
      const res = await POST(makeRequest(payload));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, status: "stored" });
      await flush();

      const { succeeded, errored } = markersFor("lead-1");
      expect(succeeded).toBeUndefined();
      expect(errored?.payload.notify_error).toBe(SKIP_REASON);
    });
  });

  it("no PLATFORM_EMAIL sender (Resend IS configured) is recorded the same way", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("PLATFORM_EMAIL", "");
    const { POST } = await import("./route");
    const res = await POST(makeRequest(CONTACT_FORM));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "stored" });
    await flush();

    const { succeeded, errored } = markersFor("lead-1");
    expect(succeeded).toBeUndefined();
    expect(errored?.payload.notify_error).toBe(SKIP_REASON);
    expect(resendState.sent).toBe(0);
  });

  it("reports the skip to Sentry once per process, never once per lead", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("PLATFORM_EMAIL", "sender@example.com");
    const { POST } = await import("./route");
    await POST(makeRequest(CONTACT_FORM));
    await POST(makeRequest({ ...CONTACT_FORM, email: "other@lab.example" }));
    await flush();

    // Both leads are marked, so the CRM sees both ...
    expect(markersFor("lead-1").errored?.payload.notify_error).toBe(SKIP_REASON);
    expect(markersFor("lead-2").errored?.payload.notify_error).toBe(SKIP_REASON);
    // ... but Sentry hears about the misconfiguration once.
    const skips = sentryState.captures.filter(
      (c) => c.stage === "founder_notify_skipped",
    );
    expect(skips).toHaveLength(1);
    // A skip is not a per-lead exception.
    expect(
      sentryState.captures.filter((c) => c.stage === "founder_notify"),
    ).toHaveLength(0);
  });

  it("a configured send still writes notify_succeeded_at and no notify_error", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("PLATFORM_EMAIL", "sender@example.com");
    const { POST } = await import("./route");
    const res = await POST(makeRequest(CONTACT_FORM));
    expect(res.status).toBe(200);
    await flush();

    const { succeeded, errored } = markersFor("lead-1");
    expect(resendState.sent).toBe(1);
    expect(typeof succeeded?.payload.notify_succeeded_at).toBe("string");
    expect(errored).toBeUndefined();
    expect(sentryState.captures).toHaveLength(0);
  });
});
