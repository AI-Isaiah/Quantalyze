/**
 * Phase 170.1.2 plan 02 (D-01) — /admin/compute-jobs shows job kinds, statuses,
 * errors and targets as words and names, never as raw column values or id
 * fragments. Harness copied from src/app/(dashboard)/admin/page.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const state = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  jobsError: null as { code: string; message: string } | null,
  fills: [] as unknown,
  selects: [] as { table: string; columns: string }[],
}));

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

// The page awaits two different terminal calls: `.limit()` on the jobs read and
// `.eq()` on the head-only analytics count. Each resolves its own result.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: () => Promise.resolve({ data: state.fills, error: null }),
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => {
        state.selects.push({ table, columns });
        return builder;
      };
      builder.order = () => builder;
      builder.limit = () =>
        Promise.resolve(
          state.jobsError
            ? { data: null, error: state.jobsError }
            : { data: state.jobs, error: null },
        );
      builder.eq = () => Promise.resolve({ count: 0, error: null });
      return builder;
    },
  }),
}));

import ComputeJobsPage from "./page";

const NOW = "2026-10-20T12:00:00.000Z";

function job(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "9f8e7d6c-0000-4000-8000-000000000001",
    strategy_id: null,
    portfolio_id: null,
    strategy_name: null,
    portfolio_name: null,
    kind: "sync_trades",
    status: "done",
    attempts: 1,
    max_attempts: 3,
    last_error: null,
    error_kind: null,
    exchange: null,
    trade_count: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

async function renderPage() {
  render(await ComputeJobsPage());
}

/** The row whose Kind cell is `kind`, for assertions scoped to one job. */
function rowOf(kindText: string): HTMLElement {
  return screen.getByRole("cell", { name: kindText }).closest("tr") as HTMLElement;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.jobs = [];
  state.jobsError = null;
  state.fills = [];
  state.selects = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("/admin/compute-jobs — labels (D-01)", () => {
  it("renders kind, status, error kind and exchange as words, and the strategy by name", async () => {
    state.jobs = [
      job({
        kind: "sync_trades",
        status: "failed_retry",
        error_kind: "transient",
        last_error: "boom",
        strategy_id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        strategy_name: "Alpha",
        exchange: "binance",
      }),
    ];
    await renderPage();

    const row = rowOf("Trade sync");
    const cells = within(row);
    expect(cells.getByText("Retrying")).toBeTruthy();
    expect(cells.getByText("Temporary error: boom")).toBeTruthy();
    expect(cells.getByText("Alpha")).toBeTruthy();
    expect(cells.getByText("Binance")).toBeTruthy();
    // The raw values are gone from the row.
    expect(row.textContent).not.toMatch(/sync_trades|failed_retry|transient|binance/);
  });

  it("falls back to Unnamed strategy, Unnamed portfolio, and an em dash for the target", async () => {
    state.jobs = [
      job({
        id: "00000000-0000-4000-8000-00000000000a",
        kind: "sync_trades",
        strategy_id: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
      job({
        id: "00000000-0000-4000-8000-00000000000b",
        kind: "stitch_composite",
        portfolio_id: "33333333-cccc-4ccc-8ccc-cccccccccccc",
      }),
      job({ id: "00000000-0000-4000-8000-00000000000c", kind: "derive_allocator_equity" }),
    ];
    await renderPage();

    expect(within(rowOf("Trade sync")).getByText("Unnamed strategy")).toBeTruthy();
    const portfolioRow = within(rowOf("Composite stitch"));
    expect(portfolioRow.getByText("Unnamed portfolio")).toBeTruthy();
    const noTarget = rowOf("Allocator equity derivation");
    // Target is the third cell; the em dash there is the "no target" answer.
    expect(within(noTarget).getAllByRole("cell")[2].textContent).toBe("—");
  });

  it("renders a null error kind as the bare excerpt, with no prefix and no leading colon", async () => {
    state.jobs = [job({ last_error: "boom", error_kind: null })];
    await renderPage();

    const errorCell = within(rowOf("Trade sync")).getAllByRole("cell")[6];
    expect(errorCell.textContent).toBe("boom");
  });

  it("never renders an 8-character slice of a job, strategy or portfolio id", async () => {
    const ids = {
      job: "abcd1234-0000-4000-8000-000000000001",
      strategy: "deadbeef-1111-4111-8111-111111111111",
      portfolio: "cafef00d-2222-4222-8222-222222222222",
    };
    state.jobs = [
      job({ id: ids.job, strategy_id: ids.strategy }),
      job({ id: "abcd1234-0000-4000-8000-000000000002", portfolio_id: ids.portfolio, kind: "stitch_composite" }),
    ];
    await renderPage();

    const html = document.body.innerHTML;
    for (const id of Object.values(ids)) {
      expect(html).not.toContain(id.slice(0, 8));
    }
  });

  it("describes Recent jobs as '{status label}: {count}' joined by commas", async () => {
    state.jobs = [
      job({ id: "00000000-0000-4000-8000-0000000000a1", status: "done" }),
      job({ id: "00000000-0000-4000-8000-0000000000a2", status: "done" }),
      job({ id: "00000000-0000-4000-8000-0000000000a3", status: "done" }),
      job({ id: "00000000-0000-4000-8000-0000000000a4", status: "failed_retry" }),
    ];
    await renderPage();

    expect(screen.getByText("Done: 3, Retrying: 1")).toBeTruthy();
  });

  it("reads the card copy without internal text: no flag name, no N/A", async () => {
    state.fills = null; // RPC unavailable -> unknown count
    await renderPage();

    expect(
      screen.getByText("Analytics rows whose position metrics did not compute"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("position_metrics_failed");
    expect(document.body.textContent).not.toContain("N/A");
    // The unknown fills count is an em dash, not a fabricated number.
    const card = screen.getByText("Strategies Missing Fills").parentElement as HTMLElement;
    expect(within(card).getByText("—")).toBeTruthy();
  });
});

describe("/admin/compute-jobs — the read", () => {
  it("reads the compute_jobs_admin view with an explicit list: names yes, user_email and claim_token never", async () => {
    await renderPage();

    const read = state.selects.find((s) => s.table === "compute_jobs_admin");
    expect(read, "the jobs read targets the compute_jobs_admin view").toBeTruthy();
    expect(read!.columns).toContain("strategy_name");
    expect(read!.columns).toContain("portfolio_name");
    expect(read!.columns).not.toContain("user_email");
    expect(read!.columns).not.toContain("claim_token");
    expect(read!.columns).not.toContain("*");
  });

  it("throws, and logs the query name, when the jobs read fails (an error is not an empty queue)", async () => {
    state.jobsError = { code: "PGRST200", message: "view not found" };
    await expect(ComputeJobsPage()).rejects.toThrow(/jobs query failed/);
    expect(errorSpy).toHaveBeenCalledWith(
      "[admin/compute-jobs] jobs query failed",
      state.jobsError,
    );
  });
});
