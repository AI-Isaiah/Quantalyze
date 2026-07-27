/**
 * Scripted error copy for the /strategies/new/wizard flow. Every error
 * has a stable code, a title, a cause, numbered fix steps, a docs
 * anchor, and the UI actions to surface. Raw backend strings never
 * reach the UI — unknown codes fall through to the UNKNOWN entry.
 */

import type { GateFailureCode } from "./strategyGate";
// ⚠️ LOAD-BEARING IMPORT PATH (Phase 140 / SEAM-04, blocker B-1). `seam-errors`
// is the dependency-free LEAF: zero imports, zero env reads, zero module-load
// side effects. This module is VALUE-imported by ten `"use client"` components
// (MetadataStep, CsvPreviewStep, MultiKeyConnectStep, SyncPreviewStep,
// CsvSubmitStep, ConnectKeyStep, SubmitStep, CsvUploadStep,
// CsvValidationEnvelope, StrategyGrid), so whatever it imports ships to the
// BROWSER. Do NOT "simplify" this to `@/lib/analytics-client` or
// `@/lib/resilient-fetch` — either re-export drags `@upstash/redis`,
// `@upstash/ratelimit` and a top-level `Redis.fromEnv()` singleton into the
// wizard bundle for every user. (The mirror-image convention is the
// `import "server-only"` guard at `src/lib/analytics.ts:1`.)
//
// The leaf path is also the only one that survives the test suite: sixteen
// route test files `vi.mock("@/lib/analytics-client")` with BARE factories, so
// a class reached through that re-export would be `undefined` at runtime and
// the `instanceof` below would throw from inside a catch block. Nothing mocks
// the leaf.
import { CircuitOpenError } from "@/lib/seam-errors";

