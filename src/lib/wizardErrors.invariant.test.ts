// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";
// ⭐ W-153.7-1 — the LIVE verdict table, imported rather than re-parsed. It is
// one of the two doors a code leaves `classifyKeyValidationError` by, and the
// only one with no literal anywhere in the source (`return verdict`). Reading
// the real Map is what makes a NEW row join this file's population with no test
// edit — the property the 153.7-02 roster regression needed and did not have.
import { VENUE_WIRE_CODE_TO_VERDICT } from "./wizardErrors";

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
    // 25 → 27 (153.2-04 / WIZFORM-04 / D-14b). TWO guards were ADDED, both
    // with an honest code, and the literal is bumped in the SAME commit the
    // route starts emitting them — which is what this assertion's own failure
    // message instructs. They are:
    //   · `KEY_SCOPE_CHECK_UNAVAILABLE` (502) — a probe body our schema could
    //     not read, split off the `probe_error` arm because it is PERMANENT;
    //   · `SEAM_MISCONFIGURED` (500) — `INTERNAL_API_TOKEN` unset, split off
    //     the generic tail because it is OUR configuration, not a blip.
    // Both were previously reported to the user as `KEY_NETWORK_TIMEOUT` with a
    // Retry that could never succeed. ⛔ Neither is a new REJECTION: both
    // conditions already blocked finalize, and both still fail CLOSED — only
    // what the user is told changed. Both codes are already members of
    // `KNOWN_FINALIZE_CODES`, so the coverage assertion below is satisfied
    // without a roster edit (verified at source, not assumed).
    //
    // 27 → 29 (153.2-05 / WIZFORM-02). ⛔ NO GUARD WAS ADDED — this is the
    // OTHER direction, and the only one that is good news: two rejections that
    // already existed stopped answering code-less. The route's own limiter deny
    // pair (429 throttle, 503 misconfiguration) now carries `RATE_LIMITED` and
    // `SEAM_MISCONFIGURED`, so both arms crossed OUT of the code-less ledger
    // and INTO this population. The sum is what proves nothing was invented:
    // `EXPECTED_FINALIZE_REJECTION_SITES` is unchanged at 32, and
    // `KNOWN_CODELESS_FINALIZE_REJECTIONS` falls 5 → 3 by the same two.
    // Neither code needed a roster edit — `SEAM_MISCONFIGURED` is already a
    // member and `RATE_LIMITED` is translated to itself by
    // `SEAM_CODE_TO_WIZARD_CODE` before the roster is consulted (verified at
    // source, not assumed).
    //
    // 29 → 32 (153.7-03 / WIZFORM-02-CLASS). ⛔ NO GUARD WAS ADDED — this is
    // the same good-news direction as the move above it, and it is the LAST
    // one available on this route: the three rejections that still answered
    // code-less now carry `DRAFT_LOOKUP_FAILED`, `DRAFT_FINALIZE_FAILED` and
    // `SEAM_RESPONSE_UNREADABLE`, so all three crossed OUT of the code-less
    // ledger and INTO this population. The sum is what proves nothing was
    // invented: `EXPECTED_FINALIZE_REJECTION_SITES` is unchanged at 32, and
    // `KNOWN_CODELESS_FINALIZE_REJECTIONS` falls 3 → 0 by the same three, so
    // 32 − 32 = 0. A plan that had invented three rejections to "fix" would
    // have moved that literal too.
    //
    // All three DID need a roster edit, unlike the 153.2-05 pair — none is a
    // wire code and none is translated by `SEAM_CODE_TO_WIZARD_CODE`, so the
    // membership check in `SubmitStep.tsx` is genuinely reached for them. The
    // three rows land in the SAME commit the route starts emitting them
    // (verified at source, not assumed).
    expectedSites: 32,
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
 * of these three puts a user in front of "We could not classify this failure"
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
 * ⭐⭐ 3 → 0 (153.7-03 / WIZFORM-02-CLASS). THE LEDGER IS EMPTY, AND THE
 * COLLAPSE CONDITION THIS DOCBLOCK PRE-AUTHORISED IS THE ONE THAT WAS REACHED.
 * The three rows that stood here — the 500 draft lookup, the 500 finalize-RPC
 * tail and the 502 upstream-shape arm — are DELETED rather than annotated,
 * which is exactly what the failure message below instructs for the downward
 * direction. Each was fixed the way that message names: a code on the arm plus
 * a member in `KNOWN_FINALIZE_CODES`, never a bump of this literal.
 *
 * ⛔ THE CONSTANT AND ITS ASSERTION STAY, and at zero they are stronger than
 * they have ever been rather than redundant. `expect(codeless.length).toBe(0)`
 * IS "every rejection this route makes carries a code" — the sentence this
 * docblock said the number would collapse into, and where WIZFORM-02's
 * criterion actually lands. Deleting the pair now would retire the guard at the
 * exact moment it became able to state the property outright, and the next
 * code-less arm would ship in silence.
 *
 * ⚠️ THE THREE COPY MEMBERS THE OLD NOTE SAID WERE OWED WERE WRITTEN, not
 * borrowed. Each was authored against the claim its own arm makes observable:
 * `DRAFT_LOOKUP_FAILED` may say nothing was changed (its arm is a SELECT that
 * errored, with no write anywhere before it); `DRAFT_FINALIZE_FAILED` may NOT
 * (the generic tail also catches a transport failure that could lose the answer
 * to a write that landed); `SEAM_RESPONSE_UNREADABLE` may claim neither outcome
 * (its upstream answered 2xx, so the submission was accepted and only the
 * result is unreadable). Three arms, three different truths — which is why one
 * shared member would have shipped a false sentence on two of them.
 *
 * The arithmetic, in the form `EXPECTED_FINALIZE_REJECTION_SITES` records it:
 * `expectedSites` 29 → 32, this ledger 3 → 0, the total UNCHANGED at 32, so
 * 32 − 32 = 0. A plan that had invented three rejections would have moved that
 * total.
 *
 * ⭐ 5 → 3 (153.2-05 / WIZFORM-02). THE TWO LIMITER ARMS ARE FIXED, so their
 * rows are DELETED here rather than annotated — the direction the failure
 * message below instructs. The 429 now carries `RATE_LIMITED` and the 503
 * carries `SEAM_MISCONFIGURED`; both moved into `expectedSites` above, which is
 * why that literal rose by exactly two while
 * `EXPECTED_FINALIZE_REJECTION_SITES` did not move at all.
 *
 * ⚠️ THE OLD LEDGER NAMED THE WRONG CODE FOR THE 429, and the correction is
 * worth keeping: it proposed `KEY_RATE_LIMIT` "because that is what the key
 * routes answer". That entry's copy opens "The exchange rate-limited this
 * request", which is false for `userActionLimiter` on our own per-user key —
 * the exchange is never contacted on that path. `RATE_LIMITED` is the member
 * 140.3-01 wrote for our own cap ("the cap is ours, not your exchange's"). A
 * ledger entry is a suggestion, not a verdict; this one was checked against the
 * copy before it was applied.
 *
 * ⚠️ THE REMAINING THREE NEED NEW COPY MEMBERS, which is why they are still
 * here: none of the existing entries states "our database read failed", "the
 * finalize RPC failed" or "the upstream answered in a shape we do not
 * recognise" without asserting something false. Minting them is a change to
 * `wizardErrors.ts` — Phase 153.1's file — plus three roster members, and it is
 * user-facing copy that wants the same care every other entry there got. It is
 * NOT deleted from this ledger to make a number smaller.
 *
 * ⭐ DISCHARGED at 153.7-03, and the paragraph above is kept rather than
 * rewritten because it is the record of what was owed and it priced the work
 * correctly: three copy members plus three roster rows, and its reason for
 * deferring — that none of the incumbent entries could carry these three
 * without asserting something false — held when it was finally checked. Two of
 * the three members it named were newly minted; the draft-read one adopted the
 * token `keys/sync` had already minted for the same fact, so the vocabulary
 * gained two names, not three.
 */
