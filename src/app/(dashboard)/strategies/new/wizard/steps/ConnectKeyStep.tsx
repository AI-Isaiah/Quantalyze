"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  recogniseSeamErrorCode,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { buildEnvelope } from "@/lib/envelope";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { ValidateWaitCard } from "../ValidateWaitCard";
import {
  WAIT_CARD_MOUNT_DELAY_MS,
  connectAbortDeadlineMsFor,
  validateBudgetSecondsFor,
} from "@/lib/wizard/validate-budget";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { SupportedExchange } from "@/lib/utils";
import { SFOX_UI_ENABLED, MT5_UI_ENABLED } from "@/lib/utils";
import {
  getWizardCorrelationId,
  wizardFetch,
} from "@/lib/wizard/wizard-correlation";
import { seamErrorCode } from "@/lib/seam-discriminator";
// 140.5-03 / SEAMPROSE-02 — the ONE `Retry-After` parser. A raw
// `Number(res.headers.get(...))` here is a repo-wide ESLint error by design
// (`quantalyze/no-raw-retry-after-parse`), because `Number("")` is 0 and
// `Number("Wed, 21 Oct…")` is NaN, and either fed to a wait is the
// thundering-herd shape this leaf exists to make unrepresentable.
import { parseRetryAfterSeconds } from "@/lib/retry/retry-after";

/**
 * ConnectKeyStep renders the exchange selector, the inline permission
 * block, and the key/secret/passphrase inputs. On submit it POSTs to
 * /api/strategies/create-with-key. All error states render scripted
 * copy from wizardErrors.ts — never raw server strings.
 */

// B8: the user-allowlist exchange ids derive from the single SupportedExchange
// set; the ExchangeOption[] array below adds component-specific UI metadata.
type ExchangeId = SupportedExchange;

interface ExchangeOption {
  id: ExchangeId;
  name: string;
  caption: string;
  requiresPassphrase: boolean;
  // Whether this exchange authenticates with an api_key + api_secret PAIR.
  // Absent → true (every ccxt exchange). sFOX authenticates with a SINGLE Bearer
  // token (no secret), so its card sets requiresSecret false: the secret input
  // is not rendered, submit is not gated on it, and the POST sends api_secret as
  // "" (the validate route's Phase-119 sfox carve-out normalizes + accepts it).
  requiresSecret?: boolean;
  // Per-exchange, presentation-only overrides for the credential-field labels
  // and placeholders. Defaults are "API Key"/"API Secret"; Deribit issues an
  // OAuth-style Client ID + Client Secret. The submit payload keys
  // (api_key/api_secret) and the generic storage columns are UNCHANGED — only
  // the rendered label/placeholder text differs.
  credentialLabels?: { key: string; secret: string };
  credentialPlaceholders?: { key: string; secret: string };
  // Per-exchange, presentation-only overrides for the third (passphrase-slot)
  // field. Today the third field is hardcoded to OKX ("OKX Passphrase"); MT5
  // reuses the SAME passphrase slot to collect the broker server, relabelled
  // "Broker server". Like credentialLabels (D-03), these mirror the label-only
  // precedent: the submit payload key (`passphrase`) and the storage column are
  // UNCHANGED — only the rendered label/placeholder/helper text differs.
  // Absent → today's OKX strings (byte-neutral for existing venues).
  passphraseLabel?: string;
  passphrasePlaceholder?: string;
  passphraseHelper?: string;
  // Whether the passphrase slot holds a genuine SECRET that must render masked.
  // Absent → true, which is OKX's behaviour, so every existing and future venue
  // that omits the key renders byte-identically to today (D-03: the OKX
  // passphrase is a real API credential and a GLOBAL unmask was rejected). MT5
  // sets false: the slot carries a broker SERVER NAME, not a credential, and the
  // founder must be able to read what they typed against the helper copy that
  // says "copy the server name exactly as it appears in your MT5 terminal".
  // Display-only — the value still rides the `passphrase` payload key into
  // encrypt_credentials and stays encrypted at rest.
  passphraseSecret?: boolean;
  // Optional muted helper rendered directly under the secret input. Absent →
  // nothing renders (byte-neutral). MT5 uses it for the up-front
  // investor-vs-master-password steer.
  secretHelper?: string;
}

// Phase 122 / SFOX-08: the sfox card is APPENDED only when SFOX_UI_ENABLED is on
// (the founder-gated NEXT_PUBLIC_SFOX_ENABLED flag). Flag OFF (default) leaves
// this array literal byte-identical to today's four cards (the spread is empty).
const EXCHANGES: ExchangeOption[] = [
  {
    id: "binance",
    name: "Binance",
    caption: "Spot + USDⓈ-M Futures + COIN-M Futures supported.",
    requiresPassphrase: false,
  },
  {
    id: "okx",
    name: "OKX",
    caption: "Spot + Perpetuals. Passphrase required.",
    requiresPassphrase: true,
  },
  {
    id: "bybit",
    name: "Bybit",
    caption: "Spot + Linear + Inverse supported.",
    requiresPassphrase: false,
  },
  {
    id: "deribit",
    name: "Deribit",
    caption: "Spot + Inverse Perpetuals + Options supported.",
    requiresPassphrase: false,
    credentialLabels: { key: "Client ID", secret: "Client Secret" },
    credentialPlaceholders: {
      key: "Paste the Deribit Client ID",
      secret: "Paste the Deribit Client Secret",
    },
  },
  ...(SFOX_UI_ENABLED
    ? [
        {
          id: "sfox" as const,
          name: "sFOX",
          caption: "Spot account. A single read-only API token, no secret.",
          requiresPassphrase: false,
          requiresSecret: false,
          credentialLabels: { key: "API Token", secret: "API Token" },
          credentialPlaceholders: {
            key: "Paste the read-only sFOX API token",
            secret: "Paste the read-only sFOX API token",
          },
        },
      ]
    : []),
  // Phase 138 / MT5UI-01: the MT5 card is APPENDED only when MT5_UI_ENABLED is
  // on (the founder-gated NEXT_PUBLIC_MT5_ENABLED flag). Flag OFF (default)
  // leaves this array literal byte-identical (empty spread). MT5 collects three
  // credentials into the existing {api_key, api_secret, passphrase} slots (the
  // 135 chokepoint): login → api_key, investor password → api_secret, broker
  // server → passphrase. requiresPassphrase:true renders the third field, gates
  // submit on it (:435), and flows the broker server into payload.passphrase.
  ...(MT5_UI_ENABLED
    ? [
        {
          id: "mt5" as const,
          name: "MT5",
          caption: "Live investor (read-only) login. Forex & CFD.",
          requiresPassphrase: true,
          credentialLabels: { key: "MT5 login", secret: "Investor password" },
          credentialPlaceholders: {
            key: "Your MT5 account number",
            secret: "Your read-only investor password",
          },
          passphraseLabel: "Broker server",
          passphraseSecret: false,
          passphrasePlaceholder: "Exactly as shown in your MT5 terminal",
          passphraseHelper:
            "Open your MT5 terminal's login window and copy the server name exactly as it appears there — it is broker-specific and often carries a region or Demo/Live suffix.",
          secretHelper:
            "Use your investor (read-only) password — not your master password. A master password can place trades, so we refuse it and store nothing.",
        },
      ]
    : []),
];

// F3 (Phase 122): the sfox honest "what we reject" atom. sFOX exposes no per-key
// scope endpoint, so we cannot PROBE scope the way the ccxt scope-rejection claim
// implies — say the structural facts instead, never a false verified-scope claim.
const SFOX_REJECT_ATOM_BODY =
  "sFOX keys are used read-only by our adapter — no order or withdraw path exists. sFOX exposes no per-key scope endpoint, so mint a READ-ONLY token.";

