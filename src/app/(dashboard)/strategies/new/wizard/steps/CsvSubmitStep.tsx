"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { CsvValidationEnvelope } from "./CsvValidationEnvelope";

/**
 * Phase 15 / CSV-01..CSV-02 — sub-step 3 of the CSV branch.
 *
 * Read-only summary card + 'Submit strategy' CTA + 'Back' button. POSTs
 * to /api/strategies/csv-finalize with {wizard_session_id, fmt,
 * strategy_name}. On success, calls onSubmitted(strategy_id) which
 * WizardClient hooks to clearWizardState + router.push (UI-SPEC §7.5).
 *
 * Cross-AI revision 2026-04-30: the finalize body now includes
 * strategy_name (snake_case JSON key) sourced from the user-typed value
 * captured on the Upload step. The strategyName prop is rendered as
 * the FIRST SummaryRow in the read-only summary.
 */

type Fmt = "daily_returns" | "daily_nav" | "trades";

interface PreviewShape {
  row_count: number;
  date_range: [string, string];
  columns_detected: string[];
  first_rows: Record<string, unknown>[];
  last_rows: Record<string, unknown>[];
}

interface ValidationEnvelope {
  code: string;
  human_message: string;
  debug_context: {
    pandera_errors?: { rule: string; row: number; message: string }[];
  };
  correlation_id: string | null;
}

export interface CsvSubmitStepProps {
  wizardSessionId: string;
  fmt: Fmt;
  /** forwarded to finalize body as `strategy_name` (snake_case) */
  strategyName: string;
  preview: PreviewShape;
  onSubmitted: (strategyId: string) => void;
  onBack: () => void;
}

// TODO(phase-17): hoist into wizardErrors.ts per DESIGN-05 — copy locked by UI-SPEC §8.5.
const FMT_LABEL: Record<Fmt, string> = {
  daily_returns: "Daily returns",
  daily_nav: "Daily NAV",
  trades: "Trade list",
};

export function CsvSubmitStep({
  wizardSessionId,
  fmt,
  strategyName,
  preview,
  onSubmitted,
  onBack,
}: CsvSubmitStepProps) {
  const [submitting, setSubmitting] = useState(false);
  const [envelope, setEnvelope] = useState<ValidationEnvelope | null>(null);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setEnvelope(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/strategies/csv-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wizard_session_id: wizardSessionId,
          fmt,
          strategy_name: strategyName, // Cross-AI revision 2026-04-30
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        strategy_id?: unknown;
        status?: unknown;
        code?: string;
        human_message?: string;
        debug_context?: {
          pandera_errors?: { rule: string; row: number; message: string }[];
        };
        correlation_id?: string | null;
        error?: string;
      };

      if (!res.ok) {
        // TODO(phase-17): hoist into wizardErrors.ts per DESIGN-05.
        const errEnvelope: ValidationEnvelope = {
          code: data.code ?? "CSV_SUBMIT_FAILED",
          human_message:
            data.human_message ??
            data.error ??
            "Your file validated cleanly, but saving the strategy hit an error. Click Submit strategy again to retry — your data is unchanged.",
          debug_context: data.debug_context ?? {},
          correlation_id: data.correlation_id ?? null,
        };
        setEnvelope(errEnvelope);
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "csv_submit",
          code: errEnvelope.code,
        });
        setSubmitting(false);
        return;
      }

      // Defensive: route returned 200 but missing strategy_id.
      if (typeof data.strategy_id !== "string" || data.strategy_id.length === 0) {
        // TODO(phase-17): hoist into wizardErrors.ts per DESIGN-05.
        const errEnvelope: ValidationEnvelope = {
          code: "CSV_SUBMIT_NO_STRATEGY_ID",
          human_message:
            "Submission succeeded but the server did not return a strategy id. Retry to confirm.",
          debug_context: {},
          correlation_id: data.correlation_id ?? null,
        };
        setEnvelope(errEnvelope);
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "csv_submit",
          code: errEnvelope.code,
        });
        setSubmitting(false);
        return;
      }

      trackForQuantsEventClient("wizard_step_complete_3", {
        wizard_session_id: wizardSessionId,
        strategy_id: data.strategy_id,
      });
      onSubmitted(data.strategy_id);
    } catch (err) {
      console.error("[wizard:CsvSubmitStep] threw:", err);
      // TODO(phase-17): hoist into wizardErrors.ts per DESIGN-05.
      const errEnvelope: ValidationEnvelope = {
        code: "CSV_NETWORK_TIMEOUT",
        human_message:
          "The server did not respond within 30 seconds. Your file is preserved — click Submit strategy to try again.",
        debug_context: {},
        correlation_id: null,
      };
      setEnvelope(errEnvelope);
      trackForQuantsEventClient("wizard_error", {
        wizard_session_id: wizardSessionId,
        step: "csv_submit",
        code: "CSV_NETWORK_TIMEOUT",
      });
      setSubmitting(false);
    }
  }, [submitting, wizardSessionId, fmt, strategyName, onSubmitted]);

  return (
    <section aria-labelledby="wizard-csv-submit-heading">
      <h2
        id="wizard-csv-submit-heading"
        className="font-sans text-2xl font-semibold text-text-primary"
      >
        {/* TODO(phase-17): hoist into wizardErrors.ts per DESIGN-05. */}
        Review and submit
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        {/* TODO(phase-17): hoist into wizardErrors.ts per DESIGN-05. */}
        The founder reviews CSV-uploaded strategies within 48 hours. You will
        receive an email when your listing is approved.
      </p>

      {/* Read-only summary — Strategy name is the FIRST row (cross-AI revision 2026-04-30). */}
      <div className="mt-6 rounded-md border border-border bg-white">
        <dl className="divide-y divide-border">
          <SummaryRow label="Strategy name" value={strategyName} />
          <SummaryRow label="Format" value={FMT_LABEL[fmt]} />
          <SummaryRow
            label="Rows detected"
            value={`${preview.row_count} rows`}
          />
          <SummaryRow
            label="Date range"
            value={`${preview.date_range[0]} → ${preview.date_range[1]}`}
          />
          <SummaryRow
            label="Columns detected"
            value={preview.columns_detected.join(", ")}
          />
        </dl>
      </div>

      {envelope && (
        <div className="mt-4">
          <CsvValidationEnvelope
            envelope={{
              code: envelope.code,
              human_message: envelope.human_message,
              debug_context: envelope.debug_context,
              correlation_id: envelope.correlation_id,
            }}
          />
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <Button
          variant="secondary"
          type="button"
          onClick={onBack}
          data-testid="wizard-csv-submit-back"
        >
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          data-testid="wizard-csv-submit-cta"
        >
          {/* TODO(phase-17): hoist into wizardErrors.ts per DESIGN-05. */}
          {submitting ? "Submitting…" : "Submit strategy"}
        </Button>
      </div>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-4 py-3 md:grid-cols-[180px_1fr] md:gap-6">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
        {label}
      </dt>
      <dd className="text-xs text-text-secondary">{value}</dd>
    </div>
  );
}
