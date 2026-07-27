import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureToSentry } from "./sentry-capture";

/**
 * Phase 140.2 / SEAMCORE-06 — scrubbing is folded INTO the one capture helper.
 *
 * ⚠️ THE SENTRY CLAUSE IS ADDITIVE, NOT A LEAK BEING PLUGGED. A grep for
 * `captureException` / `captureMessage` across the seam core, both clients and
 * every seam route file returns ZERO at HEAD: the seam captures nothing to
 * Sentry today. What DOES exist is ten `captureToSentry` calls on the two
 * key-bearing routes, and those are the ones this helper now covers. Saying
 * "we fixed a Sentry leak" would be false.
 *
 * WHY THE MECHANISM IS HERE AND NOT AT THE TEN CALL SITES. Ten sites each
 * remembering to scrub is TRAP-5's "3 of 5" shape waiting to happen — the exact
 * instance-not-class defect that cost this programme thirty-seven scrapped
 * commits. This helper is already the single chokepoint for the lazy-Sentry
 * pattern, so folding the scrub in makes the every-capture clause a MECHANISM
 * rather than a convention. Ledger row M34 removes it; these cases are what
 * redden.
 *
 * WHAT MUST NOT REGRESS. The dual try/catch skeleton is load-bearing: a Sentry
 * transport failure must never mask the caller's own logging, and this helper is
 * called from inside catch blocks, so it must never throw. Both properties are
 * asserted below alongside the scrubbing.
 */

const capturedExceptions: Array<{
  err: unknown;
  options: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    level?: string;
  };
}> = [];

vi.mock("@sentry/nextjs", () => ({
  captureException: (err: unknown, options: Record<string, unknown>) => {
    capturedExceptions.push({
      err,
      options: options as {
        tags?: Record<string, string>;
        extra?: Record<string, unknown>;
        level?: string;
      },
    });
  },
}));

/** A 40-char internal token, the shape `INTERNAL_API_TOKEN` actually carries. */
const INTERNAL_TOKEN = "int_9f3a1c7e5b2d84a6f0c1e3d5b7a9f2c48e6d0b1a";

/** A raw exchange API secret — per-request, unknowable from any env list. */
const EXCHANGE_SECRET = "kX7pQ2mN9vB4tR8sL1wY6hG3jD5fA0cZ";

/** Wait for the helper's lazy `import(...).then(...)` chain to settle. */
async function nextCapture(): Promise<(typeof capturedExceptions)[number]> {
  await vi.waitFor(() => {
    expect(capturedExceptions.length).toBeGreaterThan(0);
  });
  return capturedExceptions[capturedExceptions.length - 1];
}

