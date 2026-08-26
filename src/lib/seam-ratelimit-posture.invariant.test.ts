// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

/**
 * 140.4-13 / SEAMRIM-05 — A LIMITER MISCONFIGURATION IS NOT A THROTTLE.
 *
 * ── WHAT THIS FILE EXISTS TO STOP ────────────────────────────────────────────
 *
 * Every seam route runs `checkLimit` FIRST, before it ever reaches the
 * analytics service. When Upstash is unreachable, `checkLimit` answers
 * `{success: false, reason: "ratelimit_misconfigured"}` — a fail-CLOSED denial
 * that means "we could not consult the cap", not "you exceeded it".
 *
 * Measured on the untouched tree at the start of this plan: of the 15 seam
 * routes, **3** translated that into a 503 (`bridge`, `simulator`,
 * `strategies/finalize-wizard`), **11** answered **429**, and 1 has no limiter.
 * A 429 says the CALLER is being throttled. On `create-with-key` and
 * `composite/add-key` the wizard renders that as `KEY_RATE_LIMIT`, whose copy
 * reads *"a transient, exchange-side throttle and not a problem with your
 * key"* — so during our own outage we told every user, on their first click,
 * that their exchange was throttling them. And because a 429 is not a 5xx, the
 * canary watching for outages never saw it.
 *
 * ⚠️ THE BREAKER BESIDE THE LIMITER CANNOT COVER FOR THIS. The limiter runs
 * first, so during an Upstash outage the seam call never happens and the
 * breaker never trips. The 429 was the only signal there was.
 *
 * ── WHY THE FIX WAS AN ADOPTION, NOT ELEVEN NEW PREDICATE CALLS ──────────────
 *
 * `rateLimitDenyJson` already made this decision for 9 other routes and 2
 * wrappers — and zero seam routes. Its own docblock said why: *"routes whose
 * tests `vi.mock("@/lib/ratelimit")` still inline the branch to keep their
 * existing mocks intact."* Test-mock convenience is what kept the seam off the
 * artefact. That justification has been replaced in the source with what is now
 * true; this file is the receipt that the adoption HOLDS.
 *
 * ── HONEST STATEMENT OF SCOPE — READ THIS BEFORE TRUSTING THE FILE ───────────
 *
 * This guard has two halves and they cover different things.
 *
 *   STRUCTURAL (all 15 routes, derived from disk every run). Proves that every
 *   seam route that consumes a rate-limit token routes its DENY through the
 *   chokepoint, and that it does so ONCE PER ARM. A new seam route that inlines
 *   a 429-only arm fails here BY NAME on the day it is written. What it cannot
 *   prove is that the 503 actually reaches the wire — it reads source, not
 *   responses.
 *
 *   BEHAVIOURAL (3 of the 15). Drives real handlers and asserts the status and
 *   body a client would receive. Three routes, chosen to span the three auth
 *   shapes the seam has — PUBLIC/anonymous (`verify-strategy`), AUTHENTICATED
 *   (`keys/sync`, which is also the only route with TWO arms) and ADMIN
 *   (`admin/match/recompute`).
 *
 * ⚠️ A FULL 15-ROUTE BEHAVIOURAL TABLE IS NOT WHAT IS MISSING HERE, AND SAYING
 * SO MATTERS. Each route needs its own fixture — different auth wrapper,
 * different required body, different downstream mocks — so a "table" would be
 * fifteen bespoke stacks, each free to drift from its route. The remaining
 * twelve are covered structurally here AND behaviourally in their own
 * `route.test.ts` files, where their real fixtures already live. A guard that
 * implied behavioural coverage it does not have would be worse than one that
 * states its boundary.
 */

// ---------------------------------------------------------------------------
// PART 1 — THE STRUCTURAL HALF. Population DERIVED FROM DISK, never hand-typed.
// ---------------------------------------------------------------------------

/** The three modules through which every seam call in this repo is made. */
const SEAM_MODULES = [
  "analytics-client",
  "resilient-fetch",
  "process-key-client",
] as const;

/**
 * Matches the IMPORT EDGE, never a bare mention.
 *
 * Duplicated (not imported) from `seam-poll-disjointness.pin.test.ts` on
 * purpose: a test file must not import another test file, and two independent
 * scanners that agree are worth more than one shared helper whose single bug
 * blinds both tiers.
 */
const SEAM_IMPORT_EDGE = new RegExp(
  `from\\s*["'](?:@/lib/|\\./|\\.\\./)?(?:lib/)?(?:${SEAM_MODULES.join("|")})["']`,
);

