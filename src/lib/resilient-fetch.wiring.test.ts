import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
 * because every route test that mocks a seam client does so WHOLESALE — a
 * `vi.mock("@/lib/analytics-client")` (or `process-key-client`, or
 * `resilient-fetch`) replaces the module, so the transport underneath it is
 * never exercised by any of them.
 *
 * (140.5-04) That sentence used to give a hard COUNT of those route tests. The
 * integer is DELETED rather than corrected, because there is no single number to
 * correct it to: the population's size swings depending on whether you count raw
 * grep hits or comment-stripped ones, whether a route test living outside
 * `src/app/api/**` counts, and whether the `csv-finalize-*` suites count. Five
 * defensible readings gave five different integers when this was measured, and
 * the old figure was right under exactly one of them. The PREDICATE is the
 * honest thing to write down; a reader who needs the number can run it and will
 * then know WHICH number they got.
 *
 * ⚠️ The discredited figure is described here, not reprinted. Reprinting it
 * would put the very token back into the file that any absence check greps for,
 * so the check would fail on CORRECTED code — the DEF-16-2 shape, one level up.
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
 *
 * ---------------------------------------------------------------------------
 * PHASE 140.2 / SEAMCORE-08 (ROADMAP SC6, clause c) — THE 14/14 BUDGET-KEY
 * CENSUS, AND WHY A CENSUS ALONE IS NOT ENOUGH.
 * ---------------------------------------------------------------------------
 *
 * SC6 requires that swapping a call site's budget key fails a test. The class
 * that satisfies "call site" is NOT the five lexical invocations of the core:
 * two of the five take their key from a VARIABLE, so a call-graph enumeration
 * reports 5 and is wrong about the member list that matters. The behavioural
 * definition is *every place a budget key is BOUND to a seam call*, and in this
 * codebase that is exactly three syntactic families:
 *
 *   (i)   an exported wrapper in `src/lib/analytics-client.ts` carrying a
 *         `budgetKey:` property                                        → 10
 *         (nine wrappers; `validateKey` binds TWO rows because it selects
 *          by venue capability — 153.4-02)
 *   (ii)  an arm of `budgetKeyFor` in `src/lib/process-key-client.ts`  →  2
 *   (iii) a string literal in first-argument position of a core call    →  2
 *         (three lexical sites; the two `fetchLivePermissions` copies are
 *          one binding under two files)
 *                                                                  ------
 *                                                                     14
 *
 * How the count was re-derived (executor's own search, 2026-07-26 — reproduce
 * it rather than trusting this comment):
 *
 *   grep -rn 'budgetKey: "' src/lib/analytics-client.ts          -> 8
 *   sed -n '/function budgetKeyFor(/,/^}/p' src/lib/analytics-client.ts
 *                                    -> 2 returned key literals   (153.4-02:
 *        `validateKey` moved OUT of the literal grep and into this selector,
 *         so the first line fell 9 -> 8 while family (i) rose 9 -> 10)
 *   sed -n '/function budgetKeyFor(/,/^}/p' src/lib/process-key-client.ts
 *                                    -> 2 returned key literals
 *   grep -rn "resilientFetch(" src | grep -v test                -> 6 files,
 *        of which 3 pass a literal first argument (2 distinct bindings) and
 *        2 pass a variable (families i and ii above); the 6th is the core.
 *
 * Every one of the 14 `SeamBudgetKey` union members has at least one binding:
 * no orphan key, no unbound key.
 *
 * ⚠️ THE CENSUS ABOVE IS A CONVENTION. It records that the fourteen bindings
 * which exist today are each pinned; it proves nothing about a FIFTEENTH. A
 * wrapper added next month that reuses an EXISTING budget key adds no pin,
 * breaks no pin, and would redden nothing — the class quietly re-opens and this
 * comment becomes a historical note. The `EXPECTED_BINDINGS` roster at the
 * bottom of this file is the MECHANISM that makes the census binding: it
 * discovers the three families from source on disk and compares them, as a SET,
 * against a hand-typed roster. An unclassified binding FAILS, which forces a
 * conscious decision instead of trusting one. Falsified by ledger row M22b.
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

/**
 * Phase 140.2-09 / TS-04 — the three wrappers that gained a server-derived
 * tenant identity need one here too. This file's subject is the budget-key
 * binding, not the claim (`analytics-client.test.ts` owns that), so a single
 * shared literal keeps the pins readable.
 */
