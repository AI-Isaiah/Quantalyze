import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ComputeJobsTable } from "./ComputeJobsTable";

/**
 * B7c — ComputeJobsTable auto-refresh preference persistence.
 *
 * The migration off the lazy `localStorage.getItem(KEY) === "true"` useState
 * initializer onto `useCrossTabStorage<boolean>` (deferred hydration, raw
 * "true"/"false" codec) must preserve the contract:
 *   - default OFF when nothing is stored;
 *   - a persisted "true" reads back ON after the deferred mount-load;
 *   - toggling the checkbox persists the new value (byte-compat String(bool)).
 *
 * UI-03 (Phase 50) port (BP-03): the surface now renders through the Button /
 * Table / Field / Select primitives instead of raw <button>/<table>/<select>/
 * <input>. The auto-refresh control stays a checkbox with accessible name
 * "Auto-refresh" (still inside its <label>, unchanged for the byte-compat
 * persistence path), so the three persistence assertions resolve it via the
 * SAME getByRole("checkbox", { name: /auto-refresh/i }) query — no DOM-shape
 * adjustment was needed there. The added render assertions below confirm the
 * jobs render through a real semantic <table> with scope="col" headers (Table
 * base) and that the Load-more control is a <Button> that appears when the page
 * is full (hasMore). These are presentation/DOM-shape checks, not behavior
 * regressions.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

const KEY = "admin-compute-jobs-auto-refresh";

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => lsStore.clear()),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("localStorage", localStorageMock);
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

beforeEach(() => {
  lsStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  // The table fetches the job list on mount; return an empty page so the
  // component settles without network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", localStorageMock);
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    configurable: true,
  });
});

function checkbox(): HTMLInputElement {
  return screen.getByRole("checkbox", { name: /auto-refresh/i }) as HTMLInputElement;
}

describe("ComputeJobsTable — auto-refresh persistence", () => {
  it("defaults OFF when nothing is stored", async () => {
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    expect(checkbox().checked).toBe(false);
  });

  it("reads a persisted 'true' as ON after deferred hydration", async () => {
    lsStore.set(KEY, "true");
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    // Deferred hydration loads the persisted value post-mount.
    await waitFor(() => expect(checkbox().checked).toBe(true));
  });

  it("toggling the checkbox persists the new value (byte-compat String(bool))", async () => {
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    expect(checkbox().checked).toBe(false);
    await act(async () => {
      fireEvent.click(checkbox());
    });
    await waitFor(() => expect(checkbox().checked).toBe(true));
    // The primitive's persist is debounced (default 150ms); await the flush.
    await waitFor(() => expect(lsStore.get(KEY)).toBe("true"));
    // Toggle back off.
    await act(async () => {
      fireEvent.click(checkbox());
    });
    await waitFor(() => expect(checkbox().checked).toBe(false));
    await waitFor(() => expect(lsStore.get(KEY)).toBe("false"));
  });
});

// A full page (length === 50) makes the component set hasMore=true so the
// Load-more <Button> renders.
function fullPage(): unknown[] {
  return Array.from({ length: 50 }, (_, i) => ({
    id: `job-${i}`,
    strategy_id: `strat-${i}`,
    portfolio_id: null,
    strategy_name: null,
    portfolio_name: null,
    kind: "sync_trades",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    last_error: null,
    error_kind: null,
    exchange: "binance",
    trade_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

describe("ComputeJobsTable — primitive DOM (UI-03 port)", () => {
  it("renders jobs through a real <table> with scope=col headers (Table base)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => fullPage(),
      })) as unknown as typeof fetch,
    );

    await act(async () => {
      render(<ComputeJobsTable />);
    });

    // Semantic table (Table base renders a real <table>, never a div+role).
    const table = await screen.findByRole("table", { name: /compute jobs/i });
    expect(table.tagName).toBe("TABLE");

    // Column headers are <th scope="col"> (Table base TableHeaderCell default).
    const kindHeader = screen.getByRole("columnheader", { name: "Kind" });
    expect(kindHeader.tagName).toBe("TH");
    expect(kindHeader.getAttribute("scope")).toBe("col");
    expect(
      screen.getByRole("columnheader", { name: "Last Error" }).getAttribute("scope"),
    ).toBe("col");
  });

  it("renders the Load-more Button when the page is full (hasMore)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => fullPage(),
      })) as unknown as typeof fetch,
    );

    await act(async () => {
      render(<ComputeJobsTable />);
    });

    const loadMore = await screen.findByRole("button", { name: /load more/i });
    expect(loadMore.tagName).toBe("BUTTON");
  });
});
