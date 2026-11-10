import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor, within } from "@testing-library/react";
import { AllocatorExchangeManager } from "./AllocatorExchangeManager";

/**
 * Phase 200 MANAGERKEYS plan 07 (D-01, D-02, ROUTE-09) — the Profile key manager says
 * which strategies each key feeds, and its Disconnect / Delete confirm names them.
 *
 * The honesty rule under test (167.2.1 D-01, carried by D-01 here): a read that FAILED is
 * never rendered as "feeds nothing". A manager deciding whether to remove a key is never
 * told it is unused when the app simply could not look.
 */

const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: routerRefreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const rpcMock = vi.fn();
const holdingsCountMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    rpc: (name: string, args: unknown) => rpcMock(name, args),
    from: (table: string) => ({
      select: () => {
        if (table === "csv_daily_returns") {
          return { eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) };
        }
        if (table === "allocator_equity_derived") {
          return { in: () => Promise.resolve({ data: [], error: null }) };
        }
        return { eq: () => Promise.resolve(holdingsCountMock() ?? { count: 0, error: null }) };
      },
    }),
  }),
}));

const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Feed = { strategy_id: string | null; name: string | null; status: string | null; kind: "single" | "composite" };
const ALPHA: Feed = { strategy_id: S1, name: "Alpha Single", status: "draft", kind: "single" };
const BETA: Feed = { strategy_id: S2, name: "Beta Composite", status: "published", kind: "composite" };

function makeKey(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    exchange: "binance",
    label: id === K1 ? "Key One" : "Key Two",
    is_active: true,
    sync_status: "complete",
    last_sync_at: "2026-04-19T11:58:00Z",
    account_balance_usdt: 100,
    created_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

// A fresh Response per call: a shared single-use body would be spent by the first read.
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type Routes = {
  feeds: () => Response | Promise<Response>;
  memberships: (keyId: string) => Response | Promise<Response>;
};
let routes: Routes;
let fetchMock: ReturnType<typeof vi.fn>;
const callsTo = (needle: string) => fetchMock.mock.calls.filter((c) => String(c[0]).includes(needle));

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
  routerRefreshMock.mockReset();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ error: null });
  holdingsCountMock.mockReset();
  routes = {
    feeds: () => json(200, { feeds: { [K1]: [ALPHA, BETA], [K2]: [] } }),
    memberships: () => json(200, { memberships: [], feeds: [ALPHA, BETA] }),
  };
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).startsWith("/api/keys/feeds")) return routes.feeds();
    const m = /\/api\/keys\/([^/]+)\/memberships/.exec(String(url));
    if (m) return routes.memberships(decodeURIComponent(m[1]));
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderManager(
  role: "manager" | "allocator" | "both" = "allocator",
  keys = [makeKey(K1), makeKey(K2)],
) {
  const view = render(<AllocatorExchangeManager hasHoldings={false} initialKeys={keys} role={role} />);
  await waitFor(() => expect(callsTo("/api/keys/feeds")).toHaveLength(1));
  return view;
}

const feedsLine = (id: string) => screen.getByTestId(`allocator-key-feeds-${id}`);

function confirmButton() {
  return screen
    .getAllByRole("button")
    .filter((b) => b.textContent === "Disconnect" && b.className.includes("bg-negative"))
    .at(-1)!;
}

async function openConfirm(keyLabelNeedle = /Disconnect binance key/i, index = 0) {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: keyLabelNeedle })[index]);
  });
}

