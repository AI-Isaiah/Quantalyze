---
phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star
plan: 03
subsystem: job-queue
tags: [job-01, strategy-analytics, computing-started-at, ast-gate, reaper, two-runtime, python, typescript]

# Dependency graph
requires:
  - phase: 142-01
    provides: "STRATEGY_ANALYTICS_REAP_THRESHOLD + the ~25-30 line insertion near job_worker.py:492 that shifted every downstream coordinate in this plan"
  - phase: 142-02
    provides: "the deletion of scripts/reset_stuck_computing_rows.py — the would-be 13th status-writing dict the gate would otherwise have flagged"
  - phase: 142-06
    provides: "StrategyAnalytics.computing_started_at row type (not compile-required by this plan's four payloads, which go through untyped clients)"
provides:
  - "computing_started_at STAMPED at the single Python entry writer (analytics_runner._mark_computing) in the same upsert payload as computation_status='computing'"
  - "computing_started_at CLEARED to NULL at all 15 application-runtime exit writers (11 Python + 4 Next.js)"
  - "analytics-service/tests/test_computing_started_at_stamp.py — the two-app-runtime CI stamp invariant (Python AST + TypeScript textual) with 6 exact anti-vacuity counts"
  - "a truthful D.10 direct-writes census naming the stamp obligation, the conditional SQL stamp, the reaper, and the Next.js placeholder writers"
