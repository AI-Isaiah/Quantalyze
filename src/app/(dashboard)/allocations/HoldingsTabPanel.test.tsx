import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

/**
 * v0.15.7.0 / F4b — HoldingsTabPanel revoked-status join (regression coverage
 * for the deleted T12b that lived in AllocationDashboard.revoked-holdings.test.tsx).
 *
 * Contract under test: HoldingsTabPanel joins `props.apiKeys`
 * (api_key.id → sync_status) onto `props.holdingsSummary` (api_key_id) so each
 * spot position carries the correct `source_key_sync_status`. F4b moved spot
 * positions to the secondary "Exchange Positions" section, rendered via the
 * legacy `HoldingsTable` mode (the `holdings` prop), so the resolved status now
 * lives on `HoldingRow.source_key_sync_status` rather than the design-mode
 * `revokedStatusByHoldingId` map. The join must:
 *
 *   1. Resolve `revoked` for a holding whose api_key_id points to a
 *      revoked apiKey row.
 *   2. Resolve `complete` for a holding whose api_key_id points to a
 *      complete apiKey row.
 *   3. Default to `unknown` when api_key_id is null OR the FK doesn't
 *      resolve (defensive — RESTRICT FK should prevent the latter).
 *
 * The panel now renders `HoldingsTable` twice — once in strategy-row mode
 * (Section 1, `strategyRows`) and once in legacy mode (Section 2, `holdings`).
 * The stub serializes whichever prop is present so the test can pick the
 * legacy (`holdings`) render and assert the per-holding sync status.
 */

vi.mock("./components/HoldingsTable", () => ({
  HoldingsTable: (props: {
    strategyRows?: unknown[];
    holdings?: { id: string; source_key_sync_status: string }[];
  }) =>
    props.holdings ? (
      <div
        data-testid="holdings-table-legacy"
        data-holdings={JSON.stringify(props.holdings)}
      />
    ) : (
      <div data-testid="holdings-table-strategies" />
    ),
}));

// Phase 100 / 100-04 — the OptimizerPanel mounts the shared PortfolioOptimizer
// via next/dynamic (it calls useRouter). Stub it to a marker so the panel
// renders without the app-router context; the wave-2 wiring under test is the
// SECTION placement + honest-empty + the suggestedIds cross-link, none of which
// depend on the shared component's internals.
vi.mock("@/components/portfolio/PortfolioOptimizer", () => ({
  default: () => <div data-testid="portfolio-optimizer-mock" />,
}));

import { HoldingsTabPanel } from "./HoldingsTabPanel";
import { EMPTY_EXPOSURE } from "./lib/exposure-props";
import { buildHoldingRef } from "./lib/holding-outcome-adapter";

const REVOKED_HOLDING = {
  symbol: "BTC",
  quantity: 1.5,
  mark_price_usd: 60_000,
  value_usd: 90_000,
  venue: "binance",
  holding_type: "spot" as const,
  api_key_id: "key-revoked",
};

const ACTIVE_HOLDING = {
  symbol: "ETH",
  quantity: 10,
  mark_price_usd: 3000,
  value_usd: 30_000,
  venue: "coinbase",
  holding_type: "spot" as const,
  api_key_id: "key-complete",
};

const ORPHAN_HOLDING = {
  symbol: "SOL",
  quantity: 100,
  mark_price_usd: 100,
  value_usd: 10_000,
  venue: "kraken",
  holding_type: "spot" as const,
  api_key_id: null,
};

const STUB_PAYLOAD = {
  portfolio: null,
  analytics: null,
  apiKeys: [
    {
      id: "key-revoked",
      sync_status: "revoked",
      venue: "binance",
      key_label: "BNB key",
    },
    {
      id: "key-complete",
      sync_status: "complete",
      venue: "coinbase",
      key_label: "CB key",
    },
  ],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: [REVOKED_HOLDING, ACTIVE_HOLDING, ORPHAN_HOLDING],
  snapshotCount: 30,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  minHistoryDepthMonths: null,
  activeVenues: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  strategies: [],
  exposure: EMPTY_EXPOSURE,
};

function renderPanel() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { container } = render(<HoldingsTabPanel {...(STUB_PAYLOAD as any)} />);
  const stub = container.querySelector("[data-testid='holdings-table-legacy']");
  expect(stub).not.toBeNull();
  const raw = stub!.getAttribute("data-holdings");
  const rows = JSON.parse(raw ?? "[]") as {
    id: string;
    source_key_sync_status: string;
  }[];
  // Build ref → source_key_sync_status for the assertions.
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.source_key_sync_status;
  return map;
}

describe("HoldingsTabPanel — source_key_sync_status join (T12b regression)", () => {
  it("revoked apiKey → 'revoked' on the spot holding row", () => {
    const map = renderPanel();
    const ref = buildHoldingRef(REVOKED_HOLDING);
    expect(map[ref]).toBe("revoked");
  });

  it("complete apiKey → 'complete' on the spot holding row", () => {
    const map = renderPanel();
    const ref = buildHoldingRef(ACTIVE_HOLDING);
    expect(map[ref]).toBe("complete");
  });

  it("holding with null api_key_id → 'unknown' (defensive default)", () => {
    const map = renderPanel();
    const ref = buildHoldingRef(ORPHAN_HOLDING);
    expect(map[ref]).toBe("unknown");
  });
});

