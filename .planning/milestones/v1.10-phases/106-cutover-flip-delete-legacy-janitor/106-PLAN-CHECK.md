# Phase 106 — Pre-Execution Plan Check

**Checker:** gsd-plan-checker (opus) · **Date:** 2026-07-14
**Plans:** 106-01 … 106-10 (5 Stage-A + 5 Stage-B) · **Requirement:** BB-03

## OVERALL VERDICT: PASS-WITH-FLAGS

No BLOCKERs. The reversibility split is airtight, the D4 zombie-order is faithfully
sequenced across waves, both enqueue overloads are guarded, and file-ownership is
conflict-free within every wave. Two low-severity WARNINGs (scope/file-count budget and
one incomplete `files_modified` declaration) and one mitigated observation on the manual
SC-4 gate. Execution may proceed; the WARNINGs are quality notes, not gates.

---

## Per-check findings

### 1. Stage-B gating airtight — PASS
All five Stage-B plans carry `stage: B` + `gated: true` in frontmatter AND the first-line
`**STAGE B — GATED, DO NOT AUTO-EXECUTE.**` objective banner:
- 106-06 fm:5-6, banner :34 · 106-07 fm:5-6, banner :42 · 106-08 fm:5-6, banner :44
- 106-09 fm:5-6, banner :38 · 106-10 fm:5-6, banner :45
Each also carries an explicit `gated_on:` precondition string (user go + 106-05 approval +
empirical prod re-query). Stage-A plans 01-05 are `stage: A`. No deletion plan can
auto-execute.

### 2. Zombie-trap deletion ORDER (D4) — PASS
Locked CONTEXT-D4 order is honored by the wave graph, not just prose:
- Re-entry #3 `legacyKeysSyncHandler` → 106-07 (wave 4), BEFORE the core.
- #1 phase12 + both funding ternaries (job_worker :1519 AND cron.py :450 — the 5th live
  site) → 106-08 task 1 (wave 5); constant deleted last once grep shows zero readers.
- #4 HTTP route + dispatch arm + `run_compute_analytics_job` handler (which is
  `run_strategy_analytics`'s 2nd caller at job_worker :1607) → 106-08 task 2.
- Chain `run_strategy_analytics` (analytics_runner:1208) deleted ONLY in 106-09 (wave 6),
  behind a MANDATORY pre-delete `git grep` gate (106-09 task 2) that STOPs on any stray
  caller. Verified against source: today's only two prod callers are
  `routers/analytics.py:24` and `job_worker.py:1605-1607` — both retired in 106-08 before
  106-09 runs. `run_csv_strategy_analytics` (analytics_runner:2124) is the KEEP and is not
  a substring of the deleted name. Order faithful; no target deleted before its re-entry.

### 3. SC-4 byte-identity gate empirical — PASS (one mitigated observation)
106-05 enumerates a concrete 12-point live surface (8 basis×connector cells + teaser +
allocator per-key + resync-emits-no-`compute_analytics`-row + janitor 200), each
dispositioned PASS/FAIL and appended to 106-RATIFICATION.md; any FAIL blocks Stage B.
Observation (not a flag): the check is human visual/numeric parity to displayed precision,
not a literal byte-diff oracle. This is acceptable because (a) the flip is a ratification —
Stage A deletes nothing, so SC-4 is untouched by construction there; and (b) the automated
SC-4 guarantee for the Stage-B deletions lives in the "unified-arm tests pass UNCHANGED"
per-file evidence (106-07/08) and the preserved `test_cash_basis_series_sc4.py` count
invariant (106-09). Gate is not hand-wavy.

### 4. D3 RPC guard covers BOTH overloads — PASS
106-06 CREATE-OR-REPLACEs the 7-param (`20260510180226:164`) AND 10-param
(`20260420073003:330`) bodies — both files confirmed to define `_enqueue_compute_job_internal`.
Reject idiom is exactly `RAISE EXCEPTION '…compute_analytics is retired…' USING ERRCODE =
'invalid_parameter_value'` inserted after each NULL guard (interfaces block :79-83).
Self-verifying DO block asserts both `pg_get_functiondef`s contain the reject AND that the
CHECK still admits the kind; shape-grep verify requires 2× CREATE OR REPLACE and ≥4×
retirement literal. No admission bypass.

