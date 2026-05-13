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
});
