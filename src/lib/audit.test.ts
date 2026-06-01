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

import {
  logAuditEvent,
  logAuditEventAsUser,
  emit,
  capAuditMetadata,
  AUDIT_METADATA_VALUE_MAX_CHARS,
  AUDIT_METADATA_MAX_DEPTH,
  type AuditEvent,
} from "./audit";

const DUMMY_USER = "00000000-0000-0000-0000-000000000001";
const DUMMY_ENTITY = "00000000-0000-0000-0000-0000000000a0";

// B4c: AuditEvent is now a discriminated union (entity_type pinned per action
// arm), so a `Partial<AuditEvent>` spread cannot be statically reconciled to a
// single arm. This is a TEST factory that deliberately builds arbitrary events
// — including intentionally map-violating pairings — to exercise runtime emit
// behaviour, so it casts. Production call sites still get the full
// by-construction action↔entity_type pairing check; this escape hatch is
// test-only.
function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    action: "intro.send",
    entity_type: "contact_request",
    entity_id: DUMMY_ENTITY,
    metadata: { source: "test" },
    ...overrides,
  } as AuditEvent;
}

/**
 * audit-2026-05-07 P701 + P702 superseded the blanket swallow-all contract.
 * The current contract is typed-exception dispatch:
 *   - PostgREST code `42501` (permission_denied) → re-throw (hard error).
 *   - Transient (TypeError: fetch failed, AbortError) → Sentry + log +
 *     swallow.
 *   - Anything else → Sentry + log + re-throw.
 *
 * The new contract is fully covered by
 * `src/__tests__/audit-emit-typed-dispatch.test.ts`. This file keeps the
 * orthogonal invariants that are independent of the throw/no-throw
 * discriminant: happy-path RPC shape, `metadata` defaulting, void return,
 * `after()` scheduling, and non-blocking sync semantics. The old
 * `never-throws` tests (six of them) were removed when the contract
 * changed — see analytics-service `test_audit.py` for the Python mirror
 * of the same reconciliation (commit df3ac48).
 */
