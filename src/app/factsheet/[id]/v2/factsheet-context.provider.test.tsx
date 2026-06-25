import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useComparator, useToggles, useXRange } from "./factsheet-context";

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
vi.stubGlobal("localStorage", localStorageMock);
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
  const { setXRange } = useXRange();
  const { darkMode } = useToggles();
  return (
    <>
      <span data-testid="cmp">{comparator}</span>
      <span data-testid="dark">{darkMode ? "dark" : "light"}</span>
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
 * URL (`?range=`) nor writes a `factsheet-v2:` localStorage blob.
 */
function renderPersist(persist?: boolean) {
  return render(
    <FactsheetProvider payload={makePayload()} persist={persist}>
      <PersistHarness />
    </FactsheetProvider>,
  );
}

describe("FactsheetProvider — persist opt-out (38-02)", () => {
  it("default (persist omitted) writes BOTH the URL ?range= and the localStorage blob after a pan", async () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    // Seed a stored comparator so hydration latches deterministically (cmp →
    // "spx"); the write effect is armed only after hydrated.current is true.
    lsStore.set(KEY, JSON.stringify({ cmp: "spx" }));
    act(() => {
      renderPersist();
    });
    await waitFor(() =>
      expect(screen.getByTestId("cmp").textContent).toBe("spx"),
    );
    replaceSpy.mockClear();
    act(() => {
      fireEvent.click(screen.getByTestId("pan"));
    });
    // URL half: the debounced effect calls history.replaceState with ?range=.
    await waitFor(() => {
      expect(window.location.search).toContain("range=10-120");
    });
    expect(replaceSpy).toHaveBeenCalled();
    // localStorage half: the blob now carries the panned range.
    const raw = lsStore.get(KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).range).toBe("10-120");
    replaceSpy.mockRestore();
  });

  it("persist={false} gates BOTH reads and writes: it never adopts the sibling tab's stored/URL view-state (RT2) nor rewrites the shared URL/localStorage after a pan", async () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    // The sibling Overview factsheet shares the /allocations URL and a stored
    // `factsheet-v2:` blob. Seed BOTH a stored comparator and URL params so an
    // ungated read would bleed that view-state (cmp + dark) into the ephemeral
    // scenario chart — the exact RT2 cross-tab leak.
    lsStore.set(KEY, JSON.stringify({ cmp: "spx" }));
    window.history.replaceState(
      null,
      "",
      "/factsheet/test-strategy/v2?cmp=none&dark=1",
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
    // dark ("1") was adopted — the ephemeral chart stays at the payload defaults.
    expect(screen.getByTestId("cmp").textContent).toBe("btc");
    expect(screen.getByTestId("dark").textContent).toBe("light");
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
