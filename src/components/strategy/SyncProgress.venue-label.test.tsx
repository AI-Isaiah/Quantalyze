/** @vitest-environment jsdom */
/**
 * The "Fetching trades from <venue>" copy names the venue by its display name
 * (`OKX`, `sFOX`, `MT5`), not by its wire code with the first letter raised
 * ("Okx", "Sfox", "Mt5").
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

describe("SyncProgress exchange name", () => {
  it("renders the venue display name in the fetching-trades copy", async () => {
    render(
      <SyncProgress
        strategyId="strat-1"
        syncStatus="syncing"
        lastSyncAt={null}
        syncError={null}
        onRetry={vi.fn()}
      />,
    );
    expect(await screen.findByText("Fetching trades from OKX...")).toBeInTheDocument();
    expect(screen.queryByText(/Okx/)).toBeNull();
  });
});
