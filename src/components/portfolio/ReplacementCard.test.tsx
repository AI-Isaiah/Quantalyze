import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplacementCard } from "./ReplacementCard";
import type { BridgeCandidate } from "@/lib/types";

/**
 * H-1077 (audit-2026-05-07) — ReplacementCard had zero component tests.
 *
 * Load-bearing behaviors:
 *   - fit_label badge picks the right color class (Strong/Good → positive,
 *     Moderate → warning, Weak → badge-other).
 *   - delta sign → color (H-1065): the backend orients ALL deltas so
 *     positive = improvement, making every axis "higher-better". A positive
 *     Sharpe, MaxDD (shallower drawdown), or Corr (reduced correlation) delta
 *     paints green; negative paints red. Asserted directly so a future sign
 *     regression on any axis is caught.
 *   - intro flow: POST /api/intro, 409 treated as success ("done"), non-409
 *     error surfaces "Retry Intro", button disabled while loading.
 */

function buildCandidate(partial: Partial<BridgeCandidate> = {}): BridgeCandidate {
  return {
    strategy_id: "s-1",
    strategy_name: "Replacement Alpha",
    sharpe_delta: 0.25,
    dd_delta: 0.04,
    corr_delta: 0.1,
    composite_score: 0.82,
    fit_label: "Strong fit",
    ...partial,
  };
}

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<ReplacementCard> — H-1077", () => {
  it("renders the strategy name and the Strong fit badge with the positive color class", () => {
    render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);

    expect(screen.getByText("Replacement Alpha")).toBeInTheDocument();
    const badge = screen.getByText("Strong fit");
    expect(badge.className).toContain("text-positive");
  });

  it("renders the Moderate fit badge with the warning color class", () => {
    render(
      <ReplacementCard
        candidate={buildCandidate({ fit_label: "Moderate fit" })}
        replacementFor="old-1"
      />,
    );
    expect(screen.getByText("Moderate fit").className).toContain("text-warning");
  });

  it("renders the Weak fit badge with the badge-other color class", () => {
    render(
      <ReplacementCard
        candidate={buildCandidate({ fit_label: "Weak fit" })}
        replacementFor="old-1"
      />,
    );
    expect(screen.getByText("Weak fit").className).toContain("text-badge-other");
  });

  it("colors a POSITIVE Sharpe delta green (positive = improvement)", () => {
    render(
      <ReplacementCard
        candidate={buildCandidate({ sharpe_delta: 0.25 })}
        replacementFor="old-1"
      />,
    );
    const chip = screen.getByText("+0.25 Sharpe");
    expect(chip.className).toContain("text-positive");
  });

  it("colors a NEGATIVE Sharpe delta red", () => {
    render(
      <ReplacementCard
        candidate={buildCandidate({ sharpe_delta: -0.25 })}
        replacementFor="old-1"
      />,
    );
    const chip = screen.getByText("-0.25 Sharpe");
    expect(chip.className).toContain("text-negative");
  });

  it("colors a POSITIVE MaxDD delta green (H-1065: positive = shallower drawdown = improvement)", () => {
    render(
      <ReplacementCard
        candidate={buildCandidate({ dd_delta: 0.04 })}
        replacementFor="old-1"
      />,
    );
    // +0.04 → "+4.0% MaxDD"
    const chip = screen.getByText("+4.0% MaxDD");
    expect(chip.className).toContain("text-positive");
  });

  it("colors a NEGATIVE MaxDD delta red (deeper drawdown is worse)", () => {
    render(
      <ReplacementCard
        candidate={buildCandidate({ dd_delta: -0.04 })}
        replacementFor="old-1"
      />,
    );
    const chip = screen.getByText("-4.0% MaxDD");
    expect(chip.className).toContain("text-negative");
  });

  it("colors a POSITIVE Corr delta green (H-1065: positive = correlation reduced = improvement)", () => {
    render(
      <ReplacementCard
        candidate={buildCandidate({ corr_delta: 0.1 })}
        replacementFor="old-1"
      />,
    );
    const chip = screen.getByText("+10.0% Corr");
    expect(chip.className).toContain("text-positive");
  });

  it("colors a NEGATIVE Corr delta red (higher correlation is worse)", () => {
    render(
      <ReplacementCard
        candidate={buildCandidate({ corr_delta: -0.1 })}
        replacementFor="old-1"
      />,
    );
    const chip = screen.getByText("-10.0% Corr");
    expect(chip.className).toContain("text-negative");
  });

  it("POSTs to /api/intro with the candidate id, source=bridge, and replacement_for", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    mockFetch(fetchSpy);

    render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/intro");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.strategy_id).toBe("s-1");
    expect(body.source).toBe("bridge");
    expect(body.replacement_for).toBe("old-1");
  });

  it("transitions to the done state ('Intro Requested') after a successful intro", async () => {
    mockFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));

    await waitFor(() =>
      expect(screen.getByText("Intro Requested")).toBeInTheDocument(),
    );
    // The button is replaced by the done text.
    expect(screen.queryByRole("button", { name: /Request Intro|Retry Intro/ })).toBeNull();
  });

  it("treats a 409 from /api/intro as success (intro already requested → done)", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "already requested" }), { status: 409 }),
    );

    render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));

    await waitFor(() =>
      expect(screen.getByText("Intro Requested")).toBeInTheDocument(),
    );
    // Must NOT show the error retry affordance for a 409.
    expect(screen.queryByRole("button", { name: "Retry Intro" })).toBeNull();
  });

  it("shows 'Retry Intro' on a non-409 error response", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: "server error" }), { status: 500 }),
    );

    render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry Intro" })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Intro Requested")).toBeNull();
  });

  it("shows 'Retry Intro' when the fetch rejects (network error)", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });

    render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry Intro" })).toBeInTheDocument(),
    );
  });

  // H-1067 (loud-fail discipline) — a failed intro must NOT collapse into a
  // single opaque "Retry Intro": the user needs a distinct, actionable message
  // AND the failure must be observable in the console (no empty swallow). These
  // assertions fail on the pre-fix `catch {}`/bare-throw code, which logged
  // nothing and rendered no message.
  describe("H-1067 — distinct, observable intro failures", () => {
    it("renders a 'too many requests' message and logs on a 429", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch(async () =>
        new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
      );

      render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);
      fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(/try again in a minute/i),
      );
      // Still retryable from the same affordance.
      expect(screen.getByRole("button", { name: "Retry Intro" })).toBeInTheDocument();
      // The swallowed branch must be observable.
      expect(errSpy).toHaveBeenCalled();
      expect(errSpy.mock.calls[0]?.[0]).toContain("[bridge.intro]");
    });

    it("renders a distinct 'permission' message on a 403 (not a generic network error)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch(async () =>
        new Response(JSON.stringify({ error: "Only allocators can request introductions" }), {
          status: 403,
        }),
      );

      render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);
      fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(/don't have permission/i),
      );
      // A 403 must NOT read like a transient server outage.
      expect(screen.queryByText(/couldn't reach the server/i)).toBeNull();
    });

    it("renders a server-unreachable message and logs the thrown error on a network failure", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const thrown = new Error("network down");
      mockFetch(async () => {
        throw thrown;
      });

      render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);
      fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(/couldn't reach the server/i),
      );
      // The thrown error itself must be logged, not silently dropped.
      expect(errSpy).toHaveBeenCalled();
      expect(errSpy.mock.calls.flat()).toContain(thrown);
    });
  });

  it("disables the button and shows 'Requesting...' while the intro request is in flight", async () => {
    // A fetch that never resolves keeps the card in the loading state.
    mockFetch(() => new Promise<Response>(() => {}));

    render(<ReplacementCard candidate={buildCandidate()} replacementFor="old-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Request Intro" }));

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Requesting..." });
      expect(btn).toBeDisabled();
    });
  });
});
