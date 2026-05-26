/**
 * P701 / P702 — typed-dispatch contract test for `emit()` and
 * `emitAsUser()` in `src/lib/audit.ts`.
 *
 * Mirrors the structure of Lane C's Python `test_audit_emit.py`. Pre-fix
 * behavior: every error was blanket-swallowed and only logged via
 * `console.error`. Post-fix:
 *
 *   - PostgREST `42501` (permission_denied) → Sentry capture (tagged
 *     `audit_permission_denied=true`) + RE-THROW.
 *   - `TypeError: fetch failed` / `AbortError` → Sentry capture (tagged
 *     `audit_emit_transient=true`) + counter bump + SWALLOW.
 *   - Anything else → Sentry capture (no special tag) + RE-THROW.
 *
 * Each case asserts both the Sentry payload AND the throw/no-throw
 * discriminant — so a regression that re-introduces the blanket swallow
 * fails loudly. The Sentry SDK is mocked because audit.ts uses a lazy
 * `import("@sentry/nextjs")` (matching the codebase convention from
 * `src/app/api/for-quants-lead/route.ts`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) =>
    captureExceptionMock(...(args as Parameters<typeof captureExceptionMock>)),
}));

// `next/server` `after()` is unused by direct `emit()` calls but the
// module imports it at top level. Stub through.
vi.mock("next/server", async (orig) => {
  const real = await orig<typeof import("next/server")>();
  return {
    ...real,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

import {
  emit,
  emitAsUser,
  classifyAuditEmitError,
  getAuditEmitTransientFailures,
  __resetAuditEmitTransientFailuresForTests,
} from "@/lib/audit";

type AuditEventFixture = Parameters<typeof emit>[1];

const fixture: AuditEventFixture = {
  action: "role.grant",
  entity_type: "user_app_role",
  entity_id: "00000000-0000-0000-0000-000000000001",
  metadata: { test: true },
};

/**
 * Wait for the lazy `import("@sentry/nextjs").then(...)` microtask
 * chain to settle. The reportToSentry helper fires Sentry asynchronously
 * to avoid blocking emit's own throw/no-throw decision. Use vi.waitFor
 * so we don't depend on the exact number of microtask ticks.
 */
async function waitForSentry(expected = 1): Promise<void> {
  await vi.waitFor(
    () => expect(captureExceptionMock).toHaveBeenCalledTimes(expected),
    { timeout: 1000, interval: 5 },
  );
}

describe("audit.emit — typed dispatch (P701)", () => {
  beforeEach(() => {
    captureExceptionMock.mockReset();
    __resetAuditEmitTransientFailuresForTests();
  });

  it("permission_denied (42501): captures with audit_permission_denied tag AND re-throws", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied for table audit_log" },
      }),
    } as never;

    await expect(emit(client, fixture)).rejects.toThrow(/permission denied/i);
    await waitForSentry(1);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = captureExceptionMock.mock.calls[0];
    expect(opts).toMatchObject({
      tags: expect.objectContaining({
        audit_permission_denied: "true",
        audit_path: "log_audit_event",
      }),
      level: "fatal",
    });
  });

  it("transient (TypeError: fetch failed): captures with audit_emit_transient tag, bumps counter, does NOT re-throw", async () => {
    const client = {
      rpc: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    } as never;

    await expect(emit(client, fixture)).resolves.toBeUndefined();
    await waitForSentry(1);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = captureExceptionMock.mock.calls[0];
    expect(opts).toMatchObject({
      tags: expect.objectContaining({
        audit_emit_transient: "true",
        audit_path: "log_audit_event",
      }),
      level: "error",
    });
    expect(getAuditEmitTransientFailures()).toBe(1);
  });

  it("transient (AbortError): captures + swallows + bumps counter", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    const client = {
      rpc: vi.fn().mockRejectedValue(aborted),
    } as never;

    await expect(emit(client, fixture)).resolves.toBeUndefined();
    await waitForSentry(1);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(getAuditEmitTransientFailures()).toBe(1);
  });

  it("unknown PostgREST error (500 schema drift): captures + re-throws", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "PGRST200",
          message: "Could not find a relationship between ...",
        },
      }),
    } as never;

    await expect(emit(client, fixture)).rejects.toThrow();
    await waitForSentry(1);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = captureExceptionMock.mock.calls[0];
    expect(opts?.tags).not.toHaveProperty("audit_permission_denied");
    expect(opts?.tags).not.toHaveProperty("audit_emit_transient");
    expect(opts).toMatchObject({
      tags: expect.objectContaining({ audit_path: "log_audit_event" }),
    });
    expect(getAuditEmitTransientFailures()).toBe(0);
  });

  it("happy path: no Sentry call, no throw, no counter bump", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as never;

    await expect(emit(client, fixture)).resolves.toBeUndefined();
    // No Sentry call is expected — give the lazy import a few ticks to
    // confirm nothing fires (negative-assertion safety).
    await new Promise((r) => setTimeout(r, 20));

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(getAuditEmitTransientFailures()).toBe(0);
  });

  it("Sentry SDK transport failure does NOT mask the original audit error", async () => {
    captureExceptionMock.mockImplementation(() => {
      throw new Error("Sentry transport failed");
    });
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied" },
      }),
    } as never;

    // The original 42501 must still propagate; Sentry's own throw is swallowed.
    await expect(emit(client, fixture)).rejects.toThrow(/permission denied/i);
  });
});

