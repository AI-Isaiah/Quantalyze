"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  FactsheetPreview,
  type FactsheetPreviewMetric,
} from "@/components/strategy/FactsheetPreview";
import {
  formatKeyError,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { SyncPreviewSnapshot } from "./SyncPreviewStep";
import type { MetadataDraft } from "./MetadataStep";

/**
 * Step 4 of the wizard. Renders a read-only summary of the draft and
 * fires POST /api/strategies/finalize-wizard on confirmation. The
 * server-side RPC `finalize_wizard_strategy` (migration 031) updates
 * the row to status='pending_review' in one transaction and notifies
 * the founder via `after()`.
 *
 * Success redirect is handled by WizardClient's `handleSubmitSuccess`.
 */

export interface SubmitStepProps {
  strategyId: string;
  wizardSessionId: string;
  snapshot: SyncPreviewSnapshot;
  metadata: MetadataDraft;
  onSubmitted: (strategyId: string) => void;
  onBack: () => void;
}

export function SubmitStep({
  strategyId,
  wizardSessionId,
  snapshot,
  metadata,
  onSubmitted,
  onBack,
}: SubmitStepProps) {
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<WizardErrorCode | null>(null);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setErrorCode(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/strategies/finalize-wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_id: strategyId,
          name: metadata.name,
          description: metadata.description,
          category_id: metadata.categoryId,
          strategy_types: metadata.strategyTypes,
          subtypes: metadata.subtypes,
          markets: metadata.markets,
          supported_exchanges: metadata.supportedExchanges,
          leverage_range: metadata.leverageRange || null,
          aum: metadata.aum ? Number(metadata.aum) : null,
          max_capacity: metadata.maxCapacity ? Number(metadata.maxCapacity) : null,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        strategy_id?: string;
        status?: string;
        error?: string;
      };

      if (!res.ok) {
        // The notify-submission email is fire-and-forget — if we get a
        // 2xx but that callback failed, the strategy is still saved.
        // Here we only surface actual finalize failures.
        setErrorCode("UNKNOWN");
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "submit",
          code: "UNKNOWN",
        });
        setSubmitting(false);
        return;
      }

      onSubmitted(data.strategy_id ?? strategyId);
    } catch (err) {
      console.error("[wizard:SubmitStep] threw:", err);
      setErrorCode("KEY_NETWORK_TIMEOUT");
      setSubmitting(false);
    }
  }, [submitting, strategyId, metadata, onSubmitted, wizardSessionId]);

  const errorCopy = errorCode ? formatKeyError(errorCode) : null;

  const summaryMetrics: FactsheetPreviewMetric[] = snapshot.metrics;

  return (
    <section aria-labelledby="wizard-submit-heading">
      <h2
        id="wizard-submit-heading"
        className="font-sans text-2xl font-semibold text-text-primary"
      >
        Review and submit
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        The founder reviews pending strategies within 48 hours. You will receive
        an email when your listing is approved.
      </p>

      {/* Factsheet summary in DRAFT variant — never "Verified" pre-review */}
      <div className="mt-6">
        <FactsheetPreview
          strategyName={metadata.name ?? "Draft strategy"}
          subtitle={
            snapshot.detectedMarkets.length > 0
              ? `${metadata.strategyTypes.join(" · ")} · ${snapshot.detectedMarkets.join(", ")}`
              : metadata.strategyTypes.join(" · ")
          }
          metrics={summaryMetrics}
          sparklineReturns={snapshot.sparkline}
          computedAt={snapshot.computedAt}
          verificationState="draft"
        />
      </div>

      {/* Read-only metadata summary card */}
      <div className="mt-6 rounded-md border border-border bg-white">
        <dl className="divide-y divide-border">
          <SummaryRow label="Codename" value={metadata.name ?? "—"} />
          <SummaryRow
            label="Description"
            value={metadata.description || "—"}
          />
          <SummaryRow
            label="Strategy types"
            value={metadata.strategyTypes.join(", ") || "—"}
          />
          <SummaryRow
            label="Markets"
            value={metadata.markets.join(", ") || "—"}
          />
          <SummaryRow
            label="Supported exchanges"
            value={metadata.supportedExchanges.join(", ") || "—"}
          />
          <SummaryRow
            label="Leverage"
            value={metadata.leverageRange || "—"}
          />
          <SummaryRow
            label="AUM (USD)"
            value={metadata.aum ? `$${Number(metadata.aum).toLocaleString()}` : "—"}
          />
          <SummaryRow
            label="Max capacity (USD)"
            value={
              metadata.maxCapacity
                ? `$${Number(metadata.maxCapacity).toLocaleString()}`
                : "—"
            }
          />
        </dl>
      </div>

      {errorCopy && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-negative/30 bg-negative/5 px-4 py-3"
        >
          <p className="text-sm font-semibold text-negative">{errorCopy.title}</p>
          <p className="mt-1 text-xs text-text-secondary">{errorCopy.cause}</p>
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <Button variant="secondary" type="button" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          data-testid="wizard-submit-for-review"
        >
          {submitting ? "Submitting..." : "Submit for review"}
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
