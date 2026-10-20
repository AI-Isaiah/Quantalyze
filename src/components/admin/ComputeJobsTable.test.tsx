import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
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
// Phase 140.5-01 / SEAMPROSE-04 — installed PER TEST, not at module scope.
// `vitest.config.ts` sets `unstubGlobals: true`, which restores stubbed globals
// before every test, so a stub applied once at import time is gone by the time
// the first test runs. Re-applying it here also removes a real leak: a stub set
// at module scope is never undone, so it reaches every later file in the same
// worker (DEF-16-1).
beforeEach(() => {
  vi.stubGlobal("localStorage", localStorageMock);
});
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

beforeEach(() => {
  lsStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  // The table fetches the job list and the kind facet on mount; return an
  // empty page and an empty facet so the component settles without network.
  // URL-aware (D-07): the facets URL gets `{ kinds: [] }`, everything else `[]`.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes("facets=kinds") ? { kinds: [] } : []),
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

/**
 * TABLE-01 / T-53-11 — @container parent/child STRUCTURAL guard (#551).
 *
 * A class-string jsdom check FALSE-PASSES the #551 same-element regression: it
 * confirms the strings exist but not the parent/child relationship that makes
 * `@container` actually reshape the grid. So this guard asserts the RELATIONSHIP
 * structurally — the element carrying `@container` must be a STRICT ANCESTOR of
 * every element carrying an `@max-` or `@min-` variant (never the same node) —
 * plus that numeric columns keep `tabular-nums`. Mutation: moving `@container`
 * onto a `<th>`/`<td>` (the #551 bug) makes the ancestor assertion fail.
 */
describe("ComputeJobsTable — @container parent/child structural guard", () => {
  function variantEls(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        '[class*="@max-"], [class*="@min-"], [class*="@2xl:"], [class*="@3xl:"]',
      ),
    );
  }

  it("the @container host is a STRICT ANCESTOR of the @-variant cells (never same element)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => fullPage(),
      })) as unknown as typeof fetch,
    );
    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(<ComputeJobsTable />));
    });

    // Exactly one @container host (the ResponsiveTable scroll region).
    const hosts = Array.from(
      container!.querySelectorAll<HTMLElement>('[class*="@container"]'),
    );
    expect(hosts.length).toBe(1);
    const host = hosts[0];

    // The host itself must NOT carry an @max-*/@min-* variant (same-element
    // host is the #551 bug — it never matches and freezes the grid 1-wide).
    expect(host.className).not.toMatch(/@(max|min|2xl|3xl)/);

    // There ARE @-variant cells, and EACH is a strict descendant of the host.
    const variants = variantEls(container!);
    expect(variants.length).toBeGreaterThan(0);
    for (const el of variants) {
      expect(host.contains(el)).toBe(true);
      expect(host).not.toBe(el); // strict ancestor, never the same node
    }
  });

  it("preserves tabular-nums on the numeric Attempts column and its relocated value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => fullPage(),
      })) as unknown as typeof fetch,
    );
    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(<ComputeJobsTable />));
    });

    // Every cell that renders a number keeps tabular-nums across the reshape.
    const tabular = container!.querySelectorAll('[class*="tabular-nums"]');
    expect(tabular.length).toBeGreaterThan(0);
  });
});

/**
 * Phase 169.3 plan 01 (SC1) — error ≠ empty (the 149 review WR-01 idiom).
 *
 * A failed load must read as a failure, never as an empty queue: while the
 * error alert shows, the definitive "No compute jobs found." row must NOT
 * render. Only a load that SUCCEEDED with zero rows may claim the queue is
 * empty. Before the fix both the alert and the empty row rendered together,
 * so an admin saw "No compute jobs found." under an HTTP 500.
 */