const WIRING_TENANT = { userId: "wiring-tenant" } as const;

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
    //
    // ⚠️ A real `Response` is STILL the right stub after SEAMCORE-02 changed
    // the core's return type to `SeamResponse`. That type is spelled as a
    // subset of `Response` (`ok`, `status`, `statusText`, `headers`, `json`,
    // `text`, each as `Response["…"]`), so `Response` remains assignable to it
    // and this stub keeps type-checking. What the stub cannot reproduce is the
    // INSTRUMENTATION — a body-read failure recording a breaker failure — and
    // it is not supposed to: this file pins WIRING (which budget key, which
    // headers, which path). The instrumented behaviour is proven against the
    // real core in `resilient-fetch.test.ts` and end-to-end in each client's
    // own file. Do not "upgrade" this stub to a hand-rolled SeamResponse.
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

    await validateKey("deribit", "k", "s", undefined, WIRING_TENANT);

    expect(coreSpy).toHaveBeenCalledTimes(1);
    const { budgetKey, path } = coreCall(0);
    expect(budgetKey).toBe("validate-key");
    expect(path).toBe("/api/validate-key");
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("validateKey forwards X-Service-Key byte-for-byte through the core", async () => {
    const { validateKey } = await import("@/lib/analytics-client");

    await validateKey("deribit", "k", "s", undefined, WIRING_TENANT);

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

    await validateKey("deribit", "k", "s", undefined, WIRING_TENANT);
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

  /**
   * Drive one binding through the partial-mocked core and hand back what the
   * core actually received.
   *
   * The wrapper's own RESPONSE handling is deliberately out of scope. The core
   * spy answers every wrapper with one stub body, which satisfies no Zod
   * response schema, so most wrappers reject during `parseResponse`. That
   * rejection happens strictly AFTER the binding this file pins, and coupling
   * thirteen budget-key assertions to thirteen response contracts (owned by
   * `analytics-client.test.ts`) would make these pins fail for reasons that
   * have nothing to do with a budget key.
   *
   * Absorbing the rejection is NOT a silent skip: the two assertions below run
   * unconditionally. A wrapper that throws BEFORE reaching the core records no
   * call and fails on the first; one that bypasses the core and hits the global
   * fetch fails on the second.
   */
  async function recordedBinding(invoke: () => Promise<unknown>) {
    await invoke().then(
      () => undefined,
      () => undefined,
    );
    expect(
      coreSpy,
      "this binding never reached the resilience core — the wrapper threw " +
        "before the call, or it stopped going through the core entirely.",
    ).toHaveBeenCalledTimes(1);
    expect(
      rawFetch,
      "the raw fetch() global was touched: this call site went AROUND the " +
        "core, so its budget key and the breaker are both bypassed.",
    ).not.toHaveBeenCalled();
    return coreCall(0);
  }

  type AnalyticsClient = typeof import("@/lib/analytics-client");

  /**
   * B-01..B-09 plus B-14 — family (i): the nine exported wrappers in
   * `analytics-client.ts`, each carrying its own budget-key binding. TEN pins,
   * not nine, because `validateKey` binds two rows: it names its key with
   * `budgetKeyFor(exchange)` rather than a literal, so B-01 (default venue) and
   * B-14 (serialized venue) are the same wrapper driven with different venues.
   *
   * Every expected value here is a HAND-TYPED string literal. None is read out
   * of `SEAM_BUDGETS`, out of a `SeamBudgetKey`-typed const, or out of anything
   * imported from `resilient-fetch` — an assertion that takes its expectation
   * from the table it guards is green forever, which is the defect this whole
   * phase exists to end.
   */
  const WRAPPER_PINS: ReadonlyArray<{
    binding: string;
    wrapper: string;
    budgetKey: string;
    path: string;
    invoke: (m: AnalyticsClient) => Promise<unknown>;
  }> = [
    {
      binding: "B-01",
      wrapper: "validateKey",
      budgetKey: "validate-key",
      path: "/api/validate-key",
      invoke: (m) => m.validateKey("deribit", "k", "s", undefined, WIRING_TENANT),
    },
    {
      // 153.4-02 / WIZFORM-05 — the SAME wrapper as B-01, on the OTHER budget
      // row. `validateKey` selects by venue capability, so the only difference
      // between these two pins is the venue argument and the deadline it buys.
      // Pinned here as well as in `analytics-client.test.ts` because THIS file
      // owns the binding class: without a pin the roster would list B-14 with
      // nothing driving it, and a selector that silently stopped selecting
      // would still satisfy a source-shape scan.
      binding: "B-14",
      wrapper: "validateKey",
      budgetKey: "validate-key-serialized",
      path: "/api/validate-key",
      invoke: (m) => m.validateKey("mt5", "k", "s", undefined, WIRING_TENANT),
    },
    {
      binding: "B-02",
      wrapper: "encryptKey",
      budgetKey: "encrypt-key",
      path: "/api/encrypt-key",
      invoke: (m) => m.encryptKey("deribit", "k", "s", undefined, WIRING_TENANT),
    },
    {
      binding: "B-03",
      wrapper: "optimizeScenarioWeights",
      budgetKey: "optimize-weights",
      path: "/api/optimize-weights",
      invoke: (m) => m.optimizeScenarioWeights({}, "min_vol", WIRING_TENANT),
    },
    {
      // ZERO production callers today (VALIDATION §7.5 / M-5: latent, not
      // live). Pinned anyway — the binding exists, and the moment anyone calls
      // it the pin is what stops it landing on the wrong budget.
      binding: "B-04",
      wrapper: "computePortfolioAnalytics",
      budgetKey: "portfolio-analytics",
      path: "/api/portfolio-analytics",
      invoke: (m) => m.computePortfolioAnalytics("portfolio-1", "actor-1"),
    },
    {
      binding: "B-05",
      wrapper: "runPortfolioOptimizer",
      budgetKey: "portfolio-optimizer",
      path: "/api/portfolio-optimizer",
      invoke: (m) => m.runPortfolioOptimizer("portfolio-1", "actor-1"),
    },
    {
      // The wrapper name and the budget key deliberately do NOT match
      // (`findReplacementCandidates` → "bridge"), which is exactly the shape a
      // reviewer cannot check by eye.
      binding: "B-06",
      wrapper: "findReplacementCandidates",
      budgetKey: "bridge",
      path: "/api/portfolio-bridge",
      invoke: (m) =>
        m.findReplacementCandidates("portfolio-1", "strategy-1", "user-1"),
    },
    {
      binding: "B-07",
      wrapper: "simulateAddCandidate",
      budgetKey: "simulator",
      path: "/api/simulator",
      invoke: (m) =>
        m.simulateAddCandidate("portfolio-1", "candidate-1", "user-1"),
    },
    {
      binding: "B-08",
      wrapper: "recomputeMatch",
      budgetKey: "match-recompute",
      path: "/api/match/recompute",
      invoke: (m) => m.recomputeMatch("allocator-1", false, "actor-1"),
    },
    {
      // The only GET, and the only wrapper whose path carries a query string.
      binding: "B-09",
      wrapper: "evalMatch",
      budgetKey: "match-eval",
      path: "/api/match/eval?lookback_days=30",
      invoke: (m) => m.evalMatch({ lookback_days: "30" }, WIRING_TENANT),
    },
  ];

  describe("SC6 / SEAMCORE-08 — every budget key pinned to a hand-typed literal", () => {
    it.each(WRAPPER_PINS)(
      "$binding $wrapper binds the $budgetKey budget to $path",
      async ({ wrapper, budgetKey, path, invoke }) => {
        const mod = await import("@/lib/analytics-client");

        const call = await recordedBinding(() => invoke(mod));

        expect(
          call.budgetKey,
          `${wrapper}() now crosses the seam on the "${call.budgetKey}" budget, ` +
            `not "${budgetKey}". A wrapper on the wrong row inherits the wrong ` +
            `deadline — silently, because every other test still passes. ` +
            `Retuning is legitimate; make the change HERE in the same commit.`,
        ).toBe(budgetKey);
        expect(
          call.path,
          `${wrapper}() now calls "${call.path}" upstream, not "${path}".`,
        ).toBe(path);
      },
    );

    /**
     * B-10 / B-11 — family (ii): `budgetKeyFor(args.flow_type)`.
     *
     * All four flow types are driven, not one arm each, so the MAPPING is
     * pinned rather than a single branch of it. The split mirrors
     * `analytics-service/routers/process_key.py:_is_long_fetch`: {teaser, csv}
     * run the pipeline INLINE (60s), {onboard, resync} are enqueued and return
     * 202 (15s). Swapping the ternary's arms reddens two of these four.
     */
    const FLOW_TYPE_PINS = [
      { binding: "B-10", flowType: "teaser", budgetKey: "process-key-sync" },
      { binding: "B-10", flowType: "csv", budgetKey: "process-key-sync" },
      { binding: "B-11", flowType: "onboard", budgetKey: "process-key-enqueue" },
      { binding: "B-11", flowType: "resync", budgetKey: "process-key-enqueue" },
    ] as const;

    it.each(FLOW_TYPE_PINS)(
      "$binding flow_type=$flowType binds the $budgetKey budget",
      async ({ flowType, budgetKey }) => {
        const { postProcessKey } = await import("@/lib/process-key-client");

        const call = await recordedBinding(() =>
          postProcessKey({
            flow_type: flowType,
            source: "test",
            context: {},
            userId: "u",
          }),
        );

        expect(
          call.budgetKey,
          `flow_type "${flowType}" now maps to the "${call.budgetKey}" budget, ` +
            `not "${budgetKey}". The split exists because the Python side runs ` +
            `{teaser, csv} inline and merely ENQUEUES {onboard, resync}; getting ` +
            `it backwards either kills a live pipeline early or holds a Vercel ` +
            `concurrency slot 45s longer than the work takes.`,
        ).toBe(budgetKey);
        expect(call.path).toBe("/process-key");
      },
    );
  });
});

