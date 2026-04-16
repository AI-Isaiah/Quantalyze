import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// audit.ts imports "server-only" which throws under vitest+jsdom.
// Mirrors the pattern in for-quants-leads-admin.test.ts + snapshot.test.ts.
vi.mock("server-only", () => ({}));

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

  it("is detached from the caller's critical path (microtask scheduling)", async () => {
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

    // The caller's next synchronous statement must come BEFORE the
    // RPC fires. If we accidentally made this awaitable/blocking,
    // `after-call` would land after `rpc`.
    expect(callOrder).toEqual(["after-call"]);

    // Drain the microtask queue to prove the RPC eventually fires.
    await Promise.resolve();
    await Promise.resolve();
    expect(callOrder).toEqual(["after-call", "rpc"]);
  });
});
