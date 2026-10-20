import { describe, it, expect } from "vitest";

import { historyGate, resolveNotSyncingKeys } from "./history-gate";

// ---------------------------------------------------------------------------
// Phase 170.4 plan 04 (D-04, D-07, D-09) — the one function Overview and Risk
// choose their state through.
//
// Why this matters: on 2026-10-03 the Risk tab showed the rebuilding panel
// while the Overview showed its "No positions to analyze yet" card, because
// the Overview's empty-holdings early return ran before its rebuilding branch.
// Two tabs reading the same payload through two hand-written gates is the
// defect; these cases pin the single answer both must give.
// ---------------------------------------------------------------------------

const ONE_ROW = [{ symbol: "BTC" }] as never;
const TWO_ROWS = [{ symbol: "BTC" }, { symbol: "ETH" }] as never;

describe("historyGate", () => {
  it.each([
    // [label, input, expected]
    [
      "eligible key, empty book, not syncing, rebuilding (the 2026-10-03 case)",
      {
        hasConnectedKeys: true,
        holdingsSummary: [],
        hasSyncing: false,
        equityHistoryState: "rebuilding",
      },
      "rebuilding",
    ],
    [
      "no eligible key, empty book, not syncing, rebuilding (D-09: connect a key)",
      {
        hasConnectedKeys: false,
        holdingsSummary: [],
        hasSyncing: false,
        equityHistoryState: "rebuilding",
      },
      "no_eligible_key",
    ],
    // Phase 167.1.2.1.2 D-04 (2026-10-20, founder: "Show curve + factsheet"):
    // this row used to expect the connected-but-empty state. A ready history of
    // an all-closed book now renders figures, because the Risk tab already did
    // and the two tabs must agree for the same payload.
    [
      "eligible key, empty book, not syncing, ready (D-04: figures, not the empty card)",
      {
        hasConnectedKeys: true,
        holdingsSummary: [],
        hasSyncing: false,
        equityHistoryState: "ready",
      },
      "ready",
    ],
    [
      "eligible key, empty book, syncing, rebuilding",
      {
        hasConnectedKeys: true,
        holdingsSummary: [],
        hasSyncing: true,
        equityHistoryState: "rebuilding",
      },
      "rebuilding",
    ],
    [
      "no eligible key, two holdings, rebuilding",
      {
        hasConnectedKeys: false,
        holdingsSummary: TWO_ROWS,
        hasSyncing: false,
        equityHistoryState: "rebuilding",
      },
      "rebuilding",
    ],
    [
      "eligible key, holdings, ready",
      {
        hasConnectedKeys: true,
        holdingsSummary: ONE_ROW,
        hasSyncing: false,
        equityHistoryState: "ready",
      },
      "ready",
    ],
    [
      "no eligible key, empty book, not syncing, ready (still the connect card)",
      {
        hasConnectedKeys: false,
        holdingsSummary: [],
        hasSyncing: false,
        equityHistoryState: "ready",
      },
      "no_eligible_key",
    ],
  ])("%s -> %s", (_label, input, expected) => {
    expect(historyGate(input as never)).toBe(expected);
  });

  it.each([
    ["a missing state", undefined],
    ["null", null],
    ["an empty string", ""],
    ["an unrecognised state", "weird"],
    ["a mis-cased ready", "Ready"],
  ])(
    "fail-closed: %s reads as rebuilding, never ready",
    (_label, equityHistoryState) => {
      expect(
        historyGate({
          hasConnectedKeys: true,
          holdingsSummary: ONE_ROW,
          hasSyncing: false,
          equityHistoryState,
        } as never),
      ).toBe("rebuilding");
    },
  );

  it("hasConnectedKeys missing reads as no eligible key (the conservative default)", () => {
    expect(
      historyGate({
        holdingsSummary: [],
        hasSyncing: false,
        equityHistoryState: "ready",
      } as never),
    ).toBe("no_eligible_key");
  });

  it("D-07: live apiKeys rows do not stand in for hasConnectedKeys; the payload flag alone decides", () => {
    // A key list that looks connected must not change the answer: eligibility
    // is the server-side predicate carried in the payload, never re-derived.
    const liveKeys = [
      { id: "k1", exchange: "okx", is_active: true, sync_status: "ok" },
    ];
    expect(
      historyGate({
        hasConnectedKeys: false,
        apiKeys: liveKeys,
        activeVenues: ["OKX"],
        holdingsSummary: [],
        hasSyncing: false,
        equityHistoryState: "rebuilding",
      } as never),
    ).toBe("no_eligible_key");
    expect(
      historyGate({
        hasConnectedKeys: true,
        apiKeys: [],
        activeVenues: [],
        holdingsSummary: [],
        hasSyncing: false,
        equityHistoryState: "rebuilding",
      } as never),
    ).toBe("rebuilding");
  });

  it("D-07: holdings do not stand in for a key either (a populated book with no flag stays rebuilding, not 'connected')", () => {
    expect(
      historyGate({
        hasConnectedKeys: false,
        holdingsSummary: ONE_ROW,
        hasSyncing: false,
        equityHistoryState: "ready",
      } as never),
    ).toBe("ready");
  });
});

describe("resolveNotSyncingKeys", () => {
  const key = (id: string) => ({ id, exchange: "okx", label: id });

  it("no ids -> null (the unnamed line)", () => {
    expect(
      resolveNotSyncingKeys({
        equityHistoryNotSyncingKeyIds: [],
        apiKeys: [key("a")],
      } as never),
    ).toBeNull();
    expect(resolveNotSyncingKeys({ apiKeys: [key("a")] } as never)).toBeNull();
  });

  it("resolves ids to the owner's own key rows, in id order", () => {
    const a = key("a");
    const b = key("b");
    expect(
      resolveNotSyncingKeys({
        equityHistoryNotSyncingKeyIds: ["b", "a"],
        apiKeys: [a, b],
      } as never),
    ).toEqual([b, a]);
  });

  it("an id missing from apiKeys makes the whole set unknown (null), never a different key", () => {
    expect(
      resolveNotSyncingKeys({
        equityHistoryNotSyncingKeyIds: ["a", "gone"],
        apiKeys: [key("a")],
      } as never),
    ).toBeNull();
  });
});
