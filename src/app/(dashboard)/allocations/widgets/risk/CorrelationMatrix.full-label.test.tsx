import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CorrelationMatrix } from "./CorrelationMatrix";
import type { TimeframeKey } from "../../lib/types";

// ---------------------------------------------------------------------------
// Phase 169.4 D-75 — the correlation matrix names each key in FULL.
//
// Why this matters: the Risk tab now names each connected key the way the
// Scenario does, `${Exchange} — ${nickname}`. The matrix used to cut every name
// to 10 characters, and "Binance — Main".slice(0, 10) is "Binance — ", the same
// string as "Binance — Hedge".slice(0, 10). Two keys on one exchange became one
// name, the title (the only place a reader could recover it) carried the cut
// string, and the rows and headers were React-keyed by it, so they collided.
// The label now renders whole (CSS ellipsis only, full text as the title) and
// every row and header is keyed by the key's id.
// ---------------------------------------------------------------------------

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const base = { timeframe: "1YTD" as TimeframeKey, width: 0, height: 0 };

const series = (seed: number) =>
  Array.from({ length: 30 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    value: (((i * seed) % 11) - 5) / 1000,
  }));

const TWO_KEYS_ONE_EXCHANGE = {
  strategies: [
    {
      strategy_id: "key-aaaa-1111",
      alias: "Binance — Main",
      strategy: { id: "key-aaaa-1111", strategy_analytics: { daily_returns: series(3) } },
    },
    {
      strategy_id: "key-bbbb-2222",
      alias: "Binance — Hedge",
      strategy: { id: "key-bbbb-2222", strategy_analytics: { daily_returns: series(7) } },
    },
  ],
};

function headerTitles(): (string | null)[] {
  return [...document.querySelectorAll("thead th[title]")].map((th) =>
    th.getAttribute("title"),
  );
}

function rowTitles(): (string | null)[] {
  return [...document.querySelectorAll("tbody tr")].map((tr) =>
    tr.querySelector("td")?.getAttribute("title") ?? null,
  );
}

describe("CorrelationMatrix — full key labels (D-75)", () => {
  it("two keys on one exchange render two distinct full labels, as headers and as row labels", () => {
    render(<CorrelationMatrix data={TWO_KEYS_ONE_EXCHANGE} {...base} />);
    expect(headerTitles()).toEqual(["Binance — Main", "Binance — Hedge"]);
    expect(rowTitles()).toEqual(["Binance — Main", "Binance — Hedge"]);
    expect(screen.getAllByText("Binance — Main")).toHaveLength(2);
    expect(screen.getAllByText("Binance — Hedge")).toHaveLength(2);
  });

  it("the precomputed path names in full too", () => {
    render(
      <CorrelationMatrix
        data={{
          strategies: TWO_KEYS_ONE_EXCHANGE.strategies,
          analytics: {
            correlation_matrix: {
              "key-aaaa-1111": { "key-aaaa-1111": 1, "key-bbbb-2222": 0.4 },
              "key-bbbb-2222": { "key-aaaa-1111": 0.4, "key-bbbb-2222": 1 },
            },
          },
        }}
        {...base}
      />,
    );
    expect(headerTitles()).toEqual(["Binance — Main", "Binance — Hedge"]);
    expect(rowTitles()).toEqual(["Binance — Main", "Binance — Hedge"]);
  });

  it("two keys that share a display name still get distinct React keys (keyed by id, not name)", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <CorrelationMatrix
        data={{
          strategies: TWO_KEYS_ONE_EXCHANGE.strategies.map((s) => ({
            ...s,
            alias: "Binance — Main",
          })),
        }}
        {...base}
      />,
    );
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
    const dupKey = errors.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes("same key")),
    );
    expect(dupKey).toBe(false);
  });
});
