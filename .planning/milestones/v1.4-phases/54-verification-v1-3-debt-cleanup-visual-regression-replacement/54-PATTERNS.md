# Phase 54: Verification + v1.3 debt cleanup + visual-regression replacement - Pattern Map

**Mapped:** 2026-06-30
**Files analyzed:** 14 new/modified artifacts
**Analogs found:** 14 / 14 (every file has a direct in-repo precedent — this is a gate-hardening phase, not a green-field build)

> This phase authors NO new framework code. Every artifact is either (a) a config/matrix-row edit to an existing file or (b) a new test that copies a documented in-repo idiom verbatim. The dominant risk is procedural (the FLOW-01 dual-wiring trap, the v1.3 seeded-DB pollution trap, the frozen-spine git-diff guard), not technical. The analogs below are the exact templates to copy from.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `e2e/no-clip-sweep.spec.ts` **(NEW)** | test (e2e, runtime DOM probe) | request-response (browser render) | `e2e/reflow-sweep.spec.ts` (unseeded) + `reflow-sweep-authed.spec.ts` (seeded) + `helpers/reflow.ts` (`assertTargetSizes` per-element walk) | exact (role + flow) |
| `src/__tests__/admin-width.test.tsx` **(NEW)** | test (unit, static source-scan) | file-I/O (`readFileSync` + substring asserts) | `src/app/(dashboard)/allocations/widgets/performance/composer-width.test.tsx` | exact |
| `--text-fixed-10` / `--text-fixed-11` in `globals.css` `@theme` **(NEW tokens)** | config (CSS design token) | transform (Tailwind `@theme` → utility) | the existing fluid `@theme { --text-* }` block at `globals.css:135-144` | exact |
| `src/app/(dashboard)/admin/partner-import/page.tsx` **(MODIFY)** | component (page, prose/form) | request-response | `DashboardChrome.tsx:171-175` (`isWide` shell cap mechanism) + a new inner `max-w` cap | role-match |
| `src/app/(dashboard)/admin/users/page.tsx` **(MODIFY)** | component (page, prose/data-list) | CRUD (read) | same as above | role-match |
| `src/app/(dashboard)/admin/users/[id]/page.tsx` **(MODIFY)** | component (page, prose/form) | CRUD | same as above | role-match |
| `src/app/(dashboard)/admin/for-quants-leads/page.tsx` **(MODIFY)** | component (page, prose) | CRUD (read) | same as above | role-match |
| `e2e/axe-app-wide.spec.ts` **(MODIFY)** | test (e2e, axe matrix) | request-response | self (extend `VIEWPORTS` const + un-skip dormant describes) | exact (self-extension) |
| `e2e/reflow-sweep.spec.ts` **(MODIFY)** | test (e2e, reflow) | request-response | self + the 2560 row in `reflow-sweep-authed.spec.ts:289-354` | exact (self-extension) |
| `e2e/reflow-sweep-authed.spec.ts` **(MODIFY)** | test (e2e, reflow) | request-response | self (2560 ultra-wide block already present at `:289-354`) | exact (already partly done) |
| `lighthouserc.json` **(MODIFY)** | config (lhci budget) | batch (CI perf measure) | self (`minScore` constant at `:34`) | exact (self-edit) |
| `.github/workflows/ci.yml` lighthouse-mobile job **(MODIFY)** | config (CI job) | batch | self (`:1371-1485`; the `if: failure()` artifact upload at `:1480` is the re-measure subtlety) | exact (self-edit) |
| `eslint.config.mjs` + `tools/eslint-plugin-quantalyze/rules/no-raw-font-px.mjs` **(MODIFY config; rule UNCHANGED)** | config (lint ratchet) | transform | self (`:82` repo-wide `warn`; `:193-199` charts `off` glob) | exact (self-edit) |
| `.github/workflows/ci.yml` playwright spec lists **(MODIFY)** | config (CI job) | batch | self (unseeded list `~:1073`, seeded MA-8 list `~:1266-1280`) | exact (self-edit) |
| `tests/a11y/design-token-drift.test.ts` **(RECONCILE — likely NO edit needed)** | test (unit, drift gate) | file-I/O | self (`:117` iterates `Object.entries(TYPE_SCALE)` ONLY) | exact (self-edit) |