### 5. M2 ordering (D5) — PASS
106-02 moves the DONE-gating `metrics_json_by_basis` prestamp block to AFTER both
`persist_basis_series` writes (MTM :3188-3201, cash :3268-3275) and BEFORE the enqueue,
mirroring the composite seam :4735-4782. Fixes the stale `:4747` cross-ref; verify greps
that `:3112-3136` no longer appears. It edits only the single-key seam + the composite
COMMENT — it does NOT re-introduce the heal M1 removed from the composite F-5 arm (no code
change to the composite arm). sc4 2-persist count invariant explicitly preserved.

### 6. File-disjointness within waves — PASS
- Wave 2 (02/03/04): job_worker.py | cron.py+janitor proxy+vercel.json | csv-finalize —
  fully disjoint.
- Wave 4 (06/07): supabase migration/test | TS routes — disjoint.
- Waves 5/6/7 (08/09/10) each run a single plan.
- `job_worker.py` and `cron.py` in Stage B are owned SOLELY by 106-08 (09 touches
  analytics_runner+tests; 10 touches process_key/main_worker/feature_flags). `main_worker.py`
  is edited by 08 (wave 5) and 10 (wave 7) but in different regions and different waves —
  sequential, no parallel write. No same-wave collision anywhere.

### 7. Tasks executable & verifiable — PASS
Every task carries concrete file paths, a specific change, and an `<automated>` verify
(greps / pytest / vitest+tsc / coverage+lint). The single exception is 106-05's
`checkpoint:human-verify` — the documented Nyquist exception (VALIDATION §Exceptions). No
vague tasks; no watch-mode or full-suite-E2E in any automated verify.

### 8. No branch ops — PASS
Every plan states "NO git branch operations" and stages only explicit paths. 106-01
explicitly forbids `git add` of the gitignored `106-RATIFICATION.md`. No `-A`, no
`.planning/` staging anywhere.

### 9. Migration auto-applies to PROD — PASS
106-06's `20260716090000_*` sorts after the current latest `20260715090000_*` (confirmed).
Safe-by-construction against the 45 historical rows: pure CREATE OR REPLACE (no table DDL,
validates zero rows), `SET LOCAL lock_timeout='3s'`, no explicit BEGIN/COMMIT, registry +
both CHECKs untouched, self-verifying DO block fails the deploy on regression. Plan
instructs a re-`ls | tail` timestamp bump at execution if newer files land.

---

## Cross-cutting dimensions
- **Requirement coverage:** BB-03 on all 10 plans; goal fully decomposed; D1–D7 each owned
  (D1→01/05/10, D2→07, D3→06, D4→07/08/09, D5→02, D6→01/05, D7→03/04).
- **Dependency graph:** acyclic; wave = max(deps)+1 throughout (01→02/03/04→05→06/07→08→09→10).
- **Context compliance:** deferred scope excluded — NO store DDL (only the D3 RPC guard),
  no `csv_daily_returns` rename, no `metrics_snapshot` work; the inert kill-switch ROW is
  left for manual cleanup (no DML). No scope-reduction language ("v1/simplified/static").
- **CLAUDE.md:** coverage gates respected (07/09/10 run `--coverage`); lint gate included;
  VERSION+package.json bump correctly deferred to ship-time (orchestrator).

---

## WARNINGs (fix recommended, not blocking)

**W1 [scope_sanity] — 106-07/08/10 exceed the 8-file soft ceiling.**
106-07 = 10 files, 106-08 = 12, 106-10 = 13. Deletion-heavy and coupled (the zombie-order
+ single-PR-atomicity constraint prevents splitting across agents), and each is bounded to
2–3 tasks with per-task file subsets — so this is a context-budget note, not a structural
fault. Recommend the executor checkpoint/compact between tasks in 106-08 and 106-10.

**W2 [scope_sanity] — 106-02 `files_modified` may be under-declared.**
Its REFACTOR step greps and may edit sibling order-assertion tests
(`test_cash_basis_series_sc4.py`, `test_csv_analytics_runner.py`) that are not listed in
frontmatter. No same-wave conflict exists (no other wave-2 plan touches those files;
106-09's later edit of the sc4 file is sequential), so this is bookkeeping hygiene only —
add the sibling test paths to `files_modified` if the swap turns them red.

## Must-fix before execute
None. No BLOCKERs.
