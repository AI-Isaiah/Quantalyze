import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { getAllocatorMatchPayload, STRATEGY_ANALYTICS_MATCH_COLUMNS } from "./match";
import { RECORD_SCALAR_ALIASES } from "@/lib/figure-record-scalars";

/**
 * Why these tests exist (Phase 170 VERIFICATION gap 6).
 *
 * `allocator_preferences` is read with `.maybeSingle()`: an allocator who has
 * never saved a mandate has NO row, and that is a legitimate state. The payload
 * type declares `preferences: … | null` and the admin page renders a null
 * preferences object. The old code cast it with the THROWING `castRow`, so every
 * such allocator made `/admin/match/<id>` answer 500. These tests pin the
 * legitimate null on BOTH return paths, and pin that real failures stay loud:
 * a preferences query error still rejects, and a missing PROFILE still throws.
 */

type Res = { data: unknown; error: unknown };

const ALLOCATOR_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ROW = {
  id: ALLOCATOR_ID,
  display_name: "Synthetic Allocator",
  company: null,
  email: null,
  role: "allocator",
  allocator_status: "active",
  preferences_updated_at: null,
};
const BATCH_ROW = {
  id: "00000000-0000-4000-8000-0000000000b1",
  computed_at: "2026-01-01T00:00:00Z",
  mode: "personalized",
};

function fakeAdmin(tables: Record<string, Res>): SupabaseClient {
  return {
    from(table: string) {
      const res: Res = tables[table] ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "in"]) {
        builder[m] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve(res);
      builder.single = () => Promise.resolve(res);
      builder.then = (
        onFulfilled: (v: Res) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(res).then(onFulfilled, onRejected);
      return builder;
    },
  } as unknown as SupabaseClient;
}

function baseTables(overrides: Record<string, Res> = {}): Record<string, Res> {
  return {
    match_batches: { data: null, error: null },
    allocator_preferences: { data: null, error: null },
    profiles: { data: PROFILE_ROW, error: null },
    match_decisions: { data: [], error: null },
    contact_requests: { data: [], error: null },
    ...overrides,
  };
}

describe("getAllocatorMatchPayload: allocator with no preferences row", () => {
  it("no-batch path returns preferences null instead of throwing", async () => {
    const payload = await getAllocatorMatchPayload(fakeAdmin(baseTables()), ALLOCATOR_ID);
    expect(payload.preferences).toBeNull();
    expect(payload.batch).toBeNull();
    expect(payload.profile).toEqual(PROFILE_ROW);
  });

  it("batch path returns preferences null instead of throwing", async () => {
    const payload = await getAllocatorMatchPayload(
      fakeAdmin(
        baseTables({
          match_batches: { data: BATCH_ROW, error: null },
          match_candidates: { data: [], error: null },
        }),
      ),
      ALLOCATOR_ID,
    );
    expect(payload.preferences).toBeNull();
    expect(payload.batch).toEqual(BATCH_ROW);
    expect(payload.candidates).toEqual([]);
  });
});

describe("getAllocatorMatchPayload: real failures stay loud", () => {
  it("a preferences query error still rejects", async () => {
    await expect(
      getAllocatorMatchPayload(
        fakeAdmin(
          baseTables({ allocator_preferences: { data: null, error: { message: "boom" } } }),
        ),
        ALLOCATOR_ID,
      ),
    ).rejects.toMatchObject({ message: "boom" });
  });

  it("a missing profile still throws through castRow", async () => {
    await expect(
      getAllocatorMatchPayload(
        fakeAdmin(baseTables({ profiles: { data: null, error: null } })),
        ALLOCATOR_ID,
      ),
    ).rejects.toThrow(/castRow.*profile/);
  });
});

/**
 * Phase 194.1 B12b (194 D-12 / D-15) - the candidate detail judges its annualised figures on
 * the strategy's total record, so the loader must read the four record scalar aliases beside
 * the match columns and `asset_class` on the candidate join. The aliases are appended at the
 * read, never to `STRATEGY_ANALYTICS_MATCH_COLUMNS`, whose schema-sync backstop checks every
 * name in it is a real column.
 *
 * Neuter to redden: drop `, ${RECORD_SCALAR_ALIASES}` from the bulk `strategy_analytics`
 * select in `match.ts`.
 */
describe("getAllocatorMatchPayload: the reads the record verdict needs (194.1 B12b)", () => {
  it("appends the record aliases to the bulk analytics read and reads asset_class on the join", async () => {
    const selects: Record<string, string[]> = {};
    const base = fakeAdmin({
      ...baseTables({
        match_batches: { data: BATCH_ROW, error: null },
        match_candidates: {
          data: [
            {
              id: "c1",
              strategy_id: "00000000-0000-4000-8000-0000000000c1",
              exclusion_reason: null,
            },
          ],
          error: null,
        },
        strategy_analytics: { data: [], error: null },
      }),
    });
    const spied = {
      from(table: string) {
        const builder = (base as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
        const select = builder.select as (...a: unknown[]) => unknown;
        builder.select = (...args: unknown[]) => {
          (selects[table] ??= []).push(String(args[0]));
          return select(...args);
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    await getAllocatorMatchPayload(spied, ALLOCATOR_ID);

    expect(selects.strategy_analytics).toEqual([
      `${STRATEGY_ANALYTICS_MATCH_COLUMNS}, ${RECORD_SCALAR_ALIASES}`,
    ]);
    expect(selects.match_candidates).toHaveLength(1);
    expect(selects.match_candidates[0]).toMatch(/\basset_class\b/);
    // The constant itself stays a plain column list the schema-sync test can check.
    expect(STRATEGY_ANALYTICS_MATCH_COLUMNS).not.toMatch(/[:>]/);
  });

  // Phase 201 / D-17: the admin match queue names a strategy only when it is published,
  // so both strategy embeds must read `status`. Without it every row is not visible
  // and keeps its codename. Neuter to redden: drop `status` from either embed.
  it("reads the strategy's status in the candidate and decision embeds (D-17)", async () => {
    const selects: Record<string, string[]> = {};
    const base = fakeAdmin({
      ...baseTables({
        match_batches: { data: BATCH_ROW, error: null },
        match_candidates: { data: [], error: null },
      }),
    });
    const spied = {
      from(table: string) {
        const builder = (base as unknown as { from: (t: string) => Record<string, unknown> }).from(table);
        const select = builder.select as (...a: unknown[]) => unknown;
        builder.select = (...args: unknown[]) => {
          (selects[table] ??= []).push(String(args[0]));
          return select(...args);
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    await getAllocatorMatchPayload(spied, ALLOCATOR_ID);

    expect(selects.match_candidates[0]).toMatch(/strategies!match_candidates_strategy_id_fkey\([^)]*\bstatus\b/);
    expect(selects.match_decisions[0]).toMatch(/strategies!match_decisions_strategy_id_fkey\([^)]*\bstatus\b/);
  });
});
