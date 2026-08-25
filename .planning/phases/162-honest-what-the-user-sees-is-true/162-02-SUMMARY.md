---
phase: 162-honest-what-the-user-sees-is-true
plan: 02
subsystem: analytics-status-bridge
tags: [HONEST-01, D-162-4, computation_error, sql-bridge, wizard-copy]
status: complete

requires:
  - "sync_strategy_analytics_status @ 20260825150000 (the re-base target)"
  - "mark_compute_job_failed @ 20260529180000 (writes compute_jobs.error_kind)"
provides:
  - "computation_error_copy(TEXT) — SQL curated-copy function, range = 3 literals"
  - "strategy_analytics.computation_error holds curated user copy on every write path"
  - "portfolio_analytics.computation_error holds curated user copy on the catch-all"
  - "wizard failure envelope has no render path for either column"
affects:
  - "SyncPreviewStep failure envelope (composite + single-key)"
  - "portfolio dashboard StaleWarning (value only; reader unchanged)"
  - "supabase/tests/test_sync_status_marked_refresh_protected.sql arms A and I"

tech-stack:
  added: []
  patterns:
    - "curated-copy-at-the-write-boundary, guaranteed by RANGE not by caller discipline"
    - "apply-time behavioural gates (call the function, feed it a canary) over regex anchors"
    - "absolute identifier-absence anchor over pg_get_functiondef, comments included"

key-files:
  created:
    - supabase/migrations/20260826120000_computation_error_curated_copy.sql
    - analytics-service/tests/test_computation_error_curated.py
    - .planning/phases/162-honest-what-the-user-sees-is-true/deferred-items.md
  modified:
    - analytics-service/routers/portfolio.py
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.render.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx
    - supabase/tests/test_sync_status_marked_refresh_protected.sql
    - supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql

decisions:
  - "The write boundary is the SQL bridge, not the Python writers (162-02-DECISION.md)."
  - "classify_exception is NOT curated — that was the rejected option 2."
  - "Three error kinds yield TWO honest sentences plus a default, not three."
  - "b-prime's COALESCE is retired because the copy function is total."

metrics:
  duration: "~2h40m"
  completed: 2026-08-26

actuals:
  tokens: 46000
  tasks: 3
  commits: 3
---

# Phase 162 Plan 02: Curated `computation_error` Summary

A failed sync stops showing users Python exception strings — the fix lands at the SQL
status bridge (deriving copy from `compute_jobs.error_kind`, never from `last_error`),
at the portfolio catch-all, and by deleting the wizard envelope's `Details:` appendix.

## What was built

Three commits, on top of the prior executor's `2ee6302ca` (kept, not redone).

| Commit | Task | What |
|--------|------|------|
| `544f3cf2c` | 1 (amended) | Migration `20260826120000` — `computation_error_copy(TEXT)` + re-based bridge + 6 new apply-time gates; SQL test arms A/I rewritten |
| `f1d969cf3` | 2 | `portfolio.py` catch-all writes a curated constant; new pytest module |
| `fcf8e397a` | 3 | `Details:` appendix removed at three levels; specs G/H added, two inverted |

## The blocker, and what changed because of it

The plan's premise — "the SQL bridge needs no change, it copies what it is given" — was
false, and `162-02-DECISION.md` retracted it. Verified independently at both ends
before building anything:

- `sync_strategy_analytics_status` branch (b) does
  `VALUES (p_strategy_id, 'failed', v_latest_error, NULL)` with `v_latest_error` taken
  from `array_agg(last_error ...)`; branch (b-prime) writes the column too.
- It fires from inside `mark_compute_job_failed` via `PERFORM`, i.e. AFTER the Python
  stamp, in the same transaction as the status flip.

So the prior executor's choke-point split was necessary-but-not-sufficient, exactly as
its commit message said. **Two plan `must_haves` are therefore superseded and were NOT
implemented** (see Deviations).

One consequence worth stating plainly: **users lose nothing they currently see.**
The Python stamp's typed sentences never reached a screen — branch (b) overwrote them
on the terminal path and branch (a) writes `computation_error = NULL` on the
`failed_retry` path. What renders today is `compute_jobs.last_error` and only that.

## The measurement the decision demanded

The falsifier: *if `error_kind` is not reliably populated on the paths that reach
branch (b), the CASE collapses to its default and the three-arm structure is
decorative.* Measured statically at HEAD, over every writer of `status='failed_final'`:

