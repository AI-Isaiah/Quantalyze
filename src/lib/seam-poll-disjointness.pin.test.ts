import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 140.3 / plan 16 — NEGATIVE PIN: the poll paths are structurally
 * disjoint from the breaker-feeding paths.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The wizard's sync poll runs every few seconds for up to fifteen minutes while
 * a strategy computes. **It reads Supabase directly and never calls the seam.**
 * The stall backstop that decides "this has taken too long" is wall-clock
 * arithmetic over `RETRY_THRESHOLD_MS`, not a seam response.
 *
 * That disjointness is why **no retry storm is possible from the poll.** If the
 * poll went through a seam route, then during an analytics outage every waiting
 * wizard in every open tab would hammer the seam on a 3–10 second cadence:
 * each tick would record a failure, the breaker would re-arm continuously, and
 * the poll would itself become the thing keeping the circuit open. The outage
 * would be extended by our own recovery UI, and the more users were affected
 * the longer it would last.
 *
 * Nothing enforced that. This file is the fence.
 *
 * ⚠️ THE ONE RULE THAT MAKES THIS FILE WORK
 * -----------------------------------------
 * **Every expectation below is a hand-typed literal**, including the roster of
 * poll modules and the expected call count. `expect(found.length).toBe(
 * discovered.length)` is the shape to forbid — it is satisfied by any list,
 * including one that has silently grown a seam call, and it reads as coverage
 * while asserting nothing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PIN DOES **NOT** PROVE — read this before trusting it
 * ═══════════════════════════════════════════════════════════════════════════
 * This is the honest part, and it matters more than the assertions.
 *
 *  1. **It is a SOURCE scan over a HAND-TYPED roster of three files.** It proves
 *     those three modules contain no seam call. It does NOT prove no other
 *     component in the repo polls anything — a fourth poller added tomorrow in a
 *     new file is invisible here until someone adds it to the roster. The roster
 *     is hand-typed on purpose (see the rule above), and that choice buys
 *     falsifiability at the cost of coverage. Both halves are stated.
 *  2. **It checks DIRECT calls and DIRECT import edges only.** A poll module
 *     that called a local helper which in turn called the seam would pass. There
 *     is no such helper today; there is also no graph walk here that would find
 *     one.
 *  3. **It does not prove the poll is harmless in general** — only that it
 *     cannot feed the breaker. Poll cadence, Supabase load, and the fifteen-
 *     minute patience window are all outside this file.
 *  4. **It proves nothing about runtime.** It observes that the code has no way
 *     to call the seam from a poll tick, not that a tick was observed doing so.
 *  5. **The wall-clock assertion is structural.** It pins that the stall
 *     threshold is a numeric constant compared against elapsed time. It does not
 *     prove the timer is correct, only that its input is a clock rather than a
 *     seam response.
 *
 * A pin that overclaims is worse than no pin, because the next reader stops
 * checking. The five limits above are the reason this docblock is longer than
 * the assertions.
 */

/**
 * Hand-typed roster: every module on the wizard sync-poll path.
 *
 * - `useStrategySyncPoller.ts` is the poll ENGINE — the self-scheduling timer,
 *   the status read and the consecutive-error escalation all live here.
 * - `SyncPreviewStep.tsx` is the wizard's consumer of that engine, and the file
 *   that owns the fifteen-minute stall backstop.
 * - `SyncProgress.tsx` is the engine's OTHER consumer, outside the wizard. It is
 *   on the roster precisely because it is the one a reader thinking only about
 *   the wizard would forget, and a poller is dangerous wherever it runs.
 *
 * ⚠️ TYPED OUT, NOT DISCOVERED. A roster built by grepping for "poll" is the
 * grep again, and would silently admit a module that stopped matching.
 */
const POLL_PATH_MODULES: readonly string[] = [
  "src/hooks/useStrategySyncPoller.ts",
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
  "src/components/strategy/SyncProgress.tsx",
];

/**
 * Hand-typed. The number of network calls the poll path may make: none.
 *
 * The poll's ONLY data source is the Supabase browser client, which talks to
 * PostgREST and has nothing to do with the analytics seam or its breaker.
 */
const EXPECTED_FETCH_CALLS_ON_POLL_PATH = 0;

/** The three modules through which every seam call in this repo is made. */
const SEAM_MODULES = [
  "analytics-client",
  "resilient-fetch",
  "process-key-client",
] as const;

/** Matches the IMPORT EDGE, never a bare mention — see the SSR pin for why. */
const SEAM_IMPORT_EDGE = new RegExp(
  `from\\s*["'](?:@/lib/|\\./|\\.\\./)?(?:lib/)?(?:${SEAM_MODULES.join("|")})["']`,
);

