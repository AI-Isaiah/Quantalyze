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
 * D-10 (founder 2026-10-14): when the venue read is unavailable the label slot
 * shows a muted "Venue unavailable" placeholder, never the listed exchange and
 * never a blank.
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
 * do. The label is the `font-medium` span; the D-10 placeholder is the
 * `[data-venue-unavailable]` span.
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
  clone
    .querySelectorAll(".sr-only, span.font-medium, [data-venue-unavailable]")
    .forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function labelOf(container: HTMLElement): string | null {
  return container.querySelector("span.font-medium")?.textContent ?? null;
}

function placeholderOf(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-venue-unavailable]");
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

describe("SyncBadge - an UNAVAILABLE venue shows a muted 'Venue unavailable', never the listed exchange (D-10, review WR-01, SFH-2)", () => {
  const UNKNOWN = {
    tradeVenuesUnavailable: true,
    listedExchanges: ["bybit"],
    exchange: "bybit",
  } as const;

  /** How many times `needle` occurs in `haystack`. */
  const occurrences = (haystack: string, needle: string) =>
    haystack.split(needle).length - 1;

  it("fresh state: the label slot reads 'Venue unavailable', not the listed Bybit, and the tooltip names no venue", () => {
    const { container } = render(<SyncBadge {...CURRENT} {...UNKNOWN} />);
    // The placeholder is its own span, never the real label's font-medium span.
    expect(labelOf(container)).toBeNull();
    expect(placeholderOf(container)?.firstChild?.textContent).toBe("Venue unavailable");
    expect(visibleText(container)).not.toContain("Bybit");
    expect(titleOf(container)).toContain("Trades last fetched 2h ago");
    expect(titleOf(container)).not.toContain("from the exchange");
    expect(titleOf(container)).not.toContain("Bybit");
    expect(titleOf(container)).not.toContain("Listed as");
  });

  it("the stale tooltip drops the venue clause too, and the placeholder still renders", () => {
    const { container } = render(
      <SyncBadge {...CURRENT} tradesFetchedAt={ago(9 * DAY)} {...UNKNOWN} />,
    );
    expect(labelOf(container)).toBeNull();
    expect(placeholderOf(container)?.firstChild?.textContent).toBe("Venue unavailable");
    expect(titleOf(container)).toMatch(
      new RegExp(`^No trades fetched in more than ${TRADE_FETCH_STALE_DAYS} days\\.`),
    );
    expect(titleOf(container)).not.toContain("the exchange");
  });

  it("in EVERY rendered state the text reads 'Venue unavailable' exactly once and never Bybit", () => {
    let rendered = 0;
    for (const stamp of [null, ago(2 * HOUR), ago(9 * DAY), ahead(2 * DAY)]) {
      for (const seriesEnd of [null, ago(20 * DAY)]) {
        const { container, unmount } = render(
          <SyncBadge
            computedAt={ago(1 * HOUR)}
            seriesEnd={seriesEnd}
            tradesFetchedAt={stamp}
            tradeFetchVenue={null}
            {...UNKNOWN}
          />,
        );
        if (container.firstChild !== null) {
          rendered += 1;
          const text = visibleText(container);
          expect(occurrences(text, "Venue unavailable")).toBe(1);
          expect(text).not.toContain("Bybit");
          expect(titleOf(container)).not.toContain("Bybit");
        }
        unmount();
      }
    }
    // Guard against a vacuous loop: most of the grid renders a badge.
    expect(rendered).toBeGreaterThanOrEqual(6);
  });

  it("the placeholder is muted: text-text-muted, and none of the real label's or a failure colour's classes", () => {
    const { container } = render(<SyncBadge {...CURRENT} {...UNKNOWN} />);
    const classes = Array.from(placeholderOf(container)?.classList ?? []);
    expect(classes).toContain("text-text-muted");
    for (const forbidden of [
      "font-medium",
      "text-text-secondary",
      "text-negative",
      "text-warning",
    ]) {
      expect(classes).not.toContain(forbidden);
    }
  });

  it("an empty venue list with the flag is just as unknown as an absent one", () => {
    const { container } = render(
      <SyncBadge {...CURRENT} {...UNKNOWN} tradeVenues={[]} />,
    );
    expect(placeholderOf(container)?.firstChild?.textContent).toBe("Venue unavailable");
    expect(labelOf(container)).toBeNull();
    expect(visibleText(container)).not.toContain("Bybit");
  });

  it("a key venue that IS known still wins over a stray unavailable flag", () => {
    const { container } = render(
      <SyncBadge {...CURRENT} {...UNKNOWN} tradeVenues={["okx"]} />,
    );
    expect(labelOf(container)).toBe("OKX");
    expect(placeholderOf(container)).toBeNull();
    expect(visibleText(container)).not.toContain("Venue unavailable");
  });

  it("control: without the flag and without venues the listed exchange is the label and there is no placeholder (D-05)", () => {
    for (const flag of [undefined, false] as const) {
      const { container, unmount } = render(
        <SyncBadge
          {...CURRENT}
          listedExchanges={["bybit"]}
          exchange="bybit"
          tradeVenuesUnavailable={flag}
        />,
      );
      expect(labelOf(container)).toBe("Bybit");
      expect(placeholderOf(container)).toBeNull();
      unmount();
    }
  });

  it("D-07: the dot, the sentence and the render gate are unchanged by the flag, and the placeholder never renders without the badge", () => {
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
          // Rendered implies exactly one placeholder.
          expect(
            flagged.container.querySelectorAll("[data-venue-unavailable]"),
          ).toHaveLength(1);
        } else {
          // Not rendered implies no placeholder.
          expect(placeholderOf(flagged.container)).toBeNull();
        }
        without.unmount();
        flagged.unmount();
      }
    }
  });
});

