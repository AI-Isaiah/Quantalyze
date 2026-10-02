---
phase: 43
slug: edge-states-toggle-fold-guards
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
---

# Phase 43 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (jsdom) + @testing-library/react; Playwright + axe for the composer e2e |
| **Config** | `vitest.config.ts` (lines 82 / fns 74 / branches 72 / stmts 80); `e2e/composer-axe.spec.ts` (ci.yml:1261, HAS_SEED_ENV-gated) |
| **Quick** | `npx vitest run "src/app/factsheet/[id]/v2/" "src/app/(dashboard)/allocations/" --no-file-parallelism` |
| **Full** | `npm run test:coverage` |
| **e2e** | the composer-axe playwright spec (CI) |

## Sampling Rate
- Per task: quick command on touched dirs. Per wave: full suite + coverage ratchet. Before verify: full suite green + `tsc` + frozen-spine guards green + (CI) the axe e2e.

## Per-Task Verification Map

| Task | Req | Test | Command |
|------|-----|------|---------|
| toggle fold + edge-state cross-check | GUARD-01 | unit (render on the composed surface) | quick |
| polish carry-forwards (footer gate, seam, badge token, risk-reducing token, leverage guard, @theme token, h3) | GUARD-01 | unit (render) + byte-identity (footer default-false) | quick |
| permanent byte-identity gate | GUARD-02 | unit — FactsheetBody default ≡ scenarioMode=false (innerHTML) + Overview/page.tsx untouched | quick |
| composer-axe extension | GUARD-03 | e2e (axe WCAG-AA serious+critical = 0 on the composed surface) | playwright (CI) |
| no cross-tab bleed | GUARD-04 | unit — spy localStorage.setItem / history.replaceState scoped to factsheet-v2:/URL keyspace → 0 writes | quick |

## Wave 0 Requirements
- [ ] GUARD-02 permanent byte-identity test (promote the P40 FactsheetBody.scenario-mode test + add Overview-untouched import-shape assertion).
- [ ] GUARD-04 cross-tab-bleed spy test (scoped to factsheet-v2:/URL — NOT the legitimate `composer-collapse:controls` key).
- [ ] GUARD-03 axe-spec extension (new `#factsheet-main` + Diversification/Peer/Mandate anchors; "real OR honest-empty banner" idiom).
- [ ] GUARD-01 edge-state cross-check (the assembled-surface degenerate matrix: 0/1 constituent, n<10, n<252, no own-book, no mandate).

## Manual-Only
| Behavior | Why | Note |
|----------|-----|------|
| Authed live composed surface feel | needs authed Chromium | the CI axe e2e proves a11y structure; visual feel is a post-deploy authed canary |

## Landmines (RESEARCH)
- ⛔ scenario.ts FROZEN (frozen-spine guards zero-diff). ⛔ No `FactsheetBody` literal in ScenarioComposer.tsx (static guard :51-53 in ScenarioFactsheetChart). ⛔ `border-text`/`text-text-2` fix = `@theme` token formalization, NOT class repointing (repointing a live factsheet class breaks byte-identity). ⛔ The footer scenarioMode-gate must be additive (default false → byte-identical, GUARD-02 pins it). ⛔ GUARD-04 spy must scope to factsheet-v2:/URL (the `composer-collapse:controls` key is legitimate).
