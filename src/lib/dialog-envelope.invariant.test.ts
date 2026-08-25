// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";
// ⭐ THE LIVE ROSTER, imported rather than re-parsed. This is what makes a NEW
// roster row join this law's population with no test edit — the property the
// wizard-side laws had to bolt on after the fact. A regex over the source of
// `wizardErrors.ts` would agree with a row that type-checks but is unreachable.
import { DASHBOARD_DIALOG_ROUTE_CODES, WIZARD_ERROR_COPY } from "./wizardErrors";
import type { DashboardDialogRoute, WizardErrorCode } from "./wizardErrors";

/**
 * ⭐ 161-10 / WIZERR-07 — A DASHBOARD DIALOG RENDERS THE CODE ITS ROUTE SENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS LAW EXISTS — IT REACHES A POPULATION THE INCUMBENT LAWS DECLARE
 * THEMSELVES BLIND TO
 *
 * `wizardErrors.invariant.test.ts` derives its rosters from three files, all of
 * them inside `src/app/(dashboard)/strategies/new/wizard/steps`. Its own
 * docblock says so, and its `WIZARD_STEPS` constant is that directory. That is
 * a reasonable scope for a wizard law and a total blind spot for everything
 * else — and everything else is exactly where this class regrew after Phase
 * 153 declared it closed.
 *
 * Measured while writing this file: SIX wizard-step files call `buildEnvelope`
 * and are watched. THREE dashboard dialogs call it and were watched by nothing.
 * All three built `buildEnvelope("UNKNOWN", …)` — "we could not classify this
 * failure" — for failures their routes had classified precisely: a signed-out
 * session, a rate limit, nine distinct internal faults, six 404s. Between them
 * they recognised 3 of their routes' 46 error arms, and two of those three
 * recognitions worked by matching `body.error` PROSE.
 *
 * Fixing three components does not close that. A FOURTH dashboard dialog
 * copying the shape is how the class regrows, and the class HAS regrown before.
 * So the law derives its population from disk and fails BY NAME the day a new
 * dialog builds an envelope without joining a roster.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE POPULATION PREDICATE, IN FULL PROSE, so every count below is reproducible
 * without reading a single regex:
 *
 *   A file ending `.tsx`, not containing `.test.`, anywhere under
 *   `src/components` or `src/app/(dashboard)` — EXCLUDING any path containing
 *   `wizard/steps` — read from disk and COMMENT-STRIPPED with
 *   `stripCommentsPreserveLines(src, "ts")`, is a DASHBOARD ENVELOPE DIALOG iff
 *   BOTH hold:
 *
 *     1. it calls `buildEnvelope(` — it decides what a user is told when a
 *        write fails; AND
 *     2. it mounts `<Modal` — it is a DIALOG, not a page or a card. This is the
 *        clause that keeps `finalize-wizard/route.ts` and
 *        `venueOutageCopy.ts` out: both name `buildEnvelope`, neither is a
 *        dialog, and neither has a per-route code roster to be held to.
 *
 * ⚠️ COMMENT-STRIP BEFORE COUNTING, and this plan is its own receipt. A RAW
 * `grep -rl buildEnvelope src/` run at HEAD returns SEVEN paths outside the
 * wizard-steps directory; one of them is `strategies/[id]/ownership/route.ts`,
 * which mentions `buildEnvelope` only in a docblock this plan wrote. A law
 * built on the raw count would demand a roster for a route handler.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS LAW ASSERTS, in three parts:
 *
 *   A. ARRIVAL — every code a dialog's ROUTE emits, DERIVED FROM THE ROUTE
 *      SOURCE at HEAD, is either recognised by that dialog's roster, or is an
 *      EXPLICITLY LISTED disposition with a reason. An omission is
 *      indistinguishable from the defect, so omissions are not permitted: a
 *      code that is neither rostered nor dispositioned reds.
 *      ⭐ DERIVED SINCE 161-REVIEW / WR-02. Until then the codes were a
 *      hand-typed array here while only the FILES were derived, so the one
 *      regrowth vector this case exists to close — a new arm carrying a code
 *      nobody rosters — could not red it. See `ROUTE_PATHS` below.
 *   B. COPY — every code a roster claims to recognise has a real copy entry.
 *      A rostered code with no entry type-checks and renders nothing useful.
 *   C. NON-VACUITY — the population is non-empty and equals a HAND-TYPED count.
 *
 * ⛔ NEVER `derived.length` AS ITS OWN ORACLE. A size compared against its own
 * derivation cannot fail: delete every dialog and both sides go to zero
 * together. Every literal below was re-measured at HEAD by running the
 * predicate and counting the printed paths by hand.
 */

