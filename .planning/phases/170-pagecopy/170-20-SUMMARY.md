---
phase: 170-pagecopy
plan: 20
status: complete
gap_closure: true
requirements: [GC-03]
commits: 1
plan_head_after: 11ac37bbf
---

# 170-20 SUMMARY — re-bake the 320px portrait goldens (GC-03)

Executed by the orchestrator on 2026-10-01, after the founder's go (2026-09-30) for the extra bake CI run.

## Task 1 — bake
- Final head pushed before the bake: `cdd7c3b1a` (gap waves 1 and 2 merged). Its e2e-seeded run (CI run 36778853204, job 110103934390) passed every layout row: 198 passed, 1 failed, 11 skipped; the one failure was `streak-distribution-portrait-320` (288x184 received vs 288x185 golden). No `LAYOUT-NARROW-OFFENDER` line was printed.
- Bake: `gh workflow run CI --ref feat/170-layout -f bake_svg_goldens=true` → run 36782013496 on `cdd7c3b1a`. e2e-seeded succeeded and uploaded `svg-chart-goldens-baked` (29 PNGs). The run's only red job is `secret-scan`, the known full-history gitleaks trap on a dispatch run; a range scan of this branch's new commits (`gitleaks git . --log-opts=origin/feat/170-layout..HEAD`) reports no leaks.

## Task 2 — review and commit
- `cmp` of all 29 baked PNGs against the committed goldens: 25 byte-identical (every desktop, ultrawide and per-panel golden), 4 changed, all portrait-320:

| golden | old | new | review |
|---|---|---|---|
| bootstrap-ci | 288x48 | 288x49 | same content, 1 px vertical shift |
| correlation-strip | 288x83 | 288x82 | same content, 1 px vertical shift |
| quantile-box-plot | 288x67 | 288x66 | same content, 1 px vertical shift |
| streak-distribution | 288x185 | 288x184 | same content, 1 px vertical shift |

  Each pair was rendered side by side and viewed: identical bars, boxes, labels and values. The shift comes from the 170-11..13 factsheet changes above the charts (sub-pixel layout), not from chart code. No desktop or ultrawide golden changed, so the plan's stop condition did not fire.
- Commit `11ac37bbf` (`test(170-20)`) contains exactly those 4 PNGs. Post-commit check (bound to the test(170-20) commit): `total=4 bad=0`, exit 0.

## Deviations
- Executed directly by the orchestrator rather than a dispatched executor: the plan is a non-autonomous bake-and-review whose decisions (the go, the side-by-side review) are the orchestrator's.
- The plan anticipated the streak-distribution golden only; three more portrait-320 goldens had drifted by 1 px within the parity spec's tolerance and were re-baked together so the set matches the head.

## Self-Check: PASSED
