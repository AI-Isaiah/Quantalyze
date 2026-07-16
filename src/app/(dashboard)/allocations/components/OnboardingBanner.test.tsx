import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OnboardingBanner } from "./OnboardingBanner";

/**
 * Phase 11 / 11-05 / S1 / ONBOARD-01 — OnboardingBanner tests.
 *
 * Pins the verbatim UI-SPEC §S1 copy contract, the WarningBanner className
 * override, the sessionStorage dismissal flow, and the SSR-safe
 * "render-then-hide-after-mount" pattern that prevents CLS.
 *
 * The component is rendered unconditionally by the parent (AllocationsTabs
 * gates on apiKeysCount === 0) — these tests don't gate visibility on
 * apiKeysCount; they only assert that GIVEN the banner is rendered, all
 * copy / behavior is correct.
 */

// next/link → plain <a> (matches App-Router test convention; we don't need
// the prefetcher to drive these UI assertions).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// sessionStorage stub — per-test reset so dismissal state doesn't bleed.
const ssStore = new Map<string, string>();
const sessionStorageMock = {
  getItem: vi.fn((k: string) => ssStore.get(k) ?? null),
  setItem: vi.fn((k: string, v: string) => {
    ssStore.set(k, v);
  }),
  removeItem: vi.fn((k: string) => {
    ssStore.delete(k);
  }),
  clear: vi.fn(() => {
    ssStore.clear();
  }),
  key: vi.fn(() => null),
  length: 0,
};
vi.stubGlobal("sessionStorage", sessionStorageMock);

beforeEach(() => {
  ssStore.clear();
  sessionStorageMock.getItem.mockClear();
  sessionStorageMock.setItem.mockClear();
});

describe("OnboardingBanner (Phase 11 / S1) — verbatim copy + behavior", () => {
  it("renders heading 'Connect your exchange to see real performance' verbatim", () => {
    render(<OnboardingBanner />);
    expect(
      screen.getByText("Connect your exchange to see real performance"),
    ).toBeInTheDocument();
  });

  it("renders body copy verbatim per UI-SPEC §S1", () => {
    render(<OnboardingBanner />);
    // Use getByText with normalized whitespace to allow HTML entity parsing.
    expect(
      screen.getByText(
        /Add a read-only API key — we'll pull your real holdings within one sync cycle and populate Performance, Bridge, and Scenario\./,
      ),
    ).toBeInTheDocument();
  });

  it("renders CTA <a href='/profile?tab=exchanges'> with text 'Connect Exchange →'", () => {
    render(<OnboardingBanner />);
    const cta = screen.getByRole("link", { name: /connect exchange/i });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute("href", "/profile?tab=exchanges");
    expect(cta.textContent).toContain("Connect Exchange");
  });

  it("renders a dismiss button with aria-label='Dismiss for this session'", () => {
    render(<OnboardingBanner />);
    expect(
      screen.getByRole("button", { name: "Dismiss for this session" }),
    ).toBeInTheDocument();
  });

  it("hides the banner when sessionStorage flag is already '1' at mount (post-effect)", async () => {
    ssStore.set("allocations.onboarding_banner_dismissed", "1");
    const { container } = render(<OnboardingBanner />);
    // After the post-mount effect runs, the banner is removed from the DOM.
    // findByText on a previously-present node will throw if absent.
    // Use a microtask flush via Promise.resolve to allow the effect to settle.
    await Promise.resolve();
    // Phase 11 WR-03: heading is <h2> (was <h3> — h1→h3 skip violated WCAG 1.3.1).
    expect(
      container.querySelector("h2#onboarding-banner-heading"),
    ).toBeNull();
  });

  it("Phase 11 WR-03: renders the heading as <h2> (not <h3>) — WCAG 1.3.1 heading-level integrity", () => {
    const { container } = render(<OnboardingBanner />);
    const heading = container.querySelector("#onboarding-banner-heading");
    expect(heading).not.toBeNull();
    expect(heading?.tagName).toBe("H2");
    // Belt-and-braces: assert no <h3> with this id exists.
    expect(container.querySelector("h3#onboarding-banner-heading")).toBeNull();
  });

  it("clicking dismiss writes the sessionStorage flag and hides the banner", () => {
    render(<OnboardingBanner />);
    const dismiss = screen.getByRole("button", {
      name: "Dismiss for this session",
    });
    fireEvent.click(dismiss);
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      "allocations.onboarding_banner_dismissed",
      "1",
    );
    expect(
      screen.queryByText("Connect your exchange to see real performance"),
    ).toBeNull();
  });

  it("uses <WarningBanner className='rounded-md border border-warning/30 bg-warning/5'> full-border envelope override (UI-SPEC AC #14)", () => {
    const { container } = render(<OnboardingBanner />);
    // The WarningBanner primitive renders a single root <div>; the className
    // override is appended via cn(). We assert the full-border envelope tokens
    // exist on the outer div and that the banned left stripe is gone.
    const root = container.firstElementChild as HTMLElement | null;
    expect(root).not.toBeNull();
    expect(root?.className).not.toContain("border-l-4");
    expect(root?.className).toContain("rounded-md");
    expect(root?.className).toContain("border-warning/30");
    expect(root?.className).toContain("bg-warning/5");
  });

  it("dismiss button has the 44×44 hit area expansion (before:absolute before:inset-[-6px])", () => {
    render(<OnboardingBanner />);
    const dismiss = screen.getByRole("button", {
      name: "Dismiss for this session",
    });
    expect(dismiss.className).toContain("before:absolute");
    expect(dismiss.className).toContain("before:inset-[-6px]");
  });

  it("CTA is a real <a> (semantic), NOT a <button> (UI-SPEC §Accessibility S1)", () => {
    render(<OnboardingBanner />);
    const cta = screen.getByRole("link", { name: /connect exchange/i });
    expect(cta.tagName).toBe("A");
  });
});
