import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
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
// Phase 110 CONTRIB-01 — DashboardChrome now hosts ContributionWizardOverlay
// and calls router.refresh() on a successful contribution. hoisted so the mock
// factory (which is hoisted above the imports) can reference the shared spy.
const hoisted = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useRouter: () => ({
    refresh: hoisted.refresh,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Stub the wizard so the host tests drive DashboardChrome's own overlay wiring,
// not the wizard internals (mirrors ContributionWizardOverlay.test.tsx).
vi.mock("@/app/(dashboard)/strategies/new/wizard/WizardClient", () => ({
  WizardClient: (props: {
    onSuccess?: (id: string) => void;
    onClose?: () => void;
  }) => (
    <div data-testid="mock-wizard">
      <button
        type="button"
        data-testid="wizard-fire-success"
        onClick={() => props.onSuccess?.("id-1")}
      >
        fire success
      </button>
      <button
        type="button"
        data-testid="wizard-fire-close"
        onClick={() => props.onClose?.()}
      >
        fire close
      </button>
    </div>
  ),
}));

beforeEach(() => {
  navState.pathname = "/allocations";
  hoisted.refresh.mockClear();
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
    // Phase 45: the role-aware MobileNav ALSO surfaces "My Allocation" now, so
    // scope the assertion to the desktop Sidebar's <nav aria-label="Primary">
    // (the bottom nav is <nav aria-label="Primary mobile">). Its presence there
    // proves the desktop sidebar subtree mounted (not the full-bleed branch).
    const desktopNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(desktopNav).getByText("My Allocation")).toBeInTheDocument();
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

/**
 * Phase 52 (v1.4) — DashboardChrome wide fluid-fill variant.
 *
 * 52-02/03/04 raised the allocator-journey PAGE content to a page-level
 * `max-w-[1920px]`, but the standard shell's content container caps at
 * `max-w-7xl` (1280px), which clamped that page cap. This pins the shell-level
 * widening: the data/table routes get the wide measure, while every other
 * dashboard route keeps `max-w-7xl`.
 *
 * ⭐ UPDATED 2026-08-09 (founder decision, Option B). The wide measure is no
 * longer `max-w-[1920px]` — it is FLUID (`max-w-full`, no px ceiling), because
 * any fixed cap turns surplus viewport into dead margin exactly when the user
 * zooms out to see more. The page-level 1920px caps are removed too: two owners
 * for one property is what let `/my-strategies` cap itself at 1920 while the
 * shell clamped it to 1280. The shell is now the sole owner.
 *
 * The content container is the direct child <div> of the labeled <main> that
 * holds the page children (the `mx-auto max-w-* px-4 …` wrapper).
 */
/**
 * Phase 110 CONTRIB-01 — DashboardChrome hosts the ContributionWizardOverlay so
 * BOTH launch surfaces (the allocator nav action here, and the Browse "Add your
 * own" CTA in ScenarioComposer) mount the same reusable overlay. These pin the
 * chrome-level host contract: closed by default, opened by the nav action,
 * closed on the wizard's onClose, and closed + router.refresh()'d on onSuccess.
 */
describe("DashboardChrome — ContributionWizardOverlay host (CONTRIB-01)", () => {
  function renderChrome() {
    navState.pathname = "/allocations";
    render(
      <DashboardChrome isAllocator={true} populatedSlugs={[]}>
        <div>page</div>
      </DashboardChrome>,
    );
    return screen.getByRole("navigation", { name: "Primary" });
  }

  it("mounts the overlay CLOSED by default (no wizard until the action fires)", () => {
    renderChrome();
    expect(screen.queryByTestId("mock-wizard")).toBeNull();
  });

  it("opens the overlay when the desktop 'Add a Strategy' nav action fires", () => {
    const desktopNav = renderChrome();
    fireEvent.click(within(desktopNav).getByText("Add a Strategy"));
    expect(screen.getByTestId("mock-wizard")).toBeInTheDocument();
  });

  it("closes the overlay on the wizard onClose", () => {
    const desktopNav = renderChrome();
    fireEvent.click(within(desktopNav).getByText("Add a Strategy"));
    fireEvent.click(screen.getByTestId("wizard-fire-close"));
    expect(screen.queryByTestId("mock-wizard")).toBeNull();
  });

  it("closes the overlay AND refreshes on the wizard onSuccess", () => {
    const desktopNav = renderChrome();
    fireEvent.click(within(desktopNav).getByText("Add a Strategy"));
    fireEvent.click(screen.getByTestId("wizard-fire-success"));
    expect(screen.queryByTestId("mock-wizard")).toBeNull();
    expect(hoisted.refresh).toHaveBeenCalled();
  });

  // MD-01 (Phase 110 review) — firing the contribute action from inside the
  // OPEN mobile drawer must CLOSE the drawer as it opens the overlay. The drawer
  // owns a window-level Tab focus trap that stays armed until it unmounts
  // (`open=false`); the overlay portals to <body> outside the drawer-inert
  // <main>, so a still-open drawer would hijack every Tab in the overlay — a
  // keyboard trap (WCAG 2.1.2). Opening the overlay changes no route, so the
  // drawer's route-change auto-close never fires; DashboardChrome must close it
  // explicitly. This fails if openContribute stops calling setMenuOpen(false).
  it("closes the mobile drawer (releasing its Tab trap) when contribute fires from inside it", () => {
    renderChrome();
    // Open the drawer via the hamburger, then act from WITHIN the drawer dialog.
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByRole("dialog", { name: "Main navigation" });
    fireEvent.click(within(drawer).getByText("Add a Strategy"));
    // Overlay opened AND the drawer unmounted (window Tab trap torn down).
    expect(screen.getByTestId("mock-wizard")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Main navigation" }),
    ).toBeNull();
  });
});

describe("DashboardChrome — wide fluid-fill variant (Phase 52)", () => {
  function contentContainerFor(pathname: string) {
    navState.pathname = pathname;
    render(
      <DashboardChrome isAllocator={true} populatedSlugs={[]}>
        <div data-testid="page-body">page</div>
      </DashboardChrome>,
    );
    // The content container is the closest `mx-auto …` ancestor of the children.
    return screen.getByTestId("page-body").closest("div.mx-auto");
  }

  it("widens the allocator route /allocations to max-w-full", () => {
    const container = contentContainerFor("/allocations");
    expect(container).toHaveClass("max-w-full");
    expect(container).not.toHaveClass("max-w-7xl");
  });

  it("widens /compare to max-w-full", () => {
    const container = contentContainerFor("/compare");
    expect(container).toHaveClass("max-w-full");
  });

  it("widens nested discovery routes (/discovery/digital-assets) to max-w-full", () => {
    const container = contentContainerFor("/discovery/digital-assets");
    expect(container).toHaveClass("max-w-full");
  });

  it("widens the /portfolios data surface to max-w-full (Phase 53 APPLY-04)", () => {
    const container = contentContainerFor("/portfolios");
    expect(container).toHaveClass("max-w-full");
    expect(container).not.toHaveClass("max-w-7xl");
  });

  it("widens nested portfolio detail routes (/portfolios/abc/manage) to max-w-full", () => {
    const container = contentContainerFor("/portfolios/abc/manage");
    expect(container).toHaveClass("max-w-full");
  });

  it("widens the /admin data surface to max-w-full (Phase 53 APPLY-04)", () => {
    const container = contentContainerFor("/admin");
    expect(container).toHaveClass("max-w-full");
    expect(container).not.toHaveClass("max-w-7xl");
  });

  it("widens nested admin sub-pages (/admin/compute-jobs) to max-w-full", () => {
    const container = contentContainerFor("/admin/compute-jobs");
    expect(container).toHaveClass("max-w-full");
  });

  // ⭐ 2026-08-09 founder report — "zooming out should allow me to see more of
  // the content… it should never produce dead/empty areas." The surface hit was
  // My Strategies, which lives at `/my-strategies` and was MISSING from the
  // isWide allow-list: its page set its own `max-w-[1920px]` under a comment
  // claiming the layout does not cap width, while this shell silently clamped it
  // to `max-w-7xl` (1280px). Symptom: the table rendered "Scroll for more
  // columns →" beside dead space.
  //
  // Founder chose Option B: dense tables go FLUID (no px cap at all), prose and
  // forms keep a bounded measure. Any fixed px cap dead-spaces once the viewport
  // exceeds it, and zooming out is exactly how a viewport exceeds it.
  it("widens the My Strategies LIST (/my-strategies) — the founder-reported surface", () => {
    const container = contentContainerFor("/my-strategies");
    expect(container).toHaveClass("max-w-full");
    expect(container).not.toHaveClass("max-w-7xl");
  });

  it("gives dense tables NO px cap at all — a ceiling is what strands content on zoom-out", () => {
    // ⛔ The point of Option B is the ABSENCE of a numeric ceiling, not a larger
    // one. `toHaveClass("max-w-full")` alone would still pass if someone
    // reinstated a px cap alongside it, so this rejects the arbitrary-value form
    // outright — it fails for max-w-[1920px] and for any successor number.
    const container = contentContainerFor("/my-strategies");
    // ⚠️ Assert the container EXISTS before filtering it. Without this, a null
    // container would make `?? []` yield an empty list and the row would pass
    // vacuously — an emptiness assertion is only meaningful once you have
    // proven there was something to be empty of.
    expect(container).not.toBeNull();
    const pxCaps = [...(container?.classList ?? [])].filter((c) =>
      /^max-w-\[\d+px\]$/.test(c),
    );
    expect(pxCaps).toEqual([]);
  });

  it("keeps the new-strategy WIZARD (/strategies/new/wizard) narrow — it is a form", () => {
    // Nothing under `/strategies` is on the allow-list. A bounded measure is a
    // real readability control for a form, not decoration.
    const container = contentContainerFor("/strategies/new/wizard");
    expect(container).toHaveClass("max-w-7xl");
    expect(container).not.toHaveClass("max-w-full");
  });

  it("keeps the legacy card list (/strategies) narrow — it is not a dense table", () => {
    const container = contentContainerFor("/strategies");
    expect(container).toHaveClass("max-w-7xl");
    expect(container).not.toHaveClass("max-w-full");
  });

  it("does NOT widen a route that merely starts with the prefix string (/my-strategiesx)", () => {
    // Regex boundary for the new allow-list member, mirroring /discoveryx.
    const container = contentContainerFor("/my-strategiesx");
    expect(container).toHaveClass("max-w-7xl");
    expect(container).not.toHaveClass("max-w-full");
  });

  it("does NOT widen a route that merely starts with the prefix string (/discoveryx)", () => {
    // Regex boundary: /discoveryx is NOT a discovery route — keeps max-w-7xl.
    const container = contentContainerFor("/discoveryx");
    expect(container).toHaveClass("max-w-7xl");
    expect(container).not.toHaveClass("max-w-full");
  });
});
