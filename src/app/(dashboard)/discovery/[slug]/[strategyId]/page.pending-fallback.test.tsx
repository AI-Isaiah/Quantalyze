/**
 * Phase 167.2 review-fix round 1 (167.2-REVIEW WR-01): the discovery detail
 * page's fallback for a published strategy whose factsheet payload does not
 * build.
 *
 * WHY. The fallback used to promise that the full panel set "will render here"
 * once "the analytics service" finished "the first compute pass". That is a
 * promise the page cannot keep (a failed chain, or a series that cannot build,
 * never resolves on its own), and it names an internal pipeline to allocators,
 * which phase 164.2 criterion 9 forbids. KCS-10 removed the same sentence from
 * the v2 public lane; this page now says the SAME one sentence, imported from
 * the one place it is authored, so the two public surfaces cannot diverge again.
 *
 * The expected sentence is HAND-TYPED from 167.2-UI-SPEC.md § KCS-10 (KCS10-PUBLIC),
 * never imported: an import would make the oracle agree with whatever the
 * module says.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/queries", () => ({ getStrategyDetail: vi.fn() }));

import StrategyDetailPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStrategyDetail } from "@/lib/queries";
import { DISCOVERY_CATEGORIES } from "@/lib/constants";

const STRATEGY_ID = "44444444-4444-4444-8444-444444444444";
const SLUG = DISCOVERY_CATEGORIES[0]!.slug;

/** Hand-typed from 167.2-UI-SPEC.md § KCS-10. */
const KCS10_PUBLIC = "The detailed factsheet for this strategy is not available yet.";

/** Every string rendered anywhere in an RSC element tree, concatenated. */
function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const el = node as { props?: { children?: unknown } };
  return textOf(el.props?.children ?? null);
}

beforeEach(() => {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }) },
  } as never);
  vi.mocked(getStrategyDetail).mockResolvedValue({
    strategy: {
      id: STRATEGY_ID,
      name: "Synthetic Strategy",
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: ["trend"],
      markets: ["BTC"],
      description: null,
      subtypes: [],
      supported_exchanges: ["binance"],
      leverage_range: null,
      aum: null,
      max_capacity: null,
      avg_daily_turnover: null,
      start_date: null,
      benchmark: null,
      asset_class: "crypto",
      trust_tier: "api_verified",
      returns_denominator_config: null,
    },
    // No analytics row: the payload cannot build, so the fallback renders.
    analytics: null,
    disclosureTier: "exploratory",
  } as never);
});

describe("discovery page — the fallback when the factsheet payload does not build (WR-01)", () => {
  it("says the one KCS-10 sentence, and no timing, pipeline or computing claim", async () => {
    const jsx = await StrategyDetailPage({
      params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }),
    });
    const text = textOf(jsx);
    expect(text).toContain(KCS10_PUBLIC);
    expect(text).not.toMatch(/still computing/i);
    expect(text).not.toMatch(/analytics service/i);
    expect(text).not.toMatch(/compute pass/i);
    expect(text).not.toMatch(/will render here/i);
  });
});

/**
 * Phase 169 (D-41 / R3): the composite reader now THROWS
 * `CompositeSeriesReadError` on a failed `csv_daily_returns` read instead of
 * folding it into an empty series. This page is dynamic and not cached, so its
 * placeholder is the right answer for that one request: it catches that class,
 * logs it with its code, and renders the same KCS-10 sentence. Any other throw
 * from the reader is not an outage it can name and still propagates.
 */
describe("discovery page — a composite's csv_daily_returns read outage (169 D-41)", () => {
  const FULL_CASH = {
    cumulative_return: 0.05,
    volatility: 0.12,
    max_drawdown: -0.04,
    cagr: 0.31,
    sharpe: 1.4,
    sortino: 2.1,
    calmar: 3.0,
  };

  /** Re-seed the detail read as a published composite with a valid headline. */
  async function seedComposite() {
    const base = (await vi.mocked(getStrategyDetail).getMockImplementation()?.(STRATEGY_ID, SLUG, "discovery")) as {
      strategy: unknown;
      disclosureTier: unknown;
    };
    vi.mocked(getStrategyDetail).mockResolvedValue({
      strategy: base.strategy,
      analytics: {
        computed_at: "2026-09-01T00:00:00Z",
        computation_status: "complete",
        daily_returns: null,
        returns_series: null,
        data_quality_flags: { composite: true },
        metrics_json_by_basis: { cash_settlement: FULL_CASH },
      },
      disclosureTier: base.disclosureTier,
    } as never);
  }

  /** The service-role client: the csv read answers with a failed read. */
  function csvOutageAdmin() {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: null, error: { message: "synthetic statement timeout", code: "57014" } }),
    };
    return { from: () => chain };
  }

  it("renders the KCS-10 sentence and does not throw; the outage is logged with its code", async () => {
    await seedComposite();
    vi.mocked(createAdminClient).mockReturnValue(csvOutageAdmin() as never);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const jsx = await StrategyDetailPage({
        params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }),
      });
      expect(textOf(jsx)).toContain(KCS10_PUBLIC);
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining("csv_daily_returns"),
        expect.objectContaining({ errorCode: "57014" }),
      );
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("any other throw from the composite read still propagates", async () => {
    await seedComposite();
    vi.mocked(createAdminClient).mockReturnValue({
      from: () => {
        throw new Error("synthetic unexpected failure");
      },
    } as never);
    await expect(
      StrategyDetailPage({ params: Promise.resolve({ slug: SLUG, strategyId: STRATEGY_ID }) }),
    ).rejects.toThrow("synthetic unexpected failure");
  });
});
