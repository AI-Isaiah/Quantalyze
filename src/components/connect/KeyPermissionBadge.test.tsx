import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { KeyPermissionBadge } from "./KeyPermissionBadge";

// Helper to mount fetch responses.
function mockFetchOnce(response: object, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: async () => response,
  } as Response) as unknown as typeof fetch;
}

describe("KeyPermissionBadge", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows loading skeleton on mount", () => {
    global.fetch = vi.fn(
      () => new Promise(() => {}),
    ) as unknown as typeof fetch;
    render(<KeyPermissionBadge apiKeyId="key-1" />);
    expect(screen.getByTestId("key-permission-skeleton")).toBeInTheDocument();
  });

  it("renders read-only success state (Read ✓ / Trade ✗ / Withdraw ✗)", async () => {
    mockFetchOnce({
      read: true,
      trade: false,
      withdraw: false,
      detected_at: new Date().toISOString(),
    });
    render(<KeyPermissionBadge apiKeyId="key-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("key-perm-pill-read")).toHaveAttribute(
        "data-granted",
        "true",
      );
    });
    expect(screen.getByTestId("key-perm-pill-trade")).toHaveAttribute(
      "data-granted",
      "false",
    );
    expect(screen.getByTestId("key-perm-pill-withdraw")).toHaveAttribute(
      "data-granted",
      "false",
    );
  });

  it("highlights trade and withdraw when scopes are too broad", async () => {
    mockFetchOnce({
      read: true,
      trade: true,
      withdraw: true,
      detected_at: new Date().toISOString(),
    });
    render(<KeyPermissionBadge apiKeyId="key-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("key-perm-pill-trade")).toHaveAttribute(
        "data-granted",
        "true",
      );
    });
    expect(screen.getByTestId("key-perm-pill-withdraw")).toHaveAttribute(
      "data-granted",
      "true",
    );
  });

  it("renders an error message when the API rejects", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: "Exchange permission probe failed" }),
    } as Response) as unknown as typeof fetch;

    render(<KeyPermissionBadge apiKeyId="key-1" />);
    await waitFor(() =>
      expect(
        screen.getByText(/Exchange permission probe failed/),
      ).toBeInTheDocument(),
    );
  });

  it("re-fetches on Re-check click", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          read: true,
          trade: false,
          withdraw: false,
          detected_at: new Date().toISOString(),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          read: true,
          trade: true,
          withdraw: false,
          detected_at: new Date().toISOString(),
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<KeyPermissionBadge apiKeyId="key-1" />);
    await waitFor(() =>
      expect(screen.getByTestId("key-perm-pill-trade")).toHaveAttribute(
        "data-granted",
        "false",
      ),
    );

    fireEvent.click(screen.getByTestId("key-permission-recheck"));

    await waitFor(() =>
      expect(screen.getByTestId("key-perm-pill-trade")).toHaveAttribute(
        "data-granted",
        "true",
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
