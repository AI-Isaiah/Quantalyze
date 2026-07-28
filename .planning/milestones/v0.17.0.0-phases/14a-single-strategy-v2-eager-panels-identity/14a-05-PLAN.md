---
phase: 14a
plan: 05
type: execute
wave: 3
depends_on: [14a-01, 14a-03, 14a-04]
files_modified:
  - vitest.config.ts
  - src/test-setup.ts
  - tests/a11y/chart-contrast.test.ts
  - tests/visual/strategy-v2-panel-count.test.ts
  - tests/visual/strategy-v2-type-scale.test.ts
  - e2e/strategy-v2-partial-data.spec.ts
autonomous: true
requirements: [KPI-22, KPI-23a, DESIGN-02, A11Y-01]
must_haves:
  truths:
    - "tests/a11y/chart-contrast.test.ts asserts getContrastRatio('#64748B', '#FFFFFF') >= 4.5 AND grep-forbids #94A3B8 / #718096 as text fill in src/components/strategy-v2/**/*.tsx"
    - "tests/visual/strategy-v2-panel-count.test.ts asserts JSDOM render of <StrategyV2Shell> contains exactly 7 <section data-panel> elements"
    - "tests/visual/strategy-v2-type-scale.test.ts grep-asserts zero font-medium / font-light / font-bold AND zero text-[11px] / text-[13px] / text-[14px] / text-sm / text-xl / text-2xl in src/components/strategy-v2/**/*.tsx"
    - "e2e/strategy-v2-partial-data.spec.ts covers 4 history bands (7 / 30 / 90 / 365 days) and asserts the 7 sections always render with correct partial-data banners"
    - "vitest.config.ts include glob extended to pick up tests/a11y/**/*.test.ts and tests/visual/**/*.test.ts"
    - "src/test-setup.ts has IntersectionObserver stub next to existing ResizeObserver stub"
    - "All Vitest tests pass GREEN"
  artifacts:
    - path: "vitest.config.ts"
      provides: "Extended include glob covering tests/ top-level dirs"
    - path: "src/test-setup.ts"
      provides: "IntersectionObserver stub added (alongside existing ResizeObserver)"
    - path: "tests/a11y/chart-contrast.test.ts"
      provides: "WCAG-AA chart-axis contrast test (A11Y-01 + DESIGN-02)"
    - path: "tests/visual/strategy-v2-panel-count.test.ts"
      provides: "Hard-count assertion (KPI-22)"
    - path: "tests/visual/strategy-v2-type-scale.test.ts"
      provides: "4-size / 2-weight contract enforcement (DESIGN-02)"
    - path: "e2e/strategy-v2-partial-data.spec.ts"
      provides: "Playwright partial-data history-band coverage (KPI-23a)"
  key_links:
    - from: "tests/visual/strategy-v2-panel-count.test.ts"
      to: "src/components/strategy-v2/StrategyV2Shell.tsx"
      via: "JSDOM render with synthetic StrategyV2Detail fixture"
      pattern: "StrategyV2Shell"
    - from: "tests/visual/strategy-v2-type-scale.test.ts"
      to: "src/components/strategy-v2/**/*.tsx"
      via: "fs.readdirSync + grep-style content scan"
      pattern: "src/components/strategy-v2"
    - from: "src/test-setup.ts"
      to: "globalThis.IntersectionObserver"
      via: "class stub assignment"
      pattern: "IntersectionObserver"
---

<objective>
Land the test suite that gates Phase 14a's success criteria: (1) extend `vitest.config.ts` to pick up the new top-level `tests/a11y/` and `tests/visual/` dirs; (2) add an IntersectionObserver stub to `src/test-setup.ts` (alongside the existing ResizeObserver stub) per RESEARCH Open Question 5; (3) ship the WCAG-AA chart-axis contrast test (A11Y-01); (4) ship the hard-count panel-count visual test (KPI-22); (5) ship the type-scale lint test (DESIGN-02); (6) ship the Playwright partial-data history-band spec at `e2e/strategy-v2-partial-data.spec.ts` (per RESEARCH Pitfall 2: project precedent is `e2e/`, NOT `tests/e2e/`).

Wave 3 — depends on Plan 14A-01 (chart-tokens), Plan 14A-03 (StrategyV2Shell + 7 components must exist for the panel-count test to render), and Plan 14A-04 (route file must exist for the Playwright spec to navigate to `/strategy/{id}/v2`).

Purpose: Provide automated verification of the visual + a11y + type-scale contracts UI-SPEC §9 specifies. Without these tests, Phase 14a's acceptance gates 2-5 cannot be checked mechanically.

