import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

// ═══════════════════════════════════════════════════════════════════════════
// 153.2 review WR-06 — THE OTHER SIDE OF THE COUPLING.
//
// The shell's own comment names the hazard ("leaving them would re-clamp the
// now-fluid shell and silently restore the bug") and the rows above guard the
// SHELL. Nothing guarded the surfaces INSIDE it — which is precisely where the
// caps were, and where two of them survived: `ScenarioComposer` kept
// `max-w-[1440px]` on both of its shells, so the founder's dead-margin symptom
// was still live on `/allocations`' Scenario tab while DESIGN.md recorded that
// route as fixed. A page-side cap ships green against every shell-side row.
//
// ⛔ THIS IS A CLASS SWEEP, NOT A LIST OF THE KNOWN OFFENDERS. It walks the
// `isWide` trees rather than enumerating six paths, so a NEW page or body
// component that reinstates a cap is caught without anyone remembering to add
// it here. An enumerated list would have missed `ScenarioComposer` for exactly
// the reason it was missed the first time.
//
// ⚠️ WHAT COUNTS AS AN OFFENCE — a *page measure*, not any `max-w-*`. A
// truncating table cell (`truncate max-w-[160px]`), a `<p>` of empty-state copy
// at `max-w-md`, a modal at `w-[480px]` and a chart wrapper are not competing
// with the shell for the page's width, and DESIGN.md's rule says so in terms.
// The signature of a page measure is the centring idiom: ONE className carrying
// BOTH `mx-auto` AND a CONTAINER-sized cap.
//
// ⛔ "CONTAINER-SIZED" IS BOTH FORMS, and the second one is not decoration. The
// original founder bug WAS a Tailwind-named rung: `DashboardChrome` clamping a
// dense table to `max-w-7xl` (1280px). A sweep that only rejected the
// arbitrary-value `max-w-[Npx]` form would let the exact original defect ship
// green. `3xl`(768) and up are container widths; `md`/`lg`/`xl`/`2xl` are
// sentence widths and stay out deliberately.
//
// ⛔ AND IT SCANS `src/components/**` TOO. A body shell does not have to live in
// the route tree — `PartialDataBanner` sets its own measure and renders inside
// `ScenarioComposer` on `/allocations`. Scanning only `src/app/(dashboard)/…`
// would leave a shared dense-table shell free to re-clamp the page from one
// directory over, which is the same "guard on the wrong side of the coupling"
// shape WR-06 is about.
// ═══════════════════════════════════════════════════════════════════════════
describe("[153.2 WR-06] no surface inside an isWide tree re-clamps the fluid shell", () => {
  // The first six mirror `DashboardChrome`'s own `isWide` allow-list, kept
  // beside it in the same file so the sweep and the predicate cannot drift
  // apart unnoticed. `src/components` is added because shells live there too.
  const SCANNED_TREES = [
    "src/app/(dashboard)/allocations",
    "src/app/(dashboard)/compare",
    "src/app/(dashboard)/discovery",
    "src/app/(dashboard)/admin",
    "src/app/(dashboard)/portfolios",
    "src/app/(dashboard)/my-strategies",
    "src/components",
  ];

  /** A container-sized cap: the px form OR a large Tailwind rung. */
  // ⚠️ NO trailing `\b` after the `]` alternative — `]` is a non-word character,
  // so a word boundary there can never match and the px form would silently
  // never fire. (Measured: an earlier draft of this sweep had exactly that bug
  // and reported 2 offenders where there were 10.)
  const CONTAINER_CAP =
    /max-w-(?:\[\d+px\]|3xl\b|4xl\b|5xl\b|6xl\b|7xl\b|screen-[a-z]+\b)/;

  /**
   * The documented carve-outs, named so the next reader inherits the exception
   * instead of rediscovering it (DESIGN.md §Measure ladder). NONE is a dense
   * table: the ladder governs by CONTENT TYPE, not by URL prefix, and a bounded
   * measure is a genuine readability control for prose in a way it is not for a
   * table.
   *
   *   - the four `/admin` text pages — under `/admin` for NAVIGATION reasons
   *     only; RT-W2 (v1.4 Phase 54) set them at rung 1, 1100px.
   *   - the Overview "factsheet warming up" status block (prose).
   *   - the discovery-detail "factsheet still computing" fallback article,
   *     which carries the factsheet's own 760px reading measure.
   *   - `DashboardChrome` itself: this IS the owner, and the cap it carries is
   *     the NARROW branch of its own ternary (`isWide ? max-w-full : max-w-7xl`).
   *     Exempting the owner is what makes the rule "sole owner" rather than
   *     "no owner".
   *   - `LegalFooter`: site chrome, rendered OUTSIDE the content container, so
   *     it is not a page measure competing with it.
   *   - `PartialDataBanner`: a centred 480px notice, not a shell.
   *   - `StrategyV2Shell`: the `/strategy/[id]` document shell — rung 2. That
   *     route is deliberately NOT on the `isWide` list (a document, not a data
   *     surface), so its measure is correct and must not be swept away.
   *
   * ⛔ A dense-table page may not join this list. Adding an entry is a design
   * decision that belongs in DESIGN.md's changelog first.
   */
  const ALLOWED = new Map<string, string>([
    ["src/app/(dashboard)/admin/users/page.tsx", "max-w-[1100px]"],
    ["src/app/(dashboard)/admin/users/[id]/page.tsx", "max-w-[1100px]"],
    ["src/app/(dashboard)/admin/partner-import/page.tsx", "max-w-[1100px]"],
    ["src/app/(dashboard)/admin/for-quants-leads/page.tsx", "max-w-[1100px]"],
    [
      "src/app/(dashboard)/allocations/AllocationDashboardV2.tsx",
      "max-w-[1100px]",
    ],
    [
      "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx",
      "max-w-[760px]",
    ],
    ["src/components/layout/DashboardChrome.tsx", "max-w-7xl"],
    ["src/components/legal/LegalFooter.tsx", "max-w-6xl"],
    ["src/components/strategy-v2/PartialDataBanner.tsx", "max-w-[480px]"],
    ["src/components/strategy-v2/StrategyV2Shell.tsx", "max-w-[1200px]"],
  ]);

  /** Every `className="…"` / `className={`…`}` string literal in a source file. */
  function classNameStrings(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/className="([^"]*)"/g)) out.push(m[1]!);
    for (const m of src.matchAll(/className=\{`([^`]*)`\}/g)) out.push(m[1]!);
    return out;
  }

  function tsxFilesUnder(dir: string): string[] {
    const abs = join(process.cwd(), dir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs, { recursive: true, encoding: "utf8" })
      .filter((rel) => rel.endsWith(".tsx") && !rel.includes(".test."))
      .map((rel) => `${dir}/${rel}`);
  }

  const files = SCANNED_TREES.flatMap(tsxFilesUnder);

  it("the sweep actually walked every scanned tree (anti-vacuity floor)", () => {
    // Without this, a renamed directory or a broken glob would make every
    // assertion below iterate an empty list and pass while guarding nothing —
    // the exact shape of guard this milestone exists to delete.
    expect(files.length).toBeGreaterThan(200);
    for (const tree of SCANNED_TREES) {
      expect(
        files.some((f) => f.startsWith(tree)),
        `no .tsx found under ${tree} — the sweep is not reaching it`,
      ).toBe(true);
    }
  });

  it("the offence pattern matches BOTH cap forms (the regex is itself guarded)", () => {
    // A `\b` after the `]` alternative silently disables the px form — measured,
    // not hypothetical. Both forms are asserted here so the sweep below cannot
    // quietly become a sweep for one of them.
    expect("mx-auto max-w-[1920px] px-4".match(CONTAINER_CAP)?.[0]).toBe(
      "max-w-[1920px]",
    );
    expect("mx-auto max-w-7xl px-4".match(CONTAINER_CAP)?.[0]).toBe("max-w-7xl");
    // …and sentence-width rungs and truncating cells stay OUT, so the sweep
    // cannot drift into flagging every centred paragraph in an empty state.
    expect("mx-auto max-w-md text-sm").not.toMatch(CONTAINER_CAP);
    expect("truncate max-w-[160px]").toMatch(CONTAINER_CAP); // caught by the cap…
    expect("truncate max-w-[160px]".includes("mx-auto")).toBe(false); // …excluded by the idiom
  });

  it("⭐ no page or body shell reachable from an isWide tree carries a container cap", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      for (const cls of classNameStrings(src)) {
        if (!cls.includes("mx-auto")) continue;
        const cap = cls.match(CONTAINER_CAP)?.[0];
        if (!cap) continue;
        if (ALLOWED.get(file) === cap) continue;
        offenders.push(`${file} → "${cap}"`);
      }
    }
    // Named, not counted: a failure must say WHICH surface re-clamped the shell.
    expect(offenders).toEqual([]);
  });

  it("CONTROL — every carve-out still exists, so a stale exemption cannot hide a regression", () => {
    // The other direction. An allowlist entry whose file was deleted or whose
    // measure changed is a permission granted to nothing — and the next person
    // to reinstate a cap on that path would inherit it silently.
    for (const [file, cap] of ALLOWED) {
      const abs = join(process.cwd(), file);
      expect(existsSync(abs), `carve-out names a missing file: ${file}`).toBe(
        true,
      );
      const found = classNameStrings(readFileSync(abs, "utf8")).some(
        (cls) => cls.includes("mx-auto") && cls.includes(cap),
      );
      expect(found, `carve-out ${file} no longer uses ${cap}`).toBe(true);
    }
  });
});
