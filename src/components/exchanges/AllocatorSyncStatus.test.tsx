import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AllocatorSyncStatus, PILL_STYLES } from "./AllocatorSyncStatus";

/**
 * Phase 06 Plan 04 Task 1 — AllocatorSyncStatus sub-component test suite.
 *
 * Verifies the D-08 LOCKED copy table character-for-character (U+2026 ellipsis
 * and U+2014 em-dash), the pill color map (UI-SPEC), the aria-live helper line
 * contract (mirrors MandateSaveStatus), plus:
 *   - f8: Queued helper surfacing rate-limit-contagion when next_attempt_at
 *     is ≥30s in the future.
 *   - f4: helperOverride prop taking precedence so the manager's first-run
 *     POST failure can surface "Sync request failed — click Sync now to retry".
 */

describe("AllocatorSyncStatus — D-08 pill copy verbatim", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix wall clock so "Synced X ago" and Queued-countdown are deterministic.
    vi.setSystemTime(new Date("2026-04-19T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders 'Idle' pill for idle status and no helper line", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="idle"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toBe("Idle");
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toBe("");
  });

  it("uses U+2026 ellipsis not three dots in Syncing label", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="syncing"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toContain("Syncing\u2026");
    expect(pill.textContent).not.toContain("Syncing...");
  });

  it("'Syncing…' text length accounts for U+2026 as a single codepoint", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="syncing"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    // "Syncing…" = S-y-n-c-i-n-g-… = 8 codepoints.
    const label = pill.textContent ?? "";
    expect(Array.from(label)).toHaveLength(8);
  });

  it("renders 'Synced {relative}' for complete status with 2-min-ago anchor", () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    render(
      <AllocatorSyncStatus
        syncStatus="complete"
        syncError={null}
        lastSyncAt={twoMinAgo}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toBe("Synced 2m ago");
  });

  // Regression: ISSUE-004 — when the pill label used a React fragment
  // (<> "Synced " <span>{formatRelative}</span> </>), the outer `inline-flex
  // items-center` container treated the text node and the span as separate
  // flex items and collapsed the whitespace between them — the pill rendered
  // "Synced1m ago" visually while textContent was still "Synced 1m ago".
  // Wrapping both pieces in a single <span> reduces it to one flex item and
  // preserves the space. This test pins that structure.
  // Found by /qa on 2026-04-20 on /exchanges.
  // Report: .gstack/qa-reports/qa-report-quantalyze-phase-06-2026-04-20.md
  it("complete/rate_limited pill render as a SINGLE flex child (visible whitespace)", () => {
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    const { rerender } = render(
      <AllocatorSyncStatus
        syncStatus="complete"
        syncError={null}
        lastSyncAt={oneMinAgo}
        exchange="okx"
      />,
    );
    const completePill = screen.getByTestId("allocator-sync-pill");
    // Exactly one direct element child — the wrapping span that holds
    // "Synced " plus the relative-time span as ordinary inline flow.
    expect(completePill.children.length).toBe(1);
    expect(completePill.textContent).toBe("Synced 1m ago");

    rerender(
      <AllocatorSyncStatus
        syncStatus="rate_limited"
        syncError={null}
        lastSyncAt={null}
        exchange="okx"
        retryAtSeconds={42}
      />,
    );
    const rlPill = screen.getByTestId("allocator-sync-pill");
    expect(rlPill.children.length).toBe(1);
    expect(rlPill.textContent).toBe("Rate limited \u2014 retry in 42s");
  });

  it("renders 'Synced (warnings)' for complete_with_warnings + helper with sync_error", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="complete_with_warnings"
        syncError="Binance futures endpoint transient timeout"
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toBe("Synced (warnings)");
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toContain(
      "Binance futures endpoint transient timeout",
    );
  });

  it("uses U+2014 em-dash not hyphen-minus in Rate limited label", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="rate_limited"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        retryAtSeconds={42}
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toBe("Rate limited \u2014 retry in 42s");
    expect(pill.textContent).not.toContain("Rate limited - retry");
    expect(pill.textContent).not.toContain("Rate limited -- retry");
  });

  it("renders 'Key revoked' + helper 'Re-add a read-only key from your exchange.'", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="revoked"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toBe("Key revoked");
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toBe(
      "Re-add a read-only key from your exchange.",
    );
    // aria-live contract: helper line is the announcement channel.
    expect(helper).toHaveAttribute("role", "status");
    expect(helper).toHaveAttribute("aria-live", "polite");
  });

  it("renders 'Sync failed' + helper contains sanitized sync_error for error", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="error"
        syncError="HTTP 502 from binance"
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toBe("Sync failed");
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toContain("HTTP 502 from binance");
  });

  it("renders 'Sign-in failed' pill + authored helper (D-05/D-11 arm B)", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="sign_in_failed"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toBe("Sign-in failed");
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toBe(
      "Update this account's credentials \u2014 the saved ones may have changed.",
    );
    expect(helper.textContent).not.toContain("credentials - the saved");
    // 167 review round 1 / WR-03: the remedy must not name "Reconnect". That
    // control re-runs the SAVED credential this sign-in just failed with; the
    // fixing control is "Update password". A reword back to "Reconnect" reds.
    expect(helper.textContent).not.toMatch(/reconnect/i);
    // aria-live contract: helper line is the announcement channel; the pill
    // itself carries no aria-live.
    expect(helper).toHaveAttribute("role", "status");
    expect(helper).toHaveAttribute("aria-live", "polite");
    expect(pill).not.toHaveAttribute("aria-live");
  });

  // ⭐ Non-vacuity control (T-167-08 / D-05): the whole point of the
  // authored helper is that it IGNORES syncError. Without this control the
  // case above cannot fail the way the shipped defect failed — a
  // pass-through implementation would still print "Sign-in failed" and a
  // sentence, just the WRONG one.
  it("sign_in_failed helper IGNORES syncError — non-vacuity control", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="sign_in_failed"
        syncError="MT5 terminal unreachable \u2014 sync will retry automatically."
        lastSyncAt={null}
        exchange="mt5"
      />,
    );
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toBe(
      "Update this account's credentials \u2014 the saved ones may have changed.",
    );
    expect(helper.textContent).not.toContain("MT5 terminal unreachable");
    expect(helper.textContent).not.toContain("will retry automatically");
  });

  it("renders '{exchange title-case} cooldown remaining' helper for rate_limited", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="rate_limited"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        retryAtSeconds={15}
      />,
    );
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toBe("Binance cooldown remaining");
  });

  // ISSUE-007: generic titleCase turned "okx" into "Okx" and "bnb" into
  // "Bnb" — acronym exchanges need an explicit display-name map.
  it.each([
    ["okx", "OKX cooldown remaining"],
    ["OKX", "OKX cooldown remaining"],
    ["binance", "Binance cooldown remaining"],
    ["bybit", "Bybit cooldown remaining"],
    // F5 (Phase 122): sfox (and deribit) are now DERIVED from the shared
    // EXCHANGE_DISPLAY, so a founder-connected sfox key renders "sFOX", never
    // the titleCase "Sfox" regression. deribit was also silently missing before.
    ["sfox", "sFOX cooldown remaining"],
    ["sFOX", "sFOX cooldown remaining"],
    ["deribit", "Deribit cooldown remaining"],
    // Unknown venue falls through to titleCase — graceful degradation.
    ["kraken", "Kraken cooldown remaining"],
  ])(
    "ISSUE-007: rate_limited helper for exchange=%s renders '%s'",
    (exchange, expected) => {
      render(
        <AllocatorSyncStatus
          syncStatus="rate_limited"
          syncError={null}
          lastSyncAt={null}
          exchange={exchange}
          retryAtSeconds={15}
        />,
      );
      const helper = screen.getByTestId("allocator-sync-helper");
      expect(helper.textContent).toBe(expected);
      // Guard against the pre-fix "Okx" regression sneaking back in.
      if (exchange.toLowerCase() === "okx") {
        expect(helper.textContent).not.toContain("Okx cooldown");
      }
      // F5 guard: the titleCase fallback "Sfox" must never resurface.
      if (exchange.toLowerCase() === "sfox") {
        expect(helper.textContent).not.toContain("Sfox cooldown");
      }
    },
  );
});

