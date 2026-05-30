import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider, useComparator } from "./factsheet-context";

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
