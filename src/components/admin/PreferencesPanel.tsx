"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { EXCHANGES, STRATEGY_TYPES, MARKETS } from "@/lib/constants";
import type { AllocatorPreferences } from "@/components/admin/AllocatorMatchQueue";

interface Props {
  allocatorId: string;
  preferences: AllocatorPreferences | null;
  onClose: () => void;
  onSuccess: () => void;
  onRecomputeRequested: () => void;
}

export function PreferencesPanel({
  allocatorId,
  preferences,
  onClose,
  onSuccess,
  onRecomputeRequested,
}: Props) {
  const [archetype, setArchetype] = useState(preferences?.mandate_archetype ?? "");
  const [ticketSize, setTicketSize] = useState<string>(
    preferences?.target_ticket_size_usd != null
      ? String(preferences.target_ticket_size_usd)
      : "",
  );
  const [excludedExchanges, setExcludedExchanges] = useState<string[]>(
    preferences?.excluded_exchanges ?? [],
  );
  const [maxDD, setMaxDD] = useState<string>(
    preferences?.max_drawdown_tolerance != null
      ? String(preferences.max_drawdown_tolerance)
      : "",
  );
  const [minTrack, setMinTrack] = useState<string>(
    preferences?.min_track_record_days != null
      ? String(preferences.min_track_record_days)
      : "",
  );
  const [minSharpe, setMinSharpe] = useState<string>(
    preferences?.min_sharpe != null ? String(preferences.min_sharpe) : "",
  );
  const [maxConcentration, setMaxConcentration] = useState<string>(
    preferences?.max_aum_concentration != null
      ? String(preferences.max_aum_concentration)
      : "",
  );
  const [preferredTypes, setPreferredTypes] = useState<string[]>(
    preferences?.preferred_strategy_types ?? [],
  );
  const [preferredMarkets, setPreferredMarkets] = useState<string[]>(
    preferences?.preferred_markets ?? [],
  );
  const [founderNotes, setFounderNotes] = useState(preferences?.founder_notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Track any pending success-to-confirm timer so it can be cleared on unmount.
  // Without this, closing the panel during the 100ms window orphans a setTimeout
  // that fires confirm() on an already-unmounted component.
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  function toggle<T extends string>(list: T[], value: T, set: (v: T[]) => void) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  /** Safely parse a numeric string. Returns null for empty, NaN, or infinite. */
  function parseNum(s: string): number | null {
    if (!s.trim()) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Validate each numeric field up-front. If the user typed "$50k" into
    // ticket size, Number("$50k") is NaN, which JSON.stringify converts to
    // null — silently wiping the field. Reject at the client first.
    const numericFields: [string, string][] = [
      ["target_ticket_size_usd", ticketSize],
      ["max_drawdown_tolerance", maxDD],
      ["min_track_record_days", minTrack],
      ["min_sharpe", minSharpe],
      ["max_aum_concentration", maxConcentration],
    ];
    for (const [name, raw] of numericFields) {
      if (raw.trim() && !Number.isFinite(Number(raw))) {
        setError(`${name} must be a number (got "${raw}")`);
        setSubmitting(false);
        return;
      }
    }

    const body: Record<string, unknown> = {
      mandate_archetype: archetype.trim() || null,
      target_ticket_size_usd: parseNum(ticketSize),
      excluded_exchanges: excludedExchanges,
      max_drawdown_tolerance: parseNum(maxDD),
      min_track_record_days: parseNum(minTrack),
      min_sharpe: parseNum(minSharpe),
      max_aum_concentration: parseNum(maxConcentration),
      preferred_strategy_types: preferredTypes,
      preferred_markets: preferredMarkets,
      founder_notes: founderNotes.trim() || null,
    };

    try {
      const res = await fetch(`/api/admin/match/preferences/${allocatorId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to save preferences");
      }
      setSavedMessage("Preferences saved.");
      // Give the user a moment to see the success state before closing.
      // Timer ref is cleared on unmount to prevent orphaned confirm().
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null;
        const wantsRecompute = confirm(
          "Preferences saved. Recompute the match queue now with the new preferences?",
        );
        if (wantsRecompute) {
          onSuccess();
          onRecomputeRequested();
        } else {
          onSuccess();
        }
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative z-10 w-full max-w-lg bg-surface border-l border-border shadow-elevated overflow-y-auto">
        <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
              Preferences
            </p>
            <h2 className="mt-0.5 text-lg font-display text-text-primary">
              CRM-style editor
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M15 5L5 15M5 5l10 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Mandate */}
          <Textarea
            label="Mandate (one sentence)"
            placeholder="e.g. diversified crypto SMA, low-drawdown"
            value={archetype}
            onChange={(e) => setArchetype(e.target.value)}
            rows={2}
            maxLength={500}
          />

          {/* Capital */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Ticket size (USD)"
              type="number"
              value={ticketSize}
              onChange={(e) => setTicketSize(e.target.value)}
              min={0}
            />
            <Input
              label="Max concentration (0-1)"
              type="number"
              step="0.01"
              value={maxConcentration}
              onChange={(e) => setMaxConcentration(e.target.value)}
              min={0}
              max={1}
            />
          </div>

          {/* Risk */}
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Max DD (0-1)"
              type="number"
              step="0.01"
              value={maxDD}
              onChange={(e) => setMaxDD(e.target.value)}
              min={0}
              max={1}
            />
            <Input
              label="Min Sharpe"
              type="number"
              step="0.1"
              value={minSharpe}
              onChange={(e) => setMinSharpe(e.target.value)}
            />
            <Input
              label="Min track (days)"
              type="number"
              step="30"
              value={minTrack}
              onChange={(e) => setMinTrack(e.target.value)}
              min={0}
            />
          </div>

          {/* Universe */}
          <div>
            <p className="text-sm font-medium text-text-primary mb-2">
              Preferred strategy types
            </p>
            <div className="flex flex-wrap gap-2">
              {STRATEGY_TYPES.map((type) => {
                const active = preferredTypes.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggle(preferredTypes, type, setPreferredTypes)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-surface text-text-secondary hover:border-border-focus"
                    }`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-text-primary mb-2">
              Preferred markets
            </p>
            <div className="flex flex-wrap gap-2">
              {MARKETS.map((market) => {
                const active = preferredMarkets.includes(market);
                return (
                  <button
                    key={market}
                    type="button"
                    onClick={() => toggle(preferredMarkets, market, setPreferredMarkets)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border bg-surface text-text-secondary hover:border-border-focus"
                    }`}
                  >
                    {market}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-text-primary mb-2">
              Excluded exchanges
            </p>
            <div className="flex flex-wrap gap-2">
              {EXCHANGES.map((exchange) => {
                const active = excludedExchanges.includes(exchange);
                return (
                  <button
                    key={exchange}
                    type="button"
                    onClick={() => toggle(excludedExchanges, exchange, setExcludedExchanges)}
                    className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-negative bg-negative/10 text-negative"
                        : "border-border bg-surface text-text-secondary hover:border-border-focus"
                    }`}
                  >
                    {exchange}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Founder notes */}
          <Textarea
            label="Founder notes (CRM — only you see this)"
            placeholder="Context from conversations, preferred structure, anything useful..."
            value={founderNotes}
            onChange={(e) => setFounderNotes(e.target.value)}
            rows={4}
          />

          {error && <p className="text-sm text-negative">{error}</p>}
          {savedMessage && !error && (
            <p className="text-sm text-positive">{savedMessage}</p>
          )}

          <div className="sticky bottom-0 bg-surface border-t border-border -mx-6 px-6 pt-4 pb-0 flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Saving..." : "Save preferences"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