| Writer | What it writes to `error_kind` |
|--------|-------------------------------|
| `mark_compute_job_failed` (20260529180000) | `error_kind = p_error_kind`, **unconditional**. Both `main_worker.py` callers pass `kind or "unknown"` / the literal `"unknown"` — neither can pass NULL |
| `retention_compute_jobs_orphaned_running` (20260817120000) | `error_kind = 'permanent'`, both arms |

There is no third writer. `error_kind` is non-NULL by construction on the paths that
reach branch (b). The falsifier does not fire — but it half-fires in a way worth
reporting:

**The three kinds do not yield three honest sentences, so this ships two plus a
default.** Read `mark_compute_job_failed`: `'permanent'` terminalises immediately,
while `'transient'` and `'unknown'` reach `failed_final` on one condition only —
`v_attempts >= v_max_attempts`. So a transient failure and an unknown failure arriving
at the bridge share the same, and only, true statement: the automatic retries were used
up. Giving them different words would imply a distinction the data does not carry and
the user cannot act on. They share an arm; the cardinality is pinned at 3 in both
directions (collapse OR split goes RED).

The live PROD domain from the decision (permanent 64 / unknown 55 / transient 10 of
`failed_final` rows) was NOT re-measured here — no PROD access from the worktree. It is
cited as the decision recorded it.

## The shape

`computation_error_copy(p_error_kind TEXT)` — `IMMUTABLE`, `LANGUAGE sql`, no object
references, and **its range is three literals**. Whatever goes in, only one of three
things comes out. That is a stronger guarantee than `sync_error_copy`'s (which
interpolates a venue), and it is the SQL answer to "the guarantee is made by the
signature, not by vetting what callers pass".

| `error_kind` | Copy |
|--------------|------|
| `permanent` | "Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed." |
| `transient`, `unknown` | "Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing." |
| NULL / anything else | "Analytics could not complete for this strategy. Retry the sync, or contact support if this persists." |

Following `sync_error_copy`'s discipline: the `permanent` arm promises nothing about
retrying, and the default arm claims nothing about retries at all.

The bridge goes one step past "does not copy `last_error`": after this migration the
identifier **does not appear anywhere in the function definition, comments included**,
and gate H1 asserts that over `pg_get_functiondef` (which returns comments). The prose
explaining why lives in the migration file header, which `pg_get_functiondef` does not
return. That trade is deliberate and is stated in the gate's own error message.

`compute_jobs.last_error` keeps raw text. Unchanged, and now asserted from the test
side too.

## Verification

| Gate | Result |
|------|--------|
| Full vitest | **12470 passed, 281 skipped, 0 failed** (800 files) |
| Full pytest from `analytics-service/` | **5373 passed, 89 skipped, 0 failed** |
| `test_allocator_positions.py` (the invariant that must stay GREEN) | **59 passed** |
| `npx tsc --noEmit` | clean |
| `mypy --strict routers/portfolio.py services/job_worker.py` | clean |
| Migration applied on a throwaway PG16 | self-verify NOTICE, all inherited + new anchors GREEN |
| `test_sync_status_marked_refresh_protected.sql` on that cluster | **ALL 16 ARMS EXECUTED** |

⛔ `uvicorn main:app` was never started. pytest run only from `analytics-service/`.

### End-to-end behaviour on a real PG16

Driven through the real `mark_compute_job_failed` → bridge path:

```
A status=failed
A user  =Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.
A oper  =TypeError: '>' not supported between instances of 'str' and 'NoneType'
T jobstatus=failed_final
T user  =Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing.
T oper  =ccxt.NetworkError: read timeout
P status=complete_with_warnings
P user  =Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.
P oper  =mt5 gateway IPC timeout (-10005)
```

Arm P also shows CR-01 intact: the protected marked refresh kept
`complete_with_warnings`.

## RED-witness evidence

Every pin was witnessed failing first-hand. Byte-identical restore between every
mutation, `shasum -a 256` verified each time (never `git checkout --`).

### Migration self-verify — 10 mutations, all RED

Baseline `8b5b420927b9362a9c35f6e7c0ed7d6586bf10a334c967e90f2187db4c635549`, restored
to that exact digest after each.