describe("AllocatorExchangeManager — feeds line (200-07, D-01, D-02)", () => {
  it("FEEDS-LINKS-ALLOCATOR: each strategy a key feeds is a link to its factsheet, and a key feeding nothing says so", async () => {
    await renderManager("allocator");
    await waitFor(() => expect(feedsLine(K1)).toHaveTextContent("Feeds: Alpha Single, Beta Composite"));
    const links = Array.from(feedsLine(K1).querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([`/factsheet/${S1}`, `/factsheet/${S2}`]);
    expect(feedsLine(K2)).toHaveTextContent("Feeds no strategy.");
  });

  it.each(["manager", "both"] as const)("FEEDS-LINKS-%s: links go to the strategy edit page", async (role) => {
    await renderManager(role);
    await waitFor(() => expect(feedsLine(K1).querySelectorAll("a")).toHaveLength(2));
    expect(Array.from(feedsLine(K1).querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual([
      `/strategies/${S1}/edit`,
      `/strategies/${S2}/edit`,
    ]);
  });

  it("FEEDS-REDACTED: a composite row with no readable strategy is named without a link", async () => {
    routes.feeds = () =>
      json(200, { feeds: { [K1]: [{ strategy_id: null, name: null, status: null, kind: "composite" }], [K2]: [] } });
    await renderManager();
    await waitFor(() => expect(feedsLine(K1)).toHaveTextContent("a strategy we could not read"));
    expect(feedsLine(K1).querySelector("a")).toBeNull();
  });

  const failures: Array<[string, () => Response | Promise<Response>]> = [
    ["500", () => json(500, { error: "Lookup failed" })],
    ["429", () => json(429, { error: "rate" })],
    ["rejected fetch", () => Promise.reject(new Error("offline"))],
    ["not a feeds map", () => json(200, { feeds: [] })],
    ["malformed entry", () => json(200, { feeds: { [K1]: [{ nope: true }], [K2]: [] } })],
  ];
  it.each(failures)("FAILED-NEVER-EMPTY (%s): the line says it could not check, never 'Feeds no strategy.'", async (_n, answer) => {
    routes.feeds = answer;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderManager();
    await waitFor(() =>
      expect(feedsLine(K1)).toHaveTextContent("Could not check which strategies this key feeds."),
    );
    expect(document.body.textContent).not.toContain("Feeds no strategy.");
  });

  it("SFH-3 RETRY-LINE: a failed feeds read offers Retry, and Retry re-reads the feeds", async () => {
    let calls = 0;
    routes.feeds = () => (++calls === 1 ? json(500, { error: "rate" }) : json(200, { feeds: { [K1]: [ALPHA], [K2]: [] } }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderManager();
    await waitFor(() => expect(feedsLine(K1)).toHaveTextContent("Could not check which strategies this key feeds."));
    await act(async () => {
      fireEvent.click(within(feedsLine(K1)).getByRole("button", { name: "Retry" }));
    });
    await waitFor(() => expect(feedsLine(K1)).toHaveTextContent("Feeds: Alpha Single"));
    expect(callsTo("/api/keys/feeds")).toHaveLength(2);
  });

  it("MISSING-KEY-IS-UNCHECKED: a key the answer does not mention is could-not-check, not feeds-nothing", async () => {
    routes.feeds = () => json(200, { feeds: { [K2]: [] } });
    await renderManager();
    await waitFor(() => expect(feedsLine(K2)).toHaveTextContent("Feeds no strategy."));
    expect(feedsLine(K1)).toHaveTextContent("Could not check which strategies this key feeds.");
  });

  it("ONE-READ-ON-REFRESH: a router refresh that hands the manager new keys does not re-read the feeds", async () => {
    const { rerender } = await renderManager();
    rerender(
      <AllocatorExchangeManager
        hasHoldings={false}
        initialKeys={[makeKey(K1, { sync_status: "syncing" }), makeKey(K2)]}
        role="allocator"
      />,
    );
    await act(async () => {});
    expect(callsTo("/api/keys/feeds")).toHaveLength(1);
  });

  it("DISCONNECTED-ROW: a disconnected key still shows what it feeds (Disconnect keeps the links)", async () => {
    await renderManager("allocator", [makeKey(K1, { disconnected_at: "2026-05-01T00:00:00Z" }), makeKey(K2)]);
    await waitFor(() => expect(feedsLine(K1)).toHaveTextContent("Feeds: Alpha Single, Beta Composite"));
  });

  it("STALE-ANSWER-DROPPED: a feeds answer older than the newest read never overwrites it", async () => {
    holdingsCountMock.mockReturnValue({ count: 0, error: null });
    let releaseFirst: (r: Response) => void = () => {};
    let call = 0;
    routes.feeds = () =>
      ++call === 1
        ? new Promise<Response>((resolve) => (releaseFirst = resolve))
        : json(200, { feeds: { [K1]: [BETA], [K2]: [] } });
    await renderManager();
    await openConfirm();
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await waitFor(() => expect(feedsLine(K1)).toHaveTextContent("Feeds: Beta Composite"));
    await act(async () => {
      releaseFirst(json(200, { feeds: { [K1]: [ALPHA], [K2]: [] } }));
    });
    expect(feedsLine(K1)).toHaveTextContent("Feeds: Beta Composite");
    expect(feedsLine(K1).textContent).not.toContain("Alpha Single");
  });

  it("REFRESH-AFTER-DELETE: a completed Disconnect re-reads the feeds", async () => {
    holdingsCountMock.mockReturnValue({ count: 0, error: null });
    await renderManager();
    await openConfirm();
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    await waitFor(() => expect(callsTo("/api/keys/feeds")).toHaveLength(2));
  });
});

describe("AllocatorExchangeManager — Disconnect / Delete confirm names what the key feeds (200-07, D-01, T-200-15)", () => {
  beforeEach(() => {
    holdingsCountMock.mockReturnValue({ count: 0, error: null });
  });

  it("CONFIRM-NAMES-NEUTRAL: a Disconnect names every strategy the key feeds and does not say they lose anything", async () => {
    await renderManager();
    await openConfirm();
    const note = await screen.findByTestId("allocator-delete-feeds");
    expect(note).toHaveTextContent("This key feeds: Alpha Single, Beta Composite.");
    expect(note.textContent).not.toMatch(/loses/);
    expect(callsTo("/memberships")).toHaveLength(1);
    expect(String(callsTo("/memberships")[0][0])).toContain(`/api/keys/${K1}/memberships`);
  });

  it("CONFIRM-NAMES-HARD-DELETE: with the cascade box ticked it says what each strategy loses", async () => {
    holdingsCountMock.mockReturnValue({ count: 3, error: null });
    await renderManager();
    await openConfirm();
    const box = await screen.findByRole("checkbox");
    await act(async () => {
      fireEvent.click(box);
    });
    const note = screen.getByTestId("allocator-delete-feeds");
    expect(note).toHaveTextContent("Alpha Single loses its key");
    expect(note).toHaveTextContent("Beta Composite loses this member");
    expect(note.textContent).not.toContain("This key feeds:");
  });

  it("CONFIRM-FEEDS-NOTHING: a key that feeds no strategy says so when the read succeeded", async () => {
    routes.memberships = () => json(200, { memberships: [], feeds: [] });
    await renderManager();
    await openConfirm();
    expect(await screen.findByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds no strategy.");
  });

  const unreadable: Array<[string, () => Response | Promise<Response>]> = [
    ["500", () => json(500, { error: "Lookup failed" })],
    ["rejected fetch", () => Promise.reject(new Error("offline"))],
    ["no feeds array", () => json(200, { memberships: [] })],
  ];
  it.each(unreadable)("CONFIRM-UNCHECKED (%s): the confirm says it could not check, never that the key feeds nothing", async (_n, answer) => {
    routes.memberships = answer;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderManager();
    await openConfirm();
    const note = await screen.findByTestId("allocator-delete-feeds");
    expect(note).toHaveTextContent("Could not check which strategies this key feeds.");
    expect(note.textContent).not.toContain("feeds no strategy");
    expect(note.textContent).not.toContain("This key feeds:");
    // R2-03: Disconnect is reversible (Reconnect), so an unchecked read warns and never blocks it.
    expect(confirmButton()).not.toBeDisabled();
  });

  it("R2-03 DISCONNECT-WARNS-ONLY: an unchecked read leaves Disconnect enabled and it runs", async () => {
    routes.memberships = () => json(500, { error: "rate" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderManager();
    await openConfirm();
    await waitFor(() =>
      expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("Could not check which strategies this key feeds."),
    );
    expect(confirmButton()).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(confirmButton());
    });
    expect(rpcMock).toHaveBeenCalledWith("disconnect_allocator_api_key", { p_api_key_id: K1 });
  });

  it("R2-03 DELETE-HELD-ON-UNCHECKED: with an unchecked read Disconnect is enabled and the irreversible Delete key stays disabled, with Retry offered", async () => {
    routes.memberships = () => json(500, { error: "rate" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderManager("both");
    await openConfirm();
    await waitFor(() =>
      expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("Could not check which strategies this key feeds."),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete key" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Delete key" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Disconnect" })).not.toBeDisabled();
    expect(screen.getByTestId("allocator-delete-retry")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete key" }));
    });
    expect(rpcMock).not.toHaveBeenCalledWith("delete_allocator_api_key", expect.anything());
  });

  it("R3-01 CASCADE-DISCONNECT-HELD-ON-UNCHECKED: on an unchecked read Disconnect is disabled once the cascade box is ticked, and enabled while it is unticked", async () => {
    routes.memberships = () => json(500, { error: "rate" });
    holdingsCountMock.mockReturnValue({ count: 2, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderManager("allocator");
    await openConfirm();
    await waitFor(() =>
      expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("Could not check which strategies this key feeds."),
    );
    const box = await screen.findByRole("checkbox");
    // R2-03 stays: unticked, Disconnect is the reversible soft disconnect and is not held.
    expect(screen.getByRole("button", { name: "Disconnect" })).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(box);
    });
    // Ticked, Disconnect runs delete_allocator_api_key with p_cascade_holdings: true, so D-R1 holds it.
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    });
    expect(rpcMock).not.toHaveBeenCalledWith("delete_allocator_api_key", expect.anything());
    await act(async () => {
      fireEvent.click(box);
    });
    expect(screen.getByRole("button", { name: "Disconnect" })).not.toBeDisabled();
  });

  it("SFH-3 CONFIRM-RETRY: an unchecked confirm offers one Retry that re-reads and then releases the confirm", async () => {
    let calls = 0;
    routes.memberships = () => (++calls === 1 ? json(500, { error: "rate" }) : json(200, { memberships: [], feeds: [ALPHA] }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderManager();
    await openConfirm();
    await waitFor(() =>
      expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("Could not check which strategies this key feeds."),
    );
    expect(confirmButton()).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("allocator-delete-retry"));
    });
    await waitFor(() => expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds: Alpha Single."));
    expect(confirmButton()).not.toBeDisabled();
    expect(screen.queryByTestId("allocator-delete-retry")).not.toBeInTheDocument();
    expect(callsTo("/memberships")).toHaveLength(2);
  });

  it("CONFIRM-HELD-WHILE-READING: the confirm button stays disabled until the feeds read answers", async () => {
    let release: (r: Response) => void = () => {};
    routes.memberships = () => new Promise<Response>((resolve) => (release = resolve));
    await renderManager();
    await openConfirm();
    await waitFor(() => expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("Checking"));
    expect(confirmButton()).toBeDisabled();
    await act(async () => {
      release(json(200, { memberships: [], feeds: [ALPHA] }));
    });
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds: Alpha Single.");
  });

  it("CONFIRM-STALE-ANSWER-DROPPED: an answer for a key whose confirm was closed does not name its strategies on the next key", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    routes.memberships = (id) =>
      id === K1
        ? new Promise<Response>((resolve) => (releaseFirst = resolve))
        : json(200, { memberships: [], feeds: [] });
    await renderManager();
    await openConfirm(/Disconnect binance key/i, 0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    await openConfirm(/Disconnect binance key/i, 1);
    await waitFor(() => expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds no strategy."));
    await act(async () => {
      releaseFirst(json(200, { memberships: [], feeds: [ALPHA] }));
    });
    expect(screen.getByTestId("allocator-delete-feeds")).toHaveTextContent("This key feeds no strategy.");
    expect(screen.getByTestId("allocator-delete-feeds").textContent).not.toContain("Alpha Single");
  });
});
