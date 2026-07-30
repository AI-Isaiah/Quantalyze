/** @vitest-environment jsdom */
/**
 * Phase 140.3 / plan G1 — RUNTIME PIN: the wizard sync-poll TICK never targets
 * a seam route.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FENCE MOVED TIERS — read this before "simplifying" it back
 * ═══════════════════════════════════════════════════════════════════════════
 * `src/lib/seam-poll-disjointness.pin.test.ts` used to claim, in a source scan,
 * that ZERO network calls exist on the poll path. **That claim was false at
 * file granularity.** `SyncPreviewStep.tsx` makes three real network calls, two
 * of them to `/api/keys/sync`, which IS a seam route. The source pin passed
 * anyway because its needle was `/\bfetch\s*\(/` and every one of those calls is
 * spelled `wizardFetch(` — so the guard stayed green under the exact mutation it
 * existed to prevent.
 *
 * Widening that needle does not fix it: the pin would then go RED on a clean
 * tree, because the file-scoped property is simply not true. The property that
 * IS true, and is the one worth protecting, is **tick-scoped**:
 *
 *   > The repeating poll tick must not target a seam route.
 *   > The user-initiated kickoff may, and does.
 *
 * Tick-ness is a runtime fact about WHEN a callback fires, not a lexical fact
 * about which file a call site sits in. No regex can express it. Hence a runtime
 * pin.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A `globalThis.fetch` SPY IS INDIRECTION-PROOF BY CONSTRUCTION
 * ═══════════════════════════════════════════════════════════════════════════
 * `wizardFetch` (`src/lib/wizard/wizard-correlation.ts:58`) calls the
 * UNQUALIFIED global `fetch` in its body (`:63`). An unqualified `fetch`
 * resolves against the global object at CALL time, so a spy installed on
 * `globalThis.fetch` observes it.
 *
 * That is not a property of `wizardFetch` specifically — it is a property of
 * every wrapper. A future `apiFetch`, a wrapper of a wrapper, an inline
 * `const f = fetch`, a `Promise.all` of three helpers: all of them ultimately
 * reach the same global. **The global is the only door out of the browser.**
 * A source needle has to guess the spelling; this pin does not have to know one.
 *
 * ⚠️ `vi.spyOn(globalThis, "fetch")` + `vi.restoreAllMocks()`, NEVER
 * `vi.stubGlobal`. Four of this repo's 38 fetch-stubbing test files never
 * unstub, and a leaked stub is the known cause of this repo's CI-only failures
 * (CI Node 22 vs local Node 25).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PIN DOES **NOT** PROVE — read this before trusting it
 * ═══════════════════════════════════════════════════════════════════════════
 * The honest part, and it matters more than the assertions.
 *
 *  1. **It is jsdom under fake timers, not a browser.** It proves the code as
 *     executed in THIS harness. Production tick scheduling, real network
 *     ordering and real React concurrency are outside it.
 *  2. **It observes ONE component.** `useStrategySyncPoller.ts` and
 *     `SyncProgress.tsx` are also on the poll path and are NOT rendered here.
 *     That is precisely why `src/lib/seam-poll-disjointness.pin.test.ts` is kept
 *     rather than deleted — its comment-stripped URL allow-list covers the two
 *     modules this file cannot see. The two tiers are complements, not rivals.
 *  3. **It says nothing about a fourth poller added tomorrow** in a new file,
 *     nor about anything that polls outside the wizard.
 *  4. **It does not prove the poll is harmless in general** — only that it
 *     cannot feed the analytics breaker. Cadence, Supabase load and the
 *     fifteen-minute patience window are all other files' problems.
 *  5. **The seam-route SET is derived from DIRECT import edges only.** A route
 *     that reached the seam through a helper would not be in the set. That is
 *     the same limitation the SSR pin states, and it is stated here rather than
 *     papered over.
 *
 * A pin that overclaims is worse than no pin, because the next reader stops
 * checking.
 */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SyncPreviewStep } from "./SyncPreviewStep";
import type { SyncProgressResponse } from "@/lib/sync-progress";

// ---------------------------------------------------------------------------
// Seam-route derivation — DERIVED FROM DISK, never hand-typed.
// ---------------------------------------------------------------------------

/** The three modules through which every seam call in this repo is made. */
const SEAM_MODULES = [
  "analytics-client",
  "resilient-fetch",
  "process-key-client",
] as const;

