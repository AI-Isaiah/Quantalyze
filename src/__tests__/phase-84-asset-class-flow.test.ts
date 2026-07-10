import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 84 (#597 part 2) cross-surface asset_class-flow guard.
 *
 * WHY THIS EXISTS: the blend annualization basis (blendPeriodsPerYear — √365 if
 * any crypto leg, else √252) is derived from each leg's `asset_class`. That value
 * reaches the three blend surfaces through three INDEPENDENT projections. Each
 * surface has its own behavioural test, but those are isolated — if a future edit
 * dropped `asset_class` from ONLY ONE projection, that surface would silently fall
 * back to √252 (understating a crypto book's risk ~17%) while the others stay
 * √365, and every per-surface test would still pass (red-team coverage gap,
 * 2026-07-10). This single structural pin fails loudly the moment any of the
 * three source projections stops selecting asset_class.
 */
const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Phase 84 — asset_class flows to every blend surface", () => {
  it("getMyAllocationDashboard SSR select projects asset_class on the strategy join (composer + compare book legs)", () => {
    const src = read("src/lib/queries.ts");
    // Scope to the dashboard strategy join block so an unrelated asset_class
    // reference elsewhere in the 3k-line file cannot false-green this pin.
    const block = src.slice(
      src.indexOf("strategy:strategies!inner ("),
      src.indexOf("strategy_analytics (", src.indexOf("strategy:strategies!inner (")),
    );
    expect(block).toContain("asset_class");
  });

  it("the lazy returns route probe projects asset_class (drawer-added legs)", () => {
    const src = read("src/app/api/strategies/[id]/returns/route.ts");
    expect(src).toContain('.select("id, asset_class")');
  });

  it("the public share page strategies read projects asset_class (shared scenarios)", () => {
    const src = read("src/app/scenario-share/[token]/page.tsx");
    expect(src).toContain('.select("id, asset_class")');
  });
});
