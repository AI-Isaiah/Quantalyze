import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for src/lib/email.ts — the notification_dispatches audit trail
 * introduced in PR 4 of the hardening sprint. Every public `notify*`
 * helper funnels through the private `send()` primitive, which:
 *
 *   1. Inserts a row into `notification_dispatches` with status='queued'
 *   2. Calls Resend
 *   3. Updates the row to 'sent' (happy path) or 'failed' (any exception)
 *
 * All three steps are best-effort: an audit insert that fails must not
 * block the actual email send, and a Resend failure must not crash the
 * caller — the dispatch row records the outcome regardless.
 *
 * These tests mock both the Supabase admin client chain and the Resend
 * constructor. Because `email.ts` captures `resend` at import time, we
 * set `RESEND_API_KEY` in `beforeEach`, reset modules between tests,
 * and dynamically re-import the module so each case sees a fresh,
 * fully-mocked world.
 */

type DispatchRow = {
  id: string;
  notification_type: string;
  recipient_email: string;
  subject: string | null;
  status: "queued" | "sent" | "failed";
  error: string | null;
  metadata: Record<string, unknown> | null;
  sent_at: string | null;
};

// Hoisted so the vi.mock factory below can reach it.
const state = vi.hoisted(
  (): {
    rows: DispatchRow[];
    insertShouldFail: boolean;
    insertShouldThrow: boolean;
    updateShouldThrow: boolean;
    resendShouldFail: boolean;
    resendError: string;
    sendCalls: Array<{ to: string; subject: string; cc?: unknown }>;
  } => ({
    rows: [],
    insertShouldFail: false,
    insertShouldThrow: false,
    updateShouldThrow: false,
    resendShouldFail: false,
    resendError: "Resend rejected the message",
    sendCalls: [],
  }),
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert(payload: Omit<DispatchRow, "id" | "sent_at" | "error"> & { error?: string | null; sent_at?: string | null }) {
        return {
          select: () => ({
            single: async () => {
              if (state.insertShouldThrow) {
                throw new Error("dispatch insert threw");
              }
              if (state.insertShouldFail) {
                return {
                  data: null,
                  error: { message: "dispatch insert failed" },
                };
              }
              const row: DispatchRow = {
                id: `dispatch-${state.rows.length + 1}`,
                notification_type: payload.notification_type,
                recipient_email: payload.recipient_email,
                subject: payload.subject ?? null,
                status: "queued",
                error: null,
                metadata: payload.metadata ?? null,
                sent_at: null,
              };
              state.rows.push(row);
              return { data: { id: row.id }, error: null };
            },
          }),
        };
      },
      update(patch: Partial<DispatchRow>) {
        return {
          async eq(field: string, value: string) {
            if (state.updateShouldThrow) {
              throw new Error("dispatch update threw");
            }
            if (field !== "id") return { data: null, error: null };
            const row = state.rows.find((r) => r.id === value);
            if (row) Object.assign(row, patch);
            return { data: null, error: null };
          },
        };
      },
    }),
  }),
}));

// Mock the Resend SDK. The constructor returns an object whose
// `emails.send()` reads from the test state so each test can flip the
// failure switch without touching the mock factory itself. Class-based
// rather than vi.fn().mockImplementation so `new Resend(...)` works
// after vi.resetModules() — module re-evaluation re-runs this factory
// but the factory output has to be a real constructor, not a mock fn.
vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: async (payload: { to: string; subject: string; cc?: unknown }) => {
        state.sendCalls.push({ to: payload.to, subject: payload.subject, cc: payload.cc });
        if (state.resendShouldFail) {
          return { data: null, error: { message: state.resendError } };
        }
        return { data: { id: "resend-id" }, error: null };
      },
    };
  },
}));

