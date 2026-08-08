import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, lstatSync, realpathSync } from "fs";
import { join, resolve } from "path";
import {
  formatKeyError,
  gateFailureToWizardError,
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
   * Deliberately NOT `Object.keys(WIZARD_ERROR_COPY).length`: reading the
   * subject to build the expectation is how a guard stops being able to fail.
   * Bumping the LITERAL when the table legitimately grows is the intended
   * maintenance cost; replacing it with a derived value removes the guard.
   */
  const EXPECTED_TABLE_SIZE = 64;

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
   */
  const EXPECTED_TABLE_SIZE = 64;

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
