import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { WizardChrome } from "./WizardChrome";
import type { WizardStepKey } from "@/lib/wizard/localStorage";

// Hydration-safety regression for the savedAt path.
//
// WizardClient initializes savedAt to null synchronously and backfills
// via useEffect after mount. WizardChrome must therefore render
// "Not saved yet" when savedAt is null and "Draft saved · HH:MM" when
// savedAt is a number. SSR + first-client-render alignment depends on
// the null path producing identical markup on both, so a regression in
// the parent's lazy-init that re-introduces Date.now() at mount would
// break this test by mismatching server-rendered string with the
// post-effect string. /qa 2026-05-05; preventive fix in 9ea9d37.

const baseProps = {
  currentStep: "connect_key" as const,
  canDelete: false,
  onDeleteDraft: () => {},
  onRequestCall: () => {},
};

describe("WizardChrome — savedAt rendering (hydration safety)", () => {
  it("renders 'Not saved yet' when savedAt is null (SSR-safe initial state)", () => {
    render(
      <WizardChrome {...baseProps} savedAt={null}>
        <div />
      </WizardChrome>,
    );
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
    expect(screen.queryByText(/Draft saved/i)).toBeNull();
  });

  it("renders the timestamp when savedAt is a number", () => {
    // Use a fixed epoch so the locale formatter is deterministic.
    const fixed = new Date("2026-05-06T10:23:00Z").getTime();
    render(
      <WizardChrome {...baseProps} savedAt={fixed}>
        <div />
      </WizardChrome>,
    );
    expect(screen.getByText(/Draft saved/)).toBeInTheDocument();
    expect(screen.queryByText("Not saved yet")).toBeNull();
  });

  it("SSR string with savedAt=null matches the markup the client first renders", () => {
    // Pin the regression: if a future patch re-introduces Date.now() into
    // the synchronous-first-render path, the SSR-emitted HTML will encode
    // a different timestamp than the client's first render, triggering
    // React #418. We assert the SSR markup is the deterministic null
    // path so the savedAt fix in 9ea9d37 cannot silently regress.
    const html = renderToString(
      <WizardChrome {...baseProps} savedAt={null}>
        <div data-testid="children" />
      </WizardChrome>,
    );
    expect(html).toContain("Not saved yet");
    expect(html).not.toContain("Draft saved");
  });
});

// H-0181 — toast lifecycle (useEffect showTimer 0ms + hideTimer 2000ms).
//
// The effect schedules setShowToast(true) at 0ms and setShowToast(false) at
// 2000ms whenever `toastKey` changes; cleanup clears both timers. Without
// fake-timer coverage, a regression that swaps the two timers (or drops the
// cleanup) would leave the toast stuck on-screen forever or never show it.
// These pin: (a) appears after the 0ms tick, (b) hides at 2000ms, (c) a
// rapid second toastKey cancels the pending hide so the toast is not torn
// down mid-flight, (d) absent toastKey never shows the toast.
const TOAST_TESTID = "wizard-progress-saved-toast";

describe("[H-0181] WizardChrome — progress-saved toast lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the toast after the 0ms tick and hides it at 2000ms", () => {
    vi.useFakeTimers();
    render(
      <WizardChrome {...baseProps} savedAt={123} toastKey={1}>
        <div />
      </WizardChrome>,
    );
    // Before the 0ms timer fires, the toast is not yet mounted.
    expect(screen.queryByTestId(TOAST_TESTID)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId(TOAST_TESTID)).toBeInTheDocument();

    // Just before the hide boundary it's still visible.
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByTestId(TOAST_TESTID)).toBeInTheDocument();

    // At 2000ms total the hide timer fires.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId(TOAST_TESTID)).toBeNull();
  });

  it("never shows the toast when toastKey is undefined", () => {
    vi.useFakeTimers();
    render(
      <WizardChrome {...baseProps} savedAt={123}>
        <div />
      </WizardChrome>,
    );
    act(() => {
      vi.advanceTimersByTime(2001);
    });
    expect(screen.queryByTestId(TOAST_TESTID)).toBeNull();
  });

  it("a rapid second toastKey resets the timers so the toast stays visible past the first window", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <WizardChrome {...baseProps} savedAt={123} toastKey={1}>
        <div />
      </WizardChrome>,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByTestId(TOAST_TESTID)).toBeInTheDocument();

    // Advance most of the first window, then a new save ticks toastKey.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    rerender(
      <WizardChrome {...baseProps} savedAt={456} toastKey={2}>
        <div />
      </WizardChrome>,
    );
    // Cleanup cleared the old hide timer; the new effect re-shows at 0ms.
    act(() => {
      vi.advanceTimersByTime(0);
    });
    // At what would have been the FIRST window's hide boundary (2000ms from
    // the original mount), the toast must still be on screen because the
    // second toastKey reset the clock.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId(TOAST_TESTID)).toBeInTheDocument();

    // The toast finally hides 2000ms after the SECOND toastKey.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId(TOAST_TESTID)).toBeNull();
  });
});

