"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { MAGNITUDE_CAPS } from "@/lib/closed-sets";
import {
  CSV_UPLOAD_STEP_HEADINGS,
  WIZARD_ERROR_COPY,
  formatKeyError,
  recogniseSeamErrorCode,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { CsvValidationEnvelope } from "./CsvValidationEnvelope";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { buildEnvelope, type ErrorEnvelope } from "@/lib/envelope";
import { seamCorrelationId, seamErrorCode } from "@/lib/seam-discriminator";
import { parseRetryAfterSeconds } from "@/lib/retry/retry-after";
import { scrubSeamError } from "@/lib/seam-redaction";
import {
  getWizardCorrelationId,
  wizardFetch,
} from "@/lib/wizard/wizard-correlation";

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

const MAX_NAME_CHARS = MAGNITUDE_CAPS.MAX_NAME_CHARS;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * 140.5-05 / SEAMPROSE-07 — every code `POST /api/strategies/csv-validate`
 * puts on the wire in its OWN vocabulary, i.e. the ones whose `human_message`
 * the route authored and therefore owns.
 *
 * ── COVERAGE-LAW ROW (CONTEXT §2), STATED ────────────────────────────────────
 * This set is a **hand-typed roster — coverage-law ROW 2, PARTIAL BY
 * CONSTRUCTION**, the same shape as `KNOWN_CREATE_WITH_KEY_CODES`,
 * `KNOWN_ADD_KEY_CODES`, `KNOWN_SET_MEMBERS_CODES`, `KNOWN_KICKOFF_CODES` and
 * `KNOWN_FINALIZE_CODES`. Row 1 in this file is the OTHER half of the arm — the
 * shared `SEAM_CODE_TO_WIZARD_CODE` hop and the shared `ErrorEnvelope`, which
 * gain new members without an edit here. The row-2 half is fail-louded rather
 * than trusted: `seam-wire-vocabulary.invariant.test.ts` DERIVES this route's
 * emitted code literals from its comment-stripped source and reddens by name
 * when one of them is missing from this set.
 *
 * ── WHY A SET AND NOT `!res.ok` ⇒ ONE SENTENCE (plan-checker B-1) ────────────
 * The §4a founder copy is for the UNRECOGNISED-OR-CODELESS upstream failure. It
 * is NOT for every non-2xx. This route answers its own caller faults with real
 * top-level codes and real sentences, and collapsing them onto §4a would tell a
 * user who uploaded an 11 MB file *"This is on our side, not your data"* —
 * the milestone's signature defect, produced by the fix for it.
 *
 * ── THE TWO MEMBERSHIP DECISIONS THAT ARE NOT MECHANICAL ─────────────────────
 *
 * `SEAM_MISCONFIGURED` IS IN — and the arm below tries this set BEFORE the wire
 * table precisely so that it wins here. The code is in BOTH vocabularies. Its
 * generic entry says *"Nothing was submitted"* and *"The request never left our
 * servers"*; both are FALSE at this route, because `req.formData()` buffers the
 * entire upload ~50 lines above the limiter deny that emits it. The route
 * authored a corrected sentence for exactly that reason (140.4-16 / WR-07) and
 * roster-first is the mechanism that keeps it on screen. A hop-first order
 * would regress WR-07 four days after it landed.
 *
 * `CSV_RATE_LIMIT` IS DELIBERATELY **OUT**, and the absence is the mechanism,
 * not an oversight. Excluded, it falls past this set and hops through
 * `["CSV_RATE_LIMIT","RATE_LIMITED"]` onto the shared envelope — the only CSV
 * panel that can render the `Retry-After` this route stamps
 * (`CsvValidationEnvelope` has no wait prop at all). `wizardErrors.test.ts`
 * pins its absence from `WIZARD_ERROR_COPY`; adding it here would keep the
 * route's local copy and silently drop the one wait the CSV surface advertises.
 *
 * ── THE ENUMERATION PREDICATE, so the membership is reproducible ─────────────
 * Comment-strip `src/app/api/strategies/csv-validate/route.ts`, then collect the
 * first string-literal argument of every `csvErrorEnvelope(` / `csvErrorBody(`
 * call plus every `code: "UPPER_SNAKE"` property. That yields FIVE codes:
 * `CSV_FILE_TOO_LARGE`, `CSV_INVALID_FORMAT`, `CSV_RATE_LIMIT`,
 * `CSV_UPSTREAM_FAIL`, `SEAM_MISCONFIGURED`. Minus the `CSV_RATE_LIMIT`
 * exclusion above, the four below. The guard re-derives this on every run.
 *
 * ⚠️ TYPED `string`, NOT `WizardErrorCode`. Three of the four are NOT members of
 * that union — they are the ROUTE's vocabulary, and `CsvValidationEnvelope`'s
 * `code: string` prop is what lets them render at all.
 */
const KNOWN_CSV_VALIDATE_CODES: ReadonlySet<string> = new Set<string>([
  "CSV_FILE_TOO_LARGE",
  "CSV_INVALID_FORMAT",
  "CSV_UPSTREAM_FAIL",
  "SEAM_MISCONFIGURED",
]);

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
   * `fmt=daily_nav`. The csv-finalize route REQUIRES this series in its POST
   * body for those formats — see `parseDailyReturnsSeries` in
   * `src/app/api/strategies/csv-finalize/route.ts`, which rejects a missing or
   * empty series with `CSV_INVALID_FORMAT`. Trades is omitted; absent for
   * trades is normal.
   *
   * ⚠️ 140.5-05 / SEAMPROSE-02 — WHAT STOOD HERE WAS A BARE `file:line`
   * CITATION NAMING LINE 748 OF A FILE CALLED `route.ts`, AND IT WAS BOTH WRONG
   * AND UNRESOLVABLE. Wrong: that line is not the check. Unresolvable: the
   * census (140.5-04) measured that basename as **88-way ambiguous** in this
   * repo, so a reader could not even tell WHICH file was meant. The replacement
   * anchors on a SYMBOL, which survives every edit above it — the ambiguity
   * policy this phase adopted for the seam surface, applied here because this
   * file is on it.
   *
   * ⚠️ The old citation is DESCRIBED rather than QUOTED, deliberately. The
   * census's own needle would count a quoted `file:line` as a live citation in
   * this file, so a note recording the removal would keep reporting the
   * finding open — DEF-16-2 pointed at itself. 140.5-04 hit the same shape from
   * the other side and recorded that nothing in this repo excludes a marked
   * quotation from a prose scan yet.
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
  /**
   * Phase 15 fix (2026-05-27): report every name edit up to WizardClient so
   * it can debounce-autosave the typed name to localStorage. Pre-fix the
   * name only reached localStorage inside onSuccess (after a successful
   * validate), so typing a name and refreshing before validation lost it
   * (VERIFICATION item #4). Optional so the existing prop-sync tests, which
   * don't pass it, stay green.
   */
  onNameChange?: (name: string) => void;
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
  onNameChange,
  onSuccess,
}: CsvUploadStepProps) {
  const [strategyName, setStrategyName] = useState<string>(initialStrategyName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [fmt, setFmt] = useState<Fmt>("daily_returns");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [envelope, setEnvelope] = useState<ValidationEnvelope | null>(null);
  /**
   * 140.5-05 — the SHARED envelope, rendered by branches 2 and 3 of the arm
   * below. Deliberately a second piece of state rather than a widening of
   * `envelope`: the two panels have different shapes and only this one can
   * carry a `Retry-After` (PATTERNS §5). Exactly one is ever non-null.
   */
  const [seamEnvelope, setSeamEnvelope] = useState<ErrorEnvelope | null>(null);
  /**
   * The client's own correlation id, generated once per mount and identical to
   * the `X-Correlation-Id` header `wizardFetch` stamps on every request — so
   * when the wire names no id, the one we show is still the one the server
   * logged. §4a REQUIRES an id to render; `—` was half the reported defect.
   */
  const [correlationId] = useState<string>(() => getWizardCorrelationId());
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
    // Phase 15 fix: mirror the edit up so WizardClient can autosave it.
    onNameChange?.(value);
  }, [nameError, onNameChange]);

  /**
   * 140.5-05 — the ONE writer for the CSV panel, and it clears the shared one.
   *
   * Mutual exclusion is made STRUCTURAL rather than left to discipline: there
   * are now two error panels and exactly one may be on screen. Two accounts of
   * one failure, side by side, is the shape 140.4-16 / CR-02 already had to
   * remove once from this surface. Every pre-existing `setEnvelope(…)` call
   * site goes through here, so a future arm cannot forget the other half.
   */
  const showCsvEnvelope = useCallback((next: ValidationEnvelope | null) => {
    setEnvelope(next);
    setSeamEnvelope(null);
  }, []);

  /** The mirror image: the ONE writer for the shared panel. */
  const showSeamEnvelope = useCallback((next: ErrorEnvelope) => {
    setSeamEnvelope(next);
    setEnvelope(null);
  }, []);

  const handleSelectFmt = useCallback(
    (next: Fmt) => {
      setFmt(next);
      showCsvEnvelope(null);
    },
    [showCsvEnvelope],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;

      // Defense-in-depth: 10 MB cap fires on selection (NOT on submit).
      // Server (Next route + analytics service) re-checks.
      if (f.size > MAX_FILE_BYTES) {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        showCsvEnvelope({
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
        showCsvEnvelope({
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
      showCsvEnvelope(null);
    },
    [showCsvEnvelope],
  );

  const handleClearFile = useCallback(() => {
    setFile(null);
    showCsvEnvelope(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [showCsvEnvelope]);

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
    // Clears BOTH panels, so a wait advertised by the previous response cannot
    // survive into this attempt (TRAP-3 — the half a copy-paste of this pattern
    // drops).
    showCsvEnvelope(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("fmt", fmt);
      formData.append("wizard_session_id", wizardSessionId);
      // NOTE: strategy_name is NOT sent here — finalize-time only.

      const res = await wizardFetch("/api/strategies/csv-validate", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json().catch(() => ({}))) as ValidateResponse;

      // ⛔ 140.5-05 / SEAMPROSE-07+08 — THE THREE-WAY ARM, IN ITS BINDING ORDER.
      //
      // WHAT WAS HERE. One branch, `!res.ok || data.ok === false`, reading
      // `data.code` at the TOP level and defaulting to `CSV_VALIDATION_FAILED`.
      // A forwarded 401 (`{error:"Unauthorized"}`), a FastAPI 403
      // (`{"detail":"Forbidden"}`) and EVERY nested `service_error` envelope
      // (code at `detail.code`) carry no top-level code, so all of them rendered
      // *"Validation failed. See per-row breakdown below."* with no breakdown
      // and `correlation_id: —`. Reproduced in a browser on a real founder CSV
      // (qa-report-localhost-2026-07-29, ISSUE-003 → DEF-140.4-C).
      //
      // WHY IT IS THREE-WAY AND NOT TWO (plan-checker B-1). The tempting fix is
      // `!res.ok → §4a`. It would have BROADENED the milestone's signature
      // defect: this route emits its own caller faults with real codes and real
      // sentences, so an 11 MB upload would have read *"This is on our side,
      // not your data"*. See `KNOWN_CSV_VALIDATE_CODES` above.
      //
      // WHY THE ROSTER IS TRIED FIRST (plan-checker B-7). `SEAM_MISCONFIGURED`
      // is in BOTH vocabularies. Hop-first would hand it the generic entry,
      // whose *"Nothing was submitted"* / *"never left our servers"* clauses are
      // FALSE here — the file was already buffered. Roster-first keeps the
      // route's WR-07-corrected sentence, which is the true one.
      //
      // WHY THE SPLIT FROM `data.ok === false`. A genuine validation verdict
      // arrives **200 with `ok:false`** and owns the per-row path below. Only
      // `!res.ok` is a transport/authorisation/refusal outcome. Merging them is
      // what let an auth failure borrow validation copy.
      if (!res.ok) {
        if (data.code !== undefined && KNOWN_CSV_VALIDATE_CODES.has(data.code)) {
          // BRANCH 1 — the route's OWN vocabulary. Its body is forwarded
          // UNCHANGED: the route authored this sentence, including the
          // corrections it authored for sites where the shared copy is false.
          const errEnvelope: ValidationEnvelope = {
            code: data.code,
            human_message:
              data.human_message ??
              WIZARD_ERROR_COPY.CSV_VALIDATION_FAILED.title,
            debug_context: data.debug_context ?? {
              pandera_errors: data.errors ?? [],
            },
            correlation_id: data.correlation_id ?? null,
          };
          showCsvEnvelope(errEnvelope);
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: "csv_upload",
            code: errEnvelope.code,
          });
          setSubmitting(false);
          return;
        }

        // BRANCHES 2 AND 3 — read through the LEAF, never off the top level.
        // `seamErrorCode` handles the flat AND the nested `service_error`
        // shapes; a top-level read answers `undefined` on the nested family and
        // is exactly how the original defect was built.
        const translated = recogniseSeamErrorCode(seamErrorCode(data));
        const code: WizardErrorCode =
          translated !== "UNKNOWN" ? translated : "CSV_UPSTREAM_FAIL";
        // §4a requires an id to RENDER. Prefer what the wire named; fall back
        // to the session id `wizardFetch` already sent as `X-Correlation-Id`,
        // so the id on screen is joinable to the server's log either way. Never
        // `—`: an empty support reference is a deleted diagnostic, not a
        // relocated one.
        const surfacedId =
          seamCorrelationId(data) ?? data.correlation_id ?? correlationId;
        // The wait rides the HEADER, read through the ONE parser
        // (`quantalyze/no-raw-retry-after-parse` is a repo-wide lint error).
        // Read from the SAME response as the code, so a wait and a code can
        // never describe different failures. `?? undefined` because ABSENCE IS
        // NOT ZERO — a `0` here would be a duration nobody advertised.
        const advertisedWait = parseRetryAfterSeconds(res.headers);
        showSeamEnvelope(
          buildEnvelope(code, surfacedId, {
            retryAfterSeconds: advertisedWait ?? undefined,
          }),
        );
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "csv_upload",
          code,
        });
        setSubmitting(false);
        return;
      }

      if (data.ok === false) {
        // The genuine validation verdict — 200 + `ok:false`. Unchanged.
        const errEnvelope: ValidationEnvelope = {
          code: data.code ?? "CSV_VALIDATION_FAILED",
          human_message:
            data.human_message ?? WIZARD_ERROR_COPY.CSV_VALIDATION_FAILED.title,
          debug_context: data.debug_context ?? {
            pandera_errors: data.errors ?? [],
          },
          correlation_id: data.correlation_id ?? null,
        };
        showCsvEnvelope(errEnvelope);
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
        showCsvEnvelope(errEnvelope);
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
      // 140.5-05 / TRAP-1, restated as a PROPERTY: a caught transport error must
      // not be logged in a form that can carry credential material. This site
      // logged the raw caught value. `scrubSeamError` is the ONE entry point
      // every seam log site uses and is total by construction — it never
      // throws, which matters because this is inside a catch arm.
      //
      // ⚠️ AN INSTANCE FIX, NOT A CLASS FIX, AND SAYING SO IS THE POINT. The
      // log-coverage roster (`seam-log-coverage.test.ts`) does not cover `.tsx`
      // files at all, so this site was invisible to it and its siblings still
      // are. Scrubbing one call does not close that class; the class is named
      // as open in `140.5-05-SUMMARY.md`'s `## OPEN`.
      console.error(
        "[wizard:CsvUploadStep] submit threw:",
        scrubSeamError(err),
      );
      const errEnvelope: ValidationEnvelope = {
        code: "CSV_NETWORK_TIMEOUT",
        human_message: WIZARD_ERROR_COPY.CSV_NETWORK_TIMEOUT.title,
        debug_context: {},
        correlation_id: null,
      };
      showCsvEnvelope(errEnvelope);
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
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        {CSV_UPLOAD_STEP_HEADINGS.title}
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        {CSV_UPLOAD_STEP_HEADINGS.subtitle}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {/* Row 1 — Strategy-name input (cross-AI revision 2026-04-30).
            Phase 53 / APPLY-02: wrapped in Field so aria-invalid +
            aria-describedby wire automatically (the exact gap the bare
            hand-wired input had — it set aria-invalid but NOT
            aria-describedby). The char-counter stays an aria-live sibling;
            the error/help copy threads through Field's error/hint slots
            (existing wizardErrors / heading strings — never invented). */}
        <div>
          <Field
            id="strategy-name"
            label="Strategy name"
            error={nameError ?? undefined}
            hint={nameError ? undefined : CSV_UPLOAD_STEP_HEADINGS.nameHelper}
          >
            <input
              type="text"
              required
              maxLength={MAX_NAME_CHARS}
              value={strategyName}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={() => {
                // Surface the existing required/too-long validation at the
                // field on blur (presentation-only; the finalize POST stays
                // authoritative). Reuses the same wizardErrors copy the
                // submit path uses — no new string.
                const trimmed = strategyName.trim();
                if (trimmed.length === 0) {
                  setNameError(WIZARD_ERROR_COPY.CSV_STRATEGY_NAME_REQUIRED.title);
                } else if (strategyName.length > MAX_NAME_CHARS) {
                  setNameError(WIZARD_ERROR_COPY.CSV_STRATEGY_NAME_TOO_LONG.title);
                }
              }}
              placeholder="Aurora Capital — BTC vol carry"
              aria-required="true"
              data-testid="csv-strategy-name"
              className="block w-full rounded-md border border-border bg-white px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 aria-[invalid=true]:border-negative"
            />
          </Field>
          <span
            className="mt-1 block text-right text-micro font-metric tabular-nums text-text-muted"
            aria-live="polite"
          >
            {strategyName.length} / {MAX_NAME_CHARS}
          </span>
        </div>

        {/* Row 2 — Format selector (segmented control). */}
        <fieldset>
          <legend className="text-caption font-medium text-text-primary">Format</legend>
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
                  <p className="text-body font-semibold text-text-primary">
                    {f.label}
                  </p>
                  <p className="mt-1 text-micro text-text-secondary">{f.caption}</p>
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
                <p className="text-body text-text-primary font-medium">
                  {CSV_UPLOAD_STEP_HEADINGS.fileLabel(
                    file.name,
                    fileSizeMb ?? "0",
                  )}
                </p>
                <p className="mt-1 text-caption text-text-muted">
                  Drop a different file to replace, or use the button below.
                </p>
              </>
            ) : (
              <>
                <p className="text-body text-text-muted mb-1">
                  {CSV_UPLOAD_STEP_HEADINGS.dropzoneIdle}
                </p>
                <p className="text-caption text-text-muted">
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
              className="mt-2 text-micro text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
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

        {/* 140.5-05 — the SHARED envelope, for branches 2 and 3 of the arm.
            `onRetry` is the same dismiss handler `ConnectKeyStep` and
            `SubmitStep` pass, and it is NOT decoration: `ErrorEnvelope`
            computes `showRetry = recoverable && Boolean(onRetry)` and gates the
            advertised wait behind `showRetry`. Omitting it would render an
            envelope that structurally cannot show the `Retry-After` this route
            stamps — plumbing that reaches nothing (PATTERNS §5). */}
        {seamEnvelope && (
          <WizardErrorEnvelope
            envelope={seamEnvelope}
            onRetry={() => setSeamEnvelope(null)}
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
