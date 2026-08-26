"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "@/lib/utils";
import { RouteResponseError } from "@/lib/route-response-error";

/**
 * The one sentence shown when the failure did NOT come from a route response.
 * DESIGN.md §Voice: declarative, sentence-case, active voice, no adjectives.
 * It names "Re-check", the control actually rendered above it, rather than
 * telling the user to do something this surface does not offer.
 */
const PROBE_UNAVAILABLE_COPY =
  "We could not check this key's scopes. Use Re-check to try again.";

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
  /**
   * 162-09 — `null` means the probe did not answer, so this scope is UNKNOWN.
   * It is a third state, not a synonym for `false`: rendering a failed probe
   * as "not granted" is as false as rendering it as "granted", and on the
   * Read chip it would additionally read as "your key is revoked".
   */
  granted: boolean | null;
}

function Pill({ label, granted }: PillProps) {
  // Read+granted is the GOOD state → accent (the institutional teal).
  // Trade/Withdraw + granted is the BAD state → negative (red).
  // Trade/Withdraw + not granted is the NORMAL state → muted + strikethrough.
  // granted === null is the UNKNOWN state → em-dash, colorless (see below).
  let cls: string;
  let glyph: string;
  if (granted === null) {
    // 162-UI-SPEC §C-3/C-4 vocabulary, reused rather than reinvented: an
    // em-dash for a value that cannot be claimed, muted ink, and no semantic
    // color in either direction — absence is not an error, so no red, and not
    // reassurance either, so no accent.
    cls = "text-text-muted";
    glyph = "—";
  } else if (label === "Read") {
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
      data-granted={granted === null ? "unknown" : granted ? "true" : "false"}
      // The glyph is aria-hidden, so the state has to live in the label:
      // a screen-reader user must hear "unknown", never a verdict we don't have.
      aria-label={`${label} ${
        granted === null ? "scope unknown" : granted ? "granted" : "not granted"
      }`}
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
    // 140.3-07 / SEAMUX-09 / B-26 member 2 — invalidate BEFORE the refetch.
    // Identical shape to `PortfolioOptimizer`'s `setSuggestions(null)`, itself
    // copied from `WeightOptimizerSection.tsx`'s `setResult(null)`: ONE pattern
    // for the whole class. A guard-order fix would have worked here and been
    // smaller, but a class fixed two different ways is a class a reviewer
    // cannot audit. Without this, "Re-check" during an outage left the previous
    // Read/Trade/Withdraw verdict rendered beside the error — a stale SECURITY
    // claim about a money-bearing key, read as a current fact about its scope.
    setPerms(null);
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
          // Both values are the response's own metadata, not upstream detail.
          throw new RouteResponseError(
            `HTTP ${res.status} (${res.statusText || "no body"})`,
          );
        }
        const message = err.error ?? `HTTP ${res.status}`;
        // Prepend the route's structured `code` (e.g. PROBE_BACKEND_UNAVAILABLE)
        // so the displayed text is greppable in support tickets.
        throw new RouteResponseError(
          err.code ? `${err.code}: ${message}` : message,
        );
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
        // 140.3-07 / B-27 — only a message this component built from the route
        // RESPONSE is rendered. A rejected fetch arrives as a TypeError whose
        // message can embed an internal host, and res.json() on a proxy's HTML
        // error page arrives as a SyntaxError; neither is copy. The route's own
        // { error, code } body IS reviewed copy, so it still reaches the user
        // and stays greppable in support tickets.
        setError(
          e instanceof RouteResponseError ? e.message : PROBE_UNAVAILABLE_COPY,
        );
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

  // 162-09 / HONEST-02 — ONE fact, decided ONCE, for every claim this panel
  // makes about the probe result. The plain-English summary below already
  // branched on `probe_error`; the scope chips and the "Detected … from the
  // exchange" caption did not. Live PROD QA (2026-08-25) caught the two halves
  // disagreeing on one screen: "Could not contact the exchange to verify
  // scopes." directly above "Read ✓ Trade ✓ Withdraw ✓ — Detected 1m ago from
  // the exchange." The chips are the load-bearing falsehood, not the caption —
  // Trade ✓ / Withdraw ✓ sits under the connect form's "only read-only keys are
  // accepted", so a user who believes them concludes their read-only key can
  // move funds. Presentation only: server-side scope ENFORCEMENT is unaffected.
  //
  // ⚠️ COUPLING, recorded by the 162 silent-failure audit (A-5). `=== true`
  // means an ABSENT `probe_error` reads as a successful probe — the optimistic
  // arm. That is correct TODAY only because of a fact that lives in another
  // language, in another repo directory: `analytics-service/routers/internal.py`
  // always emits the key (`bool(perms.get("probe_error", False))`), so absence
  // never occurs on the wire. The wire SCHEMA does not enforce that —
  // `LivePermissionsSchema` marks the field `.optional()`
  // (src/lib/analytics-schemas.ts) — so nothing between the emitter and this
  // line would fail if a future response dropped it. It would simply be read as
  // "the probe succeeded", and the chips would state scopes nobody verified.
  //
  // The audit deliberately left the logic ALONE: the component is otherwise
  // correct, and flipping to a fail-closed default (`!== false`) would make
  // every legacy/cached body render the failure copy. If that emitter ever
  // stops emitting the key unconditionally, this line must become the
  // pessimistic read — and the schema should stop calling optional what the
  // producer treats as required.
  const probeFailed = perms?.probe_error === true;

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
          {/*
            The chips read from the SAME `probe_error` fact as the summary
            above. A failed probe still ships read/trade/withdraw booleans on
            the wire (the _FAIL_CLOSED payload), but none of them is knowable,
            so each renders as unknown — `—`, colorless — rather than as a
            verdict in either direction.
          */}
          <div className="flex flex-wrap gap-2">
            <Pill label="Read" granted={probeFailed ? null : perms.read} />
            <Pill label="Trade" granted={probeFailed ? null : perms.trade} />
            <Pill
              label="Withdraw"
              granted={probeFailed ? null : perms.withdraw}
            />
          </div>
          {/*
            `detected_at` on a failed probe is the timestamp of the FAILURE, so
            "Detected {t} from the exchange" is false twice over: nothing was
            detected, and it did not come from the exchange. The summary above
            already states the limitation plainly, and 162-UI-SPEC §C-4's
            single-note discipline says one sentence names the state — so this
            caption is omitted rather than restated.
          */}
          {!probeFailed && (
            <p className="text-fixed-12 text-text-muted">
              Detected{" "}
              <time dateTime={perms.detected_at} title={perms.detected_at}>
                {formatRelativeTime(perms.detected_at, Date.now())}
              </time>
              {" "}from the exchange.
            </p>
          )}
        </>
      )}
    </div>
  );
}
