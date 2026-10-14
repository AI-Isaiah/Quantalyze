/**
 * Phase 170.6.1.1 (ANONKEYID, plan 02, D-02 census G, O-1) - the /browse detail
 * header's Verified badge follows the PUBLIC trust signal.
 *
 * `getPublicStrategyDetail` stops returning `strategies.api_key_id` once anon
 * can no longer read it, so a header guarded on `strategy.api_key_id` would
 * read `undefined` and drop the badge from every public strategy. The trust
 * tier (`get_published_trust_signals`, published-gated) is the signal a visitor
 * is entitled to, and `VerifiedBadge` itself renders only for `api_verified`.
 *
 * The page is an async server component; it is invoked as a function and the
 * element tree it returns is rendered, with `@/lib/queries` mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Strategy } from "@/lib/types";

const getPublicStrategyDetail = vi.fn();
vi.mock("@/lib/queries", () => ({
  getPublicStrategyDetail: (id: string) => getPublicStrategyDetail(id),
}));

import PublicStrategyDetailPage from "./page";

const STRATEGY_ID = "33333333-0000-4000-8000-000000000001";

const ANALYTICS = {
  cagr: 0.18,
  sharpe: 1.5,
  max_drawdown: -0.12,
  volatility: 0.22,
  sortino: 1.9,
  calmar: 1.1,
  six_month_return: 0.21,
  cumulative_return: 0.42,
  sparkline_returns: null,
};

/**
 * A public strategy row as `getPublicStrategyDetail` returns it once the
 * projection excludes `api_key_id`: the key is ABSENT, not null.
 */
function publicStrategy(trustTier: Strategy["trust_tier"]): Strategy {
  return {
    id: STRATEGY_ID,
    name: "Alpha Detail",
    codename: null,
    description: null,
    strategy_types: ["Long-Only"],
    status: "published",
    trust_tier: trustTier,
  } as unknown as Strategy;
}

async function renderPage(strategy: Strategy) {
  getPublicStrategyDetail.mockResolvedValue({
    strategy,
    analytics: ANALYTICS,
    manager: null,
    disclosureTier: "institutional",
  });
  const element = await PublicStrategyDetailPage({
    params: Promise.resolve({ slug: "crypto-sma", strategyId: STRATEGY_ID }),
  });
  return render(element);
}

describe("/browse/[slug]/[strategyId] - Verified badge follows trust_tier (170.6.1.1 census G)", () => {
  beforeEach(() => {
    getPublicStrategyDetail.mockReset();
  });

  it("renders the Verified badge for trust_tier api_verified with api_key_id absent", async () => {
    const strategy = publicStrategy("api_verified");
    expect("api_key_id" in strategy).toBe(false);
    await renderPage(strategy);
    expect(screen.getByRole("heading", { level: 1 }).parentElement?.textContent).toContain(
      "Verified",
    );
  });

  it("renders no Verified badge for a csv_uploaded strategy (the tier decides, not the key)", async () => {
    await renderPage(publicStrategy("csv_uploaded"));
    expect(screen.getByRole("heading", { level: 1 }).parentElement?.textContent).not.toContain(
      "Verified",
    );
  });

  it("renders no Verified badge when no trust tier resolved", async () => {
    await renderPage(publicStrategy(null));
    expect(screen.getByRole("heading", { level: 1 }).parentElement?.textContent).not.toContain(
      "Verified",
    );
  });
});
