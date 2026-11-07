import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useComparator, useDisplay, useToggles, useXRange } from "./factsheet-context";

/**
 * B7c — FactsheetProvider ⇄ localStorage integration.
 *
 * The codec itself is unit-tested in factsheet-context.codec.test.ts; this file
 * proves the PROVIDER wiring the review flagged as untested:
 *   - deferred-load adoption: a stored blob is adopted into view state on mount
 *     (the payload's own activeComparator is overridden by the stored value).
 *   - URL-wins-over-storage precedence (link-sharing): a `?cmp=` URL param beats
 *     the stored comparator — `get = (k) => params.get(k) ?? storedView[k]`.
 *   - write-path byte-compat: a mutation persists the UNVERSIONED
 *     `JSON.stringify(state)` shape (NO version field) at `factsheet-v2:${id}`.
 *
 * These are the load-bearing behaviours of the migration; a regression in
 * precedence or the version-envelope would silently corrupt / reset saved views.
 */

vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

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

function makePayload(): FactsheetPayload {
  // 200 synthetic days — long enough to clear the internal length thresholds in
  // buildFactsheetPayload (matches ComparatorPicker.test.tsx). The payload's
  // default activeComparator is "btc".
  const dailyReturns = Array.from({ length: 200 }).map((_, i) => ({
    date: `2024-${String(((i / 28) | 0) + 1).padStart(2, "0")}-${String(
      (i % 28) + 1,
    ).padStart(2, "0")}`,
    value: Math.sin(i / 9) * 0.005,
  }));
  const payload = buildFactsheetPayload(
    {
      id: "test-strategy",
      name: "Test Strategy",
      types: ["test"],
      markets: ["crypto"],
      computedAt: "2026-05-20T00:00:00Z",
      trustTier: null,
    },
    dailyReturns,
  );
  if (!payload) throw new Error("buildFactsheetPayload returned null in test");
  return payload;
}

const KEY = "factsheet-v2:test-strategy";

function Harness() {
  const { comparator, setComparator } = useComparator();
  return (
    <>
      <span data-testid="cmp">{comparator}</span>
      <button data-testid="set-btc" onClick={() => setComparator("btc")}>
        btc
      </button>
      <button data-testid="set-spx" onClick={() => setComparator("spx")}>
        spx
      </button>
    </>
  );
}

function renderProvider() {
  return render(
    <FactsheetProvider payload={makePayload()}>
      <Harness />
    </FactsheetProvider>,
  );
}

/**
 * Harness for the persist opt-out cases (Phase 38-02). Exposes setXRange so a
 * test can drive a pan, which is what fires the provider's debounced write
 * effect (the URL `history.replaceState` half + the `setStoredView` localStorage
 * half). A child read of comparator lets us deterministically wait for hydration
 * to latch `hydrated.current` before mutating.
 */
function PersistHarness() {
  const { comparator } = useComparator();
  const { xRange, setXRange } = useXRange();
  const toggles = useToggles();
  const display = useDisplay();
  return (
    <>
      <span data-testid="cmp">{comparator}</span>
      <span data-testid="range">{`${xRange[0]}-${xRange[1]}`}</span>
      <span data-testid="cb">{toggles.colorblind ? "on" : "off"}</span>
      <span data-testid="toggle-keys">{Object.keys(toggles).sort().join(",")}</span>
      <span data-testid="display-keys">{Object.keys(display).sort().join(",")}</span>
      <button
        data-testid="pan"
        onClick={() => setXRange([10, 120] as const)}
      >
        pan
      </button>
    </>
  );
}

beforeEach(() => {
  lsStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  // Reset the URL between tests (the provider's write effect mutates it).
  window.history.replaceState(null, "", "/factsheet/test-strategy/v2");
});

describe("FactsheetProvider — storage integration (B7c)", () => {
  it("adopts the persisted comparator from storage on deferred load (no URL param)", async () => {
    // Payload default activeComparator is "btc"; a stored "spx" must win on load.
    lsStore.set(KEY, JSON.stringify({ cmp: "spx" }));
    act(() => {
      renderProvider();
    });
    await waitFor(() =>
      expect(screen.getByTestId("cmp").textContent).toBe("spx"),
    );
  });

  it("URL ?cmp= wins over the stored comparator (link-sharing precedence)", async () => {
    lsStore.set(KEY, JSON.stringify({ cmp: "spx" }));
    window.history.replaceState(null, "", "/factsheet/test-strategy/v2?cmp=none");
    act(() => {
      renderProvider();
    });
    await waitFor(() =>
      expect(screen.getByTestId("cmp").textContent).toBe("none"),
    );
  });

  it("persists a mutation in the unversioned byte-compat shape (no version field)", async () => {
    // Seed a stored comparator so we can deterministically wait for hydration to
    // complete (cmp flips to "spx"), which also latches hydrated.current → the
    // write effect is then armed. Then mutate and assert the persisted shape.
    lsStore.set(KEY, JSON.stringify({ cmp: "spx" }));
    act(() => {
      renderProvider();
    });
    await waitFor(() =>
      expect(screen.getByTestId("cmp").textContent).toBe("spx"),
    );
    act(() => {
      fireEvent.click(screen.getByTestId("set-btc"));
    });
    await waitFor(() => {
      const raw = lsStore.get(KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw as string);
      expect(parsed.cmp).toBe("btc");
      // The byte-compat invariant: NO version envelope was added.
      expect("version" in parsed).toBe(false);
    });
  });
});

