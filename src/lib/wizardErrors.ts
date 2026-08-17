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
// `import "server-only"` directive at the top of `src/lib/analytics.ts`.)
//
// The leaf path is also the only one that survives the test suite: EVERY ROUTE
// TEST THAT MOCKS A SEAM CLIENT WHOLESALE `vi.mock("@/lib/analytics-client")`
// with a BARE factory, so a class reached through that re-export would be
// `undefined` at runtime and the `instanceof` below would throw from inside a
// catch block. Nothing mocks the leaf.
//
// ⚠️ 140.5-02 / SEAMPROSE-04 — THE BARE INTEGER THAT USED TO SIT HERE IS GONE,
// NOT CORRECTED, and this note is why nobody should put one back. The
// population it counted measures 26 raw, 23 comment-stripped, 15 restricted to
// `src/app/api/**` route tests, 16 once the route test living outside that tree
// is included, and 19 with the csv-finalize suites — five predicates, five
// answers, and the number that stood here was defensible under exactly one of
// them. Replacing one bare integer with another is how this file would keep
// lying with a different number, so the PREDICATE is named instead of a count.
import { CircuitOpenError } from "@/lib/seam-errors";
// 153.1-03 / WIZFORM-03 — SAFE UNDER THE LOAD-BEARING IMPORT RULE ABOVE, and
// here is the check rather than the assurance. `closed-sets.ts` imports exactly
// one module (`zod`), declares no `import "server-only"`, and its only
// module-load env reads are the three build-inlined `NEXT_PUBLIC_*` flags
// (`:226` SFOX, `:249` SMOOTHED_MTM, `:275` MT5); the two non-public reads
// (`SFOX_ENABLED :302`, `MT5_ENABLED :330`) sit INSIDE functions and never run
// at module load. `MetadataStep.tsx`'s own value-import of `@/lib/closed-sets`
// (it reads `MAGNITUDE_CAPS` and `isCryptoExchange` from it) already pulls this
// module into the same wizard bundle, so this adds no new bytes to the browser
// payload.
// The prohibition above targets `@upstash/*` and the top-level
// `Redis.fromEnv()` singleton reachable through `@/lib/analytics-client` and
// `@/lib/resilient-fetch`; neither is reachable from here.
// [VERIFIED at 413d124f — re-verify the four claims above before landing any
// further import into this file.]
// 153.1-04 / D-23 — `MAGNITUDE_CAPS` joins the SAME import for the same
// reason. The description bounds named in the copy below are read from the one
// constant the server arm and the field guards read; a bound typed as a literal
// into a sentence is how the client came to promise a rule the server did not
// enforce (the three-failed-submit incident).
import { MAGNITUDE_CAPS, venueIsSubstitutable } from "./closed-sets";

export type WizardErrorCode =
  // Key validation (ConnectKeyStep)
  | "KEY_HAS_TRADING_PERMS"
  | "KEY_HAS_WITHDRAW_PERMS"
  // 140.5-02 / SEAMPROSE-03 — two wire codes that had no honest verdict.
  //   KEY_MISSING_READ_SCOPE = the exchange authenticated the key and reported
  //     that a REQUIRED READ scope is absent. Distinct from KEY_NOT_READ_ONLY
  //     (which is "we could not confirm read-only and observed no write scope")
  //     and from KEY_HAS_TRADING_PERMS (which is a write grant we DID observe):
  //     here the key is too NARROW, not too broad, and the remedy is the
  //     opposite one — grant a scope rather than remove one. It rendered
  //     UNKNOWN/500 for a plainly fixable Deribit key scope.
  //   KEY_PERMISSION_DENIED = the exchange refused the request on permission
  //     grounds and named TWO possible causes in one sentence (scope OR IP
  //     allowlist). It rendered 502 KEY_IP_ALLOWLIST — a SERVER status for a
  //     CALLER fault, asserting one of the two causes as if it were observed.
  //     This member exists so the copy can name both without picking one; that
  //     is the same DOGFOOD-3 discipline KEY_NOT_READ_ONLY was minted under.
  | "KEY_MISSING_READ_SCOPE"
  | "KEY_PERMISSION_DENIED"
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
  // Phase 142.2 / MT5-04 (D-05) — THE FOUR CAUSES `KEY_INVALID_FORMAT` USED TO
  // SWALLOW. The two wizard connect routes (`strategies/create-with-key` and
  // `strategies/composite/add-key`) answered ONE code at TWELVE guards each —
  // malformed body, unsupported venue, missing api_key, the two venue server
  // gates, two missing-secret arms, a missing OKX passphrase, a missing session
  // id, and three length caps — and every one of them rendered "This does not
  // look like a valid API key for the selected exchange" with Binance hex-length
  // advice. A founder who submitted a COMPLETE MT5 form, with no format problem
  // anywhere in it, was told their key format was wrong.
  //
  // ⚠️ THE VALUE IS IN THE CLASS, NOT THE INSTANCE. The arm the founder actually
  // hit (the MT5 server gate) became unreachable the moment MT5-01 turned the
  // server-side switch on, so a fix aimed at that ONE line would repair
  // something that can no longer fire while eleven siblings kept lying.
  //
  //   KEY_MISSING_REQUIRED_FIELD — a field the form requires arrived empty, or
  //     the body was not a readable object. Five of the twelve guards.
  //   KEY_UNSUPPORTED_VENUE — the exchange named is not one we support at all.
  //     A permanent property of the VENUE, not of the credential.
  //   KEY_VENUE_NOT_ENABLED — we support the venue but it is not open here yet.
  //     Distinct from the above on purpose: "never" and "not yet" have
  //     different remedies, and collapsing them tells a user to abandon a venue
  //     that is coming.
  //   KEY_INPUT_TOO_LONG — a value exceeded its maximum length. The three cap
  //     guards.
  //
  // `KEY_INVALID_FORMAT` keeps exactly ONE emitter per route — the
  // `api_secret.length < 8` check on the ccxt venues — which is the only one of
  // the twelve that was ever a format failure, and which makes its existing copy
  // true again.
  | "KEY_MISSING_REQUIRED_FIELD"
  | "KEY_UNSUPPORTED_VENUE"
  | "KEY_VENUE_NOT_ENABLED"
  | "KEY_INPUT_TOO_LONG"
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
  // MT5-13 — the permanent sibling of KEY_NETWORK_TIMEOUT. Both mean "the live
  // scope re-check at finalize did not produce an answer", but this one means it
  // will not produce one on a retry either: the venue has no probe adapter, the
  // key row carries no exchange, the key id is unknown, our internal token is
  // misconfigured. Splitting them is the whole point — the timeout copy's Retry
  // control was the only affordance offered for a condition retries cannot clear.
  | "KEY_SCOPE_CHECK_UNAVAILABLE"
  // 153.6-06 / PARITY-05 — the TRANSIENT sibling of the code directly above,
  // and it is split off that one rather than off KEY_NETWORK_TIMEOUT.
  //
  // What it means: the finalize probe answered 2xx and our zod schema could not
  // read the body. What made MT5-13 classify that as permanent was the sentence
  // "the body stays unreadable until a deploy changes one side or the other" —
  // true, and satisfied by the deploy that is ALREADY ROLLING. During an
  // analytics release the old and new pods answer different shapes for a few
  // minutes, so this condition clears by itself.
  //
  // Why it is not KEY_SCOPE_CHECK_UNAVAILABLE: that code's copy suppresses the
  // Retry control STRUCTURALLY (it holds no member of RECOVERABLE_ACTIONS), and
  // it must keep doing so for the probe-STATUS arm, where a retry genuinely
  // cannot win. Adding a recoverable action there instead of minting this member
  // would have handed a Retry to both — the affordance leaking onto the arm that
  // must not have it. ⛔ And never back to KEY_NETWORK_TIMEOUT: "we could not
  // reach the exchange" is the lie 153.2-04 removed, and the exchange answered.
  | "KEY_SCOPE_CHECK_UNREADABLE"
  | "KEY_SCOPE_BROADENED"
  | "DRAFT_ALREADY_EXISTS"
  // 154.1 / WIZCONT-02 review CR — THE HALF OF THE VENUE FENCE THAT HAD NO
  // HONEST ANSWER, split off `DRAFT_ALREADY_EXISTS` for the same reason every
  // split above was made: the incumbent sentence is FALSE here, and specifically
  // false in a way the user can check.
  //
  // `DRAFT_ALREADY_EXISTS` says "A draft strategy with the same API key is
  // already in progress" and offers `resume_draft` / `start_fresh`. When a
  // re-connect's venue identity resolves onto a strategy that has already LEFT
  // the draft state (`pending_review`, `published`, `archived`), every clause of
  // that is wrong: there is no draft, nothing is in progress, there is nothing
  // to resume, and `start_fresh` — the other control offered — would delete a
  // draft that does not exist. The user is told to go and find a session that is
  // not there.
  //
  // ⛔ NOT `DRAFT_STATE_INVALID` either, and the distinction is the same one
  // that entry's own docblock draws for itself: that code means "THIS page is
  // stale, your draft moved on, reload". Here the caller has no draft and no
  // stale page — they typed live credentials into a fresh wizard and the account
  // behind them is already spoken for. Its remedy (`leave_and_return`) would
  // send them back to a draft that does not exist.
  //
  // ⚠️ NON-RECOVERABLE BY CONSTRUCTION — `actions` holds neither member of
  // `RECOVERABLE_ACTIONS`, so `buildEnvelope` derives `recoverable: false` and no
  // Retry renders. That is the point rather than an omission: resubmitting the
  // same account is refused identically, so a Retry control here could only ever
  // fail again. Same reading `COMPOSITE_TOO_MANY_MEMBERS` and `SEAM_MISCONFIGURED`
  // are authored under.
  | "VENUE_ALREADY_CONNECTED"
  // Sync + gate (SyncPreviewStep) — these wrap strategyGate.ts codes
  | "SYNC_TIMEOUT"
  | "SYNC_FAILED"
  | "GATE_INSUFFICIENT_TRADES"
  | "GATE_INSUFFICIENT_DAYS"
  | "GATE_ANALYTICS_FAILED"
  | "GATE_NO_DATA_SOURCE"
  // 142.2 review FIX 1 — a daily-return series exists but nothing recorded how
  // it was built. Distinct from GATE_INSUFFICIENT_TRADES on purpose: the
  // strategy is not short of trades, it is short of PROVENANCE, and its remedy
  // is a re-sync rather than a different key.
  | "GATE_SERIES_PROVENANCE_UNVERIFIED"
  // Metadata step (MetadataStep) — Phase 53 / APPLY-02 inline per-field
  // validation. Copy lives here (the canonical wizard-copy home) so the
  // component never carries an invented inline string (copy-drift guard).
  | "METADATA_DESCRIPTION_REQUIRED"
  // 153.1-04 / WIZFORM-02 — the seven FIELD-LEVEL refusals `validatePayload`
  // makes in `finalize-wizard/route.ts`. Each one names a field the user typed
  // or picked, so 153.2 can route the message back to that field instead of
  // rendering a terminal envelope over a form the user can still fix.
  //
  // ⚠️ A member is minted here ONLY where a field-level message must reach a
  // SPECIFIC field. The route's three non-field arms (malformed body, a
  // non-UUID strategy_id, an out-of-set entry_context — none of them ever
  // user-typed) keep `VALIDATION_FAILED`: minting a member per arm inflates
  // the vocabulary, which is the failure `SEAM_CODE_TO_WIZARD_CODE`'s docblock
  // warns about.
  //
  // ⛔ NONE of the seven is recoverable — see the copy entries. Resubmitting an
  // identical payload is refused identically; the remedy is on the form.
  | "METADATA_NAME_INVALID"
  | "METADATA_DESCRIPTION_TOO_SHORT"
  | "METADATA_DESCRIPTION_TOO_LONG"
  | "METADATA_CATEGORY_REQUIRED"
  | "METADATA_AUM_INVALID"
  | "METADATA_CAPACITY_INVALID"
  | "METADATA_CAPITAL_OWNERSHIP_INVALID"
  // Wizard lifecycle
  | "SESSION_EXPIRED"
  | "SUBMIT_NOTIFY_FAILED"
  // H-0192: finalize-wizard 404 (draft deleted/expired) and 403/409
  // (not in a finalizable state) used to collapse to UNKNOWN at SubmitStep.
  | "GATE_DRAFT_GONE"
  | "GUARD_BLOCKED"
  // 153.1-04 / WIZFORM-02 (RESEARCH Finding 4) — THE SECOND LIVE `UNKNOWN`.
  //
  // The `error.code === "22023"` arm in `finalize-wizard/route.ts` — the 409
  // the finalize RPC's invalid-parameter raise lands on — already carried this
  // discriminator, but as the LOWERCASE literal `draft_state_invalid`, so
  // nothing matched a wizard member and SubmitStep rendered UNKNOWN. This mints the UPPER_SNAKE
  // member and its copy ONLY; 153.1-05 uppercases the route's literal in the
  // same commit the code starts being a wizard member, which is the point at
  // which the two halves become one honest classification.
  //
  // ⚠️ NOT `GUARD_BLOCKED` and NOT `GATE_DRAFT_GONE`, and each would assert
  // something false: `GUARD_BLOCKED` is the 42501 arm ("you do not have access
  // to this") and `GATE_DRAFT_GONE` says the draft is not there at all. This
  // draft exists, is the caller's, and has simply MOVED ON.
  | "DRAFT_STATE_INVALID"
  // 153.7-03 / WIZFORM-02-CLASS — TWO OF THE THREE `finalize-wizard`
  // REJECTIONS THAT ANSWERED WITH NO CODE AT ALL. Both were recorded as known
  // debt by 153.1-06's ledger and both are fixed here; the third
  // (`SEAM_RESPONSE_UNREADABLE`) sits with the seam family below because its
  // fault is the seam's, not the draft's.
  //
  // ⭐ `DRAFT_LOOKUP_FAILED` IS NOT A NEW NAME — it is the token this repo
  // already uses for exactly this fact. `keys/sync`'s draft-read split minted
  // it, and its own comment records that it copied the template from THIS
  // route's `wizard_session_id` draft read. `verify-strategy` states the rule
  // when it mints `VERIFY_PERSIST_FAILED` on that precedent: same fact ⇒ same
  // token. Minting a second name for one fact is how a vocabulary starts lying,
  // so this member adopts the existing token and gives it copy.
  //
  // WHAT EACH ONE MAY CLAIM, measured at its own arm rather than shared:
  //   · `DRAFT_LOOKUP_FAILED` — the arm is a `.maybeSingle()` SELECT that
  //     errored, and nothing in the handler writes before it (no `.insert`,
  //     `.update`, `.upsert`, `.delete` or `.rpc` precedes it). "Nothing was
  //     submitted and nothing was changed" is a fact about a read, so it is
  //     knowable in the way 140.3-15 requires and the CSV case lacked.
  //   · `DRAFT_FINALIZE_FAILED` — the GENERIC tail of the finalize RPC's error
  //     branch, reached only after P0002/02000, 42501 and 22023 have been split
  //     off. That residue holds two different worlds: a SQL raise (Postgres
  //     rolled the SECURITY DEFINER transaction back, so nothing landed) and a
  //     transport failure reaching PostgREST (the write MAY have landed). So
  //     this copy must NOT say nothing was saved — it says we cannot confirm,
  //     which is true in both worlds.
  //
  // ⚠️ NOT `DRAFT_STATE_INVALID` for either, and it would assert something
  // false: that member says the draft MOVED ON — a fact the 22023 arm above
  // establishes by reading the RPC's own SQLSTATE. Neither of these two knows
  // anything about the draft's state; one could not read it and the other could
  // not finish writing it.
  | "DRAFT_LOOKUP_FAILED"
  // RECOVERABLE, deliberately, and on the opposite mechanism to the members
  // above it: `clear_and_retry` IS a member of `RECOVERABLE_ACTIONS`
  // (src/lib/envelope.ts), so `buildEnvelope` derives `recoverable: true` and
  // the Retry control renders. A retry here can WIN — the common causes are a
  // pool blip, a deadlock and a serialization failure — and a retry cannot
  // HARM, because `finalize_wizard_strategy` is state-guarded: run a second
  // time against a draft that already finalized it raises 22023, which the arm
  // above answers as `DRAFT_STATE_INVALID` rather than creating a second
  // strategy. Both halves are why the control is offered.
  | "DRAFT_FINALIZE_FAILED"
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
  // Phase 140.3-14 / TS-37 — the composite MEMBER CAP, split off the code above.
  //
  // ⚠️ THE SPLIT IS THE POINT, AND IT IS ONE ARM OF FOUR. `finalize-wizard`
  // emits `COMPOSITE_MEMBERSHIP_UNKNOWN` at four sites. THREE are genuinely
  // transient member-list reads (the hoist's membership-count probe, the
  // member-list read, and the unified arm's probe) and KEEP that code and its
  // retry. The FOURTH — the `members.length > MAX_COMPOSITE_MEMBERS` refusal —
  // is PERMANENT: the draft really does hold more keys than the route can
  // re-probe, and no amount of retrying changes the count. It shipped wearing
  // the transient envelope byte-identically, so the user got a Retry control
  // that could only ever fail again, with no explanation and no path forward.
  //
  // NOT recoverable, deliberately: `actions` carries no `clear_and_retry` and no
  // `try_another_key`, so `RECOVERABLE_ACTIONS` derives `recoverable: false` and
  // `ErrorEnvelope` renders NO Retry control. That is the fix, not a side
  // effect — the whole defect was a retry affordance on a condition retrying
  // cannot clear.
  //
  // The copy names the LIMIT WITH ITS NUMBER (DESIGN.md §Voice: state the
  // limitation with its threshold attached) and the remedy (remove keys). The
  // number is pinned cross-file to `MAX_COMPOSITE_MEMBERS` in
  // `finalize-wizard/route.ts` by a test that reads the route's own declaration,
  // so the sentence cannot drift away from the constant it describes.
  | "COMPOSITE_TOO_MANY_MEMBERS"
  // 153.1-04 / WIZFORM-02 (RESEARCH Finding 4) — A LIVE `UNKNOWN`, closed.
  //
  // The unified arm's composite-rejection emitter in
  // `finalize-wizard/route.ts` (the one site that answers this code) has been
  // emitting it all along; it simply had no member here, so SubmitStep rendered
  // the "we could not classify this failure" card for a failure the server
  // classified precisely. WIZFORM-02's
  // criterion covers it by its own words. The alias-table docblock further down
  // used to record it as out of scope — that sentence is gone, because the
  // premise it rested on is.
  //
  // ⛔ NOT an alias in `SEAM_CODE_TO_WIZARD_CODE`. That table translates WIRE
  // codes emitted by another service; this one is minted by our own route, so
  // it is a wizard member outright.
  | "COMPOSITE_UNSUPPORTED_UNIFIED"
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
  // Phase 140.3-15 / TS-38 — a CONFIGURATION fault on OUR side, caught before
  // the request was ever issued. `resilient-fetch` raises `SeamConfigError`
  // ABOVE its classification window ("before any store or network I/O"), so
  // nothing was sent, the breaker correctly hears nothing, and Railway is fine.
  // Until this member existed the fault took `process-key-client`'s
  // `UPSTREAM_NETWORK_ERROR` 502 arm and told the user we could not reach the
  // ingestion service — a false claim about whose fault it is, with a Retry
  // control that could never succeed.
  //
  // ⚠️ NOT A DUPLICATE OF ANY OF THE THREE NEAR-MISSES, and each of them
  // asserts something FALSE here — which is why an alias was rejected:
  //   · SERVICE_UNREACHABLE — "We sent the request and never got an answer."
  //     No request was sent. It is also recoverable; this is not.
  //   · SERVICE_UNAVAILABLE_RETRY — "wait a moment, then try the same action
  //     again." True of a breaker cooling down, false of a config typo: waiting
  //     changes nothing until we fix it and redeploy.
  //   · VALIDATION_FAILED — "a request that failed its shape check." Closest on
  //     BEHAVIOUR (non-recoverable, our software's fault) and wrong on the
  //     FACT: nothing was sent and nothing was shape-checked.
  //
  // NOT recoverable, deliberately: `actions` carries neither member of
  // `RECOVERABLE_ACTIONS` (src/lib/envelope.ts), so `buildEnvelope` derives
  // `recoverable: false` and `ErrorEnvelope` renders NO Retry control. The
  // absence IS the fix, on the same mechanism `COMPOSITE_TOO_MANY_MEMBERS` uses.
  | "SEAM_MISCONFIGURED"
  // Phase 153.7-02 / WIZFORM-02-CLASS — a PERMANENT fault in our own service
  // that stopped a key check, where the more precise `SEAM_MISCONFIGURED` above
  // would assert something measurably false at the emitter.
  //
  // ⭐ IT WAS MINTED ONLY AFTER THE FOUR CANDIDATES WERE MEASURED PER EMITTER,
  // and the rule that picked it is stated so the next author can re-run it: take
  // the MOST SPECIFIC member every one of whose claims is true at EVERY emitter
  // that can reach `classifyKeyValidationError`. Three wire codes have no such
  // member:
  //   · `INTERNAL` — `validate_key`'s generic escape from
  //     `validate_key_permissions`. The venue probe HAD been issued, so
  //     `SEAM_MISCONFIGURED`'s "we stopped before sending the request" is
  //     false-by-construction; and it is `retryable=False`, so
  //     `KEY_PROBE_FAILED`'s "a transient upstream issue" is false too — and
  //     that member is recoverable, so it would render a Retry control against a
  //     fault that fails identically every time.
  //   · `ADAPTER_INIT_FAILED` — `create_exchange` raising. Nothing was sent (the
  //     emitter measures that itself: a dict lookup, a dict build and two
  //     attribute sets, zero network I/O), but the cause is a ccxt signature
  //     change, a missing extra or an OOM. "Our own configuration is wrong" names
  //     the wrong thing.
  //   · `MT5_GATEWAY_UNCONFIGURED` — four emitters. Three fire before the gateway
  //     is contacted at all, but the D-31 `undetermined` arm in
  //     `_validate_mt5_key_probe` fires AFTER the terminal ran and refused to
  //     classify, so "we stopped before sending the request" is false at one of
  //     the four. A member that is true at three of four emitters is exactly the
  //     shape this milestone exists to stop shipping.
  //
  // WHAT IT DELIBERATELY DOES NOT SAY. It makes no claim about WHERE the fault
  // stopped us, because that is the clause that differs across the three codes.
  // It claims only what is true at all of them: the fault is ours, the check did
  // not complete, no key was stored, and retrying re-runs the same fault.
  //
  // ⚠️ NOT A DUPLICATE OF THE NEAR-MISSES:
  //   · SEAM_MISCONFIGURED — narrower and still correct where it applies; this
  //     phase keeps it for `EGRESS_PROXY_MISCONFIGURED`, `SERVICE_KEY_UNCONFIGURED`
  //     and `KEK_UNAVAILABLE`, whose emitters DO fire before any outbound request
  //     and before any state change. Do not collapse the two.
  //   · SEAM_DEADLINE_EXCEEDED — our budget expired. Here the work FAILED; no
  //     deadline was involved.
  //   · UNKNOWN — "we could not classify this failure". The server classified it
  //     precisely; rendering UNKNOWN for it is the defect being closed.
  //
  // NOT recoverable, deliberately: `actions` carries neither member of
  // `RECOVERABLE_ACTIONS` (src/lib/envelope.ts), so `buildEnvelope` derives
  // `recoverable: false` and `ErrorEnvelope` renders NO Retry control — the same
  // mechanism `SEAM_MISCONFIGURED` and `ALLOCATION_NOT_ALLOCATABLE` use. All
  // three wire codes it homes are `retryable=False` at their emitters.
  | "SEAM_INTERNAL_FAULT"
  // 153.7-03 / WIZFORM-02-CLASS — the THIRD code-less `finalize-wizard`
  // rejection, and the only one of the three whose outcome is genuinely
  // unknowable. The unified arm's upstream answered **2xx** with a body that
  // fails `isProcessKeyOnboardResponse`, so the submission was ACCEPTED and we
  // cannot read what was done with it. A partial deploy, a field rename or a
  // proxy that strips the body all produce it.
  //
  // ⭐ THE COPY'S HARDEST CONSTRAINT IS WHAT IT MAY NOT SAY. Every other member
  // near it can state whether anything was saved; this one cannot, in either
  // direction. "Nothing was saved" is false whenever the onboard really did
  // land, and "it went through" is a guess about a body we could not parse. The
  // entry therefore claims only what the 2xx establishes — the submission
  // reached the service — and sends the user to the one place that settles it.
  //
  // ⚠️ AND IT MAY NOT PROMISE DEDUPE. `CSV_SUBMIT_NO_STRATEGY_ID` can say a
  // resubmit resolves to the strategy that already exists, because the partial
  // unique index behind that promise is predicated on a NON-NULL wizard session
  // id and the CSV path always writes one. This arm forwards the id with a
  // CONDITIONAL SPREAD — a draft carrying none sends no id at all — so the
  // promise would be true for most users and silently false for the rest. That
  // is the exact shape 140.4-03 recorded when this guarantee was published
  // before the mechanism could keep it.
  //
  // NOT recoverable, deliberately: `actions` carries neither member of
  // `RECOVERABLE_ACTIONS` (src/lib/envelope.ts), so no Retry control renders.
  // ⛔ THE ABSENCE IS THE POINT and it is NOT the usual reason. Retrying is not
  // futile here — it is UNPREDICTABLE, because neither we nor the user knows
  // what the first submission did. A one-click Retry on an unconfirmed submit
  // is a control whose effect the person pressing it cannot foresee, so the
  // remedy is ordered instead: look first, then decide.
  //
  // ⚠️ NOT `SEAM_INTERNAL_FAULT` above and NOT `KEY_SCOPE_CHECK_UNREADABLE`,
  // and each asserts something false: `SEAM_INTERNAL_FAULT` says the check
  // never completed and no key was stored — here a whole onboarding may have
  // completed; `KEY_SCOPE_CHECK_UNREADABLE` is about the pre-publish permission
  // probe, a read whose failure changes nothing.
  | "SEAM_RESPONSE_UNREADABLE"
  // 153.1-04 / UI-SPEC Gate A — the answer did not arrive inside the time WE
  // granted. Distinguishable client-side: our own abort fired and no transport
  // error was observed, so this is OUR deadline expiring, not the broker
  // refusing and not the network dropping.
  //
  // ⚠️ NOT `SERVICE_UNREACHABLE` and NOT `KEY_NETWORK_TIMEOUT`, and both would
  // assert something we did not observe: `SERVICE_UNREACHABLE` says we never
  // got an answer (we stopped listening), and `KEY_NETWORK_TIMEOUT` points at
  // the venue's responsiveness when what actually happened is that our own
  // budget was too small for this broker.
  //
  // NOT recoverable, deliberately: `actions` carries neither member of
  // `RECOVERABLE_ACTIONS`, so no Retry control renders. A deadline inversion
  // fails identically on every attempt — the 2026-08-08 panel offered Retry
  // against exactly this, and the founder clicked it five times.
  //
  // ⭐ Phase 153.4 is the CONSUMER (ROADMAP §153.4 Depends-on names this
  // member): it raises the validate-key budget and emits this code when its own
  // deadline fires. The copy is authored here so the member exists before the
  // emitter does — a code with no copy entry falls through to UNKNOWN exactly
  // as a missing code does.
  | "SEAM_DEADLINE_EXCEEDED"
  // Phase 151 review E5/E6 — the allocate surface's ONE actionable refusal.
  //
  // `/api/portfolio-strategies/allocation` answers 409 `not_allocatable` when
  // the strategy is not marked as the caller's own capital: either it never was
  // (every pre-150 row is NULL) or the mark changed between the row rendering
  // its Allocate affordance and the write (MarkOwnershipDialog in another tab —
  // and since E4, the D-03-A trigger firing on the insert reaches the client the
  // same way). `AllocateDialog` read only `res.status === 429` and routed this
  // to UNKNOWN, whose copy "makes no claim about what happened" — so the ONE
  // failure on that surface with a one-screen remedy was the one the user was
  // told nothing about, under a Retry the server refuses identically forever.
  //
  // ⚠️ NOT recoverable, deliberately: `actions` carries neither member of
  // `RECOVERABLE_ACTIONS` (src/lib/envelope.ts), so `buildEnvelope` derives
  // `recoverable: false` and `ErrorEnvelope` renders NO Retry control. That
  // absence IS half the fix — the same mechanism `COMPOSITE_TOO_MANY_MEMBERS`
  // and `SEAM_MISCONFIGURED` use. The remedy is a MARK, not a retry.
  //
  // ⚠️ NOT a duplicate of any near-miss, and each would assert something false:
  //   · GUARD_BLOCKED — "you do not have access to this". The caller DOES own
  //     the strategy; the route's 404 arm is what answers a row that is not
  //     theirs. This is about the row's STATE, not the caller's rights.
  //   · VALIDATION_FAILED — a request-shape rejection. The request is
  //     well-formed; the server understood it exactly and declined.
  //   · UNKNOWN — "we could not classify this failure". We classified it
  //     precisely, which is the whole point.
  | "ALLOCATION_NOT_ALLOCATABLE"
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

