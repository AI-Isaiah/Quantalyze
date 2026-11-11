/**
 * Phase 198 plan 05 — the allocator's "+ Allocation" flow (D-03, ROUTE-06).
 *
 * WHAT THESE CASES PROTECT.
 *  - Step 1 (the picker) lists what `/api/strategies/browse` returns and nothing
 *    joined onto it: no trust tier, no manager (C2). A held strategy must never be
 *    selectable, because the commit route has no per-strategy uniqueness and a
 *    second add of a held strategy is a duplicate money record.
 *  - A `?add=` value is attacker-controllable. It pre-fills only after `isUuid`
 *    and resolution against the server's list, and absence from a TRUNCATED list
 *    is reported as "not in the list we loaded", never as "unavailable".
 *  - Nothing is written before the primary is pressed (step 2's half, below).
 *
 * Copy is typed in as literals: the DOM is the one side of the comparison and the
 * UI-SPEC wording the other, so a drift in a constant cannot pass against itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { AddAllocationFlow, type AddAllocationFlowProps } from "./AddAllocationFlow";
import type { StrategyBrowseRow } from "./StrategyBrowseDrawer";
import { WIZARD_ERROR_COPY } from "@/lib/wizardErrors";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const ID_D = "44444444-4444-4444-8444-444444444444";

function row(over: Partial<StrategyBrowseRow> & { id: string; name: string }): StrategyBrowseRow {
  return {
    codename: null,
    markets: [],
    strategy_types: [],
    is_example: false,
    isOwn: false,
    ...over,
  };
}

const ROWS: StrategyBrowseRow[] = [
  row({
    id: ID_A,
    name: "Alpha One",
    codename: "ALPH",
    markets: ["Crypto"],
    strategy_types: ["Trend"],
  }),
  row({ id: ID_B, name: "Beta Two", isOwn: true, is_example: true }),
  row({ id: ID_C, name: "Gamma Three", codename: "GAMM" }),
];

type Listed = { strategies: StrategyBrowseRow[]; hasMore: boolean };

function listOf(strategies: StrategyBrowseRow[], hasMore = false) {
  return vi.fn(async (): Promise<Listed> => ({ strategies, hasMore }));
}

function setup(over: Partial<AddAllocationFlowProps> = {}) {
  const props: AddAllocationFlowProps = {
    open: true,
    onClose: vi.fn(),
    onRecorded: vi.fn(),
    deepLink: null,
    onInvalidDeepLink: vi.fn(),
    heldStrategyIds: new Set<string>(),
    bookEquityUsd: 100000,
    allKeysStale: false,
    fetchStrategies: listOf(ROWS),
    ...over,
  };
  const utils = render(<AddAllocationFlow {...props} />);
  return { props, ...utils };
}

async function ready() {
  await screen.findByRole("list", { name: "Strategies" });
}

beforeEach(() => {
  mockRefresh.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AddAllocationFlow shell", () => {
  it("renders nothing when closed", () => {
    const { baseElement } = setup({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(baseElement.querySelector("[data-testid='add-allocation-backdrop']")).toBeNull();
  });

  it("renders nothing on the server (no document)", () => {
    vi.stubGlobal("document", undefined);
    const html = renderToString(
      <AddAllocationFlow
        open
        onClose={() => {}}
        onRecorded={() => {}}
        deepLink={null}
        heldStrategyIds={new Set()}
        bookEquityUsd={null}
        allKeysStale={false}
      />,
    );
    expect(html).toBe("");
  });

  it("opens as a modal dialog labelled by its title, with the step 1 eyebrow and focus in the search", async () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Add allocation" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("Step 1 of 2 · Strategy")).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search strategies" });
    expect(search).toHaveAttribute("placeholder", "Search by name or codename");
    expect(search).toHaveFocus();
    await ready();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("closes from Esc, the backdrop and the close button", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await ready();
    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId("add-allocation-backdrop"));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Close without adding" }));
    expect(props.onClose).toHaveBeenCalledTimes(3);
  });

  it("shows the connect-a-key footer with an Exchanges page link", async () => {
    setup();
    await ready();
    expect(
      screen.getByText(/Holding capital on an exchange already\? Connect the key on the/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Exchanges page" })).toHaveAttribute(
      "href",
      "/profile?tab=exchanges",
    );
  });

  it("reads the default list from /api/strategies/browse and honours has_more", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(JSON.stringify({ strategies: ROWS, has_more: true, limit: 200 }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setup({ fetchStrategies: undefined, deepLink: { raw: ID_D } });
    await screen.findByText("That strategy is past the first 200 we list here, so it cannot be added from this list yet.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/strategies/browse");
  });
});

describe("step 1: loading, error, empty", () => {
  it("shows three skeleton rows inside a labelled status while the list loads", () => {
    setup({ fetchStrategies: () => new Promise<Listed>(() => {}) });
    const status = screen.getByRole("status", { name: "Loading strategies" });
    expect(status.children).toHaveLength(3);
    expect(screen.queryByRole("list", { name: "Strategies" })).toBeNull();
  });

  it("a rejected read renders an envelope with Retry, keeps the search usable, and Retry re-runs the read behind loading rows", async () => {
    const user = userEvent.setup();
    let resolveSecond: (v: Listed) => void = () => {};
    const fetchStrategies = vi
      .fn<() => Promise<Listed>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => new Promise<Listed>((r) => (resolveSecond = r)));
    setup({ fetchStrategies });
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("searchbox", { name: "Search strategies" })).toBeEnabled();

    await user.click(retry);
    // Retry-in-flight: the loading rows stand in, so a second Retry cannot fire.
    expect(screen.getByRole("status", { name: "Loading strategies" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(fetchStrategies).toHaveBeenCalledTimes(2);

    resolveSecond({ strategies: ROWS, hasMore: false });
    await ready();
    expect(screen.getByText("Alpha One")).toBeInTheDocument();
  });

  it("a non-2xx default read is an error too (the loud-fail, not a wedge on Loading)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    setup({ fetchStrategies: undefined });
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByRole("status", { name: "Loading strategies" })).toBeNull();
  });

  it("zero rows reads 'No strategies are listed yet.'", async () => {
    setup({ fetchStrategies: listOf([]) });
    expect(await screen.findByText("No strategies are listed yet.")).toBeInTheDocument();
  });

  it("a search with no match names the query and Clear search empties the box", async () => {
    const user = userEvent.setup();
    setup();
    await ready();
    const search = screen.getByRole("searchbox", { name: "Search strategies" });
    await user.type(search, "zz");
    expect(screen.getByText('No strategies match "zz".')).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("list", { name: "Strategies" })).toBeInTheDocument();
  });

  it("filters by name and by codename", async () => {
    const user = userEvent.setup();
    setup();
    await ready();
    const search = screen.getByRole("searchbox", { name: "Search strategies" });
    await user.type(search, "gamm");
    expect(screen.getByText("Gamma Three")).toBeInTheDocument();
    expect(screen.queryByText("Alpha One")).toBeNull();
    await user.clear(search);
    await user.type(search, "beta");
    expect(screen.getByText("Beta Two")).toBeInTheDocument();
    expect(screen.queryByText("Gamma Three")).toBeNull();
  });
});

describe("step 1: rows", () => {
  it("shows name and caption, a Yours chip only for isOwn === true, and an Example pill", async () => {
    setup();
    await ready();
    const a = screen.getByTestId(`add-allocation-row-${ID_A}`);
    expect(within(a).getByText("Alpha One")).toBeInTheDocument();
    expect(a).toHaveTextContent("ALPH · Crypto · Trend");
    expect(within(a).queryByText("Yours")).toBeNull();
    expect(within(a).queryByText("Example")).toBeNull();
    const b = screen.getByTestId(`add-allocation-row-${ID_B}`);
    expect(within(b).getByText("Yours")).toBeInTheDocument();
    expect(within(b).getByText("Example")).toBeInTheDocument();
  });

  it("a row missing its codename, markets or types omits that part, never a placeholder", async () => {
    setup();
    await ready();
    const c = screen.getByTestId(`add-allocation-row-${ID_C}`);
    expect(c).toHaveTextContent("Gamma Three");
    expect(c).toHaveTextContent("GAMM");
    expect(c.textContent).not.toMatch(/·|—|n\/a|unknown/i);
    // Beta carries no caption part at all, so no caption line renders.
    const b = screen.getByTestId(`add-allocation-row-${ID_B}`);
    expect(b.textContent).not.toMatch(/·/);
  });

  it("an absent isOwn is not a Yours chip (the === true gate)", async () => {
    const legacy = { ...row({ id: ID_D, name: "Legacy Row" }) } as Partial<StrategyBrowseRow>;
    delete legacy.isOwn;
    setup({ fetchStrategies: listOf([legacy as StrategyBrowseRow]) });
    await ready();
    expect(screen.queryByText("Yours")).toBeNull();
  });

  it("renders no trust tier and no manager (C2): the picker carries only what the browse read carries", async () => {
    setup();
    await ready();
    const text = screen.getByRole("dialog").textContent ?? "";
    expect(text).not.toMatch(/institutional|exploratory|verified|trust tier|manager/i);
  });

  it("an own strategy that is not marked own capital is not selectable and says why; a marked one is", async () => {
    // The allocation route answers 409 to an unmarked own strategy every time, so
    // offering the row is a dead end the refresh cannot cure.
    const user = userEvent.setup();
    const markedOwn = row({ id: ID_D, name: "Delta Marked", isOwn: true });
    setup({
      fetchStrategies: listOf([...ROWS, markedOwn]),
      ownCapitalStrategyIds: new Set([ID_D]),
    });
    await ready();
    const unmarked = screen.getByTestId(`add-allocation-row-${ID_B}`);
    expect(unmarked).toHaveAttribute("aria-disabled", "true");
    expect(
      within(unmarked).getByText("Not marked as your own capital. Mark it on Strategies first."),
    ).toBeInTheDocument();
    await user.click(unmarked);
    expect(screen.getByText("Step 1 of 2 · Strategy")).toBeInTheDocument();
    // Someone else's strategy is never gated by the own-capital set.
    expect(screen.getByTestId(`add-allocation-row-${ID_A}`)).not.toHaveAttribute("aria-disabled");
    const marked = screen.getByTestId(`add-allocation-row-${ID_D}`);
    expect(marked).not.toHaveAttribute("aria-disabled");
    await user.click(marked);
    expect(screen.getByText("Step 2 of 2 · Amount and date")).toBeInTheDocument();
  });

  it("an archived own row stays selectable: the own-capital set omits archived strategies, so it cannot call it unmarked (R3-02)", async () => {
    const archived = row({ id: ID_D, name: "Delta Archived", isOwn: true, status: "archived" });
    setup({
      fetchStrategies: listOf([...ROWS, archived]),
      ownCapitalStrategyIds: new Set<string>(),
    });
    await ready();
    const el = screen.getByTestId(`add-allocation-row-${ID_D}`);
    expect(el).not.toHaveAttribute("aria-disabled");
    expect(within(el).queryByText(/Not marked as your own capital/)).toBeNull();
  });

  it("without the own-capital set (its read failed) no own row is disabled", async () => {
    setup();
    await ready();
    expect(screen.getByTestId(`add-allocation-row-${ID_B}`)).not.toHaveAttribute("aria-disabled");
  });

  it("a held row says 'In your allocation', is aria-disabled, explains itself, and is never selectable", async () => {
    const user = userEvent.setup();
    setup({ heldStrategyIds: new Set([ID_A]) });
    await ready();
    const held = screen.getByTestId(`add-allocation-row-${ID_A}`);
    expect(held).toHaveAttribute("aria-disabled", "true");
    expect(within(held).getByText("In your allocation")).toBeInTheDocument();
    expect(
      within(held).getByText("Already in your allocation. Change its amount on Holdings."),
    ).toBeInTheDocument();
    await user.click(held);
    expect(screen.getByText("Step 1 of 2 · Strategy")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    // A row that is not held carries neither the tag nor the attribute.
    const free = screen.getByTestId(`add-allocation-row-${ID_C}`);
    expect(free).not.toHaveAttribute("aria-disabled");
    expect(within(free).queryByText("In your allocation")).toBeNull();
  });

  it("ArrowDown and ArrowUp move focus between rows, and Enter on a row opens step 2 with the amount focused", async () => {
    const user = userEvent.setup();
    setup();
    await ready();
    const first = screen.getByTestId(`add-allocation-row-${ID_A}`);
    const second = screen.getByTestId(`add-allocation-row-${ID_B}`);
    await user.click(screen.getByRole("searchbox", { name: "Search strategies" }));
    await user.keyboard("{ArrowDown}");
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(second).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Step 2 of 2 · Amount and date")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Allocation (USD)" })).toHaveFocus();
  });

  it("Change strategy returns to step 1 with the search text kept", async () => {
    const user = userEvent.setup();
    setup();
    await ready();
    await user.type(screen.getByRole("searchbox", { name: "Search strategies" }), "alp");
    await user.click(screen.getByTestId(`add-allocation-row-${ID_A}`));
    await user.click(screen.getByRole("button", { name: "Change strategy" }));
    expect(screen.getByRole("searchbox", { name: "Search strategies" })).toHaveValue("alp");
    expect(screen.getByRole("searchbox", { name: "Search strategies" })).toHaveFocus();
  });
});

describe("step 1: the ?add= deep link", () => {
  it("a listed strategy that is not held opens step 2 with that strategy and the amount focused", async () => {
    const { props } = setup({ deepLink: { raw: ID_A } });
    await screen.findByText("Step 2 of 2 · Amount and date");
    expect(screen.getByText("Alpha One")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Allocation (USD)" })).toHaveFocus();
    expect(props.onInvalidDeepLink).not.toHaveBeenCalled();
  });

  it("while the deep link resolves, step 1's loading state shows", () => {
    setup({ deepLink: { raw: ID_A }, fetchStrategies: () => new Promise<Listed>(() => {}) });
    expect(screen.getByRole("status", { name: "Loading strategies" })).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2 · Strategy")).toBeInTheDocument();
  });

  it("a held id opens step 1 with the held notice and an Open Holdings link", async () => {
    const { props } = setup({ deepLink: { raw: ID_A }, heldStrategyIds: new Set([ID_A]) });
    const notice = await screen.findByTestId("add-allocation-notice");
    expect(notice).toHaveTextContent(
      "Alpha One is already in your allocation. Change its amount on Holdings.",
    );
    const link = within(notice).getByRole("link", { name: "Open Holdings" });
    expect(link).toHaveAttribute("href", "?tab=holdings");
    expect(screen.getByText("Step 1 of 2 · Strategy")).toBeInTheDocument();
    expect(props.onInvalidDeepLink).not.toHaveBeenCalled();
  });

  it("an own strategy not marked own capital lands on the picker with that row's reason, never on the amount step (198-ADD-DEEPLINK-UNMARKED-OWN)", async () => {
    // ID_B is an own strategy. The own route answers 409 for it every time, so the
    // link must stop where the picker stops, not after the allocator types an amount.
    const { props } = setup({
      deepLink: { raw: ID_B },
      ownCapitalStrategyIds: new Set<string>(),
    });
    const notice = await screen.findByTestId("add-allocation-notice");
    expect(notice).toHaveTextContent(
      "Beta Two: Not marked as your own capital. Mark it on Strategies first.",
    );
    expect(screen.getByText("Step 1 of 2 · Strategy")).toBeInTheDocument();
    expect(screen.queryByText("Step 2 of 2 · Amount and date")).toBeNull();
    expect(screen.getByTestId(`add-allocation-row-${ID_B}`)).toHaveAttribute("aria-disabled", "true");
    expect(props.onInvalidDeepLink).not.toHaveBeenCalled();
  });

  it("an own strategy marked own capital still opens the amount step from the link", async () => {
    setup({ deepLink: { raw: ID_B }, ownCapitalStrategyIds: new Set([ID_B]) });
    await screen.findByText("Step 2 of 2 · Amount and date");
    expect(screen.getByText("Beta Two")).toBeInTheDocument();
  });

  it("a malformed id opens step 1 with the not-available notice and reports it once", async () => {
    const { props } = setup({ deepLink: { raw: "not-a-uuid" } });
    expect(
      await screen.findByText("That strategy is not available to add. Search for another below."),
    ).toBeInTheDocument();
    expect(props.onInvalidDeepLink).toHaveBeenCalledTimes(1);
    expect(props.onInvalidDeepLink).toHaveBeenCalledWith("malformed");
  });

  it("an unlisted uuid against a complete list reports 'unlisted'", async () => {
    const { props } = setup({ deepLink: { raw: ID_D } });
    expect(
      await screen.findByText("That strategy is not available to add. Search for another below."),
    ).toBeInTheDocument();
    expect(props.onInvalidDeepLink).toHaveBeenCalledTimes(1);
    expect(props.onInvalidDeepLink).toHaveBeenCalledWith("unlisted");
  });

  it("an unlisted uuid against a TRUNCATED list says so and reports 'unlisted_truncated'", async () => {
    const { props } = setup({
      deepLink: { raw: ID_D },
      fetchStrategies: listOf(ROWS, true),
    });
    expect(
      await screen.findByText("That strategy is past the first 200 we list here, so it cannot be added from this list yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("That strategy is not available to add. Search for another below."),
    ).toBeNull();
    // Search only filters the loaded rows, so the notice must not send the user
    // to a search that can never find a strategy past the cap.
    expect(screen.getByTestId("add-allocation-notice").textContent).not.toMatch(/search/i);
    expect(props.onInvalidDeepLink).toHaveBeenCalledTimes(1);
    expect(props.onInvalidDeepLink).toHaveBeenCalledWith("unlisted_truncated");
  });

  it("an empty value opens step 1 with no notice and no callback", async () => {
    const { props } = setup({ deepLink: { raw: "" } });
    await ready();
    expect(screen.queryByTestId("add-allocation-notice")).toBeNull();
    expect(props.onInvalidDeepLink).not.toHaveBeenCalled();
  });

  it("the deep link is resolved once per open: a later retry-free re-render does not re-report", async () => {
    const { props, rerender } = setup({ deepLink: { raw: "not-a-uuid" } });
    await screen.findByTestId("add-allocation-notice");
    rerender(<AddAllocationFlow {...props} heldStrategyIds={new Set([ID_B])} />);
    await waitFor(() => expect(props.onInvalidDeepLink).toHaveBeenCalledTimes(1));
  });
});

// ─────────────────────────────────────────────────────────── step 2: the write

const COMMIT_URL = "/api/allocator/scenario/commit";
const OWN_URL = "/api/portfolio-strategies/allocation";
const KEY_RE = /^[A-Za-z0-9._~-]{16,128}$/;

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

const COMMIT_OK = { recorded: 1, errors: [], results: [{ index: 0, kind: "voluntary_add" }] };

type FetchCall = [string, RequestInit & { headers: Record<string, string> }];

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function calls(mock: ReturnType<typeof stubFetch>): FetchCall[] {
  return mock.mock.calls as unknown as FetchCall[];
}

/** Open the flow, choose a row, and return the user at step 2. */
async function atStep2(rowId: string, over: Partial<AddAllocationFlowProps> = {}) {
  const user = userEvent.setup();
  const utils = setup(over);
  await ready();
  await user.click(screen.getByTestId(`add-allocation-row-${rowId}`));
  const amountInput = screen.getByRole("spinbutton", { name: "Allocation (USD)" });
  return { user, amountInput, ...utils };
}

