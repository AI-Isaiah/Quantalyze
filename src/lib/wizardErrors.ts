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
import {
  MAGNITUDE_CAPS,
  venueIsSubstitutable,
  type SupportedExchange,
} from "./closed-sets";

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
  // 161-05 / WIZERR-03 — THE THIRD ANSWER THE VENUE FENCE OWED, and the one
  // `create-with-key` explicitly DECLINED to mint. Its 23505 race arm carried
  // the rationale it was declined under: minting a member "would move the
  // copy-table pins (EXPECTED_TABLE_SIZE) for a state the user cannot act on
  // differently anyway".
  //
  // ⛔ THAT SECOND HALF IS NOW FALSE, AND ITS FALSENESS IS WHY THIS MINTS.
  // WIZERR-03 establishes that a remedy DOES exist — connect a different
  // account — so the user CAN act differently. What the fallthrough actually
  // bought was a cheaper pin move, paid for with a false sentence.
  //
  // WHAT RENDERED BEFORE: the byte-pinned `DRAFT_ALREADY_EXISTS` 409, false on
  // BOTH halves here. "A wizard session with this key is already in progress" —
  // there is no session, and that is MEASURED at the resolver rather than
  // assumed: this arm is reached precisely because no `source='wizard'` /
  // `status='draft'` row survives, so `resolveByVenueIdentity` never returns
  // `kind:"draft"` on it. And the remedies that entry offers (`resume_draft`,
  // `start_fresh`) send the user to a draft that does not exist and then offer
  // to delete it.
  //
  // ⛔ NOT AN ALIAS IN `SEAM_CODE_TO_WIZARD_CODE`, on `STALE_CLIENT`'s rule
  // above: that table translates codes ANOTHER service put on the wire. This
  // one is minted by our own route, so it is a wizard member outright.
  //
  // ⚠️ AND NO INCUMBENT COULD TAKE IT. The two nearest were read AT THE EMITTER
  // rather than matched on their names:
  //   · `DRAFT_ALREADY_EXISTS` — see above; no draft exists on this arm.
  //   · `VENUE_ALREADY_CONNECTED` — "already backs a strategy of yours". Here
  //     NOTHING backs it: the emitter is reached only after the owner read came
  //     back EMPTY, so that sentence asserts a strategy the server has just
  //     measured is absent, and its first remedy ("open the strategy that
  //     already uses this account") is unwinnable by construction.
  //
  // RECOVERABLE — DERIVED, NOT DECLARED. `actions` carries `try_another_key`, a
  // member of `RECOVERABLE_ACTIONS` (src/lib/envelope.ts), so `buildEnvelope`
  // derives `recoverable: true` and a Retry control renders. That is honest
  // only because of two MEASURED facts, and it stops being honest if either
  // changes:
  //   · 161-04 made "Try another key" a pure step transition — it no longer
  //     deletes the draft, so the one remedy offered here cannot destroy the
  //     work it was offered to save;
  //   · on ConnectKeyStep the Retry control is `onRetry={() => setErrorCode(null)}`
  //     — it clears the banner and returns the user to the form. It does NOT
  //     resubmit.
  // ⛔ WHICH IS WHY `clear_and_retry` IS ABSENT. Its whole meaning is "send the
  // same thing again", and the same key is refused identically — the DB index
  // is what refused it, and nothing about the second attempt differs.
  | "KEY_ORPHANED"
  // 162-05 / D-162-3 — the USE-EXISTING-KEY arm's one refusal: the request named
  // a stored key to reuse, and no LIVE key of the caller's matches it.
  //
  // ⛔ ONE CODE FOR THREE STATES ON PURPOSE — "not yours", "no longer exists"
  // and "soft-disconnected". Splitting them would publish an ownership oracle
  // for key ids to anyone who can post this route, and the user's remedy is
  // identical in all three: there is nothing to reuse, so connect the account
  // with credentials instead. The route emits it from TWO sites (the pre-RPC
  // ownership refusal and the RPC's own `no_data_found` raise, which is the
  // TOCTOU window between the two) and both mean exactly this sentence.
  //
  // ⚠️ AND NO INCUMBENT COULD TAKE IT, read AT THE EMITTER rather than matched
  // on names:
  //   · `KEY_ORPHANED` — "This key is already stored, but nothing uses it."
  //     Its whole premise is that the key IS stored and IS the caller's. Here we
  //     have just measured that no live key of theirs matches, so the sentence
  //     asserts the opposite of what the reads found, and its second remedy
  //     (email us to release the stored key) points at a key that is not there.
  //   · `VENUE_ALREADY_CONNECTED` — "already connected to an existing
  //     strategy". Nothing is connected on this arm; that code IS emitted by
  //     this same arm for the case where something is, which is precisely why
  //     it cannot also carry this one.
  //   · `STALE_CLIENT` — its title ("This page is out of date") is arguably
  //     true for the reachable population, but its CAUSE names a deploy skew:
  //     "this tab has been open since before we changed how keys are added, so
  //     it sent us a request we no longer accept". The request shape here is
  //     current and accepted; only the key it names is gone. A code whose title
  //     fits and whose cause lies is not a fit.
  //   · `DRAFT_ALREADY_EXISTS` / `GATE_DRAFT_GONE` — both speak about a draft.
  //     This refusal is reached before any draft is read or written.
  //
  // RECOVERABLE — DERIVED, NOT DECLARED, on `KEY_ORPHANED`'s own reasoning:
  // `try_another_key` is a member of `RECOVERABLE_ACTIONS`, and the remedy it
  // names IS reachable from the one screen that renders this refusal — unlike
  // on `KEY_ORPHANED`, where the same account is refused identically every
  // time.
  //
  // ⚠️ WHICH SCREEN THAT IS, RE-MEASURED (162-06 review / B-2). This code has
  // exactly one client emitter — ConnectKeyStep's reuse arm — and that arm
  // exists only in the PRESELECT sub-state, which RETURNS EARLY, before the
  // credential form is rendered at all. What stands behind the banner there is
  // the saved-key panel, "Continue with this key" (refused identically every
  // time) and a "Use a different key" control. The credential form is therefore
  // NOT behind the banner on this path: it is ONE CONTROL AWAY, which is why
  // the first fix line names that control instead of a form the reader cannot
  // see, and why ConnectKeyStep wires the envelope's Retry to the same control
  // so both routes land on the form the line promises.
  // ⛔ DO NOT RESTORE the pre-B-2 sentence ("on ConnectKeyStep the Retry
  // control clears the banner and returns the user to the credential form"). It
  // described the form-rendering branch, which this refusal never reaches; as
  // written it justified recoverability with a screen the user is not on.
  // ⛔ NOT `clear_and_retry`: re-posting the same `reuse_api_key_id` is refused
  // identically, because the key it names still does not exist.
  | "KEY_REUSE_UNAVAILABLE"
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
  // 161-07 / WIZERR-09 — the 7-day floor on a DAILY-RETURN series, which the
  // wizard could not render until this commit.
  //
  // WHAT RENDERED BEFORE: `UNKNOWN`. `gateFailureToWizardError` answered
  // `INSUFFICIENT_CSV_HISTORY` with the generic unknown-error sentence under a
  // comment asserting the code "never flows through the wizard error mapper" —
  // true only for as long as the wizard's composite arm declined to evaluate
  // the floor at all (`SyncPreviewStep.tsx`, "NOT ADDRESSED, deliberately").
  // This member and that arm's floor land in ONE commit precisely so no build
  // exists in which the wizard can refuse on row count and then explain the
  // refusal with "something went wrong".
  //
  // ⛔ NOT AN ALIAS. `SEAM_CODE_TO_WIZARD_CODE` translates codes ANOTHER
  // service put on the wire; this one is minted by our own `strategyGate.ts`
  // and reaches the mapper through `gateFailureToWizardError`. A union member
  // outright, per the ⛔ block above.
  //
  // ⚠️ WHY EACH NEAR NEIGHBOUR WAS REJECTED, read at the gate's own arms:
  //   · `GATE_INSUFFICIENT_DAYS` measures CALENDAR SPAN between the earliest
  //     and latest TRADE (`strategyGate.ts` `computeSpanDays`), and is
  //     unreachable on the daily-returns branch — a strategy here has zero
  //     trades by construction, so it has no trade span to be short of.
  //   · `GATE_INSUFFICIENT_TRADES` is the sentence this whole phase exists to
  //     stop showing to strategies that have a return series and no fills.
  //   · `GATE_SERIES_PROVENANCE_UNVERIFIED` answers a DIFFERENT question. This
  //     series HAS an admitted completeness verdict — the floor is evaluated
  //     only inside the admitted branch. It is short of DAYS, not of
  //     provenance.
  //
  // RECOVERABLE — DERIVED, NOT DECLARED. `actions` carries `clear_and_retry`, a
  // member of `RECOVERABLE_ACTIONS` (src/lib/envelope.ts), so `buildEnvelope`
  // derives `recoverable: true` and a Retry renders. Honest here because on
  // SyncPreviewStep `clear_and_retry` is what `kickoffRetryCanChangeTheOutcome`
  // keys off: the Retry is wired to `handleKickoffRetry`, which RE-RUNS THE
  // SYNC rather than resubmitting the same payload. A re-derive that reaches
  // further history is exactly the thing that clears this floor.
  | "GATE_INSUFFICIENT_CSV_HISTORY"
  // 161-07 / WIZERR-10 — a producer DID record how the daily series was built,
  // and the record does not establish a complete track record.
  //
  // WHAT RENDERED BEFORE: `GATE_INSUFFICIENT_TRADES`, i.e. "This account does
  // not have enough trade history yet" over the gate sentence "Strategy has
  // only 0 trade(s). A minimum of 5 trades is required." — about a strategy
  // carrying a full daily-return series and zero fills BY CONSTRUCTION. False,
  // unwinnable, and (until 161-04) offering a remedy that deleted the draft.
  //
  // ⛔ NOT AN ALIAS — minted by our own `strategyGate.ts`, same ground as the
  // member above.
  //
  // ⚠️ WHY EACH NEAR NEIGHBOUR WAS REJECTED, read at the gate arm rather than
  // matched on the name:
  //   · `GATE_INSUFFICIENT_TRADES` is the incumbent this replaces, and its own
  //     copy says why it cannot serve: "We need at least 5 filled trades…
  //     Sharpe on fewer trades would be noise." Nothing here is about trade
  //     count.
  //   · `GATE_SERIES_PROVENANCE_UNVERIFIED` is the OPPOSITE case and its copy
  //     says so out loud — "nothing on our side recorded how that series was
  //     built", and its remedy is a re-sync that makes a producer look. Here a
  //     producer DID look and its record is the reason for the refusal, so a
  //     re-sync re-derives the same verdict and changes nothing.
  //   · `GATE_INSUFFICIENT_DAYS` measures a trade span that does not exist on
  //     this branch.
  //
  // RECOVERABLE — DERIVED, NOT DECLARED, AND `clear_and_retry` IS DELIBERATELY
  // ABSENT. `try_another_key` alone is in `actions`, so `buildEnvelope` derives
  // `recoverable: true` and a Retry does NOT render on SyncPreviewStep (that
  // step passes `onRetry` only when the code asks for `clear_and_retry`). That
  // is the honest arrangement: re-running the sync re-derives the SAME series
  // by the SAME method and earns the SAME verdict — `fill_derived_unproven` is
  // stamped unconditionally for its venues, and a historical NAV hole does not
  // heal. Offering Retry here would be a placebo on a permanent refusal.
  //
  // ⚠️ `try_another_key` IS SAFE TO OFFER, and that is a MEASURED fact with a
  // date on it. 161-04 / WIZERR-02 made `onTryAnotherKey` a pure step
  // transition; before that it fired `handleDeleteDraft()`, and offering it
  // here would have answered "your venue's data cannot prove a complete record"
  // by destroying the user's draft.
  | "GATE_SERIES_EXAMINED_REFUSED"
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
  // 160-05 review / WIZFORM-02-CLASS — THE ONE CODE `keys/validate-and-encrypt`
  // PUTS IN FRONT OF A USER THAT NEITHER VOCABULARY ANSWERED. RANK-03 turned
  // that route's `persist` discriminator into a GATE: a body without
  // `persist: true` is refused 409 with `code: "STALE_CLIENT"`, and the only
  // thing that sends such a body is a tab loaded before that conversion — the
  // page we serve today always sends the field. Until this member existed the
  // code was in NEITHER this union NOR `SEAM_CODE_TO_WIZARD_CODE`, so
  // `recogniseSeamErrorCode` answered `UNKNOWN` and the one remedy that always
  // works — reload — collapsed into the terminal that admits knowing nothing.
  //
  // ⛔ NOT AN ALIAS IN `SEAM_CODE_TO_WIZARD_CODE`, on `COMPOSITE_UNSUPPORTED_UNIFIED`'s
  // rule rather than a fresh one: that table translates codes ANOTHER service
  // put on the wire. This one is minted by our own route, so it is a wizard
  // member outright.
  //
  // ⚠️ AND NO INCUMBENT MEMBER COULD TAKE IT. The two whose copy already names
  // a reload were read AT THIS EMITTER rather than matched on their names:
  //   · `DRAFT_STATE_INVALID` — "This draft has moved on since this page
  //     loaded", and its cause offers "already submitted from another tab".
  //     This route reads no draft and finalizes nothing, so every clause is
  //     false here and its remedy sends the user to a draft that has nothing to
  //     do with the refusal.
  //   · `SESSION_EXPIRED` — "You have been signed out." The caller is signed
  //     IN: this refusal sits below `withAuth`, so the session was already
  //     proven when the body was inspected.
  // ⛔ AND NEVER A `KEY_*` MEMBER. The refusal fires before `validateKey`,
  // before `encryptKey` and before the insert, and it turns on ONE missing
  // field of our own request shape. Blaming the user's key or credentials for
  // it is the "copy that asserts something false" class this vocabulary exists
  // to kill, and here it would send them to regenerate a key that is fine.
  //
  // NOT recoverable, deliberately: `actions` carries neither member of
  // `RECOVERABLE_ACTIONS` (src/lib/envelope.ts), so `buildEnvelope` derives
  // `recoverable: false` and `ErrorEnvelope` renders NO Retry control — the same
  // mechanism `DRAFT_STATE_INVALID` and `ALLOCATION_NOT_ALLOCATABLE` use.
  // Pressing Retry from the stale page re-posts the identical body and is
  // refused identically; only a RELOAD replaces the code that omits the field.
  //
  // ⚠️ NOTHING RENDERS IT TODAY, and that is why it is authored now. All THREE
  // live callers of the route (`AllocatorExchangeManager.tsx`,
  // `ApiKeyManager.tsx`, `StrategyForm.tsx`) print the route's `error` sentence
  // verbatim and never read `code`, and they sit OUTSIDE the wizard-steps population
  // `seam-wire-vocabulary.invariant.test.ts` derives (that file's own DECLARED
  // BLINDNESS note), so nothing in CI would have caught the gap. The member is
  // written ahead of its first reader for the reason `SEAM_DEADLINE_EXCEEDED`
  // was: a code with no copy entry falls through to UNKNOWN exactly as a
  // missing code does, so the copy must exist before the client that reads it.
  | "STALE_CLIENT"
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
  // ─────────────────────────────────────────────────────────────────────────
  // 161-10 / WIZERR-07 — the DASHBOARD DIALOG family.
  //
  // Four members minted together for one population: the three dashboard write
  // dialogs (`AllocateDialog`, `RenameStrategyDialog`, `MarkOwnershipDialog`)
  // and the three routes behind them (`strategies/[id]/name`,
  // `strategies/[id]/ownership`, `portfolio-strategies/allocation`).
  //
  // ⭐ WHY A NEW FAMILY RATHER THAN REUSE. Every one of these four has a
  // near-neighbour in this union whose SUBJECT matches and whose SENTENCE does
  // not. The wizard members were written for a surface that has a draft, an
  // exchange key and a paste-the-secret step; a rename dialog has none of the
  // three. Reusing them would swap "we could not classify this failure" for a
  // sentence that is specific and FALSE, which is a worse trade than the one
  // this phase exists to make. The rejected near-neighbour is named at each
  // member below, read at that member's EMITTER, not guessed from its name.
  //
  // ⛔ NONE of the four is an alias in `SEAM_CODE_TO_WIZARD_CODE`. That table
  // translates codes ANOTHER service put on the wire; these are minted by our
  // own routes, so aliasing them there is the "vocabulary starts lying" failure
  // that table's docblock warns about. Recognition runs through
  // `DASHBOARD_DIALOG_ROUTE_CODES` — see its docblock for why the roster is
  // per-route and why it lives here rather than at each dialog.
  //
  // The caller is signed out. All three routes answer 401 `unauthorized` after
  // `supabase.auth.getUser()` returns no user, BEFORE any write is attempted.
  //
  // ⚠️ NOT `SESSION_EXPIRED`, and the rejection was read at that entry rather
  // than inferred from its name. Its cause says "Your wizard draft is saved on
  // our side — your form answers and preview are still there" and its fix says
  // "you will need to paste the secret once more before continuing". There is
  // no draft, no form answers, no preview and no secret on a dashboard dialog:
  // both sentences would be false, and the second is an instruction the user
  // cannot follow (Principle 2 — the remedy must be able to succeed).
  //
  // Recoverable: NO. `actions` carries neither member of `RECOVERABLE_ACTIONS`
  // (src/lib/envelope.ts), so `buildEnvelope` derives `recoverable: false` and
  // no Retry control renders. Re-issuing the identical request from a signed-out
  // session is refused identically until the user signs in, so a Retry here is
  // the false affordance `ALLOCATION_NOT_ALLOCATABLE` above removed for the
  // same reason.
  | "DASHBOARD_SIGNED_OUT"
  // The route refused the REQUEST SHAPE: a non-UUID id in the path, a body that
  // is not JSON, a mark outside the allowed set, a non-boolean confirmation
  // flag, a missing `strategy_id`, an amount outside the ticket bound. Every
  // one of these is a body THIS APPLICATION built — the user types a name or an
  // amount, never the envelope around it — so a shape refusal is our defect,
  // and the copy says so rather than implying the user mistyped something.
  //
  // ⚠️ NOT `VALIDATION_FAILED`, which is the closest member in this union and
  // whose title and cause are almost exactly right ("We could not read that
  // request… The fault is in our software"). Its FIX is what disqualifies it:
  // "Contact security@quantalyze.com with your draft ID". A dashboard dialog
  // has no draft and therefore no draft ID, so the one instruction it offers
  // cannot be carried out. Copying that entry and dropping the clause would
  // change what every wizard surface says; minting is the surgical move.
  //
  // Recoverable: NO. A malformed request re-sent unchanged is refused
  // identically — the same reasoning `VALIDATION_FAILED` records at its own
  // `actions`.
  | "DASHBOARD_REQUEST_INVALID"
  // Our own service failed BEFORE it sent anything that could change data.
  // Covers the `internal error` 500s whose failing statement is a READ:
  // `ownership` 500-a (the portfolio lookup) and 500-b (the position lookup),
  // `allocation` POST's strategy lookup and its `resolveRealPortfolio` fault,
  // and `allocation` DELETE's `resolveRealPortfolio` fault.
  //
  // ⭐ ONE MEMBER FOR ALL OF THEM, DELIBERATELY. Those sites differ by which
  // internal query failed, which is a distinction the user cannot act on and
  // must not be asked to: the situation ("we could not complete your change")
  // and the remedy ("nothing was saved — try again, and tell us if it repeats")
  // are identical at every one. Each site already logs its own distinct
  // server-side line, which is where the distinction belongs. Minting a code
  // per call site would put an internal call graph in front of a user.
  //
  // ⛔ 161-REVIEW / CR-01 — THE POPULATION NARROWED, AND THAT IS THE FIX.
  // 161-10 pointed this member at EVERY `internal error` 500 on all three
  // routes, including arms whose own comments say the outcome is unknown. Its
  // sentence says "Nothing was saved — the strategy is as it was before you
  // pressed save", which on those arms is a claim the code never established.
  // Read `:2470` in this file ("'NOTHING WAS SAVED' IS VERIFIED, NOT
  // ASSERTED") and `SEAM_RESPONSE_UNREADABLE`'s member note above, which
  // records the same rule from the other side: a code whose outcome is
  // unknowable may not say "Nothing was saved" — nor "it went through" — in
  // either direction. Those arms now answer
  // `DASHBOARD_WRITE_INDETERMINATE` below. THE SENTENCE HERE IS UNCHANGED,
  // byte for byte: what moved is which arms are entitled to it.
  //
  // ⭐ THE MEMBERSHIP RULE, so the next arm is classified rather than guessed:
  // an arm belongs HERE iff no statement that could alter the user's data has
  // been sent when it returns. Every member above fails on a SELECT. (The
  // allocation route's container-provisioning arms are the one place worth
  // reading twice — an INSERT into `portfolios` has been sent there, so they
  // are INDETERMINATE, even though the money write itself has not been
  // reached. "Probably only an empty container" is a guess, and the whole
  // point of the split is that we stop making those.)
  //
  // ⚠️ NOT `SEAM_INTERNAL_FAULT`, whose title is "Something failed on our side
  // while we checked this key" and whose cause promises "no key was stored".
  // No key is checked or stored on any of these three routes. ⚠️ And NOT
  // `SERVICE_UNAVAILABLE_RETRY` / `SERVICE_UNREACHABLE`, which both describe
  // the ANALYTICS SEAM being unavailable; these failures are inside our own
  // request handler and never crossed a service boundary.
  //
  // Recoverable: YES — `clear_and_retry` is a member of `RECOVERABLE_ACTIONS`,
  // so a Retry control renders. That is correct here and nowhere else in this
  // family: a failed READ is the one dashboard failure whose second attempt
  // genuinely may succeed (a query that errored once can succeed next time),
  // and because nothing was sent, a retry starts from the state the sentence
  // describes. The write it then performs is idempotent in effect — it sets a
  // name, a mark or an amount to a stated value — so a retry cannot double
  // anything.
  | "DASHBOARD_WRITE_FAILED"
  // ⭐ 161-REVIEW / CR-01 — Our own service failed AFTER a data-modifying
  // statement had already been sent, and we cannot tell what it did.
  //
  // Covers the `internal error` 500s on the three dashboard write routes whose
  // failing operation is a WRITE:
  //
  //   · `strategies/[id]/name` — the `strategies` UPDATE errored.
  //   · `strategies/[id]/ownership` — the flip RPC errored; the flip RPC
  //     returned no row; the plain `strategies` UPDATE errored.
  //   · `portfolio-strategies/allocation` — the three container-provisioning
  //     arms (an INSERT into `portfolios` was sent), the
  //     `portfolio_strategies` upsert errored, the upsert returned zero rows,
  //     and the DELETE errored.
  //
  // ── WHY "IT ERRORED" IS NOT "IT DID NOT HAPPEN" ─────────────────────────────
  //
  // Two distinct mechanisms, both readable from the routes' own code:
  //
  //   1. AN ERRORED WRITE IS NOT A VERIFIED ROLLBACK. `supabase-js` collapses a
  //      PostgREST error (statement rejected — rolled back, nothing saved) and a
  //      TRANSPORT failure (the statement may have committed and the answer was
  //      lost) into the SAME `{ data, error }` shape. None of these arms
  //      discriminates them, so none of them can verify which happened.
  //   2. A WRITE THAT RETURNS NO ROW IS NOT A WRITE THAT DID NOTHING. The
  //      allocation route says so itself at the arm — "RLS ate the row, or the
  //      conflict target drifted" — and "RLS ate the row" means the upsert
  //      SUCCEEDED and only the returning row was suppressed. The ownership
  //      route's flip arm says the same: "a RETURNS TABLE function that yields
  //      no row leaves the counts unknown."
  //
  // ⛔ WHY THIS IS A MONEY-PATH CORRECTNESS FIX AND NOT A COPY PREFERENCE. Two
  // of these arms sit behind operations that remove things:
  // `flip_capital_ownership_to_team_review` DELETES the caller's live positions
  // and sets the mark in one transaction, and the allocation upsert is the
  // money write itself. Telling a user "Nothing was saved" there can hand them
  // a screen that says their book is untouched while their positions are gone.
  //
  // ── WHAT THE COPY MAY NOT SAY, IN EITHER DIRECTION ──────────────────────────
  //
  // This is the "'NOTHING WAS SAVED' IS VERIFIED, NOT ASSERTED" rule recorded
  // at the `CSV_UPSTREAM_FAIL` entry below, applied where it bites. That entry
  // earns the clause
  // with three measured layers of no-write; nothing of the sort is available
  // here. And the obvious correction is a second false claim pointed the other
  // way — "your change went through" is a guess about a statement we never got
  // an answer to. `SEAM_RESPONSE_UNREADABLE` (above) is the house precedent for
  // exactly this shape and its copy is the model: claim only what IS
  // established (the attempt was made), then send the user to the one place
  // that settles it.
  //
  // ⛔ NOT recoverable, and the absence is load-bearing. `actions` carries
  // neither member of `RECOVERABLE_ACTIONS`, so `buildEnvelope` derives
  // `recoverable: false` and NO Retry control renders. The reason is NOT that a
  // retry is futile — it is that a retry is UNPREDICTABLE and, on the flip arm,
  // potentially destructive: a one-click Retry against a possibly-applied money
  // write is the unwinnable-remedy defect this phase exists to remove, wearing a
  // new hat. `leave_and_return` carries the first step of the ordered remedy —
  // re-read current state — the same control `SEAM_RESPONSE_UNREADABLE` and
  // `WIZARD_DUPLICATE` use to send a user to the record rather than at the
  // button again.
  //
  // ⚠️ NOT `DASHBOARD_WRITE_FAILED` (above): its sentence is the precise claim
  // this arm cannot make. ⚠️ NOT `SEAM_RESPONSE_UNREADABLE`: every clause of it
  // is about a submission crossing to the analytics service and that service
  // answering unreadably; these failures never left our own request handler and
  // there is no submission or strategies list to send the user to.
  | "DASHBOARD_WRITE_INDETERMINATE"
  // The row this dialog points at is not there in the form the action needs.
  // Covers every 404 on the three routes: `strategy not found` (wrong owner,
  // unknown id, or — on the name route — a PUBLISHED row refused by the D-17
  // status gate), `portfolio not found`, and `investment row not found`.
  //
  // ⭐ THE SENTENCE IS DELIBERATELY ABOUT THE LIST, NOT THE ROW. The routes
  // merge several causes into one 404 on purpose (distinguishing them would
  // leak row existence to a caller probing ids), so any copy naming a specific
  // cause would be a guess. What IS true of every one of them is that the page
  // the user is looking at describes a state the server no longer agrees with,
  // and that reloading the list is the action that settles it.
  //
  // ⚠️ NOT `GATE_DRAFT_GONE` ("This draft is no longer available") — there is
  // no draft. ⚠️ NOT `DRAFT_STATE_INVALID`, whose subject is also staleness but
  // whose every sentence is about a wizard draft. ⚠️ NOT `GUARD_BLOCKED`, which
  // asserts a permissions verdict this arm cannot establish.
  //
  // Recoverable: NO. The server answers 404 to the identical request until the
  // page is reloaded, so a Retry control would promise that pressing it changes
  // the outcome. `leave_and_return` names the action that does.
  | "DASHBOARD_ROW_STALE"
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
 *
 * ⭐ `preselect` IS A SURFACE OF ITS OWN, NOT A FLAVOUR OF `connect` — 162-06
 * review / B-2 class fix. `ConnectKeyStep` has TWO mutually exclusive renders,
 * and the second one paints a DIFFERENT SET OF CONTROLS:
 *
 *   · `connect`   — the credential form: labelled inputs, a Submit, and a
 *                   Retry that returns the reader to what they typed.
 *   · `preselect` — the saved-key summary. TWO controls exist and no others:
 *                   "Continue with this key" and "Use a different key". There
 *                   is NO credential form, NO field of any kind, NO draft
 *                   control, and nothing on the screen to fill in.
 *
 * ⛔ WHY THE DISTINCTION IS LOAD-BEARING AND NOT COSMETIC. A remedy that names
 * a control is only true of the screen that paints it, and this repo has now
 * shipped that lie twice from the same table: `KEY_REUSE_UNAVAILABLE` told the
 * reader the credential form "still works normally" on the one screen with no
 * form (162-06 review / B-2), and `DRAFT_ALREADY_EXISTS` + `KEY_MISSING_
 * REQUIRED_FIELD` were then found saying the same class of thing on the same
 * screen. Collapsing the two renders into one surface name is what made those
 * sentences unfalsifiable: `surface: "connect"` was TRUE of both, so no gate
 * could tell them apart.
 *
 * ⚠️ ABSENT SURFACE STILL MEANS "WE WERE NOT TOLD", for both the `surface` and
 * the `surfaceIsNot` requirement kinds — see each kind's own absence rule.
 */
