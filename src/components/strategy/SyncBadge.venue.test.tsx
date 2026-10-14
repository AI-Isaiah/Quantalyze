/**
 * Phase 170.6.1 / DISCOVERYPHONE (SC-2, D-05, D-07, O-1, O-2, O-3) — the badge
 * names the venue a strategy's trades come from, flags a disagreement with the
 * listing, and still claims EXACTLY what it claimed before.
 *
 * THE DEFECT (measured 2026-10-13, TRADESYNC plan 21): a Discovery row read
 * "Bybit" from `strategies.supported_exchanges` while its connected key sits on
 * OKX. `tradeVenues` is the key's venue; it changes the visible LABEL and the
 * TOOLTIP and nothing else.
 *
 * Two groups of cases, because the change has two opposite duties:
 *   - D-05 (names the venue): label order, mismatch rule, no-key fallback,
 *     display names through `EXCHANGE_DISPLAY`;
 *   - D-07 (claims nothing new): the dot, the visible sentence and the render
 *     gate are identical with and without `tradeVenues`, in every trade state.
 *     The tell for the dangerous regression is a null stamp: feeding the venue
 *     into `resolveTradeFetch` turns it into "No trade fetch recorded yet".
 *
 * `visibleText` strips the screen-reader-only separator, as the sibling files
 * do. The label is the `font-medium` span.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { SyncBadge } from "./SyncBadge";
import { TRADE_FETCH_STALE_DAYS } from "@/lib/freshness";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".sr-only").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The sentence alone: the visible text with the venue label removed. */
function sentenceOf(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".sr-only, span.font-medium").forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function labelOf(container: HTMLElement): string | null {
  return container.querySelector("span.font-medium")?.textContent ?? null;
}

function titleOf(container: HTMLElement): string {
  return container.firstElementChild?.getAttribute("title") ?? "";
}

function dotClass(container: HTMLElement): string {
  return container.querySelector("span.rounded-full")?.className ?? "";
}

/** A renderable `current` state: a fetch two hours ago, no series claim. */
const CURRENT = {
  computedAt: null,
  seriesEnd: null,
  tradesFetchedAt: ago(2 * HOUR),
  tradeFetchVenue: null,
} as const;

