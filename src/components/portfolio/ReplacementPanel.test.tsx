import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplacementPanel } from "./ReplacementPanel";
import type { BridgeCandidate } from "@/lib/types";

/**
 * H-1077 (audit-2026-05-07) — ReplacementPanel had zero component tests.
 *
 * Load-bearing behaviors:
 *   - POST /api/bridge with { portfolio_id, underperformer_strategy_id }.
 *   - four render branches: loading skeletons, error, empty candidates,
 *     populated cards (one per candidate).
 *   - Escape key + backdrop click call onClose; clicking the panel interior
 *     does NOT.
 *   - the in-flight fetch is aborted on unmount (no stale setState).
 */

// Mock ReplacementCard so the panel tests stay unit-level — we assert the
// panel renders one card per candidate, keyed by strategy_id, not the card's
// own intro flow (covered by ReplacementCard.test.tsx).
vi.mock("./ReplacementCard", () => ({
  ReplacementCard: ({ candidate }: { candidate: BridgeCandidate }) => (
    <div data-testid="replacement-card" data-strategy-id={candidate.strategy_id}>
      {candidate.strategy_name}
    </div>
  ),
}));

function buildCandidate(partial: Partial<BridgeCandidate> = {}): BridgeCandidate {
  return {
    strategy_id: "s-1",
    strategy_name: "Candidate Alpha",
    sharpe_delta: 0.2,
    dd_delta: -0.03,
    corr_delta: -0.05,
    composite_score: 0.7,
    fit_label: "Good fit",
    ...partial,
  };
}

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

function renderPanel(onClose = vi.fn()) {
  return render(
    <ReplacementPanel
      portfolioId="p-1"
      strategyId="under-1"
      strategyName="Underperformer"
      insightSentence="Underperformer has trailed the baseline."
      onClose={onClose}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<ReplacementPanel> — H-1077", () => {
  it("renders the loading skeletons while the fetch is in flight", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    renderPanel();
    expect(screen.getByLabelText("Loading candidates")).toBeInTheDocument();
  });

  it("POSTs to /api/bridge with portfolio_id + underperformer_strategy_id", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    mockFetch(fetchSpy);

    renderPanel();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/bridge");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.portfolio_id).toBe("p-1");
    expect(body.underperformer_strategy_id).toBe("under-1");
  });

  it("renders one ReplacementCard per candidate, keyed by strategy_id", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            buildCandidate({ strategy_id: "s-1", strategy_name: "Alpha" }),
            buildCandidate({ strategy_id: "s-2", strategy_name: "Beta" }),
          ],
        }),
        { status: 200 },
      ),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getAllByTestId("replacement-card")).toHaveLength(2),
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders the empty state when candidates is an empty array", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );

    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByText(/No replacement candidates found/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("replacement-card")).toBeNull();
  });

  it("renders the error message when the bridge fetch returns a non-OK body", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "Bridge service unavailable" }), {
        status: 500,
      }),
    );

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Bridge service unavailable")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("replacement-card")).toBeNull();
  });

  it("renders an error message when the fetch rejects", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });

    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("network down")).toBeInTheDocument(),
    );
  });

  it("calls onClose when Escape is pressed", async () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const onClose = vi.fn();
    renderPanel(onClose);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const onClose = vi.fn();
    const { container } = renderPanel(onClose);

    // The backdrop is the outer role="dialog" container (handleBackdropClick
    // only fires when target === currentTarget).
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when the panel interior is clicked", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const onClose = vi.fn();
    renderPanel(onClose);

    // The header title lives inside the inner panel, not the backdrop.
    fireEvent.click(screen.getByText(/Replace Underperformer/));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when the explicit close button is clicked", () => {
    mockFetch(() => new Promise<Response>(() => {}));
    const onClose = vi.fn();
    renderPanel(onClose);

    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("aborts the in-flight fetch on unmount without a stale setState warning", async () => {
    let abortListenerInstalled = false;
    mockFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            abortListenerInstalled = true;
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        }),
    );

    const errorSpy = vi.spyOn(console, "error");
    const { unmount } = renderPanel();

    expect(abortListenerInstalled).toBe(true);
    unmount();

    await Promise.resolve();
    await Promise.resolve();

    const warned = errorSpy.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === "string" &&
          /unmounted|not wrapped in act|state update/i.test(arg),
      ),
    );
    expect(warned).toBe(false);
  });
});
