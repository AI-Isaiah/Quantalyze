/** @vitest-environment jsdom */
/**
 * Phase 201 plan 18 (D-11): a sync older than a week reads as the one date
 * format (`Oct 9, 2026`), not the browser locale's string; a recent one keeps
 * its relative age.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SyncProgress } from "./SyncProgress";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderComplete(lastSyncAt: string) {
  render(
    <SyncProgress
      strategyId="strat-1"
      syncStatus="complete"
      lastSyncAt={lastSyncAt}
      syncError={null}
      onRetry={vi.fn()}
    />,
  );
}

describe("SyncProgress: Last synced stamp", () => {
  it("prints a sync older than a week through formatDay", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    renderComplete("2026-10-09T08:00:00Z");
    expect(screen.getByText("Last synced Oct 9, 2026")).toBeInTheDocument();
  });

  it("keeps the relative age for a recent sync", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    renderComplete("2026-11-09T12:00:00Z");
    expect(screen.getByText("Last synced 2d ago")).toBeInTheDocument();
  });
});
