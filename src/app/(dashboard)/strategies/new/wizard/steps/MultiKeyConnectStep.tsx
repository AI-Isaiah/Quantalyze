"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { TrustTierLabel } from "@/components/strategy/TrustTierLabel";
import { buildEnvelope } from "@/lib/envelope";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { keyWindowsSchema } from "@/lib/composite/keyWindowsSchema";
import { windowsOverlap } from "@/lib/composite/windowOverlap";
import {
  ConnectKeyStep,
  type ConnectKeySuccess,
  type ConnectKeyDraft,
} from "./ConnectKeyStep";
import {
  recogniseSeamErrorCode,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
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
// 140.5-03 / SEAMPROSE-02 — the ONE `Retry-After` parser (HTTP-date safe, never
// NaN/0/negative). A raw `Number(res.headers.get(...))` is a repo-wide ESLint
// error by design.
import { parseRetryAfterSeconds } from "@/lib/retry/retry-after";

/**
 * Phase 88 / ONB-01 — the multi-key ConnectKeyStep.
 *
 * State A (single-key, default) delegates to the EXISTING ConnectKeyStep,
 * injecting the ONE additive "+ Add another key window" ghost affordance via
 * the `footerSlot` prop — so a user who never clicks it completes onboarding on
 * the byte-identical single-key path (A1 neutrality; the SC-4 regression pin).
 *
 * State B (multi) is an ordered KeyPanel list: per-key credentials, native-date
 * windows, Move ↑/↓ (position-derived seq), remove-with-confirm, per-key
 * validate against composite/add-key, live keyWindowsSchema validation (inline
 * + a step-level buildEnvelope summary — A4), and a Continue that persists
 * members wholesale via composite/set-members then advances.
 *
 * ── DELIBERATE DUPLICATION (flagged for Phase-91 QA) ──────────────────────────
 * The exchange-card grid + credential markup + credential posture below are
 * replicated VERBATIM from ConnectKeyStep (autoComplete="off", secret as
 * type="password" with show/hide, POST-body-only, no browser storage). This is
 * neutrality-over-DRY: State A must stay byte-identical to ConnectKeyStep, which
 * means ConnectKeyStep exports nothing new (footerSlot is its ONLY diff), so the
 * multi-key panels cannot share ConnectKeyStep's private EXCHANGES/markup. The
 * duplication is intentional — Phase-91 QA should verify the two credential
 * surfaces stay in lockstep (labels, placeholders, secret handling).
 *
 * ⚠️ THE LOCKSTEP IS NOW ASSERTED, BECAUSE IT BROKE (153.4 review CR-03). "QA
 * should verify" is not a mechanism: this roster fell an entire VENUE behind —
 * `MT5_UI_ENABLED` was not so much as imported here — and the resulting panel
 * posted `passphrase: null`, silently dropping the broker server, while rendering
 * no field to put it back. `MultiKeyConnectStep.test.tsx`'s "[CR-03] … THE CLASS
 * GUARD" case now compares the two surfaces' rendered exchange cards with both
 * flags ON, so the NEXT venue added to one roster and not the other reds. ⛔ If
 * that case goes red, add the venue here — never delete the case. The real class
 * fix (one shared option table both steps import, which the State-A neutrality
 * argument above does NOT forbid — it forbids ConnectKeyStep growing an export)
 * is logged in TODOS.md.
 */

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** UTC calendar day — caps the native date pickers so no window is authored
 *  into the future (the zod future-window rule is the loud backstop). */
const TODAY = new Date().toISOString().slice(0, 10);

type ExchangeId = SupportedExchange;

interface ExchangeOption {
  id: ExchangeId;
  name: string;
  caption: string;
  requiresPassphrase: boolean;
  // See ConnectKeyStep: absent → true (ccxt key+secret pair). sFOX is a single
  // Bearer token (no secret) → requiresSecret false.
  requiresSecret?: boolean;
  credentialLabels?: { key: string; secret: string };
  credentialPlaceholders?: { key: string; secret: string };
  // 153.4 review CR-03 — the four third-field overrides ConnectKeyStep's option
  // shape already carried and this one did not. Absent → today's OKX strings and
  // today's masked render, so every existing venue's panel is byte-identical.
  // MT5 reuses the SAME passphrase slot for the broker SERVER NAME, which is not
  // a credential, so it relabels the field and unmasks it.
  passphraseLabel?: string;
  passphrasePlaceholder?: string;
  passphraseHelper?: string;
  passphraseSecret?: boolean;
  // Optional muted helper under the secret input. Absent → nothing renders.
  secretHelper?: string;
}

// Replicated verbatim from ConnectKeyStep (see DELIBERATE DUPLICATION above).
// Phase 122 / SFOX-08: the sfox card is APPENDED only when SFOX_UI_ENABLED is on
// — flag OFF (default) leaves this literal byte-identical to today's four cards.
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
  // 153.4 review CR-03 — THE MT5 CARD THIS ROSTER WAS MISSING, gated on the same
  // flag as its single-key twin.
  //
  // ⚠️ ITS ABSENCE WAS NOT COSMETIC. An MT5 key reaches a member panel by exactly
  // one route — the UAT/F-4 draft carry-over in `enterMulti`, which is the path
  // plan 153.4-05's own tests drive. With no card, `EXCHANGES.find(e => e.id ===
  // "mt5")` was `undefined` for that panel, so `requiresPassphrase` defaulted
  // FALSE and `validatePanel` posted `passphrase: null` — silently dropping the
  // broker server the user typed in State A — while `KeyPanel` rendered no field
  // to put it back and `canValidate` did not gate on it. The submit control was
  // enabled for a request that could not succeed. The same lookup miss also cost
  // the panel its credential labels ("MT5 login" / "Investor password"), its
  // investor-vs-master steer, its `aria-pressed` card and its validated summary
  // name.
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

// F3 (Phase 122): honest structural note appended to the step-level "What we
// reject" atom whenever a token-only (sfox) panel is present — sFOX exposes no
// per-key scope endpoint, so the unqualified ccxt scope-rejection claim would be
// false for it. See ConnectKeyStep SFOX_REJECT_ATOM_BODY.
const SFOX_REJECT_ATOM_NOTE =
  " sFOX exposes no per-key scope endpoint — sFOX keys are used read-only by our adapter (no order or withdraw path exists), so mint a READ-ONLY token.";

// Replicated verbatim from ConnectKeyStep (step-level permission block).
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
 * 140.3-13a / SEAMUX-08 — the composite variant's funnel step name.
 *
 * DELIBERATELY NOT `"connect_key"`. State A of this component delegates to
 * `ConnectKeyStep`, which emits `step: "connect_key"` from its own error paths,
 * so reusing that value here would merge the single-key and multi-key funnels
 * into one indistinguishable bucket — and the whole reason this component needed
 * emissions is that the COMPOSITE path was invisible. Before this plan
 * `grep -c 'trackForQuantsEventClient'` on this file was **0**: every multi-key
 * failure — an add-key rejection, a set-members rejection, a failed rehydrate —
 * produced no funnel event at all, so a seam outage during a multi-key connect
 * was indistinguishable from nobody attempting one.
 */
const MULTI_KEY_FUNNEL_STEP = "connect_key_multi";

/**
 * Every `WizardErrorCode` that `POST /api/strategies/composite/add-key` can put
 * on the wire.
 *
 * Same reasoning as `ConnectKeyStep`'s `KNOWN_CREATE_WITH_KEY_CODES`, which is
 * the sibling route: this replaces a bare `as WizardErrorCode` cast of
 * `data.code` — widened with an optional and then defaulted to `"UNKNOWN"` — of
 * NETWORK DATA into a closed union, copying `SubmitStep.tsx`'s
 * `KNOWN_FINALIZE_CODES` membership shape. The two routes' `classifyKeyValidationError` halves are
 * identical by construction — both call the one shared classifier — but the
 * sets are still written out per route rather than shared, because the direct
 * emissions differ and a shared set would silently admit one route's codes at
 * the other.
 *
 * ⚠️ 140.4-15 / SEAMRIM-08 — THIS SET IS NO LONGER THE ONLY HOP AT THE ADD-KEY
 * ARM, AND IT DELIBERATELY DID NOT GAIN A MEMBER. `140.4-13` made
 * `composite/add-key/route.ts`'s 503 arm answer a limiter MISCONFIGURATION with
 * the WIRE code `SEAM_MISCONFIGURED` (`rateLimitDenyJson`'s
 * `misconfiguredBody`), replacing the 429 `KEY_RATE_LIMIT` whose copy calls the
 * throttle "exchange-side" — our own outage, blamed on the user's venue. With
 * only the set below, that code missed every member and rendered `UNKNOWN`:
 * *"Try the last action again."*, **with a Retry control**, for a fault whose
 * own copy says *"Retrying will not clear it: the setting stays wrong until we
 * fix it and redeploy."* The remedy is the ONE shared table
 * (`SEAM_CODE_TO_WIZARD_CODE`, read through `recogniseSeamErrorCode`) consulted
 * FIRST — coverage-law row 1 — not a member here, which would be a hand-typed
 * allow-list edit owed again at every surface the next wire code reaches. The
 * table's key set and this set intersect in NOTHING, so the ordering cannot
 * change what any member below renders — and 140.4-16 / WR-11 turned that
 * measurement into an assertion in `seam-ratelimit-posture.invariant.test.ts`,
 * which derives both vocabularies from disk. Note the guard asserts the
 * NECESSARY condition (a shared code must get the SAME answer) rather than
 * disjointness: disjointness holds here but NOT at `KNOWN_KICKOFF_CODES`,
 * which shares `RATE_LIMITED`. See `ConnectKeyStep`'s
 * `KNOWN_CREATE_WITH_KEY_CODES` docblock for the full reasoning; both key-entry
 * steps take the change together because both routes emit the code.
 */
const KNOWN_ADD_KEY_CODES: ReadonlySet<WizardErrorCode> =
  new Set<WizardErrorCode>([
    // Emitted directly by `composite/add-key/route.ts`'s own guards.
    "KEY_INVALID_FORMAT",
    // 142.2 / MT5-04 (D-05) — the four codes `KEY_INVALID_FORMAT` was split
    // into. `composite/add-key/route.ts` mirrors `create-with-key` guard for
    // guard, so it emits the same four and this roster gains the same four.
    // The two rosters stay SEPARATE (see the docblock above): they agree here
    // because the two routes genuinely emit the same set, not because one was
    // copied from the other.
    "KEY_MISSING_REQUIRED_FIELD",
    "KEY_UNSUPPORTED_VENUE",
    "KEY_VENUE_NOT_ENABLED",
    "KEY_INPUT_TOO_LONG",
    "KEY_NOT_READ_ONLY",
    "KEY_HAS_TRADING_PERMS",
    "KEY_HAS_WITHDRAW_PERMS",
    "DRAFT_ALREADY_EXISTS",
    "KEY_RATE_LIMIT",
    "UNKNOWN",
    // Returned by the shared `classifyKeyValidationError` at its catch arm.
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
    // ⚠️ STOPGAP (hotfix 2026-08-06, incident 2026-08-05): same three-code
    // addition as `KNOWN_CREATE_WITH_KEY_CODES` (see the full incident note
    // there) — the server put `SERVICE_UNREACHABLE` on the wire, the roster
    // rejected it, and the step rendered UNKNOWN with a Retry control for a
    // no-answer fault. The two rosters stay SEPARATE (docblock above) and
    // take the change together because both routes share the classifier that
    // emits these codes. Copy for all three verified in `WIZARD_ERROR_COPY`.
    // CLASS fix (derive the roster from the route contract) = Phase 153 /
    // WIZFORM-02; do not grow this list further, derive it there.
    "SERVICE_UNREACHABLE",
    "KEY_MISSING_READ_SCOPE",
    "KEY_PERMISSION_DENIED",
  ]);

/**
 * Every `WizardErrorCode` that `POST /api/strategies/composite/set-members` can
 * put on the wire — a SEPARATE, much smaller route contract.
 *
 * ⚠️ This is why one shared set per STEP would be wrong. `set-members` performs
 * no key validation at all: it never calls `classifyKeyValidationError` and
 * emits exactly four codes. Admitting `KEY_AUTH_FAILED` here would let a drifted
 * or spoofed body render "the exchange rejected your credentials" on a call that
 * only ever persisted date windows.
 */
const KNOWN_SET_MEMBERS_CODES: ReadonlySet<WizardErrorCode> =
  new Set<WizardErrorCode>([
    "MULTI_KEY_WINDOWS_INVALID",
    "GUARD_BLOCKED",
    "KEY_RATE_LIMIT",
    "UNKNOWN",
  ]);

interface PanelState {
  id: string;
  exchange: ExchangeId;
  nickname: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  showSecret: boolean;
  windowStart: string;
  windowEnd: string;
  stillLive: boolean;
  status: "editing" | "validating" | "validated";
  apiKeyId: string | null;
  errorCode: WizardErrorCode | null;
  /**
   * 140.5-03 / SEAMPROSE-02 — the wait THIS PANEL's failing add-key response
   * advertised, in seconds, or `null` when it advertised none.
   *
   * PER-PANEL and not per-step: each panel validates independently against
   * `composite/add-key`, and that route is rate-limited per identity, so panel
   * 3 hitting the limiter says nothing about panel 1. A single step-level wait
   * would render panel 3's duration under panel 1's error.
   *
   * Cleared on every fresh validate attempt beside `errorCode` (TRAP-3).
   */
  retryAfterSeconds: number | null;
  /**
   * 153.4-05 / D-05 / WIZFORM-05 — when THIS panel's in-flight validate left the
   * browser, or `null` when none is.
   *
   * PER-PANEL for exactly the reason `retryAfterSeconds` above is: panels
   * validate independently against `composite/add-key`, so panel 3 can be twelve
   * seconds into a wait while panel 1 has not started one. A single step-level
   * clock would render panel 3's elapsed figure — and panel 3's escalation —
   * underneath panel 1.
   */
  waitStartedAt: number | null;
  /**
   * Milliseconds since `waitStartedAt`, ticked once per second by the ONE
   * step-level interval (never faster — the card renders whole seconds).
   *
   * PER-PANEL, and STORED rather than derived in the JSX: a `Date.now()`
   * comparison at render time re-times every panel's card whenever anything else
   * re-renders the step, and the 300 ms render gate below depends on this value
   * moving on a TICK and not on a render.
   */
  waitElapsedMs: number;
  /**
   * THIS panel's user pressed `Stop waiting`. ⛔ NOT an error — it renders as a
   * neutral line, never a `WizardErrorEnvelope`. Cleared on this panel's next
   * validate and the moment any of its credential fields change.
   *
   * PER-PANEL: "we stopped waiting" is true of one member's check and false of
   * every other one still running. A step-level flag would tell a user who
   * abandoned panel 3 that nothing is happening on panel 1 either.
   */
  waitCancelled: boolean;
  /**
   * The venue of THIS panel's CURRENT (or most recent) attempt, frozen when the
   * validate left the browser.
   *
   * PER-PANEL, and FROZEN. The exchange cards stay clickable while a panel's
   * validate is in flight, and every duration this panel states — the card's
   * promise, the ladder's rungs, the client deadline and the `budgetSeconds` its
   * deadline envelope names — must describe the request that is actually on the
   * wire. Reading live `exchange` would let a mid-flight card click re-time the
   * deadline and advertise a budget nobody granted (T-153.4-12). A composite may
   * mix a serialized venue with ccxt ones, and those two arms are 90 seconds
   * apart, so this is not a theoretical delta.
   *
   * ⚠️ Deliberately NOT cleared when the wait ends: the failure envelope is
   * rendered AFTER the attempt, and it must name the budget that attempt was
   * granted rather than whatever card is selected by the time it is read.
   */
  waitExchange: ExchangeId | null;
  confirmingRemove: boolean;
}

/**
 * 153.4-05 — the patch EVERY outcome arm of a panel's validate applies beside
 * its own fields. A wait that has finished must leave nothing a later render can
 * read as a wait still running: a card outliving the request it describes is the
 * indefinite spinner in a new costume, which is what this plan exists to end.
 *
 * ⚠️ `waitExchange` is absent on purpose — see its docblock above.
 */
const WAIT_CLEARED: Partial<PanelState> = {
  waitStartedAt: null,
  waitElapsedMs: 0,
  waitCancelled: false,
};

/**
 * 153.4-05 — the panel fields whose edit invalidates a `Stop waiting` line.
 *
 * The sentence says "your key details are still on this page", and once the user
 * starts changing those details it describes an attempt that no longer matches
 * what they are looking at. Held in ONE place, read by `updatePanel`, rather
 * than in six `onChange` handlers — so a seventh field cannot be added without
 * it (the same discipline `ConnectKeyStep` applies with a single effect).
 */
const CREDENTIAL_FIELDS: ReadonlyArray<keyof PanelState> = [
  "exchange",
  "nickname",
  "apiKey",
  "apiSecret",
  "passphrase",
];

function newPanel(): PanelState {
  return {
    id: genId(),
    exchange: "binance",
    nickname: "",
    apiKey: "",
    apiSecret: "",
    passphrase: "",
    showSecret: false,
    windowStart: "",
    windowEnd: "",
    stillLive: false,
    status: "editing",
    apiKeyId: null,
    errorCode: null,
    retryAfterSeconds: null,
    waitStartedAt: null,
    waitElapsedMs: 0,
    waitCancelled: false,
    waitExchange: null,
    confirmingRemove: false,
  };
}

/**
 * Pure panel→keys[] mapping the wizard POSTs to
 * `/api/strategies/composite/set-members`. Extracted from `handleContinue` so
 * the FIRST member's entered `windowStart` VALUE can be pinned offline
 * (`MultiKeyConnectStep.payload.test.ts`) — a silent field drop/rename here goes
 * RED. Behaviour is byte-identical to the former inline map: `window_end` is
 * null for an open-ended (`stillLive`) or blank-end member, `seq` is the 1-based
 * panel index, and order is preserved.
 */
export function buildSetMembersKeys(
  panels: ReadonlyArray<{
    apiKeyId: string | null;
    windowStart: string;
    windowEnd: string;
    stillLive: boolean;
  }>,
): Array<{
  api_key_id: string | null;
  window_start: string;
  window_end: string | null;
  seq: number;
}> {
  return panels.map((p, i) => ({
    api_key_id: p.apiKeyId,
    window_start: p.windowStart,
    window_end: p.stillLive ? null : p.windowEnd || null,
    seq: i + 1,
  }));
}

interface FieldError {
  start?: string;
  end?: string;
}

/**
 * Live validation. The overlap PREDICATE is the ONE shared spec
 * (`windowsOverlap`, bound to window_overlap_convention.json); `keyWindowsSchema`
 * is the authoritative per-key + order validator and the SERVER re-runs it
 * verbatim (88-04). Only panels that carry a `windowStart` participate — an
 * unfilled panel blocks Continue without spraying "required" noise.
 *
 * Returns per-panel inline errors (by panel index) + the step-level summary
 * lines. Per-key errors (end<start, future) are inline-only; overlap is inline
 * on BOTH panels AND a summary line; non-monotone seq is summary-only.
 */
function computeValidation(panels: PanelState[]): {
  fieldErrors: Record<number, FieldError>;
  summaryLines: string[];
} {
  const fieldErrors: Record<number, FieldError> = {};
  const summaryLines: string[] = [];

  const participants: { panelIdx: number }[] = [];
  const keys: {
    api_key_id?: string;
    window_start: string;
    window_end: string | null;
    seq: number;
  }[] = [];
  panels.forEach((p, i) => {
    if (!p.windowStart) return;
    participants.push({ panelIdx: i });
    keys.push({
      api_key_id: p.apiKeyId ?? undefined,
      window_start: p.windowStart,
      window_end: p.stillLive ? null : p.windowEnd || null,
      // Position-derived seq among the participating windows (1-indexed).
      seq: keys.length + 1,
    });
  });

  const setErr = (panelIdx: number, which: "start" | "end", msg: string) => {
    fieldErrors[panelIdx] = { ...(fieldErrors[panelIdx] ?? {}), [which]: msg };
  };

  const parsed = keyWindowsSchema.safeParse({ keys });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const partIdx =
        typeof issue.path[1] === "number" ? (issue.path[1] as number) : -1;
      const field = issue.path[2];
      const panelIdx = participants[partIdx]?.panelIdx ?? -1;
      // Non-monotone seq is summary-only (classified by PATH, not message).
      if (field === "seq") {
        summaryLines.push(issue.message);
        continue;
      }
      // Overlap (classified by the locked copy) is inline on BOTH panels of the
      // pair AND a summary line — the schema emits it on the later window only,
      // so re-run the shared predicate to find the earlier partner.
      if (issue.message.includes("overlapping")) {
        summaryLines.push(issue.message);
        for (let a = 0; a < partIdx; a++) {
          if (windowsOverlap(keys[a], keys[partIdx])) {
            setErr(participants[a].panelIdx, "start", issue.message);
          }
        }
        if (panelIdx >= 0) setErr(panelIdx, "start", issue.message);
        continue;
      }
      // Per-key inline (end<start / future / malformed date), window fields only.
      if (panelIdx >= 0) {
        if (field === "window_end") setErr(panelIdx, "end", issue.message);
        else if (field === "window_start")
          setErr(panelIdx, "start", issue.message);
        else summaryLines.push(issue.message);
      }
    }
  }

  return { fieldErrors, summaryLines: [...new Set(summaryLines)] };
}