export type WizardSurface =
  | "connect"
  | "preselect"
  | "submit"
  | "csv"
  | "allocate";

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
  | { readonly kind: "surface"; readonly surface: WizardSurface }
  /**
   * 161-05 / WIZERR-11 — "render only ON this venue". The THIRD kind the union
   * docblock above pre-authorised: one member here plus one arm in
   * `requirementMet`, and no new call site.
   *
   * ⚠️ NOT A CAPABILITY, AND THE DISTINCTION IS THE REASON THIS EXISTS.
   * `venueCapability` answers "is this venue the KIND of venue where X holds",
   * which is what makes one row cover a venue that behaves like MT5. The claim
   * this gates is not of that shape: "the key is the ClientId and the secret is
   * the ClientSecret" is a fact about Deribit's own naming, true of Deribit and
   * of nothing else by definition. Inventing a capability
   * (`clientIdCredentialNaming`) to express "is deribit" would be a capability
   * with exactly one possible member forever — the record's generality bought
   * back at the price of a name that lies about what it measures.
   *
   * ⛔ `venue` IS TYPED `SupportedExchange`, so a typo is a COMPILE error at the
   * table rather than a bullet that silently never renders — the same guarantee
   * `WizardSurface` gives the `surface` kind, and the reason neither carries a
   * bare `string`. It is a CLOSED-SET member compared for equality; it is never
   * interpolated into a sentence, a log line, a URL or a breaker key (D-17).
   *
   * ⚠️ ABSENT VENUE ⇒ SUPPRESSED. That is the OPPOSITE of the `venueCapability`
   * kind directly above, whose predicates are default-permissive so that a
   * caller predating `WizardErrorContext.venue` keeps its incumbent copy. The
   * divergence is deliberate and is the whole requirement: a bullet that names
   * ONE venue is, rendered with the venue unknown, a specific claim about a
   * user we cannot identify — the false sentence WIZERR-11 exists to remove.
   * The absence rule here matches `surface`'s ("fail toward saying less"), not
   * `venueCapability`'s, and the two must not be unified.
   */
  | { readonly kind: "venueIs"; readonly venue: SupportedExchange }
  /**
   * 162-06 review / B-2 (class) — "render EVERYWHERE EXCEPT this surface". The
   * FOURTH kind, added under the rule the union docblock above states: one
   * member here plus one arm in `requirementMet`, and no new call site.
   *
   * ⚠️ IT IS NOT `surface` NEGATED, AND THE ABSENCE RULE IS WHY. `surface`
   * SUPPRESSES when the caller names none ("fail toward saying less" — a claim
   * about a screen we were not told about is unverifiable). This kind RENDERS
   * when the caller names none, and that asymmetry is the entire reason it
   * exists rather than being folded into the other:
   *
   *   · a `surface` bullet is an ADDITION that only one screen has earned;
   *   · a `surfaceIsNot` bullet is an INCUMBENT that one screen has DISPROVED.
   *
   * Suppressing an incumbent on absence would silently delete a remedy from
   * every caller that predates the gate — the "silent copy deletion, not a
   * gate" failure `REQUIRES_DERIBIT`'s sibling slot is annotated against. The
   * default-permissive posture matches `venueCapability`'s for the same reason
   * (untagged callers keep their copy byte-for-byte), and the SWEEP in
   * `wizardErrors.test.ts` asserts BOTH halves: the bullet survives with no
   * surface named, and disappears on the one surface it is barred from.
   *
   * ⛔ It is a CLOSED-SET member compared for inequality, never interpolated.
   */
  | { readonly kind: "surfaceIsNot"; readonly surface: WizardSurface };

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

