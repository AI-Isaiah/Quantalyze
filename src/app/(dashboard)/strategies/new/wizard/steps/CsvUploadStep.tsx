"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import {
  CSV_UPLOAD_STEP_HEADINGS,
  WIZARD_ERROR_COPY,
  formatKeyError,
} from "@/lib/wizardErrors";
import { CsvValidationEnvelope } from "./CsvValidationEnvelope";

/**
 * Phase 15 / CSV-01..CSV-02 — sub-step 1 of the CSV branch.
 *
 * Layout (UI-SPEC §6 row 2 + §7.1):
 *   1. Strategy-name <input> (REQUIRED, 1–80 chars; cross-AI revision 2026-04-30)
 *   2. Segmented format picker (daily_returns / daily_nav / trades; default daily_returns)
 *   3. Drag-drop zone + hidden file picker (10 MB client cap; .csv only)
 *   4. Validation envelope (renders below the form on failure)
 *   5. Submit CTA: 'Validate and continue'
 *
 * On success, hoists strategyName up via onSuccess so it survives back
 * navigation and reaches CsvSubmitStep, which forwards it to the
 * /api/strategies/csv-finalize body as `strategy_name`.
 *
 * The /api/strategies/csv-validate route ships in plan 15-05.
 */

type Fmt = "daily_returns" | "daily_nav" | "trades";

interface FormatOption {
  id: Fmt;
  label: string;
  caption: string;
  testId: string;
}

// Format-picker labels are component-local UI taxonomy (segmented control
// captions), not error/heading copy — they stay inline. wizardErrors.ts
// owns user-visible CSV error / heading strings only.
const FORMATS: FormatOption[] = [
  {
    id: "daily_returns",
    label: "Daily returns",
    caption: "One row per trading day. Columns: date, daily_return.",
    testId: "wizard-csv-fmt-daily_returns",
  },
  {
    id: "daily_nav",
    label: "Daily NAV",
    caption: "One row per trading day. Columns: date, nav.",
    testId: "wizard-csv-fmt-daily_nav",
  },
  {
    id: "trades",
    label: "Trade list",
    caption: "One row per fill. Columns: date, side, qty, price, symbol, currency.",
    testId: "wizard-csv-fmt-trades",
  },
];

const MAX_NAME_CHARS = 80;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

interface ValidateResponse {
  ok?: boolean;
  preview?: PreviewShape | null;
  /**
   * Phase 19.1 — analytics-service (`csv_validator.py`) emits the parsed
   * daily-return rows alongside `preview` for `fmt=daily_returns` and
   * `fmt=daily_nav`. The csv-finalize route REQUIRES this series in its
   * POST body for those formats (route.ts:748 — "daily_returns_series is
   * required for fmt=daily_returns and fmt=daily_nav"). Trades is
   * omitted; absent for trades is normal.
   */
  daily_returns_series?: { date: string; daily_return: number }[];
  errors?: { rule: string; row: number; message: string }[];
  correlation_id?: string | null;
  code?: string;
  human_message?: string;
  debug_context?: { pandera_errors?: { rule: string; row: number; message: string }[] };
}

export interface CsvUploadStepProps {
  wizardSessionId: string;
  /** Phase 15 — preserved across back-navigation by WizardClient. */
  initialStrategyName?: string;
  /** Hoists user-typed name up to WizardClient so it survives back/forward. */
  onSuccess: (payload: {
    fmt: Fmt;
    preview: PreviewShape;
    /**
     * Phase 19.1 — daily-return rows parsed by csv_validator. Required
     * for `fmt=daily_returns`/`daily_nav` so CsvSubmitStep can include
     * them in the csv-finalize POST body. Undefined for `fmt=trades` and
     * for legacy validate responses that pre-date 19.1.
     */
    dailyReturnsSeries?: { date: string; daily_return: number }[];
    validationPassed: boolean;
    strategyName: string;
  }) => void;
}