/**
 * Strip comments before counting.
 *
 * ⚠️ THIS IS LOAD-BEARING, NOT COSMETIC, AND IT IS A REAL SHAPE IN THIS EXACT
 * POPULATION. `admin/match/eval/route.ts` and `admin/match/recompute/route.ts`
 * both carry the line *"Same pairing as rateLimitDenyJson (…)"* in a COMMENT.
 * Until 146-01 `eval` had no limiter at all, so an unstripped scan read it as
 * adopting the chokepoint and reported this class closed while it was open —
 * the precise way a source guard becomes worse than no guard. (eval now has a
 * real `checkLimit` + builder call, but the comment-strip stays load-bearing:
 * the prose mention would otherwise inflate its per-arm deny count.) Both
 * polarities are self-tested below.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

function countMatches(src: string, re: RegExp): number {
  return src.match(re)?.length ?? 0;
}

/** Rate-limit token consumption sites. */
const CHECK_LIMIT_CALL = /\bcheckLimit\s*\(/g;

/**
 * The limiter IDENTITY at each consumption site — the first argument to
 * `checkLimit`, captured in source order.
 *
 * ⚠️ ADDED BY PHASE 163 SEC-04 BECAUSE THE ROSTER ABOVE CANNOT SEE A SWAP.
 * `EXPECTED_LIMITER_ROUTES` pins which routes consume A limiter; it says
 * nothing about WHICH ONE. Both `bridge` and `portfolio-optimizer` were
 * already members before SEC-04 moved them off the shared `userActionLimiter`
 * onto `bridgeComputeLimiter`, so the whole swap landed with this file GREEN —
 * measured, not assumed: the suite was run against the swapped tree before
 * this pin existed and reported 24/24 passing. A limiter can therefore be
 * changed, or quietly reverted, without anything here failing. That is the
 * hole this captures.
 */
const CHECK_LIMIT_LIMITER = /\bcheckLimit\s*\(\s*([A-Za-z_$][\w$]*)/g;

function captureAll(src: string, re: RegExp): string[] {
  return [...src.matchAll(re)].map((m) => m[1]);
}

/**
 * Sites where the 503-vs-429 decision is made by the ARTEFACT rather than by an
 * inlined status literal. Either builder counts, and so does a direct
 * `isRateLimitMisconfigured` branch — that predicate lives inside
 * `src/lib/ratelimit.ts` and is the single source of the decision the builders
 * themselves call, so a route applying it directly (as `bridge`, `simulator`
 * and `finalize-wizard` do) is holding the same property.
 */
const DENY_ROUTED_CALL =
  /\b(?:rateLimitDenyJson|rateLimitDenyText|isRateLimitMisconfigured)\s*\(/g;

interface RouteScan {
  /** Repo-relative path, e.g. `src/app/api/keys/sync/route.ts`. */
  path: string;
  checkLimitSites: number;
  denyRoutedSites: number;
  /** Limiter identifier per `checkLimit` site, in source order. */
  limiters: string[];
}

function deriveSeamRouteFiles(apiRoot: string): string[] {
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
      if (!SEAM_IMPORT_EDGE.test(readFileSync(join(process.cwd(), rel), "utf8")))
        continue;
      paths.push(rel);
    }
  };
  walk(apiRoot);
  return paths.sort();
}

function scanRoute(path: string): RouteScan {
  const src = stripComments(readFileSync(join(process.cwd(), path), "utf8"));
  return {
    path,
    checkLimitSites: countMatches(src, CHECK_LIMIT_CALL),
    denyRoutedSites: countMatches(src, DENY_ROUTED_CALL),
    limiters: captureAll(src, CHECK_LIMIT_LIMITER),
  };
}

const SEAM_ROUTE_FILES = deriveSeamRouteFiles("src/app/api");
const SCANS = SEAM_ROUTE_FILES.map(scanRoute);
const LIMITER_ROUTES = SCANS.filter((s) => s.checkLimitSites > 0);
const NO_LIMITER_ROUTES = SCANS.filter((s) => s.checkLimitSites === 0);

/**
 * The seam routes that consume a rate-limit token. HAND-TYPED, and compared
 * against the from-disk derivation above.
 *
 * ⚠️ HAND-TYPED ON PURPOSE. Deriving both sides would be two scanners agreeing
 * with each other, which is not evidence. A new seam route with a limiter fails
 * this equality BY NAME, which forces a conscious decision about its deny arm
 * rather than letting it inherit whatever the author typed.
 */
const EXPECTED_LIMITER_ROUTES: readonly string[] = [
  // 146-01 / RATE-02: eval gained the sibling recompute's adminActionLimiter
  // (20/min, keyed `match-eval:<user.id>`) with a chokepoint-routed deny; the
  // NO_LIMITER_QUARANTINE below shrank to [] in the SAME commit, as its
  // docblock always demanded.
  "src/app/api/admin/match/eval/route.ts",
  "src/app/api/admin/match/recompute/route.ts",
  "src/app/api/bridge/route.ts",
  "src/app/api/keys/[id]/permissions/route.ts",
  "src/app/api/keys/sync/route.ts",
  "src/app/api/keys/validate-and-encrypt/route.ts",
  "src/app/api/portfolio-optimizer/route.ts",
  "src/app/api/scenario/optimize/route.ts",
  "src/app/api/simulator/route.ts",
  "src/app/api/strategies/composite/add-key/route.ts",
  "src/app/api/strategies/create-with-key/route.ts",
  // Phase 145 (D-06 i-b): csv-finalize left the seam import edge (direct fold
  // RPC). Its limiter deny still routes through rateLimitDenyJson — pinned by
  // route.test.ts's SEAMRIM-05 describe — it is simply no longer a member of
  // this file's seam-route population.
  "src/app/api/strategies/csv-validate/route.ts",
  "src/app/api/strategies/finalize-wizard/route.ts",
  "src/app/api/verify-strategy/route.ts",
];

/**
 * Seam routes with NO limiter, quarantined by an EQUALITY rather than a
 * containment check.
 *
 * EMPTY SINCE 146-01 / RATE-02. `admin/match/eval` was the one genuine
 * no-limiter row; it now reuses the sibling recompute's `adminActionLimiter`
 * with a chokepoint-routed deny, and this quarantine SHRANK IN THE SAME
 * COMMIT as that change — exactly what the equality below exists to force.
 * The shape remains `analytics-service/tests/test_limiter_identity.py`'s, and
 * so does its reason: a containment check would let a stale exemption outlive
 * the thing it exempted, and a NEW entry appearing here means an UNLIMITED
 * seam route — decide whether that is intended and write the reason down
 * beside this roster.
 */
const NO_LIMITER_QUARANTINE: readonly string[] = [];

/**
 * WHICH limiter each seam route consumes, per arm, in source order.
 * HAND-TYPED, and compared against the from-disk derivation.
 *
 * ⚠️ ADDED BY PHASE 163 SEC-04. The roster above answers "does this route have
 * a limiter"; this one answers "which one, and is that still the one someone
 * decided on". Those are different questions, and only the second one can see
 * a route being moved between buckets — including being moved BACK.
 *
 * ── WHY A SEPARATE PIN WAS NEEDED, MEASURED NOT ASSUMED ──────────────────────
 * SEC-04 moved `bridge` and `portfolio-optimizer` off the shared
 * `userActionLimiter` (5/60s = 300/hour/user) onto `bridgeComputeLimiter`
 * (10/3600s), because the Python side serves 10/hour per TENANT and a front
 * door promising 30x that cannot emit a truthful `Retry-After`. Both routes
 * were ALREADY members of `EXPECTED_LIMITER_ROUTES`, so the entire swap landed
 * with this file green — the suite was run against the swapped tree before this
 * pin existed and reported 24/24 passing. A guard that cannot see the change it
 * is supposed to be guarding is the shape this repo treats as worse than none.
 *
 * ── FALSIFIABILITY: neuter -> RED -> restore (performed, not imagined) ───────
 * Reverting `src/app/api/bridge/route.ts` to `checkLimit(userActionLimiter, …)`
 * turns the equality below RED and names the route and both limiters:
 *   - src/app/api/bridge/route.ts: derived=[userActionLimiter] pinned=[bridgeComputeLimiter]
 * Restored immediately after observing it. The other assertions in this file
 * stay GREEN under that same mutation, which is precisely why this one exists.
 *
 * ⚠️ A LIMITER CHANGE MUST MOVE THIS PIN IN THE SAME COMMIT — the standing repo
 * rule for limiter literals. If you are here because the equality failed, do not
 * relax it: decide whether the route belongs in its new bucket, then retype it.
 */
const EXPECTED_ROUTE_LIMITERS: ReadonlyArray<readonly [string, string[]]> = [
  ["src/app/api/admin/match/eval/route.ts", ["adminActionLimiter"]],
  ["src/app/api/admin/match/recompute/route.ts", ["adminActionLimiter"]],
  // Phase 163 SEC-04 — moved off userActionLimiter. Sized from the MEASURED
  // effective backend budget (slowapi "10/hour" per tenant x 1 measured
  // replica); see the limiter's docblock in `src/lib/ratelimit.ts`.
  ["src/app/api/bridge/route.ts", ["bridgeComputeLimiter"]],
  ["src/app/api/keys/[id]/permissions/route.ts", ["userActionLimiter"]],
  // TWO arms, TWO different limiters — the per-(user,strategy) fairness bucket
  // and the per-user aggregate ceiling. Order is source order.
  ["src/app/api/keys/sync/route.ts", ["keysSyncUserLimiter", "userActionLimiter"]],
  ["src/app/api/keys/validate-and-encrypt/route.ts", ["userActionLimiter"]],
  ["src/app/api/portfolio-optimizer/route.ts", ["bridgeComputeLimiter"]],
  // ⛔ DELIBERATELY NOT MOVED BY SEC-04. `scenario/optimize` calls a DIFFERENT
  // backend (`/optimize-weights`), whose per-tenant floor is a separately
  // booked item (L-9). Folding it in here would have been scope creep, and
  // this line is where that decision stays visible.
  ["src/app/api/scenario/optimize/route.ts", ["userActionLimiter"]],
  ["src/app/api/simulator/route.ts", ["simulatorLimiter"]],
  ["src/app/api/strategies/composite/add-key/route.ts", ["userActionLimiter"]],
  // Two arms, same limiter (create + kickoff paths).
  [
    "src/app/api/strategies/create-with-key/route.ts",
    ["userActionLimiter", "userActionLimiter"],
  ],
  ["src/app/api/strategies/csv-validate/route.ts", ["csvValidateLimiter"]],
  ["src/app/api/strategies/finalize-wizard/route.ts", ["userActionLimiter"]],
  ["src/app/api/verify-strategy/route.ts", ["publicIpLimiter"]],
];

describe("[140.4-13 / SEAMRIM-05] structural — every seam limiter deny goes through the chokepoint", () => {
  it("the scan is not vacuous (a scanner that matched nothing would report agreement forever)", () => {
    // ⚠️ THE FENCE, NOT THE MEASUREMENT. Measured at plan time: 15 seam routes
    // carrying 15 `checkLimit` sites (`keys/sync` has two); re-measured at
    // Phase 145: 14 routes (csv-finalize left the seam — direct fold RPC).
    // The bounds below are
    // deliberately looser than those numbers so ordinary growth does not redden
    // the file — what they exist to catch is a walker that stopped walking or a
    // needle that stopped matching, either of which makes every set equality
    // below trivially true.
    expect(
      SEAM_ROUTE_FILES.length,
      "The seam-route walk found fewer than 14 routes. `SEAM_IMPORT_EDGE` " +
        "stopped matching, or the walker's root moved. Every assertion in this " +
        "file is now vacuous — a guard that scans nothing agrees with " +
        "everything, forever.",
    ).toBeGreaterThanOrEqual(14);

    const totalCheckLimitSites = SCANS.reduce(
      (n, s) => n + s.checkLimitSites,
      0,
    );
    expect(
      totalCheckLimitSites,
      "Fewer than 12 `checkLimit` call sites were found across the seam. The " +
        "call needle stopped matching (a rename, a wrapper), so the " +
        "compliance partition below is measuring an empty population.",
    ).toBeGreaterThanOrEqual(12);
  });

  it("the derived limiter population matches the hand-typed roster (a new seam route fails BY NAME)", () => {
    expect(
      LIMITER_ROUTES.map((s) => s.path),
      "The set of seam routes consuming a rate-limit token drifted from the " +
        "roster hand-typed in this file. A route added here is a route whose " +
        "deny arm nobody reviewed. Add it to the roster in the SAME commit " +
        "that adds its limiter — and give it a chokepoint-routed deny while " +
        "you are there, or the next assertion will tell you so.",
    ).toEqual([...EXPECTED_LIMITER_ROUTES]);
  });

  it("[163 SEC-04] every arm consumes the limiter it was PINNED to (a swap fails BY NAME)", () => {
    // The needle must actually have found identifiers, or an empty-vs-empty
    // comparison agrees forever. Pinned lower than the real population so
    // ordinary growth does not redden the file.
    const derivedNames = LIMITER_ROUTES.flatMap((s) => s.limiters);
    expect(
      derivedNames.length,
      "`CHECK_LIMIT_LIMITER` captured no limiter identifiers. The first " +
        "argument to `checkLimit` stopped matching (a rename, a wrapper, a " +
        "destructure), so the identity equality below is comparing two empty " +
        "shapes and agrees with everything.",
    ).toBeGreaterThanOrEqual(12);

    // Every arm must be accounted for: a route with 2 `checkLimit` sites must
    // yield 2 identifiers, or one arm's limiter is invisible to the pin.
    const arity = LIMITER_ROUTES.filter(
      (s) => s.limiters.length !== s.checkLimitSites,
    ).map((s) => `${s.path} (${s.limiters.length}/${s.checkLimitSites} named)`);
    expect(
      arity,
      "A route consumes more rate-limit tokens than this scan could name " +
        "limiters for. The unnamed arm could be on ANY bucket and the " +
        "equality below would not see it.",
    ).toEqual([]);

    const derived = LIMITER_ROUTES.map(
      (s) => [s.path, s.limiters] as readonly [string, string[]],
    );
    expect(
      derived,
      "A seam route consumes a DIFFERENT limiter than the one pinned in this " +
        "file. This is the assertion that sees a bucket swap — including a " +
        "revert. `EXPECTED_LIMITER_ROUTES` above cannot: it pins which routes " +
        "have a limiter, not which one, so moving a route between buckets " +
        "leaves it green. Decide whether the new bucket is right (does its " +
        "size tell the truth about the backend budget behind this route?) and " +
        "retype the pin IN THE SAME COMMIT.",
    ).toEqual(EXPECTED_ROUTE_LIMITERS.map(([p, l]) => [p, l]));
  });

  it("[163 SEC-04] the identity needle self-test — BOTH polarities", () => {
    // POSITIVE: the first argument is captured, not merely detected.
    const positive = captureAll(
      stripComments(`
        const rl = await checkLimit(bridgeComputeLimiter, \`bridge:\${user.id}\`);
        const rl2 = await checkLimit( keysSyncUserLimiter , key);
      `),
      new RegExp(CHECK_LIMIT_LIMITER.source, "g"),
    );
    expect(positive).toEqual(["bridgeComputeLimiter", "keysSyncUserLimiter"]);

    // NEGATIVE: a limiter named only in PROSE is not captured. Without the
    // comment strip, the docblocks in these routes (which quote the limiter
    // they moved AWAY from) would be read as consumption — the same DEF-16-2
    // shape the deny-arm scan already guards against, and a live one here:
    // `portfolio-optimizer/route.ts` names `userActionLimiter` in a comment
    // explaining why it no longer uses it.
    const negative = captureAll(
      stripComments(`
        // Phase 163 SEC-04: this route no longer calls checkLimit(userActionLimiter, key).
        /* previously: checkLimit(userActionLimiter, key) */
        const rl = await checkLimit(bridgeComputeLimiter, key);
      `),
      new RegExp(CHECK_LIMIT_LIMITER.source, "g"),
    );
    expect(negative).toEqual(["bridgeComputeLimiter"]);
  });

  it("EVERY limiter route routes its deny through the artefact — ONCE PER ARM", () => {
    // ⚠️ PER ARM, NOT PER FILE. `keys/sync` has TWO `checkLimit` sites. A check
    // that only asked "does this FILE mention `rateLimitDenyJson`?" stays green
    // with the SECOND arm reverted to an inlined 429, because the first arm
    // still does — the file-level check would certify a half-fixed route. This
    // plan's Falsifiability Ledger row M105 runs exactly that mutation.
    const underRouted = LIMITER_ROUTES.filter(
      (s) => s.denyRoutedSites < s.checkLimitSites,
    ).map((s) => `${s.path} (${s.denyRoutedSites}/${s.checkLimitSites} arms)`);

    expect(
      underRouted,
      "A seam route consumes more rate-limit tokens than it has " +
        "chokepoint-routed deny arms. At least one arm decides 503-vs-429 " +
        "with an inlined status literal, so a limiter MISCONFIGURATION on that " +
        "arm answers 429 — telling the user they are being throttled during " +
        "OUR outage, and hiding the outage from the canary that watches 5xx. " +
        "Route the arm through `rateLimitDenyJson` (passing its existing 429 " +
        "body and headers verbatim); do NOT relax this assertion to a " +
        "per-file check.",
    ).toEqual([]);
  });

  it("the no-limiter set EQUALS the quarantine (a repair must shrink it in the same commit)", () => {
    expect(
      NO_LIMITER_ROUTES.map((s) => s.path),
      "The set of seam routes with NO rate limiter changed. This is an " +
        "EQUALITY, not a containment check, and that is deliberate: if " +
        "`admin/match/eval` is ever given a limiter, the quarantine must " +
        "SHRINK in the same commit, so a repair cannot leave a stale exemption " +
        "behind. If a NEW route appears here it is an unlimited seam route — " +
        "decide whether that is intended and write the reason down beside the " +
        "roster.",
    ).toEqual([...NO_LIMITER_QUARANTINE]);
  });

  it("the partition is total (every derived seam route is classified exactly once)", () => {
    expect(LIMITER_ROUTES.length + NO_LIMITER_ROUTES.length).toBe(
      SEAM_ROUTE_FILES.length,
    );
    expect(
      [...LIMITER_ROUTES, ...NO_LIMITER_ROUTES].map((s) => s.path).sort(),
    ).toEqual([...SEAM_ROUTE_FILES].sort());
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 140.4-16 / WR-11 — the fact three docblocks rest on, finally asserted.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Extract the STRING LITERAL members of a named roster declaration, from disk.
 *
 * ⚠️ WHY FROM DISK AND NOT BY IMPORT. None of the four rosters is exported, and
 * exporting three module-private constants so a test can read them would widen
 * production surface for the test's convenience. More importantly, a disk scan
 * catches a roster this file has never heard of: the failure mode WR-11 names
 * is a FUTURE edit adding `RATE_LIMITED` to one of these lists, and the same
 * edit could equally mint a fifth roster at a fourth surface. The scan finds
 * any `const KNOWN_*_CODES`, so it does not need to be told.
 *
 * Comment-stripped first (DEF-16-2): a roster's own docblock quotes the very
 * code names being counted, and a raw scan would read those quotations as
 * members.
 */
function extractRosters(
  path: string,
): Array<{ name: string; answers: Map<string, string> }> {
  const lines = stripComments(
    readFileSync(join(process.cwd(), path), "utf8"),
  ).split("\n");
  const out: Array<{ name: string; answers: Map<string, string> }> = [];
  for (let i = 0; i < lines.length; i++) {
    const decl = /const\s+(KNOWN_[A-Z0-9_]*CODES)\b/.exec(lines[i]);
    if (!decl) continue;
    // Line-scan to the initializer's terminator rather than regexing across it:
    // the two shapes end `]);` and `};`, and a non-greedy `[\s\S]*?` across
    // either one silently swallows the NEXT declaration — which is how the
    // first draft of this scan found three rosters where four exist.
    const body: string[] = [];
    for (let j = i; j < lines.length; j++) {
      body.push(lines[j]);
      if (/^\s*(\]\s*\)|\]|\})\s*;\s*$/.test(lines[j])) break;
    }
    const block = body.join("\n");
    const answers = new Map<string, string>();
    if (block.includes("new Set")) {
      // SET SHAPE — `new Set<WizardErrorCode>(["A", "B"])`. Membership means
      // "surface this wire string AS the wizard code", so the roster's answer
      // for a member is the member itself.
      for (const m of block.matchAll(/"([A-Z][A-Z0-9_]{2,})"/g)) {
        answers.set(m[1], m[1]);
      }
    } else {
      // RECORD SHAPE — `{ WIRE_KEY: "WIZARD_CODE" }`. The KEY is unquoted and
      // is what the membership check indexes with; the VALUE is the answer.
      // A quoted-token scan reads only the values, which is the wrong side.
      for (const m of block.matchAll(
        /^\s*([A-Z][A-Z0-9_]{2,})\s*:\s*"([A-Z][A-Z0-9_]{2,})"/gm,
      )) {
        answers.set(m[1], m[2]);
      }
    }
    out.push({ name: decl[1], answers });
  }
  return out;
}

/** The ONE wire→wizard table, read from `wizardErrors.ts` on disk. */
function extractWireTable(): Map<string, string> {
  const src = stripComments(
    readFileSync(join(process.cwd(), "src/lib/wizardErrors.ts"), "utf8"),
  );
  const table = /SEAM_CODE_TO_WIZARD_CODE[\s\S]*?\]\s*\)\s*;/.exec(src);
  const out = new Map<string, string>();
  if (!table) return out;
  // Each entry is `["WIRE_CODE", "WIZARD_CODE"]`.
  for (const m of table[0].matchAll(
    /\[\s*"([A-Z][A-Z0-9_]+)"\s*,\s*"([A-Z][A-Z0-9_]+)"\s*\]/g,
  )) {
    out.set(m[1], m[2]);
  }
  return out;
}

