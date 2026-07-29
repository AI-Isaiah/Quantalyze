/** @vitest-environment jsdom */
/**
 * 140.4-16 / CR-02 (second half) — the CSV error panel must not print one
 * sentence twice, and must say something when there is no per-row breakdown.
 *
 * ⚠️ FOUND IN A REAL BROWSER, NOT BY READING THE CODE. A QA pass on localhost
 * drove a well-formed 5-row CSV into an upstream failure and read back
 * (qa-report-localhost-2026-07-29, ISSUE-003):
 *
 *     Validation failed. See per-row breakdown below.
 *     Validation failed. See per-row breakdown below.
 *     correlation_id: —
 *
 * …with no breakdown beneath it. The duplication is structural, not incidental:
 * the heading falls back to `human_message` when `errors.length === 0`, and
 * `causeText`'s final `else` branch is ALSO `envelope.human_message`. Every
 * non-per-row failure that reaches this panel — every upstream fault, every
 * transport failure, every 401 — renders the same sentence in both slots.
 *
 * The panel's second line exists to say something the first does not. When we
 * have authored copy for the code, that is what belongs there; when we do not,
 * nothing belongs there. Repeating the headline is the one option that costs a
 * line of screen and carries no information.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { CsvValidationEnvelope } from "./CsvValidationEnvelope";
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";

afterEach(() => cleanup());

function renderEnvelope(
  code: string,
  human_message: string,
  pandera_errors?: { rule: string; row: number; message: string }[],
) {
  render(
    <CsvValidationEnvelope
      envelope={{
        code,
        human_message,
        debug_context: pandera_errors ? { pandera_errors } : {},
        correlation_id: null,
      }}
    />,
  );
}

describe("[140.4-16 / CR-02] CsvValidationEnvelope — no duplicated sentence", () => {
  it("🔴 does NOT print human_message twice when there is no per-row breakdown", () => {
    // The exact shape the csv-validate 502 arm produces: a code, a sentence,
    // and `debug_context: {}`.
    const SENTENCE =
      "Validation service returned an unexpected response. Retry shortly.";
    renderEnvelope("CSV_UPSTREAM_FAIL", SENTENCE);

    expect(
      screen.queryAllByText(SENTENCE),
      "the panel printed the same sentence as both its heading and its body. " +
        "The second line is meant to add something; repeating the first costs " +
        "a line of screen and carries no information.",
    ).toHaveLength(1);
  });

  it("uses the code's OWN authored cause as the second line when we have one", () => {
    // Hand-typed expectation of the RELATIONSHIP, read from the table for the
    // value: the point is that the panel consults the one copy table, and the
    // table is where a founder edits the sentence.
    renderEnvelope(
      "CSV_UPSTREAM_FAIL",
      "Validation service returned an unexpected response. Retry shortly.",
    );
    expect(
      screen.getByText(WIZARD_ERROR_COPY.CSV_UPSTREAM_FAIL.cause),
    ).toBeInTheDocument();
  });

  it("renders NO second line at all for a code we have no copy for", () => {
    // The honest alternative to inventing one. A drifted or unknown code must
    // not borrow UNKNOWN's cause — that would state a reason we did not
    // establish, which is the class this milestone exists to close.
    const SENTENCE = "Something we have no entry for happened.";
    renderEnvelope("ZZ_NOT_A_WIZARD_CODE", SENTENCE);

    expect(screen.queryAllByText(SENTENCE)).toHaveLength(1);
    const panel = screen.getByTestId("wizard-csv-error");
    // The `correlation_id: —` carrier line is a stable part of the panel's DOM
    // shape (Phase 16 / OBSERV-06) and is excluded deliberately — it is not a
    // copy slot.
    const copyParagraphs = [...panel.querySelectorAll("p")].filter(
      (p) => !p.textContent?.startsWith("correlation_id:"),
    );
    expect(
      copyParagraphs,
      "a second copy paragraph was rendered for a code with no authored copy — " +
        "it can only be a repeat of the heading or an invented sentence",
    ).toHaveLength(1);
  });

  // ── 140.5-05 / D-§4a bullet 3 — THE DOUBLE-RENDER PIN, BOTH POLARITIES ─────
  //
  // CR-02 fixed the INSTANCE. This pins the PROPERTY, in the shape
  // `LiveRegion.test.tsx` uses for the same class of defect: count the
  // occurrences, and pair the count with a positive counterpart so "renders
  // once" cannot be satisfied by rendering zero times.

  it("🔴 PIN: with no per-row errors and a code we have no copy for, the heading renders EXACTLY once", () => {
    // The precise configuration that produced the browser screenshot: no
    // breakdown to show, and a code the copy table does not carry, so both the
    // heading slot and the cause slot fall back to the same string.
    const SENTENCE = "The upload could not be checked.";
    renderEnvelope("ZZ_NO_TABLE_ENTRY_AT_ALL", SENTENCE);

    expect(
      screen.queryAllByText(SENTENCE),
      "the panel printed one sentence in both of its copy slots. The user reads " +
        "the same words twice and learns nothing the second time — reproduced " +
        "in a browser on a real founder CSV (ISSUE-003).",
    ).toHaveLength(1);
    expect(
      screen.queryByText(/rows? failed validation/),
      "a breakdown region rendered with no rows to break down — the copy would " +
        "be promising something that is not on screen.",
    ).not.toBeInTheDocument();
  });

  it("POSITIVE COUNTERPART of the pin: with row errors, the heading renders once AND the breakdown region appears", () => {
    // Without this, the pin above is satisfied by deleting the panel's body.
    renderEnvelope("CSV_VALIDATION_FAILED", "ignored — rows win the heading", [
      { rule: "not_nullable", row: 4, message: "daily_return is null" },
      { rule: "not_nullable", row: 9, message: "daily_return is null" },
    ]);

    expect(screen.queryAllByText("2 rows failed validation")).toHaveLength(1);
    // The per-rule <details> region — the thing the panel exists for.
    expect(screen.getByText(/Failing values \(2 rows\)|not_nullable \(2 rows\)/)).toBeInTheDocument();
  });

  // ── 140.5-05 — the CONTRADICTION guard, found by a negative control ────────

  it("⭐ does NOT paste the generic SEAM_MISCONFIGURED cause under the route's corrected sentence", () => {
    // On the untouched tree this panel rendered, in order:
    //   "…we stopped before checking your file. … Nothing was saved … try again
    //    in a minute."            ← the route's WR-07-corrected sentence, TRUE
    //   "…Nothing was submitted and nothing was changed. Retrying will not
    //    clear it…"               ← the table's cause, FALSE at this emitter
    // Two contradictory accounts of one failure, in one panel. The table entry
    // is true where it was authored (a pre-I/O `SeamConfigError`) and false
    // here, because `req.formData()` buffers the whole upload ~50 lines above
    // the deny that emits this code.
    const ROUTE_CORRECTED =
      "Our rate limiter is unavailable, so we stopped before checking your " +
      "file. This is a fault on our side, not your data. Nothing was saved and " +
      "nothing was validated — try again in a minute.";
    renderEnvelope("SEAM_MISCONFIGURED", ROUTE_CORRECTED);

    expect(screen.getByText(ROUTE_CORRECTED)).toBeInTheDocument();
    const panel = screen.getByTestId("wizard-csv-error");
    expect(panel.textContent).not.toContain("Nothing was submitted");
    expect(panel.textContent).not.toContain("Retrying will not clear it");
    // …and no substitute sentence was invented in its place: exactly one copy
    // paragraph, the route's own.
    const copyParagraphs = [...panel.querySelectorAll("p")].filter(
      (p) => !p.textContent?.startsWith("correlation_id:"),
    );
    expect(copyParagraphs).toHaveLength(1);
  });

  it("ANTI-CONTROL: suppression is targeted — a code whose cause IS true here still renders it", () => {
    // Without this, the fix above is satisfiable by deleting the second line
    // for every code, which would undo CR-02 entirely.
    renderEnvelope(
      "CSV_FILE_TOO_LARGE",
      "Maximum file size is 10 MB. Your file is 11.3 MB.",
    );
    expect(
      screen.getByText(WIZARD_ERROR_COPY.CSV_FILE_TOO_LARGE.cause),
    ).toBeInTheDocument();
  });

  it("POSITIVE COUNTERPART: the per-row cause line is untouched", () => {
    // Without this, "render no second line" is satisfied by deleting the cause
    // line entirely, which would remove the panel's real per-row summary — the
    // thing it was built for.
    renderEnvelope("CSV_VALIDATION_FAILED", "3 rows failed validation", [
      { rule: "column_in_dataframe", row: 1, message: "missing" },
      { rule: "not_nullable", row: 2, message: "null" },
    ]);
    expect(screen.getByText(/Across 2 rule categories/)).toBeInTheDocument();
  });
});
