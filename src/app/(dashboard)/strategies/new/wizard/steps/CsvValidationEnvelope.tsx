"use client";

import {
  CSV_RULE_LABELS,
  formatCsvRuleCauseSingle,
  formatColumnInDataframeMessage,
} from "@/lib/wizardErrors";

/**
 * Phase 15 / CSV-01..CSV-02 — server validation error envelope for the
 * CSV branch of the strategy onboarding wizard.
 *
 * Visual contract is locked by 15-UI-SPEC.md §7.3 (envelope shell) and
 * §8.8 (per-rule label table). Mirrors the ConnectKeyStep error block.
 *
 * The correlation_id null slot is rendered as a dash in Phase 15. Phase
 * 16 / OBSERV-06 wires real values via analytics-client.ts:66 without
 * changing the DOM shape.
 *
 * Phase 17 / DESIGN-05: rule-label map and cause-string templates live
 * in @/lib/wizardErrors as the canonical source of truth.
 */

interface CsvValidationEnvelopeProps {
  envelope: {
    code: string;
    human_message: string;
    debug_context: {
      pandera_errors?: { rule: string; row: number; message: string }[];
    };
    correlation_id: string | null;
  };
}

export function CsvValidationEnvelope({ envelope }: CsvValidationEnvelopeProps) {
  const errors = envelope.debug_context?.pandera_errors ?? [];
  const byRule = errors.reduce<Record<string, typeof errors>>((acc, e) => {
    (acc[e.rule] ??= []).push(e);
    return acc;
  }, {});
  const ruleKeys = Object.keys(byRule);
  const ruleCount = ruleKeys.length;

  let causeText: string;
  if (ruleCount > 1) {
    // Phase 17 / DESIGN-05: matches `formatCsvRuleCauseMulti` shape but
    // humanizes each key via CSV_RULE_LABELS first (the helper takes raw
    // keys; this surface joins human-readable labels for byte-identical
    // DOM).
    const humanizedKeys = ruleKeys.map((r) => CSV_RULE_LABELS[r] ?? r);
    causeText = `Across ${ruleCount} rule categories: ${humanizedKeys.join(", ")}.`;
  } else if (ruleCount === 1 && errors.length > 0) {
    const onlyRule = ruleKeys[0];
    const human = CSV_RULE_LABELS[onlyRule] ?? onlyRule;
    causeText = formatCsvRuleCauseSingle(human);
  } else {
    causeText = envelope.human_message;
  }

  return (
    <div
      role="alert"
      className="rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
      data-testid="wizard-csv-error"
      data-error-code={envelope.code}
    >
      <p className="text-sm font-semibold text-negative">
        {errors.length > 0
          ? `${errors.length} ${errors.length === 1 ? "row" : "rows"} failed validation`
          : envelope.human_message}
      </p>
      <p className="mt-1 text-xs text-text-secondary">{causeText}</p>
      {Object.entries(byRule).map(([rule, list]) => (
        <details key={rule} className="mt-2 text-xs">
          <summary className="cursor-pointer text-text-secondary">
            {CSV_RULE_LABELS[rule] ?? rule} ({list.length} rows)
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text-muted">
            {list.map((e, i) => (
              <li key={i}>
                {rule === "column_in_dataframe"
                  ? formatColumnInDataframeMessage(e.message)
                  : `Row ${e.row}: ${e.message}`}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {/* Phase 16 / OBSERV-06 carrier marker — DOM shape stable. */}
      <p className="mt-2 text-[11px] text-text-muted">
        correlation_id: {envelope.correlation_id ?? "—"}
      </p>
    </div>
  );
}
