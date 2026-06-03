import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  AdminTabs,
  type IntroRequestRow,
  type PendingStrategyRow,
  type PendingProfileRow,
  type PendingManagerRow,
} from "./AdminTabs";

/**
 * H-0353 — typed-row render coverage for the admin dashboard tabs.
 *
 * AdminTabs previously typed every prop row as `Array<Record<string, unknown>>`
 * and re-cast each field with `as string` / `as Record<string,string>`. The fix
 * replaces those with the four exported row interfaces (matching admin/page.tsx's
 * SELECT columns) so a column rename is a compile error rather than a silently
 * blank tab. These render tests pin the typed field-access paths for each tab
 * (profile display_name/company, strategy name/strategy_types, allocator/manager
 * identity) so a future refactor that breaks them fails loudly.
 *
 * The compile-time type guard itself is enforced by the frontend-typecheck CI
 * job (AdminTabs.tsx + admin/page.tsx with the new interfaces + .returns<>).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const INTRO: IntroRequestRow = {
  id: "ir-1",
  status: "pending",
  message: "Please connect us",
  admin_note: null,
  created_at: "2025-01-01T00:00:00Z",
  allocator_id: "al-1",
  strategy_id: "st-1",
  profiles: { display_name: "Acme Capital", company: "Acme LLC" },
  strategies: {
    id: "st-1",
    name: "Alpha Strat",
    codename: null,
    disclosure_tier: "institutional",
  },
};

const STRAT: PendingStrategyRow = {
  id: "st-2",
  name: "Beta Strat",
  status: "pending_review",
  source: "wizard",
  strategy_types: ["Long-Only"],
  created_at: "2025-01-02T00:00:00Z",
  user_id: "u-1",
  profiles: { display_name: "Quant Bob" },
  strategy_analytics: [
    {
      cagr: 0.2,
      sharpe: 1.5,
      max_drawdown: -0.1,
      computation_status: "complete",
      computed_at: "2025-01-02T00:00:00Z",
    },
  ],
};

const ALLOC: PendingProfileRow = {
  id: "al-2",
  display_name: "Carol Allocator",
  company: "Carol Co",
  email: "carol@example.com",
  role: "allocator",
  allocator_status: "pending",
  created_at: "2025-01-03T00:00:00Z",
};

const MGR: PendingManagerRow = {
  id: "mg-1",
  display_name: "Dave Manager",
  company: "Dave Co",
  email: "dave@example.com",
  role: "manager",
  manager_status: "pending",
  created_at: "2025-01-04T00:00:00Z",
};

function renderTabs() {
  return render(
    <AdminTabs
      introRequests={[INTRO]}
      pendingStrategies={[STRAT]}
      pendingAllocators={[ALLOC]}
      pendingManagers={[MGR]}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminTabs — typed-row render paths (H-0353)", () => {
  it("Intro Requests tab renders the joined profile display_name + company + strategy name", () => {
    renderTabs();
    // profile.display_name and (company) — the join shape that the typed
    // IntroRequestRow.profiles now pins (was an `as Record<string,string>` cast).
    expect(screen.getByText(/Acme Capital/)).toBeTruthy();
    expect(screen.getByText(/Acme LLC/)).toBeTruthy();
    // strategies embed flows through displayStrategyName: an institutional-tier
    // strategy renders its name. Pins the `as DisplayableStrategy` narrowing
    // wiring (the one remaining cast) at the admin call site.
    expect(screen.getByText(/Alpha Strat/)).toBeTruthy();
  });

  it("Intro Requests tab does NOT leak an exploratory-tier strategy name (privacy branch wiring)", () => {
    // displayStrategyName returns the synthetic "Strategy #<id8>" for a
    // non-institutional, codename-less strategy — never the raw name. Pins that
    // AdminTabs feeds the strategies embed through displayStrategyName (not the
    // raw s.name) so the admin queue can't leak an exploratory founder's name.
    const exploratory: IntroRequestRow = {
      ...INTRO,
      id: "ir-2",
      strategies: {
        id: "explor01-secret-id",
        name: "Top Secret Strat",
        codename: null,
        disclosure_tier: "exploratory",
      },
    };
    render(
      <AdminTabs
        introRequests={[exploratory]}
        pendingStrategies={[]}
        pendingAllocators={[]}
        pendingManagers={[]}
      />,
    );
    expect(screen.getByText(/Strategy #explor01/)).toBeTruthy();
    expect(screen.queryByText(/Top Secret Strat/)).toBeNull();
  });

  it("Strategy Review tab renders strategy name + strategy_types + author", () => {
    renderTabs();
    fireEvent.click(screen.getByText("Strategy Review"));
    expect(screen.getByText("Beta Strat")).toBeTruthy(); // s.name
    expect(screen.getByText("Long-Only")).toBeTruthy(); // s.strategy_types[]
    expect(screen.getByText(/Quant Bob/)).toBeTruthy(); // s.profiles.display_name
  });

  it("Allocators tab renders display_name, company and email", () => {
    renderTabs();
    fireEvent.click(screen.getByText("Allocators"));
    expect(screen.getByText("Carol Allocator")).toBeTruthy();
    expect(screen.getByText(/Carol Co/)).toBeTruthy();
    expect(screen.getByText(/carol@example\.com/)).toBeTruthy();
  });

  it("Managers tab renders display_name and email", () => {
    renderTabs();
    fireEvent.click(screen.getByText("Managers"));
    expect(screen.getByText("Dave Manager")).toBeTruthy();
    expect(screen.getByText(/dave@example\.com/)).toBeTruthy();
  });
});
