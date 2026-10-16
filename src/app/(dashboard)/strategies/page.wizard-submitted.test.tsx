/**
 * Phase 170.1 D-07 / UI-SPEC V-1 — the wizard's submit lands on
 * `/strategies?wizard_submitted=1`, and the page says so.
 *
 * WHY THIS FILE EXISTS, stated as the defect it pins closed: the wizard pushed
 * `?wizard_submitted=1` and nothing read it, so a successful submit landed on
 * a page that gave no sign anything had been submitted (SC-4). The page now
 * reads the param from `searchParams` (a Promise in Next 16) and shows one
 * fixed sentence.
 *
 * The expected sentences are typed here by hand, never imported, so a change to
 * the page's copy goes red. The trust boundary is the query string: only the
 * exact string "1" shows the line, and the value is never echoed.
 *
 * All ids and names are synthetic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement("a", { href }, children),
}));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) =>
    React.createElement("h1", { "data-testid": "page-header" }, title),
}));
vi.mock("@/components/strategy/StrategyActions", () => ({
  StrategyActions: () => null,
}));
vi.mock("@/components/strategy/ShareableLink", () => ({
  ShareableLink: () => null,
}));
vi.mock("@/components/strategy/PendingIntros", () => ({
  PendingIntros: () => React.createElement("div", { "data-testid": "pending-intros" }),
}));

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    redirectMock(path);
    throw new Error(`__REDIRECT__:${path}`);
  },
}));

type ReadResult = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  strategies: [] as unknown[] | null,
  strategiesError: null as { message: string } | null,
  contactRequests: [] as unknown[],
  wizardDraft: null as { id: string; name: string; created_at: string; review_note: string | null } | null,
}));

// Table-dispatch double. Every table the page reads for these cases is named;
// anything else throws, so a new read cannot slip in unseen.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-0000000000a1" } }, error: null }),
    },
    from: (table: string) => {
      let result: ReadResult;
      if (table === "strategies") {
        result = state.strategiesError
          ? { data: null, error: state.strategiesError }
          : { data: state.strategies, error: null };
      } else if (table === "contact_requests") {
        result = { data: state.contactRequests, error: null };
      } else if (table === "strategy_keys" || table === "api_keys" || table === "strategy_shares") {
        result = { data: [], error: null };
      } else {
        throw new Error(`Unexpected table: ${table}`);
      }
      const chain = () => builder;
      const builder = {
        select: chain,
        eq: chain,
        or: chain,
        in: chain,
        limit: chain,
        order: chain,
        maybeSingle: async () => ({ data: state.wizardDraft, error: null }),
        then: (
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onF: (v: ReadResult) => any,
        ) => Promise.resolve(result).then(onF),
      };
      return builder;
    },
  }),
}));

const STATUS_LINE = "Strategy submitted. It is listed below as pending review.";
// When the list read failed there is no list, so the sentence is cut short
// (170.1-REVIEW SFH-3): "listed below" would be false.
const STATUS_LINE_LIST_UNREADABLE = "Strategy submitted.";
const LIST_UNREADABLE = "We could not load your strategies. Reload this page to try again.";

type Query = Record<string, string | string[] | undefined>;

async function renderPage(query: Query): Promise<HTMLElement> {
  const { default: StrategiesPage } = await import("./page");
  const jsx = await (
    StrategiesPage as unknown as (props: {
      searchParams: Promise<Query>;
    }) => Promise<React.ReactElement>
  )({ searchParams: Promise.resolve(query) });
  const { container } = render(jsx);
  return container;
}

const statusOf = (c: HTMLElement) => c.querySelector('[data-testid="wizard-submitted-status"]');

/** A published row with no analytics: it reads no jobs and needs no probe. */
function publishedRow(id: string) {
  return {
    id,
    name: `Strategy ${id}`,
    status: "published",
    source: "legacy",
    strategy_types: ["options"],
    review_note: null,
    created_at: "2026-01-01T00:00:00.000Z",
    api_key_id: null,
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
    strategy_analytics: null,
  };
}

