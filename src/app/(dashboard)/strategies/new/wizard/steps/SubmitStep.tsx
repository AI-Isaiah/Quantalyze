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
import {
  getWizardCorrelationId,
  wizardFetch,
} from "@/lib/wizard/wizard-correlation";

/**
 * Step 4 of the wizard. Renders a read-only summary of the draft and
 * fires POST /api/strategies/finalize-wizard on confirmation. The
 * server-side RPC `finalize_wizard_strategy` (migration 031) updates
 * the row to status='pending_review' in one transaction and notifies
 * the founder via `after()`.
 *
 * Success redirect is handled by WizardClient's `handleSubmitSuccess`.
 */

/**
 * Which wizard error codes `finalize-wizard` may surface, as an EXHAUSTIVE map
 * over `WizardErrorCode` rather than a hand-maintained Set.
 *
 * WHY A TOTAL RECORD (Phase 140 review / WR-01, type-design). The old Set was a
 * closed list of five strings, and anything else — including a code a seam
 * route had just started emitting — collapsed to `UNKNOWN`, i.e. "Something
 * went wrong… our team has been notified": untrue and un-actionable during an
 * infrastructure outage, and the exact DOGFOOD-3 failure `wizardErrors.ts` says
 * the newer codes exist to kill. A Set cannot tell you it is missing an entry.
 * This `Record` can: adding a member to `WizardErrorCode` without deciding here
 * whether finalize can emit it is a COMPILE ERROR, so the next code cannot
 * silently inherit the dead end.
 *
 * `false` means "finalize never emits this" (it belongs to the connect step,
 * the CSV branch, the metadata step, …), NOT "suppress it".
 */
const FINALIZE_MAY_EMIT: Record<WizardErrorCode, boolean> = {
  // ── Emitted by POST /api/strategies/finalize-wizard ──────────────────────
  // H-0192: 404 draft-gone, 403 RLS/ownership, and the live key-scope /
  // network-probe arms.
  KEY_SCOPE_BROADENED: true,
  KEY_NETWORK_TIMEOUT: true,
  GATE_DRAFT_GONE: true,
  GUARD_BLOCKED: true,
  // Phase 88 / W-4 — composite membership probe fail-closed (503). Recoverable
  // copy renders the Retry affordance rather than the generic UNKNOWN envelope.
  COMPOSITE_MEMBERSHIP_UNKNOWN: true,
  // CR-01 — the composite is larger than the finalize route's probe cap, so it
  // refused BEFORE spending any of the fan-out. "Remove some keys" is
  // actionable; UNKNOWN's "our team has been notified" is not.
  COMPOSITE_TOO_MANY_MEMBERS: true,
  // WR-01 — the breaker tripped (or the seam transport failed) during submit.
  // THE code this phase exists to surface; it reached the wizard as the
  // non-union string "CIRCUIT_OPEN" and rendered UNKNOWN.
  SERVICE_UNAVAILABLE_RETRY: true,

  // ── Not emitted by finalize ──────────────────────────────────────────────
  KEY_HAS_TRADING_PERMS: false,
  KEY_HAS_WITHDRAW_PERMS: false,
  KEY_NOT_READ_ONLY: false,
  KEY_PROBE_FAILED: false,
  KEY_INVALID_SIGNATURE: false,
  KEY_AUTH_FAILED: false,
  KEY_MT5_MASTER_PASSWORD: false,
  KEY_MT5_WRONG_SERVER: false,
  KEY_INVALID_FORMAT: false,
  KEY_IP_ALLOWLIST: false,
  KEY_RATE_LIMIT: false,
  DRAFT_ALREADY_EXISTS: false,
  SYNC_TIMEOUT: false,
  SYNC_FAILED: false,
  GATE_INSUFFICIENT_TRADES: false,
  GATE_INSUFFICIENT_DAYS: false,
  GATE_ANALYTICS_FAILED: false,
  GATE_NO_DATA_SOURCE: false,
  METADATA_DESCRIPTION_REQUIRED: false,
  SESSION_EXPIRED: false,
  SUBMIT_NOTIFY_FAILED: false,
  CSV_PARSE_FAILED: false,
  CSV_SCHEMA_VIOLATION: false,
  CSV_FILE_TOO_LARGE: false,
  CSV_INVALID_EXTENSION: false,
  CSV_NON_MONOTONIC_DATES: false,
  CSV_NAV_ZERO: false,
  CSV_RETURN_OUT_OF_RANGE: false,
  CSV_SHARPE_SUSPICIOUS: false,
  CSV_CURRENCY_INVALID: false,
  CSV_QTY_PRICE_INVALID: false,
  CSV_STRATEGY_NAME_REQUIRED: false,
  CSV_STRATEGY_NAME_TOO_LONG: false,
  CSV_VALIDATION_FAILED: false,
  CSV_UPSTREAM_FAIL: false,
  CSV_NETWORK_TIMEOUT: false,
  CSV_SUBMIT_FAILED: false,
  CSV_SUBMIT_NO_STRATEGY_ID: false,
  // Handled by its own 200-OK branch below, not by the !res.ok mapping.
  WIZARD_DUPLICATE: false,
  MULTI_KEY_WINDOWS_INVALID: false,
  WIZARD_KEYS_LOAD_FAILED: false,
  // The fallback itself — mapping it here would be circular.
  UNKNOWN: false,
};