/**
 * Matches the IMPORT EDGE, never a bare mention. A substring grep would report
 * every docblock that NAMES a seam module as a seam caller — and the natural
 * "fix" for a guard that cries wolf is to weaken it until it stops.
 */
const SEAM_IMPORT_EDGE = new RegExp(
  `from\\s*["'](?:@/lib/|\\./|\\.\\./)?(?:lib/)?(?:${SEAM_MODULES.join("|")})["']`,
);

/**
 * Walk `src/app/api`, keep `route.ts` files carrying a seam import edge, and
 * convert each to the URL path it serves.
 *
 * ⚠️ DERIVED, NOT HAND-TYPED. A hand-typed roster of seam routes re-creates the
 * roster-staleness hole this whole plan exists to close: a sixteenth seam route
 * added next month would be invisible to a typed list, and the pin would report
 * the poll safe with respect to a set that no longer describes the repo. The
 * fail-loud lower bound in the first case below is what stops the derivation
 * silently returning nothing.
 */
function deriveSeamRoutePaths(apiRoot: string): string[] {
  const paths: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(process.cwd(), dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
        continue;
      }
      if (entry.name !== "route.ts") continue;
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      if (!SEAM_IMPORT_EDGE.test(src)) continue;
      paths.push(`/${rel.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "")}`);
    }
  };
  walk(apiRoot);
  return paths.sort();
}

/**
 * Segment-wise match of a request URL against a derived seam-route path,
 * treating a `[bracketed]` path segment as a single-segment wildcard.
 *
 * ⚠️ SEGMENT-WISE IS LOAD-BEARING. `url.includes(seamPath)` would classify
 * `/api/keys/syncing` as `/api/keys/sync`, and `startsWith` would do the same.
 * Depth matters too: the live tick target
 * `/api/strategies/composite-strat-1/sync-progress` has FOUR segments, and so
 * does the seam route `/api/strategies/composite/add-key` — they are told apart
 * only by comparing segment 3. A sloppier matcher would either classify the
 * live tick as a seam call (and this pin would be red on a clean tree) or
 * classify everything under `/api/` as a seam call (and it would be red on
 * everything). The self-test below pins both directions.
 */
function isSeamRoutePath(url: string, seamPaths: readonly string[]): boolean {
  const pathOnly = url.split("#")[0].split("?")[0].replace(/\/+$/, "") || "/";
  const segs = pathOnly.split("/").filter(Boolean);
  return seamPaths.some((seamPath) => {
    const seamSegs = seamPath.split("/").filter(Boolean);
    if (seamSegs.length !== segs.length) return false;
    return seamSegs.every(
      (s, i) => (s.startsWith("[") && s.endsWith("]")) || s === segs[i],
    );
  });
}

const SEAM_ROUTE_PATHS = deriveSeamRoutePaths("src/app/api");

// ---------------------------------------------------------------------------
// Harness — idioms mirrored in shape from the sibling
// `SyncPreviewStep.progress.render.test.tsx` (which owns the progress
// piggyback's RENDER behaviour; this file owns its NETWORK TARGET).
// ---------------------------------------------------------------------------

let currentClientFactory: () => unknown = () => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  }),
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentClientFactory(),
}));

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));

vi.mock("@/components/connect/KeyPermissionBadge", () => ({
  KeyPermissionBadge: () => null,
}));

/**
 * Waiting-state Supabase mock: the freshness probe resolves EMPTY so the mount
 * effect falls through to the `/api/keys/sync` kickoff POST, and the status poll
 * returns a non-terminal status so the component stays in
 * `waiting_for_complete` and keeps ticking.
 */
function installWaitingMock(pollStatus: string) {
  currentClientFactory = () => ({
    from: () => ({
      select: (cols: string) => {
        if (cols === "computation_status, computed_at") {
          return {
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          };
        }
        if (cols === "computation_status, computation_error") {
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    computation_status: pollStatus,
                    computation_error: null,
                  },
                  error: null,
                }),
            }),
          };
        }
        return {
          eq: () => ({
            order: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        };
      },
    }),
  });
}

/** A valid, non-degraded, still-running progress body. */
const RUNNING_PROGRESS: SyncProgressResponse = {
  jobStatus: "running",
  stalled: false,
  memberProgress: [],
};

