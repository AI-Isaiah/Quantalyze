/**
 * Regression — 2026-05-21 dogfood report.
 *
 * Pre-fix: a user who left mid-wizard and came back to /strategies saw
 * "No strategies yet. Create your first strategy." — their draft was
 * invisible because the existing list query filters out
 * `source = 'wizard' AND status = 'draft'` (to avoid routing through
 * the legacy StrategyForm). The hide-by-default was intentional but
 * total — no signal, no resume path, draft eventually gets cleaned up
 * by the cron sweeper without the user realizing.
 *
 * Post-fix: a separate query fetches the most-recent wizard draft. When
 * one exists, a "Resume draft" banner renders above the list AND the
 * empty-state CTA switches from "Create your first strategy" to
 * "Resume your draft" pointing at /strategies/new/wizard.
 *
 * The filter that hides wizard drafts inline stays — preserving the
 * StrategyForm-routing safety invariant the original comment guards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

vi.mock("server-only", () => ({}));

// Stub next/link to a plain anchor (server-component compat under RTL).
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));

// PageHeader pulls in client-only UI deps that the server-component
// render doesn't need; stub to a marker so we can assert the page
// reached the render step.
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) =>
    React.createElement("h1", null, title),
}));

vi.mock("@/components/strategy/StrategyActions", () => ({
  StrategyActions: () => null,
}));
// Phase 164 (SHARE-04): the page now also imports the shared publication
// predicate from this module, so a factory that returns only the component
// leaves `isPublishedStatus` undefined and the row render throws. Re-export the
// REAL predicate rather than a stub — it is a pure two-token function, and
// stubbing it would let this file stay green while the page asked the wrong
// question about which URL a row should hand out.
vi.mock("@/components/strategy/ShareableLink", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/strategy/ShareableLink")
  >("@/components/strategy/ShareableLink");
  return { ...actual, ShareableLink: () => null };
});
vi.mock("@/components/strategy/PendingIntros", () => ({
  PendingIntros: () => null,
}));

// Phase 167.2.1 (D-08): the page now asks `probeFactsheetBuildable` about
// every row the analytics embed calls computed, on the service-role client.
// This double answers every strategies read with a computed row holding a
// 30-point series, so a computed row is BUILDABLE and shows no note, exactly as
// before the list probed; no assertion in this file depends on the probe.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      const self = () => b;
      b.select = self;
      b.eq = self;
      b.or = self;
      b.order = self;
      b.limit = self;
      b.maybeSingle = async () =>
        table === "strategies"
          ? {
              data: {
                id: "s-probe",
                name: "Synthetic probe row",
                status: "draft",
                asset_class: "crypto",
                returns_denominator_config: null,
                strategy_analytics: {
                  daily_returns: Array.from({ length: 30 }, (_, i) => ({
                    date: new Date(Date.UTC(2024, 0, 2) + i * 86_400_000)
                      .toISOString()
                      .slice(0, 10),
                    value: ((i % 7) - 3) / 1000,
                  })),
                  returns_series: null,
                  computed_at: "2024-03-01T00:00:00Z",
                  data_quality_flags: null,
                  metrics_json_by_basis: null,
                  computation_status: "complete",
                },
              },
              error: null,
            }
          : { data: null, error: null };
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      return b;
    },
  }),
}));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error(`__REDIRECT__:${path}`);
  },
}));

interface MockStrategyRow {
  id: string;
  name: string;
  status: string;
  source: string;
  strategy_types: string[];
  review_note: string | null;
  created_at: string;
  api_key_id: string | null;
  // 2026-10-09 Phase 170.7: the rest of the `Strategy` field set the shared
  // table reads (subtypes, markets, supported_exchanges, aum, start_date,
  // is_example, ...), so the page swap changes the page and not these inputs.
  user_id: string;
  category_id: string | null;
  description: string | null;
  subtypes: string[];
  markets: string[];
  supported_exchanges: string[];
  leverage_range: string | null;
  avg_daily_turnover: number | null;
  aum: number | null;
  max_capacity: number | null;
  start_date: string | null;
  is_example: boolean;
  benchmark: string;
}

interface MockDraftRow {
  id: string;
  name: string | null;
  created_at: string;
  // Set by the admin reject path; a rejected wizard draft is the SAME hidden row.
  review_note?: string | null;
}

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  publishedStrategies: [] as MockStrategyRow[],
  wizardDraft: null as MockDraftRow | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user },
        error: null,
      }),
    },
    // Phase 167.2 (KCS-06 / KCS-12): the page also reads the owner's key
    // statuses (api_keys, strategy_keys) and, per uncomputed row, the compute-job RPC. Both are allowed
    // DELIBERATELY, answering empty; any other table still throws.
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      if (
        table !== "strategies" &&
        table !== "contact_requests" &&
        table !== "api_keys" &&
        table !== "strategy_keys" &&
        // Phase 164.6.6.3.1 D-05/D-06 Wave 0: plan 05's page read; the default
        // empty answer below is what this file wants.
        table !== "strategy_shares"
      ) {
        throw new Error(`Unexpected table: ${table}`);
      }

      // Builder mimics Supabase's PostgrestFilterBuilder shape closely
      // enough for the call sites in /strategies/page.tsx. The
      // .order() / .limit() chain must remain *thenable* so the list
      // query can `await` it AND the draft query can chain
      // .limit(1).maybeSingle() off it. We discriminate which fixture
      // to resolve at the resolution point (whether maybeSingle is
      // called) — the list query resolves directly on the awaited
      // order() result.
      let isDraftQuery = false;
      const listResult =
        table === "strategies"
          ? { data: state.publishedStrategies, error: null }
          : { data: [], error: null };

      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          if (column === "source" && value === "wizard") {
            isDraftQuery = true;
          }
          return builder;
        },
        or: () => builder,
        in: () => builder,
        limit: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (isDraftQuery) {
            return { data: state.wizardDraft, error: null };
          }
          return { data: null, error: null };
        },
        // Thenable contract for the list query (`await ...order(...)`).
        then: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onF: (v: { data: unknown; error: unknown }) => any,
        ) => Promise.resolve(listResult).then(onF),
      };
      return builder;
    },
  }),
}));

async function renderPage(): Promise<HTMLElement> {
  const { default: StrategiesPage } = await import("./page");
  // server component returns a Promise<JSX>
  // 170.1 D-07: the page reads `searchParams` (a Promise in Next 16), so every
  // render passes the empty query a plain /strategies visit carries.
  const jsx = await (
    StrategiesPage as unknown as (props: {
      searchParams: Promise<Record<string, string | string[] | undefined>>;
    }) => Promise<React.ReactElement>
  )({ searchParams: Promise.resolve({}) });
  const { container } = render(jsx);
  return container;
}

describe("StrategiesPage — wizard-draft Resume banner (2026-05-21 regression)", () => {
  beforeEach(() => {
    // 2026-10-09 Phase 170.7: the shared table mounts client hooks that touch
    // `fetch` and `localStorage`; install the same doubles my-strategies/page.test.tsx does.
    installFetchMock();
    try {
      window.localStorage.clear();
    } catch {
      // jsdom may not implement clear in some configurations; non-fatal.
    }
    redirectMock.mockReset();
    // Phase 167.2.1 (D-08): UUID-shaped, because the page's probe runs under
    // `withPublishedOrOwner(q, user.id)`, which fails closed (and logs) on a
    // non-UUID id. Synthetic.
    state.user = { id: "00000000-0000-4000-8000-0000000000a1" };
    state.publishedStrategies = [];
    state.wizardDraft = null;
  });

  afterEach(() => {
    restoreFetchMock();
  });

  it("with NO published strategies AND NO wizard draft, shows 'Create your first strategy'", async () => {
    state.wizardDraft = null;
    const container = await renderPage();
    expect(container.textContent).toMatch(/no strategies yet/i);
    expect(container.textContent).toMatch(/create your first strategy/i);
    expect(container.textContent).not.toMatch(/unfinished/i);
    expect(container.textContent).not.toMatch(/resume/i);
  });

  it("with NO published strategies but a wizard draft, switches empty-state to 'Resume your draft'", async () => {
    state.wizardDraft = {
      id: "draft-1",
      name: "Alpha Centauri",
      created_at: "2026-05-21T12:00:00Z",
    };
    const container = await renderPage();
    // Empty-state CTA flipped to Resume
    expect(container.textContent).toMatch(/no published strategies yet/i);
    expect(container.textContent).toMatch(/draft in progress/i);
    expect(screen.getByText(/resume your draft/i)).toBeTruthy();
    // The original "Create your first strategy" copy must NOT appear
    // in this branch — that's the misleading message users hit pre-fix.
    expect(container.textContent).not.toMatch(/create your first strategy/i);
  });

  it("with a wizard draft AND published strategies, renders the banner above the list", async () => {
    state.publishedStrategies = [
      {
        id: "s-1",
        name: "Live Strategy",
        status: "published",
        source: "wizard",
        strategy_types: ["Momentum"],
        review_note: null,
        created_at: "2026-05-20T12:00:00Z",
        api_key_id: "k-1",
        user_id: "u-1",
        category_id: "cat-1",
        description: null,
        subtypes: ["Trend Following"],
        markets: ["Spot"],
        supported_exchanges: ["Binance"],
        leverage_range: null,
        avg_daily_turnover: null,
        aum: 1_000_000,
        max_capacity: 10_000_000,
        start_date: "2024-01-01",
        is_example: false,
        benchmark: "BTC",
      },
    ];
    state.wizardDraft = {
      id: "draft-1",
      name: "WIP Alpha",
      created_at: "2026-05-21T12:00:00Z",
    };
    const container = await renderPage();
    // Banner present
    const banner = container.querySelector(
      "[data-testid='wizard-draft-resume-banner']",
    );
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toMatch(/unfinished/i);
    expect(banner?.textContent).toContain("WIP Alpha");
    // Published strategy still rendered in the list
    expect(container.textContent).toContain("Live Strategy");
  });

  it("banner is absent when no wizard draft exists, even with published strategies", async () => {
    state.publishedStrategies = [
      {
        id: "s-1",
        name: "Live Strategy",
        status: "published",
        source: "wizard",
        strategy_types: ["Momentum"],
        review_note: null,
        created_at: "2026-05-20T12:00:00Z",
        api_key_id: "k-1",
        user_id: "u-1",
        category_id: "cat-1",
        description: null,
        subtypes: ["Trend Following"],
        markets: ["Spot"],
        supported_exchanges: ["Binance"],
        leverage_range: null,
        avg_daily_turnover: null,
        aum: 1_000_000,
        max_capacity: 10_000_000,
        start_date: "2024-01-01",
        is_example: false,
        benchmark: "BTC",
      },
    ];
    state.wizardDraft = null;
    const container = await renderPage();
    const banner = container.querySelector(
      "[data-testid='wizard-draft-resume-banner']",
    );
    expect(banner).toBeNull();
    expect(container.textContent).toContain("Live Strategy");
  });
});

// 2026-10-09 Phase 170.7 D-08: review feedback is recoverable -> amber (DESIGN.md
// colour gate). The banner's shell takes ONE `bg-warning/5` layer and the
// feedback line sits on it with no fill of its own: two layers measure 4.39:1,
// one measures 4.68:1 (UI-SPEC AD-06).
describe("StrategiesPage — a rejected wizard draft's banner is amber (170.7 D-08)", () => {
  beforeEach(() => {
    installFetchMock();
    try {
      window.localStorage.clear();
    } catch {
      // non-fatal
    }
    redirectMock.mockReset();
    state.user = { id: "00000000-0000-4000-8000-0000000000a1" };
    state.publishedStrategies = [];
    state.wizardDraft = null;
  });

  afterEach(() => {
    restoreFetchMock();
  });

  it("paints the rejected shell and its feedback line amber, the line with no fill of its own", async () => {
    state.wizardDraft = {
      id: "draft-1",
      name: "WIP Alpha",
      created_at: "2026-05-21T12:00:00Z",
      review_note: "Add a longer track record",
    };
    const container = await renderPage();

    const banner = container.querySelector(
      "[data-testid='wizard-draft-resume-banner']",
    ) as HTMLElement;
    expect(banner.getAttribute("data-rejected")).toBe("true");
    const shell = banner.className.split(/\s+/);
    expect(shell).toContain("border-warning/40");
    expect(shell).toContain("bg-warning/5");
    expect(shell).not.toContain("border-negative/40");
    expect(shell).not.toContain("bg-negative/5");

    const line = Array.from(banner.querySelectorAll("p")).find((p) =>
      (p.textContent ?? "").startsWith("Review feedback:"),
    );
    expect(line, "the feedback line").toBeDefined();
    expect(line!.textContent).toContain("Add a longer track record");
    const tokens = line!.className.split(/\s+/);
    expect(tokens).toContain("text-warning");
    expect(tokens).toContain("text-xs");
    expect(tokens).not.toContain("text-negative");
    // No fill of its own: a second bg-warning/5 layer on the shell is 4.39:1.
    expect(tokens.filter((t) => t.startsWith("bg-"))).toEqual([]);

    // Copy and the button are unchanged.
    expect(banner.textContent).toContain("Your strategy submission was sent back for changes.");
    expect(banner.textContent).toContain("Revise & resubmit");
  });

  it("keeps the unfinished-draft banner accent, not amber", async () => {
    state.wizardDraft = {
      id: "draft-2",
      name: "WIP Beta",
      created_at: "2026-05-21T12:00:00Z",
    };
    const container = await renderPage();
    const banner = container.querySelector(
      "[data-testid='wizard-draft-resume-banner']",
    ) as HTMLElement;
    expect(banner.getAttribute("data-rejected")).toBe("false");
    const shell = banner.className.split(/\s+/);
    expect(shell).toContain("border-accent/40");
    expect(shell).toContain("bg-accent/5");
    expect(shell).not.toContain("bg-warning/5");
  });
});