/**
 * 153.1-04 — the count-free HEAD of each description-bound title, held once so
 * the table's sentence and the interpolated sentence cannot drift apart.
 *
 * ⚠️ WHY A HEAD RATHER THAN A `{n}` PLACEHOLDER. `charCount` is OPTIONAL, and
 * a title carrying `{n}` renders the literal token when nothing is passed. The
 * table sentence must be TRUE and complete with no number (TRAP-3: a surface
 * must never name a count it was not given, and must never print the machinery
 * either). So the table appends only a full stop, and `formatKeyError`'s arm
 * appends the specific tail. The CSV file-size token declared just above can
 * use the placeholder shape because `CSV_FILE_TOO_LARGE` is emitted from
 * exactly one site that always supplies the size; these two are emitted from a
 * server arm that knows the length and from a client field guard that may not.
 * (That token's identifier is deliberately not spelled out here:
 * `wizardErrors.test.ts` pins its occurrence count in this file at THREE — one
 * declaration plus its two uses — as a receipt that the interpolation machinery
 * is untouched, and prose that names it moves that number for no behavioural
 * reason.)
 *
 * ⛔ The bounds are READ from `MAGNITUDE_CAPS`, never typed as `10` / `5000`
 * (D-23). `MAX_DESCRIPTION_CHARS` is grouped per the Numbers Contract, so 5000
 * reads as "5,000".
 */
const DESCRIPTION_BOUND_TITLE = {
  METADATA_DESCRIPTION_TOO_SHORT: `Add at least ${MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS} characters`,
  // 153.1 review WR-02 — "under N" asserts a ceiling of N-1, and the server
  // does not enforce that: `finalize-wizard` rejects on
  // `description.length > MAX_DESCRIPTION_CHARS` (route.ts), so a description
  // of exactly 5,000 characters is ACCEPTED. The inclusive form is the true
  // one, and it is what the `cause` one field down already says ("longer than
  // the 5,000 characters we store"). The TOO_SHORT sibling needs no such
  // change: `< MIN` rejects, so "at least 10" is exact.
  METADATA_DESCRIPTION_TOO_LONG: `Keep this to ${MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS.toLocaleString(
    "en-US",
  )} characters or fewer`,
} as const;

/**
 * 153.1-04 — the SHARED TAIL of `SEAM_DEADLINE_EXCEEDED`'s cause, held once so
 * the count-free sentence in the table and the budget-naming sentence
 * `formatKeyError` builds cannot drift apart.
 *
 * Same reasoning as `DESCRIPTION_BOUND_TITLE` above: `budgetSeconds` is
 * OPTIONAL, so the table sentence must be complete and true with no number, and
 * only the interpolation arm may name one (TRAP-3).
 */
const DEADLINE_CAUSE_TAIL =
  " Nothing was saved — your key was not stored, and this is not a sign that your key is wrong.";

/**
 * 153.1-03 / WIZFORM-03 — the wizard surface an error was raised on.
 *
 * Named as a closed set rather than a bare string so a bullet cannot be gated
 * on a surface nobody passes: a typo is a COMPILE error at the table, not a
 * bullet that silently never renders.
 */
export type WizardSurface = "connect" | "submit" | "csv" | "allocate";

/**
 * The venue capabilities a `fix[]` bullet may be gated on. ONE member today.
 *
 * Adding a second (153.4 wants `serialized` for the long-wait copy) is one
 * member here plus one entry in `VENUE_CAPABILITY_PREDICATES` — never a new
 * branch inside `formatKeyError`. That is the whole point of this mechanism.
 */
export type VenueCapabilityName = "substitutable";

/**
 * Capability name → the closed-sets PREDICATE that answers it.
 *
 * ⛔ Never index `VENUE_CAPABILITIES` here. The predicates own the per-capability
 * default for an unresolved venue, and that default IS the mechanism (153.1-02);
 * reading a row directly re-invents it per call site.
 */
const VENUE_CAPABILITY_PREDICATES: Record<
  VenueCapabilityName,
  (venue: string | null | undefined) => boolean
> = {
  substitutable: venueIsSubstitutable,
};

/**
 * 153.1-03 / WIZFORM-03 — a precondition a single `fix[]` bullet declares about
 * the CONTEXT it is rendered in. One filter reads these (`applyFixRequirements`
 * below); no code branch does.
 *
 * D-17's class: "a remedy that presupposes a fact about the context". Telling an
 * MT5 user to "switch to a different exchange" presupposes another venue exists
 * — their account IS the venue, so the remedy is unwinnable. Three bullets said
 * it; one filter now decides for all of them and for every bullet added later.
 *
 * ⛔ Do NOT re-express any of these as a per-code equality arm inside
 * `formatKeyError`. Three such arms are exactly the instance-not-class defect
 * this repo has already paid for (PATTERNS §wizardErrors.ts). The prohibited
 * pattern is deliberately NOT spelled out literally here: the acceptance gate
 * for this plan counts occurrences of it in this file, and prose that writes
 * it out is how a grep guard stops being able to fail.
 *
 * A THIRD requirement kind is an added union member plus one arm in
 * `requirementMet` — never a new call site.
 */
