import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BridgeOutcomeBanner } from "./BridgeOutcomeBanner";

// ---------------------------------------------------------------------------
// H-0086 — BridgeOutcomeBanner had NO dedicated test file. The row-integrated
// strip exposes Allocated / Rejected CTAs plus a "Dismiss for today" button
// that POSTs /api/bridge/outcome/dismiss. The critical, untested behaviour is
// the dismiss state machine: success → onDismiss(); failure → banner stays
// (onDismiss NOT called) and the error is surfaced rather than optimistically
// hiding.
// ---------------------------------------------------------------------------

function renderBanner(
  overrides: {
    strategyId?: string;
    onAllocatedClick?: () => void;
    onRejectedClick?: () => void;
    onDismiss?: () => void;
  } = {},
) {
  const props = {
    strategyId: overrides.strategyId ?? "strat-xyz",
    onAllocatedClick: overrides.onAllocatedClick ?? vi.fn(),
    onRejectedClick: overrides.onRejectedClick ?? vi.fn(),
    onDismiss: overrides.onDismiss ?? vi.fn(),
  };
  return { ...render(<BridgeOutcomeBanner {...props} />), props };
}

describe("BridgeOutcomeBanner — H-0086", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("renders the prompt + Allocated/Rejected CTAs + dismiss button", () => {
    renderBanner();
    expect(
      screen.getByText(/Did you act on this Bridge suggestion\?/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allocated" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejected" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Dismiss for today/i }),
    ).toBeInTheDocument();
  });

  it("Allocated and Rejected buttons fire their callbacks without any fetch", () => {
    const onAllocatedClick = vi.fn();
    const onRejectedClick = vi.fn();
    renderBanner({ onAllocatedClick, onRejectedClick });
    fireEvent.click(screen.getByRole("button", { name: "Allocated" }));
    expect(onAllocatedClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    expect(onRejectedClick).toHaveBeenCalledTimes(1);
    // Neither CTA touches the network — only the dismiss button does.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dismiss success → POSTs the strategy_id then calls onDismiss exactly once", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    const onDismiss = vi.fn();
    renderBanner({ strategyId: "strat-abc", onDismiss });

    fireEvent.click(screen.getByRole("button", { name: /Dismiss for today/i }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/bridge/outcome/dismiss");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      strategy_id: "strat-abc",
    });
  });

  it("dismiss failure (non-OK response) → onDismiss NOT called; banner stays visible", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const onDismiss = vi.fn();
    renderBanner({ onDismiss });

    const dismissBtn = screen.getByRole("button", {
      name: /Dismiss for today/i,
    });
    fireEvent.click(dismissBtn);

    // The error path runs through console.error in the catch block.
    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());

    // The component intentionally does NOT optimistically hide — onDismiss
    // must NOT fire so the parent doesn't refresh and re-mount the banner.
    expect(onDismiss).not.toHaveBeenCalled();
    // Banner still present + the dismiss button is re-enabled (finally block).
    expect(
      screen.getByText(/Did you act on this Bridge suggestion\?/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(dismissBtn).not.toBeDisabled());
  });

  it("dismiss rejection (network throw) → onDismiss NOT called; error logged", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const onDismiss = vi.fn();
    renderBanner({ onDismiss });

    fireEvent.click(screen.getByRole("button", { name: /Dismiss for today/i }));

    await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalled());
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismiss button is disabled while the request is in flight", async () => {
    let resolveFetch: ((v: { ok: boolean; status: number }) => void) | null =
      null;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    renderBanner();

    const dismissBtn = screen.getByRole("button", {
      name: /Dismiss for today/i,
    });
    fireEvent.click(dismissBtn);

    // While the promise is pending the button is disabled.
    await waitFor(() => expect(dismissBtn).toBeDisabled());

    // Resolve to drain pending state. Cast at the call site — TS narrows the
    // closure-assigned binding to its initial `null`.
    (
      resolveFetch as unknown as (v: { ok: boolean; status: number }) => void
    )?.({ ok: true, status: 200 });
    await waitFor(() => expect(dismissBtn).not.toBeDisabled());
  });
});