describe("logAuditEvent — fire-and-forget contract (orthogonal invariants)", () => {
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

  it("swallows a HARD emit rejection (42501) inside after() so it never surfaces as an unhandled rejection — B4c tier-1 drop-tolerance contract (H-0278/M-1157)", async () => {
    // A 42501 makes emit() classify permission_denied and RE-THROW (verified in
    // audit-emit-typed-dispatch.test.ts). The fire-and-forget tier wraps that
    // throw in `after(() => emit(...).catch(() => {}))`, so the scheduled
    // callback MUST resolve — the re-throw is reported to Sentry/console but is
    // never propagated to the after() scheduler (where it would become an
    // unhandled rejection that pollutes the runtime). This pins the documented
    // drop-tolerance contract. Mutation check: delete the `.catch(() => {})` in
    // logAuditEvent and the scheduled() promise rejects → this test fails.
    const rpc = vi.fn().mockResolvedValue({
      error: { code: "42501", message: "permission denied for table audit_log" },
    });
    const client = { rpc };

    const result = logAuditEvent(
      client as unknown as Parameters<typeof logAuditEvent>[0],
      event({ action: "role.grant", entity_type: "user_app_role" }),
    );
    // Caller observes nothing (void, not awaitable).
    expect(result).toBeUndefined();

    // The scheduled after() callback resolves despite emit() rejecting under it.
    const scheduled = afterSpy.mock.calls.at(-1)?.[0] as () => Promise<void>;
    expect(scheduled).toBeTypeOf("function");
    await expect(Promise.resolve(scheduled())).resolves.toBeUndefined();
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

/**
 * NEW-C10-05 (audit-2026-05-26 security+code-review): capAuditMetadata is now
 * applied centrally inside emit() — unbounded metadata from any route can no
 * longer reach the RPC verbatim, even if the call site doesn't wrap with
 * capAuditMetadata explicitly.
 */
describe("emit — NEW-C10-05: metadata capped centrally before RPC call", () => {
  it("truncates an oversized string in metadata before forwarding to the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc };
    const oversized = "x".repeat(AUDIT_METADATA_VALUE_MAX_CHARS + 100);

    await emit(client as unknown as Parameters<typeof emit>[0], {
      action: "intro.send",
      entity_type: "contact_request",
      entity_id: DUMMY_ENTITY,
      metadata: { big: oversized },
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const sentMetadata = (rpc.mock.calls[0][1] as { p_metadata: Record<string, string> }).p_metadata;
    // The value in the RPC call must be capped, not the original oversized string.
    expect(sentMetadata.big.length).toBeLessThan(oversized.length);
    expect(sentMetadata.big).toMatch(/…\[truncated:\d+\]$/);
  });
});

describe("logAuditEventAsUser — service-role path with caller-supplied user_id (orthogonal invariants)", () => {
  // Task 7.1b — this variant calls `log_audit_event_service` (migration
  // 058) with an explicit user_id. EXECUTE on that RPC is locked to
  // service_role only, so the TS wrapper must pass through the admin
  // client AND the user_id unchanged. The throw/no-throw contract under
  // P701/P702 is exercised in `audit-emit-typed-dispatch.test.ts`; this
  // file keeps only the happy-path wire-shape invariant.
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    afterSpy.mockClear();
  });

  afterEach(() => {
    consoleErrSpy.mockRestore();
  });

  it("invokes log_audit_event_service with the caller-supplied user_id", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const adminClient = { rpc };

    logAuditEventAsUser(
      adminClient as unknown as Parameters<typeof logAuditEventAsUser>[0],
      DUMMY_USER,
      {
        action: "alert.acknowledge",
        entity_type: "alert",
        entity_id: DUMMY_ENTITY,
        metadata: { source: "email" },
      },
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("log_audit_event_service", {
      p_user_id: DUMMY_USER,
      p_action: "alert.acknowledge",
      p_entity_type: "alert",
      p_entity_id: DUMMY_ENTITY,
      p_metadata: { source: "email" },
    });
  });
});

/**
 * Audit-2026-05-07 H-0238 (security c8): unbounded `metadata` strings
 * sourced from request bodies bloat audit_log.metadata JSONB and can
 * reflect attacker payloads through GDPR exports / audit-log CSVs.
 * `capAuditMetadata` clamps every string leaf to a fixed length
 * defensively. These tests pin the contract.
 */
describe("capAuditMetadata — H-0238 length cap on audit_log.metadata", () => {
  it("returns short strings unchanged", () => {
    expect(capAuditMetadata("hello")).toBe("hello");
  });

  it("truncates strings exceeding the cap and appends the original length", () => {
    const long = "a".repeat(AUDIT_METADATA_VALUE_MAX_CHARS + 50);
    const capped = capAuditMetadata(long);
    expect(typeof capped).toBe("string");
    expect((capped as string).length).toBeGreaterThan(
      AUDIT_METADATA_VALUE_MAX_CHARS,
    );
    expect(capped).toMatch(/…\[truncated:\d+\]$/);
    expect(capped).toContain(
      `…[truncated:${AUDIT_METADATA_VALUE_MAX_CHARS + 50}]`,
    );
  });

  it("walks nested objects and clamps string leaves only", () => {
    const long = "x".repeat(AUDIT_METADATA_VALUE_MAX_CHARS + 1);
    const out = capAuditMetadata({
      short: "ok",
      bignum: 42,
      bigbool: true,
      bignull: null,
      huge: long,
      nested: { again: long, n: 7 },
    });
    expect(out.short).toBe("ok");
    expect(out.bignum).toBe(42);
    expect(out.bigbool).toBe(true);
    expect(out.bignull).toBeNull();
    expect((out.huge as string).endsWith(`…[truncated:${long.length}]`)).toBe(
      true,
    );
    expect(
      ((out.nested as Record<string, unknown>).again as string).endsWith(
        `…[truncated:${long.length}]`,
      ),
    ).toBe(true);
    expect((out.nested as Record<string, unknown>).n).toBe(7);
  });

  it("walks arrays and clamps string elements", () => {
    const long = "y".repeat(AUDIT_METADATA_VALUE_MAX_CHARS + 5);
    const out = capAuditMetadata([long, "ok", 1, { huge: long }]);
    expect((out[0] as string).endsWith(`…[truncated:${long.length}]`)).toBe(
      true,
    );
    expect(out[1]).toBe("ok");
    expect(out[2]).toBe(1);
    expect(
      ((out[3] as Record<string, unknown>).huge as string).endsWith(
        `…[truncated:${long.length}]`,
      ),
    ).toBe(true);
  });

  it("does not mutate the caller's object", () => {
    const long = "z".repeat(AUDIT_METADATA_VALUE_MAX_CHARS + 1);
    const input = { huge: long, nested: { huge: long } };
    capAuditMetadata(input);
    expect(input.huge).toBe(long);
    expect(input.nested.huge).toBe(long);
  });

  /**
   * Audit-2026-05-07 red-team R-0005 (MED c8): depth guard. Without it,
   * an attacker-supplied 20k-deep payload through a future caller (e.g.,
   * a debug handler dropping req.body into metadata) crashes the route
   * with `Maximum call stack size exceeded`. The depth guard returns a
   * sentinel object instead so the audit row still lands.
   */
  it("R-0005: deeply nested object truncates at AUDIT_METADATA_MAX_DEPTH with a sentinel", () => {
    // Build a 50-deep nested object.
    type Nested = { next?: Nested; leaf?: string };
    const root: Nested = {};
    let cur: Nested = root;
    for (let i = 0; i < 50; i++) {
      cur.next = {};
      cur = cur.next;
    }
    cur.leaf = "deep-leaf";

    const out = capAuditMetadata(root) as Record<string, unknown>;
    // Walk to depth and assert the sentinel appears at-or-before the
    // configured limit. The function returns the sentinel at depth
    // > AUDIT_METADATA_MAX_DEPTH, so anywhere past that depth we expect
    // `{ __audit_metadata_too_deep: true, depth: <n> }` instead of the
    // user-supplied subtree.
    let walker: unknown = out;
    let depth = 0;
    while (
      walker !== undefined &&
      walker !== null &&
      typeof walker === "object" &&
      !("__audit_metadata_too_deep" in (walker as Record<string, unknown>))
    ) {
      const next = (walker as Record<string, unknown>).next;
      if (next === undefined) break;
      walker = next;
      depth += 1;
      if (depth > 100) break; // safety
    }
    // The sentinel MUST appear at or just past AUDIT_METADATA_MAX_DEPTH.
    expect(walker).toBeTruthy();
    expect(typeof walker).toBe("object");
    expect(
      (walker as Record<string, unknown>).__audit_metadata_too_deep,
    ).toBe(true);
    // No stack overflow — the test reaching this line is the assertion.
    expect(depth).toBeLessThanOrEqual(AUDIT_METADATA_MAX_DEPTH + 1);
  });

  it("R-0005: depth-32 payload (within limit) is preserved unchanged", () => {
    // A legitimate audit payload at the cap depth must NOT be sentinel-
    // replaced. 4 levels (the deepest current real metadata) is well
    // within the 32-level cap.
    const payload = { a: { b: { c: { d: "leaf" } } } };
    const out = capAuditMetadata(payload) as Record<string, unknown>;
    expect(
      (
        ((out.a as Record<string, unknown>).b as Record<string, unknown>)
          .c as Record<string, unknown>
      ).d,
    ).toBe("leaf");
  });

  /**
   * NEW-C10-06 (audit-2026-05-26 red-team): __proto__ key in metadata must
   * not pollute the output object's prototype AND the datum must be preserved
   * (renamed to __sanitized_key___proto__) so the audit row is not silently
   * missing a field the attacker could use for forensic suppression.
   */
  it("NEW-C10-06: __proto__ key is preserved (renamed) and does NOT pollute prototype", () => {
    // Simulates an attacker-supplied JSON object with a __proto__ key.
    // JSON.parse produces a plain object with an own property named __proto__
    // (not a prototype mutation) — capAuditMetadata must handle it safely.
    const input = JSON.parse('{"__proto__":"evil","real":"kept"}') as Record<string, unknown>;
    const out = capAuditMetadata(input) as Record<string, unknown>;

    // The real field must pass through unchanged.
    expect(out.real).toBe("kept");

    // The __proto__ value must NOT be silently erased — it is renamed.
    expect(out.__sanitized_key___proto__).toBe("evil");

    // The output object must NOT have a polluted prototype.
    expect(Object.getPrototypeOf(out)).toBeNull();

    // The output must NOT have an own property literally named __proto__
    // (which would be a prototype reassignment attempt on a normal object).
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(false);
  });

  it("NEW-C10-06: constructor and prototype keys are also sanitized", () => {
    const input = { constructor: "hijack", prototype: "bad", ok: "fine" };
    const out = capAuditMetadata(input) as Record<string, unknown>;
    expect(out.ok).toBe("fine");
    expect(out.__sanitized_key_constructor).toBe("hijack");
    expect(out.__sanitized_key_prototype).toBe("bad");
    expect(Object.getPrototypeOf(out)).toBeNull();
  });
});
