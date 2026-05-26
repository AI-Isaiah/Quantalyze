import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { KeyFilterPanel } from "./KeyFilterPanel";

/**
 * KeyFilterPanel — per-API-key include/exclude toggle on the Overview tab.
 * Tests pin:
 *   - One row per key, exchange label shown
 *   - Toggle flips inclusion and persists in localStorage via the hook
 *   - "N excluded" caveat appears only when something is excluded
 *   - Empty apiKeys → component renders nothing (no empty section)
 *   - All-excluded warning appears when every key is off
 */

const lsStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => lsStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    lsStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    lsStore.delete(k);
  }),
  clear: vi.fn(() => {
    lsStore.clear();
  }),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("localStorage", localStorageMock);

beforeEach(() => {
  lsStore.clear();
});

const ALLOCATOR_ID = "alloc-1";
const KEYS = [
  {
    id: "k1",
    exchange: "binance",
    label: "Main",
    is_active: true,
    sync_status: "synced",
    last_sync_at: "2026-05-21T00:00:00Z",
    account_balance_usdt: 1000,
    created_at: "2026-04-01T00:00:00Z",
    // NEW-C03-09: fields now required on MyAllocationDashboardPayload.apiKeys
    sync_error: null,
    last_429_at: null,
    disconnected_at: null,
  },
  {
    id: "k2",
    exchange: "okx",
    label: "okx",
    is_active: true,
    sync_status: "synced",
    last_sync_at: "2026-05-21T00:00:00Z",
    account_balance_usdt: 500,
    created_at: "2026-04-15T00:00:00Z",
    sync_error: null,
    last_429_at: null,
    disconnected_at: null,
  },
];

describe("KeyFilterPanel — rendering", () => {
  it("renders one toggle per key", () => {
    render(<KeyFilterPanel allocatorId={ALLOCATOR_ID} apiKeys={KEYS} />);
    const panel = screen.getByTestId("overview-key-filter-panel");
    expect(within(panel).getByText(/binance/i)).toBeInTheDocument();
    expect(within(panel).getByText(/okx/i)).toBeInTheDocument();
  });

  it("renders nothing when no api keys are connected", () => {
    const { container } = render(
      <KeyFilterPanel allocatorId={ALLOCATOR_ID} apiKeys={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("checkbox is checked when key is INCLUDED (default)", () => {
    render(<KeyFilterPanel allocatorId={ALLOCATOR_ID} apiKeys={KEYS} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(true);
  });
});

describe("KeyFilterPanel — toggle behavior", () => {
  it("clicking a checkbox excludes the key and surfaces the caveat", () => {
    render(<KeyFilterPanel allocatorId={ALLOCATOR_ID} apiKeys={KEYS} />);
    expect(screen.queryByTestId("overview-key-filter-caveat")).toBeNull();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    const caveat = screen.getByTestId("overview-key-filter-caveat");
    expect(caveat.textContent).toMatch(/1 of 2 excluded/i);
    // Persisted with allocator-scoped key.
    expect(lsStore.get(`allocations.excludedKeyIds.${ALLOCATOR_ID}`)).toBe(
      JSON.stringify(["k1"]),
    );
  });

  it("shows the all-excluded warning when no keys are included", () => {
    render(<KeyFilterPanel allocatorId={ALLOCATOR_ID} apiKeys={KEYS} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(
      screen.getByTestId("overview-key-filter-all-excluded"),
    ).toBeInTheDocument();
  });

  it("re-including a key flips back to checked and clears the caveat", () => {
    render(<KeyFilterPanel allocatorId={ALLOCATOR_ID} apiKeys={KEYS} />);
    const [first] = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(first);
    expect(first.checked).toBe(false);
    fireEvent.click(first);
    expect(first.checked).toBe(true);
    expect(screen.queryByTestId("overview-key-filter-caveat")).toBeNull();
  });

  it("hydrates from persisted exclusions", () => {
    lsStore.set(
      `allocations.excludedKeyIds.${ALLOCATOR_ID}`,
      JSON.stringify(["k2"]),
    );
    render(<KeyFilterPanel allocatorId={ALLOCATOR_ID} apiKeys={KEYS} />);
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0].checked).toBe(true); // k1 included
    expect(boxes[1].checked).toBe(false); // k2 excluded
  });
});
