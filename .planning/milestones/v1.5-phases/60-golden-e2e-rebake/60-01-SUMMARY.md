---
phase: 60-golden-e2e-rebake
plan: 01
subsystem: scenario-blend-qa
tags: [golden-bake, e2e, seeded-axe, VERIFY-01]
requires:
  - "Phase 55 BLEND-07 numpy artifact + Phase 56 parity green"
provides:
  - "60-VERIFY-01-EVIDENCE.md (no-op-bake disposition with proof)"
  - "unconditional Phase-58 composer-axe anchors on a deterministic seed"
requirements-completed: [VERIFY-01]
---

# Summary 60-01 — Phase-58 e2e net restored + VERIFY-01 evidence

Status: DONE (CI proof gate satisfied — seeded e2e PASSED on #567 round 4, all 19 checks green)

- `seedStrategyWithHistory` gained opt-in `withDailyReturns` → writes
  deterministic `strategy_analytics.daily_returns` (the exact column the
  composer's lazy `GET /api/strategies/[id]/returns` serves). Opt-in keeps the
  svg-chart-parity / strategy-v2 golden fixtures byte-identical.
- `composer-axe.spec.ts` seeds with it; the ced581e0 conditional block is
  gone — anchors (d) blend header + (e) timeline expand are UNCONDITIONAL
  again, plus a new pin that `scenario-coverage-window-value` shows a real
  derived `YYYY-MM-DD → YYYY-MM-DD` range (WINDOW-01 default, not the
  "All history" fallback). Stale "not guaranteed non-degenerate" comments
  rewritten to the deterministic contract.
- `60-VERIFY-01-EVIDENCE.md` records the no-op-bake disposition with proof
  (no golden renders the blend; zero snapshot commits in all of v1.5 —
  verified `git log --stat 221a6daa^..c6cb4cae -- 'e2e/*-snapshots'` empty;
  e2e green on #565/#566/main run 28590250701; byte-compat legacy path
  explains it by construction).
- Deliberately NOT done: any `--update-snapshots` run; a NEW scenario-blend
  screenshot golden (deferred as new coverage, noted in evidence).

Verification: tsc --noEmit clean; eslint clean on both touched files; no
src/ diffs; no snapshot diffs. Full-suite vitest unchanged from main (no
frontend code touched) — /ship pre-flight re-runs it regardless.
