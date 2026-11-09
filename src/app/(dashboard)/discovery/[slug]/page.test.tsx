/**
 * Phase 197 / CLAR-02 (D-03) - the discovery category page hands `StrategyTable` the SERVER's clock.
 *
 * WHY. The stale-data verdict changes row ORDER and row TEXT, and it is judged against an instant.
 * If the server render and the hydration each took their own clock, a row at its threshold could be
 * ordered one way on the server and another in the browser (RESEARCH Pitfall 6, T-197-09). The page
 * therefore passes `nowMs`, serialised once, and the table seeds its once-per-mount instant from it.
 *
 * This file is the page-prop harness: it renders the real RSC with every read mocked and a recording
 * stub in place of the table, so it asserts what the PAGE passes, not what the table does with it.
 * Plans 05 and 06 of Phase 197 extend it.
 *
 * CLAR-05 (D-01, plan 06): the admin-only shared-account partner map. The reader refuses a non-admin
 * itself and returns null on any failure, so the page's whole duty is to spread the prop ONLY for a
 * non-null result. The tests below assert the KEY is absent (not merely undefined) for the null
 * cases, because every prop on a client component rides in the RSC payload: an undefined-valued key
 * is dropped by serialisation, but absence here is what makes the guarantee independent of that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) =>
    React.createElement("h1", { "data-testid": "page-header" }, title),
}));
vi.mock("@/components/layout/Breadcrumb", () => ({
  Breadcrumb: () => React.createElement("nav", { "data-testid": "breadcrumb" }),
}));

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
  }),
}));

const STRATEGIES = [{ id: "s-1", name: "Meridian" }];
const PORTFOLIO = { id: "pf-1" };
const PERCENTILES = { "s-1": { sharpe: 80 } };
vi.mock("@/lib/queries", () => ({
  getStrategiesByCategory: vi.fn(async () => STRATEGIES),
  getRealPortfolio: vi.fn(async () => PORTFOLIO),
  getMyWatchlist: vi.fn(async () => new Set<string>(["s-1"])),
  getPercentiles: vi.fn(async () => PERCENTILES),
}));

// CLAR-05: the reader is mocked at its module; its own refusal and failure paths are pinned in
// `shared-account-partners.test.ts`. Default null = a non-admin viewer.
const getSharedAccountPartners = vi.fn(
  async (..._args: unknown[]): Promise<Record<string, string[]> | null> => null,
);
vi.mock("@/lib/discovery/shared-account-partners", () => ({
  getSharedAccountPartners: (...args: unknown[]) => getSharedAccountPartners(...args),
}));

// A recording stub: the page's prop list is the thing under test.
let tableProps: Record<string, unknown> | null = null;
vi.mock("@/components/strategy/StrategyTable", () => ({
  StrategyTable: (props: Record<string, unknown>) => {
    tableProps = props;
    return React.createElement("div", { "data-testid": "strategy-table" });
  },
}));

import DiscoveryPage from "./page";

const FROZEN_NOW = Date.parse("2026-11-08T12:00:00.000Z");

/** Walk the returned element tree and render the StrategyTable stub so it records its props. */
async function renderPage(slug = "crypto-sma") {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const element = await DiscoveryPage({ params: Promise.resolve({ slug }) });
  renderToStaticMarkup(element);
}

beforeEach(() => {
  tableProps = null;
  getSharedAccountPartners.mockReset();
  getSharedAccountPartners.mockResolvedValue(null);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(FROZEN_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/discovery/[slug] hands the table a server instant (CLAR-02)", () => {
  it("passes a numeric nowMs that is the server clock, not a client value", async () => {
    await renderPage();
    expect(tableProps).not.toBeNull();
    expect(typeof tableProps!.nowMs).toBe("number");
    expect(tableProps!.nowMs).toBe(FROZEN_NOW);
  });

  it("keeps every prop it passed before: strategies, categorySlug, portfolioId, userId, initialWatchedSet, percentiles", async () => {
    await renderPage("crypto-sma");
    expect(tableProps!.strategies).toBe(STRATEGIES);
    expect(tableProps!.categorySlug).toBe("crypto-sma");
    expect(tableProps!.portfolioId).toBe(PORTFOLIO.id);
    expect(tableProps!.userId).toBe(USER_ID);
    expect([...(tableProps!.initialWatchedSet as Set<string>)]).toEqual(["s-1"]);
    expect(tableProps!.percentiles).toBe(PERCENTILES);
  });

  it("opts the table into Compare selection (ROUTE-05, D-04)", async () => {
    await renderPage();
    expect(tableProps!.selectable).toBe(true);
  });

  it("passes no visibility prop, so the table runs on the published-only default where the verdict applies", async () => {
    await renderPage();
    expect("visibility" in tableProps!).toBe(false);
  });
});

describe("/discovery/[slug] passes the admin-only partner map only for an admin (CLAR-05, D-01)", () => {
  it("passes the reader's map through, and calls the reader with the page's client, the user and the listed ids", async () => {
    const map = { "s-1": ["Beta"] };
    getSharedAccountPartners.mockResolvedValue(map);
    await renderPage();
    expect(tableProps!.sharedAccountPartners).toBe(map);
    expect(getSharedAccountPartners).toHaveBeenCalledTimes(1);
    const [client, user, ids] = getSharedAccountPartners.mock.calls[0];
    expect(typeof (client as { auth: unknown }).auth).toBe("object");
    expect(user).toEqual({ id: USER_ID });
    expect(ids).toEqual(["s-1"]);
  });

  it("passes an admin with no sharing the empty map it received (it carries nothing, and only an admin gets it)", async () => {
    getSharedAccountPartners.mockResolvedValue({});
    await renderPage();
    expect(tableProps!.sharedAccountPartners).toEqual({});
  });

  it("D-01 fail closed, non-admin viewer: the reader refuses with null and the props carry no sharedAccountPartners key", async () => {
    getSharedAccountPartners.mockResolvedValue(null);
    await renderPage();
    expect(tableProps).not.toBeNull();
    expect("sharedAccountPartners" in tableProps!).toBe(false);
  });

  it("D-01 fail closed, read failure: the reader reports null, the table still renders and the key is absent", async () => {
    // The reader catches its own failures and returns null (it never throws); this is that outcome.
    getSharedAccountPartners.mockResolvedValue(null);
    await renderPage();
    expect(tableProps!.strategies).toBe(STRATEGIES);
    expect("sharedAccountPartners" in tableProps!).toBe(false);
  });
});
