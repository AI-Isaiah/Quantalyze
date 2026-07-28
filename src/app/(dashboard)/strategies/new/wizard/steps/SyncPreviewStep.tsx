"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useStrategySyncPoller } from "@/hooks/useStrategySyncPoller";
import { Button } from "@/components/ui/Button";
import {
  FactsheetPreview,
  type FactsheetPreviewMetric,
} from "@/components/strategy/FactsheetPreview";
import { KeyPermissionBadge } from "@/components/connect/KeyPermissionBadge";
import {
  checkStrategyGate,
  isLedgerBackedExchange,
  type StrategyGateResult,
} from "@/lib/strategyGate";
import {
  formatKeyError,
  gateFailureToWizardError,
  recogniseSeamErrorCode,
  type WizardErrorAction,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { buildEnvelope } from "@/lib/envelope";
// 140.3-15 / TS-20 — the dependency-free leaf, imported directly. It is the ONE
// reader for this envelope's fields; a hand-rolled `failure.detail?.correlation_id`
// branch here is the drift class 140.3-01 closed.
import { seamCorrelationId, seamErrorCode } from "@/lib/seam-discriminator";
import { parseRetryAfterSeconds } from "@/lib/retry/retry-after";
import { isComputedAnalytics } from "@/lib/closed-sets";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import { cn } from "@/lib/utils";
import {
  CoverageTimeline,
  type CoverageTimelineRow,
} from "@/app/(dashboard)/allocations/components/CoverageTimeline";
import { unionOf, type CoverageSpan } from "@/lib/scenario-window";
import {
  getWizardCorrelationId,
  wizardFetch,
} from "@/lib/wizard/wizard-correlation";
import {
  partitionAttribution,
  attributionBasisFromConfig,
} from "@/lib/composite/compositeAttribution";
import { hasBasisHeadline } from "@/lib/factsheet/basis-metrics";
import { TrustTierLabel } from "@/components/strategy/TrustTierLabel";
import { parseIsoDay, utcEpoch } from "@/lib/dateday";
import type {
  SyncProgressResponse,
  MemberProgressStatus,
} from "@/lib/sync-progress";

/**
 * SyncPreviewStep kicks off /api/keys/sync, polls strategy_analytics
 * for completion, runs `checkStrategyGate`, and renders a draft-variant
 * FactsheetPreview on success or the scripted wizardErrors copy on
 * failure. Only reads strategy_analytics — writes happen server-side.
 */

/**
 * How recent does a `complete` strategy_analytics row need to be for
 * the wizard to skip the /api/keys/sync kickoff on resume? The
 * analytics-service worker is already incremental (it uses
 * `api_keys.last_fetched_trade_timestamp` as the `since_ms` cursor —
 * see analytics-service/services/job_worker.py:_dispatch_sync_trades),
 * so a re-sync only fetches the delta. But the round-trip still costs
 * 30-60s of "Fetching trades..." UI latency for the user. Skipping the
 * kickoff when the row is fresh gets them straight to the factsheet.
 *
 * 5 minutes balances "don't show stale numbers on a long session
 * resume" against "don't re-fire a sync on every viewport remount."
 * QA report 2026-05-21 ISSUE-005.
 */
const SYNC_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/**
 * Pure helper: derive the detected-markets set from a sample of trade
 * symbols. The Bybit + OKX ingest writes daily portfolio-level
 * aggregates under the synthetic symbol "PORTFOLIO"
 * (see analytics-service/services/exchange.py); those rows must NOT
 * surface as a "market" in the factsheet preview hint or the metadata
 * step. Pulled out of the polling callback so a regression test can pin
 * the filter without mocking the entire Supabase client.
 */
export function deriveDetectedMarkets(
  symbols: ReadonlyArray<string | null | undefined>,
  limit = 6,
): string[] {
  const set = new Set<string>();
  for (const raw of symbols) {
    const symbol = raw ?? "";
    if (symbol === "PORTFOLIO") continue;
    const base = symbol.split(/[-/]/)[0]?.toUpperCase();
    if (base) set.add(base);
  }
  return Array.from(set).slice(0, limit);
}

const SLOW_HINT_MS = 15_000;
const WARN_THRESHOLD_MS = 60_000;
// A composite stitch over multi-year, multi-key history is a data-heavy job that
// can legitimately run up to ~15 minutes (the WARN copy promises this). The
// "taking much longer than expected" retry affordance must therefore only appear
// AFTER that ceiling — firing it at 3 min would contradict the WARN message and
// alarm the user mid-normal-run. The poll loop itself has no time-based abort
// (it stops only on success / terminal failure / 3 consecutive network errors),
// so raising this shifts copy only, never the polling.
const RETRY_THRESHOLD_MS = 900_000;

/**
 * Status-poll backoff schedule. Each entry is the delay BEFORE the next
 * poll; the loop walks the ladder and then holds at the final step.
 * Capping at 10s keeps DB load and background-tab timer churn down on
 * slow first-of-day syncs (~45s) and the ~15-minute worst case, while the
 * first few ticks stay snappy so a fast sync still feels instant. The
 * elapsed-time UI thresholds are wall-clock, not poll-count, so backing
 * off the poll cadence does not shift the SLOW/WARN/RETRY copy.
 */
const POLL_BACKOFF_MS = [3000, 3000, 5000, 5000, 10_000] as const;

/**
 * Phase 140.3-10 / SEAMUX-03 — the kickoff codes this step RECOGNISES.
 *
 * `/api/keys/sync` now carries a machine code on every arm. Before this, every
 * non-2xx — a throttle, an absent draft, a malformed request, an unknowable
 * composite membership — collapsed onto `SYNC_FAILED`, whose sentence claims
 * *"We fetched your trades but the analytics computation did not complete"*.
 * For a 429 that is simply false: nothing was fetched and nothing ran.
 *
 * Hand-typed, and deliberately PARTIAL. `SYNC_FAILED` stays the fallback for
 * anything uncoded or unrecognised — the same reasoning that keeps the
 * substring cascade alive underneath `classifyKeyValidationError`'s `body.code`
 * read. A map that pretended to be total would turn an unfamiliar code into a
 * silent `undefined` error state.
 *
 * ⚠️ The two 400 arms (`MISSING_STRATEGY_ID`, `INVALID_STRATEGY_ID`) are
 * ABSENT ON PURPOSE, and their absence is a decision rather than an oversight.
 * Both fetch sites in this file post `{ strategy_id: strategyId }` where
 * `strategyId` is a required uuid prop, so neither arm is reachable from here
 * except through a bug in our own code. Giving them a wizard error state would
 * mean authoring a user-facing sentence for "our page sent a malformed
 * request" — copy this plan does not own (140.3-12 does) — and wiring a branch
 * no user can reach. They carry codes on the wire, which is what SEAMUX-03
 * asks for: a machine can discriminate them in a log or a funnel without
 * matching on prose.
 */
const KNOWN_KICKOFF_CODES: Readonly<Record<string, WizardErrorCode>> = {
  RATE_LIMITED: "RATE_LIMITED",
  GATE_DRAFT_GONE: "GATE_DRAFT_GONE",
  COMPOSITE_MEMBERSHIP_UNKNOWN: "COMPOSITE_MEMBERSHIP_UNKNOWN",
  // 140.3-12 — the two 400 arms 140.3-10 gave wire codes but deliberately left
  // without wizard copy, closing the residual it recorded for this plan.
  //
  // 140.3-10's reason for holding off was correct AT THE TIME: the nearest
  // member, `VALIDATION_FAILED`, asserted "The analytics service rejected the
  // shape of the request", which is FALSE for a rejection this app's own route
  // makes before the analytics service is ever called. Routing them there would
  // have turned a vague error into a specific lie — TRAP-3, authored to satisfy
  // an acceptance criterion. 140.3-12 owns that sentence and removed the
  // producer attribution from it, so the member now states only the fact both
  // producers share: a request was refused on its shape before any work ran.
  //
  // No new union member was minted for this. A second code meaning the same
  // thing is how a vocabulary starts lying (140.3-05's CIRCUIT_OPEN reasoning),
  // and the copy table's hand-typed size guard — `EXPECTED_TABLE_SIZE` in
  // `src/lib/wizardErrors.test.ts` — is therefore not touched by this. That
  // guard's literal is hand-typed ON PURPOSE (deriving it would re-create the
  // self-referential `expect(found.length).toBe(discovered.length)` shape both
  // seam pins forbid by name), so the pointer is the durable statement and the
  // number is not restated here (140.3-G2 / GC-4: this comment previously
  // recited a size it did not own, and the size had moved).
  MISSING_STRATEGY_ID: "VALIDATION_FAILED",
  INVALID_STRATEGY_ID: "VALIDATION_FAILED",
};

/**
 * How many CONSECUTIVE poll failures (Supabase `error`, a thrown
 * exception, or a network blip) before we stop spinning and surface a
 * recoverable SYNC_FAILED envelope. Without this the wizard hangs on
 * "Fetching trades..." forever when the read keeps failing (e.g. an RLS
 * regression denies the row, or a transient 503). One transient blip is
 * tolerated; three in a row is a real fault the user needs an exit from.
 */
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

/**
 * A single composite member key, ordered by `seq`. Sourced from
 * `strategy_keys` (owner-RLS) with the `api_keys(exchange, label)` embed
 * (null-safe — the embed can be absent if the join is unavailable).
 */
export interface CompositeMemberKeyRow {
  apiKeyId: string;
  windowStart: string;
  windowEnd: string | null;
  seq: number;
  exchange: string | null;
  label: string | null;
}

/**
 * Additive composite preview payload. Populated ONLY on the composite branch
 * (membership probe count > 0). The stitched result already lives in one
 * `strategy_analytics` row + `csv_daily_returns` — this is a READ, never a
 * re-stitch. Plan 89-04 layers the attribution table / gantt / warnings on top
 * of these fields; `rawDenominatorConfig` is mapped to the attribution basis
 * there (via `attributionBasisFromConfig`).
 */
export interface CompositePreviewData {
  members: CompositeMemberKeyRow[];
  perKey: {
    seq: number;
    first_day: string | null;
    last_day: string | null;
    n_days: number;
  }[];
  gapSpans: { start: string; end: string }[]; // inclusive both ends — render verbatim
  gapDayCount: number;
  mtmGatedReason: string | null;
  /**
   * Phase 133 review IN-03: whether the persisted `metrics_json_by_basis.smoothed_mtm`
   * object carries a trustworthy headline (the SAME `hasBasisHeadline` gate the
   * factsheet surfaces trust). Server truth only — never derived from the gated
   * reason. Lets the MTM caveat note that the smoothed basis opens what MTM keeps
   * closed on an options book, without inventing availability.
   */
  smoothedMtmAvailable: boolean;
  benchmarkUnavailable: boolean;
  benchmarkNote: string | null;
  // HARD-04 (#67): server-truth sub-90-day annualization-window flag
  // (data_quality_flags.insufficient_window).
  insufficientWindow: boolean;
  // HARD-05 (Phase 93): composite members EXCLUDED from the stitch (a ccxt venue
  // not yet reconstructed) — a closed { seq, venue } shape (the server `reason`
  // enum is server-only vocabulary, dropped on parse). Empty => nothing renders.
  degradedMembers: { seq: number; venue: string }[];
  series: { date: string; daily_return: number }[]; // full stitched series
  rawDenominatorConfig: unknown;
  /**
   * Server-computed composite cumulative return (raw, from
   * `strategy_analytics.cumulative_return`). Used by the reconciliation caption
   * to epsilon-verify that the per-key attribution reconstitutes it — a count
   * match (`Σ member days == series.length`) is not a value identity (R2-4).
   */
  cumulativeReturn: number | null;
}

export interface SyncPreviewSnapshot {
  tradeCount: number;
  /**
   * `csv_daily_returns` row count. Non-zero for ledger-backed exchanges
   * (Deribit) and CSV uploads, whose returns never populate `trades` (P72).
   */
  csvRowCount: number;
  earliestTradeAt: string | null;
  latestTradeAt: string | null;
  detectedMarkets: string[];
  exchange: string | null;
  metrics: FactsheetPreviewMetric[];
  sparkline: number[] | null;
  computedAt: string | null;
  /**
   * Additive composite payload — present only on the composite branch. The
   * single-key snapshot shape and the MetadataStep/SubmitStep consumers of
   * detectedMarkets/exchange/tradeCount/sparkline are unaffected (SC-4).
   */
  composite?: CompositePreviewData;
}

export interface SyncPreviewStepProps {
  strategyId: string;
  apiKeyId: string | null;
  wizardSessionId: string;
  onComplete: (snapshot: SyncPreviewSnapshot) => void;
  onTryAnotherKey: () => void;
  /**
   * WIZ-03 (non-destructive composite review). Composite "Review your keys"
   * navigates back to `connect_key` WITHOUT deleting the draft or minting a
   * fresh session (the destructive `onTryAnotherKey` path is single-key only).
   * When absent, the composite buttons fall back to `onTryAnotherKey` so a
   * missing wiring degrades to the prior behaviour rather than a dead click.
   */
  onReviewKeys?: () => void;
  /**
   * WIZ-05 (cached crawl snapshot). The completed snapshot WizardClient already
   * holds (`syncSnapshot`). When present, the mount effect renders it directly
   * and short-circuits BEFORE any strategy_analytics read or /api/keys/sync
   * kickoff — returning to this step after a back-nav never re-crawls/re-stitches.
   */
  cachedSnapshot?: SyncPreviewSnapshot | null;
}

type Phase =
  | "kicking_off"
  | "waiting_for_complete"
  | "gate_failed"
  | "passed";

function formatMetric(value: number | null, suffix = ""): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (suffix === "%") return `${(value * 100).toFixed(1)}%`;
  return value.toFixed(2);
}

