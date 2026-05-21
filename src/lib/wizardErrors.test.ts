import { describe, it, expect } from "vitest";
import {
  formatKeyError,
  gateFailureToWizardError,
  WIZARD_ERROR_COPY,
  CSV_RULE_LABELS,
  CSV_UPLOAD_STEP_HEADINGS,
  CSV_PREVIEW_STEP_HEADINGS,
  CSV_SUBMIT_STEP_HEADINGS,
  formatCsvRuleCauseMulti,
  formatCsvRuleCauseSingle,
  type WizardErrorCode,
} from "./wizardErrors";

describe("wizardErrors", () => {
  describe("WIZARD_ERROR_COPY table shape", () => {
    it("every code has a non-empty title, cause, fix list, docsHref, and actions", () => {
      const codes = Object.keys(WIZARD_ERROR_COPY) as WizardErrorCode[];
      expect(codes.length).toBeGreaterThanOrEqual(16);

      for (const code of codes) {
        const copy = WIZARD_ERROR_COPY[code];
        expect(copy.title).toBeTruthy();
        expect(copy.title.length).toBeGreaterThan(4);
        expect(copy.cause).toBeTruthy();
        expect(copy.fix.length).toBeGreaterThan(0);
        expect(copy.docsHref).toMatch(/^\/security/);
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

    it("CSV_VALIDATION_FAILED preserves the verbatim user-visible title", () => {
      expect(WIZARD_ERROR_COPY.CSV_VALIDATION_FAILED.title).toBe(
        "Validation failed. See per-row breakdown below.",
      );
    });

    it("CSV_UPSTREAM_FAIL preserves the verbatim user-visible title", () => {
      expect(WIZARD_ERROR_COPY.CSV_UPSTREAM_FAIL.title).toBe(
        "Validation service returned an unexpected response. Retry shortly.",
      );
    });

    it("CSV_NETWORK_TIMEOUT preserves the verbatim user-visible title (CsvUploadStep variant)", () => {
      expect(WIZARD_ERROR_COPY.CSV_NETWORK_TIMEOUT.title).toBe(
        "The server did not respond within 30 seconds. Your file is preserved — click Retry to try again.",
      );
    });

    it("CSV_SUBMIT_FAILED preserves the verbatim user-visible title", () => {
      expect(WIZARD_ERROR_COPY.CSV_SUBMIT_FAILED.title).toBe(
        "Your file validated cleanly, but saving the strategy hit an error. Click Submit strategy again to retry — your data is unchanged.",
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

    it("formatCsvRuleCauseMulti formats the multi-rule cause sentence", () => {
      expect(
        formatCsvRuleCauseMulti({ rule_a: [], rule_b: [] }),
      ).toBe("Across 2 rule categories: rule_a, rule_b.");
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
});