const KNOWN_CODELESS_FINALIZE_REJECTIONS = 0;

/**
 * Every rejection site on `finalize-wizard`, coded or not (measured 153.1-06).
 *
 * 30 → 32 (153.2-04): the two split arms above. ⚠️ Both arrive CODED, so
 * `KNOWN_CODELESS_FINALIZE_REJECTIONS` stayed at 5 — the ledger of debt did not
 * grow, and the arithmetic this pair feeds (32 − 27 = 5) held. That is the
 * point of keeping the two numbers separate: a NEW code-less rejection would
 * move this literal without moving `expectedSites`, and the difference
 * assertion would name it.
 *
 * ⭐ UNCHANGED AT 32 by 153.2-05, and that is the whole proof its change was a
 * FIX rather than an addition: two arms moved from the code-less side to the
 * coded side (`expectedSites` 27 → 29, the ledger 5 → 3), so the total holds
 * and 32 − 29 = 3. A plan that had invented two rejections to "fix" would have
 * moved this literal too.
 */
const EXPECTED_FINALIZE_REJECTION_SITES = 32;

/**
 * HAND-TYPED. The two routes 142.2-07 split, by LABEL.
 *
 * ⚠️ 153.1-06 — TWO ASSERTIONS BELOW ARE FACTS ABOUT THESE TWO ROUTES ONLY, and
 * they are driven off this list rather than off `ROUTES` wholesale. The
 * `KEY_INVALID_FORMAT`-exactly-once rule and the "emitted vocabulary is the
 * hand-typed split set" rule both describe the ccxt KEY-VALIDATION split: one
 * format guard per route, five codes between them. `finalize-wizard` is
 * deliberately OUTSIDE both — it validates wizard METADATA, not key material,
 * emits `KEY_INVALID_FORMAT` zero times, and its vocabulary is twenty-two codes
 * that have nothing to do with the split.
 *
 * ⚠️ PROSE, NOT A PIN — and it had drifted, which is why the correction is
 * noted rather than silently applied. "Nineteen" was measured at 153.1-06 and
 * was never re-cut when 153.2-04/05 put `SEAM_MISCONFIGURED`, `RATE_LIMITED`
 * and `DRAFT_STATE_INVALID` on the wire (`expectedSites` moved 25 → 27 → 29 and
 * this sentence did not). 153.6-06 re-measured the derivation directly — 29
 * sites, 22 distinct codes — rather than adding one to a stale figure, which
 * would have re-published the drift as a fresh measurement. Nothing here
 * asserts the number; if it drifts again the cost is a false sentence, not a
 * false green, which is precisely why it is worth re-measuring rather than
 * incrementing.
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
    // EXPECTED_SPLIT_CODES by finalize-wizard's twenty-two codes. That would
    // have turned a closed-set assertion into a list of whatever happens to be
    // emitted — a guard retired to accommodate a new route. (Prose, re-measured
    // at 153.6-06; see the SPLIT_ROUTE_LABELS docblock for why the figure moved
    // by three rather than by one.)
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
    // did not quietly legalise every wire code. Both names below are absent
    // from it on purpose; if either started resolving, an unlisted emitter
    // would be admitted by the membership assertions above without anyone
    // deciding so.
    //
    // ⚠️ RE-CUT 2026-08-14 (153.7-03). This comment used to say the table's
    // docblock names these as codes that "correctly answer UNKNOWN", which is
    // no longer true of the second one and was never true in the way it read:
    // `MT5_GATEWAY_UNREACHABLE` now has a row in `VENUE_WIRE_CODE_TO_VERDICT`
    // answering `SERVICE_UNREACHABLE`/503, and its UNKNOWN was the live
    // WIZFORM-02 defect rather than a correct verdict. ⭐ THE ASSERTION IS
    // UNCHANGED AND IS STILL RIGHT — that is the point worth keeping. The two
    // tables are separate mechanisms read at different call sites, so a verdict
    // row neither implies nor needs an alias row. Only the prose was wrong.
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ W-153.7-1 — THE LAST HOP, WHICH WAS THE ONE HOP NOTHING GUARDED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── THE MEASUREMENT THAT PUT THIS FILE HERE ─────────────────────────────────
 *
 * 153.7's verifier deleted the line `"SEAM_INTERNAL_FAULT",` from
 * `KNOWN_CREATE_WITH_KEY_CODES` and ran the four files that plausibly cover it:
 * `ConnectKeyStep.test.tsx`, `wizardErrors.test.ts`,
 * `wizardErrors.invariant.test.ts` and `seam-venue-vocabulary.invariant.test.ts`.
 * **312 passed, 0 failed.** With that one line gone the wizard renders
 * `code: UNKNOWN` — *"We could not classify this failure"*, **with a Retry
 * control** — for `MT5_GATEWAY_UNCONFIGURED`, `ADAPTER_INIT_FAILED` and
 * `INTERNAL`, three faults the service marks `retryable=False`. That is the
 * exact shape of the 2026-08-05 `SERVICE_UNREACHABLE` incident this roster's own
 * docblock records, re-created in silence.
 *
 * ── WHY THE INCUMBENT GUARD ABOVE COULD NOT SEE IT ──────────────────────────
 *
 * `ROUTES`' coverage assertion derives its population with `deriveEmittedCodes`,
 * which matches `NextResponse.json({ code: "<LITERAL>", error: … }, …)` in the
 * ROUTE source. That is why the three new `finalize-wizard` codes ARE covered —
 * they are literals in `finalize-wizard/route.ts`. But a code returned by
 * `classifyKeyValidationError` is **never a literal in the route**: both key
 * routes write `const { code, status } = classifyKeyValidationError(err)` and
 * then `NextResponse.json({ code }, …)` — a shorthand, computed value. The whole
 * classifier-returned half of both rosters therefore sits outside `expectedSites`
 * entirely. The asymmetry is structural, not an oversight in the predicate.
 *
 * ── THE POPULATION, AND WHY IT IS DERIVED TWO WAYS ──────────────────────────
 *
 * A code can leave `classifyKeyValidationError` by exactly two doors, and each
 * needs its own derivation because each is invisible to the other's:
 *
 *   A. THE CASCADE — `return { code: "X", status: N }` written as a literal in
 *      the function body. Source-scanned, bounded to that function.
 *   B. THE VERDICT TABLE — `VENUE_WIRE_CODE_TO_VERDICT.get(seamCode)`, returned
 *      as `return verdict`, a computed value with no literal anywhere. Read from
 *      the LIVE exported Map, so a new row joins this population with no test
 *      edit — which is the property the 153.7-02 regression needed and did not
 *      have.
 *
 * ⛔ NEITHER HALF MAY BE A HAND-TYPED LIST. The rosters stay hand-typed (that is
 * this file's stated design and `ConnectKeyStep`'s), but the population they are
 * checked AGAINST must be derived, or the guard becomes two hand-typed lists
 * agreeing with each other — a self-referential oracle, which is the one
 * construction this repo has already paid for three times.
 *
 * ⚠️ ADMISSION IS TRANSLATE-FIRST, MEMBERSHIP-SECOND — the same rule the
 * incumbent assertion uses, and the same one both steps implement
 * (`recogniseSeamErrorCode(seamErrorCode(data))` runs before the roster check).
 * A code the alias table answers needs no roster row, and adding one would be a
 * type error. `SEAM_MISCONFIGURED` is the live case.
 */
