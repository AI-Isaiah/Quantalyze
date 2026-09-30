import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { getAllocatorMatchPayload } from "./match";

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
