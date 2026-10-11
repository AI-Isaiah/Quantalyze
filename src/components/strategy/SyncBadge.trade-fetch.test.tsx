/**
 * Phase 167.1.2.2.2 / TRADESYNC (SC-4, D-05, D-06, D-07, D-14, F2) — the badge
 * states the last TRADE FETCH, never the analytics compute time.
 *
 * THE DEFECT, measured on PROD (RESEARCH Section 4). `SyncBadge` read
 * `strategy_analytics.computed_at`, which the status bridge re-stamps on every
 * job transition. Five strategies whose newest trade was 15-156 days old
 * therefore read "Synced" within the day. "Synced" is a claim about the JOB and
 * every reader takes it as a claim about the STRATEGY.
 *
 * ⛔ EVERY CASE BELOW PINS THE RENDERED TEXT AND THE DOT TOGETHER. The defect
 * was a green dot over a sentence about the wrong clock, so a case asserting
 * only one of the two could pass on the bug.
 *
 * `visibleText` strips the screen-reader-only separator (`.sr-only`), because
 * the visible string and the spoken string differ by design: a sighted reader
 * sees "Trades fetched 9d ago · stale", a screen reader hears
 * "Trades fetched 9d ago, stale".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { SyncBadge } from "./SyncBadge";
import { StrategyGrid } from "./StrategyGrid";
import { TRADE_FETCH_STALE_DAYS } from "@/lib/freshness";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function agoIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function aheadIso(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

/** The freshness dot is the only element carrying the `rounded-full` token. */
function dotClass(container: HTMLElement): string {
  const dot = container.querySelector("span.rounded-full");
  expect(dot).toBeTruthy();
  return dot!.className;
}

/** What a sighted reader sees: the `.sr-only` separator is not part of it. */
function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".sr-only").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function titleOf(container: HTMLElement): string | null {
  return container.firstElementChild?.getAttribute("title") ?? null;
}

describe("SyncBadge — the trade fetch is the subject (SC-4, D-07, D-14)", () => {
  it("SC-4 RED-on-today's-badge: a fresh computedAt over a 9-day-old trade fetch reads stale", () => {
    // The exact production shape: the analytics job ran an hour ago, the last
    // trade fetch was nine days ago.
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={agoIso(9 * DAY)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 9d ago · stale");
    expect(visibleText(container)).not.toMatch(/Synced/);
    expect(dotClass(container)).toContain("bg-negative");
    // The word `stale` is its own element, in the negative text token.
    const staleWord = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "stale",
    );
    expect(staleWord).toBeTruthy();
    expect(staleWord!.className).toContain("text-negative");
    expect(titleOf(container)).toBe(
      `No trades fetched from the exchange in more than ${TRADE_FETCH_STALE_DAYS} days. Last fetch 9d ago. Analytics last computed 1h ago.`,
    );
  });

  it("D-14: today's badge sentence is gone — a healthy fetch reads 'Trades fetched', never 'Synced'", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={agoIso(1 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 1h ago");
    expect(container.textContent).not.toMatch(/Synced/);
  });

  it("current: a fetch 5h ago with a live series reads Trades fetched, positive dot, exact title", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={agoIso(5 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 5h ago");
    expect(dotClass(container)).toContain("bg-positive");
    expect(titleOf(container)).toBe(
      `Trades last fetched from the exchange 5h ago. Fetched daily; marked stale after ${TRADE_FETCH_STALE_DAYS} days without a fetch. Analytics last computed 1h ago.`,
    );
  });

  it("F2: a ccxt venue with no fetch recorded reads 'No trade fetch recorded yet', muted, never 'Trades not yet fetched'", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={null}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("No trade fetch recorded yet");
    expect(container.textContent).not.toMatch(/Trades not yet fetched/);
    expect(dotClass(container)).toContain("bg-text-muted");
    expect(titleOf(container)).toBe(
      "No trade fetch is recorded for this strategy yet. Trades are fetched daily. Analytics last computed 1h ago.",
    );
  });

  it("not applicable: no fetch and no ccxt venue falls back to the series sentence with the series tone", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(10 * DAY)}
        tradesFetchedAt={null}
        tradeFetchVenue={null}
      />,
    );

    expect(visibleText(container)).toBe("Track record ends 10d ago");
    // 10 days is past the 7-day series ladder: the series tone, unchanged.
    expect(dotClass(container)).toContain("bg-negative");
    expect(titleOf(container)).toBe(
      "Track record ends 10d ago. Analytics last computed 1h ago.",
    );
  });

  it("not applicable with a live series end keeps the series tone (positive), still no trade claim", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={null}
        tradeFetchVenue={null}
      />,
    );

    expect(visibleText(container)).toBe("Track record ends 1d ago");
    expect(dotClass(container)).toContain("bg-positive");
    expect(container.textContent).not.toMatch(/Trade/);
  });

  it("not applicable with no series end renders nothing at all", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={null}
        tradesFetchedAt={null}
        tradeFetchVenue={null}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("an unparseable series end is no claim either: nothing renders", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd="not-a-date"
        tradesFetchedAt={null}
        tradeFetchVenue={null}
      />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("future: a fetch time 2h ahead is a data defect — muted, never 'just now'", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={aheadIso(2 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched · future — check data");
    expect(dotClass(container)).toContain("bg-text-muted");
    expect(container.textContent).not.toMatch(/just now/i);
    expect(titleOf(container)).toBe(
      "The recorded trade fetch time is in the future, so no fetch age is shown. Analytics last computed 1h ago.",
    );
  });

  it("an unparseable trade fetch time makes no trade claim (the series half stands)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { container } = render(
        <SyncBadge
          computedAt={agoIso(1 * HOUR)}
          seriesEnd={agoIso(10 * DAY)}
          tradesFetchedAt="garbled-timestamp"
          tradeFetchVenue="okx"
        />,
      );

      expect(visibleText(container)).toBe("Track record ends 10d ago");
      expect(container.textContent).not.toMatch(/Trade/);
    } finally {
      warn.mockRestore();
    }
  });

  it("venue null does not demote a recorded fetch: a non-null time is authoritative (D-06)", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={agoIso(5 * HOUR)}
        tradeFetchVenue={null}
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 5h ago");
    expect(dotClass(container)).toContain("bg-positive");
  });

  it("a recorded stale fetch is stale at a venue-less public mount too (every viewer, D-06)", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={agoIso(5 * DAY)}
        tradeFetchVenue={null}
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 5d ago · stale");
    expect(dotClass(container)).toContain("bg-negative");
  });
});