const REPO = process.cwd();

/** Roots the population is drawn from. */
const SCAN_ROOTS = [
  join(REPO, "src", "components"),
  join(REPO, "src", "app", "(dashboard)"),
] as const;

/**
 * The directory the INCUMBENT laws own, excluded here so the two populations
 * are disjoint and neither is measuring the other's work.
 */
const WIZARD_STEPS_FRAGMENT = join("wizard", "steps");

function walkTsx(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (p.includes(WIZARD_STEPS_FRAGMENT)) continue;
      walkTsx(p, out);
    } else if (p.endsWith(".tsx") && !p.includes(".test.")) {
      out.push(p);
    }
  }
  return out;
}

function stripped(path: string): string {
  return stripCommentsPreserveLines(readFileSync(path, "utf-8"), "ts");
}

/** The predicate above, as code. */
function isDashboardEnvelopeDialog(source: string): boolean {
  return /buildEnvelope\s*\(/.test(source) && /<Modal[\s>]/.test(source);
}

function derivePopulation(): string[] {
  const hits: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsx(root)) {
      if (isDashboardEnvelopeDialog(stripped(file))) hits.push(file);
    }
  }
  return hits.sort();
}

/**
 * HAND-TYPED. Re-measured at HEAD by running `derivePopulation()` and counting
 * the three paths it printed:
 *
 *   src/app/(dashboard)/allocations/components/AllocateDialog.tsx
 *   src/components/strategy/MarkOwnershipDialog.tsx
 *   src/components/strategy/RenameStrategyDialog.tsx
 *
 * ⛔ If a fourth dashboard dialog builds an envelope, this literal is the thing
 * that reds — and the correct response is to give it a roster row in
 * `DASHBOARD_DIALOG_ROUTE_CODES` and a row in `DIALOGS` below, in the SAME
 * commit, not to bump the number.
 */
const EXPECTED_DIALOG_COUNT = 3;

/**
 * ⭐ 161-REVIEW / WR-02 — THE ARRIVAL POPULATION IS READ FROM THE ROUTE.
 *
 * ── WHAT WAS WRONG UNTIL THIS COMMIT ────────────────────────────────────────
 *
 * The ARRIVAL case below is named "every code a route emits is rostered OR an
 * explicit disposition", and its population of FILES was derived from disk —
 * but its population of CODES was a hand-typed array in this file, read from
 * the route once by a human and never again. So the exact regrowth vector the
 * law exists to close — a FOURTH arm added to one of these routes carrying a
 * code nobody rosters — produced no RED. The law could not fail for the thing
 * it was written to catch.
 *
 * It was also already WRONG at HEAD, which is the receipt: the rename
 * dialog's hand-typed list carried `DASHBOARD_WRITE_FAILED`, and the name
 * route stopped emitting it when 161-REVIEW / CR-01 split the 500 population.
 * A hand-typed population drifts silently; a derived one reds.
 *
 * ── THE EMITTER PREDICATE, IN FULL PROSE, so every count below is
 * reproducible without reading the regex ────────────────────────────────────
 *
 *   Take the route's source and strip comments with
 *   `stripCommentsPreserveLines(src, "ts")`. A CODED REJECTION SITE is a call
 *   to `NextResponse.json(` — or to a route-local `json(` wrapper around it —
 *   whose FIRST argument is an object literal opening with
 *   `code: "<UPPER_SNAKE_LITERAL>"` immediately followed by an `error:` key,
 *   and which passes a SECOND argument (the status / options). The emitted
 *   code is that string literal.
 *
 * ⚠️ THE STATUS IS NOT PART OF THE PREDICATE HERE, and that is a measured
 * departure from the sibling law in `wizardErrors.invariant.test.ts`, not an
 * oversight. Two of these three routes answer through `NextResponse.json(body,
 * { status })`; `portfolio-strategies/allocation` answers through its own
 * `json(body, status)` helper, which passes the status POSITIONALLY. A
 * `status:`-bearing predicate derives ZERO emitters on that route — the empty
 * population this file's own header forbids. The `error:` key does the work
 * the status did: every success body on these three routes is `{ ok: true, … }`
 * and carries no `error:`, so the rejection/success split is exact. Verified by
 * the SELF-TESTs below, which exercise both call shapes and a success body.
 *
 * ⛔ TWO THINGS THAT MUST NOT BE RELAXED TO MAKE A COUNT COME OUT RIGHT: the
 * `code:`-FIRST key order and the `[A-Z][A-Z0-9_]*` literal class. Those are
 * the levers that keep a `{ error, code }` arm (161-09's central finding — a
 * shape invisible to every coverage law in this repo) and a lowercase or
 * interpolated code VISIBLE as defects rather than legalised.
 */