/** The data source the poll is allowed to have. */
const SUPABASE_CLIENT_EDGE = /from\s*["']@\/lib\/supabase\/client["']/;

/**
 * Strip comments before matching.
 *
 * ⚠️ NOT COSMETIC HERE. `SyncPreviewStep.tsx` carries a docblock that names
 * `process-key-client` while explaining the envelope it renders, and this file's
 * own subject matter guarantees more such prose over time. An unstripped scan
 * would report a comment as a seam call — and the natural "fix" for a guard that
 * cries wolf is to delete it.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

const SOURCE = new Map<string, string>(
  POLL_PATH_MODULES.map((f) => [
    f,
    stripComments(readFileSync(join(process.cwd(), f), "utf8")),
  ]),
);

describe("[140.3-16] NEGATIVE PIN: the poll path makes no seam call", () => {
  it("the roster is exactly three modules, and each one was actually read", () => {
    // Fail-loud: a renamed or moved file must break this pin rather than
    // silently reduce it to a scan over nothing. `readFileSync` above already
    // throws on a missing path; this pins the SIZE so a deletion is visible too.
    expect(POLL_PATH_MODULES).toHaveLength(3);
    for (const file of POLL_PATH_MODULES) {
      expect(
        (SOURCE.get(file) ?? "").length,
        `${file} read as empty. The scan below would be vacuous.`,
      ).toBeGreaterThan(500);
    }
  });

  it("ZERO fetch calls exist on the poll path — pinned to a hand-typed 0", () => {
    const offenders = POLL_PATH_MODULES.filter((file) =>
      /\bfetch\s*\(/.test(SOURCE.get(file) ?? ""),
    );

    expect(
      offenders,
      `A fetch call appeared on the wizard sync-poll path. The poll ticks every ` +
        `3-10 seconds for up to fifteen minutes, in every open tab. If a tick ` +
        `can reach a seam route then during an analytics outage the poll itself ` +
        `records failures on that cadence, re-arms the breaker continuously, and ` +
        `becomes the thing keeping the circuit open — the outage is extended by ` +
        `our own recovery UI, and the more users are waiting the longer it ` +
        `lasts. Read what you need from Supabase, which is where the worker ` +
        `writes the result anyway.`,
    ).toEqual([]);

    expect(offenders.length).toBe(EXPECTED_FETCH_CALLS_ON_POLL_PATH);
  });

  it("no poll module imports a seam client", () => {
    const offenders = POLL_PATH_MODULES.filter((file) =>
      SEAM_IMPORT_EDGE.test(SOURCE.get(file) ?? ""),
    );

    expect(
      offenders,
      `A poll module imports a seam client directly. Even without a call today ` +
        `this is the edge that makes one a one-line change, and the whole ` +
        `property here is structural distance rather than discipline.`,
    ).toEqual([]);
  });

  it("the poll's data source is the Supabase browser client, at every module that reads", () => {
    // The positive counterpart. "No seam call" is an absence, and an absence is
    // also what a deleted poll produces — the M77c lesson from this phase's own
    // ledger. This asserts the mechanism that is SUPPOSED to be there, so a poll
    // that stopped reading anything at all cannot pass as a poll that reads
    // safely.
    const readers = POLL_PATH_MODULES.filter((file) =>
      SUPABASE_CLIENT_EDGE.test(SOURCE.get(file) ?? ""),
    );

    expect(
      readers,
      `Every module on this roster reads its data from @/lib/supabase/client. ` +
        `If one stopped, either the roster is stale or the poll acquired a new ` +
        `data source — and the second of those is the case this pin exists for.`,
    ).toEqual([
      "src/hooks/useStrategySyncPoller.ts",
      "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
      "src/components/strategy/SyncProgress.tsx",
    ]);
  });
});

describe("[140.3-16] NEGATIVE PIN: the stall backstop is wall-clock, not seam-driven", () => {
  const STEP = "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx";

  it("RETRY_THRESHOLD_MS is a numeric constant, not a value read off a response", () => {
    // Hand-typed on both sides: the name AND the number. If the patience window
    // is ever retuned, this literal changes in the same commit — which is the
    // point of pinning a number rather than asserting that some number exists.
    const src = SOURCE.get(STEP) ?? "";
    expect(
      src,
      `The stall threshold stopped being a local numeric constant. If it now ` +
        `comes from a response, the backstop is seam-driven: during an outage ` +
        `the very signal that should trigger "this is taking too long" is the ` +
        `signal that is missing.`,
    ).toContain("const RETRY_THRESHOLD_MS = 900_000;");
  });

  it("the retry affordance is gated on ELAPSED TIME, not on a seam status", () => {
    const src = SOURCE.get(STEP) ?? "";
    expect(
      src,
      `The wizard's retry affordance is no longer driven by elapsed wall-clock ` +
        `time. This is the client-side timer that C-7 in this phase's CONTEXT ` +
        `records as the real mechanism behind what reads like a "retry after" — ` +
        `none of the four wizard surfaces reads a Retry-After header here, and ` +
        `a change that made one do so needs to be a deliberate, reviewed one.`,
    ).toContain("elapsedMs >= RETRY_THRESHOLD_MS");
  });
});