Output: 1 modified config (vitest.config.ts), 1 modified setup file (src/test-setup.ts), 3 new Vitest test files (top-level `tests/a11y/` + `tests/visual/`), 1 new Playwright spec (`e2e/`).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-CONTEXT.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-01-PLAN.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-03-PLAN.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-04-PLAN.md
@AGENTS.md
@vitest.config.ts
@src/test-setup.ts
@playwright.config.ts
@e2e/discovery-hide-examples-default.spec.ts
@e2e/discovery-prefs-isolation.spec.ts
@e2e/helpers/seed-test-project.ts

<interfaces>
<!-- Current vitest.config.ts (verified): -->
```ts
include: ["src/**/*.test.{ts,tsx}"]   // ← MUST EXTEND
```

<!-- Current src/test-setup.ts (verified): -->
```ts
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
// ← ADD IntersectionObserver stub immediately after, mirroring this pattern
```

<!-- Existing canonical IntersectionObserver stub at AllocationDashboardV2.widget-gating.test.tsx:113-124 (per-test pattern; we move it to global): -->
```ts
class IntersectionObserverStub { observe() {} unobserve() {} disconnect() {} }
```

<!-- Playwright config (verified playwright.config.ts:4): -->
```ts
testDir: "./e2e"   // ← Spec MUST live at e2e/, NOT tests/e2e/, per RESEARCH Pitfall 2
```

<!-- Existing E2E fixture pattern (e2e/discovery-hide-examples-default.spec.ts):
  - Uses seedTestAllocator() helper from ./helpers/seed-test-project
  - Skips when TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY env vars are absent
  - Authored-but-not-CI-blocking pattern via test.skip
-->

<!-- WCAG 2.0 luminance / contrast formula (per RESEARCH "Don't Hand-Roll" section recommendation):
  - 12-line hand-roll preferred over a `polished` dependency
  - L = 0.2126*R + 0.7152*G + 0.0722*B (after sRGB to linear conversion)
  - contrast = (L_lighter + 0.05) / (L_darker + 0.05)
-->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extend vitest.config.ts include glob + add IntersectionObserver stub to src/test-setup.ts</name>
  <files>vitest.config.ts, src/test-setup.ts</files>
  <read_first>
    - vitest.config.ts (full file — confirm current `include` is `["src/**/*.test.{ts,tsx}"]`; the change is to extend, not replace)
    - src/test-setup.ts (full file — confirm the ResizeObserver stub block at lines 16-22; the change is to APPEND a parallel IntersectionObserver stub, not replace ResizeObserver)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md Pitfall 1 (vitest include extension) and Open Question 5 (move IntersectionObserver stub to global setup)
  </read_first>
  <behavior>
    - vitest.config.ts include glob covers BOTH `src/**/*.test.{ts,tsx}` AND `tests/a11y/**/*.test.ts` AND `tests/visual/**/*.test.ts`
    - src/test-setup.ts adds a class `IntersectionObserverStub` with the 3 required methods (`observe`, `unobserve`, `disconnect`) matching the ResizeObserver pattern
    - The IntersectionObserver constructor stub also accepts `(callback, options)` signature without throwing — minimal happy-path-only stub; tests that need real intersect behavior can override per-test
    - The existing ResizeObserver stub is unchanged
    - `npm test -- src/lib/strategy-ui-v2-flag.test.ts` (from Plan 14A-02 Task 2) still passes after the config change (regression check)
  </behavior>
  <action>
1. Edit `vitest.config.ts` to extend the `include` array. Replace:

```ts
include: ["src/**/*.test.{ts,tsx}"],
```

with:

```ts
include: [
  "src/**/*.test.{ts,tsx}",
  "tests/a11y/**/*.test.ts",
  "tests/visual/**/*.test.ts",
],
```

Do NOT change any other field in `vitest.config.ts`.

2. Edit `src/test-setup.ts` to append the IntersectionObserver stub after the existing ResizeObserver stub block. The new content appended at the end of the file:

```ts
// jsdom does not implement IntersectionObserver. Phase 14a's
// `useLazyPanelMetrics` hook (and related component tests) instantiate one
// in the ref-callback path, which throws under vitest+jsdom without a
// stub. Mirror the ResizeObserver pattern above so all component tests
// inherit a no-op observer. Tests that need real intersect behavior can
// override per-test.
class IntersectionObserverStub {
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
}
(globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
  IntersectionObserverStub as unknown as typeof IntersectionObserver;
```