/**
 * Review WR-01 (plan 06 round 1): the placeholder is two words in the same muted
 * colour as the sentence after it, so with nothing between them the badge read
 * "Venue unavailable Trades fetched 9d ago" on screen and was announced as one
 * noun phrase ("venue unavailable trades"). A real label is a one-word proper
 * noun in `font-medium`, which is why it never needed a boundary. The placeholder
 * borrows the badge's own `Separator`: a visible " · " and a screen-reader comma.
 */
describe("SyncBadge - the 'Venue unavailable' placeholder is set apart from the sentence (review WR-01, round 2)", () => {
  const UNKNOWN = {
    tradeVenuesUnavailable: true,
    listedExchanges: ["bybit"],
    exchange: "bybit",
  } as const;

  /** What a screen reader announces: aria-hidden nodes dropped, sr-only kept. */
  function accessibleText(container: HTMLElement): string {
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  // A null stamp only reads "No trade fetch recorded yet" for a fetched venue,
  // so the `never` case hands the badge a key venue (it still names no label).
  const STATES: ReadonlyArray<readonly [string, string, string | null, string | null]> = [
    ["current", "Venue unavailable · Trades fetched 2h ago", ago(2 * HOUR), null],
    ["stale", "Venue unavailable · Trades fetched 9d ago · stale", ago(9 * DAY), null],
    ["never", "Venue unavailable · No trade fetch recorded yet", null, null],
    ["series-bound", "Venue unavailable · Track record ends 20d ago", ago(2 * HOUR), ago(20 * DAY)],
  ];

  for (const [state, visible, stamp, seriesEnd] of STATES) {
    it(`${state}: the visible text puts a ' · ' between the placeholder and the sentence`, () => {
      const { container } = render(
        <SyncBadge
          computedAt={null}
          seriesEnd={seriesEnd}
          tradesFetchedAt={stamp}
          tradeFetchVenue={state === "never" ? "okx" : null}
          {...UNKNOWN}
        />,
      );
      expect(visibleText(container)).toBe(visible);
    });

    it(`${state}: a screen reader hears 'Venue unavailable,' and then the sentence, not one noun phrase`, () => {
      const { container } = render(
        <SyncBadge
          computedAt={null}
          seriesEnd={seriesEnd}
          tradesFetchedAt={stamp}
          tradeFetchVenue={state === "never" ? "okx" : null}
          {...UNKNOWN}
        />,
      );
      const heard = accessibleText(container);
      expect(heard.startsWith("Venue unavailable, ")).toBe(true);
      expect(heard).not.toMatch(/Venue unavailable [A-Z]/);
    });
  }

  it("a known venue label is NOT given the boundary (D-05 stays as it was)", () => {
    const { container } = render(
      <SyncBadge {...CURRENT} tradeVenues={["okx"]} listedExchanges={["okx"]} exchange="okx" />,
    );
    expect(visibleText(container)).toBe("OKXTrades fetched 2h ago");
    expect(accessibleText(container)).not.toContain("OKX,");
  });
});

/**
 * Review WR-02 (plan 06 round 1, measured in round 2): on a phone the placeholder
 * sits in the pinned Strategy name cell, a ~106 px column below `@3xl` (D-09).
 * Measured in Chromium at V360, V375 and V390 against the real compiled CSS and
 * the real table markup: without a no-wrap guard it broke inside itself ("Venue"
 * over "unavailable"), and the flagged short-name row stood 15.5 px taller than
 * the same row with a known venue (140.1 px against 124.6 px). jsdom has no
 * layout, so this pins the two class decisions that produced the measurement:
 * the placeholder is no-wrap, and the badge root is NOT `flex-wrap`. That second
 * half is the trap: `flex-wrap` also keeps the label on one line, but it drops
 * the badge's min-content to its widest item, the table's auto layout then
 * shrinks the whole name column (138 -> 120 px measured) and the dot is stranded
 * on a line of its own.
 */
describe("SyncBadge - the 'Venue unavailable' placeholder never breaks inside itself (review WR-02, round 2)", () => {
  const UNKNOWN = {
    tradeVenuesUnavailable: true,
    listedExchanges: ["bybit"],
    exchange: "bybit",
  } as const;

  it("the placeholder is whitespace-nowrap, so it can only move as a unit", () => {
    const { container } = render(<SyncBadge {...CURRENT} {...UNKNOWN} />);
    expect(Array.from(placeholderOf(container)?.classList ?? [])).toContain(
      "whitespace-nowrap",
    );
  });

  it("the badge root is not flex-wrap in any state: that would shrink the pinned name column", () => {
    for (const stamp of [ago(2 * HOUR), ago(9 * DAY)]) {
      const { container, unmount } = render(
        <SyncBadge {...CURRENT} tradesFetchedAt={stamp} {...UNKNOWN} />,
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).not.toContain("flex-wrap");
      unmount();
    }
  });

  it("the real label keeps its own markup: no no-wrap class added to a known venue (D-05 byte-identical)", () => {
    const { container } = render(
      <SyncBadge {...CURRENT} tradeVenues={["okx"]} listedExchanges={["okx"]} exchange="okx" />,
    );
    expect(container.querySelector("span.font-medium")?.className).toBe(
      "font-medium text-text-secondary",
    );
    expect(container.innerHTML).not.toContain("whitespace-nowrap");
  });
});
