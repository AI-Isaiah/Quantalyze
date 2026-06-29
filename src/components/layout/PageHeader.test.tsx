import { describe, it, expect } from "vitest";
import { type ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

/**
 * Phase 51 NAV-02 / UI-SPEC §Breadcrumb Contract — the PageHeader breadcrumb
 * back-path. RESEARCH Pattern 3a single-sources breadcrumbs THROUGH PageHeader
 * via a new optional `breadcrumb` prop that renders <Breadcrumb items={...}/>
 * above the <h1>.
 *
 * RED CONTRACT (plan 51-01): `PageHeaderProps` has NO `breadcrumb` prop today
 * (PageHeader.tsx L3-9) — the prop is added in plan 51-03. So:
 *   - the "renders a Breadcrumb above the h1 when passed" assertion is RED now
 *     (today's PageHeader ignores the unknown prop → no breadcrumb landmark);
 *   - the "omitting it renders no breadcrumb" assertion is GREEN now and stays
 *     green (additive, optional — surfaces that don't pass it are unchanged).
 * When 51-03 adds the prop + renders <Breadcrumb> above <h1>, the first
 * assertion flips GREEN.
 *
 * Compile note: because `breadcrumb` is not yet on PageHeaderProps, passing it
 * as a raw JSX attribute would be a tsc excess-property error. We build a props
 * object that includes the FUTURE `breadcrumb` field and pass it through a
 * cast to the CURRENT props type (a superset → current is always assignable),
 * so the test compiles today AND renders RED. 51-03 can drop the cast once the
 * prop exists.
 */

// The shape PageHeader will accept once 51-03 adds the breadcrumb prop. The
// current props are a subset, so this type is a structural superset and the
// cast below never widens beyond what 51-03 lands.
type FuturePageHeaderProps = ComponentProps<typeof PageHeader> & {
  breadcrumb?: { label: string; href?: string }[];
};

const BREADCRUMB = [
  { label: "My Allocation", href: "/allocations" },
  { label: "Compare" },
];

describe("PageHeader breadcrumb back-path (NAV-02, RED until 51-03)", () => {
  it("renders a <Breadcrumb> landmark ABOVE the <h1> when a breadcrumb prop is passed", () => {
    const props: FuturePageHeaderProps = {
      title: "Compare strategies",
      breadcrumb: BREADCRUMB,
    };
    // Cast the future-prop object back to the current props type so this
    // compiles before 51-03 adds `breadcrumb` to PageHeaderProps.
    render(<PageHeader {...(props as ComponentProps<typeof PageHeader>)} />);

    const heading = screen.getByRole("heading", { level: 1 });
    // The Breadcrumb landmark is <nav aria-label="Breadcrumb"> (Breadcrumb.tsx).
    const crumbNav = screen.queryByRole("navigation", { name: "Breadcrumb" });
    expect(crumbNav).not.toBeNull();
    // It must render ABOVE the <h1> in DOM order (back-path sits above the
    // page title, UI-SPEC §Breadcrumb Contract).
    expect(
      crumbNav!.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders NO breadcrumb landmark when the breadcrumb prop is omitted (identical to today)", () => {
    render(<PageHeader title="Compare strategies" />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    // Omitting the optional prop must render exactly as today — no breadcrumb
    // landmark, no behavior change for existing call sites.
    expect(
      screen.queryByRole("navigation", { name: "Breadcrumb" }),
    ).toBeNull();
  });
});