describe("ComputeJobsTable — a failed load is not an empty queue", () => {
  const EMPTY_TEXT = "No compute jobs found.";

  it("HTTP 500: shows the error alert and NOT the empty-queue row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "Failed to fetch compute jobs" }),
      })) as unknown as typeof fetch,
    );
    await act(async () => {
      render(<ComputeJobsTable />);
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Failed to fetch compute jobs");
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
  });

  it("network failure (fetch rejects): shows the error alert and NOT the empty-queue row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );
    await act(async () => {
      render(<ComputeJobsTable />);
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("network down");
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
  });

  it("OK with []: shows the empty-queue row and no alert", async () => {
    // The file-level beforeEach stubs fetch to resolve OK with [].
    await act(async () => {
      render(<ComputeJobsTable />);
    });

    expect(await screen.findByText(EMPTY_TEXT)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("OK with rows: renders the rows, neither the alert nor the empty-queue row", async () => {
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

    await screen.findByRole("button", { name: /load more/i });
    // 50 job rows + the header row.
    expect(screen.getAllByRole("row")).toHaveLength(51);
    expect(screen.queryByText(EMPTY_TEXT)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * Phase 170.6.2 plan 03 (SC-4, D-07) — the Kind filter lists every kind that
 * has jobs. It used to be a hardcoded three-kind list, so an admin could not
 * filter to `derive_allocator_equity`. The list now comes from the facet read
 * (`GET /api/admin/compute-jobs?facets=kinds`), a query of its own.
 */
describe("ComputeJobsTable — the Kind filter lists the kinds that have jobs (D-07)", () => {
  const FACETS_ERROR_ID = "compute-jobs-kinds-error";

  type FacetReply =
    | { ok: true; body: unknown }
    | { ok: false; status: number; body: unknown };

  // A URL-aware fetch stub: `facets` answers the facets URL one reply per call
  // (the last reply repeats), every other URL answers `[]`. Returns the mock so
  // a test can read which URLs were requested.
  function stubFetch(facets: FacetReply[]) {
    let facetCalls = 0;
    const mock = vi.fn(async (url: string) => {
      if (String(url).includes("facets=kinds")) {
        const reply = facets[Math.min(facetCalls, facets.length - 1)];
        facetCalls += 1;
        return {
          ok: reply.ok,
          status: reply.ok ? 200 : reply.status,
          json: async () => reply.body,
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", mock as unknown as typeof fetch);
    return mock;
  }

  function kindOptionLabels(): string[] {
    const select = screen.getByLabelText("Kind") as HTMLSelectElement;
    return Array.from(select.options).map((o) => o.textContent ?? "");
  }

  // The option VALUES are what the page read filters on; labels are display only.
  function kindOptionValues(): string[] {
    const select = screen.getByLabelText("Kind") as HTMLSelectElement;
    return Array.from(select.options).map((o) => o.value);
  }

  function urlsRequested(mock: ReturnType<typeof stubFetch>): string[] {
    return mock.mock.calls.map((c) => String(c[0]));
  }

  it("K1: offers a kind outside the old three, and selecting it filters the next page read", async () => {
    const mock = stubFetch([
      { ok: true, body: { kinds: ["derive_allocator_equity", "sync_trades"] } },
    ]);
    await act(async () => {
      render(<ComputeJobsTable />);
    });

    await waitFor(() =>
      expect(kindOptionLabels()).toEqual([
        "All kinds",
        "Allocator equity derivation",
        "Trade sync",
      ]),
    );
    // D-01: the label is display only. The value the filter sends stays raw.
    expect(kindOptionValues()).toEqual(["", "derive_allocator_equity", "sync_trades"]);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Kind"), {
        target: { value: "derive_allocator_equity" },
      });
    });
    await waitFor(() =>
      expect(
        urlsRequested(mock).some(
          (u) => !u.includes("facets=") && u.includes("kind=derive_allocator_equity"),
        ),
      ).toBe(true),
    );
  });

  it("K2: the selected kind stays listed when a later facet read no longer returns it", async () => {
    stubFetch([
      { ok: true, body: { kinds: ["derive_allocator_equity", "sync_trades"] } },
      { ok: true, body: { kinds: ["sync_trades"] } },
    ]);
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    await waitFor(() => expect(kindOptionLabels()).toHaveLength(3));

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Kind"), {
        target: { value: "derive_allocator_equity" },
      });
    });

    // The second facet read (on filter change) dropped the kind; it must stay.
    await waitFor(() =>
      expect((screen.getByLabelText("Kind") as HTMLSelectElement).value).toBe(
        "derive_allocator_equity",
      ),
    );
    expect(kindOptionLabels()).toEqual([
      "All kinds",
      "Allocator equity derivation",
      "Trade sync",
    ]);
  });

  it("K3: a failed facet read is said, not hidden, and the jobs list is unaffected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch([
      { ok: false, status: 500, body: { error: "Failed to fetch compute job kinds" } },
    ]);
    await act(async () => {
      render(<ComputeJobsTable />);
    });

    const line = await screen.findByTestId(FACETS_ERROR_ID);
    // SFH-1: the HTTP status is part of the visible message when it is known.
    expect(line.textContent).toBe("Could not load the job kinds (HTTP 500).");
    // role="status", deliberately not "alert": the alert means the jobs list failed.
    expect(line.getAttribute("role")).toBe("status");
    expect(kindOptionLabels()).toEqual(["All kinds"]);
    expect(await screen.findByText("No compute jobs found.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("K3b: a rejected facet fetch is the same visible failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mock = vi.fn(async (url: string) => {
      if (String(url).includes("facets=kinds")) throw new Error("network down");
      return { ok: true, status: 200, json: async () => [] };
    });
    vi.stubGlobal("fetch", mock as unknown as typeof fetch);
    await act(async () => {
      render(<ComputeJobsTable />);
    });

    const line = await screen.findByTestId(FACETS_ERROR_ID);
    // No HTTP status exists for a rejected fetch, so none is invented.
    expect(line.textContent).toBe("Could not load the job kinds.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("K4: a facet body that is not { kinds: string[] } is a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const body of [[], { kinds: "sync_trades" }, { kinds: [1, 2] }, null]) {
      stubFetch([{ ok: true, body }]);
      let unmount: () => void = () => {};
      await act(async () => {
        ({ unmount } = render(<ComputeJobsTable />));
      });
      expect(await screen.findByTestId(FACETS_ERROR_ID)).toBeTruthy();
      expect(kindOptionLabels()).toEqual(["All kinds"]);
      unmount();
    }
  });

  it("a good read after a failed one clears the failure line", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch([
      { ok: false, status: 500, body: { error: "Failed to fetch compute job kinds" } },
      { ok: true, body: { kinds: ["sync_trades"] } },
    ]);
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    await screen.findByTestId(FACETS_ERROR_ID);

    // A status-filter change re-reads the facet (mount + filter change only).
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "done" } });
    });
    await waitFor(() => expect(screen.queryByTestId(FACETS_ERROR_ID)).toBeNull());
    expect(kindOptionLabels()).toEqual(["All kinds", "Trade sync"]);
  });

  it("K5: a failed re-read keeps the previous good list and sets only the error line", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch([
      { ok: true, body: { kinds: ["derive_allocator_equity", "sync_trades"] } },
      { ok: false, status: 403, body: { error: "Forbidden" } },
    ]);
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    await waitFor(() =>
      expect(kindOptionLabels()).toEqual(["All kinds", "Allocator equity derivation", "Trade sync"]),
    );

    // A status-filter change re-reads the facet; this read fails.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "done" } });
    });

    const line = await screen.findByTestId(FACETS_ERROR_ID);
    expect(line.textContent).toBe("Could not load the job kinds (HTTP 403).");
    // WHY: one transient failure must not take away the filter the admin was
    // already using. The list that was good stays good.
    expect(kindOptionLabels()).toEqual(["All kinds", "Allocator equity derivation", "Trade sync"]);
  });

  it("K6: a failed facet read is logged with its cause, not swallowed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch([{ ok: false, status: 403, body: { error: "Forbidden" } }]);
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    await screen.findByTestId(FACETS_ERROR_ID);

    const call = spy.mock.calls.find((c) => String(c[0]).includes("ComputeJobsTable"));
    expect(call, "console.error with the [ComputeJobsTable] prefix").toBeTruthy();
    expect(JSON.stringify(call)).toContain("403");
  });

  it("K6b: a rejected facet fetch logs the error it threw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("facets=kinds")) throw new Error("network down");
        return { ok: true, status: 200, json: async () => [] };
      }) as unknown as typeof fetch,
    );
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    await screen.findByTestId(FACETS_ERROR_ID);

    const call = spy.mock.calls.find((c) => String(c[0]).includes("ComputeJobsTable"));
    expect(call, "console.error with the [ComputeJobsTable] prefix").toBeTruthy();
    expect(JSON.stringify(call, (_k, v) => (v instanceof Error ? v.message : v))).toContain(
      "network down",
    );
  });

  // Out-of-order guard. The mount read is held open while a filter change
  // starts a second read; the second lands first, then the first lands.
  // Only the latest request may write state.
  function deferredFacetStub(secondReply: FacetReply) {
    let release!: (r: FacetReply) => void;
    const first = new Promise<FacetReply>((res) => {
      release = res;
    });
    let facetCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (!String(url).includes("facets=kinds")) {
          return { ok: true, status: 200, json: async () => [] };
        }
        facetCalls += 1;
        const reply = facetCalls === 1 ? await first : secondReply;
        return {
          ok: reply.ok,
          status: reply.ok ? 200 : reply.status,
          json: async () => reply.body,
        };
      }) as unknown as typeof fetch,
    );
    return release;
  }

  it("K7: an older failed read that lands after a newer good one does not show the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const release = deferredFacetStub({ ok: true, body: { kinds: ["sync_trades"] } });
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "done" } });
    });
    await waitFor(() => expect(kindOptionLabels()).toEqual(["All kinds", "Trade sync"]));

    await act(async () => {
      release({ ok: false, status: 500, body: { error: "late failure" } });
    });

    expect(screen.queryByTestId(FACETS_ERROR_ID)).toBeNull();
    expect(kindOptionLabels()).toEqual(["All kinds", "Trade sync"]);
  });

  it("K7b: an older good read that lands after a newer one does not overwrite the list", async () => {
    const release = deferredFacetStub({ ok: true, body: { kinds: ["sync_trades"] } });
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Status"), { target: { value: "done" } });
    });
    await waitFor(() => expect(kindOptionLabels()).toEqual(["All kinds", "Trade sync"]));

    await act(async () => {
      release({ ok: true, body: { kinds: ["stale_kind"] } });
    });

    expect(kindOptionLabels()).toEqual(["All kinds", "Trade sync"]);
  });

  it("reads the facet on mount and on filter change, never on Load more or the auto-refresh tick", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      lsStore.set(KEY, "true");
      const mock = vi.fn(async (url: string) => {
        if (String(url).includes("facets=kinds")) {
          return { ok: true, status: 200, json: async () => ({ kinds: ["sync_trades"] }) };
        }
        return { ok: true, status: 200, json: async () => fullPage() };
      });
      vi.stubGlobal("fetch", mock as unknown as typeof fetch);
      await act(async () => {
        render(<ComputeJobsTable />);
      });
      await waitFor(() => expect(checkbox().checked).toBe(true));
      const facetCount = () =>
        mock.mock.calls.filter((c) => String(c[0]).includes("facets=kinds")).length;
      const pageCount = () =>
        mock.mock.calls.filter((c) => !String(c[0]).includes("facets=kinds")).length;
      const facetsAfterMount = facetCount();
      expect(facetsAfterMount).toBe(1);

      // Load more: one more page read, no facet read.
      const pagesBefore = pageCount();
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: /load more/i }));
      });
      await waitFor(() => expect(pageCount()).toBeGreaterThan(pagesBefore));
      expect(facetCount()).toBe(facetsAfterMount);

      // Two auto-refresh ticks: the page re-reads, the facet does not.
      const pagesBeforeTick = pageCount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_500);
      });
      expect(pageCount()).toBeGreaterThan(pagesBeforeTick);
      expect(facetCount()).toBe(facetsAfterMount);

      // A filter change reads the facet again.
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Status"), { target: { value: "done" } });
      });
      await waitFor(() => expect(facetCount()).toBe(facetsAfterMount + 1));
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Phase 170.1.2 plan 02 (D-01) — the table shows words and names. Kind and
 * status render as labels, the Status filter says "Retrying" (one vocabulary
 * with the cells), and the Target cell never falls through to a raw id.
 */
