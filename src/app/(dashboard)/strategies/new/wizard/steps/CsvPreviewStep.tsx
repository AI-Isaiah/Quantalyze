"use client";

import { Button } from "@/components/ui/Button";
import { CSV_PREVIEW_STEP_HEADINGS } from "@/lib/wizardErrors";

/**
 * Phase 15 / CSV-01..CSV-02 — sub-step 2 of the CSV branch.
 *
 * Read-only preview of the parsed CSV. Renders a 5-row metadata <dl>
 * (Strategy name + Format + Rows detected + Date range + Columns
 * detected) above a 6-row preview table (first 3 + last 3 rows from the
 * server's parse).
 *
 * Cross-AI revision 2026-04-30: 5 metadata rows total — the new
 * 'Strategy name' row is FIRST. The user-typed value is truncated to
 * 60 chars + ellipsis for display only; the full value lives in
 * WizardClient state and is forwarded to /api/strategies/csv-finalize
 * by CsvSubmitStep.
 */

type Fmt = "daily_returns" | "daily_nav" | "trades";

interface PreviewShape {
  row_count: number;
  date_range: [string, string];
  columns_detected: string[];
  first_rows: Record<string, unknown>[];
  last_rows: Record<string, unknown>[];
}

export interface CsvPreviewStepProps {
  preview: PreviewShape;
  fmt: Fmt;
  /** displayed in summary; not editable */
  strategyName: string;
  validationPassed: boolean;
  onBack: () => void;
  onContinue: () => void;
}

// Format-picker labels are component-local UI taxonomy (read-only summary
// row), not error/heading copy — they stay inline. wizardErrors.ts owns
// user-visible CSV error / heading strings only.
const FMT_LABEL: Record<Fmt, string> = {
  daily_returns: "Daily returns",
  daily_nav: "Daily NAV",
  trades: "Trade list",
};

const NAME_TRUNCATE = 60;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

/**
 * QA report 2026-05-21 ISSUE-014: the `date_range` pill rendered the
 * validator's ISO-normalized dates (`2025-04-03 → 2026-05-06`) while
 * the sample-rows table rendered the raw cell string (`4/3/2025`).
 * Picking ISO across the whole step — allocators are global, ISO is
 * unambiguous, the pill is already ISO. Explicit-format-detection
 * keeps the helper timezone-stable for date-only strings: a generic
 * `new Date(raw).toISOString()` shifts U.S. dates back a day in
 * non-UTC locales. Returns the original string when the format is
 * unrecognized rather than silently coercing.
 */
export function formatPreviewCell(value: unknown, columnName: string): string {
  const raw = String(value ?? "");
  if (columnName !== "date" || !raw) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return raw;
}

export function CsvPreviewStep({
  preview,
  fmt,
  strategyName,
  validationPassed,
  onBack,
  onContinue,
}: CsvPreviewStepProps) {
  const displayName = truncate(strategyName, NAME_TRUNCATE);
  const previewRows = [...preview.first_rows, ...preview.last_rows];
  const firstCount = preview.first_rows.length;
  const lastCount = preview.last_rows.length;

  return (
    <section aria-labelledby="wizard-csv-preview-heading">
      <h2
        id="wizard-csv-preview-heading"
        className="font-sans text-2xl font-semibold text-text-primary"
      >
        {CSV_PREVIEW_STEP_HEADINGS.title}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        {CSV_PREVIEW_STEP_HEADINGS.subtitle}
      </p>

      {/* 5-row metadata <dl> — Strategy name FIRST (cross-AI revision 2026-04-30). */}
      <div className="mt-6 rounded-md border border-border bg-white">
        <dl className="divide-y divide-border">
          <SummaryRow label="Strategy name" value={displayName} />
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

      {/* 6-row preview table — first 3 + last 3 rows. */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {preview.columns_detected.map((h, i) => (
                <th
                  key={i}
                  className="px-2 py-1.5 text-left font-medium text-text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={i} className="border-b border-border/50">
                {preview.columns_detected.map((c, j) => (
                  <td
                    key={j}
                    className="px-2 py-1.5 text-text-secondary font-metric tabular-nums"
                  >
                    {formatPreviewCell(
                      (row as Record<string, unknown>)[c],
                      c,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {/* Per-render row-count helper — not enumerated in UI-SPEC §14.1; */}
        {/* component-local dynamic template stays inline. */}
        Showing {firstCount} of {preview.row_count} rows from the start, and{" "}
        {lastCount} from the end.
      </p>

      <div className="mt-6 flex gap-3">
        <Button
          variant="secondary"
          type="button"
          onClick={onBack}
          data-testid="wizard-csv-preview-back"
        >
          Back
        </Button>
        <Button
          onClick={onContinue}
          disabled={!validationPassed}
          data-testid="wizard-csv-preview-continue"
        >
          {CSV_PREVIEW_STEP_HEADINGS.continueLabel}
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
