/**
 * Phase 201 plan 20 (D-11, U-13) - /admin/deletion-requests prints its two stamps through
 * `formatDayTime` in cells that cannot wrap. WHY: a deletion ledger is read for its timing, so
 * the same instant must read the same on every machine (UTC, named), and a wrapped stamp splits
 * the date from its time. Harness copied from the sibling admin page tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const state = vi.hoisted(() => ({ requests: [] as Record<string, unknown>[] }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`unexpected redirect to ${to}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }),
    },
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "order"]) {
        builder[method] = () => builder;
      }
      builder.limit = () => Promise.resolve({ data: state.requests, error: null });
      return builder;
    },
  })),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(async () => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = () =>
        Promise.resolve({
          data: [{ id: "user-1", display_name: "Jane", email: "jane@example.com" }],
          error: null,
        });
      return builder;
    },
  }),
}));

// The action buttons are a client component with their own behaviour.
vi.mock("@/components/admin/DeletionRequestActions", () => ({
  DeletionRequestActions: () => null,
}));

import AdminDeletionRequestsPage from "./page";

function request(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "req-1",
    user_id: "user-1",
    requested_at: "2026-10-09T14:05:00Z",
    completed_at: null,
    rejected_at: null,
    rejection_reason: null,
    notes: null,
    ...overrides,
  };
}

async function renderPage() {
  render(await AdminDeletionRequestsPage());
}

beforeEach(() => {
  state.requests = [];
});

describe("/admin/deletion-requests - dates (D-11)", () => {
  it("prints Requested and Terminal at as 'Oct 9, 2026, 14:05 UTC' in nowrap cells", async () => {
    state.requests = [request({ completed_at: "2026-10-10T08:30:00Z" })];
    await renderPage();

    const row = screen.getByText("Jane").closest("tr") as HTMLElement;
    const requested = within(row).getByText("Oct 9, 2026, 14:05 UTC");
    const terminal = within(row).getByText("Oct 10, 2026, 08:30 UTC");
    expect(requested.className).toContain("whitespace-nowrap");
    expect(terminal.className).toContain("whitespace-nowrap");
  });

  it("a pending request has an em dash for Terminal at", async () => {
    state.requests = [request({})];
    await renderPage();

    const row = screen.getByText("Jane").closest("tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell");
    expect(cells[2].textContent).toBe("Oct\u00a09,\u00a02026, 14:05\u00a0UTC");
    expect(cells[3].textContent).toBe("—");
  });
});