beforeEach(() => {
  capturedExceptions.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[SEAMCORE-06] captureToSentry scrubs before it dispatches", () => {
  it("removes an env secret from the dispatched error MESSAGE", async () => {
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);
    const err = new Error(
      `fetch failed: connect ECONNREFUSED 10.0.0.1:8002 ` +
        `(authorization: Bearer ${INTERNAL_TOKEN})`,
    );

    captureToSentry(err, { tags: { route: "api/keys/validate-and-encrypt" } });

    const captured = await nextCapture();
    const dispatched = captured.err as Error;
    expect(dispatched).toBeInstanceOf(Error);
    expect(
      dispatched.message,
      "The capture dispatched the raw message. Anything captured LEAVES our " +
        "infrastructure, so an unscrubbed capture is a credential handed to a " +
        "third party.",
    ).not.toContain(INTERNAL_TOKEN);
    // The diagnosis still has to survive — over-redaction at the capture is the
    // same TRAP-1 failure as over-redaction at the log.
    expect(dispatched.message).toContain("ECONNREFUSED");
  });

  it("removes an env secret from the dispatched error NAME and STACK", async () => {
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);
    const err = new Error("fetch failed");
    err.name = `RequestError [Bearer ${INTERNAL_TOKEN}]`;
    err.stack = `RequestError: fetch failed\n    at send (token=${INTERNAL_TOKEN})`;

    captureToSentry(err, { tags: { route: "api/keys/validate-and-encrypt" } });

    const captured = await nextCapture();
    const dispatched = captured.err as Error;
    expect(dispatched.name).not.toContain(INTERNAL_TOKEN);
    expect(String(dispatched.stack)).not.toContain(INTERNAL_TOKEN);
  });

  it("removes a PER-REQUEST secret the caller passes explicitly", async () => {
    // `keys/validate-and-encrypt` holds raw exchange credentials in its request
    // body; no module-level env list can know them.
    const err = new Error(`upstream rejected api_secret=${EXCHANGE_SECRET}`);

    captureToSentry(err, {
      tags: { route: "api/keys/validate-and-encrypt" },
      secrets: [EXCHANGE_SECRET],
    });

    const captured = await nextCapture();
    expect((captured.err as Error).message).not.toContain(EXCHANGE_SECRET);
  });

  it("scrubs the CAUSE chain rather than attaching it unscrubbed", async () => {
    vi.stubEnv("ANALYTICS_SERVICE_KEY", INTERNAL_TOKEN);
    const inner = new Error(`connect ETIMEDOUT x-service-key ${INTERNAL_TOKEN}`);
    const outer = new Error("seam body read failed", { cause: inner });

    captureToSentry(outer, { tags: { route: "api/strategies/finalize-wizard" } });

    const captured = await nextCapture();
    const dispatched = captured.err as Error & { cause?: unknown };
    const serialized = `${dispatched.message}|${String(
      (dispatched.cause as Error | undefined)?.message ?? "",
    )}`;
    expect(serialized).not.toContain(INTERNAL_TOKEN);
    expect(dispatched.message).toContain("ETIMEDOUT");
  });

  it("scrubs string values inside `extra`", async () => {
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);

    captureToSentry(new Error("probe failed"), {
      tags: { surface: "finalize-wizard" },
      extra: {
        strategy_id: "11111111-2222-3333-4444-555555555555",
        detail: `header X-Internal-Token: ${INTERNAL_TOKEN}`,
        nested: { note: `retry with ${INTERNAL_TOKEN}` },
        count: 3,
      },
    });

    const captured = await nextCapture();
    expect(JSON.stringify(captured.options.extra)).not.toContain(
      INTERNAL_TOKEN,
    );
    // Non-secret diagnostic content is untouched.
    expect(captured.options.extra?.strategy_id).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
    expect(captured.options.extra?.count).toBe(3);
  });

  it("scrubs a NON-Error thrown value into a string", async () => {
    vi.stubEnv("CRON_SECRET", INTERNAL_TOKEN);

    captureToSentry(`raw rejection carrying ${INTERNAL_TOKEN}`, {
      tags: { surface: "finalize-wizard-after" },
    });

    const captured = await nextCapture();
    expect(String(captured.err)).not.toContain(INTERNAL_TOKEN);
  });

  it("still forwards tags and level unchanged", async () => {
    captureToSentry(new Error("boom"), {
      tags: { surface: "finalize-wizard", step: "composite-member-list" },
      level: "warning",
    });

    const captured = await nextCapture();
    expect(captured.options.tags).toEqual({
      surface: "finalize-wizard",
      step: "composite-member-list",
    });
    expect(captured.options.level).toBe("warning");
  });

  it("defaults level to error", async () => {
    captureToSentry(new Error("boom"), { tags: { surface: "seam" } });
    const captured = await nextCapture();
    expect(captured.options.level).toBe("error");
  });

  it("never throws, for any thrown shape", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const thrown of [
      undefined,
      null,
      42,
      Symbol("s"),
      circular,
      { toString: () => { throw new Error("hostile toString"); } },
    ]) {
      expect(() =>
        captureToSentry(thrown, { tags: { surface: "seam" } }),
      ).not.toThrow();
    }
  });
});
