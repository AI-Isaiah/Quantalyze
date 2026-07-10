/**
 * Scripted error copy for the /strategies/new/wizard flow. Every error
 * has a stable code, a title, a cause, numbered fix steps, a docs
 * anchor, and the UI actions to surface. Raw backend strings never
 * reach the UI — unknown codes fall through to the UNKNOWN entry.
 */

import type { GateFailureCode } from "./strategyGate";

export type WizardErrorCode =
  // Key validation (ConnectKeyStep)
  | "KEY_HAS_TRADING_PERMS"
  | "KEY_HAS_WITHDRAW_PERMS"
  | "KEY_INVALID_SIGNATURE"
  | "KEY_INVALID_FORMAT"
  | "KEY_IP_ALLOWLIST"
  | "KEY_RATE_LIMIT"
  | "KEY_NETWORK_TIMEOUT"
  | "KEY_SCOPE_BROADENED"
  | "DRAFT_ALREADY_EXISTS"
  // Sync + gate (SyncPreviewStep) — these wrap strategyGate.ts codes
  | "SYNC_TIMEOUT"
  | "SYNC_FAILED"
  | "GATE_INSUFFICIENT_TRADES"
  | "GATE_INSUFFICIENT_DAYS"
  | "GATE_ANALYTICS_FAILED"
  | "GATE_NO_DATA_SOURCE"
  // Metadata step (MetadataStep) — Phase 53 / APPLY-02 inline per-field
  // validation. Copy lives here (the canonical wizard-copy home) so the
  // component never carries an invented inline string (copy-drift guard).
  | "METADATA_DESCRIPTION_REQUIRED"
  // Wizard lifecycle
  | "SESSION_EXPIRED"
  | "SUBMIT_NOTIFY_FAILED"
  // H-0192: finalize-wizard 404 (draft deleted/expired) and 403/409
  // (not in a finalizable state) used to collapse to UNKNOWN at SubmitStep.
  | "GATE_DRAFT_GONE"
  | "GUARD_BLOCKED"
  // Phase 17 NEW — CSV branch absorption (DESIGN-05).
  | "CSV_PARSE_FAILED"
  | "CSV_SCHEMA_VIOLATION"
  | "CSV_FILE_TOO_LARGE"
  | "CSV_INVALID_EXTENSION"
  | "CSV_NON_MONOTONIC_DATES"
  | "CSV_NAV_ZERO"
  | "CSV_RETURN_OUT_OF_RANGE"
  | "CSV_SHARPE_SUSPICIOUS"
  | "CSV_CURRENCY_INVALID"
  | "CSV_QTY_PRICE_INVALID"
  | "CSV_STRATEGY_NAME_REQUIRED"
  | "CSV_STRATEGY_NAME_TOO_LONG"
  | "CSV_VALIDATION_FAILED"
  | "CSV_UPSTREAM_FAIL"
  | "CSV_NETWORK_TIMEOUT"
  | "CSV_SUBMIT_FAILED"
  | "CSV_SUBMIT_NO_STRATEGY_ID"
  // Phase 19 / BACKBONE-08 — wizard double-submit idempotent return.
  // /process-key returns the existing verification_id (not 23505 to the
  // caller) when wizard_session_id was already submitted; the UI shows
  // a friendly "you already submitted this" envelope.
  | "WIZARD_DUPLICATE"
  // Phase 88 / ONB-01 — multi-key connect step (MultiKeyConnectStep).
  // CLIENT-side validation code for the step-level cross-key window summary
  // (A4: route the summary through buildEnvelope rather than a bespoke shell).
  // The per-issue lines are supplied by the component (from keyWindowsSchema);
  // this code carries the interpolated summary TITLE only.
  | "MULTI_KEY_WINDOWS_INVALID"
  // Phase 88 / W-4 (T-88-10) — composite membership probe fail-closed.
  // finalize-wizard returns a 503 with this code when it cannot determine
  // whether the draft is a multi-key composite (the membership probe threw,
  // or the member-list read failed). It is a transient server-side fault:
  // the draft is intact and nothing was submitted, so the envelope is
  // RECOVERABLE and the Retry affordance renders. Both the unified and legacy
  // finalize arms emit this same code so the client maps ONE consistent copy.
  | "COMPOSITE_MEMBERSHIP_UNKNOWN"
  // Fallback
  | "UNKNOWN";

