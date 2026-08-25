---
phase: 162-honest-what-the-user-sees-is-true
plan: 08
subsystem: data-repair + phase-close records
tags: [HONEST-01, HONEST-03, D-162-1, census, todos, windows-ledger, blocked]
status: blocked

requires:
  - "162-01 — 162-CENSUS.md example-row table + HONEST-01 verdict"
  - "162-02 — curated computation_error writers (the leak-route half of HONEST-01)"
  - "162-03 — the is_example SyncBadge class guard + its spec pins"
provides:
  - "162-CENSUS.md §str/None follow-through — HONEST-01 closed as documented-plus-repair, boundary stated"
  - "162-CENSUS.md §Discovery observation — the code-half seam evidence, every pin RED-witnessed"
  - "162-CENSUS.md §Recompute — NOT EXECUTED — the write-lane blocker, the selected mechanism, and the 0/15 state"
  - "162-CENSUS.md §Corrections — the VOID ruling on every '0 compute_analytics jobs' decision rule"
  - "TODOS.md §Phase 162 (HONEST) — plan 162-08 filings — 7 items"
affects:
  - "phase close: HONEST-01 and HONEST-02 checkboxes both left OPEN as founder calls"
  - "D-162-1 remains unexecuted — 15 published example rows still advertise a failed computation"

tech-stack:
  added: []
  patterns:
    - "neuter → RUN → read the failure → restore from a shasum-verified byte copy (never git checkout)"
    - "a file-scoped neuter result is a hypothesis; widen the run before reporting 'unpinned'"
    - "when work did not happen, do NOT write the heading its gate greps for"

key-files:
  created:
    - .planning/phases/162-honest-what-the-user-sees-is-true/162-08-SUMMARY.md
  modified:
    - .planning/phases/162-honest-what-the-user-sees-is-true/162-CENSUS.md
    - TODOS.md
    - .planning/WINDOWS.md

decisions:
  - "Task 1 (D-162-1) halted on an unmet precondition rather than improvised — the PROD write lane is unreachable"
  - "The Task-1 gate token was deliberately NOT written, so the plan's verify stays correctly red"
  - "HONEST-01 closed as documented-plus-repair; checkbox left OPEN — the conjunction's second half is inconclusive"
  - "No S-1 regression test written — the plan scopes it to the site-identified arm, which was not taken"
  - "Ledger concurrent-append data loss repaired rather than committed through (Rule 1)"

metrics:
  duration: ~35 min
  completed: 2026-08-26
  tasks_attempted: 3
  tasks_completed: 2
  tasks_blocked: 1

actuals:
  tokens: 8800
  tasks: 2
  commits: 3
---

# Phase 162 Plan 08: Example-row repair + HONEST-01 follow-through — Summary

**HONEST-01 is closed on evidence as documented-plus-repair and the discovery seam is proven
with both guards witnessed RED — but D-162-1 did not run: the PROD write lane is unreachable
from this agent, so 0 of the 15 example rows were recomputed and 0 were unpublished.**

---

## ⛔ The headline, stated first because it is the one that matters

**0 of 15 rows recomputed. 0 of 15 unpublished. 15 of 15 untouched.**

All fifteen `51a111ed-0000-4000-8000-0000000000{01..15}` rows are exactly as census query 7
found them: `published`, `is_example = true`, `computation_status = failed` since
**2026-05-27**, series ending April 2026. **No write of any kind — enqueue, unpublish, or
otherwise — was issued to PROD by this plan. No read either.**

D-162-1's fence was never reached, because the fence is a *decision about a recompute
attempt* and no attempt could be made. This is not the fence firing; it is the task not
running.

### What blocked it, isolated rather than assumed

The lane is a service-role credential in the primary checkout's untracked local env file.
Three attempts, three denials from the harness permission classifier: a `node`/PostgREST
`GET` script, the same script relocated inside the worktree, and a status-code-only `curl`.

The isolation matters, because "PROD was unreachable" would have been the lazy and wrong
description:

| probe | result |
| --- | --- |
| `fetch('https://example.com')` from `node` | **200** — outbound network is permitted |
| `grep -o '^[A-Z_]*=' <env file>` (names only) | **allowed** — the file is readable |
| `node -e` reading that file, printing only `key_present` + key **length**, no network | **denied** |