---

## Pattern Assignments

### `e2e/no-clip-sweep.spec.ts` (NEW — test, runtime DOM probe)

**Primary analog:** `e2e/reflow-sweep.spec.ts` (unseeded public half) + `e2e/reflow-sweep-authed.spec.ts` (seeded authed half). **Per-element-walk analog:** `e2e/helpers/reflow.ts:119-165` (`assertTargetSizes` loops `document.querySelectorAll` in a `page.evaluate`, accumulates offenders, asserts `measured > 0` so an empty page can't false-green).

This is a TWO-FILE pattern: the public probe copies `reflow-sweep.spec.ts` (NO seed gate at all — that absence is provable by grep), and the authed probe copies `reflow-sweep-authed.spec.ts` (HAS_SEED_ENV + `test.skip`). RESEARCH recommends a single new spec carrying BOTH a public describe and a seeded describe, OR two co-located specs. Either way the seeded half triggers FLOW-01 (see Shared Patterns).

**Public route list + per-route anchor + HTTP<400 fail-loud** — copy verbatim from `reflow-sweep.spec.ts:41-82`:
```typescript
const PUBLIC_ROUTES: { path: string; anchor: string }[] = [
  { path: "/", anchor: "h1" },
  { path: "/security", anchor: "main h1" },
  { path: "/for-quants", anchor: "main h1" },
  { path: "/browse", anchor: "main h1" },
  { path: "/demo", anchor: "#editorial-hero-headline" },
];
// ...
const res = await page.goto(r.path);
if (res && res.status() >= 400) {
  throw new Error(`${r.path} returned HTTP ${res.status()} — cannot run …`);
}
await assertNoReflow(page, r.anchor);   // anchor FIRST = false-green guard
```

**The new clip-detection probe core** — adapt the `assertTargetSizes` per-element loop idiom (`reflow.ts:130-154`) into a `page.evaluate` that flags `scrollWidth > clientWidth + 1` AND CSS `text-overflow:ellipsis` on text nodes, with an ALLOWLIST for deliberate clamps (RESEARCH §VERIFY-03 Code Example, lines 286-309):
```typescript
const clipped = await page.evaluate(() => {
  const ALLOW = ['[data-clamp-ok]', '.avatar', '[class*="line-clamp"]'];
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    if (ALLOW.some((s) => el.matches(s) || el.closest(s))) continue;
    const cs = getComputedStyle(el);
    const ellipsis = cs.textOverflow === "ellipsis" && cs.overflow !== "visible";
    const overflowed = el.scrollWidth > el.clientWidth + 1;
    if (ellipsis && overflowed && (el.textContent ?? "").trim().length > 0) {
      out.push(`${el.tagName}.${(el.className||"").toString().split(" ")[0]}`);
    }
  }
  return out;
});
expect(clipped, `truncated/ellipsis-clipped text: ${clipped.join(", ")}`).toEqual([]);
```

**Anti-false-green discipline (copy from `reflow.ts:52-55`):** every probe MUST first `await expect(page.locator(anchor)).toBeVisible()` so a blank/404/login/unhydrated page fails loud rather than passing against zero elements. This is the W-02 lesson and is non-negotiable per CLAUDE.md Rule 12.

**Seeded authed half — copy the scaffolding from `reflow-sweep-authed.spec.ts:38-62, 99-118`:** `HAS_SEED_ENV` const, `loginViaForm` helper, `beforeAll` seed one allocator, `beforeEach` login. Anchor authed routes on `'h1:has-text("My Allocation")'` (present on every `?tab=` value).

**Integration point:** FLOW-01 dual-wire. (1) Add `e2e/no-clip-sweep.spec.ts` to the ci.yml UNSEEDED list (`~:1073`) for the public describe; (2) if it carries a seeded describe, ALSO add it to the seeded MA-8 list (`~:1266-1280`) AND give that describe a `HAS_SEED_ENV` + `test.skip`. See Shared Patterns → FLOW-01.

---

### `src/__tests__/admin-width.test.tsx` (NEW — unit, static source-scan)

**Analog:** `src/app/(dashboard)/allocations/widgets/performance/composer-width.test.tsx` — the Phase-38 idiom. NOT a render test (Pitfall 7: jsdom has no layout engine, `getBoundingClientRect()` returns 0, can't distinguish 1100 from 1440).

**Copy the `readFileSync` + className-substring structure verbatim** (`composer-width.test.tsx:29-43, 45-81`):
```typescript
const REPO = process.cwd();
const PARTNER_IMPORT = join(REPO, "src/app/(dashboard)/admin/partner-import/page.tsx");
const src = readFileSync(PARTNER_IMPORT, "utf8");
// IN-SCOPE assertion: the 4 prose/form pages contain the new inner cap.
expect(src).toContain("max-w-3xl"); // (or whatever cap the plan picks)
```

**CRITICAL — copy the bidirectional OUT-OF-SCOPE assertion** (`composer-width.test.tsx:72-81`). Pin that a DATA page (e.g. `partner-roi/page.tsx` or `usage/page.tsx`) does NOT get the cap, so an over-broad edit fails CI (T-38-04-01 scope-creep mitigation):
```typescript
it("OUT OF SCOPE: admin DATA pages keep the wide 1920px measure (no inner cap)", () => {
  expect(partnerRoiSrc).not.toContain("max-w-3xl"); // data pages stay full-width
});
```

**The 4 target files (CONTEXT-locked):** `admin/partner-import/page.tsx`, `admin/users/page.tsx`, `admin/users/[id]/page.tsx`, `admin/for-quants-leads/page.tsx`.

**Integration point:** runs in the standard unit suite (the blocking `frontend-coverage` gate). No CI list edit. Must not drop coverage below the ratchet (lines 82 / stmts 80 / fns 74 / branches 72 — CLAUDE.md).

---

### The 4 admin prose/form pages (MODIFY — RT-W2 inner max-w cap)

**Analog (mechanism):** `DashboardChrome.tsx:64-77` documents that admin/portfolios get the wide `max-w-[1920px]` shell measure via the `isWide` regex (`:77`), and the cap is applied at `:171-175` (`mx-auto ${isWide ? "max-w-[1920px]" : "max-w-7xl"}`). CONTEXT REJECTED narrowing that regex (fragile — admin mixes prose + data). Instead each prose/form page adds its OWN inner cap, exactly as the ALLOCATOR pages already set their own page-level `max-w-[1920px]` (DashboardChrome comment `:67-69`: "The allocator pages each set their OWN page-level `max-w-[1920px]` cap").

**Verified wrapper shape (all 4 identical):** each page's `return (` opens a bare `<>` fragment with `<PageHeader …>` as the first child:
```tsx
// src/app/(dashboard)/admin/partner-import/page.tsx:89-92 (representative of all 4)
  return (
    <>
      <PageHeader
        title="Partner pilot import"
```
The inner `max-w` cap is applied by wrapping the fragment's content in a new constraining `<div className="mx-auto max-w-3xl">` (or similar prose width — plan picks the exact value; DESIGN.md governs). Confirmed line anchors: partner-import `:89`, users `:59`, users/[id] `:99`, for-quants-leads `:28`.

**Contrast file (must NOT change):** `admin/partner-roi/page.tsx:42` uses the SAME `<>` + `PageHeader` shape but is a DATA page — leave it wide. This is what the OUT-OF-SCOPE assertion in `admin-width.test.tsx` pins.

**Integration point:** `admin-width.test.tsx` static-scan verifies the literal landed. No shell change — `DashboardChrome.isWide` regex stays as-is (CONTEXT-locked).

---

### `globals.css` `@theme` — `--text-fixed-10` / `--text-fixed-11` (NEW tokens)

**Analog:** the existing fluid spine `@theme` block at `globals.css:135-144` (PLAIN `@theme`, NOT `@theme inline`). The new fixed tokens go in the SAME plain block (or a sibling plain block).

**The byte-identity mechanism (RESEARCH Pattern 5, CITED tailwindcss.com/docs/font-size):**
```css
@theme {
  --text-fixed-10: 0.625rem;   /* = 10px @16px root — byte-identical to text-[10px] */
  --text-fixed-11: 0.6875rem;  /* = 11px @16px root — byte-identical to text-[11px] */
}
```
`text-fixed-10` resolves to EXACTLY 10px. Do NOT reuse the fluid `--text-micro: clamp(0.625rem, 0.61rem + 0.0625vw, 0.6875rem)` (`globals.css:143`) — it renders 10px only at the narrow end, NOT byte-identical at desktop (RESEARCH "Alternatives Considered").

**DRIFT-TEST RECONCILIATION — RESOLVED (Open-Q1 / Assumption A3 answered):** `tests/a11y/design-token-drift.test.ts` iterates `Object.entries(TYPE_SCALE)` ONLY (`:117, :124, :138`) — it asserts each TYPE_SCALE tier's clamp appears in the plain `@theme` block and that NO TYPE_SCALE tier leaks into `@theme inline`. A NEW `--text-fixed-10` that is NOT a TYPE_SCALE key is invisible to all four `it.each(Object.entries(TYPE_SCALE))` blocks. **The no-inline guard (`:124-129`) scans for `--text-${tier}` per TYPE_SCALE tier — it does NOT scan for a bare `--text-fixed-*`.** Therefore adding the fixed aliases to the PLAIN block requires NO edit to the drift test. (Confirm by NOT adding `fixed-10`/`fixed-11` to `TYPE_SCALE` — they are deliberately outside the fluid spine.)

**Then migrate the ~40 migratable orphan files:** `text-[10px]` → `text-fixed-10`, `text-[11px]` → `text-fixed-11`. Plan must `grep` fresh — RESEARCH Assumption A1 says the live count is ~249 raw-px occurrences across ~62 files, NOT the "153" in REQUIREMENTS. Migrate "every file not already at `error` and not in the off-glob."

**Integration point:** the migrated files satisfy `no-raw-font-px=error` after the BP-03 flip; the byte-identity is proven by the desktop golden re-bake (VERIFY-04) + the frozen-spine guard staying green.

---

### `eslint.config.mjs` (MODIFY — BP-03 ratchet flip) + `no-raw-font-px.mjs` (rule body UNCHANGED)

**Analog:** the existing structure of `eslint.config.mjs` itself. THREE coordinated edits, in this ORDER (the flip is LAST):

**1. Exempt the frozen + chart-internal files via an `off` glob — the COMPLIANT path (RESEARCH Pitfall 4 / Anti-Pattern; NEVER edit EquityChart).** Copy the existing charts `off`-glob shape at `eslint.config.mjs:193-199`:
```javascript
// existing precedent — eslint.config.mjs:193-199
{
  files: ["src/components/charts/**"],
  rules: { "quantalyze/no-raw-font-px": "off", "quantalyze/no-rem-less-clamp": "off" },
},
```
Add a sibling block listing the FROZEN_ISLANDS chart + the 3 chart-internal SVG files (RESEARCH BP-03 Code Example, lines 326-339):
```javascript
{
  files: [
    "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx", // FROZEN_ISLANDS:158 — NEVER edit
    "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx",
    "src/app/factsheet/[id]/v2/HistogramChart.tsx",
    "src/app/factsheet/[id]/v2/MasterBrush.tsx",
  ],
  rules: { "quantalyze/no-raw-font-px": "off" },
},
```
> Note `EquityChart.tsx` lives under `allocations/widgets/performance/`, NOT under `src/components/charts/**`, so the existing `:193` glob does NOT already cover it — a new explicit entry is required. `TouchTooltip.tsx` IS under `src/components/charts/**` (already `off`).

**2. Flip the repo-wide rule from `warn` to `error`** at `eslint.config.mjs:82`:
```javascript
"quantalyze/no-raw-font-px": "warn",   // BEFORE
"quantalyze/no-raw-font-px": "error",  // AFTER (BP-03)
```
The per-surface `error` ratchet blocks (`:89-92`, `:107-189`) become redundant once repo-wide is `error` (a future cleanup, not required). The test-exempt (`:220-233`) and chart `off` (`:193-199`) blocks MUST remain.

**3. The rule body `tools/eslint-plugin-quantalyze/rules/no-raw-font-px.mjs` is NOT edited** — only its severity/scope in the config changes. RESEARCH §VERIFY-03 confirms the rule already detects the shapes; the `DS-04 sanctioned-exception:` greppable marker is the per-site escape if a token genuinely can't express a value.

**Sequencing (RESEARCH Primary Recommendation):** the `error` flip is the LAST step — every migratable file must be clean AND the off-globs in place first, or `npx eslint "src/**/*.{ts,tsx}"` reds CI.

**Integration point:** `npx eslint "src/**/*.{ts,tsx}"` → 0 errors is the proof. The frozen-spine guard (`phase-52-frozen-spine-guards.test.ts:158`) must stay GREEN — verify EquityChart has a ZERO git-diff.

---

### `e2e/axe-app-wide.spec.ts` (MODIFY — VERIFY-01 2560 row + VERIFY-02 un-skip)

**Analog:** self. Two edits:

**VERIFY-01 — add the 2560 row to the `VIEWPORTS` const** (`axe-app-wide.spec.ts:92-95`). The three for-loops at `:100, :132, :245` iterate `VIEWPORTS`, so one row fans every public + authed + embedded scan out to 2560 automatically:
```typescript
const VIEWPORTS = [
  { w: 1280, h: 800, name: "Desktop" },
  { w: 375, h: 812, name: "mobile" },
  { w: 2560, h: 1440, name: "ultrawide" },   // VERIFY-01
] as const;
```

**VERIFY-02 — un-skip the dormant authed (`:123`) + embedded (`:236`) describes** by wiring them into the seeded MA-8 list (currently EXCLUDED per the `:1298-1309` rationale). The `HAS_SEED_ENV` const (`:61-63`) + the two `test.skip(!HAS_SEED_ENV, …)` (`:124, :237`) STAY — they self-skip locally and run for real in CI when seeded.

**CRITICAL — the v1.3 pollution fix (RESEARCH Pitfall 2 / VERIFY-02 Code Example).** The ONLY cross-spec-dangerous seed is `seedBridgeCandidate({ categorySlug: "crypto-sma" })` at `:187` — `discovery-hide-examples-default.spec.ts` asserts that category is EMPTY. Add explicit teardown. `seedBridgeCandidate` RETURNS `{ strategyId, ownerUserId }` (verified `seed-test-project.ts:72-74`), and seed helpers use a service-role admin client, so teardown is a delete-by-id in a `finally`:
```typescript
const seeded = await seedBridgeCandidate({ categorySlug: "crypto-sma" });
try { /* login + goto + axe */ }
finally { await admin.from("strategies").delete().eq("id", seeded.strategyId); }
```

**Integration point:** FLOW-01 dual-wire — add `e2e/axe-app-wide.spec.ts` to the seeded MA-8 list (`~:1266-1280`). It is ALREADY in the unseeded list (`:1073`) for the public rows; the spec's `HAS_SEED_ENV` const is already present (place 2 satisfied). Update the `:1298-1309` ci.yml comment that currently says it is "intentionally NOT in this seeded MA-8 list."

---

### `e2e/reflow-sweep.spec.ts` + `e2e/reflow-sweep-authed.spec.ts` (MODIFY — VERIFY-01 app-wide 2560)

**Analog:** the 2560 ultra-wide block ALREADY EXISTS in `reflow-sweep-authed.spec.ts:289-354` (allocator subset: `/allocations`, `?tab=scenario`, `?tab=risk`, `/compare`). It is an ADDITIVE FOLD into the already-dual-wired host spec → NO new FLOW-01 wiring (RESEARCH Pattern 2; the precedent is the rotate-stability fold at `:155-287`).

**Copy that block's exact shape for any NEW app-wide 2560 rows** (`reflow-sweep-authed.spec.ts:311-353`):
```typescript
const ULTRAWIDE_ROUTES: { path: string; anchor: string; label: string }[] = [
  { path: "/allocations", anchor: 'h1:has-text("My Allocation")', label: "allocations (default)" },
  // … add admin/portfolios/public routes here per their seed-gating …
];
test.describe("reflow sweep @ 2560px ultra-wide — authed", () => {
  test.skip(!HAS_SEED_ENV, "reflow-sweep-authed (2560): …");
  let allocator; test.beforeAll(async () => { allocator = await seedTestAllocator(); });
  test.beforeEach(async ({ page }) => { await loginViaForm(page, allocator.email, allocator.password); });
  for (const r of ULTRAWIDE_ROUTES) {
    test(`${r.label} — no horizontal overflow at 2560px`, async ({ page }) => {
      await page.setViewportSize({ width: 2560, height: 1440 });
      const res = await page.goto(r.path);
      if (res && res.status() >= 400) throw new Error(`${r.path} returned HTTP ${res.status()} …`);
      await assertNoReflow(page, r.anchor);
    });
  }
});
```

**For the PUBLIC half** (`reflow-sweep.spec.ts`) add a parallel 2560 describe over `PUBLIC_ROUTES` (`:41-57`) — UNSEEDED, no env gate (matching the file's deliberate no-seed property, provable by grep `:30-32`).

**@container reflow trap (RESEARCH Pitfall 3):** at 2560 a Tailwind v4 same-element `@container` host+variant freezes grids 1-wide. `assertNoReflow` (runtime browser check, `helpers/reflow.ts:47`) catches the resulting overflow that jsdom class-string tests miss. Any 2560 finding traces to a same-element host/variant — fix by splitting host (parent) from variant (child), as P53 admin tables already did.

**Integration point (admin routes caveat):** `reflow-sweep-authed.spec.ts:26-31` deliberately EXCLUDES admin routes because `seedTestAllocator` stamps `role='allocator'` and `/admin` redirects a non-admin → a false-green. App-wide 2560 admin coverage needs an ADMIN-role seed (or routes through the axe-app-wide authed describe if that seeds an admin). Plan must resolve where the admin 2560 row lives.

---

### `lighthouserc.json` + lighthouse-mobile CI job (MODIFY — VERIFY-03 ratchet)

**Analog:** self. The budget is the `minScore` constant at `lighthouserc.json:34` (currently `0.6`):
```json
"categories:performance": ["error", { "minScore": 0.6 }]
```
**Re-measure mechanism (RESEARCH Pitfall 5 / Open-Q2):** the job at `ci.yml:1371-1485` runs `npx lhci autorun` (3-run median, mobile formFactor, `npm run start` prod build) and uploads `.lighthouseci/` as the `lighthouse-mobile-report` artifact. **SUBTLETY confirmed at `ci.yml:1477` — the upload is `if: failure()` only.** So to read the measured floor you EITHER (a) read a recent CI run's artifact from a run that DID fail/upload, or (b) temporarily make the upload unconditional / add a one-shot measure step. Set `minScore = (lowest measured 3-run median) − 0.02` (matches the coverage-ratchet "under-actual" philosophy in `lighthouserc.json:3` + CLAUDE.md). The 2026-06-28 single-run baseline was `/demo 0.67` lowest — do NOT day-one to 0.90+ (flaky-red).

**Do NOT touch (RESEARCH Pitfalls 5+6):** `formFactor:"mobile"` + `screenEmulation` (no `preset:"mobile"` — invalid in Lighthouse 12.x); `startServerCommand:"npm run start"` (never `next dev`); the 5 PUBLIC-only URLs (T-48-05-INFO — public-only avoids authed-URL info-disclosure to temporary-public-storage).

**Integration point:** the `assert.assertions` block is the gate; raising `minScore` is a one-constant edit.

---

### `.github/workflows/ci.yml` playwright spec lists (MODIFY — FLOW-01 wiring)

**Analog:** self. Two lists, both have explicit FLOW-01 comments:
- **Unseeded list** `~ci.yml:1073` (the `npx playwright test e2e/auth.spec.ts … e2e/reflow-sweep.spec.ts e2e/axe-app-wide.spec.ts …` line). Add `e2e/no-clip-sweep.spec.ts` here for its public rows.
- **Seeded MA-8 list** `~ci.yml:1266-1280` (`npx playwright test \ … e2e/reflow-sweep-authed.spec.ts \ e2e/svg-chart-parity.spec.ts \ … --timeout 60000`). Add `e2e/axe-app-wide.spec.ts` (VERIFY-02) + the seeded half of `e2e/no-clip-sweep.spec.ts` here.

The MA-8 list comment at `:1264` is the canonical reminder: "Adding/removing a seed-gated spec? Update both this list and the e2e/<spec>.spec.ts HAS_SEED_ENV constant." See Shared Patterns → FLOW-01.

---

## Shared Patterns

### FLOW-01 dual-wiring (the twice-/thrice-burned trap — applies to every NEW seeded spec)
**Source:** `e2e/reflow-sweep-authed.spec.ts:32-37, 42-48` (the canonical documented pattern); `e2e/svg-chart-parity.spec.ts:53-60`; ci.yml comments at `:1066-1071` (unseeded place 1) and `:1258-1264` (seeded place 1).
**Apply to:** `e2e/no-clip-sweep.spec.ts` (seeded half), `e2e/axe-app-wide.spec.ts` (now joining the seeded list).
**Both places are required or the gate silently never runs:**
```
place 1 (ci.yml): the spec filename in the seeded MA-8 list (~:1266-1280)
place 2 (spec):   const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL
                                    && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
                  test.skip(!HAS_SEED_ENV, "<spec>: seed-helper env vars not wired … (W-02)");
```
**Exception (Pattern 2):** an ADDITIVE `test.describe` folded into a spec that is ALREADY in the MA-8 list AND already `HAS_SEED_ENV`-gated needs NO new wiring (the 2560 block at `reflow-sweep-authed.spec.ts:289-354` and the rotate-stability fold at `:155-287` are the precedents).

### Anti-false-green anchor guard (W-02 / Pitfall 5 — applies to EVERY e2e probe)
**Source:** `e2e/helpers/reflow.ts:52-55` + every route list anchors a VISIBLE content element (never bare `body`/`main` chrome).
**Apply to:** `no-clip-sweep.spec.ts`, the new 2560 reflow rows, the un-skipped axe rows.
```typescript
await expect(page.locator(anchorSelector).first(),
  `… anchor "${anchorSelector}" not visible — blank/404/unhydrated page would false-green`,
).toBeVisible({ timeout: 10_000 });
```
Plus the HTTP `status() >= 400` early throw before every probe.

### WR-02 golden-pending guard (green-by-skip until deliberate bake — VERIFY-04)
**Source:** `e2e/svg-chart-parity.spec.ts:79-102` (the `SNAPSHOT_DIR` dir-scan + `GOLDEN_PENDING_REASON`) + `:159` (`test.skip(HAS_SEED_ENV && !HAS_GOLDENS, …)`).
**Apply to:** any NEW tolerance-golden spec, and `svg-chart-parity.spec.ts` itself remains the live bake target. The guard scans the snapshot dir for `*.png`; finding only `README.md` it skips LOUDLY (annotated, NOT a silent pass). Flips automatically when PNGs land — no spec edit. Tolerances: `maxDiffPixelRatio: 0.02` per-panel, `0.05` full-page, `threshold: 0.2` (`svg-chart-parity.spec.ts:215-228`). **NEVER blind `--update-snapshots`** (explicit Out-of-Scope ban) — bake is a deliberate per-chart CI commit, reviewed.

### Snapshot determinism (already configured — VERIFY-04 inherits)
**Source:** `playwright.config.ts:14-18` — `locale:"en-US"`, `timezoneId:"UTC"`, `colorScheme:"light"` (pinned because sub-pixel font hinting + number formatting shift between Mac dev and Linux CI). No edit needed; new golden specs inherit it.

### Frozen-spine git-diff guard (BP-03 central landmine — must stay GREEN)
**Source:** `src/__tests__/phase-52-frozen-spine-guards.test.ts:152-189`. `FROZEN_ISLANDS` (`:152-161`) git-diffs 8 paths vs the phase merge-base; ANY byte change reds it. `EquityChart.tsx` (`:158`) is in the list.
**Apply to:** BP-03 — do NOT edit EquityChart or the frozen islands; satisfy `no-raw-font-px=error` by the `off` glob instead. Run `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` after any chart-adjacent edit. The guard FAILS LOUD if it can't resolve a baseline (`:115-123`) — never a silent skip.

### Seeded test infra (don't hand-roll — service-role safety probes)
**Source:** `e2e/helpers/seed-test-project.ts` — `seedTestAllocator()` (`:76`), `seedStrategyWithHistory()` (`:307`), `seedBridgeCandidate()` (`:202`, returns `{strategyId, ownerUserId}` at `:72-74`), `seedAllocatorBook()` (`:516`). All carry `assertNotProductionSupabaseUrl` + `assertSupabaseServiceRoleKey` prod-misconfig probes (`:59-60`) and rerun-safe timestamped emails. VERIFY-02 reuses these + adds delete-by-id teardown.

---

## No Analog Found

None. Every Phase-54 artifact has a direct in-repo precedent — this is a gate-hardening phase whose entire premise is "wire existing helpers into new matrix rows + flip config." The only genuinely NEW test logic is the no-clip per-element truncation walk, and even that adapts the `assertTargetSizes` per-element-loop idiom (`reflow.ts:130-154`).

| File | Role | Data Flow | Why no NEW pattern is needed |
|------|------|-----------|------------------------------|
| `e2e/no-clip-sweep.spec.ts` | test | request-response | Reuses `reflow-sweep` scaffolding + `assertTargetSizes` loop idiom — only the clip-detection predicate is new (provided verbatim in RESEARCH §VERIFY-03). |

---

## Metadata

**Analog search scope:** `e2e/` (specs + helpers), `e2e/helpers/`, `src/app/(dashboard)/admin/`, `src/app/factsheet/[id]/v2/`, `src/components/layout/`, `src/app/`, `tests/a11y/`, `src/__tests__/`, `.github/workflows/ci.yml`, `eslint.config.mjs`, `tools/eslint-plugin-quantalyze/`, `lighthouserc.json`.
**Files scanned (read in full or targeted):** `axe-app-wide.spec.ts`, `reflow-sweep.spec.ts`, `reflow-sweep-authed.spec.ts`, `helpers/reflow.ts`, `svg-chart-parity.spec.ts`, `eslint.config.mjs`, `globals.css` (theme block), `design-token-drift.test.ts`, `phase-52-frozen-spine-guards.test.ts`, `DashboardChrome.tsx`, `lighthouserc.json`, `composer-width.test.tsx`, `partner-import/page.tsx`, `users/page.tsx`, `ci.yml` (4 sections), plus directory listings of `admin/` and `factsheet/[id]/v2/`.
**Open questions resolved this pass:** Open-Q1 / Assumption A3 — `design-token-drift.test.ts` iterates `Object.entries(TYPE_SCALE)` ONLY (`:117`), so a `--text-fixed-*` token outside TYPE_SCALE needs NO reconciliation. Assumption A2 — the lhci artifact is uploaded `if: failure()` (`ci.yml:1477`), a re-measure subtlety the plan must handle.
**Pattern extraction date:** 2026-06-30

## PATTERN MAPPING COMPLETE
