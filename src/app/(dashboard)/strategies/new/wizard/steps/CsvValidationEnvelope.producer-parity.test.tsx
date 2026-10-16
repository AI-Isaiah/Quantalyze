/** @vitest-environment jsdom */
/**
 * 170.1 round-1 WR-01 — producer to label parity for CSV validation rules.
 *
 * `csvRuleLabel` answers a rule it has no label for with the UI-SPEC fallback
 * "This value does not pass a format check". That sentence is written for an
 * unknown PANDERA rule. A rule the validator itself emits (`too_many_rows`,
 * `empty`, `parse_error`, `date_format_ambiguous`) carries its own sentence and
 * must never reach it. This test enumerates every `"rule": "<literal>"` in
 * `analytics-service/services/csv_validator.py` and fails when a literal is
 * neither labelled in `CSV_RULE_LABELS` nor handled by the bespoke path, so a
 * NEW producer rule cannot fall silently into the generic label.
 *
 * Precedent: `analytics-service/tests/test_csv_required_columns_parity.py` and
 * `src/lib/csv-required-columns.json`.
 *
 * ⚠️ The two classification sets below are HAND-TYPED on purpose. A new literal
 * has to be put into one of them (or labelled) by a person in the same commit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CSV_RULE_LABELS, hasCsvRuleLabel } from "@/lib/wizardErrors";
import { CsvValidationEnvelope } from "./CsvValidationEnvelope";
import {
  BESPOKE_SPECIMENS,
  UNKNOWN_PANDERA_RULE_FALLBACK,
} from "./CsvValidationEnvelope.producer-specimens";

afterEach(() => cleanup());

const PRODUCER_PATH = "analytics-service/services/csv_validator.py";
const producerSource = readFileSync(join(process.cwd(), PRODUCER_PATH), "utf8");

/** Producer-authored error rules: the envelope shows the producer's own sentence. */
const BESPOKE_RULES = [
  "date_format_ambiguous",
  "empty",
  "parse_error",
  "too_many_rows",
] as const;

/**
 * Rules the producer writes into `info_flags`, never into the `errors` list
 * that becomes `debug_context.pandera_errors`, so the envelope never sees them.
 */
const INFO_FLAG_RULES = [
  "auto_normalized_percent_form",
  "date_format_normalized",
] as const;

const producerRuleLiterals = (): string[] => [
  ...new Set(
    [...producerSource.matchAll(/"rule":\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]),
  ),
];

describe("[170.1 round-1 WR-01] csv_validator.py rule literals vs CSV_RULE_LABELS", () => {
  it("the scan finds the producer's rules (a vacuous regex would pass everything)", () => {
    const found = producerRuleLiterals();
    expect(found.length).toBeGreaterThanOrEqual(9);
    expect(found).toContain("too_many_rows");
    expect(found).toContain("daily_sharpe_sentinel");
  });

  it("🔴 every rule the producer emits is labelled, bespoke, or an info flag", () => {
    const bespoke = new Set<string>(BESPOKE_RULES);
    const infoFlags = new Set<string>(INFO_FLAG_RULES);
    const unhandled = producerRuleLiterals().filter(
      (rule) => !hasCsvRuleLabel(rule) && !bespoke.has(rule) && !infoFlags.has(rule),
    );
    expect(
      unhandled,
      `csv_validator.py emits rule(s) ${JSON.stringify(unhandled)} with no CSV_RULE_LABELS ` +
        "entry and no classification here. Left alone they render the unknown-pandera-rule " +
        'fallback "This value does not pass a format check", which is false for a ' +
        "producer-authored rule. Add a label, or classify the rule in this test.",
    ).toEqual([]);
  });

  it("the classification sets hold no stale or contradictory entry", () => {
    const emitted = new Set(producerRuleLiterals());
    for (const rule of [...BESPOKE_RULES, ...INFO_FLAG_RULES]) {
      expect(emitted.has(rule), `${rule} is classified here but the producer no longer emits it`).toBe(
        true,
      );
    }
    for (const rule of BESPOKE_RULES) {
      expect(
        hasCsvRuleLabel(rule),
        `${rule} is bespoke here but has a CSV_RULE_LABELS entry, which would shadow its own sentence`,
      ).toBe(false);
    }
    // Every declared bespoke rule is exercised by a specimen below.
    expect(new Set(BESPOKE_SPECIMENS.map((s) => s.rule))).toEqual(new Set(BESPOKE_RULES));
    expect(Object.keys(CSV_RULE_LABELS).length).toBeGreaterThan(0);
  });

  it("the specimens still match the producer's text and row limit", () => {
    const limit = /MAX_INGEST_ROWS\s*=\s*(\d+)/.exec(producerSource)?.[1];
    expect(limit).toBeDefined();
    const tooMany = BESPOKE_SPECIMENS.find((s) => s.rule === "too_many_rows");
    expect(tooMany?.message).toContain(`${limit}-row limit`);
    for (const fixed of [
      "No file uploaded",
      "No data rows found",
      "Could not parse CSV: ",
      "a data row has more fields than the header row.",
      // The whole founder-approved sentence as ONE literal (D-14): the producer
      // keeps it on a single line so this pin can find it.
      "Could not parse CSV: two columns have the same name.",
      "Could not determine the date format",
    ]) {
      expect(producerSource, `producer no longer contains "${fixed}"`).toContain(fixed);
    }
  });

  it("🔴 each bespoke rule renders its own sentence and never the pandera fallback", () => {
    for (const specimen of BESPOKE_SPECIMENS) {
      render(
        <CsvValidationEnvelope
          envelope={{
            code: "CSV_VALIDATION_FAILED",
            human_message: "Your file did not pass validation.",
            debug_context: { pandera_errors: [specimen] },
            correlation_id: null,
          }}
        />,
      );
      const text = screen.getByTestId("wizard-csv-error").textContent ?? "";
      expect(text, specimen.rule).toContain(specimen.message);
      expect(text, specimen.rule).not.toContain(UNKNOWN_PANDERA_RULE_FALLBACK);
      cleanup();
    }
  });
});