export type FixRequirement =
  | {
      readonly kind: "venueCapability";
      readonly capability: VenueCapabilityName;
      /** The answer the predicate must give for the bullet to render. */
      readonly is: boolean;
    }
  | { readonly kind: "surface"; readonly surface: WizardSurface };

/**
 * "Render only when the venue CAN be substituted" — the incumbent bullets.
 * With no `venue` in context `venueIsSubstitutable` answers `true`, so every
 * caller that predates this field is byte-unchanged.
 */
const REQUIRES_SUBSTITUTABLE_VENUE: FixRequirement = {
  kind: "venueCapability",
  capability: "substitutable",
  is: true,
};

/**
 * "Render only when the venue CANNOT be substituted" — the D-17 replacement.
 *
 * ⭐ This is why the requirement carries a BOOLEAN rather than being a presence
 * test: an MT5 user gets a truthful remedy, not merely a shorter list.
 */
const REQUIRES_NON_SUBSTITUTABLE_VENUE: FixRequirement = {
  kind: "venueCapability",
  capability: "substitutable",
  is: false,
};

/** "Render only on the submit step" — UI-SPEC Gate B. */
const REQUIRES_SUBMIT_SURFACE: FixRequirement = {
  kind: "surface",
  surface: "submit",
};

/**
 * "Render only on the connect step" — UI-SPEC Gate B, 153.1-04.
 *
 * ⭐ ONE CONSTANT, NO NEW BRANCH. Adding a second surface requirement costs a
 * declaration here and an index in one `fixRequires` array; `requirementMet`
 * and `formatKeyError` are byte-unchanged. That is the property 153.1-03 bought
 * and the reason a bullet's precondition is DATA rather than a conditional.
 *
 * ⚠️ Its one user is `SEAM_DEADLINE_EXCEEDED`'s "Your key details are still on
 * this page" bullet, which is a claim about the FORM BEHIND the panel. It is
 * true on the connect step and unverifiable anywhere else, so it is gated —
 * absence suppresses (see `WizardErrorContext.surface`). Phase 153.4 owns
 * passing `surface: "connect"` at the ConnectKeyStep / MultiKeyConnectStep
 * `buildEnvelope` call sites, in the same commit it starts emitting this code.
 */
const REQUIRES_CONNECT_SURFACE: FixRequirement = {
  kind: "surface",
  surface: "connect",
};

export interface WizardErrorCopy {
  title: string;
  /** Single-sentence summary of WHY the error happened. */
  cause: string;
  /** Numbered fix steps. Each step is an imperative sentence. */
  fix: string[];
  /**
   * 153.1-03 / WIZFORM-03 — OPTIONAL, index-aligned to `fix`. `null` at an
   * index means "always render"; ABSENT on an entry means "no bullet in this
   * entry is conditional", and `formatKeyError` then returns the entry object
   * itself, untouched.
   *
   * ⚠️ A PARALLEL ARRAY is the one thing that can silently fall out of step, so
   * `wizardErrors.test.ts` sweeps every tagged entry for
   * `fixRequires.length === fix.length`. Add a bullet, add its slot.
   *
   * ⛔ `fix` stays `string[]`. `buildEnvelope` (in `envelope.ts`) forwards it
   * VERBATIM as the envelope's `debug_context`, and the `debug_context`
   * equality assertion in `WizardErrorEnvelope.test.tsx` compares against it;
   * turning a bullet into an object has a blast radius this phase did not scope.
   */
  fixRequires?: readonly (FixRequirement | null)[];
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

