import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StrategyBrowseRow } from "../allocations/components/StrategyBrowseDrawer";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { CompareAddStrategy, type Catalogue } from "./CompareAddStrategy";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  push.mockClear();
});

const row = (over: Partial<StrategyBrowseRow> & { id: string; name: string }): StrategyBrowseRow => ({
  codename: null,
  markets: [],
  strategy_types: ["Momentum", "Trend"],
  is_example: false,
  isOwn: false,
  ...over,
});

const ROWS: StrategyBrowseRow[] = [
  row({ id: "pub-1", name: "Alpine Trend", codename: "Falcon" }),
  row({ id: "pub-2", name: "Alpine Carry" }),
  // WHY: the browse route also returns the caller's own drafts. /compare reads
  // through withPublishedOnly, so offering one would link to a column that
  // never renders.
  row({ id: "draft-1", name: "Alpine Draft", isOwn: true, status: "draft" }),
  // An own PUBLISHED row is a legitimate result.
  row({ id: "own-pub", name: "Alpine Mine", isOwn: true, status: "published" }),
];

// The seam carries the route's truncation flag with the rows.
const cat = (rows: StrategyBrowseRow[], over: Partial<Catalogue> = {}): Catalogue => ({
  rows,
  hasMore: false,
  limit: 200,
  ...over,
});

const setup = (currentIds: string[] = [], rows = ROWS) => {
  const fetchStrategies = vi.fn().mockResolvedValue(cat(rows));
  const user = userEvent.setup();
  render(<CompareAddStrategy currentIds={currentIds} fetchStrategies={fetchStrategies} />);
  return { fetchStrategies, user, input: screen.getByRole("combobox", { name: "Add strategy" }) };
};

describe("CompareAddStrategy (happy path and privacy filter)", () => {
  it("fetches the catalogue once the query reaches 2 characters and offers name matches", async () => {
    const { fetchStrategies, user, input } = setup();
    await user.type(input, "alp");
    expect(await screen.findByRole("option", { name: /Alpine Trend/ })).toBeInTheDocument();
    expect(fetchStrategies).toHaveBeenCalledTimes(1);
  });

  it("matches the codename too, case-insensitively", async () => {
    const { user, input } = setup();
    await user.type(input, "FALC");
    expect(await screen.findByRole("option", { name: /Alpine Trend/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Alpine Carry/ })).toBeNull();
  });

  it("never offers the caller's own non-published rows (privacy: drafts are not comparable)", async () => {
    const { user, input } = setup();
    await user.type(input, "alp");
    await screen.findByRole("option", { name: /Alpine Trend/ });
    expect(screen.queryByRole("option", { name: /Alpine Draft/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Alpine Mine/ })).toBeInTheDocument();
  });

  it("never offers a strategy already in the comparison", async () => {
    const { user, input } = setup(["pub-1"]);
    await user.type(input, "alp");
    await screen.findByRole("option", { name: /Alpine Carry/ });
    expect(screen.queryByRole("option", { name: /Alpine Trend/ })).toBeNull();
  });

  it("shows the strategy types under the name", async () => {
    const { user, input } = setup();
    await user.type(input, "alp");
    const opt = await screen.findByRole("option", { name: /Alpine Carry/ });
    expect(opt).toHaveTextContent("Momentum · Trend");
  });

  it("choosing an option pushes compareHref of the current ids plus the new one, in order", async () => {
    const { user, input } = setup(["holding:okx:BTC:spot", "pub-1"]);
    await user.type(input, "carry");
    await user.click(await screen.findByRole("option", { name: /Alpine Carry/ }));
    expect(push).toHaveBeenCalledWith("/compare?ids=holding%3Aokx%3ABTC%3Aspot,pub-1,pub-2");
  });

  it("empties the field after an add", async () => {
    const { user, input } = setup();
    await user.type(input, "carry");
    await user.click(await screen.findByRole("option", { name: /Alpine Carry/ }));
    await waitFor(() => expect(input).toHaveValue(""));
  });
});

