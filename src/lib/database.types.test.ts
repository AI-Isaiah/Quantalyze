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
    // Strip only `undefined` (the optionality), not `null` — `Json` itself is
    // nullable, so `NonNullable` would over-strip and break the draft pin.
    type Defined<T> = Exclude<T, undefined>;
    expectTypeOf<Defined<Update["name"]>>().toEqualTypeOf<string>();
    expectTypeOf<Defined<Update["draft"]>>().toEqualTypeOf<Json>();
    expectTypeOf<Defined<Update["schema_version"]>>().toEqualTypeOf<number>();
    expectTypeOf<Defined<Update["updated_at"]>>().toEqualTypeOf<string>();
    // Optionality itself: undefined is an allowed value for each field.
    expectTypeOf<undefined>().toMatchTypeOf<Update["name"]>();
  });
});

/**
 * Phase 25 / Plan 25-01 (SHARE-02, SHARE-03) — scenario_shares is a
 * HAND-PATCHED block in database.types.ts (added by migration 20260622120000;
 * cannot be regenerated without prod DB access, and a regen linked to a project
 * missing the migration silently reverts it). These pins make a stale regen
 * that drops a column or flips its nullability fail the build, mirroring the
 * PERSIST-01 scenarios guard above. The share generate/revoke routes (Plan
 * 25-03) type `.from("scenario_shares")` against this block.
 */
describe("SHARE — database.types scenario_shares hand-patch", () => {
  it("scenario_shares.Row exposes the migration column set with correct types", () => {
    type Row = Database["public"]["Tables"]["scenario_shares"]["Row"];
    expectTypeOf<Row["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["scenario_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["created_by"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["token_hash"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["created_at"]>().toEqualTypeOf<string>();
    // revoked_at is nullable (an active share has revoked_at = NULL).
    expectTypeOf<Row["revoked_at"]>().toEqualTypeOf<string | null>();
  });

  it("scenario_shares.Insert makes defaulted/nullable cols optional, content required", () => {
    type Insert = Database["public"]["Tables"]["scenario_shares"]["Insert"];
    // Defaulted / nullable columns are optional on insert.
    expectTypeOf<NonNullable<Insert["id"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Insert["created_at"]>>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Insert["revoked_at"]>>().toEqualTypeOf<string>();
    // Content columns are required on insert.
    expectTypeOf<Insert["scenario_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Insert["created_by"]>().toEqualTypeOf<string>();
    expectTypeOf<Insert["token_hash"]>().toEqualTypeOf<string>();
  });

  it("scenario_shares.Update makes every column optional", () => {
    type Update = Database["public"]["Tables"]["scenario_shares"]["Update"];
    // Strip only `undefined` (the optionality); revoked_at is itself nullable.
    type Defined<T> = Exclude<T, undefined>;
    expectTypeOf<Defined<Update["scenario_id"]>>().toEqualTypeOf<string>();
    expectTypeOf<Defined<Update["created_by"]>>().toEqualTypeOf<string>();
    expectTypeOf<Defined<Update["token_hash"]>>().toEqualTypeOf<string>();
    // The revoke path sets revoked_at; it must accept string | null and be optional.
    expectTypeOf<Defined<Update["revoked_at"]>>().toEqualTypeOf<string | null>();
    // Optionality itself: undefined is an allowed value for each field.
    expectTypeOf<undefined>().toMatchTypeOf<Update["revoked_at"]>();
  });
});
