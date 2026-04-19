import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MandateSaveStatus } from "./MandateSaveStatus";

/**
 * Regression: G-02 — "Last saved" timestamp did not auto-refresh. The
 * component read `formatRelativeTime(lastSavedAt, now=Date.now())` during
 * render but had no setInterval tick, so it never re-rendered on wall-clock
 * advance and the label stayed stuck at "just now" until the next save or
 * reload. Fix adds a self-tick every `tickIntervalMs` (default 15s) inside
 * MandateSaveStatus. Found by /qa on 2026-04-19.
 * Report: .planning/phases/02-mandate-profile-builder/02-UAT.md (Gap G-02)
 */
describe("MandateSaveStatus relative-time tick (G-02 regression)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances from 'just now' to '1 min ago' after 61s without external re-render", () => {
    const start = Date.UTC(2026, 3, 19, 12, 0, 0);
    vi.setSystemTime(start);
    const lastSavedAt = new Date(start);

    render(
      <MandateSaveStatus
        saveState="idle"
        lastSavedAt={lastSavedAt}
        tickIntervalMs={15_000}
      />,
    );
    expect(screen.getByTestId("mandate-save-status")).toHaveTextContent(
      "Last saved: just now",
    );

    // Advance wall clock past the 60s boundary and let the tick interval fire.
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByTestId("mandate-save-status")).toHaveTextContent(
      "Last saved: 1 min ago",
    );
  });

  it("continues ticking across multiple minute boundaries", () => {
    const start = Date.UTC(2026, 3, 19, 12, 0, 0);
    vi.setSystemTime(start);
    const lastSavedAt = new Date(start);

    render(
      <MandateSaveStatus
        saveState="idle"
        lastSavedAt={lastSavedAt}
        tickIntervalMs={15_000}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(5 * 60_000 + 1_000);
    });
    expect(screen.getByTestId("mandate-save-status")).toHaveTextContent(
      "Last saved: 5 min ago",
    );
  });

  it("does not tick when lastSavedAt is null ('Not saved yet')", () => {
    render(<MandateSaveStatus saveState="idle" lastSavedAt={null} />);
    expect(screen.getByTestId("mandate-save-status")).toHaveTextContent(
      "Not saved yet",
    );
    // Advancing time must not schedule any interval; the label stays put.
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.getByTestId("mandate-save-status")).toHaveTextContent(
      "Not saved yet",
    );
  });

  it("respects fixed `now` prop (test seam) — does not self-tick", () => {
    const start = Date.UTC(2026, 3, 19, 12, 0, 0);
    vi.setSystemTime(start);
    const fixedNow = start + 30 * 60_000; // 30 min ahead
    const lastSavedAt = new Date(start);

    render(
      <MandateSaveStatus
        saveState="idle"
        lastSavedAt={lastSavedAt}
        now={fixedNow}
      />,
    );
    expect(screen.getByTestId("mandate-save-status")).toHaveTextContent(
      "Last saved: 30 min ago",
    );
    // Wall-clock advance must be ignored when `now` is fixed.
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByTestId("mandate-save-status")).toHaveTextContent(
      "Last saved: 30 min ago",
    );
  });
});
