/**
 * Phase 10 / Plan 07 — RED tests for ScenarioCommitDrawer.
 *
 *   T_D1  isOpen=false → returns null
 *   T_D2  isOpen=true  → backdrop + 720px panel + role=dialog + aria-label="Commit scenario" + aria-modal=true
 *   T_D3  Header copy "Commit scenario" + subtitle "{N} decisions to record · routed through the Bridge outcome graph"
 *   T_D4  Mixed diffs → 3 grouped sections (Holdings removed · 1 / Strategies added · 1 / Weight changes · 1)
 *   T_D5  Empty group hidden — single voluntary_remove → no "Strategies added" section
 *   T_D6  Each voluntary_remove row embeds RejectedForm
 *   T_D7  Each voluntary_add / voluntary_modify row embeds AllocatedForm
 *   T_D8  "Submit {N} decisions" button visible at footer
 *   T_D9  M11 — pre-flight modal a11y: clicking Submit opens pre-flight; only ONE
 *         role="dialog"+aria-modal="true" element in the DOM at preflight time
 *         (NOT 2). Pre-flight rendered via portal to document.body.
 *   T_D10 Pre-flight Submit → fetch called once with POST /api/allocator/scenario/commit + body { diffs }
 *   T_D11 H4 full success: {recorded:N, errors:[]} → drawer collapses to green
 *         confirmation card + onSubmitSuccess fires (after 1.5s timer)
 *   T_D12 H4 full failure: {recorded:0, errors:[{index:1, error:"…"}]} → drawer
 *         stays open, row[1] error rendered inline (role="alert"); onSubmitSuccess
 *         NOT called
 *   T_D13 onSubmitSuccess called only on full-success
 *   T_D14 Backdrop click → onClose
 *   T_D15 Esc key → onClose
 *   T_D16 Success → after 1.5s timer, onClose called automatically
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
  waitFor,
} from "@testing-library/react";
import type { ScenarioCommitDiff } from "./ScenarioComposer";

import { ScenarioCommitDrawer } from "./ScenarioCommitDrawer";

// M-5 (red-team): hoist module-level mock so captureToSentry calls are
// observable. Existing tests do NOT assert on Sentry, so this is additive-safe.
const drawerSentryCalls: Array<{ err: unknown; options: { level?: string; tags?: Record<string, string> } }> = [];
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, options: { level?: string; tags?: Record<string, string> }) => {
    drawerSentryCalls.push({ err, options });
  },
}));

const VR_DIFF: ScenarioCommitDiff = {
  kind: "voluntary_remove",
  holding_ref: "holding:binance:BTC:spot",
  size_at_decision_usd: 1000,
};
const VA_DIFF: ScenarioCommitDiff = {
  kind: "voluntary_add",
  strategy_id: "strat-uuid-1",
  size_at_decision_usd: 2000,
};
const VM_DIFF: ScenarioCommitDiff = {
  kind: "voluntary_modify",
  holding_ref: "holding:binance:ETH:spot",
  new_weight: 0.08,
  size_at_decision_usd: 8000,
};

const NOOP = () => {};

/**
 * Fill the per-row inline inputs for every diff so the Submit button
 * un-disables. Mirrors the user flow: voluntary_remove needs a rejection
 * reason; voluntary_add / bridge_recommended needs a percent allocated.
 * voluntary_modify needs no extra input.
 */