// ---------------------------------------------------------------------------
// THE BINDING ROSTER — the mechanism that keeps the 14/14 census honest.
// ---------------------------------------------------------------------------

/**
 * Registry-completeness by directory walk, the second half of the idiom
 * `src/lib/api/limiter-ordering.test.ts` established: walk the source, classify
 * what is found, and FAIL on anything unclassified — *"a new … route that
 * nobody classified fails this test, forcing a conscious decision about it"*.
 *
 * WHY THIS EXISTS AT ALL. Thirteen individual pins prove the thirteen bindings
 * that exist today are correct. They are blind to a FOURTEENTH: a new exported
 * wrapper carrying `budgetKey: "bridge"` adds no pin, breaks no pin, and every
 * assertion above it stays green. That is the instance-vs-class defect this
 * programme has paid for repeatedly. The roster below closes it by comparing a
 * DISCOVERED set against a HAND-TYPED set.
 *
 * SET, NOT COUNT. A `.length === 13` check passes a rename and passes swapping
 * one binding for another — measured in plan 140.2-02, where renaming a budget
 * key left the count at 13 and only the sorted-set equality saw it.
 *
 * ORACLE INDEPENDENCE. The roster is typed HERE as literals, following
 * `tests/lib/process-key-onboard-contract-parity.test.ts`'s `EXPECTED_VERDICTS`
 * convention: never derived from the module it guards, never derived from the
 * module under test. Nothing below imports `resilient-fetch`,
 * `analytics-client` or `process-key-client` — both sides of every assertion
 * are a file on disk versus a literal in this file.
 *
 * GREP-GATE HYGIENE. Every source read is comment-stripped before matching and
 * every pattern requires call syntax, so an explanatory docblock cannot stand in
 * for the code it describes. Test files are excluded from the walk: a call
 * inside a mock factory is not a production binding, and including them would
 * make this file match itself.
 */