describe("SyncBadge — D-07: computedAt drives nothing visible", () => {
  it("computedAt null with a recent fetch still renders the fetch (the old computedAt gate is gone)", () => {
    const { container } = render(
      <SyncBadge
        computedAt={null}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={agoIso(1 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 1h ago");
    expect(dotClass(container)).toContain("bg-positive");
    // No compute time recorded: the tooltip carries no 'Analytics last computed'.
    expect(titleOf(container)).not.toMatch(/Analytics last computed/);
  });

  it.each([
    ["null", null],
    ["1 hour ago", 1 * HOUR],
    ["400 days ago", 400 * DAY],
  ] as const)(
    "the visible sentence and the dot are identical whatever computedAt is (%s)",
    (_label, computedAgo) => {
      const { container } = render(
        <SyncBadge
          computedAt={computedAgo === null ? null : agoIso(computedAgo)}
          seriesEnd={agoIso(1 * DAY)}
          tradesFetchedAt={agoIso(5 * HOUR)}
          tradeFetchVenue="okx"
        />,
      );

      expect(visibleText(container)).toBe("Trades fetched 5h ago");
      expect(dotClass(container)).toContain("bg-positive");
    },
  );

  it.each([
    ["null", null],
    ["1 hour ago", 1 * HOUR],
    ["400 days ago", 400 * DAY],
  ] as const)(
    "a binding series verdict (5d, amber) is judged on the series ladder alone, whatever computedAt is (%s)",
    (_label, computedAgo) => {
      // The series half must not be compared against the compute time: a
      // 400-day-old computedAt would otherwise outrank the 5-day series and
      // silently drop the amber verdict.
      const { container } = render(
        <SyncBadge
          computedAt={computedAgo === null ? null : agoIso(computedAgo)}
          seriesEnd={agoIso(5 * DAY)}
          tradesFetchedAt={agoIso(5 * HOUR)}
          tradeFetchVenue="okx"
        />,
      );

      expect(visibleText(container)).toBe("Track record ends 5d ago");
      expect(dotClass(container)).toContain("bg-amber-400");
    },
  );

  it("a stale fetch stays stale whatever computedAt says (a fresh job does not launder it)", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(30 * 1000)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={agoIso(9 * DAY)}
        tradeFetchVenue="okx"
      />,
    );

    expect(dotClass(container)).toContain("bg-negative");
    expect(visibleText(container)).toMatch(/stale$/);
  });

  it("an unparseable computedAt adds no suffix and breaks nothing", () => {
    const { container } = render(
      <SyncBadge
        computedAt="not-a-date"
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={agoIso(5 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 5h ago");
    expect(titleOf(container)).not.toMatch(/NaN|Analytics last computed/);
  });
});

describe("SyncBadge — precedence between the trade fetch and the series end", () => {
  it("a worse series outranks a current fetch; the tooltip keeps the fetch age", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(9 * DAY)}
        tradesFetchedAt={agoIso(1 * DAY)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Track record ends 9d ago");
    expect(dotClass(container)).toContain("bg-negative");
    expect(titleOf(container)).toBe(
      "Track record ends 9d ago. Trades last fetched 1d ago. Analytics last computed 1h ago.",
    );
  });

  it("a worse series outranks a never-fetched venue; the tooltip says no fetch is recorded", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(9 * DAY)}
        tradesFetchedAt={null}
        tradeFetchVenue="bybit"
      />,
    );

    expect(visibleText(container)).toBe("Track record ends 9d ago");
    expect(titleOf(container)).toBe(
      "Track record ends 9d ago. No trade fetch recorded yet. Analytics last computed 1h ago.",
    );
  });

  it("a live series never outranks never-fetched: the ranks tie to the trade sentence", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(1 * DAY)}
        tradesFetchedAt={null}
        tradeFetchVenue="binance"
      />,
    );

    expect(visibleText(container)).toBe("No trade fetch recorded yet");
  });

  it("a stale fetch ALWAYS binds, even over a 112-day-dead series (it is the cause)", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(112 * DAY)}
        tradesFetchedAt={agoIso(9 * DAY)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 9d ago · stale");
    expect(visibleText(container)).not.toMatch(/Track record/);
  });

  it("a stale fetch ALWAYS binds, even over a future series end", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={aheadIso(3 * DAY)}
        tradesFetchedAt={agoIso(9 * DAY)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 9d ago · stale");
    expect(dotClass(container)).toContain("bg-negative");
  });

  it("a future fetch time binds (muted) over a dead series", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={agoIso(112 * DAY)}
        tradesFetchedAt={aheadIso(2 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched · future — check data");
    expect(dotClass(container)).toContain("bg-text-muted");
  });

  it("a future series end outranks a current fetch and renders muted, naming its subject", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(5 * DAY)}
        seriesEnd={aheadIso(3 * DAY)}
        tradesFetchedAt={agoIso(2 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Track record ends in the future");
    expect(dotClass(container)).toContain("bg-text-muted");
    // The compute time is not discarded: it moves into the tooltip.
    expect(titleOf(container)).toBe(
      "Track record ends in the future. Trades last fetched 2h ago. Analytics last computed 5d ago.",
    );
  });

  it("a same-day series bar dated ahead (inside the day allowance) is current: no 'in the future', no claim of the series", () => {
    // `series_end` is a UTC DATE; a same-day bar is legitimately ahead of a
    // browser west of UTC (WR-06-UTC). With a fetch recorded it simply does
    // not bind.
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={aheadIso(1 * HOUR)}
        tradesFetchedAt={agoIso(2 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 2h ago");
    expect(dotClass(container)).toContain("bg-positive");
  });

  it("with no fetch claim, a same-day series bar ahead reads current, never 'in the future' beside a positive dot", () => {
    const { container } = render(
      <SyncBadge
        computedAt={agoIso(1 * HOUR)}
        seriesEnd={aheadIso(1 * HOUR)}
        tradesFetchedAt={null}
        tradeFetchVenue={null}
      />,
    );

    expect(dotClass(container)).toContain("bg-positive");
    expect(container.textContent).not.toMatch(/in the future/i);
    expect(visibleText(container)).toBe("Track record ends just now");
  });
});

describe("SyncBadge — the 2-day boundary, through the badge (D-05)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exactly 48 h old is current", () => {
    const { container } = render(
      <SyncBadge
        computedAt={null}
        seriesEnd={null}
        tradesFetchedAt={new Date(Date.now() - 2 * DAY).toISOString()}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 2d ago");
    expect(dotClass(container)).toContain("bg-positive");
  });

  it("48 h plus 1 ms is stale", () => {
    const { container } = render(
      <SyncBadge
        computedAt={null}
        seriesEnd={null}
        tradesFetchedAt={new Date(Date.now() - 2 * DAY - 1).toISOString()}
        tradeFetchVenue="okx"
      />,
    );

    expect(visibleText(container)).toBe("Trades fetched 2d ago · stale");
    expect(dotClass(container)).toContain("bg-negative");
  });
});

