"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "@/lib/utils";

/**
 * KeyPermissionBadge — live "Read / Trade / Withdraw" scope viewer.
 *
 * Fetches /api/keys/:id/permissions on mount and renders three pill spans:
 *   - "Read ✓"     → accent (green)  — desired
 *   - "Trade ✗"    → muted, struck-through — desired
 *   - "Withdraw ✗" → muted, struck-through — desired
 *   - "Trade ✓"    → negative (red)  — wrong scope, key should be re-keyed
 *   - "Withdraw ✓" → negative (red)  — wrong scope, key should be re-keyed
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
    cls = granted ? "text-accent" : "text-negative";
    glyph = granted ? "✓" : "✗";
  } else if (granted) {
    cls = "text-negative";
    glyph = "✓";
  } else {
    cls = "text-text-primary line-through opacity-70";
    glyph = "✗";
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[13px] ${cls}`}
      data-testid={`key-perm-pill-${label.toLowerCase()}`}
      data-granted={granted ? "true" : "false"}
      aria-label={`${label} ${granted ? "granted" : "not granted"}`}
    >
      {label} <span aria-hidden>{glyph}</span>
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
              {formatRelativeTime(perms.detected_at, Date.now())}
            </time>
            {" "}from the exchange.
          </p>
        </>
      )}
    </div>
  );
}