describe("AllocatorSyncStatus — pill color class map", () => {
  it("idle pill uses bg-[#F1F5F9] and text-text-secondary", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="idle"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.className).toMatch(/bg-\[#F1F5F9\]/);
    expect(pill.className).toMatch(/text-text-secondary/);
  });

  it("rate_limited pill uses bg-warning/10 and text-warning", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="rate_limited"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        retryAtSeconds={10}
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.className).toMatch(/bg-warning\/10/);
    expect(pill.className).toMatch(/text-warning/);
  });

  it("complete_with_warnings pill uses bg-warning/10 and text-warning", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="complete_with_warnings"
        syncError="partial"
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.className).toMatch(/bg-warning\/10/);
    expect(pill.className).toMatch(/text-warning/);
  });

  it("revoked pill uses bg-negative/10 and text-negative", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="revoked"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.className).toMatch(/bg-negative\/10/);
    expect(pill.className).toMatch(/text-negative/);
  });

  it("error pill uses bg-negative/10 and text-negative", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="error"
        syncError="boom"
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.className).toMatch(/bg-negative\/10/);
    expect(pill.className).toMatch(/text-negative/);
  });

  it("sign_in_failed pill uses the opaque amber trio and NEVER the idle fallback classes (T-167-08)", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="sign_in_failed"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.className).toMatch(/bg-warning-bg/);
    expect(pill.className).toMatch(/\btext-warning\b/);
    expect(pill.className).toMatch(/border-warning-border/);
    // Guard against the PILL_STYLES unknown-key fallback (T-167-08): a
    // partial rollout must NEVER render this broken-key state as the
    // neutral idle style.
    expect(pill.className).not.toMatch(/bg-\[#F1F5F9\]/);
    expect(pill.className).not.toMatch(/text-text-secondary/);
    expect(pill.getAttribute("data-sync-status")).toBe("sign_in_failed");
  });

  it("falls back to idle neutral pill for unknown sync_status (including 'computing' and null)", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="computing"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.className).toMatch(/bg-\[#F1F5F9\]/);
    expect(pill.textContent).toBe("Idle");
  });

  it("renders neutral 'Idle' fallback when sync_status is null", () => {
    render(
      <AllocatorSyncStatus
        syncStatus={null}
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    expect(pill.textContent).toBe("Idle");
  });
});

