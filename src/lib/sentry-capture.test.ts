import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureToSentry } from "./sentry-capture";

/**
 * Phase 140.2 / SEAMCORE-06 — scrubbing is folded INTO the one capture helper.
 *
 * ⚠️ THE SENTRY CLAUSE IS ADDITIVE, NOT A LEAK BEING PLUGGED — but not for the
 * reason this header used to give. It asserted that the seam sent NOTHING to
 * Sentry at HEAD, resting that on a `captureException` / `captureMessage` grep
 * returning ZERO, and put the real figure at ten `captureToSentry` calls on two
 * routes. Both halves were false: the seam captures via `captureToSentry`, from
 * every seam route file, and the grep returned zero only because those two
 * symbols appear nowhere but inside `captureToSentry`'s own body. ⭐ A LITERALLY
 * TRUE GREP DEFENDING A FALSE SENTENCE — CONTEXT §3's purest specimen, corrected
 * in 140.5-04 at BOTH of its sites (this header and the `sentry-capture.ts`
 * docblock), because the claim was duplicated and fixing one is the
 * instance-not-class defect inside a single file pair.
 *
 * Saying "we fixed a Sentry leak" would still be false — the captures were
 * already happening and were already unscrubbed; this helper is where they
 * became safe. That is the claim this header actually needs, and it needs no
 * integer to make it. (The population's size depends on which roster you ask
 * about; see the `sentry-capture.ts` docblock for the predicates. A count in
 * prose that a script can derive is a future false claim.)
 *
 * WHY THE MECHANISM IS HERE AND NOT AT THE CALL SITES. Every call site
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

/**
 * The recorder the mocked SDK writes into.
 *
 * Extracted so the ONE case that has to swap the module out (the rejecting
 * `import()` below) can put an identical recorder back. `vi.doUnmock` removes
 * the hoisted `vi.mock` as well, so a test that unmocks and resets leaves every
 * LATER test importing the real SDK — whose `captureException` is a silent
 * no-op without an initialised client, i.e. a false RED that looks like a
 * detached chain. Restoring explicitly is what keeps the file order-independent.
 */
function sentryRecorderModule(): { captureException: (err: unknown, options: Record<string, unknown>) => void } {
  return {
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
  };
}