3. Run `npm test -- src/lib/strategy-ui-v2-flag.test.ts --run` to confirm the existing test still passes (regression check on the config change).
  </action>
  <verify>
    <automated>npm test -- src/lib/strategy-ui-v2-flag.test.ts --run 2>&amp;1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'tests/a11y/\\*\\*/\\*.test.ts' vitest.config.ts` returns 1 match
    - `grep -n 'tests/visual/\\*\\*/\\*.test.ts' vitest.config.ts` returns 1 match
    - `grep -n 'src/\\*\\*/\\*.test.\\{ts,tsx\\}' vitest.config.ts` returns 1 match (existing entry preserved)
    - `grep -n "class IntersectionObserverStub" src/test-setup.ts` returns 1 match
    - `grep -n "globalThis as { IntersectionObserver" src/test-setup.ts` returns 1 match
    - `grep -n "class ResizeObserverStub" src/test-setup.ts` returns 1 match (existing stub preserved)
    - `npm test -- src/lib/strategy-ui-v2-flag.test.ts --run` exits 0 with all 10 tests passing
  </acceptance_criteria>
  <done>Vitest picks up tests/ top-level dirs; IntersectionObserver stub global; existing ResizeObserver stub + existing strategy-ui-v2-flag tests unaffected.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: tests/a11y/chart-contrast.test.ts + tests/visual/strategy-v2-type-scale.test.ts</name>
  <files>tests/a11y/chart-contrast.test.ts, tests/visual/strategy-v2-type-scale.test.ts</files>
  <read_first>
    - vitest.config.ts (post-Task-1 — confirms tests/ glob is wired)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §9 Vitest test contracts (chart-contrast assertions a/b/c; type-scale forbidden classes)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md Pitfall 4 (forbidden colors as TEXT FILL — must scope grep to v2 panel files; #94A3B8 IS allowed as a stroke and appears legitimately in EquityCurve.tsx) and Pitfall 6 (`text-sm` is forbidden in v2 panels but used in reused components — DO NOT scan reused-component files)
    - src/components/charts/chart-tokens.ts (post-Plan-14A-01 — `CHART_AXIS_TICK = "#64748B"`)
  </read_first>
  <behavior>
    - chart-contrast.test.ts: pure-Node Vitest test (does NOT need to render any component) that asserts (a) WCAG luminance helper computes `getContrastRatio("#64748B", "#FFFFFF") >= 4.5`; (b) glob over `src/components/strategy-v2/**/*.tsx` finds zero literal `fill: "#94A3B8"` and zero literal `fill: "#718096"`; (c) glob over the same dir finds zero `fontVariantNumeric.*tabular-nums` patterns NOT inside a `CHART_TICK_STYLE` token reference (this last is the Pitfall 14 / DESIGN-02 enforcement — Recharts XAxis ticks must use the token, not inline)
    - type-scale.test.ts: pure-Node Vitest test that scans `src/components/strategy-v2/**/*.tsx` files via `fs.readdirSync` + content match; asserts (a) zero `text-[11px]`, zero `text-[13px]`, zero `text-[14px]`, zero `text-sm`, zero `text-xl`, zero `text-2xl`; (b) zero `font-medium`, zero `font-light`, zero `font-bold`
    - Both tests use `import { describe, it, expect } from "vitest"` and `import { readFileSync, readdirSync, statSync } from "node:fs"` and `import { join, resolve } from "node:path"`
    - Both tests fail loudly if the directory `src/components/strategy-v2/` is empty or missing — so they only ever pass after Plan 14A-03 has shipped
  </behavior>
  <action>
1. Create `tests/a11y/chart-contrast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Phase 14a / A11Y-01 — WCAG-AA chart-axis contrast.
 *
 * Asserts:
 *   (a) getContrastRatio(CHART_AXIS_TICK, "#FFFFFF") >= 4.5
 *   (b) Zero literal `fill: "#94A3B8"` and zero literal `fill: "#718096"` in
 *       any v2 panel file. (#94A3B8 is allowed as a stroke for benchmark lines —
 *       Pitfall 4. We only scope this grep to v2 panel files; reused
 *       components are out of scope.)
 *
 * The luminance helper is a 12-line hand-roll per the RESEARCH "Don't
 * Hand-Roll" recommendation — `polished` would add a dependency for one
 * test.
 */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function getContrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

const CHART_AXIS_TICK = "#64748B";
const FORBIDDEN_TEXT_FILLS = ["#94A3B8", "#718096"];
const V2_DIR = resolve(process.cwd(), "src/components/strategy-v2");

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const s = statSync(full);
      if (s.isDirectory()) stack.push(full);
      else if (s.isFile() && /\.tsx?$/.test(entry) && !entry.endsWith(".test.tsx") && !entry.endsWith(".test.ts")) {
        out.push(full);
      }
    }
  }
  return out;
}