describe("AllocatorSyncStatus — helper line aria-live silence for neutral states", () => {
  it("helper is empty for idle", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="idle"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    expect(
      screen.getByTestId("allocator-sync-helper").textContent,
    ).toBe("");
  });

  it("helper is empty for syncing with null queuedNextAttemptAt", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="syncing"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        queuedNextAttemptAt={null}
      />,
    );
    expect(
      screen.getByTestId("allocator-sync-helper").textContent,
    ).toBe("");
  });

  it("helper is empty for complete", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="complete"
        syncError={null}
        lastSyncAt={new Date().toISOString()}
        exchange="binance"
      />,
    );
    expect(
      screen.getByTestId("allocator-sync-helper").textContent,
    ).toBe("");
  });
});

describe("AllocatorSyncStatus — f8 Queued helper rendering (rate-limit contagion)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders Queued helper with U+2014 em-dash when syncing and queuedNextAttemptAt is ≥30s in the future", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    render(
      <AllocatorSyncStatus
        syncStatus="syncing"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        queuedNextAttemptAt={future}
      />,
    );
    const helper = screen.getByTestId("allocator-sync-helper");
    // Allow ±2s drift (timer rounding) — accept 58s / 59s / 60s / 61s / 62s.
    expect(helper.textContent).toMatch(
      /Queued \u2014 exchange cooldown, retry in (58|59|60|61|62)s/,
    );
    // Explicit em-dash check.
    expect(helper.textContent).toContain("\u2014");
    expect(helper.textContent).not.toContain("Queued - exchange");
  });

  it("does NOT render Queued helper when queuedNextAttemptAt is <30s in the future", () => {
    const near = new Date(Date.now() + 5_000).toISOString();
    render(
      <AllocatorSyncStatus
        syncStatus="syncing"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        queuedNextAttemptAt={near}
      />,
    );
    expect(
      screen.getByTestId("allocator-sync-helper").textContent,
    ).toBe("");
  });

  it("does NOT render Queued helper at exactly the 30s boundary-minus-1 (e.g. 29s)", () => {
    const near = new Date(Date.now() + 29_000).toISOString();
    render(
      <AllocatorSyncStatus
        syncStatus="syncing"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        queuedNextAttemptAt={near}
      />,
    );
    expect(
      screen.getByTestId("allocator-sync-helper").textContent,
    ).toBe("");
  });

  it("renders Queued helper exactly at the 30s threshold", () => {
    const at = new Date(Date.now() + 30_000).toISOString();
    render(
      <AllocatorSyncStatus
        syncStatus="syncing"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        queuedNextAttemptAt={at}
      />,
    );
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toMatch(
      /Queued \u2014 exchange cooldown, retry in (28|29|30)s/,
    );
  });

  it("does NOT render Queued helper for non-syncing statuses even with future queuedNextAttemptAt", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    render(
      <AllocatorSyncStatus
        syncStatus="idle"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        queuedNextAttemptAt={future}
      />,
    );
    expect(
      screen.getByTestId("allocator-sync-helper").textContent,
    ).toBe("");
  });
});

