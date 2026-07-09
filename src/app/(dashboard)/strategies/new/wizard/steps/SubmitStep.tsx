"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  FactsheetPreview,
  type FactsheetPreviewMetric,
} from "@/components/strategy/FactsheetPreview";
import { type WizardErrorCode } from "@/lib/wizardErrors";
import { buildEnvelope } from "@/lib/envelope";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { SyncPreviewSnapshot } from "./SyncPreviewStep";
import type { MetadataDraft } from "./MetadataStep";

/**
 * Read the correlation_id from the <meta name="x-correlation-id"> tag the
 * root layout renders server-side (Plan 16-02 / OBSERV-09). Falls back to
 * a fresh UUID v4 when the meta tag is absent (e.g., during the parallel
 * wave window when 16-02 has not yet merged into this branch).
 */
function readCorrelationId(): string {
  if (typeof document !== "undefined") {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="x-correlation-id"]',
    );
    const value = meta?.getAttribute("content");
    if (value && value.length > 0) return value;
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
  // Phase 16 Plan 06: correlation_id for the envelope. See readCorrelationId().
  const [correlationId] = useState<string>(() => readCorrelationId());

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
          // #597 — asset class drives Sharpe/Sortino/vol annualization basis.
          asset_class: metadata.assetClass,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        strategy_id?: string;
        status?: string;
        error?: string;
        code?: string;
        idempotent?: boolean;
      };

      if (!res.ok) {
        // The notify-submission email is fire-and-forget — if we get a
        // 2xx but that callback failed, the strategy is still saved.
        // Here we only surface actual finalize failures.
        //
        // The server tags actionable failures with a stable WizardErrorCode
        // (e.g. KEY_SCOPE_BROADENED when the live exchange-key scope
        // re-check at finalize finds the key broadened to trade/withdraw
        // since Connect, or KEY_NETWORK_TIMEOUT when that probe itself
        // fails). Trust the code only if it's a known wizard code so a
        // garbled response can't poison the envelope copy.
        // H-0192: the finalize route tags each actionable failure with its
        // own WizardErrorCode — the 404 "Draft not found" -> GATE_DRAFT_GONE,
        // the 403 RLS/ownership denial -> GUARD_BLOCKED, and the live
        // key-scope / network-probe paths -> KEY_SCOPE_BROADENED /
        // KEY_NETWORK_TIMEOUT. Map off that code only, NOT raw HTTP status:
        // status-based mapping mislabeled pre-handler 403s (CSRF, approval-gate)
        // as draft-finalize failures and conflated them in the wizard_error
        // funnel. Anything without a known code (a 409 stale-state, a 500, a
        // pre-handler error) -> UNKNOWN, whose copy is recoverable so the retry
        // affordance the old mapping provided is preserved.
        const KNOWN_FINALIZE_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(
          [
            "KEY_SCOPE_BROADENED",
            "KEY_NETWORK_TIMEOUT",
            "GATE_DRAFT_GONE",
            "GUARD_BLOCKED",
          ],
        );
        const surfaced: WizardErrorCode =
          data.code && KNOWN_FINALIZE_CODES.has(data.code as WizardErrorCode)
            ? (data.code as WizardErrorCode)
            : "UNKNOWN";
        setErrorCode(surfaced);
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "submit",
          code: surfaced,
        });
        setSubmitting(false);
        return;
      }

      // CT-5 (army2) — even on a 200 OK, the upstream may emit
      // `code: 'WIZARD_DUPLICATE'` + `idempotent: true` to signal that
      // the strategy_verifications row pre-existed (BACKBONE-08
      // wizard_session_id idempotency). Surface the WIZARD_DUPLICATE
      // copy from wizardErrors.ts so the user sees the resume
      // affordance instead of a silent re-submit.
      if (data.code === "WIZARD_DUPLICATE") {
        setErrorCode("WIZARD_DUPLICATE");
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "submit",
          code: "WIZARD_DUPLICATE",
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

  const errorEnvelope = errorCode
    ? buildEnvelope(errorCode, correlationId)
    : null;

  const summaryMetrics: FactsheetPreviewMetric[] = snapshot.metrics;

  return (
    <section aria-labelledby="wizard-submit-heading">
      <h2
        id="wizard-submit-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        Review and submit
      </h2>
      <p className="mt-2 text-body text-text-secondary">
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

      {errorEnvelope && (
        <div className="mt-4">
          <WizardErrorEnvelope
            envelope={errorEnvelope}
            onRetry={() => setErrorCode(null)}
          />
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
      <dt className="text-micro font-medium uppercase tracking-wider text-text-muted">
        {label}
      </dt>
      <dd className="text-caption text-text-secondary">{value}</dd>
    </div>
  );
}