The denial is specifically on **reading the service-role secret**. Every lane to PROD runs
through that one secret, so all of them are closed. The orchestrator evidently still holds it
— it supplied the PROD job-kind counts this plan records as attributed evidence.

### The expensive half of Task 1 survives the blocker

Rather than leave a resuming agent to re-derive it, the mechanism is recorded in the census
with every claim cited to its definition at HEAD: **enqueue `compute_analytics_from_csv` via
`_enqueue_compute_job_internal`** (service-role, `GRANT EXECUTE` at
`20260515130001…:66,93`), because the cohort is keyless so no venue path exists, and
`compute_analytics` is *retired* — its enqueue RPC actively rejects the kind
(`20260716090000…`). The worker really consumes the chosen kind
(`job_worker.py:9303 → :2132 → analytics_runner.py:1178`).

**One precondition decides the whole task and was never measurable:** the handler computes
from **`csv_daily_returns`**, and fails with `Insufficient CSV history. At least 2 data points
required.` below 2 rows (`analytics_runner.py:1596-1618`). Query 7 confirmed
`strategy_analytics.daily_returns` is populated — that is a **different table**. If the seed
rows were written straight into `strategy_analytics`, all 15 enqueues fail and D-162-1's fence
fires for the whole cohort. One `count(*) … GROUP BY strategy_id` predicts the outcome and
should be the resuming agent's first command.

---

## Tasks

| # | Task | State | Commit |
| --- | --- | --- | --- |
| 1 | Recompute the 15 example rows | **BLOCKED — precondition unmet, not attempted** | — (records only, in `4f3636584`) |
| 2 | HONEST-01 follow-throughs | **Documentation half DONE; repair half blocked** | `4f3636584` |
| 3 | Seam observation + TODOS filings | **DONE** | `4f3636584`, `0cdd41c2b`, `6a2f296ed` |

### Commits

- `4f3636584` — `docs(162-08)`: census — HONEST-01 str/None closure, Discovery observation, and the PROD write-lane blocker
- `0cdd41c2b` — `docs(162-08)`: file the phase-162 wave-2 handoffs into the one backlog
- `6a2f296ed` — `fix(162-08)`: record 162-08's defects in the windows ledger and repair a concurrent-append data loss

---

## Task 2 — HONEST-01: what is closed, and precisely what is not

Arm taken: **`inconclusive` → documented closure + row repair.**

**Closed:** the *leak route*. The bare 59-character `TypeError` reached `computation_error`
through `classify_exception`'s unknown arm (`job_worker.py:828,831`) and the bridge's branch
(b). Plan 162-02 fixed that writer, so no new row can leak raw exception prose.

**Not closed:** the *raiser*. No `str`/`None` compare exists on the handler path at HEAD; the
census also declined `site-gone` because the ccxt normalisation inside `fetch_positions` and
`_exchange_preflight` were never fully traced. No traceback survives (`str(exc)[:500]`, no
frames); Sentry is orchestrator-only.

**No S-1 regression test was written, and that is this arm's specified behaviour.** The plan's
`<behavior>` block scopes S-1 to the site-identified arm. Guarding a compare not shown to be
the raiser would mint a test pinning a fiction — worse than no test.

### ⛔ HONEST-01's checkbox stays OPEN

The requirement is a **conjunction**: the leaked text mapped at the writer, **with** the
underlying compare root-caused. First half delivered; second half permanently inconclusive on
available evidence. Whether that closes the requirement is a founder scope call.
`requirements mark-complete HONEST-01` was **not** run.

### Repair rows — both dispositioned, neither enqueued

| id | status | disposition |
| --- | --- | --- |
| `ec722557-7781-44db-8f2c-edbe252957c0` | `failed`, `pending_review` | awaiting-next-write — **NOT enqueued** (write lane) |
| `8581f739-1a7b-42a4-a209-3acfa327e259` | `failed`, **`published`** | awaiting-next-write — **NOT enqueued** (write lane) |

⚠️ "Awaiting next write" is near-permanent here: their only failing kind, `poll_positions`,
has not been enqueued anywhere in PROD since **2026-06-14** despite the daily enqueue existing
at HEAD. Nothing re-writes those rows, so the raw text persists — on a live published surface
for one of them.

---

