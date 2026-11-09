---
status: awaiting_human_verify
trigger: "PR #1225 run 42527025928 job 128873174958 e2e-seeded: layout-narrow.spec.ts MYSTRATTABLE wide V1100 (CAGR/Sharpe probe did not run, W-02) and SC6-DISCOVERY unpinned V360/V375/V390/V768 (metric never fully visible and uncovered at scrollLeft 0/60/150/300/max)"
created: 2026-11-09
updated: 2026-11-09
---

## Current Focus

bug_class: Bohrbug (deterministic, same reading on every retry, 3/3 attempts identical)
hypothesis: the two probes sample fixed scroll stops 0/60/150/300/max; Phase 197's Track column (~152 px, U-02, right after Strategy) and the two-line metric headers (114 px each, "Full record" unit nowrap) move CAGR/Sharpe so their visible window lies wholly between stop 300 and max. No metric is covered; the probe never looks at it.
reasoning_checkpoint:
  hypothesis: "fixed stops miss the CAGR/Sharpe visibility windows because 197 widened the columns before them (by UI-SPEC design), not because anything covers them"
  confirming_evidence:
    - "a window model built from CI-measured header edges predicts exactly the failing (metric, viewport) pairs: V360 CAGR+Sharpe, V375/V390/V768 Sharpe only, V1080 none; MYSTR V1100 CAGR+Sharpe unprobed, Return probed"
    - "main run 42524694504 vs PR: manager stack W+Actions = 907.7 vs 908 px, Status/Created X-1 offsets identical (72/204): the pinned stack did not change; only the columns after it widened"
    - "main MYSTR V1100 occlusion probes=24 is reproduced by the same model with W in [503,563); PR V1280 probes=24 gives W in [530,568)"
  falsification_test: "with a stop per metric column (column left at the pinned edge) the cells must be fully visible and hit; if any is covered or does not fit, the probe stays red"
  fix_rationale: "the contracts are existential/universal over scroll positions; the stop set is a sampling choice. Adding a derived stop per metric column (superset of the old stops) makes the probe look where each column sits beside the pinned edge, keeping every per-sample condition unchanged"
  blind_spots: "not reproduced on the seeded lane locally unless booted; product geometry is inferred from CI logs"
  candidate_causes:
    - "code (product): Track column / header widths too wide -> rejected: widths are UI-SPEC-mandated (U-02, nowrap units) and the 197 UI-SPEC dismisses table width as unchanged mechanism"
    - "code (test): fixed sampling stops stale against the new column offsets -> confirmed"
    - "data: seeded rows differ -> rejected: identical seed helper, failures are geometric, not data"
  and_gate: "yes: needs both the wider pre-metric columns (197) AND a narrow room beside the pin (V1100 manager ~224 px, phones ~205-320 px); V1280 / V1080 pass"

## Symptoms

expected: layout-narrow MYSTRATTABLE wide V1100 and SC6-DISCOVERY unpinned pass, as on main
actual: see trigger; deterministic on all three attempts
errors: "CAGR row N never had a visible interval of 4 px or more at scrollLeft 0/60/150/300/1638 — the probe did not run (W-02)"; "Sharpe row N is never fully visible and uncovered at scrollLeft 0/60/150/300/1281 (container 326 px)"
reproduction: CI e2e-seeded on feat/197-screen
started: Phase 197 (plan 01 headers + Track column)

## Eliminated

- hypothesis: the pinned stack grew (stale chip / shared-account line / select column)
  evidence: W+Actions 907.7 (main) vs 908 (PR); P-2/P-3 passed; /strategies is not selectable
  timestamp: 2026-11-09

## Evidence

- timestamp: 2026-11-09
  checked: PR log vs main log 42524694504 header edges
  found: discovery metric columns 86.5/95/88.3 px on main -> 114.1 px each; new Track 151.9 px before Return; scrollWidth V360 1080 -> 1607
  implication: metric columns now sit 400-750 px into the table; stops 0/60/150/300 cannot reach them at narrow rooms

## Resolution

root_cause: fixed sampling stops in assertPinnedStackDoesNotCover (e2e/helpers/geometry.ts) and the inline "metrics reachable" probe (e2e/layout-narrow.spec.ts) went stale when Phase 197 widened the columns ahead of CAGR/Sharpe
fix: add, per metric column, the stop that puts the column's left edge at the pinned column's stuck right edge (old stops kept)
verification: "harness (synthetic table at the CI-measured widths, real chromium): old helper reproduces the V1100 W-02 failure, new passes (stops +424/540/656); old inline probe misses CAGR/Sharpe at 326-442 px, new misses none; an overlay right of the pin turns both new probes red. tsc 0, lint 0 errors, vitest src/components/strategy 1406/1406. Seeded lane NOT run locally; CI e2e-seeded is the confirming run. Commit 0095510ce."
files_changed: [e2e/helpers/geometry.ts, e2e/layout-narrow.spec.ts]
