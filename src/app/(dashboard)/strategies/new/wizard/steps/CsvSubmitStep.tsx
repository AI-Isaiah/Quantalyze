"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import {
  CSV_SUBMIT_STEP_HEADINGS,
  WIZARD_ERROR_COPY,
  recogniseSeamErrorCode,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { CsvValidationEnvelope } from "./CsvValidationEnvelope";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { buildEnvelope, type ErrorEnvelope } from "@/lib/envelope";
import { seamCorrelationId, seamErrorCode } from "@/lib/seam-discriminator";
import { parseRetryAfterSeconds } from "@/lib/retry/retry-after";
import { scrubSeamError } from "@/lib/seam-redaction";
import type { MetadataDraft } from "./MetadataStep";
import {
  getWizardCorrelationId,
  wizardFetch,
} from "@/lib/wizard/wizard-correlation";

/**
 * Phase 15 / CSV-01..CSV-02 — sub-step 3 of the CSV branch.
 *
 * Read-only summary card + 'Submit strategy' CTA + 'Back' button. POSTs
 * to /api/strategies/csv-finalize with {wizard_session_id, fmt,
 * strategy_name}. On success, calls onSubmitted(strategy_id) which
 * WizardClient hooks to clearWizardState + router.push (UI-SPEC §7.5).
 *
 * Cross-AI revision 2026-04-30: the finalize body now includes
 * strategy_name (snake_case JSON key) sourced from the user-typed value
 * captured on the Upload step. The strategyName prop is rendered as
 * the FIRST SummaryRow in the read-only summary.
 */

type Fmt = "daily_returns" | "daily_nav" | "trades";

interface PreviewShape {
  row_count: number;
  date_range: [string, string];
  columns_detected: string[];
  first_rows: Record<string, unknown>[];
  last_rows: Record<string, unknown>[];
}

interface ValidationEnvelope {
  code: string;
  human_message: string;
  debug_context: {
    pandera_errors?: { rule: string; row: number; message: string }[];
  };
  correlation_id: string | null;
}

export interface CsvSubmitStepProps {
  wizardSessionId: string;
  fmt: Fmt;
  /** forwarded to finalize body as `strategy_name` (snake_case) */
  strategyName: string;
  preview: PreviewShape;
  /**
   * Phase 19.1 — parsed daily-return rows from the csv-validate envelope.
   * Forwarded to csv-finalize as `daily_returns_series` (snake_case).
   * REQUIRED for `fmt=daily_returns`/`daily_nav`: `parseDailyReturnsSeries` in
   * `src/app/api/strategies/csv-finalize/route.ts` rejects a missing or empty
   * series with `CSV_INVALID_FORMAT`. Undefined/empty is the expected shape for
   * `fmt=trades`.
   *
   * ⚠️ 140.5-05 / SEAMPROSE-02 — a bare `file:line` citation naming line 748 of
   * a file called `route.ts` stood here. It was wrong (that line is not the
   * check) and unresolvable (140.5-04's census measured that basename as
   * **88-way ambiguous** in this repo). Replaced by a symbol anchor, which
   * survives every edit above it. The old citation is DESCRIBED rather than
   * quoted: a quoted `file:line` would keep the census counting this file as
   * carrying a live citation — DEF-16-2 pointed at itself.
   */
  dailyReturnsSeries?: { date: string; daily_return: number }[];
  /**
   * QA report 2026-05-21 ISSUE-010: classification metadata captured on
   * the new csv_metadata step. Forwarded to /api/strategies/csv-finalize
   * so the strategy can be discovered after admin approval.
   */
  metadata: MetadataDraft;
  /**
   * Phase 110 / CONTRIB-01..02 — mount surface. `"manager"` (default) keeps
   * the sell-side "founder reviews" copy and finalize `entry_context:
   * "manager"` (→ status `pending_review`). `"contribution"` shows the
   * allocator-framed private-add copy and sends `entry_context: "contribution"`
   * (→ status `private`, owner-only, never published — plan 110-04 server side).
   */
  entryContext?: "manager" | "contribution";
  onSubmitted: (strategyId: string) => void;
  /**
   * CR-01 (140.4-REVIEW) — the durable half of the double-submit fence. Fired
   * once whenever a submit ATTEMPT terminates in an error (either envelope
   * panel), so WizardClient can burn the current `wizard_session_id`: a
   * subsequent change to the name or the series then mints a fresh id, making
   * a changed resubmit a NEW submission by construction rather than a merge
   * onto the strategy the first attempt created. Not fired on success (that
   * clears the wizard) nor on the clear-before-submit call.
   */
  onSubmitFailed?: () => void;
  /**
   * ⭐ 146.2-08 / B1 — THE ESCAPE FROM A REFUSAL THAT IS OTHERWISE PERMANENT.
   *
   * A `CSV_SESSION_REUSED` 409 is the ONE refusal this step cannot retry out
   * of. The refusal burns the session id (`showCsvEnvelope` → `onSubmitFailed`)
   * against the content being submitted, and `WizardClient`'s re-mint effect
   * only mints on a MATERIAL CONTENT CHANGE — so resubmitting the same file
   * replays the same spent id and takes the same 409, forever. The wizard's two
   * existing reset controls do not reach this branch either: "Start fresh" is
   * gated on `initialDraft` (structurally null on the CSV branch) and "Delete
   * draft" on `strategyId` (never set here).
   *
   * Called when the user takes the remedy. The implementation MUST mint a fresh
   * `wizard_session_id` and clear the burn, and must NOT discard the uploaded
   * series or the metadata — the whole point is that a refused user does not
   * re-upload a file the wizard is already holding.
   *
   * ⚠️ REQUIRED, and the requiredness IS the fix. Typed optional (the shape
   * `onSubmitFailed` uses) it could be forgotten at a future mount site and the
   * user would be stranded again with no compile-time signal — which is the
   * exact defect this prop exists to close. A missing escape must fail loud, at
   * build time, on the mount site that omitted it.
   */
  onStartNewStrategy: () => void;
  onBack: () => void;
}