/**
 * Phase 38-02 — the additive `persist?: boolean` opt-out.
 *
 * The factsheet itself never passes `persist`, so the default path (persist
 * omitted ⇒ true) must round-trip view-state to the URL + localStorage exactly
 * as before (the existing B7c suite above pins that path). These cases pin the
 * SECOND direction the composer (Plan 03) relies on: `persist={false}` must
 * suppress BOTH write halves so a scenario mount never rewrites the dashboard
 * URL nor writes a `factsheet-v2:` localStorage blob. (Phase 193 D-02: the view
 * range is no longer persisted at all, so a pan writes neither half for ANY
 * mount; the D-02 describe below pins that.)
 */
function renderPersist(persist?: boolean) {
  return render(
    <FactsheetProvider payload={makePayload()} persist={persist}>
      <PersistHarness />
    </FactsheetProvider>,
  );
}

describe("FactsheetProvider — persist opt-out (38-02)", () => {
  it("persist={false} gates BOTH reads and writes: it never adopts the sibling tab's stored/URL view-state (RT2) nor rewrites the shared URL/localStorage after a pan", async () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    // The sibling Overview factsheet shares the /allocations URL and a stored
    // `factsheet-v2:` blob. Seed BOTH a stored comparator and URL params so an
    // ungated read would bleed that view-state (cmp + cb) into the ephemeral
    // scenario chart — the exact RT2 cross-tab leak.
    lsStore.set(KEY, JSON.stringify({ cmp: "spx" }));
    window.history.replaceState(
      null,
      "",
      "/factsheet/test-strategy/v2?cmp=none&cb=1",
    );
    act(() => {
      renderPersist(false);
    });
    // Flush the deferred storage load + the hydration effect. `hydrated.current`
    // latches regardless of persist (the gate is an early return AFTER the
    // latch), so the write effect IS armed — any write suppression below is due
    // to persist={false}, not an un-hydrated provider. We flush on a timer
    // because, with the read now gated, the seeded cmp is NOT adopted, so there
    // is no cmp flip to wait on.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    // READ gate (RT2): neither the stored cmp ("spx") nor the URL cmp ("none") /
    // cb ("1") was adopted — the ephemeral chart stays at the payload defaults.
    expect(screen.getByTestId("cmp").textContent).toBe("btc");
    expect(screen.getByTestId("cb").textContent).toBe("off");
    const searchBefore = window.location.search;
    replaceSpy.mockClear();
    act(() => {
      fireEvent.click(screen.getByTestId("pan"));
    });
    // Give the 250ms debounce window ample time to fire if the gate were absent.
    await new Promise((r) => setTimeout(r, 400));
    // WRITE gate: pan rewrote NEITHER the URL nor the seeded localStorage blob.
    expect(window.location.search).toBe(searchBefore);
    expect(window.location.search).not.toContain("range=");
    expect(replaceSpy).not.toHaveBeenCalled();
    const raw = lsStore.get(KEY);
    expect(JSON.parse(raw as string)).toEqual({ cmp: "spx" });
    replaceSpy.mockRestore();
  });

  it("persist={false} hydrates without throwing over an empty URL/storage (renders full range)", async () => {
    lsStore.clear();
    window.history.replaceState(null, "", "/factsheet/test-strategy/v2");
    let threw = false;
    try {
      act(() => {
        renderPersist(false);
      });
      // The comparator falls back to the payload default ("btc") — proves the
      // read effect ran cleanly with no URL/storage and no throw.
      await waitFor(() =>
        expect(screen.getByTestId("cmp").textContent).toBe("btc"),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    // No write surface was created either.
    expect(lsStore.get(KEY)).toBeUndefined();
    expect(window.location.search).toBe("");
  });
});

/**
 * Phase 193 (QUIETVIEW, D-02, TRUST-02) — the visible range is session-local.
 *
 * A pan, zoom or reset never writes the URL or localStorage; on load every visit
 * opens the FULL history; a range a browser saved before this change (a `?range=`
 * in the URL or a `range` field in the stored blob) is never applied and is
 * deleted once on hydration, while the comparator and display toggles (`cmp`,
 * `cb`, `reg`) persist exactly as before (UI-SPEC A-5).
 */
describe("FactsheetProvider — the view range is session-local (D-02)", () => {
  const FULL = "0-199";
  // The spy is created INSIDE each test, before render (so the file-level URL
  // reset in beforeEach is never counted), and restored in afterEach: a failing
  // assertion must not leave it installed, with its accumulated calls, for the
  // next case.
  let replaceSpy: MockInstance<typeof window.history.replaceState>;
  const spyReplaceState = () => {
    replaceSpy = vi.spyOn(window.history, "replaceState");
  };
  afterEach(() => {
    replaceSpy?.mockRestore();
  });

  it("Case A (ordering): a legacy ?range= AND a stored range are both deleted, neither applied; cmp/cb survive (D-02)", async () => {
    lsStore.set(KEY, JSON.stringify({ range: "10-120", cmp: "spx" }));
    window.history.replaceState(null, "", "/factsheet/test-strategy/v2?range=10-120&cb=1");
    act(() => {
      renderPersist();
    });
    // cb=1 and the stored spx are adopted in the same hydration effect run
    // that handles the legacy range, so once both flip the range branch ran.
    await waitFor(() => {
      expect(screen.getByTestId("cmp").textContent).toBe("spx");
      expect(screen.getByTestId("cb").textContent).toBe("on");
    });
    // Let the write effect's 250ms debounce land so the final URL/blob is read.
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByTestId("range").textContent).toBe(FULL);
    expect(window.location.search).not.toContain("range");
    expect(window.location.search).toContain("cb=1");
    const blob = JSON.parse(lsStore.get(KEY) as string);
    expect("range" in blob).toBe(false);
    expect(blob.cmp).toBe("spx");
  });

  it("Case B: a pan writes neither a ?range= nor a range field (D-02)", async () => {
    spyReplaceState();
    lsStore.set(KEY, JSON.stringify({ cmp: "spx" }));
    act(() => {
      renderPersist();
    });
    // Hydration latched (and the write effect is armed) once cmp flips.
    await waitFor(() =>
      expect(screen.getByTestId("cmp").textContent).toBe("spx"),
    );
    // Adopting the stored spx moved `comparator` off the payload default, so a
    // 250ms write is already pending. Wait for IT to land before clearing the
    // spies, or the silence assertion below would measure a write the pan did
    // not cause.
    await waitFor(() => {
      expect(window.location.search).toBe("?cmp=spx");
      expect(localStorageMock.setItem).toHaveBeenCalledWith(KEY, expect.any(String));
    });
    replaceSpy.mockClear();
    localStorageMock.setItem.mockClear();
    act(() => {
      fireEvent.click(screen.getByTestId("pan"));
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain("range");
    expect(JSON.parse(lsStore.get(KEY) as string)).toEqual({ cmp: "spx" });
    // The pan itself still works in memory.
    expect(screen.getByTestId("range").textContent).toBe("10-120");
  });

  it("Case C: a blob whose only field is a legacy range is removed (key gone), nothing rewritten", async () => {
    spyReplaceState();
    lsStore.set(KEY, JSON.stringify({ range: "10-120" }));
    act(() => {
      renderPersist();
    });
    await waitFor(() =>
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(KEY),
    );
    // Past the write effect's 250ms debounce, so any write hydration scheduled
    // has landed before the assertions.
    await new Promise((r) => setTimeout(r, 400));
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(KEY);
    expect(lsStore.has(KEY)).toBe(false);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("range").textContent).toBe(FULL);
  });

  it("Case D (empty visitor, HEAD-green pin): nothing stored and no ?range= makes no storage write/removal and no replaceState", async () => {
    spyReplaceState();
    act(() => {
      renderPersist();
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("range").textContent).toBe(FULL);
  });

  it("Case E (persist={false}, HEAD-green pin): neither reads nor purges a stored/URL range", async () => {
    const seed = JSON.stringify({ range: "10-120", cmp: "spx" });
    lsStore.set(KEY, seed);
    window.history.replaceState(null, "", "/factsheet/test-strategy/v2?range=10-120");
    act(() => {
      renderPersist(false);
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(lsStore.get(KEY)).toBe(seed);
    expect(window.location.search).toContain("range=10-120");
    expect(screen.getByTestId("range").textContent).toBe(FULL);
  });
});

/**
 * Phase 164.6.6.2 plan 06 (D-10, UI-SPEC A7, T-164.6.6.2-20) — a strategy whose
 * returns are in BTC can never have BTC as its active comparator, whichever way
 * the value arrives: the share URL (user-controlled) or the stored view.
 * `?cmp=spx` and `?cmp=none` still adopt exactly as today.
 */
describe("FactsheetProvider — cmp=btc is ignored for a strategy whose returns are in BTC (A7)", () => {
  function makeUnitPayload(): FactsheetPayload {
    const dailyReturns = Array.from({ length: 200 }).map((_, i) => ({
      date: `2024-${String(((i / 28) | 0) + 1).padStart(2, "0")}-${String(
        (i % 28) + 1,
      ).padStart(2, "0")}`,
      value: Math.sin(i / 9) * 0.005,
    }));
    const payload = buildFactsheetPayload(
      {
        id: "test-strategy",
        name: "Test Strategy",
        types: ["test"],
        markets: ["crypto"],
        computedAt: "2026-05-20T00:00:00Z",
        trustTier: null,
      },
      dailyReturns,
      { returnsUnit: "BTC" },
    );
    if (!payload) throw new Error("buildFactsheetPayload returned null in test");
    return payload;
  }

  function renderUnit() {
    return render(
      <FactsheetProvider payload={makeUnitPayload()}>
        <PersistHarness />
      </FactsheetProvider>,
    );
  }

  it("starts at none, and a ?cmp=btc URL leaves it at none while the rest of the URL still adopts", async () => {
    window.history.replaceState(null, "", "/factsheet/test-strategy/v2?cmp=btc&cb=1");
    act(() => {
      renderUnit();
    });
    // cb=1 is adopted in the SAME effect run that reads cmp, so once it flips
    // the cmp branch has already been evaluated; asserting after it is not vacuous.
    await waitFor(() => expect(screen.getByTestId("cb").textContent).toBe("on"));
    expect(screen.getByTestId("cmp").textContent).toBe("none");
  });

  it("a stored cmp of btc is ignored the same way", async () => {
    lsStore.set(KEY, JSON.stringify({ cmp: "btc", cb: "1" }));
    act(() => {
      renderUnit();
    });
    await waitFor(() => expect(screen.getByTestId("cb").textContent).toBe("on"));
    expect(screen.getByTestId("cmp").textContent).toBe("none");
  });

  it("?cmp=spx still selects SPX", async () => {
    window.history.replaceState(null, "", "/factsheet/test-strategy/v2?cmp=spx");
    act(() => {
      renderUnit();
    });
    await waitFor(() => expect(screen.getByTestId("cmp").textContent).toBe("spx"));
  });

  it("a USD strategy still adopts ?cmp=btc (the guard is the unit, not the key)", async () => {
    lsStore.set(KEY, JSON.stringify({ cmp: "spx" }));
    window.history.replaceState(null, "", "/factsheet/test-strategy/v2?cmp=btc");
    act(() => {
      renderProvider();
    });
    // Default is already btc, so wait on a stable read: the URL value wins over
    // the stored spx, which proves the branch ran and adopted btc.
    await waitFor(() => expect(screen.getByTestId("cmp").textContent).toBe("btc"));
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByTestId("cmp").textContent).toBe("btc");
  });
});

/**
 * Phase 195 (D-06) — dark mode is gone (DESIGN.md "Dark mode: Not planned").
 * `?dark=1` in a link and a `dark` value in a blob an older build saved are
 * trust-boundary inputs that must reach nothing: no flag is exposed, and the
 * next write never carries the value again.
 */
describe("FactsheetProvider — the removed dark option is never read or re-written (D-06)", () => {
  it("?dark=1 and a stored dark '1' expose no dark flag, and the next write has no dark key", async () => {
    // `cb` is the hydration sentinel: it is adopted in the same effect run that
    // would have read `dark`, so once it flips the dark branch (gone) has been passed.
    lsStore.set(KEY, JSON.stringify({ cb: "1", dark: "1" }));
    window.history.replaceState(null, "", "/factsheet/test-strategy/v2?dark=1");
    act(() => {
      renderPersist();
    });
    await waitFor(() => expect(screen.getByTestId("cb").textContent).toBe("on"));
    // No context exposes a dark flag or setter, so nothing can render dark.
    expect(screen.getByTestId("toggle-keys").textContent).not.toMatch(/dark/i);
    expect(screen.getByTestId("display-keys").textContent).toBe("colorblind");
    // Let the 250ms write debounce land, then read what was persisted.
    await new Promise((r) => setTimeout(r, 400));
    const blob = JSON.parse(lsStore.get(KEY) as string);
    expect("dark" in blob).toBe(false);
    expect(blob.cb).toBe("1");
  });
});
