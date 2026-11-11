import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulateImpactButton } from "./SimulateImpactButton";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<SimulateImpactButton>", () => {
  it("renders the Simulate Impact label", () => {
    render(
      <SimulateImpactButton
        candidateStrategyId="c1"
        candidateName="High Sharpe"
        portfolioId="p1"
      />,
    );
    expect(
      screen.getByRole("button", { name: /Simulate impact of adding High Sharpe/i }),
    ).toBeInTheDocument();
  });

  // Phase 201 D-04 / U-22: the button's accessible name and its help speak of the allocation.
  // The help stays button help (what pressing does), not a term definition.
  it("names the allocation in its accessible name", () => {
    render(
      <SimulateImpactButton
        candidateStrategyId="c1"
        candidateName="High Sharpe"
        portfolioId="p1"
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "Simulate impact of adding High Sharpe to your allocation",
      }),
    ).toBeInTheDocument();
  });

  it.each([
    ["p1", "See the impact on your allocation's Sharpe, Max DD and correlation."],
    [null, "Start your allocation first to see the impact of adding this strategy."],
  ])("help text for portfolioId=%s reads the allocation wording", async (portfolioId, help) => {
    render(
      <SimulateImpactButton
        candidateStrategyId="c1"
        candidateName="High Sharpe"
        portfolioId={portfolioId}
      />,
    );
    fireEvent.focus(screen.getByRole("button", { name: /Simulate impact of adding High Sharpe/i }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(help);
  });

  it("is disabled when no portfolio id is provided", () => {
    render(
      <SimulateImpactButton
        candidateStrategyId="c1"
        candidateName="High Sharpe"
        portfolioId={null}
      />,
    );
    const btn = screen.getByRole("button", {
      name: /Simulate impact of adding High Sharpe/i,
    });
    expect(btn).toBeDisabled();
  });

  it("opens the impact panel when clicked", async () => {
    // Prevent the panel's fetch from actually firing — we just need to see
    // the dialog mount.
    // Via stubGlobal, not `globalThis.fetch = …`: a direct assignment is
    // invisible to `unstubGlobals: true` (vitest.config.ts), so this
    // never-resolving mock would outlive the file and hang the next file in
    // the worker that fetches.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})) as unknown as typeof fetch,
    );

    render(
      <SimulateImpactButton
        candidateStrategyId="c1"
        candidateName="High Sharpe"
        portfolioId="p1"
      />,
    );

    const btn = screen.getByRole("button", {
      name: /Simulate impact of adding High Sharpe/i,
    });
    expect(btn).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(btn);

    // aria-expanded flips synchronously on the button…
    expect(btn).toHaveAttribute("aria-expanded", "true");
    // …but the panel is now code-split via next/dynamic (H-1123), so it
    // mounts asynchronously after the lazy chunk resolves — await it.
    // NOTE: this guards the behavioral contract (panel still opens on click),
    // NOT the code-split itself — jsdom can't assert bundle boundaries, so the
    // split is verified at build/bundle-analysis time, not here.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not open the panel when disabled", () => {
    // Via stubGlobal, not `globalThis.fetch = …`: a direct assignment is
    // invisible to `unstubGlobals: true` (vitest.config.ts), so this
    // never-resolving mock would outlive the file and hang the next file in
    // the worker that fetches.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})) as unknown as typeof fetch,
    );

    render(
      <SimulateImpactButton
        candidateStrategyId="c1"
        candidateName="High Sharpe"
        portfolioId={null}
      />,
    );

    const btn = screen.getByRole("button", {
      name: /Simulate impact of adding High Sharpe/i,
    });
    fireEvent.click(btn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
