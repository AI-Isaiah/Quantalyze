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
  /**
   * Set by the Python service's _FAIL_CLOSED payload when the upstream
   * exchange could not be contacted. Distinguishes "exchange unreachable"
   * from "key revoked" — both surface as read=false/trade=false/withdraw=false
   * otherwise, which would mislead users during outages.
   */
  probe_error?: boolean;
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
      className={`inline-flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-fixed-13 ${cls}`}
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
        // Sentinel so we can distinguish a successful empty parse from a
        // real JSON failure (HTML proxy error page, gzip corruption).
        const PARSE_FAILED = Symbol("parse-failed");
        const err = (await res.json().catch(() => PARSE_FAILED)) as
          | { error?: string; code?: string }
          | typeof PARSE_FAILED;
        if (err === PARSE_FAILED) {
          // Surface HTTP status + statusText so support has something to
          // correlate against the proxy/CDN logs when no JSON body comes back.
          throw new Error(
            `HTTP ${res.status} (${res.statusText || "no body"})`,
          );
        }
        const message = err.error ?? `HTTP ${res.status}`;
        // Prepend the route's structured `code` (e.g. PROBE_BACKEND_UNAVAILABLE)
        // so the displayed text is greppable in support tickets.
        throw new Error(err.code ? `${err.code}: ${message}` : message);
      }
      const data = (await res.json()) as Permissions;
      if (mountedRef.current) setPerms(data);
    } catch (e) {
      // Preserve the raw error for the browser console before we squash
      // it to a user-facing string. Stack traces and non-Error throws
      // disappear once we hit setError(); without this log, debugging a
      // probe failure from a user-submitted screenshot is much harder.
      console.error("[KeyPermissionBadge] probe failed:", e);
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
          className="text-fixed-12 text-text-muted underline-offset-4 hover:text-text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
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
        <p className="text-fixed-13 text-negative" role="alert">
          {error}
        </p>
      )}

      {perms && (
        <>
          {/*
            Phase 21 (ISSUE-002) — plain-English summary above the chips.
            The chips alone (color + glyph + strikethrough) are accessible
            to sighted users, but a glancing user has to parse three
            independent visual cues to know whether the key is safe.
            One sentence in either accent or negative spells it out.
          */}
          {(() => {
            // Branches are ordered probe-error → read-only → wrong-scope.
            // probe_error MUST come first so we don't mis-diagnose an
            // exchange outage as "key revoked" — both look like
            // read=false/trade=false/withdraw=false on the wire.
            const summaryState: "probe-error" | "read-only" | "wrong-scope" =
              perms.probe_error
                ? "probe-error"
                : perms.read && !perms.trade && !perms.withdraw
                  ? "read-only"
                  : "wrong-scope";
            const summaryText =
              summaryState === "probe-error"
                ? "Could not contact the exchange to verify scopes. Try the Re-check button in a moment."
                : summaryState === "read-only"
                  ? "Read-only key confirmed — trading and withdrawals are blocked."
                  : perms.trade || perms.withdraw
                    ? `⚠ This key has ${[
                        perms.trade ? "trade" : null,
                        perms.withdraw ? "withdraw" : null,
                      ]
                        .filter(Boolean)
                        .join(" and ")} permission. Re-key as read-only.`
                    : "⚠ No read permission detected on this key. The key may have been revoked or scoped wrong.";
            return (
              <p
                className={`text-fixed-13 ${
                  summaryState === "read-only" ? "text-accent" : "text-negative"
                }`}
                data-testid="key-permission-summary"
                data-state={summaryState}
                // role="alert" only on the warning states. Read-only is
                // informational ("here's the verified scope") — surfacing
                // it as an alert would over-fire screen readers on the
                // happy path.
                role={
                  summaryState === "wrong-scope" || summaryState === "probe-error"
                    ? "alert"
                    : undefined
                }
              >
                {summaryText}
              </p>
            );
          })()}
          <div className="flex flex-wrap gap-2">
            <Pill label="Read" granted={perms.read} />
            <Pill label="Trade" granted={perms.trade} />
            <Pill label="Withdraw" granted={perms.withdraw} />
          </div>
          <p className="text-fixed-12 text-text-muted">
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
