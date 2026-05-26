"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import {
  CSV_SUBMIT_STEP_HEADINGS,
  WIZARD_ERROR_COPY,
} from "@/lib/wizardErrors";
import { CsvValidationEnvelope } from "./CsvValidationEnvelope";
import type { MetadataDraft } from "./MetadataStep";

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
  /**
   * Phase 19.1 — parsed daily-return rows from the csv-validate envelope.
   * Forwarded to csv-finalize as `daily_returns_series` (snake_case).
   * REQUIRED for `fmt=daily_returns`/`daily_nav` (route.ts:748 rejects
   * with CSV_INVALID_FORMAT "received 0 rows" if missing/empty);
   * undefined/empty is the expected shape for `fmt=trades`.
   */
  dailyReturnsSeries?: { date: string; daily_return: number }[];
  /**
   * QA report 2026-05-21 ISSUE-010: classification metadata captured on
   * the new csv_metadata step. Forwarded to /api/strategies/csv-finalize
   * so the strategy can be discovered after admin approval.
   */
  metadata: MetadataDraft;
  onSubmitted: (strategyId: string) => void;
  onBack: () => void;
}

// Format-picker labels are component-local UI taxonomy (read-only summary
// row), not error/heading copy — they stay inline. wizardErrors.ts owns
// user-visible CSV error / heading strings only.
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
  dailyReturnsSeries,
  metadata,
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
          // Phase 19.1 — REQUIRED for fmt=daily_returns/daily_nav. The
          // csv-finalize route rejects with CSV_INVALID_FORMAT "received
          // 0 rows" if this is absent (route.ts:748). Omitted when the
          // wizard never received the field from csv-validate (legacy
          // pre-19.1 envelopes; fmt=trades).
          ...(dailyReturnsSeries !== undefined
            ? { daily_returns_series: dailyReturnsSeries }
            : {}),
          // QA report 2026-05-21 ISSUE-010 — classification metadata.
          // The route persists these via an authenticated UPDATE on
          // strategies AFTER the SECURITY DEFINER finalize RPC returns
          // the new id; RLS gates the write to the row's owner.
          metadata: {
            description: metadata.description,
            category_id: metadata.categoryId,
            strategy_types: metadata.strategyTypes,
            subtypes: metadata.subtypes,
            markets: metadata.markets,
            supported_exchanges: metadata.supportedExchanges,
            leverage_range: metadata.leverageRange,
            aum: metadata.aum,
            max_capacity: metadata.maxCapacity,
          },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
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

      // NEW-C14-01: 409 with ok:true is an idempotent success — the route
      // found the pre-existing strategy_id for this wizard_session_id.
      // Treat it as a successful finalize so the user lands on /strategies.
      const isIdempotentSuccess = res.status === 409 && data.ok === true;

      if (!res.ok && !isIdempotentSuccess) {
        const errEnvelope: ValidationEnvelope = {
          code: data.code ?? "CSV_SUBMIT_FAILED",
          human_message:
            data.human_message ??
            data.error ??
            WIZARD_ERROR_COPY.CSV_SUBMIT_FAILED.title,
          debug_context: data.debug_context ?? {},
          correlation_id: data.correlation_id ?? null,
        };
        setEnvelope(errEnvelope);
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "csv_submit",
          code: errEnvelope.code,
        });
        // NEW-C14-01: re-enable Submit on errors that are safe to retry.
        // The route is now idempotent for wizard_session_id conflicts
        // (23505 → 409), so retrying after CSV_FINALIZE_FAIL is safe.
        // Keep button disabled only for CSV_PERSIST_FAIL (strategy exists
        // but series not saved — user should contact support, not retry).
        if (data.code !== "CSV_PERSIST_FAIL") {
          setSubmitting(false);
        }
        return;
      }

      // FINDING-6: on the 409 idempotent-success path, explicitly log if
      // strategy_id is absent or non-UUID before the generic check below
      // surfaces the error. This distinguishes "admin lookup silently failed
      // and returned a corrupted shape" from "route returned 200 with no id".
      // The /uuid4/ regex matches the standard uuid4 format produced by the DB.
      if (isIdempotentSuccess && (typeof data.strategy_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.strategy_id ?? ""))) {
        console.error("[wizard:CsvSubmitStep] 409 idempotent but strategy_id missing or non-UUID", { strategy_id: data.strategy_id, correlation_id: data.correlation_id });
        // Fall through to the generic defensive check below which surfaces the error to the user.
      }

      // Defensive: route returned 200 but missing strategy_id.
      if (typeof data.strategy_id !== "string" || data.strategy_id.length === 0) {
        const errEnvelope: ValidationEnvelope = {
          code: "CSV_SUBMIT_NO_STRATEGY_ID",
          human_message: WIZARD_ERROR_COPY.CSV_SUBMIT_NO_STRATEGY_ID.title,
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
      // Phase 17 / DESIGN-05: unified with CsvUploadStep variant. UI-SPEC §14.1
      // row 7 declares the canonical text as "click Retry to try again" — both
      // step files now share the same single-source-of-truth title.
      const errEnvelope: ValidationEnvelope = {
        code: "CSV_NETWORK_TIMEOUT",
        human_message: WIZARD_ERROR_COPY.CSV_NETWORK_TIMEOUT.title,
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
  }, [submitting, wizardSessionId, fmt, strategyName, dailyReturnsSeries, metadata, onSubmitted]);

  return (
    <section aria-labelledby="wizard-csv-submit-heading">
      <h2
        id="wizard-csv-submit-heading"
        className="font-sans text-2xl font-semibold text-text-primary"
      >
        {CSV_SUBMIT_STEP_HEADINGS.title}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        {CSV_SUBMIT_STEP_HEADINGS.subtitle}
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
          {submitting
            ? CSV_SUBMIT_STEP_HEADINGS.submittingCtaLabel
            : CSV_SUBMIT_STEP_HEADINGS.submitCtaLabel}
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
