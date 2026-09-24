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