const WIZARD_ROSTER_FILES = [
  "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
] as const;

describe("[140.4-16 / WR-11] no wizard roster is SHADOWED into a different answer", () => {
  const wireTable = extractWireTable();
  const rosters = WIZARD_ROSTER_FILES.flatMap((f) =>
    extractRosters(f).map((r) => ({ ...r, file: f })),
  );

  /** Every (roster, code) the translate-first hop decides instead of the roster. */
  function shadowed(r: { answers: Map<string, string> }) {
    return [...r.answers.entries()].filter(([code]) => wireTable.has(code));
  }

  it("VACUITY FENCE — both sides of the comparison actually found something", () => {
    // A scanner that matches nothing reports agreement forever, which is how a
    // source guard becomes worse than none. Hand-typed anchors on both sides.
    expect(
      [...wireTable.keys()],
      "SEAM_CODE_TO_WIZARD_CODE was not found or not parsed — every " +
        "assertion below is vacuous",
    ).toContain("SEAM_MISCONFIGURED");
    expect(wireTable.size).toBeGreaterThanOrEqual(6);
    expect(
      rosters.map((r) => r.name).sort(),
      "a roster stopped being found by the scan. Either it was renamed out of " +
        "the KNOWN_*_CODES convention — in which case this scan no longer sees " +
        "it and the guard is silently narrower than it reads — or it was " +
        "deleted.",
    ).toEqual([
      "KNOWN_ADD_KEY_CODES",
      "KNOWN_CREATE_WITH_KEY_CODES",
      "KNOWN_KICKOFF_CODES",
      "KNOWN_SET_MEMBERS_CODES",
    ]);
    for (const r of rosters) {
      expect(r.answers.size, `${r.name} parsed as empty`).toBeGreaterThan(0);
    }
    // The RECORD shape must be read on its KEY side. `KNOWN_KICKOFF_CODES` maps
    // two wire codes onto ONE wizard code, so a value-side read would lose a
    // key and quietly narrow the guard.
    const kickoff = rosters.find((r) => r.name === "KNOWN_KICKOFF_CODES")!;
    expect(kickoff.answers.get("MISSING_STRATEGY_ID")).toBe("VALIDATION_FAILED");
  });

  it.each([
    "KNOWN_CREATE_WITH_KEY_CODES",
    "KNOWN_ADD_KEY_CODES",
    "KNOWN_KICKOFF_CODES",
  ])("%s: where the wire table shadows it, the two AGREE", (name) => {
    // ⚠️ THIS IS THE FACT THREE DOCBLOCKS REST ON, AND THE SHARP FORM IS NOT
    // THE ONE THEY STATE. 140.4-12 and 140.4-15 reordered these surfaces to
    // TRANSLATE FIRST, then membership-check, and justified it as safe because
    // "the table's key set and this set intersect in NOTHING". Measured here,
    // that sentence is FALSE for `KNOWN_KICKOFF_CODES`: `RATE_LIMITED` is in
    // both. The reorder is safe anyway — but for a DIFFERENT reason, and the
    // difference is the whole point of this guard.
    //
    // What actually makes it safe is that where they overlap they AGREE, so
    // which hop wins cannot change what the user sees. Disjointness is a
    // sufficient condition that happens to hold for the two Set rosters and
    // NOT for the Record one; agreement is the necessary one, and it is what
    // is asserted. A future edit that maps a shared code to a DIFFERENT wizard
    // code in one of the two places — the plausible edit, since the routes mint
    // sibling codes — makes the roster's answer unreachable, silently. That is
    // the defect class this phase exists to close, and nothing reddened on it.
    const roster = rosters.find((r) => r.name === name);
    expect(roster, `${name} not found`).toBeDefined();
    const disagreements = shadowed(roster!)
      .filter(([code, answer]) => wireTable.get(code) !== answer)
      .map(([code, answer]) => `${code}: roster=${answer} wire=${wireTable.get(code)}`);
    expect(
      disagreements,
      `${name} and SEAM_CODE_TO_WIZARD_CODE disagree on a code they BOTH ` +
        `carry. The translate-first hop runs first, so the wire table wins and ` +
        `the roster's answer is unreachable. Decide which vocabulary owns the ` +
        `code — do not leave both.`,
    ).toEqual([]);
  });

  it("records WHICH codes are shadowed today, so a new overlap is visible in review", () => {
    // Not a safety property — a visibility one. An overlap is only harmless
    // while it agrees, and "it agrees" is easy to preserve accidentally and
    // easy to break accidentally. Hand-typed, so a NEW overlap shows up as a
    // diff on this line rather than as silence.
    const overlaps = rosters
      .flatMap((r) => shadowed(r).map(([code]) => `${r.name}.${code}`))
      .sort();
    //
    // MEASURED, not assumed — and the measurement corrected a guess made while
    // writing this very case. Exactly ONE overlap exists across all four
    // rosters, and it is on the Record-shaped one:
    //   · KNOWN_KICKOFF_CODES.RATE_LIMITED → "RATE_LIMITED", and the wire table
    //     maps RATE_LIMITED → "RATE_LIMITED". They agree, so the hop's
    //     precedence is invisible to the user.
    // The two Set rosters (create-with-key, add-key) and KNOWN_SET_MEMBERS_CODES
    // are genuinely disjoint from the wire vocabulary, which is what their
    // docblocks claim — the claim is simply not true of all four.
    expect(overlaps).toEqual(["KNOWN_KICKOFF_CODES.RATE_LIMITED"]);
  });

  it("the needle self-test — the agreement assertion CAN fail", () => {
    // Without this, "no disagreements" is indistinguishable from "the extractor
    // returned nothing". A synthetic roster that answers a REAL wire code
    // DIFFERENTLY must be caught by the same expression the cases above use.
    const synthetic = new Map([["SEAM_MISCONFIGURED", "UNKNOWN"]]);
    const disagreements = [...synthetic.entries()]
      .filter(([code]) => wireTable.has(code))
      .filter(([code, answer]) => wireTable.get(code) !== answer);
    expect(disagreements).toEqual([["SEAM_MISCONFIGURED", "UNKNOWN"]]);
  });
});