  // 140.5-02 / SEAMPROSE-03. Claude-drafted per DESIGN.md §Voice; founder
  // review owed (CONTEXT §8.1) and named in 140.5-02-SUMMARY.md's `## OPEN`.
  //
  // The real wire sentence this replaces reaching the user as UNKNOWN/500 is
  // `key is missing required scope 'account:read'` — a fact about their key,
  // rendered as "we could not classify this failure". `actions` are
  // `try_another_key`-shaped and the polarity was RE-DERIVED, not copied: the
  // remedy is a DIFFERENT key (or the same key re-scoped and re-pasted), never
  // a retry of the identical credentials, so `clear_and_retry` is deliberately
  // absent — it would render a Retry control that re-fails identically.
  //
  // ⚠️ The scope NAME is not interpolated. It arrives in the wire `detail`,
  // which the classifier never returns to the client (only the code crosses),
  // and inventing a name here would be worse than omitting it.
  KEY_MISSING_READ_SCOPE: {
    title: "This key is missing a read permission we need.",
    cause:
      "The exchange accepted the key and told us a required read scope is not granted on it. The key is too narrow rather than too broad — nothing about it is unsafe, we simply cannot read the account with it.",
    fix: [
      "Open your exchange API Management page and edit this key.",
      "Enable every Read scope, including account and trade history reads. Leave every trading and withdrawal scope off.",
      "Save, then paste the key here again — or create a fresh read-only key with all read scopes enabled.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["try_another_key", "request_call"],
  },

  // 140.5-02 / SEAMPROSE-03. Claude-drafted per DESIGN.md §Voice; founder
  // review owed (CONTEXT §8.1).
  //
  // ⚠️ THIS ENTRY EXISTS TO NAME TWO CAUSES WITHOUT ASSERTING EITHER (TRAP-3).
  // The wire sentence is "Key denied permission. Confirm the key has read-only
  // scope and that your IP allowlist includes our service." — the exchange told
  // us it refused on permission grounds and NOT which of the two it was. Before
  // this entry the `ip` + `allow` substring branch matched that REMEDY sentence
  // and answered `KEY_IP_ALLOWLIST`, whose copy states as fact that the user
  // enabled IP pinning and that our egress is not on their list. On the half of
  // the population where the real cause is scope, that is a specific claim
  // about a setting we never observed, and it sends the user to edit a list
  // that was never the problem.
  //
  // The status moves 502 -> 400 with it: a permission refusal is a CALLER
  // fault, and a 5xx tells every dashboard and SLO consumer that our own
  // service was at fault.
  //
  // The fix list orders the two candidates by base rate — scope first — and
  // says which is which, rather than presenting one as the diagnosis.
  KEY_PERMISSION_DENIED: {
    title: "The exchange refused this key's permissions.",
    cause:
      "The exchange rejected the request on permission grounds without telling us which of two settings caused it: the key may be missing a required read scope, or it may be pinned to an IP allowlist that does not include us. We are not guessing between them.",
    fix: [
      "First, check the key's scopes: every Read scope on, every trading and withdrawal scope off.",
      "Then, if the key is pinned to specific IPs, either remove the restriction or add our egress IPs — see the docs link below.",
      "Save, then paste the key here again.",
    ],
    docsHref: "/security#egress-ips",
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
      // D-17 / Gate C — the truthful replacement for a venue that IS the
      // account. States the truth and invents no remedy.
      "This is your broker account, so there is no other venue to try. If it keeps failing, email security@quantalyze.com with the correlation id below.",
    ],
    // D-17 — bullet 1 presupposes another venue exists; bullet 2 presupposes
    // it does not. ONE filter picks; no code branch names mt5.
    fixRequires: [
      null,
      REQUIRES_SUBSTITUTABLE_VENUE,
      REQUIRES_NON_SUBSTITUTABLE_VENUE,
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

  // ── Phase 142.2 / MT5-04 (D-05) — the four honest causes ──────────────────
  // Each entry names ITS OWN cause and remedy. The bar every one of them has to
  // clear is the one the old bucket failed: a user who reads it must be able to
  // tell what to change. None of them may name an internal switch, a service, or
  // a field the form does not show — the copy is static, so the discipline
  // `scrubSeamError` enforces on derived strings is simply written in here.

  KEY_MISSING_REQUIRED_FIELD: {
    title: "One of the required fields is empty.",
    cause:
      "The form arrived without a value we need — one of the credential fields was blank, or the submission was incomplete. Nothing was sent to the exchange and nothing was stored.",
    fix: [
      "Fill in every field shown for the exchange you selected — the fields differ by exchange, so a slot that is optional elsewhere may be required here.",
      "Submit again once each one has a value.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["clear_and_retry", "request_call"],
  },

  KEY_UNSUPPORTED_VENUE: {
    title: "We do not support that exchange.",
    cause:
      "The exchange named in this submission is not one we can connect to. This is about the venue, not about your key — the same credentials on a supported exchange would be fine.",
    fix: [
      "Pick one of the exchanges shown on this step and connect a key from that account.",
      "If the exchange you need is missing, tell us which one — we prioritise by what people ask for.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["clear_and_retry", "request_call"],
  },

  KEY_VENUE_NOT_ENABLED: {
    // NOT recoverable, deliberately, on the same mechanism `SEAM_MISCONFIGURED`
    // and `COMPOSITE_TOO_MANY_MEMBERS` use: `actions` carries no member of
    // RECOVERABLE_ACTIONS (src/lib/envelope.ts), so `buildEnvelope` derives
    // `recoverable: false` and `ErrorEnvelope` renders NO Retry control.
    // Resubmitting the identical request cannot succeed while the venue is
    // closed, and a Retry button that can only fail again is the exact defect
    // this phase exists to remove.
    title: "This exchange is not open on Quantalyze yet.",
    cause:
      "We support this exchange but have not switched it on for connections yet. Your credentials were not sent anywhere and nothing was stored.",
    fix: [
      "Connect a key from one of the other exchanges on this step in the meantime.",
      "Ask us to let you know when this exchange opens — we can turn it on for your account first.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["request_call"],
  },

  KEY_INPUT_TOO_LONG: {
    title: "One of the values you pasted is too long.",
    cause:
      "A field exceeded its maximum length. We cap each credential field at 512 characters and the label at 100, which is well above what any exchange issues — a value past the cap is almost always a paste that picked up more than the value itself.",
    fix: [
      "Re-copy the value from your exchange on its own, without the surrounding text, line breaks, or a second credential pasted after it.",
      "Shorten the label to 100 characters or fewer.",
      "Paste the corrected values and submit again.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["clear_and_retry", "request_call"],
  },

  KEY_INVALID_FORMAT: {
    // 142.2 / MT5-04: the `cause` used to open by blaming a check performed in
    // the BROWSER before the key was sent — false at all 24 of the sites that
    // carried this code, every one of which is a guard inside a route handler.
    // (The removed clause is DESCRIBED rather than quoted: this plan's
    // acceptance grep for it is a raw repo scan with no comment exclusion, so a
    // pasted citation would keep reporting the class open. Same discipline as
    // `ConnectKeyStep.tsx`'s KNOWN_CREATE_WITH_KEY_CODES docblock.) The sentence
    // is corrected rather than deleted because the SECOND half (the per-venue
    // secret formats) is genuinely useful, and it becomes true again now that
    // the split leaves only the `api_secret.length < 8` ccxt arm on this code.
    title: "This does not look like a valid API key for the selected exchange.",
    cause:
      "A format check on our side rejected the API secret before anything was sent to the exchange. Binance secrets are 64 hex characters; OKX and Bybit use different formats.",
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
      // D-17 / Gate C — verbatim from the UI-SPEC, identical across all three
      // venue-conditional entries.
      "This is your broker account, so there is no other venue to try. If it keeps failing, email security@quantalyze.com with the correlation id below.",
    ],
    // D-17 — "a different exchange ACCOUNT" is the same unwinnable remedy for a
    // venue that is the account.
    fixRequires: [
      null,
      REQUIRES_SUBSTITUTABLE_VENUE,
      REQUIRES_NON_SUBSTITUTABLE_VENUE,
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
      // D-17 / Gate C — an MT5 user reads a truthful replacement, not a
      // shorter list. That is why the requirement carries a boolean.
      "This is your broker account, so there is no other venue to try. If it keeps failing, email security@quantalyze.com with the correlation id below.",
    ],
    // D-17 — the third instance of the one class; no third code branch.
    fixRequires: [
      null,
      REQUIRES_SUBSTITUTABLE_VENUE,
      REQUIRES_NON_SUBSTITUTABLE_VENUE,
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  KEY_SCOPE_CHECK_UNAVAILABLE: {
    // NOT recoverable, on the same mechanism KEY_VENUE_NOT_ENABLED and
    // COMPOSITE_TOO_MANY_MEMBERS use: `actions` holds no member of
    // RECOVERABLE_ACTIONS (src/lib/envelope.ts), so `buildEnvelope` derives
    // `recoverable: false` and `ErrorEnvelope` renders NO Retry control. That is
    // the entire fix. The copy this code was split out of said "try again in a
    // moment" for a condition where trying again is guaranteed to fail, and a
    // Retry button that can only fail again is worse than no button: it reads as
    // "you did it wrong", so the user keeps clicking.
    title: "We could not check this key's permissions.",
    cause:
      "The permission check we run just before publishing did not complete, and it will not complete on a retry — this is something on our side to fix, not something you can clear. Nothing about your strategy was lost; it stays exactly where it is.",
    fix: [
      "Nothing you can do from here — tell us and we will fix it.",
      "Your draft is saved. You can come back to it once we have.",
    ],
    docsHref: "/security#readonly-key",
    actions: ["request_call"],
  },

  KEY_SCOPE_CHECK_UNREADABLE: {
    // RECOVERABLE, on the SAME mechanism as the entry directly above and in the
    // OPPOSITE direction: `clear_and_retry` IS a member of RECOVERABLE_ACTIONS
    // (src/lib/envelope.ts), so `buildEnvelope` derives `recoverable: true` and
    // `ErrorEnvelope` renders the Retry control. That is the entire fix.
    //
    // The two entries are deliberately adjacent so the pair is read together.
    // Their conditions differ by ONE fact — whether the probe answered at all —
    // and that fact is exactly what decides whether a retry can win. The
    // permanent one is above; this one is a body we could not read, which is
    // what a half-rolled analytics deploy serves for the minutes between its
    // first new pod and its last old one. Suppressing Retry there turned a
    // self-clearing window into a dead end on the wizard's last step.
    title: "We could not read the permission check's answer.",
    cause:
      "The permission check we run just before publishing did answer, but in a shape we could not read — most often because a release of ours was mid-rollout when you pressed Submit. That usually clears within a few minutes. Nothing about your strategy was lost; it stays exactly where it is.",
    fix: [
      "Wait a moment, then try again.",
      "If it is still happening after a few minutes, tell us — your draft is saved either way.",
    ],
    docsHref: "/security#readonly-key",
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

  // 154.1 / WIZCONT-02 review CR — the entry directly above is the one this was
  // split off, and the two are deliberately adjacent so the pair is read
  // together. They differ by ONE fact — whether the strategy holding this
  // account is still a draft — and that fact decides whether "resume it" is a
  // real instruction or a wild goose chase.
  //
  // ⚠️ THE `cause` IS COMPLETE AND TRUE WITH NO NAME (TRAP-3). The strategy's
  // name is OPTIONAL context: the route reads it from the caller's own row, but
  // the read can fault, and a sentence built around a name we were not given
  // would render machinery or a blank. `formatKeyError` prepends the naming
  // sentence only when `strategyName` is actually present.
  //
  // The server-state claim ("nothing new was created…") is OBSERVABLE rather
  // than asserted, on BOTH emitting arms, which is what the copy-honesty guard
  // in `wizardErrors.test.ts` requires before a claim like this may ship:
  //   · the PRE-RPC arm returns before `validateKey`, before `encryptKey` and
  //     before `create_wizard_strategy` is called at all — pinned by call-count
  //     assertions in `create-with-key/route.test.ts`, not by reading the code;
  //   · the 23505 RACE arm is reached because the RPC itself RAISED, so
  //     Postgres rolled its transaction back. That is a stronger ground than
  //     the returns-before-write kind, not a weaker one.
  // Neither arm writes, so "the existing strategy was left exactly as it was"
  // is a property of the control flow.
  VENUE_ALREADY_CONNECTED: {
    title: "This account is already connected to one of your strategies.",
    cause:
      "The account behind these details already backs a strategy of yours, and that strategy has moved past the draft stage — so there is no half-finished session to take you back to. One account backs one strategy at a time. Nothing new was created and the existing strategy was left exactly as it was.",
    fix: [
      "Open the strategy that already uses this account from your strategies page — it keeps updating from this same account.",
      "To list a second strategy, connect a different account: a separate broker account, or a different login on the same broker.",
      "If you believe this account should be free, email security@quantalyze.com before you disconnect anything — disconnecting it stops the existing strategy from updating.",
    ],
    docsHref: "/security",
    // ⛔ NEITHER member of `RECOVERABLE_ACTIONS` (`clear_and_retry`,
    // `try_another_key`), so `recoverable` derives FALSE and no Retry control
    // renders — submitting the same account again is refused identically.
    // ⛔ AND NEITHER `resume_draft` NOR `start_fresh`: there is no draft to
    // resume, and `start_fresh` DELETES a draft, which on this path would offer
    // to destroy the finished strategy's own session for a state it did not
    // cause. Its absence also keeps this entry outside the destructive-action
    // population the `[140.3-10 / TRAP-4]` scan walks.
    actions: ["request_call", "expand_log"],
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

  // 142.2 review FIX 1 — the copy that replaces a false "you have too few
  // trades" for a strategy whose daily series was never examined.
  //
  // ⛔ `actions` DELIBERATELY EXCLUDES `try_another_key`, and that exclusion is
  // load-bearing rather than stylistic. In SyncPreviewStep `try_another_key` is
  // what EARNS the destructive control (`keyReplacementIsEarned`), and that
  // button fires `handleDeleteDraft()` — destroying the draft and every
  // `strategy_keys` member under it. Routing this state there would answer "we
  // never recorded where your returns came from" with "delete your work", for a
  // strategy whose data is fine. The destructive-remedy problem itself is booked
  // as DEF-142.2-03; this code simply must not feed it.
  //
  // `clear_and_retry` IS the right remedy and is not a placebo here:
  // `kickoffRetryCanChangeTheOutcome` keys off exactly this action, so the
  // envelope renders a Retry wired to `handleKickoffRetry`, which re-runs the
  // sync — and a completed re-derive is precisely what makes a producer examine
  // the series and stamp a verdict.
  GATE_SERIES_PROVENANCE_UNVERIFIED: {
    title: "We can't confirm where this strategy's daily returns came from.",
    cause:
      "This strategy has a daily-return series but no individual trades, and nothing on our side recorded how that series was built. Our pipeline stamps that record at the moment it builds a series — so either this one predates the record, or the last sync did not finish stamping it. We will not publish a track record whose provenance we cannot state. This is a gap in our bookkeeping, not a judgement about your trading.",
    fix: [
      "Retry the sync from this page. A completed re-derive rebuilds the series and records how it was built.",
      "If it still says this after a sync completes, request a call — that combination is a fault on our side and we want to see it.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },

  METADATA_DESCRIPTION_REQUIRED: {
    title: "Add a description.",
    cause:
      "Allocators need a short description to evaluate the strategy. A description is required before you can continue.",
    fix: [
      "Write one paragraph describing the strategy, its edge, and how you frame risk.",
    ],
    docsHref: "/security",
    // 153.1 review CR-01 — this Phase-53 entry became the copy for a
    // FIELD-LEVEL refusal when 153.1-05 pointed `finalize-wizard`'s
    // `typeof description !== "string"` arm in `validatePayload` at it, and
    // 153.1-06 admitted it to `KNOWN_FINALIZE_CODES` (SubmitStep.tsx). It therefore
    // joins the class documented in the block below and carries no member of
    // `RECOVERABLE_ACTIONS`, so `buildEnvelope` derives `recoverable: false`
    // and NO Retry control renders. It previously carried `clear_and_retry`,
    // which the class docblock forbids BY NAME: the server compared a value
    // against a fixed rule, so an identical resubmit is refused identically,
    // and wiping the description the user typed is the worst possible answer.
    // The remedy is on the FORM.
    //
    // ⚠️ THIS ENTRY NOW SERVES TWO SURFACES, and the note that used to sit here
    // ("MetadataStep reads only `.cause`, so the inline field guard is
    // unaffected") is FALSE at HEAD — it was true when CR-01 was written and
    // 153.2-01 changed it in the same sub-phase. `MetadataStep`'s `messageFor`
    // renders `formatKeyError(code).title`, deliberately: `.cause` is a
    // multi-sentence paragraph containing "Nothing was saved, and everything
    // you typed is still on the form", which is nonsense under a control the
    // user is still typing into. 153.2-05 then routes the SERVER's copy of this
    // code to the same field. So an edit to `title` moves the field message AND
    // the envelope heading, and an edit to `cause` moves the envelope only.
    actions: ["expand_log"],
  },

  // ────────────────────────────────────────────────────────────────────────
  // 153.1-04 / WIZFORM-02 — the seven FIELD-LEVEL refusals.
  //
  // ⛔ RECOVERABILITY IS DECIDED ONCE, FOR THE CLASS, AND THE DECISION IS
  // "NOT RECOVERABLE". Every entry below carries `["expand_log"]` and nothing
  // else, so no member of `RECOVERABLE_ACTIONS` (`clear_and_retry`,
  // `try_another_key` — src/lib/envelope.ts) is present, `buildEnvelope`
  // derives `recoverable: false`, and NO Retry control renders. That absence
  // IS the behaviour being shipped, exactly as `ALLOCATION_NOT_ALLOCATABLE`
  // and `SEAM_MISCONFIGURED` already do it (Shared Pattern B).
  //
  // The reason, written once here and cross-referenced by the six entries
  // after the first: resubmitting the identical payload is refused
  // identically — the server compared the same value against the same rule and
  // will keep doing so. The remedy is on the FORM. A Retry control against
  // that is a false affordance, and a founder clicking it five times is the
  // incident that produced this phase.
  //
  // ⛔ Specifically NOT `clear_and_retry`: it wipes what the user typed, which
  // for a description they spent minutes on is the worst possible answer to
  // "it is nine characters long". And NOT `try_another_key`: these are form
  // fields, not credentials — no key is involved on any of the seven paths.
  //
  // ⚠️ The route does not emit these yet. 153.1-05 gives the nine
  // `validatePayload` arms their codes and admits them to
  // `KNOWN_FINALIZE_CODES` in the same commit (Shared Pattern D); 153.2 maps
  // each code to its field id. A code with no copy entry falls through to
  // UNKNOWN exactly as a missing code does, which is why the copy lands first.
  // ────────────────────────────────────────────────────────────────────────

  METADATA_NAME_INVALID: {
    title: "Choose a codename from the list.",
    cause:
      "The codename on this draft is not one of the names we offer. Nothing was saved, and everything else you filled in is still on the form.",
    fix: [
      "Open the codename field and pick one of the offered names.",
      "The list is fixed, so a name typed by hand will not be accepted.",
    ],
    docsHref: "/security",
    // See the class comment above: field-level refusals carry no member of
    // RECOVERABLE_ACTIONS, so no Retry renders.
    actions: ["expand_log"],
  },

  METADATA_DESCRIPTION_TOO_SHORT: {
    // Count-free by construction — `formatKeyError` appends " — you have {n}."
    // only when `charCount` is supplied. See DESCRIPTION_BOUND_TITLE.
    title: `${DESCRIPTION_BOUND_TITLE.METADATA_DESCRIPTION_TOO_SHORT}.`,
    cause: `Allocators read the description before anything else, so we ask for at least ${MAGNITUDE_CAPS.MIN_DESCRIPTION_CHARS} characters. Nothing was saved, and everything you typed is still on the form.`,
    fix: [
      "Write one paragraph describing the strategy, its edge, and how you frame risk.",
    ],
    docsHref: "/security",
    // Non-recoverable — see the class comment above this block.
    actions: ["expand_log"],
  },

  METADATA_DESCRIPTION_TOO_LONG: {
    title: `${DESCRIPTION_BOUND_TITLE.METADATA_DESCRIPTION_TOO_LONG}.`,
    cause: `The description is longer than the ${MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS.toLocaleString(
      "en-US",
    )} characters we store. Nothing was saved, and everything you typed is still on the form.`,
    fix: [
      "Trim it to the essentials — the strategy, its edge, and how you frame risk.",
      "Keep the longer version for the call; this field is a summary.",
    ],
    docsHref: "/security",
    // Non-recoverable — see the class comment above this block.
    actions: ["expand_log"],
  },

  METADATA_CATEGORY_REQUIRED: {
    title: "Choose a category.",
    cause:
      "Every strategy is filed under one category so allocators can compare like with like. This draft has no category, or the one it carries is not one we offer. Nothing was saved, and everything else you filled in is still on the form.",
    fix: [
      "Open the category field and pick the closest match.",
      "If none of them fits exactly, pick the nearest and say more in the description.",
    ],
    docsHref: "/security",
    // Non-recoverable — see the class comment above this block.
    actions: ["expand_log"],
  },

  METADATA_AUM_INVALID: {
    title: "Enter AUM as a number of dollars, or leave it blank.",
    cause:
      "AUM has to be a plain, finite dollar amount that is not negative and not above our upper bound. Currency symbols, separators and text are not read as numbers. Nothing was saved, and everything else you filled in is still on the form.",
    fix: [
      "Type digits only — no currency symbol, no commas, no words.",
      "AUM is optional. Leave the field empty if you would rather not state it.",
    ],
    docsHref: "/security",
    // Non-recoverable — see the class comment above this block.
    actions: ["expand_log"],
  },

  METADATA_CAPACITY_INVALID: {
    title: "Enter capacity as a number of dollars, or leave it blank.",
    cause:
      "Capacity has to be a plain, finite dollar amount that is not negative and not above our upper bound. Currency symbols, separators and text are not read as numbers. Nothing was saved, and everything else you filled in is still on the form.",
    fix: [
      "Type digits only — no currency symbol, no commas, no words.",
      "Capacity is optional. Leave the field empty if you do not want to state a limit.",
    ],
    docsHref: "/security",
    // Non-recoverable — see the class comment above this block.
    actions: ["expand_log"],
  },

  METADATA_CAPITAL_OWNERSHIP_INVALID: {
    title: "Answer whose capital is in this key.",
    cause:
      "The answer on this draft is not one of the two we accept. That answer decides whether the strategy can ever hold money, so we will not guess it. Nothing was saved, and everything else you filled in is still on the form.",
    fix: [
      // The two labels are the ones CapitalOwnershipRadioGroup.tsx renders, so
      // the user reads back the words they are looking at.
      'Pick either "My own capital" or "A trading team\'s key I\'m verifying".',
      "You can change the answer later from My Strategies.",
    ],
    docsHref: "/security",
    // Non-recoverable — see the class comment above this block.
    actions: ["expand_log"],
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

  // 153.1-04 / WIZFORM-02 (RESEARCH Finding 4) — the 409 the route already
  // discriminates, given the copy it never had.
  //
  // ⚠️ THIS REMOVES A CONTROL, AND REMOVING A CONTROL IS A DECISION. Until now
  // this 409 fell to `UNKNOWN`, whose actions are `clear_and_retry` +
  // `request_call` — so `recoverable` derived TRUE and SubmitStep rendered a
  // Retry button. That button re-POSTed the identical finalize request against
  // a draft the database had already moved out of a finalizable state, so the
  // RPC raised the same 22023 and the user got the same card. It was a false
  // affordance: the page's idea of the draft is stale, and only a RELOAD can
  // fix that. The Retry is gone deliberately, and the copy says what to do
  // instead.
  //
  // ⛔ NOT `start_fresh` either — that DELETES the draft row and cascades away
  // every `strategy_keys` member under it. The draft here is fine; it is this
  // PAGE that is out of date. `leave_and_return` names the actual remedy.
  DRAFT_STATE_INVALID: {
    title: "This draft has moved on since this page loaded.",
    cause:
      "The draft is no longer in a state we can finalize — it may already have been submitted from another tab, or changed after this page loaded. This attempt saved nothing, and the draft itself is untouched.",
    fix: [
      "Reload this page to see the draft as it stands now.",
      "If it was already submitted, it is on your strategies page — submitting again would create a duplicate.",
    ],
    docsHref: "/security#draft-resume",
    // ⚠️ NO `clear_and_retry` and NO `try_another_key` — the two members of
    // `RECOVERABLE_ACTIONS`. Their absence derives `recoverable: false`, which
    // is the behaviour change described above.
    actions: ["leave_and_return", "expand_log"],
  },

  // 153.7-03 / WIZFORM-02-CLASS — the first two of the three code-less
  // `finalize-wizard` rejections. Until this plan both rendered the UNKNOWN
  // card — "We could not classify this failure" — for failures the route
  // classified well enough to pick a status and write a sentence about.
  //
  // Both entries are written under the measured-truth gate 140.3-15 set: a
  // claim about server state is made only where the ARM makes it observable.
  // That gate is why these two entries differ on exactly one clause, and the
  // difference is the whole reason they are separate members.
  DRAFT_LOOKUP_FAILED: {
    title: "We could not read this draft.",
    cause:
      "A read of your draft failed on our side before anything else ran. Nothing was submitted and nothing was changed — the fault is in our database, not in your key, your exchange or your data. Reads like this usually succeed on the next attempt.",
    fix: [
      "Wait a moment and try again — the read usually succeeds on retry.",
      "If it keeps failing, email security@quantalyze.com with the correlation id below. Your draft is saved either way.",
    ],
    docsHref: "/security#sync-timing",
    // RECOVERABLE: `clear_and_retry` is a member of `RECOVERABLE_ACTIONS`
    // (src/lib/envelope.ts), so `buildEnvelope` derives `recoverable: true` and
    // the Retry control renders. Correct here — the arm is a transient read
    // failure, which is the same condition `WIZARD_KEYS_LOAD_FAILED` above is
    // recoverable for, and this entry is modelled on it.
    actions: ["clear_and_retry", "request_call"],
  },

  DRAFT_FINALIZE_FAILED: {
    title: "We could not finish submitting this strategy.",
    cause:
      "The last write failed, and the database's answer was not one we have a specific reply for. We cannot confirm from here whether anything was recorded, so we are not going to claim either way. The fault is on our side, not in your key or your exchange.",
    fix: [
      "Try again. Submitting is state-guarded: if the first attempt did go through, the next one tells you the draft has already moved on rather than creating a second strategy.",
      "If it keeps failing, email security@quantalyze.com with the correlation id below.",
    ],
    docsHref: "/security",
    // RECOVERABLE, and both halves of that decision were checked rather than
    // assumed. A retry CAN win: the residue this arm catches is dominated by
    // transient database conditions. A retry cannot HARM: a second finalize
    // against a draft that already finalized raises 22023, which the arm above
    // this one answers as `DRAFT_STATE_INVALID` — an honest, non-recoverable
    // card — instead of writing a duplicate.
    //
    // ⚠️ THE COPY DOES NOT SAY "nothing was saved", and that omission is
    // deliberate. This arm is the GENERIC tail of the RPC error branch, so it
    // also catches a transport failure reaching PostgREST, where the write may
    // have landed and the answer was lost. The stronger sentence is true for a
    // SQL raise and false for that case, and shipping it would be the same
    // unobservable claim the `FORBIDDEN` list's "data is unchanged" entry
    // exists to ban.
    actions: ["clear_and_retry", "request_call"],
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

  // 140.5-02 / SEAMPROSE-03 — THE BREAKDOWN PROMISE IS GONE, because the
  // breakdown never renders. Not on the forwarded-upstream arm, and — the part
  // that makes this a copy fix rather than a routing fix — NOT ON THE GENUINE
  // VALIDATION ARM EITHER. Three independent reasons, each measured:
  //   1. KEY MISMATCH. `csv_adapter.py`'s CSV `ValidationResult` puts the row
  //      errors under `debug_context={"violations": …}`; the panel reads
  //      `debug_context.pandera_errors`, and `pandera_errors` has ZERO hits
  //      anywhere in `analytics-service/`.
  //   2. THE FIELD DIES BEFORE THE WIRE. `process_key.py`'s `_run_validate_only`
  //      calls `_envelope_error(...)`, which rebuilds `debug_context` from the
  //      verification id alone and never reads `val.debug_context`.
  //   3. THE CODE IS A RULE NAME. `csv_adapter.py`'s CSV validation arm sets
  //      `error_code` from `first_rule.upper()` (e.g. `COLUMN_IN_DATAFRAME`),
  //      so this entry is reached mainly through `CsvUploadStep`'s
  //      `data.code ?? "CSV_VALIDATION_FAILED"` fallback.
  //
  // ⚠️ ONLY THE COPY HALF IS DONE HERE. Fixing the DATA half means forwarding
  // `violations`, whose pandera messages embed raw cell values — the PII
  // surface QA ISSUE-005 is fenced around. Carried forward deliberately, named
  // in `140.5-02-SUMMARY.md`'s `## OPEN`, NOT silently absorbed.
  //
  // The replacement states the limitation WITH what we do report (DESIGN.md
  // §Voice) instead of promising a list. Claude-drafted; founder review owed.
  CSV_VALIDATION_FAILED: {
    title: "Your file did not pass validation.",
    cause:
      "At least one row failed a schema or business-rule check. We report the first rule that failed, not a list of every affected row.",
    fix: [
      "Check your file against the CSV format reference, then upload it again.",
      "If the reason above is not specific enough to act on, contact security@quantalyze.com with the reference below.",
    ],
    docsHref: "/security#csv-format",
    actions: ["clear_and_retry"],
  },

  // 140.5-02 / SEAMPROSE-03 (DEF-140.4-C, founder decision §4a) — THE ONE
  // SENTENCE FOR EVERY UNRECOGNISED-OR-CODELESS UPSTREAM FAILURE ON THE CSV
  // SURFACE. The strings below are FOUNDER-AUTHORED and are reproduced
  // VERBATIM; they are not Claude-drafted and are not open to a reword. The
  // rationale, in the founder's words: the user cannot act differently on a 403
  // than on a 404 — both mean "not your fault, try again or contact us" — so
  // per-status copy was rejected as a hand-typed roster.
  //
  // ⚠️ SCOPE — READ THIS BEFORE ROUTING ANYTHING NEW HERE (corrected §6c).
  // This entry's population is the upstream failure carrying NO recognisable
  // top-level code. It is NOT "every `!res.ok`". The CSV routes emit their own
  // caller-fault codes with real top-level names — `CSV_FILE_TOO_LARGE`,
  // `CSV_INVALID_FORMAT`, `CSV_RATE_LIMIT`, `CSV_SESSION_REUSED`,
  // `CSV_PERSIST_FAIL`, `CSV_FINALIZE_FAIL` — and every one of them keeps its
  // own copy. Collapsing those onto this entry would tell a user who uploaded
  // an 11 MB file that the failure is "on our side, not your data", and would
  // assert "Nothing was saved" where `CSV_PERSIST_FAIL` may make that
  // affirmatively false. 140.5-05 owns the three-way arm and its negative
  // controls.
  //
  // "NOTHING WAS SAVED" IS VERIFIED, NOT ASSERTED, at the arm this entry serves
  // (`strategies/csv-validate`). Three layers: the Next route performs zero
  // writes (no supabase client, no insert/upsert/update, no audit event);
  // Python's `_run_validate_only` runs `adapter.validate()` only, with no DB
  // insert, no state-machine transition and no fingerprint/encryption; and the
  // `strategies` row is created on the CSV path only by the folded
  // `finalize_csv_strategy_with_returns` RPC
  // at the FINALIZE step. The 401/403/429 arms short-circuit before any of it.
  // ⚠️ ONE CAVEAT, recorded so nobody has to rediscover it: a `wizard_error`
  // PostHog funnel event does fire on this path. That is TELEMETRY, not user
  // data, and the sentence reads as being about the user's file.
  //
  // WHY THIS CODE AND NOT A NEW ONE. `CSV_UPSTREAM_FAIL` already exists,
  // already means "upstream failure on this surface" and already has emitters
  // at the csv-validate route. A second code for the same fact is exactly the
  // two-names-one-fact drift `seam-copy.ts` exists to prevent, so reuse beats
  // the naming preference against a `CSV_` prefix. Deliberate, recorded.
  //
  // The `correlation_id` the copy points at is rendered by
  // `CsvValidationEnvelope`'s own footer line — it is deliberately NOT
  // interpolated here, which keeps this entry's dynamic-value count at ONE.
  CSV_UPSTREAM_FAIL: {
    title: "We couldn't check your file just now.",
    cause: "This is on our side, not your data. Nothing was saved.",
    fix: [
      "Try again in a moment — if it keeps happening, send us this reference.",
    ],
    docsHref: "/security#sync-timing",
    // `clear_and_retry` is required, not decorative: `envelope.ts` derives
    // `recoverable` from `actions`, and without it the copy would say "try
    // again in a moment" beside an envelope that renders no Retry control.
    // `request_call` is the "send us this reference" affordance.
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
  // cannot make: this code is raised on a timeout/500 around the finalize RPC
  // (since Phase 145 the folded `finalize_csv_strategy_with_returns`, called
  // from the route), and a client-side timeout does not cancel the
  // server-side transaction, so the write may well have landed. The old wording also STEERED
  // the user straight back into a resubmit, which is the dead end the reply
  // contract has not yet fixed. The copy now states the uncertainty and puts a
  // non-destructive check FIRST, ahead of any resubmit.
  //
  // 140.4-03 / SEAMRIM-03 — RECONCILED with CSV_SUBMIT_NO_STRATEGY_ID, which
  // said the OPPOSITE. This entry warned that "submitting again would create a
  // second copy" while that one promised a repeat submit "cannot create a second
  // strategy". Both were reachable from the same CSV submit step. The
  // contradiction is resolved in favour of the promise, because the mechanism
  // now exists and is the same one for both codes: the partial unique index
  // (user_id, wizard_session_id, source) added by migration 20260728120000, plus
  // the /process-key 23505 arm that resolves the duplicate to the EXISTING
  // strategy at 200.
  //
  // The uncertainty in the title and cause is KEPT — it is still true and is a
  // different claim. We genuinely cannot observe whether the save completed. What
  // changed is only the CONSEQUENCE of retrying, which is now bounded.
  //
  // The promise is scoped to "the same wizard session" deliberately: a failed
  // submit does NOT clear local state (every clearWizardState call site is a
  // success or an explicit delete-draft, and delete-draft regenerates the id per
  // NEW-C14-08), so a retry reuses the id and is fenced. Starting a fresh wizard
  // mints a new id and is a genuinely new submission — which is why the
  // non-destructive check stays FIRST.
  CSV_SUBMIT_FAILED: {
    title: "We could not confirm whether your strategy was saved.",
    cause:
      "Your file passed validation, then the save step returned an error. The error does not tell us whether the save completed, so we cannot promise it did or that it did not.",
    fix: [
      "Open /strategies in another tab first. If your strategy is listed, the save did complete and you are done.",
      "If it is not listed, submit the same file again. An unchanged resubmit from this wizard resolves to the strategy you already started instead of creating a second one.",
      "To upload a different file, or to use a different name, start a new strategy. We refuse a changed resubmit from this wizard rather than mixing it into the one you already started.",
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
    // from the user's screen.
    //
    // 140.4-03 / SEAMRIM-03 — ⚠️ THE PROMISE BELOW WAS FALSE WHEN 140.3-12
    // WROTE IT, AND IS TRUE AGAIN NOW. Recording that, because "the guarantee
    // itself is real HERE and is kept" is precisely the reasoning that let it
    // stand unverified. Sending the session id was never sufficient: the
    // mechanism was a partial unique index predicated on
    // `wizard_session_id IS NOT NULL`, and `finalize_csv_strategy` did not WRITE
    // the column, so every CSV row sat outside it. Migration 20260726000225 had
    // separately removed the only other backstop. Review finding C-2: a CSV
    // double-submit answered 200 with a duplicate strategies row AND a duplicate
    // strategy_verifications row, silently.
    //
    // What makes it true now, named so the next reader can check it rather than
    // trust this comment:
    //   1. migration 20260728120000 — the partial unique index
    //      `strategies_user_wizard_session_source_uniq` on
    //      (user_id, wizard_session_id, source), and the finalize RPC
    //      finally writing the column that puts CSV rows inside it (the
    //      Phase 145 fold inherits that write verbatim);
    //   2. the 23505 resolve arm (since Phase 145 in csv-finalize/route.ts,
    //      resolveExistingStrategyOrRefuse; previously routers/process_key.py),
    //      which turns the resulting
    //      violation into a 200 carrying the EXISTING strategy id, so the retry
    //      this copy instructs is not a dead end;
    //   3. the third index column, `source` — without it an abandoned API draft
    //      sharing the session id would make the user's FIRST legitimate CSV
    //      submit fail forever, i.e. the promise would hold by making the
    //      product unusable.
    // Receipt: supabase/tests/test_csv_finalize_double_submit.sql (Part 4 is the
    // one a two-column index fails).
    //
    // It must STILL NOT be widened to the API path — that call site's guarantee
    // is a different index scope — and a promise made ahead of its mechanism is
    // how this whole class of copy started.
    //
    // ⚠️ 140.4-16 / CR-01 — THE PROMISE IS NOW SCOPED TO AN *UNCHANGED*
    // RESUBMIT, AND THAT THIS SENTENCE HAS MOVED A THIRD TIME IS THE LESSON.
    // The mechanism above is keyed on `wizard_session_id`, which identifies a
    // SESSION and not a SUBMISSION; `clearWizardState` fires only on success /
    // delete-draft / start-fresh, so the id survives the very failure this copy
    // is shown for. A user who followed the old sentence could rename, pick a
    // DIFFERENT file and submit — and the 23505 arm resolved that to the FIRST
    // strategy, whose series then became A ∪ B, because the since-dropped
    // standalone persist RPC was an upsert with no delete outside the
    // incoming range. The old sentence was instructing the action that
    // triggered a silent cross-submission merge, reported as success.
    //
    // Both halves are refused now — since Phase 145 by the read-only 23505
    // resolve arm in csv-finalize/route.ts (resolveExistingStrategyOrRefuse:
    // name check, then range check against the committed dailies, BEFORE any
    // metadata write; the fold deleted the standalone merge-writing persist)
    // — so the copy owes the user the escape those refusals imply:
    // START A NEW STRATEGY. `wizardErrors.test.ts` asserts that escape is
    // present on BOTH resubmit entries, rather than banning a phrase: a
    // fragment ban is satisfiable by deleting the sentence, which would leave
    // the user with less information than before, not more.
    fix: [
      "Submit the same file again. On the CSV path an unchanged resubmit of the same wizard session resolves to the strategy that already exists instead of creating a second one.",
      "To upload a different file, or to use a different name, start a new strategy. We refuse a changed resubmit rather than mixing it into the first one.",
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
  //
  // 140.4-03 / SEAMRIM-03 — SCOPE CORRECTION. The paragraph above describes the
  // API path and only the API path. Read as a statement about "the wizard" it
  // was wrong twice over on the CSV branch:
  //   * it was UNREACHABLE there — 140.1 moved the WIZARD_DUPLICATE pre-check
  //     below the csv-finalize branch (correctly: it was a dead end), and
  //     csv-finalize posts no strategy_id, so the arm described above never ran;
  //   * it is STILL not emitted there, by design. The CSV path now has its OWN
  //     23505 arm (routers/process_key.py), and it deliberately answers with the
  //     ordinary first-submit envelope — ok/strategy_id/status/step="finalize",
  //     NO code — because on that path the honest thing to show the user is
  //     their strategy, not a "duplicate" notice. A user who submits twice on
  //     the CSV branch sees success, not this entry.
  // So: this code is API-path vocabulary. Do not wire it into the CSV finalize
  // reply, and do not "fix" the CSV arm to emit it.
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
    //
    // ⚠️ 140.3-14 SPLIT THE CAP ARM OFF THIS ENTRY. This copy stays exactly as
    // it is, and it stays RECOVERABLE, because the three arms that still reach
    // it are genuinely transient. Do not "unify" it with
    // COMPOSITE_TOO_MANY_MEMBERS below: merging them re-creates either a retry
    // on a permanent condition or the loss of a correct retry on three real
    // transient faults, which is the inverse defect.
    actions: ["clear_and_retry", "request_call"],
  },

  COMPOSITE_TOO_MANY_MEMBERS: {
    title: "This draft has more than 10 keys attached.",
    cause:
      "A multi-key strategy can hold at most 10 keys, because we re-check every one of them against its exchange before submitting. This draft came back with more than 10, so we stopped rather than finalise a strategy whose extra keys were never re-checked. Nothing was submitted, and retrying will not change the count.",
    fix: [
      "Go back to the keys step and remove keys until 10 or fewer remain, then submit again.",
      "Splitting the extra keys into a second strategy also works — each strategy carries its own limit of 10.",
      "If you need more than 10 keys in one strategy, email security@quantalyze.com with your draft ID. The limit is ours, not your exchange's.",
    ],
    docsHref: "/security",
    // ⚠️ NO `clear_and_retry` AND NO `try_another_key` — the two members of
    // `RECOVERABLE_ACTIONS` (src/lib/envelope.ts). Their absence is what makes
    // `recoverable` false and suppresses the Retry control, and it is the
    // BEHAVIOUR this entry exists to change. `request_call` keeps a
    // non-destructive way out; `expand_log` opens the diagnostics.
    actions: ["request_call", "expand_log"],
  },

  // 153.1-04 / WIZFORM-02 (RESEARCH Finding 4) — the copy for a code the route
  // has been emitting into an UNKNOWN card.
  //
  // ⚠️ THE COPY MUST BE TRUE OF THE STATE THE ROUTE JUST WROTE. Immediately
  // above that emitter in `finalize-wizard/route.ts` the handler upserts
  // `strategy_analytics` with `computation_status: "failed"` and a
  // `computation_error` naming this same limitation. So "we stopped and marked
  // it failed" is OBSERVABLE rather than reassuring — the row is written before
  // the response is sent. Saying instead that "nothing changed" would be the
  // false comfort the copy-honesty sweep exists to catch.
  COMPOSITE_UNSUPPORTED_UNIFIED: {
    title: "Multi-key strategies can't be finalized on this path yet.",
    cause:
      "This draft has more than one key attached, and the pipeline it was routed through does not support multi-key strategies yet. We stopped and marked the strategy as failed rather than publish half of it. Submitting the same draft again reaches the same refusal.",
    fix: [
      "Email security@quantalyze.com with the correlation id below — this is a gap on our side, and we can finalize it for you.",
      "Your keys are untouched and stay connected. Nothing needs undoing.",
    ],
    docsHref: "/security",
    // ⚠️ NO `clear_and_retry` and NO `try_another_key` — the two members of
    // `RECOVERABLE_ACTIONS`. Their absence derives `recoverable: false` and
    // suppresses the Retry control, which is the BEHAVIOUR this entry ships:
    // the route refuses on a property of the draft (its key count) that a
    // retry cannot change. `request_call` keeps a way out that can actually
    // resolve it; `expand_log` opens the id the first fix line asks for.
    actions: ["request_call", "expand_log"],
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
    // Gate B / 153.1-03 — the live defect: this first bullet rendered on the
    // CONNECT step, where nothing was being submitted, and sent the user on a
    // pointless detour. It now renders ONLY when the context names the submit
    // surface.
    //
    // ⚠️ TRADE-OFF, stated so this reads as a decision and not a deletion:
    // until the `buildEnvelope` call sites pass `surface` — `SubmitStep.tsx`
    // (153.2 / D-06) and `ConnectKeyStep.tsx` + `MultiKeyConnectStep.tsx`
    // (153.4's long-wait paths) — this bullet renders NOWHERE. That is the
    // UI-SPEC's explicit direction: fail toward saying less, never toward
    // advising a detour that may be pointless. The one surface where the
    // detour IS true gets it back the moment its call site names itself.
    //
    // The table-reading assertion at `wizardErrors.test.ts` ("SERVICE_UNREACHABLE
    // states the uncertainty…") reads WIZARD_ERROR_COPY directly and so is
    // unaffected — the filter never mutates the table.
    fixRequires: [REQUIRES_SUBMIT_SURFACE, null, null],
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

  // 140.3-15 / TS-38 — copy FINAL, and it is written under THREE simultaneous
  // constraints, each of which rules out an easier sentence:
  //   1. It must not blame the upstream. That is the lie being removed.
  //   2. It must not invite a retry. The setting stays wrong until we redeploy,
  //      so "try again" is a control that cannot work — and the sentence says
  //      so explicitly rather than merely omitting the invitation.
  //   3. It must claim only what is knowable. "Nothing was submitted and
  //      nothing was changed" is safe HERE in a way it is NOT on
  //      SERVICE_UNREACHABLE, and the difference is structural rather than
  //      stylistic: `SeamConfigError` is raised BEFORE any store or network
  //      I/O, so it is a fact about a request that never left, not a guess
  //      about one whose outcome we never learned.
  //
  // No env variable name, no route name, no status: this entry is reachable
  // from `finalize-wizard`, which forwards the seam envelope verbatim, and the
  // wire sentence beside it is rendered by the anonymous teaser.
  SEAM_MISCONFIGURED: {
    title: "We could not send this request — our own configuration is wrong.",
    cause:
      "A setting on our side is wrong, so we stopped before sending the request. Nothing was submitted and nothing was changed. Retrying will not clear it: the setting stays wrong until we fix it and redeploy. This is not your key, your exchange or your data.",
    fix: [
      "Email security@quantalyze.com with the correlation id below — a configuration fault is ours to fix, and running the same action again will not clear it.",
      "Nothing needs undoing on your side. The request never left our servers, so no draft, key or strategy changed.",
    ],
    docsHref: "/security",
    // ⚠️ NO `clear_and_retry` AND NO `try_another_key` — the two members of
    // `RECOVERABLE_ACTIONS` (src/lib/envelope.ts). Their absence derives
    // `recoverable: false` and suppresses the Retry control, and that BEHAVIOUR
    // is half of what this entry exists to change. `request_call` keeps a way
    // out that can actually resolve it; `expand_log` opens the diagnostics the
    // first fix line asks the user to quote.
    actions: ["request_call", "expand_log"],
  },

  // 153.7-02 / WIZFORM-02-CLASS — copy authored under the same three
  // constraints TS-38's entry above was, plus a fourth this one adds.
  //   1. It must not blame the venue or the user. All three wire codes it homes
  //      say so themselves: "Nothing is wrong with your key."
  //   2. It must not invite a retry. All three are `retryable=False` upstream,
  //      and `actions` below carries neither member of `RECOVERABLE_ACTIONS`, so
  //      the Retry control does not render.
  //   3. It must claim only what is knowable. "No key was stored" is safe here
  //      because all three emitters live inside `validate_key`, which BOTH key
  //      routes call before `encryptKey` and before the create RPC — the same
  //      ordering `create-with-key`'s own pre-RPC assertions pin. It is a fact
  //      about a write that was never reached, not a guess about one whose
  //      outcome we never learned.
  //   4. ⭐ IT MUST NOT NAME WHERE WE STOPPED. That is the clause that made
  //      `SEAM_MISCONFIGURED` unusable for these three (see the union member's
  //      comment), so the sentence is written to be true whether the fault fired
  //      before, during or after an outbound call. A future edit that adds
  //      "before we sent anything" re-opens exactly the defect this entry was
  //      minted to avoid.
  //   5. ⭐ AND IT MUST NOT PREDICT WHAT A SECOND ATTEMPT WOULD DO — 153.7 review
  //      WR-01, and it is constraint 3 ("claim only what is knowable") applied to
  //      the one clause that had escaped it. The entry shipped saying "Retrying
  //      will not clear it: the same fault runs again until we fix it", which is
  //      the SAME true-at-three-of-four defect the member was minted to avoid,
  //      one clause down:
  //        · `MT5_GATEWAY_UNCONFIGURED` — true. An unset env, a malformed port
  //          and the D-31 refusal all re-run identically until an operator acts.
  //        · `ADAPTER_INIT_FAILED` — FALSE at a third of its own declared cause
  //          set. The emitter's comment (`routers/exchange.py`) enumerates "a
  //          ccxt signature change, an ImportError on a missing extra or an
  //          OOM". An OOM clears on retry.
  //        · `INTERNAL` — UNKNOWABLE. It is `validate_key_permissions`' bare
  //          `except Exception` residue, open by construction, so "the same
  //          fault runs again" is not a thing anyone can assert about it. This
  //          is exactly the shape `DRAFT_FINALIZE_FAILED` (below) was careful
  //          NOT to claim about its own generic tail.
  //      ⚠️ THE ABSENT RETRY CONTROL IS NOT WHAT CHANGED, and must not change.
  //      `recoverable: false` is still correct and is still DERIVED: all three
  //      wire codes are `retryable=False` at the emitter, and `actions` below
  //      carries neither member of `RECOVERABLE_ACTIONS`. What was wrong was the
  //      copy explaining that absence with a PREDICTION we cannot make. It now
  //      explains it with what we actually know — that we cannot say whether a
  //      second attempt would get further — which is true at all three.
  //
  // No env variable name, no route name, no status, no dependency: the reader
  // gets the remedy and the limits, never the subsystem.
  SEAM_INTERNAL_FAULT: {
    title: "Something failed on our side while we checked this key.",
    cause:
      "The check stopped on a fault in our own service — not in your key, your exchange or your data. We never store a key we could not check, so no key was stored. We cannot tell you whether a second attempt would get further, so we are not offering one here.",
    fix: [
      "Email security@quantalyze.com with the correlation id below. A fault in our own service is ours to fix, whether or not it repeats.",
      "Nothing needs undoing on your side. Your key was not stored.",
    ],
    docsHref: "/security",
    // ⚠️ NO `clear_and_retry` AND NO `try_another_key` — the two members of
    // `RECOVERABLE_ACTIONS` (src/lib/envelope.ts). Their absence derives
    // `recoverable: false` and suppresses the Retry control, and that BEHAVIOUR
    // is half of what this entry exists to change: `KEY_PROBE_FAILED`, the
    // nearest member by subject, IS recoverable and would offer a control that
    // cannot work. `request_call` keeps a way out that can actually resolve it;
    // `expand_log` opens the correlation id the first fix line asks for.
    actions: ["request_call", "expand_log"],
  },

  // 153.7-03 / WIZFORM-02-CLASS — the third code-less `finalize-wizard`
  // rejection, and the one that is hard for the opposite reason to its two
  // siblings above: the fault is easy to describe and the OUTCOME is unknown.
  //
  // The unified arm's upstream answered 2xx with a body the onboard contract
  // guard rejects, so the submission was accepted and its result is unreadable.
  // Every sentence below is bounded by that: the entry states the one thing the
  // 2xx establishes, refuses both outcome claims, and puts the user in front of
  // the record that settles it.
  SEAM_RESPONSE_UNREADABLE: {
    title: "We could not read the service's answer to your submission.",
    cause:
      "Your submission reached the service that processes it and the service did answer — but in a shape we do not recognise, most often because a release of ours was mid-rollout. So we cannot tell you whether the strategy was accepted, and we would rather say that than guess.",
    fix: [
      "Open your strategies list first. If the submission went through, the strategy is there with its review status.",
      "If it is not there after a minute, submit again.",
      "If this keeps happening, email security@quantalyze.com with the correlation id below.",
    ],
    docsHref: "/security",
    // ⛔ NOT recoverable: `actions` carries neither member of
    // `RECOVERABLE_ACTIONS` (src/lib/envelope.ts), so `buildEnvelope` derives
    // `recoverable: false` and no Retry control renders — and the reason is
    // NOT the usual one. Retrying is not futile here, it is UNPREDICTABLE:
    // nobody, including us, knows what the first submission did. A one-click
    // Retry on an unconfirmed submit is a control whose effect the person
    // pressing it cannot foresee, so the remedy is ordered instead and
    // `leave_and_return` carries the first step of it — the same control
    // `WIZARD_DUPLICATE` uses to send a user to the record rather than at the
    // button again.
    actions: ["leave_and_return", "request_call", "expand_log"],
  },

  // 153.1-04 / UI-SPEC Gate A — copy authored from the spec's field table.
  //
  // ⛔ THE MISSING RETRY IS THE FEATURE. The 2026-08-08 panel offered Retry
  // against a deadline inversion — a condition that fails identically on every
  // attempt — and the founder pressed it. `actions` below holds neither member
  // of `RECOVERABLE_ACTIONS`, so `recoverable` derives false and no Retry
  // control renders. ⛔ Do NOT "replace" it with a second button either: the
  // escalation path is the existing diagnostics disclosure, and a new control
  // would re-create the false-affordance class in a fresh costume.
  //
  // ⭐ NOT DEAD COPY. Phase 153.4 is the consumer: it raises the validate-key
  // budget and emits this code from the client abort that its own deadline
  // fires. The member has to exist first — an emitted code with no copy entry
  // renders UNKNOWN exactly as an unknown code does, which is the failure
  // WIZFORM-02 is about.
  //
  // ⚠️ ONE OBLIGATION ON THE EMITTER, STATED HERE BECAUSE THE COPY DEPENDS ON
  // IT. "Nothing was saved — your key was not stored" is only OBSERVABLE while
  // the abort fires before the request could persist anything; the UI-SPEC's
  // own basis for it is that the wait is aborted pre-encrypt / pre-RPC. A
  // server does not stop working because a client stopped listening (the
  // reasoning behind the "data is unchanged" ban on the CSV entry), so 153.4
  // must NOT emit this code on a path where the write could already have
  // landed. If that ever changes, this sentence changes with it.
  SEAM_DEADLINE_EXCEEDED: {
    title: "This check ran out of the time we allow.",
    // Count-free by construction: `budgetSeconds` is optional, and
    // `formatKeyError` substitutes the number-naming head when it is supplied.
    cause: `We gave your broker the time we allow to answer and it did not.${DEADLINE_CAUSE_TAIL}`,
    fix: [
      // ⭐ Gated on the CONNECT surface (Gate B). This sentence is a claim about
      // the form standing behind the panel — true on the key step, unverifiable
      // anywhere else. Absence of `surface` SUPPRESSES it, so 153.4 must pass
      // `surface: "connect"` in the same commit it starts emitting this code or
      // the reassurance the user most needs is silently withheld.
      "Your key details are still on this page.",
      "Some brokers are slower than the time we allow. Email security@quantalyze.com with the correlation id below and we will raise the limit for your broker.",
    ],
    fixRequires: [REQUIRES_CONNECT_SURFACE, null],
    docsHref: "/security#sync-timing",
    // ⚠️ NO `clear_and_retry` AND NO `try_another_key` — see the block comment
    // above. `request_call` keeps a way out that can actually resolve it;
    // `expand_log` opens the correlation id the second fix line asks for.
    actions: ["request_call", "expand_log"],
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
  // Phase 151 review E5/E6 — see the union member's note for why this is its own
  // code and why it is deliberately NOT recoverable.
  ALLOCATION_NOT_ALLOCATABLE: {
    title: "This strategy isn't marked as your own capital.",
    cause:
      "Money can only sit against a strategy you have marked as your own capital. That mark is either not set, or it changed after this page loaded — so the allocation was refused and nothing was saved.",
    fix: [
      "Open My Strategies and mark this strategy as your own capital, then allocate again.",
      "If it is marked as a trading team's capital under review, it cannot take an allocation until that changes.",
      "Close this dialog to see the strategy's current state — the list reloads with the mark as it stands now.",
    ],
    docsHref: "/security",
    // ⚠️ NO `clear_and_retry` and NO `try_another_key` — the two members of
    // `RECOVERABLE_ACTIONS`. Their absence derives `recoverable: false` and
    // suppresses the Retry control, and that BEHAVIOUR is half of what this
    // entry exists to change: the server refuses the identical request forever
    // until the mark changes, so a Retry CTA is a false affordance.
    actions: ["leave_and_return", "expand_log"],
  },

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
  /**
   * 153.1-04 / WIZFORM-02 — the description's CURRENT length in characters,
   * for `METADATA_DESCRIPTION_TOO_SHORT` / `_TOO_LONG`.
   *
   * OPTIONAL, and absence means "we were not told how long it is" — never
   * "zero", never "empty". A surface MUST NOT name a count it did not receive:
   * telling a user "you have 0" when the value simply was not passed turns a
   * vague refusal into a specific lie, and "0" is also the one value that would
   * send them looking for a different problem (TRAP-3, the same rule
   * `retryAfterSeconds` above states for durations). Both table sentences are
   * written to be complete and true with no number; `formatKeyError` produces
   * the counted form only when this field is present.
   */
  charCount?: number;
  /**
   * 153.1-04 / UI-SPEC Gate A — the budget WE granted, in SECONDS, for
   * `SEAM_DEADLINE_EXCEEDED`.
   *
   * UNITS ARE SECONDS, like `retryAfterSeconds` above and for the same reason:
   * one field, one unit, no conversion between the deadline that fired and the
   * sentence that names it. Phase 153.4 owns the budget constant this is
   * derived from; it must divide the millisecond budget once, at the call site,
   * rather than letting a millisecond value reach a sentence that says
   * "seconds".
   *
   * OPTIONAL, and absence means "no budget was named" — never "zero" and never
   * "immediately". `SEAM_DEADLINE_EXCEEDED`'s table `cause` is written to be
   * true with no number ("the time we allow"); `formatKeyError` swaps in the
   * number-naming sentence only when this field is present (TRAP-3).
   */
  budgetSeconds?: number;
  /**
   * 153.1-03 / WIZFORM-03 / D-17 — the venue the failure happened on, as a
   * lowercase `SupportedExchange` code. Read ONLY as a lookup key into the
   * closed capability record; it is never interpolated into copy, a log line,
   * a URL or a breaker key, so no caller-supplied string can reach the
   * envelope through this field.
   *
   * ABSENT ⇒ a venue-conditional bullet STILL RENDERS. That is the incumbent
   * behaviour of every caller that predates this field, and suppressing
   * venue-shaped copy everywhere the venue is merely unnamed would be a
   * repo-wide copy regression D-17 did not ask for. D-17 asks that the bullet
   * never reaches a venue we KNOW cannot be substituted.
   *
   * ⚠️ Note the asymmetry with `surface` below — the two absences answer
   * DIFFERENTLY, deliberately. Unifying them breaks one of the two gates.
   */
  venue?: string;
  /**
   * 153.1-03 / WIZFORM-03 / UI-SPEC Gate B — which wizard step raised the
   * error.
   *
   * ABSENT ⇒ a surface-conditional bullet is SUPPRESSED. Fail toward saying
   * less, never toward advising a detour that may be pointless: the live defect
   * this removes is `SERVICE_UNREACHABLE`'s "open /strategies before retrying"
   * rendering on the CONNECT step, where nothing was being submitted.
   *
   * ⚠️ The opposite of `venue`'s absence rule above, and that is the point:
   * an unnamed venue leaves incumbent copy intact, an unnamed surface withholds
   * a claim we cannot support.
   */
  surface?: WizardSurface;
  /**
   * 154.1 / WIZCONT-02 review CR — the name of the strategy that ALREADY holds
   * the account the caller just tried to connect, for `VENUE_ALREADY_CONNECTED`.
   *
   * ⭐ IT IS THE CALLER'S OWN ROW, AND ONLY EVER THAT. `create-with-key` reads
   * it through the USER-SCOPED (RLS) client with an explicit `user_id` filter,
   * so the only name that can reach this field is one the caller typed
   * themselves and can already see on their own strategies page. ⛔ The venue
   * account id is NOT carried here and never crosses back to the browser
   * (T-154-06-C): non-secret is not the same as published.
   *
   * OPTIONAL, and absence means "we were not told which strategy" — never a
   * placeholder and never a guess. The table `cause` is written to be complete
   * and true with no name; `formatKeyError` prepends the naming sentence only
   * when this field is present (TRAP-3, the same rule `retryAfterSeconds` and
   * `charCount` state for numbers).
   */
  strategyName?: string;
}

/**
 * 153.1-03 — does the context satisfy one bullet's requirement?
 *
 * `null` (an unconditional bullet) is always met. Each union member's arm
 * carries its absence rule; both rules are stated at the context fields above.
 */
function requirementMet(
  req: FixRequirement | null,
  context?: WizardErrorContext,
): boolean {
  if (req === null) return true;
  switch (req.kind) {
    case "venueCapability":
      // An ABSENT venue answers the predicate's default (`substitutable` ⇒
      // true), so an untagged caller keeps the incumbent bullet.
      return VENUE_CAPABILITY_PREDICATES[req.capability](context?.venue) === req.is;
    case "surface":
      // An ABSENT surface can never equal a named one ⇒ suppressed (Gate B).
      return context?.surface === req.surface;
  }
}

/**
 * 153.1-03 / WIZFORM-03 — THE ONE FILTER. Applied once, at the top of
 * `formatKeyError`, for every code and therefore for every interpolation arm
 * (each of which spreads `...base`).
 *
 * ⛔ It cannot live in `buildEnvelope`: that function (in `envelope.ts`)
 * forwards `copy.fix` verbatim into the envelope's `debug_context`, and
 * `formatKeyError` has consumers that never build an envelope at all.
 *
 * An entry WITHOUT `fixRequires` is returned as the SAME OBJECT — not a copy —
 * so the ~60 untagged entries are provably untouched by this mechanism
 * (pinned by a reference-identity sweep in `wizardErrors.test.ts`).
 */
function applyFixRequirements(
  entry: WizardErrorCopy,
  context?: WizardErrorContext,
): WizardErrorCopy {
  const requires = entry.fixRequires;
  if (requires === undefined) return entry;
  const keep = entry.fix.map((_, i) => requirementMet(requires[i] ?? null, context));
  return {
    ...entry,
    fix: entry.fix.filter((_, i) => keep[i]),
    // Filtered in LOCKSTEP. `fixRequires` declares itself index-aligned to
    // `fix`, and `formatKeyError` returns a `WizardErrorCopy` — returning a
    // value that violates its own type's invariant would leave a trap for the
    // first consumer that reads both.
    fixRequires: requires.filter((_, i) => keep[i]),
  };
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
    // Returned WITHOUT the requirement filter, deliberately: `UNKNOWN` carries
    // no `fixRequires` today, so filtering it would be a no-op that returns the
    // identical object anyway. If `UNKNOWN` ever gains a conditional bullet this
    // early return must route through `applyFixRequirements` too — the
    // asymmetry is recorded here rather than left for a reader to wonder at.
    return WIZARD_ERROR_COPY.UNKNOWN;
  }

  // 153.1-03 / WIZFORM-03 — THE ONE requirement filter, applied ONCE. Every
  // interpolation arm below spreads `...base`, so all five inherit the filtered
  // array with no per-arm edit. ⛔ Do not add a filtering branch inside a
  // per-code equality arm below; that is the instance-not-class defect in a new
  // costume. (Spelled in prose, not in the literal form the plan's grep gate
  // counts — see the FixRequirement docblock.)
  const base = applyFixRequirements(WIZARD_ERROR_COPY[code], context);

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
    // compares strictly `< 7` (see `strategyGate.ts`'s
    // `spanDays < STRATEGY_GATE_MIN_DAYS` check), but `.toFixed(1)`
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

  // 154.1 / WIZCONT-02 review CR — NAME THE STRATEGY WHEN WE WERE GIVEN ITS
  // NAME, and say nothing extra when we were not. Prepended, exactly like the
  // two gate arms above: the table sentence stays intact and true on its own,
  // so an absent or blank name degrades to the unnamed copy rather than to
  // `undefined` or an empty pair of quotes. The blank check is deliberate —
  // `strategies.name` is NOT NULL at the database, but a whitespace-only value
  // would still produce a sentence pointing at nothing.
  if (
    code === "VENUE_ALREADY_CONNECTED" &&
    context?.strategyName !== undefined &&
    context.strategyName.trim().length > 0
  ) {
    return {
      ...base,
      cause:
        `It is connected to "${context.strategyName.trim()}". ` + base.cause,
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

  // 153.1-04 / WIZFORM-02 — the description pair names the user's current
  // count, and ONLY when it was given one.
  //
  // ⓘ This is a per-CODE interpolation arm, and it is NOT the instance-not-class
  // defect 153.1-03 removed. Interpolation is per-code BY NATURE — five arms
  // above it do the same thing for five different context fields, because the
  // sentence a count belongs in is different for every code. Requirement
  // FILTERING is the opposite: it is one rule over the whole table, and it stays
  // in the ONE filter at the top of this function. Do not "unify" these two;
  // they are different shapes for different reasons.
  if (
    (code === "METADATA_DESCRIPTION_TOO_SHORT" ||
      code === "METADATA_DESCRIPTION_TOO_LONG") &&
    context?.charCount !== undefined
  ) {
    return {
      ...base,
      title: `${DESCRIPTION_BOUND_TITLE[code]} — you have ${context.charCount.toLocaleString(
        "en-US",
      )}.`,
    };
  }

  // 153.1-04 / UI-SPEC Gate A — name the budget we granted, and only when we
  // were told what it was. The tail is shared with the table sentence so the
  // two forms cannot drift; only the head changes.
  if (
    code === "SEAM_DEADLINE_EXCEEDED" &&
    context?.budgetSeconds !== undefined
  ) {
    return {
      ...base,
      // 153.1 review WR-04 — pluralised. A one-second budget rendered "1
      // seconds". 153.4 is the emitter and passes a real budget; sub-second
      // and one-second budgets are plausible during a retune. The
      // MULTI_KEY_WINDOWS_INVALID arm below already pluralises, so the bare
      // form broke this file's own convention.
      cause: `We gave your broker ${context.budgetSeconds} second${
        context.budgetSeconds === 1 ? "" : "s"
      } to answer and it did not.${DEADLINE_CAUSE_TAIL}`,
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
    case "SERIES_PROVENANCE_UNVERIFIED":
      // 142.2 review FIX 1. Terminal AND wizard-reachable, so it maps to real
      // copy — never UNKNOWN. Both the single-key arm (a keyed ledger-backed
      // strategy on an unstamped row) and the composite arm (FIX 3) can land
      // here.
      return "GATE_SERIES_PROVENANCE_UNVERIFIED";
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
export const VENUE_WIRE_CODE_TO_VERDICT: ReadonlyMap<
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
  // ── 140.5-02 / SEAMPROSE-03 — the four SCOPE/PERMISSION codes ─────────────
  //
  // ⚠️ COVERAGE-LAW ROW 2. This table is a HAND-TYPED ROSTER and adding rows to
  // it is **PARTIAL BY CONSTRUCTION**, in those words. The row-1 version is a
  // `WireErrorCode` union this phase does not schedule. What the parity guard
  // in `seam-venue-vocabulary.invariant.test.ts` adds is NOT row 1 either — it
  // adds FAIL-LOUD ARRIVAL: its population is derived from the REAL Python
  // emitters, so a newly-emitted code reddens CI until someone writes its
  // disposition. A roster that cannot silently miss a new member is still a
  // roster.
  //
  //   MISSING_SCOPE — rendered UNKNOWN/500 ("we could not classify this") for a
  //     plainly fixable key scope. It matched NO cascade branch: the real
  //     detail is `key is missing required scope 'account:read'`, and the
  //     cascade has no needle for it. This is the milestone's signature defect,
  //     live at HEAD, and the Python side documents that MISSING_SCOPE IS
  //     reachable and IS permanent.
  //   PERMISSION_DENIED — rendered KEY_IP_ALLOWLIST/502: a server status for a
  //     caller fault, asserting ONE of two possible causes. It matched the
  //     `ip` + `allow` branch on the REMEDY half of its own sentence.
  //   WITHDRAW_SCOPE — reached KEY_HAS_TRADING_PERMS through the
  //     `trading|withdraw` branch, so a withdrawal-capable key was told its
  //     problem was TRADING. The correct member already existed.
  //   TRADE_SCOPE — correct today only by an ACCIDENT OF SUBSTRING ORDER (the
  //     same branch, reached by the other half of the same `||`). Listed so the
  //     verdict is decided by the table rather than by which token appears.
  //     ⭐ It is included precisely BECAUSE it is already right: a row that
  //     changes nothing today is what stops the next reword from changing it.
  ["MISSING_SCOPE", { code: "KEY_MISSING_READ_SCOPE", status: 400 }],
  ["PERMISSION_DENIED", { code: "KEY_PERMISSION_DENIED", status: 400 }],
  ["WITHDRAW_SCOPE", { code: "KEY_HAS_WITHDRAW_PERMS", status: 400 }],
  ["TRADE_SCOPE", { code: "KEY_HAS_TRADING_PERMS", status: 400 }],
  // ── 153.7-02 / WIZFORM-02-CLASS — the eight `service_error(...)` codes ─────
  //
  // ⭐ THE MEASURED FACT THAT PUT THEM HERE. Until this batch the rows above
  // covered only the codes the `services/**` ASSIGNMENT scan could see. 153.7-01
  // widened that scan to `analytics-service/**` and to the four call shapes, and
  // the population went 17 → 37 with twenty codes disposed nowhere. Replayed
  // through this very function with their REAL wire code and their REAL Python
  // `detail=` string, all eight below answered `{ code: "UNKNOWN", status: 500 }`
  // — "we could not classify this failure" — for faults the service had
  // classified precisely. The other twelve render through a different classifier
  // and take reasoned rows in `VENUE_WIRE_CODES_WITHOUT_VERDICT` instead.
  //
  // ⚠️ THE FAMILY IS NOT MT5-SPECIFIC. It was FOUND through the mt5-gateway
  // incident, but `EXCHANGE_PROBE_FAILED` is a 424 with `retryable=True` and
  // `dependency=<the caller's venue>` raised by `validate_key`'s
  // `except ccxt.BaseError` arm on EVERY venue — the ordinary "your exchange did
  // not finish the permission check" case, rendering as the terminal that admits
  // knowing nothing.
  //
  // HOW EACH MEMBER WAS CHOSEN, because a plausible member is not a true one.
  // Rule: take the most specific member every one of whose claims is measured
  // TRUE at EVERY emitter that can reach this function. Two members' copy makes
  // a "nothing was submitted" claim, and that claim is knowable only where no
  // request was issued (the trap is written out at the transport block below and
  // was the whole of 140.3-12) — so each candidate was read at its emitter
  // rather than matched on its name.
  //
  //   MT5_GATEWAY_UNREACHABLE — 503, `retryable=True`, with a Retry-After. BOTH
  //     emitters are the connect stage of `_connect_and_probe`: the stage
  //     deadline firing, and the broad connect failure. The socket connect WAS
  //     attempted and no answer came back, which is `SERVICE_UNREACHABLE`'s
  //     sentence exactly. ⛔ NEVER `SERVICE_UNAVAILABLE_RETRY`: its copy says the
  //     request was never sent, which is knowable for a breaker that DECLINED to
  //     send and false-by-construction here. Status 503 rather than 502 because
  //     the emitter's own status is 503 and it stamps a Retry-After, which is
  //     defined for 503 — the wire answer stays the one the service chose.
  //   EXCHANGE_PROBE_FAILED — 424, `retryable=True`, `dependency=req.exchange`.
  //     Same fact as the incumbent `PROBE_FAILED` row three screens up (the probe
  //     ran against the venue and did not complete), told by a different
  //     producer, so it takes the same member and the same 503.
  //   EGRESS_PROXY_MISCONFIGURED — 500, `retryable=False`. `_validate_sfox_key`
  //     raises at client CONSTRUCTION, ABOVE the `get_balances()` try, so no
  //     request left the process and no state changed. That is what makes
  //     `SEAM_MISCONFIGURED`'s "we stopped before sending the request. Nothing
  //     was submitted and nothing was changed" knowable here rather than assumed.
  //   SERVICE_KEY_UNCONFIGURED — 500, `retryable=False`. `verify_service_key` is
  //     HTTP middleware and refuses BEFORE `call_next`, so no handler ran, no
  //     venue was contacted and no row was written. The purest case for that
  //     copy. ⚠️ RENDERING ONLY — no gate logic is touched by this row, and the
  //     copy names a remedy, never the secret.
  //   KEK_UNAVAILABLE — 500, `retryable=False`. `encrypt_key`'s first statement
  //     is `get_kek()`; its RuntimeError fires before any ciphertext exists and
  //     before the create RPC is reached, so the same claim holds.
  //   MT5_GATEWAY_UNCONFIGURED, ADAPTER_INIT_FAILED, INTERNAL — all 500 and all
  //     `retryable=False`, and NONE of them can honestly take the copy above.
  //     `INTERNAL` fires after the venue probe was issued; `ADAPTER_INIT_FAILED`
  //     is a code fault, not a setting; `MT5_GATEWAY_UNCONFIGURED`'s D-31
  //     `undetermined` emitter fires after the gateway terminal ran and refused
  //     to classify, so the claim is false at one of its four emitters. They take
  //     `SEAM_INTERNAL_FAULT`, minted in this plan for exactly that gap — see its
  //     union-member comment for the per-emitter measurement. ⛔ Not
  //     `KEY_PROBE_FAILED`: it is recoverable, so it would render a Retry control
  //     against three faults that fail identically on every attempt.
  //
  // ROSTER COST, measured rather than assumed. `SEAM_MISCONFIGURED` needs NO
  // roster edit at either key step: both read `recogniseSeamErrorCode` FIRST and
  // `SEAM_CODE_TO_WIZARD_CODE` already carries the row, so the membership check
  // is never reached — which is what `ConnectKeyStep`'s own docblock says, and
  // adding it to the roster would contradict that file's stated design.
  // `SEAM_INTERNAL_FAULT` is deliberately NOT in that table (it is minted by us,
  // not put on the wire by another service), so it takes the two roster rows.
  // `SERVICE_UNREACHABLE` and `KEY_PROBE_FAILED` are already in both.
  ["MT5_GATEWAY_UNCONFIGURED", { code: "SEAM_INTERNAL_FAULT", status: 500 }],
  ["MT5_GATEWAY_UNREACHABLE", { code: "SERVICE_UNREACHABLE", status: 503 }],
  ["EGRESS_PROXY_MISCONFIGURED", { code: "SEAM_MISCONFIGURED", status: 500 }],
  ["SERVICE_KEY_UNCONFIGURED", { code: "SEAM_MISCONFIGURED", status: 500 }],
  ["KEK_UNAVAILABLE", { code: "SEAM_MISCONFIGURED", status: 500 }],
  ["EXCHANGE_PROBE_FAILED", { code: "KEY_PROBE_FAILED", status: 503 }],
  ["ADAPTER_INIT_FAILED", { code: "SEAM_INTERNAL_FAULT", status: 500 }],
  ["INTERNAL", { code: "SEAM_INTERNAL_FAULT", status: 500 }],
]);

/**
 * 140.5-02 / SEAMPROSE-03 — the wire codes `VENUE_WIRE_CODE_TO_VERDICT`
 * deliberately does NOT answer for, each with the reason, MEASURED.
 *
 * Exported for the parity guard in `seam-venue-vocabulary.invariant.test.ts`,
 * which derives the emitted-code population from the Python sources and
 * requires every member of it to have a disposition: a row above, or an entry
 * here. Without this half the guard would demand a verdict row for codes that
 * correctly have none, and the pressure would be to invent one.
 *
 * ⚠️ EVERY REASON BELOW WAS VERIFIED BY REPLAYING THE REAL PYTHON DETAIL STRING
 * THROUGH `classifyKeyValidationError`, not guessed. The guard's companion unit
 * tests assert the replayed verdicts, so a reason that stops being true reds.
 */
export const VENUE_WIRE_CODES_WITHOUT_VERDICT: ReadonlyMap<string, string> =
  new Map([
    [
      "UNSUPPORTED_EXCHANGE",
      "Detail: 'Unsupported exchange for permission verification.' Reaches the " +
        "cascade's terminal UNKNOWN/500, and that is the HONEST answer: it is " +
        "our own configuration gap (the exchange is absent from EXCHANGE_CLASSES), " +
        "not a fault in the user's key, and no KEY_* copy would be true of it. " +
        "A dedicated member is a real improvement and is NOT this plan's.",
    ],
    [
      "VALIDATION_UNEXPECTED",
      "Detail: 'Key validation failed unexpectedly. Contact support if this " +
        "persists.' It is BY DEFINITION the unclassified residue of the Python " +
        "side's own classification, so mapping it to a specific wizard verdict " +
        "would manufacture a diagnosis the producer explicitly declined to make. " +
        "UNKNOWN/500 is the correct answer for an unclassified throw.",
    ],
    [
      "MT5_MASTER_PASSWORD",
      "Already reaches KEY_MT5_MASTER_PASSWORD/400 through the cascade's " +
        "'master password' branch, whose collision invariant is stated and " +
        "checked in-file. A table row would be correct but redundant, and the " +
        "MT5 detail strings are pinned byte-identically against closed_sets.py " +
        "so a Python reword reds there rather than silently here.",
    ],
    [
      "MT5_WRONG_SERVER",
      "Same as MT5_MASTER_PASSWORD: reaches KEY_MT5_WRONG_SERVER/400 through " +
        "the 'broker server' branch, pinned byte-identically.",
    ],
    [
      "CSV_TOO_LARGE",
      "CSV-surface code. It never reaches classifyKeyValidationError at all — " +
        "the CSV branch renders through the route's own vocabulary and " +
        "WIZARD_ERROR_COPY.CSV_FILE_TOO_LARGE, which interpolates the observed " +
        "size. Disposition is BY FAMILY, not by row.",
    ],
    [
      "CSV_FORMAT_UNSUPPORTED",
      "CSV-surface code, same family disposition as CSV_TOO_LARGE: rendered by " +
        "the route vocabulary, never by the key-validation classifier.",
    ],
    [
      "CSV_VALIDATION_FAILED",
      "CSV-surface code AND the static fallback of the DYNAMIC emitter below. " +
        "Rendered by CsvValidationEnvelope through WIZARD_ERROR_COPY, never by " +
        "this classifier.",
    ],
    // ── 153.7-02 / WIZFORM-02-CLASS — the twelve codes the widened scan found
    // that reach a user through some OTHER classifier ────────────────────────
    //
    // ⚠️ READ THIS BEFORE ADDING A THIRTEENTH. These twelve are TWELVE DIFFERENT
    // MEASUREMENTS, not one disposition applied twelve times. `CSV_FORMAT_UNSUPPORTED`
    // above is the shortest row in this table and it works only because it
    // explicitly back-references a sibling in the same family; twelve rows of
    // that shape would make this half of the coverage law cover everything and
    // assert nothing, which is the exact defect 153.7 exists to close. Each row
    // below names ITS OWN consuming route and ITS OWN arm, and each was read at
    // that arm rather than inferred from the code's name.
    //
    // ⭐ SEVERAL OF THESE STILL RENDER AS `UNKNOWN`, and the rows say so instead
    // of hiding it. That residue is REAL and it is recorded rather than papered
    // over — but it is not fixable from this table, because none of the routes
    // below calls `classifyKeyValidationError` at all. A verdict row for them
    // would be a change that cannot reach the surface it claims to fix, which is
    // a worse outcome than an honest exemption: it would read as a fix in the
    // diff and green the coverage law for nothing.
    //
    // Anchors are SYMBOLS throughout — functions, arms and machine codes — and
    // that is load-bearing here in a way it is not elsewhere: a `file.py:NNN`
    // inside one of these STRINGS would pass the citation guard, whose own
    // self-test asserts that a citation in a string literal is not an offence.
    // The rot would ship with the guard as its alibi.
    [
      "UNAUTHENTICATED",
      "Detail: 'Unauthorized', 401, raised by the `_gate_process_key` middleware " +
        "gate in main.py and reachable on the `/process-key` paths ONLY. It is " +
        "relayed to the browser BYTE-FOR-BYTE with its own status by " +
        "`postProcessKey` in process-key-client, which forwards a non-ok JSON " +
        "body unchanged and never classifies it, so it renders through the " +
        "SyncPreview and CSV surfaces rather than through any key-connect step. " +
        "⚠️ ONE NAME, TWO VOCABULARIES, recorded and deliberately NOT renamed: " +
        "six Next routes of our own mint `code: \"UNAUTHENTICATED\"` from " +
        "TypeScript for a missing Supabase session (portfolio-optimizer, " +
        "scenario/optimize, simulator, admin/match/recompute, admin/match/eval, " +
        "admin/strategy-review). Same precedent as RATE_LIMITED, which is our " +
        "limiter in one vocabulary and a venue throttle in the other: a shared " +
        "name is a fact to state, not a collision to fix by renaming.",
    ],
    [
      "INTERNAL_TOKEN_UNCONFIGURED",
      "Detail: 'Service not configured', 500, from the UNSET-SECRET arm of the " +
        "same `_gate_process_key` gate — the arm that runs FIRST, before any " +
        "comparison, precisely so an unset secret cannot compare equal to an " +
        "empty bearer and admit the request. It shares that gate with " +
        "UNAUTHENTICATED and NOT its disposition: this one is OUR " +
        "misconfiguration answered 500 retryable:false, where the sibling is a " +
        "caller fault answered 401. Both are relayed unclassified by " +
        "`postProcessKey`, so neither reaches this function. A verdict row here " +
        "would state a wizard verdict for a path with no wizard on it.",
    ],
    [
      "KEY_MISSING_EXCHANGE",
      "Detail: 'This API key has no exchange set and cannot be probed.', 422, " +
        "from `get_key_permissions` in internal.py — the caller's own stored row " +
        "carrying a NULL exchange column. It lands in the keys/[id]/permissions " +
        "route, which runs a FOURTH classifier with a private PROBE_* vocabulary. " +
        "Measured through that route's arms: the body is JSON with a nested " +
        "envelope, so the thrown message is the human sentence rather than the " +
        "`Upstream <status>` fallback, and it matches neither the config " +
        "sentinels nor the timeout needles — it exits as PROBE_FAILED 502 with " +
        "'Could not check key scopes. Try again.' That route's docblock records " +
        "why it is separate: routed through THIS classifier, five of its six real " +
        "messages fall to UNKNOWN/500, because every fault reachable there is a " +
        "proxy-infrastructure fault and this function classifies key faults.",
    ],
    [
      "KEY_UNDECRYPTABLE",
      "Detail: 'This stored key could not be decrypted. It must be reconnected.', " +
        "500 retryable:false, from `decrypt_credentials` failing inside " +
        "`get_key_permissions`. It shares the permissions route with " +
        "KEY_MISSING_EXCHANGE and is worth its own row because its REMEDY is " +
        "different and is the only actionable one in the pair: the user must " +
        "reconnect the key, and today the PROBE_FAILED envelope tells them to " +
        "'try again' — which cannot work for a ciphertext that will never " +
        "decrypt. That is a real gap, it belongs to the permissions route's own " +
        "vocabulary, and a row in this table cannot close it because that route " +
        "never calls this function.",
    ],
    [
      "ADMIN_CHECK_UNAVAILABLE",
      "Detail: 'actor admin check temporarily unavailable — please retry', 503, " +
        "from `recompute` in match.py when the actor's admin lookup fails. It " +
        "reaches only the admin match-recompute route, which forwards an upstream " +
        "4xx with the upstream's own machine code but sends everything 500-and-up " +
        "to its terminal arm — so a 503 answers the admin client as UNKNOWN/500 " +
        "with generic copy plus a Sentry capture. The route is admin-only and " +
        "never touches a key, so no wizard verdict is true of it; the honest fix " +
        "is a status-aware arm in that route, not a row here.",
    ],
    [
      "ROLE_CHECK_UNAVAILABLE",
      "Detail: 'profile role check temporarily unavailable — please retry', 503, " +
        "from `recompute` in match.py. Listed SEPARATELY from " +
        "ADMIN_CHECK_UNAVAILABLE rather than folded into it, because they are two " +
        "different lookups failing — the actor's admin flag and the profile's " +
        "role — and collapsing them is how a guard stops being able to tell an " +
        "operator which check went down. Same route, same terminal arm, same " +
        "reason a wizard verdict would be a fabrication: the match-recompute " +
        "surface has no key-connect step and no key.",
    ],
    [
      "SCORING_FAILED",
      "Detail: 'Scoring failed on our side. This has been logged.', 500 " +
        "retryable:false, from the match engine's scoring pass in `recompute`. " +
        "Unlike its two 503 siblings on the same route this one is PERMANENT — " +
        "the engine raised, and an identical retry re-raises — which is exactly " +
        "why it must not borrow a KEY_* verdict: every retryable member in this " +
        "table would offer a Retry control against a computation that fails the " +
        "same way each time. It renders through the admin route's terminal arm, " +
        "which is where the honest remedy belongs.",
    ],
    [
      "EVAL_WINDOW_TOO_LARGE",
      "A 400 from `eval_metrics` in match.py whose detail is COMPOSED at the " +
        "emitter (page count, page size and an optional hint), so no fixed string " +
        "can be quoted here — the first code in this table with that property, " +
        "and the reason its row names the shape instead. It is also the only one " +
        "of the twelve that already arrives INTACT: the admin match-eval route " +
        "forwards 4xx with `code: err.seamCode`, so the client receives " +
        "EVAL_WINDOW_TOO_LARGE verbatim at status 400. A row in this table would " +
        "translate a code that is already being read correctly, one vocabulary " +
        "further from its consumer.",
    ],
    [
      "EVAL_FAILED",
      "Detail: 'Eval failed on our side. This has been logged.', 500, the " +
        "unclassified residue of `eval_metrics` after its own typed arms have " +
        "run. It is the sibling of EVAL_WINDOW_TOO_LARGE on the same handler and " +
        "takes the OPPOSITE path out of the admin match-eval route: 500 misses " +
        "the 4xx forward and lands on the terminal arm. Being the producer's own " +
        "declared residue, mapping it to a specific wizard verdict would " +
        "manufacture a diagnosis the emitter explicitly declined to make — the " +
        "same ground VALIDATION_UNEXPECTED stands on above, reached from a " +
        "different service entry point.",
    ],
    [
      "ANALYTICS_ROW_NOT_CREATED",
      "Detail: 'Could not start the analytics computation — please retry.', 503, " +
        "from `_compute_portfolio_analytics` in portfolio.py when the analytics " +
        "row insert returns nothing. ⭐ IT REACHES NO USER AT ALL TODAY, and that " +
        "is measured rather than assumed: its only TypeScript entry point is " +
        "`computePortfolioAnalytics` in analytics-client, which has ZERO " +
        "production callers — a fact independently pinned in that module's own " +
        "test roster, in resilient-fetch's budget census and in the seam retry " +
        "registry. It is dispositioned here so the coverage law does not have to " +
        "guess, and the day a caller appears the row is what a reviewer will read.",
    ],
    [
      "PORTFOLIO_ANALYTICS_FAILED",
      "Detail: 'Portfolio analytics computation failed', 500, the outer catch of " +
        "the same `_compute_portfolio_analytics` computation. It shares " +
        "ANALYTICS_ROW_NOT_CREATED's zero-caller state and differs on the one " +
        "thing a disposition turns on: the sibling fires BEFORE the computation " +
        "starts and says 'please retry', while this one fires after it ran and " +
        "failed. If this endpoint ever gains a caller they need two different " +
        "sentences, which is the whole reason they are two rows and not a family " +
        "note.",
    ],
    [
      "SIMULATION_FAILED",
      "Detail: 'Portfolio impact simulation failed', 500, from " +
        "`portfolio_simulator` in simulator.py. Its consumer is the simulator " +
        "route, which — like the two admin match routes — forwards 4xx with the " +
        "upstream code and answers everything 500-and-up from its own terminal " +
        "arm, here with 'Portfolio impact simulation failed.' and code UNKNOWN. " +
        "That surface is the portfolio impact panel, which has no key, no draft " +
        "and no connect step, so every KEY_* and SEAM_* member in this table " +
        "would be describing a wizard the user is not in.",
    ],
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
  // A PLAIN OWN DATA PROPERTY, READ WITH `typeof` — NOT `instanceof`. Every
  // route test that mocks a seam client wholesale does
  // `vi.mock("@/lib/analytics-client")`, so
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

  // ⚠️ Phase 140.5-02 / SEAMPROSE-03 — B-02. OUR OWN TRANSPORT, READ BEFORE THE
  // MESSAGE IS SNIFFED, AND FOR THE SAME REASON THE BLOCK ABOVE IS.
  //
  // WHAT WAS BROKEN. The cascade below tests `lower.includes("timeout")`, and
  // the message `analytics-client` actually constructs says **"timed out"**.
  // `"timed out"` does not contain `"timeout"`. Replayed against the whole
  // cascade, all three of the client's producible messages answered
  // `{UNKNOWN, 500}` — the terminal that admits knowing nothing, with no retry
  // affordance — and the breaker cannot rescue it, because it needs 5 failures
  // in 30 s while a Railway outage arrives at human retry cadence with the
  // breaker still CLOSED. The ONE test that appeared to cover that branch
  // pinned `"connect ETIMEDOUT …"`, a raw undici syscall string this client
  // wraps before rethrowing, so it could never reach here.
  //
  // WHY BY TYPE AND NOT A WIDER NEEDLE. Adding `"timed out"` to the substring
  // is a per-site edit the next reword re-breaks, and it would still answer
  // `KEY_NETWORK_TIMEOUT` — copy that blames the EXCHANGE for a failure of our
  // own hop.
  //
  // A PLAIN OWN DATA PROPERTY, READ WITH `typeof` — NOT `instanceof`, for
  // exactly the mock-survival reason spelled out in the block above, and
  // resolved through the SHARED wire→wizard table rather than a second private
  // vocabulary. Both values (`UPSTREAM_TIMEOUT`, `UPSTREAM_NETWORK_ERROR`) are
  // already rows there, mapping to `SERVICE_UNREACHABLE`.
  //
  // WHY IT IS A SEPARATE FIELD FROM `seamCode`, and why the two cannot collide:
  // `seamCode` is what an UPSTREAM'S BODY declared; this is what OUR TRANSPORT
  // observed, on a path where no body exists. They are mutually exclusive by
  // construction, and keeping them apart is a security property — one field
  // carrying both would let an upstream put `"UPSTREAM_TIMEOUT"` in its
  // envelope and be handed our transport verdict.
  //
  // ⚠️ DO NOT COPY `SERVICE_UNAVAILABLE_RETRY`'s "Nothing was submitted" onto
  // this path. That claim is knowable for a breaker that DECLINED to send; it
  // is false-by-construction for a request that WAS issued and never answered.
  // 140.3-12 fixed that once. `SERVICE_UNREACHABLE`'s copy is the one that
  // states the uncertainty, which is why this maps there and not one line up.
  const transportCode = (
    error as { seamTransportCode?: unknown } | null | undefined
  )?.seamTransportCode;
  if (typeof transportCode === "string") {
    const wizardCode = recogniseSeamErrorCode(transportCode);
    // No `??` fallback, same as above: an unrecognised marker falls through to
    // the cascade rather than short-circuiting to UNKNOWN. 502 is the status
    // the seam already uses for "we could not reach it" (the venue table's
    // NETWORK_UNAVAILABLE row and the cascade branch this replaces both say
    // 502), so the wire answer is unchanged; only the code and its copy move.
    if (wizardCode !== "UNKNOWN") return { code: wizardCode, status: 502 };
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
 * ⭐ 153.7 review WR-02 — THE VERDICTS THAT ARE **OUR OWN DEFECT**, named
 * explicitly, because `code === "UNKNOWN"` had stopped being a proxy for it.
 *
 * ── WHAT WENT WRONG, AND WHY IT WAS SILENT ──────────────────────────────────
 *
 * Both key routes page Sentry (`step: "unclassified-key-error"`) on the
 * classifier's terminal verdict, and both justify the exclusion of everything
 * else in one sentence: *"None is our defect and none should page anyone."*
 * That sentence was TRUE while the only recognised verdicts were the breaker
 * short-circuit, the timeout and the caller-fault family.
 *
 * 153.7-02 added `VENUE_WIRE_CODE_TO_VERDICT` rows for `INTERNAL` and
 * `ADAPTER_INIT_FAILED` — `validate_key_permissions`' bare `except Exception`
 * residue and a `create_exchange` failure — and both are OURS by the Python
 * emitter's own words. Before that commit they resolved to `UNKNOWN` and
 * PAGED; after it they are recognised, so the predicate excluded them and the
 * new route tests asserted the silence. Classifying a fault better is not a
 * reason to stop hearing about it, and nothing in the diff said we had.
 *
 * ── WHY A SET AND NOT AN AMENDED COMMENT ────────────────────────────────────
 *
 * Amending the sentence to say "…except the two we now recognise, which the
 * Python side captures anyway" was the cheaper option and was rejected: the
 * Python capture is an incidental `LoggingIntegration` side effect of
 * `logger.exception`, it carries none of the Next-side `surface` / `exchange`
 * tags, and it would leave the SAME trap armed for the next our-defect verdict
 * anyone adds — the recognised set is going to keep growing, that is what
 * WIZFORM-02-CLASS is for. Naming the population makes the policy mechanical
 * instead of a proxy that decays every time the classifier gets better.
 *
 * ⛔ MEMBERSHIP IS A PAGING DECISION, NOT A SEVERITY LABEL. Add a code here
 * only when the fault is in code or configuration WE own — never a venue
 * refusal, a caller fault, a breaker trip or a timeout. `SEAM_INTERNAL_FAULT`
 * qualifies at all three of its wire codes (`MT5_GATEWAY_UNCONFIGURED`,
 * `ADAPTER_INIT_FAILED`, `INTERNAL`); `SEAM_MISCONFIGURED` never reaches this
 * check on the key routes (its wire codes are translated at the step, and the
 * classifier hands the route the wizard code directly), so it is deliberately
 * absent rather than forgotten — add it the day a key route can answer it.
 *
 * ⚠️ ONE SET, BOTH ROUTES. `create-with-key` and `composite/add-key` are
 * byte-identical twins at this arm, and fixing one path of that pair is this
 * milestone's most repeated mistake. A route-local literal would drift on the
 * next edit; this import cannot.
 */
export const OUR_DEFECT_KEY_ERROR_CODES: ReadonlySet<WizardErrorCode> =
  new Set<WizardErrorCode>([
    // The classifier's terminal — a failure we could not name at all.
    "UNKNOWN",
    // 153.7-02's minted member. `INTERNAL` and `ADAPTER_INIT_FAILED` are our
    // defect by the emitter's own words; `MT5_GATEWAY_UNCONFIGURED` is our
    // operator configuration. All three are worth a page and none is the
    // caller's doing.
    "SEAM_INTERNAL_FAULT",
  ]);

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
 * today. `SEAM_DEGRADED` and the venue codes have no wizard member of their own
 * name; writing the mapping as `code as WizardErrorCode` would silently admit
 * every one of them.
 *
 * ⚠️ RE-CUT 2026-08-14 (153.7-03 / WIZFORM-02-CLASS). The sentence above used
 * to name `MT5_GATEWAY_UNREACHABLE` alongside `SEAM_DEGRADED` and add that all
 * of them "correctly answer UNKNOWN". That premise is gone: 153.7-02 gave the
 * code a row in `VENUE_WIRE_CODE_TO_VERDICT`, which answers
 * `SERVICE_UNREACHABLE` at 503 — and answering UNKNOWN for it was never
 * "correct", it was the live WIZFORM-02 defect, measured on PROD. The code is
 * kept as an example of what an IDENTITY RULE would wrongly admit, which is the
 * claim this paragraph actually needs and the only one still true of it: it has
 * no wizard member of its own name, and it is absent from THIS table on
 * purpose. The two tables are separate mechanisms — a verdict row is read from
 * the thrown error's `seamCode` inside `classifyKeyValidationError`, this table
 * from a body's `code` at a different call site — so a verdict row neither
 * implies nor needs an alias row, and `wizardErrors.invariant.test.ts` asserts
 * that this table still does NOT contain it.
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
 * ⚠️ THAT PARAGRAPH USED TO END BY NAMING `draft_state_invalid` and
 * `COMPOSITE_UNSUPPORTED_UNIFIED` as two more codes reaching SubmitStep without
 * a wizard member, recorded in the TS-35 ledger and out of scope. **As of Phase
 * 153.1 both ARE wizard members** (`DRAFT_STATE_INVALID`,
 * `COMPOSITE_UNSUPPORTED_UNIFIED`), minted because WIZFORM-02's criterion —
 * "no wizard failure renders UNKNOWN when the server DID classify it" — covers
 * them by its own words: `finalize-wizard` classified both precisely and the
 * client rendered "we could not classify this failure" anyway. The old sentence
 * is replaced rather than left standing, because prose whose premise has broken
 * is the Pitfall-1 class this sub-phase exists to close.
 *
 * ⛔ NEITHER IS ADDED TO THE MAP BELOW, and the omission is deliberate. This
 * table translates codes another service put on the wire; those two are minted
 * by our OWN route, so aliasing them would be the "vocabulary starts lying"
 * failure this docblock warns about one paragraph up. `CIRCUIT_OPEN` stays an
 * alias, unchanged.
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
  // 140.3-15 / TS-38. Unlike the three above this is NOT an alias: the wire
  // code and the wizard member share a name because they stand for the same
  // fact. It is still listed EXPLICITLY rather than admitted by an identity
  // rule — writing the mapping as `code as WizardErrorCode` would silently
  // admit `SEAM_DEGRADED`, `MT5_GATEWAY_UNREACHABLE` and every venue code too,
  // which is the reason this table is explicit at all.
  ["SEAM_MISCONFIGURED", "SEAM_MISCONFIGURED"],
  // 140.5-02 / SEAMPROSE-03 — AN ALIAS, in the `CIRCUIT_OPEN` sense rather than
  // the `SEAM_MISCONFIGURED` one: the CSV surface's LOCAL NAME for a fact
  // `RATE_LIMITED` already stands for. Both CSV routes answer their own
  // per-session throttle with `code: "CSV_RATE_LIMIT"` and a stamped
  // `Retry-After`; that header is the ONE wait the CSV surface actually
  // advertises, and without this row the code resolves "UNKNOWN" and the wait
  // is discarded on the way to the envelope.
  //
  // ⚠️ IT IS DELIBERATELY NOT A `WizardErrorCode`, AND THE ABSENCE IS
  // LOAD-BEARING — do not "complete" this by minting a member or adding it to a
  // `KNOWN_*` roster. 140.5-05's arm tries the already-known-code branch BEFORE
  // this table; admitting `CSV_RATE_LIMIT` there would keep the route's local
  // copy and the stamped wait would never reach the shared envelope.
  //
  // Listed EXPLICITLY, like every other row: an identity rule would silently
  // admit every future `CSV_*` name too.
  ["CSV_RATE_LIMIT", "RATE_LIMITED"],
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
 * `CsvValidationEnvelope.tsx`'s `CsvValidationEnvelopeProps` so
 * `wizardErrors.ts` owns every user-visible CSV-branch string.
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