export type WizardErrorCode =
  // Key validation (ConnectKeyStep)
  | "KEY_HAS_TRADING_PERMS"
  | "KEY_HAS_WITHDRAW_PERMS"
  // Phase 110.1 / DOGFOOD-3 FIX 3: honest reasons that do not assert an
  // unobserved scope. KEY_NOT_READ_ONLY = a bare read_only:false with no
  // observed permission scopes (the validator could not confirm read-only,
  // but never reported trade/withdraw). KEY_PROBE_FAILED = the exchange
  // permission probe fail-closed transiently (retryable upstream blip), not a
  // 500 "something went wrong".
  | "KEY_NOT_READ_ONLY"
  | "KEY_PROBE_FAILED"
  | "KEY_INVALID_SIGNATURE"
  // DOGFOOD (2026-07-18): the exchange authenticated the request and rejected
  // the whole credential pair (e.g. Deribit error 13004 invalid_credentials).
  // Distinct from KEY_INVALID_SIGNATURE — that copy asserts "the key was
  // accepted, only the signature was wrong", which is FALSE here: the exchange
  // never accepted the credentials, so either the key OR the secret (or both)
  // is wrong / regenerated / whitespace-mangled. Honest copy, no unobserved
  // "which half" claim (mirrors the KEY_NOT_READ_ONLY DOGFOOD-3 discipline).
  | "KEY_AUTH_FAILED"
  // Phase 135 / MT5SRC-02 (resolved Q-B): MT5's login accepts a MASTER
  // (trade-capable) password AND fails opaquely on a wrong broker server —
  // both would collapse to KEY_AUTH_FAILED and tell the user to fix the wrong
  // thing. Following the KEY_AUTH_FAILED DOGFOOD discipline (honest, no
  // unobserved claim), these are DISTINCT user mistakes with targeted copy:
  //   KEY_MT5_MASTER_PASSWORD — the login worked but can place trades, so it
  //     was refused and NEVER stored; the fix is the read-only investor
  //     password (the master password was not "wrong").
  //   KEY_MT5_WRONG_SERVER — the exact broker server name did not resolve; the
  //     fix is the server string shown in the MT5 terminal login window.
  | "KEY_MT5_MASTER_PASSWORD"
  | "KEY_MT5_WRONG_SERVER"
  | "KEY_INVALID_FORMAT"
  | "KEY_IP_ALLOWLIST"
  // Phase 140.3-05 / TS-35 — the two venue-transient verdicts that had no
  // wizard member, read off the machine `code` the Python service has emitted
  // on the wire since 140.1.2 (contract:
  // `analytics-service/tests/fixtures/validate_key_venue_transient_contract.json`).
  //
  //   KEY_EXCHANGE_UNAVAILABLE — wire `EXCHANGE_UNAVAILABLE`. The venue itself
  //     is down or in a maintenance window (ccxt.ExchangeNotAvailable). Its
  //     copy matched NO branch of the substring cascade, so a Binance
  //     maintenance window during key-connect rendered as UNKNOWN/500 with no
  //     retry affordance — the DOGFOOD-3 dead end.
  //   KEY_VENUE_TRANSIENT — wire `DDOS_PROTECTION`. The venue's EDGE (WAF /
  //     anti-DDoS) refused our request before the exchange ever saw it.
  //     ⚠️ This one did NOT fall through — it silently matched the cascade's
  //     `ip` + `allow` branch and rendered KEY_IP_ALLOWLIST, telling the user
  //     their key has an IP allowlist problem when the truth is that a venue
  //     edge blocked US. Invisible to an audit asking "does it reach UNKNOWN?"
  //     (correction C-6), which is why it survived the original enumeration.
  | "KEY_EXCHANGE_UNAVAILABLE"
  | "KEY_VENUE_TRANSIENT"
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
  // Phase 94.1 / RT-FINDING-3 — the wizard connect step's on-mount rehydration
  // GET (/api/strategies/composite/members) failed transiently. NEUTRAL copy:
  // it fires for ANY api draft (the client can't yet know single-key vs
  // composite), so it must NOT assert "composite" — a resumed SINGLE-KEY user's
  // membership is definitionally empty and "composite" wording would confuse
  // them. Recoverable: the draft is intact, Retry re-runs the load.
  | "WIZARD_KEYS_LOAD_FAILED"
  // Phase 140 / SEAM-04 — the Vercel→Railway circuit breaker is OPEN, so the
  // key-connect request was short-circuited BEFORE any call was issued. Nothing
  // reached the exchange and nothing was stored. Distinct from KEY_PROBE_FAILED
  // (the probe RAN and fail-closed) and from KEY_NETWORK_TIMEOUT (a request WAS
  // issued and timed out): here we deliberately declined to try, and the
  // honest, actionable thing to tell the user is "we are recovering — retry in
  // a moment". Before this code existed the trip fell through to UNKNOWN/500
  // ("something went wrong, our team has been notified"), which is both untrue
  // and un-actionable during an infra outage.
  // ✅ 140.3-12 APPLIED THE REMEDY THIS COMMENT ARGUES FOR. The quoted sentence
  // is a historical citation, not a description of shipped copy: UNKNOWN no
  // longer claims notification, and neither does any other entry in the table.
  // `wizardErrors.test.ts` scans the WHOLE table for the claim, so it cannot
  // grow back on a code nobody thought to check.
  | "SERVICE_UNAVAILABLE_RETRY"
  // Phase 140.3-05 / SEAMUX-01 — we ISSUED the request to our own analytics
  // service and never got an answer: the deadline fired, or the connection
  // failed. `process-key-client` already names both on the wire
  // (`UPSTREAM_TIMEOUT`, `UPSTREAM_NETWORK_ERROR`) and `finalize-wizard`
  // forwards that envelope verbatim, so this is a code the user's browser
  // ALREADY receives — it simply had no wizard member and collapsed to UNKNOWN.
  //
  // ⚠️ NOT a duplicate of the three near-misses, and this file's own convention
  // is what separates them:
  //   · SERVICE_UNAVAILABLE_RETRY — we DECLINED to try (the breaker is open).
  //   · KEY_NETWORK_TIMEOUT — we could not reach the EXCHANGE. Reusing it here
  //     would assert a venue fault for a fault on our own hop, which is exactly
  //     the "copy that asserts something false" class this phase exists to kill.
  //   · KEY_PROBE_FAILED — the probe RAN and fail-closed.
  | "SERVICE_UNREACHABLE"
  // Phase 140.3-01 / TS-09 — the two machine codes the APP-GLOBAL handlers in
  // `analytics-service/main.py` emit (STATUS_CONTRACT.md §2.1). Both arrive on
  // the FLAT wire shape, with the code at the TOP level of the body.
  //
  // ⚠️ NEITHER IS A DUPLICATE OF A MEMBER ABOVE, and the near-misses matter:
  //   · `RATE_LIMITED` is OUR limiter refusing the request (`RateLimitExceeded`,
  //     429). `KEY_RATE_LIMIT` above is the wizard's classification of an
  //     EXCHANGE throttle, reached through the substring cascade. Rendering one
  //     for the other blames a venue for our own limit, or vice versa.
  //   · `VALIDATION_FAILED` is a request-shape rejection (`RequestValidationError`,
  //     422) on the API path. `CSV_VALIDATION_FAILED` above is the CSV branch's
  //     row-level rule failure. Rendering one for the other tells an API user
  //     about their file.
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
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

  KEY_NOT_READ_ONLY: {
    title: "We could not verify this key as read-only.",
    cause:
      "The exchange did not confirm this key is read-only, and it did not report a specific trading or withdrawal scope either. We accept read-only keys only, so we cannot use it — but we are not claiming it has trade permissions we did not observe.",
    fix: [
      "Open your exchange API Management page and confirm this key has only Read enabled.",
      "If you are unsure, create a fresh read-only key from scratch.",
      "Paste the key here again.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["try_another_key", "request_call"],
  },

  KEY_PROBE_FAILED: {
    title: "We could not check this key's permissions just now.",
    cause:
      "The permission check against the exchange did not complete — a transient upstream issue, not a problem with your key. We fail closed when we cannot verify, so nothing was saved.",
    fix: [
      "Try again in a moment.",
      "If it keeps failing, switch to a different exchange or contact support.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
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

  KEY_AUTH_FAILED: {
    title: "The exchange rejected these credentials.",
    cause:
      "The exchange could not authenticate this key and secret (e.g. Deribit returns invalid_credentials). The exchange never accepted the pair, so the key or the secret is wrong, was regenerated, or was copied with extra whitespace.",
    fix: [
      "Open your exchange API Management page and confirm this key still exists and is enabled.",
      "Re-copy BOTH values with no leading or trailing spaces — on Deribit the key is the ClientId and the secret is the ClientSecret.",
      "If the secret was only shown once at creation, create a fresh read-only key and paste both values here.",
    ],
    docsHref: "/security#regenerate-key",
    actions: ["clear_and_retry", "request_call"],
  },

  KEY_MT5_MASTER_PASSWORD: {
    // Honest copy (Phase 135 / MT5SRC-02): the password was CORRECT — it was
    // refused because it is a MASTER login that can place trades, not because
    // it was wrong. Never assert "your password was wrong" here (that is the
    // KEY_AUTH_FAILED path). Nothing was stored.
    title: "This MT5 login can place trades.",
    cause:
      "This is a master password — it authenticated, but it can place and modify trades. Quantalyze connects to read-only accounts only, so we refused it and stored nothing. MT5 gives every account a second, read-only investor password for exactly this.",
    fix: [
      "Open your MT5 terminal and find this account's investor (read-only) password — it is separate from the master password you just used.",
      "If you do not have it, ask your broker to issue or reset the investor password for this account.",
      "Reconnect here using the login, the investor password, and the same broker server.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["try_another_key", "request_call"],
  },

  KEY_MT5_WRONG_SERVER: {
    // Phase 135 / MT5SRC-02: a wrong/unknown broker server fails opaquely on
    // MT5, indistinguishable from a bad password at the protocol level — so we
    // surface it as its own actionable code rather than a generic bad-creds
    // message. The exact server string is broker- and often region-specific.
    title: "We could not find that broker server.",
    cause:
      "MT5 could not connect to the broker server name you entered. Server names are exact and broker-specific (often with a region or Demo/Live suffix), so a small mismatch fails the same way a wrong password would.",
    fix: [
      "Open your MT5 terminal's login window and copy the server name exactly as it appears there.",
      "Watch for trailing spaces, the wrong region, or a Demo vs Live suffix.",
      "Paste the exact server name here and reconnect with the same login and investor password.",
    ],
    docsHref: "/security#readonly-key",
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

  // 140.3-12 / SEAMUX-04 — copy FINAL, reviewed and KEPT as 140.3-05 drafted it.
  // `actions` were already final there (they drive `recoverable` via
  // RECOVERABLE_ACTIONS in src/lib/envelope.ts, so they are behaviour, not
  // copy): a venue maintenance window clears on its own, so `clear_and_retry`
  // stays and `try_another_key` is ABSENT because a second key on the same
  // venue fails identically.
  //
  // Why "your key was not stored and nothing was submitted" is allowed to stand
  // here when the identical sentence had to be struck from SERVICE_UNREACHABLE:
  // this verdict is reached only from `classifyKeyValidationError`, on the
  // key-connect paths, and it is reached because the VENUE ANSWERED — it
  // refused. A refusal is an observation, so validation demonstrably never
  // passed and storage was never reached. A timeout is the opposite: no answer,
  // nothing observed, nothing knowable.
  KEY_EXCHANGE_UNAVAILABLE: {
    title: "The exchange is not available right now.",
    cause:
      "The venue reported that it is unavailable — usually a maintenance window or an outage on their side. Your key was not stored and nothing was submitted. This is not a problem with your key.",
    fix: [
      "Wait a few minutes and try again — venue maintenance windows are usually short.",
      "Check your exchange's status page if it keeps failing.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  // 140.3-12 / SEAMUX-04 — copy FINAL, reviewed and KEPT, same reasoning as the
  // entry above: the venue's edge ANSWERED with a refusal, so "not stored,
  // nothing submitted" is observed rather than assumed.
  //
  // ⚠️ WHAT THIS COPY MUST NOT SAY, and the reason the code exists. Before
  // TS-35 this verdict rendered KEY_IP_ALLOWLIST — "This key has an IP
  // allowlist that does not include Quantalyze" — and sent the user to edit
  // restrictions on a key that was never the problem. The block is at the
  // VENUE'S edge, against us. Never re-attach an allowlist instruction here.
  KEY_VENUE_TRANSIENT: {
    title: "The exchange blocked our request at its edge.",
    cause:
      "The venue's edge protection refused the request before the exchange itself saw it. It is aimed at where the request came from, not at your key. Your key was not stored and nothing was submitted.",
    fix: [
      "Wait a moment and try again — these blocks are usually short-lived.",
      "If it keeps failing, contact security@quantalyze.com so we can raise it with the venue.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
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

  // 140.3-12 / SEAMUX-04 — copy corrected. This entry used to open "We fetched
  // your trades but the analytics computation did not complete", which asserted
  // BOTH that a fetch succeeded and which later stage failed. The client can
  // observe neither: 140.3-10 made this the FALLBACK for every kickoff failure
  // that carries no code we recognise, including a breaker trip in which no
  // trade was ever fetched. It therefore names no stage at all.
  SYNC_FAILED: {
    title: "Sync failed.",
    cause:
      "The sync did not complete. We cannot tell from here which step failed or how far it got. Your draft is saved.",
    fix: [
      "Retry the sync from this page.",
      "If it keeps failing, contact security@quantalyze.com with your draft ID and the diagnostics below.",
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

  // 140.3-12 / SEAMUX-04 — TWO false claims removed from this one entry, and
  // neither was listed in any source document: they were found by grepping the
  // SENTENCE rather than the code.
  //   1. "We fetched your trades successfully" — the same unobservable claim
  //      SYNC_FAILED made, worded more strongly. The server reports the STAGE
  //      it failed at; it does not report that the earlier stage succeeded.
  //   2. the fix line claimed we had already been told. This code is reachable
  //      from routes that capture nothing, so that was an audit trail asserted
  //      and absent. Contacting us is now stated as the thing that reaches a
  //      person, without claiming anything already has.
  GATE_ANALYTICS_FAILED: {
    title: "Analytics computation failed.",
    cause:
      "The analytics step failed for this draft. We cannot tell from here how much of the sync before it completed. The fault is in our pipeline, not at your exchange.",
    fix: [
      "Retry the sync from this page.",
      "If it fails again, email security@quantalyze.com with your draft ID and the diagnostics below.",
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

  // 140.3-12 / SEAMUX-04 — "your data is unchanged" removed from BOTH the title
  // and the fix list. It was an assertion about server state that the browser
  // cannot make: this code is raised on a 500 from a handler that runs
  // `finalize_csv_strategy`, and uvicorn does not cancel a handler on client
  // disconnect, so the write may well have landed. The old wording also STEERED
  // the user straight back into a resubmit, which is the dead end the reply
  // contract has not yet fixed. The copy now states the uncertainty and puts a
  // non-destructive check FIRST, ahead of any resubmit.
  CSV_SUBMIT_FAILED: {
    title: "We could not confirm whether your strategy was saved.",
    cause:
      "Your file passed validation, then the save step returned an error. The error does not tell us whether the save completed, so we cannot promise it did or that it did not.",
    fix: [
      "Open /strategies in another tab first. If your strategy is listed, the save did complete and submitting again would create a second copy.",
      "If it is not listed, submit again.",
      "If you are unsure, contact security@quantalyze.com with your wizard session id and the diagnostics below.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  CSV_SUBMIT_NO_STRATEGY_ID: {
    title:
      "Submission succeeded but the server did not return a strategy id. Retry to confirm.",
    cause: "The finalize RPC returned 200 but no strategy_id.",
    // 140.3-12 / SEAMUX-04 — the duplicate-protection promise is SCOPED to the
    // flow that actually has the mechanism, and the internal field name is gone
    // from the user's screen. The guarantee itself is real HERE and is kept:
    // this code is CSV-only, and both `csv-validate` and `csv-finalize` send the
    // wizard session id today. It must NOT be widened to the API path — that
    // call site sends no id, and a promise made ahead of its mechanism is how
    // this whole class of copy started.
    fix: [
      "Submit again. On the CSV path a repeat submit of the same wizard session cannot create a second strategy.",
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

  WIZARD_KEYS_LOAD_FAILED: {
    title: "We couldn't load this draft's saved keys.",
    cause:
      "A transient error stopped us from loading the API keys saved on this draft. Your draft is safe and nothing was submitted — this is on our side, not your keys.",
    fix: [
      "Wait a moment and try again — the load usually succeeds on retry.",
      "If it keeps failing, contact security@quantalyze.com with your draft ID.",
    ],
    docsHref: "/security#sync-timing",
    // Recoverable transient fault: keep `clear_and_retry` so the Retry control
    // renders. NEUTRAL wording (RT-FINDING-3): no "composite" assertion, so it
    // reads correctly for a resumed single-key draft too.
    actions: ["clear_and_retry", "request_call"],
  },

  // 140.3-12 / SEAMUX-04 — the key-storage half of this sentence is gone, on
  // 140.3-05's recorded hand-off. That plan aliased the wire code CIRCUIT_OPEN
  // onto this member, so the entry is now reached at FINALIZE as well as at
  // key-connect — and at finalize the key was stored several steps earlier, so
  // "your key has not been saved" was false on the newer of its two paths. The
  // load-bearing half is true at BOTH and is what remains: the breaker declined
  // to issue the request, so nothing was submitted. That claim is knowable
  // precisely because no request was ever sent — do not copy this wording to a
  // TIMEOUT, where the request WAS sent (see SERVICE_UNREACHABLE below).
  SERVICE_UNAVAILABLE_RETRY: {
    title: "Our service is temporarily unavailable.",
    cause:
      "We paused outbound requests after repeated failures so the service can recover, so this request was never sent. Nothing was submitted — this is on our side, not your key.",
    fix: [
      "Wait a moment, then try the same action again.",
      "If it is still failing after a few minutes, contact security@quantalyze.com.",
    ],
    docsHref: "/security#sync-timing",
    // Recoverable by definition — the whole point of the code is that a Retry
    // control renders instead of the dead-end UNKNOWN envelope.
    actions: ["clear_and_retry", "request_call"],
  },

  // 140.3-12 / SEAMUX-04 — copy FINAL. `actions` were already final (140.3-05).
  //
  // ⚠️ 140.3-05's non-final draft claimed "Nothing was submitted and your draft
  // is unchanged", and that claim was FALSE-BY-CONSTRUCTION here. This member
  // homes UPSTREAM_TIMEOUT and UPSTREAM_NETWORK_ERROR: the request WAS issued
  // and no answer came back. A deadline firing tells us nothing about whether
  // the far side processed the request — it is the canonical case in which the
  // work may well have completed. Asserting a negative we cannot observe is the
  // same defect as CSV_SUBMIT_FAILED's old "your data is unchanged", and it
  // reached this entry by being copied from SERVICE_UNAVAILABLE_RETRY, where a
  // breaker DECLINED to send and the identical sentence IS knowable. The two
  // codes are one line apart and one of them may say it. Do not re-merge them.
  SERVICE_UNREACHABLE: {
    title: "We could not reach our own service.",
    cause:
      "We sent the request and never got an answer — the connection failed or ran out of time. Because no answer came back, we cannot tell whether it was processed. This is on our side, not your key or your exchange.",
    fix: [
      "If you were submitting a strategy, open /strategies before retrying — the request may have completed without answering.",
      "Otherwise, try the same action again.",
      "If it is still failing after a few minutes, contact security@quantalyze.com with your draft ID.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  // 140.3-12 / SEAMUX-04 — copy FINAL, and the PRODUCER ATTRIBUTION is gone.
  //
  // ⚠️ The non-final draft said "The analytics service rejected the shape of
  // the request". That named one producer, and it is why 140.3-10 refused to
  // route `/api/keys/sync`'s two 400 arms here: those rejections are made by
  // OUR OWN route, before the analytics service is ever called, so the sentence
  // would have been a fresh false attribution — a vague error turned into a
  // specific lie, which is worse than the vague one it replaced.
  //
  // This member is a RENDERING code, not a wire code. The one fact it stands
  // for is "a request was refused on its shape before any work ran", and that
  // is exactly true of both producers: the analytics service's 422 and this
  // app's own 400. Naming neither is what lets one honest sentence serve both,
  // and is why no new union member was minted (the table size is unchanged).
  //
  // What stays knowable, and why the claim is safe here in a way it is NOT on
  // SERVICE_UNREACHABLE: a shape rejection happens BEFORE execution, so
  // "nothing was submitted" is a fact about a request that never ran, not a
  // guess about one whose outcome we never learned.
  VALIDATION_FAILED: {
    title: "We could not read that request.",
    cause:
      "We sent a request that failed its shape check before any work started. Nothing was submitted and nothing was changed. The fault is in our software, not in your key or your data.",
    fix: [
      "Contact security@quantalyze.com with your draft ID — a request-shape fault is on our side and retrying the same action will not clear it.",
    ],
    docsHref: "/security",
    // Deliberately NO retry affordance: the request is malformed, so a retry
    // re-fails identically. DESIGN.md's Error Envelope renders the Retry CTA
    // iff `recoverable && onRetry`, and this is not recoverable.
    actions: ["request_call"],
  },

  // 140.3-12 / SEAMUX-04 — copy FINAL, and the wait is DELIBERATELY ABSENT from
  // these strings. Read this before "improving" it by adding a duration.
  //
  // DESIGN.md §Voice asks for a limitation stated WITH ITS THRESHOLD, and the
  // honest threshold is the server's own `Retry-After`. 140.3-09 built that
  // plumbing (`WizardErrorContext.retryAfterSeconds` → the envelope's
  // `retry_after_seconds`), so the number is now representable — but it belongs
  // to the RENDERER, not to this table. `ErrorEnvelope` prints "Try again in
  // Ns." from the server's own figure when one arrived, and prints nothing at
  // all when none did.
  //
  // A duration written HERE would be a static string on every path, including
  // the ones where no `Retry-After` was ever sent — a number we invented,
  // presented as the server's. So the copy says to wait without saying how
  // long, and the figure appears above it exactly when it is real.
  RATE_LIMITED: {
    title: "You have reached our request limit.",
    cause:
      "We cap how often this action can run and this attempt went over the cap. Nothing was submitted and nothing was changed — the cap is ours, not your exchange's.",
    fix: [
      "Wait, then run the same action again. We do not queue it or retry it for you.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  // 140.3-12 / SEAMUX-04 — the notification claim is GONE. It asserted an audit
  // trail that does not exist: 9 of the 15 seam routes capture nothing at all,
  // so on those paths the sentence promised a person was looking at something
  // no one could see.
  //
  // ⚠️ THE REPLACEMENT DELIBERATELY SAYS NOTHING ABOUT NOTIFICATION IN EITHER
  // DIRECTION, and that is the whole point. The obvious correction — telling
  // the user nothing reaches us automatically — is a SECOND false claim, just
  // pointed the other way: the other 6 routes DO capture, and this code is
  // reachable from them. The client cannot tell which route it came from, so
  // the only sentence true on every path is one that makes no claim about our
  // side at all. If 140.3-13 adds the missing captures, the claim may come back
  // — but only with the receipt, and only where it is true.
  UNKNOWN: {
    title: "Something went wrong.",
    cause:
      "We could not classify this failure, so we cannot tell you what happened or whether your last action took effect.",
    fix: [
      "Try the last action again.",
      "If it keeps failing, contact security@quantalyze.com with your draft ID and the diagnostics below.",
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
  /**
   * 140.3-09 / SEAMUX-06 — the advertised wait, in SECONDS, for a recoverable
   * error that carries one (KEY_RATE_LIMIT / SERVICE_UNAVAILABLE_RETRY and any
   * other throttle- or breaker-flavoured code).
   *
   * UNITS ARE SECONDS, end to end, and this field is the only place the choice
   * is made. `parseRetryAfterSeconds` (the ONE header parser) returns seconds
   * and `CircuitOpenError.retryAfterS` is seconds, so nothing between the wire
   * and this field converts. Mixing units across this boundary is how the raw
   * `Number(header)` NaN bug reached a live surface (B20).
   *
   * OPTIONAL, and absence means "no wait was advertised" — never "zero" and
   * never "retry immediately". A surface MUST NOT name a duration it did not
   * receive: an error arm that invents a wait turns a vague failure into a
   * specific lie (TRAP-3). The renderer skips the line entirely when absent.
   */
  retryAfterSeconds?: number;
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
 * Phase 140.3-05 / TS-35 — the venue-transient wire vocabulary, mapped
 * EXPLICITLY onto wizard verdicts.
 *
 * WHAT THIS REPLACES. `classifyKeyValidationError` below derived both the
 * wizard code and the returned HTTP status from a substring cascade over the
 * HUMAN string, discarding the machine code entirely. Phase 140.1.2 made all
 * seven venue-transient sites emit a stable `code` on the wire; nothing read
 * it. Replaying the cascade's real predicates over the committed contract
 * bytes, three of the six real verdicts were wrong — and only two of the three
 * were visible as UNKNOWN:
 *
 *   EXCHANGE_UNAVAILABLE  -> UNKNOWN 500            (a venue outage as a mystery)
 *   NETWORK_UNAVAILABLE   -> UNKNOWN 500            (a two-string near-miss)
 *   DDOS_PROTECTION       -> KEY_IP_ALLOWLIST 502   (a venue WAF block blamed
 *                                                    on the user's key — silent)
 *
 * WHY A `Map` AND NOT A `Record`, restated because it is a security property,
 * not a style choice: the key arrives OVER THE WIRE. A plain-object index
 * resolves `"constructor"`, `"toString"` and `"__proto__"` to inherited
 * members, so `TABLE[code] ?? fallback` would hand back a Function typed as a
 * verdict. A `Map` has no inherited keys. Same reasoning as
 * `SEAM_CODE_TO_WIZARD_CODE` below.
 *
 * WHY IT IS A LOOKUP AND NEVER A SUBSTRING TEST. The `TYPE CHECK FIRST, BY
 * DESIGN` note in the function below argues this for the breaker's code, and
 * the argument is not specific to it: a substring branch is simultaneously too
 * narrow (any reword upstream silently re-opens the cascade) and too broad (an
 * unrelated message containing the token is mislabelled), and in a cascade it
 * loses to whichever earlier branch the message happened to collide with,
 * because ORDERING decides, not specificity.
 *
 * THE TABLE IS CLOSED AND HAND-TYPED. An upstream-supplied code that is not a
 * member — the contract's own `ZZ_UNRECOGNISED_VENUE_CODE` control, or a venue
 * code minted after this table was written — falls through to the cascade and
 * then to UNKNOWN. There is no dynamic key construction and no `code as
 * WizardErrorCode` shortcut, which would admit every future string unchecked.
 *
 * ⚠️ `RATE_LIMITED` IS IN TWO WIRE VOCABULARIES WITH TWO MEANINGS, and that is
 * why this table is separate from `SEAM_CODE_TO_WIZARD_CODE`. Here it is the
 * VENUE throttling us (venue-transient contract, `KEY_RATE_LIMIT`); there it is
 * OUR OWN limiter refusing the request (the app-global `RateLimitExceeded`
 * handler, `RATE_LIMITED`). Merging the two tables would force one answer onto
 * both producers and blame a venue for our own limit, or the reverse. Telling
 * them apart needs the upstream STATUS (400 vs 429), which this function still
 * discards — that is TS-32 / TS-34's, deliberately not smuggled in here.
 *
 * ⚠️ The wire `recoverable` flag is NOT read. `recoverable` on the wizard side
 * is derived from `actions` (`src/lib/envelope.ts`) and is a RENDER hint. The
 * two are not the same predicate — the contract marks `AUTH_FAILED`
 * non-recoverable because retrying the SAME credentials cannot help, while the
 * wizard offers `clear_and_retry` because entering DIFFERENT credentials can.
 * The divergence is deliberate, and pinned in the parity test. Do not wire
 * either into an automated retry loop; retry is Phase 141 (rider W-4).
 */
const VENUE_WIRE_CODE_TO_VERDICT: ReadonlyMap<
  string,
  { code: WizardErrorCode; status: number }
> = new Map([
  // Already correct through the cascade; mapped explicitly so the verdict no
  // longer depends on an accident of substring ordering.
  ["RATE_LIMITED", { code: "KEY_RATE_LIMIT", status: 503 }],
  ["PROBE_FAILED", { code: "KEY_PROBE_FAILED", status: 503 }],
  ["AUTH_FAILED", { code: "KEY_AUTH_FAILED", status: 400 }],
  // The three the cascade got wrong.
  ["EXCHANGE_UNAVAILABLE", { code: "KEY_EXCHANGE_UNAVAILABLE", status: 503 }],
  // Reuses the existing member: "We could not reach the exchange" is exactly
  // what this verdict means, so a new member would be a second code with one
  // meaning.
  ["NETWORK_UNAVAILABLE", { code: "KEY_NETWORK_TIMEOUT", status: 502 }],
  ["DDOS_PROTECTION", { code: "KEY_VENUE_TRANSIENT", status: 503 }],
]);

/**
 * Classify a caught key-validation exception into a stable wizard error code +
 * HTTP status. SINGLE source of truth for the wizard's key-entry routes
 * (`create-with-key` and `composite/add-key`, which fed byte-identical inline
 * copies before this was extracted) so the exchange-rejection → user-copy
 * mapping is defined ONCE and can never drift between the single-key and
 * multi-key ("+ Add another key") paths.
 *
 * Accepts the caught value itself (`unknown`), not its message: Phase 140 needs
 * to branch on the error TYPE (see below), which a pre-stringified message
 * destroys. A bare `string` is still accepted and behaves exactly as before.
 *
 * The HTTP status distinguishes client faults (400) from upstream faults
 * (502/503) so dashboards/SLO consumers can tell 'bad key' from
 * 'analytics-service unavailable' (H-0310). The raw message is NEVER returned
 * to the client — callers forward ONLY the returned `code` (H-0305).
 */
export function classifyKeyValidationError(error: unknown): {
  code: WizardErrorCode;
  status: number;
} {
  // ⚠️ Phase 140 / SEAM-04 — TYPE CHECK FIRST, BY DESIGN. This branch MUST stay
  // above the substring cascade below, and it MUST stay a type check.
  //
  // Everything after this point matches on `err.message` text, and the cascade
  // terminates in `{code:"UNKNOWN", status:500}` — the "something went wrong,
  // our team has been notified" dead end. A breaker trip reaching that terminal
  // branch is the DOGFOOD-3-class failure this code exists to kill: during a
  // Railway outage the founder saw an unexplained 500 with no retry affordance.
  //
  // ✅ 140.3-12: the quoted sentence is HISTORY — UNKNOWN no longer claims
  // notification. The terminal is still a dead end worth keeping traffic out of
  // (it now says only that we could not classify the failure), so this branch's
  // ordering requirement is UNCHANGED and this comment is not an invitation to
  // relax it. Honest copy at the terminal is not a substitute for not landing
  // on the terminal.
  //
  // Never replace this with a substring match on the word c-i-r-c-u-i-t
  // (research Pitfall 2 names that as the warning sign; it is spelled out here
  // so the acceptance grep that forbids such a branch cannot be tripped by this
  // very comment). The breaker's message is our own static
  // string today, so a substring branch looks equivalent — but it is
  // simultaneously too narrow (any reword silently re-opens the cascade) and
  // too broad (an unrelated upstream string containing the word would be
  // mislabelled as an outage). It would also lose to whichever earlier branch
  // the message happened to collide with, since ordering, not specificity,
  // decides the substring cascade.
  if (error instanceof CircuitOpenError) {
    return { code: "SERVICE_UNAVAILABLE_RETRY", status: 503 };
  }

  // ⚠️ Phase 140.3-05 / TS-35 — THE MACHINE CODE, READ BEFORE THE MESSAGE IS
  // SNIFFED. Position is load-bearing in both directions: BELOW the type check
  // (a `CircuitOpenError` carries no wire body, and the breaker verdict must
  // never be decided by anything an upstream can set), and ABOVE the cascade
  // (otherwise a message that happens to collide with an earlier substring
  // branch keeps winning, which is exactly how DDOS_PROTECTION was rendering as
  // KEY_IP_ALLOWLIST).
  //
  // A PLAIN OWN DATA PROPERTY, READ WITH `typeof` — NOT `instanceof`. Sixteen
  // route test files `vi.mock("@/lib/analytics-client")` wholesale, so
  // `AnalyticsUpstreamError` is `undefined` inside those suites and an
  // `instanceof` here would throw from inside a catch block. `seamCode` is an
  // own property assigned in that class's constructor (140.3-01), so this read
  // survives every mock shape and simply answers `undefined` when the thrower
  // was not the seam client. The cast is to an optional-property shape, never
  // to the class.
  const seamCode = (error as { seamCode?: unknown } | null | undefined)
    ?.seamCode;
  if (typeof seamCode === "string") {
    const verdict = VENUE_WIRE_CODE_TO_VERDICT.get(seamCode);
    // No `??` fallback here BY DESIGN: an unrecognised wire code must fall
    // through to the cascade below rather than short-circuit to UNKNOWN, so a
    // venue code minted after this table was written still gets whatever the
    // human string can earn it.
    if (verdict !== undefined) return verdict;
  }

  // `String(error)` keeps the classifier TOTAL: `throw {…}` / `throw undefined`
  // are legal JS, and a second throw from inside a catch block would surface as
  // an unhandled 500 rather than a classified response. Both fall through to
  // UNKNOWN, which is the correct answer for an unrecognised throw.
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("signature") || lower.includes("invalid secret")) {
    // Client supplied a wrong secret — their fault, 400.
    return { code: "KEY_INVALID_SIGNATURE", status: 400 };
  }
  if (
    // DOGFOOD (2026-07-18): the exchange AUTHENTICATED the request and rejected
    // the whole credential pair — the worker maps this to a stable
    // "Authentication failed. Check your API key and secret." detail
    // (services/exchange.py AUTH_FAILED arm; e.g. Deribit error 13004
    // invalid_credentials, testnet:false). Pre-fix this matched NONE of the
    // branches and fell through to the terminal UNKNOWN 500 ("something went
    // wrong, team notified"), hiding a plain wrong-key from the founder. Client
    // fault (bad/regenerated/whitespace-mangled key) → 400 with actionable
    // copy — NOT KEY_INVALID_SIGNATURE, whose copy falsely asserts "the key was
    // accepted, only the signature was wrong". Kept AFTER the signature branch
    // so a true signature mismatch keeps its more specific code.
    lower.includes("authentication failed") ||
    lower.includes("invalid_credentials")
  ) {
    return { code: "KEY_AUTH_FAILED", status: 400 };
  }
  // Phase 135 / MT5SRC-02: the worker emits MT5_MASTER_PASSWORD_DETAIL
  // ("MT5 master password detected …") and MT5_WRONG_SERVER_DETAIL
  // ("Broker server not found …") from services/closed_sets.py. Kept AFTER the
  // KEY_AUTH_FAILED branch and BEFORE the ip/allow branch. Collision invariant
  // (re-run if EITHER side is reworded): neither worker string contains
  // "signature", "invalid secret", "authentication failed", "invalid_credentials",
  // "ip"+"allow", "rate", "429", "timeout", "etimedout", "could not verify",
  // "permission scope", "probe", "trading", or "withdraw" — so no earlier or
  // later branch shadows these, and these do not shadow any of those. Both are
  // client faults (fixable by the user) → 400. The raw message is still never
  // returned to the client (H-0305) — only the code.
  if (lower.includes("master password")) {
    return { code: "KEY_MT5_MASTER_PASSWORD", status: 400 };
  }
  if (lower.includes("broker server")) {
    return { code: "KEY_MT5_WRONG_SERVER", status: 400 };
  }
  if (lower.includes("ip") && lower.includes("allow")) {
    // Exchange IP-allowlist rejection — upstream policy, 502.
    return { code: "KEY_IP_ALLOWLIST", status: 502 };
  }
  if (lower.includes("rate") || lower.includes("429")) {
    // Exchange or Railway rate-limit — upstream throttle, 503.
    return { code: "KEY_RATE_LIMIT", status: 503 };
  }
  if (lower.includes("timeout") || lower.includes("etimedout")) {
    // Network timeout reaching analytics-service — upstream unavailable, 502.
    return { code: "KEY_NETWORK_TIMEOUT", status: 502 };
  }
  if (
    // FIX 3 facet b (Phase 110.1 / DOGFOOD-3): the Python probe fail-closed
    // ("Could not verify the key's permission scopes…") is a TRANSIENT upstream
    // blip, not a client fault or a terminal 500. Map to a retryable 5xx with a
    // retry-flavored code so the wizard offers a clear-and-retry path.
    lower.includes("could not verify") ||
    lower.includes("permission scope") ||
    lower.includes("probe")
  ) {
    return { code: "KEY_PROBE_FAILED", status: 503 };
  }
  if (lower.includes("trading") || lower.includes("withdraw")) {
    // Should have been caught by the read_only check upstream; defensive 400.
    return { code: "KEY_HAS_TRADING_PERMS", status: 400 };
  }
  return { code: "UNKNOWN", status: 500 };
}

/**
 * Phase 140.3-01 / TS-09 — the RECOGNITION BRANCH for a seam machine code.
 *
 * Maps a stable `code` read off a seam error body (via
 * `seamErrorCode` in the dependency-free `@/lib/seam-discriminator` leaf — never
 * a second, hand-rolled extractor) onto the wizard code that renders it.
 *
 * WHY A `Map` AND NOT A `Record`. The code arrives OVER THE WIRE. A plain-object
 * index would resolve `"constructor"`, `"toString"` and `"__proto__"` to
 * inherited members, and `lookup[code] ?? "UNKNOWN"` would then return a
 * Function typed as a `WizardErrorCode`. A `Map` has no such inherited keys.
 *
 * WHY THE TABLE IS EXPLICIT RATHER THAN AN IDENTITY. A seam code and a wizard
 * code are different vocabularies that happen to agree on these two names
 * today. `SEAM_DEGRADED`, `MT5_GATEWAY_UNREACHABLE` and the venue codes have no
 * wizard member and correctly answer `UNKNOWN`; writing the mapping as
 * `code as WizardErrorCode` would silently admit every one of them.
 *
 * ⚠️ 140.3-05 / SEAMUX-01 — THE ONE DECISION ABOUT `CIRCUIT_OPEN`. Three
 * production sites answer a breaker trip with the WIRE code `CIRCUIT_OPEN`
 * (`strategies/finalize-wizard`, `keys/[id]/permissions`, and
 * `process-key-client`'s forwarded 503). `CIRCUIT_OPEN` is deliberately NOT
 * added to `WizardErrorCode`: `SERVICE_UNAVAILABLE_RETRY` already IS the wizard
 * member for "the breaker is open, we declined to try, nothing was submitted",
 * and minting a second member with the same meaning is how a vocabulary starts
 * lying. It is an ALIAS, recorded here, in the ONE table — never a second local
 * one at a consumer.
 *
 * The same reasoning admits `process-key-client`'s two transport codes. Those
 * three wire codes are the complete set of non-`WizardErrorCode` codes that
 * `finalize-wizard` can put in front of a user today; every one of them landed
 * on UNKNOWN's "our team has been notified" before this entry existed.
 * (140.3-12 removed that sentence from UNKNOWN, so the phrase above is a
 * historical citation. The aliasing still matters for the same reason: an
 * honest generic terminal is still a terminal, and these codes deserve their
 * own specific, true copy rather than the one that admits knowing nothing.)
 * (`draft_state_invalid` and `COMPOSITE_UNSUPPORTED_UNIFIED` also reach
 * SubmitStep without a wizard member — both are deliberately out of scope here
 * and are recorded in the TS-35 ledger row, NOT silently absorbed.)
 *
 * ⚠️ SCOPE. TS-09's type half landed in 140.3-01. `classifyKeyValidationError`'s
 * cascade must still NOT be deleted until every emitter carries a code, or the
 * class re-opens from the other side.
 */
const SEAM_CODE_TO_WIZARD_CODE: ReadonlyMap<string, WizardErrorCode> = new Map<
  string,
  WizardErrorCode
>([
  ["VALIDATION_FAILED", "VALIDATION_FAILED"],
  ["RATE_LIMITED", "RATE_LIMITED"],
  ["CIRCUIT_OPEN", "SERVICE_UNAVAILABLE_RETRY"],
  ["UPSTREAM_TIMEOUT", "SERVICE_UNREACHABLE"],
  ["UPSTREAM_NETWORK_ERROR", "SERVICE_UNREACHABLE"],
]);

export function recogniseSeamErrorCode(
  seamCode: string | null | undefined,
): WizardErrorCode {
  if (typeof seamCode !== "string") return "UNKNOWN";
  return SEAM_CODE_TO_WIZARD_CODE.get(seamCode) ?? "UNKNOWN";
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
