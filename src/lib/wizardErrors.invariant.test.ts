// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";

/**
 * Phase 142.2-07 / MT5-04 (D-05) — A WIZARD ERROR CODE IS INERT UNLESS IT LANDS
 * IN ALL THREE REGISTRIES.
 *
 * ── WHAT THIS FILE EXISTS TO STOP ───────────────────────────────────────────
 *
 * A code a route puts on the wire has to clear three independent hand-typed
 * registries before a user sees its copy:
 *
 *   1. the `WizardErrorCode` union in `wizardErrors.ts` (and, with it, the
 *      `WIZARD_ERROR_COPY` record, which TypeScript makes total over the union);
 *   2. `KNOWN_CREATE_WITH_KEY_CODES` in `ConnectKeyStep.tsx`, for codes from
 *      `strategies/create-with-key`;
 *   3. `KNOWN_ADD_KEY_CODES` in `MultiKeyConnectStep.tsx`, for codes from
 *      `strategies/composite/add-key`.
 *
 * Miss the union and the code cannot be typed. Miss the ROSTER and the code
 * type-checks, ships, and is then rejected at the step as unrecognised — it
 * renders `UNKNOWN` ("We could not classify this failure"). That failure is
 * SILENT: nothing reddens, the copy exists, and the user gets the fallback.
 * 142.2-07 minted four codes at once, so the drift window was four times the
 * usual size, and the whole point of the plan was to stop rendering a sentence
 * that is not true of the user's situation. Landing on `UNKNOWN` would have
 * replaced a wrong sentence with a vaguer one.
 *
 * ⚠️ THE TWO ROSTERS ARE DELIBERATELY SEPARATE, and this guard does not
 * second-guess that. `ConnectKeyStep.tsx`'s docblock argues at length that a
 * step should admit the codes ITS route emits and not the whole vocabulary.
 * So the assertion is per-route — create-with-key's emitters against
 * create-with-key's roster — never a merged set. A merged check would pass
 * while each roster silently admitted the other route's codes.
 *
 * ── HONEST STATEMENT OF WHAT IT IS ──────────────────────────────────────────
 *
 * The registries stay hand-typed rosters; this does not promote them to a
 * derived single source. What it adds is FAIL-LOUD ARRIVAL: the population is
 * derived from the real emitters on disk, so a code emitted by a route and
 * missing from a registry reddens CI by name.
 *
 * ⚠️ COMMENT-STRIP BEFORE COUNTING, and this phase is the receipt for why.
 * `grep -c 'KEY_INVALID_FORMAT'` on each route returns **14**;
 * `grep -c 'code: "KEY_INVALID_FORMAT"'` returns **12**. The two-per-file delta
 * is COMMENT PROSE describing the MT5 short-login carve-out. The phase's own
 * research documents recorded 14 + 14 = 28 sites, and a plan built on that
 * number would have hunted four emitters that do not exist. Every count below
 * is taken from `stripCommentsPreserveLines` output, and the SELF-TESTs at the
 * bottom prove the scanner really does drop a commented mention.
 */

const REPO = process.cwd();

const UNION_SOURCE = join(REPO, "src", "lib", "wizardErrors.ts");
const WIZARD_STEPS = join(
  REPO,
  "src",
  "app",
  "(dashboard)",
  "strategies",
  "new",
  "wizard",
  "steps",
);

/**
 * THE EMITTER PREDICATE, stated in full so any count below can be reproduced
 * without reading this code:
 *
 *   Take the route's source and strip comments and docstrings with
 *   `stripCommentsPreserveLines(src, "ts")`. A REJECTION-EMITTING SITE is a
 *   `NextResponse.json(` call whose FIRST argument is an object literal opening
 *   with `code: "<UPPER_SNAKE_LITERAL>"` immediately followed by an `error:`
 *   key, and whose SECOND argument carries a `status:` MATCHING THAT ROUTE'S
 *   OWN `statusRe` FRAGMENT. The emitted code is that string literal.
 *
 * ⚠️ THE STATUS IS A PER-ROUTE PROPERTY, NOT A GLOBAL 400 (153.1-01 / D-34).
 * Until this plan the predicate hard-coded `status: 400`, and its prose called
 * the population "exactly the INPUT-VALIDATION rejections". That description is
 * TRUE of the two incumbent routes — their coded rejections really are the
 * pre-limiter, pre-probe input guards, and both keep `statusRe: "400"` so their
 * pinned counts below are byte-identical to before. It is FALSE of
 * `finalize-wizard`, which answers its coded arms at 400/403/404/409/502/503;
 * a 400-only predicate sees almost none of them. Leaving the old prose in place
 * while a third route arrived under it is this file's own Pitfall 1 — a
 * description that stays green while its premise changes.
 *
 * ⚠️ AND THE ERROR BODY MUST SURVIVE A TEMPLATE INTERPOLATION. The old body
 * matcher was `error:[^}]*\}`, a character class that EXCLUDES `}` outright, so
 * it could not cross the brace that closes a `${…}` interpolation and the match
 * died there. Four `finalize-wizard` bodies interpolate a constant, and they
 * stayed invisible even after the status widened. The replacement is a LAZY
 * bounded run that backtracks to the first `}` actually followed by the
 * `, { … status: … }` context, which is the real end of the object literal.
 *
 * Three things this deliberately still EXCLUDES, each verified against the real
 * sources rather than assumed:
 *
 *   · The rate-limiter deny bodies. `rateLimitDenyJson(...)` receives
 *     `throttledBody: { code: "KEY_RATE_LIMIT", ... }` and
 *     `misconfiguredBody: { code: "SEAM_MISCONFIGURED", ... }`. Both are object
 *     literals of the same SHAPE, but neither is the first argument of a
 *     `NextResponse.json(` call, and their status is decided inside the helper.
 *   · The read-only permission refusal, which is also a 400 but passes the
 *     SHORTHAND `{ code }` — a computed value, no string literal, and no
 *     `error` key (it is uniform-`{ code }` by H-0305). Excluded by the
 *     literal requirement, which is why the count is 12 and not 13.
 *   · Any answer whose status does not match the route's own fragment.
 *
 * ⛔ TWO THINGS THAT MUST NOT BE RELAXED TO MAKE A COUNT COME OUT RIGHT: the
 * `code:`-FIRST key order, and the `[A-Z][A-Z0-9_]*` literal class. Those two
 * are the levers that make the D-34 reorder mandatory and that keep a lowercase
 * `draft_state_invalid` VISIBLE as a defect. Relaxing either would "fix" the
 * assertion by legalising the defect it exists to find.
 */

/**
 * The lazy run's character cap, and the measurement that picked it (153.1-01).
 *
 * A lazy `[\s\S]{0,N}?` that is allowed to grow without bound can, when one
 * emitter's body is malformed, backtrack straight past that emitter's own close
 * and pick up the NEXT emitter's `status:` — reporting the first emitter's code
 * against the second one's status. The cap is what forbids that.
 *
 * Measured on the comment-stripped sources of all three routes:
 *   · longest REAL `error:` … `}` body = **90** characters (`DRAFT_ALREADY_EXISTS`
 *     on create-with-key), so the cap must clear 90 with headroom;
 *   · shortest distance from ANY `error:` to the NEXT emitter's `status:` =
 *     **202** characters (finalize-wizard), so the cap must stay under 202 for
 *     the cross-emitter reach to be arithmetically impossible.
 * 160 sits between them: ~1.8× the longest real body, and 42 characters short
 * of the nearest neighbour. If a genuinely longer body is ever written its
 * emitter goes invisible — which the hand-typed site counts below redden.
 */
const EMITTER_BODY_MAX_CHARS = 160;

/**
 * Build the emitter regex for one route's status fragment.
 *
 * A FACTORY, not a module const, because the fragment is per-route. `statusRe`
 * is a regex FRAGMENT (`"400"`, or `"[45]\\d\\d"` for every 4xx/5xx), spliced
 * in raw — these are hand-typed in this file, never taken from input.
 */