describe("email.ts — notification_dispatches audit trail", () => {
  beforeEach(() => {
    state.rows = [];
    state.insertShouldFail = false;
    state.insertShouldThrow = false;
    state.updateShouldThrow = false;
    state.resendShouldFail = false;
    state.resendError = "Resend rejected the message";
    state.sendCalls = [];
    // Restore all mocks so spies from previous tests (e.g., console.error
    // from the Resend failure test) don't leak into this test's assertions.
    vi.restoreAllMocks();
    // Set BEFORE importing email.ts so the module-level `resend` const
    // is non-null. Stubs are auto-restored between tests.
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    vi.stubEnv("ADMIN_EMAIL", "founder@example.com");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("happy path: notify* → dispatch row 'queued' → Resend sent → row 'sent' with timestamp", async () => {
    const { notifyManagerIntroRequest } = await import("./email");

    await notifyManagerIntroRequest(
      "manager@example.com",
      "Acme Capital",
      "Long Vol Macro",
    );

    expect(state.rows).toHaveLength(1);
    const row = state.rows[0];
    expect(row.notification_type).toBe("manager_intro_request");
    expect(row.recipient_email).toBe("manager@example.com");
    expect(row.subject).toContain("New introduction request");
    expect(row.status).toBe("sent");
    expect(row.sent_at).toBeTruthy();
    expect(row.error).toBeNull();

    // Resend was called exactly once.
    expect(state.sendCalls).toHaveLength(1);
    expect(state.sendCalls[0].to).toBe("manager@example.com");
  });

  it("writes cc into metadata when the helper passes a cc address", async () => {
    const { notifyAllocatorOfAdminIntro } = await import("./email");

    await notifyAllocatorOfAdminIntro(
      "allocator@example.com",
      {
        display_name: "Jane Manager",
        company: "Macro Capital",
        bio: "20y macro",
        years_trading: 20,
        aum_range: "$50-100M",
        linkedin: null,
      },
      "Long Vol Macro",
      "strategy-uuid",
      "Great fit for your mandate.",
    );

    expect(state.rows).toHaveLength(1);
    const row = state.rows[0];
    expect(row.notification_type).toBe("allocator_admin_intro");
    expect(row.metadata).toEqual({ cc: "founder@example.com" });
    expect(row.status).toBe("sent");
  });

  it("Resend failure: dispatch row marked 'failed' with error message, caller does not throw", async () => {
    state.resendShouldFail = true;
    state.resendError = "Rate limit exceeded";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { notifyManagerApproved } = await import("./email");

    // Must not throw — email failures are swallowed.
    await expect(
      notifyManagerApproved("manager@example.com", "Long Vol Macro", "strategy-uuid"),
    ).resolves.toBeUndefined();

    expect(state.rows).toHaveLength(1);
    const row = state.rows[0];
    expect(row.status).toBe("failed");
    expect(row.error).toBe("Rate limit exceeded");
    expect(row.sent_at).toBeNull();

    expect(errSpy).toHaveBeenCalled();
  });

  it("dispatch insert failure is non-blocking: Resend still called, warning logged", async () => {
    state.insertShouldFail = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { notifyFounderNewStrategy } = await import("./email");

    await notifyFounderNewStrategy("Long Vol Macro", "Jane Manager");

    // No dispatch row was written (insert failed).
    expect(state.rows).toHaveLength(0);
    // But Resend was still called — the audit write is best-effort.
    expect(state.sendCalls).toHaveLength(1);
    // And the warning was logged.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[email] notification_dispatches insert failed"),
      expect.any(String),
    );
  });

  it("dispatch insert throw is non-blocking: Resend still called, warning logged", async () => {
    state.insertShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { notifyFounderIntroRequest } = await import("./email");

    await notifyFounderIntroRequest("Acme Capital", "Long Vol Macro");

    expect(state.rows).toHaveLength(0);
    expect(state.sendCalls).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[email] notification_dispatches insert threw"),
      expect.any(Error),
    );
  });

  it("no Resend key: dispatch row marked 'failed' with 'Resend not configured'", async () => {
    // Override the beforeEach: kill RESEND_API_KEY *before* the module loads.
    vi.stubEnv("RESEND_API_KEY", "");
    vi.resetModules();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { notifyAllocatorIntroStatus } = await import("./email");

    await notifyAllocatorIntroStatus(
      "allocator@example.com",
      "Long Vol Macro",
      "intro_made",
    );

    expect(state.rows).toHaveLength(1);
    const row = state.rows[0];
    expect(row.status).toBe("failed");
    expect(row.error).toBe("Resend not configured");

    // No Resend call was attempted.
    expect(state.sendCalls).toHaveLength(0);

    // The skip warning was logged.
    expect(warnSpy).toHaveBeenCalledWith(
      "[email] Resend not configured — skipping send to",
      "allocator@example.com",
    );
  });

  it("empty recipient short-circuits before any dispatch write or Resend call", async () => {
    const { notifyManagerIntroRequest } = await import("./email");

    await notifyManagerIntroRequest("", "Acme Capital", "Long Vol Macro");

    expect(state.rows).toHaveLength(0);
    expect(state.sendCalls).toHaveLength(0);
  });

  // Regression test for the bug caught in the adversarial review pass of
  // /ship. Prior behavior: if Resend delivered the email successfully but
  // the post-send update to status='sent' threw (network blip), the catch
  // block would mark the row 'failed' — a misleading operator signal for
  // an email that was actually delivered. Fixed by isolating the Resend
  // call in its own try/catch and making the dispatch update best-effort.
  it("post-send update failure does NOT mark a successfully-sent email as failed", async () => {
    state.updateShouldThrow = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { notifyManagerIntroRequest } = await import("./email");

    await notifyManagerIntroRequest(
      "manager@example.com",
      "Acme Capital",
      "Long Vol Macro",
    );

    // Resend was called exactly once — the email went out.
    expect(state.sendCalls).toHaveLength(1);
    expect(state.sendCalls[0].to).toBe("manager@example.com");

    // The dispatch row exists with status='queued' (the 'sent' update
    // threw and was swallowed by markDispatch, so the status was never
    // flipped to 'sent' — but critically, it was NEVER flipped to 'failed'
    // either, because the Resend call itself succeeded).
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].status).toBe("queued");

    // The swallowed update throw produced a warning, not an error. The
    // "Failed to send" error log MUST NOT fire — the send succeeded.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[email] notification_dispatches update threw"),
      expect.any(Error),
    );
    expect(errSpy).not.toHaveBeenCalledWith(
      "[email] Failed to send:",
      expect.anything(),
      expect.anything(),
    );
  });
});