// Phase 138 / MT5UI-01 (UI-SPEC Delta 2): the mt5 honest "what we reject" atom.
// MT5 accounts carry a master password (can trade) and a separate investor
// (read-only) password. We refuse the master at connect time — state that
// structural fact up front rather than the ccxt scope-rejection claim, which
// does not describe MT5's mechanism.
const MT5_REJECT_ATOM_BODY =
  "MT5 master passwords can place trades, so we reject them at connect time and store nothing — only a read-only investor login is accepted.";

const TRUST_ATOMS: { title: string; body: string }[] = [
  {
    title: "What we store",
    body: "Your API key and secret are encrypted with AES-256-GCM envelope encryption before they ever hit the database. The KEK lives in Supabase Vault.",
  },
  {
    title: "What we reject",
    body: "Any key with trading or withdrawal scopes is rejected before we store it. Only Read permissions are allowed, enforced at the database level.",
  },
  {
    title: "Who can decrypt",
    body: "Only the Railway analytics service can decrypt the stored ciphertext to fetch your trade history. The web tier has no decryption path.",
  },
  {
    title: "Security contact",
    body: "Questions? security@quantalyze.com responds within one business day.",
  },
];

/**
 * 140.3-13a / SEAMUX-08 — every `WizardErrorCode` that
 * `POST /api/strategies/create-with-key` can actually put on the wire.
 *
 * WHY A SET AND NOT A CAST. This replaces a bare `as WizardErrorCode` cast of
 * `data.code` — widened with an optional and then defaulted to `"UNKNOWN"` — a
 * raw cast of NETWORK DATA into a closed union with no membership check at all.
 * (The removed line is described rather than quoted verbatim: this plan's
 * acceptance grep for that exact token sequence is a raw repo scan with no
 * comment exclusion, so a pasted citation would keep reporting the class open.)
 * A cast is a compile-time assertion; `data.code` is whatever an upstream, a
 * proxy or an edge/WAF layer happened to put in a JSON body. Before this, any
 * string at all became a "typed" `WizardErrorCode`, was handed to
 * `buildEnvelope`, and rendered as `WIZARD_ERROR_COPY[code]` — `undefined` —
 * while the funnel recorded a code that is not in our vocabulary. The shape
 * copied here is `SubmitStep.tsx`'s `KNOWN_FINALIZE_CODES`, which is the
 * CORRECT form of the same problem and is deliberately left where it is.
 *
 * WHY IT IS HAND-WRITTEN PER ROUTE, NOT A TOTALITY CHECK OVER THE UNION. A step
 * should admit the codes ITS route emits, not every code in the vocabulary: a
 * `CSV_NAV_ZERO` arriving here is drift, not a key-connect failure, and reading
 * it as one would render CSV copy on the exchange form. That is also why this
 * set is not shared with `MultiKeyConnectStep` — its two routes emit different
 * sets, and one shared set would silently admit each route's codes at the other.
 *
 * ⚠️ THERE IS NOW A WIRE→WIZARD TRANSLATION STEP, AND THIS PARAGRAPH USED TO
 * ARGUE THERE COULD NEVER BE ONE. Until `140.4-13` the argument held: the route
 * routed every caught value through the shared `classifyKeyValidationError`
 * (which maps `CircuitOpenError` to `SERVICE_UNAVAILABLE_RETRY`, a member
 * below) before answering, so `grep -c 'CIRCUIT_OPEN\|UPSTREAM_TIMEOUT\|
 * UPSTREAM_NETWORK_ERROR'` on `create-with-key/route.ts` was 0 and a hop would
 * have been machinery no reachable path could exercise. It then closed with
 * *"if that route ever starts emitting a wire code, it falls to `UNKNOWN` here
 * — which is the safe direction"*. **`140.4-13` made the route start emitting
 * one, and `UNKNOWN` turned out not to be the safe direction.** Its 503
 * misconfiguration arm now answers `SEAM_MISCONFIGURED` (a WIRE code, from
 * `rateLimitDenyJson`'s `misconfiguredBody`), replacing the 429 `KEY_RATE_LIMIT`
 * that told the user our own limiter outage was "a transient, exchange-side
 * throttle and not a problem with your key". Landing on `UNKNOWN` renders
 * *"Try the last action again."* — **with a Retry control** — for a fault whose
 * own copy says *"Retrying will not clear it: the setting stays wrong until we
 * fix it and redeploy."* The comment above is kept rather than deleted because
 * the reasoning it records is exactly what went stale, and how.
 *
 * THE HOP IS THE ONE SHARED TABLE, NOT A NEW ROSTER MEMBER. Adding
 * `SEAM_MISCONFIGURED` to the set below would be a hand-typed allow-list edit
 * (coverage-law row 2) owed again at every surface the next wire code reaches;
 * `SEAM_CODE_TO_WIZARD_CODE` (in `wizardErrors.ts`, read through
 * `recogniseSeamErrorCode`) is the single artefact (row 1) and already carried
 * the entry. This mirrors `SyncPreviewStep.tsx`'s kickoff arm exactly.
 *
 * ORDER IS THE WHOLE CHANGE, AND IT IS SAFE BY MEASUREMENT — NOW ASSERTED, NOT
 * NARRATED (140.4-16 / WR-11). `seam-ratelimit-posture.invariant.test.ts`
 * derives both vocabularies from disk and fails when a code they SHARE gets
 * different answers. That is the necessary condition; disjointness below is a
 * sufficient one that happens to hold HERE and does NOT hold at every surface
 * (`KNOWN_KICKOFF_CODES` shares `RATE_LIMITED`). The table's key set
 * (`VALIDATION_FAILED`, `RATE_LIMITED`, `CIRCUIT_OPEN`, `UPSTREAM_TIMEOUT`,
 * `UPSTREAM_NETWORK_ERROR`, `SEAM_MISCONFIGURED`) and this set intersect in
 * NOTHING, so translating first cannot change what any existing member renders.
 * NEITHER LIST GAINED A MEMBER. The fallback is not weakened either — a wire
 * code with no table entry (`SEAM_DEGRADED`, the venue codes) still leaves the
 * translation at `UNKNOWN`, misses the set, and lands on `UNKNOWN`, which is
 * what the unrecognised-code case pins.
 *
 * The members, enumerated from the route rather than remembered:
 *   · emitted directly by `create-with-key/route.ts`
 *   · returned by the shared `classifyKeyValidationError` at its catch arm
 */
