import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { ReadonlyURLSearchParams } from "next/navigation";

/**
 * Phase 09.1 Plan 01 Task 2 — Feature-flag routing tests for AllocationsTabs
 * (D-17 / D-20).
 *
 * Asserts the DOM-level routing contract between the legacy AllocationDashboard
 * body and the new AllocationDashboardV2 shell, gated on:
 *
 *   - localStorage["allocations.ui_v2"] === "true"
 *   - OR ?ui=v2 (only when NEXT_PUBLIC_QA_MODE === "true")
 *
 * The two real components are stubbed with minimal mocks that preserve the
 * marker contract from Task 1:
 *
 *   - AllocationDashboardV2 emits `data-ui-v2-shell="true"`
 *   - AllocationDashboard   emits `data-legacy-dashboard="true"`
 *
 * This means assertions can use container.querySelector() on the markers
 * rather than grepping user-visible copy. The mock contract MUST stay in
 * sync with the real components — Task 1 invariants are re-grepped at the
 * source files in the acceptance criteria.
 *
 * Hydration-mismatch invariant (case 7): we spy on console.error and assert
 * no React hydration warning fires under any flag state. React 19 reports
 * hydration mismatches via console.error containing strings like
 * "hydration", "did not match", or "server rendered". The Task 1 useState +
 * useEffect re-read pattern is what prevents these.
 */

// --- next/navigation mocks --------------------------------------------------

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", async () => ({
  useSearchParams: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(() => "/allocations"),
}));

// --- QA_MODE module mock (Plan 11 V3 — module-scope constant) --------------
// AllocationsTabs no longer reads `process.env.NEXT_PUBLIC_QA_MODE` directly;
// it imports `QA_MODE` from `@/lib/qa-mode`. We toggle that constant via a
// `let` captured by the hoisted mock factory, exactly as Tweaks.test.tsx does.
let qaModeValue = false;
vi.mock("@/lib/qa-mode", () => ({
  get QA_MODE() {
    return qaModeValue;
  },
}));

import { useSearchParams, useRouter } from "next/navigation";

// --- Component body mocks ---------------------------------------------------
//
// The mocks preserve the marker attribute contract from Task 1 so that
// container.querySelector('[data-ui-v2-shell]') / [data-legacy-dashboard]
// matches what the real components emit. The acceptance criteria below
// (re-grepping the source files for the same attributes) lock the contract
// from drifting silently.

vi.mock("./AllocationDashboard", () => ({
  AllocationDashboard: () => <div data-legacy-dashboard="true" />,
}));
vi.mock("./AllocationDashboardV2", () => ({
  AllocationDashboardV2: () => <div data-ui-v2-shell="true" />,
}));

// --- Import after mocks -----------------------------------------------------

import { AllocationsTabs } from "./AllocationsTabs";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

// --- Stub props (mirrors AllocationsTabs.test.tsx) -------------------------

const STUB_PROPS: MyAllocationDashboardPayload = {
  portfolio: null,
  analytics: null,
  strategies: [],
  apiKeys: [],
  alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  outcomes: [],
  equitySnapshots: [],
  holdingsSummary: [],
  snapshotCount: 0,
  allKeysStale: false,
  lastSyncAt: null,
  hasSyncing: false,
  equityDailyPoints: [],
  minHistoryDepthMonths: null,
  activeVenues: [],
  flaggedHoldings: [],
  matchDecisionsByHoldingRef: {},
};

// --- localStorage mock (clone of useDashboardConfig.test.ts P6 idiom) ------

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => { lsStore.set(k, v); }),
  removeItem: vi.fn((k: string) => { lsStore.delete(k); }),
  clear: vi.fn(() => { lsStore.clear(); }),
  get length() { return lsStore.size; },
  key: vi.fn(() => null),
};
vi.stubGlobal("localStorage", localStorageMock);

const UI_V2_KEY = "allocations.ui_v2";

function setSearchParams(query: string): void {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReadonlyURLSearchParams,
  );
}

describe("AllocationsTabs — feature flag routing (D-17)", () => {
  beforeEach(() => {
    lsStore.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockPush.mockReset();
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace,
      refresh: mockRefresh,
      push: mockPush,
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
    // Default: QA mode off (Plan 11 V3 — module-scope constant via vi.mock,
    // not env stubbing), no URL override.
    qaModeValue = false;
    setSearchParams("");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    qaModeValue = false;
  });

  it("flag-on (localStorage='true') → V2 shell renders, legacy absent", () => {
    lsStore.set(UI_V2_KEY, "true");
    const { container } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(container.querySelector("[data-ui-v2-shell]")).not.toBeNull();
    expect(container.querySelector("[data-legacy-dashboard]")).toBeNull();
  });

  it("flag-off (localStorage='false') → legacy renders, V2 absent", () => {
    lsStore.set(UI_V2_KEY, "false");
    const { container } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(container.querySelector("[data-legacy-dashboard]")).not.toBeNull();
    expect(container.querySelector("[data-ui-v2-shell]")).toBeNull();
  });

  it("missing key → legacy renders (default-false per D-17)", () => {
    // No setItem call — getItem returns null.
    const { container } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(container.querySelector("[data-legacy-dashboard]")).not.toBeNull();
    expect(container.querySelector("[data-ui-v2-shell]")).toBeNull();
  });

  it("?ui=v2 + NEXT_PUBLIC_QA_MODE=true (no localStorage) → V2 shell renders", () => {
    qaModeValue = true;
    setSearchParams("ui=v2");
    const { container } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(container.querySelector("[data-ui-v2-shell]")).not.toBeNull();
    expect(container.querySelector("[data-legacy-dashboard]")).toBeNull();
  });

  it("?ui=v2 WITHOUT NEXT_PUBLIC_QA_MODE → legacy renders (URL override is QA-gated)", () => {
    // Default beforeEach already unset NEXT_PUBLIC_QA_MODE.
    setSearchParams("ui=v2");
    const { container } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(container.querySelector("[data-legacy-dashboard]")).not.toBeNull();
    expect(container.querySelector("[data-ui-v2-shell]")).toBeNull();
  });

  it("localStorage.getItem throws (Safari private-mode) → legacy renders", () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error("Safari private mode");
    });
    const { container } = render(<AllocationsTabs {...STUB_PROPS} />);
    expect(container.querySelector("[data-legacy-dashboard]")).not.toBeNull();
    expect(container.querySelector("[data-ui-v2-shell]")).toBeNull();
  });

  it("hydration-mismatch invariant: console.error never fires with hydration/did not match under any flag state", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Flag-off render.
      const { unmount: u1 } = render(<AllocationsTabs {...STUB_PROPS} />);
      u1();
      // Flag-on render.
      lsStore.set(UI_V2_KEY, "true");
      const { unmount: u2 } = render(<AllocationsTabs {...STUB_PROPS} />);
      u2();
      // QA-gated URL override render.
      lsStore.clear();
      qaModeValue = true;
      setSearchParams("ui=v2");
      const { unmount: u3 } = render(<AllocationsTabs {...STUB_PROPS} />);
      u3();
      // Inspect every recorded console.error call. Any string containing
      // "hydration" or "did not match" or "server rendered" indicates a
      // React hydration mismatch warning — the Task 1 useState + useEffect
      // re-read pattern is what prevents these from firing.
      const offendingCalls = errorSpy.mock.calls.filter((args) =>
        args.some((a) => {
          const s = typeof a === "string" ? a : "";
          return /hydration|did not match|server rendered/i.test(s);
        }),
      );
      expect(offendingCalls).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
