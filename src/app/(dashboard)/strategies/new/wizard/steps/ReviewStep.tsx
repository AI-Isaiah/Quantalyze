"use client";

import { Button } from "@/components/ui/Button";
import type { WizardStepKey } from "@/lib/wizard/localStorage";
import type { MetadataDraft } from "./MetadataStep";

/**
 * ReviewStep — the read-only Review & confirm recap (APPLY-02, Phase 53).
 *
 * A purely-presentational recap of values the user ALREADY entered, shown
 * immediately before finalize on BOTH branches (API + CSV). It collects no
 * new data, re-fetches nothing, and fabricates nothing — every value is
 * threaded in from existing `WizardClient` state. Absent values render an
 * em-dash placeholder ONLY for genuinely-optional API fields; required
 * fields always carry a value by the time the user reaches this step
 * (no-invented-data LOCKED — no fabricated number/count-up/demo value).
 *
 * It renders NO `role="alert"`: it is not an error surface. Validation that
 * would block finalize still surfaces through the existing inline + envelope
 * path on the owning step. Each recap section offers an "Edit" affordance
 * that returns the user to the owning step via the existing `setStep` seam
 * (autosave already persists the entered data, so nothing is lost).
 *
 * The CTA carries an ADVANCE verb — "Continue to create" (API) / "Continue to
 * submit" (CSV) — NOT a finalize verb, because this step does not finalize: it
 * only advances the state machine to SubmitStep / CsvSubmitStep, which present
 * the actual finalize CTA ("Create strategy" / "Submit strategy") and fire the
 * unchanged finalize POST. Keeping the finalize verb unique to the step that
 * finalizes (WR-01) avoids the misleading "button-that-says-create-but-doesn't"
 * seam between review and submit.
 */

/** CSV recap shape — the REAL parsed numbers from `csvPreview`. */
export interface ReviewCsvSummary {
  fmt: "daily_returns" | "daily_nav" | "trades";
  rowCount: number;
  dateRange: [string, string];
  columnsDetected: string[];
}

interface ReviewStepCommonProps {
  /** Advance to the owning Submit step (review "Continue"). */
  onContinue: () => void;
  /** Return to the previous step ("Back"). */
  onBack: () => void;
  /** Jump to a specific owning step for a per-section "Edit". */
  onEdit: (step: WizardStepKey) => void;
}

interface ReviewStepApiProps extends ReviewStepCommonProps {
  branch: "api";
  /** API recap — strategy name (codename) from MetadataStep. */
  strategyName: string;
  metadata: MetadataDraft;
}

interface ReviewStepCsvProps extends ReviewStepCommonProps {
  branch: "csv";
  /** CSV recap — user-typed strategy name. */
  strategyName: string;
  csv: ReviewCsvSummary;
  metadata: MetadataDraft;
}

export type ReviewStepProps = ReviewStepApiProps | ReviewStepCsvProps;

const FMT_LABEL: Record<ReviewCsvSummary["fmt"], string> = {
  daily_returns: "Daily returns",
  daily_nav: "Daily NAV",
  trades: "Trade list",
};

/** Em-dash sentinel for a genuinely-absent OPTIONAL field. Never a zero. */
const ABSENT = "—";

export function ReviewStep(props: ReviewStepProps) {
  // WR-01 — advance verb, NOT a finalize verb: this CTA only advances to the
  // owning Submit step (which carries the real "Create strategy"/"Submit
  // strategy" finalize CTA). The finalize verb stays unique to the step that
  // actually finalizes.
  const advanceLabel =
    props.branch === "csv" ? "Continue to submit" : "Continue to create";

  return (
    <section aria-labelledby="wizard-review-heading">
      <h2
        id="wizard-review-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        Review &amp; confirm
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        Check the details below before creating your strategy. Use Edit to
        change any section.
      </p>

      <div className="mt-8">
        {props.branch === "api" ? (
          <ApiRecap
            strategyName={props.strategyName}
            metadata={props.metadata}
            onEdit={props.onEdit}
          />
        ) : (
          <CsvRecap
            strategyName={props.strategyName}
            csv={props.csv}
            metadata={props.metadata}
            onEdit={props.onEdit}
          />
        )}
      </div>

      <div className="mt-8 flex gap-3">
        <Button
          variant="secondary"
          type="button"
          onClick={props.onBack}
          data-testid="wizard-review-back"
        >
          Back
        </Button>
        <Button
          type="button"
          onClick={props.onContinue}
          data-testid="wizard-review-continue"
        >
          {advanceLabel}
        </Button>
      </div>
    </section>
  );
}

