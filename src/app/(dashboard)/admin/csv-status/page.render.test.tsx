/**
 * Phase 170.1.2 plan 02 (D-01) — /admin/csv-status renders status and trust
 * tier as words, and its description carries no internal filter text. The
 * sibling page.test.ts guards the factsheet link at the source level; this file
 * mounts the page. Harness copied from src/app/(dashboard)/admin/page.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

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
  })),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: vi.fn(async () => true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        listUsers: async () => ({
          data: { users: [{ id: "user-1", email: "team@example.com" }] },
          error: null,
        }),
      },
    },
    from: () => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order"]) {
        builder[method] = () => builder;
      }
      builder.limit = () => Promise.resolve({ data: state.rows, error: null });
      return builder;
    },
  }),
}));

import CsvStatusPage from "./page";

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "v-1",
    status: "metrics_captured",
    trust_tier: "api_verified",
    flow_type: "csv",
    created_at: "2026-10-20T12:00:00.000Z",
    updated_at: "2026-10-20T12:00:00.000Z",
    wizard_session_id: null,
    strategy_id: "s-1",
    strategies: { id: "s-1", name: "Alpha", user_id: "user-1", status: "draft" },
    ...overrides,
  };
}

async function renderPage() {
  render(await CsvStatusPage());
}

beforeEach(() => {
  state.rows = [];
});

describe("/admin/csv-status — labels (D-01)", () => {
  it("renders a known status and trust tier as words, not raw values", async () => {
    state.rows = [row({ status: "metrics_captured", trust_tier: "api_verified" })];
    await renderPage();

    const tableRow = screen.getByText("Alpha").closest("tr") as HTMLElement;
    const cells = within(tableRow);
    expect(cells.getByText("Metrics captured")).toBeTruthy();
    expect(cells.getByTestId("trust-tier-label").textContent).toBe("API verified");
    expect(tableRow.textContent).not.toMatch(/metrics_captured|api_verified/);
  });

  it("renders an unknown status as Unknown status, never the raw value", async () => {
    state.rows = [row({ status: "some_future_status" })];
    await renderPage();

    const tableRow = screen.getByText("Alpha").closest("tr") as HTMLElement;
    expect(within(tableRow).getByText("Unknown status")).toBeTruthy();
    expect(tableRow.textContent).not.toContain("some_future_status");
  });

  it("reads the description without the internal filter text", async () => {
    await renderPage();

    expect(
      screen.getByText("Track-record uploads from quant teams, most recent first."),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("flow_type");
  });
});
