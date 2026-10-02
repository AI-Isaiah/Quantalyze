import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// NOTE: the fake doubles are imported INSIDE the `vi.mock` factories below, not
// here. A top-level import would be hoisted above the mock it is defining and,
// worse, would execute `@/test/helpers/upstash-breaker` before the factory needs
// it. The factories use dynamic `import()` for exactly that reason.

/**
 * Phase 140.5-07 / SEAMPROSE-05 — THE RUNTIME HALF OF WP-13 (ledger row
 * SC-TYPE-2).
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY THE COMPILE RECEIPT COULD NOT COVER IT
 * ---------------------------------------------------------------------------
 * `SeamBreakerVerdict` became a discriminated union on `counts` in this plan, so
 * `{ counts: true, breakerKey: null }` is no longer representable. That change
 * bought two different things, and only ONE of them is a type fact:
 *
 *   · COMPILE (row SC-TYPE-1): the invalid state cannot be constructed. The
 *     receipt is `tsc`, and specifically the fact that
 *     `recordOnce(verdict.breakerKey)` type-checks at all — it takes a `string`,
 *     so it compiles only because `counts` narrowed the `null` away. Flattening
 *     the union back to `{ counts: boolean; breakerKey: string | null }` reds
 *     `tsc` with TS2345 at all three recording sites.
 *
 *   · RUNTIME (this file, row SC-TYPE-2): the three consumers no longer carry
 *     `&& verdict.breakerKey !== null`. That conjunct read as defence, but its
 *     false branch had NO ELSE — a countable infrastructure failure whose key
 *     was missing was dropped in silence: no counter, no log, no trip, so the
 *     outage the breaker exists to contain stayed invisible to it. Deleting the
 *     conjunct is a BEHAVIOURAL change and a type checker cannot see it.
 *
 * ⚠️ NEITHER ROW MAY STAND IN FOR THE OTHER, and that is the point the phase
 * checker made when it added the second one. `tsc --noEmit` exiting 0 is
 * compatible with every one of these recording sites being deleted outright.
 * What this file pins is the property the deletion was FOR: **a counting verdict
 * always lands on a real, non-empty breaker key.** That is the sentence the union
 * makes true, and it is falsifiable at runtime.
 *
 * THE SHAPE OF THE MUTATION THIS MUST CATCH
 * -----------------------------------------
 * Post-union, "keyless while counting" can no longer be spelled `null`. Its
 * remaining spelling is the EMPTY STRING — the `?? ""` defensive shape the
 * validation ledger names — which is a legal `string` and therefore tsc-clean.
 * A counting verdict carrying `""` reaches `recordSeamFailure("")`, which counts
 * against the identifier `":failures"`: a real Redis write, to a key belonging to
 * no dependency and read by no open-check. The breaker for the dependency that
 * actually failed never advances. That is the fail-open wearing its post-union
 * costume, and the assertions below are written to name it.
 *
 * ORACLE INDEPENDENCE
 * -------------------
 * Every expected key is a HAND-TYPED literal here — `"breaker:railway"`,
 * `"breaker:supabase"`, and the fake's counter prefix. Nothing is imported from
 * `seam-discriminator.ts` or `resilient-fetch.ts` on the expected side, so the
 * assertions cannot agree with a mutated module by construction.
 * `src/lib/seam-constants.pin.test.ts` is what ties these literals to
 * production's own; this file deliberately does not.
 *
 * ⚠️ `vi.spyOn` + `vi.restoreAllMocks()`, NEVER `vi.stubGlobal` (DEF-16-1 — this
 * repo's known CI-only Node-22 failure cause). `fetch` is spied on `globalThis`
 * and restored in `afterEach`.
 */

const shared = vi.hoisted(() => ({
  /** The "shared Upstash database". Hoisted so it outlives `vi.resetModules()`. */
  store: new Map<string, { value: string; expiresAt: number }>(),
}));

vi.mock("@upstash/redis", async () => {
  const { fakeRedisFor: build } = await import("@/test/helpers/upstash-breaker");
  return { Redis: { fromEnv: () => build(shared.store) } };
});