describe("[140.4-13 / SEAMRIM-05] the needle self-test — BOTH polarities", () => {
  /** Classify an in-test source SAMPLE exactly as the scan above classifies a file. */
  function classify(sample: string): "no-limiter" | "routed" | "inlined" {
    const src = stripComments(sample);
    const checks = countMatches(src, CHECK_LIMIT_CALL);
    const routed = countMatches(src, DENY_ROUTED_CALL);
    if (checks === 0) return "no-limiter";
    return routed >= checks ? "routed" : "inlined";
  }

  it("POSITIVE: an inlined 429-only deny arm is DETECTED", () => {
    expect(
      classify(`
        const rl = await checkLimit(userActionLimiter, key);
        if (!rl.success) {
          return NextResponse.json(
            { error: "Too many requests" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
          );
        }
      `),
    ).toBe("inlined");
  });

  it("NEGATIVE: a chokepoint-routed deny arm is NOT flagged", () => {
    expect(
      classify(`
        const rl = await checkLimit(userActionLimiter, key);
        if (!rl.success) {
          return rateLimitDenyJson(rl, { headers: NO_STORE_HEADERS });
        }
      `),
    ).toBe("routed");

    // The three already-correct routes use the predicate directly rather than
    // the builder. That is the same decision, made in the same module.
    expect(
      classify(`
        const rl = await checkLimit(simulatorLimiter, key);
        if (!rl.success) {
          if (isRateLimitMisconfigured(rl)) return NextResponse.json({}, { status: 503 });
          return NextResponse.json({}, { status: 429 });
        }
      `),
    ).toBe("routed");
  });

  it("NEGATIVE: a `rateLimitDenyJson` mention INSIDE A COMMENT does not count as adoption", () => {
    // ⚠️ THIS IS A REAL SHAPE IN TWO FILES TODAY, NOT A HYPOTHETICAL.
    // `admin/match/eval` and `admin/match/recompute` both carry
    // "Same pairing as rateLimitDenyJson (…)" in prose. A line-based grep
    // counts it as adoption (DEF-16-2), and a scanner that does reports this
    // class closed while it is open.
    expect(
      classify(`
        const rl = await checkLimit(userActionLimiter, key);
        // Same pairing as rateLimitDenyJson (src/lib/ratelimit.ts).
        /* also mentioned here: rateLimitDenyJson and isRateLimitMisconfigured */
        if (!rl.success) {
          return NextResponse.json({ error: "Too many requests" }, { status: 429 });
        }
      `),
    ).toBe("inlined");
  });

  it("NEGATIVE: a route with NO checkLimit is classified no-limiter, not a violation", () => {
    expect(
      classify(`
        // This route has no rate limit at all — see rateLimitDenyJson for the
        // shape it WOULD use if it ever gained one.
        export async function POST(req: NextRequest) {
          return NextResponse.json({ ok: true });
        }
      `),
    ).toBe("no-limiter");
  });

  it("POSITIVE: a TWO-ARM route with only ONE routed arm is DETECTED (the M105 shape)", () => {
    // The file mentions `rateLimitDenyJson`, so every "does this file adopt the
    // builder" check is satisfied. Only counting arms sees it.
    expect(
      classify(`
        const userRl = await checkLimit(keysSyncUserLimiter, a);
        if (!userRl.success) return rateLimitDenyJson(userRl, {});
        const rl = await checkLimit(userActionLimiter, b);
        if (!rl.success) {
          return NextResponse.json({ error: "Too many requests" }, { status: 429 });
        }
      `),
    ).toBe("inlined");
  });

  it("the import-edge regex matches an edge and NOT a prose mention", () => {
    expect(SEAM_IMPORT_EDGE.test(`import { x } from "@/lib/resilient-fetch";`)).toBe(true);
    expect(SEAM_IMPORT_EDGE.test(`import { y } from "./analytics-client";`)).toBe(true);
    expect(SEAM_IMPORT_EDGE.test(`// do NOT simplify this to @/lib/resilient-fetch`)).toBe(false);
    expect(SEAM_IMPORT_EDGE.test(`import { z } from "@/lib/seam-errors";`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PART 2 — THE BEHAVIOURAL HALF. Three routes, three auth shapes, real handlers.
//
// ⚠️ `vi.spyOn` + `vi.restoreAllMocks()`. NEVER `vi.stubGlobal` (DEF-16-1) —
// a leaked global stub is this repo's known CI-only failure cause (CI Node 22,
// local Node 25). The limiter itself is spied on the REAL module, so the deny
// builder under test is the real one and cannot drift from a double.
// ---------------------------------------------------------------------------

const authState = vi.hoisted(() => ({
  user: { id: "00000000-0000-0000-0000-00000000abcd" } as { id: string } | null,
  isAdmin: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/csrf", () => ({ assertSameOrigin: () => null }));
vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => authState.isAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authState.user }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error(
      "unreachable: the deny arm must return before any DB work runs",
    );
  },
}));
vi.mock("@/lib/audit", () => ({
  logAuditEvent: async () => {},
  logAuditEventAsUser: async () => {},
}));
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: async () => {},
}));
vi.mock("@/lib/analytics-client", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/analytics-client")>()),
  recomputeMatch: async () => {
    throw new Error("unreachable: the deny arm must return before the seam call");
  },
}));
vi.mock("@/lib/process-key-client", () => ({
  postProcessKey: async () => {
    throw new Error("unreachable: the deny arm must return before the seam call");
  },
}));

