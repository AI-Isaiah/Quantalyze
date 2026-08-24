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
 *   A. ARRIVAL — every code a dialog's ROUTE emits is either recognised by that
 *      dialog's roster, or is an EXPLICITLY LISTED disposition with a reason.
 *      An omission is indistinguishable from the defect, so omissions are not
 *      permitted: a code that is neither rostered nor dispositioned reds.
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
 * One row per dialog: where it lives, which route it writes through, and the
 * codes that route emits.
 *
 * ⛔ `emittedCodes` IS HAND-TYPED FROM THE ROUTE, read at HEAD — never derived
 * from the roster it is checked against. Deriving it would compare the roster
 * with itself and could not fail.
 */
interface DialogUnderTest {
  /** Human name used in failure messages. */
  readonly label: string;
  /** Path relative to the repo root. */
  readonly file: string;
  /** The roster key in `DASHBOARD_DIALOG_ROUTE_CODES`. */
  readonly route: DashboardDialogRoute;
  /** Every code the route puts on the wire, hand-typed from its arms. */
  readonly emittedCodes: readonly string[];
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
    emittedCodes: [
      "DASHBOARD_SIGNED_OUT",
      "DASHBOARD_REQUEST_INVALID",
      "NAME_REQUIRED",
      "NAME_TOO_LONG",
      "RATE_LIMITED",
      "DASHBOARD_WRITE_FAILED",
      "DASHBOARD_ROW_STALE",
    ],
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
      "LIVE_ALLOCATION",
      "DASHBOARD_ROW_STALE",
    ],
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
      "DASHBOARD_ROW_STALE",
      "ALLOCATION_NOT_ALLOCATABLE",
    ],
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

  it("A. ARRIVAL: every code a route emits is rostered OR an explicit disposition", () => {
    const offenders: string[] = [];

    for (const dialog of DIALOGS) {
      const roster = DASHBOARD_DIALOG_ROUTE_CODES.get(dialog.route);
      expect(
        roster,
        `no roster row exists for ${dialog.route} — the recogniser will ` +
          "answer UNKNOWN for every code this route sends",
      ).toBeDefined();

      // NON-VACUITY: a dialog whose route emits nothing would pass the loop
      // below without asserting anything at all.
      expect(
        dialog.emittedCodes.length,
        `${dialog.label}'s route emits no codes — nothing is being checked`,
      ).toBeGreaterThan(0);

      for (const code of dialog.emittedCodes) {
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
    // NON-VACUITY: 5 + 5 + 6 across the three rosters, hand-counted at HEAD.
    expect(checked).toBe(16);
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