describe("CompareAddStrategy (states, ARIA and keyboard)", () => {
  const settle = () => act(() => vi.advanceTimersByTimeAsync(250));

  const setupFake = (fetchStrategies: () => Promise<Catalogue>, currentIds: string[] = []) => {
    vi.useFakeTimers();
    // fireEvent, not userEvent: RTL's async wrapper waits on a real setTimeout, which
    // never fires under vitest fake timers.
    const input = (() => {
      render(<CompareAddStrategy currentIds={currentIds} fetchStrategies={fetchStrategies} />);
      return screen.getByRole("combobox", { name: "Add strategy" });
    })();
    const user = {
      type: async (el: HTMLElement, v: string) => {
        fireEvent.change(el, { target: { value: v } });
      },
      clear: async (el: HTMLElement) => {
        fireEvent.change(el, { target: { value: "" } });
      },
      click: async (el: HTMLElement) => {
        fireEvent.click(el);
      },
      keyboard: async (keys: string) => {
        for (const k of keys.match(/\{[^}]+\}/g) ?? []) {
          fireEvent.keyDown(input, { key: k.slice(1, -1) });
        }
      },
    };
    return { user, input };
  };

  it("one character opens nothing and fetches nothing; two fetch only after 250ms of quiet", async () => {
    const fetchStrategies = vi.fn().mockResolvedValue(cat(ROWS));
    const { user, input } = setupFake(fetchStrategies);
    await user.type(input, "a");
    await settle();
    expect(fetchStrategies).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.type(input, "al");
    await act(() => vi.advanceTimersByTimeAsync(249));
    // WHY: typing must not hit the rate-limited route per keystroke.
    expect(fetchStrategies).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchStrategies).toHaveBeenCalledTimes(1);
  });

  it("shows Searching… in role=status while the fetch is pending", async () => {
    const { user, input } = setupFake(() => new Promise<Catalogue>(() => {}));
    await user.type(input, "alp");
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  });

  it("says when no published strategy matches, quoting the query", async () => {
    const { user, input } = setupFake(() => Promise.resolve(cat(ROWS)));
    await user.type(input, "zzz");
    await settle();
    expect(screen.getByText('No published strategy matches "zzz".')).toBeInTheDocument();
  });

  it("says the search covered only part of the catalogue when the route truncated, never a flat no-match", async () => {
    // WHY: past the route's cap a real strategy is unfindable. "No published
    // strategy matches" would tell the allocator it does not exist; only the
    // partial-catalogue line is true.
    const { user, input } = setupFake(() => Promise.resolve(cat(ROWS, { hasMore: true, limit: 200 })));
    await user.type(input, "zzz");
    await settle();
    expect(
      screen.getByText(
        "No match in the first 200 strategies. Select it in Discovery and compare from there.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No published strategy matches/)).toBeNull();
    // WHY: the catalogue is fetched once and matched client-side over the first
    // rows, so a longer or more specific query only re-filters the same rows and
    // can never surface a strategy past the cut. Advising it is a dead end; the
    // path that works is selecting it in Discovery.
    expect(screen.queryByText(/more specific/i)).toBeNull();
  });

  it("still offers a match found inside a truncated catalogue", async () => {
    const { user, input } = setupFake(() => Promise.resolve(cat(ROWS, { hasMore: true })));
    await user.type(input, "alp");
    await settle();
    expect(screen.getByRole("option", { name: /Alpine Trend/ })).toBeInTheDocument();
    expect(screen.queryByText(/No match in the first/)).toBeNull();
  });

  it("a failed fetch shows role=alert and Try again re-runs it, then shows options", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchStrategies = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(cat(ROWS));
    const { user, input } = setupFake(fetchStrategies);
    await user.type(input, "alp");
    await settle();
    // WHY: a silent failure would read as "no match", telling the allocator the
    // strategy does not exist.
    expect(screen.getByRole("alert")).toHaveTextContent("Search is not available right now.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchStrategies).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("option", { name: /Alpine Trend/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    spy.mockRestore();
  });

  it("a second qualifying query does not fetch again", async () => {
    const fetchStrategies = vi.fn().mockResolvedValue(cat(ROWS));
    const { user, input } = setupFake(fetchStrategies);
    await user.type(input, "alp");
    await settle();
    await user.clear(input);
    await user.type(input, "carry");
    await settle();
    expect(fetchStrategies).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("option", { name: /Alpine Carry/ })).toBeInTheDocument();
  });

  it("shows at most 8 options", async () => {
    const many = Array.from({ length: 12 }, (_, i) => row({ id: `m${i}`, name: `Many ${i}` }));
    const { user, input } = setupFake(() => Promise.resolve(cat(many)));
    await user.type(input, "many");
    await settle();
    expect(screen.getAllByRole("option")).toHaveLength(8);
  });

  it("exposes the combobox ARIA contract and tracks the active option", async () => {
    const { user, input } = setupFake(() => Promise.resolve(cat(ROWS)));
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    await user.type(input, "alp");
    await settle();
    const listbox = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    await user.keyboard("{ArrowDown}");
    const options = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id);
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", options[0].id);
  });

  it("Down then Enter adds the first option; the field is then empty and focused", async () => {
    const { user, input } = setupFake(() => Promise.resolve(cat(ROWS)), ["pub-9"]);
    await user.type(input, "alp");
    await settle();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(push).toHaveBeenCalledWith("/compare?ids=pub-9,pub-1");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("Enter with no active option adds nothing", async () => {
    const { user, input } = setupFake(() => Promise.resolve(cat(ROWS)));
    await user.type(input, "alp");
    await settle();
    await user.keyboard("{Enter}");
    expect(push).not.toHaveBeenCalled();
  });

  it("Escape closes the listbox and keeps the query", async () => {
    const { user, input } = setupFake(() => Promise.resolve(cat(ROWS)));
    await user.type(input, "alp");
    await settle();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveValue("alp");
  });
});

describe("CompareAddStrategy (the default fetch of /api/strategies/browse)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubBrowse = (body: unknown) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) }),
    );
  };
  const typeAndSettle = async (v: string) => {
    render(<CompareAddStrategy currentIds={[]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Add strategy" }), {
      target: { value: v },
    });
    await act(() => vi.advanceTimersByTimeAsync(250));
  };

  it("a 200 without a strategies array is the error state with Try again, not 'no match'", async () => {
    // WHY: a renamed or dropped key read as an empty catalogue would tell the
    // allocator no strategy exists, and send nothing to the console.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    stubBrowse({ error: "shape changed" });
    await typeAndSettle("alp");
    expect(screen.getByRole("alert")).toHaveTextContent("Search is not available right now.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/No published strategy matches/)).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("carries has_more and limit from the response into the partial-catalogue line", async () => {
    vi.useFakeTimers();
    stubBrowse({ strategies: ROWS, has_more: true, limit: 200 });
    await typeAndSettle("zzz");
    expect(
      screen.getByText(
        "No match in the first 200 strategies. Select it in Discovery and compare from there.",
      ),
    ).toBeInTheDocument();
  });

  it("has_more false with no match keeps the original no-match line", async () => {
    vi.useFakeTimers();
    stubBrowse({ strategies: ROWS, has_more: false, limit: 200 });
    await typeAndSettle("zzz");
    expect(screen.getByText('No published strategy matches "zzz".')).toBeInTheDocument();
  });
});