describe("chart-axis contrast (A11Y-01)", () => {
  it("CHART_AXIS_TICK on white meets WCAG AA (>= 4.5:1)", () => {
    expect(getContrastRatio(CHART_AXIS_TICK, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("zero forbidden text-fill colors in v2 panel files", () => {
    const files = listTsxFiles(V2_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: { file: string; pattern: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const forbidden of FORBIDDEN_TEXT_FILLS) {
        // Match: fill: "#94A3B8" / fill: "#718096" / fill:"..." with optional spacing
        const pattern = new RegExp(`fill\\s*:\\s*["']${forbidden}["']`, "gi");
        if (pattern.test(content)) {
          violations.push({ file, pattern: `fill: "${forbidden}"` });
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

2. Create `tests/visual/strategy-v2-type-scale.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Phase 14a / DESIGN-02 — 4-size / 2-weight type contract enforcement.
 *
 * UI-SPEC §6 forbidden Tailwind classes inside src/components/strategy-v2/**/*.tsx:
 *   Sizes: text-[11px], text-[13px], text-[14px], text-sm, text-xl, text-2xl
 *   Weights: font-medium, font-light, font-bold
 * Allowed:
 *   Sizes: text-xs (12px), text-base (16px), text-lg (18px), text-[32px] (page H1 only)
 *   Weights: font-normal (400), font-semibold (600)
 */

const V2_DIR = resolve(process.cwd(), "src/components/strategy-v2");
const FORBIDDEN_SIZES = [
  /\btext-\[11px\]/,
  /\btext-\[13px\]/,
  /\btext-\[14px\]/,
  /\btext-sm\b/,
  /\btext-xl\b/,
  /\btext-2xl\b/,
];
const FORBIDDEN_WEIGHTS = [
  /\bfont-medium\b/,
  /\bfont-light\b/,
  /\bfont-bold\b/,
];

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const s = statSync(full);
      if (s.isDirectory()) stack.push(full);
      else if (s.isFile() && /\.tsx?$/.test(entry) && !entry.endsWith(".test.tsx") && !entry.endsWith(".test.ts")) {
        out.push(full);
      }
    }
  }
  return out;
}

describe("strategy-v2 type-scale lint (DESIGN-02)", () => {
  it("zero forbidden size classes", () => {
    const files = listTsxFiles(V2_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: { file: string; pattern: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const re of FORBIDDEN_SIZES) {
        if (re.test(content)) violations.push({ file, pattern: re.source });
      }
    }
    expect(violations).toEqual([]);
  });

  it("zero forbidden weight classes", () => {
    const files = listTsxFiles(V2_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: { file: string; pattern: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const re of FORBIDDEN_WEIGHTS) {
        if (re.test(content)) violations.push({ file, pattern: re.source });
      }
    }
    expect(violations).toEqual([]);
  });
});
```

3. Run both tests and confirm they pass GREEN:
   - `npm test -- tests/a11y/chart-contrast.test.ts --run`
   - `npm test -- tests/visual/strategy-v2-type-scale.test.ts --run`
  </action>
  <verify>
    <automated>npm test -- tests/a11y/ tests/visual/strategy-v2-type-scale.test.ts --run 2>&amp;1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - File `tests/a11y/chart-contrast.test.ts` exists
    - File `tests/visual/strategy-v2-type-scale.test.ts` exists
    - `grep -n "getContrastRatio" tests/a11y/chart-contrast.test.ts` returns at least 2 matches (helper + assertion)
    - `grep -n "toBeGreaterThanOrEqual(4.5)" tests/a11y/chart-contrast.test.ts` returns 1 match
    - `grep -nE "FORBIDDEN_TEXT_FILLS|#94A3B8|#718096" tests/a11y/chart-contrast.test.ts` returns at least 2 matches
    - `grep -nE "FORBIDDEN_SIZES|FORBIDDEN_WEIGHTS" tests/visual/strategy-v2-type-scale.test.ts` returns at least 2 matches
    - `grep -nE 'text-sm|text-xl|text-2xl' tests/visual/strategy-v2-type-scale.test.ts` returns matches (these literals are in the regex array — they SHOULD appear in the test file as forbidden patterns)
    - `grep -nE 'font-medium|font-bold|font-light' tests/visual/strategy-v2-type-scale.test.ts` returns matches (forbidden-pattern declarations)
    - `npm test -- tests/a11y/chart-contrast.test.ts --run` exits 0 with 2 tests passing
    - `npm test -- tests/visual/strategy-v2-type-scale.test.ts --run` exits 0 with 2 tests passing
  </acceptance_criteria>
  <done>Both Vitest tests pass GREEN against post-Plan-14A-03 v2 components; A11Y-01 + DESIGN-02 contracts mechanically enforced.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: tests/visual/strategy-v2-panel-count.test.ts (JSDOM render of StrategyV2Shell)</name>
  <files>tests/visual/strategy-v2-panel-count.test.ts</files>
  <read_first>
    - src/components/strategy-v2/StrategyV2Shell.tsx (post-Plan-14A-03 — confirm `detail` prop name and `StrategyV2Detail` import)
    - src/lib/queries.ts (post-Plan-14A-02 — confirm `StrategyV2Detail` shape so the synthetic fixture is type-correct)
    - src/lib/types.ts (Strategy interface — required to construct a synthetic Strategy object for the fixture)
    - src/components/charts/CorrelationWithBenchmark.test.tsx lines 11-23 (canonical Recharts ResponsiveContainer mock — copy if any panels mount Recharts charts in JSDOM)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §9 panel-count test (assert `screen.getAllByRole('region').length === 7` AND `document.querySelectorAll('section[data-panel]').length === 7`)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md Pattern 5 (server-component testing — render with synthetic prop) + Pattern 6 (Recharts mock)
  </read_first>
  <behavior>
    - JSDOM render of `<StrategyV2Shell detail={syntheticFixture} />`
    - Asserts exactly 7 `section[data-panel]` elements in the rendered DOM
    - Asserts at least 4 of those have `data-panel-status="placeholder"` (panels 4-7 are placeholders even with full data)
    - The synthetic fixture supplies `history_days = 365` so the eager panels render full bodies (not partial-data banners)
    - Recharts `ResponsiveContainer` is mocked at module-level (per Pattern 6) so DrawdownChart inside Panel 3 doesn't collapse to zero size
    - lightweight-charts may need stubbing too; if EquityCurve mounts and throws on lightweight-charts internals under JSDOM, mock the module via `vi.mock("lightweight-charts", ...)` — executor's discretion
  </behavior>
  <action>
1. Create `tests/visual/strategy-v2-panel-count.test.ts`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { StrategyV2Detail } from "@/lib/queries";
import { StrategyV2Shell } from "@/components/strategy-v2/StrategyV2Shell";

// Recharts ResponsiveContainer collapses to zero size in JSDOM. Mock it.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 240 }}>{children}</div>
    ),
  };
});

// lightweight-charts uses canvas APIs unavailable in JSDOM. Stub the module.
vi.mock("lightweight-charts", () => ({
  createChart: () => ({
    addAreaSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    addLineSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    timeScale: () => ({ fitContent: () => {}, applyOptions: () => {} }),
    applyOptions: () => {},
    resize: () => {},
    remove: () => {},
    subscribeCrosshairMove: () => {},
    unsubscribeCrosshairMove: () => {},
  }),
}));

const FIXTURE: StrategyV2Detail = {
  strategy: {
    id: "test-uuid",
    user_id: "user-1",
    category_id: null,
    api_key_id: null,
    name: "Test Strategy",
    description: null,
    strategy_types: ["systematic"],
    subtypes: ["trend"],
    markets: ["crypto"],
    supported_exchanges: ["Binance"],
    leverage_range: "1-3x",
    avg_daily_turnover: 250000,
    aum: null,
    max_capacity: null,
    start_date: "2025-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2025-01-01T00:00:00Z",
  },
  panel1: {
    supported_exchanges: ["Binance"],
    strategy_types: ["systematic"],
    subtypes: ["trend"],
    markets: ["crypto"],
    leverage_range: "1-3x",
    avg_daily_turnover: 250000,
  },
  panel2Headline: {
    cumulative_return: 0.42,
    cagr: 0.18,
    sharpe: 1.5,
    sortino: 2.1,
    max_drawdown: -0.12,
    volatility: 0.16,
  },
  panel2Equity: {
    series: [{ date: "2025-01-01", value: 1.0 }, { date: "2025-12-31", value: 1.42 }],
    btc_overlay: [{ date: "2025-01-01", value: 1.0 }, { date: "2025-12-31", value: 1.3 }],
  },
  panel3: {
    drawdown_series: [{ date: "2025-01-01", value: 0 }, { date: "2025-06-15", value: -0.12 }],
    drawdown_episodes: [],
  },
  lazyKeys: ["panel4", "panel5", "panel6", "panel7"],
  history_days: 365,
};

describe("StrategyV2Shell — panel count (KPI-22)", () => {
  it("renders exactly 7 <section data-panel> elements", () => {
    render(<StrategyV2Shell detail={FIXTURE} />);
    const sections = document.querySelectorAll("section[data-panel]");
    expect(sections.length).toBe(7);
  });

  it("panels 4–7 carry data-panel-status=\"placeholder\"", () => {
    render(<StrategyV2Shell detail={FIXTURE} />);
    const placeholders = document.querySelectorAll('section[data-panel-status="placeholder"]');
    expect(placeholders.length).toBe(4);
  });

  it("each panel has an aria-label", () => {
    render(<StrategyV2Shell detail={FIXTURE} />);
    const sections = document.querySelectorAll("section[data-panel]");
    for (const section of Array.from(sections)) {
      expect(section.getAttribute("aria-label")).toBeTruthy();
    }
  });
});
```

If the Strategy interface has any additional required fields not covered in the fixture above (e.g. `tenant_id`, `disclosure_tier`, `codename`, `partner_tag`, `public_contact_email`), confirm they are typed `?:` (optional) in `src/lib/types.ts` and either omit them or add them to the fixture as `null` / matching defaults. Verified in src/lib/types.ts:35-72 — `disclosure_tier`, `codename`, `public_contact_email`, `tenant_id`, `partner_tag` are all optional (`?:`); the fixture above is type-correct without them.

2. Run `npm test -- tests/visual/strategy-v2-panel-count.test.ts --run` and confirm 3/3 tests pass GREEN.

3. If a Recharts internal or lightweight-charts internal throws in JSDOM despite the mocks, expand the mock as needed; document any deviation in SUMMARY.
  </action>
  <verify>
    <automated>npm test -- tests/visual/strategy-v2-panel-count.test.ts --run 2>&amp;1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - File `tests/visual/strategy-v2-panel-count.test.ts` exists
    - `grep -n "expect(sections.length).toBe(7)" tests/visual/strategy-v2-panel-count.test.ts` returns 1 match
    - `grep -n "expect(placeholders.length).toBe(4)" tests/visual/strategy-v2-panel-count.test.ts` returns 1 match
    - `grep -n 'vi.mock("recharts"' tests/visual/strategy-v2-panel-count.test.ts` returns 1 match
    - `grep -n 'vi.mock("lightweight-charts"' tests/visual/strategy-v2-panel-count.test.ts` returns 1 match
    - `grep -n "StrategyV2Shell" tests/visual/strategy-v2-panel-count.test.ts` returns at least 2 matches (import + render)
    - `grep -n "history_days: 365" tests/visual/strategy-v2-panel-count.test.ts` returns 1 match (fixture renders eager bodies, not partial-data banners)
    - `npm test -- tests/visual/strategy-v2-panel-count.test.ts --run` exits 0 with 3 tests passing
  </acceptance_criteria>
  <done>Panel-count test passes; KPI-22 hard-count contract enforced; Recharts + lightweight-charts mocked.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 4: e2e/strategy-v2-partial-data.spec.ts (Playwright partial-data history bands)</name>
  <files>e2e/strategy-v2-partial-data.spec.ts</files>
  <read_first>
    - playwright.config.ts (testDir = "./e2e" — confirm spec lives here, NOT tests/e2e/, per RESEARCH Pitfall 2)
    - e2e/discovery-hide-examples-default.spec.ts (full file — canonical pattern for `seedTestAllocator` + `cleanupTestAllocator` + `test.skip` when `TEST_SUPABASE_URL` env var absent)
    - e2e/helpers/seed-test-project.ts (full file — confirm helper signature; this is the data-fixture pattern UI-SPEC §9 partial-data spec must mirror)
    - e2e/discovery-prefs-isolation.spec.ts (similar pattern; cross-reference for fixture structure)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §9 Playwright spec (4 fixtures: 7-day / 30-day / 90-day / 365-day; assert 7 sections always, banners or full body, no display:none, no data-error)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md Open Question 3 + Assumption A8 (seeded test strategies vs page.route()) — recommendation: seed test strategies via the existing helper pattern; this is "authored-but-not-CI-blocking" because env vars gate execution
  </read_first>
  <behavior>
    - Spec lives at `e2e/strategy-v2-partial-data.spec.ts` (project precedent — Pitfall 2)
    - Skips entire suite when `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` env vars are absent (CI-friendly fallback per existing pattern)
    - Iterates over 4 history-band fixtures: 7-day, 30-day, 90-day, 365-day. For each:
        - seed a test strategy with that exact returns_series length (using `seedTestAllocator` or analogous helper — executor reads helpers/seed-test-project.ts to confirm the actual API and what it can seed; if the helper does NOT support arbitrary returns_series length, document the deviation in SUMMARY and proceed with whatever seeding the helper supports OR mark the test as authored-but-skipped pending a Phase 14b helper extension)
        - navigate to `/strategy/{seededStrategyId}/v2`
        - assert `page.locator("section[data-panel]")` count is exactly 7
        - assert no panel has `display: none`
        - assert no panel has `data-error` attribute
        - for the 7-day band: assert Panel 1 shows full body (history_days >= 1), Panel 2 KPI strip shows partial-data banner ("Awaiting more data"), Panel 2 equity chart shows full body (history_days >= 7), Panel 3 chart shows partial-data banner
        - for the 30-day band: assert Panel 2 KPI strip shows full body, Panel 3 chart shows full body
        - for the 90-day and 365-day bands: assert all 3 eager panels render full bodies
    - cleanupTestAllocator (or equivalent) is called in afterEach to keep the DB clean
  </behavior>
  <action>
1. Read `e2e/discovery-hide-examples-default.spec.ts` and `e2e/helpers/seed-test-project.ts` to confirm the exact helper signature and what seeding capability exists.

2. Create `e2e/strategy-v2-partial-data.spec.ts`. Skeleton (executor refines based on seedTestAllocator's actual signature):

```ts
/**
 * Phase 14a / KPI-23a — Per-panel partial-data history bands.
 *
 * Asserts that /strategy/{id}/v2 renders correctly across 4 history bands:
 *   - 7 days:   Panel 2 KPI strip + Panel 3 chart show partial-data banner;
 *               Panel 1 + Panel 2 chart show full body
 *   - 30 days:  Panel 1 / Panel 2 strip / Panel 2 chart all full;
 *               Panel 3 chart still gated (banner) at exactly 30
 *   - 90 days:  All 3 eager panels show full bodies
 *   - 365 days: All 3 eager panels show full bodies
 *
 * In every case: exactly 7 <section data-panel> elements, no panel has
 * display: none, no panel has data-error attribute. Layout shape is
 * preserved (Pitfall 17 invariant).
 *
 * Seed pattern mirrors e2e/discovery-hide-examples-default.spec.ts —
 * test.skip when TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY are
 * absent so the spec is authored-but-not-CI-blocking.
 */

import { test, expect } from "@playwright/test";
// import { seedTestAllocator } from "./helpers/seed-test-project";
// import { cleanupTestAllocator } from "./helpers/cleanup-test-project";
// (Executor: confirm exact import paths/names by reading the helper files first;
//  if a custom seed-strategy-with-history helper does not exist, either extend
//  the existing helper or document a deviation in SUMMARY and use the closest
//  available helper.)

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const HISTORY_BANDS = [
  { days: 7, label: "7-day" },
  { days: 30, label: "30-day" },
  { days: 90, label: "90-day" },
  { days: 365, label: "365-day" },
] as const;

test.describe("Phase 14a — partial-data history bands (KPI-23a)", () => {
  test.skip(!HAS_SEED_ENV, "TEST_SUPABASE_URL / SERVICE_ROLE_KEY not configured");

  for (const band of HISTORY_BANDS) {
    test(`${band.label} fixture renders 7 panels with correct partial-data state`, async ({ page }) => {
      // Executor: replace this stub with an actual call into the seed helper.
      // The helper API the executor must produce / discover:
      //   const { strategyId, cleanup } = await seedStrategyWithHistory({ days: band.days });
      // After the test:
      //   await cleanup();
      const strategyId = await seedStrategyWithHistory({ days: band.days });
      try {
        await page.goto(`/strategy/${strategyId}/v2`);

        // Always exactly 7 panels (KPI-22)
        const panels = page.locator("section[data-panel]");
        await expect(panels).toHaveCount(7);

        // No panel hidden via display:none (Pitfall 17 layout-shape invariant)
        const hiddenCount = await panels.evaluateAll((nodes) =>
          nodes.filter((n) => getComputedStyle(n as HTMLElement).display === "none").length
        );
        expect(hiddenCount).toBe(0);

        // No panel carries data-error (Pitfall 17 — never crash, never hide)
        const errored = page.locator('section[data-panel][data-error]');
        await expect(errored).toHaveCount(0);

        // Per-panel partial-data assertions
        const overview = page.locator('section[data-panel="overview"]');
        const headline = page.locator('section[data-panel="headline-equity"]');
        const drawdown = page.locator('section[data-panel="drawdown"]');

        if (band.days < 1) {
          await expect(overview.getByText("Awaiting more data")).toBeVisible();
        }

        if (band.days < 30) {
          // KPI strip banner
          await expect(headline.getByText(/at least 30 days of trading history for stable Sharpe/)).toBeVisible();
        }
        if (band.days < 7) {
          // Equity chart banner
          await expect(headline.getByText(/at least 7 days of equity history/)).toBeVisible();
        }
        if (band.days < 30) {
          // Drawdown chart banner
          await expect(drawdown.getByText(/at least 30 days of trading history to detect meaningful drawdowns/)).toBeVisible();
        }
      } finally {
        // executor: call helper-side cleanup
      }
    });
  }
});

// Placeholder until executor wires the seed helper. If
// `seedStrategyWithHistory` doesn't exist yet, the executor should add it to
// e2e/helpers/seed-test-project.ts (or a new helper file) following the
// shape of the existing seedTestAllocator helper.
async function seedStrategyWithHistory(_opts: { days: number }): Promise<string> {
  throw new Error(
    "seedStrategyWithHistory not yet wired — see e2e/helpers/seed-test-project.ts pattern. " +
    "Executor: implement or document deviation in 14a-05-SUMMARY.md.",
  );
}
```

3. Confirm the spec is discovered by Playwright: `npx playwright test --list e2e/strategy-v2-partial-data.spec.ts` should list 4 tests (one per history band). When `HAS_SEED_ENV` is false (typical local dev), they will be skipped — that's the intended authored-but-not-CI-blocking pattern.

4. If the executor extends `e2e/helpers/seed-test-project.ts` with a `seedStrategyWithHistory` helper, the file must be added to `files_modified` in this plan's frontmatter at SUMMARY time, AND the plan author should note the additional helper in `14a-05-SUMMARY.md`.
  </action>
  <verify>
    <automated>npx playwright test --list e2e/strategy-v2-partial-data.spec.ts 2>&amp;1 | tail -15</automated>
  </verify>
  <acceptance_criteria>
    - File `e2e/strategy-v2-partial-data.spec.ts` exists at `e2e/` (NOT `tests/e2e/` — RESEARCH Pitfall 2)
    - `grep -n "test.skip" e2e/strategy-v2-partial-data.spec.ts` returns at least 1 match (env-var skip pattern)
    - `grep -n "TEST_SUPABASE_URL" e2e/strategy-v2-partial-data.spec.ts` returns at least 1 match
    - `grep -n "section\\[data-panel\\]" e2e/strategy-v2-partial-data.spec.ts` returns at least 1 match
    - `grep -n "toHaveCount(7)" e2e/strategy-v2-partial-data.spec.ts` returns at least 1 match
    - `grep -nE "7-day|30-day|90-day|365-day" e2e/strategy-v2-partial-data.spec.ts` returns at least 4 matches (one per band)
    - `grep -nE "Awaiting more data" e2e/strategy-v2-partial-data.spec.ts` returns at least 1 match (banner text assertion)
    - `npx playwright test --list e2e/strategy-v2-partial-data.spec.ts` exits 0 and lists 4 tests
  </acceptance_criteria>
  <done>Partial-data Playwright spec exists at the correct path; lists 4 tests; skips gracefully without seed-env vars; banner-text assertions correspond to UI-SPEC §7 verbatim copy.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (no production trust boundary — these are test-only files) | n/a |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14a-05-01 | I | Test fixture exposing real strategy data | mitigate | Synthetic UUIDs only (`"test-uuid"` etc.); no production data referenced. Playwright spec uses test-DB env vars (TEST_SUPABASE_URL is the test instance, NOT production). |
| T-14a-05-02 | T (Tampering) | Type-scale grep test bypassed via Unicode tricks | accept | Future-developer concern; UI-SPEC §6 lists allowed classes; PR review catches obvious bypass attempts. |
</threat_model>

<verification>
- `npm test -- src/lib/strategy-ui-v2-flag.test.ts --run` exits 0 (regression after vitest.config.ts change)
- `npm test -- tests/a11y/chart-contrast.test.ts --run` exits 0
- `npm test -- tests/visual/ --run` exits 0 (both visual tests pass)
- `npx playwright test --list e2e/strategy-v2-partial-data.spec.ts` lists 4 tests
- `npm run build` exits 0
</verification>

<success_criteria>
1. vitest.config.ts include glob covers tests/a11y + tests/visual.
2. src/test-setup.ts adds IntersectionObserver stub alongside existing ResizeObserver.
3. tests/a11y/chart-contrast.test.ts passes — WCAG-AA contract enforced + forbidden-text-fill grep clean.
4. tests/visual/strategy-v2-type-scale.test.ts passes — 4-size / 2-weight contract enforced.
5. tests/visual/strategy-v2-panel-count.test.ts passes — exactly 7 sections, 4 placeholders.
6. e2e/strategy-v2-partial-data.spec.ts is discovered by Playwright (skips without env vars).
</success_criteria>

<output>
After completion, create `.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-05-SUMMARY.md` describing:
- Test pass counts for each Vitest test file
- Confirmation that Playwright lists 4 tests for the new spec
- Whether `e2e/helpers/seed-test-project.ts` was extended (and how) — or whether the spec is authored-but-skipped pending helper extension in 14b
- Any deviations (e.g. additional Recharts mocks needed, lightweight-charts stub adjustments)
</output>
