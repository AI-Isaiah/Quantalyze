"use client";

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

// TODO(phase-17): hoist into wizardErrors.ts per DESIGN-05.
// UI-SPEC §8.8 rule-name human mapping (locked).
// Cross-AI revision 2026-04-30: 6 entries (was 7); the weekend-window
// rule was removed because crypto markets trade 24/7.
const RULE_LABELS: Record<string, string> = {
  monotonic_dates: "Dates must be strictly increasing",
  nav_non_zero: "NAV cannot be zero",
  daily_return_lower_bound: "Daily return cannot be ≤ -100%",
  daily_sharpe_sentinel: "Daily Sharpe > 10 looks unrealistic",
  currency_usd_or_blank: "Currency must be USD or left blank",
  qty_price_positive: "Quantity and price must be positive",
};

export function CsvValidationEnvelope({ envelope }: CsvValidationEnvelopeProps) {
  const errors = envelope.debug_context?.pandera_errors ?? [];
  const byRule = errors.reduce<Record<string, typeof errors>>((acc, e) => {
    (acc[e.rule] ??= []).push(e);
    return acc;
  }, {});
  const ruleKeys = Object.keys(byRule);
  const ruleCount = ruleKeys.length;

  // TODO(phase-17): hoist these literal strings into wizardErrors.ts.
  let causeText: string;
  if (ruleCount > 1) {
    causeText = `Across ${ruleCount} rule categories: ${ruleKeys
      .map((r) => RULE_LABELS[r] ?? r)
      .join(", ")}.`;
  } else if (ruleCount === 1 && errors.length > 0) {
    const onlyRule = ruleKeys[0];
    const human = RULE_LABELS[onlyRule] ?? onlyRule;
    causeText = `Rule violated: ${human}. Expand below for the row-level breakdown.`;
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
            {RULE_LABELS[rule] ?? rule} ({list.length} rows)
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text-muted">
            {list.map((e, i) => (
              <li key={i}>
                Row {e.row}: {e.message}
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