const KNOWN_CREATE_WITH_KEY_CODES: ReadonlySet<WizardErrorCode> =
  new Set<WizardErrorCode>([
    // Emitted directly by the route's own guards.
    "KEY_INVALID_FORMAT",
    // 142.2 / MT5-04 (D-05) — the four codes `KEY_INVALID_FORMAT` was split
    // into. `create-with-key/route.ts` emits all four from its own guards, so
    // all four belong HERE and not only in the union: a code absent from this
    // roster is rejected as unrecognised and renders UNKNOWN, which would have
    // replaced one wrong sentence with a worse one. `KEY_INVALID_FORMAT` stays
    // because the route still emits it at its one genuine format guard.
    "KEY_MISSING_REQUIRED_FIELD",
    "KEY_UNSUPPORTED_VENUE",
    "KEY_VENUE_NOT_ENABLED",
    "KEY_INPUT_TOO_LONG",
    "KEY_NOT_READ_ONLY",
    "KEY_HAS_TRADING_PERMS",
    "KEY_HAS_WITHDRAW_PERMS",
    "DRAFT_ALREADY_EXISTS",
    // 154.1 / WIZCONT-02 review CR — the venue fence's REFUSAL half, admitted
    // HERE IN THE SAME COMMIT the route starts emitting it. Omit this line and
    // the code fails the membership check below, falls through to `UNKNOWN` —
    // whose copy IS recoverable — so the user gets "Try the last action again."
    // with a Retry control for a submit that is refused identically every time,
    // and the honest sentence naming their existing strategy ships invisible
    // while every route-side test stays green. That is the trap `SubmitStep.tsx`
    // records three times over; it is written out again rather than cited
    // because this roster is the one the next author will be editing.
    "VENUE_ALREADY_CONNECTED",
    "KEY_RATE_LIMIT",
    "UNKNOWN",
    // Returned by `classifyKeyValidationError` (src/lib/wizardErrors.ts) — the
    // SHARED classifier this route and composite/add-key both call, so this
    // half of the set is identical at both key-entry steps by construction.
    "SERVICE_UNAVAILABLE_RETRY",
    "KEY_INVALID_SIGNATURE",
    "KEY_AUTH_FAILED",
    "KEY_MT5_MASTER_PASSWORD",
    "KEY_MT5_WRONG_SERVER",
    "KEY_IP_ALLOWLIST",
    "KEY_NETWORK_TIMEOUT",
    "KEY_PROBE_FAILED",
    "KEY_EXCHANGE_UNAVAILABLE",
    "KEY_VENUE_TRANSIENT",
    // ⚠️ STOPGAP (hotfix 2026-08-06, incident 2026-08-05): the server
    // classified a validate-key failure as `SERVICE_UNREACHABLE`, but this
    // roster did not carry it, so the membership check rejected the honest
    // code and the wizard rendered UNKNOWN ("Try the last action again", with
    // a Retry control) for a fault whose own copy says the request never got
    // an answer. The two scope codes travel with it: the verify-key seam maps
    // MISSING_SCOPE / PERMISSION_DENIED onto them and both routes can put
    // them on the wire the same way. All three have copy in
    // `WIZARD_ERROR_COPY` (verified: SERVICE_UNREACHABLE,
    // KEY_MISSING_READ_SCOPE, KEY_PERMISSION_DENIED entries exist in
    // `wizardErrors.ts`). This is exactly the hand-typed allow-list edit the
    // docblock above warns about — the CLASS fix (a roster DERIVED from the
    // route contract instead of hand-maintained) stays with Phase 153 /
    // WIZFORM-02; do not grow this list further, derive it there.
    "SERVICE_UNREACHABLE",
    "KEY_MISSING_READ_SCOPE",
    "KEY_PERMISSION_DENIED",
    // 153.7-02 / WIZFORM-02-CLASS — admitted HERE IN THE SAME COMMIT the shared
    // classifier starts returning it. `VENUE_WIRE_CODE_TO_VERDICT` now answers
    // for `MT5_GATEWAY_UNCONFIGURED`, `ADAPTER_INIT_FAILED` and `INTERNAL` with
    // `SEAM_INTERNAL_FAULT`; omit this line and the membership check rejects the
    // honest code, the step renders `UNKNOWN` — whose copy IS recoverable — and
    // the user gets "Try the last action again." with a Retry control for three
    // faults the service marked `retryable=False`. That is the same trap the
    // `VENUE_ALREADY_CONNECTED` note above records, and the same one the 2026-08-05
    // `SERVICE_UNREACHABLE` incident below it records.
    //
    // ⚠️ ITS FOUR SIBLING VERDICTS COST NOTHING HERE, and the asymmetry is worth
    // stating rather than leaving to be rediscovered: `SERVICE_UNREACHABLE` and
    // `KEY_PROBE_FAILED` are already members, and `SEAM_MISCONFIGURED` — which
    // that same batch maps `EGRESS_PROXY_MISCONFIGURED`, `SERVICE_KEY_UNCONFIGURED`
    // and `KEK_UNAVAILABLE` onto — is resolved by the TRANSLATE-FIRST hop through
    // `SEAM_CODE_TO_WIZARD_CODE` and never reaches this set, exactly as the
    // docblock above says. `SEAM_INTERNAL_FAULT` is deliberately absent from that
    // table (we mint it; no service puts it on the wire), so this roster is the
    // only thing standing for it.
    "SEAM_INTERNAL_FAULT",
  ]);

export interface ConnectKeySuccess {
  strategyId: string;
  apiKeyId: string;
  exchange: ExchangeId;
  /**
   * 154-06 / WIZCONT-02. Present and `true` ONLY when the server resolved this
   * submit onto a strategy the user already had — a re-connect of credentials
   * we already hold, from a context that lost the `wizard_session_id` token.
   * Absent on every other arm, including the ordinary first connect and the F6
   * session-fence replay (that one is a double-click; it needs no explaining).
   *
   * ⭐ IT IS REPORTED UPWARD RATHER THAN RENDERED HERE, AND THAT IS THE WHOLE
   * REASON THIS FIELD EXISTS. `onSuccess` is `WizardClient`'s step advance: it
   * calls `setStep("sync_preview")`, so this component UNMOUNTS in the same
   * commit. A notice rendered inside `ConnectKeyStep` on this path would be
   * dead markup — it could never paint for a single frame. The strip therefore
   * lives in `WizardClient`'s chrome, beside the session-expired strip it is
   * cloned from (UI-SPEC names that strip as its visual donor).
   *
   * ⛔ NEVER carries the credential or the venue account id — the server does
   * not send it and this type must not grow a field for it.
   */
  deduped?: boolean;
}

/**
 * The unvalidated credential draft the user has typed so far. Reported to the
 * parent via `onDraftChange` so a transition OUT of this component (multi-key
 * mode) can carry the in-progress key over instead of discarding it (UAT/F-4:
 * entering a key then clicking "+ Add another key window" must not erase it).
 */
