import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 146.2 gap closure — THE ESCAPE LABEL IS A TWO-FILE CONTRACT.
 *
 * The csv-finalize route's 409 refusal sentences instruct the user, by name, to
 * use a control the WIZARD renders:
 *
 *   route.ts        -> `START_NEW_STRATEGY_LABEL` is embedded in the refusal copy
 *   CsvSubmitStep   -> `START_NEW_STRATEGY_LABEL` is the button's visible label
 *
 * Neither file can import the other (server route vs client component), so the
 * constant is duplicated. Duplication is fine; SILENT DIVERGENCE is not. Rename
 * or re-word ONE side and the server tells the user to press a control that does
 * not exist under that name — which is the exact defect this gap closure was
 * opened to fix (the shipped sentences told users to "start a new strategy and
 * upload this file", an instruction the wizard could not carry out).
 *
 * The two fixers that wrote these constants each said, correctly, that they
 * could not close this themselves: an invariant over both files has to live in
 * a file that neither of them owns. This is that file.
 *
 * ANTI-VACUITY: this reads the REAL sources off disk — never a fixture, never a
 * re-typed copy of the string. Delete either constant, rename either constant,
 * or change either value, and this reddens. The "both present" assertions exist
 * so that a rename cannot pass by making both sides equally absent (undefined
 * === undefined would otherwise be a green two-file contract over nothing).
 */

const ROOT = join(__dirname, "..", "..");

const SITES = [
  {
    label: "server refusal copy",
    path: join(ROOT, "src/app/api/strategies/csv-finalize/route.ts"),
  },
  {
    label: "wizard escape control",
    path: join(
      ROOT,
      "src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx",
    ),
  },
] as const;

/** Pull `const START_NEW_STRATEGY_LABEL = "…";` out of a source file. */
function readEscapeLabel(path: string): string | null {
  const src = readFileSync(path, "utf8");
  const m = src.match(
    /const\s+START_NEW_STRATEGY_LABEL\s*(?::\s*[^=]+)?=\s*"([^"]*)"/,
  );
  return m ? m[1] : null;
}

describe("146.2 — the escape-control label is one contract across two files", () => {
  it.each(SITES)(
    "declares START_NEW_STRATEGY_LABEL in the $label",
    ({ path, label }) => {
      expect(
        readEscapeLabel(path),
        `${label} (${path}) no longer declares START_NEW_STRATEGY_LABEL. If it was ` +
          `renamed, rename it on BOTH sides — the server sentence names this ` +
          `control verbatim, so a one-sided rename ships copy pointing at nothing.`,
      ).not.toBeNull();
    },
  );

  it("the server names the control the wizard actually renders", () => {
    const [server, client] = SITES.map((s) => readEscapeLabel(s.path));

    // Guard the comparison itself: two nulls must not read as agreement.
    expect(server, "server label missing — see the per-site assertion").not.toBeNull();
    expect(client, "wizard label missing — see the per-site assertion").not.toBeNull();

    expect(
      client,
      `The refusal copy in csv-finalize/route.ts tells the user to use ` +
        `"${server}", but the wizard renders a control labelled "${client}". ` +
        `A user reading the 409 would look for a button that is not on screen, ` +
        `and the refusal becomes the dead end 146.2's gap closure removed.`,
    ).toBe(server);
  });

  it("the refusal copy actually embeds the label (not just declares it)", () => {
    // A constant that exists but is never interpolated into a sentence is a
    // contract over nothing: the copy could still say "start a new strategy"
    // in prose while the constant drifts, and the equality test above would
    // stay green. Pin that the route's copy is BUILT from the constant.
    const src = readFileSync(SITES[0].path, "utf8");
    const uses = src.match(/START_NEW_STRATEGY_LABEL/g) ?? [];
    expect(
      uses.length,
      "route.ts declares START_NEW_STRATEGY_LABEL but never interpolates it " +
        "into the refusal copy — the two-file contract is decorative.",
    ).toBeGreaterThan(1);
  });
});
