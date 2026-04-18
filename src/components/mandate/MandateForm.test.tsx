import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MandateForm } from "./MandateForm";
import { MandateSlider } from "./MandateSlider";
import type { AllocatorPreferences } from "@/lib/preferences";

/**
 * Phase 2 — MandateForm component tests + MandateSlider W-09 regression.
 */

function mockFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true }),
    }),
  );
}

const BLANK_PREFS: AllocatorPreferences | null = null;

function populatedPrefs(): AllocatorPreferences {
  return {
    user_id: "00000000-0000-0000-0000-000000000001",
    mandate_archetype: "diversified crypto SMA",
    target_ticket_size_usd: 50000,
    excluded_exchanges: [],
    max_drawdown_tolerance: null,
    min_track_record_days: null,
    min_sharpe: null,
    max_aum_concentration: null,
    preferred_strategy_types: [],
    preferred_markets: null,
    founder_notes: null,
    edited_by_user_id: null,
    updated_at: "2026-04-18T10:00:00Z",
    max_weight: 0.25,
    correlation_ceiling: null,
    liquidity_preference: null,
    style_exclusions: null,
    mandate_edited_at: "2026-04-18T10:00:00Z",
    scoring_weight_overrides: null,
  };
}

describe("MandateForm", () => {
  beforeEach(() => {
    mockFetchOk();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders with initial=null — all fields blank, accordion collapsed, no Reset links", () => {
    render(<MandateForm initial={BLANK_PREFS} />);
    expect(screen.getByText("Basics")).toBeInTheDocument();
    expect(screen.getByLabelText("Max weight per strategy")).toBeInTheDocument();
    expect(screen.getByLabelText("Typical ticket size (USD)")).toHaveValue(null);
    expect(screen.getByLabelText("Mandate in one sentence")).toHaveValue("");

    // Accordion collapsed by default.
    const advTrigger = screen.getByRole("button", { name: "Advanced constraints" });
    expect(advTrigger).toHaveAttribute("aria-expanded", "false");

    // No Reset links visible when all fields are blank.
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();

    // Save status shows "Not saved yet".
    expect(screen.getByTestId("mandate-save-status")).toHaveTextContent("Not saved yet");
  });

  it("renders with initial populated — slider has value pill; Reset links appear", () => {
    render(<MandateForm initial={populatedPrefs()} />);
    // max_weight 0.25 → "25%" pill
    expect(screen.getByText("25%")).toBeInTheDocument();
    // Archetype value populated
    expect(screen.getByLabelText("Mandate in one sentence")).toHaveValue("diversified crypto SMA");
    // Ticket size populated
    expect(screen.getByLabelText("Typical ticket size (USD)")).toHaveValue(50000);
    // Reset buttons appear (for max_weight + ticket size + archetype at minimum)
    expect(screen.getAllByRole("button", { name: "Reset" }).length).toBeGreaterThanOrEqual(3);
  });

  it("clicking Advanced accordion expands the panel", () => {
    render(<MandateForm initial={BLANK_PREFS} />);
    const trigger = screen.getByRole("button", { name: "Advanced constraints" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Correlation ceiling + max drawdown + liquidity + style exclusions now visible.
    expect(screen.getByLabelText("Correlation ceiling")).toBeInTheDocument();
    expect(screen.getByLabelText("Max drawdown tolerance")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Liquidity preference" })).toBeInTheDocument();
    expect(screen.getByText("Excluded styles")).toBeInTheDocument();
  });

  it("excluded_exchanges chip uses negative variant class when selected", () => {
    render(<MandateForm initial={BLANK_PREFS} />);
    // Pick an exchange chip by name.
    const binance = screen.getByRole("checkbox", { name: "Binance" });
    expect(binance).toHaveAttribute("aria-checked", "false");
    // className uses border-border / bg-surface when idle (accent tokens only on selected).
    expect(binance.className).toContain("border-border");
    fireEvent.click(binance);
    // After click, aria-checked=true and the negative variant class is applied.
    expect(binance).toHaveAttribute("aria-checked", "true");
    expect(binance.className).toContain("border-negative");
  });

  it("mandate_archetype char counter reflects length", () => {
    render(<MandateForm initial={BLANK_PREFS} />);
    const textarea = screen.getByLabelText("Mandate in one sentence");
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(screen.getByText("5 / 500")).toBeInTheDocument();
  });

  it("copy strings match UI-SPEC verbatim for Basics + Advanced field labels", () => {
    render(<MandateForm initial={BLANK_PREFS} />);
    // Basics (always visible)
    expect(screen.getByLabelText("Max weight per strategy")).toBeInTheDocument();
    expect(screen.getByText("Preferred strategy types")).toBeInTheDocument();
    expect(screen.getByText("Excluded exchanges")).toBeInTheDocument();
    expect(screen.getByLabelText("Typical ticket size (USD)")).toBeInTheDocument();
    expect(screen.getByLabelText("Mandate in one sentence")).toBeInTheDocument();

    // Expand accordion to reach Advanced labels.
    fireEvent.click(screen.getByRole("button", { name: "Advanced constraints" }));
    expect(screen.getByLabelText("Correlation ceiling")).toBeInTheDocument();
    expect(screen.getByLabelText("Max drawdown tolerance")).toBeInTheDocument();
    expect(screen.getByText("Liquidity preference")).toBeInTheDocument();
    expect(screen.getByText("Excluded styles")).toBeInTheDocument();
  });
});

describe("MandateSlider keyboard debounce (W-09 regression)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rapid arrow-key events fire onCommit exactly once after 300ms (useRef timer persists across re-renders)", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <MandateSlider
        label="Test"
        helper="h"
        value={0.25}
        min={0.05}
        max={0.5}
        step={0.01}
        formatValue={(v) => String(v)}
        onCommit={onCommit}
      />,
    );
    const input = container.querySelector("input[type='range']")!;
    // Fire 3 rapid keyUp events within the 300ms window.
    fireEvent.keyUp(input, { key: "ArrowRight" });
    vi.advanceTimersByTime(50);
    fireEvent.keyUp(input, { key: "ArrowRight" });
    vi.advanceTimersByTime(50);
    fireEvent.keyUp(input, { key: "ArrowRight" });
    // Before the 300ms elapses after the LAST event, no commit.
    expect(onCommit).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(300);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
