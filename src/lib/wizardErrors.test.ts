import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, lstatSync, realpathSync } from "fs";
import { join, resolve } from "path";
import {
  formatKeyError,
  gateFailureToWizardError,
  classifyKeyValidationError,
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
import {
  AnalyticsTimeoutError,
  AnalyticsUnreachableError,
  CircuitOpenError,
} from "@/lib/seam-errors";
// A NAMESPACE import, deliberately: this file already binds
// `AnalyticsTimeoutError` from the leaf, so importing the same NAME again under
// an alias would shadow confusingly. Used to prove the client's re-export is an
// ALIAS of the leaf's class and never a second definition (see the "ONE class
// identity" test — if it were a second definition, every type branch in
// wizardErrors would be false in production while these tests stayed green),
// and for AnalyticsUpstreamError, which has no reason to live in the leaf: it
// carries an upstream HTTP status and no client-bundle code branches on it.
//
// ⚠️ The client must re-export these with `export { X } from "./seam-errors"`,
// NOT `import { X } … ; export { X }`. The latter form resolves to `undefined`
// through vitest's SSR transform, which would turn every route that does
// `err instanceof AnalyticsTimeoutError` into a TypeError thrown from inside a
// catch block. This test is what catches that.
import * as analyticsClient from "@/lib/analytics-client";

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
    // Phase 140 review (WR-01): the old case here was the raw undici string
    // "connect ETIMEDOUT 10.0.0.1:443", which CANNOT reach this classifier —
    // analytics-client converts every transport failure into
    // AnalyticsTimeoutError / AnalyticsUnreachableError first, and both are now
    // typed above. The reachable input for this branch is an upstream `detail`
    // forwarded from Python describing an EXCHANGE-side timeout, which is what
    // KEY_NETWORK_TIMEOUT's "We could not reach the exchange" copy describes.
    ["Exchange request timed out after 10s", "KEY_NETWORK_TIMEOUT", 502],
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
    expect(classifyKeyValidationError("Exchange request timed out").code).toBe(
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
      classifyKeyValidationError(new Error("Exchange request timed out")).code,
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

  /**
   * WR-01 — the breaker trip is the RARE case; the plain outage is the common
   * one, and it was still hitting the dead end.
   *
   * The circuit only opens after 5 failures inside 30s, which is unreachable at
   * human retry cadence — so during an ordinary Railway outage the wizard's
   * key-connect routes catch one of analytics-client's two TRANSPORT errors
   * with the circuit still CLOSED. Neither matched any branch of the substring
   * cascade:
   *
   *   AnalyticsTimeoutError says "timed OUT" (with a space) while the cascade
   *   tested `includes("timeout")` — so the branch was dead for its own
   *   headline input; and "…is not reachable…" matched nothing at all.
   *
   * Both therefore rendered UNKNOWN/500 — "our team has been notified" — which
   * `wizardErrors.ts` itself names as the DOGFOOD-3 failure these codes exist
   * to kill. These pin the TYPE branch, using inputs production actually
   * produces rather than raw undici strings that can never reach the
   * classifier.
   */
  it("classifies AnalyticsTimeoutError as SERVICE_UNAVAILABLE_RETRY, not the dead end", () => {
    // Constructed exactly as analytics-client constructs it.
    const err = new AnalyticsTimeoutError("/api/validate-key", 30_000);
    // Guard the premise: this really is the message the cascade could not see.
    expect(err.message).toContain("timed out");
    expect(err.message.toLowerCase()).not.toContain("timeout");

    expect(classifyKeyValidationError(err)).toEqual({
      code: "SERVICE_UNAVAILABLE_RETRY",
      status: 503,
    });
  });

  it("classifies AnalyticsUnreachableError as SERVICE_UNAVAILABLE_RETRY, not the dead end", () => {
    const err = new AnalyticsUnreachableError();
    // Premise guard: the message matches NO substring branch, so only a type
    // check can classify it. If a future reword made it matchable, this test
    // would be measuring the cascade instead of the type branch.
    expect(classifyKeyValidationError(err.message)).toEqual({
      code: "UNKNOWN",
      status: 500,
    });

    expect(classifyKeyValidationError(err)).toEqual({
      code: "SERVICE_UNAVAILABLE_RETRY",
      status: 503,
    });
  });

  it("keeps KEY_NETWORK_TIMEOUT for a genuine EXCHANGE-side timeout forwarded from Python", () => {
    // The distinction is a copy-honesty one, not a cosmetic one: telling a
    // manager "we could not reach the exchange" when it was OUR service that
    // was unreachable is a false claim about their key.
    const upstream = new analyticsClient.AnalyticsUpstreamError(
      "Exchange request timed out after 10s",
      504,
    );
    expect(classifyKeyValidationError(upstream)).toEqual({
      code: "KEY_NETWORK_TIMEOUT",
      status: 502,
    });
  });

  it("uses ONE class identity: the leaf's types are what analytics-client throws", () => {
    // wizardErrors imports from the never-mocked `@/lib/seam-errors` leaf so
    // the instanceof survives the sixteen files that mock analytics-client
    // wholesale. If analytics-client ever re-DEFINED these instead of
    // re-exporting them, every branch above would be false in production while
    // these tests stayed green.
    expect(analyticsClient.AnalyticsTimeoutError).toBe(AnalyticsTimeoutError);
    expect(analyticsClient.AnalyticsUnreachableError).toBe(
      AnalyticsUnreachableError,
    );
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
    // issued, so nothing was stored. The user must be told that explicitly —
    // otherwise a retry looks like it risks a duplicate key.
    expect(blob.toLowerCase()).toMatch(/not (been )?(saved|stored)|nothing was (saved|stored)/);
    // It must also not blame the user's key for an outage on our side.
    expect(blob.toLowerCase()).not.toMatch(/your key (is|was) (invalid|wrong|bad)/);
    // T-140-14: no upstream infrastructure detail reaches the wizard.
    expect(blob).not.toMatch(/circuit|breaker|upstash|redis|railway|http|localhost/i);
  });
});

