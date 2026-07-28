# Phase 48: Recharts + EquityChart + Final Verification - Research

**Researched:** 2026-06-28
**Domain:** Recharts 3.8.1 touch tooltips, hand-rolled-SVG touch tuning, app-wide axe matrix, `@lhci/cli` mobile perf budget, CI gate wiring
**Confidence:** HIGH (every load-bearing claim verified against `node_modules` types, live source, or official docs)

## Summary

Phase 48 is a **retrofit + verification** phase with near-zero new product surface. Three jobs: (1) make all Recharts charts tap-inspectable on touch via the dependency's own `<Tooltip trigger="click">`, gated by `useBreakpoint`, DRY'd through one shared shim; (2) wire the existing Phase-47 `useTapPin` hook onto the hand-rolled `EquityChart`'s existing `nearestIndex` binary-search (additive touch path, desktop mouse path byte-identical, no rewrite); (3) stand up the falsifiable "v1.3 done" gate matrix — an app-wide axe spec (route × viewport), the bespoke gates run app-wide, a `@lhci/cli` mobile perf budget on public routes, and a human real-device authed sign-off.

The single must-verify item from CONTEXT.md is **confirmed against the authoritative source**: `node_modules/recharts/types/component/Tooltip.d.ts` declares `trigger?: TooltipTrigger` where `TooltipTrigger = 'hover' | 'click'` (`node_modules/recharts/types/chart/types.d.ts:3`), default `"hover"`, and the doc-comment (L168-174) states: *"If `click` then the Tooltip shows after clicking and stays active."* This is the native tap-to-show/tap-to-pin behavior the contract assumes — no new gesture machinery needed for Recharts. The one net-new dependency, `@lhci/cli` 0.15.1 (published 2025-06-25, GoogleChrome/lighthouse-ci org), is legitimate and has no postinstall script.

**Primary recommendation:** Build a thin `TouchTooltip` wrapper that injects the `useBreakpoint`-gated `trigger` and spreads each chart's existing `formatter`/`contentStyle` through unchanged (all 18 charts use only `formatter=`, none use custom `content=`/`cursor=`, so the spread is uniform). Wire `useTapPin` onto `EquityChart`'s SVG via `setChartEl` + `onPointer*` handlers in addition to the existing `onMouseMove`/`onMouseLeave`. Mirror the composer-axe `serious+critical` scoped filter for the embedded factsheet. Seed lhci thresholds from a real baseline run as `error`-level assertions a few points under measured. Dual-wire every new/extended seeded spec into BOTH `HAS_SEED_ENV` and `ci.yml`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

> All four grey areas were **accepted as recommended** in smart-discuss (autonomous) mode. These are LOCKED. Research the HOW, not the WHETHER.

### Locked Decisions

**Area 1 — Recharts Touch Interaction (CHART-01b)**
- Touch mechanism = native Recharts `<Tooltip trigger="click">` gated by `useBreakpoint` (mobile → `click`; desktop → `hover`). `useTapPin` is the WRONG fit for Recharts (Recharts owns its own pointer layer).
- Desktop byte-identical — `trigger="hover"` on desktop keeps every Recharts chart's render and behavior unchanged.
- DRY = one thin shared `TouchTooltip` wrapper (executor may instead use a `useTooltipTrigger()` hook) that injects the breakpoint-gated `trigger` and spreads through each chart's existing `content`/`formatter`/props. Avoid 18× inline duplication.
- Parity-only for tooltip-less charts — charts with NO desktop hover today (OutcomesWidget sparkline) get NO invented tap-reveal; their value is already in the adjacent KPI cell.
- Keep `accessibilityLayer={false}` — do not flip it (grep-pinned).

**Area 2 — EquityChart Touch Tuning (NO rewrite)**
- Integrate `useTapPin` — wire `pointerToIndex` to the existing `nearestIndex(visibleEpochs, targetEpoch)` binary-search. Keep the desktop `onMouseMove`/`handleMove`/`hoverIdx` mouse path byte-identical (additive pointer/touch path).
- Do NOT touch the measured-width / ResizeObserver path (L517-528) — only VERIFY it holds at small widths. Do not disturb the projection `useMemo` keying (must stay keyed on data, not hoverIdx).
- Pin dismissal matches `TimeSeriesChart` — re-tap toggles the pin off, a tap moves the pin, the pin survives `pointerleave`, no auto-dismiss timer.
- Small-width legibility = minimal — bump axis font / reduce tick density ONLY if the ~12px-at-320px legible floor is breached; never downsample data points.