describe("audit.emitAsUser — typed dispatch (P702)", () => {
  beforeEach(() => {
    captureExceptionMock.mockReset();
    __resetAuditEmitTransientFailuresForTests();
  });

  const actingUserId = "00000000-0000-0000-0000-000000000002";

  it("permission_denied (42501): captures + re-throws with service-role tag", async () => {
    const adminClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied for function log_audit_event_service" },
      }),
    } as never;

    await expect(emitAsUser(adminClient, actingUserId, fixture)).rejects.toThrow(
      /permission denied/i,
    );
    await waitForSentry(1);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = captureExceptionMock.mock.calls[0];
    expect(opts).toMatchObject({
      tags: expect.objectContaining({
        audit_permission_denied: "true",
        audit_path: "log_audit_event_service",
      }),
    });
    // Sanity: the eventContext extra carries user_id so the operator sees
    // attribution context in Sentry.
    expect(opts?.extra).toMatchObject({ user_id: actingUserId });
  });

  it("transient: bumps counter + swallows + tags service-role path", async () => {
    const adminClient = {
      rpc: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    } as never;

    await expect(
      emitAsUser(adminClient, actingUserId, fixture),
    ).resolves.toBeUndefined();
    await waitForSentry(1);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = captureExceptionMock.mock.calls[0];
    expect(opts?.tags).toMatchObject({
      audit_emit_transient: "true",
      audit_path: "log_audit_event_service",
    });
    expect(getAuditEmitTransientFailures()).toBe(1);
  });

  it("unknown failure: captures + re-throws", async () => {
    const adminClient = {
      rpc: vi.fn().mockRejectedValue(new Error("totally unexpected")),
    } as never;

    await expect(
      emitAsUser(adminClient, actingUserId, fixture),
    ).rejects.toThrow(/totally unexpected/);
    await waitForSentry(1);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});

describe("audit.emitAsUser — CRITICAL-1: unauthenticated (28000) branch", () => {
  // CRITICAL-1 / F-01 (specialist-review 2026-05-26): `emitAsUser` had no
  // `unauthenticated` dispatch branch. A 28000 from `log_audit_event_service`
  // fell through to `unknown` and re-threw with a GENERIC fatal tag — wrong
  // dispatch contract. The fix adds an explicit branch that re-throws with a
  // DISTINCT `audit_service_unexpected_28000` tag and does NOT tag
  // `audit_permission_denied=true` (reserved for 42501 grant-drift).
  //
  // Service-role does NOT use auth.uid() so 28000 here is unexpected (unlike
  // the user path where it is a routine JWT-expiry). We still re-throw (fail
  // loud) but with the right tag so ops can distinguish it from grant-drift.
  beforeEach(() => {
    captureExceptionMock.mockReset();
    __resetAuditEmitTransientFailuresForTests();
  });

  const actingUserId = "00000000-0000-0000-0000-000000000002";

  it("CRITICAL-1: 28000 on service-role path re-throws with audit_service_unexpected_28000 tag, NOT audit_permission_denied", async () => {
    const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const adminClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "28000",
          message: "invalid_authorization_specification",
        },
      }),
    } as never;

    // MUST re-throw — service-role 28000 is unexpected, not a routine JWT-expiry.
    await expect(
      emitAsUser(adminClient, actingUserId, fixture),
    ).rejects.toThrow();

    await waitForSentry(1);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = captureExceptionMock.mock.calls[0];
    // Must carry the service-path distinct tag.
    expect(opts).toMatchObject({
      tags: expect.objectContaining({
        audit_service_unexpected_28000: "true",
        audit_path: "log_audit_event_service",
      }),
      level: "error",
    });
    // Must NOT carry the grant-drift tag — that is reserved for 42501.
    expect(opts.tags).not.toHaveProperty("audit_permission_denied");
    // Must NOT carry the user-path unauthenticated tag.
    expect(opts.tags).not.toHaveProperty("audit_emit_unauthenticated");

    consoleErrSpy.mockRestore();
  });

  it("CRITICAL-1: 42501 on service-role path still re-throws with audit_permission_denied (not changed)", async () => {
    const consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const adminClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied" },
      }),
    } as never;

    await expect(
      emitAsUser(adminClient, actingUserId, fixture),
    ).rejects.toThrow();
    await waitForSentry(1);

    const [, opts] = captureExceptionMock.mock.calls[0];
    expect(opts).toMatchObject({
      tags: expect.objectContaining({ audit_permission_denied: "true" }),
      level: "fatal",
    });
    expect(opts.tags).not.toHaveProperty("audit_service_unexpected_28000");

    consoleErrSpy.mockRestore();
  });
});