describe("SyncBadge - the key's venue is the label (D-05, O-1, O-3)", () => {
  it("several venues, disjoint from the listing: label order, and the mismatch sentence names them all", () => {
    const { container } = render(
      <SyncBadge
        {...CURRENT}
        tradeVenues={["okx", "bybit", "okx"]}
        listedExchanges={["binance"]}
        exchange="binance"
      />,
    );
    // Label order (O-1): Bybit before OKX, though the codes arrived okx first.
    expect(labelOf(container)).toBe("Bybit, OKX");
    expect(titleOf(container)).toContain("Listed as Binance; trades come from Bybit, OKX");
    expect(titleOf(container)).toContain("Trades last fetched from Bybit, OKX 2h ago");
  });

  it("{Listed} is the label of listedExchanges[0], not the exchange prop (Info 1)", () => {
    const { container } = render(
      <SyncBadge
        {...CURRENT}
        tradeVenues={["okx"]}
        listedExchanges={["bybit", "binance"]}
        exchange="binance"
      />,
    );
    expect(titleOf(container)).toContain("Listed as Bybit; trades come from OKX");
    expect(titleOf(container)).not.toContain("Listed as Binance");
  });

  it("{Listed} falls back to the exchange prop only when no listed set is handed over", () => {
    // No listedExchanges at all: there is nothing to DISAGREE with (no cue)...
    const noSet = render(
      <SyncBadge {...CURRENT} tradeVenues={["okx"]} exchange="bybit" />,
    );
    expect(titleOf(noSet.container)).not.toContain("Listed as");
    noSet.unmount();
    // ...and an EMPTY set is the same: absent and empty both mean "no listing".
    const empty = render(
      <SyncBadge {...CURRENT} tradeVenues={["okx"]} listedExchanges={[]} exchange="bybit" />,
    );
    expect(titleOf(empty.container)).not.toContain("Listed as");
  });

  it("partial overlap (O-3): listed [bybit], venues [bybit, okx] shows the cue and it names OKX", () => {
    const { container } = render(
      <SyncBadge
        {...CURRENT}
        tradeVenues={["bybit", "okx"]}
        listedExchanges={["bybit"]}
        exchange="bybit"
      />,
    );
    expect(titleOf(container)).toContain("Listed as Bybit; trades come from Bybit, OKX");
  });

  it("full containment (O-3): the venues all sit in the whole listed set, so there is NO cue", () => {
    // `supported_exchanges[0]` alone (bybit) differs from the venue set
    // (bybit, okx), which is exactly the false alarm the listed SET prevents.
    const { container } = render(
      <SyncBadge
        {...CURRENT}
        tradeVenues={["bybit", "okx"]}
        listedExchanges={["bybit", "okx"]}
        exchange="bybit"
      />,
    );
    expect(labelOf(container)).toBe("Bybit, OKX");
    expect(titleOf(container)).not.toContain("Listed as");
  });

  it("orders by DISPLAY LABEL case-insensitively (O-1): sfox, mt5, okx reads MT5, OKX, sFOX", () => {
    const { container } = render(
      <SyncBadge {...CURRENT} tradeVenues={["sfox", "mt5", "okx"]} />,
    );
    expect(labelOf(container)).toBe("MT5, OKX, sFOX");
  });

  it("a match reads the venue with no cue, whatever the case of the listing", () => {
    for (const listed of [["okx"], ["OKX"]]) {
      const { container, unmount } = render(
        <SyncBadge {...CURRENT} tradeVenues={["okx"]} listedExchanges={listed} exchange={listed[0]} />,
      );
      expect(labelOf(container)).toBe("OKX");
      expect(titleOf(container)).toContain("from OKX");
      expect(titleOf(container)).not.toContain("Listed as");
      unmount();
    }
  });

  it("no key (D-05): null, undefined or [] keep the listed exchange and the old wording", () => {
    for (const venues of [null, undefined, []] as const) {
      const { container, unmount } = render(
        <SyncBadge
          {...CURRENT}
          tradeVenues={venues}
          listedExchanges={["bybit"]}
          exchange="bybit"
        />,
      );
      expect(labelOf(container)).toBe("Bybit");
      expect(titleOf(container)).toContain("Trades last fetched from the exchange 2h ago");
      expect(titleOf(container)).not.toContain("Listed as");
      unmount();
    }
  });

  it("no listed exchange at all: the venue is still the label, with no cue", () => {
    const { container } = render(<SyncBadge {...CURRENT} tradeVenues={["okx"]} />);
    expect(labelOf(container)).toBe("OKX");
    expect(titleOf(container)).not.toContain("Listed as");
  });

  it("the stale state names the venue: 'No trades fetched from OKX in more than N days'", () => {
    const { container } = render(
      <SyncBadge
        {...CURRENT}
        tradesFetchedAt={ago(9 * DAY)}
        tradeVenues={["okx"]}
        listedExchanges={["bybit"]}
        exchange="bybit"
      />,
    );
    expect(titleOf(container)).toMatch(
      new RegExp(`^No trades fetched from OKX in more than ${TRADE_FETCH_STALE_DAYS} days\\.`),
    );
    expect(titleOf(container)).toContain("Listed as Bybit; trades come from OKX");
  });

  it("the mismatch cue rides every state that renders, not only current and stale", () => {
    const common = {
      tradeVenues: ["okx"],
      listedExchanges: ["bybit"],
      exchange: "bybit",
    } as const;
    // series-bound (never-fetched ccxt venue over an old series)
    const series = render(
      <SyncBadge
        computedAt={null}
        seriesEnd={ago(20 * DAY)}
        tradesFetchedAt={null}
        tradeFetchVenue="okx"
        {...common}
      />,
    );
    expect(titleOf(series.container)).toContain("Listed as Bybit; trades come from OKX");
    series.unmount();
    // never
    const never = render(
      <SyncBadge computedAt={null} seriesEnd={null} tradesFetchedAt={null} tradeFetchVenue="okx" {...common} />,
    );
    expect(visibleText(never.container)).toContain("No trade fetch recorded yet");
    expect(titleOf(never.container)).toContain("Listed as Bybit; trades come from OKX");
    never.unmount();
    // future
    const future = render(
      <SyncBadge {...CURRENT} tradesFetchedAt={ahead(2 * DAY)} {...common} />,
    );
    expect(titleOf(future.container)).toContain("Listed as Bybit; trades come from OKX");
  });
});

describe("SyncBadge - display names come from EXCHANGE_DISPLAY (O-2)", () => {
  it("a deribit key renders Deribit, never deribit", () => {
    const { container } = render(<SyncBadge {...CURRENT} tradeVenues={["deribit"]} />);
    expect(labelOf(container)).toBe("Deribit");
  });

  it("a LISTED deribit, sfox and mt5 render their display names with no venues (today: raw, RED)", () => {
    const expected: Record<string, string> = {
      deribit: "Deribit",
      sfox: "sFOX",
      mt5: "MT5",
    };
    for (const [code, label] of Object.entries(expected)) {
      const { container, unmount } = render(<SyncBadge {...CURRENT} exchange={code} />);
      expect(labelOf(container)).toBe(label);
      unmount();
    }
  });

  it("an unknown code falls back to itself, and an inherited property name is not a label", () => {
    const unknown = render(<SyncBadge {...CURRENT} exchange="kraken" />);
    expect(labelOf(unknown.container)).toBe("kraken");
    unknown.unmount();
    const proto = render(<SyncBadge {...CURRENT} exchange="constructor" />);
    expect(labelOf(proto.container)).toBe("constructor");
  });
});

