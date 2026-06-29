import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// jsdom does not implement HTMLDialogElement.showModal()/close(); the reject
// flow renders a <Modal> (native <dialog>) whose useEffect calls them when
// `open` flips. Stub them so opening the reject modal doesn't throw.
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
      (this as unknown as { open: boolean }).open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      (this as unknown as { open: boolean }).open = false;
    };
  }
}

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

  // Radix Tabs triggers activate on the pointerdown/keyboard sequence that
  // `@testing-library/user-event` dispatches — bare `fireEvent.click` does not
  // flip the active panel (50-RESEARCH driver note; same mechanical test-port as
  // the Tabs primitive spec). The tab-switching clicks below therefore use
  // `await user.click(...)`. The test INTENT (clicking a tab reveals its panel
  // content) is unchanged. The trigger text ("Strategy Review", etc.) still
  // resolves the trigger via getByText/getByRole.
  it("Strategy Review tab renders strategy name + strategy_types + author", async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.click(screen.getByRole("tab", { name: /Strategy Review/ }));
    expect(screen.getByText("Beta Strat")).toBeTruthy(); // s.name
    expect(screen.getByText("Long-Only")).toBeTruthy(); // s.strategy_types[]
    expect(screen.getByText(/Quant Bob/)).toBeTruthy(); // s.profiles.display_name
  });

  it("Allocators tab renders display_name, company and email", async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.click(screen.getByRole("tab", { name: /Allocators/ }));
    expect(screen.getByText("Carol Allocator")).toBeTruthy();
    expect(screen.getByText(/Carol Co/)).toBeTruthy();
    expect(screen.getByText(/carol@example\.com/)).toBeTruthy();
  });

  it("Managers tab renders display_name and email", async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.click(screen.getByRole("tab", { name: /Managers/ }));
    expect(screen.getByText("Dave Manager")).toBeTruthy();
    expect(screen.getByText(/dave@example\.com/)).toBeTruthy();
  });
});

// M-0378 — reject() must surface the server's rejection-specific reason (the
// same error-body read approve() already does), not a generic "Rejection
// failed." string. The reject path is fail-loud either way, but discarding the
// server message hid actionable detail (e.g. a missing review note).
describe("AdminTabs — Strategy Review reject surfaces the server error (M-0378)", () => {
  it("renders the server-supplied rejection reason in the alert, not the generic fallback", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Review note is required." }),
    } as unknown as Response);

    renderTabs();
    await user.click(screen.getByRole("tab", { name: /Strategy Review/ }));
    // The card's ghost "Reject" (first in DOM) opens the modal + sets rejectId.
    fireEvent.click(screen.getAllByText("Reject")[0]);
    // The modal's danger "Reject" (last in DOM) confirms → reject() → fetch.
    const rejects = screen.getAllByText("Reject");
    fireEvent.click(rejects[rejects.length - 1]);

    // Server reason renders (was the generic "Rejection failed." before the fix).
    expect(await screen.findByText("Review note is required.")).toBeTruthy();
    expect(screen.queryByText("Rejection failed.")).toBeNull();
    fetchMock.mockRestore();
  });
});