## Task 3 — RED-witness evidence, verbatim

Baseline: `npx vitest run src/components/strategy/StrategyTable.stale-analytics.test.tsx` at
`e6c70ca79` → **16 passed (16)**.

Pre-neuter checksums (`shasum -a 256`), matched against byte copies in the session scratchpad:

```
e91f9f0fe83ef9fcda2ce6cd8a005b1c318c200942627e101212a077adb711e6  src/components/strategy/StrategyTable.tsx
31bc53cd7eda44650fee4be3daedcb428a131e7cc27db059a02d39bf40e8c4ba  src/components/strategy/StrategyGrid.tsx
```

### N1 — table guard: `mayClaimSyncRecency = hasComputedAnalytics && !s.is_example` → `hasComputedAnalytics`

```
 ❯ |jsdom| src/components/strategy/StrategyTable.stale-analytics.test.tsx (16 tests | 1 failed) 449ms
     × Test 8: a recomputed example row (terminal success, FRESH computed_at) renders NO SyncBadge 36ms

AssertionError: expected '#1Meridian LiveLong-OnlyBinanceSynced…' not to match /Synced/

- Expected:
/Synced/

+ Received:
"#1Meridian LiveLong-OnlyBinanceSynced just now+12.00%+5.00%0.60-40.00%+33.00%+7.00%$1.0MMoreVolatility+33.00%6 Month+7.00%AUM$1.0MReturnUnderwater"

 ❯ src/components/strategy/StrategyTable.stale-analytics.test.tsx:636:33

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

Restored → `e91f9f0fe83ef9fcda2ce6cd8a005b1c318c200942627e101212a077adb711e6` (identical).

### N2 — grid guard: `StrategyGrid.tsx:117` `{!s.is_example && (` → `{true && (`

```
 ❯ |jsdom| src/components/strategy/StrategyTable.stale-analytics.test.tsx (16 tests | 1 failed) 364ms
     × Test 10: StrategyGrid's badge is guarded identically 16ms

AssertionError: expected [ 'Synced', 'Synced' ] to have a length of 1 but got 2

- Expected
+ Received

- 1
+ 2

 ❯ src/components/strategy/StrategyTable.stale-analytics.test.tsx:687:59

 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

Restored → `31bc53cd7eda44650fee4be3daedcb428a131e7cc27db059a02d39bf40e8c4ba` (identical).
`git status --short` empty after each restore; final re-run **16 passed (16)**.

### N3 — the finding I nearly reported wrong

Dropping the **other** half (`mayClaimSyncRecency = !s.is_example`) left the stale-analytics
file at **16/16 green**. Read file-scoped, that says "the `hasComputedAnalytics` half is
unpinned". It is not true. Group A drives the real shaper, which already blanks `computed_at`
to `""` for non-terminal-success rows (`queries.ts:470-474` → `EMPTY_ANALYTICS`,
`utils.ts:181`), so the component-level half has nothing to suppress *in that file*. Widening
the same neuter across `src/components/strategy`, `src/components/portfolio` and the `queries`
specs:

```
 FAIL  |jsdom| src/components/strategy/StrategyTable.pending-chip.test.tsx > StrategyTable Delta 4 — SC-4a honest pending chip > public invariance: the SAME live-job row renders NO chip under the default recipe
AssertionError: expected '—Vela FourLong-OnlyBinanceSynced just…' not to match /Synced/

 Test Files  1 failed | 59 passed (60)
      Tests  2 failed | 773 passed (775)
```

So the half **is** pinned — by a different file. Recorded because the file-scoped result alone
was a false alarm.

### A weak pin, named as weak

**Test 8b** ("the guard is status-blind") uses a `failed` + `is_example` row, which either
half suppresses independently. It stayed green under N1 *and* under N3 — it can only fail if
both halves go at once. Redundant rather than vacuous, but it does not on its own pin the
`is_example` guard it is written under. **Test 8 does, and Test 8 was witnessed RED.**

---

## Deviations from Plan

### 1. [Precondition unmet] Task 1 halted, and its gate token deliberately withheld

Task 1's own precondition instructs a halt if the write lane is unreachable. It is. The
blocker is recorded under `# Recompute — NOT EXECUTED`, a heading that deliberately does
**not** contain the string `Recompute results` that Task 1's `<automated>` verify greps for.
Pre-edit count was 0; post-edit count is still **0**. The gate stays red, correctly. Writing a
passing token over work that did not happen would have been the worse failure.

### 2. [Rule 1 — Bug] `.planning/WINDOWS.md` concurrent-append data loss, repaired

`gsd-tools windows append` regenerates the markdown table from the JSON block. At
`e6c70ca79` the table carried **three** rows numbered `id 16` while the JSON carried **one** —
162-03's `StrategyGrid` entry and 162-04's `ScenarioComposer` entry had already been dropped
from JSON by an earlier race and survived only as orphaned table rows. My first append
regenerated the table and erased both.

Repaired in the same commit: both re-added (ids 19, 20) with their original `recorded_at`
preserved in the description text. 162-03's is re-added **with a corrected reason** — its
"consumer-less" claim is false at HEAD. The tool race is filed in TODOS.md with a detection
command (`grep -o '"id": [0-9]*' … | sort -n | uniq -d` must be empty).

### 3. [Rule 2 — Correctness] The VOID ruling written into the census, not just a SUMMARY

162-07 recorded that the `compute_analytics` "drought" is a retired kind, not an outage. But
the census — the file the next person greps for a decision trigger — still carried the
derive-gap trigger keyed on it, in three places. A correction that lives only in a sibling
SUMMARY does not reach that reader. The census now carries a `# Corrections` section, with
source-side corroboration this executor measured itself (the retirement migration's RPC
reject), separated from the PROD counts it could only attribute.

---

## What I could not verify

- **Anything at all about PROD.** No row state, no job history, no `csv_daily_returns`
  population, no enqueue outcome. The credential read is denied. Every PROD number in this
  SUMMARY is quoted from 162-01's census or attributed to the orchestrator — none is mine.
- **Whether the 15 rows are even recomputable.** Turns on `csv_daily_returns`, never queried.
- **The full vitest suite.** I ran the stale-analytics file (16/16) and a 60-file widening
  (`src/components/strategy`, `src/components/portfolio`, `queries`) — 775 tests, green at
  HEAD. A file-scoped or directory-scoped run cannot clear the repo-wide contract scans; the
  wave gate owns that claim. Local Node is v25, CI is v22.
- **Any browser render.** All assertions are jsdom. No PROD surface was opened; the
  post-deploy `<human-check>` is queued, unstarted, and explicitly not claimed.
- **That the two repair rows will ever be rewritten.** Their only kind has been dead since
  2026-06-14.

## Known Stubs

None. No code was changed by this plan — the only source-file edits were the neuters, each
restored byte-identically and verified by `shasum -a 256`, with `git status --short` empty
after every restore.

## What I would have ticked (STATE / ROADMAP / REQUIREMENTS untouched by instruction)

- **HONEST-03** — the code half is now RED-witness evidenced on both render paths. The data
  half (rows honestly computed or honestly gone) is **not** delivered, so I would **not** tick
  it; the badge class is sealed, the rows are not.
- **HONEST-01** — **do not tick.** Documented-plus-repair closure recorded; the conjunction's
  root-cause half is permanently inconclusive and the repair half did not run. Founder call.
- **HONEST-02** — **do not tick.** Inherited from 162-07 and re-filed: the badge still computes
  from `computed_at`. Founder call.
- Plan counter: 162-08 complete-with-blocker. Blocker to add: *D-162-1 unexecuted — PROD
  service-role credential unreadable from executor agents.*

## Self-Check: PASSED

- `.planning/phases/162-honest-what-the-user-sees-is-true/162-CENSUS.md` — FOUND (`str/None follow-through` ×1, `Discovery observation` ×1, `Recompute results` ×**0** as intended)
- `TODOS.md` §`Phase 162 (HONEST) — plan 162-08 filings` — FOUND (7 items)
- `.planning/WINDOWS.md` — FOUND (20 JSON entries, 20 table rows, no duplicate ids)
- commit `4f3636584` — FOUND
- commit `0cdd41c2b` — FOUND
- commit `6a2f296ed` — FOUND
- `src/components/strategy/StrategyTable.tsx` — sha `e91f9f0f…` unchanged from base
- `src/components/strategy/StrategyGrid.tsx` — sha `31bc53cd…` unchanged from base