describe("classifyAuditEmitError — H-3 red-team: 28000 on thrown path", () => {
  // H-3 (red-team 2026-05-26): the original NEW-C10-04 fix only checked
  // `rpcError.code === "28000"` (PostgREST error object path). When the
  // Supabase client propagates 28000 as a THROWN exception (connection-level
  // auth failure before PostgREST returns a JSON body), `rpcError` is null
  // and the thrown Error carries `.code === "28000"`. Without this second
  // branch the thrown-path 28000 falls through to `unknown` → re-throw as
  // a fatal event, defeating the noise-reduction goal.
  beforeEach(() => {
    captureExceptionMock.mockReset();
    __resetAuditEmitTransientFailuresForTests();
  });

  it("H-3: 28000 as a THROWN exception (rpcError=null) is classified as unauthenticated, not unknown", () => {
    const thrownErr = Object.assign(
      new Error("invalid_authorization_specification"),
      { code: "28000" },
    );
    const result = classifyAuditEmitError(thrownErr, null);
    expect(result).toBe("unauthenticated");
    expect(result).not.toBe("unknown");
    expect(result).not.toBe("permission_denied");
  });

  it("H-3: 28000 thrown path → emit() swallows (non-fatal), tags audit_emit_unauthenticated", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Simulate the Supabase client rejecting at the fetch level with a 28000
    // error (connection-level auth failure rather than a PostgREST JSON error body).
    const thrownErr = Object.assign(
      new Error("invalid_authorization_specification"),
      { code: "28000" },
    );
    const client = {
      rpc: vi.fn().mockRejectedValue(thrownErr),
    } as never;

    // Must NOT throw — 28000 on thrown path must be swallowed like the rpcError path.
    await expect(emit(client, fixture)).resolves.toBeUndefined();
    await waitForSentry(1);

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = captureExceptionMock.mock.calls[0];
    expect(opts).toMatchObject({
      tags: expect.objectContaining({
        audit_emit_unauthenticated: "true",
        audit_path: "log_audit_event",
      }),
      level: "warning",
    });
    expect(opts.tags).not.toHaveProperty("audit_permission_denied");

    consoleWarnSpy.mockRestore();
  });

  it("H-3: a generic thrown Error (no .code) still falls through to unknown (regression guard)", () => {
    // Ensure the new thrown-path check does not widen classification for
    // errors that happen to be instanceof Error but carry no .code — they
    // must still land in "unknown" so fail-loud is preserved.
    const genericErr = new Error("unexpected schema drift");
    const result = classifyAuditEmitError(genericErr, null);
    expect(result).toBe("unknown");
  });

  it("H-3: a thrown Error with code=42501 (not 28000) is still classified correctly", () => {
    // Belt-and-suspenders: an Error thrown with .code=42501 must stay
    // permission_denied even on the thrown path (rpcError=null).
    // Note: classifyAuditEmitError checks rpcError first; when rpcError is
    // null the 42501 thrown case falls to unknown (the permission_denied
    // check requires rpcError). This test pins that boundary explicitly.
    const thrownErr = Object.assign(new Error("permission denied"), { code: "42501" });
    // rpcError is null — only the thrown path is active here.
    // The existing code checks rpcError?.code === "42501" so without rpcError
    // this lands in unknown. Pin the actual behavior so a future change that
    // broadens the 42501 catch to the thrown path is explicit.
    const result = classifyAuditEmitError(thrownErr, null);
    expect(result).toBe("unknown"); // existing contract: 42501 on thrown path is unknown
  });
});

