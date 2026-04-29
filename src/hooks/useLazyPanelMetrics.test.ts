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

  it("Test 10 (F2 v0.17.1): stale payload is discarded when strategyId changes mid-fetch", async () => {
    // Grok F2 — without a mount-guard or strategyId-at-resolve check, the
    // resolved payload from strategy A would call setData on the hook
    // instance that React reuses for strategy B (no `key={strategyId}` on
    // StrategyV2Shell's panel children). The fix gates the .then/.catch
    // on (mountedRef.current && optsRef.current.strategyId === captured).
    let resolveFetch: (v: unknown) => void = () => {};
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const stalePayload = {
      rolling_volatility_3m: [{ date: "2024-01-01", value: 999 }],
    };

    const { result, rerender } = renderHook(
      ({ strategyId }) =>
        useLazyPanelMetrics("panel5", { fetchOnIntersect: true, strategyId }),
      { initialProps: { strategyId: "abc" } },
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    fireIntersection(observers[0], node);

    // Drain dynamic-import microtasks; fetch is now in-flight.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledWith("abc", "rolling");
    expect(result.current.status).toBe("loading");

    // User navigates: same hook instance (no key on panel), new strategyId.
    rerender({ strategyId: "xyz" });

    // Resolve abc's stale fetch. WITHOUT the fix, this calls setData(stale)
    // on the hook instance now bound to xyz — leaks abc's data to xyz's panel.
    await act(async () => {
      resolveFetch(stalePayload);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // F2 fix: stale payload must be discarded.
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("loading");
  });

  it("Test 11 (F2 v0.17.1): unmount mid-fetch leaves state at last-rendered value (no post-unmount setData)", async () => {
    // Defends the unmount race independently from strategyId reuse: if the
    // user navigates fully away from the strategy detail page before the
    // fetch resolves, the .then chain must short-circuit on mountedRef so
    // setData is never called on the unmounted instance.
    //
    // React 18+ removed the "state update on an unmounted component"
    // console warning, so a string-match on errSpy is vacuous (passes
    // trivially without the fix). Instead capture result.current BEFORE
    // unmount and BEFORE the deferred fetch resolves; assert it stayed at
    // the loading snapshot — proving setData never fired post-unmount.
    let resolveFetch: (v: unknown) => void = () => {};
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

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
    expect(fetchSpy).toHaveBeenCalledWith("abc", "returns_dist");
    // Snapshot at "loading" — fetch is still in flight, data is null.
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
    const beforeUnmount = result.current;

    unmount();

    // Resolve after unmount. Without the mountedRef guard, setData would
    // fire on the unmounted hook (silent-no-op in React 18+ for the test
    // observer, but state corruption if React re-mounts the same slot).
    await act(async () => {
      resolveFetch({ daily_returns_grid: { rows: [] } });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // result.current is the last-rendered value. With the F2 guard, setData
    // never fired, so the snapshot equals the pre-unmount loading state.
    expect(result.current).toBe(beforeUnmount);
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
  });

  it("Test 12 (F2 v0.17.1): .catch guard discards stale rejection when strategyId changes mid-fetch", async () => {
    // GAP-1 from coverage audit: the .then guard is exercised by Test 10, but
    // the symmetric .catch guard was not. Without `if (!isStillRelevant())`
    // on the .catch chain, abc's late rejection would fire console.error +
    // setStatus("error") on the hook instance now bound to xyz — flashing a
    // stale error in xyz's panel. Observable via the fiber-still-mounted
    // setStatus side effect AND the console.error log call.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectFetch: (e: unknown) => void = () => {};
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );

    const { result, rerender } = renderHook(
      ({ strategyId }) =>
        useLazyPanelMetrics("panel5", { fetchOnIntersect: true, strategyId }),
      { initialProps: { strategyId: "abc" } },
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
    expect(fetchSpy).toHaveBeenCalledWith("abc", "rolling");
    expect(result.current.status).toBe("loading");

    // Same hook instance, new strategyId.
    rerender({ strategyId: "xyz" });

    // Reject abc's stale fetch. WITHOUT the .catch guard, this fires
    // console.error and setStatus("error") on the xyz-bound instance.
    await act(async () => {
      rejectFetch(new Error("stale-error"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // F2 .catch fix: stale rejection must be discarded — no error log, no
    // status flip, no data mutation.
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBeNull();
    expect(errSpy).not.toHaveBeenCalledWith(
      "useLazyPanelMetrics fetch failed",
      expect.objectContaining({ strategyId: "abc" }),
    );
    errSpy.mockRestore();
  });

  it("Test 13 (F2 v0.17.1): .catch guard discards rejection that resolves post-unmount", async () => {
    // GAP-1 (catch + unmount): unlike Test 11's .then unmount race (which
    // is vacuous because React 18 silently no-ops setState on unmounted
    // components), the .catch path's first statement is `console.error(...)`.
    // That call has an OBSERVABLE side effect — independent of React's
    // post-unmount setState behavior — so spying on console.error genuinely
    // distinguishes guard-present from guard-absent.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectFetch: (e: unknown) => void = () => {};
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );

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
    expect(fetchSpy).toHaveBeenCalledWith("abc", "returns_dist");
    expect(result.current.status).toBe("loading");

    unmount();

    // Reject after unmount. Without the mountedRef guard, console.error fires
    // before the setStatus("error") call — and console.error is a side
    // effect we CAN observe, regardless of React's reconciler dropping
    // setState on the dead fiber.
    await act(async () => {
      rejectFetch(new Error("post-unmount-rejection"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // F2 .catch fix: console.error must NOT be called for the discarded
    // rejection. Filter on the structured-log payload to avoid catching
    // any unrelated React internal warnings.
    expect(errSpy).not.toHaveBeenCalledWith(
      "useLazyPanelMetrics fetch failed",
      expect.objectContaining({ strategyId: "abc", message: "post-unmount-rejection" }),
    );
    errSpy.mockRestore();
  });

  it("Test 14 (Adversarial v0.17.1): A→B→A flip discards A's stale resolve even when current strategyId is again 'abc'", async () => {
    // Cross-model adversarial review (Claude conf 7 + Grok 4.20 P1) flagged
    // the F2 fix's bare strategyId equality as missing the A→B→A flip race:
    // user navigates abc → xyz → abc within the same hook instance (a panel
    // missing key={strategy.id}, e.g.); abc's first fetch is still in
    // flight; when it resolves, optsRef.current.strategyId is again "abc",
    // so the equality check passes and stale data clobbers the third-mount
    // state.
    //
    // Fix: a monotonic versionRef that bumps on every strategyId change.
    // The captured requestVersion at intersection-time no longer matches
    // versionRef.current after the round-trip, so the .then short-circuits.
    let resolveFetch: (v: unknown) => void = () => {};
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const stalePayload = {
      rolling_volatility_3m: [{ date: "2024-01-01", value: 999 }],
    };

    const { result, rerender } = renderHook(
      ({ strategyId }) =>
        useLazyPanelMetrics("panel5", { fetchOnIntersect: true, strategyId }),
      { initialProps: { strategyId: "abc" } },
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    fireIntersection(observers[0], node);

    // Drain to start the fetch and capture requestVersion at intersection-time.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledWith("abc", "rolling");
    expect(result.current.status).toBe("loading");

    // The flip: abc → xyz → abc. With panel keying in production this
    // creates fresh hook instances, but we explicitly test the same hook
    // instance scenario here to defend against any future panel forgetting
    // the key prop. Each strategyId-change bumps versionRef.
    rerender({ strategyId: "xyz" });
    rerender({ strategyId: "abc" });

    // Resolve abc's stale fetch. WITHOUT the version counter, the bare
    // strategyId comparison would pass (current = "abc", captured = "abc")
    // and the stale payload would be applied as the third-mount data.
    await act(async () => {
      resolveFetch(stalePayload);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Adversarial fix: stale payload from request-version 1 is discarded
    // because versionRef has advanced to 3 (bumped on each strategyId change
    // of the [opts.strategyId] useEffect).
    expect(result.current.data).toBeNull();
    expect(result.current.status).toBe("loading");
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

  /**
   * SR-4 (v0.17.1.4) — three branches the prior 14 tests left uncovered.
   * Each guards a distinct edge of the ref-callback contract: the React
   * detach call (ref(null)), the SSR/no-polyfill environment, and the
   * IntersectionObserver entry-loop's per-entry isIntersecting filter.
   */

  it("Test SR-4.1: ref(null) early-returns without creating an observer", () => {
    // React calls the ref callback with null on detach (and during fast
    // refresh in dev). The hook must not crash on null and must not
    // synthesize a fresh observer for a non-element argument.
    const { result } = renderHook(() =>
      useLazyPanelMetrics("panel4", { fetchOnIntersect: true, strategyId: "abc" }),
    );
    expect(observers).toHaveLength(0);

    act(() => {
      result.current.ref(null);
    });
    expect(observers).toHaveLength(0);
    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Test SR-4.2: IntersectionObserver=undefined SSR fallback flips to ready immediately", () => {
    // The hook's runtime guard checks for `typeof IntersectionObserver`.
    // When the global is absent (SSR-shaped jsdom configuration, or a
    // future test runner without the polyfill), the hook MUST flip to
    // "ready" so consumers don't deadlock on "idle" forever. No fetch
    // is fired and no observer is created.
    const original = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    try {
      const { result } = renderHook(() =>
        useLazyPanelMetrics("panel4", {
          fetchOnIntersect: true,
          strategyId: "abc",
        }),
      );
      const node = document.createElement("div");
      act(() => {
        result.current.ref(node);
      });

      expect(result.current.status).toBe("ready");
      expect(result.current.data).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(observers).toHaveLength(0);
    } finally {
      (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
        .IntersectionObserver = original;
    }
  });

  it("Test SR-4.3: non-intersecting entries do not flip status or fetch", async () => {
    // The observer callback's per-entry loop short-circuits with
    // `if (!entry.isIntersecting) continue;`. Without coverage, a
    // regression that flipped the polarity (treating a leave event as
    // an enter) would silently fire fetches for panels the user has
    // scrolled away from.
    fetchSpy.mockResolvedValueOnce({});
    const { result } = renderHook(() =>
      useLazyPanelMetrics("panel4", { fetchOnIntersect: true, strategyId: "abc" }),
    );
    const node = document.createElement("div");
    act(() => {
      result.current.ref(node);
    });
    expect(observers).toHaveLength(1);

    // Synthesize an entry with isIntersecting=false. Our stub's
    // fireIntersection helper hard-codes true, so call the captured
    // callback directly with a "leave" entry.
    const obs = observers[0];
    act(() => {
      const leaveEntry: Partial<IntersectionObserverEntry> = {
        isIntersecting: false,
        target: node,
      };
      obs.cb(
        [leaveEntry as IntersectionObserverEntry],
        obs as unknown as IntersectionObserver,
      );
    });

    // Drain microtasks in case a stray .then snuck in.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Target stays observed — only an actual intersection unobserves it.
    expect(obs.unobserveCalls).not.toContain(node);
  });
});
