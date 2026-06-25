/**
 * Phase 36 / D4 (v1.2.1) — GDPR per-key csv_daily_returns export axis.
 *
 * `csv_daily_returns` is owned via TWO axes after the per-key migration
 * (20260624120000_csv_daily_returns_per_key_axis.sql):
 *
 *   1. STRATEGY rows  — `strategy_id` set, `allocator_id` NULL — exported
 *      via the EXISTING indirect entry (strategy_id → strategies.user_id).
 *   2. PER-KEY rows   — `strategy_id` NULL, `api_key_id` + `allocator_id`
 *      set — exported via the NEW projected entry on the allocator_id axis.
 *
 * Why this matters (the silent-omission gap D4 closes): per-key rows have
 * `strategy_id NULL`, so the indirect sub-select `strategy_id IN (...)`
 * NEVER matches them (`NULL IN (...)` is never true). The CI coverage hook
 * stays GREEN regardless (the table NAME is present), so this is a
 * correctness/compliance gap the hook cannot catch. Once the post-deploy
 * backfill (D6) populates per-key rows, an Art.15/20 bundle would silently
 * omit them without the projected axis added here.
 *
 * This file pins all three invariants:
 *   (a) an allocator's per-key rows (allocator_id = subject) export via the
 *       per-key projection;
 *   (b) the strategy-scoped indirect axis is still present in the manifest;
 *   (c) a DIFFERENT allocator's per-key rows NEVER appear (the project fn
 *       re-filters allocator_id !== subject as defense-in-depth);
 *   (d) the projected spec orders by `date` (inherited via source_table).
 *
 * Mirrors the unit-pinning style of gdpr-export-redaction.test.ts.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  USER_EXPORT_TABLES,
  redactCsvDailyReturnsPerKeyForUser,
  getOrderColumn,
} from "@/lib/gdpr-export";

describe("redactCsvDailyReturnsPerKeyForUser (D4) — per-key axis projection", () => {
  const subject = "aaaa0000-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const otherAllocator = "bbbb1111-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  it("keeps ONLY the subject's per-key rows; drops a different allocator's per-key rows; drops strategy rows (allocator_id null)", () => {
    const rows = [
      // Subject's per-key row (strategy_id NULL, allocator_id = subject) — KEEP.
      {
        id: 1,
        api_key_id: "key-subject",
        allocator_id: subject,
        strategy_id: null,
        date: "2026-06-01",
        daily_return: 0.012,
      },
      // ANOTHER allocator's per-key row — defense-in-depth DROP (the SQL
      // .eq(allocator_id, subject) would already exclude it, but the project
      // fn re-filters so a future query change cannot leak cross-tenant rows).
      {
        id: 2,
        api_key_id: "key-other",
        allocator_id: otherAllocator,
        strategy_id: null,
        date: "2026-06-01",
        daily_return: 0.5,
      },
      // A strategy-scoped row has allocator_id NULL — it never matches the
      // per-key axis (it is exported via the indirect strategy_id axis). DROP.
      {
        id: 3,
        api_key_id: null,
        allocator_id: null,
        strategy_id: "strat-1",
        date: "2026-06-01",
        daily_return: 0.003,
      },
    ];
    const out = redactCsvDailyReturnsPerKeyForUser(rows, subject);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
    expect(out[0].allocator_id).toBe(subject);
  });

  it("does NOT strip any columns — per-key rows carry only the subject's own data", () => {
    const rows = [
      {
        id: 7,
        api_key_id: "key-subject",
        allocator_id: subject,
        strategy_id: null,
        date: "2026-06-02",
        daily_return: -0.004,
      },
    ];
    const out = redactCsvDailyReturnsPerKeyForUser(rows, subject);
    expect(out).toHaveLength(1);
    // The row round-trips untouched (identity passthrough, no blanking).
    expect(out[0]).toEqual(rows[0]);
  });

  it("handles non-object / null rows without throwing", () => {
    const rows = [null, 42, "x", { allocator_id: subject, id: 9 }];
    expect(() =>
      redactCsvDailyReturnsPerKeyForUser(rows, subject),
    ).not.toThrow();
    const out = redactCsvDailyReturnsPerKeyForUser(rows, subject);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(9);
  });
});

describe("USER_EXPORT_TABLES — csv_daily_returns owned via TWO axes (D4)", () => {
  it("retains the EXISTING indirect (strategy_id) entry — strategy rows still export", () => {
    const indirect = USER_EXPORT_TABLES.find(
      (t) => t.table === "csv_daily_returns" && t.kind === "indirect",
    );
    expect(
      indirect,
      "indirect csv_daily_returns axis must remain — strategy-scoped rows would be silently dropped otherwise",
    ).toBeDefined();
    if (indirect?.kind !== "indirect") return;
    expect(indirect.via_column).toBe("strategy_id");
    expect(indirect.parent_table).toBe("strategies");
    expect(indirect.parent_user_column).toBe("user_id");
  });

  it("adds the NEW projected csv_daily_returns_per_key entry on the allocator_id axis", () => {
    const projected = USER_EXPORT_TABLES.find(
      (t) => t.table === "csv_daily_returns_per_key",
    );
    expect(
      projected,
      "projected per-key axis must be present — per-key rows (strategy_id NULL) are silently omitted otherwise",
    ).toBeDefined();
    if (projected?.kind !== "projected") {
      throw new Error("csv_daily_returns_per_key must be a projected entry");
    }
    expect(projected.kind).toBe("projected");
    expect(projected.source_table).toBe("csv_daily_returns");
    expect(projected.user_column).toBe("allocator_id");
    expect(projected.project).toBe(redactCsvDailyReturnsPerKeyForUser);
    // No or_filter: the bare .eq(allocator_id, userId) IS the exact predicate
    // the projection enforces; widening would be wrong (ProjectedUserTable docs).
    expect(projected.or_filter).toBeUndefined();
  });

  it("both axes coexist — a future refactor dropping either fails loudly", () => {
    const csvEntries = USER_EXPORT_TABLES.filter(
      (t) =>
        t.table === "csv_daily_returns" ||
        t.table === "csv_daily_returns_per_key",
    );
    const kinds = csvEntries.map((t) => t.kind).sort();
    expect(kinds).toEqual(["indirect", "projected"]);
  });

  it("getOrderColumn returns 'date' for the projected per-key spec (inherited via source_table)", () => {
    const projected = USER_EXPORT_TABLES.find(
      (t) => t.table === "csv_daily_returns_per_key",
    );
    expect(projected).toBeDefined();
    expect(getOrderColumn(projected!)).toBe("date");
  });
});