function fillRequiredInputs(diffs: ScenarioCommitDiff[]) {
  diffs.forEach((d, idx) => {
    if (d.kind === "voluntary_remove") {
      const sel = screen.getByTestId(
        `commit-rejection-${idx}`,
      ) as HTMLSelectElement;
      fireEvent.change(sel, { target: { value: "underperforming_peers" } });
    }
    if (d.kind === "voluntary_add" || d.kind === "bridge_recommended") {
      const inp = screen.getByTestId(
        `commit-percent-${idx}`,
      ) as HTMLInputElement;
      fireEvent.change(inp, { target: { value: "10" } });
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ===========================================================================
// T_D1
// ===========================================================================

describe("T_D1 isOpen=false", () => {
  it("returns null when isOpen is false", () => {
    const { container } = render(
      <ScenarioCommitDrawer
        isOpen={false}
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ===========================================================================
// T_D2 / T_D3 / T_D4 / T_D5 / T_D6 / T_D7 / T_D8
// ===========================================================================

describe("T_D2-T_D8 — drawer shell + grouped sections + form embedding + footer", () => {
  it("T_D2: drawer shell carries role='dialog', aria-label='Commit scenario', aria-modal='true', width=720", () => {
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: /Commit scenario/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Inline width style — UI-SPEC pins 720px
    expect((dialog as HTMLElement).style.width).toMatch(/720/);
  });

  it("T_D3: Header copy + subtitle render with diff count", () => {
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF, VA_DIFF, VM_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    expect(screen.getByText("Commit scenario")).toBeInTheDocument();
    expect(
      screen.getByText(/3 decisions to record · routed through the Bridge outcome graph/i),
    ).toBeInTheDocument();
  });

  it("T_D4: 3 sections render with per-kind counts", () => {
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF, VA_DIFF, VM_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    expect(screen.getByText(/Holdings removed · 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Strategies added · 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Weight changes · 1/i)).toBeInTheDocument();
  });

  it("T_D5: empty group is hidden", () => {
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    expect(screen.queryByText(/Strategies added/i)).toBeNull();
    expect(screen.queryByText(/Weight changes/i)).toBeNull();
  });

  it("T_D6: voluntary_remove row exposes a rejection-reason select", () => {
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    expect(screen.getByTestId("commit-rejection-0")).toBeInTheDocument();
  });

  it("T_D7: voluntary_add row exposes a percent-allocated input; voluntary_modify does not", () => {
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VA_DIFF, VM_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    expect(screen.getByTestId("commit-percent-0")).toBeInTheDocument();
    // voluntary_modify (idx 1) carries new_weight on the diff itself, so no
    // percent-allocated input is rendered for it.
    expect(screen.queryByTestId("commit-percent-1")).toBeNull();
  });

  it("T_D8: Submit button disabled until all required inputs filled, then shows count", () => {
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF, VA_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    const btn = screen.getByTestId("commit-drawer-submit") as HTMLButtonElement;
    expect(btn.textContent).toMatch(/Submit 2 decisions/i);
    // Initially disabled: no rejection_reason or percent_allocated entered.
    expect(btn.disabled).toBe(true);
    fillRequiredInputs([VR_DIFF, VA_DIFF]);
    expect(btn.disabled).toBe(false);
  });
});

// ===========================================================================
// T_D9 — M11 pre-flight modal a11y
// ===========================================================================

describe("T_D9 — M11 pre-flight modal a11y (portal'd, only ONE role=dialog at preflight time)", () => {
  it("clicking Submit opens pre-flight; DOM has exactly ONE role='dialog' aria-modal='true' element", () => {
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    // Pre-flight modal title visible
    expect(screen.getByText(/Submit 1 decision\?/i)).toBeInTheDocument();
    // CRITICAL: only ONE role="dialog" + aria-modal="true" in the DOM
    const modals = document.querySelectorAll(
      '[role="dialog"][aria-modal="true"]',
    );
    expect(modals.length).toBe(1);
  });
});

// ===========================================================================
// T_D10 — POST happens
// ===========================================================================

describe("T_D10 — fetch fires the right URL/body on pre-flight Submit", () => {
  it("calls fetch once with POST /api/allocator/scenario/commit + body { diffs }", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init: { method: string; body: string }) =>
        new Response(
          JSON.stringify({ recorded: 1, results: [{ index: 0 }], errors: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    // Pre-flight modal "Submit" button
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await act(async () => {
      // Allow the awaited fetch promise to resolve
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe("/api/allocator/scenario/commit");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body);
    expect(body.diffs).toHaveLength(1);
    expect(body.diffs[0].kind).toBe("voluntary_remove");
    // Drawer-collected user input MUST be merged into the wire shape.
    expect(body.diffs[0].rejection_reason).toBe("underperforming_peers");

    vi.unstubAllGlobals();
  });

  // B11 / NEW-C18-10: the drawer must forward the frozen holdings fingerprint
  // in the POST body so the RPC can reject a stale-draft commit (409).
  it("includes init_holdings_fingerprint in the body when the prop is supplied", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init: { method: string; body: string }) =>
        new Response(
          JSON.stringify({ recorded: 1, results: [{ index: 0 }], errors: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
        initHoldingsFingerprint="BTC:binance:spot"
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.init_holdings_fingerprint).toBe("BTC:binance:spot");

    vi.unstubAllGlobals();
  });

  it("OMITS init_holdings_fingerprint from the body when the prop is null (backward compat)", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init: { method: string; body: string }) =>
        new Response(
          JSON.stringify({ recorded: 1, results: [{ index: 0 }], errors: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
        // initHoldingsFingerprint omitted -> defaults to null
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect("init_holdings_fingerprint" in body).toBe(false);

    vi.unstubAllGlobals();
  });

  // B11 / NEW-C18-10: a 409 portfolio_fingerprint_stale response must render the
  // route's reload guidance (NOT a "malformed response" error), must NOT fire
  // onSubmitSuccess, and must disable the in-drawer retry (the frozen draft
  // diverges on every retry — only a reload resolves it).
  it("renders reload guidance + disables retry on a 409 portfolio_fingerprint_stale response", async () => {
    const onSubmitSuccess = vi.fn();
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "Portfolio changed since you started this scenario",
            detail:
              "Your holdings were updated after you opened this scenario. Refresh to load the latest holdings, then re-apply your changes.",
            code: "portfolio_fingerprint_stale",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
        initHoldingsFingerprint="BTC:binance:spot"
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Actionable reload copy is shown — NOT the "malformed response" string.
    const banner = screen.getByTestId("commit-drawer-error");
    expect(banner).toHaveTextContent(/Refresh to load the latest holdings/i);
    expect(banner).not.toHaveTextContent(/malformed response/i);
    // The stale conflict committed nothing → success must not fire.
    expect(onSubmitSuccess).not.toHaveBeenCalled();
    // Retry is futile for a stale conflict → the Submit button is disabled.
    expect(screen.getByTestId("commit-drawer-submit")).toBeDisabled();

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// T_D11 — H4 full success → green confirmation
// ===========================================================================

describe("T_D11 — H4 full success → green confirmation card visible", () => {
  // Use real timers for this case — waitFor relies on them, and the 1.5s
  // success-auto-close is short enough to advance via setTimeout polling
  // rather than via fake-timer juggling.
  it("recorded:N + errors:[] → drawer body collapses to confirmation; onSubmitSuccess fires after 1.5s timer", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          recorded: 1,
          results: [{ index: 0, kind: "voluntary_remove" }],
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={onClose}
        diffs={[VR_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(screen.getByText(/1 decisions recorded/i)).toBeInTheDocument();
    });

    // T_D16 — after 1.5s, onClose + onSubmitSuccess fire
    await waitFor(
      () => {
        expect(onSubmitSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// T_D12 / T_D13 — H4 full failure
// ===========================================================================

describe("T_D12 / T_D13 — H4 full failure (no partial state)", () => {
  it("recorded:0 + errors → drawer stays open; per-row error visible (role=alert); onSubmitSuccess NOT called", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          recorded: 0,
          results: [],
          errors: [{ index: 0, error: "Holding not owned by user" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Drawer body stays open (the success card is NOT shown)
    expect(screen.queryByTestId("commit-drawer-success")).toBeNull();
    // Inline error visible
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    expect(
      alerts.some((a) => /Holding not owned/i.test(a.textContent ?? "")),
    ).toBe(true);
    // onSubmitSuccess NOT called
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// T_D14 / T_D15 — backdrop click + Esc key
// ===========================================================================

describe("T_D14 / T_D15 — close paths", () => {
  it("T_D14: backdrop click → onClose", () => {
    const onClose = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={onClose}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fireEvent.click(screen.getByTestId("commit-drawer-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("T_D15: Esc key → onClose", () => {
    const onClose = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={onClose}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

// ===========================================================================
// P1934 — audit-2026-05-07 Block C / Task C.2
//
// AbortController on in-flight fetch + Esc-during-submit guard + strict
// success gate (recorded must match diffs.length) + Idempotency-Key header.
// ===========================================================================

describe("P1934 — Esc during submit must NOT close the drawer", () => {
  it("Esc keydown while state==='submitting' is ignored (onClose not called)", async () => {
    vi.useRealTimers();
    // Stall the fetch so the drawer sits in state==='submitting'.
    const fetchSpy = vi.fn(
      () =>
        new Promise(() => {
          /* never resolves — keep drawer in submitting state */
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onClose = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={onClose}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    // Click pre-flight Submit so state transitions to 'submitting' and
    // the never-resolving fetch is in flight.
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    // Yield once so the click handler swaps state to 'submitting'.
    await Promise.resolve();

    // Esc must be a no-op while submitting (P1934).
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("P1934 — unmount during in-flight fetch aborts the request", () => {
  it("unmounting the drawer mid-submit triggers AbortController.abort() on the in-flight fetch signal", async () => {
    vi.useRealTimers();
    let capturedSignal: AbortSignal | undefined;
    const fetchSpy = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) => {
        capturedSignal = init?.signal;
        return new Promise(() => {
          /* never resolves */
        });
      },
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { unmount } = render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await Promise.resolve();
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    // After unmount the cleanup effect should call abort() on the in-flight
    // signal so React doesn't leak a setState after unmount.
    expect(capturedSignal?.aborted).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("P1934 — strict success gate (recorded must equal diffs.length)", () => {
  it("server returns recorded:1 for 3 diffs → drawer enters 'failure' AND onSubmitSuccess NOT called", async () => {
    vi.useRealTimers();
    // Server claims partial success — pre-fix the drawer accepted any
    // `recorded > 0 && no errors` as full success; post-fix the gate
    // requires recorded === diffs.length.
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ recorded: 1, results: [], errors: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF, VA_DIFF, VM_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF, VA_DIFF, VM_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    // Drawer must NOT collapse to the success card. Use the testid (not a
    // text matcher) because the new partial-commit error message also
    // contains the substring "decisions recorded".
    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-success")).toBeNull();
    });
    // Wait a beat past any spurious timer to be sure onSubmitSuccess never
    // fired (the success branch has a 1.5s auto-close + onSubmitSuccess
    // call; failure has neither).
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// P1935 — audit-2026-05-07 Block C / Task C.3
//
// Pre-flight Submit must be disabled while a POST is in-flight so a rapid
// double-click can't fire two commits. The button text flips to "Submitting…".
// ===========================================================================

describe("P1935 — pre-flight Submit disabled during in-flight submit", () => {
  it("clicking pre-flight Submit twice synchronously only triggers ONE fetch (button must be disabled in DOM, not just unmounted)", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(
      () =>
        new Promise(() => {
          /* never resolves — keep drawer in submitting state */
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    // Capture the pre-flight Submit by exact label "Submit" before the
    // text flips to "Submitting…" mid-handler.
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    const preflight = preflightBtns[preflightBtns.length - 1] as HTMLButtonElement;

    // Fire two clicks SYNCHRONOUSLY without yielding to React between
    // them. The first click triggers handleSubmit (async) which calls
    // setState('submitting') AND fetch(). Before React can commit the
    // re-render, the second click also resolves and would call fetch
    // again — unless the button is `disabled` in DOM (which short-circuits
    // the click before React's synthetic event system reaches the handler).
    fireEvent.click(preflight);
    fireEvent.click(preflight);
    fireEvent.click(preflight);

    // Yield once so any pending microtasks resolve before the assertion.
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Button text should reflect the in-flight state per the C.3 contract.
    // (The portal stays mounted during 'submitting' so the button is still
    // queryable — assert that the captured node text flipped.)
    expect(preflight.textContent).toMatch(/Submitting…/);
    expect(preflight.disabled).toBe(true);

    vi.unstubAllGlobals();
  });
});

describe("P1934 — Idempotency-Key header on commit fetch", () => {
  it("fetch is called with an Idempotency-Key header per submit (Block D contract)", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ recorded: 1, results: [], errors: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    // Headers may be a plain object or a Headers instance — accept both.
    const init = (fetchSpy.mock.calls as unknown as Array<
      [string, { headers: Record<string, string> | Headers }]
    >)[0][1];
    const headers = init.headers;
    const getHeader = (k: string) =>
      headers instanceof Headers
        ? headers.get(k)
        : Object.entries(headers).find(
            ([name]) => name.toLowerCase() === k.toLowerCase(),
          )?.[1];
    expect(getHeader("Idempotency-Key")).toBeTruthy();

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// Idempotency-Key reuse across user-initiated retries
//
// The header exists to let the server dedupe — a fresh key on every retry
// of the same batch defeats it. Stable across the lifetime of one open
// batch; reset on close.
// ===========================================================================

function getIdempotencyHeader(call: unknown): string | null {
  const init = (call as [string, { headers: Record<string, string> | Headers }])[1];
  const headers = init.headers;
  if (headers instanceof Headers) return headers.get("Idempotency-Key");
  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "idempotency-key",
  );
  return entry ? entry[1] : null;
}

describe("Idempotency-Key reuse on retry within one batch", () => {
  it("two submits of the same batch send the SAME Idempotency-Key (server-side dedup contract)", async () => {
    vi.useRealTimers();
    let callCount = 0;
    const fetchSpy = vi.fn(async () => {
      callCount += 1;
      // First call fails (network), second call succeeds.
      if (callCount === 1) {
        return new Response("", { status: 502 });
      }
      return new Response(
        JSON.stringify({ recorded: 1, results: [], errors: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    let preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // Retry from the still-open pre-flight (state flipped to failure but
    // the portal stays mounted for "submitting"). The drawer's pre-flight
    // disappears on failure; re-open by clicking Submit-all then Submit
    // again.
    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-error")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    const k1 = getIdempotencyHeader(fetchSpy.mock.calls[0]);
    const k2 = getIdempotencyHeader(fetchSpy.mock.calls[1]);
    expect(k1).toBeTruthy();
    expect(k2).toBeTruthy();
    expect(k1).toBe(k2);

    vi.unstubAllGlobals();
  });

  it("crypto.randomUUID fallback path: when randomUUID is absent the header is still set", async () => {
    vi.useRealTimers();
    const originalCrypto = globalThis.crypto;
    // Force the fallback branch.
    Object.defineProperty(globalThis, "crypto", {
      value: { ...originalCrypto, randomUUID: undefined },
      configurable: true,
    });
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ recorded: 1, results: [], errors: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    const k = getIdempotencyHeader(fetchSpy.mock.calls[0]);
    expect(k).toBeTruthy();
    expect(k!.length).toBeGreaterThan(0);

    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    });
    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// Backdrop + X close during submit must be no-ops (same invariant as Esc).
// ===========================================================================

describe("close paths during submit", () => {
  it("backdrop click while state==='submitting' is ignored (onClose not called)", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onClose = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={onClose}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);
    await Promise.resolve();

    fireEvent.click(screen.getByTestId("commit-drawer-backdrop"));
    expect(onClose).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("X close button is disabled while state==='submitting'", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onClose = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={onClose}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);
    await Promise.resolve();

    const closeBtn = screen.getByRole("button", { name: /Close drawer/i }) as HTMLButtonElement;
    expect(closeBtn.disabled).toBe(true);
    fireEvent.click(closeBtn);
    expect(onClose).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// Strict success gate — additional cases:
//   - res.ok=false but recorded===diffs.length must still fail (T2)
//   - empty 200 body (server returned blank → JSON.parse throws) (T1a)
//   - HTML 502 body (non-JSON error page → JSON.parse throws)   (T1b)
// ===========================================================================

describe("strict success gate — non-2xx with matching recorded count", () => {
  it("res.ok=false with recorded===diffs.length still surfaces as failure (T2)", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ recorded: 1, results: [], errors: [] }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-success")).toBeNull();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("response body is not valid JSON", () => {
  it("empty body 200 → drawer surfaces failure (no JSON parse, no onSubmitSuccess) (T1a)", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-error")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("commit-drawer-success")).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("HTML 502 body → drawer surfaces failure, not silent network swallow (T1b)", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-error")).toBeInTheDocument();
    });
    // Error copy must reflect server-status (5xx), not network-failed.
    const err = screen.getByTestId("commit-drawer-error");
    expect(err.textContent).toMatch(/502|invalid response/i);
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// Partial-commit surfacing: recorded < diffs.length on a 2xx with no error
// list is a single-tx contract violation. Surface explicit "do NOT retry"
// copy so the user doesn't double-commit the rows that landed.
// ===========================================================================

describe("focus management — pre-flight portal + failure transition", () => {
  it("pre-flight portal traps Tab inside the modal (no escape to drawer beneath)", () => {
    vi.useRealTimers();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));

    // The pre-flight portal mounts with Cancel and Submit. Find them in
    // order — `getAllByRole` returns drawer Submit first, portal buttons
    // last because the portal is appended to document.body.
    const cancelBtn = screen.getByRole("button", { name: /^Cancel$/i });
    const submitBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    const submitBtn = submitBtns[submitBtns.length - 1];

    // Initial focus lands on the first focusable inside the portal (Cancel).
    expect(document.activeElement).toBe(cancelBtn);

    // Tab from Cancel → Submit
    submitBtn.focus();
    expect(document.activeElement).toBe(submitBtn);

    // Tab from Submit (the last focusable) wraps to Cancel.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancelBtn);

    // Shift+Tab from Cancel (the first focusable) wraps to Submit.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submitBtn);
  });

  // Real-timers + async focus chain occasionally exceeds the 5s default under
  // concurrent vitest worker load; passes in isolation. Bump for robustness.
  it("submitting → failure transition moves focus to the error banner", { timeout: 15_000 }, async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          recorded: 0,
          results: [],
          errors: [{ index: 0, error: "x" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    // After failure, focus must move to the error banner. Per-row errors
    // (index 0 → matches diff) don't trigger a top-level banner, so seed
    // an orphan error to force one. Re-run with that shape:
    vi.unstubAllGlobals();
    cleanup();
    const fetchSpy2 = vi.fn(async () =>
      new Response(
        JSON.stringify({
          recorded: 0,
          results: [],
          errors: [{ index: -1, error: "Network error" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy2);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns2 = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns2[preflightBtns2.length - 1]);

    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-error")).toBeInTheDocument();
    });
    expect(document.activeElement).toBe(
      screen.getByTestId("commit-drawer-error"),
    );

    vi.unstubAllGlobals();
  });
});

describe("partial-commit detection — over-recorded direction (server bug)", () => {
  it("recorded > diffs.length on a 2xx with no errors → flagged as contract violation with do-NOT-retry copy", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response(
        // 1 diff submitted, 5 reported recorded — server bug (double-count).
        JSON.stringify({ recorded: 5, results: [], errors: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-error")).toBeInTheDocument();
    });
    const err = screen.getByTestId("commit-drawer-error");
    expect(err.getAttribute("data-failure-reason")).toBe("partial");
    expect(err.textContent).toMatch(/do NOT retry/i);
    expect(err.textContent).toMatch(/over-recorded/i);
    expect(err.textContent).toMatch(/5 of 1/i);
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// F-07 regression — structural mismatch routes to "partial" not "generic"
//
// Before this fix: a response with recorded===diffs.length but wrong indices
// or kinds fell through to failureReason:"generic" which tells the user
// "retry is safe." After: isStructuralMismatch → failureReason:"partial".
// ===========================================================================

describe("F-07 — structural mismatch (right count, wrong indices) → partial failure (do NOT retry)", () => {
  it("server returns recorded:N with mismatched result indices → data-failure-reason='partial'", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response(
        // 2 diffs: index 0 and 1. Server returns index 1 twice (duplicate) —
        // count matches (2) but index 0 is absent. Structural mismatch.
        JSON.stringify({
          recorded: 2,
          results: [
            { index: 1, kind: "voluntary_add", match_decision_id: "a", bridge_outcome_id: "b" },
            { index: 1, kind: "voluntary_add", match_decision_id: "c", bridge_outcome_id: "d" },
          ],
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF, VA_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF, VA_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-error")).toBeInTheDocument();
    });
    const err = screen.getByTestId("commit-drawer-error");
    // F-07: structural mismatch must use failureReason="partial" ("do NOT retry")
    // not failureReason="generic" ("retry is safe").
    expect(err.getAttribute("data-failure-reason")).toBe("partial");
    // onSubmitSuccess must NOT fire.
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("server returns recorded:N with kind mismatch → data-failure-reason='partial'", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response(
        // 1 diff: voluntary_remove. Server returns index 0 with wrong kind.
        JSON.stringify({
          recorded: 1,
          results: [
            { index: 0, kind: "voluntary_add", match_decision_id: "a", bridge_outcome_id: "b" },
          ],
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-error")).toBeInTheDocument();
    });
    const err = screen.getByTestId("commit-drawer-error");
    expect(err.getAttribute("data-failure-reason")).toBe("partial");
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("Idempotency-Key reset on close → reopen (new batch gets a fresh key)", () => {
  it("closing the drawer and reopening with the same diffs content mints a NEW key", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ recorded: 0, results: [], errors: [{ index: 0, error: "x" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { rerender } = render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    let preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    // Close, then reopen — same diffs reference, but isOpen flips, which
    // is the "new batch starts" signal.
    rerender(
      <ScenarioCommitDrawer
        isOpen={false}
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );
    rerender(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={NOOP}
      />,
    );

    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    const k1 = getIdempotencyHeader(fetchSpy.mock.calls[0]);
    const k2 = getIdempotencyHeader(fetchSpy.mock.calls[1]);
    expect(k1).toBeTruthy();
    expect(k2).toBeTruthy();
    expect(k1).not.toBe(k2);

    vi.unstubAllGlobals();
  });
});

describe("partial-commit detection (server returned ok with recorded < diffs.length)", () => {
  it("surfaces an explicit do-NOT-retry message and tags the error region with data-failure-reason='partial'", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({ recorded: 1, results: [{ index: 0 }], errors: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF, VA_DIFF, VM_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF, VA_DIFF, VM_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-error")).toBeInTheDocument();
    });
    const err = screen.getByTestId("commit-drawer-error");
    expect(err.getAttribute("data-failure-reason")).toBe("partial");
    expect(err.textContent).toMatch(/do NOT retry/i);
    expect(err.textContent).toMatch(/1 of 3/i);
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// AbortError mid-fetch (without unmount). The catch branch swallows
// AbortError so the destroyed component doesn't setState — but with the
// drawer still mounted, the swallow must not leave the UI in a stale
// "submitting" state forever. Verifies the swallow keeps the drawer alive.
// ===========================================================================

describe("AbortError swallow leaves the drawer alive (does not transition to failure)", () => {
  it("fetch rejecting with AbortError does not flip state to failure", async () => {
    vi.useRealTimers();
    // Reject directly with an AbortError so the catch branch's
    // `err instanceof DOMException && err.name === "AbortError"` swallow
    // fires without needing to plumb dispatchEvent through jsdom's
    // AbortSignal implementation.
    const fetchSpy = vi.fn(
      async (_url: string, init: { signal?: AbortSignal }) => {
        // Mirror native fetch: when the signal is already aborted OR an
        // abort is triggered, throw an AbortError. Throw immediately here.
        const _ = init?.signal;
        throw new DOMException("aborted", "AbortError");
      },
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF]}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs([VR_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    // Allow the rejected fetch + catch branch to run.
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByTestId("commit-drawer-error")).toBeNull();
    expect(onSubmitSuccess).not.toHaveBeenCalled();
    // Pin the documented invariant: with no successor submit, the swallow
    // path leaves the drawer in `submitting` state. The pre-flight portal
    // stays mounted with the "Submitting…" button label. A future caller
    // that aborts via any path OTHER than a new submit / unmount would
    // strand the drawer, so this test guards that contract — if it ever
    // changes, the documented abort callers must change too.
    const submittingBtn = screen.queryByRole("button", { name: /Submitting…/i });
    expect(submittingBtn).not.toBeNull();
    expect((submittingBtn as HTMLButtonElement).disabled).toBe(true);

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// NEW-C18-12 — structural success gate: right count / wrong index must fail
//
// Before this fix fullSuccess was gated only on `recorded === diffs.length`.
// A server bug that records N rows but with wrong indices/kinds would still
// produce `recorded=N` and the drawer would collapse to the success card,
// silently accepting a commit that skipped one diff and double-recorded another.
// The structural check asserts that `result[i].index ∈ {0..length-1}` and
// `result[i].kind === diffs[result[i].index].kind`.
// ===========================================================================

describe("NEW-C18-12 — structural success gate: right count / wrong index rejects", () => {
  it("server returns recorded=N with mismatched result.index → failure, onSubmitSuccess NOT called", async () => {
    vi.useRealTimers();
    const diffs = [VR_DIFF, VA_DIFF]; // 2 diffs: indices 0, 1

    // Server returns recorded=2 (matching count) but result indices are
    // [0, 2] — index 2 does not exist in a 2-diff batch (max valid = 1).
    // This simulates a server off-by-one or wrong-index bug.
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          recorded: 2,
          results: [
            { index: 0, kind: "voluntary_remove" },
            { index: 2, kind: "voluntary_add" }, // invalid index
          ],
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={diffs}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs(diffs);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    await waitFor(() => {
      // The success card must NOT appear — structural mismatch is a failure.
      expect(screen.queryByTestId("commit-drawer-success")).toBeNull();
    });
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("server returns recorded=N with wrong kind on a result → failure, onSubmitSuccess NOT called", async () => {
    vi.useRealTimers();
    const diffs = [VR_DIFF, VA_DIFF]; // index 0 = voluntary_remove, index 1 = voluntary_add

    // Server returns correct indices but swapped kinds.
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          recorded: 2,
          results: [
            { index: 0, kind: "voluntary_add" }, // wrong kind for index 0
            { index: 1, kind: "voluntary_remove" }, // wrong kind for index 1
          ],
          errors: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const onSubmitSuccess = vi.fn();
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={diffs}
        onSubmitSuccess={onSubmitSuccess}
      />,
    );
    fillRequiredInputs(diffs);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-success")).toBeNull();
    });
    expect(onSubmitSuccess).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// M-5 (red-team) — Sentry capture for non-ok responses with structural mismatch
//
// Before: isStructuralMismatch and isContractViolation both require res.ok=true,
// so a server returning HTTP 500 with a structurally-wrong results body would
// reach the Sentry block but fire no event — silently swallowed.
// After: an additional else-if branch captures a level:"warning" Sentry event
// for non-ok responses that still carry a structurally-wrong results array.
// ===========================================================================
describe("M-5 (red-team) — non-ok response with structural mismatch fires Sentry warning", () => {
  beforeEach(() => {
    // Clear the shared collector between tests.
    drawerSentryCalls.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("HTTP 500 with structurally-wrong results array fires captureToSentry at level:warning", async () => {
    vi.useRealTimers();
    // Server returns 500 (non-ok) but still populates a results array with
    // duplicate indices — structural mismatch + non-ok. The previous code
    // silently swallowed this with no Sentry event.
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          recorded: 2,
          results: [
            { index: 1, kind: "voluntary_add", match_decision_id: "a", bridge_outcome_id: "b" },
            { index: 1, kind: "voluntary_add", match_decision_id: "c", bridge_outcome_id: "d" },
          ],
          errors: ["internal server error"],
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VR_DIFF, VA_DIFF]}
        onSubmitSuccess={vi.fn()}
      />,
    );
    fillRequiredInputs([VR_DIFF, VA_DIFF]);
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await waitFor(() => {
      expect(screen.queryByTestId("commit-drawer-error")).toBeInTheDocument();
    });

    // M-5: the Sentry capture must have fired with level:"warning" for this
    // non-ok + structural-mismatch combination.
    const warnCalls = drawerSentryCalls.filter(
      (c) =>
        c.options.level === "warning" &&
        c.options.tags?.["check"] === "C18-12-nonok",
    );
    expect(warnCalls.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// NEW-C18-06 (B1, audit-2026-05-07) — percent_allocated and
// size_at_decision_usd cannot disagree on the wire
// ===========================================================================

describe("NEW-C18-06 — drawer recomputes size_at_decision_usd from edited percent_allocated", () => {
  // The composer emits voluntary_add diffs with size = composer-time
  // weight × scenarioAum. If the drawer then lets the user edit the
  // percent without recomputing the size, the wire shape ships an
  // inconsistent pair (new percent, old size). The server-side
  // audit-trust recompute (NEW-C18-04) is the authoritative integrity
  // gate, but the client-side audit sidecar (`size_at_decision_usd_client`)
  // is what forensic queries compare against `percent_allocated` — they
  // must stay coherent at the boundary.

  it("voluntary_add: user edits percent from default → size recomputed via scenarioAum prop", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, init: { method: string; body: string }) =>
        new Response(
          JSON.stringify({
            recorded: 1,
            results: [{ index: 0, kind: "voluntary_add" }],
            errors: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    // Composer-time size on the diff is 2000 (e.g. 20% × $10k).
    // Drawer prop scenarioAum = 10_000.
    // User types percent=25 → expected size = 0.25 × 10_000 = 2_500.
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VA_DIFF]}
        scenarioAum={10_000}
        onSubmitSuccess={NOOP}
      />,
    );

    const percentInput = screen.getByTestId("commit-percent-0") as HTMLInputElement;
    fireEvent.change(percentInput, { target: { value: "25" } });

    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.diffs[0].kind).toBe("voluntary_add");
    expect(body.diffs[0].percent_allocated).toBe(25);
    // The fix: size_at_decision_usd recomputed from percent × scenarioAum,
    // NOT the composer-time 2000.
    expect(body.diffs[0].size_at_decision_usd).toBe(2_500);

    vi.unstubAllGlobals();
  });

  it("voluntary_add: user does NOT edit percent → no recompute (would be undefined; defaults to 10 from helper)", async () => {
    // Sanity boundary: the drawer's fillRequiredInputs helper enters
    // percent=10, so when scenarioAum=10_000 the recompute fires
    // (percent IS defined). Result: size = 0.10 × 10_000 = 1_000,
    // overriding the composer-time 2000 on the diff. This is the
    // intended behavior — any time percent_allocated is set, the wire
    // shape's size is derived from it deterministically.
    const fetchSpy = vi.fn(
      async (_url: string, init: { method: string; body: string }) =>
        new Response(
          JSON.stringify({
            recorded: 1,
            results: [{ index: 0, kind: "voluntary_add" }],
            errors: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VA_DIFF]}
        scenarioAum={10_000}
        onSubmitSuccess={NOOP}
      />,
    );

    fillRequiredInputs([VA_DIFF]);

    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.diffs[0].percent_allocated).toBe(10);
    expect(body.diffs[0].size_at_decision_usd).toBe(1_000);

    vi.unstubAllGlobals();
  });

  it("voluntary_add: scenarioAum=0 → fallback to composer-time size (avoids server divide-by-zero gate)", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, init: { method: string; body: string }) =>
        new Response(
          JSON.stringify({
            recorded: 1,
            results: [{ index: 0, kind: "voluntary_add" }],
            errors: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    // When scenarioAum is 0 (all live holdings toggled off, but the
    // composer let voluntary_adds through because they have explicit
    // sizes), the drawer must NOT emit size=0 — that would hit the
    // server-side scenarioAum-gt-0 gate and reject the whole batch.
    render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[VA_DIFF]}
        scenarioAum={0}
        onSubmitSuccess={NOOP}
      />,
    );

    fillRequiredInputs([VA_DIFF]);

    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    // size_at_decision_usd preserves the composer-time 2000 because
    // scenarioAum=0 disables the recompute path.
    expect(body.diffs[0].size_at_decision_usd).toBe(2000);

    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// M-0095 / M-0094 — per-row audit input is bound to the diff's STABLE identity
// (diffKey), not its array position, so a `diffs` reorder while the drawer is
// open cannot rebind a note/reason to the wrong row (and the persistent
// bridge_outcomes audit metadata stays correct). The render loops also drop the
// O(N²) `diffs.indexOf(d)` (M-0094). The production composer freezes its
// commitDiffs snapshot so this reorder isn't reachable today; these tests pin
// the drawer's reorder-safe CONTRACT directly via a prop reorder.
// ===========================================================================
describe("M-0095 — per-row audit input follows diff identity across a reorder", () => {
  const BTC: ScenarioCommitDiff = {
    kind: "voluntary_remove",
    holding_ref: "holding:binance:BTC:spot",
    size_at_decision_usd: 1000,
  };
  const ETH: ScenarioCommitDiff = {
    kind: "voluntary_remove",
    holding_ref: "holding:binance:ETH:spot",
    size_at_decision_usd: 500,
  };

  const rowByRef = (container: HTMLElement, ref: string) =>
    Array.from(container.querySelectorAll("li")).find((li) =>
      li.textContent?.includes(ref),
    ) as HTMLLIElement;

  it("a typed note tracks its diff (not the array slot) after the diffs reorder", () => {
    const { rerender, container } = render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[BTC, ETH]}
        onSubmitSuccess={NOOP}
      />,
    );
    const btcNote = container.querySelector(
      'li[data-diff-index="0"] textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(btcNote, { target: { value: "exit BTC — thesis broke" } });

    // Reorder the diffs while the drawer stays open (isOpen never flips, so
    // perRow is NOT reset).
    rerender(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[ETH, BTC]}
        onSubmitSuccess={NOOP}
      />,
    );

    // BTC is now at array index 1, but its note must still read back; the ETH
    // row (now index 0) must NOT have inherited it. With the pre-fix index
    // keying the value would have stayed on the slot and swapped onto ETH.
    expect(
      (rowByRef(container, "BTC").querySelector("textarea") as HTMLTextAreaElement)
        .value,
    ).toBe("exit BTC — thesis broke");
    expect(
      (rowByRef(container, "ETH").querySelector("textarea") as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });

  it("the committed POST body ships each note with its own holding after a reorder (audit metadata not swapped)", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init: { method: string; body: string }) =>
        new Response(
          JSON.stringify({
            recorded: 2,
            results: [{ index: 0 }, { index: 1 }],
            errors: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { rerender, container } = render(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[BTC, ETH]}
        onSubmitSuccess={NOOP}
      />,
    );
    // Fill both reasons (allFilled gate) + DISTINCT notes per holding.
    fireEvent.change(screen.getByTestId("commit-rejection-0"), {
      target: { value: "underperforming_peers" },
    });
    fireEvent.change(screen.getByTestId("commit-rejection-1"), {
      target: { value: "underperforming_peers" },
    });
    fireEvent.change(
      container.querySelector('li[data-diff-index="0"] textarea') as HTMLTextAreaElement,
      { target: { value: "btc-note" } },
    );
    fireEvent.change(
      container.querySelector('li[data-diff-index="1"] textarea') as HTMLTextAreaElement,
      { target: { value: "eth-note" } },
    );

    // Reorder, then submit.
    rerender(
      <ScenarioCommitDrawer
        isOpen
        onClose={NOOP}
        diffs={[ETH, BTC]}
        onSubmitSuccess={NOOP}
      />,
    );
    fireEvent.click(screen.getByTestId("commit-drawer-submit"));
    const preflightBtns = screen.getAllByRole("button", { name: /^Submit$/i });
    fireEvent.click(preflightBtns[preflightBtns.length - 1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const btcOut = body.diffs.find((d: { holding_ref?: string }) =>
      d.holding_ref?.includes("BTC"),
    );
    const ethOut = body.diffs.find((d: { holding_ref?: string }) =>
      d.holding_ref?.includes("ETH"),
    );
    // The note must travel with its holding, not the (reordered) array slot —
    // pre-fix index keying swaps these onto the wrong bridge_outcome.
    expect(btcOut.note).toBe("btc-note");
    expect(ethOut.note).toBe("eth-note");

    vi.unstubAllGlobals();
  });
});
