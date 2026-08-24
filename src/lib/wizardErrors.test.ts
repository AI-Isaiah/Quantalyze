import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, lstatSync, realpathSync } from "fs";
import { join, resolve } from "path";
import {
  formatKeyError,
  gateFailureToWizardError,
  recogniseDashboardDialogCode,
  classifyKeyValidationError,
  recogniseSeamErrorCode,
  WIZARD_ERROR_COPY,
  CSV_RULE_LABELS,
  CSV_UPLOAD_STEP_HEADINGS,
  CSV_PREVIEW_STEP_HEADINGS,
  CSV_SUBMIT_STEP_HEADINGS,
  formatCsvRuleCauseSingle,
  formatColumnInDataframeMessage,
  type WizardErrorCode,
} from "./wizardErrors";
import type { GateFailureCode } from "./strategyGate";
// 153.1-04 / WIZFORM-02 — the DERIVATION, not a restatement of it. The claim
// under test is "no Retry control renders", and that is decided by
// `buildEnvelope` reading `actions` against `RECOVERABLE_ACTIONS`, then by
// `ErrorEnvelope`'s `showRetry = recoverable && Boolean(onRetry)`. Asserting
// the table's `actions` array instead would only restate what the table says
// about itself and would go green if the derivation rule ever changed.
import { buildEnvelope } from "./envelope";
// 153.1-03 / WIZFORM-03 — the INDEPENDENT registry the class sweeps iterate.
// The oracle for "which venues are non-substitutable" must not be the copy
// table under test, and it must not be a hand-listed `["mt5"]` either: a second
// non-substitutable venue has to be picked up here with no test edit, which is
// exactly what the class-not-instance mutation checks.
import { SUPPORTED_EXCHANGES, venueIsSubstitutable } from "@/lib/closed-sets";
// The dependency-free leaf — the SAME module wizardErrors itself imports, so
// `instanceof` holds by class identity. Never route this through
// `@/lib/analytics-client` (whose re-export is wholesale-mocked by 16 route
// test files) nor `@/lib/resilient-fetch`.
import { CircuitOpenError } from "@/lib/seam-errors";

