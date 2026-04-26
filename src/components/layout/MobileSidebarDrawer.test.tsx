import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
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
      <a href="/holdings">First focusable</a>
    </nav>
  ),
}));

function Harness({ open }: { open: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={triggerRef} type="button" data-testid="trigger">
        Hamburger
      </button>
      <MobileSidebarDrawer
        open={open}
        onClose={() => {}}
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