| # | Mutation | Observed |
|---|----------|----------|
| 1 | branch (b) writes the bare kind | `ERROR: HONEST-01 verification failed: branch (b) does not write computation_error_copy(v_latest_kind) into the failed-status upsert.` |
| 2 | CTE reads `f.last_error` again | `ERROR: HONEST-01 verification failed: sync_strategy_analytics_status references compute_jobs.last_error.` |
| 3 | **comment-only** `last_error` mention in the body | same H1 error — proves the anchor is comment-inclusive as documented |
| 4 | b-prime writes the bare kind | `ERROR: HONEST-01 verification failed: branch (b-prime) does not write computation_error_copy(v_protected_kind).` |
| 5 | b-prime writes `computation_status` | `ERROR: CR-01 verification failed: branch (b-prime) writes computation_status;` — the **re-keyed negative anchor** fires |
| 6 | b-prime stamps `computed_at` | `ERROR: CR-01 verification failed: branch (b-prime) stamps computed_at = now();` — second re-keyed negative anchor fires |
| 7 | copy function concatenates its input | `ERROR: HONEST-01 verification failed: computation_error_copy returned its own argument.` |
| 8 | ELSE arm returns NULL | `ERROR: HONEST-01 verification failed: computation_error_copy(NULL) is NULL.` |
| 9 | `permanent` arm collapsed into the retries arm | `ERROR: HONEST-01 verification failed: computation_error_copy does not yield exactly 3 distinct sentences` |
| 10 | copy-function REVOKE deleted (after GRANTing) | `ERROR: HONEST-01 verification failed: computation_error_copy is EXECUTEable by anon/authenticated` |

Mutations 5 and 6 are the important ones. The 161.1 block records that those two
negative anchors already went dead once when b-prime's SET expression changed; keyed on
`v_protected_error` they would have matched nothing against this body and become
anchors that cannot fire. Re-keying without re-witnessing would have been the same
failure a second time.

### SQL test arms — RED against the pre-fix bridge

Built by applying the ORIGINAL `20260825150000` with only its COMMENT patched to
satisfy both presence gates, so the arms actually ran against the raw-copying bridge:

```
ERROR:  ARM A FAILED (HONEST-01): raw operator text reached strategy_analytics.computation_error (mt5 gateway IPC timeout (-10005)). ...
ERROR:  ARM I FAILED (HONEST-01): raw operator text reached strategy_analytics.computation_error (mt5 gateway IPC timeout (-10005)) across the bounce.
```

And the third part of the invariant, witnessed by simulating the **rejected option 2**
(`mark_compute_job_failed` curating `last_error` too):

```
ERROR:  ARM A FAILED (HONEST-01): compute_jobs.last_error is Analytics could not complete. Retry the sync. — curating the USER surface must not curate the OPERATOR surface too. ...
```

Restored → `ALL 16 ARMS EXECUTED`.

### pytest — 3 mutations

`portfolio.py` baseline `0f4b4b7f2d28a17629a8dd3058c2da8dffc10ccaf27db0049cd9caec8aaec957`.

| Mutation | Observed |
|----------|----------|
| raw f-string restored at the catch-all | `AssertionError: raw exception text reached portfolio_analytics.computation_error: 'RuntimeError: canary_a41f9c_portfolio_boom'` + the AST census: `a _fail() call site interpolates exception state ...: ["f'{type(exc).__name__}: {str(exc)[:400]}'"]` |
| `exc_info=False` + redacted log message | `AssertionError: the exception text must survive on the operator surface ...` |
| constant degraded to `RuntimeError: …` | `AssertionError: the exception's TYPE NAME reached the user column` + the copy-shape pin |

### vitest — 3 mutations

| Mutation | Observed |
|----------|----------|
| appendix arm re-added to `wizardErrors.ts` | `× does NOT append computationError into GATE_ANALYTICS_FAILED cause`, `× does NOT append computationError into SYNC_FAILED cause` |
| appendix arm + `SyncPreviewStep` pass-through both restored | `× [162/C-2] the computation_error value never renders in the envelope` — `AssertionError: expected 'Analytics computation failed.The anal…' not to contain 'TypeError: \'>\' not supported betwee…'` |
| a `GATE_ANALYTICS_FAILED` fix line gutted | `× [162/C-2] the envelope still says what happened and what to do` — `expected … to contain 'Retry the sync from this page.'` |

`src/lib/wizardErrors.test.ts` carries a deliberate NUL byte, so it was edited with a
raw-mode perl splice, never a text-mode tool. NUL verified present after the edit
(line 1633).

## Deviations from plan

### 1. [Rule 4 → resolved by decision] Task 1 rewritten: the bridge, not the writers

Superseded by `162-02-DECISION.md`. Two `must_haves` truths were NOT implemented, and
deliberately:

- ~~"`classify_exception`'s bottom arms return curated fixed copy in the message
  slot"~~ — **NOT DONE.** That message flows only into `DispatchResult.error_message` →
  `compute_jobs.last_error` (verified: all 6 consumers in `job_worker.py`, 5 in
  `equity_reconstruction.py`, 1 in `allocator_positions.py`). Curating it is the
  rejected option 2 — it would strip the diagnosis from the operator surface and redden
  `test_allocator_positions.py:1345-1354`. `classify_exception` is byte-unchanged.
- ~~"curating the Python writers makes a bridge migration unnecessary"~~ — retracted;
  the migration is the fix.

The prior executor's choke-point split (`2ee6302ca`) is kept. It is correct and it is
the defence for any future path where the stamp is the last writer.

### 2. [Rule 2] The `WizardErrorContext` field and the pass-through were removed too

The plan asked only for the appendix concatenation. Deleting the arm alone leaves a
context field whose sole consumer is gone and whose name invites re-wiring. Removed at
three levels so TypeScript makes re-introduction deliberate.

### 3. [Rule 1] Composite Pin 2 rewritten — an unrepresentative fixture

`SyncPreviewStep.composite.render.test.tsx` asserted the envelope "names the failing
member from the scrubbed computation_error", fixture `Key 2 (deribit) failed to
reconstruct: geo-blocked`. **No writer produces that string.** Measured at HEAD, the
composite path writes `run_stitch_composite_job: ccxt member crawl geo-blocked —
<scrubbed ccxt exception>`. The pin protected a slot that was showing a function name
and an exception tail. Rewritten to the real value and the real property; the genuine
affordance (naming the member through a structured channel) is `deferred-items.md` D1.

### 4. [Rule 2] Two stale comments replaced beside their own fixes

`SyncPreviewStep.tsx`'s "computation_error is server-scrubbed and already threaded"
(its first half was the actual misunderstanding this phase closes) and the reaper SQL
test's "renders as a Details line under GATE_ANALYTICS_FAILED".

### 5. [Rule 2] A second applied-ness gate on the SQL test

Without it, running against a DB with `20260825150000` but not `20260826120000` makes
arms A and I fail with a copy MISMATCH — a message naming the wrong cause.

### 6. AST instead of regex in the `_fail` census

Written first as a regex; it matched the module's own prose (`"_fail() itself can raise
if Supabase is down"`) and captured three comment paragraphs as a finding. It was RED
for the right reason on the mutation under test, which is precisely how a check that
reads as coverage survives. Replaced with an `ast.walk` census, count-pinned at 5.

## Threat Flags

None. No new network endpoint, auth path, or file access. The one new SQL object is
`SECURITY INVOKER`, `IMMUTABLE`, references no tables, and is REVOKEd from
`PUBLIC`/`anon`/`authenticated` with an apply-time ACL assertion.

## Known Stubs

None.

## What I could NOT verify

1. **Nothing was run against PROD or the shared TEST database.** The SQL evidence above
   is from a throwaway PG16 with a hand-built fixture schema (`compute_jobs`,
   `strategy_analytics`, `auth.users`, `profiles`, `api_keys`, `strategies` — only the
   columns the two functions and the test touch). Real RLS, triggers, FKs and the rest
   of the migration chain were not in play. The migration's own self-verify runs at
   apply time, so PROD apply is itself the remaining check.
2. **The PROD `error_kind` distribution (64/55/10) was not re-measured** — no PROD
   access from the worktree. Cited from `162-02-DECISION.md`. The *structural* claim
   (non-NULL by construction) was measured here, from the code, and is the load-bearing
   one; the distribution only affects whether the arms are exercised, not whether they
   are correct.
3. **CI's `sql-tests` step was not run** as CI runs it. The two SQL test files were
   executed locally against the throwaway cluster; the arm-roster/count check in
   `.github/workflows/ci.yml` was not exercised (arm count unchanged at 16, roster
   untouched).
4. **The new copy has not been seen by a human on a real screen.** It is pinned by
   tests and by shape assertions, not by eyes.

## Self-Check: PASSED

- `supabase/migrations/20260826120000_computation_error_curated_copy.sql` — FOUND
- `analytics-service/tests/test_computation_error_curated.py` — FOUND
- `.planning/phases/162-honest-what-the-user-sees-is-true/deferred-items.md` — FOUND
- commits `544f3cf2c`, `f1d969cf3`, `fcf8e397a` — all FOUND in `git log --all`