vi.mock("@upstash/ratelimit", async () => {
  const { fakeRatelimitFor: build } = await import(
    "@/test/helpers/upstash-breaker"
  );
  return {
    Ratelimit: class {
      // OBSERVED, never CONSUMED — the double takes its own hand-typed
      // threshold. A fake that read production's `slidingWindow(...)` argument
      // could not disagree with production, which is the defect
      // `@/test/helpers/upstash-breaker`'s header exists to forbid.
      static slidingWindow(tokens: number, window: string) {
        return { tokens, window };
      }
      private readonly fake = build(shared.store);
      limit(identifier: string) {
        return this.fake.limit(identifier);
      }
    },
  };
});

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  // `after()` outside a request scope throws. The breaker's capture arms call it;
  // this keeps them inert without touching the recording path under test.
  return { ...actual, after: (task: unknown) => void task };
});

/**
 * The fake limiter's counter prefix, HAND-TYPED (it is a private constant of the
 * helper). `recordSeamFailure` counts against `` `${breakerKey}:failures` ``, so
 * a recording against `breaker:railway` lands at
 * `__fake_breaker_count__:breaker:railway:failures`.
 */
const COUNTER_PREFIX = "__fake_breaker_count__:";

/** Every counter identifier the store currently holds, prefix stripped. */
function countedIdentifiers(): string[] {
  return [...shared.store.keys()]
    .filter((k) => k.startsWith(COUNTER_PREFIX))
    .map((k) => k.slice(COUNTER_PREFIX.length))
    .sort();
}

const ORIGINAL_ENV = { ...process.env };

/**
 * A REAL `Response` carrying a nested `service_error` envelope.
 *
 * ⚠️ IT MUST BE A REAL `Response`, NOT A `{ ok, status, json }` LITERAL, and
 * finding that out is worth recording. `readDependencyBody` peeks at a 503's body
 * through `res.clone()` — and it guards that with `typeof res.clone !== "function"
 * → return undefined`, deliberately, so route fixtures that stub the core with a
 * bare object degrade to the global key instead of throwing inside the
 * classification window. A hand-rolled literal therefore takes the CLONE-MISSING
 * path silently: the first draft of this file asserted `breaker:supabase` and got
 * `breaker:railway`, which looked like a production bug and was a harness bug.
 * A double that cannot exercise the branch under test is the vacuity hazard this
 * phase is about, so the body is built for real.
 */
function serviceUnavailable(dependency: string): Response {
  return new Response(
    JSON.stringify({
      detail: {
        code: "X_TRANSIENT",
        dependency,
        retryable: true,
        detail: "a transient service fault",
      },
    }),
    {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "content-type": "application/json" },
    },
  );
}