const ROUTE_PATHS: Readonly<Record<DashboardDialogRoute, string>> = {
  "strategies/[id]/name": join(
    REPO,
    "src/app/api/strategies/[id]/name/route.ts",
  ),
  "strategies/[id]/ownership": join(
    REPO,
    "src/app/api/strategies/[id]/ownership/route.ts",
  ),
  "portfolio-strategies/allocation": join(
    REPO,
    "src/app/api/portfolio-strategies/allocation/route.ts",
  ),
};

/**
 * The lazy run's character cap, and an HONEST statement of what it does and
 * does not buy — measured 2026-08-25 on the comment-stripped sources of all
 * three routes.
 *
 *   · longest real `error:` … `}` body: **107** characters
 *     (`DASHBOARD_REQUEST_INVALID`'s interpolated amount cap on
 *     `portfolio-strategies/allocation`). name = 22, ownership = 81.
 *   · shortest distance from ONE emitter's `error:` to the NEXT emitter's
 *     `code:`: **77** characters (allocation; 150 on the other two).
 *
 * ⚠️ 77 < 107, so — UNLIKE the sibling law in
 * `wizardErrors.invariant.test.ts`, whose 160 sits between a 90-char longest
 * body and a 202-char nearest neighbour — NO cap on these routes can both
 * clear every real body and make a cross-emitter reach arithmetically
 * impossible. Writing 160 here and repeating the sibling's argument would be a
 * false claim in a comment, which is the defect class this phase exists to
 * close. So the cap is stated for what it is: a BOUND ON BACKTRACKING at
 * ~1.7× the longest real body, not an impossibility proof.
 *
 * What actually keeps the scan on the right emitter is the LAZY quantifier:
 * it stops at the FIRST `}` followed by `,`, and on all three routes that is
 * the emitter's own object close. The one shape that defeats it is an emitter
 * with no SECOND argument (`json({ code, error })`), whose close is followed by
 * `)` rather than `,` — the run then reaches the NEXT emitter's close and
 * SWALLOWS it. That failure is LOUD, not silent: it drops the derived site
 * count and `expectedEmitterSites` reds. Pinned by a SELF-TEST below.
 */
const EMITTER_BODY_MAX_CHARS = 180;

/**
 * Every coded-rejection code literal a route emits, in source order, WITH
 * repeats. `(?:NextResponse\.)?json\(` admits both call shapes above.
 */
