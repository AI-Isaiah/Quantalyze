"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * KeyPermissionBadge — live "Read / Trade / Withdraw" scope viewer.
 *
 * Sprint 5 Task 5.8 — Live Key Permission Viewer.
 *
 * Fetches /api/keys/:id/permissions on mount and renders three pill spans:
 *   - "Read ✓"     → accent (green)  — desired
 *   - "Trade ✗"    → muted, struck-through — desired
 *   - "Withdraw ✗" → muted, struck-through — desired
 *   - "Trade ✓"    → negative (red)  — wrong scope, key should be re-keyed
 *   - "Withdraw ✓" → negative (red)  — wrong scope, key should be re-keyed
 *
 * Visual guidance from DESIGN.md:
 *   - DM Sans 14px body type for the pills
 *   - Instrument Serif for the small heading
 *   - text-accent / text-text-primary / text-negative tokens (no invented colors)
 *   - Plain ✓ / ✗ glyphs, no icon font
 */

interface Permissions {
  read: boolean;
  trade: boolean;
  withdraw: boolean;
  detected_at: string;
}

export interface KeyPermissionBadgeProps {
  apiKeyId: string;
  /** Optional className passthrough so callers can wedge spacing in. */
  className?: string;
}

function timeAgo(iso: string): string {
  // Lightweight local "x ago" — no date-fns dep needed for one display.
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface PillProps {
  label: "Read" | "Trade" | "Withdraw";
  granted: boolean;
}

function Pill({ label, granted }: PillProps) {
  // Read+granted is the GOOD state → accent (the institutional teal).
  // Trade/Withdraw + granted is the BAD state → negative (red).
  // Trade/Withdraw + not granted is the NORMAL state → muted + strikethrough.
  let cls: string;
  let glyph: string;
  if (label === "Read") {
    cls = granted
      ? "text-accent"
      : "text-negative";
    glyph = granted ? "✓" : "✗";
  } else {
    if (granted) {
      cls = "text-negative";
      glyph = "✓";
    } else {
      cls = "text-text-primary line-through opacity-70";
      glyph = "✗";
    }
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[13px] ${cls}`}
      data-testid={`key-perm-pill-${label.toLowerCase()}`}
      data-granted={granted ? "true" : "false"}
    >
      <span>{label}</span>
      <span aria-hidden>{glyph}</span>
      <span className="sr-only">{granted ? "granted" : "not granted"}</span>
    </span>
  );
}

export function KeyPermissionBadge({ apiKeyId, className = "" }: KeyPermissionBadgeProps) {
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/keys/${encodeURIComponent(apiKeyId)}/permissions`,
        { method: "GET", cache: "no-store" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Probe failed" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as Permissions;
      if (mountedRef.current) setPerms(data);
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Could not check permissions.");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [apiKeyId]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return (
    <div className={`space-y-2 ${className}`} data-testid="key-permission-badge">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-base text-text-primary">
          Detected key scopes
        </h3>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-[12px] text-text-muted underline-offset-4 hover:text-text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="key-permission-recheck"
        >
          {loading ? "Checking…" : "Re-check"}
        </button>
      </div>

      {loading && !perms && (
        <div
          className="flex gap-2"
          aria-live="polite"
          aria-busy="true"
          data-testid="key-permission-skeleton"
        >
          {["Read", "Trade", "Withdraw"].map((label) => (
            <span
              key={label}
              className="inline-flex h-6 w-20 animate-pulse rounded-sm border border-border bg-page"
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="text-[13px] text-negative" role="alert">
          {error}
        </p>
      )}

      {perms && (
        <>
          <div className="flex flex-wrap gap-2">
            <Pill label="Read" granted={perms.read} />
            <Pill label="Trade" granted={perms.trade} />
            <Pill label="Withdraw" granted={perms.withdraw} />
          </div>
          <p className="text-[12px] text-text-muted">
            Detected{" "}
            <time dateTime={perms.detected_at} title={perms.detected_at}>
              {timeAgo(perms.detected_at)}
            </time>
            {" "}from the exchange.
          </p>
        </>
      )}
    </div>
  );
}