function emitterRe(statusRe: string): RegExp {
  return new RegExp(
    `NextResponse\\.json\\(\\s*\\{\\s*code:\\s*"([A-Z][A-Z0-9_]*)"\\s*,\\s*` +
      `error:[\\s\\S]{0,${EMITTER_BODY_MAX_CHARS}}?\\}\\s*,\\s*\\{[^}]*status:\\s*(?:${statusRe})`,
    "g",
  );
}

interface RouteUnderTest {
  /** Human name used in failure messages. */
  readonly label: string;
  /** Path to the route handler, relative to the repo root. */
  readonly route: string;
  /** Path to the file holding the roster this route's codes must clear. */
  readonly rosterFile: string;
  /** The roster's declared name. */
  readonly rosterName: string;
  /**
   * The regex FRAGMENT this route's coded rejections answer on.
   *
   * ⚠️ NARROW ON PURPOSE for the two incumbents. Both also answer 403/409/500
   * with a coded body, and widening them to `"[45]\\d\\d"` would move their
   * pinned site count from 12 to 16 and add `DRAFT_ALREADY_EXISTS` / `UNKNOWN`
   * to the vocabulary assertion — a real change of population dressed up as a
   * scanner improvement. The widening belongs to the route that needs it.
   */
  readonly statusRe: string;
  /**
   * HAND-TYPED site count for THIS route, measured under the predicate above.
   *
   * ⚠️ PER-ROUTE SINCE 153.1-06, AND THAT IS THE POINT. Until this plan the
   * literal was one module-level `EXPECTED_SITES_PER_ROUTE = 12` applied to
   * every entry by `it.each`, which was honest while the only two routes were
   * structural mirrors emitting guard for guard. `finalize-wizard` is not a
   * mirror of either — 25 sites against their 12 — and the only two ways to
   * keep ONE literal are to widen it into a range or to drop the assertion,
   * both of which retire a guard to make a new route fit. Moving the number
   * onto the entry keeps every route pinned at its OWN measured value, and
   * both incumbents keep the byte-identical 12 they were pinned at in 142.2-07.
   *
   * ⚠️ NEVER `derived.length`. A size compared against its own derivation
   * cannot fail: delete every guard in the route and both sides go to zero
   * together. This is the Oracle-Independence rule the phase's validation
   * contract makes explicit, and it has a live precedent on this codebase —
   * three money bugs survived six review passes behind self-referential
   * oracles.
   *
   * ⚠️ AND FOR THE TWO INCUMBENTS THE NUMBER IS 12, NOT 14. 14 is what a raw
   * `grep -c KEY_INVALID_FORMAT` reported before the split, and two of those 14
   * per file are comment prose. Pinning 14 would make this guard assert a
   * fiction and demand two emitters nobody can write.
   */
  readonly expectedSites: number;
}

const ROUTES: readonly RouteUnderTest[] = [
  {
    label: "create-with-key",
    route: join(REPO, "src/app/api/strategies/create-with-key/route.ts"),
    rosterFile: join(WIZARD_STEPS, "ConnectKeyStep.tsx"),
    rosterName: "KNOWN_CREATE_WITH_KEY_CODES",
    statusRe: "400",
    expectedSites: 12,
  },
  {
    label: "composite/add-key",
    route: join(REPO, "src/app/api/strategies/composite/add-key/route.ts"),
    rosterFile: join(WIZARD_STEPS, "MultiKeyConnectStep.tsx"),
    rosterName: "KNOWN_ADD_KEY_CODES",
    statusRe: "400",
    expectedSites: 12,
  },
  {
    // 153.1-06 / WIZFORM-02 — THE THIRD ENTRY, and the whole reason the two
    // scanner fixes above (the per-route status fragment and the
    // whitespace-tolerant roster anchors) landed first.
    //
    // Until 153.1-05 this route emitted ZERO codes under this predicate:
    // fourteen arms were written `{ error, code }` and the rest carried no code
    // at all. 153.1-05 reordered the fourteen and coded eleven `validatePayload`
    // arms, taking the derivation 0 → 25. Adding this entry BEFORE that work
    // would have wired an assertion over an empty population — green forever,
    // measuring nothing, and indistinguishable from a route with no defects.
    //
    // ⚠️ `statusRe` IS WIDE HERE AND NARROW ABOVE, on purpose. This route
    // answers its coded arms at 400/403/404/409/502/503; the two incumbents
    // keep "400" because widening THEM would move their pinned count 12 → 16
    // and change their vocabulary — a population change dressed as a scanner
    // improvement (see `statusRe`'s docblock).
    label: "finalize-wizard",
    route: join(REPO, "src/app/api/strategies/finalize-wizard/route.ts"),
    rosterFile: join(WIZARD_STEPS, "SubmitStep.tsx"),
    rosterName: "KNOWN_FINALIZE_CODES",
    statusRe: "[45]\\d\\d",
    expectedSites: 25,
  },
];

function stripped(path: string): string {
  return stripCommentsPreserveLines(readFileSync(path, "utf-8"), "ts");
}

/**
 * Every rejection-emitted code literal, in source order, WITH repeats.
 *
 * `statusRe` defaults to `"400"` so the SELF-TESTs written before the widening
 * still exercise the narrow configuration unchanged.
 */
