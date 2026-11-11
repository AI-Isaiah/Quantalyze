/**
 * Phase 201 / R2-02 (F-11, D-21) - the daily funnel's Day column reads through
 * `formatDay`, never as the raw `YYYY-MM-DD` the PostHog query returns.
 *
 * Neuter to redden: render `{row.day}` bare in `page.tsx` (the cell then reads
 * `2026-04-16`).
 *
 * Phase 201 plan 39 (F-11, D-11, R3-01): the session-heatmap column headers read
 * through `formatDay` too ("Apr 16, 2026"), never the yearless `04-16` fragment.
 * The `days` keys and the per-row `by_day` lookups stay ISO, so each count must
 * still land under its own column.
 *
 * Neuter to redden: print `{d.slice(5)}` in the heatmap header again.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

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
  // The heatmap join reads profile labels; no profile matches, so the raw id stays.
  createAdminClient: () => ({
    from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }),
  }),
}));

vi.mock("@/lib/admin/usage-metrics", () => ({
  dailyFunnel: vi.fn(async () => ({
    rows: [
      {
        day: "2026-04-16",
        session_start: 1,
        widget_viewed: 2,
        intro_submitted: 3,
        bridge_click: 4,
        alert_acknowledged: 5,
      },
    ],
  })),
  widgetViews: vi.fn(async () => ({ rows: [] })),
  sessionHeatmap: vi.fn(async () => ({ rows: [], days: [] })),
}));

import AdminUsagePage from "./page";
import { sessionHeatmap } from "@/lib/admin/usage-metrics";

describe("/admin/usage daily funnel", () => {
  it("prints the Day column as a formatted day, not the raw ISO string", async () => {
    const { container } = render(await AdminUsagePage());
    const text = container.textContent ?? "";
    expect(text).toContain("Apr 16, 2026");
    expect(text).not.toContain("2026-04-16");
  });
});

describe("/admin/usage session heatmap", () => {
  it("prints each column header as a formatted day and keeps each count under its own ISO-keyed column", async () => {
    vi.mocked(sessionHeatmap).mockResolvedValueOnce({
      days: ["2026-04-16", "2026-04-17"],
      rows: [
        { email: "allocator-1", by_day: { "2026-04-16": 3, "2026-04-17": 7 }, total: 10 },
      ],
    });
    const { container } = render(await AdminUsagePage());
    const headers = Array.from(container.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toContain("Apr 16, 2026");
    expect(headers).toContain("Apr 17, 2026");
    // The yearless raw fragment is gone from every header.
    expect(headers).not.toContain("04-16");
    expect(headers).not.toContain("04-17");
    // Counts still sit under the right column: row cells are
    // [allocator, 04-16 count, 04-17 count, total].
    const row = Array.from(container.querySelectorAll("tr")).find((tr) =>
      tr.textContent?.includes("allocator-1"),
    );
    expect(Array.from(row!.querySelectorAll("td")).map((td) => td.textContent)).toEqual([
      "allocator-1",
      "3",
      "7",
      "10",
    ]);
  });
});
