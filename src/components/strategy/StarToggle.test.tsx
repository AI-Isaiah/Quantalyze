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
import { installFetchMock, restoreFetchMock, type FetchMock } from "@/test/helpers/fetch";

const STRATEGY_ID = "cccccccc-0001-4000-8000-000000000001";
const STRATEGY_NAME = "Stellar Neutral Alpha";

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = installFetchMock();
});

afterEach(() => {
  vi.useRealTimers();
  restoreFetchMock();
});

describe("StarToggle", () => {
  it("renders the outline star icon (not the filled one) when starred=false", () => {
    // C-0137: assert intent (which icon variant), not a fill-attribute
    // negation that any wrong rendering satisfies. The outline path has
    // fill=null, so the legacy `path.fill !== accent` check was
    // trivially true for every conceivable wrong icon.
    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={() => {}}
      />,
    );
    const outline = screen.getByTestId("star-outline");
    expect(outline).not.toBeNull();
    expect(screen.queryByTestId("star-filled")).toBeNull();
    // Defensive: the outline path's behavioural contract is
    // stroke="currentColor" with NO accent fill anywhere in the subtree.
    const strokedPath = outline.querySelector("path[stroke]");
    expect(strokedPath).not.toBeNull();
    expect(strokedPath!.getAttribute("stroke")).toBe("currentColor");
    expect(outline.querySelector('[fill="var(--color-accent)"]')).toBeNull();
  });

  it("renders the filled star icon (not the outline one) when starred=true", () => {
    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={true}
        onToggle={() => {}}
      />,
    );
    const filled = screen.getByTestId("star-filled");
    expect(filled).not.toBeNull();
    expect(screen.queryByTestId("star-outline")).toBeNull();
    const path = filled.querySelector("path");
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

  it("does not call onToggle (revert) after unmount when both fetch attempts fail (REVIEW.md MEDIUM-3)", async () => {
    // REVIEW.md MEDIUM-3 — unmount cleanup. Both fetch attempts return failure,
    // but the component is unmounted between the click and the retry chain
    // completing. The post-retry revert (`onToggle` call #2) and the
    // showRetryHint state update must be skipped because the mount guard
    // short-circuits when isMountedRef.current === false.
    //
    // C-0138 / M-0469: deterministic signal instead of a wall-clock sleep.
    // The legacy `await new Promise(r => setTimeout(r, 800))` was coupled
    // to the production 600ms retry constant — bumping retry to >800ms
    // (or running on a slow CI runner) would make the assertion fire
    // BEFORE the would-be second onToggle call, false-passing the unmount
    // guard. We now wait until BOTH fetch attempts have settled (the
    // retry chain has fully completed) and only then assert the revert
    // was suppressed. This pins the behavioural contract without any
    // dependency on the retry-gap constant.
    const onToggle = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);

    const { unmount } = render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    // Optimistic flip fired synchronously.
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenNthCalledWith(1, STRATEGY_ID, true);

    // Unmount immediately, while the retry chain is still in flight.
    unmount();

    // Wait for the retry chain to fully complete — fetchMock must have
    // been called twice (initial + retry). At this point the retry chain
    // has reached the post-second-attempt branch where the revert
    // onToggle would have fired IF isMountedRef.current were still true.
    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
    // Flush any pending microtasks queued after the second fetch
    // resolves so the recordFailure check has had its chance to run.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The mount guard at recordFailure short-circuits: onToggle is still
    // called exactly once (the optimistic flip), never twice (would-be
    // revert).
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("reverts the optimistic flip and shows the retry hint when both fetch attempts fail", async () => {
    const onToggle = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);

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

  it("does NOT retry on a 401 — surfaces the auth-specific hint immediately", async () => {
    const onToggle = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 401 } as Response);

    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    // Auth failures must not consume a retry slot.
    await waitFor(() => {
      expect(screen.getByText(/Sign in again/i)).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenNthCalledWith(1, STRATEGY_ID, true);
    expect(onToggle).toHaveBeenNthCalledWith(2, STRATEGY_ID, false);
  });

  it("does NOT retry on a 403 — same auth-no-retry path as 401", async () => {
    const onToggle = vi.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as Response);

    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(screen.getByText(/Sign in again/i)).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenNthCalledWith(2, STRATEGY_ID, false);
  });

  it("respects the Retry-After header on a 429 and uses the rate-limit hint copy", async () => {
    const onToggle = vi.fn();
    const headers = new Headers({ "Retry-After": "1" });
    // Both attempts return 429 so we exhaust the retry chain and surface
    // the hint. The retry delay is driven by Retry-After, not the 600ms
    // fallback.
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers } as unknown as Response);

    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }, { timeout: 3000 });
    await waitFor(() => {
      expect(screen.getByText(/Try again shortly/i)).toBeDefined();
    });
    expect(onToggle).toHaveBeenNthCalledWith(2, STRATEGY_ID, false);
  });

  it("honours the Retry-After: 1 (=1000ms) delay — second fetch is not issued before 1000ms (L-0087)", async () => {
    // L-0087: the loose-timeout 429 test above would also pass if the
    // route reverted to a hardcoded 600ms delay (ignoring Retry-After).
    // This deterministic fake-timer test pins the actual delay: under a
    // Retry-After: 1 header the second fetch MUST NOT fire before 1000ms.
    // A regression dropping the Retry-After parsing back to the 600ms
    // default would call fetchMock the 2nd time at 600ms — caught here.
    vi.useFakeTimers();
    const onToggle = vi.fn();
    const headers = new Headers({ "Retry-After": "1" });
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers } as unknown as Response);

    render(
      <StarToggle
        strategyId={STRATEGY_ID}
        name={STRATEGY_NAME}
        starred={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));

    // Drain the microtasks so the initial fetch resolves and the retry
    // delay timer is scheduled.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance to just under the Retry-After window — second fetch must
    // NOT have fired yet. A regression to the 600ms hardcoded delay would
    // have produced fetchMock.calls === 2 here.
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Cross the 1000ms boundary — the retry fires.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("uses the network-specific hint when fetch rejects (no response)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

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
      expect(screen.getByText(/Couldn.t reach the server/i)).toBeDefined();
    });
  });

  it("renders the failure hint as a live region (role=status, aria-live=polite)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);

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
      const hint = screen.getByText(/Couldn.t update watchlist/i);
      expect(hint.getAttribute("role")).toBe("status");
      expect(hint.getAttribute("aria-live")).toBe("polite");
    });
  });
});
