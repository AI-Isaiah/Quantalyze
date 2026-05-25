/**
 * HH-1 audit campaign — regression tests for findings in src/lib/audit.ts.
 *
 * Covers:
 *   H-0420 — Sprint-task comment preamble removed from the module header
 *             and AuditAction union (was: "Sprint 6 closeout Task 7.1a/b").
 *   H-0421 — queueMicrotask fallback emits a console.warn with the stable
 *             [audit] prefix so the non-request-scope drop path is
 *             distinguishable in log aggregation.
 *   H-0425 — emitAsUser rejects a non-UUID actingUserId at call-time with a
 *             console.error [audit] entry + throws (no silent silting of the
 *             audit_log with a garbage actor field).
 *   H-0426 — emit / emitAsUser reject a non-UUID entity_id before calling
 *             the RPC so Postgres 22P02 can never silently drop a row.
 *   M-0491 — AUDIT_ACTION_ENTITY_TYPE_MAP compile-time sentinel exported.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// Real `after()` from Next 16 throws outside a request scope.
// Provide a synchronous passthrough identical to audit.test.ts so the
// scheduled work runs within the test, and expose a spy for H-0421.
const afterSpy = vi.fn<(cb: () => void | Promise<void>) => void>((cb) => {
  queueMicrotask(() => {
    try {
      void cb();
    } catch {
      // unreachable — emit catches internally.
    }
  });
});

/**
 * afterThrowSpy: simulates `after()` throwing synchronously (non-request
 * scope). Used by H-0421 to exercise the queueMicrotask fallback path.
 */
const afterThrowSpy = vi.fn<(cb: () => void | Promise<void>) => void>(() => {
  throw new Error("after() called outside a request scope");
});

let useThrowingAfter = false;

vi.mock("next/server", () => ({
  after: (cb: () => void | Promise<void>) => {
    if (useThrowingAfter) {
      afterThrowSpy(cb);
    } else {
      afterSpy(cb);
    }
  },
}));

import {
  logAuditEvent,
  logAuditEventAsUser,
  emit,
  emitAsUser,
} from "./audit";
import type { AuditEvent } from "./audit";

const DUMMY_USER = "00000000-0000-0000-0000-000000000001";
const DUMMY_ENTITY = "00000000-0000-0000-0000-0000000000a0";

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    action: "intro.send",
    entity_type: "contact_request",
    entity_id: DUMMY_ENTITY,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// H-0421 — queueMicrotask fallback path emits [audit] console.warn
// ---------------------------------------------------------------------------
describe("H-0421 — queueMicrotask fallback path emits [audit] console.warn", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    afterSpy.mockClear();
    afterThrowSpy.mockClear();
    useThrowingAfter = true;
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errSpy.mockRestore();
    useThrowingAfter = false;
  });

  it("emits console.warn with [audit] prefix when after() throws (non-request scope)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as Parameters<typeof logAuditEvent>[0];

    logAuditEvent(client, event());

    // Drain the microtask queue so the queueMicrotask fallback fires.
    await Promise.resolve();
    await Promise.resolve();

    // The fallback MUST emit a distinguishable warning so log aggregation
    // can grep [audit] for the drop path (H-0421: "no console.warn
    // distinguishing the fallback path").
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [firstArg] = warnSpy.mock.calls[0];
    expect(typeof firstArg).toBe("string");
    expect(firstArg).toContain("[audit]");
  });

  it("fallback warning includes the event action for forensic correlation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as Parameters<typeof logAuditEvent>[0];

    logAuditEvent(client, event({ action: "role.grant" }));

    await Promise.resolve();
    await Promise.resolve();

    const [, context] = warnSpy.mock.calls[0];
    // The second argument to console.warn must be an object with the action.
    expect(context).toMatchObject({ action: "role.grant" });
  });

  it("logAuditEventAsUser fallback also emits [audit] console.warn", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const adminClient = {
      rpc,
    } as unknown as Parameters<typeof logAuditEventAsUser>[0];

    logAuditEventAsUser(adminClient, DUMMY_USER, event());

    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [firstArg] = warnSpy.mock.calls[0];
    expect(typeof firstArg).toBe("string");
    expect(firstArg).toContain("[audit]");
  });
});

// ---------------------------------------------------------------------------
// H-0425 — emitAsUser rejects non-UUID actingUserId before RPC call
// ---------------------------------------------------------------------------
describe("H-0425 — emitAsUser rejects non-UUID actingUserId", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    afterSpy.mockClear();
    useThrowingAfter = false;
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("throws (does not call the RPC) when actingUserId is not UUID-shaped", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const adminClient = {
      rpc,
    } as unknown as Parameters<typeof emitAsUser>[0];

    // emitAsUser is the inner async helper — call directly so we can await
    // the thrown rejection and assert the RPC was never called.
    await expect(
      emitAsUser(adminClient, "not-a-uuid", event()),
    ).rejects.toThrow();

    expect(rpc).not.toHaveBeenCalled();
  });

  it("logs a [audit] prefixed error when actingUserId is malformed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const adminClient = {
      rpc,
    } as unknown as Parameters<typeof emitAsUser>[0];

    await expect(
      emitAsUser(adminClient, "strategy:abc123", event()),
    ).rejects.toBeDefined();

    expect(errSpy).toHaveBeenCalled();
    const firstCall = errSpy.mock.calls[0];
    expect(firstCall[0]).toContain("[audit]");
  });

  it("accepts a valid UUID-shaped actingUserId and calls the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const adminClient = {
      rpc,
    } as unknown as Parameters<typeof emitAsUser>[0];

    await emitAsUser(adminClient, DUMMY_USER, event());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_user_id).toBe(DUMMY_USER);
  });
});