export interface ConnectKeyDraft {
  exchange: ExchangeId;
  nickname: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

export interface ConnectKeyStepProps {
  wizardSessionId: string;
  onSuccess: (result: ConnectKeySuccess) => void;
  /**
   * Phase 88 / ONB-01 (A1). Optional slot rendered between the primary CTA and
   * the CSV escape-hatch. DEFAULT-ABSENT keeps this component byte-identical to
   * the single-key experience — the multi-key step (MultiKeyConnectStep) uses
   * it to inject the ghost "+ Add another key window" affordance. When
   * undefined, `{footerSlot}` renders nothing, so the DOM is unchanged.
   */
  footerSlot?: ReactNode;
  /**
   * UAT/F-4. Optional draft reporter. Fires whenever the credential fields
   * change so the parent (MultiKeyConnectStep) can seed the first key panel with
   * the in-progress draft when the user switches to multi-key mode. Absent for
   * the standalone single-key wizard → no behavior change.
   */
  onDraftChange?: (draft: ConnectKeyDraft) => void;
}

export function ConnectKeyStep({ wizardSessionId, onSuccess, footerSlot, onDraftChange }: ConnectKeyStepProps) {
  const [exchange, setExchange] = useState<ExchangeId>("binance");
  const [nickname, setNickname] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<WizardErrorCode | null>(null);
  /**
   * 140.5-03 / SEAMPROSE-02 — the wait the failing response ADVERTISED, in
   * seconds, or `null` when it advertised none.
   *
   * `/api/strategies/create-with-key` stamps `Retry-After` on its 429 (its own
   * `rateLimitDenyJson`), and since the choke-point relay it also carries the
   * ANALYTICS SERVICE's own 429 wait through `postProcessKey`. Before this the
   * value arrived at the browser and was dropped on the floor.
   *
   * PER-FAILURE state, cleared on every fresh attempt alongside `errorCode`
   * (TRAP-3): a wait left over from attempt 1 rendered against attempt 2's
   * failure names a duration nobody advertised, which is worse than naming
   * none — it turns a vague error into a specific lie.
   */
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(
    null,
  );
  /**
   * 154.1 / WIZCONT-02 review CR — the name of the strategy that ALREADY holds
   * the account this attempt tried to connect, or `null` when the response
   * named none.
   *
   * PER-FAILURE state on exactly the same terms as `retryAfterSeconds` above and
   * for the same reason (TRAP-3): a name left over from attempt 1, rendered
   * against attempt 2's failure, points the user at a strategy that has nothing
   * to do with what just happened — a specific lie in place of a vague one. Both
   * are set from the SAME response as `errorCode`, so a code and a name can
   * never describe different failures.
   */
  const [existingStrategyName, setExistingStrategyName] = useState<
    string | null
  >(null);
  // UX-02: the wizard session correlation id — the SAME id wizardFetch sends
  // on every request below, so the id shown in an error envelope matches the
  // failing request's server logs / Sentry tag / compute_jobs.metadata.
  const [correlationId] = useState<string>(() => getWizardCorrelationId());

  /**
   * 153.4-04 / D-05 / WIZFORM-05 — THE HONEST LONG WAIT.
   *
   * 153.4-01/02 granted a serialized venue (MT5) a 120 000 ms validate budget.
   * Without the state below, that budget buys a two-minute disabled button
   * reading `Validating...` and nothing else — which D-05 states plainly is a
   * worse product than the fast wrong answer it replaced.
   *
   * All of it is LOCAL to this step. Nothing is threaded through `WizardClient`:
   * the wait belongs to the request this component made, and `MultiKeyConnectStep`
   * owns its own per-panel copy of the same shape (plan 153.4-05).
   */
  /** When the in-flight validate left the browser, or `null` when none is. */
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  /**
   * 153.4 review WR-04 — the SAME stamp, readable synchronously.
   *
   * The 300 ms render gate below is a `setTimeout`, i.e. a macrotask; the thing
   * that used to be its only OFF switch was the timer effect's cleanup, which
   * React commits on its own schedule. For a validate answering at ~250 ms on a
   * loaded main thread the order `finally → setShowWaitCard(false)` … `gate →
   * setShowWaitCard(true)` is reachable, and nothing after it ever turns the card
   * off again: a ghost card over a finished request, frozen at `0s`, whose
   * `Stop waiting` (past the 40 % rung) calls `abort()` on a ref the `finally`
   * already nulled — a control that does nothing.
   *
   * ⭐ The gate self-guards on this ref instead of trusting cleanup ordering.
   * Written beside every `setWaitStartedAt`, and only there, so the two cannot
   * describe different attempts.
   *
   * ⛔ NOT MIRRORED INTO `MultiKeyConnectStep`. That surface is immune BY
   * CONSTRUCTION — its gate is `p.status === "validating" && p.waitElapsedMs >=
   * WAIT_CARD_MOUNT_DELAY_MS`, a derivation of render-time state with no timer to
   * fire late — and adding a ref there would be machinery guarding nothing.
   */
  const waitStartedAtRef = useRef<number | null>(null);
  /** Milliseconds since `waitStartedAt`, ticked once per second (never faster). */
  const [elapsedMs, setElapsedMs] = useState(0);
  /**
   * The 300 ms render gate (UI-SPEC Surface 1). A separate boolean rather than a
   * comparison in the JSX, because the gate must be a TIMER: a sub-300 ms answer
   * has to complete before this ever flips, so no card can flash.
   */
  const [showWaitCard, setShowWaitCard] = useState(false);
  /**
   * The user pressed `Stop waiting`. NOT an error — see the neutral line rendered
   * below the form. Cleared on the next submit and the moment any field changes.
   */
  const [cancelled, setCancelled] = useState(false);
  /**
   * The venue of the CURRENT attempt, frozen at submit. The exchange cards stay
   * clickable while a validate is in flight, and every duration this component
   * states — the card's promise, the ladder's rungs, the client deadline, and the
   * `budgetSeconds` the deadline envelope names — must describe the request that
   * is actually on the wire. Reading live `exchange` would let a mid-flight card
   * click re-time the deadline and advertise a budget nobody granted (T-153.4-12).
   */
  const [attemptExchange, setAttemptExchange] = useState<ExchangeId | null>(null);
  /** The in-flight validate's controller — the only thing `Stop waiting` touches. */
  const abortRef = useRef<AbortController | null>(null);
  /**
   * WHO aborted. An `AbortError` is indistinguishable at the catch: a user cancel
   * and a spent budget both arrive as the same rejection, and they are opposite
   * outcomes — one is a choice that must not be recorded as a failure, the other
   * is a failure that must be.
   */
  const abortReasonRef = useRef<"user" | "deadline" | null>(null);
  /**
   * The submit row, so a cancel can put focus back on the submit button
   * (UI-SPEC Surface 1 §Cancel affordance).
   *
   * ⚠️ THE ROW, NOT THE BUTTON, and that is a conflict surfaced rather than
   * blended (Rule 7). The shared `ui/Button.tsx` is a plain function component
   * whose props are `ButtonHTMLAttributes` — which carries no `ref` — so
   * passing a `ref` to `<Button>` is a compile error (TS2322: "Property 'ref'
   * does not exist"), and this phase's UI-SPEC ⛔ forbids
   * editing `Button.tsx` (`AllocateDialog.test.tsx` carves it out BY IDENTITY).
   * Adding a `ref` prop there is the right fix and is logged in TODOS.md; until
   * then the row holds the ref and the query below finds the one submit control
   * inside it.
   */
  const submitRowRef = useRef<HTMLDivElement | null>(null);
  /**
   * 153.4 review CR-04 — is this component still on screen?
   *
   * Read by the SUCCESS arm before it calls `onSuccess`. `onSuccess` is threaded
   * straight through to `WizardClient` and ADVANCES THE WIZARD, so a dead closure
   * calling it navigates a user who is no longer looking at this form.
   */
  const mountedRef = useRef(true);

  /**
   * 153.4 review CR-04 — UNMOUNTING IS NOT A VERDICT, AND IT MUST NOT PRODUCE ONE.
   *
   * The reachable path, in the composite wizard: the user selects MT5, submits (a
   * 120 s wait), and clicks "+ Add another key window" — which is not disabled
   * while a validate is in flight. `enterMulti` flips to State B, THIS component
   * unmounts, and the timer effect's cleanup clears the client deadline with it,
   * so the request runs on with no controller holding it and no deadline. Up to
   * two minutes later the still-live closure called
   * `onSuccess({strategyId, apiKeyId, exchange})`, advancing the wizard past
   * `connect_key` with a SINGLE-KEY strategy and discarding the member panels the
   * user had been filling in ever since.
   *
   * Two independent stops, deliberately: abort the request (nothing should stay
   * on the wire for a surface the user has left), and gate the outcome arm on
   * `mountedRef` so a response that beat the abort still cannot navigate.
   *
   * ⚠️ The reason is `"user"` because leaving IS a user action: recording it as a
   * deadline would put a seam failure in the funnel for a healthy request.
   */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortReasonRef.current = "user";
      abortRef.current?.abort();
    };
  }, []);

  // UAT/F-4: report the in-progress draft up so a switch to multi-key mode can
  // carry it into the first panel instead of discarding it. No-op (single-key
  // wizard) when onDraftChange is absent.
  useEffect(() => {
    onDraftChange?.({ exchange, nickname, apiKey, apiSecret, passphrase });
  }, [onDraftChange, exchange, nickname, apiKey, apiSecret, passphrase]);

  /**
   * 153.4-04 — the wait's THREE timers, armed together and torn down together.
   *
   * Both deps are frozen at submit, so this effect runs exactly once per attempt:
   * a re-render cannot re-arm the deadline and buy the request another budget.
   */
  useEffect(() => {
    if (waitStartedAt === null) return;

    // 1. The clock. ⛔ Never faster than 1 s — the card renders whole seconds and
    //    a faster tick buys nothing but renders.
    const tick = setInterval(() => {
      setElapsedMs(Date.now() - waitStartedAt);
    }, 1_000);

    // 2. The render gate. A validate that answers inside 300 ms clears this
    //    timeout in its `finally` before it can fire, so no card flashes.
    //
    //    ⚠️ AND IT SELF-GUARDS (153.4 review WR-04), because "clears it in its
    //    `finally`" is not something this timer can rely on: the clear happens in
    //    THIS effect's cleanup, which React commits at its own priority, while the
    //    timeout is a macrotask that can beat it. If the wait this gate was armed
    //    for is already over, mounting the card now would leave it mounted — no
    //    later code turns `showWaitCard` off until the next submit.
    const mountGate = setTimeout(() => {
      if (waitStartedAtRef.current !== waitStartedAt) return;
      setShowWaitCard(true);
    }, WAIT_CARD_MOUNT_DELAY_MS);

    // 3. The client deadline backstop.
    //
    //    ⚠️ IT COVERS THE ROUTE, NOT THE VALIDATE LEG (153.4 review CR-01). The
    //    thing being aborted is `POST /api/strategies/create-with-key`, which
    //    spends `validateKey` THEN `encryptKey` THEN the create RPC — and which
    //    does not read `request.signal`, so this abort has no server-side effect
    //    whatsoever. A deadline sized on the validate budget alone fired almost
    //    exclusively in the window where validate had already SUCCEEDED and the
    //    route was storing the key, and then told the user nothing was saved.
    //    `connectAbortDeadlineMsFor` covers validate + encrypt + the
    //    FAILING-state store worst case + the grace, so this verdict is only
    //    reachable once the server has genuinely stopped answering.
    //
    //    ⛔ THE FAILING COLUMN, NOT THE CLOSED ONE (153.6 / PARITY-03). The
    //    first version of this deadline covered both legs plus the grace and
    //    was compared against the route's CLOSED-breaker worst case — a figure
    //    that describes a healthy seam, which is never the seam that keeps a
    //    browser waiting this long. The breaker's own store costs three
    //    commands per seam call in the failing state instead of one, and that
    //    difference is what the deadline was short by, on BOTH venue arms.
    //
    //    WHY A GRACE ON TOP. The seam deadlines fire INSIDE our own route and the
    //    browser→route hop is not free, so giving up at exactly the route's budget
    //    could cut off a verdict already on the wire and re-create the silent
    //    UNKNOWN this whole phase exists to end. The browser gives up LAST — but
    //    it does give up, so no request can hold this tab open forever
    //    (T-153.4-16).
    //
    //    ⚠️ The figure the copy advertises stays the validate BUDGET (what we
    //    grant the broker), never this one: the deadline is our margin over the
    //    promise, not an extension of the promise.
    const deadline = setTimeout(() => {
      abortReasonRef.current = "deadline";
      abortRef.current?.abort();
    }, connectAbortDeadlineMsFor(attemptExchange));

    return () => {
      clearInterval(tick);
      clearTimeout(mountGate);
      clearTimeout(deadline);
    };
  }, [waitStartedAt, attemptExchange]);

  /**
   * 153.4-04 — a stale cancelled line must never sit under a fresh attempt.
   *
   * The same discipline the 140.5-03 comment applies to `retryAfterSeconds`: the
   * sentence says "your key details are still on this page", and once the user
   * starts editing those details it is describing an attempt that no longer
   * matches what they are looking at. Held here rather than in five `onChange`
   * handlers so a sixth field cannot be added without it.
   */
  useEffect(() => {
    setCancelled(false);
  }, [exchange, nickname, apiKey, apiSecret, passphrase]);

  /**
   * 153.4-04 — move focus to the submit button after a cancel (UI-SPEC Surface 1).
   *
   * ⚠️ NOT in the click handler. `Stop waiting` lives inside a card that unmounts
   * on the same interaction, and at the instant of the click the submit button is
   * still `disabled` — `focus()` on a disabled control is a no-op, so focus would
   * fall to `<body>` and a keyboard user would lose their place entirely. The
   * abort resolves a tick later; by the time `cancelled` is true and `submitting`
   * is false the button is enabled and focusable.
   */
  useEffect(() => {
    if (!cancelled || submitting) return;
    submitRowRef.current
      ?.querySelector<HTMLButtonElement>('button[type="submit"]')
      ?.focus();
  }, [cancelled, submitting]);

  const activeExchange = EXCHANGES.find((e) => e.id === exchange);
  // WR-01: the per-exchange "setup guide" SubAnchors for the flag-gated venues
  // (sfox #sfox-readonly, mt5 #mt5-readonly) are gated on their SERVER go-live
  // flags (isSfoxEnabledServer / isMt5EnabledServer), while this wizard card is
  // gated on the CLIENT flag. In the documented card-visible / guide-dark
  // half-state those per-exchange anchors do not render, so a deep link to them
  // lands on /security top with no guide. Point those venues at the
  // UNCONDITIONAL #readonly-key section anchor (the parent "Creating a read-only
  // API key" Section, always rendered) — matching the error-envelope link — so
  // the link is never dead. Other venues keep their per-exchange anchor.
  const guideAnchor =
    exchange === "sfox" || exchange === "mt5"
      ? "readonly-key"
      : `${exchange}-readonly`;
  const requiresPassphrase = activeExchange?.requiresPassphrase ?? false;
  // Absent requiresSecret → true (every ccxt exchange). sFOX is token-only.
  const requiresSecret = activeExchange?.requiresSecret ?? true;
  // Swap the "What we reject" atom body to the honest structural claim per
  // venue. MT5 is keyed on the venue id (it REQUIRES a secret, so the sfox
  // `!requiresSecret` branch can never fire for it — check mt5 FIRST). F3: sfox
  // keys on `!requiresSecret` (no order/withdraw path; no per-key scope
  // endpoint). Every other exchange renders today's scope-rejection copy
  // byte-identically.
  const trustAtoms = TRUST_ATOMS.map((atom) => {
    if (atom.title !== "What we reject") return atom;
    if (activeExchange?.id === "mt5")
      return { ...atom, body: MT5_REJECT_ATOM_BODY };
    if (!requiresSecret) return { ...atom, body: SFOX_REJECT_ATOM_BODY };
    return atom;
  });
  // Presentation-only credential labels/placeholders. Default to the generic
  // "API Key"/"API Secret" wording; Deribit overrides to "Client ID"/"Client
  // Secret" (D-03). Storage columns + payload keys are unchanged.
  const keyLabel = activeExchange?.credentialLabels?.key ?? "API Key";
  const secretLabel = activeExchange?.credentialLabels?.secret ?? "API Secret";
  const keyPlaceholder =
    activeExchange?.credentialPlaceholders?.key ?? "Paste the read-only key";
  const secretPlaceholder =
    activeExchange?.credentialPlaceholders?.secret ?? "Paste the secret";
  // Third (passphrase-slot) field overrides. Default to today's OKX strings so
  // existing venues render byte-identically; MT5 relabels it "Broker server".
  const passphraseLabel = activeExchange?.passphraseLabel ?? "OKX Passphrase";
  const passphrasePlaceholder =
    activeExchange?.passphrasePlaceholder ?? "Paste the OKX passphrase";
  const passphraseHelper =
    activeExchange?.passphraseHelper ??
    "OKX requires a passphrase in addition to key and secret. You set this when you created the API key on OKX.";
  // MT5-03 / D-03: whether the passphrase slot is masked. Defaults to TRUE —
  // the default IS the byte-identity mechanism, so the OKX config entry is not
  // edited and OKX keeps today's Show/Hide-toggled password render exactly.
  const passphraseSecret = activeExchange?.passphraseSecret ?? true;
  // Optional muted helper under the secret input (MT5's investor-vs-master
  // steer). Absent → render nothing.
  const secretHelper = activeExchange?.secretHelper;

  const onSelectExchange = useCallback((next: ExchangeId) => {
    setExchange(next);
    setErrorCode(null);
  }, []);

  /**
   * 153.4-04 — abandon the wait, keep everything else.
   *
   * ⛔ NO CONFIRMATION DIALOG. Pressing this costs the user nothing they can act
   * on: the request is going to finish or fail on its own either way, and a
   * confirmation step on the one control whose entire purpose is escaping a stall
   * is the opposite of the affordance.
   *
   * ⚠️ ABORTING STOPS THE BROWSER LISTENING; IT DOES NOT STOP THE SERVER WORKING,
   * AND THE SERVER'S WORK IS NOT ONLY A PROBE. This comment used to close with
   * "nothing is written on this path — which is exactly why the cancelled copy
   * can truthfully say nothing was saved". THAT WAS A FACT ABOUT `validate-key`
   * ASSERTED ABOUT THE ROUTE (153.4 review CR-02). What the user aborts is
   * `POST /api/strategies/create-with-key`, which runs `validateKey` →
   * `encryptKey` → `create_wizard_strategy`; the invocation does not read
   * `request.signal`, so on any run where validate subsequently succeeds the
   * credential IS encrypted and the `api_keys` + `strategies` rows ARE written,
   * seconds after we told the user nothing was saved.
   *
   * ⛔ The cancelled line below therefore states only what THIS BROWSER knows.
   */
  const handleStopWaiting = useCallback(() => {
    abortReasonRef.current = "user";
    abortRef.current?.abort();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorCode(null);
    // 140.5-03 — cleared WITH the code it belongs to. This is the half a
    // copy-paste of the SyncPreviewStep thread drops (TRAP-3).
    setRetryAfterSeconds(null);
    // 154.1 — the same clearing rule, for the same reason. See the state's own
    // docblock: a stale name is a specific lie about which strategy is in the
    // way.
    setExistingStrategyName(null);
    // 153.4-04 — a fresh attempt clears the previous one's cancelled line for the
    // same reason, and starts the wait: the venue is frozen, the clock is stamped
    // from ONE `Date.now()` the tick then measures against, and the controller is
    // in place BEFORE the request leaves.
    setCancelled(false);
    setAttemptExchange(exchange);
    setElapsedMs(0);
    setShowWaitCard(false);
    // ONE stamp into both the state the effect keys on and the ref the render
    // gate self-guards against (153.4 review WR-04). Two `Date.now()` calls here
    // would make the guard compare two different attempts' clocks.
    const started = Date.now();
    waitStartedAtRef.current = started;
    setWaitStartedAt(started);
    const controller = new AbortController();
    abortRef.current = controller;
    abortReasonRef.current = null;
    setSubmitting(true);
    // Set on the SUCCESS arm only. The `finally` below reads it to decide whether
    // to re-enable the button — see the comment there.
    let succeeded = false;

    try {
      const res = await wizardFetch("/api/strategies/create-with-key", {
        method: "POST",
        // `wizardFetch` spreads `init` and overrides only `headers`, so the
        // signal reaches `fetch` unchanged — no change to that module is needed.
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange,
          api_key: apiKey,
          // sFOX is token-only: send api_secret as "" (the Phase-119 validate
          // carve-out normalizes empty→"" and accepts it for sfox; every ccxt
          // exchange still sends its real secret).
          api_secret: requiresSecret ? apiSecret : "",
          passphrase: requiresPassphrase ? passphrase : null,
          label: nickname.trim() || `${exchange} key`,
          wizard_session_id: wizardSessionId,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        strategy_id?: string;
        api_key_id?: string;
        // 154-06 / WIZCONT-02 — the venue-identity dedup marker. Read as a
        // strict `=== true` below: a truthy-but-not-true value would be the
        // route drifting, and this is a screen decision, not a coercion.
        deduped?: boolean;
        // 154.1 / WIZCONT-02 review CR — present ONLY on the route's
        // `VENUE_ALREADY_CONNECTED` refusal, and only when the route could read
        // the name off the caller's own row. Typed as optional and read through
        // a `typeof` check below: absence is "we were not told", never a blank.
        strategy_name?: string;
        code?: string;
        error?: string;
      };

      if (!res.ok || !data.strategy_id || !data.api_key_id) {
        // 140.3-13a / SEAMUX-08 — membership-checked, never cast. See
        // KNOWN_CREATE_WITH_KEY_CODES above for why the check exists and why
        // the set is this route's own rather than the whole union.
        //
        // 140.4-15 / SEAMRIM-08 — TRANSLATE FIRST, THEN MEMBERSHIP-CHECK, the
        // same order `SyncPreviewStep`'s kickoff arm adopted in 140.4-12.
        // `SEAM_CODE_TO_WIZARD_CODE` answers for the seam's WIRE vocabulary
        // (this route's 503 arm emits `SEAM_MISCONFIGURED`); the set below
        // answers for the wizard codes the route itself mints.
        //
        // ⚠️ 140.5-03 / SEAMPROSE-03 — CORRECTION. This paragraph used to end
        // "the two vocabularies are disjoint, so neither hop can shadow the
        // other". THE SENTENCE IS THE WRONG REASON FOR A TRUE CONCLUSION, and
        // it contradicts this file's own header (search `ORDER IS THE WHOLE
        // CHANGE`), which already qualifies disjointness as holding HERE and
        // NOT at every surface.
        //
        // THE NECESSARY PROPERTY IS AGREEMENT; DISJOINTNESS IS ONLY SUFFICIENT.
        // Where the two vocabularies overlap, the table wins by the order
        // above — harmless precisely because both sides answer the SAME code,
        // not because they never meet.
        //
        // Measured at 140.5-03, predicate stated because a line-based grep gets
        // this wrong: intersect the KEY SETS (a roster's members / a `Record`'s
        // keys against `SEAM_CODE_TO_WIZARD_CODE`'s keys), never the values —
        // `MISSING_STRATEGY_ID: "VALIDATION_FAILED"` is a VALUE and a grep
        // counts it as a third overlap that does not exist. Under that
        // predicate: `KNOWN_KICKOFF_CODES` ∩ = {RATE_LIMITED},
        // `KNOWN_FINALIZE_CODES` ∩ = {SEAM_MISCONFIGURED}, and THIS set,
        // `KNOWN_ADD_KEY_CODES` and `KNOWN_SET_MEMBERS_CODES` all intersect in
        // NOTHING. Both real overlaps AGREE at HEAD.
        //
        // `seam-ratelimit-posture.invariant.test.ts` derives both sides from
        // disk and reddens when a shared code gets DIFFERENT answers, so the
        // property is asserted rather than narrated. Do not restore the
        // disjointness sentence as the REASON: an empty intersection here is a
        // fact about today's rosters, and the safety does not depend on it.
        // 140.4-16 / WR-09 — READ THROUGH THE LEAF, not off the top level.
        // The commit that added this hop claimed it "mirrors
        // `SyncPreviewStep`'s kickoff arm exactly". It did not: that arm and
        // `SubmitStep` both read `seamErrorCode(body)`, which handles the
        // nested `service_error` shape (`body.detail.code`), while this one
        // read `data.code` and saw only the flat shape. Harmless today —
        // this route funnels every caught value through
        // `classifyKeyValidationError` and never forwards a nested
        // envelope — but an undisclosed divergence under a comment
        // asserting equivalence is how the next reader inherits a wrong
        // premise. The leaf exists precisely so a nested envelope is never
        // read as "a body carrying no code".
        const translated = recogniseSeamErrorCode(seamErrorCode(data));
        const code: WizardErrorCode =
          translated !== "UNKNOWN"
            ? translated
            : data.code &&
                KNOWN_CREATE_WITH_KEY_CODES.has(data.code as WizardErrorCode)
              ? (data.code as WizardErrorCode)
              : "UNKNOWN";
        setErrorCode(code);
        // 140.5-03 / SEAMPROSE-02 — the wait rides the HEADER, read through the
        // ONE parser. Set from the SAME response as the code above, so a wait
        // and a code can never describe different failures. An absent header
        // yields `null`, which the envelope renders as no wait at all rather
        // than as a zero we were never told (TRAP-3).
        setRetryAfterSeconds(parseRetryAfterSeconds(res.headers));
        // 154.1 — from the SAME response as the code above, on the same terms:
        // a name only ever describes the failure it arrived with. A non-string
        // or a blank is treated as "not told" rather than coerced, so the
        // envelope renders the unnamed sentence instead of empty quotes.
        setExistingStrategyName(
          typeof data.strategy_name === "string" &&
            data.strategy_name.trim().length > 0
            ? data.strategy_name
            : null,
        );
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "connect_key",
          code,
        });
        setSubmitting(false);
        return;
      }

      // 153.4 review CR-04 — ⛔ NEVER ADVANCE A WIZARD THE USER HAS LEFT. Belt
      // and braces with the unmount abort above: a response that arrived before
      // the abort landed still reaches this line from a dead closure, and
      // `onSuccess` is `WizardClient`'s step advance. The key IS stored on this
      // path — the composite step's own draft carry-over and its member panels
      // are what must not be discarded by it.
      if (!mountedRef.current) return;
      succeeded = true;
      onSuccess({
        strategyId: data.strategy_id,
        apiKeyId: data.api_key_id,
        exchange,
        // Spread rather than `deduped: data.deduped === true`, so the payload
        // every OTHER path emits is byte-identical to the pre-154 one. The
        // ordinary connect gets no new field and no new UI.
        ...(data.deduped === true ? { deduped: true } : {}),
      });
    } catch (err) {
      /**
       * 153.4-04 — AN ABORT IS NOT A TRANSPORT FAILURE, AND THE TWO ABORTS ARE
       * NOT THE SAME OUTCOME. Branch FIRST, before anything below can classify a
       * cancel as an outage.
       *
       * ⚠️ TRAP-1, re-checked at this edit now that an `AbortSignal` rides the
       * request: an `AbortError` is a `DOMException` with a fixed name and
       * message and carries no request, no headers and no body, so it embeds no
       * credential either — the measurement in the `SERVICE_UNREACHABLE` arm
       * below still holds unchanged.
       */
      if (abortRef.current?.signal.aborted) {
        if (abortReasonRef.current === "user") {
          // The user chose this. ⛔ No `errorCode`, ⛔ no `console.error`, and
          // ⛔ no `wizard_error` event: recording a deliberate cancel as an error
          // tells an operator the seam is failing when it is not, and it is the
          // funnel they would use to decide MT5 is broken (T-153.4-15).
          setCancelled(true);
          setSubmitting(false);
          return;
        }
        if (abortReasonRef.current === "deadline") {
          // A real failure, and the funnel must agree with the screen (the
          // 140.5-03 rule). The envelope names the budget we granted — see the
          // `budgetSeconds` context below.
          setErrorCode("SEAM_DEADLINE_EXCEEDED");
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: "connect_key",
            code: "SEAM_DEADLINE_EXCEEDED",
          });
          setSubmitting(false);
          return;
        }
      }
      // 140.5-03 / SEAMPROSE-03 — OUR HOP, NOT THE EXCHANGE'S.
      //
      // This catch fires when the request to `/api/strategies/create-with-key`
      // never completed — our own route, one hop from the browser. The
      // exchange was very possibly never contacted at all.
      // `KEY_NETWORK_TIMEOUT` stood here and its copy says "We could not reach
      // the exchange", which asserts a VENUE fault for a fault on our own hop:
      // `wizardErrors.ts` states that rule by name beside the entry, and this
      // site was one of the five breaking it. `SERVICE_UNREACHABLE` says what
      // is actually known — we sent it, no answer came back, and because none
      // came back we cannot tell whether it was processed.
      //
      // ⚠️ BOTH OCCURRENCES, and the telemetry one is not decoration: a funnel
      // still reporting the venue-fault code is the same false attribution in
      // machine-readable form, and it is what an operator would use to
      // conclude the exchanges are flaky when the fault is ours.
      //
      // ⚠️ Do NOT reach for `SERVICE_UNAVAILABLE_RETRY` here. Its "Nothing was
      // submitted" is knowable for a breaker that DECLINED to send and false
      // for a request that timed out. The two entries are one apart in the
      // table and 140.3-12 already separated them once.
      setErrorCode("SERVICE_UNREACHABLE");
      trackForQuantsEventClient("wizard_error", {
        wizard_session_id: wizardSessionId,
        step: "connect_key",
        code: "SERVICE_UNREACHABLE",
      });
      // TRAP-1, restated as a PROPERTY and re-checked at this edit: a caught
      // transport error must not be logged in a form that can carry credential
      // material. `wizardFetch` sets exactly one header (`X-Correlation-Id`)
      // and this route authenticates by COOKIE, so no credential value is on
      // the request for a rejection to embed. The credentials the USER typed
      // live in React state and are never part of `err`. Nothing to scrub —
      // which is a measurement, not an assumption, and it is what must be
      // re-checked if this call ever starts sending an Authorization header.
      console.error("[wizard:ConnectKeyStep] submit threw:", err);
      setSubmitting(false);
    } finally {
      // 153.4-04 — EVERY outcome ends the wait: success, failure, cancel and
      // deadline alike. A card left mounted over a finished request is the
      // indefinite spinner in a new costume, so the clock, the render gate and
      // the controller are cleared here rather than in four arms.
      //
      // ⚠️ `setSubmitting(false)` is deliberately NOT unconditional. The success
      // arm has always left the button disabled while the parent advances the
      // step — re-enabling it here would open a double-submit window on a key
      // that has already been stored. Each failing arm clears it itself; this is
      // the backstop for any arm that ever forgets.
      // ⚠️ The ref is nulled BESIDE the state, not instead of it: it is what the
      // render gate reads to discover — synchronously, without waiting for this
      // update to commit — that the wait it was armed for is over (WR-04).
      waitStartedAtRef.current = null;
      setWaitStartedAt(null);
      setShowWaitCard(false);
      abortRef.current = null;
      if (!succeeded) setSubmitting(false);
    }
  }

  const errorEnvelope = errorCode
    ? buildEnvelope(errorCode, correlationId, {
        // 140.3-10's rule, inherited: `?? undefined` because ABSENCE IS NOT
        // ZERO. `null` would be carried into the envelope slot and a `0` there
        // is a wait we were never told about.
        retryAfterSeconds: retryAfterSeconds ?? undefined,
        // 153.4-04 / UI-SPEC Gate A — the budget WE granted, in seconds, and
        // ONLY for the code that names one. The same rule one line up: the
        // expression yields `undefined`, never `null` and never `0` — a `0`
        // here is a budget we never granted, which turns a vague failure into a
        // specific lie (TRAP-3). It reads the FROZEN attempt venue, so the
        // figure describes the request that actually ran out of time.
        budgetSeconds:
          errorCode === "SEAM_DEADLINE_EXCEEDED"
            ? validateBudgetSecondsFor(attemptExchange)
            : undefined,
        // 153.4-04 / UI-SPEC Gate B — WITHOUT THIS, `SEAM_DEADLINE_EXCEEDED`'s
        // "Your key details are still on this page." is silently withheld:
        // that bullet declares `REQUIRES_CONNECT_SURFACE` and absence
        // SUPPRESSES. A user who waited two minutes and is then told nothing
        // about the credentials they typed is the worst outcome this phase can
        // produce, which is why 153.1-04 bound the obligation to the commit
        // that starts EMITTING the code — this one.
        surface: "connect",
        // 153.1-03 / D-17 — the venue, as a lookup key into the closed
        // capability record (never interpolated into copy). Absence renders the
        // substitutable remedy unconditionally, so an MT5 user reads "switch to
        // a different exchange" for a venue that IS their account. Mandated by
        // this phase's UI-SPEC at the call sites it owns; byte-neutral for every
        // ccxt venue, where the predicate already answers `true`.
        venue: attemptExchange ?? exchange,
        // 154.1 / WIZCONT-02 review CR — WITHOUT THIS, `VENUE_ALREADY_CONNECTED`
        // renders its unnamed sentence and the user is told an account of theirs
        // is already connected without being told to WHAT — on a page where the
        // whole remedy is to go and open that strategy. `?? undefined` for the
        // same reason the two lines above use it: absence must reach the copy as
        // "we were not told", never as an empty string it would print.
        strategyName: existingStrategyName ?? undefined,
      })
    : null;

  return (
    <section aria-labelledby="wizard-connect-key-heading">
      <h2
        id="wizard-connect-key-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        Connect your exchange
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        Paste a read-only API key. We validate scopes server-side before storing
        anything. Secrets are never persisted to your browser.
      </p>

      {/* Inline permission block — visible, not collapsible */}
      <div className="mt-6 rounded-md border border-border bg-page">
        <dl className="divide-y divide-border">
          {trustAtoms.map((atom) => (
            <div
              key={atom.title}
              className="grid gap-1 px-4 py-3 md:grid-cols-[180px_1fr] md:gap-6"
            >
              <dt className="text-caption font-medium text-text-primary">{atom.title}</dt>
              <dd className="text-caption text-text-secondary">{atom.body}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* 153.4-04 / UI-SPEC Surface 1 — `aria-busy` while a validate is in
          flight, absent otherwise (never `"false"`: the attribute's absence and
          its false value are the same state, and one of the two is noise). */}
      <form
        onSubmit={handleSubmit}
        className="mt-8 space-y-5"
        aria-busy={submitting ? "true" : undefined}
      >
        {/* Exchange cards */}
        <fieldset>
          <legend className="text-caption font-medium text-text-primary">
            Exchange
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            {EXCHANGES.map((ex) => {
              const active = ex.id === exchange;
              return (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => onSelectExchange(ex.id)}
                  className={`rounded-md border px-4 py-3 text-left transition-colors ${
                    active
                      ? "border-accent bg-accent/5"
                      : "border-border bg-white hover:border-accent/50"
                  }`}
                  aria-pressed={active}
                  data-testid={`wizard-exchange-${ex.id}`}
                >
                  <p className="text-body font-semibold text-text-primary">{ex.name}</p>
                  <p className="mt-1 text-micro text-text-secondary">{ex.caption}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-micro text-text-muted">
            Need help creating a read-only key?{" "}
            <Link
              href={`/security#${guideAnchor}`}
              className="underline-offset-4 hover:underline"
              target="_blank"
              rel="noopener"
            >
              {EXCHANGES.find((e) => e.id === exchange)?.name} setup guide →
            </Link>
          </p>
        </fieldset>

        <Input
          label={keyLabel}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={keyPlaceholder}
          autoComplete="off"
          required
        />

        {/* sFOX is token-only (requiresSecret false) — render the secret block
            only for exchanges that authenticate with a key+secret pair. A
            rendered `required` secret input would otherwise block a sfox submit
            on a field it does not have. */}
        {requiresSecret && (
          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="wizard-api-secret"
                className="text-caption font-medium text-text-primary"
              >
                {secretLabel}
              </label>
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="text-micro text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
              >
                {showSecret ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="wizard-api-secret"
              type={showSecret ? "text" : "password"}
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder={secretPlaceholder}
              autoComplete="off"
              required
              className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
            {/* Muted (never amber/red) steer under the secret input — DESIGN.md
                semantic-color gate: tone is earned by an actual rejection, not a
                preemptive warning. MT5 uses it for the investor-vs-master steer. */}
            {secretHelper && (
              <p className="mt-1 text-micro text-text-muted">{secretHelper}</p>
            )}
          </div>
        )}

        {requiresPassphrase && (
          <div>
            <Input
              label={passphraseLabel}
              type={passphraseSecret && !showSecret ? "password" : "text"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={passphrasePlaceholder}
              autoComplete="off"
              required
            />
            <p className="mt-1 text-micro text-text-muted">{passphraseHelper}</p>
          </div>
        )}

        <div>
          <Input
            label="Key nickname (optional)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={`e.g. ${exchange} · prod`}
            autoComplete="off"
          />
          <p className="mt-1 text-micro text-text-muted">
            For your own reference inside Quantalyze. Never shown to allocators.
          </p>
        </div>

        {errorEnvelope && (
          <WizardErrorEnvelope
            envelope={errorEnvelope}
            onRetry={() => setErrorCode(null)}
          />
        )}

        {/* 153.4-04 / D-05 — the long wait, made legible. Mounted 300 ms after
            submit and torn down on every outcome; it renders ABOVE the submit
            row so the escalation and the `Stop waiting` control sit next to the
            button they describe. The card is PURE — this step owns the clock,
            the controller and the mount gate. */}
        {showWaitCard && (
          <ValidateWaitCard
            exchange={attemptExchange ?? exchange}
            elapsedMs={elapsedMs}
            onStopWaiting={handleStopWaiting}
          />
        )}

        {/* The cancelled state. ⛔ NOT a `WizardErrorEnvelope` and ⛔ never
            `text-negative`: the user chose this and nothing failed. DESIGN.md
            §Semantic-color gates — red asserts a permanent failure, and there is
            no failure here to assert.

            ⛔ NO "NOTHING WAS SAVED" CLAIM (153.4 review CR-02). Aborting stops
            this browser listening; the route runs on past validate into
            `encryptKey` and the create RPC, so the key may well be stored — a
            user who cancels at 48 s of a 120 s MT5 validate was told nothing was
            saved while their credential was being written. The sentence states
            the two facts this browser actually knows, plus the one thing that
            makes the next submit safe: `create-with-key`'s idempotency fence is
            keyed on `wizard_session_id`, so a re-submit resolves to the draft the
            abandoned request created instead of minting a second one. */}
        {cancelled && !submitting && (
          <p
            className="text-caption text-text-secondary"
            data-testid="wizard-connect-wait-cancelled"
          >
            We stopped waiting for your broker. Your key details are still on
            this page — the check may still be finishing on our side, and
            connecting again picks up that key rather than storing a second one.
          </p>
        )}

        {/* UAT/F-5: the "+ Add another key window" affordance (footerSlot) sits
            ABOVE the primary CTA — you decide to go multi-key BEFORE validating a
            single key, so the add-window action must precede "Validate key and
            continue". Absent for the single-key wizard → renders nothing. */}
        {footerSlot}

        <div className="flex gap-3" ref={submitRowRef}>
          <Button
            type="submit"
            disabled={submitting || !apiKey || (requiresSecret && !apiSecret) || (requiresPassphrase && !passphrase)}
            data-testid="wizard-connect-submit"
          >
            {submitting ? "Validating..." : "Validate key and continue"}
          </Button>
        </div>

        {/* Phase 15 follow-up (2026-05-07): the CSV branch shipped without a
            GUI entry point — only reachable via direct URL — so founders
            with a track-record CSV but no exchange API key had no way in.
            This is the bridge: a quiet inline link from the API wizard's
            first step to the CSV branch. Same wizard chrome, just a
            different first-step component. */}
        <p className="pt-2 text-caption text-text-muted">
          Don&apos;t have an API key yet?{" "}
          <Link
            href="/strategies/new/wizard?source=csv"
            className="font-medium text-accent underline-offset-4 hover:underline"
            data-testid="wizard-csv-branch-link"
          >
            Upload a CSV track record instead →
          </Link>
        </p>
      </form>
    </section>
  );
}
