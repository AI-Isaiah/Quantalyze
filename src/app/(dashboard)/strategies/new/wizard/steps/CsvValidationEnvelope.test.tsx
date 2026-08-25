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

// ── 161-03 / WIZERR-13 — THE DATA HALF: what the breakdown may and may not say ─
//
// The producer half landed in the same plan (`csv_validator.py` nan-guard +
// `process_key.py` forwarding). These are the RENDER pins for it: the panel is
// the last place before a human reads the rows, and it is where an untrusted
// cell value would surface if the wire shape ever grew one.
//
// ⚠️ FIXTURES ARE HAND-TYPED WIRE ENVELOPES, never imported constants. An
// imported shape makes the assertion and the implementation the same oracle and
// the case passes on a producer that silently changed.

/** Render an envelope typed only as it arrives — as JSON off a fetch. */
function renderWire(envelope: unknown) {
  render(
    <CsvValidationEnvelope
      envelope={
        envelope as {
          code: string;
          human_message: string;
          debug_context: {
            pandera_errors?: { rule: string; row: number; message: string }[];
          };
          correlation_id: string | null;
        }
      }
    />,
  );
}

const panelText = () =>
  screen.getByTestId("wizard-csv-error").textContent ?? "";

describe("[161-03 / WIZERR-13] CsvValidationEnvelope — the per-row data half", () => {
  it("zero rows ⇒ the breakdown section is ABSENT, not an empty shell", () => {
    // An empty <details> would promise a breakdown and open onto nothing.
    renderWire({
      code: "CSV_VALIDATION_FAILED",
      human_message: "Your file did not pass validation.",
      debug_context: { pandera_errors: [] },
      correlation_id: null,
    });

    expect(
      screen.getByTestId("wizard-csv-error").querySelectorAll("details"),
      "a breakdown region rendered with no rows in it",
    ).toHaveLength(0);
  });

  it("each row renders its rule, its row index and its message", () => {
    renderWire({
      code: "CSV_VALIDATION_FAILED",
      human_message: "ignored — rows win the heading",
      debug_context: {
        pandera_errors: [
          {
            rule: "daily_return_lower_bound",
            row: 4,
            message:
              "Column 'daily_return' failed rule 'daily_return_lower_bound' at row 4.",
          },
          {
            rule: "monotonic_dates",
            row: 9,
            message: "Column 'date' failed rule 'monotonic_dates' at row 9.",
          },
        ],
      },
      correlation_id: null,
    });

    const text = panelText();
    // The rule — via its human label, which is what the <summary> carries.
    expect(text).toContain("Daily return cannot be ≤ -100%");
    expect(text).toContain("Dates must be strictly increasing");
    // The row index, on the row itself.
    expect(text).toContain("Row 4:");
    expect(text).toContain("Row 9:");
    // The message.
    expect(text).toContain(
      "Column 'daily_return' failed rule 'daily_return_lower_bound' at row 4.",
    );
    expect(text).toContain(
      "Column 'date' failed rule 'monotonic_dates' at row 9.",
    );
  });

  it("🔴 the COLUMN-LESS producer shape renders cleanly — no 'nan', no dangling clause", () => {
    // What `csv_validator.py` emits for a DATAFRAME-level check: the column
    // clause is omitted entirely rather than filled with the float NaN pandera
    // reports. Pre-161-03 this arrived as "Column 'nan' failed rule …".
    //
    // ⚠️ 161-REVIEW / CR-02 RE-POINTED THE FIXTURE. It used to carry
    // "Failed rule 'column_in_dataframe' at row 0." and assert that exact
    // string — i.e. it pinned the fabricated ROW number 161-03 left behind
    // after removing the fabricated COLUMN name. Both halves moved: the
    // producer stopped interpolating the absent-row sentinel, and this panel
    // stopped prefixing "Row 0:" onto it. The row-clause pin now lives in the
    // dedicated case below.
    renderWire({
      code: "CSV_VALIDATION_FAILED",
      human_message: "Your file did not pass validation.",
      debug_context: {
        pandera_errors: [
          {
            rule: "column_in_dataframe",
            row: 0,
            message: "Failed rule 'column_in_dataframe'.",
          },
        ],
      },
      correlation_id: null,
    });

    const text = panelText();
    expect(text.length).toBeGreaterThan(20); // the haystack is real
    expect(text).toContain("Failed rule 'column_in_dataframe'.");
    expect(
      text.toLowerCase(),
      "the panel named a column called 'nan' — the float NaN pandera reports " +
        "when there is no column at all",
    ).not.toContain("'nan'");
    expect(
      text,
      "the column clause was emptied instead of removed, leaving a dangling " +
        "pair of quotes where a name used to be",
    ).not.toContain("Column ''");
    // The rule still gets its human label, which is where the actionable
    // information now lives for this rule.
    expect(text).toContain("Your CSV is missing a required column");
  });

  /**
   * ⭐ 161-REVIEW / CR-02 — THE RENDERED `<li>` NAMES NO ROW IT DOES NOT HAVE.
   *
   * This is the LAST line before a human reads it, and it is a second,
   * independent producer of the same defect: even with the server's sentence
   * corrected, the panel's own `Row ${e.row}: ` prefix would have printed
   * "Row 0:" — `0` is the absent-row sentinel and rows here are 1-based.
   *
   * The fixture deliberately carries the CORRECTED server sentence, so this
   * case can only be satisfied by the RENDERER's guard. A fixture still
   * carrying "at row 0" would let the producer fix alone turn it green and this
   * pin would be measuring the wrong layer.
   */
  it("🔴 a row-less breakdown row renders NO 'Row N:' prefix — 0 is the absent-row sentinel", () => {
    renderWire({
      code: "CSV_VALIDATION_FAILED",
      human_message: "Your file did not pass validation.",
      debug_context: {
        pandera_errors: [
          {
            rule: "column_in_dataframe",
            row: 0,
            message: "Failed rule 'column_in_dataframe'.",
          },
        ],
      },
      correlation_id: null,
    });

    const text = panelText();
    expect(text.length).toBeGreaterThan(20); // the haystack is real
    // The message itself still renders — "suppress the prefix" must not be
    // satisfied by dropping the row.
    expect(text).toContain("Failed rule 'column_in_dataframe'.");
    expect(
      text,
      "the panel prefixed a row number onto a failure that has no row — the " +
        "invented-number class this phase exists to close, one layer out from " +
        "the invented column name 161-03 removed",
    ).not.toContain("Row 0:");
    expect(text).not.toContain("Row undefined:");
    expect(text).not.toContain("at row 0");
  });

  it("POSITIVE COUNTERPART: a REAL row still gets its 'Row N:' prefix", () => {
    // Without this, "suppress the prefix for row 0" is satisfied by suppressing
    // it for every row — which would delete the panel's row index outright, the
    // single most useful field on a per-row breakdown. The `each row renders
    // its rule, its row index and its message` case above asserts the same
    // property from its own fixture; this one sits beside the negative so the
    // pair reads as the matched set it is.
    renderWire({
      code: "CSV_VALIDATION_FAILED",
      human_message: "Your file did not pass validation.",
      debug_context: {
        pandera_errors: [
          {
            rule: "daily_return_lower_bound",
            row: 1,
            message:
              "Column 'daily_return' failed rule 'daily_return_lower_bound' at row 1.",
          },
        ],
      },
      correlation_id: null,
    });

    const text = panelText();
    // Row 1 is the FIRST real row and the value adjacent to the sentinel — an
    // off-by-one guard that used `> 0` on a 0-based index would drop it.
    expect(text).toContain("Row 1:");
  });

  it("🔴 NO-ECHO: an untrusted cell value smuggled onto a row never reaches the DOM", () => {
    // T-161-07. `failure_case` is the raw failing cell — untrusted CSV
    // content that can carry PII, and this envelope is persisted into
    // strategy_verifications metadata. The producer projects it away; this
    // pins the LAST line of defence, so a future wire change that reintroduced
    // it would be caught where a human would have read it.
    const CELL = "ZZ-PII-acct-4411-Jane-Doe";
    renderWire({
      code: "CSV_VALIDATION_FAILED",
      human_message: "Your file did not pass validation.",
      debug_context: {
        pandera_errors: [
          {
            rule: "currency_usd_or_blank",
            row: 3,
            message:
              "Column 'currency' failed rule 'currency_usd_or_blank' at row 3.",
            // The key the wire shape does not have — present here on purpose.
            failure_case: CELL,
          },
        ],
      },
      correlation_id: null,
    });

    const text = panelText();
    // Guard both ends before the substring assertion: `"x".includes("")` is
    // true, so a blanked needle would pass while checking nothing, and an
    // empty haystack would pass for the wrong reason.
    expect(CELL.length).toBeGreaterThan(10);
    expect(text.length).toBeGreaterThan(20);
    expect(
      text,
      "the raw failing cell was rendered — untrusted CSV content on screen " +
        "and, through this envelope, in strategy_verifications metadata",
    ).not.toContain(CELL);
    // …and the row it belongs to DID render, so the pin is not satisfied by
    // the panel dropping the row wholesale.
    expect(text).toContain("Row 3:");
    expect(text).toContain(
      "Column 'currency' failed rule 'currency_usd_or_blank' at row 3.",
    );
  });

  it("LONG-TEXT BACKSTOP: a long rule name and message do not cost the row index", () => {
    // jsdom cannot measure wrapping, so what is pinned is the thing a truncation
    // would take first: the row index sits BEFORE the message and is the only
    // part of the row a user can act on.
    const LONG_RULE = "an_extremely_long_and_unlabelled_rule_key_".repeat(3);
    const LONG_MESSAGE =
      "Column 'daily_return' failed rule 'an_extremely_long_and_unlabelled_rule_key' at row 12 — " +
      "and the explanation continues at length about exactly which of the many ".repeat(
        4,
      );
    renderWire({
      code: "CSV_VALIDATION_FAILED",
      human_message: "Your file did not pass validation.",
      debug_context: {
        pandera_errors: [{ rule: LONG_RULE, row: 12, message: LONG_MESSAGE }],
      },
      correlation_id: null,
    });

    const text = panelText();
    expect(text).toContain("Row 12:");
    // The unlabelled rule key falls through to itself in the <summary> — the
    // panel does not silently drop a rule it has no label for.
    expect(text).toContain(LONG_RULE);
    expect(text).toContain(LONG_MESSAGE);
  });
});
