/**
 * Phase 194 plan 07 (T-194-19): `readRecordSpan` is a public-page read of a private
 * table. Its privacy contract is the select string: four scalar JSON-path aliases and
 * never `returns_series`, `data_quality_flags` or `metrics_json` whole.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import { readRecordSpan, RECORD_SPAN_SELECT } from "./record-span-read";
import { captureToSentry } from "@/lib/sentry-capture";
import type { SupabaseClient } from "@supabase/supabase-js";

type Read = { data: unknown; error: { message: string } | null } | "throw";

function client(read: Read) {
  const seen = { select: "", filters: [] as Array<[string, unknown]> };
  const builder = {
    select: (cols: string) => {
      seen.select = cols;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      seen.filters.push(["eq:" + col, val]);
      return builder;
    },
    maybeSingle: async () => {
      if (read === "throw") throw new Error("read exploded");
      return read;
    },
  };
  return { seen, supabase: { from: () => builder } as unknown as SupabaseClient };
}

beforeEach(() => {
  vi.mocked(captureToSentry).mockClear();
});

describe("readRecordSpan: the select is four scalar aliases (T-194-19)", () => {
  it("projects exactly the four aliases and no blob token", () => {
    const aliases = [
      "series_start:returns_series->0->>date",
      "series_end:returns_series->-1->>date",
      "headline_since:data_quality_flags->>headline_since",
      "record_observations:metrics_json->record_observations",
    ];
    for (const a of aliases) expect(RECORD_SPAN_SELECT).toContain(a);
    // Remove every permitted alias form; no column name may remain bare.
    let rest = RECORD_SPAN_SELECT;
    for (const a of aliases) rest = rest.replace(a, "");
    expect(rest).not.toMatch(/returns_series|data_quality_flags|metrics_json/);
  });

  it("is one strategy id, published-only, on the caller's client", async () => {
    const { seen, supabase } = client({ data: { strategy_analytics: {} }, error: null });
    await readRecordSpan(supabase, "s-1");
    expect(seen.select).toBe(RECORD_SPAN_SELECT);
    expect(seen.filters).toContainEqual(["eq:id", "s-1"]);
    expect(seen.filters).toContainEqual(["eq:status", "published"]);
  });
});

describe("readRecordSpan: results", () => {
  it("ok: returns the four scalars", async () => {
    const { supabase } = client({
      data: {
        strategy_analytics: {
          series_start: "2024-01-01",
          series_end: "2024-06-30",
          headline_since: "2024-02-01",
          record_observations: 120,
        },
      },
      error: null,
    });
    expect(await readRecordSpan(supabase, "s-1")).toEqual({
      determined: true,
      seriesStart: "2024-01-01",
      seriesEnd: "2024-06-30",
      headlineSince: "2024-02-01",
      observations: 120,
    });
  });

  it("an array embed reads like an object embed", async () => {
    const { supabase } = client({
      data: { strategy_analytics: [{ series_start: "2024-01-01", series_end: "2024-02-01" }] },
      error: null,
    });
    const r = await readRecordSpan(supabase, "s-1");
    expect(r).toMatchObject({ determined: true, seriesStart: "2024-01-01", seriesEnd: "2024-02-01" });
  });

  it("null dates and a null count come back as null, still determined", async () => {
    const { supabase } = client({
      data: {
        strategy_analytics: {
          series_start: null,
          series_end: null,
          headline_since: null,
          record_observations: null,
        },
      },
      error: null,
    });
    expect(await readRecordSpan(supabase, "s-1")).toEqual({
      determined: true,
      seriesStart: null,
      seriesEnd: null,
      headlineSince: null,
      observations: null,
    });
  });

  it("a non-numeric or non-finite count is null, never a coerced number", async () => {
    const { supabase } = client({
      data: { strategy_analytics: { record_observations: "120" } },
      error: null,
    });
    expect(await readRecordSpan(supabase, "s-1")).toMatchObject({ determined: true, observations: null });
  });
});

describe("readRecordSpan: fails closed and reports", () => {
  it("a read error is undetermined and reported", async () => {
    const { supabase } = client({ data: null, error: { message: "statement timeout" } });
    expect(await readRecordSpan(supabase, "s-1")).toEqual({ determined: false });
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  it("a thrown read is undetermined and reported", async () => {
    const { supabase } = client("throw");
    expect(await readRecordSpan(supabase, "s-1")).toEqual({ determined: false });
    expect(captureToSentry).toHaveBeenCalledTimes(1);
  });

  it("no row (an unpublish race) is undetermined, not an empty record", async () => {
    const { supabase } = client({ data: null, error: null });
    expect(await readRecordSpan(supabase, "s-1")).toEqual({ determined: false });
  });
});