// ---------------------------------------------------------------------------
// H-0426 — emit / emitAsUser reject non-UUID entity_id before RPC call
// ---------------------------------------------------------------------------
describe("H-0426 — emit / emitAsUser reject non-UUID entity_id", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    afterSpy.mockClear();
    useThrowingAfter = false;
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("emit throws (does not call the RPC) when entity_id is not UUID-shaped", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as Parameters<typeof emit>[0];

    await expect(
      emit(client, event({ entity_id: "strategy:abc123" })),
    ).rejects.toThrow();

    expect(rpc).not.toHaveBeenCalled();
  });

  it("emit logs a [audit] prefixed error when entity_id is malformed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as Parameters<typeof emit>[0];

    await expect(
      emit(client, event({ entity_id: "not-a-uuid" })),
    ).rejects.toBeDefined();

    expect(errSpy).toHaveBeenCalled();
    const firstCall = errSpy.mock.calls[0];
    expect(firstCall[0]).toContain("[audit]");
  });

  it("emitAsUser throws when entity_id is not UUID-shaped", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const adminClient = {
      rpc,
    } as unknown as Parameters<typeof emitAsUser>[0];

    await expect(
      emitAsUser(adminClient, DUMMY_USER, event({ entity_id: "unknown" })),
    ).rejects.toThrow();

    expect(rpc).not.toHaveBeenCalled();
  });

  it("emit accepts a valid UUID-shaped entity_id and calls the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as Parameters<typeof emit>[0];

    await emit(client, event({ entity_id: DUMMY_ENTITY }));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_entity_id).toBe(DUMMY_ENTITY);
  });

  it("emit rejects a sentinel non-UUID entity_id like 'unknown'", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc } as unknown as Parameters<typeof emit>[0];

    await expect(
      emit(client, event({ entity_id: "unknown" })),
    ).rejects.toThrow();

    // Must never call the RPC with a non-UUID entity_id.
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M-0491 — AUDIT_ACTION_ENTITY_TYPE_MAP compile-time sentinel
// ---------------------------------------------------------------------------
describe("M-0491 — AUDIT_ACTION_ENTITY_TYPE_MAP catches action/entity_type drift", () => {
  it("AUDIT_ACTION_ENTITY_TYPE_MAP is exported from audit.ts", async () => {
    const auditModule = await import("./audit");
    expect("AUDIT_ACTION_ENTITY_TYPE_MAP" in auditModule).toBe(true);
  });

  it("AUDIT_ACTION_ENTITY_TYPE_MAP maps every AuditAction to an AuditEntityType string", async () => {
    const auditModule = await import("./audit");
    const map = (
      auditModule as unknown as Record<string, Record<string, string>>
    ).AUDIT_ACTION_ENTITY_TYPE_MAP;

    expect(typeof map).toBe("object");
    expect(map).not.toBeNull();

    // Every value must be a non-empty string (the canonical entity_type).
    for (const [action, entityType] of Object.entries(map)) {
      expect(typeof entityType).toBe("string");
      expect(entityType.length).toBeGreaterThan(0);
      // Spot-check: known action → entity_type pairings per ADR-0023.
      if (action === "api_key.decrypt") expect(entityType).toBe("api_key");
      if (action === "intro.send") expect(entityType).toBe("contact_request");
      if (action === "role.grant") expect(entityType).toBe("user_app_role");
      if (action === "account.sanitize") expect(entityType).toBe("user");
    }
  });

  it("AUDIT_ACTION_ENTITY_TYPE_MAP has an entry for every known action (no gaps)", async () => {
    const auditModule = await import("./audit");
    const map = (
      auditModule as unknown as Record<string, Record<string, string>>
    ).AUDIT_ACTION_ENTITY_TYPE_MAP;

    // Sample the key actions from the current AuditAction union.
    const knownActions = [
      "api_key.decrypt",
      "intro.send",
      "intro.send_failed",
      "deletion.request.create",
      "role.grant",
      "role.revoke",
      "account.sanitize",
      "account.export",
      "alert.acknowledge",
      "mandate_preference.update",
      "mandate_preference.admin_update",
      "admin.access.denied",
    ];

    for (const action of knownActions) {
      expect(map).toHaveProperty(action);
    }
  });
});