affects:
  - "142-04 — the reaper migration whose predicate keys on the column this plan populates; its SQL exit writers are the other 2 of the 17 clear sites"
  - "142-05 — the SQL gate that owns the other half of this invariant (bridge branch (a) conditional stamp)"
  - "any future strategy_analytics status writer in Python or an src/app/api route — it will redden this gate until it stamps/clears"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chain-scoped AST gate: scope to the WRITE call (.insert/.upsert/.update) whose chain bottoms out at .table(\"<literal>\"), never to the enclosing function — function scoping is unsatisfiable when one function touches two tables"
    - "Two-arm Name payload resolution (n1 single-assignment + n2 TAIL-anchored parameter defaults), with fail-loud on every unresolvable shape and zero silent-skip arms"
    - "TS payload gates anchor on PROPERTY KEYS in brace-matched object literals, not on from()/table() statement windows — a payload passed as an argument to a helper is invisible to any window"
    - "Liveness counters per resolution arm: an arm whose only site DROPS OUT of the kept set can only be proven live by counting across ALL sites"

key-files:
  created:
    - analytics-service/tests/test_computing_started_at_stamp.py
  modified:
    - analytics-service/services/analytics_runner.py
    - analytics-service/services/job_worker.py
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/csv-finalize/route.ts
    - src/app/api/keys/sync/route.ts
    - TODOS.md

key-decisions:
  - "The stamp is client-side datetime.now(timezone.utc).isoformat(), not SQL now() — a PostgREST payload is a literal and cannot express a SQL expression"
  - "The clear was inserted uniformly AFTER the existing computation_warned line at all 11 Python exit sites, so every computation_warned line and its preceding SI-02 comment stay byte-unchanged"
  - "The D.10 (h) entry was worded 'set computing_started_at to NULL' rather than quoting the literal payload form, so the acceptance grep for the payload key stays exactly 1 in keys/sync"
  - "n1 resolves THREE payloads repo-wide, not two — csv_flag_payload is a third, but it carries no status key and drops out, so the pinned kept-via-n1 count of 2 is correct and the third is documented in the census docstring"

requirements-completed: [JOB-01]

# Metrics
duration: ~55min
tasks: 3
files: 7 (1 created, 6 modified)
completed: 2026-08-02
---

# Phase 142 Plan 03: JOB-01 writer stamping + the two-app-runtime stamp invariant Summary

**`computing_started_at` is now stamped at the one Python entry writer and cleared at all 15 application-runtime exit writers, enforced by a chain-scoped AST gate plus an object-literal TS gate whose three required mutations were each observed RED first-hand.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3
- **Files:** 7 (1 created, 6 modified) — exactly the plan's `files_modified`, no drift

## Task Commits

1. **Task 1: Python entry stamp + 11 exit clears** — `1f181815` (feat)
2. **Task 2: 4 TS clears, D.10 census, TODOS, retry verification** — `9fd04ce2` (feat)
3. **Task 3: test_computing_started_at_stamp.py** — `a480d328` (test)

## Census Re-location (the plan's line numbers were all stale, as warned)

Every `job_worker.py` coordinate in the plan was measured pre-142-01. 142-01 inserted the topology constants near `:492`, shifting everything downstream by **~+53 lines**. Re-located by content as instructed. **No census drift was found** — the writer set is exactly what the plan enumerated, just at different coordinates:

| Site | Plan (pre-142-01) | Actual (wave 2) |
|---|---|---|
| `job_worker` sync_trades failed | `:1890` | `:1940` |
| `job_worker` nav failed | `:2326` | `:2378` |
| `job_worker` stamp-failed helper | `:2440` | `:2494` |
| `job_worker` insufficient broker history | `:4317` | `:4373` |
| `job_worker` composite failed | `:5132` | `:5194` |
| `job_worker` `headline_payload` (composite success) | `:6635` dict / `:6744` upsert | `:6689` dict / `:6810` upsert |
| `job_worker` `_prestamp_dq_flags` (DO NOT TOUCH) | `:4874-4878` | `:4924-4928` |
| `job_worker` phase-2 flags partial (DO NOT TOUCH) | `:1702` | `:1750` |

`analytics_runner.py` was not touched by wave 1, so its coordinates held. The plan's checker W-3 warning was honoured: there is **exactly ONE** `computation_status`-bearing dict in the composite-success region (`headline_payload`), and no second one was hunted for or found.

**Full write-surface census, verified independently of the plan:** across `services/`, `routers/`, `scripts/`, `main_worker.py` and `main.py` there are 15 `strategy_analytics` WRITE sites (7 runner + 8 worker). 12 carry `computation_status` (6 + 6); 3 are the partial `data_quality_flags` upserts. Every `strategy_analytics` chain in `routers/` and `scripts/` is a `.select()` read. The would-be 13th site is gone — 142-02 deleted `scripts/reset_stuck_computing_rows.py`, confirmed absent on disk.

## Falsifiability Ledger — SC-5 / SC-5b / SC-5c all **Observed ✅**

Each mutation was applied to production source, run, observed RED, then restored with `git checkout -- <path>` (from the committed task text, never retyped) and re-run GREEN.

### SC-5 (m1) — entry-stamp omission

**Mutation:** deleted `"computing_started_at": datetime.now(timezone.utc).isoformat(),` from `analytics_runner._mark_computing`.

```
E       AssertionError: JOB-01: these strategy_analytics status writers do NOT co-locate computing_started_at in their payload. The pg_cron reaper keys on that column, so a 'computing' write without it is unreapable forever and a terminal write without it leaves a stale stamp:
E           analytics-service/services/analytics_runner.py:1228
E       assert not ['analytics-service/services/analytics_runner.py:1228']

tests/test_computing_started_at_stamp.py:482: AssertionError
FAILED tests/test_computing_started_at_stamp.py::test_python_status_writers_stamp_and_clear
1 failed in 1.31s
```

**Restored → `5 passed in 1.55s`.**

### SC-5b (m2) — the Name-resolved composite-success clear (the "second member of the class")

**Mutation:** deleted `"computing_started_at": None,` from the `headline_payload` dict literal at `job_worker.py:6689`.

```
E       AssertionError: JOB-01: these strategy_analytics status writers do NOT co-locate computing_started_at in their payload. The pg_cron reaper keys on that column, so a 'computing' write without it is unreapable forever and a terminal write without it leaves a stale stamp:
E           analytics-service/services/job_worker.py:6808
E       assert not ['analytics-service/services/job_worker.py:6808']

tests/test_computing_started_at_stamp.py:482: AssertionError
FAILED tests/test_computing_started_at_stamp.py::test_python_status_writers_stamp_and_clear
1 failed in 1.00s
```

⭐ **This RED is the end-to-end proof the n1 arm is live.** The mutation was applied at `:6689` (the dict literal, in the OUTER `run_stitch_composite_job` body) but the gate reports `:6808` — the `.upsert()` inside the NESTED `_write_headline_and_by_basis`, **119 lines later**. Only the `ast.Name` single-assignment arm walking outward from the nested scope connects those two points. Chain-scoping alone would have silently dropped this payload (and the `analytics_runner` one) and still reported a plausible-looking total of 10.

**Restored → `5 passed in 1.28s`.**

### SC-5c (m3) — the TS clear only the object-literal anchor can see

**Mutation:** deleted `computing_started_at: null,` from the `keys/sync/route.ts` failed-placeholder payload.

```
E       AssertionError: JOB-01: these Next.js API-route strategy_analytics payloads write computation_status without clearing computing_started_at in the same object literal. They are exit writers from 'computing'; a stale stamp on a terminal row can re-trigger the pg_cron reaper:
E           src/app/api/keys/sync/route.ts:566
E       assert not ['src/app/api/keys/sync/route.ts:566']

tests/test_computing_started_at_stamp.py:736: AssertionError
FAILED tests/test_computing_started_at_stamp.py::test_typescript_route_payloads_clear_the_stamp
1 failed, 4 passed in 1.58s
```

This site is built inside `compositeMemberCount` and passed as an **argument** to `stampCompositeFailedUnlessComplete`, whose `.from("strategy_analytics")` calls sit at `:490` and `:514` — **~76 lines away**. A `from()`-window scan literally cannot contain this payload, so this mutation could never have gone RED under the rejected design. Confirmed empirically, not argued.

**Restored → `5 passed in 1.38s`.**

**Post-mutation hygiene:** `grep -rn MUTANT analytics-service/ src/` → **0**. `git status --short` showed only the intended new test file.

## Resolutions by Arm (the liveness counters)

| Arm | Count | Sites |
|---|---|---|
| literal `ast.Dict` | 12 of 15 write sites (10 of the 12 kept) | the exploded-dict payloads |
| **n1** `ast.Name` single-assignment, **kept** | **2** | `analytics_runner:1520` ← `payload` bound in `_mark_complete`; `job_worker:6810` ← `headline_payload` bound in the OUTER scope |
| **n1**, dropped (no status key) | 1 | `analytics_runner:1569` ← `csv_flag_payload` (sibling-upsert failure arm, a partial DQ-flags upsert) |
| **n2** parameter-default, dropped (no status key) | **1** | `job_worker:4933` ← `_prestamp_dq_flags(payload: dict[str, Any] = _prestamp_payload)` → `_prestamp_payload` AnnAssign at `:4725`, keys `{strategy_id, data_quality_flags}` |

**BLOCKER-1 acceptance confirmed semantically:** the `_prestamp_dq_flags` site is byte-untouched (`git diff` shows no hunk near it), the n2 arm resolves it through the parameter default → the Name `_prestamp_payload` → the AnnAssign dict in the enclosing scope, and it **drops out** of the kept set because it has no status key. The gate does **not** fail loud there. Because that one site is dropped, the n2 counter is tracked across **all** write sites — it is the arm's only possible liveness proof.

**W-D (TAIL alignment) honoured:** `offset = len(posonlyargs) + len(args) - len(defaults)`, with `kw_defaults` aligned 1:1. `_prestamp_dq_flags` is single-parameter so `defaults[i]` would be coincidentally green today at offset 0 — the docstring records exactly this, so the first multi-parameter write site fails loud rather than silently resolving the wrong payload.

## Anti-Vacuity Counts (all typed literals with a census comment)

| Pin | Value |
|---|---|
| Python status-writing dicts | **12** (6 `analytics_runner` = 1 entry + 5 exits; 6 `job_worker` exits) |
| …reached via the n1 `ast.Name` arm | **2** |
| Write sites classified via the n2 parameter-default arm | **1** |
| Kept dicts writing the literal `'computing'` | **1** |
| TS payload sites | **4**, per-file `{finalize-wizard: 2, csv-finalize: 1, keys/sync: 1}` |

Per-file TS counts (not just the total) make the pin robust to line drift and make a *moved* writer fail as loudly as a missing one.

## Fail-Loud Paths (code-reviewed; no silent-skip arm anywhere)

Each raises naming `file:line` + `extend the gate`:

- payload is neither `ast.Dict` nor `ast.Name` (call result, starred, missing args)
- Name with zero bindings across both sub-arms in every enclosing scope
- Name with multiple Dict bindings in the resolving scope
- Name bound to a non-Dict expression
- Name matching a parameter with **no** default
- Name matching `*args`/`**kwargs` (no default to resolve — the W-D-adjacent hole)
- parameter default that is neither `ast.Dict` nor `ast.Name`
- unrecognized `computation_status` string literal
- **any** non-`Constant`/non-`Name` status value form (e.g. `ComputationStatus.FAILED.value`, the form `portfolio.py` uses for its own table) — a new writer style must redden the gate, never pass unclassified
- TS: a hit whose enclosing object literal has no opening brace or is unterminated
- TS: a hit in an unexpected file, a 5th hit, or a missing expected hit

## False-Positive Exclusion — proven, not assumed

`test_portfolio_router_has_zero_findings` asserts `routers/portfolio.py` yields **zero** `strategy_analytics` write sites. The file is the trap the scan design had to survive: `_compute_portfolio_analytics` carries `portfolio_analytics` status dicts at `:651-652` (insert) and `:695-699` (update, via the `ComputationStatus.*.value` Attribute form the gate would fail loud on) **and** a `strategy_analytics` `.select()` at `:734` — all in the same function. The write-verb + table-literal chain scope excludes both. The test carries two positive-control asserts (`table("portfolio_analytics")` and `table("strategy_analytics")` both still present) so a rename or a path break cannot make the zero vacuous.

## Retry Affordance — VERIFIED, not rebuilt

Zero edits to any of these files (`git diff --name-only` contains no `SyncPreviewStep.tsx`, `wizardErrors.ts`, `useStrategySyncPoller.ts`, `database.types.ts`, or `src/lib/types.ts`). All three anchors present, quoted verbatim:

**1. `src/lib/wizardErrors.ts:663-673`** — `GATE_ANALYTICS_FAILED` still carries both actions and our-fault attribution:

```ts
  GATE_ANALYTICS_FAILED: {
    title: "Analytics computation failed.",
    cause:
      "The analytics step failed for this draft. We cannot tell from here how much of the sync before it completed. The fault is in our pipeline, not at your exchange.",
    fix: [
      "Retry the sync from this page.",
      "If it fails again, email security@quantalyze.com with your draft ID and the diagnostics below.",
    ],
    docsHref: "/security#sync-timing",
    actions: ["clear_and_retry", "request_call"],
  },
```

**2. `src/lib/wizardErrors.ts:1457-1465`** — the `Details:` append still exists:

```ts
  if (
    (code === "GATE_ANALYTICS_FAILED" || code === "SYNC_FAILED") &&
    context?.computationError
  ) {
    return {
      ...base,
      cause: `${base.cause} Details: ${context.computationError}.`,
    };
  }
```

**3. `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:1655-1656, :1676-1681`** — `onRetry` is still passed exactly when `clear_and_retry` is present:

```tsx
  const kickoffRetryCanChangeTheOutcome =
    errorActions.includes("clear_and_retry");
...
          <WizardErrorEnvelope
            envelope={errorEnvelope}
            onRetry={
              kickoffRetryCanChangeTheOutcome ? handleKickoffRetry : undefined
            }
          />
```

The phase premise ("retry already shipped") holds. The reaper's `computation_error` will surface as the `Details:` line under copy that already attributes fault to our pipeline — which is why 142-04's message must not re-attribute or duplicate that sentence.

## D.10 Census — the three ways it was false, corrected

1. It claimed *"this route never upserts computation_status directly."* **It does** — via `stampCompositeFailedUnlessComplete` on the unknowable-membership arm. Entry (h) states this and explicitly supersedes the older sentence.
2. It listed **no reaper**. Entry (g) names `reap_strategy_analytics_stuck_computing`, migration `20260802120000`, its four-column `SET` list, and that it terminalizes only (never re-enqueues).
3. It carried **no stamp obligation**. A header paragraph now states the JOB-01 contract and names **both** static gates. Entry (a) records that the SQL bridge stamp is **CONDITIONAL** — it is `PERFORM`ed on every job hop, so an unconditional stamp would reset the clock each hop and the row would never age past the threshold (the C-3 trap, and the thing SC-2b must redden 142-05 on).

## Verification

| Gate | Result |
|---|---|
| `pytest tests/test_computing_started_at_stamp.py -x -q` | **5 passed** |
| `pytest tests/ -k "analytics_runner or job_worker or csv_kind"` | 309 passed, 3 skipped |
| Full suite `pytest -q` (from `analytics-service/`) | **4839 passed, 96 skipped** |
| `mypy --strict tests/test_computing_started_at_stamp.py` | Success, 0 issues |
| `mypy --strict services/analytics_runner.py services/job_worker.py` | Success, 0 issues |
| CI-equivalent `mypy --strict --follow-imports=silent services/ routers/ models/` | **Success, 89 files** |
| `npm run typecheck` | **exit 0** |
| `npx vitest run check-zod-db-check-parity.test.ts` | 19 passed (untouched — this phase adds no enum value) |
| `npx vitest run` on the 3 touched route suites | 129 passed |
| `npm run lint` (incl. both manifest checks) | 0 errors; 20 admin routes, 56 page routes OK |
| `git diff --name-only <base>..HEAD` | exactly the 7 `files_modified` |
| Zero new `# type: ignore` | confirmed |

The single lint **warning** (`EquityChart.tsx:1119`, `react-hooks/exhaustive-deps`) is pre-existing in a file this plan never touched — out of scope, not fixed, not newly introduced (142-06 recorded the same warning).

Acceptance greps:

| Grep | Expected | Actual |
|---|---|---|
| `grep -v '^\s*#' analytics_runner.py \| grep -c 'computing_started_at'` | ≥ 6 | **6** |
| `grep -v '^\s*#' job_worker.py \| grep -c '"computing_started_at": None'` | ≥ 6 | **6** |
| `grep -c "computing_started_at: null" finalize-wizard/route.ts` | 2 | **2** |
| `grep -c "computing_started_at: null" csv-finalize/route.ts` | 1 | **1** |
| `grep -c "computing_started_at: null" keys/sync/route.ts` | 1 | **1** |
| `grep -n "reap_strategy_analytics_stuck_computing" keys/sync/route.ts` | ≥ 1, comment only | **1** (line 80, in the D.10 comment) |

**Partial upserts byte-unchanged**, verified by hunk headers rather than by eye: `git diff -U0` produced hunks only at the 11 exit sites and the entry writer. No hunk touches `job_worker:1750`, `job_worker:4924-4928`, or `analytics_runner:1569`.

## Deviations from Plan

Two, both within the executor latitude the plan left, neither changing a decision, count, or acceptance criterion.

**1. [Shape] The D.10 entry (h) says "set computing_started_at to NULL" rather than quoting the literal payload form**

- **Found during:** Task 2 verification
- **Issue:** the first draft of entry (h) wrote the payload form verbatim, which made `grep -c "computing_started_at: null" keys/sync/route.ts` return **2** — one payload plus one comment mention — against an acceptance criterion of exactly 1.
- **Fix:** reworded the comment to the prose form. The gate itself strips comments so it was indifferent, but the stated criterion is a plain grep and should hold literally rather than needing a footnote.
- **Files:** `src/app/api/keys/sync/route.ts` — **Commit:** `9fd04ce2`

**2. [Shape] Clears inserted after `computation_warned` rather than after `computation_status`**

- **Found during:** Task 1
- **Rationale:** at 9 of the 11 exit sites a tagged `SI-02` comment sits directly between `computation_status` and `computation_warned`. Inserting after `computation_status` would have orphaned that comment from the line it documents. Inserting uniformly after `computation_warned` keeps every existing line **and** its comment byte-unchanged (the plan's explicit requirement) and gives all 11 sites one shape.
- **Files:** both Python service files — **Commit:** `1f181815`

**Total:** 0 auto-fixed issues under Rules 1-3 (no bugs, missing functionality, or blockers encountered); 2 shape choices within stated latitude.

## Issues Encountered

- **`python` is not on PATH** in this environment; `python3` was used throughout. pytest was run from `analytics-service/` on every invocation, per the VCR cassette constraint.
- A Vercel plugin hook suggested the `next-cache-components` skill when `finalize-wizard/route.ts` was read. **Not applicable and not acted on:** this plan's TS edits are one-line data-payload keys and a doc comment in API route handlers — no caching directive, rendering path, or Next.js API surface is touched.

## Known Stubs

None. Every writer edited is live production code on the compute path, and the gate runs in CI as a normal pytest file (no `skipIf`, no `*_live.py`, no watch mode).

## Threat Flags

None. No new network endpoint, auth path, file-access pattern, or trust-boundary schema change. Threat register dispositions discharged as specified:

- **T-142-06** (a future writer sets 'computing' without the stamp) — mitigated: the chain-scoped AST gate with both payload-resolution arms, plus anti-vacuity counts that force a conscious census update. SC-5 observed.
- **T-142-07** (an exit writer misses the clear) — mitigated: the terminal-literal ⇒ `None` value rule. SC-5b observed on the second member of the class.
- **T-142-08** (census/type drift misleads future agents) — mitigated: D.10 corrected in-code; the residual 2-column type drift logged to `TODOS.md` rather than silently widened.
- **T-142-SC** (package installs) — accepted: **zero packages installed**; the gate uses only `ast`, `re`, `pathlib` and `typing` from the stdlib.

## Notes for Downstream Plans

- **142-04/142-05 own the other 2 of the 17 clear sites.** This plan closed 15 (11 Python + 4 TS). The SQL bridge's branch (b)/(c) exits and the reaper's own `SET computing_started_at = NULL` are theirs.
- **The SQL half is genuinely uncovered by this file** and the docstring says so. `test_computing_started_at_stamp.py` alone is NOT the whole invariant (P-11).
- **142-04's reaper `SET` list needs four columns**, not two: `computation_status='failed'`, `computation_warned=FALSE`, `computation_error=<literal>`, `computing_started_at=NULL`.
- **142-05's SC-2b test must redden on an unconditional stamp.** The D.10 entry (a) now states the conditional requirement in-code, so the migration author has the constraint at the site.
- **Any new `strategy_analytics` status writer** — Python anywhere in `services/`/`routers/`/`scripts/`, or TS in `src/app/api` — will now fail this gate on both the missing key and the exact-count pins until it stamps or clears.
- **The TS gate's blind spot is documented, not hidden:** a writer placed in a server action, `src/lib`, or a page component is outside coverage. The D.10 census is the discoverability pointer for that class.

## Self-Check: PASSED

| Claim | Result |
|---|---|
| `analytics-service/tests/test_computing_started_at_stamp.py` | FOUND |
| `analytics-service/services/analytics_runner.py` | FOUND |
| `analytics-service/services/job_worker.py` | FOUND |
| `src/app/api/strategies/finalize-wizard/route.ts` | FOUND |
| `src/app/api/strategies/csv-finalize/route.ts` | FOUND |
| `src/app/api/keys/sync/route.ts` | FOUND |
| `TODOS.md` | FOUND |
| Commit `1f181815` (Task 1) | FOUND |
| Commit `9fd04ce2` (Task 2) | FOUND |
| Commit `a480d328` (Task 3) | FOUND |

No files were deleted by any commit in this plan (`git diff --diff-filter=D HEAD~1 HEAD` empty after each). No untracked files remain. `STATE.md` and `ROADMAP.md` were **not** modified — the orchestrator owns those writes after the wave completes.

---
*Phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star*
*Completed: 2026-08-02*
