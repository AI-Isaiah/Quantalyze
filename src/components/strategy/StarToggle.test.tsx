/**
 * Phase 13 / Plan 13-01 / DISCO-01 — StarToggle component tests.
 *
 * Behaviour contract (per 13-01-PLAN.md Task 1 + 13-UI-SPEC.md State Matrix):
 *   1. Outline icon when starred=false; filled icon when starred=true.
 *   2. aria-label = "Add {name} to watchlist" / "Remove {name} from watchlist"
 *   3. aria-pressed mirrors starred prop.
 *   4. onClick → optimistic onToggle(strategyId, !starred) is called BEFORE
 *      fetch resolves (so the visual flips immediately).
 *   5. Button is disabled while the in-flight transition is pending — the
 *      200ms double-click absorption window is realised via React's
 *      useTransition isPending flag.
 *   6. PUT failure (mock fetch rejects or returns 500 twice) calls onToggle
 *      again with the ORIGINAL starred value to revert the optimistic flip,
 *      then surfaces the inline retry hint copy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { StarToggle } from "./StarToggle";

const STRATEGY_ID = "cccccccc-0001-4000-8000-000000000001";
const STRATEGY_NAME = "Stellar Neutral Alpha";

// vitest's globalThis.fetch typing accepts the broader RequestInfo union.
type FetchMock = ReturnType<typeof vi.fn>;

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  // @ts-expect-error — node test env exposes a mutable global.fetch
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StarToggle", () => {
  it("renders the outline star icon when starred=false", () => {
    const { container } = render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={() => {}}
      />,
    );
    // Outline icon path uses stroke="currentColor" with no fill="var(--color-accent)".
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const path = svg!.querySelector("path");
    expect(path).not.toBeNull();
    expect(path!.getAttribute("fill")).not.toBe("var(--color-accent)");
  });

  it("renders the filled star icon when starred=true", () => {
    const { container } = render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={true}
        onToggle={() => {}}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    const path = svg!.querySelector("path");
    expect(path).not.toBeNull();
    expect(path!.getAttribute("fill")).toBe("var(--color-accent)");
  });

  it("uses 'Add {name} to watchlist' aria-label when starred=false", () => {
    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByLabelText(`Add ${STRATEGY_NAME} to watchlist`),
    ).toBeDefined();
  });

  it("uses 'Remove {name} from watchlist' aria-label when starred=true", () => {
    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={true}
        onToggle={() => {}}
      />,
    );
    expect(
      screen.getByLabelText(`Remove ${STRATEGY_NAME} from watchlist`),
    ).toBeDefined();
  });

  it("aria-pressed reflects the starred prop", () => {
    const { rerender } = render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={() => {}}
      />,
    );
    let btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-pressed")).toBe("false");

    rerender(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={true}
        onToggle={() => {}}
      />,
    );
    btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("calls onToggle(strategyId, !starred) optimistically on click", () => {
    const onToggle = vi.fn();
    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    // The optimistic call MUST have fired synchronously, before the (mock)
    // fetch resolves. We don't await fetch here — that is the whole point.
    expect(onToggle).toHaveBeenCalledWith(STRATEGY_ID, true);
  });

  it("issues a PUT to /api/watchlist/{strategyId} with body { action: 'add' } when toggling on", async () => {
    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/watchlist/${STRATEGY_ID}`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ action: "add" });
  });

  it("issues a PUT with body { action: 'remove' } when toggling off", async () => {
    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={true}
        onToggle={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body as string)).toEqual({ action: "remove" });
  });

  it("button is disabled while the transition is pending then re-enables", async () => {
    // Hold the fetch promise open so isPending stays true.
    let resolveFetch: ((v: unknown) => void) | undefined;
    fetchMock.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={() => {}}
      />,
    );
    const btn = screen.getByRole("button");
    fireEvent.click(btn);

    // While fetch is in flight, the button should be disabled (useTransition isPending).
    await waitFor(() => {
      expect(btn.hasAttribute("disabled")).toBe(true);
    });

    // Release the fetch and let the transition flush.
    await act(async () => {
      resolveFetch?.({ ok: true });
    });
    await waitFor(() => {
      expect(btn.hasAttribute("disabled")).toBe(false);
    });
  });

  it("reverts the optimistic flip and shows the retry hint when both fetch attempts fail", async () => {
    const onToggle = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    // Wait for the failure path: fetch is called twice (initial + 1 retry),
    // then onToggle is called a second time to revert.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }, { timeout: 3000 });

    await waitFor(() => {
      // First call was the optimistic add (true), second is the revert (false).
      expect(onToggle).toHaveBeenNthCalledWith(1, STRATEGY_ID, true);
      expect(onToggle).toHaveBeenNthCalledWith(2, STRATEGY_ID, false);
    });

    // The inline retry-hint copy is rendered (sr-only or visible).
    await waitFor(() => {
      expect(
        screen.getByText(/Couldn.t update watchlist/i),
      ).toBeDefined();
    });
  });
});
