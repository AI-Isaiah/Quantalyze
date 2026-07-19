"use client";

import React from "react";
import { EXCHANGE_DISPLAY } from "@/lib/closed-sets";

/**
 * Allocator-facing sync-status pill + helper line.
 *
 * Renders a 7-state inline status pill plus a 12px muted helper line.
 *
 * Copy table is LOCKED VERBATIM — do NOT reword. Unit tests assert
 * character-for-character fidelity including the U+2026 ellipsis in
 * "Syncing…" and the U+2014 em-dash in "Rate limited — retry in Ns" /
 * "Queued — exchange cooldown, retry in Ns".
 *
 * Special helper-text surfaces:
 *   - rate-limit contagion: when syncStatus='syncing' AND
 *     queuedNextAttemptAt is ≥30s in the future, the helper line reads
 *     "Queued — exchange cooldown, retry in {N}s". This surfaces the
 *     per-exchange circuit-breaker queue state (from the route's
 *     already_inflight response) so the allocator sees "queued" instead
 *     of a mystery-stuck "Syncing…" pill when strategy-side 429s are in
 *     flight on the same exchange.
 *   - first-run failure: when helperOverride is a non-empty string,
 *     it takes precedence over all computed helper text. The manager's
 *     handleAddKey sets this to "Sync request failed — click Sync now to
 *     retry" when the awaited first-run POST returns non-2xx, so the row
 *     surfaces the error instead of leaving a stuck "Syncing…" pill.
 *
 * aria-live contract: only the helper line carries
 * `role="status" aria-live="polite"`. The pill itself has no aria-live so
 * neutral idle→syncing→complete transitions produce zero SR chatter
 * (helper line is empty for neutral states).
 */
export interface AllocatorSyncStatusProps {
  /** One of: idle | syncing | complete | complete_with_warnings | rate_limited | revoked | error. Unknown / null / 'computing' fall back to 'idle'. */
  syncStatus: string | null;
  /** DB value of api_keys.sync_error (sanitized ≤500 chars server-side). */
  syncError: string | null;
  /** DB value of api_keys.last_sync_at; interpolated into "Synced {relative time ago}" for the `complete` state. */
  lastSyncAt: string | null;
  /** Exchange name (lower-case, e.g. "binance") for the rate_limited helper "{title-case} cooldown remaining". */
  exchange: string;
  /** Integer seconds until retry for the rate_limited pill. Floor to 0 if elapsed. Omit to render 0s. */
  retryAtSeconds?: number;
  /**
   * ISO timestamp of the queued job's next_attempt_at. When
   * syncStatus === 'syncing' AND this timestamp is ≥30s in the future the
   * helper line reads "Queued — exchange cooldown, retry in {N}s" (U+2014).
   * Surfaces per-exchange circuit-breaker contagion from strategy-side 429s.
   */
  queuedNextAttemptAt?: string | null;
  /**
   * Explicit helper-line override. When present AND non-empty, takes
   * precedence over every computed helper text. Used by the manager's
   * handleAddKey/handleSync failure paths to render
   * "Sync request failed — click Sync now to retry" via the aria-live line.
   */
  helperOverride?: string | null;
}

// LOCKED pill colour map — do NOT deviate.
// `idle`/`syncing`/`complete` are neutral; `complete_with_warnings`/
// `rate_limited` are amber; `revoked`/`error` are red. No positive colour is
// used here — positive is reserved for future status states.
const PILL_STYLES: Record<string, { bg: string; text: string }> = {
  idle: { bg: "bg-[#F1F5F9]", text: "text-text-secondary" },
  syncing: { bg: "bg-[#F1F5F9]", text: "text-text-secondary" },
  complete: { bg: "bg-[#F1F5F9]", text: "text-text-secondary" },
  complete_with_warnings: { bg: "bg-warning/10", text: "text-warning" },
  rate_limited: { bg: "bg-warning/10", text: "text-warning" },
  revoked: { bg: "bg-negative/10", text: "text-negative" },
  error: { bg: "bg-negative/10", text: "text-negative" },
};

// LOCKED helper copy — note the terminating period.
const REVOKED_HELPER = "Re-add a read-only key from your exchange.";

const ELLIPSIS = "\u2026"; // U+2026 — NOT three dots.
const EM_DASH = "\u2014"; // U+2014 — NOT a hyphen-minus.

// Queued threshold: only surface the Queued helper when the breaker cooldown is
// ≥30s out. Under 30s is treated as a "pending/starting" state where the
// pill alone is sufficient (helper line silent — no SR chatter).
const QUEUED_THRESHOLD_SECONDS = 30;

