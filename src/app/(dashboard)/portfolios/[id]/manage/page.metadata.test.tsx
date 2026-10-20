/**
 * Phase 170.1.1 D-06 — the /portfolios/[id]/manage tab title.
 *
 * The name is read through the request's RLS server client, name column only,
 * with the error checked. A miss or a read error falls back to a fixed
 * "Manage portfolio" (the error is also captured) and the title never carries
 * the portfolio id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const PORTFOLIO_ID = "33333333-3333-3333-3333-333333333333";

const state = vi.hoisted(() => ({
  row: null as { name: string | null } | null,
  error: null as { message: string } | null,
  selected: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = (cols: string) => {
        state.selected.push(cols);
        return builder;
      };
      builder.eq = () => builder;
      builder.maybeSingle = () =>
        Promise.resolve({ data: state.row, error: state.error });
      return builder;
    },
  })),
}));

vi.mock("@/lib/queries", () => ({
  getPortfolioDetail: vi.fn(),
  getPortfolioStrategies: vi.fn(),
  getAllocationEvents: vi.fn(),
}));

// A read error is reported, not only given a neutral title.
const captureToSentryMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureToSentryMock }));

import { generateMetadata } from "./page";

const params = Promise.resolve({ id: PORTFOLIO_ID });

beforeEach(() => {
  state.row = null;
  state.error = null;
  state.selected = [];
  captureToSentryMock.mockClear();
});

describe("/portfolios/[id]/manage generateMetadata", () => {
  it("names the portfolio", async () => {
    state.row = { name: "Core Book" };
    expect(await generateMetadata({ params })).toEqual({
      title: "Manage Core Book",
    });
  });

  it("selects the name column only", async () => {
    state.row = { name: "Core Book" };
    await generateMetadata({ params });
    expect(state.selected).toEqual(["name"]);
  });

  it("falls back to Manage portfolio when the row is missing", async () => {
    state.row = null;
    const meta = await generateMetadata({ params });
    expect(meta).toEqual({ title: "Manage portfolio" });
    expect(String(meta.title)).not.toContain("3333");
    expect(captureToSentryMock).not.toHaveBeenCalled();
  });

  it("falls back to Manage portfolio on a read error and captures it", async () => {
    state.row = { name: "Core Book" };
    state.error = { message: "boom" };
    const meta = await generateMetadata({ params });
    expect(meta).toEqual({ title: "Manage portfolio" });
    expect(String(meta.title)).not.toContain("3333");
    expect(captureToSentryMock).toHaveBeenCalledTimes(1);
    expect(captureToSentryMock.mock.calls[0][0]).toEqual(new Error("boom"));
  });
});
