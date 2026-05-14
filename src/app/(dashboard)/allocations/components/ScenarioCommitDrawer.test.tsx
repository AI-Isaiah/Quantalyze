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

    vi.unstubAllGlobals();
  });
});