export type WizardErrorAction =
  | "try_another_key"
  | "clear_and_retry"
  | "expand_log"
  | "resume_draft"
  | "start_fresh"
  | "request_call"
  | "leave_and_return";

/**
 * Interpolation token for the CSV_FILE_TOO_LARGE title. Held in a const so
 * the placeholder string in the title literal and the call-site replace
 * cannot drift apart. Adding a second interpolation slot in the future
 * should follow the same const-then-replace pattern (or graduate to a
 * generic `interpolate(template, vars)` helper).
 */
const SIZE_MB_PLACEHOLDER = "{sizeMb}";

export interface WizardErrorCopy {
  title: string;
  /** Single-sentence summary of WHY the error happened. */
  cause: string;
  /** Numbered fix steps. Each step is an imperative sentence. */
  fix: string[];
  /** Anchor URL on /security with a walkthrough + screenshots. */
  docsHref: string;
  /** Action IDs the UI should render as buttons/links. */
  actions: WizardErrorAction[];
}

/**
 * Code IDs are STABLE — renaming breaks PostHog `wizard_error { code }`
 * events. Placeholders like `{N}` and `{days}` are filled by
 * `formatKeyError` at render time.
 */
const WIZARD_ERROR_COPY: Record<WizardErrorCode, WizardErrorCopy> = {
  KEY_HAS_TRADING_PERMS: {
    title: "This key has trading permissions enabled.",
    cause:
      "The exchange returned trading or order-placement scopes on this key. Quantalyze accepts read-only keys only, enforced at the database level.",
    fix: [
      "Open your exchange API Management page and edit this key.",
      "Uncheck every permission except Read.",
      "Save, then paste the key here again. You can also create a new read-only key from scratch.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["try_another_key", "request_call"],
  },

  KEY_HAS_WITHDRAW_PERMS: {
    title: "This key can withdraw funds.",
    cause:
      "We reject any key with withdrawal scope, even if read-only is also enabled. Defense-in-depth: a stolen key must never be able to move funds.",
    fix: [
      "Regenerate the key with only Read enabled.",
      "Confirm every Withdrawal and Transfer scope is off.",
      "Paste the new key here.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["try_another_key", "request_call"],
  },

  KEY_INVALID_SIGNATURE: {
    title: "The API secret does not match this key.",
    cause:
      "The exchange accepted the key but rejected the signature. The most common cause is pasting the API key into the secret field, or copying with whitespace.",
    fix: [
      "Re-copy the secret from your exchange API Management page.",
      "If you cannot find it (some exchanges only show it once at creation), create a new read-only key.",
      "Paste the fresh secret here.",
    ],
    docsHref: "/security#regenerate-key",
    actions: ["clear_and_retry", "request_call"],
  },

  KEY_INVALID_FORMAT: {
    title: "This does not look like a valid API key for the selected exchange.",
    cause:
      "Client-side format check failed before sending the key to the exchange. Binance secrets are 64 hex characters; OKX and Bybit use different formats.",
    fix: [
      "Check that you selected the correct exchange tab above.",
      "Re-copy the key and secret from your exchange, without extra spaces.",
      "Paste them again.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["clear_and_retry", "request_call"],
  },

  KEY_IP_ALLOWLIST: {
    title: "This key has an IP allowlist that does not include Quantalyze.",
    cause:
      "The exchange rejected the request with an IP restriction error. You enabled IP pinning on this key and our egress IPs are not on the list.",
    fix: [
      "Remove the IP restriction on this key (recommended — read-only keys cannot move funds regardless of origin).",
      "Or, add our egress IPs to the allowlist. See the docs link below.",
    ],
    docsHref: "/security#egress-ips",
    actions: ["try_another_key", "request_call"],
  },

  KEY_RATE_LIMIT: {
    title: "The exchange rate-limited this request.",
    cause:
      "The exchange asked us to slow down. This is a transient, exchange-side throttle and not a problem with your key.",
    fix: [
      "Wait 60 seconds and try again.",
      "If it persists, try a different exchange account or contact support.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  KEY_NETWORK_TIMEOUT: {
    title: "We could not reach the exchange.",
    cause:
      "The validation request did not complete in time. Usually means a temporary exchange issue or a network blip on our side.",
    fix: [
      "Try again in a moment.",
      "If it keeps failing, switch to a different exchange or contact support.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  KEY_SCOPE_BROADENED: {
    title: "Your key now has trading permissions.",
    cause:
      "When you connected this key it was read-only, but a fresh check at submit time shows it now has trade or withdraw scope on the exchange. Quantalyze accepts read-only keys only — we re-check just before publishing so a key edited in the exchange dashboard between Connect and Submit cannot slip through.",
    fix: [
      "Open your exchange API Management page and edit this key.",
      "Uncheck every permission except Read, save, then come back here.",
      "Or create a brand-new read-only key and re-key this draft from the start.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["try_another_key", "request_call"],
  },

  DRAFT_ALREADY_EXISTS: {
    title: "You already have a wizard session open for this key.",
    cause:
      "A draft strategy with the same API key is already in progress. Each key can back one listing at a time.",
    fix: [
      "Resume the existing draft to continue where you left off.",
      "Or delete it and start fresh here.",
    ],
    docsHref: "/security#draft-resume",
    actions: ["resume_draft", "start_fresh"],
  },

  SYNC_TIMEOUT: {
    title: "Sync is taking longer than expected.",
    cause:
      "We are still fetching trades from your exchange. Accounts with multi-year history can take up to 5 minutes. First sync of the day can require up to 60 seconds while the analytics service wakes up.",
    fix: [
      "Your draft is saved — you can leave this page and come back, or wait here.",
      "Expand the details below to see what we are currently doing.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["expand_log", "leave_and_return", "request_call"],
  },

  SYNC_FAILED: {
    title: "Sync failed.",
    cause:
      "We fetched your trades but the analytics computation did not complete. The failure is on our side, not on your exchange.",
    fix: [
      "Retry the sync from this page.",
      "If it keeps failing, your draft is saved — contact security@quantalyze.com with your draft ID.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  GATE_INSUFFICIENT_TRADES: {
    title: "This account does not have enough trade history yet.",
    cause:
      "We need at least 5 filled trades before we can compute a verified factsheet. Sharpe on fewer trades would be noise, not signal.",
    fix: [
      "If this is a testnet key, connect your mainnet key instead.",
      "If this is a new strategy, keep trading and come back. Your draft is saved for 30 days.",
      "If the history is on a different sub-account, create a key on that sub-account.",
    ],
    docsHref: "/security#thresholds",
    actions: ["try_another_key", "request_call"],
  },

  GATE_INSUFFICIENT_DAYS: {
    title: "This account needs more trading history.",
    cause:
      "We measure trading history as calendar days between the earliest and latest trade, not by trade count. Volatility and drawdown estimates become unstable below 7 calendar days, so we require at least 7 calendar days of span before computing a verified factsheet.",
    fix: [
      "Keep trading and come back once your earliest and latest trades span at least 7 calendar days. Your draft is saved for 30 days.",
      "Or use a different key whose trades span a longer time window.",
    ],
    docsHref: "/security#thresholds",
    actions: ["try_another_key", "request_call"],
  },

  GATE_ANALYTICS_FAILED: {
    title: "Analytics computation failed.",
    cause:
      "We fetched your trades successfully, but the risk metrics pipeline errored out. The failure is on our side.",
    fix: [
      "Retry the sync from this page.",
      "If it fails again, email security@quantalyze.com with your draft ID — we have been notified.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  GATE_NO_DATA_SOURCE: {
    title: "This strategy has no trade data connected yet.",
    cause:
      "The wizard could not find a linked API key or any uploaded trades for this draft. This usually means the create-with-key step did not complete.",
    fix: [
      "Start fresh — the previous draft will be cleaned up.",
      "Or request a call if you keep hitting this state.",
    ],
    docsHref: "/security#draft-resume",
    actions: ["start_fresh", "request_call"],
  },

  METADATA_DESCRIPTION_REQUIRED: {
    title: "Add a description.",
    cause:
      "Allocators need a short description to evaluate the strategy. A description is required before you can continue.",
    fix: [
      "Write one paragraph describing the strategy, its edge, and how you frame risk.",
    ],
    docsHref: "/security",
    actions: ["clear_and_retry"],
  },

  SESSION_EXPIRED: {
    title: "Your session expired.",
    cause:
      "You have been signed out. Your wizard draft is saved on our side — your form answers and preview are still there.",
    fix: [
      "Sign in again with the same account.",
      "Your API key was never stored in your browser, so you will need to paste the secret once more before continuing.",
    ],
    docsHref: "/security#draft-resume",
    actions: ["resume_draft"],
  },

  SUBMIT_NOTIFY_FAILED: {
    title: "Strategy submitted — founder notification delayed.",
    cause:
      "We saved your submission with status pending_review, but the founder email did not deliver. Review may take longer than usual.",
    fix: [
      "You do not need to take any action — the founder checks pending_review manually within 48 hours.",
      "If you need a faster response, use Request a Call below.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["request_call"],
  },

  GATE_DRAFT_GONE: {
    title: "This draft is no longer available.",
    cause:
      "We couldn't find this wizard draft. It may have already been submitted, or it expired before you finished.",
    fix: [
      "Start a new strategy from the strategies page.",
      "If you believe this is a mistake, use Request a Call below.",
    ],
    docsHref: "/security#draft-resume",
    actions: ["start_fresh", "request_call"],
  },

  GUARD_BLOCKED: {
    title: "This draft can't be finalized right now.",
    cause:
      "The server rejected the submission — this draft isn't in a finalizable state for your account, or the page is out of date.",
    fix: [
      "Refresh the page and try again.",
      "If it keeps failing, start a new strategy or use Request a Call below.",
    ],
    docsHref: "/security#draft-resume",
    // `clear_and_retry` keeps the envelope recoverable so the Retry control
    // renders — the route's 403 is a refresh-nudge (stale page), not a hard
    // permission wall, and retrying after a refresh is the intended path.
    actions: ["clear_and_retry", "start_fresh", "request_call"],
  },

  // ============================================================
  // Phase 17 NEW — CSV branch absorption (DESIGN-05).
  // Source-of-truth for the 17 CSV-branch error codes Phase 15 left
  // as hoist markers (the `phase-17 hoist` TODO comments) across:
  //   - CsvUploadStep.tsx
  //   - CsvPreviewStep.tsx
  //   - CsvSubmitStep.tsx
  //   - CsvValidationEnvelope.tsx
  // Mapping table: 17-UI-SPEC.md §14.1.
  // ============================================================

  CSV_PARSE_FAILED: {
    title: "We could not parse your CSV file.",
    cause:
      "The file is not valid UTF-8 CSV — required columns are missing, quoting is broken, or the encoding is wrong.",
    fix: [
      "Re-export your file as CSV (UTF-8) from your spreadsheet tool.",
      "Make sure the required columns for your selected format are present in the header row.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry", "request_call"],
  },

  CSV_SCHEMA_VIOLATION: {
    title: "Your file does not match the selected format.",
    cause:
      "The columns or column types in your CSV do not match the format you selected on the previous step.",
    fix: [
      "Confirm the format selector matches your file (Daily returns, Daily NAV, or Trade list).",
      "Open your CSV and verify the column headers exactly match the format spec.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry", "request_call"],
  },

  CSV_FILE_TOO_LARGE: {
    title:
      `Maximum file size is 10 MB. Your file is ${SIZE_MB_PLACEHOLDER} MB. Trim it or split it before retrying.`,
    cause: "We cap CSV uploads at 10 MB to keep validation fast.",
    fix: [
      "Trim or split your file so it stays under 10 MB.",
      "If you must upload a larger file, contact support.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry", "request_call"],
  },

  CSV_INVALID_EXTENSION: {
    title: "Only .csv files are accepted. Convert your file and try again.",
    cause: "Files must have a `.csv` extension.",
    fix: [
      "Save your spreadsheet as CSV (UTF-8) and re-upload.",
      "Excel: File → Save As → CSV (Comma delimited).",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry"],
  },

  CSV_NON_MONOTONIC_DATES: {
    title:
      "Dates must be strictly increasing — fix the offending rows and re-upload.",
    cause:
      "Dates must be strictly increasing. We found at least one row whose date is equal to or earlier than the previous row.",
    fix: [
      "Sort your file by date ascending.",
      "Remove any duplicate-date rows.",
      "Re-upload the corrected CSV.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry"],
  },

  CSV_NAV_ZERO: {
    title: "NAV cannot be zero — fix the offending rows and re-upload.",
    cause:
      "NAV cannot be zero. A zero NAV breaks the daily-return computation.",
    fix: [
      "Replace zero-NAV rows with the correct end-of-day value.",
      "If a real zero-NAV day exists, omit it from the file.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry"],
  },

  CSV_RETURN_OUT_OF_RANGE: {
    title:
      "Daily return cannot be ≤ -100% — fix the offending rows and re-upload.",
    cause:
      "Daily return cannot be ≤ -100%. Returns at or below -100% imply a fully-blown account, which we treat as a data-entry error.",
    fix: [
      "Re-check the offending row(s) — a value below -100% is almost always a typo or unit error.",
      "Express returns as decimals (0.05 for 5%, not 5).",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry"],
  },

  CSV_SHARPE_SUSPICIOUS: {
    title:
      "Daily Sharpe > 10 looks unrealistic — fix the offending rows and re-upload.",
    cause:
      "Daily Sharpe > 10 looks unrealistic. We block obviously-fabricated track records at the gate.",
    fix: [
      "Double-check whether your returns column is actually decimals (0.01) and not percent (1.0).",
      "If your strategy genuinely produces this Sharpe, contact us — we will verify it manually.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry", "request_call"],
  },

  CSV_CURRENCY_INVALID: {
    title:
      "Currency must be USD or left blank — fix the offending rows and re-upload.",
    cause:
      "Currency must be USD or left blank. Multi-currency CSVs are not supported in this release.",
    fix: [
      "Convert all rows to USD before uploading, or leave the currency column blank.",
      "If your fund reports natively in a non-USD currency, contact us.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry", "request_call"],
  },

  CSV_QTY_PRICE_INVALID: {
    title:
      "Quantity and price must be positive — fix the offending rows and re-upload.",
    cause:
      "Quantity and price must be positive. Trade-list rows with non-positive qty or price cannot be priced.",
    fix: [
      "Re-check the offending rows — qty and price must both be > 0.",
      "Use the side column ('buy'/'sell') to express direction, not signed quantity.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry"],
  },

  CSV_STRATEGY_NAME_REQUIRED: {
    title: "Strategy name is required.",
    cause: "We need a strategy name to publish a factsheet.",
    fix: ["Type a strategy name (1–80 characters)."],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry"],
  },

  CSV_STRATEGY_NAME_TOO_LONG: {
    title: "Strategy name must be 80 characters or fewer.",
    cause:
      "Strategy names render in marketplace tiles and factsheet headers; longer names truncate.",
    fix: ["Shorten your name to 80 characters or fewer."],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry"],
  },

  CSV_VALIDATION_FAILED: {
    title: "Validation failed. See per-row breakdown below.",
    cause:
      "One or more rows in your file failed schema or business-rule checks.",
    fix: [
      "Expand each rule below to see the row-level breakdown.",
      "Fix the offending rows and re-upload.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry"],
  },

  CSV_UPSTREAM_FAIL: {
    title: "Validation service returned an unexpected response. Retry shortly.",
    cause: "Our analytics service returned an envelope without preview data.",
    fix: [
      "Wait 30 seconds and click Retry.",
      "If it persists, contact security@quantalyze.com.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  CSV_NETWORK_TIMEOUT: {
    title:
      "The server did not respond within 30 seconds. Your file is preserved — click Retry to try again.",
    cause: "The validation request did not complete in time.",
    fix: [
      "Retry — your file is preserved.",
      "If it keeps failing, contact security@quantalyze.com.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  CSV_SUBMIT_FAILED: {
    title:
      "Your file validated cleanly, but saving the strategy hit an error. Click Submit strategy again to retry — your data is unchanged.",
    cause:
      "We validated your CSV but the strategy-creation RPC errored.",
    fix: [
      "Click Submit strategy again — your data is unchanged.",
      "If it keeps failing, contact security@quantalyze.com with your wizard session id.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  CSV_SUBMIT_NO_STRATEGY_ID: {
    title:
      "Submission succeeded but the server did not return a strategy id. Retry to confirm.",
    cause: "The finalize RPC returned 200 but no strategy_id.",
    fix: [
      "Click Submit strategy again to confirm — duplicates are prevented by wizard_session_id idempotency.",
      "If it persists, contact security@quantalyze.com.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  // Phase 19 / BACKBONE-08 — wizard double-submit idempotent return.
  // The unified /process-key router catches Postgres 23505 (unique
  // violation on wizard_session_id) and returns the existing
  // verification_id with semantically successful status. The wizard UI
  // surfaces this code so the user knows their submission landed and
  // where to find it, rather than seeing a generic "duplicate" error.
  WIZARD_DUPLICATE: {
    title: "You've already submitted this strategy.",
    cause:
      "We found an existing submission with the same wizard session. Your strategy is already on its way through the pipeline.",
    fix: [
      "Open your dashboard to see the strategy and its current status.",
      "If you intended a fresh submission, start a new wizard session from /strategies/new.",
      "If you think this is a mistake, contact security@quantalyze.com with your draft ID.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["leave_and_return", "request_call"],
  },

  MULTI_KEY_WINDOWS_INVALID: {
    // The `{n}` count is interpolated by formatKeyError via `issueCount`; the
    // default (no context) keeps a sensible non-interpolated title. The bulleted
    // fix list is REPLACED at render time by the component with the live
    // per-issue field messages (from keyWindowsSchema) — one spec, one copy.
    title: "Fix the highlighted issues before continuing.",
    cause: "",
    fix: [],
    docsHref: "/security",
    actions: [],
  },

  COMPOSITE_MEMBERSHIP_UNKNOWN: {
    title: "We couldn't confirm this strategy's key membership.",
    cause:
      "A transient check couldn't determine whether this draft is a multi-key composite. Your draft is saved and nothing was submitted — this is on our side, not your key.",
    fix: [
      "Wait a moment and try again — the check usually succeeds on retry.",
      "If it keeps failing, contact security@quantalyze.com with your draft ID.",
    ],
    docsHref: "/security#sync-timing",
    // Recoverable transient fault: keep `clear_and_retry` so the Retry control
    // renders instead of falling through to the generic UNKNOWN envelope.
    actions: ["clear_and_retry", "request_call"],
  },

  UNKNOWN: {
    title: "Something went wrong.",
    cause:
      "We are not sure what happened. Our team has been notified and is looking into it.",
    fix: [
      "Try the last action again.",
      "If it keeps failing, contact security@quantalyze.com with your draft ID.",
    ],
    docsHref: "/security",
    actions: ["clear_and_retry", "request_call"],
  },
};

/**
 * Optional placeholder context for `formatKeyError`. Fields are filled
 * into the copy at render time. Any unused fields are ignored.
 */
export interface WizardErrorContext {
  /** Trade count (for GATE_INSUFFICIENT_TRADES messaging). */
  trades?: number;
  /** Span days, rounded to 1 decimal (for GATE_INSUFFICIENT_DAYS). */
  days?: number;
  /** Current draft id for support references. */
  draftId?: string;
  /** Raw computation error to include under SYNC_FAILED / GATE_ANALYTICS_FAILED. */
  computationError?: string | null;
  /** File size in MB, formatted as a string with 1 decimal (for CSV_FILE_TOO_LARGE). */
  sizeMb?: string;
  /** Count of blocking cross-key window issues (for MULTI_KEY_WINDOWS_INVALID). */
  issueCount?: number;
}

/**
 * Returns pure data (not JSX) so error copy can be tested, serialized
 * to PostHog, and rendered by multiple components with different markup.
 */
export function formatKeyError(
  code: WizardErrorCode | null | undefined,
  context?: WizardErrorContext,
): WizardErrorCopy {
  if (!code || !(code in WIZARD_ERROR_COPY)) {
    return WIZARD_ERROR_COPY.UNKNOWN;
  }

  const base = WIZARD_ERROR_COPY[code];

  // Interpolate context fields where they are useful. We mutate copies
  // of the strings so the original table stays untouched.
  if (code === "GATE_INSUFFICIENT_TRADES" && context?.trades !== undefined) {
    return {
      ...base,
      cause:
        `We found only ${context.trades} filled trade(s) on this key. ` + base.cause,
    };
  }

  if (code === "GATE_INSUFFICIENT_DAYS" && context?.days !== undefined) {
    // Floor-round so a sub-7 value never displays as "7.0". The gate
    // compares strictly `< 7` (see strategyGate.ts:89), but `.toFixed(1)`
    // rounds half-up, so a real span of 6.95 was rendered as "7.0" — a
    // user reading "we found 7.0 days" sees a passing-looking number
    // alongside a failure and is justifiably confused. Floor at 1
    // decimal: 6.95 → "6.9", 6.99 → "6.9", 7.0 exact → never reaches
    // here (gate passes). For values < 0.1 the fallback string is "0.0".
    const floored = Math.floor(context.days * 10) / 10;
    return {
      ...base,
      cause:
        `Your trades span ${floored.toFixed(1)} calendar day(s). ` + base.cause,
    };
  }

  if (
    (code === "GATE_ANALYTICS_FAILED" || code === "SYNC_FAILED") &&
    context?.computationError
  ) {
    return {
      ...base,
      cause: `${base.cause} Details: ${context.computationError}.`,
    };
  }

  if (code === "CSV_FILE_TOO_LARGE" && context?.sizeMb !== undefined) {
    return {
      ...base,
      title: base.title.replace(SIZE_MB_PLACEHOLDER, context.sizeMb),
    };
  }

  if (
    code === "MULTI_KEY_WINDOWS_INVALID" &&
    context?.issueCount !== undefined
  ) {
    const n = context.issueCount;
    return {
      ...base,
      title: `Fix ${n} issue${n === 1 ? "" : "s"} before continuing`,
    };
  }

  return base;
}

/**
 * Map a gate failure code from `strategyGate.ts` to the corresponding
 * wizard error code. Keeps the two modules loosely coupled — the gate
 * does not know about wizard UI, the wizard does not re-encode the gate.
 */
export function gateFailureToWizardError(code: GateFailureCode): WizardErrorCode {
  switch (code) {
    case "INSUFFICIENT_TRADES":
      return "GATE_INSUFFICIENT_TRADES";
    case "INSUFFICIENT_DAYS":
      return "GATE_INSUFFICIENT_DAYS";
    case "ANALYTICS_FAILED":
      return "GATE_ANALYTICS_FAILED";
    case "NO_DATA_SOURCE":
      return "GATE_NO_DATA_SOURCE";
    case "ANALYTICS_MISSING":
    case "ANALYTICS_PENDING":
    case "ANALYTICS_COMPUTING":
      // These are transient UI states, not terminal errors. Callers
      // should poll rather than render an error. Fall back to UNKNOWN
      // if they do reach this path so we catch the misuse.
      return "UNKNOWN";
    case "INSUFFICIENT_CSV_HISTORY":
      // Admin-approval-only gate code. The wizard's SyncPreviewStep is the
      // exchange-key path (never CSV-sourced), and the CSV upload branch
      // validates via csv-finalize — so this code never flows through the
      // wizard error mapper. UNKNOWN flags the misuse if it ever does.
      return "UNKNOWN";
  }
}

/**
 * Export the copy table for unit tests. Not for UI consumption —
 * components should call `formatKeyError` so placeholder interpolation
 * runs through a single code path.
 */
export { WIZARD_ERROR_COPY };

// ============================================================
// Phase 17 — CSV branch absorption (DESIGN-05).
// Heading / helper / dropzone strings hoisted from the four CSV
// step files. These are NOT error codes — they are user-visible
// surface chrome strings. Mapping table: 17-UI-SPEC.md §14.1.
// ============================================================

/**
 * CsvUploadStep.tsx user-visible chrome strings (heading, subtitle,
 * field helper, file label template, dropzone idle copy). Hoisted
 * verbatim from CsvUploadStep.tsx lines 303 / 307 / 352 / 404 / 414.
 */
export const CSV_UPLOAD_STEP_HEADINGS = {
  title: "Upload your track record",
  subtitle:
    "Name your strategy, pick a format, and drop your CSV. We validate every row before creating your strategy. Max 10 MB.",
  nameHelper:
    "1–80 characters. This is the public name on your factsheet — pick something your LPs will recognize.",
  fileLabel: (fileName: string, fileSizeMb: string) =>
    `${fileName} · ${fileSizeMb} MB`,
  dropzoneIdle: "Drop a CSV file here, or click to browse",
} as const;

/**
 * CsvPreviewStep.tsx user-visible chrome strings (heading, subtitle,
 * continue-CTA label). Hoisted verbatim from CsvPreviewStep.tsx
 * lines 74 / 78 / 154.
 */
export const CSV_PREVIEW_STEP_HEADINGS = {
  title: "Preview your data",
  subtitle:
    "Confirm we parsed your file correctly. Validation runs across every row in your file before you can continue.",
  continueLabel: "Submit strategy",
} as const;

/**
 * CsvSubmitStep.tsx user-visible chrome strings (heading, subtitle,
 * submit CTA). Hoisted verbatim from CsvSubmitStep.tsx lines
 * 170 / 174 / 226.
 */
export const CSV_SUBMIT_STEP_HEADINGS = {
  title: "Review and submit",
  subtitle:
    "The founder reviews CSV-uploaded strategies within 48 hours. You will receive an email when your listing is approved.",
  submitCtaLabel: "Submit strategy",
  submittingCtaLabel: "Submitting…",
} as const;

/**
 * Pandera rule labels surfaced by `CsvValidationEnvelope` per-rule
 * `<details>` summaries. Locked verbatim by 15-UI-SPEC §8.8 +
 * 17-UI-SPEC §14.3. Phase 17 relocates them from
 * `CsvValidationEnvelope.tsx:30-37` so wizardErrors.ts owns every
 * user-visible CSV-branch string.
 */
export const CSV_RULE_LABELS: Readonly<Record<string, string>> = {
  monotonic_dates: "Dates must be strictly increasing",
  nav_non_zero: "NAV cannot be zero",
  daily_return_lower_bound: "Daily return cannot be ≤ -100%",
  daily_sharpe_sentinel: "Daily Sharpe > 10 looks unrealistic",
  currency_usd_or_blank: "Currency must be USD or left blank",
  qty_price_positive: "Quantity and price must be positive",
  // QA report 2026-05-21 ISSUE-012: the underlying pandera rule key was
  // `column_in_dataframe` and the envelope's per-rule label fell through
  // to the raw key (e.g. "Rule violated: column_in_dataframe"). A
  // user-friendly label here resolves the cause line; the per-row
  // message is rewritten by `formatColumnInDataframeMessage()` below.
  column_in_dataframe: "Your CSV is missing a required column",
  // QA report 2026-05-21 ISSUE-008: the daily_return column carried raw
  // dollar PnL (median |x| > 0.5) instead of decimal returns. The
  // dataset-level sentinel in services/csv_validator.py fires; the
  // friendly per-rule label here matches what the user sees.
  daily_return_dollar_form_sentinel:
    "Daily return values look like dollar PnL, not decimal returns",
} as const;

/**
 * Format the single-rule cause sentence emitted by
 * `CsvValidationEnvelope` when exactly one rule failed. Mirrors the
 * original literal `"Rule violated: {human}. Expand below for the
 * row-level breakdown."`. Caller passes the already-resolved human
 * label (via `CSV_RULE_LABELS`).
 */
export function formatCsvRuleCauseSingle(humanLabel: string): string {
  return `Rule violated: ${humanLabel}. Expand below for the row-level breakdown.`;
}

/**
 * Rewrite a pandera `column_in_dataframe` per-row message to be
 * actionable. The raw message is shaped like "Column 'None' failed:
 * daily_return" — referencing the missing column by its rule name,
 * not by anything the user can use. Pull out the expected column
 * name and surface "The required column `daily_return` is missing
 * from your file." instead. (QA report 2026-05-21 ISSUE-012.)
 *
 * The match is intentionally narrow — anything we cannot parse falls
 * through to the original message so we don't drop information.
 */
export function formatColumnInDataframeMessage(raw: string): string {
  const m = raw.match(/Column\s+'[^']*'\s+failed:\s+(\S+)/);
  if (!m) return raw;
  const missingColumn = m[1];
  return `The required column \`${missingColumn}\` is missing from your file. Rename a column to \`${missingColumn}\` or switch formats on the upload step.`;
}