/**
 * Phase 110 — contribution-mode overrides of the sell-side CSV headings.
 * Manager mode uses CSV_SUBMIT_STEP_HEADINGS byte-for-byte.
 */
const CSV_SUBMIT_STEP_HEADINGS_CONTRIBUTION = {
  title: "Review and add",
  subtitle:
    "This strategy is added privately to your account. Only you can see it — it is never published or submitted for review.",
  submitCtaLabel: "Add to my strategies",
  submittingCtaLabel: "Adding…",
} as const;

/**
 * 140.5-05 / SEAMPROSE-08 — every code `POST /api/strategies/csv-finalize` puts
 * on the wire in its OWN vocabulary. The twin of `KNOWN_CSV_VALIDATE_CODES` in
 * `CsvUploadStep.tsx`, and DELIBERATELY A SECOND APPLICATION rather than a
 * shared two-client abstraction: the shared artefacts here are the hop, the
 * envelope, the copy table and the guard. A bespoke "shared CSV error handler"
 * would be a THIRD vocabulary surface admitting each route's codes at the
 * other — the reason `KNOWN_CREATE_WITH_KEY_CODES` and `KNOWN_ADD_KEY_CODES`
 * are also kept apart.
 *
 * ── COVERAGE-LAW ROW (CONTEXT §2), STATED ────────────────────────────────────
 * A hand-typed roster — **row 2, PARTIAL BY CONSTRUCTION**. Row 1 in this file
 * is the other half of the arm: the shared `SEAM_CODE_TO_WIZARD_CODE` hop and
 * the shared `ErrorEnvelope`. The row-2 half is fail-louded, not trusted:
 * `seam-wire-vocabulary.invariant.test.ts` derives this route's emitted codes
 * from its comment-stripped source and reddens BY NAME when one is missing here.
 *
 * ── THE ENUMERATION PREDICATE ────────────────────────────────────────────────
 * Comment-strip `src/app/api/strategies/csv-finalize/route.ts`, then collect the
 * first string-literal argument of every `csvErrorEnvelope(` / `csvErrorBody(`
 * call plus every `code: "UPPER_SNAKE"` property. That yields SIX:
 * `CSV_FINALIZE_FAIL`, `CSV_INVALID_FORMAT` (×20 sites), `CSV_PERSIST_FAIL`,
 * `CSV_RATE_LIMIT`, `CSV_SESSION_REUSED`, `SEAM_MISCONFIGURED`. The route's one
 * dynamic emitter, `parsedSeries.code`, is not a gap: `parseDailyReturnsSeries`
 * only ever yields `CSV_INVALID_FORMAT`, which is already a member.
 *
 * ── THE TWO NON-MECHANICAL MEMBERSHIP DECISIONS, same as the sibling ─────────
 * `SEAM_MISCONFIGURED` is IN, and the arm tries this set BEFORE the wire table
 * so the route's own corrected sentence wins. `CSV_RATE_LIMIT` is OUT, so it
 * falls to the hop and the `Retry-After` this route stamps reaches the only CSV
 * panel that can render a wait.
 *
 * ⭐ `CSV_PERSIST_FAIL` is the member that matters most. Its route sentence
 * REFUSES to say what is already saved — at HEAD (re-read 2026-08-19; the
 * wording quoted here before 146.2-07 was the pre-145 sentence, re-cut in 146.1
 * and gone from the route) it reads *"We could not confirm what is already
 * saved for this strategy, so we stopped before writing anything of this
 * submission."* Routing that to §4a — whose copy asserts *"Nothing was
 * saved."* — would print, as a reassurance, the one fact the route has just
 * declined to claim. A negative control asserts that phrase is absent from the
 * DOM on this code, so the unreachability is tested, not intended.
 *
 * ⚠️ TYPED `string`, NOT `WizardErrorCode`: five of the six are the ROUTE's
 * vocabulary and are not members of that union.
 */
const KNOWN_CSV_FINALIZE_CODES: ReadonlySet<string> = new Set<string>([
  "CSV_FINALIZE_FAIL",
  "CSV_INVALID_FORMAT",
  "CSV_PERSIST_FAIL",
  "CSV_SESSION_REUSED",
  "SEAM_MISCONFIGURED",
]);