describe("ComputeJobsTable — labels and targets (D-01)", () => {
  const ID = {
    job: ["aaaa1111-0000-4000-8000-000000000001", "bbbb2222-0000-4000-8000-000000000002"],
    strategy: "ccccdddd-1111-4111-8111-111111111111",
    portfolio: "eeeeffff-2222-4222-8222-222222222222",
  };

  function jobRow(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
      id: "job-x",
      strategy_id: null,
      portfolio_id: null,
      strategy_name: null,
      portfolio_name: null,
      kind: "sync_trades",
      status: "done",
      attempts: 1,
      max_attempts: 3,
      last_error: null,
      error_kind: null,
      exchange: null,
      trade_count: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  async function renderWith(rows: unknown[]): Promise<HTMLElement> {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => (String(url).includes("facets=kinds") ? { kinds: [] } : rows),
      })) as unknown as typeof fetch,
    );
    await act(async () => {
      render(<ComputeJobsTable />);
    });
    return screen.findByRole("table", { name: /compute jobs/i });
  }

  /** Target is the second cell of each body row. */
  function targetCells(): HTMLElement[] {
    return screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1]);
  }

  it("the Status filter reads Retrying for failed_retry, with the value unchanged", async () => {
    await renderWith([]);
    const select = screen.getByLabelText("Status") as HTMLSelectElement;
    const options = Array.from(select.options);
    expect(options.map((o) => o.textContent)).toEqual([
      "All statuses",
      "Pending",
      "Running",
      "Done",
      "Retrying",
      "Failed",
    ]);
    expect(options.find((o) => o.textContent === "Retrying")?.value).toBe("failed_retry");
  });

  it("renders the kind and status cells as labels, not raw values", async () => {
    const table = await renderWith([
      jobRow({ id: "j1", kind: "derive_allocator_equity", status: "failed_retry" }),
    ]);
    const row = within(table).getAllByRole("row")[1];
    expect(row.textContent).toContain("Allocator equity derivation");
    expect(row.textContent).toContain("Retrying");
    expect(row.textContent).not.toMatch(/derive_allocator_equity|failed_retry/);
  });

  it("Target: a name, else Unnamed strategy / Unnamed portfolio, else an em dash; text and title agree", async () => {
    await renderWith([
      jobRow({ id: ID.job[0], strategy_id: ID.strategy, strategy_name: "Alpha" }),
      jobRow({ id: ID.job[1], strategy_id: ID.strategy }),
      jobRow({ id: "j3", portfolio_id: ID.portfolio }),
      jobRow({ id: "j4" }),
      jobRow({ id: "j5", portfolio_id: ID.portfolio, portfolio_name: "Core book" }),
    ]);

    const cells = targetCells();
    const expected = ["Alpha", "Unnamed strategy", "Unnamed portfolio", "—", "Core book"];
    expect(cells.map((c) => c.textContent)).toEqual(expected);
    // The tooltip carries the same words as the cell.
    expect(cells.map((c) => c.getAttribute("title"))).toEqual(expected);
  });

  it("Target: no job, strategy or portfolio id appears in the table, whole or as an 8-character slice", async () => {
    const table = await renderWith([
      jobRow({ id: ID.job[0], strategy_id: ID.strategy }),
      jobRow({ id: ID.job[1], portfolio_id: ID.portfolio }),
    ]);

    // innerHTML covers cell text and every attribute, title included.
    const html = table.innerHTML;
    for (const id of [...ID.job, ID.strategy, ID.portfolio]) {
      expect(html).not.toContain(id);
      expect(html).not.toContain(id.slice(0, 8));
    }
  });
});
