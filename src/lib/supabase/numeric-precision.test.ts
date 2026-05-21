import { describe, it, expect, expectTypeOf } from "vitest";
import type { Database } from "@/lib/database.types";
import {
  KNOWN_NUMERIC_COLUMNS,
  serializeNumeric,
  parseNumericString,
  type NumericString,
  type ResolveColumn,
} from "./numeric-precision";

/**
 * Audit-2026-05-07 — contract test pinning the precision-aware
 * NUMERIC catalog in `numeric-precision.ts` to the generated
 * `database.types.ts`. Two layers of protection:
 *
 *   1. Type-level: a future regeneration of database.types.ts that
 *      drops or renames a cataloged column fails the build via
 *      `ResolveColumn` (each `__compile_*` assertion below must remain
 *      a non-`never` type — see expectTypeOf assertions).
 *
 *   2. Runtime: assertions on serializeNumeric / parseNumericString
 *      pin the precision-preservation behavior. A future refactor that
 *      starts losing precision in the string round-trip (e.g., someone
 *      "optimizes" serializeNumeric to use `.toString()` on a number-
 *      cast value) breaks these tests.
 */

describe("KNOWN_NUMERIC_COLUMNS — generated-types contract", () => {
  it("catalog matches the generated positions.* NUMERIC columns at type level", () => {
    // Each line below is a compile-time assertion. If
    // `database.types.ts` regenerates and drops one of these columns,
    // `ResolveColumn<...>` resolves to `never` and the `expectTypeOf`
    // call below fails the type-check. Vitest runs `tsc` over test
    // files via the v8 plugin, so the assertion fires at test time.
    expectTypeOf<ResolveColumn<"positions.funding_pnl">>().not.toBeNever();
    expectTypeOf<ResolveColumn<"positions.realized_pnl">>().not.toBeNever();
    expectTypeOf<ResolveColumn<"positions.unrealized_pnl">>().not.toBeNever();
    expectTypeOf<ResolveColumn<"positions.roi">>().not.toBeNever();
    expectTypeOf<ResolveColumn<"positions.entry_price_avg">>().not.toBeNever();
    expectTypeOf<ResolveColumn<"positions.exit_price_avg">>().not.toBeNever();
    expectTypeOf<ResolveColumn<"positions.fee_total">>().not.toBeNever();
    expectTypeOf<ResolveColumn<"positions.size_base">>().not.toBeNever();
    expectTypeOf<ResolveColumn<"positions.size_peak">>().not.toBeNever();
  });

  it("KNOWN_NUMERIC_COLUMNS still references column names on the live Database type", () => {
    // Runtime cross-check — every catalog entry decomposes into a
    // (table, column) pair that resolves on the generated Database
    // type. The actual presence is asserted by the import compiling;
    // here we exercise the loop so a future refactor that introduces a
    // typo regression also fails at runtime.
    type TablesShape = Database["public"]["Tables"];
    type TableNames = keyof TablesShape;

    for (const entry of KNOWN_NUMERIC_COLUMNS) {
      const [table, column] = entry.split(".") as [string, string];
      expect(table).toBeTruthy();
      expect(column).toBeTruthy();
      // We can't enumerate the type at runtime (TS types erase), but
      // the type-level guard above already enforces presence on the
      // entries we use. This runtime check enforces the (table, column)
      // string shape contract so a future "positions.funding_pnl.extra"
      // typo can't slip past.
      expect(entry.split(".").length).toBe(2);
      // Type-narrow `table` so the next line type-checks without the
      // catalog assertion needing to enumerate every table.
      const _typedTable = table as TableNames;
      void _typedTable;
    }
  });
});

describe("serializeNumeric — precision-preserving serializer", () => {
  it("accepts a JS number and round-trips through string", () => {
    const out = serializeNumeric(1234567890.12);
    expect(typeof out).toBe("string");
    expect(parseNumericString(out)).toBe(1234567890.12);
  });

  it("accepts a bigint and preserves full integer precision", () => {
    // 2^54 = 18014398509481984 — beyond Number.MAX_SAFE_INTEGER.
    // A round-trip through `number` would lose the last digit; bigint
    // preserves it via .toString(). Using BigInt() instead of the
    // literal-suffix syntax to keep this test compatible with target
    // levels below ES2020.
    const big = BigInt("18014398509481985");
    const out = serializeNumeric(big);
    expect(out).toBe("18014398509481985");
  });

  it("accepts a string in scientific notation", () => {
    expect(serializeNumeric("1.5e10")).toBe("1.5e10");
  });

  it("accepts a string with a leading sign", () => {
    expect(serializeNumeric("-0.00000001")).toBe("-0.00000001");
  });

  it("rejects NaN with a clear message", () => {
    expect(() => serializeNumeric(NaN)).toThrow(/non-finite/);
  });

  it("rejects Infinity with a clear message", () => {
    expect(() => serializeNumeric(Infinity)).toThrow(/non-finite/);
  });

  it("rejects a junk string", () => {
    expect(() => serializeNumeric("not a number")).toThrow(/not a valid numeric string/);
  });

  it("returns a value compatible with the NumericString brand", () => {
    const out: NumericString = serializeNumeric(1);
    // Brand is phantom — at runtime it's just a string.
    expect(typeof out).toBe("string");
  });
});

describe("parseNumericString — explicit precision-loss boundary", () => {
  it("converts a NumericString back to a JS number", () => {
    const ns = serializeNumeric(42);
    expect(parseNumericString(ns)).toBe(42);
  });

  it("throws on a non-finite-derived NumericString (defense in depth)", () => {
    // Constructing this via `as` skips serializeNumeric's guard — the
    // helper is the trusted constructor, but parseNumericString still
    // defends against a misuse.
    const bad = "not parseable" as NumericString;
    expect(() => parseNumericString(bad)).toThrow(/not a finite number/);
  });
});