// The REAL limiter module — nothing mocks it, so `rateLimitDenyJson` under test
// is the production implementation and `checkLimit` is spy-able on it.
import * as ratelimit from "./ratelimit";

const MISCONFIGURED = {
  success: false as const,
  retryAfter: 60,
  reason: "ratelimit_misconfigured" as const,
};

function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describe("[140.4-13 / SEAMRIM-05] behavioural — the 503 reaches the wire, across all three auth shapes", () => {
  beforeEach(() => {
    authState.user = { id: "00000000-0000-0000-0000-00000000abcd" };
    authState.isAdmin = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("PUBLIC / anonymous — verify-strategy", () => {
    it("ratelimit_misconfigured → 503, not a 429 blaming a first-time visitor", async () => {
      vi.spyOn(ratelimit, "checkLimit").mockResolvedValue(MISCONFIGURED);
      const { POST } = await import("@/app/api/verify-strategy/route");

      const res = await POST(
        jsonReq("http://localhost:3000/api/verify-strategy", {
          email: "a@b.co",
          exchange: "okx",
          api_key: "k",
          api_secret: "s",
        }),
      );

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "Rate limiter unavailable" });
      expect(res.headers.get("Retry-After")).toBe("60");
    });

    it("a genuine throttle still answers 429 with its own body", async () => {
      vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({
        success: false,
        retryAfter: 42,
      });
      const { POST } = await import("@/app/api/verify-strategy/route");

      const res = await POST(
        jsonReq("http://localhost:3000/api/verify-strategy", {
          email: "a@b.co",
          exchange: "okx",
          api_key: "k",
          api_secret: "s",
        }),
      );

      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "Too many requests" });
      expect(res.headers.get("Retry-After")).toBe("42");
      // The one seam route whose 429 carries no NO_STORE_HEADERS. Unchanged.
      expect(res.headers.get("Cache-Control")).toBeNull();
    });
  });

  describe("AUTHENTICATED — keys/sync, and it has TWO arms", () => {
    const STRATEGY_ID = "11111111-1111-4111-8111-111111111111";

    function syncReq() {
      return jsonReq("http://localhost:3000/api/keys/sync", {
        strategy_id: STRATEGY_ID,
      });
    }

    it("ARM 1 (per-user ceiling) misconfigured → 503", async () => {
      // Only the FIRST call denies; the second would allow. The ceiling
      // short-circuits, so this can only be arm 1 answering.
      const spy = vi.spyOn(ratelimit, "checkLimit");
      spy.mockResolvedValueOnce(MISCONFIGURED);
      spy.mockResolvedValue({ success: true });
      const { POST } = await import("@/app/api/keys/sync/route");

      const res = await POST(syncReq());

      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("SEAM_MISCONFIGURED");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("ARM 2 (per-(user, strategy) bucket) misconfigured → 503 — reachable ONLY through the second site", async () => {
      // ⚠️ THE ARM THIS PLAN'S LEDGER ROW MUTATES. The ceiling ALLOWS, so this
      // response can only have come from the second call site. Reverting that
      // one site to an inlined 429 leaves the file still mentioning
      // `rateLimitDenyJson` — every file-level check stays green, and this case
      // plus the per-arm structural count are the only things that see it.
      const spy = vi.spyOn(ratelimit, "checkLimit");
      spy.mockResolvedValueOnce({ success: true });
      spy.mockResolvedValueOnce(MISCONFIGURED);
      const { POST } = await import("@/app/api/keys/sync/route");

      const res = await POST(syncReq());

      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("SEAM_MISCONFIGURED");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("ARM 2 — a genuine throttle keeps its own 429 body, code RATE_LIMITED", async () => {
      const spy = vi.spyOn(ratelimit, "checkLimit");
      spy.mockResolvedValueOnce({ success: true });
      spy.mockResolvedValueOnce({ success: false, retryAfter: 9 });
      const { POST } = await import("@/app/api/keys/sync/route");

      const res = await POST(syncReq());

      expect(res.status).toBe(429);
      // Hand-typed: `{error, code}` in THAT key order.
      // 140.4-16 / WR-03 — byte-wise, because `toEqual` on parsed JSON does NOT
      // compare key order (measured: a swap at `keys/sync/route.ts:138` left
      // all four receipts green). See the note in `keys/sync/route.test.ts`.
      expect(await res.clone().text()).toBe(
        '{"error":"Too many requests","code":"RATE_LIMITED"}',
      );
      expect(await res.json()).toEqual({
        error: "Too many requests",
        code: "RATE_LIMITED",
      });
      expect(res.headers.get("Retry-After")).toBe("9");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });

  describe("ADMIN — admin/match/recompute", () => {
    function recomputeReq() {
      return jsonReq("http://localhost:3000/api/admin/match/recompute", {
        allocator_id: "22222222-2222-4222-8222-222222222222",
        force: false,
      });
    }

    it("ratelimit_misconfigured → 503, not a 429 that reads as an admin over-clicking", async () => {
      vi.spyOn(ratelimit, "checkLimit").mockResolvedValue(MISCONFIGURED);
      const { POST } = await import("@/app/api/admin/match/recompute/route");

      const res = await POST(recomputeReq());

      expect(res.status).toBe(503);
      // 140.3-G8 / SEAMUX-03 — recompute's deny bodies carry a machine `code`
      // (SEAM_MISCONFIGURED / RATE_LIMITED), matching the keys/sync template.
      // The posture invariant is status + error string + headers; the code is
      // additive and the byte-kept sentence is unchanged.
      expect(await res.json()).toEqual({
        error: "Rate limiter unavailable",
        code: "SEAM_MISCONFIGURED",
      });
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("a genuine throttle still answers 429 with its own body", async () => {
      vi.spyOn(ratelimit, "checkLimit").mockResolvedValue({
        success: false,
        retryAfter: 42,
      });
      const { POST } = await import("@/app/api/admin/match/recompute/route");

      const res = await POST(recomputeReq());

      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({
        error: "Too many requests",
        code: "RATE_LIMITED",
      });
      expect(res.headers.get("Retry-After")).toBe("42");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });
});
