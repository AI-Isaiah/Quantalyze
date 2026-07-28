---
phase: 54
slug: verification-v1-3-debt-cleanup-visual-regression-replacement
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-30
---

# Phase 54 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> This phase IS verification — the requirements install the gates. The map below ties each
> requirement to the gate that proves it.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `@playwright/test` 1.61.1 (e2e gates) + `vitest` ^4.1.2 (guard / byte-identity / drift unit tests) |
| **Config file** | `playwright.config.ts` (single chromium, en-US/UTC/light pinned); `vitest.config.ts` (coverage ratchet = BLOCKING gate); `lighthouserc.json`; `eslint.config.mjs` |
| **Quick run command** | `npx eslint "src/**/*.{ts,tsx}"` (BP-03 lint flip proof — expect 0 errors) |
| **Full suite command** | `npx vitest run` (coverage ratchet is the blocking `frontend` gate) |
| **Estimated runtime** | ~90s vitest full; eslint ~20s; e2e seeded list CI-only |

---

## Sampling Rate

- **After every task commit:** the touched unit guard (`phase-52-frozen-spine-guards` for any chart-adjacent edit; `design-token-drift` for any `@theme` edit) + `npx eslint` on touched files.
- **After every plan wave:** full `npx vitest run` + `npx eslint "src/**/*.{ts,tsx}"`.
- **Before `/gsd:verify-work`:** full unit suite green + lint 0 errors + (in a configured CI) MA-8 seeded e2e green-or-skip + lhci green at the new floor.
- **Max feedback latency:** ~90 seconds (vitest full suite).

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command / Gate | File Exists |
|-----|----------|-----------|--------------------------|-------------|
| VERIFY-01 | 2560 row green app-wide (axe + reflow) | e2e seeded+unseeded | MA-8 list + unseeded playwright list; add 2560 to `axe-app-wide.spec.ts:92` VIEWPORTS + reflow route lists | ✅ host specs exist |
| VERIFY-01 | svg goldens at 2560 + deferred P52 canaries | e2e screenshot | `svg-chart-parity.spec.ts` (WR-02 green-by-skip) | ✅ spec exists; bake deferred |
| VERIFY-02 | authed + mobile axe rows hermetic | e2e seeded | un-skip authed/embedded describes (`axe-app-wide.spec.ts:123,:236`) + add to MA-8 list + teardown the crypto-sma discovery seed (`:187`) | ✅ describes exist, dormant |
| VERIFY-03 | lhci minScore raised | CI config | `lhci autorun`; re-measure from `.lighthouseci/*.json` artifact → `minScore = floor − 0.02` | ✅ config + job exist |
| VERIFY-03 | no-clip guard | e2e seeded+unseeded | **new** `e2e/no-clip-sweep.spec.ts` (runtime scrollWidth>clientWidth + text-overflow) | ❌ Wave 0 — dual-wire FLOW-01 |
| VERIFY-04 | tolerance goldens replace byte-identity | e2e screenshot (pending bake) | `svg-chart-parity.spec.ts` + tolerance specs (WR-02 guard) | ✅ pattern exists; bake deferred |
| VERIFY-05 | app-wide design-review audit | skill / manual | gsd-ui-review / design-review (runs now) | N/A (audit artifact) |
| VERIFY-05 | real-device authed sign-off | human checkpoint | `human_needed` VERIFICATION.md item | N/A (deferred — no device/network) |
| VERIFY-05 | RT-W2 admin width caps | unit (static source-scan) | **new** `admin-width.test.tsx` (Phase-38 `composer-width.test.tsx` idiom) | ❌ Wave 0 — static scan, NOT jsdom render |
| BP-03 | no-raw-font-px error repo-wide (except documented frozen-chart off-islands) | lint | `npx eslint` 0 errors | ✅ rule+config exist; flip + off-globs needed |
| BP-03 | scenario.ts/FactsheetBody byte-equivalent | unit | `phase-52-frozen-spine-guards.test.ts` + FactsheetBody GUARD-02 innerHTML test — must stay GREEN | ✅ guards exist |
| BP-03 | token-drift not broken by fixed alias | unit | `tests/a11y/design-token-drift.test.ts` — reconcile new `--text-fixed-*` | ✅ must reconcile |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky — planner/executor stamps per task.*

---

## Wave 0 Requirements

- [ ] `e2e/no-clip-sweep.spec.ts` — VERIFY-03 no-clip; dual-wire FLOW-01 (ci.yml unseeded list + seeded MA-8 list + `HAS_SEED_ENV` const for the authed half).
- [ ] `src/__tests__/admin-width.test.tsx` (or co-located) — VERIFY-05 RT-W2; static source-scan, NOT jsdom render (jsdom layout pitfall).
- [ ] `--text-fixed-10` / `--text-fixed-11` fixed tokens in `globals.css` `@theme` + reconcile `design-token-drift.test.ts`.
- [ ] No new framework install — Playwright / vitest / lhci all present.
- [ ] Golden PNGs deliberately NOT baked in Wave 0 (locked decision) — WR-02 guard keeps green-by-skip.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-device authed sign-off | VERIFY-05 | No real device + no Bash network in this sandbox | Human loads authed surfaces on a physical phone/tablet, confirms no clip/reflow/a11y regressions vs the matrix |
| Live golden PNG bake | VERIFY-04 / VERIFY-01 | Needs seeded authed render; never blind `--update-snapshots` | Controlled CI run bakes per-chart goldens deliberately, one chart at a time, reviewing each diff |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (no-clip spec, admin-width test, fixed tokens)
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter (planner/auditor flips when map is complete)

**Approval:** pending
