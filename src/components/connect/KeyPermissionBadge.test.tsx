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

  /**
   * [162-09 / HONEST-02] — a failed probe may not present any scope as detected.
   *
   * Live PROD QA 2026-08-25 observed, on ONE screen simultaneously:
   *   "Could not contact the exchange to verify scopes."
   *   "Read ✓  Trade ✓  Withdraw ✓ — Detected 1m ago from the exchange."
   * The plain-English summary branched on `probe_error`; the three scope chips
   * and the "Detected … from the exchange" caption rendered unconditionally.
   *
   * The severity is the DIRECTION of the falsehood: Trade ✓ / Withdraw ✓ renders
   * directly beneath the connect form's own copy "Only read-only keys are
   * accepted. Keys with trading or withdrawal permissions will be rejected."
   * A user who believes the chips concludes their read-only key can withdraw
   * funds; a user who believes the copy concludes the app is broken. No reading
   * leaves them correctly informed.
   *
   * These assertions therefore query the CHIPS and the CAPTION. The pre-existing
   * probe-error assertion on `key-permission-summary` above passes against the
   * BROKEN behaviour and cannot stand in for them.
   *
   * CONSUMER SWEEP (162-09 Task 2) — the class is closed, and it is a class of
   * ONE. `grep -rna probe_error src analytics-service` returns exactly one
   * component hit (this one); every other TS hit is a route, a schema, or a
   * spec. `grep -rna detected_at src --include="*.tsx"` likewise returns only
   * this component and its spec — no other surface renders a "detected at"
   * claim about a key probe. `KeyPermissionBadge` itself has two render sites,
   * `strategies/[id]/edit/page.tsx:84` and `wizard/steps/SyncPreviewStep.tsx:2546`
   * (the composite branch deliberately omits it), and both inherit the gate
   * from the component — there is no second, independently-gated copy.
   * `WithdrawalWarningStrip.tsx` names Trade/Withdraw but states the POLICY
   * ("keys with Trade or Withdraw permissions are refused"), never a detected
   * fact — it is the copy these chips were contradicting, not a second
   * offender. `finalize-wizard/route.ts:946` reads `probe_error` server-side
   * and already branches on it (→ KEY_NETWORK_TIMEOUT), so the wizard's error
   * surface asserts no scope either. Scope ENFORCEMENT is untouched throughout.
   */
  describe("[162-09] a failed probe presents no scope as detected", () => {
    // Non-null scope values, deliberately in the dangerous direction: an
    // unusable upstream body claiming the key can trade AND withdraw. Under
    // `probe_error` none of it is knowable, so none of it may be shown.
    const PROBE_ERROR_WITH_SCOPES = {
      read: true,
      trade: true,
      withdraw: true,
      probe_error: true,
      detected_at: new Date().toISOString(),
    };

    function chips() {
      return ["read", "trade", "withdraw"].map((scope) =>
        screen.getByTestId(`key-perm-pill-${scope}`),
      );
    }

    it("K-1a: renders no chip as granted or denied — every chip is unknown", async () => {
      mockFetchOnce(PROBE_ERROR_WITH_SCOPES);
      render(<KeyPermissionBadge apiKeyId="key-1" />);
      await screen.findByTestId("key-permission-summary");

      for (const chip of chips()) {
        expect(chip).toHaveAttribute("data-granted", "unknown");
        // Neither verdict glyph: ✓ is the false claim and ✗ is the opposite
        // false claim. A probe that did not answer supports neither.
        expect(chip.textContent).not.toContain("✓");
        expect(chip.textContent).not.toContain("✗");
        // A screen reader must hear the unknown too — status is never carried
        // by color, and "granted"/"not granted" is the same lie in text.
        expect(chip.getAttribute("aria-label")).toMatch(/unknown/);
        expect(chip.getAttribute("aria-label")).not.toMatch(/granted/);
        // UI-SPEC C-3/C-4: colorless absence. Absence is not an error, so no
        // red — and no accent either, which would read as "this is fine".
        expect(chip.className).not.toMatch(/text-negative/);
        expect(chip.className).not.toMatch(/text-accent/);
      }
    });

    it("K-1b: renders no 'Detected … from the exchange' freshness caption", async () => {
      mockFetchOnce(PROBE_ERROR_WITH_SCOPES);
      const { container } = render(<KeyPermissionBadge apiKeyId="key-1" />);
      await screen.findByTestId("key-permission-summary");

      // The freshness claim is the caption's <time> plus its trailing clause.
      // ("Detected" alone would also match the panel heading "Detected key
      // scopes", which is a label, not a claim about this probe.)
      expect(container.querySelector("time")).toBeNull();
      expect(document.body.textContent).not.toContain("from the exchange");
    });

    it("K-1c: the contradiction observed in PROD has no render path", async () => {
      mockFetchOnce(PROBE_ERROR_WITH_SCOPES);
      render(<KeyPermissionBadge apiKeyId="key-1" />);
      const summary = await screen.findByTestId("key-permission-summary");

      // The screen says it could not read the scopes …
      expect(summary.textContent).toContain("Could not contact the exchange");
      // … so nothing else on that same screen may assert one.
      const body = document.body.textContent ?? "";
      expect(body).not.toContain("Read ✓");
      expect(body).not.toContain("Trade ✓");
      expect(body).not.toContain("Withdraw ✓");
    });

    it("K-2: a successful probe still renders the chips AND the caption", async () => {
      mockFetchOnce({
        read: true,
        trade: false,
        withdraw: false,
        detected_at: new Date().toISOString(),
      });
      const { container } = render(<KeyPermissionBadge apiKeyId="key-1" />);
      await waitFor(() =>
        expect(screen.getByTestId("key-perm-pill-read")).toHaveAttribute(
          "data-granted",
          "true",
        ),
      );
      expect(screen.getByTestId("key-perm-pill-trade")).toHaveAttribute(
        "data-granted",
        "false",
      );
      expect(screen.getByTestId("key-perm-pill-read").textContent).toContain(
        "✓",
      );
      // The gate is error-scoped, not a chip deletion: on the path where the
      // freshness claim is true, it survives untouched.
      expect(container.querySelector("time")).not.toBeNull();
      expect(document.body.textContent).toContain("from the exchange");
    });

    it("K-3: the probe-error summary sentence is unchanged beside the unknown chips", async () => {
      mockFetchOnce(PROBE_ERROR_WITH_SCOPES);
      render(<KeyPermissionBadge apiKeyId="key-1" />);
      const summary = await screen.findByTestId("key-permission-summary");
      expect(summary).toHaveAttribute("data-state", "probe-error");
      // Byte-exact: this sentence was already honest and must not drift.
      expect(summary.textContent).toBe(
        "Could not contact the exchange to verify scopes. Try the Re-check button in a moment.",
      );
      expect(summary).toHaveAttribute("role", "alert");
      // One honest message, and no second claim standing beside it.
      expect(chips()).toHaveLength(3);
    });
  });
});
