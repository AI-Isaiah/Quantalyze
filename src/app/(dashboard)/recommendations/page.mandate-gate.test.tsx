/** @vitest-environment jsdom */
/**
 * Phase 169.3 / SC8: /recommendations makes ONE statement about the mandate.
 *
 * WHY THIS MATTERS. Before this fix the page derived `mandateSet`, rendered
 * "Set your mandate to see recommendations" when it was false, and STILL
 * rendered the candidate list plus a hard-coded header saying the strategies
 * "fit your mandate". The match engine scores an allocator with no mandate on
 * its default preferences, so a batch exists for them and the page asserted a
 * mandate fit it had no mandate to fit. An allocator reading the page could not
 * tell which of the two contradicting statements was true.
 *
 * CHOSEN TREATMENT: WITHHOLD. With no mandate, the candidate list is not
 * rendered at all; only the set-mandate call to action is. That keeps the call
 * to action's own heading ("... to see recommendations") true, and it keeps the
 * card copy (engine reasons such as "Matches the X mandate", and the card's
 * fallback reason) from making a mandate claim on a no-mandate page.
 *
 * The first block pins that the page is self-consistent around its mandate
 * predicate. The MP block (plan 169.3-04, D-03) pins WHICH predicate: the page
 * answers "is a mandate set" with `deriveMandateIsSet`, the rule /allocations
 * uses, which reads `max_weight` and `preferred_strategy_types`, fields the
 * match engine consumes. It used to read `mandate_archetype`, a free-text field
 * the engine never reads, so one allocator could be told "set your mandate"
 * here while /allocations treated the mandate as set, and the reverse.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect() called");
  },
}));
vi.mock("@/lib/auth/requireRolePage", () => ({
  requireRolePage: async () => {},
}));
vi.mock("@/components/ui/Disclaimer", () => ({
  Disclaimer: () => React.createElement("div", { "data-testid": "disclaimer" }),
}));
vi.mock("@/components/legal/AccreditedInvestorGate", () => ({
  AccreditedInvestorGate: () =>
    React.createElement("div", { "data-testid": "gate" }),
}));

const seeded = vi.hoisted(() => ({
  prefs: null as unknown,
  prefsError: null as unknown,
  prefsSelect: [] as string[],
  recsError: null as unknown,
  batchMetaError: null as unknown,
  recs: [] as unknown[],
  batchMeta: [] as unknown[],
  statusRows: [] as unknown[],
  statusError: null as unknown,
  analyticsSelect: [] as string[],
  analyticsIn: [] as Array<{ column: string; ids: unknown }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "00000000-0000-4000-8000-0000000000aa" } },
        error: null,
      }),
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = (cols: string) => {
        if (table === "strategy_analytics") seeded.analyticsSelect.push(cols);
        if (table === "allocator_preferences") seeded.prefsSelect.push(cols);
        return chain;
      };
      chain.eq = () => chain;
      chain.in = (column: string, ids: unknown) => {
        if (table === "strategy_analytics") seeded.analyticsIn.push({ column, ids });
        return chain;
      };
      chain.maybeSingle = () =>
        Promise.resolve(
          table === "investor_attestations"
            ? { data: { attested_at: "2026-01-01T00:00:00Z" }, error: null }
            : seeded.prefsError
              ? // PostgREST on a failed read: no row, an error.
                { data: null, error: seeded.prefsError }
              : { data: projectPrefs(seeded.prefs), error: null },
        );
      // Like PostgREST, a column comes back only if the select projected it:
      // a row's `series_end` is dropped unless the alias was selected, so a
      // regression that stops projecting it fails AGE1, not only AGE4.
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) => {
        const projected = (seeded.analyticsSelect.at(-1) ?? "").includes("series_end:");
        const rows = (seeded.statusRows as Array<Record<string, unknown>>).map((r) => {
          if (projected) return r;
          const { series_end: _dropped, ...rest } = r;
          return rest;
        });
        return Promise.resolve(
          table === "strategy_analytics"
            ? { data: rows, error: seeded.statusError }
            : { data: [], error: null },
        ).then(onFulfilled);
      };
      return chain;
    },
    rpc: async (name: string) =>
      name === "get_allocator_recommendations"
        ? seeded.recsError
          ? { data: null, error: seeded.recsError }
          : { data: seeded.recs, error: null }
        : seeded.batchMetaError
          ? { data: null, error: seeded.batchMetaError }
          : { data: seeded.batchMeta, error: null },
  }),
}));

/**
 * Like PostgREST, the preferences row carries only the columns the page
 * selected. Without this, a page that called the right predicate but never
 * projected `max_weight` / `preferred_strategy_types` would still pass here
 * and read `undefined` for both in production.
 */