/** Repo-relative paths, POSIX separators, as the roster spells them. */
const REPO_ROOT = process.cwd();
const ANALYTICS_CLIENT = "src/lib/analytics-client.ts";
const PROCESS_KEY_CLIENT = "src/lib/process-key-client.ts";

/**
 * Strip comments before matching.
 *
 * Block comments go entirely; a line whose first non-space characters are `//`
 * goes entirely. A TRAILING `//` comment is deliberately left in place: hiding
 * a binding behind one would produce a FALSE POSITIVE here (an extra discovered
 * site that the roster does not list), and a guard that fails loud in the wrong
 * direction is safe. Silently missing a binding is the only unacceptable
 * direction.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

function readCode(relPath: string): string {
  return stripComments(readFileSync(join(REPO_ROOT, relPath), "utf8"));
}

/**
 * Normalise a path expression to something hand-typable: every `${…}`
 * interpolation becomes `{}`. Truncating at the interpolation instead would
 * collapse the two `fetchLivePermissions` copies (which differ only by a query
 * string) into one indistinguishable entry.
 */
function normalisePath(raw: string): string {
  return raw.replace(/\$\{[^}]*\}/g, "{}");
}

/** One discovered place where a budget key is bound to a seam call. */
interface DiscoveredBinding {
  family: "i" | "ii" | "iii";
  key: string;
  path: string;
  /** `file` for a literal call site, `file::symbol` for the two clients. */
  site: string;
  /**
   * Phase 141.1 / D-09 — THE SECOND CLASSIFICATION AXIS, censused here so a new
   * call site cannot be discovered by nothing on the RETRY dimension.
   *
   * The normalised source expression this site passes as `retriesOverride`, or
   * the sentinel `"<ABSENT>"` when it passes none. Phase 141 added retry as a
   * per-call-site verdict and shipped it with no census at all — the budget-key
   * axis below had one from the day it existed, and the retry axis is the same
   * shape of decision made at the same call sites. Extending this roster with a
   * FIELD rather than adding a second census file is deliberate: a parallel
   * census would duplicate the walk and the comment-stripping (the repo already
   * carries 17 unrewired copies of the latter) and could drift from the roster
   * it is supposed to agree with.
   */
  retry: string;
}

const encodeBinding = (b: DiscoveredBinding) =>
  `${b.family} | ${b.key} | ${b.path} | ${b.site} | ${b.retry}`;

