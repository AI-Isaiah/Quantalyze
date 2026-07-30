import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installFetchMock, type FetchMock } from "@/test/helpers/fetch";

/**
 * Phase 140 / SC-1c — BOTH seam chokepoints demonstrably invoke the ONE
 * resilience core.
 *
 * WHY THIS FILE EXISTS. `analytics-client.ts` and `process-key-client.ts`
 * calling `resilientFetch` is a CONVENTION, and convention is exactly what
 * failed here before: the third Railway seam
 * (`/internal/keys/{id}/permissions`) went months with its own duplicated
 * 15s constant and no breaker precisely because nothing asserted "there is
 * one transport". Grepping for `AbortSignal.timeout` proves a NEGATIVE; this
 * file proves the POSITIVE — the spy fires, once, with the right budget key,
 * and the raw `fetch` global is never touched. It fails the moment either
 * client regresses to a hand-rolled fetch, which no route test can catch
 * because all sixteen of them mock these clients wholesale.
 *
 * ⚠️ ENV MUST BE SET BEFORE THE CLIENT MODULES LOAD. `SERVICE_KEY` is captured
 * at MODULE SCOPE in `analytics-client.ts` (`process.env.ANALYTICS_SERVICE_KEY
 * ?? ""`) and the `X-Service-Key` header is emitted CONDITIONALLY on it being
 * truthy. A `beforeEach` that sets the env after a static top-level import
 * yields `""`, the header is silently omitted, and the assertion below fails
 * for a reason that has nothing to do with the wiring. Hence: set env →
 * `vi.resetModules()` → **dynamically** import the clients. Same precedent as
 * `analytics-client.test.ts`.
 *
 * ⚠️ This file is allowed to `importActual` the core — the constraint that
 * downstream ROUTE tests must not rely on re-exports through mocked modules
 * does not apply to a test that owns its own mock.
 *
 * HEADER FORWARDING IS THE SECURITY HALF (threat T-140-07). Two headers are
 * pinned byte-for-byte because dropping either is silent and expensive:
 *   - `X-User-Id` on `/process-key` — the Python limiter keys on
 *     `(token_hash, X-User-Id)`. Dropped, every tenant collapses into one
 *     shared 100/hour bucket. That is the CT-4 defect, already fixed once.
 *   - `X-Service-Key` on the analytics calls — dropped, every analytics
 *     request unauthenticates, which reads as a total outage.
 */

/** The ONE core, spied. Hoisted so the module factory can close over it. */
const coreSpy = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

// process-key-client resolves a correlation id via next/headers when the
// caller does not supply one; stub it so the wiring assertions don't depend
// on a request scope.
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn(async () => "wiring-corr-id"),
}));

// PARTIAL mock: everything real except the transport function itself, so the
// clients keep reading the genuine SEAM_BUDGETS table.
vi.mock("@/lib/resilient-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/resilient-fetch")>();
  return { ...actual, resilientFetch: coreSpy };
});

const ORIGINAL_ENV = { ...process.env };

const SERVICE_KEY = "svc-key-from-env";
const INTERNAL_TOKEN = "internal-token-from-env";

/** Read one recorded core invocation in a typed shape. */
function coreCall(index: number) {
  const [budgetKey, path, init] = coreSpy.mock.calls[index] as [
    string,
    string,
    RequestInit,
  ];
  return {
    budgetKey,
    path,
    init,
    headers: (init.headers ?? {}) as Record<string, string>,
  };
}

describe("SC-1c — both seam clients invoke the ONE resilience core", () => {
  /** A raw-fetch tripwire: if either client bypasses the core, this fires. */
  let rawFetch: FetchMock;

  beforeEach(() => {
    coreSpy.mockReset();
    // A FRESH Response per call — a single shared instance would have its body
    // consumed by the first `.json()` and make the second client's read throw.
    coreSpy.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ valid: true, read_only: true, ok: true }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    rawFetch = installFetchMock();
    rawFetch.mockRejectedValue(
      new Error(
        "raw fetch() reached — the seam must go through resilientFetch",
      ),
    );

    process.env.ANALYTICS_SERVICE_KEY = SERVICE_KEY;
    process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN;
    // AFTER the env writes, so the next dynamic import captures them at
    // module scope. Reversing these two lines silently breaks the
    // X-Service-Key assertion.
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // CI is Node 22 and local is Node 25; a leaked fetch stub is this repo's
    // known CI-only failure cause.
    vi.unstubAllGlobals();
  });

  it("validateKey delegates to the core once, with the validate-key budget", async () => {
    const { validateKey } = await import("@/lib/analytics-client");

    await validateKey("deribit", "k", "s");

    expect(coreSpy).toHaveBeenCalledTimes(1);
    const { budgetKey, path } = coreCall(0);
    expect(budgetKey).toBe("validate-key");
    expect(path).toBe("/api/validate-key");
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("validateKey forwards X-Service-Key byte-for-byte through the core", async () => {
    const { validateKey } = await import("@/lib/analytics-client");

    await validateKey("deribit", "k", "s");

    const { headers } = coreCall(0);
    expect(headers["X-Service-Key"]).toBe(SERVICE_KEY);
    expect(headers["X-Api-Version"]).toBe("1");
    expect(headers["X-Correlation-Id"]).toBeTruthy();
  });

  it("postProcessKey delegates to the core once, with the process-key-enqueue budget", async () => {
    const { postProcessKey } = await import("@/lib/process-key-client");

    const result = await postProcessKey({
      flow_type: "resync",
      source: "test",
      context: {},
      userId: "u",
    });

    expect(result.ok).toBe(true);
    expect(coreSpy).toHaveBeenCalledTimes(1);
    const { budgetKey, path } = coreCall(0);
    expect(budgetKey).toBe("process-key-enqueue");
    expect(path).toBe("/process-key");
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("postProcessKey forwards X-User-Id byte-for-byte through the core (CT-4)", async () => {
    const { postProcessKey } = await import("@/lib/process-key-client");

    await postProcessKey({
      flow_type: "resync",
      source: "test",
      context: {},
      userId: "tenant-42",
    });

    const { headers, init } = coreCall(0);
    expect(headers["X-User-Id"]).toBe("tenant-42");
    expect(headers["Authorization"]).toBe(`Bearer ${INTERNAL_TOKEN}`);
    // `cache: "no-store"` is part of the preserved init, not a core default.
    expect(init.cache).toBe("no-store");
  });

  it("both clients route through the SAME core function object", async () => {
    const { validateKey } = await import("@/lib/analytics-client");
    const { postProcessKey } = await import("@/lib/process-key-client");

    await validateKey("deribit", "k", "s");
    await postProcessKey({
      flow_type: "resync",
      source: "test",
      context: {},
      userId: "u",
    });

    // ONE spy recorded BOTH calls — which is the whole claim of SC-1c. Two
    // transports would show one call here and one somewhere unobserved.
    expect(coreSpy).toHaveBeenCalledTimes(2);
    expect(coreCall(0).budgetKey).toBe("validate-key");
    expect(coreCall(1).budgetKey).toBe("process-key-enqueue");
    expect(rawFetch).not.toHaveBeenCalled();
  });
});
