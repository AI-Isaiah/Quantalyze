import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

/**
 * Phase 14b / KPI-22 + KPI-07 — useLazyPanelMetrics real-fetch path tests.
 *
 * Test plan (9 cases):
 *  1. Idle → ready transition (no fetch when fetchOnIntersect=false / opts omitted)
 *  2. Fetch path success — idle → loading → ready, panel-id mapped via PANEL_TO_ID
 *  3. Fetch path error — idle → loading → error, console.error invoked
 *  4. Panel-id mapping — panel4..panel7 → returns_dist / rolling / trades / exposure
 *  5. Memoization — fetch fires exactly once across re-renders
 *  6. Unobserve on first intersection — second intersection does not retrigger fetch
 *  7. Missing strategyId guard — fetchOnIntersect=true without strategyId stays idle
 *  8. Cleanup on unmount (Grok I-01) — observer.disconnect() called on unmount
 *  9. Cleanup after fetch resolves — unmount post-fetch does not throw
 *
 * Test isolation strategy: each test installs its OWN IntersectionObserver
 * stub on `globalThis.IntersectionObserver` that captures the callback +
 * observed nodes so the test can synthetically trigger an intersection. The
 * test-setup.ts global stub is overridden via direct assignment and restored
 * in afterEach.
 */

interface CapturedObserver {
  cb: IntersectionObserverCallback;
  observed: Element[];
  disconnectCalls: number;
  unobserveCalls: Element[];
}

const observers: CapturedObserver[] = [];
let originalIO: typeof IntersectionObserver | undefined;

