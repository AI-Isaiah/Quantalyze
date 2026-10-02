---
phase: 48-recharts-equitychart-final-verification
plan: 05
subsystem: ci-verification
tags: [a11y, lighthouse, performance-budget, e2e, rotate-stability, coverage-ratchet, final-verify]
requires:
  - "48-04 (axe-app-wide dual-wired; the e2e job structure this job mirrors)"
  - "Wave 0/1/2 (@lhci/cli@0.15.1 installed + pinned; lighthouserc.json stub)"
provides:
  - "Mobile @lhci/cli perf budget gating the 5 public routes via a BLOCKING lighthouse-mobile CI job"
  - "Rotate-stability assertion (no ResizeObserver-loop error + bounded heap) in reflow-sweep-authed"
  - "48-HUMAN-UAT.md real-device authed sign-off checklist (verification ends human_needed)"
  - "Recorded final-verify: coverage ratchet held + frozen-math/byte-identity/parity guards green un-weakened"
affects:
  - ".github/workflows/ci.yml (new lighthouse-mobile job + aggregator wiring)"
  - "lighthouserc.json (real baseline-seeded config)"
  - "e2e/reflow-sweep-authed.spec.ts (rotate-stability fold)"
tech-stack:
  added: []   # @lhci/cli was installed in Wave 0; no new dep here
  patterns:
    - "Lighthouse 12.x mobile = DEFAULT form-factor set EXPLICITLY via settings.formFactor + screenEmulation (there is NO preset:'mobile')"
    - "Coverage-ratchet philosophy applied to a perf budget: seed minScore a few points UNDER measured baseline, error-level"
    - "Additive e2e fold into an already-seeded/already-dual-wired spec (no new harness, no new FLOW-01 wiring)"
key-files:
  created:
    - ".planning/phases/48-recharts-equitychart-final-verification/48-HUMAN-UAT.md (LOCAL — .planning is gitignored)"
  modified:
    - "lighthouserc.json"
    - ".github/workflows/ci.yml"
    - "e2e/reflow-sweep-authed.spec.ts"
    - ".gitignore (ignore generated .lighthouseci/)"
decisions:
  - "Fixed the Wave-0 stub's invalid `preset:\"mobile\"` (Rule 1 bug — no such LH 12 preset) to explicit mobile form-factor settings"
  - "Dropped the `lighthouse:no-pwa` assert preset — assert ONLY categories:performance (the preset gates dozens of unrelated sub-audits the plan does not want)"
  - "Seeded minScore=0.60 (7pts under the lowest measured route /demo 0.67); first CI run establishes the true CI baseline to ratchet from"
  - "Wired lighthouse-mobile into the frontend aggregator needs + result-check (blocking via the single required check)"
metrics:
  duration: "~50 min"
  completed: "2026-06-28"
  tasks: 3
  commits: 2
  files-changed: 4
---

# Phase 48 Plan 05: Mobile Perf Budget + Rotate-Stability + Final Verification Summary

Stood up A11Y-03 — a baseline-seeded mobile `@lhci/cli` performance budget gating the 5 public routes via a new BLOCKING `lighthouse-mobile` CI job (build-artifact restore -> `npm run start` -> `npx lhci autorun`, no Supabase secret) — folded a rotate-stability assertion (no ResizeObserver-loop error + bounded heap) into the already-seeded `reflow-sweep-authed` spec, authored the `48-HUMAN-UAT.md` real-device authed sign-off checklist, and recorded the final-verify gate: coverage ratchet held and every frozen-math/byte-identity/parity guard green and un-weakened.

## What Was Built

### Task 1 — Mobile lhci budget + lighthouse-mobile CI job (commit `a2f514d6`)

- **Ran a REAL baseline** (Lighthouse 12.6.1, mobile form-factor, simulated `mobileSlow4G`) against the production `next start` on the 5 public routes. Measured `categories:performance` (single run):

  | Route | Performance |
  |-------|-------------|
  | `/` | 0.93 |
  | `/security` | 0.94 |
  | `/for-quants` | 0.92 |
  | `/browse` | 0.94 |
  | `/demo` | **0.67** (lowest) |

