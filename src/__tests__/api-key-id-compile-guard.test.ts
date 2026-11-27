/**
 * Phase 244 DBACC-04 — compile-time guard for `Strategy.api_key_id`.
 *
 * These tests do NOT exercise runtime behaviour — they assert TYPES. The owner
 * type `Strategy` carries a REQUIRED `api_key_id: string | null`; readers that
 * select `STRATEGY_PUBLIC_COLUMNS` (anon holds no SELECT on the key) return the
 * key-free `PublicStrategy` / `PublicRankedStrategyRow`. If `Strategy.api_key_id`
 * goes optional again, or a public reader starts returning `Strategy`, the
 * `@ts-expect-error` lines below FLIP: the expected error disappears and
 * `tsc --noEmit` fails with "Unused '@ts-expect-error' directive". That tsc
 * failure IS the test — the `frontend-typecheck` CI job is the gate; vitest
 * itself cannot surface the directives at runtime. The single live `it()` is a
 * smoke check.
 *
 * Honest limit: the guard protects code that TAKES `Strategy`. It does NOT make an
 * owner read that lost `api_key_id` fail to compile: every owner read gets its row
 * type from a cast (`as unknown as Strategy`, `as unknown as OwnerListRow[]`) or an
 * explicit generic over an unchecked select string, so a select without the key
 * still type-checks. That half is pinned by the source scan in
 * `api-key-id-owner-read-pin.test.ts`, not by tsc. (`anon-strategies-projection.test.ts`
 * covers the PUBLIC readers only.) A structurally typed helper that declares the key
 * optional (for example the owner list page's local shape helper `shapeOf` in
 * `src/app/(dashboard)/strategies/page.tsx`) is invisible to both.
 *
 * Type-only imports: vitest never loads `queries.ts` from this file.
 */

import { describe, it, expect } from "vitest";
import type { Strategy, PublicStrategy } from "@/lib/types";
import type {
  getFactsheetDetail,
  getStrategiesByCategory,
  getMyStrategies,
} from "@/lib/queries";

type FactsheetStrategy = NonNullable<Awaited<ReturnType<typeof getFactsheetDetail>>>["strategy"];
type CategoryRow = Awaited<ReturnType<typeof getStrategiesByCategory>>[number];
type OwnerRow = NonNullable<Awaited<ReturnType<typeof getMyStrategies>>>[number];

// Never invoked: only its TS body is type-checked. (Pattern of
// audit-event-union-types.test.ts.) Each `@ts-expect-error` guards a SINGLE-LINE
// statement so the error lands on the one line the directive sits above.
function _typeAssertions(): void {
  const pub = {} as PublicStrategy;
  const factsheet = {} as FactsheetStrategy;
  const row = {} as CategoryRow;
  const owner = {} as Strategy;
  const ownerRow = {} as OwnerRow;

  // @ts-expect-error - ARM-1: a public projection is not an owner row
  const a: Strategy = pub;
  void a;
  // @ts-expect-error - ARM-2: the public tearsheet reader's row has no api_key_id
  const b: Strategy = factsheet;
  void b;
  // @ts-expect-error - ARM-3: reading the key off a public row is a compile error
  void pub.api_key_id;
  // @ts-expect-error - ARM-4: a category list row has no api_key_id
  const c: Strategy = row;
  void c;

  // ARM-OWNER: the owner type reads the key as string | null, no undefined arm.
  const k: string | null = owner.api_key_id;
  void k;
  // ARM-OWNER-READ: the owner reader's row keeps the key required.
  const k2: string | null = ownerRow.api_key_id;
  void k2;
}
void _typeAssertions;

describe("api_key_id compile guard (DBACC-04)", () => {
  it("is enforced by tsc --noEmit (frontend-typecheck), not at runtime", () => {
    expect(typeof _typeAssertions).toBe("function");
  });
});