**Area 3 — App-wide axe + bespoke gate matrix (A11Y-01)**
- Axe route coverage = all primary routes (public: `/`, `/security`, `/for-quants`, `/browse`, `/demo`; authed: `/allocations`, strategy-v2, discovery, composer, wizard, factsheet). Exact list enumerated at plan-phase; drop genuinely non-primary routes with rationale.
- Both viewports — every axe check runs at Desktop AND a mobile viewport (375px; executor's discretion 375 vs 360).
- Embedded-factsheet landmark exception = scoped `serious+critical` filter (the composer-axe GUARD-03 precedent), NEVER a rule disable.
- Spec shape = one new parametrized `axe-app-wide.spec.ts` (route × viewport matrix); leave existing focused per-route axe specs in place. FLOW-01 dual-wire (HAS_SEED_ENV const + ci.yml seeded MA-8 / unseeded list). Prove it actually RUNS in CI.
- Bespoke gate matrix app-wide — confirm 320px reflow, 44px target-size, zoom-meta grep, mobile keyboard/focus run app-wide as BLOCKING CI checks beside axe.

**Area 4 — Mobile perf budget (A11Y-03) + final sign-off**
- lhci = `@lhci/cli` + `lighthouserc.json`, mobile form-factor, PUBLIC routes only; new `lighthouse-mobile` CI job (build → start → autorun → assert).
- Thresholds seeded from a baseline run, floors a few points UNDER measured actual (coverage-ratchet philosophy), as `error`-level assertions; ratchet over time. No hard 90+ on day one.
- Rotate/resize stability — assert no ResizeObserver-loop console error and stable memory on rotate, folded into an EXISTING mobile e2e.
- Real-device authed sign-off = a `48-HUMAN-UAT.md` real-device checklist (like Phase 47's); verification ends `human_needed`. Verify coverage ratchet held + all frozen-math / byte-identity / parity guards green un-weakened.

### Claude's Discretion
- Exact 19-chart enumeration + per-chart `TouchTooltip` wiring → **enumerated below (verified against live tree)**.
- Exact Recharts 3.8.1 tooltip `trigger`/`defaultIndex` wiring → **verified below (node_modules types)**.
- Exact primary-route list for the axe matrix and the precise mobile viewport (375 vs 360).
- Initial lhci threshold numbers (seeded from the baseline run).
- Whether `TouchTooltip` is a wrapper component or a `useTooltipTrigger()` hook.

### Deferred Ideas (OUT OF SCOPE)
- Native-app touch gestures (swipe between tabs, pull-to-refresh) — v2 (MOBL-01).
- Offline / PWA support — v2 (MOBL-02).
- Authed-route Lighthouse perf gating — needs headless auth; covered by human sign-off.
- Ratcheting lhci thresholds tighter — future maintenance.
- Baking the svg-chart-parity goldens into seeded CI — standing Phase-47 carryover (the spec self-skips until baked; not this phase's job, but must not be made false-green).

**Also OUT OF SCOPE (REQUIREMENTS.md anti-features):** rewriting `EquityChart` to viewBox; downsampling chart points; touching `scenario.ts`/`compute.ts` math; new charting library / UI kit / CSS framework; dark mode; dropping material columns.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHART-01b | Every Recharts chart (and `EquityChart`) is touch-inspectable on a phone — explicit tap-to-show/tap-to-pin tooltip (+ DESIGN.md KPI-cell fallback) replaces hover-first; `EquityChart` pointer handlers tuned for touch WITHOUT rewriting. | Recharts: `<Tooltip trigger="click">` verified native tap-to-pin (Tooltip.d.ts L168-175). EquityChart: `useTapPin` → `nearestIndex` wiring path mapped (handleMove L1142-1159, SVG handlers L1422-1430, hoverIdx L502). 18 tooltip charts + 1 parity-only enumerated. |
| A11Y-01 | App-wide axe WCAG-AA gate covers all primary routes (extended from 5), wired into BOTH seed-guard and `ci.yml` (FLOW-01). | `buildAxe()` helper + `withTags(wcag2a,wcag2aa,best-practice)` confirmed; composer-axe `serious+critical` filter precedent (L208-212) for embedded factsheet; CI seeded MA-8 list (ci.yml ~L1252-1265) + unseeded list (L1059) anchors located; reflow-sweep route × loop pattern is the data-driven template. |
| A11Y-03 | Mobile performance budget gates public routes in CI — `@lhci/cli` + Lighthouse-mobile job; thresholds seeded from baseline and ratcheted. | `@lhci/cli` 0.15.1 verified on npm (legit, GoogleChrome org, no postinstall). lighthouserc.json schema (collect/assert/upload, `preset:"mobile"`, error-level assertions) fetched from official docs. Next 16 build→`.next`→`next start` (port 3000) workflow confirmed compatible with CI's existing build-artifact restore. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Recharts touch tooltip (`trigger`) | Browser / Client | — | `useBreakpoint` is a client hook; the `trigger` is read at render in `"use client"` chart components. Recharts owns the pointer layer entirely on the client. |
| `useBreakpoint`-gated trigger selection | Browser / Client | — | `matchMedia` is browser-only; SSR snapshot is `desktop`/`hover` (verified). |
| EquityChart tap-pin (`useTapPin`) | Browser / Client | — | Pointer events + `getBoundingClientRect` are client-only; the binary-search runs in the browser. |
| App-wide axe / reflow / target-size gates | CI (Playwright, Chromium) | — | Run against a `next start` production build in GitHub Actions; not a runtime tier. |
| Lighthouse mobile perf budget | CI (lhci, headless Chrome) | — | `lhci autorun` drives headless Chrome against `next start`; public routes only (no auth). |
| Real-device authed sign-off | Human (real device) | — | Headless cannot hydrate authed pages (documented limitation, `reference_browse_no_hydrate_authed`). |
| Frozen-math / byte-identity guards | CI (Vitest + Playwright) | — | Source-grep + git-diff + golden snapshots; verify-only, must not be weakened. |

**Sanity note for the planner:** NOTHING in this phase belongs in the API/backend/database tiers. Charts read precomputed payload values (never recompute). If a plan task proposes recomputing a value client-side or touching an analytics/SQL path, that is a tier misassignment and a frozen-math violation.

## Standard Stack

### Core (all already installed — verified in node_modules)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | 3.8.1 `[VERIFIED: node_modules/recharts/package.json]` | The 19 in-scope chart components; `<Tooltip trigger>` provides native touch tap-to-pin | Already the project's charting library; `trigger="click"` is a first-class API (no add-on) |
| next | 16.2.9 `[VERIFIED: node_modules/next/package.json]` | App framework; `next build`→`.next`, `next start`→:3000 for the lhci target | Project framework |
| @axe-core/playwright | (installed, imported in `e2e/helpers/axe.ts`) `[VERIFIED: live import]` | The axe WCAG-AA scanner behind `buildAxe()` | Existing project a11y harness; no second harness allowed |
| @playwright/test | (installed) `[VERIFIED: playwright.config.ts]` | E2E runner for axe/reflow/target-size/keyboard/rotate gates | Existing project e2e runner |

### Supporting (one net-new dependency — the ONLY one allowed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @lhci/cli | 0.15.1 `[VERIFIED: npm registry — GoogleChrome/lighthouse-ci]` | Mobile Lighthouse perf budget + `lighthouserc.json` autorun in CI | The `lighthouse-mobile` CI job; A11Y-03 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@lhci/cli` raw `lhci autorun` in a CI step | `treosh/lighthouse-ci-action` GitHub Action | The action is a thin wrapper around `@lhci/cli`. CONTEXT.md Area 4 locks "`@lhci/cli` + `lighthouserc.json` ... new `lighthouse-mobile` CI job (build → start → `lhci autorun` → assert)" — i.e. a raw `npx lhci autorun` step mirroring the existing Playwright job structure. Prefer raw `lhci autorun` for consistency with the repo's existing build-artifact-restore pattern. The action remains a valid fallback if step wiring proves fiddly. `[CITED: github.com/GoogleChrome/lighthouse-ci]` |
| `TouchTooltip` wrapper component | `useTooltipTrigger()` hook returning `{ trigger }` | Both satisfy DRY. A wrapper keeps the `<Tooltip>` JSX local to each chart (smaller diff per chart: replace `<Tooltip ...>` with `<TouchTooltip ...>`); a hook needs each chart to read + spread the value. Wrapper is marginally lower-friction across 18 files. Executor's discretion (locked). |
| Native Recharts `trigger="click"` | Hand-rolled gesture layer (`useTapPin`) on Recharts | `useTapPin` is for hand-rolled SVG only — Recharts owns its own pointer/active-index state machine; layering `useTapPin` on top would fight it. LOCKED against. |

**Installation:**
```bash
npm install --save-dev @lhci/cli@0.15.1
```

**Version verification (run at plan/impl time):**
```bash
npm view @lhci/cli version            # → 0.15.1 (verified 2026-06-28)
cat node_modules/recharts/package.json | grep version   # → 3.8.1 (verified)
```

## Package Legitimacy Audit

> Phase installs exactly ONE external package (`@lhci/cli`). `slopcheck` was not installable in this environment; legitimacy verified manually via npm registry metadata + official-org provenance.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| @lhci/cli | npm | 0.15.1 published 2025-06-25 (mature line, 5+ yrs) | high (Lighthouse CI standard) | github.com/GoogleChrome/lighthouse-ci | n/a (unavailable) | **Approved** |

**Provenance checks performed `[VERIFIED: npm view]`:**
- `repository.url` = `git+https://github.com/GoogleChrome/lighthouse-ci.git` (official Google Chrome org).
- Maintainers = `paulirish`, `patrickhulce`, `hoten`, `adamraine` — the Lighthouse core team.
- `scripts.postinstall` = **none** (no install-time code execution).

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable at research time. `@lhci/cli` is nonetheless tagged `[VERIFIED: npm registry]` because it is verified via the official GoogleChrome/lighthouse-ci org provenance AND has no postinstall script. The planner MAY still add a `checkpoint:human-verify` before the `npm install` per the standard gate; given the unimpeachable provenance this is low-risk.*

## Architecture Patterns

### System Architecture Diagram

```
                         CHART-01b touch interaction
                         ───────────────────────────

  ┌─────────────────────────── Recharts family (19 components) ───────────────────────────┐
  │                                                                                        │
  │   useBreakpoint() ──► "mobile" | "tablet" | "desktop"                                  │
  │        │                                                                               │
  │        ▼                                                                               │
  │   TouchTooltip (NEW shim)  ──injects──►  trigger = mobile ? "click" : "hover"          │
  │        │  spreads through: formatter, contentStyle, ...rest (UNCHANGED)                │
  │        ▼                                                                               │
  │   <Tooltip trigger={...} {...rest} />   (18 charts)                                    │
  │        │                                                                               │
  │        ├─ desktop/tablet → "hover"  ───────► BYTE-IDENTICAL to today                   │
  │        └─ mobile        → "click"   ───────► tap shows tooltip, STAYS ACTIVE (native)  │
  │                                                                                        │
  │   OutcomesWidget sparkline (NO <Tooltip>) ─► parity-only: NO change (KPI-cell value)   │
  └────────────────────────────────────────────────────────────────────────────────────-─┘

  ┌──────────────────────── EquityChart (hand-rolled SVG, 2277 LOC) ──────────────────────┐
  │                                                                                        │
  │   <svg onMouseMove={handleMove} onMouseLeave={...}>  ── DESKTOP path: BYTE-IDENTICAL   │
  │        │                                                                               │
  │   useTapPin({ count: n, pointerToIndex })  ── ADDITIVE touch path                      │
  │        │  pointerToIndex(clientX,clientY,rect):                                        │
  │        │     px = clientX - rect.left                                                  │
  │        │     clampedPx = clamp(px, pad.l, pad.l+chartW)                                │
  │        │     targetEpoch = firstEpochX + (clampedPx-pad.l)/chartW * totalMs            │
  │        │     return nearestIndex(visibleEpochs, targetEpoch)   ◄── SAME math as        │
  │        │                                                            handleMove L1158   │
  │        ▼                                                                               │
  │   ref={setChartEl}  onPointer{Down,Move,Up,Leave}={...}  (added to the same <svg>)     │
  │        │                                                                               │
  │        └─ selectedIdx/pinned ──► render the SAME crosshair+dot reveal hoverIdx renders │
  │                                   (L1589-1640) — read precomputed values, NO recompute │
  │                                                                                        │
  │   ResizeObserver measured-width (L517-528, floor 400px)  ── DO NOT TOUCH (verify only) │
  │   projection useMemo (L652-670, keyed on DATA not hoverIdx) ── DO NOT add touch deps   │
  └────────────────────────────────────────────────────────────────────────────────────-─┘

                         A11Y-01 + A11Y-03 verification matrix
                         ─────────────────────────────────────

   GitHub Actions (push/PR)
     ├─ frontend-build ──► nextjs-build artifact (.next + public)
     │
     ├─ e2e (unseeded job)  restore artifact ► npm run start ► npx playwright test
     │     reflow.spec · target-size.spec · reflow-sweep.spec · [axe-app-wide PUBLIC rows]
     │
     ├─ e2e (seeded MA-8 job, gated vars.E2E_TEST_DB_CONFIGURED=='true')
     │     seed ► npm run start ► npx playwright test (each self-skips on !HAS_SEED_ENV)
     │     discovery-axe · composer-axe · strategy-v2-axe · …
     │     reflow-sweep-authed · target-size · [axe-app-wide AUTHED rows] · [rotate-stability fold]
     │
     └─ lighthouse-mobile (NEW job)  next build ► next start ► npx lhci autorun
           lighthouserc.json: collect{url:[public routes], settings.preset:"mobile"}
                              assert{error-level, minScore seeded a few pts under baseline}
```

### Recommended Project Structure (net-new / extended files)
```
src/
├── components/charts/
│   └── TouchTooltip.tsx          # NEW — breakpoint-gated <Tooltip trigger> shim (or src/hooks/useTooltipTrigger.ts)
└── app/(dashboard)/allocations/widgets/performance/
    └── EquityChart.tsx           # EXTENDED — additive useTapPin touch path only

e2e/
├── axe-app-wide.spec.ts          # NEW — route × viewport axe matrix (data-driven)
├── target-size.spec.ts           # EXTENDED — add EquityChart tap-rect ≥44px @ 320px on /allocations
└── reflow-sweep-authed.spec.ts   # CANDIDATE — fold rotate-stability (no-RO-loop / stable-memory) here, or another mobile e2e

lighthouserc.json                 # NEW — lhci config (collect/assert/upload)
.github/workflows/ci.yml          # EXTENDED — axe-app-wide into BOTH lists + new lighthouse-mobile job
package.json                      # EXTENDED — @lhci/cli devDep
.planning/phases/48-.../48-HUMAN-UAT.md   # NEW — real-device authed checklist
```

### Pattern 1: Breakpoint-gated Recharts trigger (the TouchTooltip shim)
**What:** A wrapper that reads `useBreakpoint()` and injects `trigger`, spreading all other Tooltip props.
**When to use:** Every one of the 18 charts that has a `<Tooltip>` today.
**Verified fact:** `trigger` default is `"hover"`; `trigger="click"` "shows after clicking and stays active" `[VERIFIED: node_modules/recharts/types/component/Tooltip.d.ts L168-175]`. All 18 charts pass only `formatter` (+ `contentStyle`), none use custom `content=` or `cursor=` `[VERIFIED: grep across live tree]`, so the spread is uniform.
```tsx
// Source: derived from node_modules/recharts/types/component/Tooltip.d.ts (verified API)
// "use client" already present in every chart file.
import { Tooltip } from "recharts";
import type { ComponentProps } from "react";
import { useBreakpoint } from "@/hooks/useBreakpoint";

type TooltipProps = ComponentProps<typeof Tooltip>;

export function TouchTooltip(props: TooltipProps) {
  // mobile → tap-to-show/pin; tablet+desktop → hover (byte-identical to today).
  // SSR + first client paint render "desktop" → "hover" (see Pitfall 1).
  const trigger = useBreakpoint() === "mobile" ? "click" : "hover";
  return <Tooltip trigger={trigger} {...props} />;
}
```
Per-chart change is a one-token swap: `<Tooltip formatter={...} contentStyle={...} />` → `<TouchTooltip formatter={...} contentStyle={...} />`.

### Pattern 2: useTapPin → nearestIndex on EquityChart (additive)
**What:** A second pointer handler set on the same SVG that pins the value the desktop hover shows.
**When to use:** EquityChart only (the hand-rolled SVG; Recharts charts use Pattern 1).
**Key constraint:** the existing `onMouseMove={handleMove}` / `onMouseLeave` / `hoverIdx` path stays exactly as shipped (L1428-1429). The touch path is parallel.
```tsx
// Source: derived from src/hooks/useTapPin.ts (verified API) + EquityChart handleMove (L1142-1159)
const tap = useTapPin({
  count: n,
  pointerToIndex: (clientX, _clientY, rect) => {
    if (n === 0) return null;
    const px = clientX - rect.left;
    if (n === 1) return 0;
    const clampedPx = Math.max(pad.l, Math.min(pad.l + chartW, px));   // SAME clamp as handleMove
    const targetEpoch = firstEpochX + ((clampedPx - pad.l) / chartW) * totalMs;
    return nearestIndex(visibleEpochs, targetEpoch);                   // SAME binary-search
  },
});
// On the EXISTING <svg> (do not remove the mouse handlers):
//   ref={tap.setChartEl}
//   onPointerDown={tap.onPointerDown} onPointerMove={tap.onPointerMove}
//   onPointerUp={tap.onPointerUp}     onPointerLeave={tap.onPointerLeave}
// Render the SAME crosshair/dot reveal (L1589-1640) when (hoverIdx ?? tap.selectedIdx) is set.
```
Note `useTapPin`'s handlers are typed `ReactPointerEvent<SVGSVGElement>` `[VERIFIED: useTapPin.ts L79-82]` — the SVG already exists, so the types line up directly. `setChartEl` is a callback ref (no `.current` mutation — react-compiler-safe) `[VERIFIED: useTapPin.ts L107-109]`.

### Pattern 3: Data-driven axe route × viewport matrix (one spec)
**What:** A `for (route of ROUTES) for (vp of VIEWPORTS) test(...)` matrix in one `axe-app-wide.spec.ts`.
**Template:** `e2e/reflow-sweep.spec.ts` already does the route-loop pattern (`PUBLIC_ROUTES.map`, L41-68) `[VERIFIED: live source]`. Reuse its `{path, anchor}` shape + a `VIEWPORTS = [{w:1280,h:800,name:"Desktop"},{w:375,h:812,name:"mobile"}]` inner loop.
**Ruleset:** `buildAxe(page)` from `e2e/helpers/axe.ts` (already `withTags(["wcag2a","wcag2aa","best-practice"])`) `[VERIFIED: axe.ts L15-21]`. Reuse it — do NOT introduce a second harness.
**Embedded-factsheet exception (composer route + factsheet route):** filter to `serious+critical`, NEVER disable a rule:
```ts
// Source: e2e/composer-axe.spec.ts L208-212 (verified precedent — GUARD-03)
const results = await buildAxe(page).analyze();
const blocking = results.violations.filter(
  (v) => v.impact === "serious" || v.impact === "critical",
);
expect(blocking).toEqual([]);
// For non-embedded routes keep the strict `expect(results.violations).toEqual([])`.
```
**Anti-false-green:** every analyze() must be gated behind a visible-anchor assertion (`main h1` etc.) so a blank/404/login page fails loud, not hollow-zero (the composer-axe + reflow-sweep idiom).

### Pattern 4: lighthouserc.json (mobile, public routes, error-level seeded thresholds)
**What:** lhci config consumed by `npx lhci autorun`.
```json
// Source: github.com/GoogleChrome/lighthouse-ci/docs/configuration.md (fetched 2026-06-28)
{
  "ci": {
    "collect": {
      "startServerCommand": "npm run start",
      "startServerReadyPattern": "ready|started|listening",
      "startServerReadyTimeout": 30000,
      "url": [
        "http://localhost:3000/",
        "http://localhost:3000/security",
        "http://localhost:3000/for-quants",
        "http://localhost:3000/browse",
        "http://localhost:3000/demo"
      ],
      "numberOfRuns": 3,
      "settings": { "preset": "mobile" }
    },
    "assert": {
      "preset": "lighthouse:no-pwa",
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.70 }]
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
```
`preset:"mobile"` is the default and applies mobile screen emulation + throttling `[CITED: lighthouse-ci configuration.md]`. `minScore` is a placeholder — **seed it from a real baseline run a few points under measured** (locked). `error`-level fails the build (locked). `lighthouse:no-pwa` drops PWA audits (this app is not a PWA — MOBL-02 deferred). The CI job already has the build-artifact-restore + `npm run start` machinery to copy (`ci.yml` L1040-1059).

### Anti-Patterns to Avoid
- **Layering `useTapPin` on Recharts charts** — Recharts owns its pointer/active-index state machine; the native `trigger` is the correct surface. LOCKED against.
- **Flipping `accessibilityLayer={true}`** — re-introduces empty keyboard tab-stops; breaks `tests/visual/chart-accessibility-layer.test.ts` AND `e2e/strategy-v2-keyboard.spec.ts` (the original bug). The `trigger` change touches `<Tooltip>`, NOT the chart root tag, so it does not affect this grep.
- **Disabling an axe rule for the embedded factsheet** — use the `serious+critical` impact filter instead (every rule still RUNS). LOCKED against.
- **Adding `selectedIdx`/`pinned` to the projection `useMemo` deps** — re-introduces the multi-hundred-ms-per-pixel hover regression the hoist fixed (L657-670). LOCKED against.
- **Hard 90+ Lighthouse score on day one** — flaky-red; seed from baseline (locked).
- **Authoring a new seeded spec without dual-wiring** — FLOW-01: it silently never runs (burned ≥3×).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Touch tooltip for Recharts | A custom tap/pointer gesture layer per chart | `<Tooltip trigger="click">` (native) | The dependency already provides tap-to-show/stay-active; a parallel layer fights Recharts' own pointer state. `[VERIFIED: Tooltip.d.ts]` |
| Tap-vs-drag + pin-toggle on EquityChart | A fresh gesture state machine | `useTapPin` (Phase 47, tested, 22/22 branch cov) | Slop/time/touch-only/re-tap/leave-survival semantics already extracted verbatim from `TimeSeriesChart`. `[VERIFIED: useTapPin.ts]` |
| Breakpoint detection | A new matchMedia/orientation listener | `useBreakpoint` (SSR-safe two-pass) | Already the single source; orientation media-query would miss narrow desktop windows (UI-SPEC locks width-breakpoint). `[VERIFIED: useBreakpoint.ts]` |
| axe scanning | jest-axe / a second AxeBuilder config | `buildAxe()` from `e2e/helpers/axe.ts` | Shared factory keeps the rule-set in lock-step; a second harness drifts. `[VERIFIED: axe.ts]` |
| Reflow / target-size measurement | New DOM-measurement code | `assertReflow` / `assertTargetSizes` from `e2e/helpers/reflow.ts` (`MIN_TARGET_PX=44`) | Existing helpers; `MIN_TARGET_PX` must NOT be lowered. `[VERIFIED: reflow.ts L27]` |
| Lighthouse perf budgeting | A custom perf harness / Puppeteer timing | `@lhci/cli` + `lighthouserc.json` | The single allowed new dep; standard, maintained by the Lighthouse team. `[VERIFIED: npm]` |
| EquityChart epoch→index mapping | A new inversion | the existing `nearestIndex(visibleEpochs, targetEpoch)` binary-search | `useTapPin.pointerToIndex` must reuse the SAME math `handleMove` runs (L1150-1158) so a tap pins exactly what hover shows. `[VERIFIED: EquityChart.tsx]` |

**Key insight:** This phase is almost entirely *wiring existing, tested primitives* (a native Recharts prop, a Phase-47 hook, an existing axe/reflow harness, a standard CI tool). The regression risk is concentrated in **byte-identity** (desktop must not change) and **CI-actually-runs** (FLOW-01), not in new logic.

## Runtime State Inventory

> This phase is **not** a rename/refactor/migration. It is additive presentation + CI scaffolding over a frozen engine. No stored data, live-service config, OS-registered state, secrets, or build artifacts carry a renamed string.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — phase writes no data; charts read precomputed payloads only. | none |
| Live service config | None — no external service config changes. | none |
| OS-registered state | None. | none |
| Secrets/env vars | None new at runtime. CI uses existing `TEST_SUPABASE_URL`/`TEST_SUPABASE_SERVICE_ROLE_KEY` (already wired) for seeded specs; lhci needs NO secret (public routes, temporary-public-storage upload). | none |
| Build artifacts | None renamed. `@lhci/cli` install adds a devDep + `package-lock.json` entry (normal). | `npm install` once |

**Verified by:** the phase scope is `<Tooltip trigger>` swaps, an additive EquityChart touch path, new/extended e2e specs, a `lighthouserc.json`, a CI job, and a UAT doc — none of which persists or registers state.

## Common Pitfalls

### Pitfall 1: SSR/hydration two-pass with the breakpoint-gated trigger
**What goes wrong:** On mobile, the chart renders `trigger="hover"` on the server AND on the first client paint, then flips to `"click"` after `matchMedia` resolves — a brief window where a mobile tap does nothing.
**Why it happens:** `useMediaQuery`'s `getServerSnapshot` returns `false` for every query `[VERIFIED: useMediaQuery.ts L27]`, so `useBreakpoint` resolves to `"desktop"` on the server and on the all-false initial client snapshot, then `useSyncExternalStore` updates post-hydration. This is **by design** (matches the `strategy.ui_v2` SSR-false convention) and produces **no hydration mismatch** (server and first-client agree). The flip is a normal post-hydration re-render.
**How to avoid:** Accept the two-pass — it is the locked, hydration-safe pattern. Do NOT try to read the breakpoint during SSR or force a single-pass; that re-introduces hydration mismatches. The momentary `"hover"` on mobile pre-hydration is harmless (no tooltip is shown until hydration completes anyway). Component tests should assert the desktop arm renders `trigger="hover"` (default) and the mobile arm renders `trigger="click"` by mocking `useBreakpoint`.

### Pitfall 2: `trigger="click"` UX differs by chart type
**What goes wrong:** Tap-to-pin "feels" different on a `PieChart`/`BarChart` (per-segment/per-bar Cell) vs a `LineChart`/`AreaChart` (axis-coordinate tooltip).
**Why it happens:** With `shared` unset (all 19 charts have `shared=0` `[VERIFIED: grep]`), cartesian charts (Line/Area/Composed/Bar) show the tooltip at the nearest axis coordinate on click; `PieChart` (CompositionDonut) and per-`Cell` bars (RiskDecomposition/ReturnHistogram/YearlyReturns/AttributionBar) show it for the tapped segment/bar. Thin bars/small segments may be hard to hit.
**How to avoid:** This is acceptable per the UI-SPEC — where a Recharts tappable element is smaller than 44px, the contract relies on the **adjacent KPI-cell value fallback** rather than inflating Recharts internals (UI-SPEC Spacing §). Do NOT add a ≥44px overlay to Recharts charts. The UAT checklist should spot-check tap-to-pin on at least one Line, one Bar, and the Pie chart.

### Pitfall 3: The gate exists but never RUNS in CI (FLOW-01)
**What goes wrong:** `axe-app-wide.spec.ts` is authored with a `HAS_SEED_ENV` self-skip but not added to `ci.yml`'s seeded MA-8 list → it self-skips forever and CI is green against nothing.
**Why it happens:** Two independent switches must both be flipped: the spec's `HAS_SEED_ENV` const (place 2) AND the `ci.yml` `npx playwright test …` list (place 1). Burned ≥3× (JOURNEY-03, Phase 44, Phase 47).
**How to avoid:** Authed routes → add `axe-app-wide.spec.ts` to the seeded MA-8 list (`ci.yml` ~L1252-1265, alongside `composer-axe`/`svg-chart-parity`). Public-route axe rows → either keep them in the same spec gated to run unseeded, or add the spec to the unseeded list (`ci.yml` L1059, alongside `reflow`/`target-size`/`reflow-sweep`). **Prove it ran** in a real CI run (check the run log for the test names, not just a green check). The ci.yml even carries the reminder comment: *"Adding/removing a seed-gated spec? Update both this list and the e2e/<spec>.spec.ts HAS_SEED_ENV constant."* `[VERIFIED: ci.yml L1251]`

### Pitfall 4: Hollow-zero false-green on an empty/unhydrated page
**What goes wrong:** axe analyzes a 404/login/empty `<main>` and reports zero violations (because there's nothing to violate).
**Why it happens:** Authed routes redirect to `/login` without a seeded session; headless can't hydrate authed pages.
**How to avoid:** Gate every analyze() behind a `expect(page.locator("main h1")).toBeVisible()` (or a route-specific anchor) — the composer-axe + target-size + reflow idiom `[VERIFIED: composer-axe.spec.ts L104-106, target-size.spec.ts L54]`. For authed routes, seed + log in via the `seedTestAllocator`/`loginViaForm` helpers (composer-axe pattern). Fail loud on HTTP ≥ 400 before scanning.

### Pitfall 5: Breaking the `accessibilityLayer={false}` grep with a prop refactor
**What goes wrong:** Refactoring a chart to spread props onto the chart root tag (`<LineChart {...chartProps}>`) hides `accessibilityLayer={false}` from the source-grep, failing `chart-accessibility-layer.test.ts`.
**Why it happens:** The guard greps the literal `<Tag ...>` opening block for `accessibilityLayer={false}` `[VERIFIED: chart-accessibility-layer.test.ts L67-71]`. It does NOT evaluate runtime props.
**How to avoid:** The `TouchTooltip` change touches the `<Tooltip>` element only — the chart root tags (`<LineChart accessibilityLayer={false}>` etc.) stay literal and untouched. Do NOT spread props onto the chart root. The grep also has a breadth floor (`files.length >= 18`) — adding charts is fine; deleting below 18 trips it.

### Pitfall 6: lhci against a dev server / wrong build dir
**What goes wrong:** `lhci autorun` runs against `next dev` (slow, non-representative) or a `.next/dev` build, producing a meaningless/failing perf score.
**Why it happens:** Next 16 routes dev builds to `.next/dev` and production `next build` to `.next` `[VERIFIED: node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md L60]`. `next start` serves the production `.next` on :3000.
**How to avoid:** The `lighthouse-mobile` job must `next build` then `lhci autorun` with `startServerCommand: "npm run start"` (production). Reuse the existing CI build-artifact restore (`ci.yml` L1040-1046 downloads the `nextjs-build` artifact into `.next`) so the perf job doesn't rebuild from scratch. `next start` defaults to port 3000 `[VERIFIED: next.md L121]` — match the `url` entries.

### Pitfall 7: Disturbing EquityChart's measured-width / projection memo
**What goes wrong:** Touching the ResizeObserver path or adding touch state to the projection `useMemo` deps re-introduces a per-pixel performance regression or changes desktop layout.
**Why it happens:** The projection memo is deliberately keyed on DATA only, not `hoverIdx`, to keep hover O(1) (L657-670); the ResizeObserver floors width at 400px (L517-528).
**How to avoid:** The touch path is *purely additive* — `useTapPin` owns its own state (`selectedIdx`/`pinned`), rendered alongside `hoverIdx`. Do NOT add `selectedIdx`/`pinned` to any existing `useMemo` dep array. Verify (don't refactor) the measured-width path holds at 320px.

## Code Examples

### Confirming the Recharts trigger contract (the must-verify item)
```ts
// Source: node_modules/recharts/types/component/Tooltip.d.ts (VERIFIED 2026-06-28)
// L168-175:
//   /**
//    * If `hover` then the Tooltip shows on mouse enter and hides on mouse leave.
//    * If `click` then the Tooltip shows after clicking and stays active.
//    * @defaultValue hover
//    */
//   trigger?: TooltipTrigger;
//
// node_modules/recharts/types/chart/types.d.ts:3:
//   export type TooltipTrigger = 'hover' | 'click';
//
// defaultTooltipProps.trigger === "hover"  (L207)
// defaultIndex?: number | TooltipIndex     (L78) — NOT needed; touch reveal is tap-driven, not pre-pinned.
// active?: boolean (L26) — optional controlled mode; NOT used (let Recharts own the lifecycle, locked).
```

### Existing EquityChart hover math the touch path must mirror
```ts
// Source: src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx L1142-1159 (VERIFIED)
function handleMove(e: React.MouseEvent<SVGSVGElement>) {
  if (n === 0) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const px = e.clientX - rect.left;
  if (n === 1) { setHoverIdx(0); return; }
  const clampedPx = Math.max(pad.l, Math.min(pad.l + chartW, px));
  const targetEpoch = firstEpochX + ((clampedPx - pad.l) / chartW) * totalMs;
  setHoverIdx(nearestIndex(visibleEpochs, targetEpoch));
}
// The SVG (L1422-1430): onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}
// — these stay byte-identical. useTapPin's pointerToIndex reuses the px→epoch→nearestIndex chain.
```

### The 19-chart inventory (verified against the live tree)
```
# 18 with <Tooltip> → get the gated trigger via TouchTooltip:
src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx   BarChart
src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx            AreaChart
src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.tsx               BarChart (Cell)
src/app/(dashboard)/allocations/widgets/risk/TailRisk.tsx                        BarChart
src/components/charts/CorrelationWithBenchmark.tsx                               LineChart
src/components/charts/DrawdownChart.tsx                                          AreaChart
src/components/charts/NetGrossExposureChart.tsx                                  ComposedChart
src/components/charts/ReturnHistogram.tsx                                        BarChart (Cell×2)
src/components/charts/RollingAlphaBetaChart.tsx                                  LineChart
src/components/charts/RollingMetrics.tsx                                         LineChart
src/components/charts/RollingSortinoChart.tsx                                    LineChart
src/components/charts/RollingVolatilityChart.tsx                                 LineChart
src/components/charts/TurnoverChart.tsx                                          LineChart
src/components/charts/YearlyReturns.tsx                                          BarChart (Cell)
src/components/portfolio/AttributionBar.tsx                                      BarChart (Cell)
src/components/portfolio/CompositionDonut.tsx                                    PieChart (Cell)
src/components/portfolio/RiskAttribution.tsx                                     BarChart
src/components/strategy/CompareEquityOverlay.tsx                                 LineChart
# 1 parity-only (NO <Tooltip>, hidden axes sparkline):
src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx             LineChart  ← NO change
```
`[VERIFIED: grep "from 'recharts'" + "<Tooltip" + chart-type grep across src/ on 2026-06-28]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Recharts v2 `activeIndex`-based tooltip control | Recharts v3 `trigger` prop (`hover`/`click`) + `defaultIndex` | Recharts 3.x major | `trigger="click"` is now the first-class touch path — no controlled-state hand-rolling needed. `[VERIFIED: Tooltip.d.ts; v2→v3 migration referenced L218]` |
| `next build` → `.next` for both dev and prod | Next 16: dev → `.next/dev`, prod → `.next` | Next 16 | lhci must run against the production `next build`/`next start` (the CI artifact path), not dev. `[VERIFIED: next.md L60]` |
| Lint during `next build` | Linting removed from `next build` in Next 16 | Next 16 | Not directly in scope, but confirms training data on Next build behavior is stale — heed AGENTS.md docs-first. `[VERIFIED: next.md L103]` |

**Deprecated/outdated:**
- Recharts v2 tooltip patterns from training data — superseded by v3 `trigger`/`defaultIndex`. Confirm against `node_modules/recharts/types/**`, not memory.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **AGENTS.md docs-first rule:** "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before writing Next code; heed deprecation notices. (Verified: `next start`/`next build`/`.next/dev` behavior above is from the bundled docs.)
- **Coverage ratchet (CLAUDE.md + vitest.config.ts):** lines 82 / statements 80 / functions 74 / branches 72, BLOCKING via the `frontend-coverage` CI job. Measured actual 2026-06-20: 85.2 / 83.3 / 77.4 / 75.5 `[VERIFIED: vitest.config.ts L73-77]`. New viewport conditionals (the `trigger` ternary, the EquityChart touch path) need **branch coverage**; never lower a threshold or blanket-update a snapshot. Measure with `npm run test:coverage` after the change and report the new actuals.
- **DESIGN.md authority:** all tokens locked; no new colors/typography/spacing (the `accessibilityLayer={false}` opt-out + KPI-cell fallback are DESIGN.md decisions). Any hex comes from `chart-tokens.ts` or a `var(--color-*)` ref `[VERIFIED: chart-tokens.ts]`.
- **Banned packages (global CLAUDE.md):** none relevant to this phase (no React Native).
- **No manual git commit:** use the project's /ship flow (feedback memory).
- **Rule 3 (surgical changes):** the EquityChart touch path is additive; the per-chart change is a one-token `<Tooltip>`→`<TouchTooltip>` swap. Do not "improve" adjacent code.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Wrapping `<Tooltip>` in a thin `TouchTooltip` and spreading props preserves byte-identical desktop render (since desktop `trigger` defaults to `"hover"` and that's what the wrapper injects). | Pattern 1 | LOW — if any chart relied on an implicit non-default `trigger` it would change, but all 18 omit `trigger` today (default hover), so the wrapper reproduces it exactly. Verify with a desktop component snapshot per chart family. |
| A2 | `serious+critical` is the right filter granularity for the embedded factsheet on the new app-wide spec (vs. composer-axe which scoped it to one route). | Pattern 3 | MEDIUM — the embedded factsheet appears on the composer + (possibly) the standalone factsheet route; on standalone `/factsheet/[id]/v2` the existing strict `strategy-v2-axe`/`discovery-axe` already pass with ALL impacts, so the new spec should keep standalone routes STRICT and apply the filter ONLY to the composer/embedded surface. Planner must scope precisely. |
| A3 | The mobile axe viewport is 375px (CONTEXT.md leaves 375 vs 360 to discretion). | User Constraints | LOW — either is a valid small-phone width; 375 (iPhone) is the common default and matches reflow-sweep's mobile usage. |
| A4 | lhci `minScore` placeholder 0.70 is illustrative; the real floor comes from a baseline run. | Pattern 4 | LOW (by design) — locked to seed from baseline; the number in the example must NOT be shipped as-is. |
| A5 | The rotate-stability assertion (no ResizeObserver-loop console error, stable memory) folds cleanly into `reflow-sweep-authed.spec.ts` or another existing mobile e2e. | Validation Architecture | LOW — `page.on("console")` / `pageerror` listeners are already used in several e2e specs; the fold is additive. Planner picks the host spec. |

## Open Questions (RESOLVED)

1. **Exact authed-route list for the axe matrix (strategy-v2, discovery, composer, wizard, factsheet need concrete seeded URLs).**
   - What we know: composer = `/allocations?tab=scenario`; factsheet = `/factsheet/[id]/v2`; strategy-v2 = `/strategy/[id]/v2`; discovery = `/discovery/[slug]`; wizard = `/strategies/new/wizard`. These already have seeded specs whose URL-construction the new spec can mirror.
   - What's unclear: whether to RE-scan routes already covered by a focused spec (composer-axe/strategy-v2-axe) or only ADD the uncovered primary routes at the new mobile viewport. CONTEXT.md says "leave the existing focused per-route axe specs in place" — implying the new spec adds the *mobile viewport* dimension + the *uncovered* routes, not a wholesale re-scan.
   - **RESOLVED:** New spec covers all primary routes at BOTH viewports using the same seed helpers; Desktop overlap with focused specs accepted (cheap) for matrix completeness. Implemented in **48-04 Task 1** (route × {Desktop, mobile 375} matrix; standalone /factsheet/[id]/v2 kept STRICT per assumption A2; embedded factsheet scoped serious+critical).

2. **lhci public-route set on `next start` — does `/demo` render without a seeded DB?**
   - What we know: `/demo` is a public route (in reflow-sweep PUBLIC_ROUTES with anchor `#editorial-hero-headline`); the unseeded e2e job already loads it.
   - What's unclear: whether the demo page's perf is representative without seed data.
   - **RESOLVED:** Include `/`, `/security`, `/for-quants`, `/browse`, `/demo` (all confirmed public + reflow-sweep-covered). Baseline the run; if `/demo` is anomalous, document and drop with rationale. Implemented in **48-05 Task 1** (lighthouserc.json public-route set, baseline-seeded thresholds).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| recharts | CHART-01b Recharts touch | ✓ | 3.8.1 | — |
| next (build/start) | lhci target, e2e server | ✓ | 16.2.9 | — |
| @axe-core/playwright | A11Y-01 axe matrix | ✓ | (installed) | — |
| @playwright/test | all e2e gates | ✓ | (installed) | — |
| @lhci/cli | A11Y-03 perf budget | ✗ (net-new) | install 0.15.1 | none — it is the single allowed new dep; install it |
| Chrome/Chromium (headless) | lhci + Playwright | ✓ in CI (`playwright install chromium`) | — | — |
| slopcheck | package legitimacy gate | ✗ | — | manual npm provenance check (done above) |

**Missing dependencies with no fallback:** `@lhci/cli` — but it is the explicitly-allowed install (A11Y-03 cannot ship without it). Not a blocker; install it.
**Missing dependencies with fallback:** `slopcheck` — replaced by manual provenance verification (GoogleChrome org, no postinstall).

## Validation Architecture

> `workflow.nyquist_validation = true` `[VERIFIED: .planning/config.json]` — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit/component) + Playwright (e2e) `[VERIFIED: vitest.config.ts, playwright.config.ts]` |
| Config file | `vitest.config.ts` (coverage thresholds L73-77); `playwright.config.ts` (Desktop Chrome project, CI workers=1, retries=2) |
| Quick run command | `npx vitest run <file>` (unit) ; `npx playwright test <spec> --project=chromium` (e2e) |
| Full suite command | `npm run test` (vitest) ; `npm run test:coverage` (coverage gate) ; seeded `npx playwright test` MA-8 list (CI) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHART-01b | `TouchTooltip` injects `trigger="click"` on mobile, `"hover"` on desktop; spreads props | unit/component | `npx vitest run src/components/charts/TouchTooltip.test.tsx` | ❌ Wave 0 |
| CHART-01b | Each chart family desktop render byte-identical (trigger defaults hover) | component snapshot | `npx vitest run <chart>.test.tsx` (existing per-chart tests) | ⚠️ extend existing |
| CHART-01b | `OutcomesWidget` sparkline unchanged (parity-only) | component | existing OutcomesWidget test (assert no `trigger`/no `<Tooltip>`) | ⚠️ verify existing |
| CHART-01b | EquityChart `pointerToIndex` maps px→nearestIndex identically to handleMove | unit | `npx vitest run` EquityChart touch-path test (extract pointerToIndex or test via mount) | ❌ Wave 0 |
| CHART-01b | EquityChart desktop mouse path byte-identical (hoverIdx via onMouseMove) | component | existing EquityChart test | ⚠️ verify existing |
| CHART-01b | EquityChart tap-pin hit area ≥44px under pointer-coarse @ 320px on /allocations | e2e (seeded, coarse) | `npx playwright test e2e/target-size.spec.ts` (extended) | ⚠️ extend |
| A11Y-01 | Zero WCAG-AA violations across all primary routes × {Desktop, mobile 375} | e2e (seeded + unseeded) | `npx playwright test e2e/axe-app-wide.spec.ts` | ❌ Wave 0 |
| A11Y-01 | Embedded factsheet → serious+critical=0 (no rule disabled) | e2e | (within axe-app-wide; filter precedent composer-axe L208-212) | ❌ Wave 0 |
| A11Y-01 | 320px reflow blocking app-wide | e2e | `npx playwright test e2e/reflow-sweep.spec.ts e2e/reflow-sweep-authed.spec.ts` | ✅ verify |
| A11Y-01 | zoom-meta grep blocking | unit | `npx vitest run tests/visual/viewport-zoom-meta.test.ts` | ✅ |
| A11Y-01 | mobile keyboard/focus blocking | e2e | `npx playwright test e2e/mobile-drawer-keyboard.spec.ts e2e/strategy-v2-keyboard.spec.ts` | ✅ verify |
| A11Y-03 | Mobile perf score ≥ seeded floor on public routes | CI (lhci) | `npx lhci autorun` (lighthouserc.json) | ❌ Wave 0 |
| A11Y-03 | No ResizeObserver-loop console error + stable memory on rotate | e2e | folded into an existing mobile e2e (`page.on("console")`/`pageerror`) | ❌ Wave 0 (fold) |
| (guard) | scenario.ts zero-diff (SCENARIO-05) | unit (git-diff) | `npx vitest run src/__tests__/phase-31-frozen-spine-guards.test.ts` | ✅ must stay green |
| (guard) | accessibilityLayer={false} grep (whole codebase) | unit | `npx vitest run tests/visual/chart-accessibility-layer.test.ts` | ✅ must stay green |
| (guard) | svg-chart-parity goldens (Phase-47 carryover, self-skips) | e2e | `npx playwright test e2e/svg-chart-parity.spec.ts` | ✅ do not make false-green |
| (guard) | coverage ratchet held | unit (coverage) | `npm run test:coverage` | ✅ must stay ≥ thresholds |

### Sampling Rate
- **Per task commit:** the touched spec/test (`npx vitest run <file>` or `npx playwright test <spec> --project=chromium`).
- **Per wave merge:** `npm run test` + the seeded MA-8 Playwright list + `npm run test:coverage`.
- **Phase gate:** full Vitest suite green + coverage ≥ thresholds + the seeded MA-8 list green in a REAL CI run (FLOW-01 proof) + the new `lighthouse-mobile` job green + all frozen-math/byte-identity/parity guards green before `/gsd:verify-work`. Verification ends `human_needed` (real-device UAT).

### Wave 0 Gaps
- [ ] `src/components/charts/TouchTooltip.test.tsx` — covers CHART-01b trigger gating (mobile→click, desktop→hover, props spread) — mock `useBreakpoint`.
- [ ] EquityChart touch-path test — covers CHART-01b `pointerToIndex`/tap-pin parity with hoverIdx (extract `pointerToIndex` as a pure fn for unit testability, or test via mount with synthetic pointer events).
- [ ] `e2e/axe-app-wide.spec.ts` — covers A11Y-01 route × viewport matrix (+ `HAS_SEED_ENV` const; + ci.yml dual-wire BOTH lists).
- [ ] `lighthouserc.json` + `lighthouse-mobile` CI job — covers A11Y-03 (seed thresholds from baseline; mobile preset; public routes).
- [ ] Rotate-stability assertion folded into an existing mobile e2e — covers A11Y-03 SC#4.
- [ ] `target-size.spec.ts` extension — EquityChart tap-rect ≥44px @ 320px coarse on /allocations (reuse the Phase-47 `test.use({hasTouch,isMobile})` coarse-emulation idiom).
- [ ] Framework install: `npm install --save-dev @lhci/cli@0.15.1`.

## Security Domain

> `security_enforcement` absent in config → treated as enabled. This phase is presentation + CI scaffolding over a frozen engine with **no auth/session/access-control/input/crypto surface**. ASVS applicability is therefore minimal.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth code touched. Seeded e2e reuses existing `seedTestAllocator`/`loginViaForm` helpers. |
| V3 Session Management | no | No session code touched. |
| V4 Access Control | no | No access-control code; charts read precomputed payloads. |
| V5 Input Validation | no (n/a) | No new user input. Tooltip values are precomputed; `formatter` unchanged. |
| V6 Cryptography | no | None. lhci uploads to temporary-public-storage (public routes only; no secrets, no tokens). |
| V14 Configuration (supply chain) | yes | One new devDep (`@lhci/cli`) — verified legitimate (GoogleChrome org, no postinstall). Pin the version. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Slopsquatted devDep | Tampering | Pin `@lhci/cli@0.15.1`; verified org + no postinstall (Package Legitimacy Audit). |
| lhci leaking authed/sensitive data to temporary-public-storage | Information disclosure | PUBLIC routes only (locked); no authed URLs in `lighthouserc.json` `url`. |
| CI secrets exposure via the new job | Information disclosure | lhci needs NO secret (public routes, temporary-public-storage). Do not pass `TEST_SUPABASE_*` to the lighthouse-mobile job. |

## Sources

### Primary (HIGH confidence)
- `node_modules/recharts/types/component/Tooltip.d.ts` (L78 defaultIndex, L168-175 trigger doc-comment, L207 default hover) + `node_modules/recharts/types/chart/types.d.ts:3` (TooltipTrigger) — the authoritative installed-version API.
- `node_modules/recharts/package.json` — version 3.8.1.
- `node_modules/next/package.json` (16.2.9) + `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md` (next build/start, .next/dev L60, port L121).
- Live source: `src/hooks/useTapPin.ts`, `src/hooks/useBreakpoint.ts`, `src/hooks/useMediaQuery.ts`, `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx`, `src/components/charts/chart-tokens.ts`, all 19 recharts files.
- Live tests/CI: `tests/visual/chart-accessibility-layer.test.ts`, `tests/visual/viewport-zoom-meta.test.ts`, `src/__tests__/phase-31-frozen-spine-guards.test.ts`, `e2e/helpers/axe.ts`, `e2e/helpers/reflow.ts`, `e2e/composer-axe.spec.ts`, `e2e/target-size.spec.ts`, `e2e/reflow-sweep.spec.ts`, `.github/workflows/ci.yml`, `playwright.config.ts`, `vitest.config.ts`.
- `npm view @lhci/cli` (version 0.15.1, repository, maintainers, no postinstall).

### Secondary (MEDIUM confidence)
- github.com/GoogleChrome/lighthouse-ci/docs/configuration.md (fetched 2026-06-28) — lighthouserc.json collect/assert/upload schema, mobile preset, error-level assertions.

### Tertiary (LOW confidence)
- None — all load-bearing claims verified against installed types, live source, or official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified in node_modules; Recharts API verified against installed types; @lhci/cli verified on npm.
- Architecture: HIGH — wiring paths traced against live source (EquityChart line numbers, hook signatures, CI list anchors, axe filter precedent).
- Pitfalls: HIGH — each grounded in a verified source artifact (SSR snapshot, grep regex, CI dual-wire comment, Next build dir).
- lhci config: MEDIUM — schema from official docs (not installed types); the exact `minScore` is by-design a baseline-seeded placeholder.

**Research date:** 2026-06-28
**Valid until:** 2026-07-28 (stable; Recharts/Next pinned, @lhci/cli mature line). Re-verify @lhci/cli version + lighthouserc schema if more than ~30 days elapse before execution.