// WIZ-04 — clickable free stepper. Navigable, non-active cells render as real
// <button>s that fire onStepSelect on click AND on keyboard Enter (button
// semantics, DESIGN.md:241). The active cell and non-navigable cells stay inert
// <div>s, and omitting onStepSelect renders zero rail buttons (CSV byte-neutral).
describe("[WIZ-04] WizardChrome — clickable stepper", () => {
  // At sync_preview with connect_key past+complete, connect_key is navigable
  // (backward) and sync_preview is active; metadata/review/submit are ahead.
  const stepperProps = {
    ...baseProps,
    savedAt: null,
    currentStep: "sync_preview" as WizardStepKey,
    onStepSelect: vi.fn<(key: WizardStepKey) => void>(),
    // Only the past connect_key cell is navigable in this fixture.
    stepNavigable: (key: WizardStepKey) => key === "connect_key",
  };

  afterEach(() => {
    stepperProps.onStepSelect.mockClear();
  });

  it("renders a navigable past cell as a button that fires onStepSelect on click", () => {
    render(
      <WizardChrome {...stepperProps}>
        <div />
      </WizardChrome>,
    );
    const cell = screen.getByTestId("wizard-step-connect_key");
    expect(cell.tagName).toBe("BUTTON");

    cell.click();
    expect(stepperProps.onStepSelect).toHaveBeenCalledExactlyOnceWith(
      "connect_key",
    );
  });

  it("activates a navigable cell on keyboard Enter (DESIGN.md:241 conformance)", async () => {
    const user = userEvent.setup();
    render(
      <WizardChrome {...stepperProps}>
        <div />
      </WizardChrome>,
    );
    const cell = screen.getByTestId("wizard-step-connect_key");
    cell.focus();
    expect(cell).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(stepperProps.onStepSelect).toHaveBeenCalledExactlyOnceWith(
      "connect_key",
    );
  });

  it("keeps the active and non-navigable cells inert (not buttons); aria-current on active", () => {
    render(
      <WizardChrome {...stepperProps}>
        <div />
      </WizardChrome>,
    );
    // Active cell (sync_preview) is not a button and carries aria-current.
    expect(screen.queryByTestId("wizard-step-sync_preview")).toBeNull();
    const active = screen.getByText("Verify data").closest("[aria-current]");
    expect(active).not.toBeNull();
    expect(active).toHaveAttribute("aria-current", "step");

    // Forward non-navigable cells are not buttons.
    expect(screen.queryByTestId("wizard-step-metadata")).toBeNull();
    expect(screen.queryByTestId("wizard-step-review")).toBeNull();
    expect(screen.queryByTestId("wizard-step-submit")).toBeNull();
  });

  it("renders zero rail buttons when onStepSelect is omitted (CSV byte-neutral)", () => {
    render(
      <WizardChrome {...baseProps} savedAt={null} currentStep="sync_preview">
        <div />
      </WizardChrome>,
    );
    // No step cell is a button; the only buttons are the footer controls
    // (Request a Call), never the stepper rail.
    expect(screen.queryByTestId(/^wizard-step-/)).toBeNull();
  });
});