function deriveEmittedCodes(source: string, statusRe = "400"): string[] {
  const out: string[] = [];
  const re = emitterRe(statusRe);
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

/**
 * The `WizardErrorCode` union's members, read out of its declaration.
 *
 * Bounded at the declaration's terminating `;` so the scan cannot wander into
 * `WIZARD_ERROR_COPY` below it and read the record's KEYS as if they were union
 * members. The two agree today (TypeScript makes the record total over the
 * union), and that is exactly why reading the wrong one would be invisible.
 */
function deriveUnionMembers(source: string): string[] {
  const start = source.indexOf("export type WizardErrorCode =");
  if (start < 0) return [];
  const end = source.indexOf(";", start);
  const block = source.slice(start, end < 0 ? source.length : end);
  return [...block.matchAll(/\|\s*"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

/**
 * The string literals inside a `const <name> ... new Set<...>([ ... ])`.
 *
 * ⚠️ THE ANCHORS ARE WHITESPACE-TOLERANT, AND THAT IS THE WHOLE POINT.
 * Until 153.1-01 this function searched for the two-character strings `"(["`
 * and `"])"`, which require the bracket to be ADJACENT to the paren. Both
 * incumbent rosters wrap after the `=` (`ConnectKeyStep.tsx:265`,
 * `MultiKeyConnectStep.tsx:214`) so their `([` really is adjacent — which is
 * why nobody hit this. `SubmitStep.tsx:230` wraps INSIDE the call instead
 * (`new Set<WizardErrorCode>(` at end of line, `[` on the next), so
 * `indexOf("([")` returned -1 and the roster derived to `[]` — measured by
 * execution 2026-08-09. An empty derivation satisfies every "the missing set is
 * empty" assertion in this file, so the guard would have been BORN BLIND on
 * that route and passed green.
 *
 * ⛔ REFORMATTING THE SUBJECT IS NOT THE FIX. Joining `SubmitStep.tsx`'s
 * declaration onto one line makes it ~93 characters, Prettier re-breaks it, and
 * the next `npm run lint -- --fix` silently re-blinds the scanner. Fixing the
 * SCANNER is the class fix; reformatting the file it happens to be pointed at
 * is the instance fix.
 *
 * The contract is otherwise unchanged: bounded to the NAMED declaration,
 * returns `[]` when either anchor is missing, and extracts UPPER_SNAKE string
 * literals only. The closing anchor tolerates the trailing comma that a
 * multi-line argument list carries (`],` then `);`), and both anchors take
 * their FIRST match, so the scan still stops at this roster's own close and
 * cannot run on into the next `const KNOWN_*` set — pinned by the two SELF-TESTs
 * at the bottom of this file.
 */
function deriveRoster(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) return [];
  const tail = source.slice(start);
  const openMatch = /\(\s*\[/.exec(tail);
  if (openMatch === null) return [];
  const open = openMatch.index;
  const closeMatch = /\]\s*,?\s*\)/.exec(tail.slice(open));
  if (closeMatch === null) return [];
  const block = tail.slice(open, open + closeMatch.index);
  return [...block.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

/**
 * The wire→wizard ALIAS TABLE's pairs, read out of its declaration (153.1-06).
 *
 * ── WHY THE COVERAGE LAW NEEDS THIS AT ALL ──────────────────────────────────
 *
 * `finalize-wizard` emits `CIRCUIT_OPEN`, and `CIRCUIT_OPEN` is deliberately
 * NOT a `WizardErrorCode` and deliberately NOT in `KNOWN_FINALIZE_CODES`. It is
 * a WIRE code: `SEAM_CODE_TO_WIZARD_CODE` translates it to
 * `SERVICE_UNAVAILABLE_RETRY` — which the roster does admit — and that
 * translation runs BEFORE the membership check (`SubmitStep.tsx`, `surfaced`).
 * `SERVICE_UNAVAILABLE_RETRY` already IS the member for "the breaker is open,
 * we declined to try, nothing was submitted"; minting a second one is how a
 * vocabulary starts lying (`SEAM_CODE_TO_WIZARD_CODE`'s own docblock, 140.3-05).
 *
 * So a coverage assertion that compares emitted codes against the roster and
 * the union ALONE reports `CIRCUIT_OPEN` as an uncovered emitter forever, and
 * the obvious "fix" — adding it to a `ReadonlySet<WizardErrorCode>` — would not
 * compile, and would be wrong if it did. `MultiKeyConnectStep.tsx`'s docblock
 * states the rule as coverage-law row 1: the ONE shared table is consulted
 * FIRST, never a member here.
 *
 * ⛔ DERIVED FROM SOURCE, NEVER RE-TYPED. A hand-copied alias list is a second
 * source of truth that goes stale silently — precisely the failure this whole
 * file exists to prevent, and the reason the rosters and the union are read off
 * disk rather than mirrored here.
 *
 * Bounded exactly like `deriveUnionMembers`: from the declaration to the
 * `]);` that closes the `new Map<…>([ … ])` argument, so the scan cannot run on
 * into `recogniseSeamErrorCode` below it and read a string out of unrelated
 * code. Returns `[]` when either anchor is missing — which is why the SELF-TEST
 * on the real table's non-emptiness is load-bearing: an empty alias map turns
 * the widened admission rule into a no-op that passes for the wrong reason.
 */
function deriveAliasPairs(source: string): [string, string][] {
  const start = source.indexOf("const SEAM_CODE_TO_WIZARD_CODE");
  if (start < 0) return [];
  const tail = source.slice(start);
  const openMatch = /\(\s*\[/.exec(tail);
  if (openMatch === null) return [];
  const open = openMatch.index;
  const closeMatch = /\]\s*,?\s*\)/.exec(tail.slice(open));
  if (closeMatch === null) return [];
  const block = tail.slice(open, open + closeMatch.index);
  return [...block.matchAll(/\[\s*"([A-Z][A-Z0-9_]*)"\s*,\s*"([A-Z][A-Z0-9_]*)"\s*\]/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  );
}

/**
 * EVERY rejection-answering `NextResponse.json(` site on a route, CODED OR NOT
 * (153.1-06). Returns one entry per site, in source order.
 *
 * ── THE HOLE THIS EXISTS TO CLOSE, AND IT IS THE POINT OF THE WHOLE WAVE ────
 *
 * Everything else in this file derives from the CODED emitters, and that
 * population has a blind spot with exactly the shape of the defect the
 * sub-phase set out to kill: an arm that answers with NO CODE AT ALL emits
 * nothing, so it does not appear in `deriveEmittedCodes`, so
 *
 *   · the per-route site count does not move (25 stays 25) — GREEN;
 *   · the union and roster assertions have no code to judge — GREEN;
 *   · the vacuity floor does not move — GREEN.
 *
 * The route ships a rejection that renders "We could not classify this failure"
 * for a failure it classified exactly, and NOTHING REDDENS. That is precisely
 * the year-long state 153.1-05 found on this route, and precisely what 153.1-05
 * recorded as still open: *"nothing reds if 153.2 adds a twelfth arm without a
 * code."*
 *
 * ⚠️ AND THE ROUTE-SIDE CLASS SWEEP DOES NOT CLOSE IT EITHER, which is worth
 * writing down because it LOOKS like it does. `route.test.ts`'s *"NOT ONE arm
 * answers without a code"* iterates a HAND-TYPED `ARMS` table, so a new arm is
 * caught only once someone adds it to that table — the same "passes by not
 * being listed" failure the sweep was written to fix, moved one level up. Its
 * positive control pins `ARMS.length`, which proves the table is not empty, not
 * that the table is complete. A source-derived population is the only kind that
 * cannot be evaded by omission.
 *
 * ── THE PREDICATE ──────────────────────────────────────────────────────────
 *
 * Split the comment-stripped source at each `NextResponse.json(`. A segment
 * runs to the NEXT such call, so it is bounded BY CONSTRUCTION — no lazy run,
 * no character cap, and no way to reach a neighbour's `status:` (the failure
 * `EMITTER_BODY_MAX_CHARS` exists to forbid for the coded scan). The FIRST
 * `status: <n>` in a segment is that call's own, because the status lives in
 * the second argument, immediately after the body. A site counts as a REJECTION
 * when that status is 4xx or 5xx, and as CODED when its first argument opens
 * `{ code: "<UPPER_SNAKE_LITERAL>"`.
 *
 * ⚠️ `coded` HERE IS THE SAME KEY-ORDER RULE `emitterRe` APPLIES, deliberately.
 * An arm reordered to `{ error, code }` is reported UNCODED by this scan too —
 * it is invisible to the wizard's scanner, which is the fact that matters, and
 * making this scan more permissive than the emitter scan would let the two
 * disagree about the same site.
 */
function deriveRejectionSites(
  source: string,
): { status: number; coded: boolean }[] {
  const CALL = "NextResponse.json(";
  const segments = source.split(CALL).slice(1);
  const out: { status: number; coded: boolean }[] = [];
  for (const seg of segments) {
    const st = /status:\s*(\d{3})/.exec(seg);
    if (st === null) continue;
    const status = Number(st[1]);
    if (status < 400 || status > 599) continue;
    out.push({
      status,
      coded: /^\s*\{\s*code:\s*"[A-Z][A-Z0-9_]*"/.test(seg),
    });
  }
  return out;
}

/**
 * HAND-TYPED. The `finalize-wizard` rejections that answer with NO CODE, and
 * therefore render the UNKNOWN card today (measured 153.1-06).
 *
 * ⚠️ THIS IS A LEDGER OF KNOWN DEBT, NOT A LIST OF THINGS THAT ARE FINE. Each
 * of these five puts a user in front of "We could not classify this failure"
 * for a failure the route classified well enough to pick a status and write a
 * sentence about. They are recorded rather than fixed because 153.1-06 is a
 * TEST-ONLY plan and they sit outside both populations 153.1-05 worked on — it
 * coded the eleven `validatePayload` arms and reordered the fourteen coded
 * emitters, and none of these five is either. Recording them is what makes the
 * assertion below able to fail for a NEW one.
 *
 * ⛔ DO NOT ADD TO THIS NUMBER TO MAKE A FAILING ASSERTION PASS. A new
 * code-less rejection is the defect this sub-phase exists to stop shipping; the
 * remedy is a code on the arm and a member in `KNOWN_FINALIZE_CODES`. The
 * number comes DOWN as those arms are fixed, and the day it reaches zero this
 * constant and its assertion collapse into "every rejection carries a code",
 * which is where WIZFORM-02's criterion actually lands.
 *
 * The five, by status, measured from stripped source (⚠️ a raw-source scan with
 * a fixed look-ahead window reports FOUR — it loses the `:869` arm behind the
 * `console.error` block above it, which is the 14-vs-12 lesson again in a new
 * costume):
 *   · 429 — the limiter's throttle body (`{ error: "Too many requests" }`).
 *     `KEY_RATE_LIMIT` is what the key routes answer here.
 *   · 503 — the limiter's MISCONFIGURED body (`"Rate limiter unavailable"`).
 *     `SEAM_MISCONFIGURED` is the member; 140.4-15 fixed exactly this arm on
 *     `composite/add-key` and its reasoning transfers verbatim — the copy for
 *     the throttle blames the user's exchange for our own outage.
 *   · 500 — `"Could not load draft"`, the strategy lookup's failure.
 *   · 500 — `"Could not finalize wizard draft"`, the RPC's generic failure.
 *   · 502 — `"Upstream service returned unexpected response"`.
 */
const KNOWN_CODELESS_FINALIZE_REJECTIONS = 5;

/** Every rejection site on `finalize-wizard`, coded or not (measured 153.1-06). */
const EXPECTED_FINALIZE_REJECTION_SITES = 30;

/**
 * HAND-TYPED. The two routes 142.2-07 split, by LABEL.
 *
 * ⚠️ 153.1-06 — TWO ASSERTIONS BELOW ARE FACTS ABOUT THESE TWO ROUTES ONLY, and
 * they are driven off this list rather than off `ROUTES` wholesale. The
 * `KEY_INVALID_FORMAT`-exactly-once rule and the "emitted vocabulary is the
 * hand-typed split set" rule both describe the ccxt KEY-VALIDATION split: one
 * format guard per route, five codes between them. `finalize-wizard` is
 * deliberately OUTSIDE both — it validates wizard METADATA, not key material,
 * emits `KEY_INVALID_FORMAT` zero times, and its vocabulary is nineteen codes
 * that have nothing to do with the split.
 *
 * ⛔ THE SCOPING IS NOT A WEAKENING, and the diff is where to check that: the
 * two literals stayed `12`, `EXPECTED_SPLIT_CODES` stayed five members, and
 * `EXPECTED_FORMAT_EMITTERS_PER_ROUTE` stayed `1`. Widening
 * `EXPECTED_SPLIT_CODES` to absorb finalize-wizard's vocabulary — the other way
 * to make the third entry fit — would have retired the guard instead.
 *
 * ⚠️ BY LABEL, NOT BY ARRAY POSITION. The mirror-pair assertion used to
 * destructure `const [a, b] = derived`, which is correct only while the split
 * routes happen to be first. It would go on comparing the wrong pair, silently,
 * the day a fourth entry is inserted anywhere but the end.
 */
const SPLIT_ROUTE_LABELS: readonly string[] = [
  "create-with-key",
  "composite/add-key",
];

/**
 * After the split, exactly ONE guard per route may still answer
 * `KEY_INVALID_FORMAT`: the ccxt `api_secret.length < 8` arm, the only one of
 * the twelve that judges the SHAPE of a value. Its copy (Binance secrets are 64
 * hex characters, …) is true of that guard and was false of the other eleven.
 */
const EXPECTED_FORMAT_EMITTERS_PER_ROUTE = 1;

/**
 * HAND-TYPED VACUITY FLOOR on the COMBINED derivation, with the reason.
 *
 * `source-scan.ts`'s own docblock places this obligation on every caller: it
 * BLANKS trailing comments rather than leaving them in, so a tokenizer bug now
 * fails SILENT rather than loud. An "every emitted code is in its registry"
 * assertion over an EMPTY derivation is green forever while measuring nothing,
 * and `it.each([])` is zero cases, which is a passing suite.
 *
 * ⚠️ 153.1-06 — RESIZED, AND LEAVING IT AT 14 WAS THE TRAP. The measured total
 * is now **49** sites (12 create-with-key + 12 composite/add-key + 25
 * finalize-wizard, up from the 24 this floor was written against). With 49
 * available, a floor of 14 is satisfied even if the ENTIRE finalize-wizard
 * derivation collapses to zero — the floor would have been carried by the two
 * incumbents alone and could not have failed for the route it was raised to
 * cover. ~60% of 49 is 29.4, so the floor is **29**.
 *
 * ⛔ SIZED AGAINST 49, NOT AGAINST THE NINE NEW ARMS AND NOT AGAINST THE
 * FOURTEEN REORDERED SITES. Either of those smaller anchors produces a floor
 * that is already cleared by work that predates this sub-phase.
 *
 * ── THE DIVISION OF LABOUR, so nobody "simplifies" one into the other ───────
 *
 * This floor and `RouteUnderTest.expectedSites` catch DIFFERENT failures and
 * neither subsumes the other:
 *
 *   · THE FLOOR catches a TOTAL scanner break — the regex stops matching, the
 *     comment-stripper starts blanking real code, a path goes wrong. It is a
 *     `>=` on purpose: it must not need editing when a route legitimately
 *     grows a guard, or it becomes a chore that gets bumped without thought.
 *   · THE PER-ROUTE LITERALS catch a SINGLE SITE or a SINGLE ROUTE going blind
 *     — one arm reordered back to `{ error, code }`, one body pushed past
 *     `EMITTER_BODY_MAX_CHARS`, one route's file renamed. Those are exact `toBe`
 *     equalities, so they red in BOTH directions.
 *
 * ⚠️ THE ARITHMETIC, WORKED RATHER THAN ASSERTED, because a floor is exactly
 * the kind of guard whose prose drifts from what it can actually catch:
 *
 *   · ONE SITE goes blind → 48, which clears 29. The floor is SILENT; only
 *     that route's literal reds. MEASURED at 153.1-06 by reordering one
 *     `COMPOSITE_MEMBERSHIP_UNKNOWN` arm back to `{ error, code }` — exactly
 *     one assertion red, the per-route count, at 24-vs-25.
 *   · AN INCUMBENT ROUTE collapses entirely (12 → 0) → 37, which clears 29.
 *     The floor is SILENT; only that route's literal reds.
 *   · finalize-wizard collapses entirely (25 → 0) → 24, which does NOT clear
 *     29. Both red. (This is the case the old floor of 14 could not see, and
 *     the reason for the resize.)
 *   · THE SCANNER breaks outright → 0. The floor reds, and so does everything
 *     else. MEASURED at 153.1-06 by breaking the emitter regex: 13 assertions
 *     red, the floor's message reading "expected 0 to be greater than or equal
 *     to 29".
 *
 * Two of those four cases are caught ONLY by the per-route literals, which is
 * why deleting them in favour of "the floor already covers it" would re-open
 * the blindness this sub-phase spent five waves closing.
 */
const DERIVED_FLOOR = 29;

/**
 * HAND-TYPED. The four codes 142.2-07 minted, and the one it left in place.
 * Compared against a from-disk derivation, never against a second derivation.
 */
const EXPECTED_SPLIT_CODES: readonly string[] = [
  "KEY_INPUT_TOO_LONG",
  "KEY_INVALID_FORMAT",
  "KEY_MISSING_REQUIRED_FIELD",
  "KEY_UNSUPPORTED_VENUE",
  "KEY_VENUE_NOT_ENABLED",
];

describe("[142.2-07 / MT5-04] every emitted wizard code clears the union AND its route's roster", () => {
  const unionSource = stripped(UNION_SOURCE);
  const union = new Set(deriveUnionMembers(unionSource));
  const alias = new Map(deriveAliasPairs(unionSource));

  /**
   * THE COVERAGE LAW, in one place so the union and the roster answer it the
   * same way and neither can drift permissive on its own.
   *
   * A derived code is COVERED if it is a wizard member in its own right, OR if
   * the alias table translates it to one. This mirrors `SubmitStep.tsx`'s
   * `surfaced` exactly — translation first, membership second — rather than
   * inventing a second admission rule for the test to be right about.
   */
  const aliasTarget = (code: string): string | undefined => alias.get(code);

  const derived = ROUTES.map((r) => {
    const rosterSource = stripped(r.rosterFile);
    return {
      ...r,
      codes: deriveEmittedCodes(stripped(r.route), r.statusRe),
      roster: new Set(deriveRoster(rosterSource, r.rosterName)),
    };
  });

  it("the derivation is NOT VACUOUS — population floor, with its predicate", () => {
    const total = derived.reduce((n, d) => n + d.codes.length, 0);
    expect(
      total,
      `Derived only ${total} rejection-emitting sites across the THREE wizard ` +
        `routes (floor ${DERIVED_FLOOR}, measured total 49). PREDICATE: ` +
        `comment-stripped via stripCommentsPreserveLines(src,"ts"), then every ` +
        `NextResponse.json( call whose first argument is ` +
        `{ code: "<LITERAL>", error: … } and whose second carries a status ` +
        `matching THAT ROUTE'S OWN fragment — status 400 for the two ` +
        `key-validation routes, any 4xx/5xx for finalize-wizard, which answers ` +
        `its coded arms at 400/403/404/409/502/503. A number this low means ` +
        `the SCANNER broke, not that the routes stopped validating input — and ` +
        `a broken scanner makes every assertion below pass vacuously.`,
    ).toBeGreaterThanOrEqual(DERIVED_FLOOR);

    // Both sides of every comparison must have parsed, not just the emitters.
    expect(union.size, "the WizardErrorCode union parsed as empty").toBeGreaterThan(
      30,
    );
    // ⚠️ THE BOUND IS 10 AND finalize-wizard IS THE ROUTE THAT MADE IT TIGHT.
    // It was written for the two 24-member key rosters; KNOWN_FINALIZE_CODES
    // has 21 (measured 153.1-06), so it clears with room but by less than half
    // the margin the incumbents have. Left at 10 deliberately — this guard's
    // job is to catch a roster that parsed as [] or nearly so (the real
    // 153.1-01 defect), not to re-pin each roster's size, which is a fact about
    // the roster rather than about the scanner.
    for (const d of derived) {
      expect(d.roster.size, `${d.rosterName} parsed as empty`).toBeGreaterThan(10);
    }
    // The alias table is the THIRD vocabulary a comparison above depends on,
    // and an empty one makes the widened admission a silent no-op. Its own
    // SELF-TEST below asserts the CIRCUIT_OPEN row; this is the vacuity half,
    // stated here beside the other two so all three are visible in one place.
    expect(alias.size, "SEAM_CODE_TO_WIZARD_CODE parsed as empty").toBeGreaterThan(
      3,
    );
  });

  it.each(ROUTES.map((r) => r.label))(
    "%s: the site count is THIS ROUTE's hand-typed literal — not its own length",
    (label) => {
      const d = derived.find((x) => x.label === label)!;
      expect(
        d.codes.length,
        `${label} has ${d.codes.length} rejection-emitting sites under the ` +
          `predicate in this file's header; ${d.expectedSites} were measured ` +
          `(142.2-07 for the two key-validation routes, 153.1-05 for ` +
          `finalize-wizard). If a guard was ADDED, give it an honest code and ` +
          `bump this route's literal. If one was REMOVED, a validation guard ` +
          `just disappeared, which is a bigger question than this test. And if ` +
          `a guard is still THERE but no longer counted, it went BLIND — the ` +
          `two ways that happens are a \`{ error, code }\` key order and an ` +
          `\`error:\` body longer than EMITTER_BODY_MAX_CHARS (${EMITTER_BODY_MAX_CHARS}); ` +
          `⛔ the remedy is to fix the emitter, never to relax the predicate.`,
      ).toBe(d.expectedSites);
    },
  );

  it.each(ROUTES.map((r) => r.label))(
    "%s: every emitted code is a WizardErrorCode member, or the alias table makes it one",
    (label) => {
      const d = derived.find((x) => x.label === label)!;
      const missing = [...new Set(d.codes)]
        .filter((c) => {
          if (union.has(c)) return false;
          const t = aliasTarget(c);
          // A translated code still has to land in the union — an alias
          // pointing at a member that no longer exists is the same silent
          // UNKNOWN by a longer route.
          return t === undefined || !union.has(t);
        })
        .sort();
      expect(
        missing,
        `${label} emits codes that are not in the WizardErrorCode union AND ` +
          `that SEAM_CODE_TO_WIZARD_CODE does not translate into it, so ` +
          `WIZARD_ERROR_COPY has no entry for them and formatKeyError falls ` +
          `through to UNKNOWN. ⛔ THE REMEDY IS NOT TO ADD THE CODE TO A ` +
          `ReadonlySet<WizardErrorCode>: a WIRE code is deliberately not a ` +
          `wizard member (CIRCUIT_OPEN is the live case — SERVICE_UNAVAILABLE_RETRY ` +
          `already stands for the same fact, and a second member with the same ` +
          `meaning is how a vocabulary starts lying). Either mint a real union ` +
          `member for a route-minted code, or record the translation as a row ` +
          `in the ONE alias table.`,
      ).toEqual([]);
    },
  );

  it.each(ROUTES.map((r) => r.label))(
    "%s: every emitted code is admitted by THAT ROUTE's roster, or by the alias table",
    (label) => {
      const d = derived.find((x) => x.label === label)!;
      const missing = [...new Set(d.codes)]
        // The step translates FIRST and consults the roster only for what the
        // table does not answer (`SubmitStep.tsx`'s `surfaced`, and the same
        // shape at both key-entry steps). A code the table translates is
        // covered without a roster row, and adding one would be a type error.
        .filter((c) => aliasTarget(c) === undefined && !d.roster.has(c))
        .sort();
      expect(
        missing,
        `${label} emits codes that ${d.rosterName} does not admit and that ` +
          `SEAM_CODE_TO_WIZARD_CODE does not translate. The step rejects an ` +
          `unrecognised code and renders UNKNOWN — silently, with nothing else ` +
          `reddening. Add each code to ${d.rosterName}. Do NOT merge the ` +
          `rosters to make this pass: they are separate on purpose (see ` +
          `ConnectKeyStep's docblock), and a merged set would admit each ` +
          `route's codes at the others.`,
      ).toEqual([]);
    },
  );

  it("finalize-wizard: NOT ONE NEW rejection may answer without a code (the class, from source)", () => {
    // ⭐ THE ASSERTION THAT CLOSES WIZFORM-02's LOOP, and the only one in this
    // file whose population includes arms that emit NOTHING. Everything above
    // derives from CODED emitters and is therefore blind to the exact defect
    // the sub-phase exists to kill: a rejection with no code at all. See
    // `deriveRejectionSites`' docblock for why the route-side sweep does not
    // cover this and why a hand-typed arm table can never be the population.
    const d = derived.find((x) => x.label === "finalize-wizard")!;
    const sites = deriveRejectionSites(stripped(d.route));
    const codeless = sites.filter((s) => !s.coded);

    // Positive control FIRST. A scan that matched nothing would report zero
    // code-less sites and pass this test for the worst possible reason.
    expect.soft(
      sites.length,
      `Found ${sites.length} 4xx/5xx NextResponse.json sites on finalize-wizard; ` +
        `${EXPECTED_FINALIZE_REJECTION_SITES} were measured at 153.1-06. If a ` +
        `rejection was ADDED, bump this literal in the SAME commit that gives ` +
        `the arm a code. A number near zero means the scan broke, and a broken ` +
        `scan reports "no code-less rejections" for a route made entirely of them.`,
    ).toBe(EXPECTED_FINALIZE_REJECTION_SITES);

    expect.soft(
      codeless.length,
      `finalize-wizard answers ${codeless.length} rejections with NO code ` +
        `(statuses ${codeless.map((s) => s.status).join(", ")}); ` +
        `${KNOWN_CODELESS_FINALIZE_REJECTIONS} are the KNOWN, RECORDED debt. A ` +
        `code-less rejection renders the UNKNOWN card — "We could not classify ` +
        `this failure" — for a failure this route classified well enough to ` +
        `pick a status and write a sentence about. ⛔ IF THIS NUMBER WENT UP, ` +
        `THE REMEDY IS A CODE ON THE NEW ARM plus a member in ` +
        `KNOWN_FINALIZE_CODES — never a bump of this literal. If it went DOWN, ` +
        `an arm was fixed: lower the literal and delete its row from the ` +
        `ledger's docblock, which is the direction WIZFORM-02 is travelling.`,
    ).toBe(KNOWN_CODELESS_FINALIZE_REJECTIONS);

    // The two populations reconcile against each other, which is what makes
    // either one's drift visible: the coded sites this scan sees are the same
    // sites `deriveEmittedCodes` sees. If they disagree, one of the two
    // predicates changed and the other did not.
    //
    // ⛔ THE RIGHT-HAND SIDE MUST BE THE OTHER SCANNER'S OUTPUT, NOT A THIRD
    // LITERAL. It used to read `d.expectedSites`, which made the whole
    // assertion `30 - 5 === 25` — both operands come from
    // `deriveRejectionSites`, and both are already pinned by the two
    // `expect.soft`s above, so whenever those passed this one was
    // arithmetically forced and could not fail. `deriveEmittedCodes` was never
    // read, so the divergence it exists to catch was invisible: break
    // `emitterRe` until it returns 20 codes for finalize-wizard and this
    // assertion still passed green while claiming the two predicates agree.
    expect.soft(
      sites.length - codeless.length,
      `the CODED rejections deriveRejectionSites sees (${
        sites.length - codeless.length
      }) and the emitters deriveEmittedCodes sees (${d.codes.length}) have ` +
        "diverged — the two predicates no longer describe the same sites, so " +
        "one of them is measuring something nobody decided on.",
    ).toBe(d.codes.length);
  });

  it("SELF-TEST — the rejection scan sees a CODE-LESS arm that the emitter scan cannot", () => {
    // ⚠️ THE POSITIVE CONTROL FOR THE ASSERTION ABOVE, and the clearest
    // statement of why it had to be written. The same fixture is INVISIBLE to
    // `deriveEmittedCodes` — no code literal, nothing to match — which is
    // exactly how a code-less arm slips past every other guard in this file.
    const codeless = [
      "      return NextResponse.json(",
      '        { error: "Could not finalize wizard draft" },',
      "        { status: 500, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(codeless, "[45]\\d\\d")).toEqual([]);
    expect(deriveRejectionSites(codeless)).toEqual([
      { status: 500, coded: false },
    ]);

    // A coded arm is seen by BOTH, and reported as coded by this one.
    const coded = [
      "      return NextResponse.json(",
      '        { code: "GATE_DRAFT_GONE", error: "The draft is gone" },',
      "        { status: 404, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveRejectionSites(coded)).toEqual([{ status: 404, coded: true }]);

    // A SUCCESS is not a rejection. Without this the scan would count every
    // answer the route gives and the ledger literal would be meaningless.
    const ok = [
      "      return NextResponse.json(",
      "        { ok: true, strategy_id: id },",
      "        { status: 200, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveRejectionSites(ok)).toEqual([]);

    // ⚠️ A REORDERED arm is UNCODED to this scan too, on purpose: it is
    // invisible to the wizard's scanner, which is the fact that matters. If
    // this scan were more permissive than `emitterRe`, the two would disagree
    // about the same site and the reconciliation above would red for a reason
    // nobody could act on.
    const reordered = [
      "      return NextResponse.json(",
      '        { error: "The draft is gone", code: "GATE_DRAFT_GONE" },',
      "        { status: 404, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveRejectionSites(reordered)).toEqual([
      { status: 404, coded: false },
    ]);
  });

  it.each(SPLIT_ROUTE_LABELS)(
    "%s: KEY_INVALID_FORMAT survives at exactly ONE guard — the ccxt short-secret arm",
    (label) => {
      // ⚠️ SCOPED TO THE TWO SPLIT ROUTES SINCE 153.1-06, and the scoping is
      // the honest reading rather than a retirement: this is a fact about the
      // ccxt key-validation split. `finalize-wizard` emits KEY_INVALID_FORMAT
      // ZERO times — it validates wizard METADATA, not key material — so
      // running this over it would demand a guard that must not exist.
      const d = derived.find((x) => x.label === label)!;
      const n = d.codes.filter((c) => c === "KEY_INVALID_FORMAT").length;
      expect(
        n,
        `${label} answers KEY_INVALID_FORMAT at ${n} guards; exactly ` +
          `${EXPECTED_FORMAT_EMITTERS_PER_ROUTE} is correct. More than one ` +
          `means a cause that is not a format failure has been folded back ` +
          `into the bucket this phase split — and its copy ("Binance secrets ` +
          `are 64 hex characters") becomes false again for that cause. Zero ` +
          `means the one genuine format guard lost its code.`,
      ).toBe(EXPECTED_FORMAT_EMITTERS_PER_ROUTE);
    },
  );

  it("the two KEY-VALIDATION routes emit the SAME set of codes — they are structural mirrors", () => {
    // Not a tautology: the routes are separate files with separate guards, and
    // the phase's stated risk is fixing one and leaving the other. A divergence
    // here means a guard was edited on one side only.
    //
    // ⚠️ LOOKED UP BY LABEL SINCE 153.1-06. This was `const [a, b] = derived`,
    // which stays green by ACCIDENT now that a third route exists — it happens
    // to destructure the first two — and would start comparing the wrong pair
    // the day an entry is inserted above them. `finalize-wizard` has no mirror
    // and must never be dragged into this comparison.
    const [aLabel, bLabel] = SPLIT_ROUTE_LABELS;
    const a = derived.find((x) => x.label === aLabel)!;
    const b = derived.find((x) => x.label === bLabel)!;
    expect(
      [...new Set(a.codes)].sort(),
      `${aLabel} and ${bLabel} mirror each other guard for guard; their ` +
        `emitted vocabularies diverged, which means one side was edited alone.`,
    ).toEqual([...new Set(b.codes)].sort());
  });

  it("the two SPLIT routes' emitted vocabulary is the hand-typed split set — no more, no less", () => {
    // ⚠️ SCOPED TO THE TWO SPLIT ROUTES SINCE 153.1-06. EXPECTED_SPLIT_CODES is
    // the five codes 142.2-07 minted and left in place; it is a fact about the
    // ccxt split, not about the wizard's whole vocabulary.
    // ⛔ The other way to make the third entry fit was to WIDEN
    // EXPECTED_SPLIT_CODES by finalize-wizard's nineteen codes. That would have
    // turned a closed-set assertion into a list of whatever happens to be
    // emitted — a guard retired to accommodate a new route.
    const split = derived.filter((d) => SPLIT_ROUTE_LABELS.includes(d.label));
    expect(split.length, "SPLIT_ROUTE_LABELS matched no ROUTES entry").toBe(
      SPLIT_ROUTE_LABELS.length,
    );
    const all = new Set(split.flatMap((d) => d.codes));
    expect(
      [...all].sort(),
      "The set of codes these two routes put on the wire changed. If a code " +
        "was added, it needs a copy entry and a roster row; if one vanished, " +
        "a cause silently merged back into another.",
    ).toEqual([...EXPECTED_SPLIT_CODES].sort());
  });

  it("SELF-TEST — the scanner reads a code out of real emitter syntax", () => {
    // The POSITIVE half, and the load-bearing one: a regex narrowed until it
    // matches nothing satisfies every "missing is empty" assertion above.
    const real = [
      "    return NextResponse.json(",
      '      { code: "REAL_CODE", error: "something is required" },',
      "      { status: 400, headers: NO_STORE_HEADERS },",
      "    );",
    ].join("\n");
    expect(deriveEmittedCodes(real)).toEqual(["REAL_CODE"]);
  });

  it("SELF-TEST — a code inside a COMMENT is not an emitter (the 14-vs-12 lesson)", () => {
    // ⚠️ THIS IS THE EXACT DEFECT THAT PRODUCED THIS PHASE'S WRONG SITE COUNT.
    // Both wizard routes carry comment prose naming KEY_INVALID_FORMAT — the
    // MT5 short-login carve-out explains which rejection it avoids — so a raw
    // grep returned 14 per file where only 12 are emitters. The research
    // documents recorded 28 sites; the truth is 24.
    const src = [
      '    // the ccxt venues keep the KEY_INVALID_FORMAT rejection below',
      "    return NextResponse.json(",
      '      { code: "REAL_CODE", error: "x" },',
      "      { status: 400, headers: NO_STORE_HEADERS },",
      "    );",
    ].join("\n");
    const out = stripCommentsPreserveLines(src, "ts");
    expect(out).not.toContain("KEY_INVALID_FORMAT");
    expect(out).toContain("REAL_CODE");
    expect(deriveEmittedCodes(out)).toEqual(["REAL_CODE"]);
  });

  it("SELF-TEST — the excluded shapes really are excluded", () => {
    // The shorthand 400 (`{ code }`, no literal, no error key) and the
    // limiter's nested deny bodies. If either started matching, the site count
    // would move for a reason that has nothing to do with input validation,
    // and someone would 'fix' the literal 12 to cover it.
    const shorthand = [
      "      return NextResponse.json(",
      "        { code },",
      "        { status: 400, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(shorthand)).toEqual([]);

    const denyBodies = [
      "    return rateLimitDenyJson(rl, {",
      "      headers: NO_STORE_HEADERS,",
      '      throttledBody: { code: "KEY_RATE_LIMIT", error: "Too many requests" },',
      "      misconfiguredBody: {",
      '        code: "SEAM_MISCONFIGURED",',
      '        error: "Rate limiter unavailable",',
      "      },",
      "    });",
    ].join("\n");
    expect(deriveEmittedCodes(denyBodies)).toEqual([]);
  });

  it("SELF-TEST — a WIDENED status fragment sees a 502 coded rejection", () => {
    // The POSITIVE half of the per-route widening. `finalize-wizard` answers
    // its coded arms at 400/403/404/409/502/503; a predicate that can only see
    // 400 finds almost none of them and then satisfies every "the missing set
    // is empty" assertion by measuring nothing.
    const seamDown = [
      "      return NextResponse.json(",
      '        { code: "SERVICE_UNREACHABLE", error: "The service is unreachable" },',
      "        { status: 502, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(seamDown, "[45]\\d\\d")).toEqual([
      "SERVICE_UNREACHABLE",
    ]);
  });

  it("SELF-TEST — the NARROW status fragment still refuses that same 502", () => {
    // ⚠️ THIS IS WHAT PROVES THE PER-ROUTE SCOPING IS REAL AND NOT DECORATIVE.
    // If the widening had leaked into the default, the two incumbent routes
    // would silently pick up their 403/409/500 coded answers, their pinned
    // site count would move 12 → 16, and someone would "fix" the literal to
    // cover it — converting a population change into a scanner change.
    const seamDown = [
      "      return NextResponse.json(",
      '        { code: "SERVICE_UNREACHABLE", error: "The service is unreachable" },',
      "        { status: 502, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(seamDown)).toEqual([]);
    expect(deriveEmittedCodes(seamDown, "400")).toEqual([]);
  });

  it("SELF-TEST — an error body containing a `${…}` interpolation is still an emitter", () => {
    // ⚠️ THE THIRD BLINDNESS CLASS, and the one that survives BOTH the D-34
    // reorder and the status widening. The old body matcher was `[^}]*`, a
    // class that excludes `}` outright, so the brace closing `${…}` ended the
    // run and the match died before reaching the object literal's real close.
    // Four finalize-wizard bodies interpolate a constant; this mirrors the
    // two-interpolation shape of the own-capital arm.
    const interpolated = [
      "      return NextResponse.json(",
      "        {",
      '          code: "DRAFT_STATE_INVALID",',
      "          error: `capital_source must be ${OWN_CAPITAL} or ${TEAM_REVIEW}`,",
      "        },",
      "        { status: 400, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(interpolated)).toEqual(["DRAFT_STATE_INVALID"]);
    expect(deriveEmittedCodes(interpolated, "[45]\\d\\d")).toEqual([
      "DRAFT_STATE_INVALID",
    ]);
  });

  it("SELF-TEST — `{ error, code }` key order is STILL invisible under BOTH fragments (D-34)", () => {
    // ⚠️ THE NEGATIVE THIS WHOLE PLAN TURNS ON. Fourteen pre-existing
    // finalize-wizard arms are written `{ error, code }`; they are out of scope
    // today ONLY because the predicate gated on 400. Once a route arrives with
    // a widened fragment, "the scanner found nothing" and "there was nothing to
    // find" become indistinguishable unless this test exists — and the coverage
    // assertion would go blind on the PRE-EXISTING arms, not merely on newly
    // added ones.
    //
    // ⛔ The remedy is to REORDER THE ROUTE (153.1-06), never to relax this
    // predicate. Accepting `{ error, code }` here would make the reorder
    // optional and the defect legal.
    const wrongOrder = [
      "      return NextResponse.json(",
      '        { error: "The draft is gone", code: "GATE_DRAFT_GONE" },',
      "        { status: 404, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(wrongOrder)).toEqual([]);
    expect(deriveEmittedCodes(wrongOrder, "400")).toEqual([]);
    expect(deriveEmittedCodes(wrongOrder, "[45]\\d\\d")).toEqual([]);

    // The same arm written the RIGHT way round IS seen — otherwise the
    // assertion above would pass for a scanner that matches nothing at all.
    const rightOrder = [
      "      return NextResponse.json(",
      '        { code: "GATE_DRAFT_GONE", error: "The draft is gone" },',
      "        { status: 404, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(rightOrder, "[45]\\d\\d")).toEqual([
      "GATE_DRAFT_GONE",
    ]);

    // The SECOND lever, and the other half of D-34: a `code:`-FIRST arm whose
    // literal is lowercase. `finalize-wizard` has one (`draft_state_invalid`).
    // It fails the `[A-Z][A-Z0-9_]*` class, and it must keep failing it — the
    // remedy is to rename the code, never to widen the class, because a
    // lowercase code cannot be a `WizardErrorCode` union member either.
    const lowercase = [
      "      return NextResponse.json(",
      '        { code: "draft_state_invalid", error: "The draft moved on" },',
      "        { status: 409, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(lowercase, "[45]\\d\\d")).toEqual([]);
  });

  it("SELF-TEST — the lazy body run cannot reach the NEXT emitter's status", () => {
    // The cap's own falsifier. If `EMITTER_BODY_MAX_CHARS` were removed or
    // raised past the measured 202-character neighbour distance, a malformed
    // body would backtrack past its own close and report ITS code against the
    // FOLLOWING emitter's status — inflating counts for a reason that has
    // nothing to do with the route's guards.
    // ⛔ THE BOUND IS ASSERTED DIRECTLY, and the fixture below is a SECOND,
    // weaker check rather than the primary one. It used to be the only check,
    // and it was ~100 characters weaker than the prose above it: the filler was
    // sized 200 to model the measured 202-character neighbour distance, but the
    // regex run is measured from `error:` to the next `}`, and the fixture
    // injects ~104 characters of scaffolding into that span that the sizing did
    // not account for (26 of the first body, 31 for the newline-plus-
    // `return NextResponse.json(` line, 45 of the second body before its close).
    // The real span was 304, so the fixture only red at cap >= ~305 — MEASURED,
    // by sweeping the cap through this file's own regex: 160/200/250/300/304 all
    // returned ["SECOND_CODE"] and only 320 returned ["FIRST_CODE"]. A cap of
    // 250 — genuinely unsafe against the 202 bound — passed green. A guard which
    // cannot fail across the range that matters is worse than no guard, so the
    // property is now stated as itself.
    expect(
      EMITTER_BODY_MAX_CHARS,
      "The lazy body run can now reach past a malformed emitter's own close " +
        "and report ITS code against the FOLLOWING emitter's status, " +
        "inflating counts for a reason that has nothing to do with the " +
        "route's guards. 202 is the measured shortest distance from any " +
        "`error:` to the next emitter's `status:` on the real sources; the " +
        "cap must stay under it.",
    ).toBeLessThan(202);

    // ⚠️ THE GAP IS HAND-TYPED 100, NOT `EMITTER_BODY_MAX_CHARS + n`. A filler
    // sized off the constant under test grows with it, so raising the cap to
    // 2 000 would move the fixture too and this test would stay green for the
    // exact change it exists to catch — the self-referential oracle again, in
    // miniature. 100 puts this fixture's REAL span (filler + the ~104 chars of
    // scaffolding described above) at ~205, just past the 202 bound, so it
    // stays a behavioural demonstration that the cap does terminate the run.
    const unterminated = [
      "      return NextResponse.json(",
      '        { code: "FIRST_CODE", error: "no closing context here"',
      "      ".padEnd(100, "x"),
      "      return NextResponse.json(",
      '        { code: "SECOND_CODE", error: "fine" },',
      "        { status: 400, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(unterminated)).toEqual(["SECOND_CODE"]);
  });

  it("SELF-TEST — the union scan stops at the declaration, not at the copy table", () => {
    const fake = [
      'export type WizardErrorCode =',
      '  | "UNION_MEMBER"',
      '  | "UNKNOWN";',
      "",
      "const WIZARD_ERROR_COPY = {",
      '  NOT_A_UNION_MEMBER: { title: "x" },',
      "};",
    ].join("\n");
    expect(deriveUnionMembers(fake)).toEqual(["UNION_MEMBER", "UNKNOWN"]);
  });

  it("SELF-TEST — the REAL alias table parsed, and it carries the CIRCUIT_OPEN pair", () => {
    // ⚠️ THE LOAD-BEARING HALF OF THE ALIAS LAW (153.1-06). The two membership
    // assertions above were WIDENED to admit a code the alias table translates.
    // A widened admission rule over an EMPTY table is a no-op that passes for
    // the wrong reason — and worse, an alias derivation that silently returns
    // [] would make the widening look harmless while it quietly stopped
    // covering `CIRCUIT_OPEN` at all. So the real table is asserted here, from
    // disk, rather than trusted.
    expect(
      alias.size,
      "SEAM_CODE_TO_WIZARD_CODE parsed as EMPTY. Every 'or the alias table " +
        "makes it one' clause above is then a no-op, and the assertions pass " +
        "while measuring nothing. Check deriveAliasPairs' anchors against the " +
        "declaration in wizardErrors.ts before touching anything else.",
    ).toBeGreaterThan(3);
    expect(
      alias.get("CIRCUIT_OPEN"),
      "CIRCUIT_OPEN is the ONE live case the widened admission exists for: " +
        "finalize-wizard emits it at the breaker-open 503, it is deliberately " +
        "NOT a WizardErrorCode, and SubmitStep translates it before the " +
        "membership check. If this row is gone the code renders UNKNOWN.",
    ).toBe("SERVICE_UNAVAILABLE_RETRY");
    // And the target really is a union member — the alias hop is only a cover
    // if it lands somewhere WIZARD_ERROR_COPY can answer for.
    expect(union.has("SERVICE_UNAVAILABLE_RETRY")).toBe(true);
    // The table is NOT an identity rule, and this is what proves the widening
    // did not quietly legalise every wire code. `SEAM_DEGRADED` and the venue
    // codes are named in the table's own docblock as codes that correctly
    // answer UNKNOWN; if either started resolving, an unlisted emitter would be
    // admitted by the membership assertions above without anyone deciding so.
    expect(alias.has("SEAM_DEGRADED")).toBe(false);
    expect(alias.has("MT5_GATEWAY_UNREACHABLE")).toBe(false);
  });

  it("SELF-TEST — the alias scan reads the named Map and stops at its close", () => {
    // The boundary guarantee, and the negative that keeps the pair regex from
    // matching arbitrary two-string arrays further down the file. A scan that
    // over-ran into `recogniseSeamErrorCode` or the copy table below could
    // invent alias rows, and an invented row admits an emitter nobody covered.
    const fake = [
      "const SEAM_CODE_TO_WIZARD_CODE: ReadonlyMap<string, WizardErrorCode> = new Map<",
      "  string,",
      "  WizardErrorCode",
      ">([",
      '  ["WIRE_ONE", "MEMBER_ONE"],',
      '  ["WIRE_TWO", "MEMBER_TWO"],',
      "]);",
      "",
      "const SOMETHING_ELSE = [",
      '  ["NOT_AN_ALIAS", "ALSO_NOT_ONE"],',
      "];",
    ].join("\n");
    expect(deriveAliasPairs(fake)).toEqual([
      ["WIRE_ONE", "MEMBER_ONE"],
      ["WIRE_TWO", "MEMBER_TWO"],
    ]);
    // Missing declaration ⇒ empty, which the SELF-TEST above turns into a RED
    // rather than a silent permissive pass.
    expect(deriveAliasPairs("const OTHER = new Map([]);")).toEqual([]);
  });

  it("SELF-TEST — the roster scan reads the named Set and stops at its close", () => {
    const fake = [
      "const KNOWN_ADD_KEY_CODES: ReadonlySet<WizardErrorCode> =",
      "  new Set<WizardErrorCode>([",
      '    "IN_ROSTER",',
      '    "ALSO_IN_ROSTER",',
      "  ]);",
      "",
      "const KNOWN_OTHER_CODES: ReadonlySet<WizardErrorCode> =",
      "  new Set<WizardErrorCode>([",
      '    "IN_THE_OTHER_ONE",',
      "  ]);",
    ].join("\n");
    expect(deriveRoster(fake, "KNOWN_ADD_KEY_CODES")).toEqual([
      "IN_ROSTER",
      "ALSO_IN_ROSTER",
    ]);
    expect(deriveRoster(fake, "KNOWN_OTHER_CODES")).toEqual(["IN_THE_OTHER_ONE"]);
  });

  it("SELF-TEST — the roster scan reads a Set whose `(` and `[` are on DIFFERENT lines", () => {
    // ⚠️ THIS IS THE SHAPE THAT MADE THE SCANNER RETURN [] AND PASS ANYWAY.
    // Reproduced structurally from `SubmitStep.tsx:230` — declared INSIDE a
    // function body (hence the eight-space indent), type annotation, the call's
    // `(` at end of line, the `[` on the next, and a close that carries a
    // trailing comma (`],` then `);`) because it is one argument of a
    // multi-line argument list rather than the whole call.
    //
    // The old two-character anchors (`"(["` / `"])"`) matched NONE of this and
    // derived the empty set. An empty roster makes "every emitted code is
    // admitted by that route's roster" fail LOUD, but an empty roster paired
    // with an empty emitter derivation — which is what a third ROUTES entry
    // would have had under the 400-only predicate — passes silently. Fixing the
    // scanner BEFORE the third entry lands is what makes that assertion
    // evidence rather than decoration.
    const fake = [
      "        const KNOWN_FINALIZE_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(",
      "          [",
      '            "IN_FINALIZE_ROSTER",',
      '            "ALSO_IN_FINALIZE_ROSTER",',
      "          ],",
      "        );",
    ].join("\n");
    expect(deriveRoster(fake, "KNOWN_FINALIZE_CODES")).toEqual([
      "IN_FINALIZE_ROSTER",
      "ALSO_IN_FINALIZE_ROSTER",
    ]);
  });

  it("SELF-TEST — the line-broken scan STOPS at its own close and does not swallow the next Set", () => {
    // The boundary guarantee, restated for the widened anchors. The old anchors
    // were two literal characters and could not over-run; regex anchors CAN, so
    // the first-match semantics are pinned here rather than assumed. If the
    // closing anchor ever became lazy across the wrong boundary, the first
    // roster would silently absorb the second's members and every membership
    // assertion in this file would go permissive.
    const fake = [
      "        const KNOWN_FINALIZE_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(",
      "          [",
      '            "IN_FINALIZE_ROSTER",',
      "          ],",
      "        );",
      "",
      "        const KNOWN_LATER_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(",
      "          [",
      '            "IN_THE_LATER_ONE",',
      "          ],",
      "        );",
    ].join("\n");
    expect(deriveRoster(fake, "KNOWN_FINALIZE_CODES")).toEqual([
      "IN_FINALIZE_ROSTER",
    ]);
    expect(deriveRoster(fake, "KNOWN_LATER_CODES")).toEqual(["IN_THE_LATER_ONE"]);
  });
});
