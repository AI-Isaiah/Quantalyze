/** @vitest-environment jsdom */
/**
 * Phase 200 D-01 / D-08 (ROUTE-09, plan 200-09): the saved-key summary, the one
 * place the wizard lists an existing key, names the strategies that key feeds.
 *
 * WHY EACH CASE EXISTS
 *  - FEEDS-LISTED: a manager reusing a key must see what it already feeds.
 *  - FEEDS-NONE: an empty list is the one state that may say "Feeds no strategy.".
 *  - FAILED-NEVER-EMPTY (T-200-19): a failed or missing read must NEVER say the
 *    key is unused. Telling a manager "unused" when the app could not look is
 *    the failure D-01 exists to prevent; every failure shape is swept.
 *  - NO-CALL-WITHOUT-PRESELECT: the credential form stays byte-identical and
 *    makes no feeds call.
 *  - NO-NEW-CONTROL (D-08): the line is text plus links; the step does not
 *    become a key manager.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectKeyStep, type PreselectedKey } from "./ConnectKeyStep";

vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: () => {},
}));

const PRESELECT: PreselectedKey = {
  id: "k1",
  exchange: "binance",
  exchangeLabel: "Binance",
  keyLabel: "Main account",
};

const NONE = "Feeds no strategy.";
const UNCHECKED = "Could not check which strategies this key feeds.";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mountWithPreselect() {
  return render(
    <ConnectKeyStep
      wizardSessionId="sess-1"
      onSuccess={vi.fn()}
      preselectKey={PRESELECT}
      onUseDifferentKey={vi.fn()}
    />,
  );
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("[200-09] the saved-key summary names what the preselected key feeds", () => {
  it("FEEDS-LISTED: names each strategy as a link to its factsheet", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        feeds: {
          k1: [
            { strategy_id: "S1", name: "Alpha", kind: "single" },
            { strategy_id: "S2", name: "Beta", kind: "composite" },
          ],
        },
      }),
    );
    mountWithPreselect();
    const line = await screen.findByTestId("wizard-preselect-feeds");
    expect(line.textContent).toContain("Feeds:");
    expect(line.textContent).not.toContain(NONE);
    expect(line.textContent).not.toContain(UNCHECKED);
    expect(within(line).getByRole("link", { name: "Alpha" })).toHaveAttribute(
      "href",
      "/factsheet/S1?from=strategies",
    );
    expect(within(line).getByRole("link", { name: "Beta" })).toHaveAttribute(
      "href",
      "/factsheet/S2?from=strategies",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe("/api/keys/feeds");
  });

  it("FEEDS-LISTED: a redacted composite row is named without a link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        feeds: { k1: [{ strategy_id: null, name: null, status: null, kind: "composite" }] },
      }),
    );
    mountWithPreselect();
    const line = await screen.findByTestId("wizard-preselect-feeds");
    expect(line.textContent).toContain("a strategy we could not read");
    expect(within(line).queryByRole("link")).toBeNull();
  });

  it("FEEDS-NONE: an empty list reads `Feeds no strategy.`", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ feeds: { k1: [] } }));
    mountWithPreselect();
    const line = await screen.findByTestId("wizard-preselect-feeds");
    expect(line.textContent).toBe(NONE);
  });

  it("LOADING: nothing is rendered until the read lands", async () => {
    let release: (r: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    mountWithPreselect();
    expect(screen.getByTestId("wizard-preselect-summary")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-preselect-feeds")).toBeNull();
    release(json({ feeds: { k1: [] } }));
    await screen.findByTestId("wizard-preselect-feeds");
  });

  const FAILURES: ReadonlyArray<[string, () => void]> = [
    [
      "the fetch rejects",
      () => void vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline")),
    ],
    [
      "the route answers 500",
      () =>
        void vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: "Lookup failed" }, 500)),
    ],
    [
      "the route answers 429",
      () =>
        void vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ error: "slow down" }, 429)),
    ],
    [
      "the body is not a feeds map",
      () => void vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ nope: true })),
    ],
    [
      "the map lacks the preselected key",
      () =>
        void vi.spyOn(globalThis, "fetch").mockResolvedValue(
          json({ feeds: { other: [{ strategy_id: "S9", name: "Z", kind: "single" }] } }),
        ),
    ],
    [
      "the key's entry is not a list",
      () => void vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ feeds: { k1: "x" } })),
    ],
    [
      "an entry is malformed",
      () =>
        void vi.spyOn(globalThis, "fetch").mockResolvedValue(
          json({ feeds: { k1: [{ strategy_id: 7, name: "A", kind: "single" }] } }),
        ),
    ],
  ];

  it.each(FAILURES)(
    "FAILED-NEVER-EMPTY: %s -> could-not-check, never `Feeds no strategy.`",
    async (_label, arrange) => {
      arrange();
      mountWithPreselect();
      const line = await screen.findByTestId("wizard-preselect-feeds");
      expect(line.textContent).toBe(UNCHECKED);
      expect(screen.getByTestId("wizard-preselect-summary").textContent).not.toContain(NONE);
    },
  );

  it("NO-NEW-CONTROL (D-08): the line adds no button, only links", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ feeds: { k1: [{ strategy_id: "S1", name: "Alpha", kind: "single" }] } }),
    );
    mountWithPreselect();
    const summary = await screen.findByTestId("wizard-preselect-summary");
    await screen.findByTestId("wizard-preselect-feeds");
    expect(within(summary).queryAllByRole("button")).toEqual([]);
  });

  it("STALE-ANSWER-DROPPED: a late answer for a previous preselect is never shown for the current one", async () => {
    let releaseFirst: (r: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch")
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          releaseFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(json({ feeds: { k2: [] } }));
    const { rerender } = mountWithPreselect();
    rerender(
      <ConnectKeyStep
        wizardSessionId="sess-1"
        onSuccess={vi.fn()}
        preselectKey={{ ...PRESELECT, id: "k2", keyLabel: "Second" }}
        onUseDifferentKey={vi.fn()}
      />,
    );
    const line = await screen.findByTestId("wizard-preselect-feeds");
    expect(line.textContent).toBe(NONE);
    releaseFirst(json({ feeds: { k1: [{ strategy_id: "S1", name: "Alpha", kind: "single" }] } }));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId("wizard-preselect-feeds").textContent).toBe(NONE);
    expect(screen.queryByRole("link", { name: "Alpha" })).toBeNull();
  });

  it("NO-CALL-WITHOUT-PRESELECT: the credential form makes no feeds call", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ feeds: {} }));
    render(<ConnectKeyStep wizardSessionId="sess-1" onSuccess={vi.fn()} />);
    expect(screen.queryByTestId("wizard-preselect-summary")).toBeNull();
    // Let any (wrongly) scheduled effect and its microtasks settle.
    await waitFor(() => expect(screen.queryByTestId("wizard-preselect-feeds")).toBeNull());
    await Promise.resolve();
    const feedsCalls = spy.mock.calls.filter((c) => String(c[0]).includes("/api/keys/feeds"));
    expect(feedsCalls).toEqual([]);
  });
});