describe("AllocatorSyncStatus — f4 helperOverride precedence (first-run failure surfacing)", () => {
  it("helperOverride takes precedence over computed helper text", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="idle"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        helperOverride="Sync request failed — click Sync now to retry"
      />,
    );
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toContain("Sync request failed");
  });

  it("helperOverride wins over revoked helper copy", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="revoked"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        helperOverride="custom override text"
      />,
    );
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toBe("custom override text");
    expect(helper.textContent).not.toContain("Re-add a read-only key");
  });

  it("empty-string helperOverride does not suppress computed helper text", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="revoked"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
        helperOverride=""
      />,
    );
    const helper = screen.getByTestId("allocator-sync-helper");
    expect(helper.textContent).toBe(
      "Re-add a read-only key from your exchange.",
    );
  });
});

describe("AllocatorSyncStatus — motion + spinner respects prefers-reduced-motion", () => {
  it("syncing pill includes a motion-safe:animate-spin spinner glyph", () => {
    render(
      <AllocatorSyncStatus
        syncStatus="syncing"
        syncError={null}
        lastSyncAt={null}
        exchange="binance"
      />,
    );
    const pill = screen.getByTestId("allocator-sync-pill");
    const svg = pill.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("class") ?? "").toMatch(/motion-safe:animate-spin/);
    expect(svg!.getAttribute("aria-hidden")).toBe("true");
  });
});

/**
 * ROSTER — every status that has a PILL_STYLES row must also have a `switch`
 * case that produces a visible label.
 *
 * ⛔ THE DEFECT THIS EXISTS TO CATCH, and why the compiler cannot.
 * `PILL_STYLES` is typed `Record<string, …>`, so `keyof typeof PILL_STYLES`
 * widens to `string`; `normalized` is therefore a `string` and the component's
 * `switch (normalized)` is NON-EXHAUSTIVE BY CONSTRUCTION. `pillLabel` is
 * declared `let pillLabel: React.ReactNode`, which admits `undefined`, so no
 * definite-assignment error fires either. A status added to `PILL_STYLES` but
 * NOT to the switch therefore type-checks, lints, and renders a correctly
 * COLOURED, completely EMPTY pill — the silent failure, in the surface whose
 * whole job is telling an allocator that a key is broken.
 *
 * ⛔ THE ROSTER IS DERIVED FROM THE LIVE MAP, NEVER HAND-LISTED. A literal
 * array here would be a second list that can fall out of step with the first,
 * which is the very defect being guarded — the next status would be missing
 * from BOTH the switch and the roster, and this test would stay green.
 * `Object.keys(PILL_STYLES)` means adding a style row is what arms the guard.
 */
describe("AllocatorSyncStatus — PILL_STYLES roster is fully labelled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Non-vacuity: if the map were ever emptied or the import went undefined,
  // the `it.each` below would run zero cases and report green over nothing.
  it("walks a non-empty roster", () => {
    expect(Object.keys(PILL_STYLES).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(PILL_STYLES))(
    "status %s renders a non-empty pill label",
    (status) => {
      render(
        <AllocatorSyncStatus
          syncStatus={status}
          syncError={null}
          lastSyncAt={null}
          exchange="binance"
        />,
      );
      const pill = screen.getByTestId("allocator-sync-pill");
      // The status must round-trip: a key present in PILL_STYLES must never be
      // normalised away to the `idle` fallback, or the assertion below would
      // be measuring the fallback's label instead of this status'.
      expect(pill.getAttribute("data-sync-status")).toBe(status);
      expect((pill.textContent ?? "").trim()).not.toBe("");
    },
  );
});
