import { describe, it, expectTypeOf } from "vitest";
import type { Database, Json } from "@/lib/database.types";

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

/**
 * Phase 23 / Plan 23-01 (PERSIST-01) — scenarios is a HAND-PATCHED block in
 * database.types.ts (added by migration 20260621120000; cannot be regenerated
 * without prod DB access, and a regen linked to a project missing the migration
 * silently reverts it). These pins make a stale regen that drops a column or
 * flips its nullability fail the build, mirroring the C-0156 drift guard above.
 */
describe("PERSIST-01 — database.types scenarios hand-patch", () => {
  it("scenarios.Row exposes the migration column set with correct types", () => {
    type Row = Database["public"]["Tables"]["scenarios"]["Row"];
    expectTypeOf<Row["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["allocator_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["name"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["draft"]>().toEqualTypeOf<Json>();
    expectTypeOf<Row["schema_version"]>().toEqualTypeOf<number>();
    expectTypeOf<Row["created_at"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["updated_at"]>().toEqualTypeOf<string>();
  });

  it("scenarios.Insert makes defaulted cols optional, content required", () => {
    type Insert = Database["public"]["Tables"]["scenarios"]["Insert"];
    // Defaulted columns are optional (so an INSERT may omit them).
    expectTypeOf<NonNullable<Insert["id"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Insert["created_at"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Insert["updated_at"]>>().toEqualTypeOf<string>();
    // Content columns are required on insert.
    expectTypeOf<Insert["allocator_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Insert["name"]>().toEqualTypeOf<string>();
    expectTypeOf<Insert["draft"]>().toEqualTypeOf<Json>();
    expectTypeOf<Insert["schema_version"]>().toEqualTypeOf<number>();
  });

  it("scenarios.Update makes every column optional", () => {
    type Update = Database["public"]["Tables"]["scenarios"]["Update"];
    expectTypeOf<NonNullable<Update["name"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Update["draft"]>>().toEqualTypeOf<Json>();
    expectTypeOf<NonNullable<Update["schema_version"]>>().toEqualTypeOf<number>();
    expectTypeOf<NonNullable<Update["updated_at"]>>().toEqualTypeOf<string>();
  });
});
