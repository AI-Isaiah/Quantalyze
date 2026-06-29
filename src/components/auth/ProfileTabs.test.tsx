/**
 * Phase 11 Plan 06 / S6 / D-05 — ProfileTabs Security tab integration tests.
 *
 * Locked contract:
 *   - ALL_TABS includes a `security` entry with `allocatorOnly: true`
 *   - Non-allocator users do NOT see the Security tab
 *   - Allocator users DO see the Security tab
 *   - When activeTab === 'security', AuditLogSubsection renders inside
 *     the tab body
 *   - parseTabParam('security', isAllocator=true) → 'security' (allowed)
 *   - parseTabParam('security', isAllocator=false) → 'personal' (gated)
 *
 * The router/searchParams hooks from next/navigation are stubbed because
 * jsdom has no router context.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileTabs } from "./ProfileTabs";
import type { Profile } from "@/lib/types";

// next/navigation hooks are not available in jsdom — supply minimal stubs.
// routerReplace is a STABLE hoisted spy (a fresh vi.fn() per useRouter() call
// would be unassertable) so the manual-activation test can assert nav timing.
const { routerReplace } = vi.hoisted(() => ({ routerReplace: vi.fn() }));
const searchParamsState = { tab: null as string | null };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/profile",
  useSearchParams: () => ({
    get: (k: string) => (k === "tab" ? searchParamsState.tab : null),
    toString: () =>
      searchParamsState.tab ? `tab=${searchParamsState.tab}` : "",
  }),
}));

// AuditLogSubsection's fetch is stubbed so the tab-render test doesn't
// trigger an actual network request when the security tab mounts.
const mockFetch = vi.fn();
beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
  searchParamsState.tab = null;
});
afterEach(() => {
  vi.clearAllMocks();
});

const PROFILE_FIXTURE: Profile = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "test@example.test",
  display_name: "Test",
  full_name: "Test User",
  role: "allocator",
  bio: null,
  years_trading: null,
  aum_range: null,
  organization_id: null,
  created_at: new Date("2026-01-01").toISOString(),
  updated_at: new Date("2026-01-01").toISOString(),
} as unknown as Profile;

describe("ProfileTabs — Security tab visibility (S6 / D-05)", () => {
  // 50-RESEARCH Pitfall 2 — the consolidated ProfileTabs renders triggers via
  // the Radix-backed Tabs primitive, whose Trigger is role="tab" (the
  // hand-rolled version used bare <button>, implicit role=button). These tab
  // queries are mechanically ported getByRole("button") -> getByRole("tab"); the
  // behavioral contract (allocator-only Security tab visibility, tab order, URL
  // gating) is unchanged. Note: the in-panel "Download audit log CSV" control in
  // Test 3 is a real <button> and correctly stays role="button".
  it("Test 1 — allocator sees the Security tab", () => {
    render(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={true} />);
    expect(
      screen.getByRole("tab", { name: "Security" }),
    ).toBeInTheDocument();
  });

  it("Test 2 — non-allocator does NOT see the Security tab", () => {
    render(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={false} />);
    expect(screen.queryByRole("tab", { name: "Security" })).toBeNull();
  });

  it("Test 3 — when ?tab=security and user is allocator, AuditLogSubsection renders", () => {
    searchParamsState.tab = "security";
    render(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={true} />);
    // The subsection's own heading is the most stable assertion target.
    expect(
      screen.getByRole("heading", { name: "Audit log" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Download audit log CSV/,
      }),
    ).toBeInTheDocument();
  });

  it("Test 4 — when ?tab=security and user is NOT allocator, falls back to Personal Info tab", () => {
    searchParamsState.tab = "security";
    render(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={false} />);
    // Audit log heading must NOT render — security path is gated by
    // ALLOCATOR_ONLY_KEYS in parseTabParam, so the visibility predicate
    // falls through to the personal tab (ProfileForm).
    expect(screen.queryByRole("heading", { name: "Audit log" })).toBeNull();
  });

  it("Test 5 — Security tab appears AFTER Exchanges and BEFORE Organizations in tab order", () => {
    render(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={true} />);
    const buttons = screen.getAllByRole("tab").map((b) => b.textContent);
    const exchangesIdx = buttons.indexOf("Exchanges");
    const securityIdx = buttons.indexOf("Security");
    const organizationsIdx = buttons.indexOf("Organizations");
    expect(exchangesIdx).toBeGreaterThanOrEqual(0);
    expect(securityIdx).toBeGreaterThan(exchangesIdx);
    expect(organizationsIdx).toBeGreaterThan(securityIdx);
  });

  // M-0393 (audit-2026-05-07) — the allocator-only Mandate gate. A
  // non-allocator who hits /profile?tab=mandate must be coerced to the
  // Personal tab and must NOT render MandateForm (whose POST to
  // /api/preferences has only a shallow server-side role check). These
  // tests pin parseTabParam's mandate branch specifically (the existing
  // Test 4 only exercises the `security` key).
  it("M-0393 — non-allocator with ?tab=mandate is coerced to Personal (no MandateForm)", () => {
    searchParamsState.tab = "mandate";
    render(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={false} />);
    // MandateForm's ticket-size label must be absent — the tab gate kept it
    // from mounting and the personal ProfileForm renders instead.
    expect(
      screen.queryByLabelText("Typical ticket size (USD)"),
    ).toBeNull();
    // The Mandate tab button itself must not even render for non-allocators.
    expect(screen.queryByRole("tab", { name: "Mandate" })).toBeNull();
  });

  it("M-0393 — allocator with ?tab=mandate DOES render MandateForm", () => {
    searchParamsState.tab = "mandate";
    render(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={true} />);
    // The allocator path mounts MandateForm — its ticket-size label appears.
    expect(
      screen.getByLabelText("Typical ticket size (USD)"),
    ).toBeInTheDocument();
  });

  // 50-REVIEW (red-team) — ProfileTabs uses activationMode="manual": arrow-key
  // navigation moves focus but must NOT commit the tab (its onValueChange does a
  // router.replace() and the Exchanges panel mounts a Supabase-backed component).
  // Selection commits only on Enter/Space/click. Pins that arrow-focus is
  // side-effect-free and activation still works.
  it("50-REVIEW — manual activation: arrow-focus does not navigate; Enter commits", async () => {
    const user = userEvent.setup();
    render(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={true} />);
    screen.getByRole("tab", { name: "Personal Info" }).focus();
    routerReplace.mockClear();

    // Arrow to the next tab — focus moves, but manual mode must NOT commit.
    await user.keyboard("{ArrowRight}");
    expect(routerReplace).not.toHaveBeenCalled();
    // The newly-focused tab is still NOT the selected one.
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
      "Personal Info",
    );

    // Activating with Enter commits the focused tab → exactly one navigation.
    await user.keyboard("{Enter}");
    expect(routerReplace).toHaveBeenCalledTimes(1);
  });

  // 50-REVIEW (a11y BLOCKER) — every TabsTrigger must control a real
  // role="tabpanel". The first port rendered the bodies as bare conditionals
  // OUTSIDE <TabsContent>, so Radix's Trigger emitted aria-controls at panel
  // ids that never existed in the DOM (6 dangling aria-controls, 0 tabpanels) —
  // a NEW WCAG 4.1.2 / 1.3.1 regression vs the pre-port hand-rolled <button>s.
  // This pins the trigger<->panel round-trip so a future un-wrapping fails loud.
  it("50-REVIEW — active tab controls a real tabpanel (no dangling aria-controls)", () => {
    render(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={true} />);

    // The default active tab is Personal Info.
    const activeTab = screen.getByRole("tab", { selected: true });
    expect(activeTab).toHaveTextContent("Personal Info");

    // Radix renders exactly the active panel, and it is a real tabpanel.
    const panel = screen.getByRole("tabpanel");
    expect(panel).toBeInTheDocument();

    // Round-trip the WAI-ARIA wiring: the active trigger's aria-controls
    // resolves to the panel, and the panel's aria-labelledby resolves to the
    // active trigger. A body rendered outside <TabsContent> breaks both.
    expect(activeTab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", activeTab.id);
  });

  it("Phase 11 IN-06 — activeTab derives per-render from searchParams (back/forward parity)", () => {
    // Mount with ?tab=security — Audit log heading visible.
    searchParamsState.tab = "security";
    const { rerender } = render(
      <ProfileTabs profile={PROFILE_FIXTURE} isAllocator={true} />,
    );
    expect(
      screen.getByRole("heading", { name: "Audit log" }),
    ).toBeInTheDocument();

    // Simulate browser back: searchParams flips to ?tab=mandate.
    // Under the previous useState(initialTab) snapshot pattern, the
    // Audit-log heading would persist because activeTab stayed locked
    // to its mount-time value. With the IN-06 derive-per-render fix the
    // re-render reflects the new searchParams and the security panel
    // unmounts.
    searchParamsState.tab = "mandate";
    rerender(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={true} />);
    expect(
      screen.queryByRole("heading", { name: "Audit log" }),
    ).toBeNull();

    // Simulate browser forward: searchParams returns to ?tab=security.
    // The security panel must re-mount.
    searchParamsState.tab = "security";
    rerender(<ProfileTabs profile={PROFILE_FIXTURE} isAllocator={true} />);
    expect(
      screen.getByRole("heading", { name: "Audit log" }),
    ).toBeInTheDocument();
  });
});