/**
 * ⚠️ THE DEFAULT BRANCH IS LOAD-BEARING AND WAS MEASURED. DO NOT "SIMPLIFY" IT
 * BACK TO `new Response("{}")`.
 *
 * The sibling PROG file answers unknown URLs with `"{}"`, which is fine there
 * because nothing retargets the tick. Here, the ledger's M86 mutation DOES
 * retarget it — and with a `"{}"` body the component throws a TypeError inside
 * the progress `setState` updater (`SyncPreviewStep.tsx:757` reads
 * `json.memberProgress.length`) BEFORE this file's URL assertion ever runs. The
 * pin would then "redden" for the wrong reason and the M86 receipt would be
 * FALSE — a guard certified by a crash it did not cause.
 *
 * Answering every non-kickoff URL with a VALID `SyncProgressResponse` means the
 * mutant does not crash, and the redness is attributable to the URL assertion
 * alone. If you ever see this file fail with a TypeError from that updater
 * rather than with an assertion message of its own, this branch is what
 * regressed.
 */
function installFetchMock() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/keys/sync")) {
        return new Response(
          JSON.stringify({
            ok: true,
            accepted: true,
            status: "syncing",
            composite: true,
          }),
          { status: 202 },
        );
      }
      return new Response(JSON.stringify(RUNNING_PROGRESS), { status: 200 });
    });
}

const baseProps = {
  strategyId: "composite-strat-1",
  apiKeyId: "11111111-1111-4111-8111-111111111111",
  wizardSessionId: "session-1",
  onComplete: vi.fn(),
  onTryAnotherKey: vi.fn(),
};

/** Poll cadence in `SyncPreviewStep.tsx` — the shortest leg of POLL_BACKOFF_MS. */
const TICK_MS = 3000;
const TICK_ITERATIONS = 5;