function deriveEmittedCodes(source: string): string[] {
  const re = new RegExp(
    `(?:NextResponse\\.)?json\\(\\s*\\{\\s*code:\\s*"([A-Z][A-Z0-9_]*)"\\s*,\\s*` +
      `error:[\\s\\S]{0,${EMITTER_BODY_MAX_CHARS}}?\\}\\s*,`,
    "g",
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

/**
 * One row per dialog: where it lives, which route it writes through, and the
 * codes that route emits.
 *
 * ⛔ `emittedCodes` IS HAND-TYPED FROM THE ROUTE, read at HEAD — never derived
 * from the roster it is checked against, and (since 161-REVIEW / WR-02) never
 * the thing the ARRIVAL loop actually iterates either. It is now the
 * INDEPENDENT DRIFT ORACLE the derived set is compared against: two artefacts,
 * neither derived from the other, so a route arm that changes reds against the
 * list and a list edit that has no arm behind it reds against the route.
 */
interface DialogUnderTest {
  /** Human name used in failure messages. */
  readonly label: string;
  /** Path relative to the repo root. */
  readonly file: string;
  /** The roster key in `DASHBOARD_DIALOG_ROUTE_CODES`. */
  readonly route: DashboardDialogRoute;
  /** Every DISTINCT code the route puts on the wire, hand-typed from its arms. */
  readonly emittedCodes: readonly string[];
  /**
   * HAND-TYPED count of coded-rejection SITES on this route, WITH repeats,
   * measured under the predicate above.
   *
   * ⛔ NEVER `derived.length`. A size compared against its own derivation
   * cannot fail: delete every guard in the route and both sides go to zero
   * together. This is the second oracle — `emittedCodes` pins WHICH codes, this
   * pins HOW MANY ARMS, and an arm deleted without its code disappearing (the
   * common case on these routes, where several arms share a code) reds here and
   * nowhere else.
   */
  readonly expectedEmitterSites: number;
  /**
   * Codes this dialog deliberately does NOT route to an envelope, each with the
   * reason. ⛔ A code that is neither rostered nor listed here REDS — that is
   * the whole point: an omission is indistinguishable from the defect.
   */
  readonly deliberatelyNotEnvelope: Readonly<Record<string, string>>;
}

const DIALOGS: readonly DialogUnderTest[] = [
  {
    label: "RenameStrategyDialog",
    file: "src/components/strategy/RenameStrategyDialog.tsx",
    route: "strategies/[id]/name",
    // ⛔ `DASHBOARD_WRITE_FAILED` WAS HERE AND IS GONE, and its removal is the
    // receipt for WR-02. This route has exactly one 500 arm — the UPDATE
    // failure — and 161-REVIEW / CR-01 moved it to
    // `DASHBOARD_WRITE_INDETERMINATE`. The hand-typed list kept the old code
    // for a write the route can no longer report, and nothing reddened,
    // because nothing read the route. The derivation reds.
    //
    // It stays a ROSTER member in `DASHBOARD_DIALOG_ROUTE_CODES` on purpose:
    // ARRIVAL is one-directional (route → roster). A roster admitting a code
    // its route does not currently emit costs nothing; a route emitting a code
    // its roster does not admit renders UNKNOWN.
    emittedCodes: [
      "DASHBOARD_SIGNED_OUT",
      "DASHBOARD_REQUEST_INVALID",
      "NAME_REQUIRED",
      "NAME_TOO_LONG",
      "RATE_LIMITED",
      "DASHBOARD_WRITE_INDETERMINATE",
      "DASHBOARD_ROW_STALE",
    ],
    // 9 sites, counted by hand off the route at HEAD: signed-out ×1,
    // request-invalid ×2 (bad uuid, unparseable json), NAME_REQUIRED ×2
    // (non-string, empty-after-trim), NAME_TOO_LONG ×1, rate-limited ×1,
    // indeterminate ×1, row-stale ×1.
    expectedEmitterSites: 9,
    deliberatelyNotEnvelope: {
      NAME_REQUIRED:
        "FIELD-LEVEL. Lands inline at the Name input, where the user is " +
        "looking and where the remedy is. An envelope here would re-introduce " +
        "the terminal-envelope class for a field problem AND would show a " +
        "correlation id on an actionable arm (Copy Principle 4).",
      NAME_TOO_LONG:
        "FIELD-LEVEL, for the reason above. The route REJECTS rather than " +
        "truncating, so the cap has to surface at the field the user can edit.",
    },
  },
  {
    label: "MarkOwnershipDialog",
    file: "src/components/strategy/MarkOwnershipDialog.tsx",
    route: "strategies/[id]/ownership",
    emittedCodes: [
      "DASHBOARD_SIGNED_OUT",
      "DASHBOARD_REQUEST_INVALID",
      "RATE_LIMITED",
      "DASHBOARD_WRITE_FAILED",
      "DASHBOARD_WRITE_INDETERMINATE",
      "LIVE_ALLOCATION",
      "DASHBOARD_ROW_STALE",
    ],
    // 14 sites, counted by hand off the route at HEAD: signed-out ×1,
    // request-invalid ×4 (bad uuid, unparseable json, unknown mark,
    // non-boolean confirm flag), rate-limited ×1, write-failed ×2 (both READ
    // failures — the portfolio lookup and the position lookup), LIVE_ALLOCATION
    // ×1, indeterminate ×3 (the flip RPC error, the flip RPC's no-row answer,
    // the plain UPDATE error), row-stale ×2.
    expectedEmitterSites: 14,
    deliberatelyNotEnvelope: {
      LIVE_ALLOCATION:
        "A QUESTION, not a refusal to read and leave. The dialog answers it " +
        "by swapping in its confirmation body naming the amount at risk, so " +
        "it never reaches buildEnvelope. It is also the ONLY client path to " +
        "confirm_remove_allocation: true, which is why the dialog suite pins " +
        "that prose alone can no longer open it.",
    },
  },
  {
    label: "AllocateDialog",
    file: "src/app/(dashboard)/allocations/components/AllocateDialog.tsx",
    route: "portfolio-strategies/allocation",
    emittedCodes: [
      "DASHBOARD_SIGNED_OUT",
      "DASHBOARD_REQUEST_INVALID",
      "RATE_LIMITED",
      "DASHBOARD_WRITE_FAILED",
      "DASHBOARD_WRITE_INDETERMINATE",
      "DASHBOARD_ROW_STALE",
      "ALLOCATION_NOT_ALLOCATABLE",
    ],
    // 23 sites across BOTH verbs — this is the only one of the three routes
    // with two of them, and the dialog reaches both (POST allocates, DELETE
    // removes). Counted by hand off the route at HEAD: signed-out ×2,
    // request-invalid ×5, rate-limited ×2, write-failed ×3 (all READ failures),
    // row-stale ×3, ALLOCATION_NOT_ALLOCATABLE ×2 (the pre-check and the
    // D-03-A trigger arm), indeterminate ×6. 2+5+2+3+3+2+6 = 23.
    expectedEmitterSites: 23,
    deliberatelyNotEnvelope: {},
  },
];

/**
 * Arms that reach one of these dialogs and CORRECTLY stay on `UNKNOWN`.
 *
 * ⛔ EACH IS A LISTED DISPOSITION WITH A REASON, not an omission. `UNKNOWN`'s
 * copy says "we could not classify this failure", and that sentence is TRUE of
 * every entry below — which is the only test a disposition has to pass.
 */
const TERMINAL_UNKNOWN_DISPOSITIONS: Readonly<Record<string, string>> = {
  "transport failure (offline / aborted / DNS)":
    "The request never reached a status, so nothing classified anything. " +
    "There is no code to read and no verdict to report.",
  "an unreadable response body":
    "`res.json()` threw. A response we could not parse supports no verdict, " +
    "so naming a specific failure would be an invented claim.",
  "an unrostered code":
    "A code this route is not known to emit. Admitting it would mean casting " +
    "an arbitrary wire string into the copy union (Pitfall 4); the honest " +
    "answer is that we do not recognise it.",
  "the shared CSRF refusal (assertSameOrigin, 403)":
    "Emitted by `src/lib/csrf.ts`, a helper serving many routes — coding it " +
    "is a cross-cutting change 161-10 did not scope. A browser-originated " +
    "dialog request always carries an Origin, so the arm is unreachable from " +
    "these three surfaces in practice.",
};

describe("[161-10 / WIZERR-07] the dashboard-dialog envelope population", () => {
  it("C. NON-VACUITY: the population is NON-EMPTY and matches the hand-typed count", () => {
    const population = derivePopulation();

    // An empty-set law passes trivially and is indistinguishable from a repo
    // with no dialogs at all. This is the floor everything below stands on.
    expect(
      population.length,
      "the scanner found NO dashboard envelope dialogs — every assertion " +
        "below is vacuous until this is non-zero",
    ).toBeGreaterThan(0);

    expect(
      population.length,
      "The dashboard envelope-dialog population changed:\n" +
        population.map((p) => "  " + p.replace(REPO + "/", "")).join("\n") +
        "\nIf a dialog was ADDED, give it a roster row in " +
        "DASHBOARD_DIALOG_ROUTE_CODES and a DIALOGS row here, in the SAME " +
        "commit. Do not bump this literal to make the assertion pass.",
    ).toBe(EXPECTED_DIALOG_COUNT);
  });

  it("C. every hand-typed DIALOGS row is really in the derived population", () => {
    // The other direction: the roster cannot name a file the scanner does not
    // find, which is how a row survives a rename or a deletion.
    const population = derivePopulation().map((p) => p.replace(REPO + "/", ""));
    expect(DIALOGS.length).toBe(EXPECTED_DIALOG_COUNT);
    for (const dialog of DIALOGS) {
      expect(
        population,
        `${dialog.label} is listed here but the scanner does not see it at ` +
          `${dialog.file} — it was moved, renamed, or stopped building an ` +
          "envelope",
      ).toContain(dialog.file);
    }
  });

  it("SELF-TEST (positive): the scanner finds buildEnvelope in at least two dialogs", () => {
    // A scanner that matched nothing would make every membership assertion
    // above pass by accident on an empty set.
    const found = DIALOGS.filter((d) =>
      /buildEnvelope\s*\(/.test(stripped(join(REPO, d.file))),
    );
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it("SELF-TEST (negative): a buildEnvelope mention inside a COMMENT is not counted", () => {
    // The receipt for the comment-strip. Two synthetic sources, identical but
    // for whether the call is commented out.
    const commented = [
      "// buildEnvelope( is mentioned here in a line comment",
      "/** and here: buildEnvelope( inside a docblock, beside <Modal> */",
      "export const x = 1;",
    ].join("\n");
    expect(
      isDashboardEnvelopeDialog(stripCommentsPreserveLines(commented, "ts")),
    ).toBe(false);

    const real = [
      "export function D() {",
      "  const e = buildEnvelope('UNKNOWN', 'c');",
      "  return <Modal open>{e.code}</Modal>;",
      "}",
    ].join("\n");
    expect(
      isDashboardEnvelopeDialog(stripCommentsPreserveLines(real, "ts")),
    ).toBe(true);
  });

  it("SELF-TEST (negative): a non-dialog that builds envelopes is NOT in the population", () => {
    // The `<Modal` clause, exercised. Without it `venueOutageCopy.ts` and
    // `finalize-wizard/route.ts` would join a population they have no roster
    // for, and the law would demand a change with no defect behind it.
    const notADialog = [
      "export function helper() {",
      "  return buildEnvelope('UNKNOWN', 'c');",
      "}",
    ].join("\n");
    expect(isDashboardEnvelopeDialog(notADialog)).toBe(false);
  });

  it("A. ARRIVAL: every code the ROUTE emits is rostered OR an explicit disposition", () => {
    const offenders: string[] = [];

    for (const dialog of DIALOGS) {
      const roster = DASHBOARD_DIALOG_ROUTE_CODES.get(dialog.route);
      expect(
        roster,
        `no roster row exists for ${dialog.route} — the recogniser will ` +
          "answer UNKNOWN for every code this route sends",
      ).toBeDefined();

      // ⭐ 161-REVIEW / WR-02 — READ FROM THE ROUTE, not from the array in this
      // file. This is the line that makes a NEW arm on any of these three
      // routes red here without a test edit. Iterating `dialog.emittedCodes`
      // (as this loop did until now) could only ever check codes a human had
      // already noticed, which is the one population that needs no checking.
      const derived = deriveEmittedCodes(stripped(ROUTE_PATHS[dialog.route]));

      // NON-VACUITY: a derivation that parsed to `[]` — a renamed route file, a
      // reordered `{ error, code }` literal, a scanner blinded by a reformat —
      // satisfies the loop below without asserting anything at all. This floor
      // is what stands between this law and the 153.1-01 born-blind defect.
      expect(
        derived.length,
        `the scanner found NO coded rejections in ${dialog.route} — every ` +
          `ARRIVAL assertion for ${dialog.label} is vacuous until this is ` +
          "non-zero. Check the route still answers `code:`-FIRST; a " +
          "`{ error, code }` literal is invisible to this predicate by design.",
      ).toBeGreaterThan(0);

      for (const code of new Set(derived)) {
        const rostered = roster?.has(code as WizardErrorCode) ?? false;
        const dispositioned = Object.prototype.hasOwnProperty.call(
          dialog.deliberatelyNotEnvelope,
          code,
        );
        if (rostered && dispositioned) {
          offenders.push(
            `${dialog.label}: ${code} is BOTH rostered and listed as ` +
              "deliberately-not-an-envelope. It cannot be both.",
          );
        }
        if (!rostered && !dispositioned) {
          offenders.push(
            `${dialog.label}: ${code} is emitted by ${dialog.route} but is ` +
              "neither in its roster nor listed as a deliberate " +
              "non-envelope. It will render UNKNOWN — 'we could not classify " +
              "this failure' — for a failure the route classified.",
          );
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("A. DRIFT: the derived emitter set matches BOTH hand-typed oracles", () => {
    // Two independent oracles against one derivation, neither taken from the
    // other. `emittedCodes` pins WHICH codes; `expectedEmitterSites` pins HOW
    // MANY ARMS — and on these routes several arms share a code, so an arm
    // deleted or added without changing the vocabulary reds ONLY on the count.
    //
    // ⛔ NEITHER SIDE MAY BECOME `derived.length` OR `[...new Set(derived)]`.
    // A size compared against its own derivation cannot fail: delete every
    // guard in the route and both sides go to zero together.
    for (const dialog of DIALOGS) {
      const derived = deriveEmittedCodes(stripped(ROUTE_PATHS[dialog.route]));

      expect(
        derived.length,
        `${dialog.label}: ${dialog.route} now has ${derived.length} coded ` +
          `rejection sites, not ${dialog.expectedEmitterSites}. If an arm was ` +
          "ADDED, roster its code (or disposition it) and bump this literal in " +
          "the SAME commit. If the count DROPPED unexpectedly, check for an " +
          "emitter with no second argument — its lazy run swallows the next " +
          "one (see EMITTER_BODY_MAX_CHARS).",
      ).toBe(dialog.expectedEmitterSites);

      expect(
        [...new Set(derived)].sort(),
        `${dialog.label}: the codes ${dialog.route} actually emits no longer ` +
          "match the hand-typed list on its DIALOGS row. Correct the LIST " +
          "from the route — never the route to suit the list.",
      ).toEqual([...dialog.emittedCodes].sort());
    }
  });

  it("SELF-TEST (positive): the emitter scanner sees BOTH call shapes", () => {
    // `NextResponse.json(body, { status })` — name and ownership — and the
    // route-local `json(body, status)` wrapper that `allocation` answers
    // through. A scanner that saw only the first would derive ZERO on
    // allocation and take a third of this law dark.
    const src = [
      "return NextResponse.json(",
      '  { code: "ALPHA_ONE", error: "a" },',
      "  { status: 500, headers: NO_STORE_HEADERS },",
      ");",
      'return json({ code: "BETA_TWO", error: "b" }, 409);',
    ].join("\n");
    expect(deriveEmittedCodes(src)).toEqual(["ALPHA_ONE", "BETA_TWO"]);
  });

  it("SELF-TEST (negative): `{ error, code }`, a success body and a computed code are NOT counted", () => {
    // ⚠️ THE FIRST ONE IS A KNOWN, DELIBERATE BLINDNESS, recorded rather than
    // papered over: 161-09's central finding is that EVERY coverage law in this
    // repo derives with a `code:`-first predicate, so an `{ error, code }` arm
    // is invisible to all of them. Relaxing the key order here to "cover more"
    // would legalise the defect instead of finding it — it is why 161-REVIEW /
    // WR-03 reordered the `keys/[id]/permissions` literal rather than widening
    // a scanner.
    expect(
      deriveEmittedCodes(
        'return NextResponse.json({ error: "e", code: "GAMMA" }, { status: 500 });',
      ),
    ).toEqual([]);
    // A success body carries no `error:` — this is the clause doing the work
    // the sibling law's `status:` fragment does.
    expect(
      deriveEmittedCodes(
        "return NextResponse.json({ ok: true, mark }, { headers: NO_STORE_HEADERS });",
      ),
    ).toEqual([]);
    // A lowercase code and an interpolated one stay VISIBLE as defects by
    // being EXCLUDED — the literal class is not negotiable for a count.
    expect(
      deriveEmittedCodes('return json({ code: "lower_case", error: "e" }, 400);'),
    ).toEqual([]);
    expect(
      deriveEmittedCodes(
        'return json({ code: seamCode ?? "UNKNOWN", error: "e" }, 500);',
      ),
    ).toEqual([]);
  });

  it("SELF-TEST (negative): a COMMENTED-OUT emitter is not counted", () => {
    const commented = [
      '// return json({ code: "ALPHA_ONE", error: "a" }, 400);',
      '/** and in a docblock: json({ code: "BETA_TWO", error: "b" }, 400); */',
      'return json({ code: "GAMMA_THREE", error: "c" }, 400);',
    ].join("\n");
    expect(
      deriveEmittedCodes(stripCommentsPreserveLines(commented, "ts")),
    ).toEqual(["GAMMA_THREE"]);
  });

  it("SELF-TEST: an emitter with NO second argument swallows the next one — and the site count is what catches it", () => {
    // The one shape the lazy quantifier cannot terminate on, pinned so the
    // claim in EMITTER_BODY_MAX_CHARS' docblock is a measured fact rather than
    // an argument. ALPHA's close is followed by `)`, not `,`, so its run
    // reaches BETA's close and consumes it.
    const swallowing = [
      'json({ code: "ALPHA_ONE", error: "a" });',
      'json({ code: "BETA_TWO", error: "b" }, 400);',
    ].join("\n");
    expect(deriveEmittedCodes(swallowing)).toEqual(["ALPHA_ONE"]);
    // The SAME pair with ALPHA's second argument restored derives both — so
    // the difference really is the missing argument and not the fixture.
    const healthy = [
      'json({ code: "ALPHA_ONE", error: "a" }, 400);',
      'json({ code: "BETA_TWO", error: "b" }, 400);',
    ].join("\n");
    expect(deriveEmittedCodes(healthy)).toEqual(["ALPHA_ONE", "BETA_TWO"]);
  });

  it("A. every deliberate non-envelope disposition carries a REASON, not a blank", () => {
    // An empty string would satisfy "is listed" while recording nothing, and
    // `"anything".includes("")` is true — so the floor is a length, not truthiness.
    let checked = 0;
    for (const dialog of DIALOGS) {
      for (const [code, reason] of Object.entries(
        dialog.deliberatelyNotEnvelope,
      )) {
        expect(
          reason.length,
          `${dialog.label}: ${code} is dispositioned with no real reason`,
        ).toBeGreaterThan(40);
        checked += 1;
      }
    }
    // Hand-typed: NAME_REQUIRED + NAME_TOO_LONG + LIVE_ALLOCATION.
    expect(checked).toBe(3);
  });

  it("A. every TERMINAL-UNKNOWN arm is a listed disposition with a reason", () => {
    const entries = Object.entries(TERMINAL_UNKNOWN_DISPOSITIONS);
    // Hand-typed: transport, unreadable body, unrostered code, CSRF.
    expect(entries.length).toBe(4);
    for (const [arm, reason] of entries) {
      expect(arm.length).toBeGreaterThan(5);
      expect(
        reason.length,
        `the ${arm} disposition records no reason`,
      ).toBeGreaterThan(40);
    }
  });

  it("B. COPY: every rostered code has a real copy entry", () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const [route, roster] of DASHBOARD_DIALOG_ROUTE_CODES) {
      expect(
        roster.size,
        `the roster for ${route} is empty — it recognises nothing`,
      ).toBeGreaterThan(0);

      for (const code of roster) {
        checked += 1;
        const copy = WIZARD_ERROR_COPY[code];
        if (!copy) {
          offenders.push(`${route}: ${code} has no WIZARD_ERROR_COPY entry`);
          continue;
        }
        // Not merely present — usable. A rostered code whose entry is a stub
        // renders a heading and nothing a user can act on.
        if (copy.title.length < 5) {
          offenders.push(`${route}: ${code} has an empty or stub title`);
        }
        if (!copy.fix || copy.fix.length === 0) {
          offenders.push(`${route}: ${code} offers no remedy at all`);
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
    // NON-VACUITY: 6 + 6 + 7 across the three rosters, hand-counted at HEAD.
    // 16 -> 19 at 161-REVIEW / CR-01: `DASHBOARD_WRITE_INDETERMINATE` joined
    // all three rosters, because all three routes have at least one arm that
    // fails AFTER a data-modifying statement was sent.
    expect(checked).toBe(19);
  });

  it("B. no rostered code is the generic terminal — that would defeat the roster", () => {
    for (const [route, roster] of DASHBOARD_DIALOG_ROUTE_CODES) {
      expect(
        [...roster],
        `${route} rosters UNKNOWN, which makes recognising it indistinguishable ` +
          "from failing to recognise anything",
      ).not.toContain("UNKNOWN");
    }
  });

  it("the dialogs read the SHARED recogniser — no local wire-code table survives", () => {
    // The prohibition, asserted over the population rather than per file, so a
    // FOURTH dialog inherits it automatically.
    for (const dialog of DIALOGS) {
      const src = stripped(join(REPO, dialog.file));
      expect(
        src,
        `${dialog.label} does not call the shared recogniser — it is either ` +
          "matching prose or casting a wire string",
      ).toContain("recogniseDashboardDialogCode");
      expect(
        src,
        `${dialog.label} carries a keyed lookup table; translation belongs in ` +
          "the ONE shared roster",
      ).not.toMatch(/Record<\s*string\s*,/);
    }
  });

  it("the Modal shell still has NO fixed height — the E5 premise stays corrected", () => {
    // 161-UI-SPEC's one ⚠ unresolved row originally claimed these dialogs mount
    // the envelope in a FIXED-HEIGHT body. Measured at plan time and RE-MEASURED
    // here at HEAD: `Modal.tsx` has no `max-h`, no `overflow` and no height —
    // the only `height` token in the file is an SVG icon attribute.
    //
    // ⚠️ THIS PIN DOES NOT SETTLE E5, and must not be read as doing so. What is
    // open is VIEWPORT CONTAINMENT of an UNBOUNDED body — whether an overflowing
    // native <dialog> scrolls or clips is a UA-resolved rendered property that
    // jsdom does not compute. That half is verified BY HAND and recorded as
    // MANUAL in the plan's summary. What this pin buys is narrower and real: if
    // someone later adds a `max-h` here, the ORIGINAL premise becomes true again
    // and the manual finding recorded against the corrected premise stops
    // applying — so the finding's own precondition reds instead of rotting.
    const raw = readFileSync(
      join(REPO, "src", "components", "ui", "Modal.tsx"),
      "utf-8",
    );
    expect(raw.length).toBeGreaterThan(400); // the file really loaded
    expect(raw).toContain("<dialog");
    expect(raw).not.toMatch(/max-h-/);
    expect(raw).not.toMatch(/overflow-/);
    // `height=` survives on the close icon's <svg>; a CSS height class does not.
    expect(raw).not.toMatch(/\bh-\[/);
  });
});