vi.mock("@sentry/nextjs", () => sentryRecorderModule());

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

  it("HI-03: scrubs a SHORT per-request secret before it leaves for a third party", async () => {
    // ⚠️ SENTRY IS THE SINK THAT MATTERS MOST HERE. The leaf's own docblock
    // says anything captured LEAVES OUR INFRASTRUCTURE, so "the caller will
    // remember" is not an acceptable control — and until HI-03 the leaf refused
    // to redact anything below 12 characters, which is every MT5 login (8-digit
    // account number) and every short user-chosen OKX passphrase.
    //
    // Both literals are hand-typed and both are below that floor.
    const shortApiKey = "26547876";
    const shortPassphrase = "hunter";
    const err = new Error(
      `upstream rejected api_key=${shortApiKey} passphrase=${shortPassphrase}`,
    );

    captureToSentry(err, {
      tags: { route: "api/keys/validate-and-encrypt" },
      extra: { attempted_key: shortApiKey },
      secrets: [shortApiKey, shortPassphrase],
    });

    const captured = await nextCapture();
    expect((captured.err as Error).message).not.toContain(shortApiKey);
    expect((captured.err as Error).message).not.toContain(shortPassphrase);
    // `extra` takes the same leaf, so a value copied into a context field must
    // not survive either.
    expect(JSON.stringify(captured.options.extra)).not.toContain(shortApiKey);
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

/**
 * Phase 140.4 / SEAMRIM-04 — the capture is no longer DETACHED before it settles.
 *
 * ⚠️ THIS IS `audit.ts`'s NEW-C10-03, RE-CREATED IN AN ADJACENT MODULE. That
 * red team (audit-2026-05-26) diagnosed `void import(...).then(...)`: the call
 * returns SYNCHRONOUSLY, so the in-flight dynamic-import promise is detached
 * before `captureException` resolves, and under `after()` on a cold finish the
 * lambda is reaped before Sentry flushes — no alert, silently. `reportToSentry`
 * was fixed by RETURNING the import chain so the caller can hold the
 * `waitUntil` window open. This helper kept the defective shape.
 *
 * ⚠️ THE CASES BELOW DELIBERATELY DO NOT USE `nextCapture()`. That helper polls
 * with `vi.waitFor`, which observes the capture whether the chain was returned
 * or detached — it is the right tool for the scrub cases above and precisely the
 * wrong one here, because polling is exactly what a reaped lambda cannot do. The
 * only oracle for "the promise stays open until capture settles" is awaiting the
 * RETURN VALUE and nothing else.
 */
describe("[SEAMRIM-04] captureToSentry returns its import chain", () => {
  it("awaiting the RETURN VALUE observes the capture — the chain is not detached", async () => {
    const returned = captureToSentry(new Error("seam.breaker.open"), {
      tags: { surface: "seam-breaker" },
      level: "warning",
    });

    // The capture cannot have happened yet: the import is asynchronous by
    // construction. Asserting the gap first is what makes the await below
    // meaningful rather than incidentally true.
    expect(
      capturedExceptions,
      "The capture completed synchronously, so awaiting the return value " +
        "proves nothing about the window staying open.",
    ).toHaveLength(0);

    await returned;

    expect(
      capturedExceptions,
      "Awaiting the returned value did not observe the capture. The import " +
        "chain is detached (NEW-C10-03), so an `after()`-scheduled caller has " +
        "nothing to hold the waitUntil window open with: on a cold finish the " +
        "lambda is reaped and the alert is lost silently.",
    ).toHaveLength(1);
    expect(
      (capturedExceptions[0].err as Error).message,
    ).toContain("seam.breaker.open");
  });

  it("the SCRUB still runs before dispatch on the returned-promise path", async () => {
    // V8 / third-party data protection. The property most likely to be lost in
    // a "it returns a promise now" edit is the unconditional chokepoint scrub,
    // so it is asserted HERE too — on the payload handed to Sentry, not merely
    // on the fact that the helper was called.
    vi.stubEnv("INTERNAL_API_TOKEN", INTERNAL_TOKEN);

    await captureToSentry(
      new Error(`connect ECONNREFUSED (authorization: Bearer ${INTERNAL_TOKEN})`),
      {
        tags: { surface: "seam-breaker", detail: `token ${INTERNAL_TOKEN}` },
        extra: { note: `retry with ${INTERNAL_TOKEN}` },
        level: "warning",
      },
    );

    expect(capturedExceptions).toHaveLength(1);
    const captured = capturedExceptions[0];
    expect((captured.err as Error).message).not.toContain(INTERNAL_TOKEN);
    expect(JSON.stringify(captured.options.tags)).not.toContain(INTERNAL_TOKEN);
    expect(JSON.stringify(captured.options.extra)).not.toContain(INTERNAL_TOKEN);
    // Over-redaction is the same TRAP-1 failure as under-redaction.
    expect((captured.err as Error).message).toContain("ECONNREFUSED");
  });

  it("RESOLVES (never rejects) when the Sentry SDK itself throws", async () => {
    // A rejection here becomes an unhandled rejection at every call site that
    // schedules this with `after()`.
    const Sentry = await import("@sentry/nextjs");
    vi.spyOn(Sentry, "captureException").mockImplementation(() => {
      throw new Error("sentry transport exploded");
    });

    await expect(
      captureToSentry(new Error("boom"), { tags: { surface: "seam" } }),
    ).resolves.toBeUndefined();
  });

  it("RESOLVES (never rejects) when the Sentry IMPORT itself rejects", async () => {
    // The chunk-load-failure path. `void`-ing it hid this; returning it means a
    // floating rejection would surface at 100+ call sites, so the swallowing
    // `.catch()` is now load-bearing rather than decorative.
    vi.resetModules();
    vi.doMock("@sentry/nextjs", () => {
      throw new Error("ChunkLoadError: @sentry/nextjs");
    });
    try {
      const fresh = await import("./sentry-capture");
      await expect(
        fresh.captureToSentry(new Error("boom"), { tags: { surface: "seam" } }),
      ).resolves.toBeUndefined();
    } finally {
      // Put the recorder BACK rather than unmocking: see `sentryRecorderModule`.
      vi.doMock("@sentry/nextjs", () => sentryRecorderModule());
      vi.resetModules();
    }
  });

  it("a hostile getter in `extra` drops the payload without cancelling the capture", async () => {
    // An alert with no context beats no alert. The `extra` is dropped, the
    // capture still dispatches, and the returned promise still resolves.
    const hostile = {
      get detail(): string {
        throw new Error("hostile getter");
      },
    } as unknown as Record<string, unknown>;

    await captureToSentry(new Error("breaker store rejected"), {
      tags: { surface: "seam-breaker" },
      extra: hostile,
    });

    expect(capturedExceptions).toHaveLength(1);
    expect(capturedExceptions[0].options.extra).toBeUndefined();
    expect((capturedExceptions[0].err as Error).message).toContain(
      "breaker store rejected",
    );
  });
});