/**
 * 146.2-08 / B1 — the ONE code that gets the remedy control. Both 409 refusal
 * sentences `refuse()` can send (the default track-record one and the
 * classification-conflict one) travel under this code, and both end with an
 * instruction to start a new strategy. A code check rather than a sentence
 * match: the copy is the route's to change, the code is the contract.
 */
const CSV_SESSION_REUSED = "CSV_SESSION_REUSED";

/**
 * ⚠️ THE LABEL IS LOAD-BEARING COPY, NOT A CAPTION, AND IT IS HALF OF A
 * TWO-FILE CONTRACT. `csv-finalize/route.ts` declares a constant of the SAME
 * NAME and quotes it inside its 409 refusal sentences, so a rename on this side
 * turns the server's instruction into a reference to a button that does not
 * exist. The duplication is deliberate — that route handler cannot import from
 * a `"use client"` module — and the shared NAME is what makes it safe: one grep
 * for `START_NEW_STRATEGY_LABEL` finds both sites.
 *
 * Local rather than hoisted into `wizardErrors.ts` for the reason
 * `CSV_SUBMIT_STEP_HEADINGS_CONTRIBUTION` above is local: that table owns the
 * shared error/heading vocabulary, and this is a control label used at exactly
 * one site.
 */
const START_NEW_STRATEGY_LABEL = "Start a new strategy";

/**
 * ⭐ 146.2-08 / B3 — how long the echo's Continue CTA ignores clicks.
 *
 * Continue replaces the submit CTA in the SAME slot the user just clicked. A
 * double-click, or a second Enter on a fast echo, would otherwise land on
 * Continue and navigate before the sentence — whose whole content is "stop and
 * check the numbers" — could be read. Pre-146.2-07 this was harmless because a
 * success auto-navigated anyway; the HOLD is what makes a stray second click
 * destructive.
 *
 * NOT a disabled button (the v1.11 UAT direction bans those): the control is
 * live, focusable and unstyled-as-dead, and it arms itself after this interval
 * with no user action. The interval is a hair above a typical double-click
 * threshold, so it swallows the accidental second click of one gesture and
 * nothing a user does deliberately.
 */
const ECHO_CONTINUE_ARM_MS = 500;

// Format-picker labels are component-local UI taxonomy (read-only summary
// row), not error/heading copy — they stay inline. wizardErrors.ts owns
// user-visible CSV error / heading strings only.
const FMT_LABEL: Record<Fmt, string> = {
  daily_returns: "Daily returns",
  daily_nav: "Daily NAV",
  trades: "Trade list",
};