beforeEach(() => {
  installFetchMock();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
  redirectMock.mockReset();
  state.strategies = [];
  state.strategiesError = null;
  state.contactRequests = [];
  state.wizardDraft = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  restoreFetchMock();
  vi.restoreAllMocks();
});

describe("StrategiesPage — the wizard-submitted status line (170.1 D-07, UI-SPEC V-1)", () => {
  it("wizard_submitted=1 shows the locked sentence in a role=status panel", async () => {
    const container = await renderPage({ wizard_submitted: "1" });

    const line = statusOf(container);
    expect(line).not.toBeNull();
    expect(line!.getAttribute("role")).toBe("status");
    expect(line!.textContent).toBe(STATUS_LINE);
    // The V-1 panel: square, bordered, no truncation, so it wraps at 390 px.
    const cls = line!.getAttribute("class") ?? "";
    expect(cls).toContain("border border-border bg-surface");
    expect(cls).not.toMatch(/truncate|whitespace-nowrap|rounded|shadow/);
  });

  it("a plain visit (no param) renders no status line", async () => {
    const container = await renderPage({});

    expect(statusOf(container)).toBeNull();
    expect(container.textContent).not.toContain(STATUS_LINE);
  });

  it("only the exact string \"1\" shows it: \"0\", \"true\", \"\" and a repeated param do not", async () => {
    for (const value of ["0", "true", "", ["1", "1"], ["1"]] as Array<string | string[]>) {
      const container = await renderPage({ wizard_submitted: value });
      expect(statusOf(container), `wizard_submitted=${JSON.stringify(value)}`).toBeNull();
    }
  });

  it("never echoes the param: other params and values add nothing to the page", async () => {
    const container = await renderPage({ wizard_submitted: "1", note: "<b>forged</b>" });

    expect(statusOf(container)!.textContent).toBe(STATUS_LINE);
    expect(container.textContent).not.toContain("forged");
  });

  it("sits under the page header and above the pending intros and the list", async () => {
    state.strategies = [publishedRow("s-1")];
    state.contactRequests = [{ id: "r-1" }];

    const container = await renderPage({ wizard_submitted: "1" });

    const header = container.querySelector('[data-testid="page-header"]')!;
    const line = statusOf(container)!;
    const intros = container.querySelector('[data-testid="pending-intros"]')!;
    const list = container.querySelector('[data-testid="strategy-row"], table')!;
    expect(intros).not.toBeNull();
    expect(list).not.toBeNull();
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(header.compareDocumentPosition(line) & FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(intros) & FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(list) & FOLLOWING).toBeTruthy();
  });

  it("still renders when the list read fails, drops \"listed below\" (no list exists), and the load-failure sentence follows it", async () => {
    state.strategiesError = { message: "synthetic list failure" };

    const container = await renderPage({ wizard_submitted: "1" });

    const line = statusOf(container)!;
    expect(line.textContent).toBe(STATUS_LINE_LIST_UNREADABLE);
    expect(line.textContent).not.toContain("listed below");
    expect(container.textContent).not.toContain("listed below");
    const unreadable = container.querySelector('[data-testid="strategies-list-unreadable"]')!;
    expect(unreadable.textContent).toBe(LIST_UNREADABLE);
    expect(line.compareDocumentPosition(unreadable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("an empty list with the param still shows the line, and no param shows neither line", async () => {
    const submitted = await renderPage({ wizard_submitted: "1" });
    expect(statusOf(submitted)!.textContent).toBe(STATUS_LINE);
    expect(submitted.textContent).toContain("No strategies yet.");

    const plain = await renderPage({});
    expect(statusOf(plain)).toBeNull();
    expect(plain.textContent).toContain("No strategies yet.");
  });

  it("leaves the PageHeader title alone (the heading belongs to Phase 170.1.1 TITLES)", async () => {
    const container = await renderPage({ wizard_submitted: "1" });

    expect(container.querySelector('[data-testid="page-header"]')!.textContent).toBe("My Strategies");
  });
});