export function CsvUploadStep({
  wizardSessionId,
  initialStrategyName = "",
  onSuccess,
}: CsvUploadStepProps) {
  const [strategyName, setStrategyName] = useState<string>(initialStrategyName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [fmt, setFmt] = useState<Fmt>("daily_returns");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [envelope, setEnvelope] = useState<ValidationEnvelope | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync local input state when the parent's strategyName arrives after
  // mount. WizardClient runs its post-mount LS-hydration effect AFTER
  // CsvUploadStep has already initialized `strategyName` from the
  // (initially empty) prop, so without this sync the user types into a
  // field that should have shown their resumed name.
  //
  // Clobber-guard: only sync when local state is still the empty default
  // (`strategyName === ""`). React commits child effects before parent
  // effects, so on slow paint the user could in theory type before the
  // hydration prop update lands; the empty-string guard preserves any
  // already-typed value. The CsvUploadStep.test.tsx suite pins both the
  // resumed-name backfill and the clobber-guard explicitly.
  useEffect(() => {
    if (initialStrategyName && strategyName === "") {
      setStrategyName(initialStrategyName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStrategyName]);

  const handleNameChange = useCallback((value: string) => {
    setStrategyName(value);
    if (nameError) setNameError(null);
  }, [nameError]);

  const handleSelectFmt = useCallback((next: Fmt) => {
    setFmt(next);
    setEnvelope(null);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;

      // Defense-in-depth: 10 MB cap fires on selection (NOT on submit).
      // Server (Next route + analytics service) re-checks.
      if (f.size > MAX_FILE_BYTES) {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        setEnvelope({
          code: "CSV_FILE_TOO_LARGE",
          human_message: formatKeyError("CSV_FILE_TOO_LARGE", { sizeMb }).title,
          debug_context: {},
          correlation_id: null,
        });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      if (!f.name.toLowerCase().endsWith(".csv")) {
        setEnvelope({
          code: "CSV_INVALID_EXTENSION",
          human_message: WIZARD_ERROR_COPY.CSV_INVALID_EXTENSION.title,
          debug_context: {},
          correlation_id: null,
        });
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      setFile(f);
      setEnvelope(null);
    },
    [],
  );

  const handleClearFile = useCallback(() => {
    setFile(null);
    setEnvelope(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleDropZoneKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const input = fileInputRef.current;
    if (!input) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    // Validate strategy name BEFORE any network work.
    const trimmedName = strategyName.trim();
    if (trimmedName.length === 0) {
      setNameError(WIZARD_ERROR_COPY.CSV_STRATEGY_NAME_REQUIRED.title);
      return;
    }
    if (strategyName.length > MAX_NAME_CHARS) {
      setNameError(WIZARD_ERROR_COPY.CSV_STRATEGY_NAME_TOO_LONG.title);
      return;
    }
    if (!file) return;

    setSubmitting(true);
    setEnvelope(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fmt", fmt);
      formData.append("wizard_session_id", wizardSessionId);
      // NOTE: strategy_name is NOT sent here — finalize-time only.

      const res = await fetch("/api/strategies/csv-validate", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json().catch(() => ({}))) as ValidateResponse;

      if (!res.ok || data.ok === false) {
        const errEnvelope: ValidationEnvelope = {
          code: data.code ?? "CSV_VALIDATION_FAILED",
          human_message:
            data.human_message ?? WIZARD_ERROR_COPY.CSV_VALIDATION_FAILED.title,
          debug_context: data.debug_context ?? {
            pandera_errors: data.errors ?? [],
          },
          correlation_id: data.correlation_id ?? null,
        };
        setEnvelope(errEnvelope);
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "csv_upload",
          code: errEnvelope.code,
        });
        setSubmitting(false);
        return;
      }

      if (!data.preview) {
        // Defensive: route returned ok but no preview — treat as upstream fail.
        const errEnvelope: ValidationEnvelope = {
          code: "CSV_UPSTREAM_FAIL",
          human_message: WIZARD_ERROR_COPY.CSV_UPSTREAM_FAIL.title,
          debug_context: {},
          correlation_id: data.correlation_id ?? null,
        };
        setEnvelope(errEnvelope);
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "csv_upload",
          code: errEnvelope.code,
        });
        setSubmitting(false);
        return;
      }

      onSuccess({
        fmt,
        preview: data.preview,
        dailyReturnsSeries: data.daily_returns_series,
        validationPassed: true,
        strategyName: trimmedName,
      });
    } catch (err) {
      console.error("[wizard:CsvUploadStep] submit threw:", err);
      const errEnvelope: ValidationEnvelope = {
        code: "CSV_NETWORK_TIMEOUT",
        human_message: WIZARD_ERROR_COPY.CSV_NETWORK_TIMEOUT.title,
        debug_context: {},
        correlation_id: null,
      };
      setEnvelope(errEnvelope);
      trackForQuantsEventClient("wizard_error", {
        wizard_session_id: wizardSessionId,
        step: "csv_upload",
        code: "CSV_NETWORK_TIMEOUT",
      });
      setSubmitting(false);
    }
  }

  const trimmedName = strategyName.trim();
  const submitDisabled =
    submitting ||
    !file ||
    trimmedName.length === 0 ||
    strategyName.length > MAX_NAME_CHARS;

  const fileSizeMb = file ? (file.size / (1024 * 1024)).toFixed(1) : null;

  return (
    <section aria-labelledby="wizard-csv-upload-heading">
      <h2
        id="wizard-csv-upload-heading"
        className="font-sans text-2xl font-semibold text-text-primary"
      >
        {CSV_UPLOAD_STEP_HEADINGS.title}
      </h2>
      <p className="mt-2 text-sm text-text-secondary">
        {CSV_UPLOAD_STEP_HEADINGS.subtitle}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {/* Row 1 — Strategy-name input (cross-AI revision 2026-04-30). */}
        <div>
          <div className="flex items-center justify-between">
            <label
              htmlFor="strategy-name"
              className="text-xs font-medium text-text-primary"
            >
              Strategy name
            </label>
            <span
              className="text-[11px] font-metric tabular-nums text-text-muted"
              aria-live="polite"
            >
              {strategyName.length} / {MAX_NAME_CHARS}
            </span>
          </div>
          <input
            id="strategy-name"
            type="text"
            required
            maxLength={MAX_NAME_CHARS}
            value={strategyName}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Aurora Capital — BTC vol carry"
            aria-label="Strategy name"
            aria-required="true"
            aria-invalid={nameError !== null}
            data-testid="csv-strategy-name"
            className="mt-2 block w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20"
          />
          {nameError ? (
            <p
              className="mt-1 text-xs text-negative"
              data-testid="csv-strategy-name-error"
            >
              {nameError}
            </p>
          ) : (
            <p className="mt-1 text-xs text-text-muted">
              {CSV_UPLOAD_STEP_HEADINGS.nameHelper}
            </p>
          )}
        </div>

        {/* Row 2 — Format selector (segmented control). */}
        <fieldset>
          <legend className="text-xs font-medium text-text-primary">Format</legend>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {FORMATS.map((f) => {
              const active = f.id === fmt;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleSelectFmt(f.id)}
                  className={`rounded-md border px-4 py-3 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent/5"
                      : "border-border bg-white hover:border-accent/50"
                  }`}
                  aria-pressed={active}
                  data-testid={f.testId}
                >
                  <p className="text-sm font-semibold text-text-primary">
                    {f.label}
                  </p>
                  <p className="mt-1 text-[11px] text-text-muted">{f.caption}</p>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Row 3 — Drag-drop zone + hidden file input. */}
        <div>
          <div
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-accent/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            aria-label="Upload CSV file. Drop a file or press Enter to browse."
            onKeyDown={handleDropZoneKey}
            data-testid="wizard-csv-dropzone"
          >
            {file ? (
              <>
                <p className="text-sm text-text-primary font-medium">
                  {CSV_UPLOAD_STEP_HEADINGS.fileLabel(
                    file.name,
                    fileSizeMb ?? "0",
                  )}
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  Drop a different file to replace, or use the button below.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-text-muted mb-1">
                  {CSV_UPLOAD_STEP_HEADINGS.dropzoneIdle}
                </p>
                <p className="text-xs text-text-muted">
                  Required columns shown above. Max 10 MB.
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="wizard-csv-file-input"
            />
          </div>
          {file && (
            <button
              type="button"
              onClick={handleClearFile}
              className="mt-2 text-[11px] text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
            >
              Choose a different file
            </button>
          )}
        </div>

        {/* Validation envelope — renders below the form on failure. */}
        {envelope && (
          <CsvValidationEnvelope
            envelope={{
              code: envelope.code,
              human_message: envelope.human_message,
              debug_context: envelope.debug_context,
              correlation_id: envelope.correlation_id,
            }}
          />
        )}

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={submitDisabled}
            data-testid="wizard-csv-validate-submit"
          >
            {submitting ? "Validating…" : "Validate and continue"}
          </Button>
        </div>
      </form>
    </section>
  );
}