describe("wizardErrors", () => {
  describe("WIZARD_ERROR_COPY table shape", () => {
    // MULTI_KEY_WINDOWS_INVALID is a summary-only code: its cause/fix/actions
    // are intentionally left empty in the table because the MultiKeyConnectStep
    // component REPLACES them at render with live per-issue field messages
    // derived from keyWindowsSchema (see wizardErrors.ts). Only its title is
    // table-owned, so the full-shape invariant below does not apply to it.
    const SUMMARY_ONLY_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(
      ["MULTI_KEY_WINDOWS_INVALID"],
    );

    it("every code has a non-empty title, cause, fix list, docsHref, and actions", () => {
      const codes = Object.keys(WIZARD_ERROR_COPY) as WizardErrorCode[];
      expect(codes.length).toBeGreaterThanOrEqual(16);

      for (const code of codes) {
        const copy = WIZARD_ERROR_COPY[code];
        // Title + docsHref are table-owned for EVERY code, including the
        // summary-only ones.
        expect(copy.title).toBeTruthy();
        expect(copy.title.length).toBeGreaterThan(4);
        expect(copy.docsHref).toMatch(/^\/security/);
        if (SUMMARY_ONLY_CODES.has(code)) continue;
        // Full-envelope codes must additionally carry cause, fix, and actions.
        expect(copy.cause).toBeTruthy();
        expect(copy.fix.length).toBeGreaterThan(0);
        expect(copy.actions.length).toBeGreaterThan(0);
      }
    });

    it("every docsHref is a valid path", () => {
      for (const copy of Object.values(WIZARD_ERROR_COPY)) {
        expect(copy.docsHref).toMatch(/^\/security(#|$)/);
      }
    });

    it("actions only contain known action IDs", () => {
      const allowed = new Set([
        "try_another_key",
        "clear_and_retry",
        "expand_log",
        "resume_draft",
        "start_fresh",
        "request_call",
        "leave_and_return",
      ]);
      for (const copy of Object.values(WIZARD_ERROR_COPY)) {
        for (const action of copy.actions) {
          expect(allowed.has(action)).toBe(true);
        }
      }
    });
  });

  describe("formatKeyError", () => {
    it("returns the exact table entry for a known code", () => {
      const result = formatKeyError("KEY_HAS_TRADING_PERMS");
      expect(result.title).toBe("This key has trading permissions enabled.");
      expect(result.actions).toContain("try_another_key");
    });

    it("KEY_SCOPE_BROADENED has the read-only re-key copy", () => {
      // Surfaced when the wizard finalize re-check finds trade/withdraw
      // scope on a key that passed the read-only validation at Connect.
      // Title and cause must explicitly tell the user the key was
      // broadened on the exchange between Connect and Submit so they
      // know they need to re-key as read-only — not retry the same key.
      const result = formatKeyError("KEY_SCOPE_BROADENED");
      expect(result.title).toBe("Your key now has trading permissions.");
      expect(result.cause).toMatch(/read-only/);
      expect(result.cause).toMatch(/trade|withdraw/);
      expect(result.actions).toContain("try_another_key");
      expect(result.docsHref).toBe("/security#readonly-key");
    });

    it("returns UNKNOWN when code is null", () => {
      const result = formatKeyError(null);
      expect(result.title).toBe("Something went wrong.");
    });

    it("returns UNKNOWN when code is undefined", () => {
      const result = formatKeyError(undefined);
      expect(result.title).toBe("Something went wrong.");
    });

    it("returns UNKNOWN when code is not in the table", () => {
      // @ts-expect-error intentional invalid input
      const result = formatKeyError("NOT_A_REAL_CODE");
      expect(result.title).toBe("Something went wrong.");
    });

    it("interpolates trade count into GATE_INSUFFICIENT_TRADES cause", () => {
      const result = formatKeyError("GATE_INSUFFICIENT_TRADES", { trades: 3 });
      expect(result.cause).toContain("only 3 filled trade");
    });

    it("interpolates days into GATE_INSUFFICIENT_DAYS cause", () => {
      const result = formatKeyError("GATE_INSUFFICIENT_DAYS", { days: 4.2 });
      // Phase 21 — concrete span days are surfaced in the cause so the
      // user immediately sees how short their actual history is.
      expect(result.cause).toContain("4.2 calendar day");
      expect(result.cause).toContain("Your trades span");
    });

    it("floor-rounds sub-7 span so 6.97 days never displays as 7.0", () => {
      // Regression — 2026-05-21 user dogfooding report. The gate compares
      // strict `< 7` (strategyGate.ts:89) but `.toFixed(1)` rounds half-up,
      // so a real span of 6.95-6.99 was rendered as "7.0" alongside a
      // failure message. The user read "7.0 days" and reasonably concluded
      // they were AT the threshold but still being rejected — confusing.
      // After the fix, floor-rounding guarantees a sub-7 value never
      // displays as "7.0".
      const just_under = formatKeyError("GATE_INSUFFICIENT_DAYS", { days: 6.97 });
      expect(just_under.cause).toContain("6.9 calendar day");
      expect(just_under.cause).not.toContain("7.0 calendar day");

      const really_close = formatKeyError("GATE_INSUFFICIENT_DAYS", { days: 6.99 });
      expect(really_close.cause).toContain("6.9 calendar day");
      expect(really_close.cause).not.toContain("7.0 calendar day");

      const half_below = formatKeyError("GATE_INSUFFICIENT_DAYS", { days: 6.5 });
      expect(half_below.cause).toContain("6.5 calendar day");
    });

    it("GATE_INSUFFICIENT_DAYS title talks about history, not activity", () => {
      // Regression: the old wording "needs at least 7 days of activity"
      // was misleading for high-frequency keys (3,842 fills in <7 days
      // looks like plenty of "activity" to a user). The actual rule is a
      // calendar-day span between earliest and latest trade. /qa
      // 2026-05-05 — Bybit MWF-Read live key surfaced this on prod.
      const result = formatKeyError("GATE_INSUFFICIENT_DAYS");
      expect(result.title).not.toContain("activity");
      expect(result.title).toContain("history");
      expect(result.cause).toContain("calendar day");
    });

    it("appends computationError into GATE_ANALYTICS_FAILED cause", () => {
      const result = formatKeyError("GATE_ANALYTICS_FAILED", {
        computationError: "Railway timed out",
      });
      expect(result.cause).toContain("Railway timed out");
    });

    it("appends computationError into SYNC_FAILED cause", () => {
      const result = formatKeyError("SYNC_FAILED", {
        computationError: "connection refused",
      });
      expect(result.cause).toContain("connection refused");
    });

    it("does not mutate the original table", () => {
      const first = formatKeyError("GATE_INSUFFICIENT_TRADES", { trades: 1 });
      const second = formatKeyError("GATE_INSUFFICIENT_TRADES", { trades: 2 });
      expect(first.cause).toContain("only 1 filled trade");
      expect(second.cause).toContain("only 2 filled trade");
      // Neither should have both.
      expect(first.cause).not.toContain("only 2 filled trade");
      expect(second.cause).not.toContain("only 1 filled trade");
    });
  });

  describe("Phase 17 — CSV branch absorption (DESIGN-05)", () => {
    const CSV_CODES: WizardErrorCode[] = [
      "CSV_PARSE_FAILED",
      "CSV_SCHEMA_VIOLATION",
      "CSV_FILE_TOO_LARGE",
      "CSV_INVALID_EXTENSION",
      "CSV_NON_MONOTONIC_DATES",
      "CSV_NAV_ZERO",
      "CSV_RETURN_OUT_OF_RANGE",
      "CSV_SHARPE_SUSPICIOUS",
      "CSV_CURRENCY_INVALID",
      "CSV_QTY_PRICE_INVALID",
      "CSV_STRATEGY_NAME_REQUIRED",
      "CSV_STRATEGY_NAME_TOO_LONG",
      "CSV_VALIDATION_FAILED",
      "CSV_UPSTREAM_FAIL",
      "CSV_NETWORK_TIMEOUT",
      "CSV_SUBMIT_FAILED",
      "CSV_SUBMIT_NO_STRATEGY_ID",
    ];

    it("registers all 17 CSV_* codes in WIZARD_ERROR_COPY with full WizardErrorCopy shape", () => {
      for (const code of CSV_CODES) {
        const copy = WIZARD_ERROR_COPY[code];
        expect(copy, `WIZARD_ERROR_COPY missing entry for ${code}`).toBeTruthy();
        expect(copy.title.length).toBeGreaterThan(4);
        expect(copy.cause.length).toBeGreaterThan(4);
        expect(copy.fix.length).toBeGreaterThan(0);
        expect(copy.docsHref).toMatch(/^\/security/);
        expect(copy.actions.length).toBeGreaterThan(0);
      }
    });

    it("CSV_FILE_TOO_LARGE preserves the verbatim {sizeMb} interpolation contract", () => {
      const copy = WIZARD_ERROR_COPY.CSV_FILE_TOO_LARGE;
      expect(copy.title).toBe(
        "Maximum file size is 10 MB. Your file is {sizeMb} MB. Trim it or split it before retrying.",
      );
    });

    it("CSV_INVALID_EXTENSION preserves the verbatim user-visible title", () => {
      expect(WIZARD_ERROR_COPY.CSV_INVALID_EXTENSION.title).toBe(
        "Only .csv files are accepted. Convert your file and try again.",
      );
    });

    it("CSV_STRATEGY_NAME_REQUIRED preserves the verbatim user-visible title", () => {
      expect(WIZARD_ERROR_COPY.CSV_STRATEGY_NAME_REQUIRED.title).toBe(
        "Strategy name is required.",
      );
    });

    it("CSV_STRATEGY_NAME_TOO_LONG preserves the verbatim user-visible title", () => {
      expect(WIZARD_ERROR_COPY.CSV_STRATEGY_NAME_TOO_LONG.title).toBe(
        "Strategy name must be 80 characters or fewer.",
      );
    });

    // ⚠️ 140.5-02 — BOTH TITLES BELOW WERE RE-POINTED, in the same commit as
    // the copy change, and the old strings are recorded here rather than simply
    // overwritten:
    //   CSV_VALIDATION_FAILED was "Validation failed. See per-row breakdown
    //     below." — a promise measured FALSE on both arms of the route
    //     (RESEARCH §12.4). It is reached as the ENVELOPE HEADING via
    //     `CsvUploadStep`'s `data.human_message ?? …title` fallback, so a
    //     forwarded 401 printed it verbatim.
    //   CSV_UPSTREAM_FAIL was "Validation service returned an unexpected
    //     response. Retry shortly." — replaced by the FOUNDER-AUTHORED §4a
    //     sentence, which is pre-approved and not open to a reword.
    // A pin that survives the change it was written to catch is worse than no
    // pin, so these move deliberately, with the reason attached.
    it("CSV_VALIDATION_FAILED preserves the verbatim user-visible title", () => {
      expect(WIZARD_ERROR_COPY.CSV_VALIDATION_FAILED.title).toBe(
        "Your file did not pass validation.",
      );
    });

    it("CSV_UPSTREAM_FAIL preserves the verbatim user-visible title", () => {
      expect(WIZARD_ERROR_COPY.CSV_UPSTREAM_FAIL.title).toBe(
        "We couldn't check your file just now.",
      );
    });

    it("CSV_NETWORK_TIMEOUT preserves the verbatim user-visible title (CsvUploadStep variant)", () => {
      expect(WIZARD_ERROR_COPY.CSV_NETWORK_TIMEOUT.title).toBe(
        "The server did not respond within 30 seconds. Your file is preserved — click Retry to try again.",
      );
    });

    it("CSV_SUBMIT_FAILED preserves the verbatim user-visible title", () => {
      // ⚠️ RE-PINNED by 140.3-12 / SEAMUX-04. The previous literal was
      // "Your file validated cleanly, but saving the strategy hit an error.
      //  Click Submit strategy again to retry — your data is unchanged."
      // Two defects, both deliberate to remove: it asserted the write had NOT
      // landed (unknowable — the 500 comes from a handler that commits, and
      // uvicorn does not cancel on client disconnect), and it steered the user
      // straight back into a resubmit. This pin's PURPOSE is drift detection on
      // a verbatim string, so a deliberate rewrite re-pins it rather than
      // relaxing it to a substring match.
      expect(WIZARD_ERROR_COPY.CSV_SUBMIT_FAILED.title).toBe(
        "We could not confirm whether your strategy was saved.",
      );
    });

    it("CSV_SUBMIT_NO_STRATEGY_ID preserves the verbatim user-visible title", () => {
      expect(WIZARD_ERROR_COPY.CSV_SUBMIT_NO_STRATEGY_ID.title).toBe(
        "Submission succeeded but the server did not return a strategy id. Retry to confirm.",
      );
    });

    it("formatKeyError interpolates {sizeMb} into CSV_FILE_TOO_LARGE title", () => {
      const result = formatKeyError("CSV_FILE_TOO_LARGE", { sizeMb: "12.5" });
      expect(result.title).toBe(
        "Maximum file size is 10 MB. Your file is 12.5 MB. Trim it or split it before retrying.",
      );
    });

    it("CSV_RULE_LABELS exposes the 6 verbatim entries from UI-SPEC §14.3", () => {
      expect(CSV_RULE_LABELS.monotonic_dates).toBe(
        "Dates must be strictly increasing",
      );
      expect(CSV_RULE_LABELS.nav_non_zero).toBe("NAV cannot be zero");
      expect(CSV_RULE_LABELS.daily_return_lower_bound).toBe(
        "Daily return cannot be ≤ -100%",
      );
      expect(CSV_RULE_LABELS.daily_sharpe_sentinel).toBe(
        "Daily Sharpe > 10 looks unrealistic",
      );
      expect(CSV_RULE_LABELS.currency_usd_or_blank).toBe(
        "Currency must be USD or left blank",
      );
      expect(CSV_RULE_LABELS.qty_price_positive).toBe(
        "Quantity and price must be positive",
      );
    });

    it("CSV_UPLOAD_STEP_HEADINGS exposes the verbatim heading + helper + dropzone strings", () => {
      expect(CSV_UPLOAD_STEP_HEADINGS.title).toBe("Upload your track record");
      expect(CSV_UPLOAD_STEP_HEADINGS.subtitle).toBe(
        "Name your strategy, pick a format, and drop your CSV. We validate every row before creating your strategy. Max 10 MB.",
      );
      expect(CSV_UPLOAD_STEP_HEADINGS.nameHelper).toBe(
        "1–80 characters. This is the public name on your factsheet — pick something your LPs will recognize.",
      );
      expect(CSV_UPLOAD_STEP_HEADINGS.dropzoneIdle).toBe(
        "Drop a CSV file here, or click to browse",
      );
      expect(CSV_UPLOAD_STEP_HEADINGS.fileLabel("foo.csv", "1.23")).toBe(
        "foo.csv · 1.23 MB",
      );
    });

    it("CSV_PREVIEW_STEP_HEADINGS exposes the verbatim title/subtitle/CTA", () => {
      expect(CSV_PREVIEW_STEP_HEADINGS.title).toBe("Preview your data");
      expect(CSV_PREVIEW_STEP_HEADINGS.subtitle).toBe(
        "Confirm we parsed your file correctly. Validation runs across every row in your file before you can continue.",
      );
      expect(CSV_PREVIEW_STEP_HEADINGS.continueLabel).toBe("Submit strategy");
    });

    it("CSV_SUBMIT_STEP_HEADINGS exposes the heading, subtitle, and submit-CTA labels for CsvSubmitStep", () => {
      expect(CSV_SUBMIT_STEP_HEADINGS.title).toBe("Review and submit");
      expect(CSV_SUBMIT_STEP_HEADINGS.subtitle).toBe(
        "The founder reviews CSV-uploaded strategies within 48 hours. You will receive an email when your listing is approved.",
      );
      expect(CSV_SUBMIT_STEP_HEADINGS.submitCtaLabel).toBe("Submit strategy");
      expect(CSV_SUBMIT_STEP_HEADINGS.submittingCtaLabel).toBe("Submitting…");
    });

    it("formatCsvRuleCauseSingle formats the single-rule cause sentence", () => {
      expect(
        formatCsvRuleCauseSingle("Dates must be strictly increasing"),
      ).toBe(
        "Rule violated: Dates must be strictly increasing. Expand below for the row-level breakdown.",
      );
    });

    it("CsvSubmitStep variant of CSV_NETWORK_TIMEOUT uses the same title (single source of truth)", () => {
      // Phase 17 collapses the two near-identical timeout strings (CsvUpload "click Retry"
      // vs CsvSubmit "click Submit strategy") into ONE canonical CSV_NETWORK_TIMEOUT
      // entry. Verbatim CsvUpload variant wins per UI-SPEC §14.1 row 7.
      expect(WIZARD_ERROR_COPY.CSV_NETWORK_TIMEOUT.title).toContain(
        "did not respond within 30 seconds",
      );
    });
  });

  describe("gateFailureToWizardError", () => {
    it("maps INSUFFICIENT_TRADES to the wizard gate code", () => {
      expect(gateFailureToWizardError("INSUFFICIENT_TRADES")).toBe(
        "GATE_INSUFFICIENT_TRADES",
      );
    });

    it("maps INSUFFICIENT_DAYS to the wizard gate code", () => {
      expect(gateFailureToWizardError("INSUFFICIENT_DAYS")).toBe(
        "GATE_INSUFFICIENT_DAYS",
      );
    });

    it("maps ANALYTICS_FAILED to the wizard gate code", () => {
      expect(gateFailureToWizardError("ANALYTICS_FAILED")).toBe(
        "GATE_ANALYTICS_FAILED",
      );
    });

    it("maps NO_DATA_SOURCE to the wizard gate code", () => {
      expect(gateFailureToWizardError("NO_DATA_SOURCE")).toBe(
        "GATE_NO_DATA_SOURCE",
      );
    });

    it("maps transient gate states to UNKNOWN so callers handle them as polling", () => {
      expect(gateFailureToWizardError("ANALYTICS_MISSING")).toBe("UNKNOWN");
      expect(gateFailureToWizardError("ANALYTICS_PENDING")).toBe("UNKNOWN");
      expect(gateFailureToWizardError("ANALYTICS_COMPUTING")).toBe("UNKNOWN");
    });
  });

  // Regression: /qa CSV report 2026-05-21 ISSUE-012. Before this fix the
  // CSV validation envelope leaked panderas's raw rule-name text:
  //   Top-line: "1 row failed validation"
  //   Cause:    "Rule violated: column_in_dataframe"
  //   Detail:   "Row 0: Column 'None' failed: daily_return"
  // None of those tell the user what to actually do. The fix routes the
  // raw rule name through CSV_RULE_LABELS for the cause line + rewrites
  // the per-row message via formatColumnInDataframeMessage.
  describe("ISSUE-012 — column_in_dataframe envelope rewrite", () => {
    it("CSV_RULE_LABELS includes a human label for column_in_dataframe", () => {
      expect(CSV_RULE_LABELS.column_in_dataframe).toBe(
        "Your CSV is missing a required column",
      );
    });

    it("rewrites the panderas Column 'None' failed message into an actionable sentence", () => {
      const raw = "Column 'None' failed: daily_return";
      const rewritten = formatColumnInDataframeMessage(raw);
      expect(rewritten).toContain("daily_return");
      expect(rewritten).toContain("missing from your file");
      // Tells the user what to do, not just what failed.
      expect(rewritten).toMatch(/rename|switch/i);
      // Never leaks the rule-name 'Column \'None\'' bookkeeping back to the user.
      expect(rewritten).not.toContain("Column 'None'");
    });

    it("returns the original message unchanged when the format does not match", () => {
      // Defensive: if panderas changes its message shape we surface the
      // original text rather than dropping information.
      expect(formatColumnInDataframeMessage("something else entirely")).toBe(
        "something else entirely",
      );
    });

    it("handles missing required column for trade-list format", () => {
      // The same pandera rule fires on any required column. Make sure
      // the rewrite pulls out the actual column name (not hardcoded to
      // daily_return).
      const raw = "Column 'None' failed: trade_qty";
      const rewritten = formatColumnInDataframeMessage(raw);
      expect(rewritten).toContain("trade_qty");
      expect(rewritten).not.toContain("daily_return");
    });
  });
});

// M-0591 — UNKNOWN-fallback typo blindspot.
//
// formatKeyError() falls through to the UNKNOWN entry for any code not in
// WIZARD_ERROR_COPY. Direct string-literal call sites
// (`setErrorCode("KEY_HAS_TRADING_PERMS")`) are type-checked against the
// WizardErrorCode union, but two leak paths remain unguarded by the type
// system:
//   1. `gateFailureToWizardError` MAPS a GateFailureCode → WizardErrorCode by
//      string return; a typo there ('GATE_INSUFICIENT_TRADES') compiles
//      because the function's declared return type is the union, and the typo
//      would render UNKNOWN copy at runtime instead of failing the build.
//   2. Any `setErrorCode("LITERAL")` / `formatKeyError("LITERAL")` literal
//      that was cast (`as WizardErrorCode`) or otherwise escaped the union
//      check.
//
// These two tests are the runtime safety net the type system can't provide.

describe("M-0591 — every reachable error code resolves to real (non-UNKNOWN) copy", () => {
  it("gateFailureToWizardError maps every GateFailureCode to a key present in WIZARD_ERROR_COPY", () => {
    // Exhaustive over the GateFailureCode union. ANALYTICS_MISSING/PENDING/
    // COMPUTING are transient UI states that intentionally map to UNKNOWN
    // (callers should poll, not render an error) — assert that explicitly so
    // a future code that should have a terminal mapping isn't silently
    // swallowed.
    const allGateCodes: GateFailureCode[] = [
      "NO_DATA_SOURCE",
      "INSUFFICIENT_TRADES",
      "INSUFFICIENT_DAYS",
      "INSUFFICIENT_CSV_HISTORY",
      // 142.2 review FIX 1. Deliberately NOT added to `intentionallyUnknown`
      // below: it is terminal AND wizard-reachable (a keyed ledger-backed
      // strategy on an unstamped analytics row lands here, as does an unstamped
      // composite), so it MUST resolve to real, non-UNKNOWN copy. That is the
      // whole point of minting it — the state it names previously rendered
      // GATE_INSUFFICIENT_TRADES, whose sentence was false for it.
      "SERIES_PROVENANCE_UNVERIFIED",
      "ANALYTICS_MISSING",
      "ANALYTICS_PENDING",
      "ANALYTICS_COMPUTING",
      "ANALYTICS_FAILED",
    ];
    // Codes that intentionally map to UNKNOWN: the ANALYTICS_* transient UI
    // states (callers poll, not render), plus INSUFFICIENT_CSV_HISTORY, which
    // is admin-approval-only and never flows through the wizard error mapper
    // (the CSV wizard branch validates via csv-finalize; SyncPreviewStep is
    // exchange-only). Everything else is a terminal wizard-reachable code and
    // MUST resolve to real, non-UNKNOWN copy.
    const intentionallyUnknown = new Set<GateFailureCode>([
      "ANALYTICS_MISSING",
      "ANALYTICS_PENDING",
      "ANALYTICS_COMPUTING",
      "INSUFFICIENT_CSV_HISTORY",
    ]);

    for (const code of allGateCodes) {
      const mapped = gateFailureToWizardError(code);
      // The mapped code MUST be a real key in the copy table (UNKNOWN counts
      // as a key, but for terminal codes we additionally require non-UNKNOWN).
      expect(Object.keys(WIZARD_ERROR_COPY)).toContain(mapped);
      if (!intentionallyUnknown.has(code)) {
        expect(mapped).not.toBe("UNKNOWN");
        // And the copy it resolves to must NOT be the UNKNOWN fallback copy.
        expect(formatKeyError(mapped).title).not.toBe(
          WIZARD_ERROR_COPY.UNKNOWN.title,
        );
      }
    }
  });

  it("every error-code string literal passed to setErrorCode()/formatKeyError() in src/** exists in WIZARD_ERROR_COPY", () => {
    // Codebase scan. Catches a typo'd literal (`KEY_HAS_TRADING_PERM` missing
    // the S) that escaped the type union via an `as` cast or a loosely-typed
    // call site, which would otherwise silently render UNKNOWN copy with no
    // test failure.
    const SRC_ROOT = resolve(__dirname, "..");
    const validCodes = new Set(Object.keys(WIZARD_ERROR_COPY));

    function walk(dir: string, seen: Set<string> = new Set()): string[] {
      const canonical = (() => {
        try {
          return realpathSync(dir);
        } catch {
          return dir;
        }
      })();
      if (seen.has(canonical)) return [];
      seen.add(canonical);
      const out: string[] = [];
      for (const entry of readdirSync(dir)) {
        if (
          entry === "node_modules" ||
          entry === ".next" ||
          entry === "dist" ||
          entry.endsWith(".test.ts") ||
          entry.endsWith(".test.tsx")
        ) {
          continue;
        }
        const full = join(dir, entry);
        const s = (() => {
          try {
            return lstatSync(full);
          } catch {
            return null;
          }
        })();
        if (!s) continue;
        if (s.isDirectory() || s.isSymbolicLink()) {
          out.push(...walk(full, seen));
        } else if (
          entry.endsWith(".ts") ||
          entry.endsWith(".tsx")
        ) {
          out.push(full);
        }
      }
      return out;
    }

    // Match `setErrorCode("LITERAL")` and `formatKeyError("LITERAL"...)` with
    // a STRING-LITERAL first argument only. Calls with a variable
    // (`setErrorCode(code)`, `setErrorCode(wizardCode)`) are skipped — those
    // flow through the typed union or gateFailureToWizardError (covered
    // above). `null` literal is also skipped (clears the error state).
    const LITERAL_RE =
      /\b(?:setErrorCode|formatKeyError)\s*\(\s*["'`]([A-Z0-9_]+)["'`]/g;

    const files = walk(SRC_ROOT);
    const offenders: Array<{ file: string; code: string }> = [];
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      for (const m of text.matchAll(LITERAL_RE)) {
        const code = m[1];
        if (!validCodes.has(code)) {
          offenders.push({ file: file.replace(SRC_ROOT, "src"), code });
        }
      }
    }

    expect(
      offenders,
      `Found error-code literals not present in WIZARD_ERROR_COPY (would render UNKNOWN copy):\n${offenders
        .map((o) => `  ${o.code} @ ${o.file}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});

// Phase 135 (MT5SRC-02): the EXACT worker detail strings emitted by
// analytics-service/services/closed_sets.py (MT5_MASTER_PASSWORD_DETAIL /
// MT5_WRONG_SERVER_DETAIL, cited in 135-01/135-03). Pinned as byte-identical
// literals here because that byte-identity IS the cross-language contract: if
// a Python-side reword drops the "master password" / "broker server" substring
// the TS classifier depends on, these tests MUST red rather than silently
// collapsing the MT5 failure to a generic UNKNOWN 500.
const MT5_MASTER_PASSWORD_DETAIL =
  "MT5 master password detected — this login can place trades. Reconnect using your read-only investor password.";
const MT5_WRONG_SERVER_DETAIL =
  "Broker server not found — check the exact server name shown in your MT5 terminal login window.";

describe("classifyKeyValidationError — shared key-entry error mapping", () => {
  // The single source of truth for BOTH create-with-key and composite/add-key.
  // Each case pins (message → code + status) so the "+ Add another key" path can
  // never drift from the single-key path.
  const cases: Array<[string, WizardErrorCode, number]> = [
    ["Invalid signature for request", "KEY_INVALID_SIGNATURE", 400],
    ["invalid secret provided", "KEY_INVALID_SIGNATURE", 400],
    // DOGFOOD (2026-07-18): the worker's stable AUTH_FAILED detail + the raw
    // Deribit 13004 phrase. Both must land on the actionable 400, NOT UNKNOWN.
    ["Authentication failed. Check your API key and secret.", "KEY_AUTH_FAILED", 400],
    ['deribit {"error":{"code":13004,"message":"invalid_credentials"}}', "KEY_AUTH_FAILED", 400],
    // Phase 135 (MT5SRC-02): the worker emits THREE distinguishable MT5 failure
    // details. Byte-identical to services/closed_sets.py MT5_*_DETAIL — a
    // Python-side reword MUST red these. "master password" / "broker server"
    // are the collision-checked substrings; both are client faults → 400.
    [MT5_MASTER_PASSWORD_DETAIL, "KEY_MT5_MASTER_PASSWORD", 400],
    [MT5_WRONG_SERVER_DETAIL, "KEY_MT5_WRONG_SERVER", 400],
    ["Your IP is not on the allowlist", "KEY_IP_ALLOWLIST", 502],
    ["Rate limit exceeded", "KEY_RATE_LIMIT", 503],
    ["429 Too Many Requests", "KEY_RATE_LIMIT", 503],
    // ⚠️ 140.5-02 / B-02 — RE-POINTED IN THE SAME COMMIT AS THE FIX, and the
    // re-pointing is the load-bearing part. This row used to read
    // `"connect ETIMEDOUT 10.0.0.1:443"` and it was the ONLY case exercising
    // the `timeout|etimedout` branch — so the suite read as covering that arm.
    // It does not: that is a RAW UNDICI SYSCALL STRING, and `analytics-client`
    // wraps every transport failure before rethrowing, so no producer can put
    // it in front of this classifier. The arm it "covered" was dead, and the
    // real messages ("Analytics service timed out after 15000ms on …", "…is
    // not reachable…") both fell to UNKNOWN/500. Their replay now lives in the
    // B-02 block below, against the TYPE marker. The substring branch survives
    // as a LAST RESORT for a raw syscall string that reaches the classifier
    // unwrapped from somewhere new, and this row says so out loud rather than
    // implying production coverage it does not have.
    ["connect ETIMEDOUT 10.0.0.1:443", "KEY_NETWORK_TIMEOUT", 502],
    ["Could not verify the key's permission scopes", "KEY_PROBE_FAILED", 503],
    ["This key has trading permissions", "KEY_HAS_TRADING_PERMS", 400],
    ["some totally unclassified upstream string", "UNKNOWN", 500],
  ];

  for (const [message, code, status] of cases) {
    it(`maps ${JSON.stringify(message.slice(0, 40))} → ${code} (${status})`, () => {
      expect(classifyKeyValidationError(message)).toEqual({ code, status });
    });
  }

  it("orders signature BEFORE auth-failed so a true signature mismatch keeps its specific code", () => {
    // A message carrying BOTH tokens must resolve to the more specific signature
    // code, never the broader auth-failed one.
    expect(
      classifyKeyValidationError("signature mismatch: authentication failed").code,
    ).toBe("KEY_INVALID_SIGNATURE");
  });

  it("does NOT mislabel FastAPI's generic 'invalid authentication credentials' 401 as KEY_AUTH_FAILED", () => {
    // The underscore form (invalid_credentials) is the exchange fault; the
    // spaced form is a server/service-key misconfig — it must not borrow the
    // user-facing bad-key copy.
    const { code } = classifyKeyValidationError("Invalid authentication credentials");
    expect(code).not.toBe("KEY_AUTH_FAILED");
  });

  // ===========================================================
  // Phase 135 (MT5SRC-02) — three distinguishable MT5 failure paths.
  // Resolved Q-B: a master (trade-capable) login and a wrong/unknown broker
  // server are DISTINCT user mistakes from bad credentials and need targeted,
  // actionable copy. Collapsing them into KEY_AUTH_FAILED would tell the user
  // to fix the wrong thing.
  // ===========================================================
  it("classifies the worker's master-password detail as KEY_MT5_MASTER_PASSWORD (not bad-creds)", () => {
    expect(classifyKeyValidationError(MT5_MASTER_PASSWORD_DETAIL)).toEqual({
      code: "KEY_MT5_MASTER_PASSWORD",
      status: 400,
    });
  });

  it("classifies the worker's wrong-server detail as KEY_MT5_WRONG_SERVER (not bad-creds)", () => {
    expect(classifyKeyValidationError(MT5_WRONG_SERVER_DETAIL)).toEqual({
      code: "KEY_MT5_WRONG_SERVER",
      status: 400,
    });
  });

  it("keeps the three MT5 failure paths distinguishable (master ≠ wrong-server ≠ bad-creds)", () => {
    const master = classifyKeyValidationError(MT5_MASTER_PASSWORD_DETAIL).code;
    const server = classifyKeyValidationError(MT5_WRONG_SERVER_DETAIL).code;
    const badCreds = classifyKeyValidationError(
      "Authentication failed. Check your API key and secret.",
    ).code;
    expect(new Set([master, server, badCreds]).size).toBe(3);
    expect(badCreds).toBe("KEY_AUTH_FAILED");
  });

  it("does NOT let the MT5 branches shadow existing classifications (placement pin)", () => {
    // The MT5 branches sit AFTER KEY_AUTH_FAILED and BEFORE ip/allow. A
    // signature mismatch, a rate-limit, a timeout and a probe failure must all
    // keep their existing codes after the insertion.
    expect(classifyKeyValidationError("Invalid signature").code).toBe(
      "KEY_INVALID_SIGNATURE",
    );
    expect(classifyKeyValidationError("Rate limit exceeded").code).toBe(
      "KEY_RATE_LIMIT",
    );
    expect(classifyKeyValidationError("connect ETIMEDOUT").code).toBe(
      "KEY_NETWORK_TIMEOUT",
    );
    expect(
      classifyKeyValidationError("Could not verify the key's permission scopes")
        .code,
    ).toBe("KEY_PROBE_FAILED");
  });

  it("renders real (non-UNKNOWN) copy for both new MT5 codes without placeholder leakage", () => {
    for (const code of ["KEY_MT5_MASTER_PASSWORD", "KEY_MT5_WRONG_SERVER"] as const) {
      expect(Object.keys(WIZARD_ERROR_COPY)).toContain(code);
      const copy = formatKeyError(code);
      expect(copy.title).not.toBe(WIZARD_ERROR_COPY.UNKNOWN.title);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.cause.length).toBeGreaterThan(0);
      expect(copy.fix.length).toBeGreaterThan(0);
      // No un-interpolated placeholder tokens leaked into user-facing copy.
      expect(copy.title).not.toMatch(/\{.*\}/);
      expect(copy.cause).not.toMatch(/\{.*\}/);
    }
  });

  it("master-password copy never falsely asserts a wrong password", () => {
    // Honest-copy discipline: on the master path the password was CORRECT — it
    // was refused because it can trade, not because it was wrong. The copy must
    // not tell the user their password was wrong (that path is KEY_AUTH_FAILED).
    const copy = formatKeyError("KEY_MT5_MASTER_PASSWORD");
    const blob = (copy.title + " " + copy.cause + " " + copy.fix.join(" ")).toLowerCase();
    expect(blob).toContain("investor");
    expect(blob).not.toMatch(/password (was |is )?(wrong|incorrect|invalid)/);
  });
});

// ===========================================================================
// Phase 140 / SEAM-04 — the Class-2 cascade-500.
//
// `classifyKeyValidationError` was a pure substring matcher over `err.message`
// whose terminal branch is `{code:"UNKNOWN", status:500}` — the "something went
// wrong, our team has been notified" envelope. A `CircuitOpenError` thrown by
// the shared resilience core during key-connect matched NO branch, so a Railway
// outage rendered as an unexplained 500 with no retry affordance (the
// DOGFOOD-3-class failure).
//
// The fix is a TYPE check placed BEFORE the substring cascade. These tests pin
// three separate properties, each of which can regress independently:
//   1. the type branch exists and yields a retryable 503;
//   2. it wins over every substring branch (the collision regression);
//   3. it is a TYPE branch, NOT a `lower.includes("circuit")` branch — research
//      Pitfall 2 names a substring match here as the warning sign, because the
//      breaker message is our own static string today but any upstream reword
//      would silently re-open the cascade.
// ===========================================================================
describe("classifyKeyValidationError — Phase 140 CircuitOpenError type branch (SEAM-04)", () => {
  it("classifies a CircuitOpenError as SERVICE_UNAVAILABLE_RETRY with a retryable 503", () => {
    expect(classifyKeyValidationError(new CircuitOpenError(30))).toEqual({
      code: "SERVICE_UNAVAILABLE_RETRY",
      status: 503,
    });
  });

  it("TYPE wins over SUBSTRING: a CircuitOpenError carrying timeout/rate tokens still classifies as SERVICE_UNAVAILABLE_RETRY", () => {
    // The collision regression. If the instanceof branch is ever moved BELOW
    // the substring cascade (or replaced by one), a breaker trip whose message
    // happened to carry "timeout" would be mislabelled KEY_NETWORK_TIMEOUT (502)
    // and one carrying "rate" would become KEY_RATE_LIMIT — both of which tell
    // the user to fix the wrong thing. The class message is static today, so
    // this test forces the tokens in explicitly rather than relying on it.
    const trippedWithTimeout = new CircuitOpenError(15);
    trippedWithTimeout.message = "connect ETIMEDOUT — request timeout";
    expect(classifyKeyValidationError(trippedWithTimeout)).toEqual({
      code: "SERVICE_UNAVAILABLE_RETRY",
      status: 503,
    });

    const trippedWithRate = new CircuitOpenError(15);
    trippedWithRate.message = "rate limit exceeded 429";
    expect(classifyKeyValidationError(trippedWithRate)).toEqual({
      code: "SERVICE_UNAVAILABLE_RETRY",
      status: 503,
    });

    // And the signature branch, which is FIRST in the cascade.
    const trippedWithSignature = new CircuitOpenError(15);
    trippedWithSignature.message = "invalid signature for request";
    expect(classifyKeyValidationError(trippedWithSignature).code).toBe(
      "SERVICE_UNAVAILABLE_RETRY",
    );
  });

  it("is a TYPE branch, not a substring branch: the breaker's own message as a plain string does NOT reach SERVICE_UNAVAILABLE_RETRY", () => {
    // Research Pitfall 2. A `lower.includes("circuit")` branch would pass the
    // two tests above while silently claiming "the service is down" for any
    // upstream string that happens to contain the word. Both call sites thread
    // the error OBJECT, so the string form is unreachable in production — and
    // asserting it stays UNKNOWN is what proves the implementation is
    // type-driven rather than text-driven.
    expect(classifyKeyValidationError("Analytics service circuit is open")).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("classifies a plain Error by its message exactly as the string form does", () => {
    // The signature widened from `string` to `unknown`; Error objects must
    // route through the identical cascade so both call sites can pass the
    // caught value straight through.
    expect(classifyKeyValidationError(new Error("Rate limit exceeded"))).toEqual(
      classifyKeyValidationError("Rate limit exceeded"),
    );
    expect(
      classifyKeyValidationError(new Error("connect ETIMEDOUT 10.0.0.1:443")).code,
    ).toBe("KEY_NETWORK_TIMEOUT");
  });

  it("falls through to UNKNOWN for a non-Error, non-string throw", () => {
    // `throw { foo: 1 }` and `throw undefined` are legal JS. Stringifying keeps
    // the classifier total instead of throwing a second time inside a catch.
    expect(classifyKeyValidationError({ foo: 1 })).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
    expect(classifyKeyValidationError(undefined)).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("renders real, non-UNKNOWN copy for SERVICE_UNAVAILABLE_RETRY with a retry affordance", () => {
    expect(Object.keys(WIZARD_ERROR_COPY)).toContain("SERVICE_UNAVAILABLE_RETRY");
    const copy = formatKeyError("SERVICE_UNAVAILABLE_RETRY");
    expect(copy.title).not.toBe(WIZARD_ERROR_COPY.UNKNOWN.title);
    expect(copy.cause).not.toBe(WIZARD_ERROR_COPY.UNKNOWN.cause);
    // The whole point of the code: a Retry control must render. Without
    // clear_and_retry the user gets an outage message and no way to act on it.
    expect(copy.actions).toContain("clear_and_retry");
    // No un-interpolated placeholder tokens leaked into user-facing copy.
    expect(copy.title).not.toMatch(/\{.*\}/);
    expect(copy.cause).not.toMatch(/\{.*\}/);
  });

  it("copy is honest about the key NOT being saved and leaks no internals (T-140-14)", () => {
    const copy = formatKeyError("SERVICE_UNAVAILABLE_RETRY");
    const blob = `${copy.title} ${copy.cause} ${copy.fix.join(" ")}`;
    // Honest-copy discipline: the breaker short-circuits BEFORE any request is
    // issued, so the user must be told explicitly that nothing landed —
    // otherwise a retry looks like it risks a duplicate.
    //
    // ⚠️ RE-POINTED by 140.3-12, NOT relaxed. This used to require the words
    // "not saved"/"not stored". 140.3-05 aliased the wire code CIRCUIT_OPEN
    // onto this member, so it is now also reached at FINALIZE — where the key
    // WAS stored several steps earlier, making the storage claim false on the
    // newer of its two paths. The claim that is true on BOTH paths, and the one
    // that actually answers "will retrying duplicate something?", is that
    // nothing was SUBMITTED. That is what is required now.
    expect(
      blob.toLowerCase(),
      "The user must still be told nothing landed; only the WORDING moved " +
        "from storage to submission, because storage is path-dependent here.",
    ).toMatch(/nothing was submitted|never sent/);
    // ...and the stale claim must not come back. This is the half that makes
    // the re-point a strengthening rather than a swap.
    expect(
      blob.toLowerCase(),
      "False at finalize, where the key was stored several steps earlier.",
    ).not.toMatch(/key (has )?not (been )?(saved|stored)/);
    // It must also not blame the user's key for an outage on our side.
    expect(blob.toLowerCase()).not.toMatch(/your key (is|was) (invalid|wrong|bad)/);
    // T-140-14: no upstream infrastructure detail reaches the wizard.
    expect(blob).not.toMatch(/circuit|breaker|upstash|redis|railway|http|localhost/i);
  });
});

/**
 * [140.3-01 / TS-09] The two seam codes the wizard could not name.
 *
 * THE SPLIT, STATED SO NEITHER PLAN ASSUMES THE OTHER DID IT. A union member is
 * a TYPE and lands here. A copy string is a RENDER and belongs to 140.3's copy
 * plan, alongside TS-35, so that copy is designed once against the whole
 * surface rather than one site at a time. `WIZARD_ERROR_COPY` is a
 * `Record<WizardErrorCode, …>`, so a member without an entry does not
 * type-check — hence a minimal, explicitly NON-FINAL entry, marked in-file with
 * the hand-off token `TODO-COPY-140.3-12`.
 *
 * ⚠️ Both codes are DISTINCT from members the union already had.
 * `KEY_RATE_LIMIT` is the wizard's own classification of an EXCHANGE throttle
 * reached through the substring cascade; `RATE_LIMITED` is the seam's machine
 * code from the app-global `RateLimitExceeded` handler. `CSV_VALIDATION_FAILED`
 * is a CSV-branch code; `VALIDATION_FAILED` is the seam's `RequestValidationError`
 * code. Conflating either pair would render a CSV message for a 422 on the API
 * path, or blame an exchange for our own limiter.
 */
describe("[140.3-01 / TS-09] seam machine codes are recognised, not collapsed to UNKNOWN", () => {
  it("VALIDATION_FAILED and RATE_LIMITED are WizardErrorCode members with a copy entry", () => {
    // Word-boundary, so the pre-existing CSV_VALIDATION_FAILED and
    // KEY_RATE_LIMIT members cannot satisfy this by substring.
    const codes = Object.keys(WIZARD_ERROR_COPY);
    expect(codes).toContain("VALIDATION_FAILED");
    expect(codes).toContain("RATE_LIMITED");
    // The neighbours they must not be confused with are still there.
    expect(codes).toContain("CSV_VALIDATION_FAILED");
    expect(codes).toContain("KEY_RATE_LIMIT");
  });

  it("the recognition branch maps an incoming RATE_LIMITED to its member, not UNKNOWN", () => {
    expect(
      recogniseSeamErrorCode("RATE_LIMITED"),
      "A seam code that has a wizard member must never fall through to " +
        "UNKNOWN — that is the 'something went wrong, our team has been " +
        "notified' dead end this obligation exists to close.",
    ).toBe("RATE_LIMITED");
  });

  it("the recognition branch maps an incoming VALIDATION_FAILED to its member, not UNKNOWN", () => {
    expect(recogniseSeamErrorCode("VALIDATION_FAILED")).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("an unrecognised, absent, or prototype-shaped code answers UNKNOWN", () => {
    expect(recogniseSeamErrorCode("SEAM_DEGRADED")).toBe("UNKNOWN");
    expect(recogniseSeamErrorCode(null)).toBe("UNKNOWN");
    expect(recogniseSeamErrorCode(undefined)).toBe("UNKNOWN");
    // The lookup must not be a plain-object index: the body arrives over the
    // wire, so `"constructor"` / `"toString"` would resolve to an inherited
    // Function and be returned as if it were a WizardErrorCode.
    expect(recogniseSeamErrorCode("constructor")).toBe("UNKNOWN");
    expect(recogniseSeamErrorCode("toString")).toBe("UNKNOWN");
    expect(recogniseSeamErrorCode("__proto__")).toBe("UNKNOWN");
  });

  it("the hand-off token is fully consumed — 140.3-12 closed all five entries", () => {
    // ⚠️ THIS TOKEN IS THE HAND-OFF MECHANISM, NOT DECORATION. 140.3-12 closed
    // these entries by grepping the token to 0; without the token that plan's
    // closing criterion would have been vacuous and the copy silently never
    // written. Asserted here rather than only in a shell so the hand-off is
    // falsifiable in CI.
    //
    // ⚠️ WAS `toBe(5)`, NOW `toBe(0)` — the CLOSING half of the same two-sided
    // check, not a weakened assertion. The 5 was measured on the untouched tree
    // and reconciled against 140.3-05's `## Marker accounting` (2 from
    // 140.3-01 + 3 from 140.3-05) BEFORE any copy was authored. Both numbers
    // together are what make this a check.
    //
    // The bare word "placeholder" is deliberately NOT the marker: this file
    // already contains it three times (a live `SIZE_MB_PLACEHOLDER` constant
    // used for file-size interpolation, plus two docblocks), so a generic grep
    // would be unsatisfiable without deleting working code.
    const source = readFileSync(join(__dirname, "wizardErrors.ts"), "utf-8");
    const matches = source.match(/TODO-COPY-140\.3-12/g) ?? [];
    expect(
      matches.length,
      "All five non-final entries (140.3-01: VALIDATION_FAILED, RATE_LIMITED; " +
        "140.3-05: SERVICE_UNREACHABLE, KEY_EXCHANGE_UNAVAILABLE, " +
        "KEY_VENUE_TRANSIENT) now carry final copy. A marker reappearing means " +
        "a member was added with placeholder copy and no owner — put the " +
        "owning plan's id in the token and re-pin this count to it, so the " +
        "next copy owner inherits a number instead of silence.",
    ).toBe(0);
    // The live interpolation machinery is untouched — it is not a copy marker.
    expect((source.match(/SIZE_MB_PLACEHOLDER/g) ?? []).length).toBe(3);
  });
});

/**
 * [140.3-05 / SEAMUX-01] The wire codes the wizard could not name.
 *
 * THE ONE DECISION, PINNED HERE. `CIRCUIT_OPEN` is a WIRE code emitted by three
 * production sites; it is deliberately NOT a `WizardErrorCode`, because
 * `SERVICE_UNAVAILABLE_RETRY` already means exactly "the breaker is open, we
 * declined to try, nothing was submitted". It is an ALIAS in the ONE wire→wizard
 * table. These cases are what stops a later reader from "fixing" that by minting
 * a second member with the same meaning.
 *
 * The two transport codes are the CLASS half. `process-key-client` emits
 * `CIRCUIT_OPEN`, `UPSTREAM_TIMEOUT` and `UPSTREAM_NETWORK_ERROR`, and
 * `finalize-wizard` forwards all three verbatim. Naming only the breaker would
 * leave two siblings from the same helper on the "our team has been notified"
 * dead end — the instance-fix signature this programme keeps hitting.
 */
describe("[140.3-05 / SEAMUX-01] the seam's outage wire codes translate onto real members", () => {
  it("CIRCUIT_OPEN aliases onto SERVICE_UNAVAILABLE_RETRY rather than minting a second member", () => {
    expect(
      recogniseSeamErrorCode("CIRCUIT_OPEN"),
      "A breaker trip must reach the member whose copy already says the pause " +
        "is on our side and nothing was submitted.",
    ).toBe("SERVICE_UNAVAILABLE_RETRY");
    // …and the alias did NOT become a union member of its own. Two codes with
    // one meaning is how a vocabulary starts lying, and PostHog `wizard_error
    // {code}` values are contractually stable.
    expect(Object.keys(WIZARD_ERROR_COPY)).not.toContain("CIRCUIT_OPEN");
  });

  it("both of process-key-client's transport codes translate onto SERVICE_UNREACHABLE", () => {
    expect(recogniseSeamErrorCode("UPSTREAM_TIMEOUT")).toBe(
      "SERVICE_UNREACHABLE",
    );
    expect(recogniseSeamErrorCode("UPSTREAM_NETWORK_ERROR")).toBe(
      "SERVICE_UNREACHABLE",
    );
  });

  it("SERVICE_UNREACHABLE renders real, non-UNKNOWN copy with a retry affordance", () => {
    expect(Object.keys(WIZARD_ERROR_COPY)).toContain("SERVICE_UNREACHABLE");
    const copy = formatKeyError("SERVICE_UNREACHABLE");
    expect(copy.title).not.toBe(WIZARD_ERROR_COPY.UNKNOWN.title);
    expect(copy.cause).not.toBe(WIZARD_ERROR_COPY.UNKNOWN.cause);
    // `actions` is a BEHAVIOUR decision, not a copy decision: it drives
    // `recoverable` in src/lib/envelope.ts, which drives whether a Retry
    // control renders at all. A request that never reached us is retryable.
    expect(copy.actions).toContain("clear_and_retry");
    // It must not blame the key or the exchange for a fault on our own hop.
    expect(copy.actions).not.toContain("try_another_key");
    const blob = `${copy.title} ${copy.cause} ${copy.fix.join(" ")}`;
    expect(blob).not.toMatch(/circuit|breaker|upstash|redis|railway|http|localhost/i);
  });

  it("a code that merely LOOKS like a wire code is not admitted", () => {
    // The table is closed and hand-typed: an upstream-supplied string selects a
    // verdict ONLY by exact membership. No prefix match, no normalisation.
    expect(recogniseSeamErrorCode("CIRCUIT_OPEN_BUT_NOT_REALLY")).toBe(
      "UNKNOWN",
    );
    expect(recogniseSeamErrorCode("circuit_open")).toBe("UNKNOWN");
  });
});

/**
 * [140.3-05 / TS-35] `classifyKeyValidationError` reads the machine code before
 * it sniffs the human string.
 *
 * These are UNIT cases over hand-built throwables. The cross-language half —
 * the same classifier driven over the COMMITTED Python contract bytes — is
 * `tests/lib/validate-key-venue-transient-parity.test.ts`. Both exist on
 * purpose: this file pins the branch's SHAPE (ordering, fall-through, the
 * property read), the parity file pins its AGREEMENT with the other language.
 *
 * The messages below are the byte-identical wire copy from
 * `analytics-service/tests/fixtures/validate_key_venue_transient_contract.json`,
 * typed here as literals. They are what make the "without the code branch this
 * lands somewhere else" claim checkable rather than asserted.
 */
describe("[140.3-05 / TS-35] the wire code decides before the substring cascade does", () => {
  /** A seam client throw: a plain Error carrying the own `seamCode` property. */
  function seamThrow(message: string, seamCode: string): Error {
    return Object.assign(new Error(message), { seamCode });
  }

  it("EXCHANGE_UNAVAILABLE no longer falls through to UNKNOWN/500", () => {
    const verdict = classifyKeyValidationError(
      seamThrow(
        "Exchange is currently unavailable. Try again in a few minutes.",
        "EXCHANGE_UNAVAILABLE",
      ),
    );
    expect(
      verdict.code,
      "A venue maintenance window rendered as 'something went wrong, our team " +
        "has been notified' with no retry affordance — the DOGFOOD-3 dead end.",
    ).toBe("KEY_EXCHANGE_UNAVAILABLE");
    expect(verdict.status).toBe(503);
    // The same message with NO code still lands where it always did. This is
    // what proves the code — not a reworded predicate — moved the verdict.
    expect(
      classifyKeyValidationError(
        new Error("Exchange is currently unavailable. Try again in a few minutes."),
      ),
    ).toEqual({ code: "UNKNOWN", status: 500 });
  });

  it("NETWORK_UNAVAILABLE no longer falls through to UNKNOWN/500", () => {
    expect(
      classifyKeyValidationError(
        seamThrow(
          "Network error reaching the exchange. Check connectivity and try again.",
          "NETWORK_UNAVAILABLE",
        ),
      ),
    ).toEqual({ code: "KEY_NETWORK_TIMEOUT", status: 502 });
    expect(
      classifyKeyValidationError(
        new Error(
          "Network error reaching the exchange. Check connectivity and try again.",
        ),
      ),
    ).toEqual({ code: "UNKNOWN", status: 500 });
  });

  it("a venue WAF block (DDOS_PROTECTION) is no longer rendered as the user's own IP allowlist", () => {
    // ⚠️ THE MEMBER THE ORIGINAL ENUMERATION MISSED (correction C-6). This one
    // never reached UNKNOWN, so an audit asking "does it fall through?" could
    // not see it: the detail ends "Check region / IP allowlist." and the
    // cascade's fifth branch tests for `ip` AND `allow`, so a block at the
    // VENUE's edge was rendered as "This key has an IP allowlist that does not
    // include Quantalyze" and the user was sent to edit a key that was never
    // the problem.
    const detail =
      "Exchange blocked the validation request at the edge (DDoS / WAF protection). Check region / IP allowlist.";
    const verdict = classifyKeyValidationError(
      seamThrow(detail, "DDOS_PROTECTION"),
    );
    expect(verdict.code).toBe("KEY_VENUE_TRANSIENT");
    expect(
      verdict.code,
      "A venue edge block must never be presented as a fault in the user's key.",
    ).not.toBe("KEY_IP_ALLOWLIST");
    expect(verdict.status).toBe(503);
    // The mis-map is real, not hypothetical: the identical message with no
    // machine code STILL reaches KEY_IP_ALLOWLIST through the cascade. That is
    // the cascade surviving as the documented fallback, and it is also the
    // measurement of what the code branch bought.
    expect(classifyKeyValidationError(new Error(detail))).toEqual({
      code: "KEY_IP_ALLOWLIST",
      status: 502,
    });
    // And the copy the new code renders must not re-attach the allowlist
    // instruction the old verdict carried.
    const copy = formatKeyError("KEY_VENUE_TRANSIENT");
    const blob = `${copy.title} ${copy.cause} ${copy.fix.join(" ")}`;
    expect(blob.toLowerCase()).not.toMatch(/allowlist|allow list|ip restriction/);
  });

  it("the three verdicts the cascade already got right are unchanged", () => {
    expect(
      classifyKeyValidationError(
        seamThrow(
          "Exchange rate-limited the validation request. Wait a moment and try again — repeated failures may indicate a missing read scope.",
          "RATE_LIMITED",
        ),
      ),
    ).toEqual({ code: "KEY_RATE_LIMIT", status: 503 });
    expect(
      classifyKeyValidationError(
        seamThrow(
          "Could not verify the key's permission scopes — the permission probe failed. Try again in a moment.",
          "PROBE_FAILED",
        ),
      ),
    ).toEqual({ code: "KEY_PROBE_FAILED", status: 503 });
    expect(
      classifyKeyValidationError(
        seamThrow(
          "Authentication failed. Check your API key and secret.",
          "AUTH_FAILED",
        ),
      ),
    ).toEqual({ code: "KEY_AUTH_FAILED", status: 400 });
  });

  it("an unrecognised wire code falls through to the cascade, then to UNKNOWN", () => {
    // The contract ships this control precisely so the closed table is proven
    // closed. It must NOT short-circuit to UNKNOWN above the cascade — a code
    // minted after this table was written still earns whatever its human
    // string can.
    expect(
      classifyKeyValidationError(
        seamThrow(
          "A synthetic verdict from a venue code this router has never seen.",
          "ZZ_UNRECOGNISED_VENUE_CODE",
        ),
      ),
    ).toEqual({ code: "UNKNOWN", status: 500 });
    // Fall-through, not short-circuit: an unrecognised code on a message the
    // cascade CAN read keeps the cascade's answer.
    expect(
      classifyKeyValidationError(
        seamThrow("connect ETIMEDOUT 10.0.0.1:443", "ZZ_UNRECOGNISED_VENUE_CODE"),
      ),
    ).toEqual({ code: "KEY_NETWORK_TIMEOUT", status: 502 });
  });

  it("the breaker type check still wins over any wire code an upstream can set", () => {
    // Ordering, asserted rather than assumed. A hostile or confused body must
    // not be able to relabel a breaker trip: the type check is above the lookup
    // and stays there.
    const breaker = Object.assign(new CircuitOpenError(30), {
      seamCode: "AUTH_FAILED",
    });
    expect(classifyKeyValidationError(breaker)).toEqual({
      code: "SERVICE_UNAVAILABLE_RETRY",
      status: 503,
    });
  });

  it("a non-string seamCode is ignored and never indexes the table", () => {
    // The property arrives over the wire. `typeof === "string"` is the guard;
    // without it a `{}` or a number would reach `.get()` and, on a plain
    // object, `"constructor"` would resolve to an inherited Function.
    for (const bogus of [42, {}, null, ["AUTH_FAILED"], () => "AUTH_FAILED"]) {
      expect(
        classifyKeyValidationError(
          Object.assign(new Error("nothing the cascade can read"), {
            seamCode: bogus,
          }),
        ),
      ).toEqual({ code: "UNKNOWN", status: 500 });
    }
    // A prototype-shaped string is a miss, not a Function.
    expect(
      classifyKeyValidationError(
        Object.assign(new Error("nothing the cascade can read"), {
          seamCode: "constructor",
        }),
      ),
    ).toEqual({ code: "UNKNOWN", status: 500 });
  });

  it("the copy hand-off is CLOSED — every TODO-COPY marker was consumed by 140.3-12", () => {
    // ⚠️ THIS ASSERTION WAS `toBe(5)` AND IS NOW `toBe(0)`. That is the CLOSING
    // half of a two-sided check, not a weakened one. The pre-value was measured
    // on the untouched tree and reconciled against 140.3-05's recorded
    // `## Marker accounting` before a single string was edited:
    //
    //   2 (140.3-01: VALIDATION_FAILED, RATE_LIMITED)
    //     + 3 (140.3-05: SERVICE_UNREACHABLE, KEY_EXCHANGE_UNAVAILABLE,
    //          KEY_VENUE_TRANSIENT)
    //     = 5, measured 5, then authored to 0.
    //
    // It stays EXACT rather than "at or below": a future plan that adds a union
    // member with non-final copy MUST re-open this to its own count, so that
    // the next copy owner inherits a number instead of silence. A `toBeLessThan`
    // here would let an unmarked, copy-less member ship with every check green.
    const source = readFileSync(join(__dirname, "wizardErrors.ts"), "utf-8");
    expect(
      (source.match(/TODO-COPY-140\.3-12/g) ?? []).length,
      "Every entry 140.3-01 and 140.3-05 left non-final is now authored. A " +
        "marker reappearing means a member was added with placeholder copy and " +
        "no owner — name the owning plan in the token before landing it.",
    ).toBe(0);
    // 140.3-01's two TITLES are unchanged by the copy pass and are pinned here
    // so "authored" cannot be satisfied by deleting the entries outright.
    expect(source).toContain("You have reached our request limit.");
    expect(source).toContain("We could not read that request.");
  });

  it("the substring cascade is still the fallback — it was not deleted", () => {
    // TS-35 is explicit: keep the cascade until every emitter carries a code,
    // or the class re-opens from the other side. Every one of these throws
    // carries NO machine code and must still be classified.
    expect(classifyKeyValidationError("Invalid signature").code).toBe(
      "KEY_INVALID_SIGNATURE",
    );
    expect(classifyKeyValidationError("MT5 master password detected").code).toBe(
      "KEY_MT5_MASTER_PASSWORD",
    );
    expect(classifyKeyValidationError("Rate limit exceeded").code).toBe(
      "KEY_RATE_LIMIT",
    );
    expect(
      classifyKeyValidationError("Could not verify the key's permission scopes").code,
    ).toBe("KEY_PROBE_FAILED");
  });

  // -------------------------------------------------------------------------
  // 140.3-09 / SEAMUX-06 — `WizardErrorContext.retryAfterSeconds`.
  //
  // The context field is the ONE place the unit decision (seconds) is made.
  // These cases pin that the field is inert with respect to COPY: this plan
  // adds a channel, not a sentence. 140.3-12 owns every sentence that will use
  // it, and a copy edit smuggled in here would be invisible to that plan.
  // -------------------------------------------------------------------------
  describe("[140.3-09 / SEAMUX-06] retryAfterSeconds is a channel, not copy", () => {
    it("supplying a wait does not alter any rendered string", () => {
      const without = formatKeyError("KEY_RATE_LIMIT");
      const with_ = formatKeyError("KEY_RATE_LIMIT", { retryAfterSeconds: 90 });
      expect(with_.title).toBe(without.title);
      expect(with_.cause).toBe(without.cause);
      expect(with_.fix).toEqual(without.fix);
      expect(with_.actions).toEqual(without.actions);
    });

    it("no copy entry interpolates the wait — 140.3-12 owns that sentence", () => {
      // Hand-typed literal, not a read of the table under test. If a future
      // edit interpolates the number into KEY_RATE_LIMIT's cause, this reddens
      // and the copy plan's hand-off is forced to be explicit.
      const result = formatKeyError("KEY_RATE_LIMIT", {
        retryAfterSeconds: 90,
      });
      expect(result.cause).toBe(
        "The exchange asked us to slow down. This is a transient, exchange-side throttle and not a problem with your key.",
      );
      expect(result.cause).not.toContain("90");
      expect(result.title).not.toContain("90");
      expect(result.fix.join(" ")).not.toContain("90");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 153.7-02 / WIZFORM-02-CLASS — the EIGHT analytics-service codes that
// reach `classifyKeyValidationError` and had no verdict row.
//
// ⭐ WHY THESE EIGHT AND NOT THE TWENTY. 153.7-01 widened the Python emitter
// scan (root `analytics-service/**`, plus the `service_error(...)` /
// `service_error_body(...)` / `service_error_response(...)` /
// `VenueTransientHTTPException(code=…)` call shapes) from 17 codes to 37, and
// left 20 with no disposition. Twelve of the twenty render through a DIFFERENT
// classifier and take a reasoned `VENUE_WIRE_CODES_WITHOUT_VERDICT` row. These
// eight are raised inside `validate_key` / `encrypt_key` (`routers/exchange.py`)
// or by the `verify_service_key` HTTP middleware (`main.py`), all of which sit
// under the `try` that `create-with-key` and `composite/add-key` catch — so
// every one of them arrives at this classifier as `err.seamCode`.
//
// ⭐ THE MEASURED HARM, recorded here because it is what these cases exist to
// stop regressing: at 153.7-01's HEAD all eight replays below answered
// `{ code: "UNKNOWN", status: 500 }` — the terminal that admits knowing nothing
// — and `ConnectKeyStep` / `MultiKeyConnectStep` rendered "We could not
// classify this failure" for a fault the server had classified precisely. The
// eight-code family is NOT MT5-specific: `EXCHANGE_PROBE_FAILED` is a 424 with
// `retryable=True` and `dependency=<the caller's venue>` on EVERY venue.
//
// ⚠️ THE MESSAGES BELOW ARE THE REAL PYTHON `detail=` ARGUMENTS, byte-copied
// from their emitters, and each case carries a NO-CODE CONTROL asserting the
// same sentence still lands where the substring cascade puts it. That control
// is what makes "the machine code moved the verdict" checkable instead of
// asserted — the same construction the 140.3-05 block above uses.
// ══════════════════════════════════════════════════════════════════════════
describe("[153.7-02 / WIZFORM-02-CLASS] every code that reaches classifyKeyValidationError has a verdict", () => {
  /** A seam client throw: a plain Error carrying the own `seamCode` property. */
  function seamThrow(message: string, seamCode: string): Error {
    return Object.assign(new Error(message), { seamCode });
  }

  it("MT5_GATEWAY_UNCONFIGURED renders the permanent our-side fault, not UNKNOWN/500", () => {
    // Four emitters, all reached from `validate_key`: the unset-env and
    // malformed-port arms of `_validate_mt5_key_probe`, the D-24 IPC ordering
    // inversion inside `_connect_and_probe`, and the D-31 `undetermined`
    // refusal when the gateway terminal has trade permission off. All four are
    // `retryable=False` — an operator must act, so no retry affordance may
    // render.
    const detail =
      "The MetaTrader gateway is not configured. This needs an operator, not a retry.";
    expect(classifyKeyValidationError(seamThrow(detail, "MT5_GATEWAY_UNCONFIGURED"))).toEqual({
      code: "SEAM_INTERNAL_FAULT",
      status: 500,
    });
    // NO-CODE CONTROL: the cascade cannot read this sentence, so the verdict
    // above is the table's doing and not a reworded predicate's.
    expect(classifyKeyValidationError(new Error(detail))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("MT5_GATEWAY_UNREACHABLE renders the no-answer verdict, never the breaker's", () => {
    // Two emitters, both in `_connect_and_probe`: the connect-stage
    // `asyncio.TimeoutError` and the broad connect failure. `retryable=True`
    // with a Retry-After. ⛔ NEVER `SERVICE_UNAVAILABLE_RETRY` — its copy says
    // "this request was never sent", which is knowable for a breaker that
    // DECLINED to send and false-by-construction here, where the connect WAS
    // attempted. `classifyKeyValidationError`'s own transport block writes that
    // trap down; this row is the case that proves it was obeyed.
    const detail = "The MetaTrader gateway is not responding. Try again shortly.";
    const verdict = classifyKeyValidationError(
      seamThrow(detail, "MT5_GATEWAY_UNREACHABLE"),
    );
    expect(verdict).toEqual({ code: "SERVICE_UNREACHABLE", status: 503 });
    expect(
      verdict.code,
      "A request that WAS issued must never be told nothing was submitted.",
    ).not.toBe("SERVICE_UNAVAILABLE_RETRY");
    expect(classifyKeyValidationError(new Error(detail))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("EGRESS_PROXY_MISCONFIGURED renders the stopped-before-sending verdict", () => {
    // `_validate_sfox_key`: `make_sfox_client` raises at CONSTRUCTION, above
    // the `get_balances()` try, so no request left the process and nothing
    // changed. That is what makes SEAM_MISCONFIGURED's "we stopped before
    // sending the request. Nothing was submitted and nothing was changed"
    // knowable here rather than assumed.
    const detail =
      "The service's outbound proxy is misconfigured. This needs an operator, not a retry.";
    expect(classifyKeyValidationError(seamThrow(detail, "EGRESS_PROXY_MISCONFIGURED"))).toEqual({
      code: "SEAM_MISCONFIGURED",
      status: 500,
    });
    expect(classifyKeyValidationError(new Error(detail))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("SERVICE_KEY_UNCONFIGURED renders the stopped-before-sending verdict", () => {
    // `verify_service_key` is Starlette HTTP middleware and refuses BEFORE
    // `call_next`, so no handler ran, no venue was contacted and no row was
    // written. ⚠️ This is a RENDERING disposition only — the gate itself is
    // untouched, and the copy names a remedy rather than the secret.
    const detail = "Service not configured";
    expect(classifyKeyValidationError(seamThrow(detail, "SERVICE_KEY_UNCONFIGURED"))).toEqual({
      code: "SEAM_MISCONFIGURED",
      status: 500,
    });
    expect(classifyKeyValidationError(new Error(detail))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("KEK_UNAVAILABLE renders the stopped-before-sending verdict", () => {
    // `encrypt_key`'s first statement is `get_kek()`; its RuntimeError fires
    // before any ciphertext exists and before the storage RPC is reached, so
    // nothing was submitted and nothing was changed.
    const detail =
      "Credential encryption is not configured. This needs an operator, not a retry.";
    expect(classifyKeyValidationError(seamThrow(detail, "KEK_UNAVAILABLE"))).toEqual({
      code: "SEAM_MISCONFIGURED",
      status: 500,
    });
    expect(classifyKeyValidationError(new Error(detail))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("EXCHANGE_PROBE_FAILED — the venue-agnostic 424 — renders the probe verdict", () => {
    // `validate_key`'s `except ccxt.BaseError` arm: a venue-attributable escape
    // from `validate_key_permissions`, 424, `retryable=True`,
    // `dependency=req.exchange`. Same verdict and status as the incumbent
    // `PROBE_FAILED` row, because it is the same fact told by a different
    // producer.
    const detail =
      "Your exchange did not complete the permission check. This is a problem at the venue — try again shortly.";
    expect(classifyKeyValidationError(seamThrow(detail, "EXCHANGE_PROBE_FAILED"))).toEqual({
      code: "KEY_PROBE_FAILED",
      status: 503,
    });
    expect(classifyKeyValidationError(new Error(detail))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("ADAPTER_INIT_FAILED renders the permanent our-side fault", () => {
    // `validate_key`'s `create_exchange` catch. The emitter's own comment
    // measures the property this verdict rests on: `create_exchange` is a dict
    // lookup, a dict build and two attribute sets — ZERO network I/O — so a
    // ccxt signature change, a missing extra or an OOM is OURS and permanent.
    const detail =
      "Something went wrong on our side while opening this connection. Nothing is wrong with your key.";
    expect(classifyKeyValidationError(seamThrow(detail, "ADAPTER_INIT_FAILED"))).toEqual({
      code: "SEAM_INTERNAL_FAULT",
      status: 500,
    });
    expect(classifyKeyValidationError(new Error(detail))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("INTERNAL renders the permanent our-side fault, never a transient-upstream sentence", () => {
    // `validate_key`'s generic escape from `validate_key_permissions`. The
    // venue probe HAD been issued, so no "we stopped before sending" copy may
    // carry it; and `retryable=False`, so no "transient upstream issue" copy
    // may either — `KEY_PROBE_FAILED` would render a Retry control against a
    // fault that fails identically on every attempt.
    const detail =
      "Something went wrong on our side while checking this key. Nothing is wrong with your key.";
    const verdict = classifyKeyValidationError(seamThrow(detail, "INTERNAL"));
    expect(verdict).toEqual({ code: "SEAM_INTERNAL_FAULT", status: 500 });
    expect(
      verdict.code,
      "A permanent fault in our own code must not be dressed as a transient " +
        "upstream blip with a Retry control.",
    ).not.toBe("KEY_PROBE_FAILED");
    expect(classifyKeyValidationError(new Error(detail))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("none of the eight verdicts offers a control that cannot work", () => {
    // ⭐ THE BEHAVIOURAL HALF, derived rather than restated: `buildEnvelope`
    // decides `recoverable` from `actions` against `RECOVERABLE_ACTIONS`, and
    // `ErrorEnvelope` renders Retry iff `recoverable && onRetry`. The four
    // permanent codes are `retryable=False` at their emitters, so a Retry
    // control on them is a false affordance — the 2026-08-08 defect the founder
    // hit. The two transient ones must keep theirs.
    for (const code of ["SEAM_MISCONFIGURED", "SEAM_INTERNAL_FAULT"] as const) {
      expect(
        buildEnvelope(code as WizardErrorCode, "corr-153-7").recoverable,
        `${code} is raised with retryable=False upstream; a Retry control cannot clear it.`,
      ).toBe(false);
    }
    for (const code of ["SERVICE_UNREACHABLE", "KEY_PROBE_FAILED"] as const) {
      expect(
        buildEnvelope(code as WizardErrorCode, "corr-153-7").recoverable,
        `${code} is raised with retryable=True upstream; the Retry control must stay.`,
      ).toBe(true);
    }
  });

  /**
   * ⭐ 153.7 review WR-01 — THE MEMBER'S OWN RULE, APPLIED TO ITS OWN COPY.
   *
   * `wizardErrors.ts`' union comment states the rule that picked this member:
   * *take the MOST SPECIFIC member every one of whose claims is true at EVERY
   * emitter*. `SEAM_INTERNAL_FAULT` shipped breaking it one clause down — it
   * predicted *"Retrying will not clear it: the same fault runs again until we
   * fix it"* across three wire codes where that is true at ONE:
   *
   *   · `MT5_GATEWAY_UNCONFIGURED` — true (operator faults, all four emitters).
   *   · `ADAPTER_INIT_FAILED` — FALSE at a third of the emitter's OWN declared
   *     cause set: `routers/exchange.py` enumerates "a ccxt signature change,
   *     an ImportError on a missing extra or an **OOM**". An OOM clears.
   *   · `INTERNAL` — UNKNOWABLE: `validate_key_permissions`' bare
   *     `except Exception` residue, open by construction.
   *
   * ⛔ THE REMEDY IS NOT A RETRY CONTROL, and this test asserts that too. The
   * CLASSIFICATION was right — all three are `retryable=False` upstream, and
   * `recoverable` is DERIVED from `actions` carrying neither member of
   * `RECOVERABLE_ACTIONS`. Only the PREDICTION was wrong. A "fix" that answered
   * this test by adding `clear_and_retry` would re-open the 2026-08-08 defect
   * (a control the founder clicked five times against a fault that cannot clear
   * by itself), so the recoverable half is pinned in the same case.
   *
   * ⛔ AND IT IS NOT A PINNED SENTENCE. The assertion is over a hand-typed
   * PHRASE CLASS, not over the copy we happen to ship, so a reword that keeps
   * the honest meaning stays green and a reword that re-introduces the
   * prediction reds. The POSITIVE CONTROL is what makes that checkable:
   * `SEAM_MISCONFIGURED` legitimately claims permanence — its emitter really is
   * a setting that stays wrong until we redeploy, true at every one of its
   * emitters — so the same predicate MUST flag it. If the control ever goes
   * quiet, the predicate stopped matching and the negative half below became
   * vacuous.
   */
  it("[WR-01] SEAM_INTERNAL_FAULT never predicts that a retry cannot help — and still offers no Retry", () => {
    // Hand-typed, lower-cased. Each is a claim about what a FUTURE attempt
    // would do — the class of sentence no member homing an `except Exception`
    // residue or an OOM-capable emitter may make.
    const PERMANENCE_PREDICTIONS = [
      "will not clear it",
      "will not clear this",
      "the same fault runs again",
      "fails identically",
      "retrying will not",
      "trying again will not",
      "will fail again",
      "cannot succeed",
    ] as const;

    const phrasesIn = (code: WizardErrorCode): string[] => {
      const copy = WIZARD_ERROR_COPY[code];
      const haystack = [copy.title, copy.cause ?? "", ...(copy.fix ?? [])]
        .join("   ")
        .toLowerCase();
      return PERMANENCE_PREDICTIONS.filter((p) => haystack.includes(p));
    };

    // POSITIVE CONTROL FIRST — the predicate is live, and the phrase list is
    // not a list of sentences nobody writes.
    expect(
      phrasesIn("SEAM_MISCONFIGURED"),
      "The permanence-prediction predicate matched NOTHING in SEAM_MISCONFIGURED, " +
        "whose copy legitimately says 'Retrying will not clear it: the setting " +
        "stays wrong until we fix it and redeploy.' The predicate has gone " +
        "blind, so the assertion below is passing for the wrong reason. ⛔ Fix " +
        "the phrase list, never delete this control.",
    ).not.toEqual([]);

    expect(
      phrasesIn("SEAM_INTERNAL_FAULT"),
      "SEAM_INTERNAL_FAULT's copy predicts what a second attempt would do. It " +
        "homes THREE wire codes and the prediction is true at ONE of them: " +
        "ADAPTER_INIT_FAILED's own emitter comment names an OOM among its " +
        "causes (an OOM clears on retry), and INTERNAL is validate_key_" +
        "permissions' bare `except Exception` residue, whose content is open by " +
        "construction. That is the SAME true-at-three-of-four defect this member " +
        "was minted to avoid. ⛔ THE REMEDY IS TO STOP PREDICTING — say the " +
        "fault is ours and that no key was stored — NOT to add a Retry control, " +
        "which the next assertion forbids.",
    ).toEqual([]);

    // The half that must NOT move. `recoverable` is derived, so this reds if a
    // reader "fixes" the sentence above by making the fault retryable.
    expect(
      buildEnvelope("SEAM_INTERNAL_FAULT", "corr-wr-01").recoverable,
      "All three wire codes are retryable=False at the emitter. Removing the " +
        "false PREDICTION does not make the fault recoverable, and a Retry " +
        "control here is the 2026-08-08 defect returning.",
    ).toBe(false);

    // And the measured half stays verbatim: the write was never reached, which
    // both key routes' pre-RPC assertions pin.
    expect(
      WIZARD_ERROR_COPY.SEAM_INTERNAL_FAULT.cause,
      "The 'no key was stored' claim is MEASURED (validateKey precedes " +
        "encryptKey and the create RPC on both key routes) and is the only " +
        "thing this card can promise. Do not lose it while rewording.",
    ).toContain("no key was stored");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 140.3-10 / TRAP-4 — no error state offers a destructive control as its
// only way forward.
//
// ⚠️ WRITTEN OVER THE TABLE, NOT OVER A LIST, and that is the whole point.
// `140.3-RESEARCH.md` Q5 gives the `start_fresh` class as "3 of 3". The table
// carries FOUR: `DRAFT_ALREADY_EXISTS`, `GATE_NO_DATA_SOURCE`,
// `GATE_DRAFT_GONE` and — missing from the research table — `GUARD_BLOCKED`.
// A guard enumerated from a document's list would have shipped covering three
// of four and would never catch the fifth member a future plan adds. That is
// the "3 of 5 log sites" defect class this programme exists to close, applied
// to its own guards.
//
// M66 is the falsifier: give the code the `keys/sync` denial maps to an
// `actions: ["start_fresh"]` array alone and this must redden. If it stays
// green the guard is a hand-listed set rather than a table scan.
// ══════════════════════════════════════════════════════════════════════════
describe("[140.3-10 / TRAP-4] the whole copy table, scanned for destructive-only error states", () => {
  /**
   * HAND-TYPED. Never derived from the module under test — deriving either set
   * from `wizardErrors.ts` would make this a self-referential oracle that
   * cannot fail when the module changes, which is the exact defect the phase's
   * economic-invariant rule names. (140.5-02 bumps the size literal below to
   * 57; see the twin guard's note for the per-entry reasoning re-run.)
   *
   * `start_fresh` is destructive because WizardClient's handler DELETEs the
   * draft row, cascading away every `strategy_keys` member under it. It is the
   * only member of `WizardErrorAction` that destroys server-side user data
   * from the error surface itself.
   *
   * ⚠️ `try_another_key` ALSO reaches a delete at the wizard (`onTryAnotherKey`
   * fires `handleDeleteDraft()`), and it is deliberately NOT listed here. That
   * path discards a draft holding a key the exchange just REJECTED — the whole
   * point of the affordance, documented in-file, and pinned by its own
   * anti-regression case. Listing it would redden every `KEY_*` entry and turn
   * this guard into noise. The asymmetry is recorded rather than smoothed over.
   */
  const DESTRUCTIVE_ACTIONS: readonly string[] = ["start_fresh"];

  /**
   * HAND-TYPED. The actions that constitute a CONTROL a user can act on.
   *
   * `expand_log` is excluded: it toggles a disclosure and moves nobody
   * anywhere. Everything else — including `request_call`, which opens the
   * contact modal — is a control the user can press that does not destroy
   * their draft, and "does not destroy their draft" is the property this guard
   * defends.
   */
  const ACTIONABLE_ACTIONS: readonly string[] = [
    "try_another_key",
    "clear_and_retry",
    "resume_draft",
    "start_fresh",
    "request_call",
    "leave_and_return",
  ];

  /**
   * HAND-TYPED SIZE GUARD. 53 entries at 140.3-10; **54 at 140.3-14**, which
   * added `COMPOSITE_TOO_MANY_MEMBERS` (TS-37 — the composite member cap split
   * off `COMPOSITE_MEMBERSHIP_UNKNOWN`). Its `actions` are `request_call` +
   * `expand_log`: no destructive member, so the guard below is unaffected in
   * substance and the number is the only thing that moved.
   *
   * **55 at 140.3-15**, which added `SEAM_MISCONFIGURED` (TS-38 — our own
   * configuration fault, which until now wore the dead-upstream envelope). Its
   * `actions` are `request_call` + `expand_log` as well: again no destructive
   * member, so this guard is unaffected in substance. The reasoning below was
   * re-run over the new entry BEFORE the number moved — bumping the literal
   * without re-running it is how a growing table smuggles a violation past a
   * size guard.
   *
   * **57 at 140.5-02**, which added `KEY_MISSING_READ_SCOPE` and
   * `KEY_PERMISSION_DENIED` (SEAMPROSE-03 — two venue wire codes that had no
   * honest verdict). Both carry `try_another_key` + `request_call`: NO
   * destructive member, so this guard is unaffected in substance. The
   * reasoning below was re-run over both new entries BEFORE the number moved.
   *
   * **61 at 142.2-07**, which added `KEY_MISSING_REQUIRED_FIELD`,
   * `KEY_UNSUPPORTED_VENUE`, `KEY_VENUE_NOT_ENABLED` and `KEY_INPUT_TOO_LONG`
   * (MT5-04 / D-05 — the four causes `KEY_INVALID_FORMAT` used to swallow). The
   * reasoning was re-run over all four before the number moved: three carry
   * `clear_and_retry` + `request_call` and the fourth (`KEY_VENUE_NOT_ENABLED`)
   * carries `request_call` alone. NONE carries `start_fresh`, so the destructive
   * class below is unchanged at four members and this guard is unaffected in
   * substance. `KEY_VENUE_NOT_ENABLED`'s single-action shape was checked against
   * the guard directly rather than assumed: the scan only examines entries that
   * DO carry a destructive action, so an entry with one non-destructive action
   * is out of its population by construction.
   *
   * **62 at the 142.2 code review (FIX 1)**, which added
   * `GATE_SERIES_PROVENANCE_UNVERIFIED` — the honest answer for a strategy whose
   * daily series no producer has examined, replacing a false
   * `GATE_INSUFFICIENT_TRADES` for that state. The reasoning was re-run before
   * the number moved, and this entry is one THIS guard has a direct stake in:
   * its actions are `clear_and_retry` + `request_call`, carrying NEITHER
   * `try_another_key` NOR `start_fresh`, so the destructive class below is
   * unchanged at four members and the entry is out of the scanned population by
   * construction. That exclusion is the fix, not a side effect — the state it
   * replaces rendered `try_another_key`, whose control fires
   * `handleDeleteDraft()` and destroys the draft plus every `strategy_keys`
   * member under it. Answering "we never recorded where your returns came from"
   * with "delete your work" is the dead end the code was minted to remove, so
   * re-adding a destructive action here would defeat its purpose.
   *
   * Without it a table that SHRANK — an entry deleted, or the export replaced
   * by an empty object — would satisfy every assertion below vacuously. A scan
   * over nothing passes.
   *
   * **63 at MT5-13**, which added `KEY_SCOPE_CHECK_UNAVAILABLE` — the permanent
   * sibling of `KEY_NETWORK_TIMEOUT`, for a finalize scope re-check that will
   * not succeed on a retry. The reasoning was re-run before the number moved.
   * Its actions are `request_call` ALONE: no `try_another_key`, no
   * `start_fresh`, so the destructive class below is unchanged at four members
   * and the entry is out of the scanned population by construction — the same
   * shape `KEY_VENUE_NOT_ENABLED` established. That is load-bearing here rather
   * than incidental: the whole reason this code exists is that the condition is
   * not the user's to clear, so offering a control that deletes their draft
   * would be the worst possible answer to it.
   *
   * **64 at the 151 review (E5/E6)**, which added
   * `ALLOCATION_NOT_ALLOCATABLE` — the allocate surface's one actionable
   * refusal, previously collapsed to `UNKNOWN`. The reasoning was re-run before
   * the number moved. Its actions are `leave_and_return` + `expand_log`:
   * NEITHER `try_another_key` NOR `start_fresh`, so the destructive class below
   * is unchanged at four members and the entry is out of the scanned population
   * by construction. That exclusion is load-bearing rather than incidental —
   * the remedy for this state is a MARK on a strategy the user keeps, so a
   * control that deletes their draft would destroy the very thing the copy tells
   * them to go and fix.
   *
   * **74 at 153.1-04** (WIZFORM-02), which added TEN members in one wave:
   * the seven field-level metadata refusals (`METADATA_NAME_INVALID`,
   * `METADATA_DESCRIPTION_TOO_SHORT`, `METADATA_DESCRIPTION_TOO_LONG`,
   * `METADATA_CATEGORY_REQUIRED`, `METADATA_AUM_INVALID`,
   * `METADATA_CAPACITY_INVALID`, `METADATA_CAPITAL_OWNERSHIP_INVALID`), plus
   * `SEAM_DEADLINE_EXCEEDED`, `COMPOSITE_UNSUPPORTED_UNIFIED` and
   * `DRAFT_STATE_INVALID`. The number was READ OUT OF THIS GUARD'S OWN FAILURE
   * (`expected 74 to be 64`) rather than copied from the plan's arithmetic, and
   * the reasoning below was re-run over all ten BEFORE it moved.
   *
   * THIS guard's population is entries carrying a DESTRUCTIVE action, and
   * `DESTRUCTIVE_ACTIONS` has exactly one member: `start_fresh`. Per entry:
   *   · the seven metadata refusals carry `["expand_log"]` and nothing else —
   *     one non-destructive, non-actionable control apiece;
   *   · `SEAM_DEADLINE_EXCEEDED` and `COMPOSITE_UNSUPPORTED_UNIFIED` carry
   *     `request_call` + `expand_log`;
   *   · `DRAFT_STATE_INVALID` carries `leave_and_return` + `expand_log`.
   * NONE of the ten carries `start_fresh`, so all ten are outside the scanned
   * population by construction and the destructive class below is unchanged at
   * four members — which the `toEqual([...])` receipt two `it`s down asserts
   * independently rather than by this reasoning.
   *
   * ⭐ That exclusion is LOAD-BEARING rather than incidental on `DRAFT_STATE_INVALID`
   * in particular. Its condition is "this PAGE is stale"; the draft is intact
   * and is the thing the user wants back. `start_fresh` DELETES that draft and
   * cascades away every `strategy_keys` member under it, so offering it here
   * would answer "your page is out of date" by destroying the work. The same
   * argument applies to the seven metadata refusals, whose whole point is that
   * the user's typing survives the refusal.
   *
   * **75 at 153.6-06** (PARITY-05), which added `KEY_SCOPE_CHECK_UNREADABLE` —
   * the TRANSIENT half split back off `KEY_SCOPE_CHECK_UNAVAILABLE` for a probe
   * body our schema could not read, which is what a half-rolled analytics
   * deploy serves and therefore clears by itself. The number was READ OUT OF
   * THIS GUARD'S OWN FAILURE (`expected 75 to be 74`), and the reasoning was
   * re-run over the entry before it moved.
   *
   * THIS guard's population is entries carrying a DESTRUCTIVE action, and
   * `DESTRUCTIVE_ACTIONS` has exactly one member: `start_fresh`. The new entry
   * carries `clear_and_retry` + `request_call` — NEITHER `start_fresh` NOR
   * `try_another_key` — so it is outside the scanned population by construction
   * and the destructive class below is unchanged at four members.
   *
   * ⭐ That exclusion is LOAD-BEARING rather than incidental, and in a way worth
   * stating because this entry is the first RECOVERABLE one added since 74. The
   * condition is a deploy of OURS in flight: the draft is intact, the user did
   * nothing wrong, and the remedy is to wait thirty seconds. `start_fresh`
   * DELETES that draft and cascades away every `strategy_keys` member under it,
   * so offering it here would answer "our release is still rolling" by
   * destroying the user's work. `clear_and_retry` is the whole point of the
   * entry — it is a control that CAN win, unlike the one on the permanent
   * sibling it was split off — and it is not destructive.
   *
   * Deliberately NOT `Object.keys(WIZARD_ERROR_COPY).length`: reading the
   * subject to build the expectation is how a guard stops being able to fail.
   * Bumping the LITERAL when the table legitimately grows is the intended
   * maintenance cost; replacing it with a derived value removes the guard.
   *
   * **76 at 154.1** (the WIZCONT-02 review CR), which added
   * `VENUE_ALREADY_CONNECTED` — the refusal for a re-connect whose venue account
   * is already held by a strategy that has LEFT the draft state. Split off
   * `DRAFT_ALREADY_EXISTS`, whose every clause ("a draft… already in progress",
   * resume it, or start fresh) is false once the holder is finalized. The number
   * was READ OUT OF THIS GUARD'S OWN FAILURE (`expected 76 to be 75`), and the
   * reasoning was re-run over the entry before it moved.
   *
   * THIS guard's population is entries carrying a DESTRUCTIVE action, and
   * `DESTRUCTIVE_ACTIONS` has exactly one member: `start_fresh`. The new entry
   * carries `request_call` + `expand_log` — NEITHER `start_fresh` NOR either
   * recoverable action — so it is outside the scanned population by construction
   * and the destructive class below is unchanged at four members.
   *
   * ⭐ That exclusion is LOAD-BEARING rather than incidental, and it is the
   * sharpest instance of this guard's own subject so far. The entry it was split
   * from DOES offer `start_fresh`, and that is correct there: a draft exists and
   * deleting it is a real choice. Here there is no draft, so the SAME control
   * would delete the finished strategy's own wizard session — offering to
   * destroy the very thing the copy tells the user to go and open, for a state
   * they did not cause.
   *
   * **76 → 77 at 153.7-02** (WIZFORM-02-CLASS), which added
   * `SEAM_INTERNAL_FAULT` — the permanent our-side fault that homes
   * `MT5_GATEWAY_UNCONFIGURED`, `ADAPTER_INIT_FAILED` and `INTERNAL`, three wire
   * codes for which `SEAM_MISCONFIGURED`'s "we stopped before sending the
   * request" is measurably false at an emitter. THIS guard's reasoning was
   * re-run over the entry before the number moved: its `actions` are
   * `request_call` + `expand_log` — NEITHER `start_fresh` NOR either recoverable
   * action — so it is outside the scanned population by construction and the
   * destructive class below is unchanged at four members.
   *
   * ⭐ The exclusion is load-bearing here in the same way it is for
   * `VENUE_ALREADY_CONNECTED` above: `start_fresh` DELETEs the draft, and this
   * entry is reached mid-key-connect on a draft the user is still building.
   * Offering to destroy it for a fault they did not cause, and cannot clear,
   * would be the destructive-only class in its worst form.
   *
   * **77 → 80 at 153.7-03** (WIZFORM-02-CLASS), which added
   * `DRAFT_LOOKUP_FAILED`, `DRAFT_FINALIZE_FAILED` and
   * `SEAM_RESPONSE_UNREADABLE` — the copy for the last three `finalize-wizard`
   * rejections that answered with no code at all, taking that route's code-less
   * ledger to zero. THIS guard's reasoning was re-run over each of the three
   * before the number moved, and the answer is the same for all three: their
   * `actions` are `clear_and_retry` + `request_call` (twice) and
   * `leave_and_return` + `request_call` + `expand_log` — NO `start_fresh` on
   * any of them — so all three sit outside the scanned population by
   * construction and the destructive class below is unchanged at four members.
   *
   * ⭐ The exclusion is load-bearing on the same ground as the two entries
   * above, and most sharply on `SEAM_RESPONSE_UNREADABLE`: that entry is
   * reached when a submission was ACCEPTED upstream and only its answer was
   * unreadable, so `start_fresh` would offer to delete the draft behind a
   * strategy that may already exist — destroying the record the copy sends the
   * user to go and check.
   *
   * **80 → 81 at the 160-05 review** (WIZFORM-02-CLASS), which added
   * `STALE_CLIENT` — the 409 `keys/validate-and-encrypt` answers a tab that
   * predates RANK-03's `persist` conversion, and the one code that route emits
   * which was in NEITHER the union NOR the alias table, so it resolved to
   * `UNKNOWN`. THIS guard's reasoning was re-run over the entry before the
   * number moved: its `actions` are `leave_and_return` + `expand_log` — NO
   * `start_fresh`, and neither member of `RECOVERABLE_ACTIONS` — so it sits
   * outside the scanned population by construction and the destructive class
   * below is unchanged at four members.
   *
   * ⭐ The exclusion is load-bearing rather than incidental, on the same ground
   * as `DRAFT_STATE_INVALID`: the condition is "this PAGE is out of date", and
   * `start_fresh` DELETEs a draft. This refusal knows nothing about any draft —
   * it fires on a key-management surface that may have none — so offering to
   * destroy one would answer a stale bundle by destroying unrelated work.
   *
   * **82 → 83 at 161-07** (WIZERR-09) — `GATE_INSUFFICIENT_CSV_HISTORY`, the
   * 7-day floor on a DAILY-RETURN series, minted in the same commit the
   * wizard's composite arm starts evaluating that floor. (82 was
   * `KEY_ORPHANED` at 161-05; its copy is pinned by the `[161-05 / WIZERR-03]`
   * describe.) THIS guard's reasoning was re-run over the entry before the
   * number moved: its `actions` are `clear_and_retry` ALONE — not a member of
   * `DESTRUCTIVE_ACTIONS` — so it sits outside the scanned population by
   * construction and the destructive class below is unchanged at four members.
   *
   * ⛔ The exclusion is load-bearing rather than incidental. `start_fresh`
   * DELETEs a draft, and the condition here is "the series is not long enough
   * YET" — a strategy whose data is fine and whose remedy is time. Answering a
   * shortage of days with a control that destroys the days already accumulated
   * is the TRAP-4 shape exactly.
   *
   * **83 → 84 at 161-07** (WIZERR-10) — `GATE_SERIES_EXAMINED_REFUSED`, the
   * truthful fourth CSV-verdict outcome, replacing "Strategy has only 0
   * trade(s)" for a strategy with a full daily-return series and no fills.
   * THIS guard's reasoning was re-run over the entry before the number moved:
   * its `actions` are `try_another_key` ALONE — not a member of
   * `DESTRUCTIVE_ACTIONS` — so it too sits outside the scanned population and
   * the destructive class below is still four members.
   *
   * ⚠️ IT WAS NOT ALWAYS OUTSIDE. `try_another_key` fired
   * `handleDeleteDraft()` until 161-04 / WIZERR-02 made it a pure step
   * transition. Had this entry been written before that commit, it would have
   * answered "the venue's data cannot prove a complete record" with a control
   * that destroys the draft — which is why the two requirements were sequenced
   * into different waves rather than merely written down in the same phase.
   *
   * ⚠️ THIS NUMBER HAS A TWIN. The same literal is pinned in the
   * `[140.3-12 / SEAMUX-04]` describe below, and moving one without the other
   * is a silent half-fix — the shrink-detection it buys survives in one scan
   * and dies in the other. 153.1-04 added a third guard (at the end of this
   * file) that reads this source and reds when the two literals disagree.
   *
   * ⚠️ 84 → 88 (161-10 / WIZERR-07). FOUR entries were minted in one
   * commit — `DASHBOARD_SIGNED_OUT`, `DASHBOARD_REQUEST_INVALID`,
   * `DASHBOARD_WRITE_FAILED` and `DASHBOARD_ROW_STALE` — for the three
   * dashboard write dialogs, whose routes classified their failures precisely
   * while the dialogs rendered `code: "UNKNOWN"` for every one of them. THIS
   * guard's reasoning was re-run over all four before the number moved: none
   * carries a member of `DESTRUCTIVE_ACTIONS` (their `actions` are drawn from
   * `leave_and_return` / `expand_log` / `clear_and_retry` / `request_call`
   * only), so all four sit OUTSIDE the scanned population and the destructive
   * class below is still four members. The baseline was re-measured at HEAD
   * before it moved — 161-05 took it 81 → 82 and 161-07 took it 82 → 84.
   */
  const EXPECTED_TABLE_SIZE = 88;

  it("the scan actually covers the table — hand-typed size guard", () => {
    expect(
      Object.keys(WIZARD_ERROR_COPY).length,
      "If the table grew, re-run this guard's reasoning over the new entries " +
        "and then update the number. If it SHRANK, an entry was deleted and " +
        "every assertion below just became vacuous.",
    ).toBe(EXPECTED_TABLE_SIZE);
  });

  it("EVERY entry carrying a destructive action also offers a non-destructive control", () => {
    const offenders: string[] = [];

    for (const [code, copy] of Object.entries(WIZARD_ERROR_COPY)) {
      const actions = copy.actions as readonly string[];
      const carriesDestructive = actions.some((a) =>
        DESTRUCTIVE_ACTIONS.includes(a),
      );
      if (!carriesDestructive) continue;

      const nonDestructiveWaysOut = actions.filter(
        (a) => ACTIONABLE_ACTIONS.includes(a) && !DESTRUCTIVE_ACTIONS.includes(a),
      );
      if (nonDestructiveWaysOut.length === 0) offenders.push(code);
    }

    expect(
      offenders,
      "An error state whose ONLY actionable control destroys the user's draft " +
        "turns our own error copy into the route to data loss — and the user " +
        "arrives there because something already went wrong, so they are " +
        "primed to click whatever is offered. TRAP-4.",
    ).toEqual([]);
  });

  it("the destructive class really is FOUR entries, GUARD_BLOCKED included", () => {
    // A receipt, not a duplicate of the guard above. The research table said
    // three; naming the fourth here means the next reader inherits the
    // correction rather than re-deriving it — and if a fifth appears, this
    // reddens and forces someone to look at it.
    const carriers = Object.entries(WIZARD_ERROR_COPY)
      .filter(([, copy]) =>
        (copy.actions as readonly string[]).some((a) =>
          DESTRUCTIVE_ACTIONS.includes(a),
        ),
      )
      .map(([code]) => code)
      .sort();

    expect(carriers).toEqual([
      "DRAFT_ALREADY_EXISTS",
      "GATE_DRAFT_GONE",
      "GATE_NO_DATA_SOURCE",
      "GUARD_BLOCKED",
    ]);
  });

  it("the two codes /api/keys/sync's denial arms map to are BOTH in the table", () => {
    // 140.3-10 gave the route's arms codes. `GATE_DRAFT_GONE` (404) and
    // `RATE_LIMITED` (both 429 sites) are the two that reach a wizard state, so
    // a rename on either side has to be a deliberate, two-sided act.
    const codes = Object.keys(WIZARD_ERROR_COPY);
    expect(codes).toContain("GATE_DRAFT_GONE");
    expect(codes).toContain("RATE_LIMITED");
  });
});

/**
 * Phase 140.3-12 / SEAMUX-04 — THE COPY-HONESTY GUARD.
 *
 * ⚠️ THIS SCANS THE WHOLE TABLE ON PURPOSE, and the reason is a measurement.
 * The lie class was documented as five strings across four codes. Grepping the
 * SENTENCES rather than the code names found SEVEN across five, then NINE
 * across seven — and two of the extras lived on `GATE_ANALYTICS_FAILED`, which
 * no source document listed at all, while two more (`SERVICE_UNAVAILABLE_RETRY`
 * and `SERVICE_UNREACHABLE`) were inherited from a sentence that was true on
 * the code it was copied FROM and false on the code it was copied TO.
 *
 * A guard enumerated from the five codes someone wrote down would have
 * certified this class closed with four live strings still shipping. So the
 * oracle is: every entry, every string, hand-typed forbidden substrings.
 *
 * The forbidden list is a HAND-TYPED LITERAL. Deriving it from the module under
 * test — or from the copy currently in it — is the self-referential defect that
 * lets a table certify its own contents.
 */
describe("[140.3-12 / SEAMUX-04] no entry in the copy table makes a claim we cannot substantiate", () => {
  /**
   * HAND-TYPED. Each entry pairs the banned substring with WHY it is banned, so
   * a future editor deleting a row has to argue with the reason.
   */
  const FORBIDDEN: readonly { fragment: string; why: string }[] = [
    {
      fragment: "been notified",
      why:
        "9 of the 15 seam routes capture nothing, so this asserts an audit " +
        "trail that does not exist. 140.3-13 owns adding the captures; until " +
        "a route has one, no copy reachable from it may claim one.",
    },
    {
      fragment: "we fetched your trades",
      why:
        "The browser cannot observe whether a fetch stage succeeded. The " +
        "server reports the stage it FAILED at, never that an earlier stage " +
        "succeeded — and SYNC_FAILED is now the fallback for kickoff failures " +
        "in which no trade was ever fetched.",
    },
    {
      fragment: "data is unchanged",
      why:
        "Asserted after a 500 from a handler that runs finalize_csv_strategy. " +
        "uvicorn does not cancel on client disconnect, so the write may have " +
        "landed. This is a negative the client cannot observe.",
    },
    {
      fragment: "wizard_session_id idempotency",
      why:
        "An internal field name shown to a user. 140.3-12 also banned it for " +
        "promising a guarantee that held on the CSV path and NOT on the API " +
        "path; 140.3-14 / TS-33 closed that half by wiring the id into " +
        "finalize-wizard's postProcessKey context, so the GUARANTEE now holds " +
        "on both. The BAN stands regardless and on its first ground alone: an " +
        "internal column name is not user-facing copy. Say what the user gets, " +
        "never the mechanism's field name.",
    },
  ];

  /**
   * HAND-TYPED SIZE GUARD, mirroring 140.3-10's. A scan over an emptied table
   * passes every assertion below vacuously.
   *
   * 53 at 140.3-12; **54 at 140.3-14** (`COMPOSITE_TOO_MANY_MEMBERS`);
   * **55 at 140.3-15** (`SEAM_MISCONFIGURED`). Each new entry was read against
   * every FORBIDDEN fragment by hand before the number moved — bumping the
   * literal without re-running the reasoning is how a growing table smuggles a
   * lie past a size guard.
   *
   * 140.3-15's entry needed the "data is unchanged" fragment checked with care:
   * it says "nothing was changed", which is NOT the banned string and, unlike
   * the CSV case that fragment came from, is knowable — `SeamConfigError` is
   * raised before any store or network I/O, so no write could have landed.
   *
   * **57 at 140.5-02** (`KEY_MISSING_READ_SCOPE`, `KEY_PERMISSION_DENIED`).
   * Both were read against all four FORBIDDEN fragments by hand before the
   * number moved. Neither mentions notification, trade fetching, or a session
   * field name. The one needing care is "data is unchanged": neither entry
   * asserts anything about server state at all — both describe the EXCHANGE's
   * refusal and the user's remedy, and the key was never stored on either path.
   * The §4a entry `CSV_UPSTREAM_FAIL` (this plan's other copy change) says
   * "not your data" and "Nothing was saved", neither of which is the banned
   * string, and "Nothing was saved" is verified true at its arm at three
   * layers rather than asserted.
   *
   * **61 at 142.2-07** (`KEY_MISSING_REQUIRED_FIELD`, `KEY_UNSUPPORTED_VENUE`,
   * `KEY_VENUE_NOT_ENABLED`, `KEY_INPUT_TOO_LONG` — MT5-04 / D-05). All four
   * were read against all four FORBIDDEN fragments by hand before the number
   * moved. None mentions notification, trade fetching, or a session field name.
   * The one needing care is again "data is unchanged", because three of the four
   * DO make a server-state claim: `KEY_MISSING_REQUIRED_FIELD` says "Nothing was
   * sent to the exchange and nothing was stored" and `KEY_VENUE_NOT_ENABLED`
   * says "not sent anywhere and nothing was stored". Neither is the banned
   * string, and both are KNOWABLE rather than asserted — every one of these
   * guards returns from the route BEFORE `validateKey`, `encryptKey`, the
   * limiter and the RPC, so no request was issued and no row was written. That
   * is the same test 140.3-15's entry passed and the CSV case failed: the
   * question is not whether the sentence is comforting but whether the code path
   * makes it observable.
   *
   * **62 at the 142.2 code review (FIX 1)**
   * (`GATE_SERIES_PROVENANCE_UNVERIFIED`). Read against all four FORBIDDEN
   * fragments by hand before the number moved. It mentions no notification, no
   * trade fetching, and no session field name. The one needing care is again
   * "data is unchanged", because the entry DOES make a server-state claim:
   * "nothing on our side recorded how that series was built". That is not the
   * banned string, and — applying the same test 140.3-15's entry passed and the
   * CSV case failed — it is OBSERVABLE rather than asserted: it restates the
   * exact value the gate just read (`strategy_analytics.series_completeness` was
   * NULL or unrecognised) and is the sole reason the refusal fired. It is not a
   * negative about a write that may or may not have landed. The entry also
   * volunteers "This is a gap in our bookkeeping, not a judgement about your
   * trading", which is a statement about US and is the point of the code.
   *
   * **63 at MT5-13** (`KEY_SCOPE_CHECK_UNAVAILABLE`). Read against all four
   * FORBIDDEN fragments by hand before the number moved. It mentions no
   * notification, no trade fetching, and no session field name — and note it
   * deliberately does NOT say "our team has been notified" even though the copy
   * asks the user to tell us, which is exactly the fragment's point. The one
   * needing care is again "data is unchanged", because the entry DOES make a
   * server-state claim twice: "Nothing about your strategy was lost; it stays
   * exactly where it is" and "Your draft is saved". Neither is the banned
   * string, and — applying the same test 140.3-15's entry passed and the CSV
   * case failed — both are OBSERVABLE rather than asserted. This arm returns
   * from `runScopeBroadeningProbe` BEFORE `finalize_wizard_strategy` is called
   * at all, which is not a reading of the code but a pinned assertion: the
   * route's own probe-failure tests check `STATE.rpcCalls` holds no
   * `finalize_wizard_strategy`. The draft row predates the request and this path
   * issues no write, so "unchanged" is a property of the control flow rather
   * than a comfort about a write that may or may not have landed — the
   * distinction the CSV entry failed on, where the handler HAD run the RPC.
   *
   * **64 at the 151 review (E5/E6)** (`ALLOCATION_NOT_ALLOCATABLE`). Read
   * against all four FORBIDDEN fragments by hand before the number moved. It
   * mentions no notification, no trade fetching and no session field name. The
   * one needing care is again the server-state claim: the entry says "the
   * allocation was refused and nothing was saved". That is OBSERVABLE, not
   * asserted — the refusal comes from a BEFORE INSERT trigger and from a
   * pre-check that both run before any row is written, so "nothing was saved" is
   * a property of the control flow (the route's own tests pin `upsertCalls`
   * empty on the pre-check arm) rather than a comfort about a write that may or
   * may not have landed.
   *
   * **74 at 153.1-04** (WIZFORM-02) — TEN new entries, every one of them read
   * against all four FORBIDDEN fragments by hand before the number moved. None
   * mentions notification, trade fetching, or a session field name, so as ever
   * the fragment needing care is "data is unchanged", and nine of the ten DO
   * make a server-state claim. Taken in three groups, because the GROUND for
   * the claim differs:
   *
   *   · **The seven field-level metadata refusals** (`METADATA_NAME_INVALID`,
   *     `METADATA_DESCRIPTION_TOO_SHORT`, `METADATA_DESCRIPTION_TOO_LONG`,
   *     `METADATA_CATEGORY_REQUIRED`, `METADATA_AUM_INVALID`,
   *     `METADATA_CAPACITY_INVALID`, `METADATA_CAPITAL_OWNERSHIP_INVALID`) each
   *     say "Nothing was saved". Not the banned string, and OBSERVABLE by the
   *     same test 140.3-15's entry passed and the CSV case failed: every one of
   *     these is raised inside `validatePayload`, which returns its 400 BEFORE
   *     the route reaches `finalize_wizard_strategy`, before `postProcessKey`
   *     and before any write of any kind. "Nothing was saved" is a property of
   *     the control flow, not a comfort about a request whose outcome we never
   *     learned. They also claim "everything you typed is still on the form",
   *     which is a statement about the CLIENT's own DOM — the weakest possible
   *     claim to make and the one the user actually needs.
   *
   *   · **`COMPOSITE_UNSUPPORTED_UNIFIED`** deliberately does NOT claim nothing
   *     changed, and that is the interesting one. The route stamps
   *     `strategy_analytics` with `computation_status: "failed"` in the
   *     statement immediately above the 409, so a "nothing changed" sentence
   *     here would have been exactly the CSV-entry lie. The copy says instead
   *     "We stopped and marked the strategy as failed", which restates the row
   *     the handler just wrote, and narrows its untouched-claim to the keys —
   *     which that upsert does not touch.
   *
   *   · **`DRAFT_STATE_INVALID`** says "This attempt saved nothing, and the
   *     draft itself is untouched." Ground: the 409 is raised from SQLSTATE
   *     22023, i.e. the RPC itself raised, so the function's transaction is
   *     rolled back by Postgres. That is a stronger guarantee than the
   *     returns-before-write kind above, not a weaker one.
   *
   *   · **`SEAM_DEADLINE_EXCEEDED`** says "Nothing was saved — your key was not
   *     stored". ⚠️ This is the ONE of the ten whose ground is an OBLIGATION ON
   *     A FUTURE EMITTER rather than a property of code that exists today: the
   *     member is authored here and Phase 153.4 emits it. The claim holds only
   *     while the abort fires before the request can persist (the UI-SPEC's
   *     stated basis: pre-encrypt / pre-RPC). A server does not stop working
   *     because a client stopped listening — the precise reasoning behind the
   *     "data is unchanged" ban. The obligation is written at the entry itself
   *     so 153.4 inherits it; if 153.4 emits this code from a path where the
   *     write could already have landed, this sentence must change in the same
   *     commit.
   *
   * **75 at 153.6-06** (PARITY-05) — `KEY_SCOPE_CHECK_UNREADABLE`. Read against
   * all four FORBIDDEN fragments by hand before the number moved. It mentions no
   * trade fetching and no session field name, and — like its permanent sibling
   * at 63 — it deliberately does NOT say "our team has been notified" even
   * though its second bullet asks the user to tell us, which is the fragment's
   * whole point. The one needing care is again "data is unchanged", because the
   * entry DOES make a server-state claim: "Nothing about your strategy was lost;
   * it stays exactly where it is."
   *
   * Not the banned string, and OBSERVABLE rather than asserted by the same test
   * 140.3-15's entry passed and the CSV case failed — and here the ground is a
   * PINNED assertion rather than a reading of the code: this arm returns from
   * `runScopeBroadeningProbe` before `finalize_wizard_strategy` is called at
   * all, and `route.test.ts`'s `[153.6-06 / PARITY-05]` block asserts
   * `STATE.rpcCalls` holds no `finalize_wizard_strategy` on exactly this path.
   * The draft row predates the request and this path issues no write.
   *
   * ⚠️ ONE CLAUSE IS NEW IN KIND and is the one to re-read if this entry's copy
   * is ever edited: "a release of ours was mid-rollout". That is a statement
   * about OUR deploy state, offered as the LIKELY cause rather than as a fact
   * we checked — the copy says "most often because", and it is hedged for the
   * same reason the FORBIDDEN list exists. We do not read our own rollout status
   * on this path, and a sentence asserting we did would be the next member of
   * this ban list rather than a member of the table.
   *
   * **76 at 154.1** (the WIZCONT-02 review CR) — `VENUE_ALREADY_CONNECTED`. Read
   * against all four FORBIDDEN fragments by hand before the number moved. It
   * mentions no notification, no trade fetching and no session field name — it
   * says "half-finished session" precisely so the mechanism's column name never
   * reaches the user. The one needing care is again "data is unchanged", because
   * the entry DOES make a server-state claim: "Nothing new was created and the
   * existing strategy was left exactly as it was."
   *
   * Not the banned string, and OBSERVABLE rather than asserted — and it has to
   * hold on BOTH of the arms that emit this code, which is why it is spelled out
   * per arm at the entry itself:
   *   · the PRE-RPC arm returns before `validateKey`, before `encryptKey` and
   *     before `create_wizard_strategy` is called at all. That is a pinned
   *     assertion rather than a reading of the code: `create-with-key`'s
   *     `[154.1]` block asserts `rpcMock`, `validateKeyMock`, `encryptKeyMock`
   *     and the asset-class update were ALL uncalled on exactly this path.
   *   · the 23505 RACE arm is only reached because the RPC itself RAISED, so
   *     Postgres rolled the whole SECURITY DEFINER transaction back — the same
   *     stronger ground `DRAFT_STATE_INVALID` stands on at 74.
   *
   * ⚠️ ONE CLAUSE IS WORTH RE-READING if this entry is ever edited: "that
   * strategy has moved past the draft stage". That is a claim about the row we
   * just READ, not an inference — the refusal exists precisely because the
   * draft-scoped read found nothing and the unscoped one found a row.
   *
   * **76 → 77 at 153.7-02** (WIZFORM-02-CLASS) — `SEAM_INTERNAL_FAULT`. Read
   * against all four FORBIDDEN fragments by hand before the number moved. It
   * mentions no notification, no trade fetching and no session field name. The
   * one needing care is again "data is unchanged", because the entry DOES make a
   * server-state claim: "We never store a key we could not check, so no key was
   * stored", repeated as "Your key was not stored" in the second fix line.
   *
   * Not the banned string, and OBSERVABLE rather than asserted — and it has to
   * hold at all THREE wire codes this member homes, which is why it was checked
   * per emitter rather than per entry. All three (`MT5_GATEWAY_UNCONFIGURED`,
   * `ADAPTER_INIT_FAILED`, `INTERNAL`) are raised inside `validate_key`, and BOTH
   * key routes call `validateKey` before `encryptKey` and before the create RPC
   * — the same ordering `create-with-key`'s `[154.1]` block pins with its
   * `rpcMock` / `encryptKeyMock` uncalled assertions. So the write was never
   * reached, which is the ground 140.3-15's entry stands on and the ground the
   * CSV case lacked.
   *
   * ⭐ WHAT THE ENTRY DELIBERATELY DOES NOT CLAIM is the more interesting half:
   * it never says WHERE we stopped. `SEAM_MISCONFIGURED`'s "we stopped before
   * sending the request" is exactly the clause that is false at `INTERNAL`'s
   * emitter (the venue probe HAD been issued) and at one of
   * `MT5_GATEWAY_UNCONFIGURED`'s four, which is why this member exists at all. A
   * future edit that "improves" the copy by adding that clause re-opens the
   * defect it was minted to avoid.
   *
   * **77 → 80 at 153.7-03** (WIZFORM-02-CLASS) — `DRAFT_LOOKUP_FAILED`,
   * `DRAFT_FINALIZE_FAILED`, `SEAM_RESPONSE_UNREADABLE`. All three were read
   * against all four FORBIDDEN fragments by hand before the number moved. None
   * mentions notification, trade fetching or a session field name — and the
   * last of those is a near miss worth recording: `SEAM_RESPONSE_UNREADABLE`'s
   * arm sits one function away from the dedupe mechanism, and the obvious
   * reassurance ("submitting again resolves to the strategy that already
   * exists") was DELIBERATELY NOT WRITTEN, because that promise rests on a
   * partial unique index predicated on a NON-NULL wizard session id and this
   * route forwards the id through a conditional spread. True for most drafts,
   * silently false for the rest — which is exactly the shape 140.4-03 recorded
   * when the same guarantee was published ahead of its mechanism.
   *
   * ⭐ "data is unchanged" is again the fragment needing care, and the three
   * entries answer it DIFFERENTLY, which is the reason they are three members
   * and not one:
   *   · `DRAFT_LOOKUP_FAILED` DOES make a server-state claim — "Nothing was
   *     submitted and nothing was changed". Not the banned string, and
   *     observable rather than asserted: its arm is a `.maybeSingle()` SELECT
   *     that errored, and the handler contains no `.insert`, `.update`,
   *     `.upsert`, `.delete` or `.rpc` before it. A read that fails cannot have
   *     written, which is the strongest ground of the three.
   *   · `DRAFT_FINALIZE_FAILED` MAKES NO SUCH CLAIM, on purpose. It is the
   *     generic tail of the RPC's error branch, so it catches both a SQL raise
   *     (transaction rolled back, nothing landed) and a transport failure that
   *     can lose the answer to a write that DID land. It says we cannot confirm
   *     — true in both worlds — and that omission is the entry's whole point.
   *   · `SEAM_RESPONSE_UNREADABLE` MAY NOT CLAIM EITHER OUTCOME. Its upstream
   *     answered 2xx, so the submission was accepted and only the result is
   *     unreadable. "Nothing was saved" would be false whenever the onboard
   *     landed; "it went through" would be a guess about a body we could not
   *     parse. The copy states what the 2xx establishes and nothing further.
   *
   * **80 → 81 at the 160-05 review** (WIZFORM-02-CLASS) — `STALE_CLIENT`, the
   * 409 `keys/validate-and-encrypt` answers a tab loaded before RANK-03 made
   * `persist: true` mandatory. It was read against all four FORBIDDEN fragments
   * by hand before the number moved: it mentions no notification, no trade
   * fetching and no session field name.
   *
   * ⭐ "data is unchanged" is again the fragment needing care, because the entry
   * DOES make a server-state claim — "Nothing reached your exchange and nothing
   * was stored". Not the banned string, and OBSERVABLE rather than asserted, on
   * the same ground `DRAFT_LOOKUP_FAILED` stands on: the refusal returns from
   * the route before `validateKey`, before `encryptKey` and before the insert,
   * so no request was issued and no row was written. That is the test
   * 140.3-15's entry passed and the CSV case failed — not whether the sentence
   * is comforting, but whether the code path makes it observable.
   *
   * **82 → 83 at 161-07** (WIZERR-09) — `GATE_INSUFFICIENT_CSV_HISTORY`. Read
   * against all four FORBIDDEN fragments by hand before the number moved: it
   * mentions no notification, no trade fetching and no session field name.
   *
   * ⛔ "data is unchanged" is again the fragment needing care, and this entry
   * makes NO claim about a write at all. It says "Nothing is wrong with the
   * data we have — there is not yet enough of it", which restates the very
   * measurement that fired the refusal (the gate counted the series and found
   * it under the floor) rather than asserting a negative about a request whose
   * outcome we never learned. That is the test 140.3-15's entry passed and the
   * CSV case failed.
   *
   * ⚠️ TWO CLAUSES ARE WORTH RE-READING if this entry is ever edited:
   *   · the fix bullet says a completed re-derive "rebuilds the series from
   *     whatever history the venue holds by then". That states the MECHANISM a
   *     retry runs, deliberately without promising the venue holds more — the
   *     copy nowhere claims the missing history exists.
   *   · the UI-SPEC's proposed bullet ("Upload a CSV covering at least 7 daily
   *     returns") was DELETED rather than reworded, because it named a remedy
   *     no emitter of this code can reach: the composite arm counts a STITCHED
   *     series, the single-key arm counts a venue-DERIVED one, and the keyless
   *     CSV upload path never reaches this surface at all. The measurement is
   *     argued in full at the entry itself.
   *
   * **83 → 84 at 161-07** (WIZERR-10) — `GATE_SERIES_EXAMINED_REFUSED`. Read
   * against all four FORBIDDEN fragments by hand before the number moved: it
   * mentions no notification, no trade fetching and no session field name.
   *
   * ⛔ "data is unchanged" is again the fragment needing care, and this entry
   * makes NO claim about a write. Its server-state claim is of a different kind
   * — "Our pipeline records how every daily-return series was built, and for
   * this one the record does not establish a complete track record" — which
   * restates the persisted value the gate just read
   * (`strategy_analytics.series_completeness`) and is the sole reason the
   * refusal fired. Same ground `GATE_SERIES_PROVENANCE_UNVERIFIED` stands on at
   * 62, and the mirror image of it: that entry reports the value's ABSENCE,
   * this one reports what the value SAYS.
   *
   * ⚠️ THE CLAUSE TO RE-READ if this entry is ever edited is the one the
   * UI-SPEC proposed and this entry does NOT contain: "examined and refused" /
   * "the data was found wanting". Both assert that something looked at THIS
   * series and judged it. Measured at the producer
   * (`analytics-service/services/broker_dailies.py`, "Who stamps what"):
   * `fill_derived_unproven` is stamped for binance / bybit / okx ALWAYS and
   * unconditionally — the producer's own words are "a CONSTANT, not a
   * data-driven refinement" — so no per-series finding exists to report. The
   * shipped cause describes the two METHODS instead, which is true of every
   * series that can reach it. A future edit that reaches for the more
   * satisfying "we examined it" wording is re-opening this exact defect, and
   * the same wording would be false in the same way.
   *
   * ⚠️ THIS NUMBER HAS A TWIN in the `[140.3-10 / TRAP-4]` describe above.
   * Moving one without the other is a silent half-fix; the guard added at the
   * end of this file reds when the two literals disagree.
   *
   * ⚠️ 84 → 88 (161-10 / WIZERR-07). The same four dashboard-dialog
   * entries as the twin above. THIS guard's reasoning — no banned claim in any
   * title, cause or fix line — was re-run over all four before the number
   * moved: none predicts permanence, none promises a notification, none names
   * an internal cause the user cannot act on. The baseline was re-measured at
   * HEAD before it moved (161-05: 81 → 82; 161-07: 82 → 84).
   */
  const EXPECTED_TABLE_SIZE = 88;

  it("the scan actually covers the table — hand-typed size guard", () => {
    expect(
      Object.keys(WIZARD_ERROR_COPY).length,
      "If this shrank, the honesty scan below just became vacuous.",
    ).toBe(EXPECTED_TABLE_SIZE);
  });

  it("EVERY entry — title, cause and every fix line — is free of the banned claims", () => {
    const offenders: string[] = [];

    for (const [code, copy] of Object.entries(WIZARD_ERROR_COPY)) {
      // Every user-visible string on the entry, not just the title: two of the
      // nine strings lived in `fix[]`, where a title-only scan cannot see them.
      const strings = [copy.title, copy.cause, ...copy.fix];
      const haystack = strings.join("   ").toLowerCase();

      for (const { fragment } of FORBIDDEN) {
        if (haystack.includes(fragment.toLowerCase())) {
          offenders.push(code + " -> " + fragment);
        }
      }
    }

    expect(
      offenders,
      "A copy string is claiming something the client cannot know, or that is " +
        "false on at least one path that reaches this code. The reasons are " +
        "written beside each fragment in FORBIDDEN above.\n" +
        FORBIDDEN.map((f) => "  - " + f.fragment + ": " + f.why).join("\n"),
    ).toEqual([]);
  });

  it("[140.4-16 / CR-01] the two CSV resubmit instructions name the CHANGED case, not only the repeat", () => {
    // ⚠️ WHY THIS IS A GUARD AND NOT A STYLE NOTE. These two entries are the
    // ONLY copy in the product that instructs a resubmit, and the fence they
    // describe is scoped to a REPEAT. `wizard_session_id` survives a failed
    // submit (localStorage.ts:390-393), so the very user reading this sentence
    // can rename, pick a different file and submit — and until CR-01 that was
    // silently merged into the first strategy and reported as success.
    //
    // Both halves are now refused (process_key.py's 23505 name check, and the
    // stale-range fence in csv-finalize/route.ts). A refusal the user was never
    // warned about is still a dead end, so the copy owes them the escape: start
    // a new strategy. Asserting the ESCAPE rather than banning a phrase is
    // deliberate — a fragment ban is satisfied by deleting the sentence, which
    // would leave the user with less information, not more.
    for (const code of ["CSV_SUBMIT_FAILED", "CSV_SUBMIT_NO_STRATEGY_ID"] as const) {
      const copy = WIZARD_ERROR_COPY[code];
      const haystack = [copy.title, copy.cause, ...copy.fix]
        .join("   ")
        .toLowerCase();
      expect(
        haystack.includes("same file"),
        `${code} instructs a resubmit without saying WHICH file. The fence ` +
          `only holds for an unchanged one; a changed resubmit is refused.`,
      ).toBe(true);
      expect(
        haystack.includes("start a new strategy"),
        `${code} tells the user to submit again but never tells them what to ` +
          `do if the file or the name changed — which is now a refusal, not a ` +
          `merge. Without the escape they are dead-ended by our own guard.`,
      ).toBe(true);
    }
  });

  it("the guard can actually see a fix[] line, not only the title", () => {
    // A receipt for the scan's own reach. Two of the nine strings
    // (GATE_ANALYTICS_FAILED's notification claim and
    // CSV_SUBMIT_NO_STRATEGY_ID's idempotency promise) lived ONLY in `fix[]`.
    // If this fails, the scan above stopped covering the array and half the
    // class became invisible to it.
    const withMultipleFixLines = Object.values(WIZARD_ERROR_COPY).filter(
      (c) => c.fix.length > 1,
    );
    expect(withMultipleFixLines.length).toBeGreaterThan(10);
  });

  it("SERVICE_UNREACHABLE states the uncertainty instead of denying the write", () => {
    // Expected sentences are HAND-TYPED: reading WIZARD_ERROR_COPY[code].cause
    // on the expected side asserts only that a string equals itself.
    const copy = WIZARD_ERROR_COPY.SERVICE_UNREACHABLE;

    expect(copy.cause).toBe(
      "We sent the request and never got an answer — the connection failed or ran out of time. Because no answer came back, we cannot tell whether it was processed. This is on our side, not your key or your exchange.",
    );
    // The specific regression: this member homes UPSTREAM_TIMEOUT, where the
    // request WAS issued. It inherited "Nothing was submitted" from
    // SERVICE_UNAVAILABLE_RETRY, where a breaker DECLINED to send and the same
    // sentence is knowable. One code may say it; this one may not.
    expect(
      copy.cause.toLowerCase(),
      "A timeout is the canonical case in which the work may well have " +
        "completed. Denying the submission here is a negative we cannot see.",
    ).not.toContain("nothing was submitted");
    // ...and it must give a non-destructive way to find out.
    expect(copy.fix.join(" ")).toContain("/strategies");
  });

  it("SERVICE_UNAVAILABLE_RETRY keeps the claim it CAN make and drops the one it cannot", () => {
    const copy = WIZARD_ERROR_COPY.SERVICE_UNAVAILABLE_RETRY;

    expect(copy.cause).toBe(
      "We paused outbound requests after repeated failures so the service can recover, so this request was never sent. Nothing was submitted — this is on our side, not your key.",
    );
    // 140.3-05 aliased CIRCUIT_OPEN onto this member, so it is now reached at
    // FINALIZE too — where the key was stored several steps earlier.
    expect(
      copy.cause.toLowerCase(),
      "The key-storage claim is stale on the finalize path this member gained " +
        "in 140.3-05. The submission claim is true on both and stays.",
    ).not.toContain("has not been saved");
    expect(copy.cause.toLowerCase()).toContain("nothing was submitted");
  });

  it("RATE_LIMITED names no duration — the renderer supplies the server's own figure", () => {
    const copy = WIZARD_ERROR_COPY.RATE_LIMITED;
    const all = [copy.title, copy.cause, ...copy.fix].join(" ");

    // C-7: copy may name a wait only when one actually arrived. A static
    // duration in the table would be shown on every path, including those
    // where the server sent no Retry-After — a number we invented, presented
    // as the server's. ErrorEnvelope renders `retry_after_seconds` when it is
    // present and renders nothing when it is not.
    expect(
      all,
      "A duration written into the copy table is asserted unconditionally. " +
        "The honest figure is the server's Retry-After, and it belongs to the " +
        "renderer, not to this string.",
    ).not.toMatch(/\b\d+\s*(seconds?|minutes?|hours?)\b/i);
  });

  it("UNKNOWN makes no claim about notification in EITHER direction", () => {
    const copy = WIZARD_ERROR_COPY.UNKNOWN;
    const all = [copy.title, copy.cause, ...copy.fix].join(" ").toLowerCase();

    expect(copy.cause).toBe(
      "We could not classify this failure, so we cannot tell you what happened or whether your last action took effect.",
    );
    // The obvious over-correction is a SECOND false claim: 6 of the 15 routes
    // DO capture, and UNKNOWN is reachable from them. The client cannot tell
    // which route it came from, so the only sentence true on every path makes
    // no claim about our side at all.
    expect(all).not.toContain("been notified");
    expect(
      all,
      "Telling the user nothing reaches us is false on the 6 routes that do " +
        "capture. Say nothing, not the opposite.",
    ).not.toContain("not been alerted");
    expect(all).not.toContain("no one has been");
  });
});

/**
 * Phase 140.3-14 / TS-37 — THE COMPOSITE MEMBER CAP GETS ITS OWN CODE.
 *
 * `finalize-wizard` emitted `COMPOSITE_MEMBERSHIP_UNKNOWN` at FOUR sites. Three
 * are genuinely transient member-list reads and keep that code AND its retry.
 * The fourth — `members.length > MAX_COMPOSITE_MEMBERS` — is PERMANENT, and it
 * shipped wearing the transient envelope byte-identically, so an oversized draft
 * was handed a Retry control that could only ever fail again.
 *
 * ⚠️ ORACLE INDEPENDENCE. Every expected sentence below is a LITERAL typed in
 * this file. The ONE derived value is the cap NUMBER, and it is read from
 * `finalize-wizard/route.ts` — a DIFFERENT file from the subject — so the
 * assertion binds the copy to the constant it claims to describe rather than to
 * itself. That is the same cross-file discipline `seam-budgets.invariant.test.ts`
 * applies to the same constant.
 */
describe("[140.3-14 / TS-37] the composite member cap is a PERMANENT condition and says so", () => {
  const CODE = "COMPOSITE_TOO_MANY_MEMBERS" as const;

  /**
   * Read the cap from the ROUTE's own declaration. Hand-typing 10 on both sides
   * would let the constant and the sentence drift apart silently, which is the
   * exact failure DESIGN.md's "state the limitation with its threshold attached"
   * rule exists to prevent — a threshold that is stated but wrong is worse than
   * one that is omitted.
   */
  const MAX_COMPOSITE_MEMBERS_DECL = /^const MAX_COMPOSITE_MEMBERS = (\d+)/m;
  const ROUTE_PATH = resolve(
    __dirname,
    "../app/api/strategies/finalize-wizard/route.ts",
  );

  function capFromRoute(): number {
    const src = readFileSync(ROUTE_PATH, "utf-8");
    const m = MAX_COMPOSITE_MEMBERS_DECL.exec(src);
    if (!m) {
      throw new Error(
        "finalize-wizard/route.ts has no `const MAX_COMPOSITE_MEMBERS = <n>` " +
          "declaration, so the number this copy quotes is bound to nothing. " +
          "Restore the constant — do NOT relax this test.",
      );
    }
    return Number(m[1]);
  }

  it("the code exists in the table (without it the route's new code renders as UNKNOWN)", () => {
    expect(Object.keys(WIZARD_ERROR_COPY)).toContain(CODE);
  });

  it("names the LIMIT WITH ITS NUMBER, and the number is the route's own cap", () => {
    const copy = WIZARD_ERROR_COPY[CODE];
    const cap = capFromRoute();
    const all = [copy.title, copy.cause, ...copy.fix].join("   ");

    // A digit at all — DESIGN.md §Voice: name the threshold, do not gesture at
    // it. "more than we can handle" is the banned shape.
    expect(
      /\d/.test(all),
      "The cap copy quotes no number. A limitation stated without its " +
        "threshold tells the user nothing they can act on.",
    ).toBe(true);

    // …and the RIGHT digit, read from the route rather than typed twice here.
    expect(
      all.includes(String(cap)),
      `The copy does not mention the route's declared cap of ${cap}. The ` +
        "sentence and the constant have drifted apart, so the user is being " +
        "given a threshold that is not the one enforced.",
    ).toBe(true);
  });

  it("gives the REMEDY — remove keys — not a retry instruction", () => {
    const copy = WIZARD_ERROR_COPY[CODE];
    const all = [copy.title, copy.cause, ...copy.fix].join("   ").toLowerCase();

    expect(all).toContain("remove keys");
    // The lie this split exists to kill. "please retry" on a condition that
    // never clears is a dead end dressed as an affordance.
    expect(
      all,
      "The permanent cap copy is still telling the user to retry. Retrying " +
        "cannot reduce the number of keys on the draft.",
    ).not.toContain("please retry");
    expect(all).not.toContain("try again — the check usually succeeds");
  });

  it("verbatim title and first fix line — drift detection on the two sentences the user actually reads", () => {
    const copy = WIZARD_ERROR_COPY[CODE];
    expect(copy.title).toBe("This draft has more than 10 keys attached.");
    expect(copy.fix[0]).toBe(
      "Go back to the keys step and remove keys until 10 or fewer remain, then submit again.",
    );
  });

  it("carries NEITHER recoverable action, so `recoverable` is false and no Retry renders", () => {
    const actions = WIZARD_ERROR_COPY[CODE].actions as readonly string[];

    // Hand-typed: these two ARE `RECOVERABLE_ACTIONS` in src/lib/envelope.ts.
    // Importing that set would let a future edit that ADDS a member to it
    // silently satisfy this assertion.
    expect(actions).not.toContain("clear_and_retry");
    expect(actions).not.toContain("try_another_key");

    // POSITIVE half: it is not simply actionless. A code offering the user
    // nothing at all would satisfy both negatives above and be a worse dead end
    // than the one this replaces.
    expect(
      actions.length,
      "The permanent cap code offers the user no control at all. Removing the " +
        "wrong affordance is only half the fix; there must still be a way out.",
    ).toBeGreaterThan(0);
    expect(actions).toContain("request_call");
  });

  it("ANTI-REGRESSION: the THREE transient arms' code keeps its retry — the split went one way only", () => {
    // ⚠️ THE CASE THAT CATCHES A FIX APPLIED TO THE WRONG ARM. Three of the four
    // `COMPOSITE_MEMBERSHIP_UNKNOWN` emissions in finalize-wizard are genuine
    // transient reads; stripping their retry is the INVERSE defect and it would
    // be invisible to every assertion above.
    const transient = WIZARD_ERROR_COPY.COMPOSITE_MEMBERSHIP_UNKNOWN;
    expect(transient.actions).toContain("clear_and_retry");
    expect(transient.title).toBe(
      "We couldn't confirm this strategy's key membership.",
    );
  });

  it("the two codes are DISTINCT copy, not one entry aliased twice", () => {
    // A "split" implemented by pointing the new key at the old object would
    // pass the existence check and every actions assertion above only by
    // accident — and would re-create the byte-identical envelope this plan
    // exists to remove.
    const a = WIZARD_ERROR_COPY[CODE];
    const b = WIZARD_ERROR_COPY.COMPOSITE_MEMBERSHIP_UNKNOWN;
    expect(a.title).not.toBe(b.title);
    expect(a.cause).not.toBe(b.cause);
  });
});

/**
 * Phase 140.3-15 / TS-38 — THE CONFIG FAULT GETS ITS OWN COPY, AND NO RETRY.
 *
 * `process-key-client` now answers a `SeamConfigError` with the wire code
 * `SEAM_MISCONFIGURED` instead of `UPSTREAM_NETWORK_ERROR`. The wire vocabulary
 * and the wizard vocabulary are not the same set, so the code needs BOTH a
 * translation entry (`recogniseSeamErrorCode`) and copy of its own — without
 * the translation it lands on `UNKNOWN` and the obligation ships invisible with
 * every route-side test green (that is `140.3-14`'s M81, one plan ago).
 *
 * ⚠️ WHY A NEW MEMBER RATHER THAN AN ALIAS ONTO AN EXISTING ONE. This file's
 * own convention is that a second member with the same meaning is how a
 * vocabulary starts lying, so the three near-misses were read first and each
 * asserts something FALSE here:
 *   · SERVICE_UNREACHABLE — "We sent the request and never got an answer".
 *     `SeamConfigError` is raised BEFORE any store or network I/O, so no
 *     request was ever sent. It is also recoverable, and this is not.
 *   · SERVICE_UNAVAILABLE_RETRY — "We paused outbound requests … wait a moment,
 *     then try the same action again". True of a breaker, false of a config
 *     typo: waiting changes nothing until we redeploy.
 *   · VALIDATION_FAILED — "We sent a request that failed its shape check".
 *     Closest on BEHAVIOUR (non-recoverable, our software's fault) and wrong on
 *     the FACT: nothing was sent and nothing was shape-checked.
 *
 * ORACLE INDEPENDENCE: every expected sentence below is typed in this file.
 */
describe("[140.3-15 / TS-38] SEAM_MISCONFIGURED — our fault, permanent, no retry", () => {
  const CODE = "SEAM_MISCONFIGURED" as const;

  it("the wire code TRANSLATES to the wizard member — it does not fall to UNKNOWN", () => {
    expect(recogniseSeamErrorCode("SEAM_MISCONFIGURED")).toBe(CODE);
  });

  it("the copy exists and names the fault as ours, in hand-typed sentences", () => {
    const copy = WIZARD_ERROR_COPY[CODE];
    expect(copy.title).toBe(
      "We could not send this request — our own configuration is wrong.",
    );
    expect(copy.cause).toBe(
      "A setting on our side is wrong, so we stopped before sending the request. Nothing was submitted and nothing was changed. Retrying will not clear it: the setting stays wrong until we fix it and redeploy. This is not your key, your exchange or your data.",
    );
  });

  it("renders NO retry control — the condition is permanent until we redeploy", () => {
    const copy = WIZARD_ERROR_COPY[CODE];
    // `RECOVERABLE_ACTIONS` in src/lib/envelope.ts is exactly
    // {clear_and_retry, try_another_key}; carrying neither is what makes
    // `buildEnvelope` derive `recoverable: false`, which is what suppresses
    // ErrorEnvelope's Retry control. The absence IS the fix, not a side effect.
    expect(copy.actions).not.toContain("clear_and_retry");
    expect(copy.actions).not.toContain("try_another_key");
    // ...but it is not a dead end either: a code offering NOTHING would satisfy
    // every negative above while being strictly worse.
    expect(copy.actions.length).toBeGreaterThan(0);
    expect(copy.actions).toContain("request_call");
  });

  it("blames neither the upstream, the user's key, nor the exchange", () => {
    const copy = WIZARD_ERROR_COPY[CODE];
    const all = [copy.title, copy.cause, ...copy.fix].join(" ").toLowerCase();
    expect(all).not.toContain("could not reach");
    expect(all).not.toContain("ingestion service");
    expect(all).not.toMatch(/railway|upstash|vercel|supabase|localhost/);
    expect(all).not.toMatch(/https?:/);
    // No env var name, no internal identifier: the entry is user-facing copy.
    expect(all).not.toContain("analytics_service_url");
  });

  it("does not invite a retry anywhere in its copy, including the fix lines", () => {
    const copy = WIZARD_ERROR_COPY[CODE];
    // The fix lines are where a retry invitation hides from a title-only scan —
    // two of the nine claims 140.3-12 removed lived ONLY in `fix[]`.
    const fixText = copy.fix.join(" ").toLowerCase();
    expect(fixText).not.toMatch(/try (the same action|again)/);
    expect(fixText).not.toMatch(/wait a moment/);
    expect(copy.fix.join(" ")).toContain("security@quantalyze.com");
  });

  it("is DISTINCT copy from the three near-misses, not an alias of one of them", () => {
    const mine = WIZARD_ERROR_COPY[CODE];
    for (const other of [
      WIZARD_ERROR_COPY.SERVICE_UNREACHABLE,
      WIZARD_ERROR_COPY.SERVICE_UNAVAILABLE_RETRY,
      WIZARD_ERROR_COPY.VALIDATION_FAILED,
    ]) {
      expect(mine.title).not.toBe(other.title);
      expect(mine.cause).not.toBe(other.cause);
    }
  });

  it("ANTI-REGRESSION: the two transport wire codes still translate as they did", () => {
    // The new entry sits beside them in the ONE wire->wizard table. A sweep that
    // re-pointed the table would be invisible to every assertion above.
    expect(recogniseSeamErrorCode("UPSTREAM_NETWORK_ERROR")).toBe(
      "SERVICE_UNREACHABLE",
    );
    expect(recogniseSeamErrorCode("UPSTREAM_TIMEOUT")).toBe(
      "SERVICE_UNREACHABLE",
    );
    expect(recogniseSeamErrorCode("CIRCUIT_OPEN")).toBe(
      "SERVICE_UNAVAILABLE_RETRY",
    );
    expect(recogniseSeamErrorCode("NOT_A_SEAM_CODE")).toBe("UNKNOWN");
  });
});

// ===========================================================================
// Phase 140.5-02 / SEAMPROSE-03 — the §4a vocabulary
// ===========================================================================

describe("[140.5-02 / SEAMPROSE-03] DEF-140.4-C — ONE sentence for an unrecognised upstream failure", () => {
  /**
   * ORACLE INDEPENDENCE. Every expected string below is a LITERAL, transcribed
   * by hand from `140.5-CONTEXT.md` §4a (founder-authored, pre-approved copy).
   * Nothing here is imported from, or derived from, the module under test — a
   * `toBe(WIZARD_ERROR_COPY.X.title)` assertion passes for any implementation.
   *
   * ⚠️ SCOPE OF THIS ENTRY, from the CORRECTED §6c. `CSV_UPSTREAM_FAIL` is the
   * code for the UNRECOGNISED-OR-CODELESS upstream failure only. The CSV
   * routes' OWN caller-fault codes (`CSV_FILE_TOO_LARGE`, `CSV_INVALID_FORMAT`,
   * `CSV_RATE_LIMIT`, `CSV_SESSION_REUSED`, `CSV_PERSIST_FAIL`,
   * `CSV_FINALIZE_FAIL`) keep their own copy and must NEVER reach this entry:
   * "This is on our side, not your data" is FALSE for an 11 MB upload, and
   * "Nothing was saved" may be affirmatively false for `CSV_PERSIST_FAIL`.
   * Routing the three-way arm that enforces that is 140.5-05's, with negative
   * controls; this plan publishes only the vocabulary it consumes.
   */
  it("carries the founder heading VERBATIM", () => {
    expect(WIZARD_ERROR_COPY.CSV_UPSTREAM_FAIL.title).toBe(
      "We couldn't check your file just now.",
    );
  });

  it("splits the two founder sentences across cause/fix WITHOUT rewording either", () => {
    const copy = WIZARD_ERROR_COPY.CSV_UPSTREAM_FAIL;
    expect(copy.cause).toBe(
      "This is on our side, not your data. Nothing was saved.",
    );
    expect(copy.fix).toEqual([
      "Try again in a moment — if it keeps happening, send us this reference.",
    ]);
  });

  it("offers the retry control its own sentence promises (polarity re-derived, not copied)", () => {
    // `envelope.ts`'s RECOVERABLE_ACTIONS is {clear_and_retry, try_another_key}.
    // The copy says "try again in a moment", so without `clear_and_retry` the
    // envelope renders no Retry CTA and the sentence names a control that does
    // not exist. `request_call` is the "send us this reference" affordance.
    const { actions } = WIZARD_ERROR_COPY.CSV_UPSTREAM_FAIL;
    expect(actions).toContain("clear_and_retry");
    expect(actions).toContain("request_call");
    // Not destructive: this failure is ours, so nothing here offers to delete
    // the user's draft.
    expect(actions).not.toContain("start_fresh");
  });

  it("keeps the copy's dynamic-value count at ONE — correlation_id, rendered by the component", () => {
    // PATTERNS §9 static-copy rule. No URL, no status, no hostname, no env
    // name, and no interpolation token: `correlation_id` is printed by
    // `CsvValidationEnvelope`'s own footer line, never embedded in a string
    // here. A placeholder in the table would be a SECOND dynamic value.
    const copy = WIZARD_ERROR_COPY.CSV_UPSTREAM_FAIL;
    const blob = [copy.title, copy.cause, ...copy.fix].join("   ");
    expect(blob).not.toMatch(/\{[^}]*\}/);
    expect(blob).not.toMatch(/\$\{/);
    expect(blob).not.toMatch(/https?:\/\//);
    expect(blob.toLowerCase()).not.toContain("correlation_id");
  });

  it("PROMISE PIN — no CSV copy on this surface promises a per-row breakdown", () => {
    // ⚠️ THE PROMISE IS FALSE ON **BOTH** ARMS (RESEARCH §12.4), not only the
    // forwarded-upstream one: `csv_adapter.py` emits the rows under
    // `debug_context.violations`, `CsvValidationEnvelope` reads
    // `debug_context.pandera_errors` (zero Python hits), and `_envelope_error`
    // discards `debug_context` before the wire. The `<details>` blocks never
    // render, so the sentence is a promise the UI cannot keep.
    //
    // ABSENCE **and** PRESENCE, both halves. An absence-only assertion is
    // satisfied by deleting the entry, which would leave the user with less
    // information rather than honest information.
    const copy = WIZARD_ERROR_COPY.CSV_VALIDATION_FAILED;
    const blob = [copy.title, copy.cause, ...copy.fix].join("   ").toLowerCase();
    expect(blob).not.toContain("per-row breakdown");
    expect(blob).not.toContain("row-level breakdown");
    expect(copy.title).toBe("Your file did not pass validation.");
  });

  it("CSV_RATE_LIMIT is an EXPLICIT row in the wire table — the CSV surface's name for the RATE_LIMITED fact", () => {
    // The CSV routes stamp `Retry-After` on their 429 and mint the
    // surface-local code `CSV_RATE_LIMIT`. Without this row the code resolves
    // "UNKNOWN" and the one CSV wait the seam actually advertises is dropped.
    // `RATE_LIMITED`'s copy deliberately carries no duration — the figure is
    // the server's own header, rendered by `ErrorEnvelope`.
    expect(recogniseSeamErrorCode("CSV_RATE_LIMIT")).toBe("RATE_LIMITED");
  });

  it("CSV_RATE_LIMIT is NOT a WizardErrorCode, and that absence is load-bearing", () => {
    // ⚠️ DO NOT "FIX" THIS BY MINTING A `CSV_RATE_LIMIT` MEMBER OR ADDING IT TO
    // A `KNOWN_*` ROSTER. 140.5-05's three-way arm tries branch (1) — the code
    // is already a known wizard/route code, keep today's copy — BEFORE branch
    // (2), the wire-table hop. If `CSV_RATE_LIMIT` were admitted by branch (1)
    // it would keep today's copy and the stamped wait would never reach the
    // shared envelope. The ABSENCE is what routes it through the table.
    expect(Object.keys(WIZARD_ERROR_COPY)).not.toContain("CSV_RATE_LIMIT");
  });

  it("ANTI-REGRESSION: the pre-existing wire-table rows still answer as they did", () => {
    // A new row lands in the ONE shared table. A sweep that re-pointed the
    // table would be invisible to every assertion above.
    expect(recogniseSeamErrorCode("RATE_LIMITED")).toBe("RATE_LIMITED");
    expect(recogniseSeamErrorCode("VALIDATION_FAILED")).toBe("VALIDATION_FAILED");
    expect(recogniseSeamErrorCode("CIRCUIT_OPEN")).toBe("SERVICE_UNAVAILABLE_RETRY");
    expect(recogniseSeamErrorCode("SEAM_MISCONFIGURED")).toBe("SEAM_MISCONFIGURED");
    expect(recogniseSeamErrorCode("CSV_VALIDATION_FAILED")).toBe("UNKNOWN");
  });
});

describe("[140.5-02 / SEAMPROSE-03] the four scope/permission wire codes, answered BY TABLE", () => {
  /**
   * ⚠️ COVERAGE-LAW ROW 2. `VENUE_WIRE_CODE_TO_VERDICT` is a HAND-TYPED ROSTER
   * and these four rows are **PARTIAL BY CONSTRUCTION**, in those words. The
   * companion parity guard does not promote it to row 1 — what it adds is
   * fail-loud ARRIVAL for a newly-emitted code.
   *
   * ORACLE INDEPENDENCE: every `detail` below is hand-transcribed BYTE-FOR-BYTE
   * from the Python source that emits it. That byte-identity is the
   * cross-language contract — a reword on the Python side must red here.
   * Nothing is imported from, or derived from, the module under test.
   */
  function seamThrow(message: string, seamCode: string): Error {
    return Object.assign(new Error(message), { seamCode });
  }

  // exchange.py, the deribit scope-precheck arm, via key_permissions.py's
  // `scope_detail`.
  const MISSING_SCOPE_DETAIL = "key is missing required scope 'account:read'";
  // exchange.py, the ccxt.PermissionDenied arm.
  const PERMISSION_DENIED_DETAIL =
    "Key denied permission. Confirm the key has read-only scope and that your IP allowlist includes our service.";
  // exchange.py, the has_withdraw / has_trade arms.
  const WITHDRAW_SCOPE_DETAIL =
    "Key has withdrawal permissions. Please use a read-only key.";
  const TRADE_SCOPE_DETAIL =
    "Key has trading permissions. Please use a read-only key.";

  it("MISSING_SCOPE stops being UNKNOWN/500 — the DOGFOOD-3 dead end for a fixable key scope", () => {
    const verdict = classifyKeyValidationError(
      seamThrow(MISSING_SCOPE_DETAIL, "MISSING_SCOPE"),
    );
    expect(
      verdict.code,
      "A user was told 'we could not classify this failure' about their own " +
        "key's scope, which the exchange named precisely and which they can fix " +
        "in two clicks.",
    ).toBe("KEY_MISSING_READ_SCOPE");
    expect(verdict.status, "a caller fault is not a 5xx").toBe(400);
    // The same message with NO code still lands where it always did. This is
    // what proves the CODE — not a reworded predicate — moved the verdict.
    expect(classifyKeyValidationError(new Error(MISSING_SCOPE_DETAIL))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
  });

  it("PERMISSION_DENIED stops asserting an IP allowlist it never observed", () => {
    const verdict = classifyKeyValidationError(
      seamThrow(PERMISSION_DENIED_DETAIL, "PERMISSION_DENIED"),
    );
    expect(verdict.code).toBe("KEY_PERMISSION_DENIED");
    expect(
      verdict.code,
      "TRAP-3: the exchange named TWO possible causes and we picked one.",
    ).not.toBe("KEY_IP_ALLOWLIST");
    expect(verdict.status, "a permission refusal is the CALLER's fault").toBe(400);
    // ⭐ The mis-map is real, not hypothetical: the identical sentence with no
    // machine code STILL reaches KEY_IP_ALLOWLIST through the cascade, because
    // the `ip` + `allow` branch matches the REMEDY half of the sentence. That
    // is the measurement of what the table row bought.
    expect(classifyKeyValidationError(new Error(PERMISSION_DENIED_DETAIL))).toEqual(
      { code: "KEY_IP_ALLOWLIST", status: 502 },
    );
    // And the new copy must name BOTH candidates without asserting either.
    const copy = WIZARD_ERROR_COPY.KEY_PERMISSION_DENIED;
    const blob = [copy.title, copy.cause, ...copy.fix].join("   ").toLowerCase();
    expect(blob, "the scope candidate is missing").toContain("scope");
    expect(blob, "the allowlist candidate is missing").toContain("allowlist");
    // The old entry states the allowlist cause as observed fact. This one must
    // not, or the member was pointless.
    expect(blob).not.toContain("you enabled ip pinning");
    expect(
      WIZARD_ERROR_COPY.KEY_IP_ALLOWLIST.cause.toLowerCase(),
      "the ANTI-CONTROL: the entry we stopped routing here still makes the " +
        "single-cause claim, which is exactly why it is the wrong answer.",
    ).toContain("you enabled ip pinning");
  });

  it("WITHDRAW_SCOPE stops rendering copy that says TRADING", () => {
    expect(
      classifyKeyValidationError(
        seamThrow(WITHDRAW_SCOPE_DETAIL, "WITHDRAW_SCOPE"),
      ),
    ).toEqual({ code: "KEY_HAS_WITHDRAW_PERMS", status: 400 });
    // The cascade's `trading|withdraw` branch answered KEY_HAS_TRADING_PERMS
    // for BOTH, so a withdrawal-capable key was told its problem was trading.
    expect(classifyKeyValidationError(new Error(WITHDRAW_SCOPE_DETAIL))).toEqual({
      code: "KEY_HAS_TRADING_PERMS",
      status: 400,
    });
    // The copy the correct member renders must name WITHDRAWAL, not trading.
    const copy = WIZARD_ERROR_COPY.KEY_HAS_WITHDRAW_PERMS;
    expect(copy.title.toLowerCase()).toContain("withdraw");
  });

  it("TRADE_SCOPE is right BY TABLE, not by an accident of substring order", () => {
    // ⭐ This row changes nothing today. That is the point: it is what stops the
    // next reword on either side from changing it. Asserted alongside the
    // accident it replaces so the difference is visible.
    expect(
      classifyKeyValidationError(seamThrow(TRADE_SCOPE_DETAIL, "TRADE_SCOPE")),
    ).toEqual({ code: "KEY_HAS_TRADING_PERMS", status: 400 });
  });

  it("the six pre-existing venue rows still answer exactly as they did", () => {
    // ANTI-REGRESSION. Four rows landed in a shared table; a sweep that
    // re-pointed it would be invisible to every assertion above.
    const unchanged: Array<[string, WizardErrorCode, number]> = [
      ["RATE_LIMITED", "KEY_RATE_LIMIT", 503],
      ["PROBE_FAILED", "KEY_PROBE_FAILED", 503],
      ["AUTH_FAILED", "KEY_AUTH_FAILED", 400],
      ["EXCHANGE_UNAVAILABLE", "KEY_EXCHANGE_UNAVAILABLE", 503],
      ["NETWORK_UNAVAILABLE", "KEY_NETWORK_TIMEOUT", 502],
      ["DDOS_PROTECTION", "KEY_VENUE_TRANSIENT", 503],
    ];
    for (const [wire, code, status] of unchanged) {
      expect(
        classifyKeyValidationError(seamThrow("irrelevant prose", wire)),
        `the ${wire} row moved`,
      ).toEqual({ code, status });
    }
  });

  it("the two EXEMPT venue codes still reach the verdicts their reasons claim", () => {
    // ⚠️ The exemption reasons in `VENUE_WIRE_CODES_WITHOUT_VERDICT` are claims
    // about runtime behaviour. A reason nobody executes is prose. These two are
    // the ones whose reason says "reaches the cascade's terminal UNKNOWN/500,
    // and that is the honest answer" — so replay them and check.
    expect(
      classifyKeyValidationError(
        seamThrow("Unsupported exchange for permission verification.", "UNSUPPORTED_EXCHANGE"),
      ),
    ).toEqual({ code: "UNKNOWN", status: 500 });
    expect(
      classifyKeyValidationError(
        seamThrow(
          "Key validation failed unexpectedly. Contact support if this persists.",
          "VALIDATION_UNEXPECTED",
        ),
      ),
    ).toEqual({ code: "UNKNOWN", status: 500 });
  });
});

describe("[140.5-02 / B-02] the three real analytics-client messages, replayed", () => {
  /**
   * ⚠️ B-02 WAS OPEN AT HEAD, CONFIRMED BY EXECUTION, NOT BY READING. The
   * cascade's transport branch tests `lower.includes("timeout")`, and the
   * message this client actually produces says **"timed out"**. `"timed out"`
   * does not contain `"timeout"`. Replayed against the whole cascade before the
   * fix, all three of the client's real messages answered `UNKNOWN`/500 — the
   * "we could not classify this" terminal, with no retry affordance — and the
   * breaker cannot rescue it, because it needs 5 failures in 30 s and a Railway
   * outage arrives at human retry cadence with the breaker still CLOSED.
   *
   * THE FIX IS BY TYPE, NOT BY A WIDER SUBSTRING. Adding `"timed out"` to the
   * needle is a per-site edit that the next reword re-breaks (coverage-law
   * row 3), and it would still answer `KEY_NETWORK_TIMEOUT` — copy that blames
   * the EXCHANGE for a failure of our own hop.
   *
   * ORACLE INDEPENDENCE: the two message strings below are hand-transcribed
   * literals, byte-identical to what `analytics-client.ts` constructs. That
   * byte-identity is the cross-module contract — a reword on either side must
   * red here rather than silently reopening the dead arm.
   */
  const TIMED_OUT_MESSAGE =
    "Analytics service timed out after 15000ms on /process-key";
  const NOT_REACHABLE_MESSAGE =
    "Analytics service is not reachable. Please ensure it is running.";

  /** A transport throw from the seam client: the own marker, as assigned. */
  function transportThrow(message: string, seamTransportCode: string): Error {
    return Object.assign(new Error(message), { seamTransportCode });
  }

  it("a deadline miss reaches SERVICE_UNREACHABLE, not UNKNOWN/500", () => {
    expect(
      classifyKeyValidationError(
        transportThrow(TIMED_OUT_MESSAGE, "UPSTREAM_TIMEOUT"),
      ),
    ).toEqual({ code: "SERVICE_UNREACHABLE", status: 502 });
  });

  it("a connection that never completed reaches SERVICE_UNREACHABLE too", () => {
    expect(
      classifyKeyValidationError(
        transportThrow(NOT_REACHABLE_MESSAGE, "UPSTREAM_NETWORK_ERROR"),
      ),
    ).toEqual({ code: "SERVICE_UNREACHABLE", status: 502 });
  });

  it("the MARKER moved the verdict — the same prose with no marker still cannot earn it", () => {
    // ⭐ THE MEASUREMENT OF WHAT THE TYPE BRANCH BOUGHT, and the proof the fix
    // is not substring-carried. Both messages, unmarked, still answer exactly
    // what they answered before this plan.
    expect(classifyKeyValidationError(new Error(TIMED_OUT_MESSAGE))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
    expect(classifyKeyValidationError(new Error(NOT_REACHABLE_MESSAGE))).toEqual({
      code: "UNKNOWN",
      status: 500,
    });
    // And the token that makes the dead branch dead, stated as an assertion so
    // a reword on either side is caught: "timed out" ∌ "timeout".
    expect(TIMED_OUT_MESSAGE.toLowerCase()).not.toContain("timeout");
  });

  it("the THIRD real message — an upstream non-2xx — is untouched by this branch", () => {
    // NEGATIVE CONTROL. RESEARCH lists three producible messages; only two are
    // transport failures. An upstream error carries a body, so it is the
    // `seamCode` branch's business, and a marker branch that swallowed it would
    // report a service that ANSWERED as one we could not reach.
    expect(
      classifyKeyValidationError(new Error("Analytics service error (502)")),
    ).toEqual({ code: "UNKNOWN", status: 500 });
  });

  it("SERVICE_UNREACHABLE's copy does NOT borrow the breaker's 'nothing was submitted'", () => {
    // ⚠️ 140.3-12 fixed this once and it must not be re-merged. The breaker
    // DECLINED to send, so "nothing was submitted" is knowable there. A
    // deadline firing tells us nothing about whether the far side processed the
    // request — it is the canonical case where the work may well have
    // completed. This branch routes timeouts here, so the distinction is now
    // load-bearing for a second producer.
    const copy = WIZARD_ERROR_COPY.SERVICE_UNREACHABLE;
    const blob = [copy.title, copy.cause, ...copy.fix].join("   ").toLowerCase();
    expect(blob).not.toContain("nothing was submitted");
    expect(WIZARD_ERROR_COPY.SERVICE_UNAVAILABLE_RETRY.cause.toLowerCase()).toContain(
      "nothing was submitted",
    );
  });

  it("a non-string marker is ignored and never decides a verdict", () => {
    // Same fence as the `seamCode` read: the property is data, and data can be
    // anything. Prototype-shaped strings must not resolve through the table
    // either.
    for (const bogus of [42, null, {}, [], true, undefined]) {
      expect(
        classifyKeyValidationError(
          Object.assign(new Error("some unclassified string"), {
            seamTransportCode: bogus,
          }),
        ),
      ).toEqual({ code: "UNKNOWN", status: 500 });
    }
    expect(
      classifyKeyValidationError(
        Object.assign(new Error("some unclassified string"), {
          seamTransportCode: "constructor",
        }),
      ),
    ).toEqual({ code: "UNKNOWN", status: 500 });
  });

  it("the CircuitOpenError type check still outranks the marker", () => {
    // Ordering is load-bearing: the breaker verdict must never be decided by
    // anything an upstream — or a marker on a wrapped error — can set.
    const breakerTrip = Object.assign(new CircuitOpenError(30), {
      seamTransportCode: "UPSTREAM_TIMEOUT",
    });
    expect(classifyKeyValidationError(breakerTrip)).toEqual({
      code: "SERVICE_UNAVAILABLE_RETRY",
      status: 503,
    });
  });

  it("COLLISION INVARIANT, re-derived for this branch (not copied)", () => {
    // The branch is a table lookup, so it cannot collide with a substring the
    // way the cascade's members do. What it CAN do is shadow an earlier
    // verdict, so the invariant to re-run is: neither real message matches any
    // cascade branch that would otherwise have claimed it. Asserted rather than
    // asserted-in-a-comment.
    for (const message of [TIMED_OUT_MESSAGE, NOT_REACHABLE_MESSAGE]) {
      const lower = message.toLowerCase();
      for (const needle of [
        "signature",
        "invalid secret",
        "authentication failed",
        "invalid_credentials",
        "master password",
        "broker server",
        "allow",
        "rate",
        "429",
        "timeout",
        "etimedout",
        "could not verify",
        "permission scope",
        "probe",
        "trading",
        "withdraw",
      ]) {
        expect(
          lower.includes(needle),
          `"${message}" contains "${needle}" — the cascade would have claimed ` +
            `it, so the marker branch is now SHADOWING a verdict rather than ` +
            `rescuing an unclassified one. Re-derive before moving either side.`,
        ).toBe(false);
      }
    }
  });
});

/**
 * Phase 142.2-07 / MT5-04 (D-05) — THE SPLIT OF `KEY_INVALID_FORMAT`.
 *
 * The two wizard connect routes answered ONE code at twelve guards each. Eleven
 * of the twelve were not format failures at all — a malformed body, an
 * unsupported venue, a missing api_key, two venue server switches, two
 * missing-secret arms, a missing OKX passphrase, a missing session id and three
 * length caps — and every one rendered "This does not look like a valid API key
 * for the selected exchange", opening with a sentence that blamed a CLIENT-SIDE
 * check. Every one of those 24 sites is a server-side route guard, so the
 * sentence was false at all of them.
 *
 * These cases cover the REGISTRY half. The (status, code) pairing per guard is
 * pinned in the two route specs, and the three-registry membership invariant is
 * pinned in `wizardErrors.invariant.test.ts`.
 */
describe("[142.2-07 / MT5-04] KEY_INVALID_FORMAT split into four honest causes", () => {
  /**
   * HAND-TYPED, and deliberately not derived from the union or from either
   * roster: a derivation compared against a second derivation cannot fail. If
   * this list and the shipped table disagree, one of them is wrong and the
   * failure has to name which code moved.
   */
  const NEW_CODES = [
    "KEY_MISSING_REQUIRED_FIELD",
    "KEY_UNSUPPORTED_VENUE",
    "KEY_VENUE_NOT_ENABLED",
    "KEY_INPUT_TOO_LONG",
  ] as const;

  it("the KEY_INVALID_FORMAT cause no longer claims a CLIENT-SIDE check", () => {
    const copy = WIZARD_ERROR_COPY.KEY_INVALID_FORMAT;

    // The exact regression, stated on the string that carried it. Every site
    // that emitted this code is a guard inside a Next route handler; the
    // browser never ran a format check on the secret at all.
    expect(
      copy.cause.toLowerCase(),
      "The cause opened 'Client-side format check failed', which was false at " +
        "every one of the 24 sites that carried this code — all of them are " +
        "server-side route guards. Correcting the sentence is half the fix; " +
        "the other half is that only a genuine format failure still reaches it.",
    ).not.toContain("client-side");

    // HAND-TYPED expected sentence. Reading the module's own value onto the
    // expected side would assert only that a string equals itself.
    expect(copy.cause).toBe(
      "A format check on our side rejected the API secret before anything was sent to the exchange. Binance secrets are 64 hex characters; OKX and Bybit use different formats.",
    );

    // The per-venue guidance is the half worth KEEPING, and it only becomes
    // true once the split leaves this code on the `api_secret.length < 8` ccxt
    // arm. A future edit that drops it makes the entry less useful, not safer.
    expect(copy.cause).toContain("64 hex characters");
  });

  it.each(NEW_CODES)(
    "%s resolves to a real entry — title, cause, and at least one fix step",
    (code) => {
      const copy = formatKeyError(code);

      // Non-UNKNOWN is the load-bearing half: a code in the union with no table
      // entry falls through to the UNKNOWN fallback, which would replace one
      // wrong sentence with a vaguer one.
      expect(
        copy.title,
        `${code} rendered the UNKNOWN fallback — it has no entry of its own.`,
      ).not.toBe(WIZARD_ERROR_COPY.UNKNOWN.title);

      expect(copy.title.length).toBeGreaterThan(4);
      expect(copy.cause.length).toBeGreaterThan(20);
      expect(copy.fix.length).toBeGreaterThanOrEqual(1);
      for (const step of copy.fix) expect(step.length).toBeGreaterThan(10);
      expect(copy.actions.length).toBeGreaterThanOrEqual(1);
      expect(copy.docsHref).toMatch(/^\/security/);
    },
  );

  /**
   * HAND-TYPED INTERNAL-VOCABULARY DENYLIST.
   *
   * The defect this phase closes is copy that describes OUR machinery to a user
   * who cannot act on it. The founder's actual failure was a server-side venue
   * switch reported as a key-format problem — and the tempting "fix" is to name
   * the switch, which trades a false sentence for an unactionable one and leaks
   * an internal name (V7). Static strings, so no scrubber runs over them; the
   * discipline `scrubSeamError` / `scrub_freeform_string` enforce on DERIVED
   * strings is written into the copy by hand and asserted here.
   *
   * Matched at a WORD BOUNDARY with a trailing-word-character allowance, not as
   * a bare substring: a substring match on "env" reddens on "seven" and one on
   * "gate" reddens on "propagate", and a guard that cries wolf gets deleted.
   * The allowance is what keeps "flags", "gated" and "environment" caught.
   *
   * ⚠️ KNOWN LIMIT, stated rather than hidden — and it was MEASURED by this
   * file's own self-test failing on it, not reasoned about in advance. The
   * trailing allowance also matches an innocent word that merely STARTS with a
   * denylisted term: "flagrant" trips "flag". The alternative (exact-word match)
   * lets "flags", "gated" and "environment" through, which are the forms the
   * offending copy would actually take. The false positive is a word no error
   * copy on this surface would use; the false negatives are the likely ones. If
   * a legitimate string ever trips it, add the word to a narrow exemption with
   * its reason — do not drop the allowance.
   */
  const INTERNAL_VOCABULARY: readonly string[] = [
    "MT5_ENABLED",
    "SFOX_ENABLED",
    "flag",
    "env",
    "seam",
    "gate",
    "server-side",
    "endpoint",
    "worker",
  ];

  function offendingTerms(text: string): string[] {
    return INTERNAL_VOCABULARY.filter((term) =>
      new RegExp(`\\b${term}\\w*\\b`, "i").test(text),
    );
  }

  it.each(NEW_CODES)("%s's copy carries no internal vocabulary", (code) => {
    const copy = WIZARD_ERROR_COPY[code];
    const strings = [copy.title, copy.cause, ...copy.fix];

    for (const s of strings) {
      expect(
        offendingTerms(s),
        `${code} names something a user cannot see or act on, in: "${s}". ` +
          `Say what THEY should change, never what our software is doing.`,
      ).toEqual([]);
    }
  });

  it("SELF-TEST — the denylist scanner can actually fire, and does not cry wolf", () => {
    // Without the positive half, "no offenders" is indistinguishable from a
    // regex that matches nothing — the vacuity failure that makes an absence
    // assertion green forever.
    expect(offendingTerms("MT5_ENABLED is not set on the server")).toContain(
      "MT5_ENABLED",
    );
    expect(offendingTerms("the feature flags are off")).toContain("flag");
    expect(offendingTerms("the seam returned nothing")).toContain("seam");
    expect(offendingTerms("this venue is gated")).toContain("gate");
    expect(offendingTerms("read the env var")).toContain("env");

    // The negative half: the boundary allowance exists so ordinary English does
    // not redden the guard. Each of these CONTAINS a denylisted substring and
    // must not match.
    for (const innocent of [
      "seven of the fields",
      "eventually the exchange responds",
      "we propagate the change",
      "investigate the mismatch",
      "the exchange rejected the request",
    ]) {
      expect(
        offendingTerms(innocent),
        `"${innocent}" is ordinary prose and must not trip the denylist.`,
      ).toEqual([]);
    }
  });

  it("the four new codes are members of the union AND resolve through formatKeyError", () => {
    // A compile-time membership check would be satisfied by a cast; this is the
    // runtime half. The `satisfies` below is the static half and fails
    // typecheck if a name drifts.
    const codes = NEW_CODES satisfies readonly WizardErrorCode[];
    for (const code of codes) {
      expect(Object.keys(WIZARD_ERROR_COPY)).toContain(code);
      expect(formatKeyError(code).title).toBe(WIZARD_ERROR_COPY[code].title);
    }
  });

  it("KEY_VENUE_NOT_ENABLED is NOT recoverable — no Retry control on a closed venue", () => {
    // Behaviour, not copy: `envelope.ts` derives `recoverable` from `actions`,
    // and neither member of RECOVERABLE_ACTIONS (`clear_and_retry`,
    // `try_another_key`) is present. Resubmitting the identical request while
    // the venue is closed can only fail again — the same reasoning
    // COMPOSITE_TOO_MANY_MEMBERS and SEAM_MISCONFIGURED are built on.
    const actions = WIZARD_ERROR_COPY.KEY_VENUE_NOT_ENABLED
      .actions as readonly string[];
    expect(actions).not.toContain("clear_and_retry");
    expect(actions).not.toContain("try_another_key");
    // ...but it must still offer a way out, or it is a dead end (TRAP-4).
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions).toContain("request_call");
  });

  it("'not supported' and 'not open yet' stay DISTINCT codes with distinct copy", () => {
    // The split's whole point in miniature. Collapsing these two would tell a
    // user to abandon a venue that is coming, or to wait for one that is not.
    const never = WIZARD_ERROR_COPY.KEY_UNSUPPORTED_VENUE;
    const notYet = WIZARD_ERROR_COPY.KEY_VENUE_NOT_ENABLED;

    expect(never.title).not.toBe(notYet.title);
    expect(never.cause).not.toBe(notYet.cause);
    expect(notYet.title.toLowerCase()).toContain("yet");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Phase 153.1-03 / WIZFORM-03 / D-17 — a remedy that presupposes a fact about
// the context renders ONLY when the context supports it.
//
// ⚠️ WRITTEN OVER THE WHOLE COPY TABLE AND OVER THE WHOLE VENUE ALLOWLIST, and
// that is the entire point. Three sweeps written over the three codes this plan
// happened to tag would be the instance-not-class defect moved out of the
// source and into the test — and the second Falsifiability mutation for this
// requirement (a SECOND non-substitutable venue, no copy change) exists
// specifically to tell the two apart.
//
// Oracle independence: every expectation below is a hand-typed literal, a
// hand-typed regex, or an INDEPENDENT registry (`SUPPORTED_EXCHANGES`,
// `venueIsSubstitutable`). Nothing reads `fixRequires` to build the value it
// then compares `fixRequires` against.
// ══════════════════════════════════════════════════════════════════════════
describe("[153.1-03 / WIZFORM-03] fix[] requirements — the class, not the instances", () => {
  const ALL_CODES = Object.keys(WIZARD_ERROR_COPY) as WizardErrorCode[];

  /**
   * HAND-TYPED. Covers all three live phrasings — "switch to a different
   * exchange", "try a different exchange account" — plus "another venue" for a
   * bullet nobody has written yet. Deliberately NOT derived from the table: a
   * pattern built out of the strings it is meant to police matches them by
   * construction and can never find a fourth one.
   */
  const SUBSTITUTION_RE =
    /switch to a different exchange|different exchange account|another venue/i;

  it("the substitution pattern is CAPABLE of matching — positive control", () => {
    // Guards the failure this phase has now hit eleven times: a sweep that is
    // green because its matcher matches nothing at all. `binance` is
    // substitutable, so the bullet MUST be there for it.
    expect(
      formatKeyError("KEY_NETWORK_TIMEOUT", { venue: "binance" }).fix.some((b) =>
        SUBSTITUTION_RE.test(b),
      ),
      "The substitution regex found nothing even for a substitutable venue. " +
        "The sweep below is then vacuously green for every venue.",
    ).toBe(true);
    expect(
      formatKeyError("KEY_RATE_LIMIT", { venue: "binance" }).fix.some((b) =>
        SUBSTITUTION_RE.test(b),
      ),
    ).toBe(true);
    expect(
      formatKeyError("KEY_PROBE_FAILED", { venue: "binance" }).fix.some((b) =>
        SUBSTITUTION_RE.test(b),
      ),
    ).toBe(true);
  });

  it("SWEEP 1: no non-substitutable venue receives a venue-substitution bullet, for ANY code", () => {
    const nonSubstitutable = SUPPORTED_EXCHANGES.filter(
      (venue) => !venueIsSubstitutable(venue),
    );

    // Non-vacuity floor A — a sweep over an empty venue list is green forever.
    expect(
      nonSubstitutable.length,
      "No venue in SUPPORTED_EXCHANGES answers venueIsSubstitutable === false, " +
        "so this sweep asserts nothing. Either the capability record lost its " +
        "mt5 row or the predicate's default inverted (153.1-02).",
    ).toBeGreaterThanOrEqual(1);

    const offenders: string[] = [];
    let checked = 0;
    for (const venue of nonSubstitutable) {
      for (const code of ALL_CODES) {
        for (const bullet of formatKeyError(code, { venue }).fix) {
          checked++;
          if (SUBSTITUTION_RE.test(bullet)) {
            offenders.push(`${venue} / ${code}: "${bullet}"`);
          }
        }
      }
    }

    // Non-vacuity floor B — hand-typed, and deliberately far below the real
    // count (~180 bullet-checks today) so ordinary table growth does not
    // touch it, while a table or venue list that collapsed to nothing does.
    expect(
      checked,
      "The loop body barely executed — the table or the venue list is empty.",
    ).toBeGreaterThan(50);

    expect(
      offenders,
      "A venue whose ACCOUNT IS THE VENUE was told to switch venues. That is " +
        "the unwinnable-remedy class (D-17 / MT5-13): the user cannot act on " +
        "it, so the panel is asking them to do something impossible. Tag the " +
        "bullet with a substitutable requirement in WIZARD_ERROR_COPY — do " +
        "NOT add a per-code branch to formatKeyError. Offenders:",
    ).toEqual([]);
  });

  it("SWEEP 2: a bullet that presupposes a surface is SUPPRESSED when no surface is named (Gate B)", () => {
    let covered = 0;
    for (const code of ALL_CODES) {
      const entry = WIZARD_ERROR_COPY[code];
      const requires = entry.fixRequires;
      if (requires === undefined) continue;
      // Driven off fixRequires, not off a list of codes, so a fifth
      // surface-conditional bullet added later is covered automatically.
      requires.forEach((req, i) => {
        if (req === null || req === undefined || req.kind !== "surface") return;
        covered++;
        const bullet = entry.fix[i];
        expect(
          formatKeyError(code).fix,
          `${code} bullet ${i} presupposes the "${req.surface}" surface but ` +
            "rendered with NO surface in context. Fail toward saying less: " +
            "the live defect was this exact bullet advising a /strategies " +
            "detour on the connect step, where nothing was being submitted.",
        ).not.toContain(bullet);
        expect(
          formatKeyError(code, { surface: req.surface }).fix,
          `${code} bullet ${i} did NOT render on the very surface it requires ` +
            `("${req.surface}") — the requirement suppressed it everywhere, ` +
            "which is a silent copy deletion, not a gate.",
        ).toContain(bullet);
      });
    }
    expect(
      covered,
      "No entry declares a surface requirement, so this sweep asserts nothing.",
    ).toBeGreaterThanOrEqual(1);
  });

  it("SWEEP 3: every fixRequires array is index-aligned to its fix array", () => {
    const tagged = ALL_CODES.filter(
      (code) => WIZARD_ERROR_COPY[code].fixRequires !== undefined,
    );

    // HAND-TYPED FLOOR — the four entries 153.1-03 tags. Never
    // `tagged.length` compared to something derived from `tagged`.
    expect(
      tagged.length,
      "Fewer than the four entries 153.1-03 tagged carry fixRequires. An " +
        "entry lost its requirements, which means a venue- or " +
        "surface-conditional bullet is rendering unconditionally again.",
    ).toBeGreaterThanOrEqual(4);

    for (const code of tagged) {
      const entry = WIZARD_ERROR_COPY[code];
      expect(
        entry.fixRequires!.length,
        `${code}: fixRequires is a PARALLEL array — the ONE thing this shape ` +
          "can silently get wrong. A length mismatch does not throw; it " +
          "silently shifts every requirement onto the wrong bullet, so a " +
          "remedy is gated on a condition that belongs to its neighbour. " +
          "Added a bullet? Add its slot (null = always render).",
      ).toBe(entry.fix.length);
    }
  });

  it("SWEEP 4: every entry WITHOUT fixRequires returns the identical fix array reference", () => {
    let checked = 0;
    for (const code of ALL_CODES) {
      const entry = WIZARD_ERROR_COPY[code];
      if (entry.fixRequires !== undefined) continue;
      checked++;
      expect(
        formatKeyError(code, { venue: "binance", surface: "connect" }).fix,
        `${code} has no requirements, so the filter must not run for it at ` +
          "all. Reference identity — not deep equality — is what proves that: " +
          "a new array with the same strings would mean the filter DID run " +
          "and the additive guarantee rests on it happening to agree.",
      ).toBe(entry.fix);
    }
    // Hand-typed floor: ~60 untagged entries today, well clear of 40.
    expect(
      checked,
      "Almost nothing was checked — either the table shrank or nearly every " +
        "entry became conditional.",
    ).toBeGreaterThan(40);
  });

  it("an MT5 user reads the truthful replacement, not merely a shorter list (D-17)", () => {
    // HAND-TYPED verbatim from the UI-SPEC Gate C row. The replacement must be
    // a static table string — nothing caller-supplied reaches the envelope
    // through `context.venue`, which is read ONLY as a lookup key.
    const REPLACEMENT =
      "This is your broker account, so there is no other venue to try. If it keeps failing, email security@quantalyze.com with the correlation id below.";
    for (const code of [
      "KEY_PROBE_FAILED",
      "KEY_RATE_LIMIT",
      "KEY_NETWORK_TIMEOUT",
    ] as const) {
      const fix = formatKeyError(code, { venue: "mt5" }).fix;
      expect(
        fix,
        `${code}: a non-substitutable venue got its substitution bullet ` +
          "removed and NOTHING put in its place. The UI-SPEC asks for copy " +
          "that states the truth and invents no remedy, not for silence.",
      ).toContain(REPLACEMENT);
      expect(fix.length).toBe(2);
    }
  });

  it("a ccxt venue — and a caller that names no venue — is byte-identical to HEAD", () => {
    // HAND-TYPED expected arrays: the pre-plan values. Reading the table for
    // the expected side would assert only that a string equals itself.
    const HEAD_TIMEOUT = [
      "Try again in a moment.",
      "If it keeps failing, switch to a different exchange or contact support.",
    ];
    expect(
      formatKeyError("KEY_NETWORK_TIMEOUT", { venue: "binance" }).fix,
    ).toEqual(HEAD_TIMEOUT);
    expect(formatKeyError("KEY_NETWORK_TIMEOUT").fix).toEqual(HEAD_TIMEOUT);
    expect(formatKeyError("KEY_RATE_LIMIT", { venue: "okx" }).fix).toEqual([
      "Wait 60 seconds and try again.",
      "If it persists, try a different exchange account or contact support.",
    ]);
    // An UNKNOWN venue string keeps the incumbent copy too — absence and
    // unresolved both answer `substitutable` with the predicate's default.
    expect(
      formatKeyError("KEY_PROBE_FAILED", { venue: "kraken" }).fix,
    ).toEqual([
      "Try again in a moment.",
      "If it keeps failing, switch to a different exchange or contact support.",
    ]);
  });
});

/**
 * [153.1-04 / WIZFORM-02] THE TWO `EXPECTED_TABLE_SIZE` SITES ARE ONE FACT.
 *
 * ⚠️ WHY THIS EXISTS. The size guard is pinned TWICE — once in the
 * `[140.3-10 / TRAP-4]` describe and once in `[140.3-12 / SEAMUX-04]` — because
 * each scan needs its own shrink detector and each carries its own reasoning
 * docblock. Neither `it` can see the other's constant: they are separate
 * function scopes, so nothing has ever stopped a plan from moving one and
 * leaving the other behind. That half-fix does not red anything at the moment
 * it is made; it reds LATER, on the next plan, which then inherits a
 * contradiction it did not create. 153.1-04 moved both, and this is what makes
 * the next mover unable to move only one.
 *
 * The subject is this file's own SOURCE, which is the only vantage point from
 * which both declarations are visible at once. `wizardErrors.test.ts` already
 * reads a sibling module's source for the copy-marker hand-off, so the
 * technique is the file's own.
 */
describe("[153.1-04 / WIZFORM-02] the two EXPECTED_TABLE_SIZE pins cannot silently diverge", () => {
  it("both declarations are hand-typed literals, and they are the SAME literal", () => {
    const source = readFileSync(join(__dirname, "wizardErrors.test.ts"), "utf-8");
    // Matches a DECLARATION with a numeric literal only. An `EXPECTED_TABLE_SIZE
    // = Object.keys(...).length` would not match, and would therefore fail the
    // count assertion below rather than sneak past as agreement — which is the
    // point: the two guards' own docblocks forbid a derived value, and this is
    // where that prohibition becomes enforceable across both at once.
    const declarations = [
      ...source.matchAll(/const EXPECTED_TABLE_SIZE = (\d+);/g),
    ].map((m) => Number(m[1]));

    // ⭐ POSITIVE CONTROL, and the reason it is an assertion rather than a
    // comment: if the regex above ever stops matching (a rename, a reformat, a
    // derived value), `declarations` is empty and `new Set([]).size === 1` is
    // FALSE — but `[...new Set([])].length <= 1` would have been vacuously
    // true. Pinning the count to a hand-typed 2 is what stops this whole `it`
    // from passing over nothing.
    expect(
      declarations.length,
      "Expected exactly TWO hand-typed EXPECTED_TABLE_SIZE declarations in " +
        "this file. Zero means the matcher stopped matching and everything " +
        "below is vacuous; more than two means a third pin appeared and the " +
        "reasoning docblocks no longer enumerate the sites.",
    ).toBe(2);

    expect(
      new Set(declarations).size,
      "The two EXPECTED_TABLE_SIZE pins disagree: " +
        declarations.join(" vs ") +
        ". Moving one and not the other is a silent half-fix — one scan keeps " +
        "its shrink detection and the other one loses it, and nothing reds " +
        "until a later plan inherits the contradiction. Move both, and re-run " +
        "EACH docblock's reasoning over the new entries; the two guards scan " +
        "different populations, so the clause one site needs is not the clause " +
        "the other needs.",
    ).toBe(1);

    // Both pins describe the SAME table, so they must also still describe it.
    // This is not a duplicate of the two size guards: they each answer "did my
    // scan's population change?", this answers "are these two literals about
    // the object I think they are about?" — the question that only has meaning
    // once the two are known to agree.
    expect(declarations[0]).toBe(Object.keys(WIZARD_ERROR_COPY).length);
  });
});

/**
 * [153.6-06 / PARITY-05] THE PROBE-FAILURE PAIR, ASSERTED AS A PAIR.
 *
 * `KEY_SCOPE_CHECK_UNAVAILABLE` and `KEY_SCOPE_CHECK_UNREADABLE` describe the
 * same subsystem failing in two ways that differ by ONE fact — whether the probe
 * answered — and that fact is exactly what decides whether a retry can win. They
 * are asserted together, in one block, because every plausible regression here
 * moves BOTH: sweeping the parse miss back onto the permanent code takes a
 * working control away from a self-clearing condition, and widening the
 * permanent code's `actions` to give the parse miss its Retry hands the same
 * control to an arm where retrying is guaranteed to fail. A block that pinned
 * only the new entry would catch the first and miss the second.
 *
 * ⭐ THE ORACLE IS `buildEnvelope`'s DERIVATION, never the `actions` array. The
 * claim under test is "a Retry control renders", and that is decided by
 * `buildEnvelope` reading `actions` against `RECOVERABLE_ACTIONS` and then by
 * `ErrorEnvelope`'s `showRetry = recoverable && Boolean(onRetry)`. Asserting
 * `actions` would restate what the table says about itself and would stay green
 * if the derivation rule ever changed — the convention this file's own import
 * comment states, applied here in the RECOVERABLE direction for the first time.
 */
describe("[153.6-06 / PARITY-05] the probe-failure pair renders opposite controls", () => {
  it("the parse-miss code derives recoverable — the Retry control renders", () => {
    const envelope = buildEnvelope("KEY_SCOPE_CHECK_UNREADABLE", "corr-1");
    expect(
      envelope.recoverable,
      "A 2xx body our schema cannot read is what a half-rolled analytics " +
        "deploy serves. It clears by itself, so a Retry is the honest control — " +
        "and its absence was the dead end 153.6-06 exists to remove.",
    ).toBe(true);
  });

  it("the permanent code stays NON-recoverable — no Retry, unchanged", () => {
    const envelope = buildEnvelope("KEY_SCOPE_CHECK_UNAVAILABLE", "corr-2");
    expect(
      envelope.recoverable,
      "⛔ T-153.6-E2. The parse miss got its Retry back by MINTING a code, not " +
        "by widening this one's actions. If this is now true, the affordance " +
        "leaked onto the arm where a retry is guaranteed to fail.",
    ).toBe(false);
  });

  it("the two carry DIFFERENT copy — a shared entry would defeat the split", () => {
    // The split is only real if the user can tell the two apart. Comparing the
    // two rendered titles couples this to the table without reading either
    // expectation out of it.
    const unreadable = formatKeyError("KEY_SCOPE_CHECK_UNREADABLE");
    const unavailable = formatKeyError("KEY_SCOPE_CHECK_UNAVAILABLE");
    expect(unreadable.title).not.toBe(unavailable.title);
    expect(unreadable.cause).not.toBe(unavailable.cause);
  });

  it("⛔ the new copy never claims we could not reach the exchange", () => {
    // THE REMOVED LIE, pinned so it cannot come back through the copy table.
    // 153.2-04 moved this condition off `KEY_NETWORK_TIMEOUT` precisely because
    // that entry opens "We could not reach the exchange." — false here, because
    // the exchange answered and OUR schema could not read the reply. Restoring
    // the Retry control by restoring that code would have been the easy fix and
    // would have re-shipped the untruth; this is what makes that route red.
    const copy = formatKeyError("KEY_SCOPE_CHECK_UNREADABLE");
    const haystack = [copy.title, copy.cause, ...copy.fix]
      .join("   ")
      .toLowerCase();
    for (const banned of ["reach the exchange", "the exchange did not"]) {
      expect(
        haystack.includes(banned),
        `The parse-miss copy says "${banned}". The exchange ANSWERED — the ` +
          `body was ours to read and we could not. Blaming the venue for our ` +
          `own deploy is the lie 153.2-04 removed.`,
      ).toBe(false);
    }
    // The POSITIVE half: it must actually say the thing that makes waiting the
    // right move. Without this the guard passes on copy that says nothing.
    expect(
      /again/i.test(haystack),
      "The copy must tell the user to try again — the Retry control it now " +
        "renders is otherwise unexplained.",
    ).toBe(true);
  });

  it("the parse-miss entry offers no DRAFT-DESTROYING way out", () => {
    // The condition is a deploy of ours in flight. `start_fresh` deletes the
    // draft and cascades away every `strategy_keys` member under it, which
    // would answer "wait thirty seconds" by destroying the user's work.
    const copy = formatKeyError("KEY_SCOPE_CHECK_UNREADABLE");
    expect(copy.actions).not.toContain("start_fresh");
    expect(copy.actions).not.toContain("try_another_key");
  });
});

/**
 * [153.1-04 / WIZFORM-02] THE TEN NEW MEMBERS, AS A CLASS.
 *
 * ⚠️ WHY A SWEEP AND NOT TEN CASES. The plan's acceptance criteria were three
 * behaviours checked once, by hand, at authoring time: none of the ten offers a
 * Retry, and neither optional count reaches a sentence when it was not
 * supplied. A check run once is a measurement, not a guard — and the whole
 * reason these members exist is that a Retry control was offered against a
 * condition retrying could not clear, which nothing in this file would have
 * noticed. So the measurements are pinned here.
 *
 * The roster below is HAND-TYPED, deliberately. Deriving it (say, every code
 * matching /^METADATA_/) would make the sweep agree with whatever the table
 * happens to contain, and a member accidentally dropped from the union would
 * take its own assertion out with it. Ten names, typed out, is the oracle.
 */
describe("[153.1 review CR-01 / WR-03] every FIELD-LEVEL refusal is NON-recoverable", () => {
  // The sweep above is keyed on "the ten members 153.1-04 MINTED", which is a
  // provenance, not a class. `METADATA_DESCRIPTION_REQUIRED` is answered by the
  // same `validatePayload` block against the same kind of rule, but it is a
  // Phase-53 entry that 153.1-05 merely POINTED the route at — so it fell
  // outside that roster and kept a `clear_and_retry` for the whole phase while
  // three artefacts asserted the class held. That is the instance-not-class
  // shape this phase exists to delete, so the class is asserted here on what
  // the codes ARE rather than on when they were written.
  //
  // HAND-TYPED, and deliberately NOT derived from `KNOWN_FINALIZE_CODES` or
  // from a `startsWith("METADATA_")` filter: an oracle read off the same
  // structure under test moves with it. This is the roster of codes
  // `finalize-wizard` answers a FORM FIELD with (route.ts `validatePayload`).
  const FIELD_LEVEL: readonly WizardErrorCode[] = [
    "METADATA_NAME_INVALID",
    "METADATA_DESCRIPTION_REQUIRED",
    "METADATA_DESCRIPTION_TOO_SHORT",
    "METADATA_DESCRIPTION_TOO_LONG",
    "METADATA_CATEGORY_REQUIRED",
    "METADATA_AUM_INVALID",
    "METADATA_CAPACITY_INVALID",
    "METADATA_CAPITAL_OWNERSHIP_INVALID",
  ];

  it("all eight exist in the table, and there are eight of them", () => {
    // Non-vacuity for the sweep below, and the rename detector.
    expect(FIELD_LEVEL.length).toBe(8);
    for (const code of FIELD_LEVEL) {
      expect(
        Object.keys(WIZARD_ERROR_COPY),
        `${code} is named as a field-level refusal but has no copy entry.`,
      ).toContain(code);
    }
  });

  it("NOT ONE of the eight derives recoverable — no Retry control renders", () => {
    // Reported as a POPULATION, not code-by-code: a per-code assertion stops at
    // the first offender and hides the rest of the class.
    const offenders = FIELD_LEVEL.filter(
      (code) => buildEnvelope(code, "corr-cr01").recoverable,
    );
    expect(
      offenders,
      "A field-level refusal derived `recoverable: true`, so SubmitStep " +
        "renders a Retry wired to `onRetry={() => setErrorCode(null)}` that " +
        "re-POSTs the identical payload against the identical server rule and " +
        "is refused identically. The remedy is on the FORM — see the class " +
        "docblock in wizardErrors.ts, which forbids `clear_and_retry` here BY " +
        "NAME because it wipes what the user typed. Recoverability is derived " +
        "STRUCTURALLY from `actions ∩ RECOVERABLE_ACTIONS`: the fix is to " +
        "remove the action, never to special-case the code.",
    ).toEqual([]);
  });
});

describe("[153.1-04 / WIZFORM-02] the ten new members offer no false affordance", () => {
  /** HAND-TYPED — this plan's entire contract with 153.1-05, 153.2 and 153.4. */
  const NEW_MEMBERS: readonly WizardErrorCode[] = [
    "METADATA_NAME_INVALID",
    "METADATA_DESCRIPTION_TOO_SHORT",
    "METADATA_DESCRIPTION_TOO_LONG",
    "METADATA_CATEGORY_REQUIRED",
    "METADATA_AUM_INVALID",
    "METADATA_CAPACITY_INVALID",
    "METADATA_CAPITAL_OWNERSHIP_INVALID",
    "SEAM_DEADLINE_EXCEEDED",
    "COMPOSITE_UNSUPPORTED_UNIFIED",
    "DRAFT_STATE_INVALID",
  ];

  it("all ten exist in the table, and there are ten of them", () => {
    // Non-vacuity for every `it` below, plus the rename detector: a member
    // renamed on one side only leaves a name here with no entry there.
    expect(NEW_MEMBERS.length).toBe(10);
    for (const code of NEW_MEMBERS) {
      expect(
        Object.keys(WIZARD_ERROR_COPY),
        `${code} is named in 153.1-04's contract but has no copy entry. A code ` +
          "with no entry renders UNKNOWN exactly as an unknown code does, " +
          "which is the failure WIZFORM-02 is about.",
      ).toContain(code);
    }
  });

  it("NOT ONE of the ten derives recoverable — no Retry control renders", () => {
    for (const code of NEW_MEMBERS) {
      expect(
        buildEnvelope(code, "corr-153104").recoverable,
        `${code} derived recoverable: true, so ErrorEnvelope renders a Retry ` +
          "button. Every one of these ten refuses on a condition an identical " +
          "resubmission cannot change — a field the server compared against a " +
          "fixed rule, a deadline that fires the same way every time, a draft " +
          "the database has already moved past. A Retry there is a false " +
          "affordance, and the founder clicking it five times is the incident " +
          "that produced this phase. Recoverability is derived from `actions`: " +
          "one of `clear_and_retry` / `try_another_key` got added.",
      ).toBe(false);
    }
  });

  it("the description pair names NO count when it was not given one (TRAP-3)", () => {
    for (const code of [
      "METADATA_DESCRIPTION_TOO_SHORT",
      "METADATA_DESCRIPTION_TOO_LONG",
    ] as const) {
      const bare = formatKeyError(code);
      // The BOUND may appear (a rule stated without its threshold is not a
      // rule). What must not appear is the user's own count, or the machinery
      // that would have carried it.
      expect(
        [bare.title, bare.cause, ...bare.fix].join(" "),
        `${code} named the user's character count with no charCount in ` +
          "context. Absence means 'we were not told how long it is' — never " +
          "zero, never empty. A surface that invents a count turns a vague " +
          "refusal into a specific lie.",
      ).not.toMatch(/you have|\{n\}|\{charCount\}/);
    }
    // ...and the counted form really is produced when the count IS given, so the
    // rule above is a gate rather than a deletion.
    expect(
      formatKeyError("METADATA_DESCRIPTION_TOO_SHORT", { charCount: 2 }).title,
    ).toBe("Add at least 10 characters — you have 2.");
    expect(
      formatKeyError("METADATA_DESCRIPTION_TOO_LONG", { charCount: 5231 }).title,
    // 153.1 review WR-02 — "to N or fewer", not "under N". The server rejects
    // on `length > MAX_DESCRIPTION_CHARS`, so exactly 5,000 is ACCEPTED and
    // "under 5,000" would name a ceiling of 4,999 that nothing enforces.
    ).toBe("Keep this to 5,000 characters or fewer — you have 5,231.");
  });

  it("SEAM_DEADLINE_EXCEEDED names NO budget when it was not given one (TRAP-3)", () => {
    const bare = formatKeyError("SEAM_DEADLINE_EXCEEDED");
    expect(
      bare.cause,
      "The cause named a number with no budgetSeconds in context. Absence " +
        "means 'no budget was named' — never zero and never 'immediately'. " +
        "This is the same rule retryAfterSeconds states for durations, and " +
        "the reason the table sentence says 'the time we allow'.",
    ).not.toMatch(/\d/);
    expect(
      formatKeyError("SEAM_DEADLINE_EXCEEDED", { budgetSeconds: 120 }).cause,
    ).toContain("120 seconds");
    // The tail is shared between the two forms, so it must survive the swap.
    expect(
      formatKeyError("SEAM_DEADLINE_EXCEEDED", { budgetSeconds: 120 }).cause,
    ).toContain("your key was not stored");
  });

  it("SEAM_DEADLINE_EXCEEDED pluralises its budget (153.1 review WR-04)", () => {
    // A one-second budget rendered "We gave your broker 1 seconds to answer".
    // 153.4 is the emitter and passes a real budget; a sub-second or
    // one-second budget is plausible during a retune, and the
    // MULTI_KEY_WINDOWS_INVALID arm in the same function already pluralises,
    // so the bare form broke this file's own convention.
    expect(
      formatKeyError("SEAM_DEADLINE_EXCEEDED", { budgetSeconds: 1 }).cause,
      "the singular budget rendered with a plural noun.",
    ).toContain("1 second to answer");
    // ...and the plural is not collateral damage: only n === 1 loses the "s".
    for (const n of [0, 2, 120]) {
      expect(
        formatKeyError("SEAM_DEADLINE_EXCEEDED", { budgetSeconds: n }).cause,
        `${n} seconds lost its plural — the ternary is inverted or too wide.`,
      ).toContain(`${n} seconds to answer`);
    }
  });
});

/**
 * [154.1 / WIZCONT-02 review CR] `VENUE_ALREADY_CONNECTED` — a refusal that is
 * TRUE, and that offers no control which cannot work.
 *
 * ⚠️ WHAT THIS MEMBER REPLACED. `create-with-key`'s venue fence used to resolve a
 * re-connect onto ANY strategy hanging off the live key, finalized ones
 * included, and every arm downstream answered `DRAFT_ALREADY_EXISTS` — "A wizard
 * session with this key is already in progress", with `resume_draft` and
 * `start_fresh`. Once the resolver was narrowed to real drafts, that sentence
 * became the fall-through for a user whose account is held by a FINISHED
 * strategy, where all of it is false: there is no draft, nothing is in progress,
 * there is nothing to resume, and `start_fresh` would delete a draft that is not
 * there.
 *
 * These are the COPY half of the fix. The route half — that the arm exists,
 * refuses, writes nothing, and names the strategy — is pinned in
 * `create-with-key/route.test.ts`'s `[154.1]` block.
 */
describe("[154.1 / WIZCONT-02] VENUE_ALREADY_CONNECTED — the honest refusal", () => {
  it("is a union member with copy of its OWN — not the UNKNOWN fallback", () => {
    // A code in the union with no entry renders UNKNOWN exactly as an unknown
    // code does, which is the silent-ship failure every roster note in this
    // repo warns about.
    expect(Object.keys(WIZARD_ERROR_COPY)).toContain("VENUE_ALREADY_CONNECTED");
    expect(formatKeyError("VENUE_ALREADY_CONNECTED").title).not.toBe(
      WIZARD_ERROR_COPY.UNKNOWN.title,
    );
  });

  it("is DISTINCT copy from DRAFT_ALREADY_EXISTS, not an alias of it", () => {
    const split = formatKeyError("VENUE_ALREADY_CONNECTED");
    const parent = WIZARD_ERROR_COPY.DRAFT_ALREADY_EXISTS;
    expect(split.title).not.toBe(parent.title);
    expect(split.cause).not.toBe(parent.cause);
  });

  it("makes NEITHER of the two claims that were false about a finished strategy", () => {
    const copy = WIZARD_ERROR_COPY.VENUE_ALREADY_CONNECTED;
    const haystack = [copy.title, copy.cause, ...copy.fix]
      .join("   ")
      .toLowerCase();
    // These are the two sentences the user acted on and could not satisfy: they
    // went looking for a session that is not there.
    expect(
      haystack,
      "the split kept the parent's claim that a session is under way.",
    ).not.toContain("in progress");
    expect(
      haystack,
      "there is no draft to resume — that is the entire reason this member " +
        "exists.",
    ).not.toContain("resume");
  });

  it("offers NO Retry control — resubmitting the same account is refused identically", () => {
    // Behaviour, not copy: `envelope.ts` derives `recoverable` from `actions`,
    // and neither member of RECOVERABLE_ACTIONS is present.
    expect(
      buildEnvelope("VENUE_ALREADY_CONNECTED", "corr-1541").recoverable,
      "a Retry button here can only ever fail again — the account stays " +
        "connected until the user acts on the EXISTING strategy.",
    ).toBe(false);
    // The UNKNOWN contrast is what keeps the assertion above discriminating: an
    // envelope that rendered no controls at all would satisfy it vacuously.
    expect(buildEnvelope("UNKNOWN", "corr-1541").recoverable).toBe(true);
  });

  it("offers NO start_fresh — the one destructive control, and there is no draft to delete", () => {
    // The parent entry DOES offer it, correctly: a draft exists there. Here the
    // same control would delete the FINISHED strategy's own wizard session —
    // destroying the very thing the copy tells the user to go and open.
    expect(WIZARD_ERROR_COPY.DRAFT_ALREADY_EXISTS.actions).toContain(
      "start_fresh",
    );
    expect(WIZARD_ERROR_COPY.VENUE_ALREADY_CONNECTED.actions).not.toContain(
      "start_fresh",
    );
    expect(WIZARD_ERROR_COPY.VENUE_ALREADY_CONNECTED.actions).not.toContain(
      "resume_draft",
    );
  });

  it("names NO strategy when it was not given one (TRAP-3)", () => {
    const bare = formatKeyError("VENUE_ALREADY_CONNECTED");
    // Absence means "we were not told which strategy" — never a placeholder,
    // never an empty pair of quotes. The table sentence must stand alone.
    expect(
      [bare.title, bare.cause, ...bare.fix].join(" "),
      "the copy printed the interpolation machinery, or an empty name.",
    ).not.toMatch(/\{strategyName\}|""|It is connected to/);
    expect(bare.cause.length).toBeGreaterThan(20);
  });

  it("...and DOES name it when it was given one, so the rule above is a gate not a deletion", () => {
    const named = formatKeyError("VENUE_ALREADY_CONNECTED", {
      strategyName: "Helios Momentum",
    });
    expect(named.cause).toContain('It is connected to "Helios Momentum".');
    // The table sentence survives the prepend — the naming line ADDS a fact, it
    // does not replace the explanation.
    expect(named.cause).toContain(
      WIZARD_ERROR_COPY.VENUE_ALREADY_CONNECTED.cause,
    );
  });

  it("a BLANK name degrades to the unnamed sentence rather than empty quotes", () => {
    // `strategies.name` is NOT NULL at the database, but whitespace is not a
    // name, and a sentence pointing at nothing is worse than one that points at
    // nothing in particular.
    for (const blank of ["", "   ", "\t\n"]) {
      expect(
        formatKeyError("VENUE_ALREADY_CONNECTED", { strategyName: blank }).cause,
        `a ${JSON.stringify(blank)} name produced a naming sentence.`,
      ).toBe(WIZARD_ERROR_COPY.VENUE_ALREADY_CONNECTED.cause);
    }
  });

  it("the naming arm is SCOPED to this code — it cannot leak onto a neighbour", () => {
    // The arm keys on the code as well as on the context field. Passing the
    // context to a different member must leave that member byte-identical, or
    // an unrelated failure starts naming a strategy that has nothing to do with
    // it.
    expect(
      formatKeyError("DRAFT_ALREADY_EXISTS", { strategyName: "Helios Momentum" })
        .cause,
    ).toBe(WIZARD_ERROR_COPY.DRAFT_ALREADY_EXISTS.cause);
  });
});

/**
 * [161-05 / WIZERR-03] KEY_ORPHANED — THE REFUSAL, AND THE ONE PROPERTY THAT
 * MAKES IT AN IMPROVEMENT RATHER THAN A RENAME.
 *
 * The code it replaces (`DRAFT_ALREADY_EXISTS`, reached at `create-with-key`'s
 * 23505 fallthrough) was false on both halves: it named a wizard session that
 * does not exist, and it offered `resume_draft` / `start_fresh` for a draft that
 * is gone. Minting a truer sentence is only half the fix — a truer sentence
 * attached to a remedy that still cannot succeed is the same defect in better
 * prose. So this block pins the REMEDY, not the wording.
 *
 * ⭐ THE ORACLE IS `buildEnvelope`'s DERIVATION, never the `actions` array —
 * the convention `[153.6-06 / PARITY-05]` above states. Asserting `actions`
 * alone would restate the table against itself and stay green if the derivation
 * rule ever changed.
 */
describe("[161-05 / WIZERR-03] KEY_ORPHANED offers a remedy that can succeed", () => {
  it("derives recoverable — and derives it from try_another_key, not clear_and_retry", () => {
    expect(
      buildEnvelope("KEY_ORPHANED", "corr-orphan-1").recoverable,
      "The Retry control on ConnectKeyStep is `onRetry={() => setErrorCode(null)}`: " +
        "it clears the banner and returns the user to the form so a DIFFERENT " +
        "key can be typed. Losing recoverability here strands a user whose only " +
        "route forward is that control.",
    ).toBe(true);

    expect(
      WIZARD_ERROR_COPY.KEY_ORPHANED.actions,
      "⛔ `clear_and_retry` means 'send the same thing again'. The same account " +
        "is refused by the same partial UNIQUE every time, so that member would " +
        "make `recoverable` true for a reason that is false. Recoverability on " +
        "this arm must rest on try_another_key alone.",
    ).not.toContain("clear_and_retry");
  });

  it("offers neither to resume a draft nor to delete one — there is no draft", () => {
    // The two controls the false incumbent offered. `start_fresh` is the
    // destructive one (140.3-10 / TRAP-4), and offering it on an arm whose whole
    // premise is that no draft exists is the worst available combination: a
    // destructive control aimed at nothing.
    for (const forbidden of ["resume_draft", "start_fresh"] as const) {
      expect(
        WIZARD_ERROR_COPY.KEY_ORPHANED.actions,
        `KEY_ORPHANED offers ${forbidden}, but this code is emitted only after ` +
          "the resolver established that NO strategy — draft or otherwise — " +
          "hangs off the key.",
      ).not.toContain(forbidden);
    }
  });

  it("names no key-management surface this arm cannot reach (the measured 161-05 divergence)", () => {
    // MEASURED at HEAD, 2026-08-24. The user standing in this wizard is a
    // manager, and every surface that can remove an `api_keys` row is out of
    // their reach on this arm:
    //   · `components/strategy/ApiKeyManager.tsx` (which does carry a delete) is
    //     mounted at `strategies/[id]/edit/page.tsx` and nowhere else — a
    //     per-STRATEGY surface, and this code exists because NO strategy holds
    //     the key;
    //   · `AllocatorExchangeManager` (profile → Exchanges), the only other list
    //     with a Disconnect control, sits behind `allocatorOnly` in
    //     `ProfileTabs.tsx`;
    //   · `my-strategies` renders the orphan as a "No strategy yet" row whose
    //     only control is "Finish setup →", which reopens this same wizard.
    // 161-UI-SPEC's draft bullet ("Disconnect the unused key under Manage keys,
    // then connect it here again") named the first of those. It was replaced,
    // not reworded, and this case is what stops it coming back.
    //
    // Hand-typed and lower-cased: a PHRASE CLASS, not a pinned sentence, so an
    // honest reword stays green and a re-introduction reds.
    const UNREACHABLE_SURFACES = ["manage keys", "manage your keys"] as const;

    const phrasesIn = (haystack: string): string[] =>
      UNREACHABLE_SURFACES.filter((p) => haystack.toLowerCase().includes(p));

    // POSITIVE CONTROL FIRST — the predicate is live, and the phrase list is not
    // a list of strings nobody would write. ⛔ Never delete this: with an empty
    // phrase list the assertion below passes while checking nothing.
    expect(
      phrasesIn("Disconnect the unused key under Manage keys, then connect it here again."),
      "The unreachable-surface predicate matched NOTHING in the exact sentence " +
        "161-UI-SPEC proposed, so it has gone blind and the assertion below is " +
        "passing for the wrong reason. ⛔ Fix the phrase list, never delete this " +
        "control.",
    ).not.toEqual([]);

    const copy = WIZARD_ERROR_COPY.KEY_ORPHANED;
    const surface = [copy.title, copy.cause, ...copy.fix].join(" | ");
    // Guards the `"anything".includes("")` shape from the other direction: an
    // emptied haystack would satisfy the `toEqual([])` below while asserting
    // nothing about any sentence we ship.
    expect(
      surface.length,
      "the copy under test collapsed to nothing, so the scan below is vacuous",
    ).toBeGreaterThan(80);
    expect(
      phrasesIn(surface),
      "KEY_ORPHANED points the user at a key-management surface this arm cannot " +
        "reach: no strategy holds the key, so there is no strategy edit page, " +
        "and profile → Exchanges is allocator-only. A remedy the user cannot " +
        "perform is the D-17 class this requirement exists to remove.",
    ).toEqual([]);
  });
});

/**
 * [161-05 / WIZERR-11] KEY_AUTH_FAILED STOPS NAMING DERIBIT AT EVERYONE ELSE.
 *
 * This code is returned by the SHARED `classifyKeyValidationError`, so every
 * venue reaches it. Until this plan its `cause` carried "(e.g. Deribit returns
 * invalid_credentials)" and its second bullet ended "— on Deribit the key is the
 * ClientId and the secret is the ClientSecret", which meant a Binance user whose
 * secret was mistyped was told to go and check a "ClientId" that does not exist
 * in their console. A specific, checkable claim about a venue the reader is not
 * on is a worse failure than vagueness: it sends them to a different problem.
 *
 * ⭐ THE ASSERTIONS ARE OVER THE FULL FORMATTED OUTPUT — title, cause and EVERY
 * bullet joined — not over the one bullet that was gated. A test that watched
 * only the gated bullet would have stayed green through the `cause` half of this
 * defect, which is the half that shipped for longer.
 *
 * ⭐ AND THE NEGATIVE SWEEP RUNS OVER THE WHOLE VENUE REGISTRY, not over the two
 * venues this plan happened to think of. `SUPPORTED_EXCHANGES` is an independent
 * source (`closed-sets.ts`), so a seventh venue is covered on the day it is
 * added rather than on the day someone remembers this file.
 */
describe("[161-05 / WIZERR-11] KEY_AUTH_FAILED names a venue only to that venue's own users", () => {
  /** The full user-visible surface of the card, as one string. */
  const rendered = (context?: Parameters<typeof formatKeyError>[1]): string => {
    const copy = formatKeyError("KEY_AUTH_FAILED", context);
    return [copy.title, copy.cause, ...copy.fix].join(" | ");
  };

  /**
   * HAND-TYPED. The venue token that must not escape its own venue. Lower-cased
   * comparison so a re-cased reintroduction ("DERIBIT", "deribit") still reds.
   */
  const VENUE_TOKEN = "deribit";

  it("POSITIVE CONTROL — the token IS present for a Deribit user, so the sweeps below are live", () => {
    // ⛔ Never delete this. Every assertion in this block is a "does not
    // contain", and a copy entry that lost the bullet entirely — or a predicate
    // that suppressed it for everyone — would satisfy all of them while the
    // Deribit user silently lost real information.
    const forDeribit = rendered({ venue: "deribit" }).toLowerCase();
    expect(
      forDeribit.includes(VENUE_TOKEN),
      "The Deribit-specific bullet did not render for venue 'deribit'. The " +
        "requirement suppressed it everywhere, which is a silent copy deletion " +
        "rather than a gate — and it makes every negative assertion below pass " +
        "for the wrong reason.",
    ).toBe(true);
    // And it is the NAMING bullet specifically, not an incidental match.
    expect(
      formatKeyError("KEY_AUTH_FAILED", { venue: "deribit" }).fix,
    ).toContain(
      "On Deribit the key is the ClientId and the secret is the ClientSecret.",
    );
  });

  it("the CAUSE is venue-neutral for every venue — including Deribit's own users", () => {
    // The `cause` was the half that could not be gated, because it was an
    // ILLUSTRATION rather than a remedy: "(e.g. Deribit returns
    // invalid_credentials)". Deleting it is the fix, so the sentence must carry
    // no venue on ANY path — a gate here would have been the wrong tool.
    for (const venue of [...SUPPORTED_EXCHANGES, undefined]) {
      const copy = formatKeyError(
        "KEY_AUTH_FAILED",
        venue === undefined ? undefined : { venue },
      );
      expect(
        copy.cause.toLowerCase(),
        `the cause named a venue for ${venue ?? "an unnamed venue"}. ` +
          "The cause explains a general authentication failure; naming one " +
          "exchange in it is a claim about a reader we cannot identify.",
      ).not.toContain(VENUE_TOKEN);
    }
  });

  it("a BINANCE user sees the token NOWHERE in the whole card — and still gets a complete remedy", () => {
    const forBinance = rendered({ venue: "binance" });
    expect(
      forBinance.length,
      "the rendered card collapsed to nothing, so the scan below is vacuous",
    ).toBeGreaterThan(120);
    expect(
      forBinance.toLowerCase(),
      "A Binance user was told about Deribit's ClientId/ClientSecret. There is " +
        "no such pair in their console, so the remedy sends them to look for a " +
        "different problem — the false-sentence class WIZERR-11 removes.",
    ).not.toContain(VENUE_TOKEN);
    // ⛔ THE OTHER HALF, AND THE ONE A CARELESS FIX BREAKS: suppressing the
    // venue-specific bullet must not cost the user the instruction it carried.
    expect(
      formatKeyError("KEY_AUTH_FAILED", { venue: "binance" }).fix,
      "The generic re-copy instruction vanished along with the Deribit bullet. " +
        "That is not a gate, it is a copy deletion: the unconditional bullet " +
        "exists precisely so every venue keeps an actionable remedy.",
    ).toContain("Re-copy both values with no leading or trailing spaces.");
  });

  it("an ABSENT venue sees the token NOWHERE — the STRICT rule, diverging from the capability default", () => {
    // ⚠️ THE DIVERGENCE UNDER TEST. `venueCapability` requirements are
    // default-PERMISSIVE: with no venue in context `venueIsSubstitutable`
    // answers true and the incumbent bullet survives, so callers predating the
    // field are byte-unchanged. This kind is the opposite, and it must be: a
    // bullet that names ONE venue, rendered when the venue is unknown, is a
    // specific claim about a user we cannot identify. `SyncPreviewStep` calls
    // `formatKeyError(errorCode)` with no context at all, so this path is live.
    const withNoContext = rendered();
    expect(
      withNoContext.length,
      "the rendered card collapsed to nothing, so the scan below is vacuous",
    ).toBeGreaterThan(120);
    expect(
      withNoContext.toLowerCase(),
      "With no venue in context the Deribit bullet still rendered. Absence is " +
        "not permission: unify this with the venueCapability default and every " +
        "context-less caller starts naming Deribit again.",
    ).not.toContain(VENUE_TOKEN);
    expect(
      formatKeyError("KEY_AUTH_FAILED").fix,
      "and the venue-less caller must still get the generic instruction",
    ).toContain("Re-copy both values with no leading or trailing spaces.");
  });

  it("SWEEP: no venue in the registry OTHER than deribit ever sees the token", () => {
    // The class, not the two instances above. Driven off the independent venue
    // registry so a seventh venue is covered the day it lands.
    const others = SUPPORTED_EXCHANGES.filter((v) => v !== "deribit");
    expect(
      others.length,
      "SUPPORTED_EXCHANGES yielded no non-deribit venue, so this sweep asserts " +
        "nothing.",
    ).toBeGreaterThanOrEqual(4);

    const offenders: string[] = [];
    for (const venue of others) {
      const surface = rendered({ venue });
      if (surface.toLowerCase().includes(VENUE_TOKEN)) {
        offenders.push(`${venue}: "${surface}"`);
      }
    }
    expect(
      offenders,
      "KEY_AUTH_FAILED named Deribit at users of another venue. ⛔ The remedy " +
        "is a FixRequirement slot in the copy table, never a per-code branch " +
        "inside formatKeyError. Offenders:",
    ).toEqual([]);
  });

  it("the venue is a LOOKUP/COMPARISON KEY ONLY — no caller string round-trips into the card (D-17)", () => {
    // T-161-13. The context field is typed `string`, so a caller CAN pass
    // something that is not a supported venue. Whatever they pass, none of it
    // may appear in the rendered output: the requirement compares it, it never
    // renders it.
    const probe = "zz-injected-venue-probe";
    const surface = rendered({ venue: probe });
    expect(
      surface,
      "A caller-supplied venue string reached the rendered card. The venue is " +
        "read as a comparison key against a closed-set member and must never " +
        "be interpolated into a sentence (D-17).",
    ).not.toContain(probe);
    // An unknown venue is not deribit, so it is suppressed like an absent one.
    expect(surface.toLowerCase()).not.toContain(VENUE_TOKEN);
  });
});

/**
 * [161-07 / WIZERR-09] THE ATOMIC PAIR, FROM THE COPY SIDE.
 *
 * `gateFailureToWizardError` answered `INSUFFICIENT_CSV_HISTORY` with
 * `UNKNOWN` under a comment asserting the code "never flows through the wizard
 * error mapper". The wizard's composite arm started evaluating the 7-day floor
 * in the SAME commit as this describe, which makes that premise false — and a
 * floor landing without its copy would have shipped a real gate refusal
 * explained by the generic unknown-error sentence, which is strictly worse than
 * the un-floored arm: the user is stopped AND told nothing.
 *
 * The exhaustive `switch` in `gateFailureToWizardError` enforces half of the
 * atomicity for free (a union member with no arm, or an arm with no member,
 * fails `tsc`). What it cannot enforce is that the arm returns a member with
 * REAL COPY rather than `UNKNOWN`, which is what the first case here pins.
 */
describe("[161-07 / WIZERR-09] INSUFFICIENT_CSV_HISTORY renders copy of its own, never UNKNOWN", () => {
  const CODE: WizardErrorCode = "GATE_INSUFFICIENT_CSV_HISTORY";

  /** Every user-visible string on the entry, joined — never just the title. */
  const surface = (): string => {
    const copy = formatKeyError(CODE);
    const joined = [copy.title, copy.cause, ...copy.fix].join("   ");
    // NON-VACUITY GUARD, and not a formality: `"anything".includes("")` is
    // `true`, so every negative assertion below would pass against an empty
    // render. This is the floor that makes them mean something.
    expect(
      joined.length,
      "The rendered surface is empty or near-empty, which makes every " +
        "not.toMatch below vacuously green.",
    ).toBeGreaterThan(120);
    return joined;
  };

  it("the gate code maps to a real member — the UNKNOWN fallthrough is gone", () => {
    expect(gateFailureToWizardError("INSUFFICIENT_CSV_HISTORY")).toBe(CODE);
  });

  it("ANTI-CONTROL: the three transient analytics codes still answer UNKNOWN", () => {
    // Without this, "map every gate code to something" satisfies the case
    // above. The three below are POLL states, not terminal errors: rendering
    // an error card for them would be the misuse UNKNOWN exists to flag, and
    // the flip must be surgical rather than wholesale.
    const transient: GateFailureCode[] = [
      "ANALYTICS_MISSING",
      "ANALYTICS_PENDING",
      "ANALYTICS_COMPUTING",
    ];
    for (const code of transient) {
      expect(gateFailureToWizardError(code), `${code} must stay UNKNOWN`).toBe(
        "UNKNOWN",
      );
    }
  });

  it("names the threshold as the NUMBER 7 and invents no other number", () => {
    // Hand-typed needle. ⛔ NEVER `${STRATEGY_GATE_MIN_CSV_ROWS}` — an oracle
    // built from the constant it is asserting about follows a rename silently
    // and can never fail.
    expect(surface()).toMatch(/at least 7 days/i);

    // TRAP-3 — the user's OWN row count is deliberately absent. The entry has
    // no `formatKeyError` interpolation arm and no context field, so there is
    // no path by which an unsupplied count could render as a zero or a
    // placeholder. "only 0 trade(s)" is the sentence this phase is deleting;
    // it must not be replaced with "only 0 day(s)".
    expect(surface()).not.toMatch(/\b0 (day|days|row|rows)\b/i);
  });

  it("offers no remedy this code's emitters cannot reach", () => {
    // MEASURED, per emitter, before this assertion was written:
    //   · wizard COMPOSITE arm — counts the STITCHED series, no upload exists;
    //   · wizard SINGLE-KEY arm — reachable only on the daily-returns branch,
    //     i.e. a KEYED account whose dailies were DERIVED from the venue;
    //   · admin approve — renders `gate.reason` raw, not this copy at all.
    // The keyless CSV upload path never reaches `SyncPreviewStep`; it
    // validates through `csv-finalize`. So the UI-SPEC's proposed bullet
    // ("Upload a CSV covering at least 7 daily returns, then submit again")
    // named a control no reader of this copy has.
    expect(surface().toLowerCase()).not.toContain("upload a csv");
    expect(surface().toLowerCase()).not.toContain("submit again");
  });

  it("RECOVERABLE is DERIVED, and the control it earns is the non-destructive one", () => {
    // The derivation, not a restatement of the table: `buildEnvelope` reads
    // `actions` against `RECOVERABLE_ACTIONS`.
    expect(buildEnvelope(CODE, "corr-csv-history-1").recoverable).toBe(true);

    // …and the action that earns it is `clear_and_retry`, which on
    // SyncPreviewStep is wired to `handleKickoffRetry` (a re-SYNC), never to a
    // resubmit of the same payload and never to a draft delete. TRAP-4.
    const actions = WIZARD_ERROR_COPY[CODE].actions as readonly string[];
    expect(actions).toContain("clear_and_retry");
    expect(actions).not.toContain("start_fresh");
  });
});

/**
 * [161-07 / WIZERR-10] THE FOURTH OUTCOME'S COPY, AND THE REMEDY IT MAY OFFER.
 *
 * This code replaces `GATE_INSUFFICIENT_TRADES` for a strategy whose daily
 * series carries a completeness record that does not earn admission. The
 * sentence it replaces — "This account does not have enough trade history yet"
 * over "Strategy has only 0 trade(s)" — was false about the strategy AND
 * unwinnable for the user, so both halves are pinned: the copy must not talk
 * about trade counts, and the remedy must be one that can actually succeed.
 */
describe("[161-07 / WIZERR-10] SERIES_EXAMINED_REFUSED renders a truthful fourth outcome", () => {
  const CODE: WizardErrorCode = "GATE_SERIES_EXAMINED_REFUSED";

  const surface = (): string => {
    const copy = formatKeyError(CODE);
    const joined = [copy.title, copy.cause, ...copy.fix].join("   ");
    // NON-VACUITY GUARD — `"anything".includes("")` is `true`, so an empty
    // render would satisfy every negative assertion below.
    expect(joined.length).toBeGreaterThan(200);
    return joined;
  };

  it("the gate code maps to a real member — never UNKNOWN, never back to the trade code", () => {
    expect(gateFailureToWizardError("SERIES_EXAMINED_REFUSED")).toBe(CODE);
    // The regression stated as the CODE IT MUST NOT BE. A refactor that
    // "simplifies" the split by folding this arm back into the trade branch
    // reds here rather than silently restoring the false sentence.
    expect(gateFailureToWizardError("SERIES_EXAMINED_REFUSED")).not.toBe(
      "GATE_INSUFFICIENT_TRADES",
    );
  });

  it("the two provenance outcomes stay DISTINCT members with distinct copy", () => {
    // "Nobody looked" and "somebody looked and the record is not enough" are
    // different facts with different remedies (a re-sync vs a different
    // source). Collapsing them would put a re-sync button on a permanent
    // refusal, which is the placebo-remedy class this phase closes.
    expect(gateFailureToWizardError("SERIES_PROVENANCE_UNVERIFIED")).not.toBe(
      CODE,
    );
    expect(WIZARD_ERROR_COPY[CODE].cause).not.toBe(
      WIZARD_ERROR_COPY.GATE_SERIES_PROVENANCE_UNVERIFIED.cause,
    );
  });

  it("says nothing about trade counts — the sentence it replaces cannot come back", () => {
    const s = surface();
    expect(s).not.toMatch(/only 0 trade/i);
    expect(s).not.toMatch(/minimum of 5 trades/i);
    expect(s).not.toMatch(/filled trades/i);
    // TRAP-3 — no invented figure of any kind. The entry has no interpolation
    // arm, so there is no context field whose absence could render as a zero.
    expect(s).not.toMatch(/\b0 (trade|trades|day|days|fill|fills)\b/i);
  });

  it("does not claim a per-series examination the producer does not perform", () => {
    // ⭐ THE TRUTH OBLIGATION, carried onto the copy surface.
    // `fill_derived_unproven` is stamped for its venues ALWAYS and
    // unconditionally ("a CONSTANT, not a data-driven refinement" —
    // `broker_dailies.py`), so no finding about THIS series exists to report.
    // 161-UI-SPEC proposed exactly these words and they were corrected.
    const s = surface();
    expect(s).not.toMatch(/examined and refused/i);
    expect(s).not.toMatch(/found wanting/i);
    // …and no size threshold either: `sampled_gapped` fires at ANY interior
    // hole (`nav_gap_days > 0`), so "gaps too large" would be a threshold we
    // do not apply.
    expect(s).not.toMatch(/too large/i);

    // What it DOES say: the two methods, stated as methods.
    expect(s).toMatch(/sampled from balance snapshots/i);
    expect(s).toMatch(/derived from individual fills/i);
  });

  it("offers a remedy that can succeed, and NO retry that cannot", () => {
    const actions = WIZARD_ERROR_COPY[CODE].actions as readonly string[];

    // `try_another_key` is a genuine remedy: a venue whose producer folds a
    // complete ledger stamps a verdict the gate admits.
    expect(actions).toContain("try_another_key");

    // ⛔ `clear_and_retry` IS THE ONE THAT MUST BE ABSENT. On SyncPreviewStep
    // it is the ONLY action that passes `handleKickoffRetry` as `onRetry`, so
    // its presence is what makes a Retry control render. A re-sync re-derives
    // the same series by the same method and earns the same verdict — the
    // button would promise an outcome that cannot change.
    expect(
      actions,
      "A Retry on this state is a placebo: re-running the sync cannot change a " +
        "verdict that is a property of the derivation method.",
    ).not.toContain("clear_and_retry");

    // …and nothing destructive, which is only true because 161-04 made
    // the try-another-key handler a pure step transition.
    expect(actions).not.toContain("start_fresh");

    // The DERIVATION, not a restatement: `buildEnvelope` reads `actions`
    // against `RECOVERABLE_ACTIONS`, and `try_another_key` is a member.
    expect(buildEnvelope(CODE, "corr-examined-refused-1").recoverable).toBe(true);
  });
});

/**
 * [161-10 / WIZERR-07] THE FOUR DASHBOARD-DIALOG ENTRIES, FROM THE COPY SIDE.
 *
 * Three client components — `AllocateDialog`, `RenameStrategyDialog`,
 * `MarkOwnershipDialog` — built `buildEnvelope("UNKNOWN", …)` for every
 * failure their routes classified. The routes now put a machine code on the
 * wire and the dialogs read it; these four members are the copy that code
 * selects.
 *
 * ⭐ THE HARD PART IS NOT COVERAGE, IT IS TRUTHFULNESS. Each of the four has a
 * near-neighbour already in the table whose SUBJECT matches and whose SENTENCE
 * does not, because the incumbent vocabulary was written for a surface that has
 * a wizard draft, an exchange key and a paste-the-secret step. Landing a
 * dashboard failure on one of those would swap "we could not classify this
 * failure" for a sentence that is specific and FALSE — a worse trade than the
 * one this phase exists to make. The cases below pin what each entry must NOT
 * say, per rejected neighbour, at least as hard as what it must.
 *
 * ORACLE INDEPENDENCE: every needle is hand-typed here. Nothing is imported
 * from `wizardErrors.ts` except the table and the derivation helpers, and no
 * assertion compares a string to itself.
 */
describe("[161-10 / WIZERR-07] the dashboard-dialog entries say only what is true of a dashboard", () => {
  const FAMILY: readonly WizardErrorCode[] = [
    "DASHBOARD_SIGNED_OUT",
    "DASHBOARD_REQUEST_INVALID",
    "DASHBOARD_WRITE_FAILED",
    "DASHBOARD_ROW_STALE",
  ];

  /** Every user-visible string on one entry, joined — never just the title. */
  const surface = (code: WizardErrorCode): string => {
    const copy = formatKeyError(code);
    const joined = [copy.title, copy.cause, ...copy.fix].join("   ");
    // NON-VACUITY FLOOR, and not a formality: `"anything".includes("")` is
    // `true`, so every `not.toMatch` below would pass against an empty render.
    expect(
      joined.length,
      `${code} renders an empty or near-empty surface, which makes every ` +
        "negative assertion below vacuously green.",
    ).toBeGreaterThan(140);
    return joined;
  };

  it("the population is non-empty and all four members carry real copy", () => {
    // A family loop over an empty list passes trivially. Hand-typed count.
    expect(FAMILY.length).toBe(4);
    for (const code of FAMILY) {
      expect(surface(code).length).toBeGreaterThan(140);
      // Never the generic terminal: the whole point is that these failures WERE
      // classified.
      expect(formatKeyError(code).title).not.toBe("Something went wrong.");
    }
  });

  it("NOT ONE of the four mentions a draft, an API key, an exchange or a secret", () => {
    // The exact false-specificity this family exists to avoid. Every rejected
    // near-neighbour (`SESSION_EXPIRED`, `VALIDATION_FAILED`,
    // `SEAM_INTERNAL_FAULT`, `GATE_DRAFT_GONE`, `DRAFT_STATE_INVALID`) trips at
    // least one of these needles, which is why each was rejected.
    for (const code of FAMILY) {
      const s = surface(code);
      expect(s, `${code} names a wizard draft`).not.toMatch(/\bdraft\b/i);
      expect(s, `${code} names an API key`).not.toMatch(/\bapi key\b/i);
      expect(s, `${code} names a key at all`).not.toMatch(/\byour key\b/i);
      expect(s, `${code} names an exchange`).not.toMatch(/\bexchange\b/i);
      expect(s, `${code} names a pasted secret`).not.toMatch(/\bsecret\b/i);
    }
  });

  it("SIGNED_OUT names the session and offers signing in — not a retry that cannot work", () => {
    const s = surface("DASHBOARD_SIGNED_OUT");
    expect(s).toMatch(/signed out/i);
    // The state-safety claim the user needs: the refused write changed nothing.
    expect(s).toMatch(/nothing was saved/i);
    expect(s).toMatch(/sign in again/i);
    // THE DERIVATION, not a restatement of the table: `buildEnvelope` reads
    // `actions` against `RECOVERABLE_ACTIONS`. A Retry from a signed-out
    // session is refused identically, so no control may render.
    expect(buildEnvelope("DASHBOARD_SIGNED_OUT", "corr-dash-401").recoverable).toBe(
      false,
    );
  });

  it("REQUEST_INVALID blames our software, never what the user typed", () => {
    const s = surface("DASHBOARD_REQUEST_INVALID");
    expect(s).toMatch(/our (own )?s(oftware|ervice)/i);
    // ⛔ The clause that disqualified `VALIDATION_FAILED` for this surface:
    // it instructs the user to quote a draft ID they do not have, which is a
    // remedy that cannot be carried out (Principle 2).
    expect(s.toLowerCase()).not.toContain("draft id");
    expect(buildEnvelope("DASHBOARD_REQUEST_INVALID", "corr-dash-400").recoverable).toBe(
      false,
    );
  });

  it("WRITE_FAILED is the ONE recoverable member, and says nothing was saved", () => {
    const s = surface("DASHBOARD_WRITE_FAILED");
    expect(s).toMatch(/nothing was saved/i);
    // A 500 is the one dashboard failure whose second attempt genuinely may
    // succeed, so this is the only member of the family that earns a Retry.
    expect(buildEnvelope("DASHBOARD_WRITE_FAILED", "corr-dash-500").recoverable).toBe(
      true,
    );
    // ANTI-CONTROL: "make them all recoverable" must not satisfy the line
    // above. The other three are pinned false in their own cases; asserting the
    // contrast here is what makes this one a decision rather than a default.
    expect(buildEnvelope("DASHBOARD_ROW_STALE", "corr-dash-404").recoverable).toBe(
      false,
    );
  });

  it("ROW_STALE points at the LIST, and names no cause the 404 cannot establish", () => {
    const s = surface("DASHBOARD_ROW_STALE");
    // The remedy that actually settles it: reload the list.
    expect(s).toMatch(/reload/i);
    // ⛔ The three routes merge several causes into one 404 on purpose (naming
    // one would leak row existence to a caller probing ids), so the copy may
    // not pick a cause. These are the guesses a future edit would reach for.
    expect(s).not.toMatch(/you do not (have|own)/i);
    expect(s).not.toMatch(/not yours/i);
    expect(s).not.toMatch(/(was|has been) deleted\b/i);
    expect(buildEnvelope("DASHBOARD_ROW_STALE", "corr-dash-404b").recoverable).toBe(
      false,
    );
  });

  it("no member of the family carries a destructive action", () => {
    // These entries render on surfaces holding REAL MONEY positions. A remedy
    // that removes something is never the answer to "we could not save that".
    for (const code of FAMILY) {
      const actions = WIZARD_ERROR_COPY[code].actions as readonly string[];
      expect(actions.length, `${code} offers no action at all`).toBeGreaterThan(0);
      expect(actions, `${code} offers a draft-destroying action`).not.toContain(
        "start_fresh",
      );
    }
  });
});

/**
 * [161-10 / WIZERR-07] `recogniseDashboardDialogCode` — THE ONE GUARDED CAST.
 *
 * Pitfall 4: a recognised code must be an explicit roster member, never a
 * `code as WizardErrorCode` written at a consumer. This is the only place the
 * cast happens, so this is where the guard is pinned.
 */
describe("[161-10 / WIZERR-07] the dashboard recogniser admits only rostered codes", () => {
  it("admits a code the route really emits, per route", () => {
    expect(
      recogniseDashboardDialogCode("strategies/[id]/name", "DASHBOARD_ROW_STALE"),
    ).toBe("DASHBOARD_ROW_STALE");
    expect(
      recogniseDashboardDialogCode(
        "portfolio-strategies/allocation",
        "ALLOCATION_NOT_ALLOCATABLE",
      ),
    ).toBe("ALLOCATION_NOT_ALLOCATABLE");
  });

  it("REFUSES a real member of the union that THIS route does not emit", () => {
    // The per-route split is the point (`ConnectKeyStep`'s roster docblock).
    // A flat set would go green here while the rename dialog silently admitted
    // an allocation-only code.
    expect(
      recogniseDashboardDialogCode(
        "strategies/[id]/name",
        "ALLOCATION_NOT_ALLOCATABLE",
      ),
    ).toBe("UNKNOWN");
  });

  it("REFUSES an arbitrary string, an empty string and a non-string", () => {
    // An identity rule (`code as WizardErrorCode`) would admit all of these.
    expect(
      recogniseDashboardDialogCode("strategies/[id]/name", "TOTALLY_MADE_UP"),
    ).toBe("UNKNOWN");
    expect(recogniseDashboardDialogCode("strategies/[id]/name", "")).toBe("UNKNOWN");
    expect(recogniseDashboardDialogCode("strategies/[id]/name", undefined)).toBe(
      "UNKNOWN",
    );
    expect(recogniseDashboardDialogCode("strategies/[id]/name", null)).toBe("UNKNOWN");
    expect(recogniseDashboardDialogCode("strategies/[id]/name", 42)).toBe("UNKNOWN");
  });

  it("REFUSES the three wire codes that are deliberately NOT envelope codes", () => {
    // `NAME_REQUIRED` / `NAME_TOO_LONG` land inline at the Name field;
    // `LIVE_ALLOCATION` swaps in a confirmation body. None reaches
    // `buildEnvelope`, so none may be admitted here — admitting one would
    // demand a copy entry for a string the user never sees as an error.
    for (const wire of ["NAME_REQUIRED", "NAME_TOO_LONG"]) {
      expect(recogniseDashboardDialogCode("strategies/[id]/name", wire)).toBe(
        "UNKNOWN",
      );
    }
    expect(
      recogniseDashboardDialogCode("strategies/[id]/ownership", "LIVE_ALLOCATION"),
    ).toBe("UNKNOWN");
  });
});
