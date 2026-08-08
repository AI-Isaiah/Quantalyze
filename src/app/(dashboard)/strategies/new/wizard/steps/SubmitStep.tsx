"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  FactsheetPreview,
  type FactsheetPreviewMetric,
} from "@/components/strategy/FactsheetPreview";
import {
  recogniseSeamErrorCode,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { buildEnvelope } from "@/lib/envelope";
// 140.3-15 / TS-20 — the dependency-free leaf, imported directly. It is the ONE
// reader for this envelope's fields; a hand-rolled `data.detail?.correlation_id`
// branch here is the drift class 140.3-01 closed.
import { seamCorrelationId, seamErrorCode } from "@/lib/seam-discriminator";
// 140.5-03 / SEAMPROSE-02 — the ONE `Retry-After` parser (HTTP-date safe, never
// NaN/0/negative). A raw `Number(res.headers.get(...))` is a repo-wide ESLint
// error by design.
import { parseRetryAfterSeconds } from "@/lib/retry/retry-after";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { WarningBanner } from "@/components/ui/WarningBanner";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { SyncPreviewSnapshot } from "./SyncPreviewStep";
import type { MetadataDraft } from "./MetadataStep";
import {
  getWizardCorrelationId,
  wizardFetch,
} from "@/lib/wizard/wizard-correlation";

/**
 * Step 4 of the wizard. Renders a read-only summary of the draft and
 * fires POST /api/strategies/finalize-wizard on confirmation. The
 * server-side RPC `finalize_wizard_strategy` (migration 031) updates
 * the row to status='pending_review' in one transaction and notifies
 * the founder via `after()`.
 *
 * Success redirect is handled by WizardClient's `handleSubmitSuccess`.
 */

/**
 * 151 review E8 — the dropped-mark notice copy. Module constants, not inline
 * JSX, so the component and its spec cannot drift and so the apostrophes stay
 * literal (the 150-UI-SPEC copywriting convention this wizard already follows).
 *
 * The first line leads with SAVED, deliberately: the finalize succeeded and the
 * strategy exists. Reading this as a failure would be its own defect — the user
 * would go looking for work that is not lost. The second line names the ONE
 * thing that did not land and the screen where they can set it, plus the
 * consequence of leaving it unset, because "your mark was dropped" without
 * "so Allocate will not appear" is a fact with no meaning attached.
 */
const MARK_DROPPED_TITLE = "Saved. The own-capital mark didn't stick.";
const MARK_DROPPED_BODY =
  "Everything else was saved. Mark this strategy as your own capital in My Strategies — until you do, the Allocate action won't appear for it.";
const MARK_DROPPED_CONTINUE = "Continue";

export interface SubmitStepProps {
  strategyId: string;
  wizardSessionId: string;
  snapshot: SyncPreviewSnapshot;
  metadata: MetadataDraft;
  /**
   * Phase 110 / CONTRIB-01..02 — mount surface. `"manager"` (default) keeps
   * the sell-side "Submit for review" flow and finalize `entry_context:
   * "manager"` (→ status `pending_review`). `"contribution"` shows the
   * allocator-framed private-add copy and sends `entry_context: "contribution"`
   * (→ status `private`, owner-only, never published — plan 110-04 server side).
   */
  entryContext?: "manager" | "contribution";
  onSubmitted: (strategyId: string) => void;
  onBack: () => void;
}

export function SubmitStep({
  strategyId,
  wizardSessionId,
  snapshot,
  metadata,
  entryContext = "manager",
  onSubmitted,
  onBack,
}: SubmitStepProps) {
  const isContribution = entryContext === "contribution";
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<WizardErrorCode | null>(null);
  // UX-02: the wizard session correlation id — the SAME id wizardFetch sends on
  // the finalize-wizard request, so a copied envelope id matches server logs.
  const [correlationId] = useState<string>(() => getWizardCorrelationId());
  /**
   * 140.3-15 / TS-20 — the UPSTREAM correlation id, when the failure carried
   * one. `finalize-wizard` forwards the seam envelope verbatim, so the id the
   * ANALYTICS SERVICE logged arrives here; `correlationId` above is minted in
   * the browser and memoized per PAGE LOAD, so on a seam failure it is the
   * weaker of the two for support to search on.
   *
   * PER-FAILURE state, reset on every submit alongside `errorCode`, so a second
   * attempt can never render the first attempt's id.
   */
  const [upstreamCorrelationId, setUpstreamCorrelationId] = useState<
    string | null
  >(null);
  /**
   * 140.5-03 / SEAMPROSE-02 — the wait the failing response ADVERTISED, in
   * seconds, or `null` when it advertised none.
   *
   * `finalize-wizard` stamps `Retry-After` on three arms of its own, and since
   * the choke-point relay it also forwards the ANALYTICS SERVICE's 429 wait
   * through `postProcessKey`. Before this the header arrived at the browser and
   * was discarded.
   *
   * PER-FAILURE state, cleared on every fresh attempt beside `errorCode` and
   * the upstream id (TRAP-3): rendering attempt 1's wait against attempt 2's
   * failure names a duration nobody advertised.
   */
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(
    null,
  );
  /**
   * 151 review E8 — THE FINALIZE SUCCEEDED AND THE CAPITAL MARK DID NOT LAND.
   *
   * `finalize-wizard` has emitted `capital_ownership_persisted: false` since
   * 151 specialist F-3, and its docblock calls the field "the honest minimum" so
   * a user whose mark was dropped is not shown plain success. NO client read it:
   * the response was typed as five fields, this key appeared nowhere in `src/`,
   * and the user got an unqualified success screen while their answer was lost —
   * with no way to know why `Allocate…` never appears against the strategy (an
   * unmarked strategy is non-allocatable, and the D-03-A trigger enforces it).
   *
   * Holding the id here rather than calling `onSubmitted` straight away is what
   * makes the notice reachable at all: `onSubmitted` navigates (WizardClient's
   * `handleSubmitSuccess` pushes /strategies, or the contribution overlay closes
   * on `onSuccess`), so anything rendered beside it is unmounted before it can
   * be read. The user leaves on their own click instead.
   *
   * NON-BLOCKING by construction: this is not an error envelope, no retry is
   * offered, and `Continue` completes the submit exactly as the silent path did.
   * The finalize genuinely succeeded; only the ONE metadata field was dropped.
   */
  const [markDroppedStrategyId, setMarkDroppedStrategyId] = useState<
    string | null
  >(null);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setErrorCode(null);
    // 140.3-15 / TS-20 — cleared with the code it belongs to. Leaving it would
    // let a retry render the PREVIOUS failure's id, which is worse than
    // rendering none: it points support at the wrong request.
    setUpstreamCorrelationId(null);
    // 140.5-03 — same reasoning, same reset point: the wait belongs to the
    // failure, so it dies with it.
    setRetryAfterSeconds(null);
    setSubmitting(true);

    try {
      const res = await wizardFetch("/api/strategies/finalize-wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_id: strategyId,
          name: metadata.name,
          description: metadata.description,
          category_id: metadata.categoryId,
          strategy_types: metadata.strategyTypes,
          subtypes: metadata.subtypes,
          markets: metadata.markets,
          supported_exchanges: metadata.supportedExchanges,
          leverage_range: metadata.leverageRange || null,
          aum: metadata.aum ? Number(metadata.aum) : null,
          max_capacity: metadata.maxCapacity ? Number(metadata.maxCapacity) : null,
          // #597 — asset class drives Sharpe/Sortino/vol annualization basis.
          asset_class: metadata.assetClass,
          // Phase 110 / CONTRIB-02 — routing hint the finalize RPC branches on:
          // "contribution" finalizes status='private' (owner-only), "manager"
          // finalizes status='pending_review'. This is a HINT only — neither
          // value can publish; the RPC terminal-status guard (plan 110-01
          // T-110-02) is the real enforcement (client field can't be trusted).
          entry_context: entryContext,
          // Phase 150 / OWN-03 — the capital mark rides the SAME body as
          // entry_context. Spread-in only when the metadata step actually
          // asked the question, so a path that never asked sends an ABSENT
          // field rather than `null`: the route writes nothing, the column
          // stays NULL, and an unmarked strategy is non-allocatable. Never
          // assert a mark on the user's behalf.
          ...(metadata.capitalOwnership
            ? { capital_ownership: metadata.capitalOwnership }
            : {}),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        strategy_id?: string;
        status?: string;
        error?: string;
        code?: string;
        idempotent?: boolean;
        /**
         * 151 review E8 — present ONLY when the caller asked for a capital mark
         * and it did not save (`finalize-wizard/route.ts`, the `...(persisted ?
         * {} : {...})` spread). ABSENT means nothing was lost, so the read below
         * is an explicit `=== false` and never a truthiness test: `undefined`
         * must not be read as "dropped".
         */
        capital_ownership_persisted?: boolean;
      };

      if (!res.ok) {
        // The notify-submission email is fire-and-forget — if we get a
        // 2xx but that callback failed, the strategy is still saved.
        // Here we only surface actual finalize failures.
        //
        // The server tags actionable failures with a stable WizardErrorCode
        // (e.g. KEY_SCOPE_BROADENED when the live exchange-key scope
        // re-check at finalize finds the key broadened to trade/withdraw
        // since Connect, or KEY_NETWORK_TIMEOUT when that probe itself
        // fails). Trust the code only if it's a known wizard code so a
        // garbled response can't poison the envelope copy.
        // H-0192: the finalize route tags each actionable failure with its
        // own WizardErrorCode — the 404 "Draft not found" -> GATE_DRAFT_GONE,
        // the 403 RLS/ownership denial -> GUARD_BLOCKED, and the live
        // key-scope / network-probe paths -> KEY_SCOPE_BROADENED /
        // KEY_NETWORK_TIMEOUT. Map off that code only, NOT raw HTTP status:
        // status-based mapping mislabeled pre-handler 403s (CSRF, approval-gate)
        // as draft-finalize failures and conflated them in the wizard_error
        // funnel. Anything without a known code (a 409 stale-state, a 500, a
        // pre-handler error) -> UNKNOWN, whose copy is recoverable so the retry
        // affordance the old mapping provided is preserved.
        const KNOWN_FINALIZE_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(
          [
            "KEY_SCOPE_BROADENED",
            "KEY_NETWORK_TIMEOUT",
            // MT5-13 — the permanent half of the probe-failed split, admitted
            // HERE IN THE SAME COMMIT the route started emitting it. Omit this
            // line and the new code fails the membership check below, falls
            // through to UNKNOWN — whose copy IS recoverable — and the fix ships
            // invisible: the user gets a Retry button again, which is the exact
            // defect being removed. (Same trap COMPOSITE_TOO_MANY_MEMBERS
            // records above.) Like that one, its copy is deliberately
            // NON-recoverable and renders no Retry control.
            "KEY_SCOPE_CHECK_UNAVAILABLE",
            "GATE_DRAFT_GONE",
            "GUARD_BLOCKED",
            // Phase 88 / W-4 — composite membership probe fail-closed (503).
            // Recoverable copy renders the Retry affordance rather than
            // degrading to the generic UNKNOWN envelope.
            "COMPOSITE_MEMBERSHIP_UNKNOWN",
            // Phase 140.3-14 / TS-37 — the composite MEMBER CAP, split off the
            // code above. It arrives on the SAME 503 from the SAME route, and
            // it is admitted HERE IN THE SAME COMMIT that the route started
            // emitting it. Without this line the new code fails the membership
            // check below, falls through to UNKNOWN, and the user sees the
            // generic dead end instead of the limit and the remedy — the whole
            // obligation ships invisible while every route-side test is green.
            //
            // ⚠️ Its copy is deliberately NON-recoverable, so unlike every other
            // member of this set it renders NO Retry control. That is correct:
            // the draft really does hold more keys than the route can re-probe,
            // and retrying cannot change the count.
            "COMPOSITE_TOO_MANY_MEMBERS",
            // Phase 140.3-05 / SEAMUX-01 + SEAMUX-08 — the two members the
            // seam's own outage codes translate onto. Before this, a breaker
            // trip mid-outage rendered "Our team has been notified" AND
            // reported `wizard_error {code:"UNKNOWN"}`, so the funnel could not
            // tell an infra outage from a bad draft. Neither of these is
            // reachable from a raw `data.code` — see the translation below.
            "SERVICE_UNAVAILABLE_RETRY",
            "SERVICE_UNREACHABLE",
            // Phase 140.3-15 / TS-38 — a CONFIGURATION fault on our side, which
            // `process-key-client` now answers with its own code (500) instead
            // of the dead-upstream 502. Admitted HERE IN THE SAME COMMIT that
            // the client starts emitting it: without this line the code fails
            // the membership check below, falls to UNKNOWN, and the user sees
            // the generic dead end while every client-side test stays green.
            // That is `140.3-14`'s M81, one plan ago, on a different code.
            //
            // ⚠️ Like COMPOSITE_TOO_MANY_MEMBERS above, its copy is deliberately
            // NON-recoverable, so it renders no Retry control. Correct: the
            // setting stays wrong until we fix it and redeploy.
            "SEAM_MISCONFIGURED",
          ],
        );
        // 140.4-12 / SEAMRIM-08 — EACH LIST OWNS ITS OWN VOCABULARY, AND
        // NEITHER OVERRULES THE OTHER.
        //
        //   `SEAM_CODE_TO_WIZARD_CODE` (`recogniseSeamErrorCode`) owns the WIRE
        //   vocabulary — the codes the seam and the analytics service put on
        //   the wire. It is the ONE wire→wizard table and it is authoritative:
        //   a code it translates is surfaced as translated.
        //
        //   `KNOWN_FINALIZE_CODES` above owns the ROUTE-MINTED WIZARD
        //   vocabulary — codes `finalize-wizard` mints that are already
        //   `WizardErrorCode` members (`KEY_SCOPE_BROADENED`,
        //   `GATE_DRAFT_GONE`, `GUARD_BLOCKED`, …) and therefore never appear
        //   in a wire→wizard table at all.
        //
        // WHAT THIS REPLACED, AND WHY IT IS NOT A ROSTER EDIT. 140.3-05 ran the
        // translation and then made the RESULT re-qualify through
        // `KNOWN_FINALIZE_CODES`. Both are typed `WizardErrorCode`, so the
        // second gate added NO type safety — it added only an obligation to
        // edit two lists in one commit. That obligation is written down twice
        // in the set above and was skipped anyway: 140.3-01 added
        // `VALIDATION_FAILED` and `RATE_LIMITED` to the translation table, the
        // second list never learned about them, and BOTH collapsed to UNKNOWN.
        // The honest rate-limit copy — the cap is ours, not the user's exchange
        // — existed and was unreachable for three commits. Widening the roster
        // fixes those two codes and leaves the next author the same trap; this
        // deletes the roster's jurisdiction over wire codes instead, so there
        // is no second list to forget.
        //
        // THE MEMBERSHIP CHECK IS NOT WEAKENED, and this is the part to verify
        // before "simplifying" it: an unrecognised wire code still resolves to
        // UNKNOWN by BOTH paths — the table answers "UNKNOWN" for anything it
        // does not list, and the raw code then still has to be a known finalize
        // code. No identity rule is created, so `SEAM_DEGRADED` and the venue
        // codes cannot be cast into this vocabulary (that is the reason the
        // table in `wizardErrors.ts` is explicit at all).
        //
        // THE CODE IS READ THROUGH THE LEAF, not off the top level. Every
        // `service_error()` answer nests it at `body.detail.code`;
        // `seamErrorCode` handles BOTH shapes and is the same leaf
        // `seamCorrelationId` below already comes from, so the id and the code
        // are read from the same body by the same reader.
        const wireCode = seamErrorCode(data);
        const translated = recogniseSeamErrorCode(wireCode);
        const surfaced: WizardErrorCode =
          translated !== "UNKNOWN"
            ? translated
            : wireCode && KNOWN_FINALIZE_CODES.has(wireCode as WizardErrorCode)
              ? (wireCode as WizardErrorCode)
              : "UNKNOWN";
        setErrorCode(surfaced);
        // 140.3-15 / TS-20 — read through the leaf, which handles BOTH wire
        // shapes (top-level on the flat envelopes, nested inside
        // `service_error`) and refuses a value that is not correlation-id
        // shaped. Set beside the code, from the SAME body, so the two can never
        // describe different failures.
        setUpstreamCorrelationId(seamCorrelationId(data));
        // 140.5-03 / SEAMPROSE-02 — the wait rides the HEADER, read through the
        // ONE parser, from the SAME response as the code and the id above. The
        // body also carries `retry_after_seconds` on a relayed Python 429 —
        // deliberately NOT read: two extraction paths for one fact is the
        // cascade shape this milestone removes. Absent header ⇒ `null` ⇒ the
        // envelope names no duration rather than inventing one (TRAP-3).
        setRetryAfterSeconds(parseRetryAfterSeconds(res.headers));
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "submit",
          code: surfaced,
        });
        setSubmitting(false);
        return;
      }

      // CT-5 (army2) — even on a 200 OK, the upstream may emit
      // `code: 'WIZARD_DUPLICATE'` + `idempotent: true` to signal that
      // the strategy_verifications row pre-existed (BACKBONE-08
      // wizard_session_id idempotency). Surface the WIZARD_DUPLICATE
      // copy from wizardErrors.ts so the user sees the resume
      // affordance instead of a silent re-submit.
      if (data.code === "WIZARD_DUPLICATE") {
        setErrorCode("WIZARD_DUPLICATE");
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "submit",
          code: "WIZARD_DUPLICATE",
        });
        setSubmitting(false);
        return;
      }

      // 151 review E8 — the finalize SUCCEEDED; only the capital mark was
      // dropped. Hold the completion so the notice can be read, then hand over
      // on the user's own click (see the state's docblock for why an immediate
      // `onSubmitted` would unmount the notice before anyone saw it).
      if (data.capital_ownership_persisted === false) {
        setMarkDroppedStrategyId(data.strategy_id ?? strategyId);
        setSubmitting(false);
        return;
      }

      onSubmitted(data.strategy_id ?? strategyId);
    } catch (err) {
      // TRAP-1, restated as a PROPERTY and re-checked at this edit: a caught
      // transport error must not be logged in a form that can carry credential
      // material. `wizardFetch` sets exactly one header (`X-Correlation-Id`)
      // and this route authenticates by COOKIE, so there is no credential value
      // on the request for a rejection to embed, and this step never holds key
      // plaintext at all. Nothing to scrub — a measurement, not an assumption,
      // and the thing to re-check if this call ever gains an auth header.
      console.error("[wizard:SubmitStep] threw:", err);
      // 140.5-03 / SEAMPROSE-03 — OUR HOP, NOT THE EXCHANGE'S. The request to
      // `/api/strategies/finalize-wizard` never completed; the exchange may
      // never have been contacted. `KEY_NETWORK_TIMEOUT`'s copy ("We could not
      // reach the exchange") asserted a venue fault for a fault on our own hop
      // — the rule `wizardErrors.ts` states by name beside that entry.
      // `SERVICE_UNREACHABLE` is already a member of `KNOWN_FINALIZE_CODES`
      // above, admitted in 140.3-05 for the wire codes that translate onto it;
      // this is the same state arriving by the other door.
      setErrorCode("SERVICE_UNREACHABLE");
      setSubmitting(false);
    }
  }, [submitting, strategyId, metadata, onSubmitted, wizardSessionId, entryContext]);

  // 140.3-15 / TS-20 — ONE id field, the one `ErrorEnvelope` already renders and
  // `buildDiagBlock` already copies into the QUANTALYZE_DIAG payload. The
  // upstream id WINS when the wire carried a usable one, and today's browser-
  // minted id remains the fallback, so nothing that previously rendered an id
  // stops doing so. No second field was added: the render slot expects exactly
  // one value, and two ids in a diagnostics block is a support ticket asking
  // which one to search.
  const errorEnvelope = errorCode
    ? buildEnvelope(errorCode, upstreamCorrelationId ?? correlationId, {
        // 140.3-10's rule, inherited: `?? undefined` because ABSENCE IS NOT
        // ZERO. `null` would reach the envelope slot, and a `0` there is a wait
        // we were never told about.
        retryAfterSeconds: retryAfterSeconds ?? undefined,
      })
    : null;

  const summaryMetrics: FactsheetPreviewMetric[] = snapshot.metrics;

  return (
    <section aria-labelledby="wizard-submit-heading">
      <h2
        id="wizard-submit-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        {isContribution ? "Review and add" : "Review and submit"}
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        {isContribution
          ? "This strategy is added privately to your account. Only you can see it — it is never published or submitted for review."
          : "The founder reviews pending strategies within 48 hours. You will receive an email when your listing is approved."}
      </p>

      {/* Factsheet summary in DRAFT variant — never "Verified" pre-review */}
      <div className="mt-6">
        <FactsheetPreview
          strategyName={metadata.name ?? "Draft strategy"}
          subtitle={
            snapshot.detectedMarkets.length > 0
              ? `${metadata.strategyTypes.join(" · ")} · ${snapshot.detectedMarkets.join(", ")}`
              : metadata.strategyTypes.join(" · ")
          }
          metrics={summaryMetrics}
          sparklineReturns={snapshot.sparkline}
          computedAt={snapshot.computedAt}
          verificationState="draft"
        />
      </div>

      {/* Read-only metadata summary card */}
      <div className="mt-6 rounded-md border border-border bg-white">
        <dl className="divide-y divide-border">
          <SummaryRow label="Codename" value={metadata.name ?? "—"} />
          <SummaryRow
            label="Description"
            value={metadata.description || "—"}
          />
          <SummaryRow
            label="Strategy types"
            value={metadata.strategyTypes.join(", ") || "—"}
          />
          <SummaryRow
            label="Markets"
            value={metadata.markets.join(", ") || "—"}
          />
          <SummaryRow
            label="Supported exchanges"
            value={metadata.supportedExchanges.join(", ") || "—"}
          />
          <SummaryRow
            label="Leverage"
            value={metadata.leverageRange || "—"}
          />
          <SummaryRow
            label="AUM (USD)"
            value={metadata.aum ? `$${Number(metadata.aum).toLocaleString()}` : "—"}
          />
          <SummaryRow
            label="Max capacity (USD)"
            value={
              metadata.maxCapacity
                ? `$${Number(metadata.maxCapacity).toLocaleString()}`
                : "—"
            }
          />
        </dl>
      </div>

      {errorEnvelope && (
        <div className="mt-4">
          <WizardErrorEnvelope
            envelope={errorEnvelope}
            onRetry={() => setErrorCode(null)}
          />
        </div>
      )}

      {markDroppedStrategyId !== null ? (
        // 151 review E8 — NOT an error envelope, on purpose: there is nothing to
        // retry and nothing was rolled back. `role="status"` (polite) rather
        // than `role="alert"` for the same reason — this is an outcome the user
        // should hear about, not an interruption.
        <div
          role="status"
          data-testid="capital-mark-dropped-notice"
          className="mt-6"
        >
          <WarningBanner>
            <p className="font-medium text-text-primary">
              {MARK_DROPPED_TITLE}
            </p>
            <p className="mt-1">{MARK_DROPPED_BODY}</p>
          </WarningBanner>
          <div className="mt-6 flex gap-3">
            <Button
              type="button"
              onClick={() => onSubmitted(markDroppedStrategyId)}
              data-testid="wizard-submit-continue"
            >
              {MARK_DROPPED_CONTINUE}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" type="button" onClick={onBack}>
            Back
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            data-testid="wizard-submit-for-review"
          >
            {submitting
              ? "Submitting..."
              : isContribution
                ? "Add to my strategies"
                : "Submit for review"}
          </Button>
        </div>
      )}
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