function projectPrefs(row: unknown): unknown {
  if (row === null || typeof row !== "object") return row;
  const cols = (seeded.prefsSelect.at(-1) ?? "").split(",").map((c) => c.trim());
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).filter(([k]) => cols.includes(k)),
  );
}

import RecommendationsPage from "./page";
import { deriveMandateIsSet } from "@/lib/queries";

// --- Fixtures (synthetic ids and names only) ------------------------------

const IDS = [
  "51a10002-0000-4000-8000-000000000001",
  "51a10002-0000-4000-8000-000000000002",
  "51a10002-0000-4000-8000-000000000003",
] as const;
const NAMES = ["Alpha Test", "Beta Test", "Gamma Test"] as const;

// A mandate the engine can act on (D-03): max_weight set. No archetype, so the
// fixture cannot pass on the old free-text predicate.
const MANDATE = {
  mandate_archetype: null,
  max_weight: 0.2,
  preferred_strategy_types: [],
  target_ticket_size_usd: 1,
};
const BATCH = {
  batch_id: "51a10002-0000-4000-8000-0000000000b0",
  computed_at: "2026-09-25T00:00:00.000Z",
  candidate_count: 3,
};

function rec(i: 0 | 1 | 2) {
  return {
    id: `cand-${IDS[i]}`,
    strategy_id: IDS[i],
    rank: i + 1,
    score: 0.9,
    reasons: ["Matches the trend mandate"],
    strategy_name: NAMES[i],
    strategy_description: null,
    discovery_category_slug: "crypto-sma",
    cagr: 0.1,
    sharpe: 1.1,
    max_drawdown: -0.2,
    analytics_computed_at: hoursAgo(1),
  };
}

/** Relative to the real clock: SyncBadge reads Date.now() with no injection. */
function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}
function dateDaysAgo(d: number): string {
  return new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
}

function cardFor(name: string): HTMLElement {
  const li = screen.getByText(name).closest("li");
  expect(li, `no card rendered for ${name}`).not.toBeNull();
  return li as HTMLElement;
}

async function renderPage() {
  const ui = await RecommendationsPage();
  return render(ui as React.ReactElement);
}

const CTA = "Set your mandate to see recommendations";
const MANDATE_FIT_HEADER = "Top 3 strategies that fit your mandate. Updated daily.";

beforeEach(() => {
  seeded.prefs = MANDATE;
  seeded.recs = [rec(0), rec(1), rec(2)];
  seeded.batchMeta = [BATCH];
  seeded.statusRows = IDS.map((id) => ({
    strategy_id: id,
    computation_status: "complete",
    computed_at: hoursAgo(1),
    series_end: dateDaysAgo(1),
  }));
  seeded.statusError = null;
  seeded.analyticsSelect = [];
  seeded.analyticsIn = [];
  seeded.prefsSelect = [];
  seeded.prefsError = null;
  seeded.recsError = null;
  seeded.batchMetaError = null;
});

