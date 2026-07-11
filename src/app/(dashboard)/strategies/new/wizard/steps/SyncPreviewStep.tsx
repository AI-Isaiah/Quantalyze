"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  gateFailureToWizardError,
  type WizardErrorCode,
} from "@/lib/wizardErrors";
import { buildEnvelope } from "@/lib/envelope";
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
  partitionAttribution,
  attributionBasisFromConfig,
} from "@/lib/composite/compositeAttribution";
import { TrustTierLabel } from "@/components/strategy/TrustTierLabel";
import { parseIsoDay, utcEpoch } from "@/lib/dateday";

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

/**
 * Read the correlation_id from the <meta name="x-correlation-id"> tag the
 * root layout renders server-side (Plan 16-02 / OBSERV-09). Falls back to
 * a fresh UUID v4 when the meta tag is absent (e.g., during the parallel
 * wave window when 16-02 has not yet merged into this branch).
 */
function readCorrelationId(): string {
  if (typeof document !== "undefined") {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="x-correlation-id"]',
    );
    const value = meta?.getAttribute("content");
    if (value && value.length > 0) return value;
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  benchmarkUnavailable: boolean;
  benchmarkNote: string | null;
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

export function SyncPreviewStep({
  strategyId,
  apiKeyId,
  wizardSessionId,
  onComplete,
  onTryAnotherKey,
}: SyncPreviewStepProps) {
  const [phase, setPhase] = useState<Phase>("kicking_off");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorCode, setErrorCode] = useState<WizardErrorCode | null>(null);
  const [gateResult, setGateResult] = useState<StrategyGateResult | null>(null);
  const [snapshot, setSnapshot] = useState<SyncPreviewSnapshot | null>(null);
  const [expandLog, setExpandLog] = useState(false);
  const [computationStatus, setComputationStatus] = useState<string | null>(null);
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
  // Phase 16 Plan 06: correlation_id for the envelope. See readCorrelationId().
  const [correlationId] = useState<string>(() => readCorrelationId());
  // useRef initializer must be a non-impure value for React Compiler's
  // purity rule. Real start time is set in the mount effect.
  const startedAtRef = useRef<number>(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    startedAtRef.current = Date.now();
    (async () => {
      try {
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
        const { data: existing } = await supabase
          .from("strategy_analytics")
          .select("computation_status, computed_at")
          .eq("strategy_id", strategyId)
          .maybeSingle();
        const computedAtMs = existing?.computed_at
          ? Date.parse(existing.computed_at)
          : null;
        const isFresh =
          isComputedAnalytics(existing?.computation_status) &&
          computedAtMs !== null &&
          Number.isFinite(computedAtMs) &&
          Date.now() - computedAtMs < SYNC_FRESHNESS_WINDOW_MS;
        if (isFresh) {
          // R2-2 (freshness-skip resume): the kickoff POST is SKIPPED here, so
          // there is no server `composite` field to thread. Determine
          // composite-ness DETERMINISTICALLY from the marker the stitch worker
          // persists (`data_quality_flags.composite`) via a SEPARATE lightweight
          // read — we do NOT re-derive/re-enqueue a fresh composite, and we do
          // NOT touch the frozen `computation_status, computed_at` read above.
          // Fail CLOSED to SYNC_FAILED when the marker row can't be read (error
          // or missing row) rather than silently routing a possible composite
          // through the single-key arm. A present row WITHOUT the marker is
          // definitively single-key/CSV → byte-neutral resume.
          const { data: dqRow, error: dqErr } = await supabase
            .from("strategy_analytics")
            .select("data_quality_flags")
            .eq("strategy_id", strategyId)
            .maybeSingle();
          if (!mountedRef.current) return;
          if (dqErr || !dqRow) {
            setErrorCode("SYNC_FAILED");
            setPhase("gate_failed");
            return;
          }
          const dqFlags = (dqRow.data_quality_flags ?? {}) as {
            composite?: unknown;
          };
          if (dqFlags.composite === true) setIsComposite(true);
          setPhase("waiting_for_complete");
          return;
        }
        const res = await fetch("/api/keys/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy_id: strategyId }),
        });
        if (!res.ok) {
          // A non-2xx kickoff — INCLUDING the 503 the route returns when
          // composite membership is UNKNOWABLE — fails CLOSED: surface the
          // recoverable SYNC_FAILED envelope, never silently assume single-key.
          if (mountedRef.current) {
            setErrorCode("SYNC_FAILED");
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
  }, [strategyId]);

  useEffect(() => {
    if (phase !== "waiting_for_complete" && phase !== "kicking_off") return;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "waiting_for_complete") return;
    const supabase = createClient();

    // `stopped` is checked at the top of every tick AND before every
    // self-reschedule so the loop hard-stops the instant the effect
    // tears down (phase change / strategyId change / unmount). The old
    // setInterval relied on the effect re-running to clear the timer,
    // which left the previous interval's closure firing 1-2 extra polls
    // against a stale `phase` after a setPhase() (H-0195). A
    // self-scheduling setTimeout with a local guard cannot fire again
    // once cleared.
    let stopped = false;
    let timerId: number | undefined;
    let tick = 0;
    // Count of CONSECUTIVE status-read failures (Supabase `error` or a
    // transport throw before the terminal fetch); reset to 0 on any clean
    // status read.
    let consecutiveErrors = 0;
    // Count of CONSECUTIVE terminal/heavy-fetch failures. Tracked separately
    // from `consecutiveErrors` because the narrow status read can keep
    // succeeding (resetting `consecutiveErrors`) while the heavy Promise.all
    // persistently REJECTS — e.g. a network blip, an aborted fetch, or a
    // transport-level error on a trades/api_keys query. (A Supabase error
    // returned AS A VALUE — `{ data, error }` with a non-null `error` — is NOT
    // caught here: the destructured results ignore `.error`, so e.g. an RLS
    // denial on `trades` drops `tradeCount` to 0 via `?? 0` and the gate fails
    // with INSUFFICIENT_TRADES — a terminal, loop-stopping outcome, not a
    // heavyFetchErrors escalation.) With a shared counter a persistent throw
    // oscillates 0→1→0 and never escalates, so the wizard spins forever
    // (H-0197, narrowed to heavy-fetch-only faults). A dedicated counter never
    // needs a reset: every non-throwing heavy outcome (passed / gate-fail)
    // sets `stopped = true` and terminates the loop, so the only path that
    // reschedules is a throw.
    let heavyFetchErrors = 0;

    const scheduleNext = () => {
      if (stopped) return;
      const delay =
        POLL_BACKOFF_MS[Math.min(tick, POLL_BACKOFF_MS.length - 1)];
      tick += 1;
      timerId = window.setTimeout(poll, delay);
    };

    /**
     * Stop polling and surface a recoverable SYNC_FAILED envelope. Used
     * when the status read keeps failing (H-0197 / H-0198) so the user
     * gets an exit affordance instead of an indefinite spinner. Fires
     * the same `wizard_error` funnel event as the gate-failure path so
     * the drop-off is recorded in PostHog.
     */
    const failPolling = () => {
      if (stopped || !mountedRef.current) return;
      stopped = true;
      setErrorCode("SYNC_FAILED");
      setPhase("gate_failed");
      trackForQuantsEventClient("wizard_error", {
        wizard_session_id: wizardSessionId,
        step: "sync_preview",
        code: "SYNC_FAILED",
      });
    };

    const poll = async () => {
      if (stopped) return;
      try {
        // Lightweight status poll: only read the two status columns
        // while we wait for completion so each tick is cheap. The
        // heavy analytics columns (sparkline, metrics) only load once
        // on the terminal state.
        const { data: statusRow, error: statusError } = await supabase
          .from("strategy_analytics")
          .select("computation_status, computation_error")
          .eq("strategy_id", strategyId)
          .maybeSingle();

        if (stopped) return;

        // A Supabase `error` (RLS denial, transient 503) is NOT the same
        // as a genuine `pending` row. Without this branch an RLS
        // regression returns { data: null, error } and `nextStatus`
        // silently collapses to "pending" via the ?? default — the
        // wizard then spins forever on a permissions misconfig nobody
        // can see (H-0198). Treat it as a poll failure and let the
        // consecutive-error counter escalate.
        if (statusError) {
          console.error(
            "[wizard:SyncPreviewStep] poll status error:",
            statusError,
          );
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            failPolling();
            return;
          }
          scheduleNext();
          return;
        }

        consecutiveErrors = 0;

        const nextStatus = statusRow?.computation_status ?? "pending";
        const nextError = statusRow?.computation_error ?? null;
        setComputationStatus((prev) => (prev === nextStatus ? prev : nextStatus));
        setComputationError((prev) => (prev === nextError ? prev : nextError));

        // Hard-failure terminal state. Bail BEFORE the heavy Promise.all
        // (H-0195): on `failed` the analytics row is errored, so the 5
        // trades/api_keys queries are pure waste, and the gate would only
        // ever map this to GATE_ANALYTICS_FAILED anyway. Route straight
        // to the scripted analytics-failed envelope, carrying
        // computation_error for the detail line, and stop polling.
        if (nextStatus === "failed") {
          stopped = true;
          if (!mountedRef.current) return;
          setErrorCode("GATE_ANALYTICS_FAILED");
          setPhase("gate_failed");
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: "sync_preview",
            code: "GATE_ANALYTICS_FAILED",
          });
          return;
        }

        // Terminal SUCCESS includes complete_with_warnings — else a warned
        // first compute (e.g. a Deribit onboarding tripping a DQ guard) polls
        // forever, since the runner now persists that status instead of it
        // being laundered to 'complete' (mig 20260707120000).
        if (!isComputedAnalytics(nextStatus)) {
          scheduleNext();
          return;
        }

        // Terminal state reached. Fetch the heavy analytics row, trade
        // count + span, sample symbols for market detection, and the
        // exchange name in one Promise.all so the user moves to the
        // factsheet preview as fast as possible.
        //
        // Wrapped in its own try/catch (separate from the status-read catch
        // below) so a persistently-throwing heavy fetch escalates via
        // `heavyFetchErrors` instead of being masked by the line-above
        // `consecutiveErrors = 0` reset. One transient heavy fault is still
        // tolerated; the threshold matches the status-read path.
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

            if (!mountedRef.current) return;

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
              scheduleNext();
              return;
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
                benchmarkUnavailable: dq.benchmark_unavailable === true,
                benchmarkNote: dq.benchmark_note ?? null,
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

            stopped = true;
            setSnapshot(compositeSnapshot);
            setPhase("passed");
            return;
          }

          const [
            { data: analytics },
            { count: tradeCount },
            { data: earliest },
            { data: latest },
            { data: sample },
            { count: csvRowCount },
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

          const detectedMarkets = deriveDetectedMarkets(
            (sample ?? []).map((t) => (t as { symbol?: string }).symbol),
          );

          const keyRow = keyRowResult.data;

          if (!mountedRef.current) return;

          const gate = checkStrategyGate({
            apiKeyId,
            tradeCount: tradeCount ?? 0,
            earliestTradeAt: earliest?.[0]?.timestamp
              ? new Date(earliest[0].timestamp)
              : null,
            latestTradeAt: latest?.[0]?.timestamp
              ? new Date(latest[0].timestamp)
              : null,
            computationStatus: nextStatus,
            computationError: nextError,
            csvRowCount: csvRowCount ?? 0,
            // P72 — only a ledger-backed (Deribit) keyed strategy may pass on a
            // daily-returns series; a keyed perp with 0 fills must stay on the
            // trade branch (its funding series has no completeness gate).
            isLedgerBacked: isLedgerBackedExchange(keyRow?.exchange),
          });

          if (!gate.passed) {
            stopped = true;
            setGateResult(gate);
            const wizardCode = gate.code ? gateFailureToWizardError(gate.code) : "UNKNOWN";
            setErrorCode(wizardCode);
            setPhase("gate_failed");
            trackForQuantsEventClient("wizard_error", {
              wizard_session_id: wizardSessionId,
              step: "sync_preview",
              code: wizardCode,
              trade_count: tradeCount ?? 0,
            });
            return;
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
            tradeCount: tradeCount ?? 0,
            csvRowCount: csvRowCount ?? 0,
            earliestTradeAt: earliest?.[0]?.timestamp ?? null,
            latestTradeAt: latest?.[0]?.timestamp ?? null,
            detectedMarkets,
            exchange: keyRow?.exchange ?? null,
            metrics,
            sparkline: Array.isArray(analytics?.sparkline_returns)
              ? (analytics.sparkline_returns as number[])
              : null,
            computedAt: analytics?.computed_at ?? null,
          };

          stopped = true;
          setSnapshot(nextSnapshot);
          setPhase("passed");
        } catch (heavyErr) {
          // The terminal fetch / gate evaluation threw (network blip, an
          // aborted fetch, or a transport-level rejection). One transient
          // fault is tolerated, but a persistent heavy-fetch fault
          // must escalate — the narrow status read keeps succeeding above,
          // so `consecutiveErrors` would never reach the threshold (H-0197,
          // heavy-fetch-narrowed). Count consecutive heavy failures and
          // surface the recoverable SYNC_FAILED envelope past the threshold.
          if (stopped) return;
          console.error(
            "[wizard:SyncPreviewStep] terminal fetch error:",
            heavyErr,
          );
          heavyFetchErrors += 1;
          if (heavyFetchErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
            failPolling();
            return;
          }
          scheduleNext();
        }
      } catch (err) {
        // A thrown status read (network blip, aborted fetch, transient 503)
        // is tolerated once, but repeated throws must not leave the wizard
        // spinning forever (H-0197). Count consecutive failures and
        // escalate to a recoverable SYNC_FAILED envelope past the
        // threshold; otherwise back off and retry.
        if (stopped) return;
        console.error("[wizard:SyncPreviewStep] poll error:", err);
        consecutiveErrors += 1;
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          failPolling();
          return;
        }
        scheduleNext();
      }
    };

    // Schedule the first poll after one base interval, exactly matching
    // the replaced setInterval's first-tick latency (setInterval also
    // waits one period before its first callback) so resume/timing
    // behaviour is unchanged.
    timerId = window.setTimeout(poll, POLL_BACKOFF_MS[0]);

    return () => {
      stopped = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [phase, strategyId, apiKeyId, wizardSessionId, isComposite]);

  const handleUseThisKey = useCallback(() => {
    if (snapshot) onComplete(snapshot);
  }, [snapshot, onComplete]);

  const errorEnvelope = errorCode
    ? buildEnvelope(errorCode, correlationId, {
        trades: gateResult?.detail?.trades as number | undefined,
        days: gateResult?.detail?.days as number | undefined,
        computationError: computationError,
      })
    : null;

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
          <WizardErrorEnvelope envelope={errorEnvelope} />
        </div>
        <div className="mt-6 flex gap-3">
          <Button
            type="button"
            onClick={onTryAnotherKey}
            data-testid="wizard-try-another-key"
          >
            {isComposite ? "Review your keys" : "Try another key"}
          </Button>
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
    const hasDqCaveat = hasMtmCaveat || hasBenchmarkCaveat;
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
                const windowText =
                  pk?.first_day && pk?.last_day
                    ? `${pk.first_day} – ${pk.last_day}`
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
                    </p>
                  )}
                  {hasBenchmarkCaveat && (
                    <p>Benchmark overlay unavailable for this period.</p>
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
            onClick={onTryAnotherKey}
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
            onClick={onTryAnotherKey}
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
                  ? "Stitching composite…"
                  : computationStatus === "computing"
                    ? "Computing analytics..."
                    : "Fetching trades..."}
          </p>
          <span className="ml-auto font-metric text-caption tabular-nums text-text-muted">
            {elapsedSeconds}s
          </span>
        </div>

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

        {showRetry && (
          <div className="mt-2 space-y-2">
            <p className="text-caption text-negative">
              Sync is taking much longer than expected. You can leave this page
              and come back — the draft is saved.
            </p>
          </div>
        )}

        {showWarn && (
          <button
            type="button"
            onClick={() => setExpandLog((v) => !v)}
            className="mt-2 text-micro text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
            data-testid="wizard-sync-expand-log"
          >
            {expandLog ? "Hide details" : "Show me what is happening"}
          </button>
        )}

        {expandLog && (
          <pre className="mt-2 overflow-x-auto rounded border border-border bg-white px-3 py-2 text-micro text-text-muted">
            strategy_id={strategyId}
            {"\n"}
            status={computationStatus ?? "unknown"}
            {"\n"}
            elapsed={elapsedSeconds}s{"\n"}
            {computationError ? `error=${computationError}\n` : ""}
          </pre>
        )}
      </div>
    </section>
  );
}