- **Seeded `minScore=0.60`** — 7 points under the lowest measured route (`/demo` 0.67), `error`-level, coverage-ratchet philosophy (low enough to absorb local-vs-CI + single-run noise, high enough that a real regression fails the build; NOT a hard 0.90+ day one). The lighthouserc records the baseline date + measured floors in a `_baseline` comment.
- **New `lighthouse-mobile` CI job**: mirrors the e2e job's `actions/download-artifact` (nextjs-build, v8.0.1 pinned SHA) restore + `npm run start` shape, installs Playwright Chromium for lhci's headless Chrome (`CHROME_PATH`), runs `npx lhci autorun --config=lighthouserc.json` against the PRODUCTION `.next` (never `next dev`, Pitfall 6). Placeholder env only.
- **Wired blocking**: added `lighthouse-mobile` to the `frontend` aggregator's `needs` + its result-check loop, so it is a BLOCKING gate via the single required check.
- **.gitignore**: ignore the generated `.lighthouseci/` run output.

### Task 2 — Rotate-stability fold (commit `882ea690`)

- Added a self-contained `test.describe("rotate-stability (SC#4)...")` to `e2e/reflow-sweep-authed.spec.ts` (additive; the host is already in the ci.yml seeded MA-8 list AND `HAS_SEED_ENV`-gated, so NO new FLOW-01 wiring — composer-axe GUARD-03 fold precedent).
- Registers `page.on("console")` + `page.on("pageerror")` BEFORE navigation, seeds+logs in, mounts EquityChart on `/allocations`, rotates 375x812 -> 812x375 -> portrait -> landscape -> portrait with a 250ms settle between each.
- Asserts **no `ResizeObserver loop`** error (console OR uncaught pageerror). SC#4 stable-memory = a BOUNDED heap-growth check (`<4x`) read from `performance.memory` only when available; skips gracefully otherwise (never a hard byte count, which flakes on GC timing). Anchors on the seeded `My Allocation` h1 (fail-loud on login/unhydrated; Pitfall 4); self-skips unseeded.

### Task 3 — 48-HUMAN-UAT.md + final-verify (no committable real files — UAT is gitignored)