export function CsvSubmitStep({
  wizardSessionId,
  fmt,
  strategyName,
  preview,
  dailyReturnsSeries,
  metadata,
  entryContext = "manager",
  onSubmitted,
  onSubmitFailed,
  onStartNewStrategy,
  onBack,
}: CsvSubmitStepProps) {
  const [submitting, setSubmitting] = useState(false);
  const [envelope, setEnvelope] = useState<ValidationEnvelope | null>(null);
  /**
   * 140.5-05 — the SHARED envelope, for branches 2 and 3. A second piece of
   * state rather than a widening of `envelope`: only this panel can carry a
   * `Retry-After` (PATTERNS §5). Exactly one of the two is ever non-null, and
   * the two writers below make that structural.
   */
  const [seamEnvelope, setSeamEnvelope] = useState<ErrorEnvelope | null>(null);
  /**
   * Generated once per mount and identical to the `X-Correlation-Id` header
   * `wizardFetch` stamps on every request, so an id always renders even when
   * the wire names none — `—` was half of DEF-140.4-C.
   */
  const [correlationId] = useState<string>(() => getWizardCorrelationId());
  /**
   * 146.2-07 / R6 — THE ECHO NOTICE. A THIRD piece of state, and deliberately
   * not a widening of either envelope above: this is not an error. The submit
   * SUCCEEDED; what the server has to add is that the strategy was already
   * saved by an earlier attempt and that its own comparison was partial.
   * Folding it into `envelope` would render it through `CsvValidationEnvelope`
   * — a `role="alert"` negative-tinted panel — and tell a user whose data is
   * safe that something failed.
   *
   * Non-null ⇒ the step HOLDS: `onSubmitted` (which `WizardClient` hooks to
   * `clearWizardState()` + `router.push('/strategies')`) is deferred to an
   * explicit Continue. Auto-navigating would tear the wizard down mid-sentence,
   * on the one response whose copy asks the user to stop and check.
   */
  const [echoNotice, setEchoNotice] = useState<{
    message: string;
    strategyId: string;
  } | null>(null);
  /**
   * 146.2-08 / B1 — the remedy's own receipt. Without it, taking the escape
   * would look like nothing but the error panel vanishing: no error, no
   * confirmation, and a Submit CTA the user has already watched fail. It says
   * the ONE fact the next click depends on — this is now a new strategy.
   */
  const [sessionRestarted, setSessionRestarted] = useState(false);
  /**
   * 146.2-08 / B3 — the echo's Continue CTA is inert until this arms. See
   * `ECHO_CONTINUE_ARM_MS`.
   *
   * A REF, not state, and not merely to satisfy `react-hooks/set-state-in-effect`:
   * arming changes NOTHING that renders. The control is live, focusable and
   * identically styled throughout (it is not a disabled button), so a state
   * flag would schedule a render that paints the same pixels — and the value is
   * read only inside a click handler, which always sees `.current`.
   */
  const continueArmedRef = useRef(false);
  /**
   * 146.2-08 / B3 — the double-fire latch. `onSubmitted` is hooked to
   * `clearWizardState()` + a `router.push`, and `WizardClient` fires a
   * `wizard_submit_success` on every call, so a second click on the SAME echo
   * double-counts a single submission in the funnel. A ref, not state: the
   * guard must hold within one tick, before any re-render can land.
   */
  const continuedRef = useRef(false);
  /** 146.2-08 / B4 — the focus target of the echo hand-off. */
  const echoPanelRef = useRef<HTMLDivElement | null>(null);

  /**
   * ⭐ 146.2-08 / B4 — THE HAND-OFF, and B3's keyboard half.
   *
   * React reconciles the two CTA branches below to the SAME `<button>` node
   * unless they are keyed apart, so before this the accessible name of the
   * focused control changed under the user from "Submit strategy" to
   * "Continue" — silently, since a name change on a focused element is not an
   * announcement. The keys force a remount, which drops focus to `<body>`; this
   * effect then hands it to the notice, where the sentence is.
   *
   * The `role="status"` region is a belt to this brace and NOT a duplicate:
   * a live region that is MOUNTED already populated is commonly announced as
   * nothing at all, which is why the region below is mounted empty and filled
   * here. Some screen readers will therefore say the sentence twice — once as
   * the insertion, once on focus. That is the deliberate trade: the failure it
   * replaces was silence followed by a navigation.
   */
  useEffect(() => {
    if (echoNotice === null) return;
    continuedRef.current = false;
    continueArmedRef.current = false;
    echoPanelRef.current?.focus();
    const timer = setTimeout(() => {
      continueArmedRef.current = true;
    }, ECHO_CONTINUE_ARM_MS);
    return () => clearTimeout(timer);
  }, [echoNotice]);

  /** The ONE writer for the CSV panel; it clears the shared one. */
  const showCsvEnvelope = useCallback(
    (next: ValidationEnvelope | null) => {
      setEnvelope(next);
      setSeamEnvelope(null);
      // CR-01: a non-null envelope IS a failed submit (every showCsvEnvelope
      // call on this step carries a submit error; `null` is only the
      // clear-before-submit). Signal the parent so the session id is burned.
      if (next !== null) onSubmitFailed?.();
    },
    [onSubmitFailed],
  );

  /** The mirror image. Two accounts of one failure must never co-exist. */
  const showSeamEnvelope = useCallback(
    (next: ErrorEnvelope) => {
      setSeamEnvelope(next);
      setEnvelope(null);
      // CR-01: the seam panel is only ever written on a transport/upstream
      // failure of the submit — always a failed attempt.
      onSubmitFailed?.();
    },
    [onSubmitFailed],
  );

  /**
   * 146.2-08 / B1 — take the escape. The session half is the parent's (it owns
   * `wizard_session_id` and the burn); this half retires the refusal that is no
   * longer true and puts the receipt in its place. Nothing about the upload is
   * touched: the series, the preview and the metadata are props, and the parent
   * leaves them alone, so the next click submits the file already in hand.
   */
  const handleStartNewStrategy = useCallback(() => {
    onStartNewStrategy();
    // `null` is the clear-before-submit shape and does NOT fire onSubmitFailed
    // (only a non-null envelope is a failed attempt), so taking the remedy
    // cannot re-burn the id it was just handed.
    showCsvEnvelope(null);
    setSessionRestarted(true);
  }, [onStartNewStrategy, showCsvEnvelope]);

  const headings =
    entryContext === "contribution"
      ? CSV_SUBMIT_STEP_HEADINGS_CONTRIBUTION
      : CSV_SUBMIT_STEP_HEADINGS;

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    // Clears BOTH panels, so a wait advertised by the previous response cannot
    // survive into this attempt (TRAP-3).
    showCsvEnvelope(null);
    // 146.2-07 — and the echo notice, for the same reason: a sentence about a
    // PREVIOUS response must never stand beside this attempt's outcome.
    setEchoNotice(null);
    // 146.2-08 — and the remedy's receipt: "this will be a new strategy" is a
    // statement about the attempt now in flight, not one to leave standing over
    // whatever that attempt comes back with.
    setSessionRestarted(false);
    setSubmitting(true);

    try {
      const res = await wizardFetch("/api/strategies/csv-finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wizard_session_id: wizardSessionId,
          fmt,
          strategy_name: strategyName, // Cross-AI revision 2026-04-30
          // Phase 110 / CONTRIB-02 — routing hint the csv-finalize RPC branches
          // on: "contribution" finalizes status='private' (owner-only),
          // "manager" finalizes status='pending_review'. HINT only — the RPC
          // terminal-status guard (plan 110-01) is the real enforcement.
          entry_context: entryContext,
          // Phase 19.1 — REQUIRED for fmt=daily_returns/daily_nav. The
          // csv-finalize route rejects with CSV_INVALID_FORMAT if this is
          // absent — see `parseDailyReturnsSeries` in that route. Omitted when
          // the wizard never received the field from csv-validate (legacy
          // pre-19.1 envelopes; fmt=trades). 140.5-05: the bare `file:line`
          // citation that stood here is described in the `dailyReturnsSeries`
          // prop docblock above and was replaced for the reason recorded there.
          ...(dailyReturnsSeries !== undefined
            ? { daily_returns_series: dailyReturnsSeries }
            : {}),
          // QA report 2026-05-21 ISSUE-010 — classification metadata.
          // The route persists these via an authenticated UPDATE on
          // strategies AFTER the SECURITY DEFINER finalize RPC returns
          // the new id; RLS gates the write to the row's owner.
          metadata: {
            description: metadata.description,
            category_id: metadata.categoryId,
            strategy_types: metadata.strategyTypes,
            subtypes: metadata.subtypes,
            markets: metadata.markets,
            supported_exchanges: metadata.supportedExchanges,
            leverage_range: metadata.leverageRange,
            aum: metadata.aum,
            max_capacity: metadata.maxCapacity,
            // #597 part 2 — the deferred upload-picker persistence. The CSV
            // branch captures an asset_class picker value (MetadataStep →
            // MetadataDraft.assetClass) with a FREE choice (no exchange lock),
            // but this body used to drop it, so every CSV strategy landed with
            // asset_class null. Forward it verbatim (snake_case wire key,
            // matching every sibling field); csv-finalize validates the closed
            // set ('crypto' | 'traditional') at the route boundary. Unlike the
            // API-key path there is NO force-derive to 'crypto' — a legitimately
            // traditional CSV track record must keep the user's choice.
            asset_class: metadata.assetClass,
          },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        strategy_id?: unknown;
        status?: unknown;
        code?: string;
        human_message?: string;
        debug_context?: {
          pandera_errors?: { rule: string; row: number; message: string }[];
        };
        correlation_id?: string | null;
        error?: string;
      };

      // NEW-C14-01: 409 with ok:true is an idempotent success — the route
      // found the pre-existing strategy_id for this wizard_session_id.
      // Treat it as a successful finalize so the user lands on /strategies.
      const isIdempotentSuccess = res.status === 409 && data.ok === true;

      if (!res.ok && !isIdempotentSuccess) {
        // ⛔ 140.5-05 / SEAMPROSE-08 — THE THREE-WAY ARM, SECOND APPLICATION.
        //
        // WHAT WAS HERE. `data.code ?? "CSV_SUBMIT_FAILED"` — a TOP-LEVEL read.
        // This route forwards NESTED bodies whose code sits at `detail.code`
        // (the 424 from `process_key.py`, the per-key 429 from `internal.py`),
        // plus `withAuth`'s codeless 401. Every one of them missed the read and
        // rendered *"We could not confirm whether your strategy was saved"* —
        // a sentence about an outcome we never established, for failures where
        // the answer was on the wire the whole time.
        //
        // ORDER IS BINDING AND IS NOT A STYLE CHOICE. Roster first, because
        // `SEAM_MISCONFIGURED` is in BOTH vocabularies and this route's emitter
        // sits below `req.json()`; the generic entry's *"Nothing was
        // submitted"* / *"never left our servers"* would be false here. See
        // `KNOWN_CSV_FINALIZE_CODES` above for both membership decisions.
        if (data.code !== undefined && KNOWN_CSV_FINALIZE_CODES.has(data.code)) {
          // BRANCH 1 — the route's own vocabulary, body forwarded UNCHANGED.
          const errEnvelope: ValidationEnvelope = {
            code: data.code,
            human_message:
              data.human_message ??
              data.error ??
              WIZARD_ERROR_COPY.CSV_SUBMIT_FAILED.title,
            debug_context: data.debug_context ?? {},
            correlation_id: data.correlation_id ?? null,
          };
          showCsvEnvelope(errEnvelope);
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: "csv_submit",
            code: errEnvelope.code,
          });
          // NEW-C14-01: re-enable Submit on errors that are safe to retry.
          // The route is now idempotent for wizard_session_id conflicts
          // (23505 → 409), so retrying after CSV_FINALIZE_FAIL is safe.
          //
          // Phase 145 ship-review fix: CSV_PERSIST_FAIL left this fence. Its
          // pre-fold meaning ("strategy exists but series not saved, contact
          // support") died with persist_csv_daily_returns — the code's SOLE
          // remaining emitter is the fail-closed resolve arm (503), which
          // wrote NOTHING of this submission and whose copy says "Try again
          // shortly." A fence here left that instruction beside a permanently
          // dead button (page-refresh was the only recovery). Retry is safe:
          // a committed prior attempt re-raises 23505 and the resolve arm
          // echoes the existing id.
          // v1.19 review (2026-08-18): the last fenced code,
          // CSV_DUPLICATE_SESSION, was DEAD — it is not in
          // KNOWN_CSV_FINALIZE_CODES (so this branch could never carry it)
          // and no emitter exists anywhere in the repo. Every code this
          // branch CAN carry is safe to retry, so Submit always re-enables.
          setSubmitting(false);
          return;
        }

        // BRANCHES 2 AND 3 — read through the LEAF, which handles the flat AND
        // the nested `service_error` shapes. This is the hop `CsvSubmitStep`
        // never had; its absence is why the §6 hand-off hole reopened here.
        const translated = recogniseSeamErrorCode(seamErrorCode(data));
        const code: WizardErrorCode =
          translated !== "UNKNOWN" ? translated : "CSV_UPSTREAM_FAIL";
        const surfacedId =
          seamCorrelationId(data) ?? data.correlation_id ?? correlationId;
        // Through the ONE parser (`quantalyze/no-raw-retry-after-parse` is a
        // repo-wide lint error), off the SAME response as the code, and
        // `?? undefined` because absence is not zero.
        const advertisedWait = parseRetryAfterSeconds(res.headers);
        showSeamEnvelope(
          buildEnvelope(code, surfacedId, {
            retryAfterSeconds: advertisedWait ?? undefined,
          }),
        );
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "csv_submit",
          code,
        });
        // Nothing on these two branches is a persist failure — the retry fence
        // below is keyed on codes only branch 1 can carry — so Submit
        // re-enables, which is correct for a transport or upstream refusal.
        setSubmitting(false);
        return;
      }

      // FINDING-6: on the 409 idempotent-success path, explicitly log if
      // strategy_id is absent or non-UUID before the generic check below
      // surfaces the error. This distinguishes "admin lookup silently failed
      // and returned a corrupted shape" from "route returned 200 with no id".
      // The /uuid4/ regex matches the standard uuid4 format produced by the DB.
      if (isIdempotentSuccess && (typeof data.strategy_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.strategy_id ?? ""))) {
        console.error("[wizard:CsvSubmitStep] 409 idempotent but strategy_id missing or non-UUID", { strategy_id: data.strategy_id, correlation_id: data.correlation_id });
        // Fall through to the generic defensive check below which surfaces the error to the user.
      }

      // Defensive: route returned 200 but missing strategy_id.
      if (typeof data.strategy_id !== "string" || data.strategy_id.length === 0) {
        const errEnvelope: ValidationEnvelope = {
          code: "CSV_SUBMIT_NO_STRATEGY_ID",
          human_message: WIZARD_ERROR_COPY.CSV_SUBMIT_NO_STRATEGY_ID.title,
          debug_context: {},
          correlation_id: data.correlation_id ?? null,
        };
        showCsvEnvelope(errEnvelope);
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "csv_submit",
          code: errEnvelope.code,
        });
        setSubmitting(false);
        return;
      }

      // Fires on BOTH arms below, at RESPONSE time. Step 3 completed either
      // way — only the navigation defers — so gating this on the notice would
      // silently drop a completion event for every echoed submit.
      trackForQuantsEventClient("wizard_step_complete_3", {
        wizard_session_id: wizardSessionId,
        strategy_id: data.strategy_id,
      });

      // ⭐ 146.2-07 / R6 — THE ECHO DISCRIMINATOR.
      //
      // 146.1 / C1 attached `human_message` to the 23505 resolve echo: the
      // sentence that states WHAT the route compared (the saved track record's
      // row count and its first and last dates) and what it did NOT (the
      // individual daily values), then instructs the user to open the strategy
      // and check. Until now this client read `human_message` on `!res.ok`
      // ONLY, so the sentence was computed, serialised, sent — and rendered
      // nowhere. A mitigation the user cannot read is not a mitigation.
      //
      // THE DISCRIMINATOR IS THE BODY, NOT THE STATUS. Control reaches here
      // only on a success (every error arm returned above), so re-testing
      // `res.ok` would buy nothing and would EXCLUDE the legacy 409-with-
      // ok:true idempotent shape — also a success, and a success that carries
      // a sentence must show it. `ok === true` plus a non-empty
      // `human_message` is exactly the echo: `route.ts` spreads that field in
      // only when `resolveExistingCsvStrategy` supplies it, so a fresh create
      // carries no such key and falls through to the unchanged auto-continue.
      //
      // The sentence renders VERBATIM. The register it is written in
      // (SEAMUX-04: state the fact, keep the uncertainty, do not editorialise)
      // lives server-side; re-voicing it here would fork the copy.
      if (
        data.ok === true &&
        typeof data.human_message === "string" &&
        data.human_message.trim().length > 0
      ) {
        setEchoNotice({
          message: data.human_message,
          strategyId: data.strategy_id,
        });
        // Not a disabled "Submitting…" button: the submit is DONE. The CTA is
        // swapped for Continue below, so no dead control is left on screen
        // (v1.11 UAT direction — no disabled buttons).
        setSubmitting(false);
        return;
      }

      onSubmitted(data.strategy_id);
    } catch (err) {
      // 140.5-05 / TRAP-1, as a PROPERTY: a caught transport error must not be
      // logged in a form that can carry credential material. `scrubSeamError`
      // is the ONE entry point every seam log site uses and is total by
      // construction, which matters inside a catch arm. AN INSTANCE FIX — the
      // log-coverage roster does not cover `.tsx` files, so this site was
      // invisible to it and its siblings still are (named open in the SUMMARY).
      console.error("[wizard:CsvSubmitStep] threw:", scrubSeamError(err));
      // Phase 17 / DESIGN-05: unified with CsvUploadStep variant. UI-SPEC §14.1
      // row 7 declares the canonical text as "click Retry to try again" — both
      // step files now share the same single-source-of-truth title.
      const errEnvelope: ValidationEnvelope = {
        code: "CSV_NETWORK_TIMEOUT",
        human_message: WIZARD_ERROR_COPY.CSV_NETWORK_TIMEOUT.title,
        debug_context: {},
        correlation_id: null,
      };
      showCsvEnvelope(errEnvelope);
      trackForQuantsEventClient("wizard_error", {
        wizard_session_id: wizardSessionId,
        step: "csv_submit",
        code: "CSV_NETWORK_TIMEOUT",
      });
      setSubmitting(false);
    }
  }, [submitting, wizardSessionId, fmt, strategyName, dailyReturnsSeries, metadata, onSubmitted, entryContext, correlationId, showCsvEnvelope, showSeamEnvelope]);

  return (
    <section aria-labelledby="wizard-csv-submit-heading">
      <h2
        id="wizard-csv-submit-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        {headings.title}
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        {headings.subtitle}
      </p>

      {/* Read-only summary — Strategy name is the FIRST row (cross-AI revision 2026-04-30). */}
      <div className="mt-6 rounded-md border border-border bg-white">
        <dl className="divide-y divide-border">
          <SummaryRow label="Strategy name" value={strategyName} />
          <SummaryRow label="Format" value={FMT_LABEL[fmt]} />
          <SummaryRow
            label="Rows detected"
            value={`${preview.row_count} rows`}
          />
          <SummaryRow
            label="Date range"
            value={`${preview.date_range[0]} → ${preview.date_range[1]}`}
          />
          <SummaryRow
            label="Columns detected"
            value={preview.columns_detected.join(", ")}
          />
        </dl>
      </div>

      {envelope && (
        <div className="mt-4">
          <CsvValidationEnvelope
            envelope={{
              code: envelope.code,
              human_message: envelope.human_message,
              debug_context: envelope.debug_context,
              correlation_id: envelope.correlation_id,
            }}
            /* ⭐ 146.2-08 / B1 — the refusal's clickable remedy, INSIDE the
               shell because DESIGN.md's Error Envelope contract puts the CTA
               there ("`Button size='sm'`, BELOW the body and ABOVE the
               `<details>` accordion"); a button floating under a red panel
               reads as unrelated. `variant="secondary"` for the same reason
               the CSV escape-hatch card's CTA is secondary — it must not
               compete with the step's `bg-accent` primary.
               Gated on the code, so it appears on exactly the refusal whose
               own sentence names it and on nothing else. */
            action={
              envelope.code === CSV_SESSION_REUSED ? (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={handleStartNewStrategy}
                  data-testid="wizard-csv-start-new-strategy"
                >
                  {START_NEW_STRATEGY_LABEL}
                </Button>
              ) : undefined
            }
          />
        </div>
      )}

      {/* 140.5-05 — the SHARED envelope, for branches 2 and 3. `onRetry` is
          load-bearing, not decoration: `ErrorEnvelope` gates the advertised
          wait behind `showRetry = recoverable && Boolean(onRetry)`, so without
          it this client could never render the `Retry-After` its route stamps
          (SC-CSV-4's subject). */}
      {seamEnvelope && (
        <div className="mt-4">
          <WizardErrorEnvelope
            envelope={seamEnvelope}
            onRetry={() => setSeamEnvelope(null)}
          />
        </div>
      )}

      {/* ⭐ 146.2-07 / R6 — the echo notice. DESIGN.md contract, stated:
          • NOT the error envelope. `ErrorEnvelope`'s authoring rule ("every
            error path MUST call buildEnvelope") governs ERROR paths; this is a
            200. Its shell is `role="alert"` + `border-negative/30
            bg-negative/5`, and red is reserved for "permanent / negative only"
            — the strategy IS saved, so red would be a false statement.
          • AMBER, per the semantic-color gates as widened 2026-07-02
            ("transient/recoverable states — whether the system or a disclosed
            one-click user action performs the recovery"). The outstanding
            uncertainty here is resolved by exactly such a disclosed user
            action: open the strategy and check the numbers. Muted would say
            "nothing to flag", which is false; red would say "broken", which is
            also false.
          • Shell verbatim from the nearest existing pattern — the two wizard
            warning strips (`WizardIpAllowlistHint`, `WithdrawalWarningStrip`)
            and `/security`'s banner all use `rounded-md border
            border-warning/30 bg-warning/5 px-4 py-3`. No left stripe (the
            colored-left-border card is an AI-Slop Ban row), no icon, no
            client-authored heading.
          • `role="status"` + `aria-live="polite"` — DESIGN-05's a11y minimum
            for a NON-BLOCKING state change (`role="alert"` is reserved for
            blocking errors). ⚠️ 146.2-08 / B4 MOVED those attributes OFF this
            panel and onto the always-mounted wrapper below, and DROPPED the
            "without stealing focus" half: a region mounted already populated
            announces nothing, and leaving focus put left it on a button whose
            accessible name changed under the user. See that block for both.
          • Body in `text-text-primary`, not the strips' `text-text-secondary`:
            this is the response's primary content and the a11y floor should
            not rest on the tinted fill (DESIGN.md measures amber-700 at 4.56:1
            on `bg-warning/5`; near-black clears it with room). */}
      {/* ⭐ 146.2-08 / B4 — THE LIVE REGION IS MOUNTED EMPTY, ALWAYS.
          A `role="status"` element that arrives already populated is commonly
          announced as nothing: assistive tech watches a live region for
          CHANGES, and a region whose first observation is its final content has
          none to report. Mounting the region unconditionally and filling it
          later makes the sentence an insertion, which is the announcement.
          The wrapper carries no classes on purpose — an empty div has no box,
          so this costs nothing visually in the (common) no-notice case.
          Both children below are non-blocking status content and are mutually
          exclusive by construction: the echo is only ever set on a SUCCESS and
          the restart receipt only from a refusal panel, and `handleSubmit`
          clears both before every attempt. */}
      <div
        role="status"
        aria-live="polite"
        data-testid="wizard-csv-status-live"
      >
        {echoNotice && (
          <div
            ref={echoPanelRef}
            tabIndex={-1}
            data-testid="wizard-csv-echo-notice"
            className="mt-4 rounded-md border border-warning/30 bg-warning/5 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <p className="text-body text-text-primary">{echoNotice.message}</p>
            {/* ⭐ 146.2-08 / B2 — THE SENTENCE'S OWN INSTRUCTION NEEDS A
                DESTINATION. The copy above ends "open the strategy to check it
                holds the numbers you meant to upload", and until this there was
                nowhere to open it from: Continue discards the id and lands on
                `/strategies`, where a `pending_review` CSV strategy's numbers
                are not reachable. This mirrors `ViewFullFactsheetLink` in
                `SyncPreviewStep.tsx` — the affordance the API branch already
                ships, pointing at the SAME owner lane (`/factsheet/{id}/v2`
                serves the uploading account its own unpublished draft, so this
                cannot dead-end). New tab, deliberately: the wizard is still
                holding an un-continued response.
                It also repairs this panel's own amber justification — the
                semantic-color gate admits amber for a state recovered by "a
                disclosed one-click user action", and that action was, until
                now, described but not rendered. */}
            <div className="mt-3">
              <Link
                href={`/factsheet/${echoNotice.strategyId}/v2`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="wizard-csv-echo-view-factsheet"
                className="text-small font-medium text-accent underline underline-offset-4 transition-colors duration-150 ease-out hover:text-accent-hover"
              >
                Open the strategy →
                <span className="sr-only"> (opens in new tab)</span>
              </Link>
            </div>
          </div>
        )}

        {/* 146.2-08 / B1 — the remedy's receipt. Deliberately a plain line and
            not a tinted panel: nothing is wrong, nothing is pending, and a
            second bordered box beside the summary card would out-weigh the
            fact it carries. The CTA is named verbatim from `headings` so the
            contribution mount ("Add to my strategies") reads correctly too. */}
        {sessionRestarted && (
          <p
            data-testid="wizard-csv-session-restarted"
            className="mt-4 text-caption text-text-secondary"
          >
            {`This will be a new strategy. Press “${headings.submitCtaLabel}” to upload this file.`}
          </p>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <Button
          variant="secondary"
          type="button"
          onClick={onBack}
          data-testid="wizard-csv-submit-back"
        >
          Back
        </Button>
        {echoNotice ? (
          /* The submit already succeeded, so the submit CTA is RETIRED rather
             than left live beside a sentence saying the strategy is saved —
             two contradictory affordances, and the primary of the pair would
             invite a resubmit that can only echo again. Continue is the single
             forward action and completes the flow the response arrived on.

             ⭐ 146.2-08 / B3 — THE `key` IS THE FIX, NOT HOUSEKEEPING. Same
             component type, same position, same parent: without distinct keys
             React reuses the ONE `<button>` DOM node across the swap, so the
             control under the user's cursor and focus silently becomes a
             different action. Keyed apart, the node is replaced — which also
             drops focus off it, and the echo effect above then hands focus to
             the sentence. */
          <Button
            key="echo-continue"
            type="button"
            onClick={() => {
              // The queued second half of a double-click, or a second Enter on
              // a fast echo. It arrives at a control the user never chose.
              if (!continueArmedRef.current) return;
              // …and one deliberate click must produce exactly one navigation
              // and one `wizard_submit_success`.
              if (continuedRef.current) return;
              continuedRef.current = true;
              onSubmitted(echoNotice.strategyId);
            }}
            data-testid="wizard-csv-echo-continue"
          >
            Continue
          </Button>
        ) : (
          <Button
            key="submit-cta"
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="wizard-csv-submit-cta"
          >
            {submitting
              ? headings.submittingCtaLabel
              : headings.submitCtaLabel}
          </Button>
        )}
      </div>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-4 py-3 md:grid-cols-[180px_1fr] md:gap-6">
      <dt className="text-micro font-medium uppercase tracking-wider text-text-muted">
        {label}
      </dt>
      <dd className="text-caption text-text-secondary">{value}</dd>
    </div>
  );
}
