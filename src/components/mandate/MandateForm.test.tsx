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

  it("sliders expose aria-label for automated accessibility scanners (QA 2026-04-19)", () => {
    // The visible <label htmlFor> already associates the name, but some a11y
    // scanners only read attributes on the input itself. aria-label on the
    // range input is redundant with the label but satisfies those checks.
    render(<MandateForm initial={BLANK_PREFS} />);
    const maxWeight = screen.getByRole("slider", { name: "Max weight per strategy" });
    expect(maxWeight).toHaveAttribute("aria-label", "Max weight per strategy");
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
    expect(screen.getByRole("radiogroup", { name: "Minimum AUM" })).toBeInTheDocument();
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

  // Regression: style_exclusions was shipped with variant="accent" so the
  // selected chips rendered GREEN, identical to preferred_strategy_types
  // (a positive preference). Users expected red to signal "excluded" — the
  // same color treatment as excluded_exchanges. Fix flips the variant to
  // "negative". Reported 2026-04-19.
  it("style_exclusions chip uses negative variant class when selected (parity with excluded_exchanges)", () => {
    render(<MandateForm initial={BLANK_PREFS} />);
    // Expand Advanced to mount the style_exclusions chips.
    fireEvent.click(screen.getByRole("button", { name: "Advanced constraints" }));
    const trend = screen.getByRole("checkbox", { name: "Trend Following" });
    expect(trend.className).toContain("border-border");
    fireEvent.click(trend);
    expect(trend).toHaveAttribute("aria-checked", "true");
    // The critical assertion: same negative styling as excluded_exchanges,
    // NOT the accent (green) styling of preferred_strategy_types.
    expect(trend.className).toContain("border-negative");
    expect(trend.className).not.toContain("border-accent");
  });

  it("preferred_strategy_types chip stays accent (positive preference, not exclusion)", () => {
    render(<MandateForm initial={BLANK_PREFS} />);
    const longOnly = screen.getByRole("checkbox", { name: "Long-Only" });
    fireEvent.click(longOnly);
    expect(longOnly).toHaveAttribute("aria-checked", "true");
    expect(longOnly.className).toContain("border-accent");
    expect(longOnly.className).not.toContain("border-negative");
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
    // Phase 09.1 PR1 — field renamed from "Liquidity preference" to "Minimum AUM"
    // (underlying enum unchanged; option labels relabeled to dollar tiers).
    expect(screen.getByText("Minimum AUM")).toBeInTheDocument();
    expect(screen.getByText("Excluded styles")).toBeInTheDocument();
  });

  // Regression: G-01 — chip toggle handlers closed over stale React state,
  // so rapid successive clicks each read the same initial snapshot and each
  // save overwrote the previous. Fix uses ref-backed latest-value pattern
  // in MandateForm.tsx. Found by /qa on 2026-04-19.
  // Report: .planning/phases/02-mandate-profile-builder/02-UAT.md (Gap G-01)
  it("rapid successive preferred_strategy_types clicks send cumulative values (not overwrite)", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MandateForm initial={BLANK_PREFS} />);
    const longOnly = screen.getByRole("checkbox", { name: "Long-Only" });
    const marketNeutral = screen.getByRole("checkbox", { name: "Market Neutral" });

    // Fire synchronously — simulates two clicks within a single React batch
    // (before any re-render commits). With the stale-closure bug, the second
    // click would read `preferredTypes = []` and send `["Market Neutral"]`
    // alone, overwriting the first save.
    fireEvent.click(longOnly);
    fireEvent.click(marketNeutral);

    // Both saves must be POSTed — and the second must carry both values.
    const bodies = fetchMock.mock.calls
      .filter((c) => c[0] === "/api/preferences")
      .map((c) => JSON.parse(c[1].body as string));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual({ preferred_strategy_types: ["Long-Only"] });
    expect(bodies[1]).toEqual({
      preferred_strategy_types: ["Long-Only", "Market Neutral"],
    });
    expect(longOnly).toHaveAttribute("aria-checked", "true");
    expect(marketNeutral).toHaveAttribute("aria-checked", "true");
  });

  it("rapid successive excluded_exchanges clicks send cumulative values (not overwrite)", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MandateForm initial={BLANK_PREFS} />);
    const binance = screen.getByRole("checkbox", { name: "Binance" });
    const okx = screen.getByRole("checkbox", { name: "OKX" });

    fireEvent.click(binance);
    fireEvent.click(okx);

    const bodies = fetchMock.mock.calls
      .filter((c) => c[0] === "/api/preferences")
      .map((c) => JSON.parse(c[1].body as string));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual({ excluded_exchanges: ["Binance"] });
    expect(bodies[1]).toEqual({ excluded_exchanges: ["Binance", "OKX"] });
  });

  it("rapid successive style_exclusions clicks send cumulative values (not overwrite)", () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MandateForm initial={BLANK_PREFS} />);
    // Expand Advanced to reach style_exclusions chips.
    fireEvent.click(screen.getByRole("button", { name: "Advanced constraints" }));
    const trend = screen.getByRole("checkbox", { name: "Trend Following" });
    const momentum = screen.getByRole("checkbox", { name: "Momentum" });

    fireEvent.click(trend);
    fireEvent.click(momentum);

    const bodies = fetchMock.mock.calls
      .filter((c) => c[0] === "/api/preferences")
      .map((c) => JSON.parse(c[1].body as string));
    expect(bodies).toHaveLength(2);
    expect(bodies[0].style_exclusions).toEqual(["Trend Following"]);
    expect(bodies[1].style_exclusions).toEqual(["Trend Following", "Momentum"]);
  });

  // M-0420 (audit-2026-05-07) — document the NO-DEBOUNCE contract for chip
  // toggles. The "rapid successive clicks" tests above assert two immediate
  // POSTs without advancing any timer, silently locking in the assumption
  // that chip toggles bypass useMandateAutoSave's debounce. This test makes
  // that contract explicit: under fake timers, a single chip toggle must
  // fire its POST WITHOUT any timer advancement. If a future change adds a
  // debounce window to chip toggles (sensible UX), this test fails loudly
  // and on purpose — forcing the contract change to be deliberate rather
  // than a silent break of the cumulative-save tests.
  it("M-0420: chip toggle POSTs synchronously — no debounce window (contract)", () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true }),
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<MandateForm initial={BLANK_PREFS} />);
      const longOnly = screen.getByRole("checkbox", { name: "Long-Only" });

      fireEvent.click(longOnly);

      // The POST must already have been issued — BEFORE any timer advances.
      // If chip saves were debounced, the fetch would still be queued behind
      // a setTimeout and this assertion would be 0.
      const immediateCalls = fetchMock.mock.calls.filter(
        (c) => c[0] === "/api/preferences",
      );
      expect(immediateCalls).toHaveLength(1);
      expect(JSON.parse(immediateCalls[0][1].body as string)).toEqual({
        preferred_strategy_types: ["Long-Only"],
      });

      // Advancing timers issues NO additional POST — there is no trailing
      // debounced save to flush.
      vi.advanceTimersByTime(5000);
      expect(
        fetchMock.mock.calls.filter((c) => c[0] === "/api/preferences"),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
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

/**
 * Regression: controlled-input drag — the slider used
 *   <input value={renderValue} onChange={() => {}}>
 * which made the native range input behave as read-only in React 19. The
 * DOM reset the thumb on every drag/arrow event, so users believed the
 * slider was broken ("max weight per strategy cannot be changed" — 2026-04-19
 * bug report). Fix decoupled local draft state from parent state so drag
 * updates the DOM live, commits flow on pointerUp / touchEnd / keyUp.
 */
describe("MandateSlider drag-responsiveness (controlled-input regression)", () => {
  it("user input changes the rendered value and pill (not frozen on parent prop)", () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(
      <MandateSlider
        label="Max weight per strategy"
        helper="h"
        value={0.28}
        min={0.05}
        max={0.5}
        step={0.01}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onCommit={onCommit}
      />,
    );
    const input = container.querySelector("input[type='range']") as HTMLInputElement;
    expect(input.value).toBe("0.28");
    // Simulate a drag step: native input dispatches `change` with the new value.
    fireEvent.change(input, { target: { value: "0.15" } });
    // The DOM must reflect the user's input — NOT snap back to the parent prop.
    expect(input.value).toBe("0.15");
    // Before pointerUp, parent has not been notified (no commit yet).
    expect(onCommit).toHaveBeenCalledTimes(0);
    // Commit via pointerUp.
    fireEvent.pointerUp(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(0.15);
    // When the parent acknowledges the commit and re-renders with the new
    // value, the slider continues to display the committed value.
    rerender(
      <MandateSlider
        label="Max weight per strategy"
        helper="h"
        value={0.15}
        min={0.05}
        max={0.5}
        step={0.01}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onCommit={onCommit}
      />,
    );
    expect(input.value).toBe("0.15");
  });

  it("external prop change syncs to the draft (Reset resets the thumb position)", () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(
      <MandateSlider
        label="Max weight per strategy"
        helper="h"
        value={0.4}
        min={0.05}
        max={0.5}
        step={0.01}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onCommit={onCommit}
      />,
    );
    const input = container.querySelector("input[type='range']") as HTMLInputElement;
    expect(input.value).toBe("0.4");
    // User drags to 0.1 but parent resets to null before commit (Reset pressed
    // mid-drag, or external update).
    fireEvent.change(input, { target: { value: "0.1" } });
    expect(input.value).toBe("0.1");
    rerender(
      <MandateSlider
        label="Max weight per strategy"
        helper="h"
        value={null}
        min={0.05}
        max={0.5}
        step={0.01}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onCommit={onCommit}
      />,
    );
    // renderValue falls back to midpoint ((0.05+0.5)/2 = 0.275); draft syncs.
    expect(input.value).toBe("0.275");
  });
});