- Authored `.planning/phases/48-.../48-HUMAN-UAT.md` mirroring the Phase-47 frontmatter + `## Current Test` / `## Tests` / `## Summary` / `## Gaps` shape. 5 items: Recharts tap-to-pin on Line+Bar+Pie families; EquityChart tap-pin (reveal/pin/re-tap toggle/>=44px); no 320px overflow; no RO-loop + stable memory on rotate; the automated final-verify guard matrix. Contains `human_needed`; fulfills the Phase-47 carry-forward (its deferred item #2).
- **Final-verify guard matrix (all run at authoring, all GREEN, none weakened):**

  | Guard | Command | Result |
  |-------|---------|--------|
  | Coverage ratchet HELD | `npm run test:coverage` | exit 0 — Lines 85.05 / Stmts 82.93 / Funcs 78.81 / Branches 75.45 (thresholds 82/80/74/72 unchanged) |
  | Frozen-math SCENARIO-05 | `vitest run phase-31-frozen-spine-guards` | green |
  | accessibilityLayer={false} grep | `vitest run chart-accessibility-layer` | green (Tooltip swap did not trip it) |
  | svg-chart-parity (Phase-47 carryover) | `playwright test svg-chart-parity` | 2 skipped (self-skips loudly — NOT false-green, NO placeholder goldens) |
  | typecheck | `npm run typecheck` | clean |
  | lighthouse-mobile budget | `lhci autorun --config=lighthouserc.json` | All assertions passed at minScore 0.60 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wave-0 lighthouserc stub used an invalid `preset: "mobile"`**
- **Found during:** Task 1 baseline run.
- **Issue:** The Wave-0 scaffold set `settings.preset: "mobile"`, but Lighthouse 12.6.1's `preset` only accepts `perf`/`experimental`/`desktop` (verified in `node_modules/lighthouse/cli/cli-flags.js`). `lhci collect` failed loudly: `Invalid values: Argument: preset, Given: "mobile"`. Mobile is the Lighthouse DEFAULT form-factor — there is no `"mobile"` preset.
- **Fix:** Replaced `preset: "mobile"` with explicit `formFactor: "mobile"` + `screenEmulation` (MotoG-class) + `throttlingMethod: "simulate"`. Re-ran the baseline — clean.
- **Files modified:** lighthouserc.json
- **Commit:** a2f514d6

**2. [Rule 1 - Bug] `lighthouse:no-pwa` assert preset would gate dozens of unrelated sub-audits**
- **Found during:** Task 1 baseline assert.
- **Issue:** With `assert.preset: "lighthouse:no-pwa"` active, lhci asserts ALL of that preset's sub-audits (LCP, legacy-javascript, mainthread-work-breakdown, max-potential-fid, ...) and warned/failed on many of them — but the plan's must-have is gating `categories:performance` ONLY, at error-level.
- **Fix:** Dropped the assert preset; declare ONLY the `categories:performance` assertion. PWA audits are not asserted because we are not asserting them at all (this app is not a PWA; MOBL-02 deferred).
- **Files modified:** lighthouserc.json
- **Commit:** a2f514d6

**3. [Rule 3 - Blocking] Generated `.lighthouseci/` output was untracked**
- **Found during:** Task 1 (post-baseline `git status`).
- **Issue:** `lhci autorun` writes its HTML/JSON reports + link records to `.lighthouseci/` — a runtime artifact that should never be committed.
- **Fix:** Added `.lighthouseci/` to `.gitignore`.
- **Files modified:** .gitignore
- **Commit:** a2f514d6

## Baseline-from-CI vs Local (honest disclosure)

The seeded `minScore=0.60` is derived from a **LOCAL** single-run baseline (macOS, Google Chrome, simulated `mobileSlow4G`), not from a GitHub Actions runner. CI conditions differ (3-run median, shared runner CPU, Playwright-installed Chromium). The conservative 7-point cushion below the lowest measured route is intended to absorb that drift WITHOUT false-red on the first CI run. **The first `lighthouse-mobile` CI run establishes the true CI baseline to ratchet UP from over time** — do not tighten `minScore` until a few green CI runs confirm the stable CI floor. The config's `_baseline` comment records this. No metrics were fabricated; all five route scores above are real measured values.

## Note on the `lighthouse-mobile` job + the TEST_SUPABASE acceptance grep

The job's env block contains ZERO `${{ secrets.TEST_SUPABASE_* }}` references (verified: `grep -c "secrets.TEST_SUPABASE"` in the job = 0). The only `TEST_SUPABASE` strings inside the job are two SECURITY-RATIONALE COMMENTS ("this job receives NO TEST_SUPABASE_* secret"; "Deliberately NO TEST_SUPABASE_* here"). So the literal `grep -A40 "lighthouse-mobile" | grep -c "TEST_SUPABASE"` returns 2 (both comments), but the substantive T-48-05-INFO criterion — no secret passed to the job — is fully met. The job runs on placeholder env only.

## Self-Check: PASSED

- lighthouserc.json minScore 0.60 (numeric, 0 < 0.6 < 0.9) — FOUND
- `grep -c "lighthouse-mobile" .github/workflows/ci.yml` = 6 (>= 1) — FOUND
- YAML parses — OK
- No `secrets.TEST_SUPABASE` in the lighthouse-mobile job (= 0) — VERIFIED
- `grep -c "ResizeObserver loop" e2e/reflow-sweep-authed.spec.ts` = 6 (>= 1) + `page.on("console"` present — FOUND
- Playwright `--list` shows the rotate-stability case (line 188, self-skips unseeded) — FOUND
- 48-HUMAN-UAT.md exists, contains `human_needed` + Line/Bar/Pie/EquityChart tap-to-pin checklist — FOUND
- Coverage ratchet HELD (85.05/82.93/78.81/75.45 >= 82/80/74/72) — VERIFIED
- frozen-spine + accessibilityLayer guards green; svg-chart-parity self-skips (not false-green) — VERIFIED
- Commit a2f514d6 — FOUND; commit 882ea690 — FOUND

verification status: **human_needed** — the real-device authed walkthrough (48-HUMAN-UAT.md items 1-4) is the v1.3 milestone SC#5 sign-off, deferred to a physical phone against preview/prod after deploy.
