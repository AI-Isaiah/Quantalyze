import { describe, it, expectTypeOf } from "vitest";
import type { Database } from "@/lib/database.types";

/**
 * audit-2026-05-07 C-0156 — regression. positions.duration_seconds was added
 * in migration 114 (20260510182439_positions_schema_rls_g12d.sql) but the
 * generated Database type was never re-synced. The numeric-precision contract
 * (sibling file) resolves NUMERIC columns through this type, so the column
 * was invisible to the gate until now. This regression pins the column's
 * presence so a future stale regen drops the column AND fails the build.
 */
describe("C-0156 — database.types positions schema drift", () => {
  it("positions.Row exposes duration_seconds as number | null (migration 114)", () => {
    type Row = Database["public"]["Tables"]["positions"]["Row"];
    type DurationSeconds = Row["duration_seconds"];
    expectTypeOf<DurationSeconds>().toEqualTypeOf<number | null>();
  });

  it("positions.Insert accepts optional duration_seconds", () => {
    type Insert = Database["public"]["Tables"]["positions"]["Insert"];
    // Field exists and is optional (so existing INSERTs that omit it stay valid).
    type DS = NonNullable<Insert["duration_seconds"]>;
    expectTypeOf<DS>().toEqualTypeOf<number>();
  });
});