function installObserverStub() {
  observers.length = 0;
  originalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
    .IntersectionObserver;

  class CapturingStub {
    private record: CapturedObserver;
    constructor(cb: IntersectionObserverCallback) {
      this.record = {
        cb,
        observed: [],
        disconnectCalls: 0,
        unobserveCalls: [],
      };
      observers.push(this.record);
    }
    observe(el: Element) {
      this.record.observed.push(el);
    }
    unobserve(el: Element) {
      this.record.unobserveCalls.push(el);
      this.record.observed = this.record.observed.filter((n) => n !== el);
    }
    disconnect() {
      this.record.disconnectCalls += 1;
      this.record.observed = [];
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
  }

  (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
    CapturingStub as unknown as typeof IntersectionObserver;
}

function restoreObserverStub() {
  if (originalIO) {
    (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
      originalIO;
  }
  observers.length = 0;
}

function fireIntersection(observer: CapturedObserver, target: Element) {
  // Mirror real IntersectionObserver semantics: an unobserved target
  // produces no entries. Without this the test stub would synthetically
  // re-fire after `observer.unobserve(target)` and break the once-only
  // memoization contract.
  if (!observer.observed.includes(target)) return;
  const entry: Partial<IntersectionObserverEntry> = {
    isIntersecting: true,
    target,
  };
  act(() => {
    observer.cb([entry as IntersectionObserverEntry], observer as unknown as IntersectionObserver);
  });
}

const fetchSpy = vi.fn();
vi.mock("@/lib/queries-client", () => ({
  fetchStrategyLazyMetricsClient: (...args: unknown[]) => fetchSpy(...args),
}));

let useLazyPanelMetrics: typeof import("./useLazyPanelMetrics").useLazyPanelMetrics;
beforeEach(async () => {
  installObserverStub();
  fetchSpy.mockReset();
  // Re-import lazily so the hook's import binding is fresh under the mock
  ({ useLazyPanelMetrics } = await import("./useLazyPanelMetrics"));
});

afterEach(() => {
  restoreObserverStub();
  vi.restoreAllMocks();
});

describe("useLazyPanelMetrics — Phase 14b extension", () => {
  it("Test 1: idle → ready, no fetch when fetchOnIntersect is omitted", () => {
    const { result } = renderHook(() => useLazyPanelMetrics("panel4"));
    expect(result.current.status).toBe("idle");

    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    expect(observers).toHaveLength(1);

    fireIntersection(observers[0], node);
    expect(result.current.status).toBe("ready");
    expect(result.current.data).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Test 2: fetch path success — status idle → loading → ready, data populated", async () => {
    const payload = { daily_returns_grid: { rows: [] } };
    fetchSpy.mockResolvedValueOnce(payload);

    const { result } = renderHook(() =>
      useLazyPanelMetrics("panel4", { fetchOnIntersect: true, strategyId: "abc" }),
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    fireIntersection(observers[0], node);

    // Dynamic import resolves on a microtask after intersection — drain it
    // before asserting the fetch was called.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledWith("abc", "returns_dist");

    // Drain again for the fetch's resolved-promise chain.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.data).toEqual(payload);
  });

  it("Test 3: fetch path error — idle → loading → error, console.error fired", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() =>
      useLazyPanelMetrics("panel5", { fetchOnIntersect: true, strategyId: "sid" }),
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    fireIntersection(observers[0], node);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.data).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      "useLazyPanelMetrics fetch failed",
      expect.objectContaining({ panelId: "panel5", strategyId: "sid", message: "boom" }),
    );
    errSpy.mockRestore();
  });

  it("Test 4: panel-id mapping covers all 4 LazyPanelIds", async () => {
    const cases: Array<[string, string]> = [
      ["panel4", "returns_dist"],
      ["panel5", "rolling"],
      ["panel6", "trades"],
      ["panel7", "exposure"],
    ];

    for (const [panelId, expected] of cases) {
      fetchSpy.mockResolvedValueOnce({});
      observers.length = 0;
      const { result, unmount } = renderHook(() =>
        useLazyPanelMetrics(panelId as "panel4" | "panel5" | "panel6" | "panel7", {
          fetchOnIntersect: true,
          strategyId: "sid",
        }),
      );
      const node = document.createElement("div");
      act(() => {
        result.current.ref(node);
      });
      fireIntersection(observers[0], node);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(fetchSpy).toHaveBeenLastCalledWith("sid", expected);
      unmount();
    }
  });

  it("Test 5: memoization — fetch fires exactly once across re-renders", async () => {
    fetchSpy.mockResolvedValue({});
    const { result, rerender } = renderHook(() =>
      useLazyPanelMetrics("panel4", { fetchOnIntersect: true, strategyId: "abc" }),
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    fireIntersection(observers[0], node);

    rerender();
    rerender();
    rerender();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Test 6: unobserve on first intersection — second intersection does not refetch", async () => {
    fetchSpy.mockResolvedValue({});
    const { result } = renderHook(() =>
      useLazyPanelMetrics("panel6", { fetchOnIntersect: true, strategyId: "sid" }),
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    fireIntersection(observers[0], node);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Confirm unobserve was called on the target
    expect(observers[0].unobserveCalls).toContain(node);

    // Second intersection event should be a no-op (target removed by unobserve)
    fireIntersection(observers[0], node);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Test 7: missing strategyId guard — stays idle, console.error fired", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      // strategyId is structurally optional in the type so we can exercise
      // the runtime guard. TypeScript users in production would be steered
      // by the JSDoc + plan documentation, not the type system.
      useLazyPanelMetrics("panel4", { fetchOnIntersect: true }),
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    fireIntersection(observers[0], node);

    expect(result.current.status).toBe("idle");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(
      "useLazyPanelMetrics: fetchOnIntersect=true requires strategyId",
      expect.objectContaining({ panelId: "panel4" }),
    );
    errSpy.mockRestore();
  });

  it("Test 8 (I-01): observer.disconnect() runs on unmount before intersection", () => {
    const { result, unmount } = renderHook(() =>
      useLazyPanelMetrics("panel4", { fetchOnIntersect: true, strategyId: "abc" }),
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    expect(observers).toHaveLength(1);
    expect(observers[0].disconnectCalls).toBe(0);

    unmount();
    expect(observers[0].disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it("Test 9: cleanup runs after fetch resolves without throwing", async () => {
    fetchSpy.mockResolvedValue({});
    const { result, unmount } = renderHook(() =>
      useLazyPanelMetrics("panel4", { fetchOnIntersect: true, strategyId: "abc" }),
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    fireIntersection(observers[0], node);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(() => unmount()).not.toThrow();
    expect(observers[0].disconnectCalls).toBeGreaterThanOrEqual(1);
  });
});
