import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import BridgeHeroWidget from "./BridgeHeroWidget";
import { TweaksProvider } from "../../context/TweaksContext";
import type { FlaggedHolding } from "../../lib/holding-outcome-adapter";

/**
 * Phase 11 / UI-BLOCK-01 — Regression test asserting that BridgeHeroWidget
 * routes its error branch through the shared <WidgetState mode="error">
 * primitive when the `widget_state_v2` feature flag is ON.
 *
 * This test fails before the wiring lands (the legacy branch renders a plain
 * <div> with no role="alert"), and passes after the wiring forwards the
 * error message through WidgetState. The flag is forced ON via the
 * `?widget_state=v2` URL override so we don't need to mutate localStorage
 * (matches the precedent in src/lib/widget-state-flag.test.ts).
 */

// next/navigation is consumed by BridgeDrawer (transitively via BridgeWidget)
// — stub so the widget can mount under jsdom without a Next router context.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const originalLocation = window.location;

beforeEach(() => {
  // Reset window.location.search between tests so the URL override doesn't
  // leak across cases. We restore the original Location object in the
  // top-level afterAll-equivalent (assigning back at end of suite).
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, search: "" },
  });
});

describe("BridgeHeroWidget — UI-BLOCK-01 WidgetState v2 wiring", () => {
  it("flag OFF (default): error branch renders the legacy plain <div> chrome (no role='alert')", () => {
    const { container } = render(
      <BridgeHeroWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ __error: true } as any}
        timeframe="1YTD"
        width={4}
        height={3}
      />,
    );
    expect(screen.getByText("Bridge unavailable")).toBeInTheDocument();
    // Legacy chrome carries NO role="alert" — that's the BLOCK we resolve.
    expect(container.querySelector("[role='alert']")).toBeNull();
  });

  it("flag ON via ?widget_state=v2: error branch routes through <WidgetState mode='error'> (role='alert' + aria-live='polite')", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...originalLocation, search: "?widget_state=v2" },
    });
    const { container } = render(
      <BridgeHeroWidget
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={{ __error: true } as any}
        timeframe="1YTD"
        width={4}
        height={3}
      />,
    );
    expect(screen.getByText("Bridge unavailable")).toBeInTheDocument();
    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.getAttribute("aria-live")).toBe("polite");
  });
});

/**
 * H-1207 — BridgeHeroWidget happy-path adapter coverage.
 *
 * The existing suite above only exercises the error branch. These tests
 * assert the production data path the registry actually mounts: that the
 * adapter (a) forwards the `bridgeVariant` knob from TweaksContext into
 * BridgeWidget's chrome, (b) forwards `payload.outcomes` so the empty-state
 * "Last reviewed N days ago" line renders, and (c) forwards
 * `payload.flaggedHoldings` so the active-breach chrome appears. A
 * regression that drops any of these forwardings would silently revert the
 * PR2/PR3 polish — these assertions break loudly when that happens.
 */
describe("BridgeHeroWidget — H-1207 happy-path adapter forwarding", () => {
  // The runtime's `window.localStorage` (Node experimental shim under jsdom)
  // exposes only getItem/setItem here, so stub a complete Map-backed store —
  // same idiom as Tweaks.test.tsx — to drive TweaksProvider hydration.
  const lsStore = new Map<string, string>();
  const localStorageMock = {
    getItem: (k: string) => lsStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      lsStore.set(k, v);
    },
    removeItem: (k: string) => {
      lsStore.delete(k);
    },
    clear: () => {
      lsStore.clear();
    },
    key: () => null,
    length: 0,
  };
  const realLocalStorage = window.localStorage;

  afterAll(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: realLocalStorage,
    });
  });

  // The TweaksProvider hydrates bridgeVariant from localStorage in a
  // post-mount effect, so seed the persisted blob before rendering and use
  // async findBy* queries which retry until the hydration effect lands.
  function seedTweaks(partial: Record<string, unknown>): void {
    window.localStorage.setItem(
      "allocations.tweaks",
      JSON.stringify({
        density: "comfortable",
        accentIntensity: "muted",
        displayFont: "serif",
        bridgeVariant: "full",
        chartStyle: "area",
        showBench: true,
        showOutcomes: true,
        ...partial,
      }),
    );
  }

  function makeFlaggedHolding(symbol: string): FlaggedHolding {
    return {
      venue: "okx",
      symbol,
      holding_type: "spot",
      value_usd: 10_000,
      top_candidate_strategy_id: `strat-${symbol}`,
      top_candidate_name: `Strategy ${symbol}`,
      top_candidate_composite: 72,
      breach_reasons: ["max_weight"],
    };
  }

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: localStorageMock,
    });
    lsStore.clear();
  });

  it("(a) forwards bridgeVariant='card' from TweaksContext into BridgeWidget chrome (card, not hero)", async () => {
    seedTweaks({ bridgeVariant: "card" });
    render(
      <TweaksProvider>
        <BridgeHeroWidget
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={{ flaggedHoldings: [makeFlaggedHolding("SOL")] } as any}
          timeframe="1YTD"
          width={4}
          height={3}
        />
      </TweaksProvider>,
    );
    // Card variant chrome: "N holding(s) flagged" + "Review candidates →".
    // The hero ("full") variant would instead read "N holdings need review"
    // with an inline holdings list, so this distinguishes the two.
    expect(await screen.findByText(/1 holding flagged/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /review candidates/i }),
    ).toBeInTheDocument();
    // Hero-only "need review" copy must NOT be present in card mode.
    expect(screen.queryByText(/needs? review/i)).toBeNull();
  });

  it("(b) forwards payload.outcomes so the empty state shows 'Last reviewed 3 days ago'", async () => {
    seedTweaks({});
    const threeDaysAgo = new Date(
      Date.now() - 3 * 86_400_000,
    ).toISOString();
    render(
      <TweaksProvider>
        <BridgeHeroWidget
          data={
            {
              flaggedHoldings: [],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              outcomes: [{ created_at: threeDaysAgo } as any],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
          timeframe="1YTD"
          width={4}
          height={3}
        />
      </TweaksProvider>,
    );
    const emptyState = await screen.findByTestId("bridge-empty-state");
    expect(
      within(emptyState).getByTestId("bridge-empty-last-reviewed"),
    ).toHaveTextContent("3 days ago");
    expect(
      within(emptyState).getByTestId("bridge-empty-review-count"),
    ).toHaveTextContent("1 review on file");
  });

  it("(c) forwards payload.flaggedHoldings so the active-breach 'Bridge flagged' chrome appears", async () => {
    seedTweaks({}); // default "full" (hero) variant
    render(
      <TweaksProvider>
        <BridgeHeroWidget
          data={
            {
              flaggedHoldings: [
                makeFlaggedHolding("SOL"),
                makeFlaggedHolding("ETH"),
              ],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          }
          timeframe="1YTD"
          width={4}
          height={3}
        />
      </TweaksProvider>,
    );
    // Hero variant active-breach chrome: "Bridge flagged" eyebrow +
    // "2 holdings need review" headline. The empty state would instead
    // render "All clear", so this proves the flaggedHoldings reached the
    // active path.
    expect(await screen.findByText("Bridge flagged")).toBeInTheDocument();
    expect(
      screen.getByText(/2 holdings need review/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("All clear")).toBeNull();
  });
});
