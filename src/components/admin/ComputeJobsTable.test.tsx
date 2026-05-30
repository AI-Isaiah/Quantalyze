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
