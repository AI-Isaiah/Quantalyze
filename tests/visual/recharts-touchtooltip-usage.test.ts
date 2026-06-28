import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 48 / CHART-01b — lock the touch-tooltip contract on every recharts
 * chart IN THE WHOLE CODEBASE.
 *
 * The CHART-01b deliverable replaced the raw recharts `<Tooltip>` (hover-only —
 * invisible to a touch user) with the breakpoint-gated `<TouchTooltip>` shim
 * (`src/components/charts/TouchTooltip.tsx`) across all 18 tooltip-bearing
 * charts, so a tap shows/pins the value on a phone while desktop stays
 * `trigger="hover"` byte-identical. `TouchTooltip` is therefore the ONLY file
 * allowed to import the raw `Tooltip` from `"recharts"`.
 *
 * Source-level grep covers the contract in one place: a chart that reverts to a
 * bare recharts `<Tooltip>` — or a NEW chart added with one — would silently
 * ship a mobile chart with no tap-to-show and pass every other test. This guard
 * fails before that can land (mirrors the chart-accessibility-layer.test.ts
 * whole-codebase grep idiom).
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");
const ALLOWED = "src/components/charts/TouchTooltip.tsx";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...walk(full));
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

// True when the file imports the exact identifier `Tooltip` (not `TouchTooltip`,
// not `Tooltip as X`) from the "recharts" package. Handles multi-line imports.
function importsRawRechartsTooltip(src: string): boolean {
  const importRe = /import\s*\{([^}]*)\}\s*from\s*["']recharts["']/g;
  for (const m of src.matchAll(importRe)) {
    const specifiers = m[1].split(",").map((s) => s.trim());
    if (specifiers.some((s) => s === "Tooltip")) return true;
  }
  return false;
}

describe("[CHART-01b] recharts <Tooltip> → <TouchTooltip> contract (whole codebase)", () => {
  const importers = walk(SRC_DIR)
    .filter((p) => importsRawRechartsTooltip(readFileSync(p, "utf8")))
    .map((p) => p.replace(REPO_ROOT + "/", ""));

  it("only TouchTooltip.tsx imports the raw recharts Tooltip", () => {
    expect(
      importers.sort(),
      "Every recharts chart must route its tooltip through <TouchTooltip> so it " +
        "is tap-inspectable on touch (CHART-01b). The raw recharts <Tooltip> is " +
        "hover-only. TouchTooltip.tsx is the sole legitimate importer.",
    ).toEqual([ALLOWED]);
  });

  it("the guard actually sees TouchTooltip.tsx (non-vacuous)", () => {
    // If the import-detection regex silently matched nothing, the assertion
    // above would pass vacuously — this proves the scanner found the shim.
    expect(importers).toContain(ALLOWED);
  });
});
