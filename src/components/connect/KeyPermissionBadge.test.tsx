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
    // This repo has no global fetch-stub safety net and a leaked stub is its
    // known CI-only failure cause (CI runs Node 22, local runs Node 25).
    vi.unstubAllGlobals();
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
      statusText: "Bad Gateway",
      json: async () => ({ error: "Exchange permission probe failed" }),
    } as Response) as unknown as typeof fetch;

    render(<KeyPermissionBadge apiKeyId="key-1" />);
    await waitFor(() =>
      expect(
        screen.getByText(/Exchange permission probe failed/),
      ).toBeInTheDocument(),
    );
  });

  // When the upstream proxy returns an HTML error page (or gzip-corrupt
  // body), res.json() throws. Without status preservation the user sees
  // a generic "Probe failed" with no correlatable status code.
  it("falls back to HTTP status + statusText when JSON parse fails", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 504,
      statusText: "Gateway Timeout",
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    } as unknown as Response) as unknown as typeof fetch;

    render(<KeyPermissionBadge apiKeyId="key-1" />);
    await waitFor(() =>
      expect(
        screen.getByText(/HTTP 504 \(Gateway Timeout\)/),
      ).toBeInTheDocument(),
    );
  });

  // When the route returns a structured { error, code } payload (the new
  // PROBE_BACKEND_UNAVAILABLE shape), prepend the code so support can
  // grep for it in tickets without asking the user to copy the status.
  it("prepends the structured `code` field to the error message", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => ({
        error: "Could not reach the permissions service. Try again shortly.",
        code: "PROBE_BACKEND_UNAVAILABLE",
      }),
    } as Response) as unknown as typeof fetch;

    render(<KeyPermissionBadge apiKeyId="key-1" />);
    await waitFor(() =>
      expect(
        screen.getByText(
          /PROBE_BACKEND_UNAVAILABLE: Could not reach the permissions service/,
        ),
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

  // Phase 21 (ISSUE-002) — plain-English summary above the pills so a
  // glancing user does not need to parse three independent chip states
  // (color + glyph + strikethrough) to know whether the key is safe.
  // /qa 2026-05-05 surfaced this on the OKX factsheet step.
  describe("plain-English summary line (ISSUE-002)", () => {
    it("renders read-only success summary in accent color", async () => {
      mockFetchOnce({
        read: true,
        trade: false,
        withdraw: false,
        detected_at: new Date().toISOString(),
      });
      render(<KeyPermissionBadge apiKeyId="key-1" />);
      const summary = await screen.findByTestId("key-permission-summary");
      expect(summary).toHaveAttribute("data-state", "read-only");
      expect(summary.textContent).toContain("Read-only key confirmed");
      expect(summary.className).toMatch(/text-accent/);
      // Read-only is informational, not alarm — no role attr expected.
      expect(summary).not.toHaveAttribute("role");
    });

    it("renders wrong-scope warning when trade is granted", async () => {
      mockFetchOnce({
        read: true,
        trade: true,
        withdraw: false,
        detected_at: new Date().toISOString(),
      });
      render(<KeyPermissionBadge apiKeyId="key-1" />);
      const summary = await screen.findByTestId("key-permission-summary");
      expect(summary).toHaveAttribute("data-state", "wrong-scope");
      expect(summary.textContent).toContain("trade");
      expect(summary.textContent).toContain("Re-key as read-only");
      expect(summary.className).toMatch(/text-negative/);
      expect(summary).toHaveAttribute("role", "alert");
    });

    it("renders combined warning when trade AND withdraw are granted", async () => {
      mockFetchOnce({
        read: true,
        trade: true,
        withdraw: true,
        detected_at: new Date().toISOString(),
      });
      render(<KeyPermissionBadge apiKeyId="key-1" />);
      const summary = await screen.findByTestId("key-permission-summary");
      expect(summary).toHaveAttribute("data-state", "wrong-scope");
      expect(summary.textContent).toContain("trade and withdraw");
      expect(summary).toHaveAttribute("role", "alert");
    });

    it("renders revoked-key warning when read is missing", async () => {
      mockFetchOnce({
        read: false,
        trade: false,
        withdraw: false,
        detected_at: new Date().toISOString(),
      });
      render(<KeyPermissionBadge apiKeyId="key-1" />);
      const summary = await screen.findByTestId("key-permission-summary");
      expect(summary).toHaveAttribute("data-state", "wrong-scope");
      expect(summary.textContent).toContain("No read permission");
      expect(summary).toHaveAttribute("role", "alert");
    });

    // probe_error is set by the Python service's _FAIL_CLOSED payload
    // when the upstream exchange is unreachable. Without a dedicated
    // branch, the badge would mis-diagnose this as "key revoked" since
    // read/trade/withdraw all come back false in that payload.
    it("renders probe-error state when probe_error is true (exchange unreachable)", async () => {
      mockFetchOnce({
        read: false,
        trade: false,
        withdraw: false,
        probe_error: true,
        detected_at: new Date().toISOString(),
      });
      render(<KeyPermissionBadge apiKeyId="key-1" />);
      const summary = await screen.findByTestId("key-permission-summary");
      expect(summary).toHaveAttribute("data-state", "probe-error");
      expect(summary.textContent).toContain("Could not contact the exchange");
      expect(summary).toHaveAttribute("role", "alert");
    });
  });

  /**
   * [140.3-07 / SEAMUX-09 / B-26 live member 2] — correction C-5.
   *
   * The findings doc concluded "a class of ONE" by a syntax-shaped candidate
   * scan. Enumerated by BEHAVIOUR — "can this component render a fetched result
   * while an error is set?" — this component is a second live member: `load`
   * calls `setError(null)` and `setPerms(data)` but never `setPerms(null)`, and
   * `{loading && !perms && …}` / `{!loading && error && …}` / `{perms && …}` are
   * INDEPENDENT SIBLINGS with no guard-order exclusivity.
   *
   * So "Re-check" during an outage rendered the PREVIOUS Read/Trade/Withdraw
   * verdict beside the error. That is a stale SECURITY claim about a
   * money-bearing key, and it is worse than the stale allocation because the
   * user reads it as a current fact about their key's scope.
   *
   * The assertions query for the CHIPS, not for the error text: the hazard is
   * the stale verdict, and an error message says nothing about its absence.
   */
  describe("[140.3-07 / SEAMUX-09] a failed re-check discards the stale scope verdict", () => {
    function scopeChips() {
      return [
        screen.queryByTestId("key-perm-pill-read"),
        screen.queryByTestId("key-perm-pill-trade"),
        screen.queryByTestId("key-perm-pill-withdraw"),
      ].filter(Boolean);
    }

    async function renderWithVerdict() {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          read: true,
          trade: false,
          withdraw: false,
          detected_at: new Date().toISOString(),
        }),
      });
      vi.stubGlobal("fetch", fetchMock);
      render(<KeyPermissionBadge apiKeyId="key-1" />);
      await waitFor(() => expect(scopeChips()).toHaveLength(3));
      return fetchMock;
    }

    it("removes every Read/Trade/Withdraw chip when the re-check hits a breaker 503", async () => {
      const fetchMock = await renderWithVerdict();
      // The verdict is on screen and reads as a current fact before the failure.
      expect(screen.getByTestId("key-perm-pill-read")).toHaveAttribute(
        "data-granted",
        "true",
      );

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({
          error: "Could not check key scopes. Try again.",
          code: "PROBE_FAILED",
        }),
      });

      fireEvent.click(screen.getByTestId("key-permission-recheck"));

      await waitFor(() =>
        expect(screen.getByText(/PROBE_FAILED/)).toBeInTheDocument(),
      );

      // THE assertion: no stale security claim survives the failure.
      expect(scopeChips()).toHaveLength(0);
      expect(screen.queryByTestId("key-permission-summary")).toBeNull();
    });

    it("renders no scope verdict for the fail-closed 2xx `{}` the 140.3-03 route now answers", async () => {
      // 140.3-03 made `keys/[id]/permissions` fail CLOSED: an unreadable 2xx
      // upstream body is answered as 502 { error, code: "PROBE_FAILED" } and is
      // never cached. This component is that route's only consumer, so the two
      // fixes must agree — a fail-closed route in front of a component that
      // keeps showing the old verdict closes nothing.
      const fetchMock = await renderWithVerdict();

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => ({
          error: "Could not check key scopes. Try again.",
          code: "PROBE_FAILED",
        }),
      });

      fireEvent.click(screen.getByTestId("key-permission-recheck"));

      await waitFor(() =>
        expect(
          screen.getByText("PROBE_FAILED: Could not check key scopes. Try again."),
        ).toBeInTheDocument(),
      );
      expect(scopeChips()).toHaveLength(0);
    });

    it("does NOT render a raw caught message when the fetch itself rejects (B-27)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchMock = await renderWithVerdict();

      const raw = new TypeError(
        "NetworkError: connect ECONNREFUSED http://analytics.internal:8002/keys",
      );
      fetchMock.mockRejectedValueOnce(raw);

      fireEvent.click(screen.getByTestId("key-permission-recheck"));

      await waitFor(() =>
        expect(
          screen.getByText("We could not check this key's scopes. Use Re-check to try again."),
        ).toBeInTheDocument(),
      );

      // The raw value never reaches the DOM …
      expect(document.body.textContent).not.toContain("ECONNREFUSED");
      expect(document.body.textContent).not.toContain("analytics.internal");
      // … but it DOES reach the console, so debuggability was not traded away.
      expect(
        consoleSpy.mock.calls.find((call) => call.some((arg) => arg === raw)),
      ).toBeDefined();
      // And the stale verdict is discarded on this path too.
      expect(scopeChips()).toHaveLength(0);
    });

    it("ANTI-REGRESSION: a successful re-check renders the NEW verdict", async () => {
      const fetchMock = await renderWithVerdict();

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          read: true,
          trade: true,
          withdraw: false,
          detected_at: new Date().toISOString(),
        }),
      });

      fireEvent.click(screen.getByTestId("key-permission-recheck"));

      await waitFor(() =>
        expect(screen.getByTestId("key-perm-pill-trade")).toHaveAttribute(
          "data-granted",
          "true",
        ),
      );
      expect(scopeChips()).toHaveLength(3);
    });

    it("ANTI-REGRESSION: invalidating does not introduce a set-after-unmount", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise(() => {})),
      );
      const { unmount } = render(<KeyPermissionBadge apiKeyId="key-1" />);
      unmount();
      await Promise.resolve();
      await Promise.resolve();

      // The existing `mountedRef` guard must survive the invalidation edit.
      const warned = consoleSpy.mock.calls.some((call) =>
        call.some(
          (arg) =>
            typeof arg === "string" &&
            /unmounted|not wrapped in act|state update/i.test(arg),
        ),
      );
      expect(warned).toBe(false);
    });
  });
});