/**
 * "Render only on ConnectKeyStep's SAVED-KEY SUMMARY" — 162-06 review / B-2
 * (class). Its users are the refusals the reuse arm can put on that screen and
 * whose incumbent remedy names a control the screen does not paint.
 *
 * ⚠️ EVERY BULLET GATED ON THIS MAY NAME ONLY THESE TWO CONTROLS: "Continue
 * with this key" and "Use a different key". They are the whole screen. That is
 * asserted against the RENDERED DOM — not against this comment — by
 * `steps/ConnectKeyStep.preselect-refusal-class.test.tsx`, which reads both
 * labels off the tree and sweeps EVERY code the reuse arm can reach.
 */
const REQUIRES_PRESELECT_SURFACE: FixRequirement = {
  kind: "surface",
  surface: "preselect",
};

/**
 * "Render anywhere EXCEPT the saved-key summary" — the incumbent half of the
 * same pair. Tags a bullet that is TRUE on the credential form (and on every
 * caller that names no surface at all) and FALSE on the one screen with no
 * form, no fields and no draft controls.
 *
 * ⛔ Reach for this ONLY when the bullet is disproved on the preselect screen,
 * never to tidy a list: absence of a surface renders it, so a bullet tagged
 * here still reaches every untagged caller unchanged.
 */
const NOT_ON_PRESELECT_SURFACE: FixRequirement = {
  kind: "surfaceIsNot",
  surface: "preselect",
};

/**
 * "Render only on Deribit" — 161-05 / WIZERR-11's one user.
 *
 * ⚠️ ITS ONE BULLET IS A NAMING CLARIFICATION AND NOTHING ELSE. The generic
 * "re-copy both values" instruction stays UNCONDITIONAL one slot above it, so a
 * user on any venue — or on none we were told about — still gets a complete,
 * actionable remedy. Suppressing this bullet removes a Deribit-specific label,
 * never the instruction, which is what makes the strict absence rule safe here.
 */
