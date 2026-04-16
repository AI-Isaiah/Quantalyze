import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// audit.ts imports "server-only" which throws under vitest+jsdom.
// Mirrors the pattern in for-quants-leads-admin.test.ts + snapshot.test.ts.
vi.mock("server-only", () => ({}));

// `after()` (Next 16) schedules a callback after the response flushes.
// In the test environment there is no request scope, so the real
// implementation throws. Replace it with a synchronous passthrough so
// the scheduled work still runs — tests assert the scheduling via the
// `afterSpy` mock below, and assert the work runs via the RPC mock.
const afterSpy = vi.fn<(cb: () => void | Promise<void>) => void>((cb) => {
  // Mirror the real `waitUntil` semantics: defer the callback so it
  // runs AFTER the caller's current sync block, then detach the
  // returned promise. Using `queueMicrotask` here makes the test a
  // faithful proxy for production's "after the response flush" timing.
  queueMicrotask(() => {
    try {
      void cb();
    } catch {
      // unreachable in these tests — emit catches internally.
    }
  });
});
vi.mock("next/server", () => ({
  after: (cb: () => void | Promise<void>) => afterSpy(cb),
}));

import { logAuditEvent, emit, type AuditEvent } from "./audit";

const DUMMY_USER = "00000000-0000-0000-0000-000000000001";
const DUMMY_ENTITY = "00000000-0000-0000-0000-0000000000a0";

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    action: "intro.send",
    entity_type: "contact_request",
    entity_id: DUMMY_ENTITY,
    metadata: { source: "test" },
    ...overrides,
  };
}

describe("logAuditEvent — fire-and-forget contract", () => {
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    afterSpy.mockClear();
  });

  afterEach(() => {
    consoleErrSpy.mockRestore();
  });

  it("returns void synchronously (not a Promise) so callers never await it", () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) };
    const result = logAuditEvent(
      client as unknown as Parameters<typeof logAuditEvent>[0],
      event(),
    );
    expect(result).toBeUndefined();
  });

  it("invokes the RPC with the expected argument shape", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: DUMMY_USER, error: null });
    const client = { rpc };

    logAuditEvent(
      client as unknown as Parameters<typeof logAuditEvent>[0],
      event({
        action: "api_key.decrypt",
        entity_type: "api_key",
        entity_id: DUMMY_ENTITY,
        metadata: { route: "/api/keys/[id]/permissions" },
      }),
    );

    // queueMicrotask drains before the next awaited tick; await a
    // resolved Promise to let it fire.
    await Promise.resolve();
    await Promise.resolve();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("log_audit_event", {
      p_action: "api_key.decrypt",
      p_entity_type: "api_key",
      p_entity_id: DUMMY_ENTITY,
      p_metadata: { route: "/api/keys/[id]/permissions" },
    });
  });

  it("defaults metadata to {} when omitted", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc };

    logAuditEvent(client as unknown as Parameters<typeof logAuditEvent>[0], {
      action: "deletion.request.create",
      entity_type: "data_deletion_request",
      entity_id: DUMMY_ENTITY,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(rpc.mock.calls[0][1].p_metadata).toEqual({});
  });

  it("never throws to the caller when the RPC rejects (Supabase client error)", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("network down"));
    const client = { rpc };

    // logAuditEvent must not throw synchronously.
    expect(() =>
      logAuditEvent(
        client as unknown as Parameters<typeof logAuditEvent>[0],
        event(),
      ),
    ).not.toThrow();

    // And the dropped-error must NOT surface as an unhandled rejection.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleErrSpy).toHaveBeenCalledWith(
      "[audit] log_audit_event call threw (dropping):",
      expect.objectContaining({
        action: "intro.send",
        message: "network down",
      }),
    );
  });

  it("never throws to the caller when the RPC returns an error payload", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });
    const client = { rpc };

    expect(() =>
      logAuditEvent(
        client as unknown as Parameters<typeof logAuditEvent>[0],
        event(),
      ),
    ).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();

    expect(consoleErrSpy).toHaveBeenCalledWith(
      "[audit] log_audit_event RPC returned error (dropping):",
      expect.objectContaining({
        action: "intro.send",
        entity_type: "contact_request",
        entity_id: DUMMY_ENTITY,
        code: "42501",
        message: "permission denied",
      }),
    );
  });

  it("emit() also never throws when the RPC rejects (unit contract)", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("boom"));
    const client = { rpc };

    await expect(
      emit(
        client as unknown as Parameters<typeof emit>[0],
        event(),
      ),
    ).resolves.toBeUndefined();
  });

  it("schedules the RPC via after() so it survives response flush on Vercel", () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc };

    logAuditEvent(
      client as unknown as Parameters<typeof logAuditEvent>[0],
      event(),
    );

    // The right Vercel primitive is `after(cb)` — on the platform it
    // maps to `waitUntil(promise)` so the function instance stays alive
    // until the emission settles, even after the response has flushed
    // to the client. Assert we called it exactly once with a callback.
    expect(afterSpy).toHaveBeenCalledTimes(1);
    expect(afterSpy.mock.calls[0][0]).toBeTypeOf("function");
  });

  it("does not block the caller's synchronous code path", () => {
    const callOrder: string[] = [];
    const rpc = vi.fn().mockImplementation(async () => {
      callOrder.push("rpc");
      return { data: null, error: null };
    });
    const client = { rpc };

    logAuditEvent(
      client as unknown as Parameters<typeof logAuditEvent>[0],
      event(),
    );
    callOrder.push("after-call");

    // `logAuditEvent` returns immediately — the caller's next
    // synchronous statement must come BEFORE the RPC resolves. Under
    // the test-env `after()` passthrough we invoke the callback
    // synchronously, but the RPC body is async so its completion
    // still lands after the caller's sync push.
    expect(callOrder).toEqual(["after-call"]);
  });
});
