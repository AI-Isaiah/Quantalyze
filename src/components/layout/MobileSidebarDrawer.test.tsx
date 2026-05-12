import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { MobileSidebarDrawer } from "./MobileSidebarDrawer";

/**
 * Phase 09.1 REVIEW WR-03 regression — MobileSidebarDrawer's
 * focus-restore effect must NOT fire on initial mount with open=false.
 *
 * Pre-fix:
 *   useEffect(() => {
 *     if (!open) {
 *       triggerRef.current?.focus();   // fires on initial mount!
 *       return;
 *     }
 *     // ...
 *   }, [open, onClose, triggerRef]);
 *
 * On every (dashboard) route entry on mobile, the hamburger received
 * focus before the user had interacted with the drawer at all — pulling
 * focus away from the route's natural tab-stop.
 *
 * Fix: track previous open state via a ref; only restore focus on the
 * actual close transition (open=true → open=false).
 *
 * Test: mount with open=false and assert triggerRef.focus() was NOT
 * called. Then transition open=false → true → false and assert focus IS
 * restored on the close transition.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/allocations",
}));

// The drawer mounts the full Sidebar internally — stub it so this test
// stays scoped to the focus-restore behavior under test.
vi.mock("./Sidebar", () => ({
  Sidebar: () => (
    <nav data-testid="sidebar-stub">
      <a href="/first" data-testid="first-link">First focusable</a>
      <a href="/middle" data-testid="middle-link">Middle</a>
      <a href="/last" data-testid="last-link">Last focusable</a>
    </nav>
  ),
}));

function Harness({
  open,
  onClose,
}: {
  open: boolean;
  onClose?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={triggerRef} type="button" data-testid="trigger">
        Hamburger
      </button>
      {/* Audit 2026-05-07 G11.C.2: a sibling outside the drawer that
          would receive focus if the trap leaked. The focus-trap test
          asserts focus never lands here. */}
      <button type="button" data-testid="outside-button">
        Outside the drawer
      </button>
      <MobileSidebarDrawer
        open={open}
        onClose={onClose ?? (() => {})}
        triggerRef={triggerRef}
        flaggedCount={0}
      />
    </div>
  );
}

describe("MobileSidebarDrawer — WR-03 focus restoration only on close transition", () => {
  it("does NOT focus the trigger on initial mount with open=false", () => {
    const { getByTestId } = render(<Harness open={false} />);
    const trigger = getByTestId("trigger") as HTMLButtonElement;
    // On initial mount with open=false, the effect runs but must skip
    // the focus call because there was no prior open=true state to
    // restore from. The active element should not be the trigger.
    expect(document.activeElement).not.toBe(trigger);
  });

  it("DOES focus the trigger when transitioning open=true → open=false (real close)", () => {
    const { getByTestId, rerender } = render(<Harness open={false} />);
    const trigger = getByTestId("trigger") as HTMLButtonElement;
    expect(document.activeElement).not.toBe(trigger);

    // Open the drawer — focus moves into the dialog (first focusable
    // link in the Sidebar stub). The exact target isn't asserted; we
    // just want to record that focus has left the trigger.
    rerender(<Harness open={true} />);

    // Now close the drawer (open=true → open=false). This is the
    // legitimate close transition; the trigger MUST receive focus so
    // keyboard users return to the hamburger.
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(trigger);
  });
});

/**
 * Audit 2026-05-07 G11.C.2 regression: the dialog declares
 * aria-modal="true" so WCAG 2.1.2 (No Keyboard Trap) and the ARIA
 * Authoring Practices for modal dialogs both require focus
 * containment when the dialog is open. Pre-audit code only handled
 * Escape — Tab leaked to the underlying-page elements behind the
 * backdrop. After the fix, Tab and Shift+Tab cycle within the panel.
 */
describe("MobileSidebarDrawer — G11.C.2 focus trap", () => {
  it("Tab from the LAST focusable wraps to the first (audit G11.C.2)", () => {
    const { getByTestId } = render(<Harness open={true} />);
    const lastLink = getByTestId("last-link") as HTMLAnchorElement;
    const firstLink = getByTestId("first-link") as HTMLAnchorElement;
    const outside = getByTestId("outside-button") as HTMLButtonElement;

    // Move focus to the last link in the drawer.
    lastLink.focus();
    expect(document.activeElement).toBe(lastLink);

    // Tab forward should wrap to the first link, NOT escape to the
    // outside-button (the bug pre-audit).
    fireEvent.keyDown(window, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(firstLink);
    expect(document.activeElement).not.toBe(outside);
  });

  it("Shift+Tab from the FIRST focusable wraps to the last (audit G11.C.2)", () => {
    const { getByTestId } = render(<Harness open={true} />);
    const firstLink = getByTestId("first-link") as HTMLAnchorElement;
    const lastLink = getByTestId("last-link") as HTMLAnchorElement;
    const trigger = getByTestId("trigger") as HTMLButtonElement;

    firstLink.focus();
    expect(document.activeElement).toBe(firstLink);

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastLink);
    // Specifically MUST NOT escape backwards to the trigger (the
    // pre-fix Tab leak direction).
    expect(document.activeElement).not.toBe(trigger);
  });

  it("focus trap is inactive when the drawer is closed (audit G11.C.2)", () => {
    // When the drawer is closed (open=false) the keydown handler is
    // unbound; Tab behaves natively. We verify by sending Tab and
    // asserting focus stays where the user left it (the focus trap
    // would have moved focus inside the panel).
    const { getByTestId } = render(<Harness open={false} />);
    const outside = getByTestId("outside-button") as HTMLButtonElement;
    outside.focus();
    expect(document.activeElement).toBe(outside);

    fireEvent.keyDown(window, { key: "Tab", shiftKey: false });
    // No drawer-bound handler should have fired; focus is unmoved.
    // (Native Tab traversal in jsdom doesn't move focus on its own.)
    expect(document.activeElement).toBe(outside);
  });
});