beforeEach(() => {
  vi.resetModules();
  shared.store.clear();
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  process.env.ANALYTICS_SERVICE_URL = "https://analytics.invalid";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("[140.5-07 / SC-TYPE-2] a counting verdict never proceeds without a key", () => {
  it("records a 503 naming an UNRECOGNISED dependency against the residual global key", async () => {
    // ⭐ THE MUTATION TARGET. This is the arm where `serviceDependencyOf`
    // discards a value outside the closed service set and the verdict falls back
    // to the global key — i.e. the one counting arm whose key is CHOSEN rather
    // than constant. Under the old flat type this was the natural place for a
    // keyless counting verdict to arise, and the consumer's
    // `&& breakerKey !== null` would have swallowed it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      // "binance" is a VENUE, deliberately: it is outside the closed service set
      // and the leaf must discard it rather than key on it (T-140-01).
      serviceUnavailable("binance"),
    );

    const mod = await import("./resilient-fetch");
    await mod.resilientFetch("validate-key", "/api/validate-key", {
      retriesOverride: 0,
      method: "POST",
    });

    expect(
      countedIdentifiers(),
      "A 503 COUNTED but nothing was recorded against a real breaker key. " +
        "This is the WP-13 fail-open: the verdict said `counts: true`, the key " +
        "was missing or empty, and the recording site dropped it with no log " +
        "and no counter — so the circuit cannot trip and the outage is " +
        "invisible to the breaker that exists to contain it. Expected one " +
        "counter against `breaker:railway:failures`.",
    ).toEqual(["breaker:railway:failures"]);
    // The discard is LOUD, which is the other half of "never silently".
    expect(warn).toHaveBeenCalled();
  });

  it("records a 503 naming a RECOGNISED dependency against that dependency's key", async () => {
    // The second member of the class, and an independent oracle: this arm builds
    // the key from the body rather than falling back. If the case above were
    // carrying this one, emptying only the fallback would leave both green.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      serviceUnavailable("supabase"),
    );

    const mod = await import("./resilient-fetch");
    await mod.resilientFetch("validate-key", "/api/validate-key", {
      retriesOverride: 0,
      method: "POST",
    });

    expect(countedIdentifiers()).toEqual(["breaker:supabase:failures"]);
  });

  it("records a TRANSPORT throw against the residual global key", async () => {
    // The third recording site. `seamBreakerVerdict(null)` is a constant verdict,
    // so this case cannot be reddened by a body-arm mutation — it is here so the
    // "every counting arm lands somewhere real" claim covers all three sites
    // rather than only the dynamic one.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network unreachable"),
    );

    const mod = await import("./resilient-fetch");
    await expect(
      mod.resilientFetch("validate-key", "/api/validate-key", {
        retriesOverride: 0,
        method: "POST",
      }),
    ).rejects.toThrow(/network unreachable/);

    expect(countedIdentifiers()).toEqual(["breaker:railway:failures"]);
  });

  it("NO counter is ever created against a keyless identifier", async () => {
    // ⚠️ THE DIRECT NEGATIVE FORM, and it is not a duplicate of the three cases
    // above. Those assert the RIGHT key was written; this asserts the WRONG one
    // was not. A `?? ""` fail-open produces the identifier `":failures"`, which
    // is a real write to a key no open-check reads — so a test that only counted
    // writes, or only checked "something was recorded", would stay green on it.
    //
    // ⚠️ IT DRIVES ITS OWN REQUEST, and that is a correction worth keeping. The
    // first draft looped over "whatever the earlier cases left" — but `beforeEach`
    // clears the store, so the loop ran over an EMPTY set and the case passed
    // vacuously, asserting nothing. A guard whose population can be empty reports
    // agreement forever (VALIDATION Wave 0). The floor below is what makes the
    // emptiness itself a failure.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      serviceUnavailable("binance"),
    );
    const mod = await import("./resilient-fetch");
    await mod.resilientFetch("validate-key", "/api/validate-key", {
      retriesOverride: 0,
      method: "POST",
    });

    const identifiers = countedIdentifiers();
    expect(
      identifiers.length,
      "VACUITY FENCE: this case counted nothing at all, so the loop below " +
        "would have asserted nothing. Either the recording path stopped firing " +
        "or the harness stopped observing it — both make this guard blind, and " +
        "a blind guard is indistinguishable from a passing one.",
    ).toBeGreaterThan(0);

    for (const identifier of identifiers) {
      expect(
        identifier.startsWith(":"),
        `A failure was counted against "${identifier}" — an identifier with no ` +
          `breaker key in front of it. That is the fail-open's post-union ` +
          `spelling: the empty string is a legal \`string\`, so it type-checks, ` +
          `and it counts against a key belonging to no dependency.`,
      ).toBe(false);
      expect(identifier).toMatch(/^breaker:[a-z0-9-]+:failures$/);
    }
  });

  it("a NON-counting status records nothing at all (the positive control)", async () => {
    // Without this, every assertion above would also pass on a module that
    // recorded EVERY response. A 424 is the sharpest choice: it is a 4xx whose
    // body names the caller's venue, and that slug must never become a key.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: "EXCHANGE_PROBE_FAILED",
            dependency: "binance",
            retryable: true,
            detail: "the venue did not answer",
          },
        }),
        {
          status: 424,
          statusText: "Failed Dependency",
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const mod = await import("./resilient-fetch");
    await mod.resilientFetch("validate-key", "/api/validate-key", {
      retriesOverride: 0,
      method: "POST",
    });

    expect(
      countedIdentifiers(),
      "A 424 recorded against the breaker. Every 4xx is breaker-inert by " +
        "construction: a handful of users fat-fingering credentials must never " +
        "become a platform outage.",
    ).toEqual([]);
  });
});