const REQUIRES_DERIBIT: FixRequirement = { kind: "venueIs", venue: "deribit" };

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

  // 161-05 / WIZERR-11 — THIS ENTRY NAMED DERIBIT AT USERS OF EVERY OTHER
  // VENUE, TWICE.
  //
  // The `cause` carried "(e.g. Deribit returns invalid_credentials)" and the
  // second bullet ended "— on Deribit the key is the ClientId and the secret is
  // the ClientSecret". This code is returned by the SHARED
  // `classifyKeyValidationError`, so both sentences reached binance, okx, bybit,
  // sfox and mt5 users alike: a specific, checkable claim about a venue they are
  // not on, on the one card whose whole job is to tell them which of two values
  // is wrong. A user hunting for a "ClientId" in their Binance console is
  // looking for a different problem — the class this phase exists to remove.
  //
  // TWO DIFFERENT FIXES, because the two sentences failed differently:
  //   · the `cause`'s parenthetical was an ILLUSTRATION of a general fact and is
  //     simply DELETED. The sentence is complete and true without it, on every
  //     venue including Deribit, so there is nothing to gate;
  //   · the bullet carries REAL information for Deribit users, so it is SPLIT.
  //     The generic re-copy instruction stays unconditional (every venue keeps a
  //     complete remedy) and the venue-specific NAMING becomes its own bullet,
  //     gated on `REQUIRES_DERIBIT`.
  //
  // ⚠️ THE SPLIT BULLET IS THE UI-SPEC SENTENCE MINUS ITS TRAILING CLAUSE.
  // 161-UI-SPEC proposed "On Deribit the key is the ClientId and the secret is
  // the ClientSecret — re-copy both with no leading or trailing spaces." Kept
  // verbatim it would render DIRECTLY BELOW the unconditional bullet that now
  // says exactly that, so a Deribit user would read the same instruction twice
  // in adjacent bullets. The clause is dropped, not reworded: what is left is
  // the only part of the sentence that is venue-specific.
  //
  // ⛔ NO PER-CODE ARM WAS ADDED TO `formatKeyError` FOR THIS. The gate is one
  // `FixRequirement` constant and one index in `fixRequires`, filtered by the
  // single `applyFixRequirements` call — the mechanism `FixRequirement`'s own
  // docblock demands, and the reason a fourth venue-specific bullet costs a
  // declaration rather than a branch.
  KEY_AUTH_FAILED: {
    title: "The exchange rejected these credentials.",
    cause:
      "The exchange could not authenticate this key and secret. The exchange never accepted the pair, so the key or the secret is wrong, was regenerated, or was copied with extra whitespace.",
    fix: [
      "Open your exchange API Management page and confirm this key still exists and is enabled.",
      "Re-copy both values with no leading or trailing spaces.",
      "On Deribit the key is the ClientId and the secret is the ClientSecret.",
      "If the secret was only shown once at creation, create a fresh read-only key and paste both values here.",
    ],
    // Index-aligned to `fix`. Slot 2 is the only gated bullet; ⛔ slot 1 stays
    // `null` deliberately — gating the generic instruction to "not deribit"
    // would leave a venue-less caller with no re-copy instruction at all, which
    // is a silent copy deletion rather than a gate.
    fixRequires: [null, null, REQUIRES_DERIBIT, null],
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

  // ⚠️ 162-06 review / B-1 — THIS CODE HAS A SECOND EMITTER THAT RECEIVES NO
  // FIELDS AT ALL, so its remedy is now surface-split.
  //
  // `create-with-key`'s USE-EXISTING-KEY arm answers 400 with this code from its
  // own shape guard (a non-uuid `wizard_session_id` or `reuse_api_key_id`), and
  // that request body is TWO IDS — the caller typed nothing. The guard's own
  // comment says the refusal "is about OUR REQUEST SHAPE rather than about the
  // user's key — which is why it may not wear a `KEY_*` verdict that blames a
  // credential", and the incumbent bullets below did exactly that on the one
  // screen with no fields on it: "fill in every field shown" named a control
  // that is not painted, and "submit again" promised an outcome that a
  // deterministic shape rejection cannot deliver.
  //
  // ⛔ THE SPLIT IS BULLETS ONLY, AND THE REMAINDER IS DISCLOSED RATHER THAN
  // QUIETLY LIVED WITH: `fixRequires` gates `fix[]` and nothing else, so on the
  // preselect surface the TITLE and CAUSE still read as though a field were
  // blank. The whole fix belongs at the emitter — the reuse arm must stop
  // answering a credential-shaped code for a request that carries no
  // credentials — and lives in `create-with-key/route.ts`, not here. Until it
  // lands, the remedy at least names only what the reader can see.
  KEY_MISSING_REQUIRED_FIELD: {
    title: "One of the required fields is empty.",
    cause:
      "The form arrived without a value we need — one of the credential fields was blank, or the submission was incomplete. Nothing was sent to the exchange and nothing was stored.",
    fix: [
      "Fill in every field shown for the exchange you selected — the fields differ by exchange, so a slot that is optional elsewhere may be required here.",
      "Submit again once each one has a value.",
      // ── preselect-only. Two controls exist on that screen and neither is a
      // field, so nothing here asks the reader to type or to resubmit.
      "Nothing on this screen was left blank — this request carried no fields for you to fill, only the key you picked. Email security@quantalyze.com with the correlation id below: a request of ours that our own server refuses is ours to fix.",
      "“Use a different key” on this screen opens the credential form, which is a different request and may well go through. It is not a workaround for the refusal above, and pressing “Continue with this key” again sends the identical thing and is refused identically.",
    ],
    fixRequires: [
      NOT_ON_PRESELECT_SURFACE,
      NOT_ON_PRESELECT_SURFACE,
      REQUIRES_PRESELECT_SURFACE,
      REQUIRES_PRESELECT_SURFACE,
    ],
    docsHref: "/security#readonly-key",
    // ⚠️ `clear_and_retry` STAYS, and it stays for the credential emitter: there
    // the reader fills the blank field and resubmits, which is precisely "send
    // it again". On the preselect screen re-sending is provably futile, and the
    // control is withheld THERE, by the surface that knows it — ConnectKeyStep's
    // preselect branch passes no `onRetry` for a 400. Deleting the action here
    // would take the honest Retry away from the form as well.
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

  // ⛔ 162-06 review / B-2a — THE BLOCKING INSTANCE OF THE B-2 CLASS, and the
  // one the B-2 fix itself steers users into.
  //
  // REACHABILITY, MEASURED rather than assumed: `create_wizard_strategy_for_key`
  // inserts into `strategies` with the caller's `wizard_session_id`,
  // `strategies_user_wizard_session_source_uniq` (20260728120000) raises 23505,
  // and `create-with-key`'s reuse arm maps that 23505 here. Two live paths:
  //   · TOCTOU — the first "Continue with this key" landed server-side while the
  //     client's hop timed out. The client set `SERVICE_UNREACHABLE`, whose
  //     Retry deliberately KEEPS the preselect, the reader pressed Continue
  //     again, and the second RPC collided with the first one's committed row;
  //   · A STALE SESSION ID — `deriveWizardResumeOverrides` restores
  //     `wizardSessionId` from localStorage on the API branch UNCONDITIONALLY
  //     (localStorage.ts, source-gated only), so an abandoned draft over key A
  //     lends its session id to a preselect for key B.
  //
  // ⛔ AND THE INCUMBENT REMEDY NAMED TWO CONTROLS THAT SCREEN DOES NOT PAINT.
  // "Resume draft" and "Start fresh" are WizardClient's resume-banner buttons,
  // and the banner renders only on `showResumeBanner && initialDraft` — which on
  // the preselect path is FALSE by construction on the second path above
  // (ContributionWizardOverlay only offers a draft whose own `api_key_id` is the
  // preselected key). With `actions` carrying neither member of
  // `RECOVERABLE_ACTIONS`, no Retry renders either: the reader was left on a
  // screen naming two absent controls, whose only working control discards the
  // key they chose.
  //
  // ⚠️ THE PRESELECT BULLETS PROMISE ONLY WHAT THE ARM DELIVERS. Re-pressing
  // "Continue with this key" succeeds on the TOCTOU path and ONLY there, because
  // the colliding row is now committed and `resolveStrategiesForKey` answers
  // `kind: "draft"` — the arm's own idempotent envelope, before the RPC is
  // reached at all. On the stale-session path the collision is over a DIFFERENT
  // key, that resolver still finds nothing, and the second bullet says so
  // instead of sending the reader round the loop again.
  DRAFT_ALREADY_EXISTS: {
    title: "You already have a wizard session open for this key.",
    cause:
      "A draft strategy with the same API key is already in progress. Each key can back one listing at a time.",
    fix: [
      "Resume the existing draft to continue where you left off.",
      "Or delete it and start fresh here.",
      // ── preselect-only.
      "Press “Continue with this key” once more. If the draft already open is this key's, we hand that one back and carry on from where it stopped — nothing is created twice.",
      "If it is refused a second time, the open draft belongs to a different key of yours and this screen cannot reach it. Email security@quantalyze.com with the correlation id below. Nothing was created by this attempt.",
    ],
    fixRequires: [
      NOT_ON_PRESELECT_SURFACE,
      NOT_ON_PRESELECT_SURFACE,
      REQUIRES_PRESELECT_SURFACE,
      REQUIRES_PRESELECT_SURFACE,
    ],
    docsHref: "/security#draft-resume",
    // ⛔ UNCHANGED, and deliberately so. `resume_draft` / `start_fresh` are what
    // the resume banner offers where it renders, and neither is a member of
    // `RECOVERABLE_ACTIONS` — so no Retry control appears on EITHER surface.
    // That is right here: on the preselect screen the action the first bullet
    // names is "Continue with this key", which is already painted as the step's
    // primary control. A Retry beside it would be a second button for the same
    // press. ⛔ And `clear_and_retry` must not be added to buy one: it would
    // render a Retry on the credential surface too, where the collision is not
    // resolvable by re-sending.
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
      // ── 162-06 review / B-2b — preselect-only, and it exists because this
      // entry is NOT recoverable: `actions` carries neither member of
      // `RECOVERABLE_ACTIONS`, so no Retry renders and the reuse arm's own
      // refusal left the reader with three bullets that named no control on the
      // screen at all. The bullet above it ("connect a different account") is
      // the true remedy; this one names the painted control that performs it.
      // ⛔ It must stay gated: on the credential form the same instruction is
      // carried out by editing the fields, and "Use a different key" is not
      // there to press.
      "On this screen that second option is “Use a different key” — it swaps the saved key out for the credential form. Pressing “Continue with this key” again sends the identical request and is refused identically.",
    ],
    fixRequires: [null, null, null, REQUIRES_PRESELECT_SURFACE],
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

  // 161-05 / WIZERR-03 — THE THIRD ENTRY OF THE VENUE-FENCE FAMILY, adjacent to
  // the two it splits from for the same reason they are adjacent to each other:
  // the three differ by ONE fact — what, if anything, hangs off the live key —
  // and that fact decides which remedy is real.
  //   · a surviving wizard draft ⇒ resume it       (DRAFT_ALREADY_EXISTS)
  //   · a strategy past draft    ⇒ open it         (VENUE_ALREADY_CONNECTED)
  //   · nothing at all           ⇒ neither exists  (here)
  //
  // ⚠️ `cause` CLAIMS THE STATE DOES NOT AGE OUT, AND THAT CLAIM WAS MEASURED
  // (161-05 plan assumption A2, re-read at HEAD rather than inherited).
  // `cleanup_abandoned_wizard_drafts()` builds `v_candidate_keys` from the
  // drafts THAT RUN is deleting (`created_at < now() - interval '7 days'`) and
  // sweeps only those ids; a key that was ALREADY orphaned before the run is
  // never a candidate again. So the leftover key genuinely persists, which is
  // why no bullet below tells the user to wait for it to clear.
  //
  // ⚠️ AND THE SECOND HALF IS MEASURED TOO: an orphaned key on this path was
  // ALWAYS created alongside a wizard draft. `api_keys.venue_account_id` — the
  // column whose partial UNIQUE produced this refusal — is written by exactly
  // ONE writer, `create_wizard_strategy`, in the same INSERT that mints the
  // draft strategy (every other writer's value is removed by the
  // `api_keys_scrub_venue_account_id` trigger). So "saved in an earlier session
  // whose draft was deleted" is the only way to reach this state, not a guess
  // at the likeliest one.
  //
  // ⛔ THE `fix` BULLETS DIVERGE FROM 161-UI-SPEC § WIZERR-03, DELIBERATELY,
  // AND THE DIVERGENCE IS A MEASUREMENT RATHER THAN A PREFERENCE. The spec's
  // first bullet was "Disconnect the unused key under Manage keys, then connect
  // it here again." Checked at HEAD:
  //   · the string "Manage keys" occurs NOWHERE in `src`;
  //   · the key-management component (`components/strategy/ApiKeyManager.tsx`,
  //     which does carry a delete) is mounted at `strategies/[id]/edit/page.tsx`
  //     and nowhere else — a per-STRATEGY surface. This code exists precisely
  //     because NO strategy holds the key, so there is no edit page to reach;
  //   · the only other list with a Disconnect control
  //     (`AllocatorExchangeManager`, profile → Exchanges) sits behind
  //     `allocatorOnly` in `ProfileTabs.tsx`, and the user standing in this
  //     wizard is a manager;
  //   · `my-strategies` DOES surface the orphan, as a "No strategy yet" row —
  //     but its only control is "Finish setup →", which reopens this same
  //     wizard and lands on this same refusal.
  // Shipping that bullet verbatim would have shipped an UNWINNABLE remedy: the
  // D-17 class, and a direct breach of the principle (161-UI-SPEC § Copy
  // Principles 2) this very requirement exists to enforce. The bullets below
  // name only remedies that were measured to be reachable.
  //
  // ⭐ 162-06 / D-162-3 — THE LAST BULLET OF THAT MEASUREMENT NO LONGER HOLDS,
  // AND THE COPY MOVED IN THE COMMIT THAT BROKE IT. "Finish setup →" now carries
  // the clicked row's key id into the wizard, which opens on the saved-key
  // summary and REUSES the stored `api_keys` row through `create-with-key`'s
  // reuse arm — it no longer re-POSTs credentials, so it no longer lands here.
  // The sentence that stood in `fix[1]` ("To reuse this exact account, email
  // security@quantalyze.com … releasing the stored key is not something you can
  // do from this page") told exactly the users this phase is about that a remedy
  // they now HAVE does not exist.
  //
  // ⚠️ AND IT IS NAMED CONDITIONALLY, BECAUSE THE PAGE IS ROLE-SCOPED. Same
  // measurement discipline as the divergence above: `/my-strategies` guards on
  // `requireRolePage(…, "allocator")`, so a `role: "manager"` profile standing in
  // the manager wizard is redirected off it. Asserting it flatly would re-open
  // the D-17 class for that population. The row is also not guaranteed to be
  // there: `getStrategylessActiveKeys` filters on `is_active` and
  // `sync_status !== "revoked"` while the venue fence that emits this code
  // filters only on `disconnected_at`, so a revoked-but-not-disconnected key is
  // refused here and listed nowhere. Both gaps land in the same bullet.
  //
  // ⚠️ THE RELEASE GAP IS STILL REAL AND IS STILL NOT CLOSED: nothing we ship
  // lets an owner of ANY role release their own stored key. 162-06 closed REUSE,
  // not release, and the last bullet keeps routing to us for it.
  KEY_ORPHANED: {
    title: "This key is already stored, but nothing uses it.",
    cause:
      "These credentials were saved in an earlier session whose draft was deleted, leaving the key attached to nothing. A new strategy cannot be created over the leftover key, and it does not clear on its own.",
    fix: [
      "Connect this strategy with a different account — one whose key is not already stored here.",
      "If your account includes the My Strategies page, look for this account there under “No strategy yet”: “Finish setup” on that row builds the strategy from the key already stored, with no credentials to enter again.",
      "If that page is not part of your account, or it does not list this key, email security@quantalyze.com with the correlation id below: releasing the stored key is not something you can do from this page.",
    ],
    docsHref: "/security",
    // ⛔ `try_another_key` AND NOT `clear_and_retry`. Both are members of
    // `RECOVERABLE_ACTIONS`, so either would derive `recoverable: true` — but
    // `clear_and_retry` means "send the same thing again", and the same account
    // is refused by the same index every time. Only a DIFFERENT key can succeed,
    // which is exactly what the surviving member names.
    // ⛔ AND NEITHER `resume_draft` NOR `start_fresh`: there is no draft to
    // resume, and `start_fresh` deletes one. Their absence also keeps this entry
    // outside the destructive-action population the `[140.3-10 / TRAP-4]` scan
    // walks.
    actions: ["try_another_key", "expand_log"],
  },

  // 162-05 / D-162-3. See the union member's docblock for why this is a member
  // rather than an alias, and for the four near-misses it was measured against.
  //
  // ⚠️ WHAT THIS COPY MAY CLAIM, measured at the arms rather than assumed. Both
  // emitters return BEFORE any write: the pre-RPC one has performed two reads
  // and nothing else, and the `no_data_found` one is raised by the function
  // before its INSERT, inside a transaction that rolls back. So "nothing was
  // created" is knowable in the way 140.3-15 requires. ⛔ It says nothing about
  // the user's credentials, which this arm never receives, never sends anywhere
  // and never stores — a sentence implying otherwise would send them to
  // regenerate a working key for a state that has nothing to do with it.
  //
  // ⚠️ AND IT MAY NOT CLAIM A CREDENTIAL FORM IS ON THE SCREEN (162-06 review /
  // B-2). The first line used to read "Connect this account here with its API
  // credentials instead — the form on this step still works normally", and that
  // was TRUE when 162-05 wrote it: ConnectKeyStep rendered the form on every
  // path. 162-06 added the PRESELECT sub-state in the same branch, and that
  // sub-state returns BEFORE the form — so the only screen that can render this
  // refusal is the one screen with no form on it. Naming the form there left
  // the reader looking for a control that is not painted, with Retry blanking
  // the banner and changing nothing: the unwinnable loop 162-06 exists to
  // close, one screen later. The line now names the CONTROL that reaches the
  // form — "Use a different key", rendered directly under this envelope — and
  // ConnectKeyStep's preselect branch wires Retry to the same control.
  // ⛔ IT STILL CLAIMS NOTHING ABOUT WHERE THE READER CAME FROM — but ⚠️ NOT
  // FOR THE REASON THAT STOOD HERE. The retired sentence read "This refusal also
  // renders in the manager wizard while /my-strategies is allocator-gated, so a
  // flat 'go back to My Strategies' would re-open the D-17 class for managers".
  // TRACED AT HEAD (162-06 review) AND FALSE: there is no manager population on
  // this path at all.
  //   · `preselectKey` reaches `ConnectKeyStep` only through the step mount in
  //     `WizardClient.tsx` and the one in `MultiKeyConnectStep.tsx`, and this
  //     code is emitted ONLY by the arm a non-null preselect unlocks;
  //   · the only production supplier of a NON-NULL preselect is the
  //     `ContributionWizardOverlay` mount in `MyStrategiesSection.tsx` (the
  //     "Finish setup" seam). `/strategies/new` mounts `WizardClient` with no
  //     preselect, and the credential arm never sends `reuse_api_key_id`;
  //   · `MyStrategiesSection` renders on `/my-strategies`, whose page component
  //     awaits `requireRolePage(supabase, user, "allocator")` before rendering
  //     anything.
  // So every reader of this refusal is an allocator who arrived from that page.
  // An argument that turns on a population which cannot reach the screen is not
  // a weaker reason for the right shape — it is a reason that would evaporate
  // the moment someone checked it, taking the shape with it.
  //
  // ⭐ THE MEASURED REASON THE SECOND LINE STAYS CONDITIONAL is about the SEAM,
  // not about roles. The preselect is a PROP: `ContributionWizardOverlay` is
  // mounted at five sites and four of them pass none today, and any one of them
  // may start to. A flat "go back to My Strategies" would be a claim about where
  // the reader came from that the component cannot check — the same unearned
  // claim the bullet above it (the credential-form one) turned into a live
  // defect. "If you arrived from…" costs the current population nothing and
  // cannot become false when a second supplier appears; and the FIRST line names
  // only what is painted on the screen, which is checkable from the DOM and is
  // pinned there.
  KEY_REUSE_UNAVAILABLE: {
    title: "That stored key is not available to reuse.",
    cause:
      "You asked us to finish setting up a strategy using a key already stored on your account, and we could not find a live one matching it. It may have been disconnected or removed since the page you started from was loaded. Nothing was created and none of your stored keys changed.",
    fix: [
      "Choose “Use a different key” on this screen to connect this account with its own API credentials instead.",
      "If you arrived from My Strategies, reload that page first: the key list it showed you is what this request is checked against, and it is now out of date.",
      "If neither clears it, email security@quantalyze.com with the correlation id below.",
    ],
    docsHref: "/security",
    // ⛔ `try_another_key` AND NOT `clear_and_retry` — see the union member's
    // docblock. ⛔ AND NEITHER `resume_draft` NOR `start_fresh`: no draft was
    // read or written on this arm, and `start_fresh` DELETES one, which also
    // keeps this entry outside the destructive-action population the
    // `[140.3-10 / TRAP-4]` scan walks.
    actions: ["try_another_key", "expand_log"],
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

  // 161-07 / WIZERR-09 — the copy that lands in the SAME commit the wizard's
  // composite arm starts evaluating the 7-day floor.
  //
  // ⚠️ THE UI-SPEC'S PROPOSED COPY WAS CORRECTED HERE, and the correction is
  // the point rather than a preference. It read "Not enough CSV history…" and
  // "Upload a CSV covering at least 7 daily returns, then submit again."
  // MEASURED at every emitter this member can reach, that remedy is false:
  //   · the wizard COMPOSITE arm counts the STITCHED composite series
  //     (`series.length`), which no user uploaded;
  //   · the wizard SINGLE-KEY arm reaches this code only on the daily-returns
  //     branch — a KEYED account (deribit / mt5 / sfox stamp `ledger_complete`)
  //     whose dailies were DERIVED from the venue's ledger, not uploaded.
  // The keyless CSV upload path never reaches `SyncPreviewStep` at all (it
  // validates through `csv-finalize`). So a bullet telling this user to upload
  // a CSV names a remedy their surface does not offer — the unwinnable-remedy
  // class this phase exists to close. The copy talks about the SERIES instead,
  // which is true on all three emitters including the admin one.
  //
  // ⚠️ THE NUMBER IS SPELLED OUT because it exists and is fixed
  // (`STRATEGY_GATE_MIN_CSV_ROWS = 7`) — DESIGN.md: no adjective where a number
  // exists. The user's OWN row count is deliberately NOT interpolated: this
  // entry has no `formatKeyError` arm and no context field, so there is no path
  // by which an absent count could render as a placeholder or a zero (TRAP-3).
  // The gate's `reason` string, which the admin surface renders raw, does carry
  // both numbers — that is a different channel with a different audience.
  GATE_INSUFFICIENT_CSV_HISTORY: {
    title: "This strategy needs at least 7 days of return history.",
    cause:
      "This strategy's daily-return series covers fewer than 7 days. We hold a daily-return series to the same 7-day floor we hold trade history to: below that, volatility and drawdown estimates are unstable, so we will not compute a verified factsheet from it yet. Nothing is wrong with the data we have — there is not yet enough of it.",
    fix: [
      "Come back once the series covers at least 7 days and retry the sync from this page — a completed re-derive rebuilds the series from whatever history the venue holds by then.",
    ],
    docsHref: "/security#thresholds",
    actions: ["clear_and_retry"],
  },

  // 161-07 / WIZERR-10 — the truthful fourth outcome, replacing "Strategy has
  // only 0 trade(s)" for a strategy that has a full return series and no fills.
  //
  // ⭐ EVERY CLAUSE BELOW WAS VALIDATED AGAINST THE PRODUCER, and 161-UI-SPEC's
  // proposed title and cause were CORRECTED rather than shipped. Truth source:
  // `analytics-service/services/broker_dailies.py`'s producer registry
  // docstring, read first-hand.
  //   · The UI-SPEC's title "This data source was examined and refused." and
  //     its cause "We examined the venue's return series and could not verify
  //     it — the data was found wanting" both assert a PER-SERIES examination.
  //     `fill_derived_unproven` is stamped for binance / bybit / okx ALWAYS and
  //     unconditionally — "a CONSTANT, not a data-driven refinement". Nothing
  //     looked at this particular series and found it wanting; a METHOD was
  //     used that cannot establish completeness for any series.
  //   · The cause therefore describes the two METHODS, and the enumeration is
  //     exhaustive by construction: the gate's examined-refused map has exactly
  //     these two members. ⚠️ A third verdict joining that map makes this
  //     sentence incomplete — the obligation is written at the map itself.
  //   · No gap magnitude and no row count appears (T-73-02 leak discipline, and
  //     TRAP-3: this entry has no interpolation arm, so no absent number can
  //     surface as a zero).
  //
  // ⭐ 161-REVIEW / IN-03 — THE FIRST REMEDY NAMES A VENUE, and the name was
  // MEASURED at the producer rather than inferred. It used to read "Connect a
  // key from a venue we can read end to end — one that gives us a complete
  // transaction ledger rather than a fill feed", which gestured at a set the
  // reader cannot resolve: nothing on the user's screen says which of the
  // venues on offer keeps a ledger, so the remedy was "guess". Truth source,
  // read first-hand: `analytics-service/services/broker_dailies.py`'s producer
  // registry docstring ("Who stamps what") plus the three stamp sites.
  //
  //   · `combine_native_ledger` (DERIBIT) stamps `ledger_complete` on BOTH
  //     return paths, unconditionally — an incomplete crawl raises
  //     `LedgerCompletenessError` / `LedgerTruncatedError` and fails the whole
  //     job permanently, so no partial deribit series can exist to land here.
  //     Deribit is therefore a remedy that CANNOT put the user back on this
  //     screen, and it is in `UI_EXCHANGE_CODES_BASE` — offered unconditionally,
  //     behind no flag.
  //   · `combine_realized_and_funding` (BINANCE / BYBIT / OKX) stamps
  //     `fill_derived_unproven` always, and `combine_sfox_balance_history`
  //     stamps `sampled_gapped` on any interior hole. Those four are exactly the
  //     venues that can REACH this code, so none of them is a remedy.
  //
  // ⛔ `combine_mt5_deal_ledger` ALSO stamps `ledger_complete` unconditionally,
  // and MT5 is deliberately NOT named. Its wizard presence rides
  // `MT5_UI_ENABLED` (`closed-sets.ts`), so a static sentence naming it would
  // name a venue the surface may not be offering — the same disclosure defect
  // WIZERR-08/F3 exists to prevent, in a different costume. The sentence names
  // ONE venue and claims no exhaustiveness for exactly that reason: it stays
  // true when a flag-gated venue is dark AND when it is live. If a second
  // ALWAYS-OFFERED venue starts stamping `ledger_complete`, name it here too.
  GATE_SERIES_EXAMINED_REFUSED: {
    title: "We can't verify this strategy's returns from the venue's own data.",
    cause:
      "Our pipeline records how every daily-return series was built, and for this one the record does not establish a complete track record. There are two ways a series lands here: it was sampled from balance snapshots that have interior gaps, or it was derived from individual fills — a method that produces a plausible series whether or not the venue returned every fill, with no residual to check it against. Either way, publishing it would mean standing behind a number we cannot show is complete. This is a limit on what the venue's data can prove, not a judgement about your trading.",
    fix: [
      "Connect a Deribit key instead — Deribit gives us the venue's full transaction ledger rather than a fill feed, so the record behind the series is whole.",
      "Or create this strategy from a CSV upload instead: a track record you supply yourself carries its own completeness record, which we do accept.",
    ],
    docsHref: "/security#thresholds",
    actions: ["try_another_key"],
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

  // 160-05 review / WIZFORM-02-CLASS. See the union member's docblock for why
  // this is a member rather than an alias, and for the two near-misses it was
  // measured against.
  //
  // ⚠️ WHAT THIS COPY MAY CLAIM, measured at the arm rather than assumed. The
  // refusal returns before `validateKey`, before `encryptKey` and before the
  // insert, so "nothing reached your exchange and nothing was stored" is
  // knowable in the way 140.3-15 requires — not a comforting negative about a
  // write that may have landed.
  //
  // ⛔ WHAT IT MAY NOT SAY: anything about the key. The user's credentials were
  // never sent anywhere on this path and are not what was rejected; a sentence
  // that implies otherwise would send them to regenerate a working key for a
  // fault that is entirely ours. It also names OUR side as the thing that
  // changed, because it is.
  STALE_CLIENT: {
    title: "This page is out of date.",
    cause:
      "This tab has been open since before we changed how keys are added, so it sent us a request we no longer accept. Nothing reached your exchange and nothing was stored. There is nothing wrong with your key or your credentials — the page is simply older than we are.",
    fix: [
      "Reload this page. That is the whole fix: a fresh load replaces the out-of-date code this tab is running.",
      "Add the key again on the reloaded page. Nothing was stored the first time, so there is nothing to undo first.",
      "If a reload does not clear it, email security@quantalyze.com with the correlation id below — that would mean the page we are serving is the out-of-date one, which is ours to fix.",
    ],
    docsHref: "/security",
    // ⛔ NEITHER member of `RECOVERABLE_ACTIONS` (`clear_and_retry`,
    // `try_another_key`), so `recoverable` derives FALSE and no Retry control
    // renders: a retry from this same page re-posts the same body and is
    // refused identically. `leave_and_return` names the actual remedy, exactly
    // as it does on `DRAFT_STATE_INVALID`, whose condition is also "this PAGE
    // is stale".
    // ⛔ AND NOT `start_fresh`: it DELETES a draft, and this refusal knows
    // nothing about any draft — which also keeps this entry outside the
    // destructive-action population the `[140.3-10 / TRAP-4]` scan walks.
    actions: ["leave_and_return", "expand_log"],
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

  // 161-10 / WIZERR-07 — the four DASHBOARD DIALOG entries. The union members
  // above carry the full reasoning for each: what rendered before it, which
  // near-neighbour was rejected and why (read at that neighbour's emitter), and
  // how `recoverable` derives. The copy below is held to Principle 1 (name the
  // actual blocker) and Principle 2 (the remedy must be able to succeed).
  //
  // ⚠️ 161-REVIEW / IN-02 — PRINCIPLE 4 IS AN AUTHORING RULE, NOT A PROPERTY
  // THIS TABLE ESTABLISHES. The superseded version of this note claimed
  // otherwise — "Principle 4 (no correlation id on an actionable arm — three of
  // the four are terminal, so `expand_log` is present on those and the id is
  // what the user is asked to quote)" — which reads `expand_log`'s presence as
  // the enforcing mechanism. It is not one, on two independent measured
  // grounds:
  //
  //   · `expand_log` does not decide what renders. Whether the envelope's
  //     `<details> Diagnostics` block — the one that carries `code` and
  //     `correlation_id` — is shown is `ErrorEnvelope`'s decision, taken from
  //     its own props. Read it THERE before relying on the id being present or
  //     absent on any arm; no entry in this table can assert it.
  //   · `expand_log` does not even imply the arm is terminal. `KEY_ORPHANED`
  //     carries `try_another_key` — a member of `RECOVERABLE_ACTIONS`, so
  //     `buildEnvelope` derives `recoverable: true` — ALONGSIDE `expand_log`.
  //     One counterexample is enough: `expand_log` present cannot establish
  //     "this arm is non-actionable" for any entry, this table's or another's.
  //
  // So `expand_log` on three of the four below records the AUTHOR'S judgement
  // that the diagnostics disclosure is the right escalation for a terminal arm,
  // and the fix line asking the user to quote the id is what makes it useful.
  // It is a declaration, never a claim about the rendered DOM.
  DASHBOARD_SIGNED_OUT: {
    title: "You are signed out.",
    cause:
      "We could not confirm your session, so we refused the change before making it. Nothing was saved — your strategy, its name and its allocation are exactly as they were.",
    fix: [
      "Sign in again, then make the change from the reloaded page.",
      "Nothing needs undoing first. The refused change never reached your data.",
    ],
    docsHref: "/security",
    // ⛔ Neither member of `RECOVERABLE_ACTIONS`, so `recoverable` derives false
    // and no Retry renders: the same request from the same signed-out session
    // is refused identically. `leave_and_return` names the action that works.
    actions: ["leave_and_return", "expand_log"],
  },

  DASHBOARD_REQUEST_INVALID: {
    title: "We could not send that change.",
    cause:
      "The request this page built was refused by our own service before any work started. Nothing was saved and nothing was changed. The fault is in our software, not in what you typed.",
    fix: [
      "Reload the page and make the change again — a fresh page may build the request correctly.",
      "If it happens again, email security@quantalyze.com with the correlation id below. A request our own page built wrong is ours to fix.",
    ],
    docsHref: "/security",
    // ⛔ Neither member of `RECOVERABLE_ACTIONS`. Re-sending the identical
    // malformed request is refused identically, so the Retry control would
    // promise an outcome it cannot deliver.
    actions: ["leave_and_return", "expand_log"],
  },

  DASHBOARD_WRITE_FAILED: {
    title: "We could not save that change.",
    cause:
      "Our own service failed part-way through the change and stopped. Nothing was saved — the strategy is as it was before you pressed save. This is a fault on our side, not in your data.",
    fix: [
      "Try the same change again. This kind of fault is often momentary.",
      "If it keeps failing, email security@quantalyze.com with the correlation id below.",
    ],
    docsHref: "/security",
    // ⚠️ `clear_and_retry` IS a member of `RECOVERABLE_ACTIONS`, so this is the
    // ONE recoverable entry in this family and the Retry control renders. That
    // is deliberate: a query that errored once can succeed on the next attempt,
    // and these writes set a stated value rather than accumulating one, so a
    // retry cannot double anything.
    //
    // ⛔ 161-REVIEW / CR-01 — THE SENTENCE ABOVE IS BYTE-IDENTICAL TO WHAT
    // 161-10 SHIPPED, and the Retry is deliberately kept. What changed is the
    // set of arms allowed to reach it: only those where no data-modifying
    // statement had been sent, so "Nothing was saved" is established by the
    // control flow rather than asserted. Every other arm now answers
    // `DASHBOARD_WRITE_INDETERMINATE` below. Do not widen this entry back.
    actions: ["clear_and_retry", "request_call"],
  },

  // 161-REVIEW / CR-01 — the honest half of the split. The union member carries
  // the full reasoning: which arms, why an errored write is not a verified
  // rollback, and why a Retry is withheld from a possibly-applied money write.
  //
  // ⛔ EVERY CLAUSE BELOW IS A THING THE ROUTE ESTABLISHED. It says the attempt
  // was made (true — the statement was sent), that we cannot tell what it did
  // (true — no arm discriminates a rejected statement from a lost answer), and
  // that the reloaded page is the current state (true — the dialogs' lists
  // re-fetch on close). It says NOTHING about whether anything persisted, in
  // either direction, which is the "'NOTHING WAS SAVED' IS VERIFIED, NOT
  // ASSERTED" rule recorded at the `CSV_UPSTREAM_FAIL` entry, applied at the one
  // place in this family where it bites.
  DASHBOARD_WRITE_INDETERMINATE: {
    title: "We could not confirm whether that change was saved.",
    cause:
      "Our own service failed part-way through the change, and by then the request to save it had already been sent. We cannot tell from here whether it took effect, and we would rather say that than guess in either direction. The fault is on our side, not in what you entered.",
    fix: [
      "Close this dialog and reload the page. What the reloaded page shows is the current state.",
      "If the change is not there, make it again. If it is there, nothing needs undoing.",
      "If this keeps happening, email security@quantalyze.com with the correlation id below.",
    ],
    docsHref: "/security",
    // ⛔ NEITHER member of `RECOVERABLE_ACTIONS`, so `buildEnvelope` derives
    // `recoverable: false` and no Retry control renders — and the reason is NOT
    // the usual one. Retrying is not futile here, it is UNPREDICTABLE: nobody,
    // including us, knows what the first attempt did. On the ownership flip
    // that first attempt may have removed live positions. A one-click Retry
    // whose effect the person pressing it cannot foresee is the unwinnable
    // remedy this phase removes; the remedy is ORDERED instead, and
    // `leave_and_return` carries its first step.
    actions: ["leave_and_return", "expand_log"],
  },

  DASHBOARD_ROW_STALE: {
    title: "This page is out of date.",
    cause:
      "What this dialog points at is not there in the form this change needs — it may have been renamed, removed, or moved to a state this action does not apply to since the page loaded. Nothing was saved.",
    fix: [
      "Close this dialog. The list reloads and shows the strategies as they stand now.",
      "If the row is still listed after the reload and the change still fails, email security@quantalyze.com with the correlation id below.",
    ],
    docsHref: "/security",
    // ⛔ Neither member of `RECOVERABLE_ACTIONS`. The server answers the
    // identical request 404 until the page is reloaded, so a Retry would
    // promise that pressing it changes the outcome.
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
  // ⛔ REMOVED 2026-08-26 — `computationError?: string | null`, "raw computation
  // error to include under SYNC_FAILED / GATE_ANALYTICS_FAILED". Phase 162 /
  // HONEST-01, UI-SPEC C-2. That field carried
  // `strategy_analytics.computation_error` — a SERVER column — into the wizard
  // envelope body as a `Details: …` appendix, and until migration 20260826120000
  // that column held raw `classify_exception` output, so the envelope rendered
  // Python exception strings to users. The column is curated at its write
  // boundary now, and the appendix is STILL wrong: appending curated copy to
  // curated copy double-renders the same claim, which is the duplication C-2
  // removes. This file is the canonical source of human copy (DESIGN-05);
  // operator context belongs in the diagnostics accordion, which carries the
  // code and the correlation id and is PII-scrubbed.
  //
  // The absence is deliberate and TYPED: re-adding a server-detail field here is
  // the one edit that reopens the render path, so it has to be a decision rather
  // than a convenience.
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
    case "venueIs":
      // 161-05 / WIZERR-11 — EXACT EQUALITY AGAINST A CLOSED-SET MEMBER, and
      // deliberately NOT routed through `venueCapabilities`' lookup:
      //   · no `.toLowerCase()` on the caller's value. Both connect steps type
      //     their context venue as `SupportedExchange` (ConnectKeyStep's
      //     `attemptExchange ?? exchange`, MultiKeyConnectStep's `attemptVenue`),
      //     so it arrives lowercase by construction — MEASURED at both call
      //     sites, not assumed. Case-folding an inbound string before comparing
      //     it would widen what can satisfy a venue-specific claim for no
      //     caller that exists;
      //   · no default. An ABSENT venue is not "deribit", so it is suppressed —
      //     the opposite of the `venueCapability` arm above, argued at the
      //     union member.
      return context?.venue === req.venue;
    case "surfaceIsNot":
      // 162-06 review / B-2 (class) — an ABSENT surface is not the barred one,
      // so the incumbent bullet RENDERS. ⛔ The inverted default is the whole
      // point of the kind and must not be "unified" with the `surface` arm
      // three lines up: this gate removes a remedy that one screen disproved,
      // and applying `surface`'s suppress-on-absence rule to it would delete
      // that remedy from every caller that names no surface at all.
      return context?.surface !== req.surface;
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

  // ⛔ DELETED 2026-08-26 (Phase 162 / HONEST-01, UI-SPEC C-2) — the arm that
  // read `context.computationError` and returned
  // `${base.cause} Details: ${context.computationError}.` for
  // GATE_ANALYTICS_FAILED and SYNC_FAILED. See the removed field on
  // WizardErrorContext above for why. Nothing replaces it: the cause sentence
  // in the table stands alone, which is what it was written to do.
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
    case "SERIES_EXAMINED_REFUSED":
      // 161-07 / WIZERR-10. The other half of the "did a producer look?" split:
      // one looked, and what it recorded does not establish a complete record.
      // Terminal and wizard-reachable from the single-key arm (a keyed perp on
      // binance / bybit / okx arrives with 0 trades and a fill-derived series),
      // so it maps to real copy — never UNKNOWN, and never back to
      // GATE_INSUFFICIENT_TRADES, which is the false sentence it replaces.
      return "GATE_SERIES_EXAMINED_REFUSED";
    case "ANALYTICS_MISSING":
    case "ANALYTICS_PENDING":
    case "ANALYTICS_COMPUTING":
      // These are transient UI states, not terminal errors. Callers
      // should poll rather than render an error. Fall back to UNKNOWN
      // if they do reach this path so we catch the misuse.
      return "UNKNOWN";
    case "INSUFFICIENT_CSV_HISTORY":
      // 161-07 / WIZERR-09. THIS ARM'S PREVIOUS COMMENT IS DELETED RATHER THAN
      // AMENDED, because its premise stopped being true in this commit. It
      // said: "Admin-approval-only gate code… so this code never flows through
      // the wizard error mapper. UNKNOWN flags the misuse if it ever does."
      //
      // Two of its three clauses were already wrong when written, and the third
      // is wrong now:
      //   · the wizard's SINGLE-KEY arm has passed `csvRowCount` to
      //     `checkStrategyGate` since MT5-11/12, and a KEYED account on the
      //     daily-returns branch (deribit / mt5 / sfox → `ledger_complete`) with
      //     fewer than 7 derived days lands here, no CSV involved;
      //   · "never CSV-sourced" conflates the STORAGE (`csv_daily_returns`,
      //     which every daily-returns strategy writes) with the SOURCE;
      //   · the wizard COMPOSITE arm now evaluates the floor too, in this same
      //     commit — which is the whole reason the pair is atomic.
      // Terminal AND wizard-reachable ⇒ real copy, never UNKNOWN.
      return "GATE_INSUFFICIENT_CSV_HISTORY";
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
 * 161-10 / WIZERR-07 — the three DASHBOARD WRITE ROUTES, named as a closed set.
 *
 * These are the routes behind `AllocateDialog`, `RenameStrategyDialog` and
 * `MarkOwnershipDialog`. The strings are the route's directory path under
 * `src/app/api/`, so a reader can go from a roster row to the emitter without
 * a lookup table in between.
 */
export type DashboardDialogRoute =
  | "strategies/[id]/name"
  | "strategies/[id]/ownership"
  | "portfolio-strategies/allocation";

/**
 * The `WizardErrorCode`s each dashboard write route can put on the wire.
 *
 * ── WHY THIS LIVES HERE AND NOT AT EACH DIALOG ──────────────────────────────
 *
 * The wizard steps each hold their own `KNOWN_*_CODES` roster in the component
 * file, and that shape is not copied here on purpose. WIZERR-07's finding was
 * that the dashboard dialogs are where this class REGREW after Phase 153 —
 * three client components minting `code: "UNKNOWN"` for failures their routes
 * had already classified — and the wizard coverage law could not see them
 * because it declares itself blind to everything outside the wizard-steps
 * directory. Putting the rosters in ONE shared module is what lets
 * `dialog-envelope.invariant.test.ts` import the live map instead of re-parsing
 * three component files, so a new roster row joins that law with no test edit.
 *
 * It also keeps the ONE guarded cast in one audited place (see the recogniser
 * below) rather than once per consumer.
 *
 * ── WHY IT IS PER-ROUTE AND NOT ONE FLAT SET ────────────────────────────────
 *
 * `ConnectKeyStep.tsx`'s roster docblock argues at length that a surface should
 * admit the codes ITS route emits and not the whole vocabulary, and that
 * argument is not weaker here. A flat set would go green while the rename
 * dialog silently admitted an allocation-only code, which is precisely the
 * failure a merged check cannot distinguish from correctness.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 *
 * Three wire codes these routes emit are NOT `WizardErrorCode`s and must not be
 * added here or minted as members. They never reach `buildEnvelope`:
 *
 *   · `NAME_REQUIRED` / `NAME_TOO_LONG` — the name route's two field-level
 *     refusals. `RenameStrategyDialog` lands them INLINE at the Name field,
 *     which is where the user is looking and where the remedy is; routing them
 *     through an envelope would re-introduce the terminal-envelope class for a
 *     field-level problem: the remedy is AT the Name field, and a terminal panel
 *     beside it is noise competing with that remedy (Principle 4). ⚠️ 161-REVIEW
 *     / IN-02 — this used to read "would show a correlation id on an ACTIONABLE
 *     arm", which asserted what `ErrorEnvelope` renders. Nothing in this file
 *     decides that; see the IN-02 note at the DASHBOARD copy entries.
 *   · `LIVE_ALLOCATION` — the ownership route's 409. `MarkOwnershipDialog`
 *     answers it by swapping in its confirmation body with the amount at risk,
 *     not by rendering an error at all. It is a QUESTION, not a refusal the
 *     user must read and leave.
 *
 * Each of the three is asserted as an explicit disposition by the coverage law,
 * so its absence is a recorded decision rather than an omission — an omission
 * being indistinguishable from the defect.
 */
const DASHBOARD_DIALOG_ROUTE_CODES: ReadonlyMap<
  DashboardDialogRoute,
  ReadonlySet<WizardErrorCode>
> = new Map<DashboardDialogRoute, ReadonlySet<WizardErrorCode>>([
  [
    "strategies/[id]/name",
    new Set<WizardErrorCode>([
      "DASHBOARD_SIGNED_OUT",
      "DASHBOARD_REQUEST_INVALID",
      "RATE_LIMITED",
      "DASHBOARD_WRITE_FAILED",
      // 161-REVIEW / CR-01 — the indeterminate half of the 500 population.
      // Every one of these three routes has at least one arm that fails AFTER
      // a data-modifying statement was sent, so every roster gains it.
      "DASHBOARD_WRITE_INDETERMINATE",
      "DASHBOARD_ROW_STALE",
    ]),
  ],
  [
    "strategies/[id]/ownership",
    new Set<WizardErrorCode>([
      "DASHBOARD_SIGNED_OUT",
      "DASHBOARD_REQUEST_INVALID",
      "RATE_LIMITED",
      "DASHBOARD_WRITE_FAILED",
      // 161-REVIEW / CR-01 — the indeterminate half of the 500 population.
      // Every one of these three routes has at least one arm that fails AFTER
      // a data-modifying statement was sent, so every roster gains it.
      "DASHBOARD_WRITE_INDETERMINATE",
      "DASHBOARD_ROW_STALE",
    ]),
  ],
  [
    "portfolio-strategies/allocation",
    new Set<WizardErrorCode>([
      "DASHBOARD_SIGNED_OUT",
      "DASHBOARD_REQUEST_INVALID",
      "RATE_LIMITED",
      "DASHBOARD_WRITE_FAILED",
      // 161-REVIEW / CR-01 — the indeterminate half of the 500 population.
      // Every one of these three routes has at least one arm that fails AFTER
      // a data-modifying statement was sent, so every roster gains it.
      "DASHBOARD_WRITE_INDETERMINATE",
      "DASHBOARD_ROW_STALE",
      // The allocate surface's one actionable refusal, emitted by both the
      // pre-check and the D-03-A trigger arm.
      "ALLOCATION_NOT_ALLOCATABLE",
    ]),
  ],
]);

/** Read-only view for the coverage law, which imports the LIVE map. */
export { DASHBOARD_DIALOG_ROUTE_CODES };

/**
 * ⭐ 161-09 / WIZERR-08 — THE VOCABULARY `keys/validate-and-encrypt` EMITS.
 *
 * ── WHY IT IS HERE AND NOT AT A CONSUMER ────────────────────────────────────
 *
 * Three components POST to that route (`ApiKeyManager`, `StrategyForm`,
 * `AllocatorExchangeManager` — measured by grep over `src/`, 2026-08-24), so a
 * roster living inside any one of them would be a fourth hand-typed registry
 * that the other two silently disagree with. Same call 161-10 made for
 * `DASHBOARD_DIALOG_ROUTE_CODES` directly above: one shared table, in the module
 * that already owns the union and the copy, so the coverage law reads ONE
 * declaration rather than re-parsing three component files.
 *
 * ── ⚠️ WHAT THIS ROSTER DOES AND DOES NOT PROVE — READ THIS BEFORE TRUSTING IT
 *
 * The wizard-step rosters (`KNOWN_CREATE_WITH_KEY_CODES` and friends) are read
 * at runtime by the step that renders the error, so "the roster admits it"
 * really does mean "a client can render it". THIS ROSTER IS WEAKER, and saying
 * so is the point of this paragraph.
 *
 * MEASURED at HEAD, 2026-08-24: **none of the three consumers reads this
 * route's `code` field at all.** All three read `err.error` — the prose
 * sentence — and throw or render that. So there is no runtime reader to bind
 * this roster to, and a docblock claiming "a client can render it" would be
 * exactly the kind of false sentence this phase exists to delete.
 *
 * What the 4th `ROUTES` row in `wizardErrors.invariant.test.ts` DOES enforce
 * with this table, and it is not nothing:
 *
 *   1. every code the route emits is a `WizardErrorCode` (or is translated into
 *      one by `SEAM_CODE_TO_WIZARD_CODE`), so `WIZARD_ERROR_COPY` has a real
 *      entry for it and the first consumer to read the code channel gets copy
 *      rather than the UNKNOWN card;
 *   2. every member listed here has that copy entry;
 *   3. the route's emitter count cannot drift silently — which is how
 *      `STALE_CLIENT` shipped here in Phase 160 with nothing watching it.
 *
 * What it does NOT enforce: that anything renders it today. ⛔ THE FOLLOW-ON IS
 * NAMED DEBT, not an implied fix: wiring those three consumers onto the code
 * channel (the way 161-10 wired the three dashboard dialogs) is what would make
 * this roster's first half real. Until then, treat "rostered" as "typed and
 * has copy", never as "the user will see it".
 *
 * ── MEMBERSHIP, and the two codes deliberately ABSENT ───────────────────────
 *
 * Six members, measured from the emitters at HEAD. `CIRCUIT_OPEN` and
 * `UPSTREAM_TIMEOUT` are NOT here and must not be added: both are WIRE codes
 * that `SEAM_CODE_TO_WIZARD_CODE` translates (→ `SERVICE_UNAVAILABLE_RETRY`,
 * `SERVICE_UNREACHABLE`), neither is a `WizardErrorCode`, and adding either to
 * a `ReadonlySet<WizardErrorCode>` would not compile — and would be wrong if it
 * did, on `MultiKeyConnectStep`'s coverage-law rule 1: the ONE alias table is
 * consulted first, never a member here.
 *
 * ── WHAT THIS ROSTER DOES *NOT* COVER (measured 2026-08-25, IN-04) ──────────
 *
 * Six DECLARED members, but the route can emit roughly **21** codes: the other
 * ~15 arrive on the computed channel, forwarded from the analytics service's
 * own `>=500` vocabulary rather than minted here. They are deliberately not
 * rostered, and the basis for accepting that gap is a measurement, not a
 * preference: none of the fifteen is a `SEAM_CODE_TO_WIZARD_CODE` member at
 * HEAD, so every one of them resolves to UNKNOWN copy — the accepted
 * unrecognized case, not a false sentence.
 *
 * ⚠️ The condition that makes this unsafe: **adding a
 * `SEAM_CODE_TO_WIZARD_CODE` row for any of those fifteen.** The moment one
 * gains wizard copy, it becomes a recognized code arriving on a 5xx carrying a
 * remedy that was authored for a 4xx arm — the WIZERR-06 W1 hazard. If you add
 * such a row, re-run that inventory and roster the code here.
 */
export const KNOWN_VALIDATE_AND_ENCRYPT_CODES: ReadonlySet<WizardErrorCode> =
  new Set<WizardErrorCode>([
    // the two request-shape families 161-09 split off KEY_INVALID_FORMAT
    "KEY_MISSING_REQUIRED_FIELD",
    "KEY_VENUE_NOT_ENABLED",
    // the read-only verdict (400) and the deploy-skew refusal (409)
    "KEY_NOT_READ_ONLY",
    "STALE_CLIENT",
    // our own configuration faults (503, two sites) and the persist-INSERT
    // failure (500), which is deliberately terminal-unclassified: the user's
    // key WAS verified and the row was not written, and no more specific member
    // states that without naming an internal writer.
    //
    // ⚠️ `SEAM_MISCONFIGURED` IS LISTED BUT IS NOT LOAD-BEARING FOR THE
    // COVERAGE HALF, and that is measured rather than assumed: 161-09 removed
    // it and re-ran the law, which stayed GREEN (49 passed). The reason is
    // `SEAM_CODE_TO_WIZARD_CODE`, which maps it to ITSELF, and the law consults
    // the alias table before the roster — so the row is redundant there. It is
    // kept because this table's job is to state the route's vocabulary
    // completely, and a vocabulary with a hole in it that happens to be covered
    // by an alias is a worse artefact to inherit than a complete one. ⛔ Do not
    // read its presence as evidence that the law is checking it.
    "SEAM_MISCONFIGURED",
    "UNKNOWN",
  ]);

/**
 * Translate a dashboard write route's wire `code` into a `WizardErrorCode`.
 *
 * ⛔ THE CAST IS GUARDED AND THIS IS THE ONLY PLACE IT HAPPENS (Pitfall 4).
 * `code as WizardErrorCode` written at a consumer would silently admit every
 * string a route — or an attacker-influenced upstream — put in that field, and
 * `formatKeyError` would then fall through to UNKNOWN's copy while the envelope
 * advertised the unrecognised code in its `data-error-code` attribute. Here the
 * cast happens only after the value has been proven a member of THIS route's
 * roster, so an unrecognised code answers `UNKNOWN` by design rather than by
 * accident.
 *
 * A non-string (absent field, `null`, a number) answers `UNKNOWN` for the same
 * reason `recogniseSeamErrorCode` does: a response we could not read supports
 * no verdict.
 */
export function recogniseDashboardDialogCode(
  route: DashboardDialogRoute,
  wireCode: unknown,
): WizardErrorCode {
  if (typeof wireCode !== "string" || wireCode.length === 0) return "UNKNOWN";
  const roster = DASHBOARD_DIALOG_ROUTE_CODES.get(route);
  if (!roster) return "UNKNOWN";
  return roster.has(wireCode as WizardErrorCode)
    ? (wireCode as WizardErrorCode)
    : "UNKNOWN";
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
  // user-friendly label here resolves the cause line.
  //
  // ⚠️ 161-REVIEW / CR-02 — THIS LABEL IS NOW THE WHOLE OF ISSUE-012's FIX.
  // The other half was `formatColumnInDataframeMessage()`, which claimed to
  // rewrite the per-row message into "The required column `X` is missing…".
  // Measured against the producer: its regex required a literal `failed:` and
  // `csv_validator.py` has only ever emitted `… failed rule '…'`, so it never
  // fired — and for THIS rule the producer reports `column` as NaN, so there is
  // no `X` on the wire for any regex to extract. It was deleted rather than
  // repaired. Restoring an actionable per-row remedy needs the expected column
  // name as a first-class producer field (D-161-02); until then this label is
  // the only place the user is told what class of problem it is.
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

/*
 * ⚰️ REMOVED 161-REVIEW / CR-02 — `formatColumnInDataframeMessage(raw)`.
 *
 * It existed to rewrite a `column_in_dataframe` per-row message into an
 * actionable sentence: "The required column `daily_return` is missing from your
 * file. Rename a column to `daily_return` …". It pulled the column name out of
 * `raw` with a regex requiring a literal "failed:" and fell through to the
 * original message on a miss.
 *
 * ⛔ IT ALWAYS MISSED. MEASURED against the producer
 * (`analytics-service/services/csv_validator.py`, driven through `validate_csv`
 * at HEAD), every message it has ever built reads "… failed rule '…'":
 *
 *     Failed rule 'column_in_dataframe'.
 *     Column 'daily_return' failed rule 'daily_return_lower_bound' at row 2.
 *
 * The "Column 'None' failed: daily_return" shape the old docblock quoted is
 * PANDERA's own error text, which this producer does not forward — it builds
 * its own sentence. So the actionable remedy never reached a user, on any
 * message, ever, and `CsvValidationEnvelope` rendered `raw` unchanged.
 *
 * ⛔ AND IT IS UNREPAIRABLE AS A REGEX. It was only ever called for
 * `rule === "column_in_dataframe"`, and for that DATAFRAME-level check pandera
 * reports `column` as NaN — which is why 161-03 had to strip the literal `nan`
 * from the sentence. The expected column name is simply not on the wire. A
 * fixed pattern would have nothing to extract. Restoring the remedy needs the
 * expected column carried as a first-class producer field, which is D-161-02's
 * scope and is deliberately not smuggled in here.
 *
 * Deleting beats leaving a formatter that cannot fire: a function whose
 * docblock promises a remedy no code path can deliver is the same false claim
 * this phase removes from copy, wearing a different hat.
 * `CSV_RULE_LABELS.column_in_dataframe` ("Your CSV is missing a required
 * column") survives and is now the whole of ISSUE-012's fix.
 */