const CLASSIFIER_STEPS: readonly {
  readonly label: string;
  readonly rosterFile: string;
  readonly rosterName: string;
}[] = [
  {
    label: "create-with-key → ConnectKeyStep",
    rosterFile: join(WIZARD_STEPS, "ConnectKeyStep.tsx"),
    rosterName: "KNOWN_CREATE_WITH_KEY_CODES",
  },
  {
    label: "composite/add-key → MultiKeyConnectStep",
    rosterFile: join(WIZARD_STEPS, "MultiKeyConnectStep.tsx"),
    rosterName: "KNOWN_ADD_KEY_CODES",
  },
];

/**
 * Every code the CASCADE returns as a literal, bounded to
 * `classifyKeyValidationError`'s own body.
 *
 * ⚠️ THE BOUND IS LOAD-BEARING IN BOTH DIRECTIONS. Unbounded, this would sweep
 * `recogniseSeamErrorCode` and every other `return { code: … }` in a 3600-line
 * module, inventing population members no key route can produce and forcing
 * roster rows for them. Bounded too tightly (a regex that matches nothing) it
 * returns `[]` and the assertion passes over half a population.
 *
 * ⛔ THE CLOSING ANCHOR IS `\n}\n` — A BRACE ALONE ON ITS LINE — AND NOT THE
 * FIRST COLUMN-ZERO `}`, WHICH IS THE BUG THIS COMMENT EXISTS TO STOP BEING
 * REINTRODUCED. `classifyKeyValidationError`'s return type is a MULTI-LINE
 * OBJECT LITERAL:
 *
 *     export function classifyKeyValidationError(error: unknown): {
 *       code: WizardErrorCode;
 *       status: number;
 *     } {
 *
 * so the first column-zero `}` closes the TYPE, three lines in, and a body
 * bounded there contains no `return` at all. Written that way this scanner
 * returned ZERO codes and the membership assertion below passed over an empty
 * population — a guard that cannot fail, which is worse than no guard. It was
 * caught by the vacuity floor and not by review, which is the argument for the
 * floor. The type's closing line is `} {`, so `\n}\n` skips it; the function's
 * own closer is a brace alone on its line. The SELF-TEST reproduces the exact
 * signature shape.
 */
