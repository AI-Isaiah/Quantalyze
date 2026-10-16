/**
 * 170.1 round-1 WR-02 — the producer's REAL bespoke messages, as test specimens.
 *
 * Hand-typed from the f-strings in `analytics-service/services/csv_validator.py`
 * (the repo's hand-typed-oracle convention) with realistic numbers. Every bespoke
 * rule is emitted as a FILE-level error: `row: 0`, the absent-row sentinel.
 * `parse_error` is never emitted at a real row.
 *
 * Two test files read this module so the specimens cannot drift apart:
 * `CsvValidationEnvelope.test.tsx` (what a user reads) and
 * `CsvValidationEnvelope.producer-parity.test.tsx` (producer to label parity).
 * The parity test also checks the static text of each message against the
 * producer source, so a reworded producer message fails there.
 */
export interface ProducerSpecimen {
  rule: string;
  row: number;
  message: string;
}

/** `MAX_INGEST_ROWS = 5000`; 7300 is about 20 years of daily returns. */
export const TOO_MANY_ROWS: ProducerSpecimen = {
  rule: "too_many_rows",
  row: 0,
  message: "CSV exceeds the 5000-row limit (got 7300 rows).",
};

export const EMPTY_NO_FILE: ProducerSpecimen = {
  rule: "empty",
  row: 0,
  message: "No file uploaded",
};

export const EMPTY_NO_ROWS: ProducerSpecimen = {
  rule: "empty",
  row: 0,
  message: "No data rows found",
};

/** `f"Could not parse CSV: {e}"` with a pandas tokenizer error for `e`. */
export const PARSE_ERROR: ProducerSpecimen = {
  rule: "parse_error",
  row: 0,
  message:
    "Could not parse CSV: Error tokenizing data. C error: Expected 2 fields in line 3, saw 4",
};

export const DATE_FORMAT_AMBIGUOUS: ProducerSpecimen = {
  rule: "date_format_ambiguous",
  row: 0,
  message:
    "Could not determine the date format — these dates are ambiguous (each could be DD/MM/YYYY or MM/DD/YYYY). Please re-upload with ISO dates in YYYY-MM-DD format.",
};

/** One specimen per emission site; `empty` has two. */
export const BESPOKE_SPECIMENS: readonly ProducerSpecimen[] = [
  TOO_MANY_ROWS,
  EMPTY_NO_FILE,
  EMPTY_NO_ROWS,
  PARSE_ERROR,
  DATE_FORMAT_AMBIGUOUS,
];

/** The text `CsvValidationEnvelope` shows for an unknown PANDERA rule. */
export const UNKNOWN_PANDERA_RULE_FALLBACK =
  "This value does not pass a format check";
