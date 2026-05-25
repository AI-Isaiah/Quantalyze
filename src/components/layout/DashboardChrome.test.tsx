import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import { DashboardChrome } from "./DashboardChrome";
import {
  AllocationProvider,
  useFlaggedCountStore,
} from "@/app/(dashboard)/allocations/AllocationContext";

/**
 * Phase 09.1 Plan 11 / R5 — DashboardChrome flagged-count badge tests.
 *
 * The badge actually renders inside Sidebar — DashboardChrome's role
 * is to read the cross-tree flaggedCount from `useFlaggedCountStore`
 * and forward it as a prop. We test both seams here:
 *
 *   - Direct prop path (the test mirror of what DashboardChrome does
 *     when forwarding the count to Sidebar / MobileSidebarDrawer):
 *     render `<Sidebar flaggedCount={N} isAllocator />` and assert
 *     badge presence + plural-aware aria-label.
 *
 *   - Cross-tree store path: mount AllocationProvider in a sibling
 *     tree, read via `useFlaggedCountStore` from outside the provider,
 *     and assert the value propagates so DashboardChrome's hook
 *     contract holds.
 *
 * Tests cover (≥ 6 cases):
 *   1. flaggedCount=0 → badge NOT rendered.
 *   2. flaggedCount=3 → badge renders with "3" text.
 *   3. flaggedCount undefined → badge NOT rendered.
 *   4. aria-label uses plural form when N > 1 ("3 flagged holdings").
 *   5. aria-label uses singular form when N === 1 ("1 flagged holding").
 *   6. Discovery sub-groups (Digital Assets / TradFi from be30973)
 *      still render — the badge wiring did not regress the layout.
 *   7. AllocationProvider publishes the count into the cross-tree
 *      store so DashboardChrome (above the provider) can read it.
 */

// Mutable pathname so the DashboardChrome tests can exercise both the
// standard layout and the full-bleed (/admin/match/[id]) branch.
const navState = { pathname: "/allocations" };
vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
}));

beforeEach(() => {
  navState.pathname = "/allocations";
});

describe("DashboardChrome — sidebar flagged-count badge (prop path)", () => {
  it("does NOT render the badge when flaggedCount is 0", () => {
    render(
      <Sidebar populatedSlugs={[]} isAllocator={true} flaggedCount={0} />,
    );
    // No element with the flagged-holding aria-label exists.
    expect(screen.queryByLabelText(/flagged holding/i)).toBeNull();
  });

  it("renders the badge with '3' when flaggedCount is 3", () => {
    render(
      <Sidebar populatedSlugs={[]} isAllocator={true} flaggedCount={3} />,
    );
    const badge = screen.getByLabelText(/3 flagged holdings/i);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("3");
  });

  it("does NOT render the badge when flaggedCount is undefined", () => {
    render(<Sidebar populatedSlugs={[]} isAllocator={true} />);
    expect(screen.queryByLabelText(/flagged holding/i)).toBeNull();
  });

  it("uses plural aria-label '3 flagged holdings' when count > 1", () => {
    render(
      <Sidebar populatedSlugs={[]} isAllocator={true} flaggedCount={3} />,
    );
    expect(
      screen.getByLabelText(/^3 flagged holdings$/i),
    ).toBeInTheDocument();
  });

  it("uses singular aria-label '1 flagged holding' when count === 1", () => {
    render(
      <Sidebar populatedSlugs={[]} isAllocator={true} flaggedCount={1} />,
    );
    expect(
      screen.getByLabelText(/^1 flagged holding$/i),
    ).toBeInTheDocument();
  });

  it("preserves Discovery 'Digital Assets' / 'TradFi' sub-groups (commit be30973) when badge is wired", () => {
    render(<Sidebar isAllocator={true} flaggedCount={2} />);
    expect(screen.getByText("Digital Assets")).toBeInTheDocument();
    expect(screen.getByText("TradFi")).toBeInTheDocument();
  });
});

// Component used to read `useFlaggedCountStore` from OUTSIDE the
// provider — exactly the position DashboardChrome occupies in the
// real layout tree.
function FlaggedCountReader() {
  const flaggedCount = useFlaggedCountStore();
  return <div data-testid="store-count">{flaggedCount}</div>;
}

describe("DashboardChrome — cross-tree flaggedCount store integration", () => {
  it("publishes the provider's flaggedCount into the cross-tree store after mount", async () => {
    // Mount the reader BEFORE the provider so we exercise the same
    // out-of-tree subscriber pattern DashboardChrome uses.
    render(
      <>
        <FlaggedCountReader />
        <AllocationProvider value={{ flaggedCount: 5 }}>
          <span>provider-children</span>
        </AllocationProvider>
      </>,
    );
    // The provider's effect publishes the count after mount; testing
    // library wraps the render in act() so effects have flushed.
    expect(screen.getByTestId("store-count").textContent).toBe("5");
    expect(screen.getByText("provider-children")).toBeInTheDocument();
  });
});

/**
 * M-0410 (audit-2026-05-07) — actually render DashboardChrome.
 *
 * The tests above all render <Sidebar> directly. None exercise
 * DashboardChrome's own structure: the `<main aria-label="Dashboard
 * content">` wrap on the standard layout, and the full-bleed branch
 * (/admin/match/[id]) which drops both the sidebar wrapper and the
 * aria-label'd main. These tests pin both.
 */
describe("DashboardChrome — standard vs full-bleed layout (M-0410)", () => {
  it("standard layout wraps content in <main aria-label='Dashboard content'>", () => {
    navState.pathname = "/allocations";
    render(
      <DashboardChrome isAllocator={true} populatedSlugs={[]}>
        <div data-testid="page-body">page</div>
      </DashboardChrome>,
    );
    const main = screen.getByRole("main", { name: "Dashboard content" });
    expect(main).toBeInTheDocument();
    // The children render inside it.
    expect(main).toContainElement(screen.getByTestId("page-body"));
  });

  it("standard layout renders the desktop Sidebar (My Allocation visible for allocators)", () => {
    navState.pathname = "/allocations";
    render(
      <DashboardChrome isAllocator={true} populatedSlugs={[]}>
        <div>page</div>
      </DashboardChrome>,
    );
    // Sidebar emits the allocator workspace link; its presence proves the
    // desktop sidebar subtree mounted (not the full-bleed branch).
    expect(screen.getByText("My Allocation")).toBeInTheDocument();
  });

  it("full-bleed route (/admin/match/[id]) drops the 'Dashboard content' main + desktop sidebar", () => {
    navState.pathname = "/admin/match/abc-123";
    render(
      <DashboardChrome isAdmin={true} populatedSlugs={[]}>
        <div data-testid="page-body">queue</div>
      </DashboardChrome>,
    );
    // Full-bleed <main> has NO aria-label, so the named query must miss.
    expect(
      screen.queryByRole("main", { name: "Dashboard content" }),
    ).toBeNull();
    // But the page body still renders (inside the unlabeled full-bleed main).
    expect(screen.getByTestId("page-body")).toBeInTheDocument();
  });

  it("the /admin/match/eval route is NOT full-bleed (keeps the standard labeled main)", () => {
    navState.pathname = "/admin/match/eval";
    render(
      <DashboardChrome isAdmin={true} populatedSlugs={[]}>
        <div>eval</div>
      </DashboardChrome>,
    );
    expect(
      screen.getByRole("main", { name: "Dashboard content" }),
    ).toBeInTheDocument();
  });
});