describe("[140.3-G1] RUNTIME PIN: the sync-poll TICK never targets a seam route", () => {
  let fetchSpy: ReturnType<typeof installFetchMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    baseProps.onComplete = vi.fn();
    baseProps.onTryAnotherKey = vi.fn();
    installWaitingMock("computing");
    fetchSpy = installFetchMock();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    currentClientFactory = () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });
  });

  /**
   * Render, settle the mount + kickoff, mark the boundary, then run the poll.
   *
   * The MARK is the whole idea of this file. Everything before it is the
   * user-initiated kickoff, which is allowed to reach the seam. Everything after
   * it is the repeating tick, which is not. A file-scoped scan cannot draw this
   * line; a runtime observation draws it for free.
   */
  async function runKickoffThenTicks(): Promise<{
    kickoffCalls: string[];
    tickCalls: string[];
  }> {
    render(<SyncPreviewStep {...baseProps} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // mount effect
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // kickoff POST settles
    });

    const mark = fetchSpy.mock.calls.length;

    for (let i = 0; i < TICK_ITERATIONS; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TICK_MS);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0); // flush fire-and-forget setState
      });
    }

    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    return { kickoffCalls: urls.slice(0, mark), tickCalls: urls.slice(mark) };
  }

  it("the seam-route set is DERIVED from disk and non-trivial", () => {
    // A derivation that returned nothing would report every URL safe forever —
    // the failure mode that makes a guard worse than no guard, because it reads
    // as protection. The bound is hand-typed WELL BELOW the real figure (15 at
    // the time of writing) so ordinary growth never touches it; this is the same
    // idiom as `seam-ssr-exposure.pin.test.ts:186`.
    expect(
      SEAM_ROUTE_PATHS.length,
      `The seam-route derivation found almost nothing, so every seam ` +
        `classification below is vacuously "not a seam route". Fix the walker ` +
        `before trusting this file.`,
    ).toBeGreaterThanOrEqual(12);

    // Hand-typed positive members. If the derivation started producing the wrong
    // SHAPE of path (e.g. keeping the `src/app/` prefix, or the `/route.ts`
    // suffix), the length bound above would still pass and every URL would
    // classify as safe. These two pin the shape.
    expect(SEAM_ROUTE_PATHS).toContain("/api/keys/sync");
    expect(SEAM_ROUTE_PATHS).toContain("/api/scenario/optimize");

    // Hand-typed negative member: the tick's real target is NOT a seam route.
    // Measured at HEAD: `src/app/api/strategies/[id]/sync-progress/route.ts`
    // imports no seam module. If it ever acquires one, this pin must be revisited
    // rather than silently satisfied — the poll would then BE a seam caller.
    expect(SEAM_ROUTE_PATHS).not.toContain("/api/strategies/[id]/sync-progress");
  });

  it("the route matcher matches a seam route and NOT a near-miss", () => {
    // The NEGATIVE half is the load-bearing one. A matcher that answered "true"
    // for anything under /api/ would make the tick assertion below red on a
    // clean tree, and the natural "fix" for a guard that cries wolf is to weaken
    // it until it stops complaining. Both polarities are pinned so neither can
    // drift.
    const m = (u: string) => isSeamRoutePath(u, SEAM_ROUTE_PATHS);

    // POSITIVE — the canonical seam route the kickoff legitimately calls.
    expect(m("/api/keys/sync")).toBe(true);
    // POSITIVE — a dynamic segment matched as a wildcard (the alternate
    // spelling; `/api/keys/[id]/permissions` is a real seam route).
    expect(m("/api/keys/abc-123/permissions")).toBe(true);
    // POSITIVE — depth-3 vs depth-4 handling.
    expect(m("/api/strategies/composite/add-key")).toBe(true);
    // POSITIVE — query strings are stripped before matching.
    expect(m("/api/keys/sync?x=1")).toBe(true);

    // NEGATIVE — THE LOAD-BEARING ONE. This is the LIVE tick target. It has the
    // same segment COUNT as the seam route `/api/strategies/composite/add-key`
    // and differs only at segment 3, so it forces the matcher to be
    // route-specific rather than "any /api/ URL" or "anything under
    // /api/strategies".
    expect(m("/api/strategies/composite-strat-1/sync-progress")).toBe(false);
    // NEGATIVE — superstring. `includes()`/`startsWith()` would call this a seam
    // route.
    expect(m("/api/keys/syncing")).toBe(false);
  });

  it("the poll tick issues at least one network call (POSITIVE control)", async () => {
    const { tickCalls } = await runKickoffThenTicks();

    // The M77c lesson made structural: for a guard, "no violation found" is
    // produced EQUALLY by a clean codebase and by a dead subject. A poll that
    // stopped calling anything at all satisfies the next case trivially, and a
    // reader would see green and conclude the fence held. This case is what
    // makes the next one non-vacuous — it is falsified by ledger row M86b, which
    // deletes the tick's fire-and-forget call and must turn THIS case red.
    expect(
      tickCalls.length,
      `The poll tick issued NO network call at all, so the seam-disjointness ` +
        `assertion that follows is vacuously true. Either the progress ` +
        `piggyback was removed (in which case delete this pin deliberately, ` +
        `with the reason written down) or the harness stopped driving the poll.`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("NO tick-phase call targets a seam route", async () => {
    const { tickCalls } = await runKickoffThenTicks();
    const offenders = tickCalls.filter((u) => isSeamRoutePath(u, SEAM_ROUTE_PATHS));

    expect(
      offenders,
      `The wizard sync-poll TICK now targets a seam route. The poll ticks every ` +
        `3-10 seconds for up to fifteen minutes, in every open tab. During an ` +
        `analytics outage each tick records a failure, the breaker re-arms ` +
        `continuously, and the poll itself becomes the thing keeping the ` +
        `circuit open — the outage is extended by our own recovery UI, and the ` +
        `more users are waiting the longer it lasts. The kickoff may call the ` +
        `seam (it is one user action); the TICK may not. Read what the tick ` +
        `needs from Supabase, which is where the worker writes the result ` +
        `anyway, or from a route that does not import a seam client.`,
    ).toEqual([]);
  });

  it("the KICKOFF does target a seam route — the property is tick-scoped, not file-scoped", async () => {
    const { kickoffCalls } = await runKickoffThenTicks();

    // THE HONESTY CASE. The source pin this file replaces claimed "ZERO fetch
    // calls exist on the poll path". That was false, and this case is the
    // executable record of WHY: the kickoff is a real, deliberate, user-initiated
    // seam call from the very same file. Anyone who later "simplifies" this pin
    // back into a file-scoped source scan has to make this case fail first —
    // which is the conversation the old pin never forced.
    const kickoffSeamCalls = kickoffCalls.filter((u) =>
      isSeamRoutePath(u, SEAM_ROUTE_PATHS),
    );

    expect(
      kickoffCalls.some((u) => u.includes("/api/keys/sync")),
      `The kickoff no longer POSTs /api/keys/sync. That is not a safety ` +
        `regression, but it invalidates this file's phase split: the "mark" that ` +
        `separates kickoff from tick was calibrated on that call.`,
    ).toBe(true);

    expect(
      kickoffSeamCalls.length,
      `The kickoff's /api/keys/sync no longer classifies as a seam route, so ` +
        `the matcher has drifted — and a matcher that under-reports makes the ` +
        `tick assertion pass for the wrong reason.`,
    ).toBeGreaterThanOrEqual(1);
  });
});