describe("classifyAuditEmitError", () => {
  it("classifies 42501 PostgREST error as permission_denied", () => {
    expect(
      classifyAuditEmitError(null, { code: "42501" }),
    ).toBe("permission_denied");
  });

  it("classifies TypeError: fetch failed as transient", () => {
    expect(
      classifyAuditEmitError(new TypeError("fetch failed"), null),
    ).toBe("transient");
  });

  it("classifies AbortError as transient", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(classifyAuditEmitError(err, null)).toBe("transient");
  });

  it("classifies generic Error as unknown", () => {
    expect(classifyAuditEmitError(new Error("nope"), null)).toBe("unknown");
  });

  it("classifies non-42501 PostgREST code as unknown", () => {
    expect(
      classifyAuditEmitError(null, { code: "PGRST200" }),
    ).toBe("unknown");
  });

  // NEW-C10-04 (audit-2026-05-26 silent-failure) regression tests.
  // Pre-fix: 28000 fell through to "unknown" → re-throw (fatal). Post-fix:
  // 28000 is classified as "unauthenticated" (non-fatal, separate Sentry tag).
  it("NEW-C10-04: classifies 28000 PostgREST error as unauthenticated (not permission_denied, not unknown)", () => {
    // 28000 = invalid_authorization_specification: raised by log_audit_event
    // when auth.uid() IS NULL (JWT expired before after() settled).
    // MUST NOT be permission_denied — that tag is reserved for EXECUTE-grant drift.
    const result = classifyAuditEmitError(null, { code: "28000" });
    expect(result).toBe("unauthenticated");
    expect(result).not.toBe("permission_denied");
    expect(result).not.toBe("unknown");
  });
});

describe("audit.emit — NEW-C10-04: 28000 unauthenticated path is non-fatal", () => {
  // NEW-C10-04 (audit-2026-05-26 silent-failure): 28000 from log_audit_event
  // is raised when auth.uid() IS NULL (JWT expired before after() settled).
  // Pre-fix: 28000 fell through to "unknown" → re-throw + Sentry, but
  // operators couldn't distinguish it from grant-drift (42501). Post-fix:
  // 28000 → "unauthenticated" → swallowed + Sentry at warning level with
  // audit_emit_unauthenticated=true (NOT audit_permission_denied=true).
  beforeEach(() => {
    captureExceptionMock.mockReset();
    __resetAuditEmitTransientFailuresForTests();
  });

  it("NEW-C10-04: 28000 swallows (non-fatal), tags audit_emit_unauthenticated, NOT audit_permission_denied", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "28000",
          message: "log_audit_event: auth.uid() is NULL — caller must be authenticated",
        },
      }),
    } as never;

    // Must NOT throw — unauthenticated is non-fatal.
    await expect(emit(client, fixture)).resolves.toBeUndefined();
    await waitForSentry(1);

    // Sentry capture must fire with audit_emit_unauthenticated=true.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, opts] = captureExceptionMock.mock.calls[0];
    expect(opts).toMatchObject({
      tags: expect.objectContaining({
        audit_emit_unauthenticated: "true",
        audit_path: "log_audit_event",
      }),
      level: "warning",
    });
    // The fatal tag must NOT be present — it is reserved for grant-drift (42501).
    expect(opts.tags).not.toHaveProperty("audit_permission_denied");

    // Console.warn (not error) so log aggregation sees distinct severity.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[audit]"),
      expect.objectContaining({ code: "28000" }),
    );

    consoleWarnSpy.mockRestore();
  });

  it("NEW-C10-04: 42501 still re-throws (fatal) — 28000 fix does not change grant-drift handling", async () => {
    // Belt-and-suspenders: verify that the new 28000 branch doesn't accidentally
    // swallow 42501. Pre-existing behavior must be preserved.
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied" },
      }),
    } as never;

    await expect(emit(client, fixture)).rejects.toThrow();
    await waitForSentry(1);

    const [, opts] = captureExceptionMock.mock.calls[0];
    expect(opts).toMatchObject({
      tags: expect.objectContaining({ audit_permission_denied: "true" }),
      level: "fatal",
    });
  });
});