// ===========================================================================
// Phase 140 round-3 / C2 — THE TWO UNAVAILABLE CODES MUST STAY TRUTHFUL.
//
// `SERVICE_UNAVAILABLE_RETRY` asserts "Your key has not been saved and nothing
// was submitted". That is TRUE at the connect step it was written for, where
// `create-with-key` has not run yet. Batch-B fixes (SubmitStep's wire-code
// aliases, SyncPreviewStep's kickoff classifier) routed LATER steps into the
// same copy — steps that only run AFTER the `api_keys` row and the draft
// `strategies` row exist, and after a composite may have several members.
//
// These pin the contract as a PROPERTY of the copy rather than as a
// spot-check of one sentence, so a future reword cannot quietly re-break it.
// ===========================================================================
describe("[C2] the unavailable codes make opposite, surface-correct claims", () => {
  const connectStep = formatKeyError("SERVICE_UNAVAILABLE_RETRY");
  const postSave = formatKeyError("SERVICE_UNAVAILABLE_RETRY_DRAFT_SAVED");

  it("the CONNECT-step copy says nothing was saved", () => {
    expect(connectStep.cause).toMatch(/has not been saved/i);
    expect(connectStep.cause).toMatch(/nothing was submitted/i);
  });

  it("the POST-SAVE copy says the draft and the keys ARE saved, and never the opposite", () => {
    // THE assertion. Rendering "has not been saved" on a surface where the key
    // IS saved is a false statement about the user's data — and it sat directly
    // above the control that deletes the draft.
    expect(postSave.cause).not.toMatch(/has not been saved/i);
    expect(postSave.cause).toMatch(/are saved/i);
    expect(postSave.cause).toMatch(/nothing was submitted/i);
  });

  it("neither asserts the BREAKER as the mechanism (C3)", () => {
    // Both codes are emitted for a plain transport timeout / unreachable
    // service with the circuit CLOSED — which is the common case, since five
    // failures in 30s is unreachable at human retry cadence — and the post-save
    // one is additionally emitted for two Supabase failures in `keys/sync`.
    // "We paused outbound requests after repeated failures" is a specific,
    // checkable claim about our own infrastructure that is false in all of
    // those.
    for (const copy of [connectStep, postSave]) {
      expect(copy.cause).not.toMatch(/paused outbound requests/i);
    }
  });

  it("the POST-SAVE fix steps never tell the user to reconnect the key", () => {
    // The connect-step remedy ("try connecting the key again") is wrong after
    // the key is stored: it points at re-doing work that already succeeded,
    // which is what steered users onto the destructive control.
    expect(connectStep.fix[0]).toMatch(/connecting the key again/i);
    for (const step of postSave.fix) {
      expect(step).not.toMatch(/connecting the key again/i);
    }
  });

  it("both are RECOVERABLE, so a Retry control renders instead of a dead end", () => {
    for (const copy of [connectStep, postSave]) {
      expect(copy.actions).toContain("clear_and_retry");
    }
  });

  it("both name the real wait when the seam published a Retry-After (F-4 parity)", () => {
    // The post-save surfaces are exactly where the hint is most actionable;
    // extending the interpolation to only one code would have left them on the
    // vague "wait a moment", which in practice means retrying instantly into
    // the same wall.
    for (const code of [
      "SERVICE_UNAVAILABLE_RETRY",
      "SERVICE_UNAVAILABLE_RETRY_DRAFT_SAVED",
    ] as const) {
      expect(formatKeyError(code, { retryAfterS: 27 }).fix[0]).toMatch(
        /Wait about 27 seconds/i,
      );
      // Malformed hints degrade to the generic copy, never "NaN".
      expect(formatKeyError(code, { retryAfterS: Number.NaN }).fix[0]).not.toMatch(
        /NaN/,
      );
    }
  });
});