describe("SyncBadge - D-07: badge STATES do not change with tradeVenues", () => {
  const STAMPS: [string, string | null][] = [
    ["null stamp", null],
    ["recent stamp", ago(2 * HOUR)],
    ["stale stamp", ago(9 * DAY)],
    ["future stamp", ahead(2 * DAY)],
  ];
  const SERIES: [string, string | null][] = [
    ["no series end", null],
    ["a series end that binds", ago(20 * DAY)],
  ];

  for (const [stampName, stamp] of STAMPS) {
    for (const [seriesName, seriesEnd] of SERIES) {
      it(`${stampName} + ${seriesName}: dot, sentence and render gate are identical with and without tradeVenues`, () => {
        const props = {
          computedAt: ago(1 * HOUR),
          seriesEnd,
          tradesFetchedAt: stamp,
          tradeFetchVenue: null,
        } as const;
        const without = render(<SyncBadge {...props} />);
        const withVenues = render(
          <SyncBadge {...props} tradeVenues={["okx"]} listedExchanges={["bybit"]} exchange="bybit" />,
        );

        // Same render gate: both render, or neither does.
        expect(withVenues.container.firstChild === null).toBe(
          without.container.firstChild === null,
        );
        if (without.container.firstChild !== null) {
          expect(dotClass(withVenues.container)).toBe(dotClass(without.container));
          expect(sentenceOf(withVenues.container)).toBe(sentenceOf(without.container));
        }
      });
    }
  }

  it("a null stamp with a null tradeFetchVenue never reads 'No trade fetch recorded yet', venues or not", () => {
    // The dangerous regression: handing the venue to resolveTradeFetch turns a
    // null stamp into the `never` state on a surface that never claimed it.
    const { container } = render(
      <SyncBadge
        computedAt={ago(1 * HOUR)}
        seriesEnd={ago(20 * DAY)}
        tradesFetchedAt={null}
        tradeFetchVenue={null}
        tradeVenues={["okx"]}
        listedExchanges={["bybit"]}
        exchange="bybit"
      />,
    );
    expect(visibleText(container)).not.toContain("No trade fetch recorded yet");
    expect(titleOf(container)).not.toContain("No trade fetch is recorded");
    // With no series end either, the badge renders NOTHING, with venues too.
    const none = render(
      <SyncBadge
        computedAt={ago(1 * HOUR)}
        seriesEnd={null}
        tradesFetchedAt={null}
        tradeFetchVenue={null}
        tradeVenues={["okx"]}
      />,
    );
    expect(none.container.firstChild).toBeNull();
  });
});

describe("SyncBadge - an UNAVAILABLE venue names nothing (review WR-01, SFH-2)", () => {
  const UNKNOWN = {
    tradeVenuesUnavailable: true,
    listedExchanges: ["bybit"],
    exchange: "bybit",
  } as const;

  it("renders no label and no venue claim in a fresh tooltip, not the listed Bybit", () => {
    const { container } = render(<SyncBadge {...CURRENT} {...UNKNOWN} />);
    expect(labelOf(container)).toBeNull();
    expect(visibleText(container)).not.toContain("Bybit");
    expect(titleOf(container)).toContain("Trades last fetched 2h ago");
    expect(titleOf(container)).not.toContain("from the exchange");
    expect(titleOf(container)).not.toContain("Bybit");
    expect(titleOf(container)).not.toContain("Listed as");
  });

  it("the stale tooltip drops the venue clause too", () => {
    const { container } = render(
      <SyncBadge {...CURRENT} tradesFetchedAt={ago(9 * DAY)} {...UNKNOWN} />,
    );
    expect(labelOf(container)).toBeNull();
    expect(titleOf(container)).toMatch(
      new RegExp(`^No trades fetched in more than ${TRADE_FETCH_STALE_DAYS} days\\.`),
    );
    expect(titleOf(container)).not.toContain("the exchange");
  });

  it("a key venue that IS known still wins over a stray unavailable flag", () => {
    const { container } = render(
      <SyncBadge {...CURRENT} {...UNKNOWN} tradeVenues={["okx"]} />,
    );
    expect(labelOf(container)).toBe("OKX");
  });

  it("D-07: the dot, the sentence and the render gate are unchanged by the flag", () => {
    for (const stamp of [null, ago(2 * HOUR), ago(9 * DAY), ahead(2 * DAY)]) {
      for (const seriesEnd of [null, ago(20 * DAY)]) {
        const props = {
          computedAt: ago(1 * HOUR),
          seriesEnd,
          tradesFetchedAt: stamp,
          tradeFetchVenue: null,
        } as const;
        const without = render(<SyncBadge {...props} />);
        const flagged = render(<SyncBadge {...props} {...UNKNOWN} />);
        expect(flagged.container.firstChild === null).toBe(
          without.container.firstChild === null,
        );
        if (without.container.firstChild !== null) {
          expect(dotClass(flagged.container)).toBe(dotClass(without.container));
          expect(sentenceOf(flagged.container)).toBe(sentenceOf(without.container));
        }
        without.unmount();
        flagged.unmount();
      }
    }
  });
});