function deriveClassifierCascadeCodes(source: string): string[] {
  const start = source.indexOf("export function classifyKeyValidationError");
  if (start < 0) return [];
  const tail = source.slice(start);
  const end = /\n\}\n/.exec(tail);
  if (end === null) return [];
  const body = tail.slice(0, end.index);
  return [
    ...body.matchAll(/return\s*\{\s*code:\s*"([A-Z][A-Z0-9_]*)"/g),
  ].map((m) => m[1]);
}

describe("[153.7 review W-153.7-1] every CLASSIFIER-returned code is admitted by its key step", () => {
  const unionSource = stripped(UNION_SOURCE);
  const alias = new Map(deriveAliasPairs(unionSource));

  // DOOR A — the cascade's literals, from source.
  const cascade = deriveClassifierCascadeCodes(unionSource);
  // DOOR B — the verdict table, from the LIVE exported Map. Not a copy of it,
  // and not a re-parse of its declaration: a new row must join this population
  // with no edit here.
  const verdicts = [...VENUE_WIRE_CODE_TO_VERDICT.values()].map((v) => v.code);

  const reachable = [...new Set([...cascade, ...verdicts])].sort();

  it("the population is NOT VACUOUS — BOTH doors, separately", () => {
    // ⭐ SEPARATELY, and that is the point of two assertions rather than one on
    // the union. The two derivations are independent mechanisms with
    // independent ways to break, and a healthy total would hide a dead half:
    // the cascade alone clears any sane floor on the union, so a verdict table
    // that parsed as empty — the exact 153.7-02 regression this guard exists
    // for — would pass a union-only check silently.
    expect(
      cascade.length,
      `Only ${cascade.length} literal verdicts were scanned out of ` +
        `classifyKeyValidationError's body (10 measured at 153.7). A number ` +
        `near zero means the BOUND broke — either the declaration anchor or the ` +
        `column-zero closing brace — and a broken bound makes the assertion ` +
        `below pass over an empty population.`,
    ).toBeGreaterThanOrEqual(10);

    expect(
      verdicts.length,
      "VENUE_WIRE_CODE_TO_VERDICT is empty. That table is the ONLY door " +
        "through which a wire code reaches a wizard card, so an empty one " +
        "makes this whole guard vacuous.",
    ).toBeGreaterThanOrEqual(8);

    expect(alias.size, "SEAM_CODE_TO_WIZARD_CODE parsed as empty").toBeGreaterThan(3);
  });

  it.each(CLASSIFIER_STEPS.map((s) => s.label))(
    "%s: the roster parsed, and it is not a stub",
    (label) => {
      const step = CLASSIFIER_STEPS.find((s) => s.label === label)!;
      const roster = deriveRoster(stripped(step.rosterFile), step.rosterName);
      expect(
        roster.length,
        `${step.rosterName} parsed as ${roster.length} members. A roster that ` +
          `parsed as [] admits nothing, and the assertion below would then ` +
          `report EVERY code as missing rather than passing — but a roster that ` +
          `parsed as one or two would report a plausible-looking subset. Pin ` +
          `the floor so neither reads as a real finding.`,
      ).toBeGreaterThan(10);
    },
  );

  it.each(CLASSIFIER_STEPS.map((s) => s.label))(
    "%s: no classifier verdict can reach the step and be rejected as unrecognised",
    (label) => {
      const step = CLASSIFIER_STEPS.find((s) => s.label === label)!;
      const roster = new Set(deriveRoster(stripped(step.rosterFile), step.rosterName));

      const missing = reachable
        .filter((code) => !alias.has(code) && !roster.has(code))
        .sort();

      expect(
        missing,
        `${step.rosterName} does not admit ${missing.length} code(s) that ` +
          `classifyKeyValidationError can return, and SEAM_CODE_TO_WIZARD_CODE ` +
          `does not translate them either. THE USER-VISIBLE CONSEQUENCE, ` +
          `measured on this exact hop at 153.7: the step rejects the honest ` +
          `code, renders UNKNOWN — "We could not classify this failure" — and ` +
          `UNKNOWN's copy IS recoverable, so a Retry control appears against a ` +
          `fault the service marked retryable=False. That is the 2026-08-05 ` +
          `SERVICE_UNREACHABLE incident, and it ships with every other test ` +
          `green. ⛔ THE REMEDY IS A ROW IN ${step.rosterName} in the SAME ` +
          `commit the classifier starts returning the code — never a deletion ` +
          `from the verdict table, and never a merge of the two rosters (they ` +
          `are separate on purpose; see ConnectKeyStep's docblock).`,
      ).toEqual([]);
    },
  );

  it("SELF-TEST — the bound clears the MULTI-LINE RETURN TYPE and stops at the function's own brace", () => {
    // ⛔ THE SIGNATURE SHAPE IS THE POINT, not decoration. The real function's
    // return type is a multi-line object literal, so a bound anchored on the
    // first column-zero `}` stops INSIDE the signature and yields zero codes —
    // which is what the first draft of this scanner did, and it made the
    // membership assertion below unfailable. Reproduced here so the fixture
    // reds if anyone re-narrows the anchor.
    const fake = [
      "export function somethingEarlier(): void {",
      '  return { code: "BEFORE_THE_FUNCTION", status: 400 };',
      "}",
      "",
      "export function classifyKeyValidationError(error: unknown): {",
      "  code: WizardErrorCode;",
      "  status: number;",
      "} {",
      '  if (a) return { code: "INSIDE_ONE", status: 503 };',
      "  if (b) {",
      '    return { code: "INSIDE_TWO", status: 400 };',
      "  }",
      '  return { code: "INSIDE_TERMINAL", status: 500 };',
      "}",
      "",
      "export function somethingLater(): void {",
      '  return { code: "AFTER_THE_FUNCTION", status: 400 };',
      "}",
    ].join("\n");

    expect(deriveClassifierCascadeCodes(fake)).toEqual([
      "INSIDE_ONE",
      "INSIDE_TWO",
      "INSIDE_TERMINAL",
    ]);

    // And a missing declaration yields [] rather than the whole file — which is
    // why the vacuity floor above is the thing that catches a renamed function,
    // not this.
    expect(deriveClassifierCascadeCodes("const x = 1;\n")).toEqual([]);
  });

  /**
   * ⭐ W-153.7-2 — A CLASS FIX WITH NO OWNER IS A CLASS FIX THAT DOES NOT HAPPEN.
   *
   * Both rosters' docblocks assigned the derived-roster class fix to *"Phase 153
   * / WIZFORM-02"*. That requirement is ticked **COMPLETE** in `REQUIREMENTS.md`
   * as of 2026-08-14 — and 153.7 grew both lists anyway — so the pointer named a
   * closed requirement and the work became nobody's. It was not in `TODOS.md`
   * either (grepped by the verifier).
   *
   * ⛔ THIS IS NOT A PROSE-STYLE ASSERTION, and the distinction matters under
   * this project's stopping rule: it is a two-sided REFERENTIAL INTEGRITY check
   * between a comment and the single backlog file. It reds if the citation is
   * removed from either roster (ownerless again) **or** if the `TODOS.md` item is
   * deleted while the comments still point at it (a dangling pointer, which is
   * the same defect wearing the other shoe). Neither side can be "fixed" by
   * editing the other into agreement without the owner actually existing.
   *
   * The ID is deliberately a short stable token rather than a sentence, so a
   * reword of either docblock cannot break this while the ownership survives.
   */
  it("[W-153.7-2] both rosters cite a LIVE owner for the derived-roster class fix", () => {
    const OWNER_ID = "ROSTER-DERIVE-01";

    const todos = readFileSync(join(REPO, "TODOS.md"), "utf-8");
    expect(
      todos.includes(OWNER_ID),
      `TODOS.md carries no ${OWNER_ID} item, but both key-step rosters cite it ` +
        `as the owner of the derived-roster class fix. A dangling pointer is ` +
        `the same defect as no pointer: add the item back, or re-point both ` +
        `docblocks at whoever really owns it.`,
    ).toBe(true);

    for (const step of CLASSIFIER_STEPS) {
      // ⚠️ Read the RAW source, not the comment-stripped one. The citation IS a
      // comment — `stripped()` would blank exactly what is under test.
      const raw = readFileSync(step.rosterFile, "utf-8");
      expect(
        raw.includes(OWNER_ID),
        `${step.rosterName}'s docblock no longer cites ${OWNER_ID}. That roster ` +
          `is hand-typed and something has to own deriving it; without a live ` +
          `citation the class fix is nobody's, which is exactly how it sat ` +
          `pointed at a CLOSED requirement from 2026-08-06 to 2026-08-14.`,
      ).toBe(true);
    }
  });

  /**
   * ⭐ W-153.7-4 — THE FACT THE CORRECTED PROSE RESTS ON, ASSERTED SO IT STAYS
   * TRUE.
   *
   * `REQUIREMENTS.md`'s WIZFORM-02 rollup used to write the residue as *"six
   * analytics-service codes still render `UNKNOWN` … plus `KEY_UNDECRYPTABLE` on
   * `keys/[id]/permissions`"*. Measured, that route's terminal answers
   * `PROBE_FAILED` / `PROBE_BACKEND_UNAVAILABLE` / `PROBE_TIMEOUT` /
   * `PROBE_RATE_LIMITED` / `CIRCUIT_OPEN` and **`UNKNOWN` is not in its
   * vocabulary at all** — so the sentence overstated the residue by one code,
   * and the `TODOS.md` entry (which says the real defect is a wrong REMEDY
   * sentence) was the one telling the truth. The rollup is corrected.
   *
   * ⛔ WHAT THIS TEST IS AND IS NOT. It does NOT pin the prose — pinning a
   * sentence is the anti-pattern, and a documentation correction cannot have a
   * test that fails without it. It pins the MEASUREMENT the corrected sentence
   * and the TODOS item both rest on. The day this route starts minting `UNKNOWN`,
   * both records become wrong AND a wizard-adjacent surface starts rendering
   * `"UNKNOWN: …"` through `KeyPermissionBadge` — so CI should say so rather
   * than leaving two documents to rot quietly.
   *
   * ⚠️ THE COMMENT STRIP IS LOAD-BEARING, exactly as this file's header argues:
   * the route's own docblock QUOTES `{code:"UNKNOWN", status:500}` while
   * explaining why it does not use it. A raw grep reports the opposite of the
   * truth here.
   */
  it("[W-153.7-4] keys/[id]/permissions mints no UNKNOWN — the measurement the rollup was corrected to", () => {
    const source = stripped(
      join(REPO, "src/app/api/keys/[id]/permissions/route.ts"),
    );

    // POSITIVE CONTROL FIRST. A path typo or a moved route would make the
    // negative below pass over an empty string.
    for (const code of [
      "PROBE_FAILED",
      "PROBE_BACKEND_UNAVAILABLE",
      "PROBE_TIMEOUT",
      "PROBE_RATE_LIMITED",
      "CIRCUIT_OPEN",
    ]) {
      expect(
        source.includes(`"${code}"`),
        `keys/[id]/permissions no longer mints ${code}. Either its private ` +
          `PROBE_* cascade changed (see the TODOS.md item that owns giving it a ` +
          `coverage law) or this scan is reading the wrong file — and a scan ` +
          `reading nothing would pass the assertion below for the worst reason.`,
      ).toBe(true);
    }

    expect(
      source.includes('"UNKNOWN"'),
      `keys/[id]/permissions now mints UNKNOWN. TWO records go stale the moment ` +
        `it does — REQUIREMENTS.md's WIZFORM-02 residue sentence and the ` +
        `TODOS.md item, both of which say this route's defect is a wrong REMEDY ` +
        `sentence rather than an UNKNOWN card — and its wizard-adjacent ` +
        `consumer KeyPermissionBadge renders the route's own { code, error } as ` +
        `plain "CODE: message" text, so a user reads the literal word UNKNOWN.`,
    ).toBe(false);
  });

  it("SELF-TEST — a code the ALIAS TABLE answers needs no roster row", () => {
    // The admission rule has two limbs and only one of them is exercised by the
    // real data at HEAD in an obvious way. `SEAM_MISCONFIGURED` is the live
    // proof of the other: it IS a classifier verdict (three wire codes resolve
    // to it) and it is deliberately in NEITHER key roster, because both steps
    // translate through SEAM_CODE_TO_WIZARD_CODE first. If this stops holding,
    // the assertion above is silently running on one limb.
    expect(
      reachable,
      "SEAM_MISCONFIGURED left the classifier-reachable population, so the " +
        "alias limb of the admission rule is no longer exercised by real data.",
    ).toContain("SEAM_MISCONFIGURED");
    expect(
      alias.has("SEAM_MISCONFIGURED"),
      "SEAM_CODE_TO_WIZARD_CODE no longer carries SEAM_MISCONFIGURED, so the " +
        "translate-first hop the two key steps rely on has gone — and the code " +
        "now needs a row in BOTH rosters instead.",
    ).toBe(true);
    for (const step of CLASSIFIER_STEPS) {
      expect(
        deriveRoster(stripped(step.rosterFile), step.rosterName),
        `${step.rosterName} gained SEAM_MISCONFIGURED. That is a hand-typed ` +
          `allow-list edit for a code the ONE shared table already answers ` +
          `(coverage-law row 1), and it contradicts that step's own docblock.`,
      ).not.toContain("SEAM_MISCONFIGURED");
    }
  });
});