describe("SC8 · /recommendations — one mandate branch drives the header and the list", () => {
  it("MG1: no mandate + a 3-candidate batch — never says 'fit your mandate' and withholds the list", async () => {
    seeded.prefs = null;
    const { container } = await renderPage();
    const text = container.textContent ?? "";

    expect(
      text,
      "the page claimed a mandate fit for an allocator with no mandate",
    ).not.toMatch(/fit your mandate/i);
    expect(screen.getByText(CTA)).toBeTruthy();
    // Withheld, not relabelled: no candidate card renders beside the CTA.
    for (const name of NAMES) {
      expect(screen.queryByText(name), `${name} rendered on a no-mandate page`).toBeNull();
    }
    expect(container.querySelector("ol")).toBeNull();
    // The card copy's mandate claims cannot leak through a withheld list.
    expect(text).not.toMatch(/Matches the .* mandate/i);
  });

  it("MG2: mandate set + a 3-candidate batch — the header states the mandate fit and no CTA renders", async () => {
    await renderPage();

    expect(screen.getByText(MANDATE_FIT_HEADER)).toBeTruthy();
    expect(screen.queryByText(CTA)).toBeNull();
    for (const name of NAMES) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it("MG3: mandate set + no batch — the first-batch state only", async () => {
    seeded.batchMeta = [];
    seeded.recs = [];
    const { container } = await renderPage();

    expect(screen.getByText("Your first batch is computing")).toBeTruthy();
    expect(screen.queryByText(CTA)).toBeNull();
    expect(screen.queryByText("No candidates match today")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
  });

  it("MG4: no mandate + no candidates — the CTA only, no empty-list copy that implies a mandate", async () => {
    seeded.prefs = null;
    seeded.batchMeta = [];
    seeded.recs = [];
    const { container } = await renderPage();

    expect(screen.getByText(CTA)).toBeTruthy();
    expect(screen.queryByText("Your first batch is computing")).toBeNull();
    expect(screen.queryByText("No candidates match today")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/fit your mandate/i);
  });
});

describe("SC8 / D-03 · /recommendations decides 'mandate set' with the /allocations rule", () => {
  const ARCHETYPE_ONLY = {
    mandate_archetype: "systematic trend, low turnover",
    max_weight: null,
    preferred_strategy_types: [],
    target_ticket_size_usd: 1,
  };
  const MAX_WEIGHT_ONLY = {
    mandate_archetype: null,
    max_weight: 0.2,
    preferred_strategy_types: [],
    target_ticket_size_usd: 1,
  };
  const TYPES_ONLY = {
    mandate_archetype: null,
    max_weight: null,
    preferred_strategy_types: ["trend"],
    target_ticket_size_usd: 1,
  };

  async function expectNotSet() {
    const { container } = await renderPage();
    expect(screen.getByText(CTA)).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(/fit your mandate/i);
    expect(container.querySelector("ol")).toBeNull();
  }
  async function expectSet() {
    await renderPage();
    expect(screen.getByText(MANDATE_FIT_HEADER)).toBeTruthy();
    expect(screen.queryByText(CTA)).toBeNull();
    for (const name of NAMES) expect(screen.getByText(name)).toBeTruthy();
  }

  it("MP1: only a free-text archetype (the engine never reads it) is NOT a mandate: the CTA renders", async () => {
    seeded.prefs = ARCHETYPE_ONLY;
    await expectNotSet();
  });

  it("MP2: max_weight set with no archetype IS a mandate: the fit header and the list render", async () => {
    seeded.prefs = MAX_WEIGHT_ONLY;
    await expectSet();
  });

  it("MP3: a non-empty preferred-types list with no archetype IS a mandate", async () => {
    seeded.prefs = TYPES_ONLY;
    await expectSet();
  });

  it("MP4: no preferences row is NOT a mandate", async () => {
    seeded.prefs = null;
    await expectNotSet();
  });

  it("MP5: for every case the page agrees with deriveMandateIsSet, the rule /allocations reads", async () => {
    for (const row of [null, ARCHETYPE_ONLY, MAX_WEIGHT_ONLY, TYPES_ONLY]) {
      seeded.prefs = row;
      seeded.prefsSelect = [];
      const { unmount } = await renderPage();
      const pageSaysSet = screen.queryByText(CTA) === null;
      expect(pageSaysSet, `page and /allocations disagree for ${JSON.stringify(row)}`).toBe(
        deriveMandateIsSet(row as Parameters<typeof deriveMandateIsSet>[0]),
      );
      unmount();
    }
  });
});

describe("CR-01 · a failed preferences read is UNKNOWN, never 'no mandate'", () => {
  // WHY: `data` is null both when no row exists and when the read fails. On
  // HEAD before this fix the page ignored `error`, so a transient PostgREST /
  // RLS / grant fault told an allocator WITH a mandate that none was set,
  // withheld their scored list and logged nothing.
  it("ER1: prefs read fails + a 3-candidate batch — the list renders, no CTA, no 'no mandate' claim, and the fault is logged", async () => {
    seeded.prefsError = { code: "42501", message: "permission denied" };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = await renderPage();
      const text = container.textContent ?? "";

      expect(screen.queryByText(CTA), "a failed read rendered the set-mandate CTA").toBeNull();
      expect(text).not.toMatch(/No mandate is set yet/);
      // Unknown is not "set" either: the page makes no mandate-fit claim.
      expect(screen.queryByText(MANDATE_FIT_HEADER)).toBeNull();
      expect(screen.getByText("We couldn't load your mandate")).toBeTruthy();
      for (const name of NAMES) {
        expect(screen.getByText(name), `${name} withheld on a failed read`).toBeTruthy();
      }
      expect(
        errSpy.mock.calls.some((c) => String(c[0]).includes("allocator_preferences read failed")),
        "the failed read left no breadcrumb",
      ).toBe(true);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("ER2: a missing row (no error) is still 'unset', not unknown", async () => {
    seeded.prefs = null;
    await renderPage();
    expect(screen.getByText(CTA)).toBeTruthy();
    expect(screen.queryByText("We couldn't load your mandate")).toBeNull();
  });
});

describe("SC8 · /recommendations — every recommended record states where its track record ends", () => {
  it("AGE1: a series that ended 200 days ago renders the track-record-ended state, not a fresh sync", async () => {
    seeded.statusRows = [
      {
        strategy_id: IDS[0],
        computation_status: "complete",
        computed_at: hoursAgo(1),
        series_end: dateDaysAgo(200),
      },
    ];
    await renderPage();
    const card = within(cardFor(NAMES[0]));

    expect(
      card.queryByText(/^Track record ends 200d ago$/),
      "a record that ended 200 days ago read as current",
    ).not.toBeNull();
    expect(card.queryByText(/^Synced /)).toBeNull();
  });

  it("AGE2: a series that ended yesterday renders the fresh sync state", async () => {
    await renderPage();
    const card = within(cardFor(NAMES[1]));

    expect(card.queryByText(/^Synced 1h ago$/)).not.toBeNull();
    expect(card.queryByText(/Track record ends/)).toBeNull();
  });

  it("AGE3: a failed status read renders no age claim at all (fail-closed)", async () => {
    seeded.statusError = { message: "boom" };
    seeded.statusRows = [];
    await renderPage();

    for (const name of NAMES) {
      const card = within(cardFor(name));
      expect(card.queryByText(/^Synced /)).toBeNull();
      expect(card.queryByText(/Track record ends/)).toBeNull();
    }
  });

  it("AGE4: the status read stays bounded to the RPC's own ids and projects one date, never the series", async () => {
    await renderPage();

    expect(seeded.analyticsIn).toEqual([{ column: "strategy_id", ids: [...IDS] }]);
    expect(seeded.analyticsSelect).toHaveLength(1);
    const cols = seeded.analyticsSelect[0];
    expect(cols).toContain("series_end:returns_series->-1->>date");
    // The whole returns_series blob is never projected; only the arrow alias.
    expect(cols.replace("returns_series->-1->>date", "")).not.toContain("returns_series");
  });
});