function ApiRecap({
  strategyName,
  metadata,
  onEdit,
}: {
  strategyName: string;
  metadata: MetadataDraft;
  onEdit: (step: WizardStepKey) => void;
}) {
  return (
    <RecapSection
      title="Strategy profile"
      onEdit={() => onEdit("metadata")}
      editTestId="wizard-review-edit-metadata"
    >
      <RecapRow label="Codename" value={strategyName || metadata.name || ABSENT} />
      <RecapRow label="Description" value={metadata.description || ABSENT} />
      <RecapRow
        label="Strategy types"
        value={metadata.strategyTypes.join(", ") || ABSENT}
      />
      <RecapRow label="Subtypes" value={metadata.subtypes.join(", ") || ABSENT} />
      <RecapRow label="Markets" value={metadata.markets.join(", ") || ABSENT} />
      <RecapRow
        label="Supported exchanges"
        value={metadata.supportedExchanges.join(", ") || ABSENT}
      />
      <RecapRow label="Leverage range" value={metadata.leverageRange || ABSENT} />
      <RecapRow
        label="AUM (USD)"
        value={metadata.aum ? `$${Number(metadata.aum).toLocaleString()}` : ABSENT}
        numeric
      />
      <RecapRow
        label="Max capacity (USD)"
        value={
          metadata.maxCapacity
            ? `$${Number(metadata.maxCapacity).toLocaleString()}`
            : ABSENT
        }
        numeric
      />
    </RecapSection>
  );
}

function CsvRecap({
  strategyName,
  csv,
  metadata,
  onEdit,
}: {
  strategyName: string;
  csv: ReviewCsvSummary;
  metadata: MetadataDraft;
  onEdit: (step: WizardStepKey) => void;
}) {
  return (
    <>
      <RecapSection
        title="Track record"
        onEdit={() => onEdit("csv_upload")}
        editTestId="wizard-review-edit-csv"
      >
        <RecapRow label="Strategy name" value={strategyName || ABSENT} />
        <RecapRow label="Format" value={FMT_LABEL[csv.fmt]} />
        <RecapRow label="Rows detected" value={`${csv.rowCount}`} numeric />
        <RecapRow
          label="Date range"
          value={`${csv.dateRange[0]} → ${csv.dateRange[1]}`}
          numeric
        />
        <RecapRow
          label="Columns detected"
          value={csv.columnsDetected.join(", ") || ABSENT}
        />
      </RecapSection>

      <RecapSection
        title="Strategy profile"
        onEdit={() => onEdit("csv_metadata")}
        editTestId="wizard-review-edit-csv-metadata"
      >
        <RecapRow label="Description" value={metadata.description || ABSENT} />
        <RecapRow
          label="Strategy types"
          value={metadata.strategyTypes.join(", ") || ABSENT}
        />
        <RecapRow
          label="Subtypes"
          value={metadata.subtypes.join(", ") || ABSENT}
        />
        <RecapRow label="Markets" value={metadata.markets.join(", ") || ABSENT} />
        <RecapRow
          label="Supported exchanges"
          value={metadata.supportedExchanges.join(", ") || ABSENT}
        />
        <RecapRow label="Leverage range" value={metadata.leverageRange || ABSENT} />
        <RecapRow
          label="AUM (USD)"
          value={
            metadata.aum ? `$${Number(metadata.aum).toLocaleString()}` : ABSENT
          }
          numeric
        />
        <RecapRow
          label="Max capacity (USD)"
          value={
            metadata.maxCapacity
              ? `$${Number(metadata.maxCapacity).toLocaleString()}`
              : ABSENT
          }
          numeric
        />
      </RecapSection>
    </>
  );
}

/**
 * One recap section: a hairline-divider editorial block (no card-on-card)
 * with a section title + an "Edit" affordance returning to the owning step.
 */
function RecapSection({
  title,
  onEdit,
  editTestId,
  children,
}: {
  title: string;
  onEdit: () => void;
  editTestId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-border pt-4 first:border-t-0 first:pt-0 [&:not(:first-child)]:mt-8">
      <div className="flex items-baseline justify-between">
        <h3 className="text-h3 font-semibold text-text-primary">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-caption font-medium text-accent underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
          data-testid={editTestId}
        >
          Edit
        </button>
      </div>
      <dl className="mt-3 divide-y divide-border">{children}</dl>
    </div>
  );
}

function RecapRow({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div className="grid gap-1 py-2 md:grid-cols-[200px_1fr] md:gap-6">
      <dt className="text-caption uppercase tracking-wider text-text-muted">
        {label}
      </dt>
      <dd
        className={
          numeric
            ? "text-body font-metric tabular-nums text-text-primary"
            : "text-body text-text-primary"
        }
      >
        {value}
      </dd>
    </div>
  );
}
