/** @vitest-environment jsdom */
/**
 * Phase 212 WIZTRUTH plan 06 (SC6): the panel's error paragraph shows the server's
 * `strategy_analytics.computation_error` text. When that sentence points the user at
 * the contact form, the phrase is a working link to the support topic for THIS
 * strategy. A sentence without the phrase stays plain text.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SyncProgress } from "./SyncProgress";

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: () => {
            if (table === "strategies") {
              return Promise.resolve({ data: { api_key_id: "key-1" }, error: null });
            }
            if (table === "api_keys") {
              return Promise.resolve({ data: { exchange: "okx" }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  }),
}));

afterEach(() => {
  cleanup();
});

function renderError(syncError: string) {
  return render(
    <SyncProgress
      strategyId="strat-1"
      syncStatus="error"
      lastSyncAt={null}
      syncError={syncError}
      onRetry={vi.fn()}
    />,
  );
}

describe("SyncProgress syncError contact pointer", () => {
  it("links 'contact form' in a server sentence to the support topic for this strategy, same tab", () => {
    // Hand-typed (UI-SPEC row 8), as csv-finalize writes it to computation_error.
    renderError(
      "Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists.",
    );
    const link = screen.getByRole("link", { name: "contact form" });
    expect(link.getAttribute("href")).toBe(
      "/contact?topic=support&strategy=strat-1",
    );
    expect(link.getAttribute("target")).toBeNull();
    expect(link.parentElement?.textContent).toBe(
      "Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists.",
    );
  });

  it("renders a syncError without the phrase as plain text with no link", () => {
    renderError("Exchange rejected the key: permission denied.");
    expect(
      screen.getByText("Exchange rejected the key: permission denied."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