function formatCagr(value: number | null): string {
  if (value === null) return "—";
  const pct = value * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Human name for a composite member row: the nickname when present, else the
 * `Key {seq} · {exchange}` fallback (mirrors the multi-key summary chip). Pure
 * — shared by the coverage gantt and the attribution table so both label a
 * member identically.
 */
function memberDisplayName(
  seq: number,
  label: string | null,
  exchange: string | null,
): string {
  return label ?? `Key ${seq} · ${exchange ?? "unknown"}`;
}

/**
 * Signed percentage contribution string (`+X.X%` / `−X.X%`), or an em dash for
 * a no-data member (`null` contribution — never a fabricated 0%). Uses the
 * U+2212 MINUS SIGN for negatives, matching the tabular financial convention.
 */
function formatContribution(value: number | null): string {
  if (value === null) return "—";
  const pct = value * 100;
  const sign = pct >= 0 ? "+" : "−";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

/**
 * Inclusive-both-ends day count of a server `gap_span` — the count the warnings
 * list shows next to the range. Derived via parseIsoDay/utcEpoch (NOT
 * `new Date(iso)`, which reintroduces the UTC/local off-by-one dateday.ts
 * exists to kill). Returns 0 for a malformed bound so a bad span degrades
 * quietly rather than rendering NaN.
 */
function inclusiveGapDays(start: string, end: string): number {
  const s = parseIsoDay(start);
  const e = parseIsoDay(end);
  if (!s || !e) return 0;
  return Math.round((utcEpoch(e) - utcEpoch(s)) / 86_400_000) + 1;
}

/**
 * Convert a declared HALF-OPEN `[start, end)` window's EXCLUSIVE `end` into the
 * INCLUSIVE last calendar day WITH data (`end − 1 day`) for the coverage gantt,
 * whose `CoverageSpan.last` is documented as "last calendar day with data"
 * (R2-3). Passing the half-open `window_end` straight through draws member N's
 * bar THROUGH member N+1's first owned day, so adjacent disjoint windows appear
 * to overlap. UTC-epoch math + UTC accessors keep this timezone-stable and
 * lexicographically ordered (dateday.ts discipline — no local-Date drift). A
 * malformed bound degrades to pass-through rather than rendering garbage.
 */
function halfOpenEndToInclusiveLast(halfOpenEnd: string): string {
  const parsed = parseIsoDay(halfOpenEnd);
  if (!parsed) return halfOpenEnd;
  const prev = new Date(utcEpoch(parsed) - 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(
    prev.getUTCDate(),
  )}`;
}

/**
 * PROG-02 — the LOCKED live per-key status label set (95-04 decision 3). These
 * are the exact user-facing strings; the map doubles as an exhaustiveness check
 * over `MemberProgressStatus`.
 */
const MEMBER_STATUS_LABEL: Record<MemberProgressStatus, string> = {
  waiting: "Waiting",
  in_process: "In process",
  successful: "Successful",
  degraded: "Degraded",
};

/**
 * Per-status chip color. Successful → positive; Degraded → the canonical amber
 * warning token (#B45309, AA at caption size — DESIGN.md Color); In process →
 * accent (paired with a pulsing dot matching the card's existing dot idiom);
 * Waiting → muted. Degraded is amber (RECOVERABLE), never negative red.
 */
const MEMBER_STATUS_CHIP_CLASS: Record<MemberProgressStatus, string> = {
  waiting: "text-text-muted",
  in_process: "text-accent",
  successful: "text-positive",
  degraded: "text-warning",
};

/** Title-case a lowercase exchange slug for the per-key identity fallback. */
function capitalizeExchange(exchange: string): string {
  return exchange.charAt(0).toUpperCase() + exchange.slice(1);
}

export function SyncPreviewStep({
  strategyId,
  apiKeyId,
  wizardSessionId,
  onComplete,
  onTryAnotherKey,
  onReviewKeys,
  cachedSnapshot,
}: SyncPreviewStepProps) {
  const [phase, setPhase] = useState<Phase>("kicking_off");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorCode, setErrorCode] = useState<WizardErrorCode | null>(null);
  // 140.3-10 / SEAMUX-06 — the wait the kickoff ADVERTISED, in seconds, or null
  // when it advertised none. Never defaulted, never fabricated: the envelope
  // renders a countdown only when a real upstream stated one (140.3-09's
  // additive-optional slot).
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(
    null,
  );
  // 140.3-10 / B-22 — bumping this re-runs the kickoff effect, which is what
  // gives a recoverable error state a REAL retry rather than a control that
  // renders and does nothing.
  const [kickoffNonce, setKickoffNonce] = useState(0);
  const [gateResult, setGateResult] = useState<StrategyGateResult | null>(null);
  const [snapshot, setSnapshot] = useState<SyncPreviewSnapshot | null>(null);
  const [computationStatus, setComputationStatus] = useState<string | null>(null);
  // PROG-02/03 — the last GET /api/strategies/[id]/sync-progress projection.
  // COSMETIC: piggybacked on the poll tick, fail-open (never blocks the
  // authoritative strategy_analytics poll). Composite-only; null on single-key.
  const [syncProgress, setSyncProgress] = useState<SyncProgressResponse | null>(
    null,
  );
  // PROG-03 — retry CTA in-flight guard (disables the button, prevents a
  // double re-enqueue). Server-side idempotency is the real defense.
  const [retrying, setRetrying] = useState(false);
  // SF-1 backstop — TRUE once the poll has sat in `waiting_for_complete` with an
  // UNCHANGED computation_status for the full RETRY_THRESHOLD_MS patience. This
  // exit affordance is INDEPENDENT of the cosmetic `syncProgress.stalled`
  // channel, so a genuinely stalled job never becomes an indefinite hang even
  // when the sync-progress route is dead (degrades to IDLE / sustained 429).
  const [stallBackstop, setStallBackstop] = useState(false);
  const [computationError, setComputationError] = useState<string | null>(null);
  // Composite discriminator (Finding-H / Pitfall 1): threaded from SERVER TRUTH
  // — the `/api/keys/sync` kickoff response's `composite` field (true ONLY when
  // the route took the `stitch_composite` branch). NEVER from a client
  // `strategy_keys` count re-read: that probe falls OPEN on a transient error
  // or a null-without-error count, silently routing an already-stitched
  // composite through the single-key arm (false INSUFFICIENT_TRADES / a
  // degraded first-member factsheet). The route fails CLOSED (503) on an
  // unknowable membership, so `!res.ok` → SYNC_FAILED covers that end to end.
  // Init false so a single-key run never re-renders and the poll effect never
  // restarts on the single-key path (SC-4 neutrality).
  const [isComposite, setIsComposite] = useState(false);
  // UX-02: the wizard session correlation id — the SAME id wizardFetch sends on
  // every sync request, so a copied envelope id matches server logs.
  const [correlationId] = useState<string>(() => getWizardCorrelationId());
  /**
   * 140.3-15 / TS-20 — the UPSTREAM correlation id, when the failure carried
   * one. `/api/keys/sync` does `if (!result.ok) return result.response`, so
   * `process-key-client`'s envelope — including the id the ANALYTICS SERVICE
   * logged — reaches this component verbatim. `correlationId` above is minted
   * in the browser and memoized per PAGE LOAD, so on a seam failure it is the
   * weaker of the two for support to search on.
   *
   * PER-FAILURE state. Only the kickoff arm has a body to read it from; every
   * other error path in this component sets a code with no upstream id, and the
   * retry handler clears it, so a stale id can never outlive the failure it
   * belongs to.
   */
  const [upstreamCorrelationId, setUpstreamCorrelationId] = useState<
    string | null
  >(null);
  // useRef initializer must be a non-impure value for React Compiler's
  // purity rule. Real start time is set in the mount effect.
  const startedAtRef = useRef<number>(0);
  const mountedRef = useRef(true);
  // SF-1 backstop — wall-clock of the LAST observed computation_status change.
  // A status that has not advanced for RETRY_THRESHOLD_MS means the job is stuck
  // (or legitimately slow — the retry is an idempotent no-op either way). A real
  // re-stitch (RT-1: a member-set change resets analytics to pending) CHANGES
  // the status and so RESETS this clock, correctly delaying the backstop.
  const statusChangedAtRef = useRef<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    startedAtRef.current = Date.now();
    (async () => {
      try {
        // WIZ-05 (cached crawl snapshot) — FIRST, before any DB probe or
        // kickoff POST. WizardClient renders SyncPreviewStep only while
        // step === "sync_preview", so a back-nav unmounts then remounts this
        // effect. When WizardClient still holds the completed snapshot
        // (`syncSnapshot`, threaded as cachedSnapshot), render it directly and
        // return: no strategy_analytics read, no /api/keys/sync POST, no poll
        // (phase "passed" never enters the poll effect) — regardless of the
        // freshness window. Mirrors the freshness-skip idiom below but keys off
        // the client-held snapshot instead of a DB freshness probe.
        if (cachedSnapshot) {
          setSnapshot(cachedSnapshot);
          if (cachedSnapshot.composite) setIsComposite(true);
          setPhase("passed");
          return;
        }
        // QA report 2026-05-21 ISSUE-005 — skip the /api/keys/sync
        // round-trip on resume when the analytics row is both COMPLETE
        // and fresh (within SYNC_FRESHNESS_WINDOW_MS). The worker is
        // already incremental via api_keys.last_fetched_trade_timestamp,
        // so a re-sync only fetches the delta — but the user still
        // sees ~30-60s of "Fetching trades..." while the round-trip
        // unwinds. Skipping when fresh gets them straight to the
        // factsheet polling tick, which then materializes the snapshot
        // on the first poll. Stale rows still kick off as before so
        // a long-paused session doesn't show outdated metrics.
        const supabase = createClient();
        // NOTE: composite-ness is NOT probed client-side here (the removed
        // fail-open `strategy_keys` count read). It is threaded from the
        // kickoff response below. On the freshness-skip resume path the row is
        // already complete+fresh; that path stays byte-neutral for single-key,
        // and a broken composite is still caught by the shared failed-gate
        // fail-safe in the poll effect.
        // ⚠️ 140.4-12 / SEAMRIM-11 (C-3) — `error` IS BOUND, AND A READ FAILURE
        // IS NOT THE SAME FACT AS AN ABSENT ROW.
        //
        // supabase-js resolves a failed read AS A VALUE, so before this an RLS
        // denial or a statement timeout arrived here as `{ data: null }` —
        // byte-identical to the ordinary first-time draft that simply has no
        // analytics row yet. `.maybeSingle()` answers genuine no-rows with
        // `{ data: null, error: null }`, so the two ARE distinguishable; they
        // just were not being distinguished. This was the last unchecked read
        // in this file: `140.4-02` converted the seven-member `Promise.all`
        // ~530 lines below and never reached this one.
        //
        // WHY THIS LOGS AND FALLS THROUGH RATHER THAN THROWING, unlike the
        // marker read a few lines down. That one decides COMPOSITE vs
        // SINGLE-KEY routing, so it fails CLOSED. This one decides only whether
        // to SKIP a round-trip: on a failed read `data` is null, so the
        // derivations below already resolve to "not complete, not fresh" and
        // the effect falls through to the kickoff POST — exactly what a cold
        // start does. Throwing would end the wizard on a transient blip in an
        // optimisation, which is the over-refusal `140.4-01` carved PGRST116
        // out to avoid, on a path where the fail-open direction cannot occur (a
        // failed read can never produce `isComplete === true`).
        //
        // So the defect closed here is SILENCE, not a wrong branch: the failure
        // is now recorded and is distinguishable from an absence. Both
        // polarities are pinned in `SyncPreviewStep.render.test.tsx` — a
        // failure logs exactly once and still kicks off, an absence logs
        // nothing.
        const { data: existing, error: existingErr } = await supabase
          .from("strategy_analytics")
          .select("computation_status, computed_at")
          .eq("strategy_id", strategyId)
          .maybeSingle();
        if (existingErr) {
          console.error(
            "[wizard:SyncPreviewStep] resume freshness probe read failed — " +
              "treating this resume as a COLD START, not as an absent " +
              "analytics row:",
            existingErr.message,
          );
        }
        const computedAtMs = existing?.computed_at
          ? Date.parse(existing.computed_at)
          : null;
        const isComplete = isComputedAnalytics(existing?.computation_status);
        const isFresh =
          isComplete &&
          computedAtMs !== null &&
          Number.isFinite(computedAtMs) &&
          Date.now() - computedAtMs < SYNC_FRESHNESS_WINDOW_MS;
        if (isComplete) {
          // The kickoff POST is (potentially) SKIPPED on a resume, so there is
          // no server `composite` field to thread. Determine composite-ness
          // DETERMINISTICALLY from the marker the stitch worker persists
          // (`data_quality_flags.composite`) via a SEPARATE lightweight read —
          // we do NOT re-derive/re-enqueue a fresh composite, and we do NOT
          // touch the frozen `computation_status, computed_at` read above.
          //
          // WIZ-05 durability (resolved decision 1): this read now runs for ANY
          // complete row (fresh OR stale), not only fresh ones, so a COMPLETE
          // composite short-circuits the kickoff regardless of the 5-minute
          // window — a finished stitch never needs re-running merely to display
          // (the hard-reload case). Cost on the complete-and-stale SINGLE-KEY
          // resume is one extra lightweight marker read before the unchanged
          // re-sync POST.
          const { data: dqRow, error: dqErr } = await supabase
            .from("strategy_analytics")
            .select("data_quality_flags")
            .eq("strategy_id", strategyId)
            .maybeSingle();
          if (!mountedRef.current) return;
          const dqFlags = (dqRow?.data_quality_flags ?? {}) as {
            composite?: unknown;
          };
          if (dqFlags.composite === true) {
            // COMPLETE composite (fresh OR stale) → skip the kickoff; the
            // existing poll materializes the snapshot from the persisted rows.
            setIsComposite(true);
            setPhase("waiting_for_complete");
            return;
          }
          if (isFresh) {
            // FRESH resume, non-composite (or unreadable marker). The fresh-skip
            // path has NO kickoff-POST fallback, so it fails CLOSED to
            // SYNC_FAILED when the marker row can't be read (error or missing
            // row) rather than silently routing a possible composite through the
            // single-key arm — byte-identical to the prior freshness-skip guard.
            // A present row WITHOUT the marker is definitively single-key/CSV →
            // byte-neutral resume.
            if (dqErr || !dqRow) {
              setErrorCode("SYNC_FAILED");
              setPhase("gate_failed");
              return;
            }
            setPhase("waiting_for_complete");
            return;
          }
          // STALE, non-composite (or unreadable marker) → fall through to the
          // kickoff POST exactly as today. The route fails CLOSED (503) on an
          // unknowable membership, so the end-to-end fail-closed guarantee is
          // preserved without blocking a legitimate stale single-key re-sync on
          // a transient marker-read blip.
        }
        const res = await wizardFetch("/api/keys/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy_id: strategyId }),
        });
        if (!res.ok) {
          // A non-2xx kickoff fails CLOSED — we never silently assume
          // single-key. What changed in 140.3-10 is only WHICH honest state we
          // fail closed INTO: the route now names the fact on the wire, so a
          // throttle no longer reads as a failed computation.
          const failure = (await res.json().catch(() => null)) as {
            code?: unknown;
          } | null;
          // 140.4-12 / SEAMRIM-08 — TRANSLATE FIRST, THEN MEMBERSHIP-CHECK.
          //
          // Until this, the lookup below was the ONLY hop and it indexed the
          // RAW WIRE STRING. `KNOWN_KICKOFF_CODES` holds wizard codes OUR OWN
          // route mints, and its intersection with the seam's wire vocabulary
          // (`CIRCUIT_OPEN`, `UPSTREAM_TIMEOUT`, `UPSTREAM_NETWORK_ERROR`,
          // `SEAM_MISCONFIGURED`) is EMPTY — so a breaker trip or a dead
          // upstream during the kickoff rendered SYNC_FAILED, which asks the
          // user which step failed about a computation that never started.
          // `SubmitStep` has had the translation hop since 140.3-05; this
          // sibling arm never did.
          //
          // Order matters and is the whole change: `SEAM_CODE_TO_WIZARD_CODE`
          // (the ONE wire→wizard table, in `wizardErrors.ts`) answers for WIRE
          // codes, and `KNOWN_KICKOFF_CODES` answers for the route-minted ones
          // it has always owned. NEITHER LIST GAINED A MEMBER — the roster's
          // reasoning below (why the two 400 arms map to VALIDATION_FAILED and
          // why no new union member was minted) is unchanged and still governs
          // its own domain.
          //
          // The fallback is NOT weakened: an unrecognised wire code leaves the
          // translation at "UNKNOWN" and then misses the roster, so it still
          // reaches SYNC_FAILED — deliberately, because a map pretending to be
          // total turns an unfamiliar code into a silent undefined state.
          //
          // The code is read through `seamErrorCode`, the same leaf
          // `seamCorrelationId` below already comes from, so a nested
          // `service_error` body (`body.detail.code`) is seen rather than read
          // as a body carrying no code at all.
          const wireCode = seamErrorCode(failure);
          const translated = recogniseSeamErrorCode(wireCode);
          const surfaced: WizardErrorCode =
            translated !== "UNKNOWN"
              ? translated
              : (wireCode !== null && KNOWN_KICKOFF_CODES[wireCode]) ||
                "SYNC_FAILED";
          // The wait rides the HEADER, read through the ONE parser
          // (`parseRetryAfterSeconds` — HTTP-date safe, never NaN/0/negative).
          // Absent header ⇒ no wait, and the envelope then names no duration at
          // all rather than inventing one (TRAP-3).
          //
          // ⚠️ This is NOT the step's patience threshold — the elapsed clock
          // that surfaces the stuck-job exit affordance. That one serves a
          // different purpose and is deliberately untouched. Its constant is
          // NOT NAMED HERE ON PURPOSE: this plan's acceptance check counts
          // occurrences of that identifier to prove the timer was not
          // repurposed, and reproducing it in a comment that says "we did not
          // touch it" is exactly how a check stops discriminating. (Third
          // occurrence of that trap in this phase — see 140.3-09's FINDING-C.)
          const advertisedWait = parseRetryAfterSeconds(res.headers);
          // 140.3-15 / TS-20 — read through the leaf, which handles BOTH wire
          // shapes (top-level on the flat envelopes, nested inside
          // `service_error`) and refuses a value that is not correlation-id
          // shaped. Set from the SAME body as the code above, so the id and the
          // state can never describe different failures.
          const upstreamId = seamCorrelationId(failure);
          if (mountedRef.current) {
            setRetryAfterSeconds(advertisedWait);
            setUpstreamCorrelationId(upstreamId);
            setErrorCode(surfaced);
            setPhase("gate_failed");
          }
          return;
        }
        // AUTHORITATIVE composite discriminator from server truth. The route
        // returns `composite: true` ONLY on the stitch_composite branch and
        // fails CLOSED (503, handled above) on an unknowable membership, so a
        // 2xx always carries a definite boolean. A parse failure can only be a
        // legacy/empty body (never a real composite, which always emits
        // `composite: true`), so it safely defaults to the single-key arm.
        const kickoff = (await res.json().catch(() => null)) as {
          composite?: boolean;
        } | null;
        if (mountedRef.current) {
          if (kickoff?.composite === true) setIsComposite(true);
          setPhase("waiting_for_complete");
        }
      } catch (err) {
        console.error("[wizard:SyncPreviewStep] kickoff threw:", err);
        if (mountedRef.current) {
          setErrorCode("KEY_NETWORK_TIMEOUT");
          setPhase("gate_failed");
        }
      }
    })();
    return () => {
      mountedRef.current = false;
    };
    // cachedSnapshot is stable WizardClient state; the early return keeps any
    // re-run inert (it never re-crawls when a snapshot is already held).
    // kickoffNonce: B-22's retry re-runs this effect deliberately. The effect
    // re-arms `mountedRef` on entry (first line), so a re-run behaves exactly
    // like a fresh mount rather than writing into a torn-down closure.
  }, [strategyId, cachedSnapshot, kickoffNonce]);

  // SF-1 backstop — record when the observed computation_status last advanced.
  // Fires on mount (null) and on every change; a status frozen for the whole
  // patience window is the stuck signal the backstop keys off. Cheap ref write,
  // no re-render.
  useEffect(() => {
    statusChangedAtRef.current = Date.now();
  }, [computationStatus]);

  useEffect(() => {
    if (phase !== "waiting_for_complete" && phase !== "kicking_off") return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setElapsedMs(now - startedAtRef.current);
      // SF-1 — still waiting AND the analytics status has not advanced for the
      // full 15-min patience budget → surface the exit affordance even if the
      // cosmetic sync-progress stall channel is dead. Only fires in
      // `waiting_for_complete` (a terminal transition leaves this phase).
      setStallBackstop(
        phase === "waiting_for_complete" &&
          now - statusChangedAtRef.current >= RETRY_THRESHOLD_MS,
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // UX-03 (#46): heavy terminal-fetch failure counter. SEPARATE from the hook's
  // status-read consecutive-error counter — the narrow status read can keep
  // succeeding (resetting that counter) while the heavy Promise.all persistently
  // REJECTS (a network blip, an aborted fetch, a transport-level trades/api_keys
  // error). With a shared counter such a throw oscillates 0→1→0 and never
  // escalates, so the wizard spins forever (H-0197, narrowed to heavy-fetch-only
  // faults). A ref (not a poll-local `let`) so it survives the 1s elapsed-timer
  // re-renders that recreate the onTerminal closure; per the invariant it never
  // needs a reset — every non-throwing heavy outcome (passed / gate-fail) stops
  // the loop, so the only path that repolls is a throw. (A Supabase error
  // returned AS A VALUE on a heavy read throws below — on BOTH arms as of
  // 140.4-02 — so it escalates here. Previously only the composite arm checked;
  // an RLS denial on the single-key `trades` read dropped tradeCount to 0 via
  // `?? 0` and the gate answered INSUFFICIENT_TRADES, telling the user we had
  // measured zero trades on an account we had failed to read — a terminal,
  // loop-stopping outcome with no self-recovery. All seven single-key members
  // now bind `error`, and both head-counts refuse a null count for the same
  // reason: a count that did not come back is not a count of zero.)
  const heavyFetchErrorsRef = useRef(0);

  /**
   * Stop polling and surface a recoverable SYNC_FAILED envelope. Used when the
   * status read keeps failing (H-0197 / H-0198) — the hook's escalation sink —
   * AND by the heavy terminal arm's own escalation below, so the user gets an
   * exit affordance instead of an indefinite spinner. Fires the same
   * `wizard_error` funnel event as the gate-failure path.
   */
  const failPolling = () => {
    if (!mountedRef.current) return;
    setErrorCode("SYNC_FAILED");
    setPhase("gate_failed");
    trackForQuantsEventClient("wizard_error", {
      wizard_session_id: wizardSessionId,
      step: "sync_preview",
      code: "SYNC_FAILED",
    });
  };

  // UX-03 (#46): the status-poll loop (self-scheduling setTimeout over
  // POLL_BACKOFF_MS, the strategy_analytics status read, the consecutive-error
  // escalation, terminal detection) now lives in the shared
  // `useStrategySyncPoller`. What STAYS here is the surface-specific work: the
  // per-tick status setState + the 95-04 sync-progress piggyback (onStatus), the
  // SYNC_FAILED escalation sink (onError), and the heavy composite/single-key
  // terminal arms incl. their heavyFetchErrors escalation + WIZ-05/RT-1 stall
  // behavior (onTerminal). The kickoff effect + elapsed timer + waiting render
  // are untouched; the three frozen wizard tests + the 95-04 sibling prove zero
  // behavior change.
  useStrategySyncPoller({
    enabled: phase === "waiting_for_complete",
    strategyId,
    schedule: POLL_BACKOFF_MS,
    maxConsecutiveErrors: MAX_CONSECUTIVE_POLL_ERRORS,
    onError: failPolling,
    onStatus: (nextStatus, nextError) => {
      // Keep the two status columns in state so the waiting render's phase-aware
      // copy (downloaded vs processed) + the failure line update each tick.
      setComputationStatus((prev) => (prev === nextStatus ? prev : nextStatus));
      setComputationError((prev) => (prev === nextError ? prev : nextError));

      // PROG-02/03 — piggyback the per-key progress projection on this tick
      // (composite only; no new timer, cadence follows POLL_BACKOFF_MS). This is
      // COSMETIC: a failure is swallowed with a console.warn and MUST NOT touch
      // the authoritative strategy_analytics poll. Fire-and-forget so a
      // slow/hung progress route never delays the status loop; the setState is
      // guarded by `mountedRef`.
      if (isComposite) {
        void wizardFetch(`/api/strategies/${strategyId}/sync-progress`)
          .then((r) => (r.ok ? r.json() : null))
          .then((json: SyncProgressResponse | null) => {
            if (!mountedRef.current || !json) return;
            // SF-3 — a DEGRADED read (`json.degraded === true`, the route's
            // rpcError branch) or an EMPTY read that arrives while we already
            // hold a populated in-flight snapshot must NOT wipe the live panel
            // or flip `stalled` to false: a couldn't-read blip is not evidence
            // of "not stalled". Keep last-known state until a REAL, non-empty
            // read arrives. A non-empty read (real progress) always replaces.
            setSyncProgress((prev) => {
              const incomingEmpty =
                json.degraded === true || json.memberProgress.length === 0;
              const havePopulated =
                prev != null && prev.memberProgress.length > 0;
              if (incomingEmpty && havePopulated) return prev;
              return json;
            });
          })
          .catch((progressErr) => {
            console.warn(
              "[wizard:SyncPreviewStep] sync-progress fetch failed (cosmetic, ignored):",
              progressErr,
            );
          });
      }
    },
    onTerminal: async (nextStatus, nextError) => {
      const supabase = createClient();

      // Hard-failure terminal state. Bail BEFORE the heavy Promise.all (H-0195):
      // on `failed` the analytics row is errored, so the 5 trades/api_keys
      // queries are pure waste, and the gate would only ever map this to
      // GATE_ANALYTICS_FAILED anyway. Route straight to the scripted
      // analytics-failed envelope, carrying computation_error for the detail
      // line (already threaded via onStatus above), and stop polling.
      if (nextStatus === "failed") {
        if (!mountedRef.current) return "done";
        setErrorCode("GATE_ANALYTICS_FAILED");
        setPhase("gate_failed");
        trackForQuantsEventClient("wizard_error", {
          wizard_session_id: wizardSessionId,
          step: "sync_preview",
          code: "GATE_ANALYTICS_FAILED",
        });
        return "done";
      }

      // Terminal SUCCESS (isComputedAnalytics, incl. complete_with_warnings).
      // Fetch the heavy analytics row, trade count + span, sample symbols for
      // market detection, and the exchange name in one Promise.all so the user
      // moves to the factsheet preview as fast as possible.
      //
      // Wrapped in its own try/catch so a persistently-throwing heavy fetch
      // escalates via `heavyFetchErrorsRef` instead of being masked. One
      // transient heavy fault is still tolerated; the threshold matches the
      // status-read path.
      try {
        // COMPOSITE ARM (Pitfall 1/4/5): the composite reads the stitched
        // result directly (analytics mask + members + full series +
        // denominator config) and NEVER routes through checkStrategyGate or
        // queries `trades` (a composite has 0 trades — the single-key gate
        // would false-fail INSUFFICIENT_TRADES). Its only gate is the shared
        // `nextStatus === "failed"` branch above, which fires before this
        // read. Supabase error-as-value on any read throws so the existing
        // heavyFetchErrors escalation (H-0197) applies unchanged.
        if (isComposite) {
            const [analyticsRes, membersRes, seriesRes, stratRes] =
              await Promise.all([
                supabase
                  .from("strategy_analytics")
                  .select(
                    "cagr, sharpe, sortino, max_drawdown, volatility, cumulative_return, sparkline_returns, metrics_json_by_basis, data_quality_flags, computed_at",
                  )
                  .eq("strategy_id", strategyId)
                  .maybeSingle(),
                supabase
                  .from("strategy_keys")
                  .select(
                    "api_key_id, window_start, window_end, seq, api_keys(exchange, label)",
                  )
                  .eq("strategy_id", strategyId)
                  .order("seq", { ascending: true }),
                supabase
                  .from("csv_daily_returns")
                  .select("date, daily_return")
                  .eq("strategy_id", strategyId)
                  .order("date", { ascending: true })
                  // Flat safety ceiling, T-36-03-03 precedent (queries.ts).
                  .limit(20000),
                supabase
                  .from("strategies")
                  .select("returns_denominator_config")
                  .eq("id", strategyId)
                  .maybeSingle(),
              ]);

            if (analyticsRes.error) {
              throw new Error(
                `composite analytics read failed: ${analyticsRes.error.message}`,
              );
            }
            if (membersRes.error) {
              throw new Error(
                `composite members read failed: ${membersRes.error.message}`,
              );
            }
            if (seriesRes.error) {
              throw new Error(
                `composite series read failed: ${seriesRes.error.message}`,
              );
            }
            if (stratRes.error) {
              throw new Error(
                `composite denominator-config read failed: ${stratRes.error.message}`,
              );
            }

            if (!mountedRef.current) return "done";

            const analyticsRow =
              (analyticsRes.data as Record<string, unknown> | null) ?? null;
            const dq = (analyticsRow?.data_quality_flags ?? {}) as {
              per_key?: {
                seq: number;
                first_day: string | null;
                last_day: string | null;
                n_days: number;
              }[];
              gap_spans?: { start: string; end: string }[];
              gap_day_count?: number;
              mtm_gated_reason?: string | null;
              benchmark_unavailable?: boolean;
              benchmark_note?: string | null;
              insufficient_window?: boolean;
              degraded_members?: unknown;
            };

            const members: CompositeMemberKeyRow[] = (
              (membersRes.data as
                | {
                    api_key_id: string;
                    window_start: string;
                    window_end: string | null;
                    seq: number;
                    api_keys?:
                      | { exchange: string | null; label: string | null }
                      | { exchange: string | null; label: string | null }[]
                      | null;
                  }[]
                | null) ?? []
            )
              .map((r) => {
                // The api_keys embed is many-to-one; supabase-js may return it
                // as an object OR a single-element array. Normalize null-safely.
                const embed = Array.isArray(r.api_keys)
                  ? r.api_keys[0]
                  : r.api_keys;
                return {
                  apiKeyId: r.api_key_id,
                  windowStart: r.window_start,
                  windowEnd: r.window_end ?? null,
                  seq: r.seq,
                  exchange: embed?.exchange ?? null,
                  label: embed?.label ?? null,
                };
              })
              .sort((a, b) => a.seq - b.seq);

            const perKey = Array.isArray(dq.per_key)
              ? [...dq.per_key].sort((a, b) => a.seq - b.seq)
              : [];
            const series =
              (seriesRes.data as
                | { date: string; daily_return: number }[]
                | null) ?? [];

            // R2-5 (stale-complete race): the stitch_composite worker does a
            // wholesale delete→re-upsert of csv_daily_returns. A poll landing
            // inside that window can read a 'complete' status with 0 series
            // rows — rendering an empty attribution table + gantt beside stale
            // metrics. Treat an empty series as NOT-yet-terminal: stay in the
            // waiting/computing state and re-poll until the re-upsert lands
            // (bounded by the same elapsed WARN/RETRY affordances). A genuine
            // stitched composite always persists ≥1 day, so this never hides a
            // real result.
            if (series.length === 0) {
              return "repoll";
            }

            const compositeMetrics: FactsheetPreviewMetric[] = [
              {
                label: "CAGR",
                value: formatCagr((analyticsRow?.cagr as number) ?? null),
              },
              {
                label: "Sharpe",
                value: formatMetric((analyticsRow?.sharpe as number) ?? null),
              },
              {
                label: "Sortino",
                value: formatMetric((analyticsRow?.sortino as number) ?? null),
              },
              {
                label: "Max DD",
                value:
                  analyticsRow?.max_drawdown != null
                    ? formatCagr(analyticsRow.max_drawdown as number)
                    : "—",
              },
              {
                label: "Volatility",
                value:
                  analyticsRow?.volatility != null
                    ? formatMetric(analyticsRow.volatility as number, "%")
                    : "—",
              },
              {
                label: "Cumulative",
                value:
                  analyticsRow?.cumulative_return != null
                    ? formatCagr(analyticsRow.cumulative_return as number)
                    : "—",
              },
            ];

            // A1 fallback: use the served sparkline_returns if present, else
            // the daily_return values from the stitched series — served data
            // only, NEVER recomputed.
            const compositeSparkline: number[] | null = Array.isArray(
              analyticsRow?.sparkline_returns,
            )
              ? (analyticsRow!.sparkline_returns as number[])
              : series.map((d) => d.daily_return);

            // Phase 133 review IN-03: strict extraction of the persisted smoothed
            // headline from the untrusted jsonb (mirrors the factsheet read side's
            // coercion posture — a malformed column yields `false`, never a caveat
            // inventing availability).
            const metricsJsonByBasis = analyticsRow?.metrics_json_by_basis;
            const smoothedMtmAvailable = hasBasisHeadline(
              metricsJsonByBasis !== null &&
                typeof metricsJsonByBasis === "object" &&
                !Array.isArray(metricsJsonByBasis)
                ? (metricsJsonByBasis as Record<string, unknown>).smoothed_mtm
                : undefined,
            );

            const compositeSnapshot: SyncPreviewSnapshot = {
              tradeCount: 0,
              csvRowCount: series.length,
              earliestTradeAt: null,
              latestTradeAt: null,
              detectedMarkets: [],
              exchange: null,
              metrics: compositeMetrics,
              sparkline: compositeSparkline,
              computedAt: (analyticsRow?.computed_at as string) ?? null,
              composite: {
                members,
                perKey,
                gapSpans: Array.isArray(dq.gap_spans) ? dq.gap_spans : [],
                gapDayCount:
                  typeof dq.gap_day_count === "number" ? dq.gap_day_count : 0,
                mtmGatedReason: dq.mtm_gated_reason ?? null,
                smoothedMtmAvailable,
                benchmarkUnavailable: dq.benchmark_unavailable === true,
                benchmarkNote: dq.benchmark_note ?? null,
                // HARD-04 (#67): strict server-truth coercion (mirror
                // benchmark_unavailable) — a malformed value renders nothing.
                insufficientWindow: dq.insufficient_window === true,
                // HARD-05 (Phase 93): strict-coerce the degraded-member records —
                // ONLY objects with a finite numeric seq + non-empty string venue
                // survive; malformed jsonb yields [] (renders nothing, T-92-05).
                // The server `reason` enum is dropped (server-only vocabulary).
                degradedMembers: Array.isArray(dq.degraded_members)
                  ? dq.degraded_members.flatMap((e): { seq: number; venue: string }[] => {
                      if (typeof e !== "object" || e === null) return [];
                      const { seq, venue } = e as { seq?: unknown; venue?: unknown };
                      if (typeof seq !== "number" || !Number.isFinite(seq)) return [];
                      if (typeof venue !== "string" || venue.length === 0) return [];
                      return [{ seq, venue }];
                    })
                  : [],
                series,
                rawDenominatorConfig:
                  (stratRes.data as { returns_denominator_config?: unknown } | null)
                    ?.returns_denominator_config ?? null,
                // R2-4: the SERVER-computed composite cumulative return, kept raw
                // so the reconciliation caption can epsilon-check that the
                // per-key attribution actually reconstitutes it (a count match
                // alone is not a value identity).
                cumulativeReturn:
                  (analyticsRow?.cumulative_return as number | null) ?? null,
              },
            };

            setSnapshot(compositeSnapshot);
            setPhase("passed");
            return "done";
          }

          const [
            analyticsRes,
            tradeCountRes,
            earliestRes,
            latestRes,
            sampleRes,
            csvRowCountRes,
            keyRowResult,
          ] = await Promise.all([
            supabase
              .from("strategy_analytics")
              .select(
                "cagr, sharpe, sortino, max_drawdown, volatility, cumulative_return, sparkline_returns, computed_at",
              )
              .eq("strategy_id", strategyId)
              .maybeSingle(),
            supabase
              .from("trades")
              .select("id", { count: "exact", head: true })
              .eq("strategy_id", strategyId),
            supabase
              .from("trades")
              .select("timestamp")
              .eq("strategy_id", strategyId)
              .order("timestamp", { ascending: true })
              .limit(1),
            supabase
              .from("trades")
              .select("timestamp")
              .eq("strategy_id", strategyId)
              .order("timestamp", { ascending: false })
              .limit(1),
            supabase
              .from("trades")
              .select("symbol")
              .eq("strategy_id", strategyId)
              // Bybit + OKX ingest writes daily portfolio aggregates under
              // the synthetic symbol "PORTFOLIO". Bybit accounts can have
              // hundreds of these clustered at the start of the table; an
              // unordered limit(50) sample then comes back as 50× PORTFOLIO
              // and the client-side filter leaves the detected-markets
              // hint empty. Excluding the sentinel at the query layer keeps
              // the sample biased toward real trading pairs.
              .neq("symbol", "PORTFOLIO")
              .limit(50),
            // P72 — daily-return row count. Ledger-backed exchanges (Deribit)
            // derive returns into `csv_daily_returns` and NEVER write `trades`,
            // so a keyed Deribit strategy has tradeCount 0. The gate needs the
            // csv row count to take its daily-returns branch instead of
            // false-failing INSUFFICIENT_TRADES.
            supabase
              .from("csv_daily_returns")
              .select("strategy_id", { count: "exact", head: true })
              .eq("strategy_id", strategyId),
            apiKeyId
              ? supabase
                  .from("api_keys")
                  .select("exchange")
                  .eq("id", apiKeyId)
                  .maybeSingle()
              : Promise.resolve({ data: null as { exchange?: string } | null }),
          ]);

          // C-3 / SEAMRIM-02 — EVERY member binds `error`, in the same shape the
          // composite arm 200 lines above already uses. supabase-js resolves a
          // PostgREST failure AS A VALUE, so an unchecked destructure is
          // indistinguishable from real data: an RLS denial or a statement
          // timeout on `trades` used to arrive as `count: null`, become 0 via
          // `?? 0`, and render "We found only 0 filled trade(s) on this key." —
          // a measurement we never took, on a product whose whole value is a
          // trustworthy verified track record. Throwing routes the failure into
          // the `heavyFetchErrorsRef` escalation below (one transient fault
          // tolerated, then the recoverable SYNC_FAILED envelope with an exit
          // affordance) instead of a terminal, loop-stopping gate verdict.
          if (analyticsRes.error) {
            throw new Error(
              `single-key analytics read failed: ${analyticsRes.error.message}`,
            );
          }
          if (tradeCountRes.error) {
            throw new Error(
              `single-key trades count read failed: ${tradeCountRes.error.message}`,
            );
          }
          if (earliestRes.error) {
            throw new Error(
              `single-key earliest-trade read failed: ${earliestRes.error.message}`,
            );
          }
          if (latestRes.error) {
            throw new Error(
              `single-key latest-trade read failed: ${latestRes.error.message}`,
            );
          }
          if (sampleRes.error) {
            throw new Error(
              `single-key trade-sample read failed: ${sampleRes.error.message}`,
            );
          }
          if (csvRowCountRes.error) {
            throw new Error(
              `single-key csv daily-returns count read failed: ${csvRowCountRes.error.message}`,
            );
          }
          // ⚠️ MEMBER 7 IS A TERNARY AND STAYS ONE. When `apiKeyId` is falsy the
          // else-branch resolves a SYNTHETIC `{ data: null }` that has no `error`
          // property at all — a keyless draft, not a read failure. Checking it
          // unconditionally would turn this fix into an outage for every keyless
          // draft, so the property's PRESENCE is what gates the check.
          if ("error" in keyRowResult && keyRowResult.error) {
            throw new Error(
              `single-key api_keys read failed: ${keyRowResult.error.message}`,
            );
          }

          const analytics = analyticsRes.data;
          const tradeCount = tradeCountRes.count;
          const earliest = earliestRes.data;
          const latest = latestRes.data;
          const sample = sampleRes.data;
          const csvRowCount = csvRowCountRes.count;

          // COUNTS ARE PART OF THE CLASS. Both of these are `head: true` exact
          // counts, so a null count with NO error is as unrepresentable as an
          // error — and `?? 0` on it is the same fabrication by another route.
          // Refuse it rather than coercing; the throw lands in the same sink.
          if (tradeCount === null) {
            throw new Error(
              "single-key trades count read returned no count (head:true exact count was null)",
            );
          }
          if (csvRowCount === null) {
            throw new Error(
              "single-key csv daily-returns count read returned no count (head:true exact count was null)",
            );
          }

          const detectedMarkets = deriveDetectedMarkets(
            sample.map((t) => (t as { symbol?: string }).symbol),
          );

          const keyRow = keyRowResult.data;

          if (!mountedRef.current) return "done";

          const gate = checkStrategyGate({
            apiKeyId,
            tradeCount,
            earliestTradeAt: earliest[0]?.timestamp
              ? new Date(earliest[0].timestamp)
              : null,
            latestTradeAt: latest[0]?.timestamp
              ? new Date(latest[0].timestamp)
              : null,
            computationStatus: nextStatus,
            computationError: nextError,
            csvRowCount,
            // P72 — only a ledger-backed (Deribit) keyed strategy may pass on a
            // daily-returns series; a keyed perp with 0 fills must stay on the
            // trade branch (its funding series has no completeness gate).
            isLedgerBacked: isLedgerBackedExchange(keyRow?.exchange),
          });

          if (!gate.passed) {
            setGateResult(gate);
            const wizardCode = gate.code ? gateFailureToWizardError(gate.code) : "UNKNOWN";
            setErrorCode(wizardCode);
            setPhase("gate_failed");
            trackForQuantsEventClient("wizard_error", {
              wizard_session_id: wizardSessionId,
              step: "sync_preview",
              code: wizardCode,
              trade_count: tradeCount,
            });
            return "done";
          }

          const metrics: FactsheetPreviewMetric[] = [
            { label: "CAGR", value: formatCagr(analytics?.cagr ?? null) },
            { label: "Sharpe", value: formatMetric(analytics?.sharpe ?? null) },
            { label: "Sortino", value: formatMetric(analytics?.sortino ?? null) },
            {
              label: "Max DD",
              value: analytics?.max_drawdown != null ? formatCagr(analytics.max_drawdown) : "—",
            },
            {
              label: "Volatility",
              value: analytics?.volatility != null ? formatMetric(analytics.volatility, "%") : "—",
            },
            {
              label: "Cumulative",
              value: analytics?.cumulative_return != null ? formatCagr(analytics.cumulative_return) : "—",
            },
          ];

          const nextSnapshot: SyncPreviewSnapshot = {
            tradeCount,
            csvRowCount,
            earliestTradeAt: earliest[0]?.timestamp ?? null,
            latestTradeAt: latest[0]?.timestamp ?? null,
            detectedMarkets,
            exchange: keyRow?.exchange ?? null,
            metrics,
            sparkline: Array.isArray(analytics?.sparkline_returns)
              ? (analytics.sparkline_returns as number[])
              : null,
            computedAt: analytics?.computed_at ?? null,
          };

          setSnapshot(nextSnapshot);
          setPhase("passed");
          return "done";
        } catch (heavyErr) {
          // The terminal fetch / gate evaluation threw (network blip, an
          // aborted fetch, or a transport-level rejection). One transient
          // fault is tolerated, but a persistent heavy-fetch fault must
          // escalate — the hook's status read keeps succeeding, so its
          // consecutive-error counter would never reach the threshold
          // (H-0197, heavy-fetch-narrowed). Count consecutive heavy failures
          // in a ref and surface the recoverable SYNC_FAILED envelope past it.
          if (!mountedRef.current) return "done";
          console.error(
            "[wizard:SyncPreviewStep] terminal fetch error:",
            heavyErr,
          );
          heavyFetchErrorsRef.current += 1;
          if (heavyFetchErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
            failPolling();
            return "done";
          }
          return "repoll";
        }
      },
    });

  const handleUseThisKey = useCallback(() => {
    if (snapshot) onComplete(snapshot);
  }, [snapshot, onComplete]);

  // PROG-03 / SF-1 — idempotent retry for a stall (route-detected OR the SF-1
  // backstop). Re-POSTs the SAME kickoff shape (`:451-455`); the partial-unique
  // index `compute_jobs_one_inflight_per_kind_strategy` makes a genuinely
  // inflight (`pending`/`running`) job a no-op and re-enqueues a
  // watchdog-reclaimed/dead one. (NB: `failed_retry` is EXCLUDED from that index
  // — the manual Retry is SUPPRESSED during that backoff, F-3, so this handler
  // is never invoked then.) Never routes into the SYNC_FAILED terminal gate.
  // On a 2xx we (a) reset the SF-1 backstop patience clock so the amber banner
  // DROPS and the 15-min window restarts — a re-claimed run may write the SAME
  // `computing` status, which the poll dedups, so the [computationStatus] reset
  // effect never fires and the clock MUST be reset here explicitly — and (b)
  // drop the `stalled` flag WITHOUT wiping the live per-key panel (keep
  // memberProgress; the next poll refreshes it — losing the panel at the anxious
  // moment is a regression). A non-2xx keeps the banner visible to retry.
  const handleRetrySync = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const res = await wizardFetch("/api/keys/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId }),
      });
      if (res.ok && mountedRef.current) {
        statusChangedAtRef.current = Date.now();
        setStallBackstop(false);
        // F-2b — a successful retry is a legitimate "fresh wait starts now"
        // event, so reset the MOUNT patience clock too, not just the SF-1
        // backstop clock. Both banners key off elapsed clocks (the amber
        // `showInterruptedBanner` off `stallBackstop`, the red
        // `showRetry`/"leave this page" block off `elapsedMs`). Resetting only
        // the backstop dropped the amber banner but left `elapsedMs` past
        // RETRY_THRESHOLD_MS, so the scariest copy in the flow ("taking much
        // longer than expected … leave this page") instantly replaced the
        // reassuring retry — and persisted, since a re-claimed run often writes
        // the SAME `computing` status and never re-advances any clock. Reset
        // both so the whole patience window restarts on retry.
        startedAtRef.current = Date.now();
        setElapsedMs(0);
        setSyncProgress((prev) =>
          prev ? { ...prev, stalled: false } : prev,
        );
      }
    } catch (retryErr) {
      console.warn(
        "[wizard:SyncPreviewStep] retry sync POST failed:",
        retryErr,
      );
    } finally {
      if (mountedRef.current) setRetrying(false);
    }
  }, [retrying, strategyId]);

  // 140.3-15 / TS-20 — ONE id field, the one `ErrorEnvelope` already renders and
  // `buildDiagBlock` already copies into the QUANTALYZE_DIAG payload. The
  // upstream id WINS when the wire carried a usable one; today's browser-minted
  // id remains the fallback, so nothing that previously rendered an id stops
  // doing so. No second field was added — the render slot expects exactly one
  // value, and two ids in a diagnostics block is a support ticket asking which
  // one to search.
  const errorEnvelope = errorCode
    ? buildEnvelope(errorCode, upstreamCorrelationId ?? correlationId, {
        trades: gateResult?.detail?.trades as number | undefined,
        days: gateResult?.detail?.days as number | undefined,
        computationError: computationError,
        // 140.3-10 — `?? undefined` because ABSENCE IS NOT ZERO. `null` would
        // be carried into the envelope slot and a `0` there is a wait we were
        // never told about.
        retryAfterSeconds: retryAfterSeconds ?? undefined,
      })
    : null;

  /**
   * 140.3-10 / B-22 — the retry the shared renderer could never show.
   *
   * `ErrorEnvelope` computes `showRetry = envelope.recoverable && Boolean(onRetry)`.
   * This step passed NO `onRetry`, so `showRetry` was STRUCTURALLY false: a
   * recoverable seam error rendered with no retry control at all, which is
   * exactly what SEAMUX-06 forbids. The handler is supplied only where retrying
   * is genuinely the right thing. A non-recoverable state (`GATE_DRAFT_GONE`)
   * gets `undefined` and renders no Retry, because retrying a draft that is gone
   * re-fails identically and a control that cannot work is a false affordance.
   *
   * ⚠️ 140.4-11 RE-POINTED THE PREDICATE. This block used to say `recoverable`
   * "already encodes that". It does not: `recoverable` is any of
   * `clear_and_retry` OR `try_another_key`, and the two history codes earn it
   * through the latter — a remedy this handler cannot perform. The gate is now
   * `clear_and_retry` specifically (`kickoffRetryCanChangeTheOutcome`, below).
   * Every code that rendered a Retry for a `clear_and_retry` reason still does.
   */
  const handleKickoffRetry = useCallback(() => {
    setErrorCode(null);
    setRetryAfterSeconds(null);
    // 140.3-15 / TS-20 — cleared with the code it belongs to. Leaving it would
    // let a second failure on a DIFFERENT path render the first one's id, which
    // is worse than rendering none: it points support at the wrong request.
    setUpstreamCorrelationId(null);
    setPhase("kicking_off");
    setKickoffNonce((n) => n + 1);
  }, []);

  /**
   * ⚠️ 140.4-11 / SEAMRIM-07 — TRAP-4, RESTATED AS A PROPERTY.
   *
   * TRAP-4 is registered against a STALE premise: it pins its hazard to
   * "`/api/keys/sync` … denies codeless", which `140.3-10` closed. A literal
   * reading therefore concludes the trap is discharged — and that is exactly
   * the reasoning that left the members of this render unexamined. The trap
   * this render is actually held to is:
   *
   *   A terminal error render must not offer a destructive control as the SOLE
   *   affordance, nor place a retry beside one. This is a property of the
   *   RENDER, not of a code list — and `recoverable` is NOT a usable proxy for
   *   it, because `try_another_key` earns `recoverable` for codes whose only
   *   "retry" re-evaluates an identical gate.
   *
   * WHAT THIS REPLACED, AND WHY THE REPLACEMENT IS A DIFFERENT MECHANISM.
   * `140.3-10` shipped a hand-typed EXEMPTION roster (`GATE_DRAFT_GONE`);
   * `140.3-12` widened it to two (`+ VALIDATION_FAILED`). Eleven distinct codes
   * reach this render. Of the nine left outside the roster exactly ONE —
   * `GATE_NO_DATA_SOURCE` — had the destructive control as its SOLE route (the
   * other eight render `[Retry, destructive]`, a bad pairing but not a forced
   * choice). The count of genuine sole-control violations was 1, not 9, and
   * that one code's `actions` are BYTE-IDENTICAL to `GATE_DRAFT_GONE`'s — the
   * code the roster was written for. It was forgotten anyway, which is what a
   * roster does: the phase's measured coverage for a hand-typed allow-list is
   * 9/37 codes · 8/15 files · 2/3 codes. Partial by construction.
   *
   * So the decision is INVERTED rather than widened. The destructive control is
   * now EARNED by the code's own `actions` — the same source `buildEnvelope`
   * derives `recoverable` from — and there is no second list to forget to edit.
   * The earning action is the one that actually means *replace the key*:
   * `try_another_key`. A code whose actions are `start_fresh` / `request_call` /
   * `clear_and_retry` has not asked for a control that deletes the draft.
   *
   * THREE conditions, each load-bearing, each rejecting an easier version:
   *
   *   1. `keyReplacementIsEarned` — read off the code table, not off
   *      `recoverable`. `recoverable` is true for `clear_and_retry` too, so it
   *      would re-admit `SYNC_FAILED`, `RATE_LIMITED`, `KEY_NETWORK_TIMEOUT`,
   *      `GATE_ANALYTICS_FAILED`, `UNKNOWN` and `COMPOSITE_MEMBERSHIP_UNKNOWN`
   *      — the last of which is a code ABOUT COMPOSITES rendering the
   *      SINGLE-KEY destructive control.
   *   2. `compositeReviewIsAvailable` — the composite route destroys nothing
   *      (`onReviewKeys` is a pure step transition, WIZ-03), so it is offered
   *      unconditionally. It requires the prop to be PRESENT: without it the
   *      button falls back to `onTryAnotherKey`, i.e. it is destructive while
   *      wearing the non-destructive label, and gating on `isComposite` alone
   *      would ship exactly that.
   *   3. The non-destructive `<Link>` renders ALWAYS, not as an else-branch.
   *      An either/or leaves `GATE_INSUFFICIENT_TRADES` and
   *      `GATE_INSUFFICIENT_DAYS` — which legitimately EARN key replacement and
   *      get no Retry (see below) — rendering the destructive button as their
   *      sole affordance, re-creating the very violation this closes one code
   *      over. "Never the sole affordance" is a claim about the whole control
   *      row, so the safe exit has to be unconditional.
   *
   * Referenced by NAME, never by line number: 140.2 comments falsified by
   * 140.3 commits are a measured class in this programme (7 of 17).
   */
  const errorActions: readonly WizardErrorAction[] = errorCode
    ? formatKeyError(errorCode).actions
    : [];
  /**
   * The composite "Review your keys" route is NON-destructive by construction
   * (WIZ-03: a pure step transition, no `handleDeleteDraft`, no fresh session),
   * so it needs no earning. The `Boolean(onReviewKeys)` term is the whole
   * safety of this line — see condition 2 above.
   */
  const compositeReviewIsAvailable = isComposite && Boolean(onReviewKeys);
  /**
   * `onTryAnotherKey` fires `handleDeleteDraft()` in WizardClient: it DESTROYS
   * the draft and every `strategy_keys` member under it. Correct for a REJECTED
   * key — which is what "this account has too little history, bring a different
   * one" means — and wrong everywhere else.
   */
  const keyReplacementIsEarned = errorActions.includes("try_another_key");
  const showKeyControl = compositeReviewIsAvailable || keyReplacementIsEarned;
  /**
   * ⚠️ `recoverable` SPLIT FROM "a kickoff retry will help" — the mislabel, not
   * a spurious flag.
   *
   * `onRetry` here is `handleKickoffRetry`, which re-runs the kickoff and then
   * re-evaluates an IDENTICAL gate. `GATE_INSUFFICIENT_TRADES` and
   * `GATE_INSUFFICIENT_DAYS` are `recoverable` — earned by `try_another_key`,
   * which is a genuine remedy — but the remedy is a different KEY, not a second
   * attempt at the same one. A Retry there promises the outcome can change when
   * nothing about the account has. So the handler is passed only when the code
   * asks for `clear_and_retry`, i.e. when the failure is transient.
   *
   * `ErrorEnvelope`'s `showRetry = recoverable && Boolean(onRetry)` is UNCHANGED
   * and does the rest — this is a decision about what this step passes, not a
   * change to a shared artefact. `RECOVERABLE_ACTIONS` and `buildEnvelope` are
   * deliberately untouched: `recoverable` still means "some action can help",
   * which is what the envelope's copy and its wait-countdown are keyed off.
   */
  const kickoffRetryCanChangeTheOutcome =
    errorActions.includes("clear_and_retry");

  // --- Rendering --------------------------------------------------------

  if (phase === "gate_failed" && errorEnvelope) {
    return (
      <section aria-labelledby="wizard-sync-heading">
        <h2
          id="wizard-sync-heading"
          className="font-sans text-h3 font-semibold text-text-primary"
        >
          {isComposite
            ? "We could not verify this composite"
            : "We could not verify this strategy"}
        </h2>
        <div className="mt-4">
          {/* The envelope names the offending member: computation_error is
              server-scrubbed and already threaded via buildEnvelope → the
              GATE_ANALYTICS_FAILED cause gains "Details: {computation_error}."
              (zero new plumbing). */}
          <WizardErrorEnvelope
            envelope={errorEnvelope}
            onRetry={
              kickoffRetryCanChangeTheOutcome ? handleKickoffRetry : undefined
            }
          />
        </div>
        <div className="mt-6 flex gap-3">
          {showKeyControl && (
            <Button
              type="button"
              onClick={
                compositeReviewIsAvailable && onReviewKeys
                  ? onReviewKeys
                  : onTryAnotherKey
              }
              data-testid="wizard-try-another-key"
            >
              {/* The label follows what the button DOES. Keying it off
                  `isComposite` alone put "Review your keys" on a click that
                  deletes the draft whenever `onReviewKeys` was absent. */}
              {compositeReviewIsAvailable ? "Review your keys" : "Try another key"}
            </Button>
          )}
          {/* UNCONDITIONAL — condition 3 above. Non-destructive, and it is the
              state's OWN fix line: "Start a new strategy from the strategies
              page." Navigating away destroys nothing, which is the property
              that matters both when the draft may still exist and simply not be
              ours to read, and when the only other control on the row deletes
              it. */}
          <Link href="/strategies" data-testid="wizard-back-to-strategies">
            <Button type="button" variant="ghost">
              Back to strategies
            </Button>
          </Link>
        </div>
      </section>
    );
  }

  if (phase === "passed" && snapshot && isComposite && snapshot.composite) {
    const composite = snapshot.composite;
    const memberCount = composite.members.length;
    // firstDay/lastDay = union of the per_key ACTUAL data days (min non-null
    // first_day / max non-null last_day). Omit the range clause when either is
    // absent (no-invented-data).
    const firstDays = composite.perKey
      .map((k) => k.first_day)
      .filter((d): d is string => d != null);
    const lastDays = composite.perKey
      .map((k) => k.last_day)
      .filter((d): d is string => d != null);
    const firstDay = firstDays.length > 0 ? firstDays.reduce((a, b) => (a < b ? a : b)) : null;
    const lastDay = lastDays.length > 0 ? lastDays.reduce((a, b) => (a > b ? a : b)) : null;
    const rangeClause =
      firstDay && lastDay ? `, ${firstDay} – ${lastDay}` : "";

    // activeWindow (the accent band) = the stitched ACTUAL data span, drawn over
    // the DECLARED bars. Null when either bound is absent — the gantt degrades.
    const activeWindow =
      firstDay && lastDay ? { start: firstDay, end: lastDay } : null;

    // Coverage gantt rows — DECLARED windows as bars, ordered by seq (defensive
    // re-sort so the render layer never depends on read order). TODAY closes an
    // open-ended window; inBlend=true for EVERY member (no auto-excluded state).
    // Two window conventions stay separate: these declared bars are half-open
    // `[start,end)`; the per_key attribution windows below are inclusive.
    const ganttToday = new Date().toISOString().slice(0, 10);
    const sortedMembers = [...composite.members].sort((a, b) => a.seq - b.seq);
    // R2-3: the declared `window_end` is HALF-OPEN (exclusive). The gantt's
    // `last` is the INCLUSIVE last day WITH data, so convert `end → end − 1 day`;
    // a still-live member (null `window_end`) keeps its open-ended treatment
    // (drawn through TODAY). Without this, adjacent disjoint windows overlap by
    // one day and contradict the correct inclusive attribution windows beside.
    const ganttLast = (m: (typeof sortedMembers)[number]): string =>
      m.windowEnd != null
        ? halfOpenEndToInclusiveLast(m.windowEnd)
        : ganttToday;
    const ganttSpans: CoverageSpan[] = sortedMembers.map((m) => ({
      first: m.windowStart,
      last: ganttLast(m),
    }));
    const ganttRows: CoverageTimelineRow[] = sortedMembers.map((m) => ({
      id: m.apiKeyId,
      name: memberDisplayName(m.seq, m.label, m.exchange),
      span: { first: m.windowStart, last: ganttLast(m) },
      inBlend: true,
    }));
    const ganttUnion = unionOf(ganttSpans);

    // Per-key attribution — signed contribution from the 89-01 pure helper on
    // the SERVED series (never a client re-stitch). Basis mirrors the server
    // branch VERBATIM via attributionBasisFromConfig. Exactly one call site
    // each (no duplicate derivation — one-spec discipline).
    const attributionBasis = attributionBasisFromConfig(
      composite.rawDenominatorConfig,
    );
    const attributionRows = partitionAttribution(
      composite.series,
      composite.perKey,
      attributionBasis,
    );
    const perKeyBySeq = new Map(composite.perKey.map((k) => [k.seq, k]));
    const memberBySeq = new Map(composite.members.map((m) => [m.seq, m]));
    // Reconciliation caption renders ONLY when the members' present days cover
    // the whole series — otherwise the "sums/compounds to the cumulative" claim
    // would not hold (fail-safe honesty; no-invented-data).
    const attributedDays = attributionRows.reduce((sum, r) => sum + r.days, 0);
    // R2-4: the count gate (`Σ member days == series.length`) is necessary but
    // NOT sufficient — corrupted `per_key` windows or a `.limit(20000)` series
    // truncation could satisfy it while the VALUE identity is false. Cheap
    // insurance: also reconstitute the composite return from the per-key
    // contributions (arithmetic Σ, or geometric Π(1+c)−1; a null no-data member
    // contributes 0 / factor 1) and epsilon-compare it to the SERVER's
    // cumulative_return. Suppress the "sums/compounds to the cumulative" claim
    // when they diverge (fail-safe honesty — never assert a false identity).
    const RECONCILE_EPSILON = 1e-4;
    const reconstitutedReturn =
      attributionBasis === "arithmetic"
        ? attributionRows.reduce((sum, r) => sum + (r.contribution ?? 0), 0)
        : attributionRows.reduce(
            (prod, r) => prod * (1 + (r.contribution ?? 0)),
            1,
          ) - 1;
    const cumulativeReturn = composite.cumulativeReturn;
    const valueReconciles =
      cumulativeReturn != null &&
      Number.isFinite(cumulativeReturn) &&
      Math.abs(reconstitutedReturn - cumulativeReturn) <= RECONCILE_EPSILON;
    const showReconciliationCaption =
      attributedDays === composite.series.length && valueReconciles;

    // Pre-submit warnings — gaps rendered VERBATIM from the server mask (the
    // client never recomputes gaps from windows) + amber DQ caveats. Both are
    // non-blocking; submit stays enabled on the passed path.
    const gapSpans = composite.gapSpans;
    const hasGaps = gapSpans.length > 0;
    const hasMtmCaveat = composite.mtmGatedReason != null;
    const hasBenchmarkCaveat = composite.benchmarkUnavailable;
    const hasInsufficientWindowCaveat = composite.insufficientWindow;
    const hasDegradedMembers = composite.degradedMembers.length > 0;
    const hasDqCaveat =
      hasMtmCaveat ||
      hasBenchmarkCaveat ||
      hasInsufficientWindowCaveat ||
      hasDegradedMembers;
    const hasWarnings = hasGaps || hasDqCaveat;

    return (
      <section aria-labelledby="wizard-sync-heading">
        <h2
          id="wizard-sync-heading"
          className="font-sans text-h3 font-semibold text-text-primary"
        >
          Your verified composite factsheet is ready
        </h2>
        <p className="mt-2 text-body text-text-secondary">
          {memberCount} key{memberCount === 1 ? "" : "s"} stitched into one
          continuous track record{rangeClause}. Review the composite below and
          continue to add metadata.
        </p>

        {/* KeyPermissionBadge OMITTED on the composite branch (FLAG-3) — a
            single badge would show only the first member's scopes and mislead. */}

        <div className="mt-6">
          <FactsheetPreview
            strategyName={"Your draft composite"}
            metrics={snapshot.metrics}
            sparklineReturns={snapshot.sparkline}
            computedAt={snapshot.computedAt}
            verificationState="draft"
          />
        </div>

        {/* Per-key attribution — signed contribution (89-01 partition), basis-
            honest, reconstitutes the composite cumulative. A real <table> per
            DESIGN.md data-density: no outer border, hairline row borders. */}
        <div className="mt-6">
          <p className="text-micro font-medium uppercase tracking-wider text-text-secondary">
            PER-KEY ATTRIBUTION
          </p>
          <table className="mt-2 w-full border-collapse text-left">
            <caption className="sr-only">
              Per-key attribution: each member key&rsquo;s data window, day
              count, and signed contribution to the composite cumulative return.
            </caption>
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="py-2 pr-4 text-caption font-medium text-text-secondary"
                >
                  #
                </th>
                <th
                  scope="col"
                  className="py-2 pr-4 text-caption font-medium text-text-secondary"
                >
                  Key
                </th>
                <th
                  scope="col"
                  className="py-2 pr-4 text-caption font-medium text-text-secondary"
                >
                  Data window
                </th>
                <th
                  scope="col"
                  className="py-2 pr-4 text-caption font-medium text-text-secondary"
                >
                  Days
                </th>
                <th
                  scope="col"
                  className="py-2 text-caption font-medium text-text-secondary"
                >
                  Contribution
                </th>
              </tr>
            </thead>
            <tbody>
              {attributionRows.map((row) => {
                const pk = perKeyBySeq.get(row.seq);
                const member = memberBySeq.get(row.seq);
                // Tier 1: actual reconstructed coverage when present. Tier 2:
                // the member's DECLARED entered window from strategy_keys (user-
                // entered metadata read from the DB, never invented) — so an
                // entered window never renders "—" behind a reconstructed
                // n_days=0. The Days column stays coverage-honest below. "live"
                // matches the wizard's open-ended (stillLive) vocabulary. Tier 3:
                // "—" only when no window was ever entered.
                const windowText =
                  pk?.first_day && pk?.last_day
                    ? `${pk.first_day} – ${pk.last_day}`
                    : member?.windowStart
                      ? `${member.windowStart} – ${member.windowEnd ?? "live"}`
                      : "—";
                const contributionClass =
                  row.contribution === null
                    ? "text-text-muted"
                    : row.contribution < 0
                      ? "text-negative"
                      : "text-positive";
                return (
                  <tr key={row.seq} className="border-b border-border">
                    <td className="py-2 pr-4 font-metric text-caption tabular-nums text-text-muted">
                      {row.seq}
                    </td>
                    <td className="py-2 pr-4 text-caption text-text-primary">
                      <span className="inline-flex items-center gap-2">
                        {memberDisplayName(
                          row.seq,
                          member?.label ?? null,
                          member?.exchange ?? null,
                        )}
                        <TrustTierLabel trustTier="api_verified" />
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-metric text-caption tabular-nums text-text-secondary">
                      {windowText}
                    </td>
                    <td className="py-2 pr-4 font-metric text-caption tabular-nums text-text-secondary">
                      {pk?.n_days ?? "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2 font-metric text-caption tabular-nums",
                        contributionClass,
                      )}
                    >
                      {formatContribution(row.contribution)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {showReconciliationCaption && (
              <tfoot>
                <tr>
                  <td
                    colSpan={5}
                    className="pt-2 text-caption text-text-muted"
                  >
                    {attributionBasis === "arithmetic"
                      ? "Contributions sum to the composite cumulative return."
                      : "Contributions compound to the composite cumulative return."}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Coverage mini-gantt — the REUSED CoverageTimeline (never rebuilt),
            one row per member by seq, declared windows as bars + the stitched
            actual span as the accent band. Gaps are NOT drawn here (FLAG-5);
            the warnings list below owns gap display. */}
        <div className="mt-6">
          <CoverageTimeline
            rows={ganttRows}
            unionWindow={ganttUnion}
            activeWindow={activeWindow}
          />
        </div>

        {/* Pre-submit warnings — neutral gaps (server-authoritative) + amber DQ
            caveats. Non-blocking; both role="status" aria-live="polite". */}
        {hasWarnings && (
          <div className="mt-6">
            <p className="text-micro font-medium uppercase tracking-wider text-text-secondary">
              BEFORE YOU SUBMIT
            </p>
            {hasGaps && (
              <div
                role="status"
                aria-live="polite"
                className="mt-2 rounded-md border border-border bg-page px-4 py-3"
              >
                <p className="text-caption font-medium text-text-primary">
                  Coverage gaps ({composite.gapDayCount} days total)
                </p>
                <ul className="mt-2 space-y-1">
                  {gapSpans.map((gap) => (
                    <li
                      key={`${gap.start}-${gap.end}`}
                      className="font-metric text-caption tabular-nums text-text-muted"
                    >
                      {gap.start} → {gap.end} (
                      {inclusiveGapDays(gap.start, gap.end)} days). Your
                      composite shows this as a break, not zero returns.
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {hasDqCaveat && (
              <div
                role="status"
                aria-live="polite"
                className="mt-2 rounded-md border border-warning/30 bg-warning/5 px-4 py-3"
              >
                <p className="text-caption font-medium text-warning">
                  Data quality
                </p>
                <div className="mt-1 space-y-1 text-caption text-text-secondary">
                  {hasMtmCaveat && (
                    <p>
                      Mark-to-market view unavailable — {composite.mtmGatedReason}
                      . Cash-settlement basis shown.
                      {/* Phase 133 review IN-03: on an options book the smoothed
                          basis opens what MTM keeps closed — say so, but ONLY on
                          the persisted server truth (hasBasisHeadline), never an
                          invented promise. */}
                      {composite.smoothedMtmAvailable &&
                        " A Smoothed mark-to-market view is available on the published factsheet."}
                    </p>
                  )}
                  {hasBenchmarkCaveat && (
                    <p>Benchmark overlay unavailable for this period.</p>
                  )}
                  {hasInsufficientWindowCaveat && (
                    <p>
                      Short track record — annualized metrics are computed on an
                      insufficient window and may not be meaningful.
                    </p>
                  )}
                  {hasDegradedMembers && (
                    <p>
                      {composite.degradedMembers
                        .map((d) => `Key ${d.seq} (${d.venue})`)
                        .join(", ")}{" "}
                      could not be included —{" "}
                      {composite.degradedMembers.length > 1 ? "their" : "its"} data
                      is excluded from this composite.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <Button onClick={handleUseThisKey} data-testid="wizard-use-this-key">
            Use this composite and continue
          </Button>
          <Button
            variant="ghost"
            onClick={isComposite && onReviewKeys ? onReviewKeys : onTryAnotherKey}
            data-testid="wizard-try-another-key"
          >
            Review your keys
          </Button>
        </div>
      </section>
    );
  }

  if (phase === "passed" && snapshot) {
    return (
      <section aria-labelledby="wizard-sync-heading">
        <h2
          id="wizard-sync-heading"
          className="font-sans text-h3 font-semibold text-text-primary"
        >
          Your verified factsheet is ready
        </h2>
        <p className="mt-2 text-body text-text-secondary">
          {snapshot.tradeCount > 0 ? (
            <>
              {snapshot.tradeCount} trade{snapshot.tradeCount === 1 ? "" : "s"}{" "}
              detected across{" "}
              {snapshot.detectedMarkets.length > 0
                ? snapshot.detectedMarkets.join(", ")
                : "your account"}
              . Review the preview and continue to add metadata.
            </>
          ) : (
            // Ledger-backed / CSV strategies have no trades — their history is a
            // daily-return series (P72). Show the series length instead of a
            // "0 trades detected" line.
            <>
              {snapshot.csvRowCount} day{snapshot.csvRowCount === 1 ? "" : "s"} of
              returns detected. Review the preview and continue to add metadata.
            </>
          )}
        </p>

        {/*
          Sprint 5 Task 5.8: informational scope badge. The route-level gate
          in /api/keys/validate-and-encrypt (line 26) already blocked any key
          with trade/withdraw before we got here, so by definition this should
          render Read ✓ / Trade ✗ / Withdraw ✗. The badge surfaces it for
          allocator confidence and confirms scopes haven't drifted.
        */}
        {apiKeyId && (
          <div className="mt-6">
            <KeyPermissionBadge apiKeyId={apiKeyId} />
          </div>
        )}

        <div className="mt-6">
          <FactsheetPreview
            strategyName={"Your draft strategy"}
            subtitle={
              snapshot.detectedMarkets.length > 0
                ? `Detected: ${snapshot.detectedMarkets.join(", ")}`
                : undefined
            }
            metrics={snapshot.metrics}
            sparklineReturns={snapshot.sparkline}
            computedAt={snapshot.computedAt}
            verificationState="draft"
          />
        </div>

        <div className="mt-6 flex gap-3">
          <Button onClick={handleUseThisKey} data-testid="wizard-use-this-key">
            Use this key and continue
          </Button>
          <Button
            variant="ghost"
            onClick={isComposite && onReviewKeys ? onReviewKeys : onTryAnotherKey}
            data-testid="wizard-try-another-key"
          >
            Try another key
          </Button>
        </div>
      </section>
    );
  }

  // Default: kicking_off / waiting_for_complete (spinner + elapsed)
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const showSlowHint = elapsedMs >= SLOW_HINT_MS;
  const showWarn = elapsedMs >= WARN_THRESHOLD_MS;
  const showRetry = elapsedMs >= RETRY_THRESHOLD_MS;
  // F-3 — the queue is auto-retrying during a `failed_retry` backoff; a manual
  // re-POST would INSERT A SECOND job (the partial-unique index + in-flight
  // SELECT both EXCLUDE `failed_retry`), so suppress the manual Retry and relabel
  // honestly. Only actionable when the route surfaces the status (channel alive).
  const isAutoRetrying = syncProgress?.jobStatus === "failed_retry";
  // F-1 — the amber recoverable "taking longer" banner (route stall OR the SF-1
  // backstop). Computed once so the red Error-severity `showRetry` block can be
  // suppressed when it is up: rendering both at t≈15min stacks two near-duplicate
  // banners with contradicting severity (red "leave this page" vs amber "retry
  // safely"). Composite-only (single-key never has the amber banner).
  const showInterruptedBanner =
    isComposite && (syncProgress?.stalled === true || stallBackstop);

  return (
    <section aria-labelledby="wizard-sync-heading">
      <h2
        id="wizard-sync-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        {isComposite
          ? "Stitching your composite track record"
          : "Computing your verified factsheet"}
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        {isComposite
          ? "We are reconstructing each key's history and stitching them into one continuous track. Usually takes 20–40 seconds."
          : "We are fetching your trade history from the exchange and computing risk metrics. Usually takes 15–30 seconds."}
      </p>

      <div className="mt-6 rounded-md border border-border bg-page px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          <p className="text-body font-medium text-text-primary">
            {computationStatus === "failed"
              ? "Sync reported a failure"
              : phase === "kicking_off"
                ? "Contacting exchange..."
                : isComposite
                  ? computationStatus === "computing"
                    ? "Trades are being processed…"
                    : "Trades are being downloaded…"
                  : computationStatus === "computing"
                    ? "Computing analytics..."
                    : "Fetching trades..."}
          </p>
          <span className="ml-auto font-metric text-caption tabular-nums text-text-muted">
            {elapsedSeconds}s
          </span>
        </div>

        {isComposite &&
          syncProgress?.memberProgress &&
          syncProgress.memberProgress.length > 0 && (
            <ul
              data-testid="wizard-member-progress"
              className="mt-3 space-y-1.5 border-t border-border pt-3"
            >
              {[...syncProgress.memberProgress]
                .sort((a, b) => a.seq - b.seq)
                .map((m) => {
                  const identity =
                    m.label ??
                    (m.exchange ? capitalizeExchange(m.exchange) : null);
                  return (
                    <li
                      key={m.seq}
                      data-testid={`member-progress-${m.seq}`}
                      className="flex items-center justify-between gap-3 text-caption"
                    >
                      <span className="text-text-secondary">
                        {`Key ${m.seq}`}
                        {identity ? ` — ${identity}` : ""}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center font-medium",
                          MEMBER_STATUS_CHIP_CLASS[m.status],
                        )}
                      >
                        {m.status === "in_process" && (
                          <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                        )}
                        {MEMBER_STATUS_LABEL[m.status]}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}

        {showSlowHint && !showWarn && (
          <p className="mt-2 text-caption text-text-muted">
            First sync of the day can take up to 45 seconds while the analytics
            service wakes up.
          </p>
        )}

        {showWarn && !showRetry && (
          <p className="mt-2 text-caption text-amber-600">
            This is a data-heavy operation and can take up to 15 minutes for
            large accounts with a long history. Your draft is saved.
          </p>
        )}

        {showRetry && !showInterruptedBanner && (
          <div className="mt-2 space-y-2">
            <p className="text-caption text-negative">
              Sync is taking much longer than expected. You can leave this page
              and come back — the draft is saved.
            </p>
          </div>
        )}
      </div>

      {/* PROG-03 / SF-1 — distinct, recoverable "taking longer" state. Shows
          when the route stall channel fires (`syncProgress.stalled`,
          job-heartbeat-derived) OR the elapsed-patience BACKSTOP fires
          (`stallBackstop`: computation_status unchanged past RETRY_THRESHOLD_MS)
          — so a genuine stall is NEVER an indefinite hang even when the cosmetic
          sync-progress channel is dead. The backstop respects RT-1: a re-stitch
          that resets analytics to pending CHANGES the status and resets the
          stall clock, so it is not inferred from a status regression. Renders
          ALONGSIDE the spinner card — polling continues, the job may
          self-recover via the watchdog reclaim. Amber = recoverable, not red.
          When up, it SUPPRESSES the red `showRetry` Error block above (F-1) —
          exactly one banner renders for a stuck composite. */}
      {showInterruptedBanner && (
        <div
          data-testid="wizard-sync-interrupted"
          role="status"
          className="mt-4 rounded-md border border-warning/40 bg-warning/5 px-4 py-3"
        >
          <p className="text-body font-medium text-text-primary">
            This sync is taking longer than expected
          </p>
          {isAutoRetrying ? (
            // F-3 — the queue is AUTO-RETRYING (`failed_retry` backoff). A manual
            // re-POST would INSERT A SECOND stitch (the partial-unique index +
            // the in-flight SELECT both EXCLUDE `failed_retry`), so relabel
            // honestly and suppress the manual Retry — the job retries on its own.
            <p
              className="mt-1 text-caption text-text-secondary"
              data-testid="wizard-sync-auto-retrying"
            >
              The sync is retrying automatically — no action needed.
            </p>
          ) : (
            <>
              <p className="mt-1 text-caption text-text-secondary">
                You can retry safely — a healthy run already in progress is
                unaffected.
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleRetrySync}
                disabled={retrying}
                className="mt-3"
                data-testid="wizard-sync-retry"
              >
                {retrying ? "Retrying…" : "Retry sync"}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