export interface MultiKeyConnectStepProps {
  wizardSessionId: string;
  onSuccess: (result: ConnectKeySuccess) => void;
  /**
   * WIZ-02: the composite draft's strategy id, threaded from WizardClient so a
   * re-mounted step can rehydrate State B from the WIZ-01 GET. Named
   * `draftStrategyId` (NOT strategyId) to avoid shadowing the local
   * `const [strategyId, setStrategyId]` state below.
   */
  draftStrategyId?: string | null;
  /**
   * Phase 94.1 / F2 — reports whether connect_key holds UNSAVED edits vs the
   * last-committed member set: a State-B panel that is not yet validated, a
   * validated set reordered/removed since the last successful Continue, or a
   * typed-but-unsubmitted State-A single-key draft. WizardClient factors this
   * into `stepCompleted('connect_key')` so the clickable stepper cannot jump
   * FORWARD past connect_key while edits are pending (they would be silently
   * dropped). Optional — the standalone/legacy single-key wizard omits it.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * WIZ-02: a WIZ-01 GET member → rehydrated PanelState. Mirrors a post-validate
 * panel (validatePanel success, above): status "validated", apiKeyId set,
 * plaintext EMPTY. The three credential fields are hardcoded to "" (T-94-06) —
 * no secret ever enters browser state on rehydrate.
 */
function toRehydratedPanel(member: {
  exchange: string;
  nickname: string | null;
  window_start: string;
  window_end: string | null;
  api_key_id: string;
}): PanelState {
  return {
    id: genId(),
    exchange: member.exchange as ExchangeId,
    nickname: member.nickname ?? "",
    apiKey: "",
    apiSecret: "",
    passphrase: "",
    showSecret: false,
    windowStart: member.window_start,
    windowEnd: member.window_end ?? "",
    stillLive: member.window_end == null,
    status: "validated",
    apiKeyId: member.api_key_id,
    errorCode: null,
    retryAfterSeconds: null,
    // 153.4-05 — a rehydrated panel arrives ALREADY `validated`: it made no
    // request from this browser, so it has no wait, and the card's gate (which
    // requires `status === "validating"`) can never fire for it.
    waitStartedAt: null,
    waitElapsedMs: 0,
    waitCancelled: false,
    waitExchange: null,
    confirmingRemove: false,
  };
}

export function MultiKeyConnectStep({
  wizardSessionId,
  onSuccess,
  draftStrategyId,
  onDirtyChange,
}: MultiKeyConnectStepProps) {
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [panels, setPanels] = useState<PanelState[]>([]);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<WizardErrorCode | null>(
    null,
  );
  /**
   * 140.5-03 / SEAMPROSE-02 — the wait the failing `set-members` response
   * advertised, in seconds, or `null` when it advertised none.
   *
   * STEP-LEVEL, unlike the per-panel field on `PanelState`: Continue is one
   * request for the whole set, so there is exactly one failure to describe.
   *
   * Cleared on every fresh Continue attempt beside `continueError` (TRAP-3).
   */
  const [continueRetryAfterSeconds, setContinueRetryAfterSeconds] = useState<
    number | null
  >(null);
  const [correlationId] = useState<string>(() => getWizardCorrelationId());
  // Phase 94.1 / F3 — rehydration lifecycle. "loading" while the WIZ-01
  // members GET is in flight, "error" when it fails (non-ok / throw /
  // unparseable body). Gates a loading placeholder + an actionable retry
  // envelope so a failed/in-flight rehydration is DISTINGUISHABLE from an
  // empty single-key wizard (pre-fix both showed the same blank State-A form).
  const [rehydrateStatus, setRehydrateStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  // Retry nonce — bumped by the error-envelope Retry control to re-run the
  // rehydration effect below.
  const [retryTick, setRetryTick] = useState(0);
  // Phase 94.1 / F2 — signature of the last-COMMITTED member set (after a
  // rehydrate or a successful Continue). Compared against the current panels'
  // signature to detect uncommitted reorders/removals of already-validated
  // keys (adds/edits are caught separately by the not-all-validated check).
  const [committedSig, setCommittedSig] = useState<string | null>(null);
  // Phase 94.1 / F2 — whether the State-A single-key form holds a typed but
  // un-submitted credential draft (dirty). Updated from onSingleDraftChange.
  const [singleDraftDirty, setSingleDraftDirty] = useState(false);

  // Latest-panels ref for reads inside event handlers (validate / continue /
  // add) that must see current state without re-binding callbacks. Synced in an
  // effect (never written during render).
  const panelsRef = useRef(panels);
  useEffect(() => {
    panelsRef.current = panels;
  }, [panels]);

  // F4 — latest single-key dirtiness for reads inside the rehydration effect
  // below, synced in an effect (never written during render) to mirror
  // `panelsRef`. The rehydration clobber guard must see the CURRENT dirtiness at
  // GET-resolve time; reading `singleDraftRef.current` directly in the effect
  // would violate react-hooks/immutability (a ref written in a callback, read in
  // an effect). Declared BEFORE the rehydration effect so the write-effect
  // precedes the read (the same ordering `panelsRef` relies on).
  const singleDraftDirtyRef = useRef(false);
  useEffect(() => {
    singleDraftDirtyRef.current = singleDraftDirty;
  }, [singleDraftDirty]);

  // WIZ-02: mount rehydration. When the step re-mounts for an existing composite
  // draft (back-nav — WizardClient threads its strategyId as draftStrategyId),
  // fetch the WIZ-01 GET and rebuild State B so stored keys appear pre-filled and
  // verified rather than a blank single-key form. The panels carry EMPTY
  // plaintext (toRehydratedPanel) and status "validated", so the gating
  // predicates (allValidated) accept them with no re-validation, and the
  // secretless set-members resubmit works by construction.
  //
  // Guards: no draftStrategyId → no fetch (byte-neutral State A). Empty
  // membership → stays single-key State A (single-key drafts have no
  // strategy_keys rows). Never clobbers in-progress work: applies only when
  // still on the pristine single-key path (mode single, no panels), checked via
  // panelsRef at resolve time. A non-ok/failed GET degrades honestly to State A
  // (the pre-phase behavior) with the error logged — no secret-touching path.
  useEffect(() => {
    if (!draftStrategyId) return;
    let cancelled = false;
    (async () => {
      try {
        // F3 — enter the loading state so State A shows the "loading your saved
        // keys" banner (not a bare blank form) while the members GET is in
        // flight. Set inside the async IIFE (not synchronously in the effect
        // body) per react-hooks/set-state-in-effect.
        setRehydrateStatus("loading");
        const res = await wizardFetch(
          `/api/strategies/composite/members?strategy_id=${draftStrategyId}`,
        );
        if (cancelled) return;
        if (!res.ok) {
          console.error(
            "[wizard:MultiKeyConnectStep] members GET non-ok:",
            res.status,
          );
          // F3 — surface a distinguishable, retryable error rather than
          // degrading silently to the blank State-A form.
          setRehydrateStatus("error");
          // 140.3-13a / SEAMUX-08 — the THIRD error surface of this step, and
          // the one no document listed. It renders a real
          // WIZARD_KEYS_LOAD_FAILED envelope to the user, so leaving it
          // unreported would have shipped a step that emits on two of three
          // paths while the count read >= 1 and looked closed. The code is the
          // one the banner below actually builds — the funnel and the screen
          // must not be able to disagree.
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: MULTI_KEY_FUNNEL_STEP,
            code: "WIZARD_KEYS_LOAD_FAILED",
          });
          return;
        }
        const data = (await res.json().catch(() => ({}))) as {
          members?: Array<{
            exchange: string;
            nickname: string | null;
            window_start: string;
            window_end: string | null;
            api_key_id: string;
          }>;
        };
        if (cancelled) return;
        const members = data.members;
        if (!Array.isArray(members) || members.length === 0) {
          // Definitively single-key/CSV (or a present-but-empty membership):
          // resolve to idle so State A renders normally.
          setRehydrateStatus("idle");
          return;
        }
        // F4 — the clobber guard bails not only when State-B panels already
        // exist, but ALSO when the State-A single-key form holds an
        // in-progress typed draft. Single-key typing lands in
        // `singleDraftRef.current` (never in `panels`), so a slow GET resolving
        // mid-typing would otherwise flip mode→multi + replace panels and blow
        // the user's in-progress entry away. Both refs are read at RESOLVE time
        // so a slow fetch + concurrent typing/panel-work is respected.
        if (panelsRef.current.length > 0 || singleDraftDirtyRef.current) {
          setRehydrateStatus("idle");
          return;
        }
        const rehydrated = members.map(toRehydratedPanel);
        setStrategyId(draftStrategyId);
        setMode("multi");
        setPanels(rehydrated);
        // F2 — the rehydrated set IS the committed set (it mirrors the persisted
        // strategy_keys rows); seed the signature so it is NOT reported dirty
        // until the user actually edits it.
        setCommittedSig(JSON.stringify(buildSetMembersKeys(rehydrated)));
        setRehydrateStatus("idle");
      } catch (err) {
        if (cancelled) return;
        // Logs only `err`, never member/panel fields (T-94-07).
        console.error("[wizard:MultiKeyConnectStep] members GET threw:", err);
        setRehydrateStatus("error");
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: MULTI_KEY_FUNNEL_STEP,
          code: "WIZARD_KEYS_LOAD_FAILED",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftStrategyId, retryTick, wizardSessionId]);

  const focusRef = useRef<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  /**
   * 153.4-05 — the in-flight validate controllers, KEYED BY `panel.id`.
   *
   * ⛔ NEVER BY INDEX. `onMove` reorders panels, so an index captured when a
   * validate started can point at a DIFFERENT panel by the time that panel's
   * `Stop waiting` is pressed — the abort would then either miss entirely or
   * cancel a sibling's credential-carrying POST (T-153.4-18). Entries are
   * deleted in the validate's `finally`, so the maps cannot grow across attempts.
   */
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  /**
   * WHO aborted, per panel. An `AbortError` is ONE rejection with two opposite
   * meanings — a user's choice, which must never be recorded as a seam failure,
   * and a spent budget, which must be — and the catch cannot tell them apart
   * without this. Same key, same lifetime as the controller map.
   */
  const abortReasonsRef = useRef<Map<string, "user" | "deadline">>(new Map());
  /**
   * The panel whose validate control should receive focus once its cancelled
   * wait has settled (UI-SPEC Surface 1 §Cancel affordance).
   */
  const pendingWaitFocusRef = useRef<string | null>(null);
  /**
   * Per-panel validate ROW elements — THE ROW, NOT THE BUTTON. The shared
   * `ui/Button.tsx` is a plain function component whose props are
   * `ButtonHTMLAttributes`, which carries no `ref` (TS2322, measured at
   * 153.4-04), and this phase's UI-SPEC ⛔ forbids editing it because
   * `AllocateDialog.test.tsx` carves it out BY IDENTITY. The row holds the ref
   * and the focus effect queries the one button inside it; the `Button` ref gap
   * is logged in TODOS.md.
   */
  const validateRowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  /**
   * 153.4 review CR-04 — UNMOUNTING IS NOT A VERDICT, AND NOTHING MAY STAY ON THE
   * WIRE FOR A SURFACE THE USER HAS LEFT.
   *
   * The interval effect's cleanup clears the tick — which is also the ONLY thing
   * enforcing a client deadline on every panel's request — but it never walked
   * this map. So a step unmounted mid-validate (Continue advancing, a back-nav, a
   * route change) left N credential-carrying POSTs running with no controller
   * holding them and no bound at all, which is the exact property the interval's
   * own docblock USED TO claim was closed ("it does give up, so no request can
   * hold this tab open forever"). ⚠️ That sentence is gone from there now: the
   * unmount hole this effect closes was not its only counter-example — removing a
   * validating panel breaks it too, and that one is left open deliberately
   * (153.4 review WR-03, logged in TODOS.md).
   *
   * ⚠️ The reason is `"user"` per panel because leaving IS a user action:
   * recording it as a deadline would put N seam failures in the funnel for N
   * healthy requests.
   *
   * ⚠️ Both maps are captured in the effect BODY rather than read off the refs
   * inside the cleanup: the ref OBJECTS are stable for the component's life and
   * the maps are mutated in place, so the capture sees every controller
   * `validatePanel` has registered by unmount time. Same shape the react-hooks
   * exhaustive-deps rule wants for a cleanup that touches a ref.
   */
  useEffect(() => {
    const controllers = abortControllersRef.current;
    const reasons = abortReasonsRef.current;
    return () => {
      for (const [id, controller] of controllers) {
        reasons.set(id, "user");
        controller.abort();
      }
    };
  }, []);
  const registerValidateRowRef = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      validateRowRefs.current.set(id, el);
    },
    [],
  );
  // UAT/F-4: the latest unvalidated draft the user typed into the single-key
  // (State A) ConnectKeyStep form. enterMulti seeds the first panel from this so
  // switching to multi-key mode carries the in-progress key over.
  const singleDraftRef = useRef<ConnectKeyDraft | null>(null);
  const onSingleDraftChange = useCallback((draft: ConnectKeyDraft) => {
    singleDraftRef.current = draft;
    // F2 — a typed-but-unsubmitted single-key credential is an unsaved edit on
    // connect_key. Report it so a forward stepper jump is blocked until the
    // user either submits (single-key onSuccess) or clears the field.
    setSingleDraftDirty(!!draft.apiKey || !!draft.apiSecret);
  }, []);

  const registerCardRef = useCallback(
    (id: string, el: HTMLButtonElement | null) => {
      cardRefs.current.set(id, el);
    },
    [],
  );

  // Focus the first control of a freshly-added panel (DESIGN-05 focus rule at
  // panel granularity). Guarded by focusRef so it fires only after add.
  useEffect(() => {
    if (focusRef.current) {
      cardRefs.current.get(focusRef.current)?.focus();
      focusRef.current = null;
    }
  });

  const enterMulti = useCallback(() => {
    // UAT/F-4: carry the in-progress single-key draft into the first panel rather
    // than discarding it. ConnectKeyStep reports its draft via onSingleDraftChange;
    // if the user typed anything, seed panel 1 with it (windows stay empty — the
    // single-key form has no window field, so the user fills them in multi mode).
    const draft = singleDraftRef.current;
    const p1 = newPanel();
    if (draft) {
      p1.exchange = draft.exchange;
      p1.nickname = draft.nickname;
      p1.apiKey = draft.apiKey;
      p1.apiSecret = draft.apiSecret;
      p1.passphrase = draft.passphrase;
    }
    const p2 = newPanel();
    focusRef.current = p2.id;
    setPanels([p1, p2]);
    setMode("multi");
    // The State-A→State-B transition creates BOTH panels at once, so announce
    // the two-key start rather than "Key 2 added" (which implies key 1 already
    // existed). Matches the terse "Key N added" style used by addPanel below.
    setAnnouncement("Multi-key mode on — 2 keys added");
  }, []);

  const addPanel = useCallback(() => {
    const np = newPanel();
    focusRef.current = np.id;
    setAnnouncement(`Key ${panelsRef.current.length + 1} added`);
    setPanels((prev) => [...prev, np]);
  }, []);

  const updatePanel = useCallback(
    (idx: number, patch: Partial<PanelState>) => {
      // 153.4-05 — a stale cancelled line must never sit under edited details.
      // Centralised here rather than repeated in each field's `onChange`; an
      // explicit `waitCancelled` in the patch always wins (the validate path
      // sets it deliberately).
      const next =
        CREDENTIAL_FIELDS.some((f) => f in patch) && !("waitCancelled" in patch)
          ? { ...patch, waitCancelled: false }
          : patch;
      setPanels((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, ...next } : p)),
      );
    },
    [],
  );

  /**
   * 153.4-05 — patch a panel by IDENTITY rather than by position.
   *
   * ⛔ The validate path may NOT use the index it was called with. `onMove`
   * reorders panels while a request is in flight, so an outcome written back to
   * the captured index lands on whichever panel now sits there — writing one
   * member's failure, cancelled line or verified id onto another's. Every
   * outcome arm of `validatePanel` goes through here; `updatePanel(idx, patch)`
   * stays for the synchronous UI edits, where the index is current by
   * construction because the user just clicked that panel's control.
   */
  const updatePanelById = useCallback(
    (id: string, patch: Partial<PanelState>) => {
      setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    [],
  );

  const move = useCallback((idx: number, dir: -1 | 1) => {
    setPanels((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  }, []);

  const doRemove = useCallback((idx: number) => {
    setAnnouncement(`Key ${idx + 1} removed`);
    setPanels((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const requestRemove = useCallback(
    (idx: number) => {
      const p = panelsRef.current[idx];
      const hasEnteredCreds =
        !!p.apiKey ||
        !!p.apiSecret ||
        !!p.passphrase ||
        p.status !== "editing";
      if (!hasEnteredCreds) {
        doRemove(idx);
        return;
      }
      updatePanel(idx, { confirmingRemove: true });
    },
    [doRemove, updatePanel],
  );

  const cancelRemove = useCallback(
    (idx: number) => updatePanel(idx, { confirmingRemove: false }),
    [updatePanel],
  );

  /**
   * 153.4-05 / D-05 — ONE interval drives EVERY validating panel's wait.
   *
   * ⛔ NOT one interval per panel. A once-a-second render does not need N timers
   * disagreeing about "now" (T-153.4-22), and the card is pure precisely so this
   * step can own a single clock for all of them. The interval is armed while ANY
   * panel is validating and cleared the moment none is (and on unmount).
   *
   * It does two things per tick, both read through `panelsRef` — this file's
   * "synced in an effect, never written during render" rule — so the callback
   * never closes over a stale panel list:
   *
   *   1. THE CLIENT DEADLINE, evaluated against EACH PANEL'S OWN venue budget. A
   *      composite can mix a serialized venue (120 000 ms) with ccxt ones
   *      (30 000 ms); a shared deadline would abort a two-minute grant after
   *      forty-five seconds.
   *
   *      ⚠️ THE DEADLINE COVERS THE ROUTE, NOT THE VALIDATE LEG (153.4 review
   *      CR-01). `composite/add-key` spends `validateKey` THEN `encryptKey` THEN
   *      the add RPC, and it does not read `request.signal` — this abort has no
   *      server-side effect at all. Sized on the validate budget alone, the
   *      deadline fired almost exclusively in the window where validate had
   *      already SUCCEEDED and the route was minting and storing the key.
   *      `connectAbortDeadlineMsFor` covers both legs plus the grace, and the
   *      grace is still there for the reason it always was: the seam deadlines
   *      fire inside our own route and the reply still has to travel back, so
   *      giving up at exactly the route's budget could cut off a verdict already
   *      on the wire and re-create the silent UNKNOWN this phase exists to end.
   *      The browser gives up LAST — for every panel this interval is still
   *      watching.
   *
   *      ⚠️ AND THAT IS THE WHOLE OF THE CLAIM. This paragraph used to close
   *      "so no request can hold this tab open forever", which is false of one
   *      reachable path (153.4 review WR-03): the `Remove` control is
   *      deliberately not disabled while a panel is validating, and removing
   *      such a panel recomputes `anyValidating` to false, clears this one
   *      interval, and leaves that request with no client bound of OURS — only
   *      the platform's invocation limit. Left as-is on purpose rather than
   *      unfixed by oversight: the abort buys nothing there, because neither
   *      connect route reads `request.signal` (so it would not stop the key
   *      being stored) and `updatePanelById` no-ops for an id that is gone (so
   *      the settled request cannot touch the UI). Logged in TODOS.md.
   *   2. THE ELAPSED FIGURE each panel's card renders.
   */
  const anyValidating = panels.some((p) => p.status === "validating");
  useEffect(() => {
    if (!anyValidating) return;
    const tick = setInterval(() => {
      const now = Date.now();
      for (const p of panelsRef.current) {
        if (p.status !== "validating" || p.waitStartedAt === null) continue;
        if (now - p.waitStartedAt >= connectAbortDeadlineMsFor(p.waitExchange)) {
          abortReasonsRef.current.set(p.id, "deadline");
          abortControllersRef.current.get(p.id)?.abort();
        }
      }
      setPanels((prev) =>
        prev.map((p) =>
          p.status === "validating" && p.waitStartedAt !== null
            ? { ...p, waitElapsedMs: now - p.waitStartedAt }
            : p,
        ),
      );
    }, 1_000);
    return () => clearInterval(tick);
  }, [anyValidating]);

  /**
   * 153.4-05 — abandon ONE panel's wait, and nothing else.
   *
   * ⛔ NO CONFIRMATION DIALOG. Pressing this costs the user nothing they can act
   * on: the request is going to finish or fail on its own either way, and a
   * confirmation step on the one control whose purpose is escaping a stall is the
   * opposite of the affordance.
   *
   * The panel is looked up by index through `panelsRef` (the index the user just
   * clicked is current) and everything after that is keyed by its ID, so a
   * reorder between the validate and the cancel cannot redirect the abort.
   *
   * ⚠️ ABORTING STOPS THE BROWSER LISTENING; IT DOES NOT STOP THE SERVER WORKING,
   * AND THE SERVER'S WORK IS NOT ONLY A PROBE. This comment used to close with
   * "nothing is written on this path … which is what lets the cancelled copy
   * truthfully say nothing was saved". THAT WAS A FACT ABOUT `validate-key`
   * ASSERTED ABOUT THE ROUTE (153.4 review CR-02). What the user aborts is
   * `POST /api/strategies/composite/add-key`, which runs `validateKey` →
   * `encryptKey` → the add RPC and reads no `request.signal`, so on any run where
   * validate subsequently succeeds the credential IS encrypted and an `api_keys`
   * row IS written — while this panel sits at `status: "editing"` with
   * `apiKeyId: null`. ⚠️ And unlike `create-with-key`, this route has NO
   * existing-draft short-circuit by construction (see DIVERGENCE (1) in
   * `add-key/route.ts`), so an immediate re-validate mints a SECOND stored
   * credential for the same key rather than reconciling to the first.
   *
   * ⛔ The cancelled line below therefore states only what THIS BROWSER knows.
   */
  const handleStopWaiting = useCallback((idx: number) => {
    const p = panelsRef.current[idx];
    if (!p) return;
    abortReasonsRef.current.set(p.id, "user");
    pendingWaitFocusRef.current = p.id;
    abortControllersRef.current.get(p.id)?.abort();
  }, []);

  /**
   * 153.4-05 — restore focus to the cancelled panel's validate control.
   *
   * ⚠️ IN AN EFFECT, NOT IN THE CLICK HANDLER. `Stop waiting` lives inside a card
   * that unmounts on the same interaction, and at the instant of the click the
   * validate button is still `disabled` (`canValidate` is false while the panel
   * is validating). `focus()` on a disabled control is a no-op, so focus would
   * fall to `<body>` and a keyboard user would lose their place entirely. The
   * abort settles a tick later; by then the panel is back to `editing` and its
   * button is focusable again.
   */
  useEffect(() => {
    const id = pendingWaitFocusRef.current;
    if (!id) return;
    const target = panels.find((p) => p.id === id);
    if (!target || target.status === "validating") return;
    pendingWaitFocusRef.current = null;
    validateRowRefs.current
      .get(id)
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus();
  }, [panels]);

  const validatePanel = useCallback(
    async (idx: number) => {
      const p = panelsRef.current[idx];
      if (p.status === "validating") return;
      // 153.4-05 — everything after this line is keyed by IDENTITY. A reorder
      // while the request is in flight makes `idx` point at a different panel.
      const panelId = p.id;
      const activeOption = EXCHANGES.find((e) => e.id === p.exchange);
      const requiresPassphrase = activeOption?.requiresPassphrase ?? false;
      const requiresSecret = activeOption?.requiresSecret ?? true;
      // 153.4-05 — the controller is in place BEFORE the request leaves, and any
      // reason recorded for a previous attempt is dropped with it.
      const controller = new AbortController();
      abortControllersRef.current.set(panelId, controller);
      abortReasonsRef.current.delete(panelId);
      // 140.5-03 — the wait is cleared WITH the code it belongs to, on every
      // fresh attempt. This is the half a copy-paste of the working thread
      // drops: a wait left from attempt 1 rendered under attempt 2's failure
      // names a duration nobody advertised (TRAP-3).
      updatePanelById(panelId, {
        status: "validating",
        errorCode: null,
        retryAfterSeconds: null,
        // 153.4-05 — the wait starts: ONE `Date.now()` the step's interval then
        // measures against, the previous attempt's cancelled line retired, and
        // the venue FROZEN so every duration this panel goes on to state
        // describes the request actually on the wire.
        waitStartedAt: Date.now(),
        waitElapsedMs: 0,
        waitCancelled: false,
        waitExchange: p.exchange,
      });
      try {
        const res = await wizardFetch("/api/strategies/composite/add-key", {
          method: "POST",
          // `wizardFetch` spreads `init` and overrides only `headers`, so the
          // signal reaches `fetch` unchanged — no change to that module needed.
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exchange: p.exchange,
            api_key: p.apiKey,
            // sFOX is token-only: send api_secret "" (Phase-119 add-key carve-out
            // normalizes empty→"" and accepts it for sfox).
            api_secret: requiresSecret ? p.apiSecret : "",
            passphrase: requiresPassphrase ? p.passphrase : null,
            label: p.nickname.trim() || `${p.exchange} key`,
            wizard_session_id: wizardSessionId,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          strategy_id?: string;
          api_key_id?: string;
          code?: string;
        };
        if (!res.ok || !data.ok || !data.strategy_id || !data.api_key_id) {
          // 140.3-13a / SEAMUX-08 — membership-checked, never cast.
          //
          // 140.4-15 / SEAMRIM-08 — TRANSLATE FIRST, THEN MEMBERSHIP-CHECK, the
          // same order `SyncPreviewStep`'s kickoff arm adopted in 140.4-12 and
          // `ConnectKeyStep`'s sibling arm adopts alongside this one.
          //
          // ⚠️ 140.5-03 / SEAMPROSE-03 — CORRECTION. This paragraph used to end
          // "the two vocabularies are disjoint, so neither hop shadows the
          // other". THE WRONG REASON FOR A TRUE CONCLUSION, and one this file's
          // own `KNOWN_ADD_KEY_CODES` header does not claim.
          //
          // THE NECESSARY PROPERTY IS AGREEMENT; DISJOINTNESS IS ONLY
          // SUFFICIENT. Where the vocabularies overlap the table wins by the
          // order above, and that is harmless because both sides answer the
          // SAME code — not because they never meet.
          //
          // Measured at 140.5-03, predicate stated because a line-based grep
          // gets it wrong: intersect KEY SETS against
          // `SEAM_CODE_TO_WIZARD_CODE`'s keys, never values. Under that
          // predicate `KNOWN_KICKOFF_CODES` ∩ = {RATE_LIMITED} and
          // `KNOWN_FINALIZE_CODES` ∩ = {SEAM_MISCONFIGURED}; this file's two
          // sets and `ConnectKeyStep`'s intersect in NOTHING. Both real
          // overlaps AGREE at HEAD, and
          // `seam-ratelimit-posture.invariant.test.ts` reddens if a shared code
          // ever gets different answers. Do not restore the disjointness
          // sentence as the REASON — an empty intersection here is a fact about
          // today's rosters, and the safety does not rest on it.
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
              : data.code && KNOWN_ADD_KEY_CODES.has(data.code as WizardErrorCode)
                ? (data.code as WizardErrorCode)
                : "UNKNOWN";
          // 140.5-03 / SEAMPROSE-02 — the wait rides the HEADER, read through
          // the ONE parser, from the SAME response as the code. Absent header
          // ⇒ `null` ⇒ no wait rendered rather than a zero nobody advertised.
          updatePanelById(panelId, {
            ...WAIT_CLEARED,
            status: "editing",
            errorCode: code,
            retryAfterSeconds: parseRetryAfterSeconds(res.headers),
          });
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: MULTI_KEY_FUNNEL_STEP,
            code,
          });
          return;
        }
        setStrategyId(data.strategy_id);
        updatePanelById(panelId, {
          ...WAIT_CLEARED,
          status: "validated",
          apiKeyId: data.api_key_id,
          errorCode: null,
          confirmingRemove: false,
          // T-88-18: the key now exists server-side (referenced by api_key_id)
          // and the plaintext is no longer read on any validated-panel path
          // (the Continue payload sends only {api_key_id, window_start,
          // window_end}; the validated panel renders a read-only summary chip,
          // not the credential inputs). Clear the plaintext from React state so
          // it does not linger for the lifetime of the step while other keys
          // are added/reordered — mirroring single-key ConnectKeyStep, which
          // unmounts on success.
          apiKey: "",
          apiSecret: "",
          passphrase: "",
        });
      } catch (err) {
        /**
         * 153.4-05 — AN ABORT IS NOT A TRANSPORT FAILURE, AND THE TWO ABORTS ARE
         * NOT THE SAME OUTCOME. Branch FIRST, before anything below can classify
         * a user's own choice as an outage.
         *
         * ⚠️ TRAP-1, re-checked at this edit now that an `AbortSignal` rides the
         * request: an `AbortError` is a `DOMException` with a fixed name and
         * message and carries no request, no headers and no body, so it embeds
         * no credential either — the measurement in the `SERVICE_UNREACHABLE`
         * arm below still holds unchanged.
         */
        if (controller.signal.aborted) {
          const reason = abortReasonsRef.current.get(panelId);
          if (reason === "user") {
            // The user chose this. ⛔ No `errorCode`, ⛔ no `console.error` and
            // ⛔ no `wizard_error`: recording a deliberate cancel as an error
            // tells an operator the seam is failing when it is not, and that
            // funnel is what they would read to decide MT5 is broken
            // (T-153.4-21).
            updatePanelById(panelId, {
              ...WAIT_CLEARED,
              status: "editing",
              waitCancelled: true,
              errorCode: null,
              retryAfterSeconds: null,
            });
            return;
          }
          if (reason === "deadline") {
            // A real failure, and the funnel must agree with the screen (the
            // 140.5-03 rule this file states twice). The envelope names the
            // budget we granted — see `budgetSeconds` in `KeyPanel`.
            updatePanelById(panelId, {
              ...WAIT_CLEARED,
              status: "editing",
              errorCode: "SEAM_DEADLINE_EXCEEDED",
              retryAfterSeconds: null,
            });
            trackForQuantsEventClient("wizard_error", {
              wizard_session_id: wizardSessionId,
              step: MULTI_KEY_FUNNEL_STEP,
              code: "SEAM_DEADLINE_EXCEEDED",
            });
            return;
          }
        }
        // 140.5-03 / SEAMPROSE-03 — OUR HOP, NOT THE EXCHANGE'S. ⚠️ THIS CATCH
        // AND ITS SIBLING IN `handleContinue` WERE MISSED BY EVERY PRIOR
        // CENSUS: the synthesis named three transport catches and this file
        // holds two of the five. The request to
        // `/api/strategies/composite/add-key` never completed, so the exchange
        // may never have been contacted; `KEY_NETWORK_TIMEOUT`'s copy ("We
        // could not reach the exchange") asserted a venue fault for a fault on
        // our own hop, the rule `wizardErrors.ts` states by name beside it.
        //
        // ⚠️ BOTH OCCURRENCES. The telemetry payload below carried the same
        // wrong code, which is the identical false attribution in
        // machine-readable form — an operator reading that funnel would
        // conclude the VENUES are flaky when the fault is ours.
        updatePanelById(panelId, {
          ...WAIT_CLEARED,
          status: "editing",
          errorCode: "SERVICE_UNREACHABLE",
          // No response exists on this path, so no wait was advertised.
          // Explicit rather than inherited: a wait surviving from a previous
          // attempt would render under this failure (TRAP-3).
          retryAfterSeconds: null,
        });
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: MULTI_KEY_FUNNEL_STEP,
          code: "SERVICE_UNREACHABLE",
        });
        // Logs only `err`, never credential fields (T-88-18). TRAP-1 re-checked
        // at this edit as a PROPERTY: `wizardFetch` sets exactly one header
        // (`X-Correlation-Id`) and this route authenticates by COOKIE, so no
        // credential value is on the request for a rejection to embed. The
        // typed key material lives in React state, never in `err`.
        console.error("[wizard:MultiKeyConnectStep] add-key threw:", err);
      } finally {
        // 153.4-05 — this attempt's controller and its reason die with it, on
        // EVERY outcome (the `return`s above run this too). Without it the maps
        // would grow one entry per attempt for the life of the step.
        abortControllersRef.current.delete(panelId);
        abortReasonsRef.current.delete(panelId);
      }
    },
    [updatePanelById, wizardSessionId],
  );

  const { fieldErrors, summaryLines } = useMemo(
    () => computeValidation(panels),
    [panels],
  );

  const allValidated =
    panels.length > 0 &&
    panels.every((p) => p.status === "validated" && !!p.windowStart);
  const hasBlockingError =
    summaryLines.length > 0 || Object.keys(fieldErrors).length > 0;
  const canContinue = allValidated && !hasBlockingError && !continuing;

  // Phase 94.1 / F2 — connect_key "dirty vs last-saved set". In State B the set
  // is dirty when any panel is not yet validated (a fresh add or a re-opened
  // edit → no persisted member for it) OR when the validated set's signature
  // diverges from the last-committed one (an uncommitted reorder/removal). In
  // State A the single-key draft is dirty when credentials are typed but not
  // submitted. Reported up so the clickable stepper blocks a forward jump that
  // would bypass the Continue → set-members POST and drop the edits.
  const currentSig = allValidated
    ? JSON.stringify(buildSetMembersKeys(panels))
    : null;
  const dirty =
    mode === "multi"
      ? currentSig === null || currentSig !== committedSig
      : singleDraftDirty;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // Reset the parent's dirty flag when this step unmounts (e.g. Continue
  // advanced the wizard) so a stale `true` never lingers on a later step.
  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
  }, [onDirtyChange]);

  const summaryEnvelope =
    summaryLines.length > 0
      ? {
          // Route the summary through buildEnvelope (A4); the human_message
          // (interpolated title) comes from wizardErrors. The bulleted list is
          // the live per-issue field messages from keyWindowsSchema.
          ...buildEnvelope("MULTI_KEY_WINDOWS_INVALID", correlationId, {
            issueCount: summaryLines.length,
          }),
          debug_context: summaryLines,
        }
      : null;

  const continueErrorEnvelope = continueError
    ? continueError === "MULTI_KEY_WINDOWS_INVALID"
      ? {
          // The set-members route rejected the key windows the client passed —
          // reachable via browser-vs-server clock skew tripping the future-window
          // rule server-side only. MULTI_KEY_WINDOWS_INVALID is a SUMMARY-ONLY
          // table entry (empty cause/fix, recoverable:false) built for the inline
          // client-summary path, where the component supplies the live per-issue
          // lines (summaryEnvelope above). On THIS server-reject path client
          // validation already passed, so there are no field-level issues to
          // highlight — a bare summary envelope would show an empty box with no
          // Retry. Mirror the summaryEnvelope spread+override pattern: spread
          // buildEnvelope then override with a populated cause and force
          // recoverable so ErrorEnvelope renders Retry (showRetry = recoverable
          // && Boolean(onRetry)). Keep the table entry summary-only — do NOT
          // pollute wizardErrors.ts.
          ...buildEnvelope(continueError, correlationId, {
            retryAfterSeconds: continueRetryAfterSeconds ?? undefined,
          }),
          cause:
            "We couldn't save these key windows — the server rejected them, most likely a clock or timing mismatch between your browser and our servers. Review the dates and try again.",
          recoverable: true,
        }
      : // 140.5-03 / SEAMPROSE-02 — ONE handler, one state, BOTH arms. The two
        // `buildEnvelope` calls here are the same failure rendered two ways
        // (the windows-invalid arm spreads and overrides), so threading only
        // the arm an author happens to read first would leave the other silent.
        // `?? undefined` because ABSENCE IS NOT ZERO (140.3-10's rule).
        buildEnvelope(continueError, correlationId, {
          retryAfterSeconds: continueRetryAfterSeconds ?? undefined,
        })
    : null;

  const handleContinue = useCallback(async () => {
    const current = panelsRef.current;
    if (continuing || !strategyId) return;
    setContinuing(true);
    setContinueError(null);
    // 140.5-03 — the wait dies with the code it belongs to, on every fresh
    // attempt (TRAP-3).
    setContinueRetryAfterSeconds(null);
    try {
      const keys = buildSetMembersKeys(current);
      const res = await wizardFetch("/api/strategies/composite/set-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId, keys }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
      };
      if (!res.ok || !data.ok) {
        // 140.3-13a / SEAMUX-08 — membership-checked against set-members' OWN
        // four-code contract, never cast and never against add-key's set.
        const code: WizardErrorCode =
          data.code && KNOWN_SET_MEMBERS_CODES.has(data.code as WizardErrorCode)
            ? (data.code as WizardErrorCode)
            : "UNKNOWN";
        setContinueError(code);
        // 140.5-03 / SEAMPROSE-02 — the wait rides the HEADER, read through the
        // ONE parser, from the SAME response as the code above.
        setContinueRetryAfterSeconds(parseRetryAfterSeconds(res.headers));
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: MULTI_KEY_FUNNEL_STEP,
          code,
        });
        setContinuing(false);
        return;
      }
      // F2 — the current set is now persisted; mark it committed so the step is
      // not reported dirty if the user navigates back to it without editing.
      setCommittedSig(JSON.stringify(keys));
      const first = current[0];
      onSuccess({
        strategyId,
        apiKeyId: first.apiKeyId ?? "",
        exchange: first.exchange,
      });
    } catch (err) {
      // 140.5-03 / SEAMPROSE-03 — OUR HOP, NOT THE EXCHANGE'S, and here the
      // old code was doubly wrong: `set-members` performs NO key validation at
      // all (it never calls `classifyKeyValidationError` — see
      // `KNOWN_SET_MEMBERS_CODES` above), so it never touches an exchange on
      // any path. "We could not reach the exchange" named a venue that was
      // provably not involved, for a request that only persists date windows.
      //
      // ⚠️ BOTH OCCURRENCES, telemetry included — same false attribution,
      // machine-readable.
      setContinueError("SERVICE_UNREACHABLE");
      // No response exists on this path, so no wait was advertised. Explicit,
      // because a value surviving from a previous attempt would render under
      // this failure (TRAP-3).
      setContinueRetryAfterSeconds(null);
      trackForQuantsEventClient("wizard_error", {
        wizard_session_id: wizardSessionId,
        step: MULTI_KEY_FUNNEL_STEP,
        code: "SERVICE_UNREACHABLE",
      });
      setContinuing(false);
      // TRAP-1 re-checked at this edit as a PROPERTY: `wizardFetch` sets
      // exactly one header (`X-Correlation-Id`) and this route authenticates by
      // COOKIE, so no credential value is on the request for a rejection to
      // embed. The Continue payload carries `{api_key_id, window_start,
      // window_end}` only — no plaintext key material exists on this path.
      console.error("[wizard:MultiKeyConnectStep] set-members threw:", err);
    }
  }, [continuing, strategyId, onSuccess, wizardSessionId]);

  // ── State A: byte-identical ConnectKeyStep + the ONE ghost affordance ───────
  // The rehydration loading/error affordances (F3) render as NON-form-replacing
  // banners ABOVE a still-mounted ConnectKeyStep — NOT as early returns that
  // unmount it. RT-FINDING-2: an early-return error branch destroyed the
  // in-progress single-key credentials the user typed during the loading window
  // (ConnectKeyStep's useState unmounts), and stranded them on a blank form
  // after Retry (a stale singleDraftDirtyRef then bailed the guard, and the
  // rehydration effect never re-ran). Keeping the form mounted across
  // loading→error→retry preserves typed credentials and F4's guard reasoning,
  // and never strands the user. No draftStrategyId ⇒ status stays "idle" ⇒ no
  // banner ⇒ byte-neutral single-key wizard.
  if (mode === "single") {
    return (
      <>
        {/* F3 — non-blocking "loading your saved keys" banner while the members
            GET is in flight. Additive, not a form-replacing skeleton (F4). */}
        {rehydrateStatus === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-md border border-border bg-page px-4 py-3"
            data-testid="rehydrate-loading"
          >
            <p className="text-caption text-text-secondary">
              Loading your saved keys…
            </p>
          </div>
        )}
        {/* F3 + RT-2 — retryable error banner ABOVE the form (not replacing it),
            symmetric with the loading banner. RT-3: WIZARD_KEYS_LOAD_FAILED
            carries NEUTRAL copy (no "composite" assertion) so it reads correctly
            for a resumed single-key draft, whose membership is empty. */}
        {rehydrateStatus === "error" && (
          <div className="mb-4" data-testid="rehydrate-error">
            <WizardErrorEnvelope
              envelope={buildEnvelope("WIZARD_KEYS_LOAD_FAILED", correlationId)}
              onRetry={() => {
                setRehydrateStatus("loading");
                setRetryTick((t) => t + 1);
              }}
            />
          </div>
        )}
        <ConnectKeyStep
          wizardSessionId={wizardSessionId}
          onSuccess={onSuccess}
          onDraftChange={onSingleDraftChange}
          footerSlot={
            <Button
              type="button"
              variant="ghost"
              data-testid="multi-add-key"
              onClick={enterMulti}
            >
              + Add another key window
            </Button>
          }
        />
      </>
    );
  }

  // ── State B: ordered KeyPanel list ──────────────────────────────────────────
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

      {/* Step-level permission block — rendered ONCE, not per key. F3: when a
          token-only (sfox) panel is present, append the honest sfox structural
          note to "What we reject" so the unqualified scope-rejection claim is
          not shown false for sfox. */}
      <div className="mt-6 rounded-md border border-border bg-page">
        <dl className="divide-y divide-border">
          {TRUST_ATOMS.map((atom) =>
            atom.title === "What we reject" &&
            panels.some(
              (p) =>
                (EXCHANGES.find((e) => e.id === p.exchange)?.requiresSecret ??
                  true) === false,
            )
              ? { ...atom, body: atom.body + SFOX_REJECT_ATOM_NOTE }
              : atom,
          ).map((atom) => (
            <div
              key={atom.title}
              className="grid gap-1 px-4 py-3 md:grid-cols-[180px_1fr] md:gap-6"
            >
              <dt className="text-caption font-medium text-text-primary">
                {atom.title}
              </dt>
              <dd className="text-caption text-text-secondary">{atom.body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ol className="mt-8 space-y-6" data-testid="multi-key-list">
        {panels.map((panel, i) => (
          <KeyPanel
            key={panel.id}
            panel={panel}
            index={i}
            total={panels.length}
            fieldError={fieldErrors[i]}
            correlationId={correlationId}
            registerCardRef={registerCardRef}
            registerValidateRowRef={registerValidateRowRef}
            onUpdate={updatePanel}
            onValidate={validatePanel}
            onStopWaiting={handleStopWaiting}
            onMove={move}
            onRequestRemove={requestRemove}
            onConfirmRemove={doRemove}
            onCancelRemove={cancelRemove}
          />
        ))}
      </ol>

      {summaryEnvelope && (
        <div id="multi-key-validation-summary" className="mt-6" data-testid="multi-key-validation-summary">
          <WizardErrorEnvelope envelope={summaryEnvelope} />
        </div>
      )}

      {continueErrorEnvelope && (
        <div className="mt-6">
          <WizardErrorEnvelope
            envelope={continueErrorEnvelope}
            onRetry={() => setContinueError(null)}
          />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <Button
          type="button"
          variant="ghost"
          data-testid="multi-add-key"
          onClick={addPanel}
        >
          + Add another key window
        </Button>
        <Button
          type="button"
          data-testid="multi-continue"
          disabled={!canContinue}
          aria-describedby={
            summaryEnvelope ? "multi-key-validation-summary" : undefined
          }
          onClick={handleContinue}
        >
          Continue
        </Button>
      </div>

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

      <div
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="multi-key-announce"
      >
        {announcement}
      </div>
    </section>
  );
}

interface KeyPanelProps {
  panel: PanelState;
  index: number;
  total: number;
  fieldError?: FieldError;
  correlationId: string;
  registerCardRef: (id: string, el: HTMLButtonElement | null) => void;
  /** 153.4-05 — the validate ROW, so a cancelled wait can restore focus to it. */
  registerValidateRowRef: (id: string, el: HTMLDivElement | null) => void;
  onUpdate: (idx: number, patch: Partial<PanelState>) => void;
  onValidate: (idx: number) => void;
  /** 153.4-05 — abandon THIS panel's wait. Aborts nothing else. */
  onStopWaiting: (idx: number) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
  onRequestRemove: (idx: number) => void;
  onConfirmRemove: (idx: number) => void;
  onCancelRemove: (idx: number) => void;
}

const CONTROL_CLASS =
  "inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-border text-text-secondary transition-colors hover:bg-page disabled:opacity-50 disabled:pointer-events-none";

function KeyPanel({
  panel: p,
  index,
  total,
  fieldError,
  correlationId,
  registerCardRef,
  registerValidateRowRef,
  onUpdate,
  onValidate,
  onStopWaiting,
  onMove,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
}: KeyPanelProps) {
  const active = EXCHANGES.find((e) => e.id === p.exchange);
  const requiresPassphrase = active?.requiresPassphrase ?? false;
  // Absent → true (ccxt key+secret pair). sFOX is token-only.
  const requiresSecret = active?.requiresSecret ?? true;
  const keyLabel = active?.credentialLabels?.key ?? "API Key";
  const secretLabel = active?.credentialLabels?.secret ?? "API Secret";
  const keyPlaceholder =
    active?.credentialPlaceholders?.key ?? "Paste the read-only key";
  const secretPlaceholder =
    active?.credentialPlaceholders?.secret ?? "Paste the secret";
  // 153.4 review CR-03 — the third field's per-venue strings. Every default is
  // today's hardcoded OKX value, so a panel on any existing venue renders
  // byte-identically; MT5 relabels the slot to the broker server and unmasks it
  // (a server NAME is not a credential, and the user must be able to read it
  // back against the helper that says to copy it exactly).
  const passphraseLabel = active?.passphraseLabel ?? "OKX Passphrase";
  const passphrasePlaceholder =
    active?.passphrasePlaceholder ?? "Paste the OKX passphrase";
  const passphraseHelper =
    active?.passphraseHelper ??
    "OKX requires a passphrase in addition to key and secret. You set this when you created the API key on OKX.";
  const passphraseSecret = active?.passphraseSecret ?? true;
  const secretHelper = active?.secretHelper;
  const secretInputId = `key-${index}-api-secret-input`;
  const windowEndId = `key-${index}-window-end`;

  // 153.4-05 — the venue THIS panel's most recent attempt actually ran against,
  // falling back to the selected card only when no attempt has been made.
  const attemptVenue = p.waitExchange ?? p.exchange;

  const errorEnvelope = p.errorCode
    ? buildEnvelope(p.errorCode, correlationId, {
        // 140.5-03 / SEAMPROSE-02 — THIS panel's advertised wait, not the
        // step's. `?? undefined` because ABSENCE IS NOT ZERO (140.3-10's rule):
        // `null` in the envelope slot renders as a `0`-second wait we were
        // never told about.
        retryAfterSeconds: p.retryAfterSeconds ?? undefined,
        // 153.4-05 / UI-SPEC Gate A — the budget WE granted THIS panel, in
        // seconds, and ONLY for the code that names one. The same rule one line
        // up: the expression yields `undefined`, never `null` and never `0` — a
        // `0` here is a budget we never granted, which turns a vague failure
        // into a specific lie (TRAP-3). Read from the FROZEN attempt venue, so
        // the figure describes the request that actually ran out of time.
        budgetSeconds:
          p.errorCode === "SEAM_DEADLINE_EXCEEDED"
            ? validateBudgetSecondsFor(attemptVenue)
            : undefined,
        // 153.4-05 / UI-SPEC Gate B — WITHOUT THIS, `SEAM_DEADLINE_EXCEEDED`'s
        // "Your key details are still on this page." is silently withheld: that
        // bullet declares `REQUIRES_CONNECT_SURFACE` and absence SUPPRESSES. A
        // user who waited two minutes and is then told nothing about the
        // credentials they typed is the worst outcome this phase can produce,
        // which is why 153.1-04 bound the obligation to the commit that starts
        // EMITTING the code — this one, for the composite surface.
        surface: "connect",
        // 153.1-03 / D-17 — the venue, as a lookup key into the closed
        // capability record (never interpolated into copy). Absence renders the
        // substitutable remedy unconditionally, so a serialized-venue user reads
        // "switch to a different exchange" for a venue that IS their account.
        // PER PANEL, because each member carries its own venue — a step-level
        // value would answer panel 1's question with panel 3's venue.
        venue: attemptVenue,
      })
    : null;

  /**
   * 153.4-05 / UI-SPEC Surface 1 §Render gate — the card's gate is DERIVED, not
   * stored.
   *
   * ⚠️ `waitElapsedMs` moves on the step's 1 s tick, so it is 0 for the whole
   * first second: a validate that answers in under 300 ms finishes before the
   * value can ever reach 300 and no card flashes. That is the render gate,
   * satisfied WITHOUT a second per-panel timer — please do not "fix" it by
   * adding one. (`ConnectKeyStep` needs an explicit 300 ms timeout because it
   * gates on a boolean rather than on a ticked figure.)
   */
  const showWaitCard =
    p.status === "validating" &&
    p.waitStartedAt !== null &&
    p.waitElapsedMs >= WAIT_CARD_MOUNT_DELAY_MS;

  const canValidate =
    !!p.apiKey &&
    (!requiresSecret || !!p.apiSecret) &&
    (!requiresPassphrase || !!p.passphrase) &&
    !!p.windowStart &&
    p.status !== "validating";

  return (
    <li>
      <fieldset
        data-testid={`key-panel-${index}`}
        data-panel={index + 1}
        // 153.4-05 / UI-SPEC Surface 1 — busy while THIS panel's validate is in
        // flight, absent otherwise (never `"false"`: the attribute's absence and
        // its false value are the same state to AT, and one of the two is
        // noise). Per panel, because the other panels are not busy.
        aria-busy={p.status === "validating" ? "true" : undefined}
        className="rounded-md border border-border bg-white px-4 py-3"
      >
        <legend className="font-metric text-micro uppercase tracking-wider tabular-nums text-text-secondary">
          Key {index + 1} / {total}
        </legend>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            aria-label={`Move key ${index + 1} earlier`}
            aria-disabled={index === 0}
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
            data-testid={`key-${index}-move-up`}
            className={CONTROL_CLASS}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move key ${index + 1} later`}
            aria-disabled={index === total - 1}
            disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
            data-testid={`key-${index}-move-down`}
            className={CONTROL_CLASS}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label={`Remove key ${index + 1}`}
            onClick={() => onRequestRemove(index)}
            data-testid={`key-${index}-remove`}
            className={`${CONTROL_CLASS} px-3`}
          >
            Remove
          </button>
        </div>

        {p.confirmingRemove && (
          <div className="mt-3 rounded-md border border-negative/30 bg-negative/5 px-4 py-3">
            <p className="text-caption text-text-primary">
              Remove Key {index + 1}? The credentials you entered for it will be
              cleared.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                data-testid={`key-${index}-remove-confirm`}
                onClick={() => onConfirmRemove(index)}
              >
                Remove
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onCancelRemove(index)}
              >
                Keep
              </Button>
            </div>
          </div>
        )}

        {p.status === "validated" ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-2"
            data-testid={`key-${index}-summary`}
          >
            <span className="text-body text-text-primary">{active?.name}</span>
            <span className="text-text-muted">·</span>
            <span className="text-caption text-text-secondary">
              {p.nickname.trim() || `${p.exchange} key`}
            </span>
            <span className="text-text-muted">·</span>
            <span className="font-metric text-caption tabular-nums text-text-secondary">
              {p.windowStart} – {p.stillLive || !p.windowEnd ? "live" : p.windowEnd}
            </span>
            <TrustTierLabel trustTier="api_verified" />
          </div>
        ) : (
          <>
            <fieldset className="mt-3">
              <legend className="text-caption font-medium text-text-primary">
                Exchange
              </legend>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                {EXCHANGES.map((ex, exIdx) => {
                  const isActive = ex.id === p.exchange;
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      ref={
                        exIdx === 0
                          ? (el) => registerCardRef(p.id, el)
                          : undefined
                      }
                      onClick={() =>
                        onUpdate(index, { exchange: ex.id, errorCode: null })
                      }
                      className={`rounded-md border px-4 py-3 text-left transition-colors ${
                        isActive
                          ? "border-accent bg-accent/5"
                          : "border-border bg-white hover:border-accent/50"
                      }`}
                      aria-pressed={isActive}
                      data-testid={`key-${index}-exchange-${ex.id}`}
                    >
                      <p className="text-body font-semibold text-text-primary">
                        {ex.name}
                      </p>
                      <p className="mt-1 text-micro text-text-secondary">
                        {ex.caption}
                      </p>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-5 space-y-5">
              <Input
                label={keyLabel}
                value={p.apiKey}
                onChange={(e) => onUpdate(index, { apiKey: e.target.value })}
                placeholder={keyPlaceholder}
                autoComplete="off"
                data-testid={`key-${index}-api-key`}
              />

              {/* sFOX is token-only — render the secret block only for
                  key+secret exchanges (mirrors ConnectKeyStep). */}
              {requiresSecret && (
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor={secretInputId}
                      className="text-caption font-medium text-text-primary"
                    >
                      {secretLabel}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdate(index, { showSecret: !p.showSecret })
                      }
                      className="text-micro text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
                    >
                      {p.showSecret ? "Hide" : "Show"}
                    </button>
                  </div>
                  <input
                    id={secretInputId}
                    type={p.showSecret ? "text" : "password"}
                    value={p.apiSecret}
                    onChange={(e) =>
                      onUpdate(index, { apiSecret: e.target.value })
                    }
                    placeholder={secretPlaceholder}
                    autoComplete="off"
                    data-testid={`key-${index}-api-secret`}
                    className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  />
                  {/* Muted (never amber/red) steer under the secret input —
                      DESIGN.md semantic-color gate: tone is earned by an actual
                      rejection, not a preemptive warning. MT5 uses it for the
                      investor-vs-master steer; absent elsewhere. */}
                  {secretHelper && (
                    <p className="mt-1 text-micro text-text-muted">
                      {secretHelper}
                    </p>
                  )}
                </div>
              )}

              {requiresPassphrase && (
                <div>
                  <Input
                    label={passphraseLabel}
                    type={passphraseSecret && !p.showSecret ? "password" : "text"}
                    value={p.passphrase}
                    onChange={(e) =>
                      onUpdate(index, { passphrase: e.target.value })
                    }
                    placeholder={passphrasePlaceholder}
                    autoComplete="off"
                    data-testid={`key-${index}-passphrase`}
                  />
                  <p className="mt-1 text-micro text-text-muted">
                    {passphraseHelper}
                  </p>
                </div>
              )}

              <Input
                label="Key nickname (optional)"
                value={p.nickname}
                onChange={(e) => onUpdate(index, { nickname: e.target.value })}
                placeholder={`e.g. ${p.exchange} · prod`}
                autoComplete="off"
                data-testid={`key-${index}-nickname`}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  type="date"
                  label="Active from"
                  value={p.windowStart}
                  max={TODAY}
                  onChange={(e) =>
                    onUpdate(index, { windowStart: e.target.value })
                  }
                  error={fieldError?.start}
                  data-testid={`key-${index}-window-start`}
                />
                <div>
                  <Input
                    id={windowEndId}
                    type="date"
                    label="Active until"
                    value={p.windowEnd}
                    max={TODAY}
                    disabled={p.stillLive}
                    onChange={(e) =>
                      onUpdate(index, { windowEnd: e.target.value })
                    }
                    error={fieldError?.end}
                    data-testid={`key-${index}-window-end`}
                  />
                  <label className="mt-1 flex items-center gap-2 text-micro text-text-muted">
                    <input
                      type="checkbox"
                      checked={p.stillLive}
                      onChange={(e) =>
                        onUpdate(index, {
                          stillLive: e.target.checked,
                          windowEnd: e.target.checked ? "" : p.windowEnd,
                        })
                      }
                      aria-controls={windowEndId}
                      data-testid={`key-${index}-still-live`}
                    />
                    Still live — no end date
                  </label>
                </div>
              </div>

              <p className="text-micro text-text-muted">
                Each key covers a date range of this strategy&apos;s track
                record. Ranges may not overlap.
              </p>
            </div>
          </>
        )}

        {/* Overlap notes stay visible on collapsed (validated) panels so a
            cross-key error is loud on BOTH offending rows. */}
        {p.status === "validated" && fieldError?.start && (
          <p
            className="mt-2 text-caption text-negative"
            data-testid={`key-${index}-window-error`}
          >
            {fieldError.start}
          </p>
        )}
        {/* Editing panels carry the overlap note on their start-field error via
            the Input `error` prop; mirror it under a stable testid too. */}
        {p.status !== "validated" && fieldError?.start && (
          <p
            className="sr-only"
            data-testid={`key-${index}-window-error`}
          >
            {fieldError.start}
          </p>
        )}

        {errorEnvelope && (
          <div className="mt-3">
            <WizardErrorEnvelope
              envelope={errorEnvelope}
              onRetry={() =>
                // 140.5-03 — the wait is cleared WITH the code, mirroring
                // `SyncPreviewStep`'s `handleKickoffRetry`. Belt and braces
                // with the clear in `validatePanel`: whichever path dismisses
                // the error, no wait survives it.
                onUpdate(index, { errorCode: null, retryAfterSeconds: null })
              }
            />
          </div>
        )}

        {/* 153.4-05 / D-05 — THIS panel's long wait, made legible. One card per
            validating panel, mounted inside the panel it describes so panel 3's
            wait can never render under panel 1, and torn down on every outcome.
            The card is PURE — this step owns the clock, the controller and the
            budget; it renders ABOVE the validate row so the escalation and the
            `Stop waiting` control sit next to the button they describe. */}
        {showWaitCard && (
          <ValidateWaitCard
            exchange={attemptVenue}
            elapsedMs={p.waitElapsedMs}
            onStopWaiting={() => onStopWaiting(index)}
          />
        )}

        {/* The cancelled state. ⛔ NOT a `WizardErrorEnvelope` and ⛔ never
            `text-negative`: the user chose this and nothing failed. DESIGN.md
            §Semantic-color gates — red asserts a permanent failure, and there is
            no failure here to assert. Scoped to this panel, because the other
            panels' checks are still running.

            ⛔ NO "NOTHING WAS SAVED" CLAIM (153.4 review CR-02). Aborting stops
            this browser listening; the route runs on past validate into
            `encryptKey` and the add RPC, so this key may well be stored. ⚠️ The
            tail differs from the single-key surface's ON PURPOSE and is not
            copy-drift: `create-with-key` reconciles a re-submit through its
            `wizard_session_id` idempotency fence, and `composite/add-key` has no
            such fence by construction — so here the honest steer is to wait
            rather than to re-fire, which would mint a second credential. */}
        {p.waitCancelled && p.status !== "validating" && (
          <p
            className="mt-3 text-caption text-text-secondary"
            data-testid={`key-${index}-wait-cancelled`}
          >
            We stopped waiting for your broker. Your key details are still on
            this page — the check may still be finishing on our side, so give it
            a moment before validating this key again.
          </p>
        )}

        {p.status !== "validated" && (
          <div
            className="mt-5"
            ref={(el) => registerValidateRowRef(p.id, el)}
          >
            <Button
              type="button"
              data-testid={`key-${index}-validate`}
              disabled={!canValidate}
              onClick={() => onValidate(index)}
            >
              {p.status === "validating" ? "Validating..." : "Validate & add key"}
            </Button>
          </div>
        )}
      </fieldset>
    </li>
  );
}