describe("SyncBadge — markup contract (accessibility, venue label)", () => {
  it("the separator is aria-hidden and a screen reader hears a comma; the dot is aria-hidden", () => {
    const { container } = render(
      <SyncBadge
        computedAt={null}
        seriesEnd={null}
        tradesFetchedAt={agoIso(9 * DAY)}
        tradeFetchVenue="okx"
      />,
    );

    const dot = container.querySelector("span.rounded-full");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");

    const hidden = container.querySelector('span[aria-hidden="true"]:not(.rounded-full)');
    expect(hidden?.textContent).toBe(" · ");
    const srOnly = container.querySelector("span.sr-only");
    expect(srOnly?.textContent).toBe(", ");
    // What assistive tech reads: the aria-hidden separator is skipped, the
    // sr-only comma is kept.
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
    expect((clone.textContent ?? "").replace(/\s+/g, " ").trim()).toBe(
      "Trades fetched 9d ago, stale",
    );
  });

  it("the future variant uses the same separator markup", () => {
    const { container } = render(
      <SyncBadge
        computedAt={null}
        seriesEnd={null}
        tradesFetchedAt={aheadIso(2 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );

    expect(container.querySelector('span[aria-hidden="true"]:not(.rounded-full)')?.textContent).toBe(" · ");
    expect(container.querySelector("span.sr-only")?.textContent).toBe(", ");
  });

  it("the exchange label still renders before the sentence, and tradeFetchVenue does not create one", () => {
    const withLabel = render(
      <SyncBadge
        computedAt={null}
        seriesEnd={null}
        exchange="okx"
        tradesFetchedAt={agoIso(5 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );
    // Flex items with a gap, no whitespace between them in the DOM.
    expect(visibleText(withLabel.container)).toBe("OKXTrades fetched 5h ago");
    expect(withLabel.container.querySelector(".font-medium")?.textContent).toBe("OKX");
    withLabel.unmount();

    const withoutLabel = render(
      <SyncBadge
        computedAt={null}
        seriesEnd={null}
        tradesFetchedAt={agoIso(5 * HOUR)}
        tradeFetchVenue="okx"
      />,
    );
    expect(visibleText(withoutLabel.container)).toBe("Trades fetched 5h ago");
  });

  it("the venue lookup is case-insensitive (the api-key exchange arrives lower-case, a label may not)", () => {
    const { container } = render(
      <SyncBadge
        computedAt={null}
        seriesEnd={null}
        tradesFetchedAt={null}
        tradeFetchVenue="OKX"
      />,
    );

    expect(visibleText(container)).toBe("No trade fetch recorded yet");
  });
});

// =========================================================================
// Mount wiring — the public StrategyGrid (plan 22, SC-4, D-06, D-07, F3)
// =========================================================================

type GridRow = Strategy & { analytics: StrategyAnalytics };

/**
 * A published, non-example grid row. `api_key_id` is null on purpose: the grid
 * is fed by the anonymous list read, which cannot see `api_keys`, so the mount
 * has no api-key exchange to name and passes `tradeFetchVenue={null}`.
 */
function gridRow(
  over: { exchanges: string[]; tradesFetchedAt: string | null },
): GridRow {
  return {
    id: "7a5d0001-0000-4000-8000-000000000001",
    name: "Grid Wiring Spec",
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: [],
    markets: ["Spot"],
    supported_exchanges: over.exchanges,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    trust_tier: null,
    analytics: {
      strategy_id: "7a5d0001-0000-4000-8000-000000000001",
      computation_status: "complete",
      computed_at: agoIso(1 * HOUR),
      // A live series, so the badge MOUNTS in every case: a case that renders
      // nothing at all would pass "no trade sentence" vacuously.
      series_end: agoIso(1 * DAY),
      trades_fetched_at: over.tradesFetchedAt,
      sparkline_returns: [1, 2, 3],
      cumulative_return: 0.1,
      cagr: 0.05,
    } as unknown as StrategyAnalytics,
  } as unknown as GridRow;
}

describe("StrategyGrid mount — the trade claim comes from the cron's record only", () => {
  it("F3: a CSV strategy declaring okx (no api key, no fetch) makes no trade claim", () => {
    const { container } = render(
      <StrategyGrid
        strategies={[gridRow({ exchanges: ["okx"], tradesFetchedAt: null })]}
        categorySlug="grid-wiring"
      />,
    );

    // The badge DID mount (the series half), so the absence below is a verdict
    // and not an empty render.
    expect(container.textContent).toContain("Track record ends 1d ago");
    // `supported_exchanges` is a DECLARATION; feeding it to the venue would
    // stamp "No trade fetch recorded yet" on a strategy no cron ever fetches.
    expect(container.textContent).not.toMatch(/Trades fetched/);
    expect(container.textContent).not.toMatch(/No trade fetch recorded yet/);
  });

  it("D-06/D-07: a published strategy fetched 5h ago reads Trades fetched 5h ago with no venue", () => {
    const { container } = render(
      <StrategyGrid
        strategies={[
          gridRow({ exchanges: ["okx"], tradesFetchedAt: agoIso(5 * HOUR) }),
        ]}
        categorySlug="grid-wiring"
      />,
    );

    expect(container.textContent).toContain("Trades fetched 5h ago");
    // The badge's recency claim is the trade fetch, never the compute time.
    expect(container.textContent).not.toMatch(/Synced/);
  });
});