function formatRelative(iso: string | null): string {
  if (!iso) return "just now";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "just now";
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ISSUE-007: "OKX" is an acronym, not a title-case proper noun. Plain
// `titleCase("okx")` produces "Okx", which is wrong. The map below is the
// authoritative display name per exchange; fall through to titleCase for
// unknown exchanges so we degrade gracefully on the next venue.
//
// F5 (Phase 122): DERIVED from the shared closed-set EXCHANGE_DISPLAY (the ONE
// lowercase-code → label source) instead of a hand-maintained literal — the old
// literal was missing deribit AND sfox, so a founder-connected sfox key rendered
// "Sfox" via the titleCase fallback. Deriving here means a new exchange picks up
// its correct casing automatically and this map can never drift from the wizard /
// chip surfaces again. EXCHANGE_DISPLAY is keyed by the canonical lowercase code,
// matching the `exchange.toLowerCase()` lookup below.
const EXCHANGE_DISPLAY_NAME: Record<string, string> = EXCHANGE_DISPLAY;

export function exchangeDisplayName(exchange: string): string {
  if (!exchange) return exchange;
  return (
    EXCHANGE_DISPLAY_NAME[exchange.toLowerCase()] ?? titleCase(exchange)
  );
}

function secondsUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.floor((target - Date.now()) / 1000));
}

/**
 * 12×12 inline SVG spinner. Tailwind `motion-safe:animate-spin` makes the
 * rotation respect `prefers-reduced-motion: reduce` — the glyph stays visible
 * but freezes, consistent with the globals.css precedent for reduced-motion.
 */
function SpinnerSvg() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="motion-safe:animate-spin"
      style={{ animationDuration: "1s" }}
    >
      <circle
        cx="6"
        cy="6"
        r="4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.25"
      />
      <path
        d="M6 1.5 A 4.5 4.5 0 0 1 10.5 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AllocatorSyncStatus({
  syncStatus,
  syncError,
  lastSyncAt,
  exchange,
  retryAtSeconds,
  queuedNextAttemptAt,
  helperOverride,
}: AllocatorSyncStatusProps) {
  // Forward-compat fallback: unknown / null / 'computing' → neutral idle pill.
  // The 066 migration adds `revoked` + `rate_limited`; the allocator worker
  // never sets `computing` (that's strategy-side only).
  const rawKey = syncStatus ?? "idle";
  const normalized = (rawKey in PILL_STYLES
    ? rawKey
    : "idle") as keyof typeof PILL_STYLES;
  const styles = PILL_STYLES[normalized];

  let pillLabel: React.ReactNode;
  switch (normalized) {
    case "idle":
      pillLabel = "Idle";
      break;
    case "syncing":
      pillLabel = (
        <span className="inline-flex items-center gap-1">
          <SpinnerSvg />
          <span>{`Syncing${ELLIPSIS}`}</span>
        </span>
      );
      break;
    case "complete":
      // Wrap both parts in a single span so the inline-flex pill treats them
      // as one flex item — otherwise the whitespace between "Synced" and
      // the relative-time span collapses and the pill renders "Synced1m ago"
      // even though .textContent is still "Synced 1m ago".
      pillLabel = (
        <span>
          Synced{" "}
          <span className="font-metric tabular-nums">
            {formatRelative(lastSyncAt)}
          </span>
        </span>
      );
      break;
    case "complete_with_warnings":
      pillLabel = "Synced (warnings)";
      break;
    case "rate_limited": {
      const n = Math.max(0, retryAtSeconds ?? 0);
      // Same single-flex-item wrap as `complete` — otherwise inline-flex
      // collapses the trailing " " before the {n}s span.
      pillLabel = (
        <span>
          {`Rate limited ${EM_DASH} retry in `}
          <span className="font-metric tabular-nums">{n}s</span>
        </span>
      );
      break;
    }
    case "revoked":
      pillLabel = "Key revoked";
      break;
    case "error":
      pillLabel = "Sync failed";
      break;
  }

  // Helper text resolution order:
  //   1. helperOverride — explicit manager-side override wins over all.
  //   2. status-specific computed text per the locked copy table.
  //   3. Queued surface when syncing + queuedNextAttemptAt >= 30s out.
  //   4. neutral empty string — aria-live stays silent.
  let helperText = "";
  if (
    helperOverride !== null &&
    helperOverride !== undefined &&
    helperOverride.length > 0
  ) {
    helperText = helperOverride;
  } else if (normalized === "revoked") {
    helperText = REVOKED_HELPER;
  } else if (normalized === "rate_limited") {
    helperText = `${exchangeDisplayName(exchange)} cooldown remaining`;
  } else if (normalized === "error" || normalized === "complete_with_warnings") {
    helperText = syncError ?? "";
  } else if (normalized === "syncing") {
    const secs = secondsUntil(queuedNextAttemptAt);
    if (secs !== null && secs >= QUEUED_THRESHOLD_SECONDS) {
      helperText = `Queued ${EM_DASH} exchange cooldown, retry in ${secs}s`;
    }
  }

  return (
    <div className="flex flex-col items-end">
      <span
        data-testid="allocator-sync-pill"
        data-sync-status={normalized}
        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors duration-150 ease-out ${styles.bg} ${styles.text}`}
      >
        {pillLabel}
      </span>
      <div
        role="status"
        aria-live="polite"
        data-testid="allocator-sync-helper"
        className="text-xs text-text-muted mt-1"
      >
        {helperText ? <span>{helperText}</span> : null}
      </div>
    </div>
  );
}