/**
 * resolveManagerName tests — separate describe so we can use a fresh,
 * lightweight mock store without touching the notification_dispatches
 * state. We dynamic-import email.ts here AFTER the module mocks above
 * have been registered, so the `createAdminClient` stub survives.
 */
describe("resolveManagerName — manager fallback ladder", () => {
  const USER_ID = "11111111-0000-0000-0000-000000000001";

  async function runWithProfile(
    profile: Record<string, unknown> | null,
    user: { id: string; email?: string | null },
  ): Promise<string> {
    const { createMockSupabaseClient, createMockStore, seedTable } = await import(
      "./supabase/mock"
    );
    const { resolveManagerName } = await import("./email");
    const store = createMockStore();
    if (profile) {
      seedTable(store, "profiles", [{ id: USER_ID, ...profile }]);
    }
    const client = createMockSupabaseClient(store);
    return resolveManagerName(client, user);
  }

  it("prefers display_name when present", async () => {
    const name = await runWithProfile(
      { display_name: "Alice Quant", company: "Acme Capital" },
      { id: USER_ID, email: "alice@example.com" },
    );
    expect(name).toBe("Alice Quant");
  });

  it("falls back to company when display_name is null", async () => {
    const name = await runWithProfile(
      { display_name: null, company: "Acme Capital" },
      { id: USER_ID, email: "alice@example.com" },
    );
    expect(name).toBe("Acme Capital");
  });

  it("falls back to email when both profile fields are null", async () => {
    const name = await runWithProfile(
      { display_name: null, company: null },
      { id: USER_ID, email: "alice@example.com" },
    );
    expect(name).toBe("alice@example.com");
  });

  it("returns 'Unknown' when profile row is missing and email is null", async () => {
    const name = await runWithProfile(null, { id: USER_ID, email: null });
    expect(name).toBe("Unknown");
  });

  it("returns 'Unknown' when profile row is missing and email is undefined", async () => {
    const name = await runWithProfile(null, { id: USER_ID });
    expect(name).toBe("Unknown");
  });
});