const primary = () => screen.getByRole("button", { name: /^(Add allocation|Adding…)$/ });

function utcDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

describe("step 2: the form", () => {
  it("shows the strategy, the step eyebrow, a numeric amount, and a date only for someone else's strategy", async () => {
    const { amountInput } = await atStep2(ID_A);
    expect(screen.getByText("Step 2 of 2 · Amount and date")).toBeInTheDocument();
    expect(screen.getByText("Alpha One")).toBeInTheDocument();
    expect(amountInput).toHaveAttribute("type", "number");
    expect(amountInput).toHaveAttribute("inputmode", "decimal");
    const date = screen.getByLabelText("Allocation date") as HTMLInputElement;
    expect(date.value).toBe(utcDaysAgo(0));
    expect(date).toHaveAttribute("max", utcDaysAgo(0));
    expect(date).toHaveAttribute("min", utcDaysAgo(365));
  });

  it("an own strategy has no date field (C4: the own route takes none)", async () => {
    await atStep2(ID_B);
    expect(screen.queryByLabelText("Allocation date")).toBeNull();
  });

  it("prints the share line from Book equity as the amount is typed", async () => {
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    expect(screen.getByText("≈ 25.0% of your allocation equity ($100,000).")).toBeInTheDocument();
  });

  it.each([
    ["Book equity is unknown", { bookEquityUsd: null }, "25000"],
    ["Book equity is zero", { bookEquityUsd: 0 }, "25000"],
    ["every key is stale", { allKeysStale: true }, "25000"],
    ["the amount does not parse", {}, ""],
  ])("prints no share line when %s", async (_why, over, typed) => {
    const { user, amountInput } = await atStep2(ID_A, over);
    if (typed) await user.type(amountInput, typed);
    expect(screen.queryByText(/of your allocation equity/)).toBeNull();
  });

  it("nothing is posted by opening, choosing and typing", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, COMMIT_OK));
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "100");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("step 2: refusals send nothing", () => {
  it("an empty amount is refused at the field, focus lands there, and the next valid keystroke clears it", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, COMMIT_OK));
    const { user, amountInput } = await atStep2(ID_A);
    expect(screen.queryByText("Enter an amount above $0.")).toBeNull();
    await user.click(primary());
    expect(screen.getByText("Enter an amount above $0.")).toBeInTheDocument();
    expect(amountInput).toHaveFocus();
    expect(amountInput).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(primary()).toBeEnabled();
    await user.type(amountInput, "5");
    expect(screen.queryByText("Enter an amount above $0.")).toBeNull();
  });

  it("someone else's strategy with no Book equity is refused at the amount, with no request", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, COMMIT_OK));
    const { user, amountInput } = await atStep2(ID_A, { bookEquityUsd: null });
    await user.type(amountInput, "1000");
    await user.click(primary());
    expect(
      screen.getByText("We cannot size this allocation until your allocation equity is available."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("someone else's strategy with every key stale is refused with no request, and an own strategy still posts", async () => {
    // The share line is hidden under allKeysStale; the stored percent is the only
    // size an Outcomes row keeps, so it must not be built from that same figure.
    const fetchMock = stubFetch(async () => jsonResponse(200, COMMIT_OK));
    const { user, amountInput } = await atStep2(ID_A, { allKeysStale: true });
    await user.type(amountInput, "1000");
    await user.click(primary());
    expect(
      screen.getByText("We cannot size this allocation until your allocation equity is available."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup();

    const own = await atStep2(ID_B, { allKeysStale: true });
    await own.user.type(own.amountInput, "1000");
    await own.user.click(primary());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("an amount above Book equity is refused naming the Book equity, with no request", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, COMMIT_OK));
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "150000");
    await user.click(primary());
    expect(
      screen.getByText("Enter an amount up to your allocation equity ($100,000)."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an own strategy needs no Book equity", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, {}));
    const { user, amountInput } = await atStep2(ID_B, { bookEquityUsd: null });
    await user.type(amountInput, "1000");
    await user.click(primary());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("a future date is refused at the date field, with no request", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, COMMIT_OK));
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "1000");
    fireEvent.change(screen.getByLabelText("Allocation date"), {
      target: { value: utcDaysAgo(-2) },
    });
    await user.click(primary());
    expect(screen.getByText("Date cannot be in the future")).toBeInTheDocument();
    expect(screen.getByLabelText("Allocation date")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a date more than 365 days back is refused, and exactly 365 days back is sent", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, COMMIT_OK));
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "1000");
    fireEvent.change(screen.getByLabelText("Allocation date"), {
      target: { value: utcDaysAgo(366) },
    });
    await user.click(primary());
    expect(screen.getByText("Date cannot be more than 365 days ago")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Allocation date"), {
      target: { value: utcDaysAgo(365) },
    });
    expect(screen.queryByText("Date cannot be more than 365 days ago")).toBeNull();
    await user.click(primary());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

describe("step 2: the two routes", () => {
  it("own: one POST to the allocation route, no key, and the own success line then close", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, { ok: true }));
    const { user, amountInput, props } = await atStep2(ID_B);
    await user.type(amountInput, "25000");
    await user.click(primary());
    await waitFor(() => expect(props.onRecorded).toHaveBeenCalledTimes(1));
    expect(calls(fetchMock)).toHaveLength(1);
    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(OWN_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      strategy_id: ID_B,
      allocated_amount: 25000,
    });
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain("idempotency-key");
    expect(props.onRecorded).toHaveBeenCalledWith(
      "Allocation recorded: Beta Two, $25,000. It is listed under Strategies on Holdings.",
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("other: one POST to the commit route with an Idempotency-Key, one voluntary_add diff, no fingerprint, and the Outcomes line", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(200, COMMIT_OK));
    const { user, amountInput, props } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    fireEvent.change(screen.getByLabelText("Allocation date"), {
      target: { value: utcDaysAgo(10) },
    });
    await user.click(primary());
    await waitFor(() => expect(props.onRecorded).toHaveBeenCalledTimes(1));
    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(COMMIT_URL);
    expect(init.headers["Idempotency-Key"]).toMatch(KEY_RE);
    expect(init.body).not.toContain("init_holdings_fingerprint");
    expect(JSON.parse(init.body as string)).toEqual({
      diffs: [
        {
          kind: "voluntary_add",
          strategy_id: ID_A,
          percent_allocated: 25,
          size_at_decision_usd: 25000,
          effective_date: utcDaysAgo(10),
        },
      ],
    });
    const line = vi.mocked(props.onRecorded).mock.calls[0][0];
    expect(line).toMatch(
      /^Allocation recorded: Alpha One, \$25,000 from [A-Z][a-z]{2} \d{1,2}, \d{4}\. It is listed under Outcomes on Holdings\.$/,
    );
    expect(line).not.toContain("Strategies on Holdings");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("while a request is in flight the primary reads Adding… and is disabled, inputs are read-only, Esc does nothing, and a second click sends nothing", async () => {
    const fetchMock = stubFetch(() => new Promise<Response>(() => {}));
    const { user, amountInput, props } = await atStep2(ID_A);
    await user.type(amountInput, "1000");
    await user.click(primary());
    expect(primary()).toBeDisabled();
    expect(primary()).toHaveTextContent("Adding…");
    expect(amountInput).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Allocation date")).toHaveAttribute("readonly");
    await user.keyboard("{Escape}");
    await user.click(screen.getByTestId("add-allocation-backdrop"));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(primary());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("step 2: failures and the idempotency key", () => {
  it.each([
    [400, "DASHBOARD_REQUEST_INVALID"],
    [422, "DASHBOARD_REQUEST_INVALID"],
    [401, "DASHBOARD_SIGNED_OUT"],
    [403, "DASHBOARD_SIGNED_OUT"],
  ] as const)(
    "a %s from the commit route wrote nothing: it says so and offers no Retry",
    async (status, code) => {
      stubFetch(async () => jsonResponse(status, { error: "refused" }));
      const { user, amountInput, props } = await atStep2(ID_A);
      await user.type(amountInput, "25000");
      await user.click(primary());
      expect(await screen.findByText(WIZARD_ERROR_COPY[code].title)).toBeInTheDocument();
      expect(screen.getByRole("dialog").textContent).toMatch(/nothing was saved/i);
      expect(screen.getByRole("dialog").textContent).not.toMatch(/part-way/i);
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      expect(amountInput).toHaveValue(25000);
      expect(props.onRecorded).not.toHaveBeenCalled();
    },
  );

  it.each([409, 500, 503])(
    "a %s from the commit route is retryable, and Retry re-sends the SAME Idempotency-Key",
    async (status) => {
      // A 5xx may have committed before the answer was lost; a re-send on the same
      // key is deduped server-side, so Retry is safe where a fresh key would not be.
      const fetchMock = stubFetch(async () => jsonResponse(status, { error: "boom" }));
      const { user, amountInput, props } = await atStep2(ID_A);
      await user.type(amountInput, "25000");
      await user.click(primary());
      expect(await screen.findByText(WIZARD_ERROR_COPY.UNKNOWN.title)).toBeInTheDocument();
      expect(screen.getByRole("dialog").textContent).not.toMatch(/part-way/i);
      expect(amountInput).toHaveValue(25000);
      fetchMock.mockImplementation(async () => jsonResponse(200, COMMIT_OK));
      await user.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(props.onRecorded).toHaveBeenCalledTimes(1));
      const keys = calls(fetchMock).map(([, init]) => init.headers["Idempotency-Key"]);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toMatch(KEY_RE);
      expect(keys[1]).toBe(keys[0]);
    },
  );

  it("a 502 with a non-JSON body is still retryable, not INDETERMINATE (the status alone decides)", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 502,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }) as unknown as Response);
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    await user.click(primary());
    expect(await screen.findByText(WIZARD_ERROR_COPY.UNKNOWN.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it.each([
    ["recorded is 0", { recorded: 0, errors: [] }],
    ["recorded is 2", { recorded: 2, errors: [] }],
    ["errors is non-empty", { recorded: 1, errors: [{ index: 0, error: "x" }] }],
  ])("a 200 where %s is INDETERMINATE, not success", async (_why, body) => {
    stubFetch(async () => jsonResponse(200, body));
    const { user, amountInput, props } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    await user.click(primary());
    expect(
      await screen.findByText(WIZARD_ERROR_COPY.DASHBOARD_WRITE_INDETERMINATE.title),
    ).toBeInTheDocument();
    expect(props.onRecorded).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("a non-JSON body is INDETERMINATE (the request reached the server)", async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }) as unknown as Response);
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    await user.click(primary());
    expect(
      await screen.findByText(WIZARD_ERROR_COPY.DASHBOARD_WRITE_INDETERMINATE.title),
    ).toBeInTheDocument();
  });

  it("a fetch throw is UNKNOWN, with Retry", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    await user.click(primary());
    expect(await screen.findByText(WIZARD_ERROR_COPY.UNKNOWN.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // Not silent: the cause is logged for whoever reads the console.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[AddAllocationFlow]"),
      expect.any(TypeError),
    );
  });

  it("a 429 is RATE_LIMITED with Retry, and Retry re-sends the SAME Idempotency-Key", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(429, {}, { "Retry-After": "30" }));
    const { user, amountInput, props } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    await user.click(primary());
    expect(await screen.findByText(WIZARD_ERROR_COPY.RATE_LIMITED.title)).toBeInTheDocument();
    fetchMock.mockImplementation(async () => jsonResponse(200, COMMIT_OK));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(props.onRecorded).toHaveBeenCalledTimes(1));
    const keys = calls(fetchMock).map(([, init]) => init.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(KEY_RE);
    expect(keys[1]).toBe(keys[0]);
  });

  it("Retry re-sends the exact first body even after the Book equity moved (a key is bound to its body)", async () => {
    // percent_allocated is a share of the live Book equity, and the Overview's 30s
    // refresh moves it. A rebuilt body under the kept key would be answered 422
    // body-mismatch for a write that had landed, so the first bytes must be reused.
    const fetchMock = stubFetch(async () => jsonResponse(503, { error: "boom" }));
    const { user, amountInput, props, rerender } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    await user.click(primary());
    await screen.findByText(WIZARD_ERROR_COPY.UNKNOWN.title);
    rerender(<AddAllocationFlow {...props} bookEquityUsd={200000} />);
    fetchMock.mockImplementation(async () => jsonResponse(200, COMMIT_OK));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(props.onRecorded).toHaveBeenCalledTimes(1));
    const bodies = calls(fetchMock).map(([, init]) => init.body as string);
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[0]).diffs[0].percent_allocated).toBe(25);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("a 422 for a key reused with another body is INDETERMINATE, not 'nothing was saved'", async () => {
    // That answer means an earlier send under this key landed. Telling the user to
    // make the change again would record the allocation twice.
    stubFetch(async () =>
      jsonResponse(422, { error: "Idempotency-Key reuse with different body" }),
    );
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    await user.click(primary());
    expect(
      await screen.findByText(WIZARD_ERROR_COPY.DASHBOARD_WRITE_INDETERMINATE.title),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog").textContent).not.toMatch(/nothing was saved/i);
  });

  it("changing the amount after a failure sends a NEW key", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(429, {}));
    const { user, amountInput } = await atStep2(ID_A);
    await user.type(amountInput, "25000");
    await user.click(primary());
    await screen.findByText(WIZARD_ERROR_COPY.RATE_LIMITED.title);
    await user.clear(amountInput);
    await user.type(amountInput, "26000");
    await user.click(primary());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const keys = calls(fetchMock).map(([, init]) => init.headers["Idempotency-Key"]);
    expect(keys[1]).toMatch(KEY_RE);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("an own-route 409 not_allocatable renders its envelope with no Retry", async () => {
    stubFetch(async () => jsonResponse(409, { error: "not_allocatable" }));
    const { user, amountInput } = await atStep2(ID_B);
    await user.type(amountInput, "25000");
    await user.click(primary());
    expect(
      await screen.findByText(WIZARD_ERROR_COPY.ALLOCATION_NOT_ALLOCATABLE.title),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    // The envelope's remedy says "the list reloads", so it must actually reload.
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("an own-route failure other than 409 does not refresh the list", async () => {
    stubFetch(async () => jsonResponse(500, { error: "boom" }));
    const { user, amountInput } = await atStep2(ID_B);
    await user.type(amountInput, "25000");
    await user.click(primary());
    await screen.findByRole("alert");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