/** A first-argument-position string or template literal, or a loud sentinel. */
function firstLiteralArg(rest: string): string {
  const m = /^\s*(["`])([^"`]*)\1/.exec(rest);
  return m ? normalisePath(m[2]) : "<NON-LITERAL PATH>";
}

/**
 * Normalise a captured `retriesOverride` expression to something hand-typable.
 *
 * `readCode` has already removed whole-line comments, but a TRAILING `//`
 * comment survives by design (see `stripComments`), so it is stripped here —
 * otherwise re-wording a trailing note beside an unchanged expression would red
 * this guard for no reason. The trailing property comma goes for the same
 * reason: it is punctuation of the object literal, not of the verdict.
 */
function normaliseRetryExpr(raw: string): string {
  return raw
    .replace(/\/\/.*$/, "")
    .trim()
    .replace(/,$/, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The `retriesOverride` expression governing the core call that begins at
 * `callIndex`, or a loud sentinel.
 *
 * SCAN WINDOW. From this call to the NEXT core call in the same file (or EOF).
 * That bound is exact rather than approximate: `retriesOverride` is a member of
 * `ResilientFetchInit`, so after D-08 made it REQUIRED it cannot legally appear
 * anywhere but inside one of these inits — every occurrence between call N and
 * call N+1 belongs to call N.
 *
 * ⚠️ THE SENTINELS FAIL IN THE SAFE DIRECTION. `"<ABSENT>"` and
 * `"<AMBIGUOUS RETRY>"` are values that no roster entry may legally hold, so
 * both redden the set equality below. A multi-line expression would likewise be
 * captured partially and mismatch the roster. Every failure mode of this
 * extractor is therefore a RED, never a silent pass — which is the only
 * property that matters in a guard whose whole job is to notice an omission.
 */
function retryExprFor(code: string, callIndex: number): string {
  const nextCall = [...code.matchAll(/resilientFetch\s*\(/g)]
    .map((m) => m.index)
    .find((i) => i > callIndex);
  const window = code.slice(callIndex, nextCall ?? code.length);
  const hits = [...window.matchAll(/retriesOverride:\s*([^\n]*)/g)];
  if (hits.length === 0) return "<ABSENT>";
  if (hits.length > 1) return "<AMBIGUOUS RETRY>";
  return normaliseRetryExpr(hits[0][1]);
}

/**
 * The retry expression at a client module's SINGLE core chokepoint.
 *
 * Both clients funnel every binding they own through exactly one
 * `resilientFetch` call, so ONE expression governs all of them — the same
 * property `discoverBudgetKeyForArms` already relies on to give both its arms
 * one upstream path. Requiring exactly one call is itself the fence: a SECOND
 * chokepoint in either client would mean its bindings no longer share a retry
 * verdict, and the sentinel makes that a RED rather than a half-truth silently
 * attributed to every binding in the family.
 */
function chokepointRetry(code: string): string {
  const calls = [...code.matchAll(/resilientFetch\s*\(/g)];
  if (calls.length !== 1) return "<NOT A SINGLE CHOKEPOINT>";
  return retryExprFor(code, calls[0].index);
}

/**
 * The budget keys a `budgetKeyFor`-shaped selector can RETURN, read from the
 * given source at the given declaration.
 *
 * Shared by families (i) and (ii) since 153.4-02, when a SECOND module grew a
 * selector of this shape. The extraction recipe is family (ii)'s, unchanged, and
 * its reasoning is written out at `discoverBudgetKeyForArms` below — strip the
 * arm TESTS so the guard is not coupled to a ternary-vs-switch spelling, then
 * keep only RETURN positions so a fail-loud `throw` message containing a quoted
 * string is not reported as a phantom budget key.
 *
 * ⚠️ ONE extractor for both selectors is deliberate here, against this file's
 * general preference for independent duplicated scanners. Those duplicates exist
 * so two scanners can DISAGREE about the same population; these two read
 * DIFFERENT populations in different files, so a second copy would give nothing
 * to disagree with and would simply be a second place to forget.
 */
function returnedKeyLiterals(code: string, declaration: string): string[] {
  const start = code.indexOf(declaration);
  if (start < 0) return [];
  const body = code.slice(start, code.indexOf("\n}", start));
  const withoutArmTests = body
    .replace(/===\s*"[^"]*"/g, "")
    .replace(/\bcase\s+"[^"]*"\s*:/g, "");
  const returned = [...withoutArmTests.matchAll(/\breturn\b[^;]*;/g)]
    .map((m) => m[0])
    .join("\n");
  return [...returned.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Family (i) — every exported wrapper in `analytics-client.ts` carrying a
 * `budgetKey:` property, paired with the upstream path of the request it
 * builds.
 */
function discoverAnalyticsWrappers(): DiscoveredBinding[] {
  const code = readCode(ANALYTICS_CLIENT);
  // D-09: every wrapper in this family reaches the core through `analyticsRequest`,
  // so the retry verdict is that one chokepoint's expression, shared by all nine.
  const retry = chokepointRetry(code);
  const starts: Array<{ name: string; index: number }> = [];
  for (const m of code.matchAll(/^export async function (\w+)\s*\(/gm)) {
    starts.push({ name: m[1], index: m.index });
  }

  const out: DiscoveredBinding[] = [];
  starts.forEach((fn, i) => {
    const body = code.slice(fn.index, starts[i + 1]?.index ?? code.length);
    const paths = [...body.matchAll(/analyticsRequest\(/g)].map((m) => ({
      index: m.index,
      path: firstLiteralArg(body.slice(m.index + m[0].length)),
    }));
    // 153.4-02 — TWO SHAPES, and the second one is why this is a `matchAll`
    // over an alternation rather than a literal scan.
    //
    //   `budgetKey: "<literal>"`      — the incumbent shape, one binding.
    //   `budgetKey: budgetKeyFor(…)`  — a SELECTOR, which binds this call site
    //                                   to EVERY key the selector can return.
    //
    // A wrapper that selects its budget row at run time is still a call site
    // with a budget, and it has as many bindings as the selector has arms.
    // Reading only the literal shape would have made `validateKey` vanish from
    // the census the moment it went venue-aware — the guard reporting a smaller
    // class than exists, which is the direction that fails silently once the
    // fence below is relaxed to match.
    for (const keyMatch of body.matchAll(
      /budgetKey:\s*(?:"([^"]+)"|budgetKeyFor\()/g,
    )) {
      const preceding = paths.filter((p) => p.index < keyMatch.index).pop();
      const keys =
        keyMatch[1] !== undefined
          ? [keyMatch[1]]
          : returnedKeyLiterals(code, "function budgetKeyFor(");
      for (const key of keys) {
        out.push({
          family: "i",
          key,
          path: preceding?.path ?? "<NO REQUEST PATH FOUND>",
          site: `${ANALYTICS_CLIENT}::${fn.name}`,
          retry,
        });
      }
    }
  });
  return out;
}

/**
 * Family (ii) — the arms of `budgetKeyFor` in `process-key-client.ts`.
 *
 * The extraction is stated as "the budget keys the function can RETURN", which
 * is what the census recipe at the top of this file measures ("-> 2 returned key
 * literals"). Two steps get there:
 *
 *   1. Strip the flow-type TESTS. `budgetKeyFor` has worn TWO syntactic forms
 *      and this discovery must not be coupled to either: the pre-141.1 ternary
 *      spelled its tests `flowType === "teaser"`, and the 141.1 / D-11
 *      `never`-defaulted switch spells them `case "teaser":`. Handling only the
 *      first is what made this guard red on the D-11 conversion — it reported
 *      `teaser` / `csv` / `onboard` / `resync` as four phantom BUDGET KEYS while
 *      the function's actual returns were unchanged.
 *   2. Keep only RETURN statements. Stripping the tests and then scanning the
 *      whole body was always one double-quoted string away from a phantom: the
 *      switch's `default` arm throws a fail-loud message, and a message with a
 *      `"` in it is prose, not a binding. Return position is the property the
 *      roster is actually about.
 *
 * ⚠️ NEITHER STEP WIDENS THE GUARD. A genuinely NEW arm returning a NEW budget
 * key is still discovered and still fails against the roster; a third syntactic
 * form that this extractor cannot read yields FEWER bindings than the roster
 * lists, which fails too. Both directions stay loud — that is the invariant to
 * preserve if this ever needs touching again.
 *
 * The upstream path is the literal at that module's single core call.
 */
function discoverBudgetKeyForArms(): DiscoveredBinding[] {
  const code = readCode(PROCESS_KEY_CLIENT);
  // 153.4-02: the extraction recipe described above now lives in
  // `returnedKeyLiterals`, because `analytics-client.ts` grew a selector of the
  // same shape. The recipe is byte-unchanged; only its home moved.
  const returnedKeys = returnedKeyLiterals(code, "function budgetKeyFor(");

  const callMatch = /resilientFetch\(\s*\w+\s*,\s*/.exec(code);
  const path = callMatch
    ? firstLiteralArg(code.slice(callMatch.index + callMatch[0].length))
    : "<NO CORE CALL FOUND>";

  // D-09: both arms reach the core through `postProcessKey`'s single call, so
  // one retry expression governs them — exactly as one `path` already does.
  const retry = chokepointRetry(code);

  return returnedKeys.map((key) => ({
    family: "ii" as const,
    key,
    path,
    site: `${PROCESS_KEY_CLIENT}::budgetKeyFor`,
    retry,
  }));
}

/** Every non-test `.ts`/`.tsx` file under `src/`. */
function walkSourceFiles(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...walkSourceFiles(rel, prefix));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !rel.startsWith("src/test/")
    ) {
      out.push(rel);
    }
  }
  return out;
}

/** Non-test source files that reference the core as a CALL. */
const SEAM_CALL_FILES: string[] = walkSourceFiles("src", "src")
  .filter((rel) => /resilientFetch\s*\(/.test(readCode(rel)))
  .sort();

/**
 * Family (iii) — a string literal in first-argument position of a core call,
 * anywhere in the walked source.
 */
function discoverLiteralCallSites(): DiscoveredBinding[] {
  const out: DiscoveredBinding[] = [];
  for (const rel of SEAM_CALL_FILES) {
    const code = readCode(rel);
    for (const m of code.matchAll(/resilientFetch\(\s*"([^"]+)"\s*,/g)) {
      out.push({
        family: "iii",
        key: m[1],
        path: firstLiteralArg(code.slice(m.index + m[0].length)),
        site: rel,
        // D-09: unlike the two clients, each literal call site states its own
        // retry verdict inline, so it is read at the site.
        retry: retryExprFor(code, m.index),
      });
    }
  }
  return out;
}

/**
 * Phase 141.1 / D-09 — the two client chokepoints' retry expressions, typed
 * here as source text.
 *
 * Named constants rather than repeated string literals only because nine and
 * two roster rows share them respectively; they are hand-typed oracles like
 * every other value in this roster, never imported or derived from the modules
 * they describe. On the ANALYTICS row the `?? 0` half is the load-bearing part:
 * it is what makes a seam function ABSENT from the SEAM-06 registry resolve to no
 * retry instead of inheriting one, so a drift to `?? 1` is a silent grant of
 * retry to every unaudited wrapper — and reddens here.
 *
 * ⚠️ 141.2 / D-01 — THE PROCESS-KEY ROW NOW SHOWS A NAME, NOT ARITHMETIC, AND
 * THAT IS THE ACCEPTED TRADEOFF. Its expression used to spell the whole verdict
 * out (`RETRY_SAFE_FLOW_TYPES[args.flow_type]?.retries ?? 0`); the verdict now
 * also depends on idempotency-key presence, which cannot be written inline
 * without either a multi-line expression (which this roster's line-scoped
 * extractor captures PARTIALLY and reddens on) or a ~200-character single-line
 * ternary (worse to read than a name). So the belt moved INSIDE `retriesForFlow`
 * in the registry leaf — the artifact whose whole purpose is to be the single
 * readable verdict — and it carries its own direct unit pins there plus
 * behavioural pins through the real client in `process-key-client.test.ts`. What
 * this roster still guarantees is the property it was built for: that the
 * chokepoint's retry decision is the one named here and did not drift.
 * DO NOT widen the extractor to accommodate a multi-line expression.
 */
const ANALYTICS_RETRY = "RETRY_SAFE_ANALYTICS[options.budgetKey]?.retries ?? 0";
const PROCESS_KEY_RETRY = "retriesForFlow(args.flow_type, args.context)";

/**
 * The 14 bindings, typed HERE as literals — the whole class, one entry per
 * binding, each entry listing every site that binding occupies.
 *
 * B-14 (153.4-02) is the second binding of ONE call site: `validateKey` selects
 * between two budget rows by venue capability, so the site occupies two rows and
 * appears twice. A roster keyed on call sites rather than bindings could not
 * express that, and would have had to pick one of the two deadlines to pin.
 *
 * B-12 is one binding at TWO sites: `fetchLivePermissions` exists as two
 * verbatim copies (the route's own cached probe and finalize-wizard's
 * cache-bypassing submit probe), differing only by `?force_refresh=true`.
 * Listing the sites rather than collapsing them means a THIRD copy of that seam
 * — a new file reusing the same key and path — is an unlisted site and fails
 * too, which key-level deduplication would have hidden.
 *
 * Phase 141.1 / D-09 — EVERY SITE ALSO CARRIES ITS RETRY EXPRESSION, hand-typed
 * here as a literal exactly as its path is. The two clients resolve their
 * verdict from the SEAM-06 registry at one chokepoint each; the three route
 * sites state a bare `0` because none of them appears in that registry. Both
 * shapes are pinned as source text, so deleting an override, or drifting one
 * from `?? 0` to `?? 1`, changes a value on this roster's other side.
 */
const EXPECTED_BINDINGS: ReadonlyArray<{
  id: string;
  family: "i" | "ii" | "iii";
  key: string;
  sites: ReadonlyArray<{ site: string; path: string; retry: string }>;
}> = [
  { id: "B-01", family: "i", key: "validate-key",
    sites: [{ site: `${ANALYTICS_CLIENT}::validateKey`, path: "/api/validate-key", retry: ANALYTICS_RETRY }] },
  { id: "B-02", family: "i", key: "encrypt-key",
    sites: [{ site: `${ANALYTICS_CLIENT}::encryptKey`, path: "/api/encrypt-key", retry: ANALYTICS_RETRY }] },
  { id: "B-03", family: "i", key: "optimize-weights",
    sites: [{ site: `${ANALYTICS_CLIENT}::optimizeScenarioWeights`, path: "/api/optimize-weights", retry: ANALYTICS_RETRY }] },
  { id: "B-04", family: "i", key: "portfolio-analytics",
    sites: [{ site: `${ANALYTICS_CLIENT}::computePortfolioAnalytics`, path: "/api/portfolio-analytics", retry: ANALYTICS_RETRY }] },
  { id: "B-05", family: "i", key: "portfolio-optimizer",
    sites: [{ site: `${ANALYTICS_CLIENT}::runPortfolioOptimizer`, path: "/api/portfolio-optimizer", retry: ANALYTICS_RETRY }] },
  { id: "B-06", family: "i", key: "bridge",
    sites: [{ site: `${ANALYTICS_CLIENT}::findReplacementCandidates`, path: "/api/portfolio-bridge", retry: ANALYTICS_RETRY }] },
  { id: "B-07", family: "i", key: "simulator",
    sites: [{ site: `${ANALYTICS_CLIENT}::simulateAddCandidate`, path: "/api/simulator", retry: ANALYTICS_RETRY }] },
  { id: "B-08", family: "i", key: "match-recompute",
    sites: [{ site: `${ANALYTICS_CLIENT}::recomputeMatch`, path: "/api/match/recompute", retry: ANALYTICS_RETRY }] },
  { id: "B-09", family: "i", key: "match-eval",
    sites: [{ site: `${ANALYTICS_CLIENT}::evalMatch`, path: "/api/match/eval?{}", retry: ANALYTICS_RETRY }] },
  { id: "B-10", family: "ii", key: "process-key-sync",
    sites: [{ site: `${PROCESS_KEY_CLIENT}::budgetKeyFor`, path: "/process-key", retry: PROCESS_KEY_RETRY }] },
  { id: "B-11", family: "ii", key: "process-key-enqueue",
    sites: [{ site: `${PROCESS_KEY_CLIENT}::budgetKeyFor`, path: "/process-key", retry: PROCESS_KEY_RETRY }] },
  { id: "B-12", family: "iii", key: "keys-permissions",
    sites: [
      { site: "src/app/api/keys/[id]/permissions/route.ts", path: "/internal/keys/{}/permissions", retry: "0" },
      { site: "src/app/api/strategies/finalize-wizard/route.ts", path: "/internal/keys/{}/permissions?force_refresh=true", retry: "0" },
    ] },
  { id: "B-13", family: "iii", key: "process-key-unified-dormant",
    sites: [{ site: "src/app/api/keys/validate-and-encrypt/route.ts", path: "/process-key", retry: "0" }] },
  // 153.4-02 / WIZFORM-05 — `validateKey` binds TWO keys, not one. It selects
  // its row with `budgetKeyFor(exchange)`, whose arms are `validate-key` (B-01,
  // above, unchanged) and this one, taken only when the venue's probe is
  // SERIALIZED. Same site, same path and the same chokepoint retry expression:
  // what differs between B-01 and B-14 is ONLY the deadline, which is the whole
  // point of the change and exactly what this roster exists to make visible.
  { id: "B-14", family: "i", key: "validate-key-serialized",
    sites: [{ site: `${ANALYTICS_CLIENT}::validateKey`, path: "/api/validate-key", retry: ANALYTICS_RETRY }] },
];

/**
 * The files that may call the core at all, typed here as literals.
 *
 * This closes the one hole the roster cannot see on its own: a NEW call site
 * that passes its budget key as a VARIABLE belongs to no family above and would
 * be discovered by nothing. Such a call site is invisible to the roster and to
 * every pin in this file — and it is the exact shape families (i) and (ii)
 * already have, so it is the likely shape of the next one.
 */
const EXPECTED_SEAM_CALL_FILES: string[] = [
  "src/app/api/keys/[id]/permissions/route.ts",
  "src/app/api/keys/validate-and-encrypt/route.ts",
  "src/app/api/strategies/finalize-wizard/route.ts",
  "src/lib/analytics-client.ts",
  "src/lib/process-key-client.ts",
  "src/lib/resilient-fetch.ts",
];

/** The 14 budget keys these bindings cover — no orphan key, no unbound key. */
const EXPECTED_BOUND_KEYS: string[] = [
  "bridge",
  "encrypt-key",
  "keys-permissions",
  "match-eval",
  "match-recompute",
  "optimize-weights",
  "portfolio-analytics",
  "portfolio-optimizer",
  "process-key-enqueue",
  "process-key-sync",
  "process-key-unified-dormant",
  "simulator",
  "validate-key",
  "validate-key-serialized",
];

describe("SC6 / SEAMCORE-08 — the budget-key binding class stays closed", () => {
  const discovered = [
    ...discoverAnalyticsWrappers(),
    ...discoverBudgetKeyForArms(),
    ...discoverLiteralCallSites(),
  ];

  it("finds bindings at all (fail-loud on a vacuous discovery pass)", () => {
    // A discovery pass that matched nothing would make the SET equality below
    // pass only if the roster were empty too — but it also has to be impossible
    // for a refactor (a renamed helper, a moved file) to quietly reduce this
    // guard's reach. Zero cases is a passing suite; this is the fence.
    expect(
      discovered.length,
      "the binding discovery pass found nothing. The source moved or a pattern " +
        "stopped matching — this guard is now blind, not satisfied.",
    ).toBeGreaterThanOrEqual(15);
  });

  it("every discovered binding is classified in the roster (a 15th binding FAILS)", () => {
    const expectedSites = EXPECTED_BINDINGS.flatMap((b) =>
      b.sites.map((s) =>
        encodeBinding({
          family: b.family,
          key: b.key,
          path: s.path,
          site: s.site,
          retry: s.retry,
        }),
      ),
    ).sort();
    const actualSites = discovered.map(encodeBinding).sort();

    expect(
      actualSites,
      "The set of budget-key bindings on disk no longer matches the roster " +
        "typed in this file. An UNLISTED binding is a seam call site whose " +
        "budget key nobody pinned — which is how a call site ends up on the " +
        "wrong deadline with every test in the repo green, and how the third " +
        "Railway seam survived for months on its own duplicated constant. Note " +
        "that a new binding REUSING an existing budget key breaks no individual " +
        "pin above and fails only here. The correct response is to pin the new " +
        "binding and add it to the roster — a conscious decision. Never widen " +
        "this assertion to make a diff pass. Since 141.1/D-09 each entry also " +
        "carries its `retriesOverride` SOURCE EXPRESSION, so a call site that " +
        "drops its override, or drifts one from `?? 0` to `?? 1`, differs on " +
        "this roster's other side and lands here too.",
    ).toEqual(expectedSites);
  });

  it("no discovered site is missing its retry verdict (D-09)", () => {
    const absent = discovered
      .filter((b) => b.retry === "<ABSENT>")
      .map((b) => `${b.site} (${b.key})`);

    expect(
      absent,
      "A seam call site passes NO `retriesOverride`. The roster docblock below " +
        "states why the file-level fence exists — a new call site that belongs " +
        "to no family 'would be discovered by nothing'. That was true of the " +
        "RETRY axis for the whole of phase 141: retry is a per-site verdict " +
        "about whether replaying this request can duplicate a side effect, and " +
        "a site that never states one is an UNAUDITED replay, not a safe " +
        "default. Since D-08 made the field required, `tsc` catches this first " +
        "— this assertion is the belt that survives an `as any`, a JS caller, " +
        "or the field being relaxed back to optional, exactly as the runtime " +
        "validator survives beside the compile-time union. The remedy is to " +
        "decide the verdict: add the seam function to the SEAM-06 retry-safety " +
        "registry, or state `retriesOverride: 0` at the site and say why. " +
        "Never widen this assertion to make a diff pass.",
    ).toEqual([]);
  });

  it("the roster covers exactly the 14 budget keys (no orphan key, no unbound key)", () => {
    const boundKeys = [...new Set(discovered.map((b) => b.key))].sort();
    expect(
      boundKeys,
      "The set of budget keys actually BOUND to a seam call drifted. A key in " +
        "the table that nothing binds is dead tuning nobody will notice is " +
        "wrong; a bound key that is not one of these fourteen is a call site " +
        "running on a row this file never reviewed.",
    ).toEqual([...EXPECTED_BOUND_KEYS].sort());
  });

  it("only the six known files call the core (catches a variable-key call site)", () => {
    expect(
      SEAM_CALL_FILES,
      "A source file outside the known six now calls the resilience core. If " +
        "it passes its budget key as a VARIABLE it belongs to none of the three " +
        "discovered families, so no assertion above can see it — this is the " +
        "only one that will. Classify the new call site and list it here in the " +
        "same commit.",
    ).toEqual([...EXPECTED_SEAM_CALL_FILES].sort());
  });
});