/**
 * Legacy wire codes that predate the `WizardErrorCode` vocabulary, mapped to
 * their union equivalent.
 *
 * `process-key-client` owns ONE shared 503 envelope for five routes (keys/sync,
 * the public teaser, finalize-wizard's enqueue arm, csv-validate, csv-finalize)
 * and publishes `code: "CIRCUIT_OPEN"` alongside `human_message`. That envelope
 * is a stable contract for callers that are not the wizard, so it is aliased
 * here rather than renamed across five routes — but the WIZARD must not show
 * the "our team has been notified" dead end for a breaker trip on ANY finalize
 * path, including the enqueue arm that is reachable when the circuit opens
 * between the probe and the enqueue.
 */
const LEGACY_WIRE_CODE_ALIASES: Readonly<Record<string, WizardErrorCode>> = {
  CIRCUIT_OPEN: "SERVICE_UNAVAILABLE_RETRY",
};

/**
 * Map a server-supplied `code` onto the wizard vocabulary.
 *
 * Trust the code only if finalize can genuinely emit it, so a garbled or
 * mislabelled response cannot poison the envelope copy — and map off the CODE,
 * never the raw HTTP status: status-based mapping used to label pre-handler
 * 403s (CSRF, the approval gate) as draft-finalize failures and conflated them
 * in the `wizard_error` funnel.
 */
function surfacedFinalizeCode(code: string | undefined): WizardErrorCode {
  if (!code) return "UNKNOWN";
  const aliased = LEGACY_WIRE_CODE_ALIASES[code] ?? code;
  return FINALIZE_MAY_EMIT[aliased as WizardErrorCode]
    ? (aliased as WizardErrorCode)
    : "UNKNOWN";
}

export interface SubmitStepProps {
  strategyId: string;
  wizardSessionId: string;
  snapshot: SyncPreviewSnapshot;
  metadata: MetadataDraft;
  /**
   * Phase 110 / CONTRIB-01..02 — mount surface. `"manager"` (default) keeps
   * the sell-side "Submit for review" flow and finalize `entry_context:
   * "manager"` (→ status `pending_review`). `"contribution"` shows the
   * allocator-framed private-add copy and sends `entry_context: "contribution"`
   * (→ status `private`, owner-only, never published — plan 110-04 server side).
   */
  entryContext?: "manager" | "contribution";
  onSubmitted: (strategyId: string) => void;
  onBack: () => void;
}

export function SubmitStep({
  strategyId,
  wizardSessionId,
  snapshot,
  metadata,
  entryContext = "manager",
  onSubmitted,
  onBack,
}: SubmitStepProps) {
  const isContribution = entryContext === "contribution";
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<WizardErrorCode | null>(null);
  // UX-02: the wizard session correlation id — the SAME id wizardFetch sends on
  // the finalize-wizard request, so a copied envelope id matches server logs.
  const [correlationId] = useState<string>(() => getWizardCorrelationId());

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setErrorCode(null);
    setSubmitting(true);

    try {
      const res = await wizardFetch("/api/strategies/finalize-wizard", {
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
          // Phase 110 / CONTRIB-02 — routing hint the finalize RPC branches on:
          // "contribution" finalizes status='private' (owner-only), "manager"
          // finalizes status='pending_review'. This is a HINT only — neither
          // value can publish; the RPC terminal-status guard (plan 110-01
          // T-110-02) is the real enforcement (client field can't be trusted).
          entry_context: entryContext,
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
        // H-0192: the server tags each actionable failure with its own stable
        // code (404 draft-gone -> GATE_DRAFT_GONE, 403 RLS/ownership ->
        // GUARD_BLOCKED, the live key-scope / probe arms -> KEY_SCOPE_BROADENED
        // / KEY_NETWORK_TIMEOUT). Anything unrecognised -> UNKNOWN, whose copy
        // is still recoverable so a Retry affordance renders. See
        // FINALIZE_MAY_EMIT for why that mapping is now exhaustive by type.
        const surfaced = surfacedFinalizeCode(data.code);
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
  }, [submitting, strategyId, metadata, onSubmitted, wizardSessionId, entryContext]);

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
        {isContribution ? "Review and add" : "Review and submit"}
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        {isContribution
          ? "This strategy is added privately to your account. Only you can see it — it is never published or submitted for review."
          : "The founder reviews pending strategies within 48 hours. You will receive an email when your listing is approved."}
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
          {submitting
            ? "Submitting..."
            : isContribution
              ? "Add to my strategies"
              : "Submit for review"}
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