// ── Phase 100 / 100-04 (PI-04 + PI-05) — Watchlist & Optimizer + Notes
//    sections mount BELOW the Phase-99 exposure trio. ──────────────────────────
const P100_BASE = {
  portfolio: null,
  analytics: null,
  apiKeys: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: [],
  snapshotCount: 0,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  minHistoryDepthMonths: null,
  activeVenues: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
  strategies: [],
  mandate: null,
  exposure: EMPTY_EXPOSURE,
};

const EMPTY_OPTIMIZER = {
  portfolios: [],
  defaultPortfolioId: null,
  initialSuggestions: null,
  computedAt: null,
  computationStatus: null,
};

function makeFavorite(id: string, name: string) {
  return {
    strategy_id: id,
    name,
    slug: name.toLowerCase(),
    trust_tier: null,
    created_at: "2026-07-01T00:00:00.000Z",
  };
}

function makeSuggestion(id: string) {
  return {
    strategy_id: id,
    strategy_name: id,
    corr_with_portfolio: 0.1,
    sharpe_lift: 0.2,
    dd_improvement: 0.3,
    score: 0.9,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderP100(props: Record<string, unknown>) {
  return render(<HoldingsTabPanel {...(props as any)} />);
}

describe("HoldingsTabPanel — Watchlist/Optimizer + Notes (100-04 wiring)", () => {
  it("mounts Exposure → Watchlist & Optimizer → Notes → Exchange Positions in order", () => {
    const { container } = renderP100({
      ...P100_BASE,
      favorites: [],
      optimizer: EMPTY_OPTIMIZER,
      note: { initialContent: "", initialLastSavedAt: null },
    });
    const text = container.textContent ?? "";
    const iExposure = text.indexOf("Exposure");
    const iWatchOpt = text.indexOf("Watchlist & Optimizer");
    const iNotes = text.indexOf("Notes");
    const iExchange = text.indexOf("Exchange Positions");
    expect(iExposure).toBeGreaterThanOrEqual(0);
    expect(iWatchOpt).toBeGreaterThanOrEqual(0);
    expect(iNotes).toBeGreaterThanOrEqual(0);
    expect(iExchange).toBeGreaterThanOrEqual(0);
    expect(iExposure).toBeLessThan(iWatchOpt);
    expect(iWatchOpt).toBeLessThan(iNotes);
    expect(iNotes).toBeLessThan(iExchange);

    // Both new sections are real aria landmarks.
    expect(
      container.querySelector('section[aria-label="Watchlist & Optimizer"]'),
    ).not.toBeNull();
    expect(container.querySelector('section[aria-label="Notes"]')).not.toBeNull();
  });

  it("SC-4: the Phase-99 Exposure section is unchanged and still precedes the new sections", () => {
    const { container } = renderP100({
      ...P100_BASE,
      favorites: [],
      optimizer: EMPTY_OPTIMIZER,
      note: { initialContent: "", initialLastSavedAt: null },
    });
    const exposure = container.querySelector('section[aria-label="Exposure"]');
    expect(exposure).not.toBeNull();
    // Its heading idiom is untouched (h3 "Exposure").
    expect(exposure!.querySelector("h3")?.textContent).toBe("Exposure");
  });

  it("renders honest-empty states for all three sections with zero fabricated rows", () => {
    const { container, getByPlaceholderText } = renderP100({
      ...P100_BASE,
      favorites: [],
      optimizer: EMPTY_OPTIMIZER,
      note: { initialContent: "", initialLastSavedAt: null },
    });
    const text = container.textContent ?? "";
    // Watchlist honest-empty.
    expect(text).toContain("No favorites yet.");
    // Optimizer 0-portfolio honest gate.
    expect(text).toContain("Optimizer suggestions need a portfolio");
    // Notes: placeholder present, no rendered preview (empty content).
    expect(
      getByPlaceholderText(/Add a private note about your allocation book/i),
    ).toBeTruthy();
    // Zero favorites rows fabricated (the watchlist table only renders with rows).
    expect(
      container.querySelector('[data-testid="watchlist-name"]'),
    ).toBeNull();
    // No suggested chip when there is nothing to cross-link.
    expect(container.querySelector('[data-testid="suggested-chip"]')).toBeNull();
  });

  it("cross-links suggestedIds: a favorite present in optimizer.initialSuggestions gets a Suggested chip", () => {
    const { container } = renderP100({
      ...P100_BASE,
      favorites: [makeFavorite("s-alpha", "Alpha"), makeFavorite("s-beta", "Beta")],
      optimizer: {
        portfolios: [{ id: "p1", name: "Core", created_at: "2026-06-01T00:00:00.000Z" }],
        defaultPortfolioId: "p1",
        // Only Alpha is a live optimizer suggestion → only Alpha is "Suggested".
        initialSuggestions: [makeSuggestion("s-alpha")],
        computedAt: "2026-07-01T00:00:00.000Z",
        computationStatus: "complete" as const,
      },
      note: { initialContent: "", initialLastSavedAt: null },
    });
    const chips = container.querySelectorAll('[data-testid="suggested-chip"]');
    expect(chips.length).toBe(1);
  });

  it("empty optimizer.initialSuggestions → no Suggested chips (honest, [] cross-link)", () => {
    const { container } = renderP100({
      ...P100_BASE,
      favorites: [makeFavorite("s-alpha", "Alpha")],
      optimizer: EMPTY_OPTIMIZER,
      note: { initialContent: "", initialLastSavedAt: null },
    });
    expect(container.querySelector('[data-testid="suggested-chip"]')).toBeNull();
  });
});
