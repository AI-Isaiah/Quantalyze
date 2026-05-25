/** @vitest-environment jsdom */
/**
 * H-0179 — DesktopGate submit-on-narrow-viewport path.
 *
 * The audit flagged the hard-coded `wizard_session_id: "desktop-gate"` as a
 * value that would fail a server-side UUID check and silently 400 every
 * submit. That claim does not hold against the actual server contract: the
 * for-quants-lead route validates wizard_session_id with
 * `z.string().min(8).max(64)` (NOT a UUID regex — see
 * src/app/api/for-quants-lead/route.ts:161). "desktop-gate" is 12 chars and
 * `step: "connect_key"` is a valid WizardStepKey, so the body is ACCEPTED.
 *
 * These tests therefore assert the CORRECT, currently-passing behavior:
 *   (a) matchMedia gating flips the gate on/off correctly,
 *   (b) the POST body conforms to the for-quants-lead schema (in particular
 *       the wizard_session_id length window the route enforces).
 * A regression that shortens wizard_session_id below 8 chars, drops a
 * required field, or breaks the matchMedia wiring fails here.
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DesktopGate } from "./DesktopGate";

type MqlListener = (e: MediaQueryListEvent) => void;

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<MqlListener>();
  const mql = {
    get matches() {
      return matches;
    },
    media: "(max-width: 639px)",
    addEventListener: (_: string, cb: MqlListener) => listeners.add(cb),
    removeEventListener: (_: string, cb: MqlListener) => listeners.delete(cb),
    // Legacy API some libs poke at — harmless no-ops here.
    addListener: (cb: MqlListener) => listeners.add(cb),
    removeListener: (cb: MqlListener) => listeners.delete(cb),
    dispatchEvent: () => true,
    onchange: null,
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn(() => mql),
  });
  return {
    fire(next: boolean) {
      matches = next;
      const evt = { matches: next } as MediaQueryListEvent;
      for (const cb of listeners) cb(evt);
    },
  };
}

describe("[H-0179] DesktopGate — narrow viewport gating + submit path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders children (not the gate) on a wide viewport", () => {
    installMatchMedia(false);
    render(
      <DesktopGate>
        <div data-testid="wizard-children">wizard body</div>
      </DesktopGate>,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId("wizard-children")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-desktop-gate")).toBeNull();
  });

  it("flips to the gate when matchMedia reports a narrow viewport", () => {
    const mm = installMatchMedia(false);
    render(
      <DesktopGate>
        <div data-testid="wizard-children">wizard body</div>
      </DesktopGate>,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId("wizard-children")).toBeInTheDocument();

    // Cross the breakpoint: the change handler must swap children for the gate.
    act(() => {
      mm.fire(true);
    });
    expect(screen.getByTestId("wizard-desktop-gate")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-children")).toBeNull();
  });

  it("POSTs a schema-conformant body to /api/for-quants-lead on submit", async () => {
    installMatchMedia(true);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    render(
      <DesktopGate>
        <div>wizard body</div>
      </DesktopGate>,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });

    const input = screen.getByPlaceholderText("you@firm.com") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "lead@firm.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send me a resume link/i }));

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/for-quants-lead");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as {
      name: string;
      firm: string;
      email: string;
      wizard_context: {
        step: string;
        draft_strategy_id: string | null;
        wizard_session_id: string;
      };
    };
    expect(body.email).toBe("lead@firm.com");
    expect(body.name.length).toBeGreaterThan(0);
    expect(body.firm.length).toBeGreaterThan(0);
    expect(body.wizard_context.step).toBe("connect_key");
    expect(body.wizard_context.draft_strategy_id).toBeNull();
    // Server contract: z.string().min(8).max(64). This is the exact window
    // the audit claimed was a UUID check; pin the real constraint so a
    // regression that shortens the sentinel below 8 chars is caught.
    const sid = body.wizard_context.wizard_session_id;
    expect(sid.length).toBeGreaterThanOrEqual(8);
    expect(sid.length).toBeLessThanOrEqual(64);
  });
});
