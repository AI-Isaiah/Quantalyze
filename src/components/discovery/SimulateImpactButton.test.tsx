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
    globalThis.fetch = vi.fn(
      () => new Promise(() => {}),
    ) as unknown as typeof fetch;

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
    globalThis.fetch = vi.fn(
      () => new Promise(() => {}),
    ) as unknown as typeof fetch;

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
