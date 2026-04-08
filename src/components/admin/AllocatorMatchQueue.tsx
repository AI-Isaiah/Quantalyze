"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { computeFreshness } from "@/lib/freshness";
import { displayStrategyName } from "@/lib/strategy-display";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { CandidateDetail } from "@/components/admin/CandidateDetail";
import { SendIntroPanel } from "@/components/admin/SendIntroPanel";
import { PreferencesPanel } from "@/components/admin/PreferencesPanel";

/**
 * Reactive media-query hook. Returns true when the query matches.
 *
 * Used to gate keyboard shortcuts to lg+ viewports without forcing a
 * separate mobile component tree. Implemented with useSyncExternalStore
 * so we don't fall into the "setState inside useEffect" anti-pattern
 * the React compiler (rightly) complains about. The SSR snapshot is
 * `false` so the read-only mobile UI hydrates first — flipping the
 * other way would briefly expose write actions before JS classifies
 * the viewport.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  }, [query]);
  const getServerSnapshot = useCallback(() => false, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// ─── Types ──────────────────────────────────────────────────────────────

interface ScoreBreakdown {
  preference_fit?: number;
  track_record?: number;
  capacity_fit?: number;
  portfolio_fit?: number;
  raw?: {
    corr_with_portfolio?: number | null;
    sharpe_lift?: number | null;
    dd_improvement?: number | null;
    track_record_days?: number | null;
    manager_aum?: number | null;
    ticket_concentration?: number | null;
    sharpe?: number | null;
    max_drawdown_pct?: number | null;
  };
}

export interface CandidateRow {
  id: string;
  strategy_id: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  reasons: string[];
  rank: number | null;
  exclusion_reason: string | null;
  exclusion_provenance: string | null;
  strategies: {
    id: string;
    name: string;
    codename: string | null;
    disclosure_tier: "institutional" | "exploratory" | null;
    strategy_types: string[] | null;
    supported_exchanges: string[] | null;
    aum: number | null;
    max_capacity: number | null;
    user_id: string;
  } | null;
  analytics: {
    sharpe: number | null;
    sortino: number | null;
    max_drawdown: number | null;
    cagr: number | null;
    volatility: number | null;
    six_month_return: number | null;
    cumulative_return: number | null;
    total_aum: number | null;
    sparkline_returns: unknown;
  } | null;
}

interface MatchBatch {
  id: string;
  computed_at: string;
  mode: "personalized" | "screening";
  filter_relaxed: boolean;
  candidate_count: number;
  excluded_count: number;
  engine_version: string;
  weights_version: string;
  effective_preferences: Record<string, unknown>;
  effective_thresholds: Record<string, unknown>;
  source_strategy_count: number;
  latency_ms: number | null;
}

interface Profile {
  id: string;
  display_name: string;
  company: string | null;
  email: string | null;
  role: string;
  allocator_status: string;
  preferences_updated_at: string | null;
}

export interface AllocatorPreferences {
  user_id: string;
  mandate_archetype: string | null;
  target_ticket_size_usd: number | null;
  excluded_exchanges: string[] | null;
  max_drawdown_tolerance: number | null;
  min_track_record_days: number | null;
  min_sharpe: number | null;
  max_aum_concentration: number | null;
  preferred_strategy_types: string[] | null;
  preferred_markets: string[] | null;
  founder_notes: string | null;
  updated_at: string;
}

interface Decision {
  id: string;
  strategy_id: string;
  decision: string;
  founder_note: string | null;
  contact_request_id: string | null;
  created_at: string;
  strategies?: {
    id: string;
    name: string;
    codename: string | null;
    disclosure_tier: "institutional" | "exploratory" | null;
  } | null;
}

interface QueueData {
  profile: Profile;
  preferences: AllocatorPreferences | null;
  batch: MatchBatch | null;
  candidates: CandidateRow[];
  excluded: CandidateRow[];
  decisions: Decision[];
  existing_contact_requests: { strategy_id: string; created_at: string; status: string }[];
}

// ─── Component ──────────────────────────────────────────────────────────

export function AllocatorMatchQueue({ allocatorId }: { allocatorId: string }) {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [recomputing, setRecomputing] = useState(false);
  const [sendIntroFor, setSendIntroFor] = useState<CandidateRow | null>(null);
  const [showPreferencesPanel, setShowPreferencesPanel] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // Viewport classification.
  //   lg+ (1024+): keyboard shortcuts on, two-pane layout, full write mode
  //   below lg: single-column stacked layout (list on top, detail below)
  //   below md (768): read-only banner rendered above the list; the action
  //     buttons still exist but a visible warning discourages use.
  const isLg = useMediaQuery("(min-width: 1024px)");

  // Track in-flight load requests to prevent a stale response from overwriting
  // a newer one. Incremented on each load(); responses only apply if they match
  // the current id.
  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    const thisLoadId = ++loadIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/match/${allocatorId}`);
      if (loadIdRef.current !== thisLoadId) return; // A newer load is in flight
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load match queue");
      }
      const json = await res.json();
      if (loadIdRef.current !== thisLoadId) return;
      setData(json);
    } catch (err) {
      if (loadIdRef.current !== thisLoadId) return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (loadIdRef.current === thisLoadId) {
        setLoading(false);
      }
    }
  }, [allocatorId]);

  useEffect(() => {
    load();
    return () => {
      // On unmount or allocator change, invalidate any in-flight response.
      // We INCREMENT the ref here (not read it), so the usual "capture in
      // variable" lint guidance doesn't apply — the bump is the point.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loadIdRef.current++;
    };
  }, [load]);

  const selectedCandidate = data?.candidates[selectedIdx] ?? null;

  const handleRecompute = useCallback(async () => {
    setRecomputing(true);
    try {
      const res = await fetch("/api/admin/match/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocator_id: allocatorId, force: true }),
      });
      const body = await res.json();
      if (body.disabled) {
        alert("Engine is disabled. Re-enable it from the match queue index.");
      } else {
        await load();
      }
    } catch (err) {
      alert(`Recompute failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setRecomputing(false);
    }
  }, [allocatorId, load]);

  const handleDecision = useCallback(
    async (strategyId: string, decision: "thumbs_up" | "thumbs_down" | "snoozed", candidateId: string | null) => {
      // Optimistic: local refetch after write
      try {
        const res = await fetch("/api/admin/match/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allocator_id: allocatorId,
            strategy_id: strategyId,
            candidate_id: candidateId,
            decision,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        load();
      } catch (err) {
        alert(`Failed to save decision: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [allocatorId, load],
  );

  // Keyboard shortcuts — only active at lg+ (1024+) per Sprint 4 T10.1.
  // Each handler short-circuits via the isLg check; we still register the
  // hook unconditionally so the listener doesn't churn on viewport changes.
  useKeyboardShortcuts([
    {
      key: "j",
      handler: () => {
        if (!isLg || !data?.candidates.length) return;
        setSelectedIdx((i) => Math.min(i + 1, data.candidates.length - 1));
      },
    },
    {
      key: "k",
      handler: () => {
        if (!isLg) return;
        setSelectedIdx((i) => Math.max(i - 1, 0));
      },
    },
    {
      key: "s",
      handler: () => {
        if (!isLg) return;
        if (selectedCandidate) setSendIntroFor(selectedCandidate);
      },
    },
    {
      key: "u",
      handler: () => {
        if (!isLg) return;
        if (selectedCandidate) {
          handleDecision(selectedCandidate.strategy_id, "thumbs_up", selectedCandidate.id);
        }
      },
    },
    {
      key: "d",
      handler: () => {
        if (!isLg) return;
        if (selectedCandidate) {
          handleDecision(selectedCandidate.strategy_id, "thumbs_down", selectedCandidate.id);
        }
      },
    },
    {
      key: "r",
      handler: () => {
        if (!isLg) return;
        handleRecompute();
      },
    },
  ]);

  // Shortcut help overlay: bound to "?" (Shift+/). Stricter than the
  // useKeyboardShortcuts hook because we want it to fire ONLY when the
  // user has nothing focused — body. This excludes the case where a
  // slide-out panel is open and focus has moved into it. Esc closes the
  // modal via the native <dialog> behavior.
  useEffect(() => {
    if (!isLg) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "?") return;
      // Strict body check: only fire on the bare page, not over an open
      // modal/slide-out/input. document.body is the activeElement when
      // nothing is focused.
      if (document.activeElement !== document.body) return;
      e.preventDefault();
      setShowShortcutHelp(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isLg]);

  // ─── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return <MatchQueueSkeleton />;
  }
  if (error || !data) {
    return (
      <Card className="border-negative/40">
        <p className="text-sm text-negative">{error || "Failed to load"}</p>
        <Button variant="secondary" size="sm" onClick={load} className="mt-3">
          Retry
        </Button>
      </Card>
    );
  }

  const { profile, preferences, batch, candidates, excluded, decisions, existing_contact_requests } = data;
  const sentStrategyIds = new Set(existing_contact_requests.map((cr) => cr.strategy_id));
  const thumbsUpIds = new Set(
    decisions.filter((d) => d.decision === "thumbs_up").map((d) => d.strategy_id),
  );
  const thumbsDownIds = new Set(
    decisions.filter((d) => d.decision === "thumbs_down").map((d) => d.strategy_id),
  );

  const hoursAgo = batch?.computed_at
    ? Math.floor((Date.now() - Date.parse(batch.computed_at)) / 3_600_000)
    : null;
  const isStale = computeFreshness(batch?.computed_at ?? null) === "stale";
  const topThree = candidates.slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-text-muted">
        <Link href="/admin/match" className="hover:text-text-primary">
          Match queue
        </Link>
        <span>/</span>
        <span className="text-text-primary">
          {profile.display_name || profile.email}
        </span>
      </nav>

      {/* Read-only mobile banner: below the md breakpoint (768px) the queue
          hides all KEEP/SKIP/SENT actions so a founder accidentally demoing
          from their phone doesn't record a decision with the wrong intent. */}
      <div className="md:hidden rounded-md border border-accent/30 bg-accent/5 px-4 py-3">
        <p className="text-sm text-text-primary">
          <strong className="font-semibold">Read-only on mobile.</strong>{" "}
          Open on a desktop or tablet (1024px+) to use keyboard shortcuts
          and record KEEP / SKIP / Send Intro decisions.
        </p>
      </div>

      {/* Header strip */}
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[24px] font-display text-text-primary">
              {profile.display_name || "(unknown)"}
            </h1>
            {profile.company && (
              <p className="text-sm text-text-secondary mt-0.5">{profile.company}</p>
            )}
            {preferences?.mandate_archetype && (
              <p className="text-sm text-text-secondary mt-2 italic">
                &ldquo;{preferences.mandate_archetype}&rdquo;
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {batch && <ModeBadge mode={batch.mode} />}
            {hoursAgo !== null && (
              <span
                className={`text-[11px] font-mono uppercase tracking-wider ${
                  isStale ? "text-negative" : "text-text-muted"
                }`}
              >
                {isStale ? "Stale: " : "Computed "}
                {hoursAgo < 24
                  ? `${hoursAgo}h ago`
                  : `${Math.floor(hoursAgo / 24)}d ago`}
              </span>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <Button
            variant="primary"
            size="sm"
            onClick={handleRecompute}
            disabled={recomputing}
          >
            {recomputing ? "Computing..." : "Recompute now"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowPreferencesPanel(true)}
          >
            Edit preferences
          </Button>
          {batch && (
            <span className="ml-auto text-[11px] text-text-muted font-mono tabular-nums">
              {candidates.length} candidates ·{" "}
              {decisions.filter((d) => d.decision === "sent_as_intro").length} sent ·{" "}
              {decisions.filter((d) => d.decision === "thumbs_up").length} kept
            </span>
          )}
        </div>
      </Card>

      {/* Filter-relaxed callout */}
      {batch?.filter_relaxed && (
        <div className="rounded-md border border-negative/40 bg-transparent px-4 py-3">
          <p className="text-sm text-text-primary">
            Eligibility was relaxed to find these. Review carefully.
          </p>
        </div>
      )}

      {/* Empty states */}
      {!batch && (
        <Card className="text-center py-12">
          <p className="text-sm text-text-secondary mb-4">
            No candidates yet for this allocator.
          </p>
          <Button variant="primary" size="sm" onClick={handleRecompute} disabled={recomputing}>
            {recomputing ? "Computing..." : "Recompute now"}
          </Button>
        </Card>
      )}
      {batch && candidates.length === 0 && (
        <Card className="text-center py-10">
          <p className="text-sm text-text-muted">
            No eligible candidates for this batch. Try editing preferences or relaxing criteria.
          </p>
        </Card>
      )}

      {/* Shortlist strip (top 3 cards, above the fold) */}
      {candidates.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Shortlist
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {topThree.map((cand, i) => (
              <ShortlistCard
                key={cand.id}
                candidate={cand}
                selected={selectedIdx === i}
                alreadySent={sentStrategyIds.has(cand.strategy_id)}
                onSelect={() => setSelectedIdx(i)}
                onSendIntro={() => setSendIntroFor(cand)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Two-pane: left rail + sticky right detail */}
      {candidates.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
          {/* Left rail */}
          <Card className="p-0 max-h-[600px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold w-10">
                    #
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                    Strategy
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-text-muted font-semibold">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((cand, i) => {
                  const selected = selectedIdx === i;
                  const sent = sentStrategyIds.has(cand.strategy_id);
                  const kept = thumbsUpIds.has(cand.strategy_id);
                  const skipped = thumbsDownIds.has(cand.strategy_id);
                  return (
                    <tr
                      key={cand.id}
                      onClick={() => setSelectedIdx(i)}
                      className={`border-b border-border cursor-pointer transition-colors ${
                        selected
                          ? "bg-accent/5 border-l-2 border-l-accent"
                          : "hover:bg-page"
                      } ${sent ? "opacity-50" : ""}`}
                    >
                      <td className="px-3 py-2 font-mono tabular-nums text-xs text-text-muted">
                        {cand.rank}
                      </td>
                      <td className="px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {displayStrategyName(cand.strategies)}
                          </p>
                          {cand.reasons[0] && (
                            <p className="text-xs text-text-secondary truncate max-w-[260px]">
                              {cand.reasons[0]}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider">
                            {sent && (
                              <span className="text-text-muted">SENT</span>
                            )}
                            {kept && !sent && (
                              <span className="text-accent">KEPT</span>
                            )}
                            {skipped && !sent && (
                              <span className="text-text-muted line-through">SKIP</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <ScoreCell score={cand.score} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Sticky right pane */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            {selectedCandidate && (
              <CandidateDetail
                candidate={selectedCandidate}
                alreadySent={sentStrategyIds.has(selectedCandidate.strategy_id)}
                isKept={thumbsUpIds.has(selectedCandidate.strategy_id)}
                isSkipped={thumbsDownIds.has(selectedCandidate.strategy_id)}
                onSendIntro={() => setSendIntroFor(selectedCandidate)}
                onKeep={() =>
                  handleDecision(selectedCandidate.strategy_id, "thumbs_up", selectedCandidate.id)
                }
                onSkip={() =>
                  handleDecision(selectedCandidate.strategy_id, "thumbs_down", selectedCandidate.id)
                }
              />
            )}
          </div>
        </div>
      )}

      {/* Excluded list */}
      {excluded.length > 0 && (
        <details className="group" open={showExcluded}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              setShowExcluded((s) => !s);
            }}
            className="cursor-pointer text-sm font-medium text-text-primary hover:text-accent"
          >
            Excluded strategies ({excluded.length}) {showExcluded ? "▼" : "▶"}
          </summary>
          {showExcluded && (
            <Card className="mt-2 p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                      Strategy
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                      Reason
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                      Detail
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {excluded.map((exc) => (
                    <tr key={exc.id} className="border-b border-border">
                      <td className="px-4 py-2 text-sm text-text-primary">
                        {displayStrategyName(exc.strategies)}
                      </td>
                      <td className="px-4 py-2 text-sm text-text-secondary">
                        {exc.exclusion_reason}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono text-text-muted">
                        {exc.exclusion_provenance || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </details>
      )}

      {/* Decision history */}
      {decisions.length > 0 && (
        <details className="group" open={showHistory}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              setShowHistory((s) => !s);
            }}
            className="cursor-pointer text-sm font-medium text-text-primary hover:text-accent"
          >
            Decision history ({decisions.length}) {showHistory ? "▼" : "▶"}
          </summary>
          {showHistory && (
            <Card className="mt-2 p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                      When
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                      Decision
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                      Strategy
                    </th>
                    <th className="px-4 py-2 text-left text-[11px] uppercase tracking-wider text-text-muted font-semibold">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id} className="border-b border-border">
                      <td className="px-4 py-2 text-xs font-mono text-text-muted">
                        {new Date(d.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono uppercase tracking-wider text-text-secondary">
                        {d.decision.replace("_", " ")}
                      </td>
                      <td className="px-4 py-2 text-sm text-text-primary">
                        {d.strategy_id}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-secondary max-w-[320px] truncate">
                        {d.founder_note || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </details>
      )}

      {/* Send Intro slide-out panel */}
      {sendIntroFor && (
        <SendIntroPanel
          allocatorId={allocatorId}
          candidate={sendIntroFor}
          alreadySent={sentStrategyIds.has(sendIntroFor.strategy_id)}
          onClose={() => setSendIntroFor(null)}
          onSuccess={() => {
            setSendIntroFor(null);
            load();
          }}
        />
      )}

      {/* Preferences slide-out panel */}
      {showPreferencesPanel && (
        <PreferencesPanel
          allocatorId={allocatorId}
          preferences={preferences}
          onClose={() => setShowPreferencesPanel(false)}
          onSuccess={() => {
            setShowPreferencesPanel(false);
            load();
          }}
          onRecomputeRequested={handleRecompute}
        />
      )}

      {/* Keyboard shortcut help modal (opened by `?`) */}
      {showShortcutHelp && (
        <ShortcutHelpModal onClose={() => setShowShortcutHelp(false)} />
      )}
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: "personalized" | "screening" }) {
  if (mode === "personalized") {
    return (
      <span className="inline-flex items-center rounded-sm border border-accent px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-accent">
        Personalized
      </span>
    );
  }
  return (
    <div>
      <span className="inline-flex items-center rounded-sm border border-text-secondary px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider text-text-secondary">
        Screening
      </span>
      <p className="mt-1 text-[11px] text-text-muted text-right">
        No portfolio context — score reflects preference fit only.
      </p>
    </div>
  );
}

function ScoreCell({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(1, score / 100));
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <span className="font-mono tabular-nums text-sm text-text-primary">
        {score.toFixed(0)}
      </span>
      <div className="h-[2px] w-[32px] bg-border">
        <div className="h-full bg-accent" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * Shimmer skeleton shown while the queue data is loading. Matches the rough
 * shape of the real layout (header strip + shortlist strip + two-pane list
 * + sticky detail) so there's no jarring reflow when data arrives.
 */
function MatchQueueSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 w-48 bg-border rounded" />
      <Card>
        <div className="h-6 w-64 bg-border rounded" />
        <div className="mt-2 h-3 w-40 bg-border/60 rounded" />
        <div className="mt-4 flex gap-2">
          <div className="h-8 w-32 bg-border rounded" />
          <div className="h-8 w-32 bg-border/60 rounded" />
        </div>
      </Card>
      <div>
        <div className="mb-2 h-3 w-20 bg-border/60 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <div className="h-4 w-3/4 bg-border rounded" />
              <div className="h-3 w-full bg-border/60 rounded" />
              <div className="h-2 w-full bg-border/40 rounded" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
        <Card className="p-0">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="border-b border-border px-4 py-3 space-y-2 last:border-b-0"
            >
              <div className="h-3 w-2/3 bg-border rounded" />
              <div className="h-2 w-1/2 bg-border/60 rounded" />
            </div>
          ))}
        </Card>
        <Card className="min-h-[320px] space-y-3">
          <div className="h-5 w-48 bg-border rounded" />
          <div className="h-3 w-full bg-border/60 rounded" />
          <div className="h-3 w-5/6 bg-border/60 rounded" />
          <div className="h-3 w-4/6 bg-border/60 rounded" />
        </Card>
      </div>
    </div>
  );
}

/** Keyboard shortcut hint modal triggered by `?`. */
function ShortcutHelpModal({ onClose }: { onClose: () => void }) {
  const shortcuts: Array<{ keys: string[]; label: string }> = [
    { keys: ["j"], label: "Next candidate" },
    { keys: ["k"], label: "Previous candidate" },
    { keys: ["s"], label: "Open Send Intro panel" },
    { keys: ["u"], label: "Mark as keep (thumbs up)" },
    { keys: ["d"], label: "Mark as skip (thumbs down)" },
    { keys: ["r"], label: "Recompute now" },
    { keys: ["?"], label: "Show this help" },
    { keys: ["Esc"], label: "Close open panel" },
  ];
  return (
    <Modal open onClose={onClose} title="Keyboard shortcuts">
      <p className="text-sm text-text-secondary mb-4">
        Shortcuts only fire on the match-queue page and only on desktop
        (1024px+). They&rsquo;re suppressed whenever a modal or input has
        focus.
      </p>
      <dl className="space-y-2">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.label}
            className="flex items-center justify-between border-b border-border pb-2 last:border-b-0"
          >
            <dt className="text-sm text-text-primary">{shortcut.label}</dt>
            <dd className="flex items-center gap-1">
              {shortcut.keys.map((k) => (
                <kbd
                  key={k}
                  className="inline-flex items-center rounded border border-border bg-page px-2 py-0.5 font-mono text-[11px] text-text-primary"
                >
                  {k}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

function ShortlistCard({
  candidate,
  selected,
  alreadySent,
  onSelect,
  onSendIntro,
}: {
  candidate: CandidateRow;
  selected: boolean;
  alreadySent: boolean;
  onSelect: () => void;
  onSendIntro: () => void;
}) {
  // Using a <div> with role="button" instead of a native <button> so that
  // we can nest a real <button> (the "Send intro →" action) inside without
  // DOM nesting violations. Keyboard activation is handled via onKeyDown.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`text-left rounded-lg border bg-surface p-4 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40 ${
        selected
          ? "border-accent"
          : "border-border hover:border-border-focus"
      } ${alreadySent ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">
            {displayStrategyName(candidate.strategies)}
          </p>
          {candidate.reasons[0] && (
            <p className="mt-1 text-xs text-text-secondary line-clamp-2">
              {candidate.reasons[0]}
            </p>
          )}
        </div>
        <div className="shrink-0">
          <span className="font-mono tabular-nums text-[24px] text-text-primary">
            {candidate.score.toFixed(0)}
          </span>
        </div>
      </div>
      <div className="mt-3">
        <div
          className="h-[2px] bg-border"
          aria-label={`Score ${candidate.score.toFixed(0)} out of 100`}
        >
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.min(100, candidate.score)}%` }}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted">
          Rank {candidate.rank}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!alreadySent) onSendIntro();
          }}
          disabled={alreadySent}
          className={`inline-flex items-center text-xs font-medium ${
            alreadySent ? "text-text-muted" : "text-accent hover:text-accent-hover cursor-pointer"
          }`}
        >
          {alreadySent ? "Sent" : "Send intro →"}
        </button>
      </div>
    </div>
  );
}
