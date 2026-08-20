---
phase: 142-job-strategy-analytics-stuck-computing-reaper-computing-star
reviewed: 2026-08-02T00:00:00Z
depth: deep
reviewer: gsd-code-reviewer (independent second pass)
files_reviewed: 21
files_reviewed_list:
  - supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql
  - supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql
  - analytics-service/services/job_worker.py
  - analytics-service/services/analytics_runner.py
  - analytics-service/services/ingestion/long_fetch.py
  - analytics-service/scripts/reset_stuck_computing_rows.py (deleted)
  - analytics-service/tests/test_computing_started_at_stamp.py
  - analytics-service/tests/test_job07_reaper_off_worker_loop.py
  - analytics-service/tests/test_main_worker.py
  - src/app/api/keys/sync/route.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/lib/types.ts
  - src/lib/utils.ts
  - src/__tests__/analytics-format.test.ts
  - src/__tests__/phase-52-container-tabular-nums.test.tsx
  - src/components/charts/WorstDrawdowns.test.tsx
  - src/components/strategy/CompareTable.test.tsx
  - src/components/strategy/StrategyGrid.test.tsx
  - src/components/strategy/StrategyTable.test.tsx
  - src/components/strategy/discovery-selectors.contract.test.tsx
findings:
  critical: 0
  blocker: 0
  warning: 4
  info: 0
  total: 4
status: issues_found
---

# Phase 142: Code Review Report (independent second pass)

**Reviewed:** 2026-08-02
**Depth:** deep (cross-language: SQL / Python / TypeScript, plus call-chain tracing)
**Files Reviewed:** 21 source files (planning artifacts and the dirty `.planning/` + `TODOS.md` working-tree edits excluded per instruction)
**Status:** issues_found — 0 blockers, 4 warnings

## Summary

I found **no blocker**. I traced every state transition of
`strategy_analytics.computation_status` / `computing_started_at` across all four
runtimes (the re-based SQL bridge, the pg_cron body, the Python worker, the
Next.js API routes) looking specifically for the two failure classes that matter
here — a false success on a money surface, and a permanently stranded spinner —
and could not construct either from this diff.

Things I actively tried to break and could not:

- **Missed `'computing'` writer.** Repo-wide grep confirms exactly one Python
  writer (`analytics_runner._mark_computing`) and one SQL writer (bridge branch
  (a)). `set_wizard_composite_members` (20260712120000) is scoped to
  `complete`/`complete_with_warnings` only; the cutover RPCs
  (20260428142831, 20260514045627) touch `metrics_json` only. No TS writer sets
  `'computing'`.
- **`(computing, NULL)` produced by the new bridge.** Arm 1 clears the stamp
  only in the same CASE branch that resolves the status to
  `complete_with_warnings`, and Arms 2/3 stamp-or-keep. The two CASEs read the
  same pre-`UPDATE` row, so they cannot disagree.
- **Re-base fidelity.** I diffed the new `sync_strategy_analytics_status` body
  against `20260710150000` (confirmed the latest defining migration). The only
  deltas are the `computing_started_at` maintenance and one comment
  back-reference. `d.kind = f.kind`, `d.created_at > f.created_at`, both
  `computation_warned` marker reads, SECDEF, `search_path`, and the
  `REVOKE ALL` all survive intact.
- **Reaper safety conjunct vs. composites.** Composite fan-out runs *inside* one
  `stitch_composite` job carrying the composite's own `strategy_id`, so the
  `NOT EXISTS (active compute_jobs)` conjunct holds for the entire fan-out. No
  false-failure path there.
- **Negative anchors.** The STEP 7 `computing_started_at\s*=\s*now\(\)` negative
  regex is not tripped by the legitimate `VALUES (..., now())` arm or by the
  `THEN now()` CASE arm. The drift gate's `$cron$` scoping correctly avoids the
  header prose that discusses `computed_at`.
- **Type change.** `npx tsc --noEmit` is clean (exit 0) with
  `computing_started_at` made a required member of `StrategyAnalytics`.
- **Gates actually run.** `sql-tests` in `.github/workflows/ci.yml:959` globs
  `supabase/tests/test_*.sql`, so the new SQL gate is auto-discovered; the
  `python` job runs the full `analytics-service` suite. Both new Python suites
  pass locally from `analytics-service/` (5 + 6 tests).

The four warnings below are all real and all have concrete paths. The first is
the one I would actually fix before merge, because it silently invalidates a
number the migration header advertises as its "cadence honesty" claim.

## Warnings

### WR-01: `_mark_computing` re-advances the stamp mid-chain, contradicting Arm 3 and inflating the real reap window by ~10h

**File:** `analytics-service/services/analytics_runner.py:1227-1241`
(and the claim it invalidates: `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql:32-36`)

**Issue.** The comment on the new stamp asserts:

```
# Unconditional here is correct — every invocation of
# this writer genuinely transitions the row INTO computing.
```

That is false on the queue path, which is the only live caller.
`run_csv_strategy_analytics` is reached exclusively from the
`compute_analytics_from_csv` job handler, i.e. the **last** hop of
`process_key_long -> sync_trades -> derive_broker_dailies ->
compute_analytics_from_csv`. By the time it runs, the row has already been at
`computation_status='computing'` since hop 1 — the bridge stamped it there
(branch (a) VALUES arm on a fresh row, or Arm 2 from `pending`/`complete`) and
Arms 3 deliberately *kept* that stamp across hops 2 and 3, with an eleven-line
comment explaining why advancing it would be the Phase 106 bug. The Python
writer then advances it anyway.

**Concrete path and wrong output.**

1. Wizard finalize enqueues `process_key_long` for strategy S. Row S is
   `pending`.
2. `mark_compute_job_done(process_key_long)` -> bridge branch (a) -> Arm 2
   stamps `computing_started_at = T0`.
3. Hops 2 and 3 complete; each bridge call hits Arm 3 and keeps `T0`. Correct.
4. `compute_analytics_from_csv` is claimed at `T0 + 9.5h` worst case (hops 1-3
   cost 34,290 s by the phase's own `_chain_inclusive_ceiling_seconds` model:
   43,920 s total minus the 9,630 s hop-4 cost). `_mark_computing` overwrites
   the stamp with `T0 + 9.5h`.
5. The handler is killed (worker OOM / Railway redeploy) and the retention
   purge (`20260720120000`) later DELETEs the orphaned job rows, which is the
   stranding condition the migration header names.
6. The reaper now fires at `T0 + 9.5h + 16h + <=15 min`, i.e. **~25.8h** after
   the row entered `computing`, not the `~16h15m` the migration header states
   as its worst case end-to-end under the heading "CADENCE HONESTY".
   `compute_analytics_from_csv` retries (3 attempts, 630 s backoff) each
   re-stamp, pushing it to ~28h.

**Impact.** Not a correctness break — the reaper still fires, and the direction
is conservative (later, never earlier, so it cannot mis-reap a healthy chain).
The cost is user-visible spinner duration on the return-later / factsheet path,
roughly 1.75x the advertised bound, and the invariant is now inconsistent across
the two runtimes: SQL is documented at length as "never advance", Python
advances unconditionally. The static gate cannot catch this — it only checks
that the key is present and non-`None`. `TestReaperThresholdInvariant` cannot
catch it either: it derives `16h > 12.2h chain ceiling` on the assumption that
the stamp measures the whole chain, which after this writer it does not.

**Fix.** Make the Python writer honour the same "stamp only on transition in"
rule. A PostgREST payload cannot express a conditional, so split it:

```python
def _mark_computing() -> None:
    supabase.table("strategy_analytics").upsert(
        {"strategy_id": strategy_id, "computation_status": "computing"},
        on_conflict="strategy_id",
    ).execute()
    # JOB-01: stamp ONLY when the row was not already computing, mirroring the
    # bridge's Arm 3. A blind now() here re-advances the clock on the LAST hop
    # of a multi-hop chain and inflates the reap window by the chain's own
    # duration.
    supabase.table("strategy_analytics").update(
        {"computing_started_at": datetime.now(timezone.utc).isoformat()}
    ).eq("strategy_id", strategy_id).is_("computing_started_at", "null").execute()
```

This preserves the NULL-stamp closure (a fresh row still gets stamped, because
the column defaults to NULL) while never advancing an existing stamp. If you
instead choose to keep the blind stamp, then **the header's `~16h15m` worst-case
claim and the `TestReaperThresholdInvariant` docstring must be corrected**, or
the phase ships a documented number that the code does not produce.

---

### WR-02: `(computing, NULL)` rows are unreachable by every mechanism this phase ships — reaper, gate, and operator surface

**File:** `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql:103-107, 165-168, 514`

**Issue.** The reaper's `computing_started_at IS NOT NULL` conjunct makes a
NULL-stamp `computing` row permanently invisible. The migration argues this is
safe because "detection of that writer bug is the STATIC CI stamp invariant".
That argument does not hold: a static source scan detects *source omissions in
two scanned surfaces*; it detects **nothing about rows that already exist in the
database**. There is no runtime detection, no alert, no cron arm, and no
operator surface beyond a hand-run SQL snippet buried in a migration comment.
So for the NULL-stamp subset, the permanent-spinner class this phase exists to
close remains fully open, silently.

**Concrete producers, in descending likelihood.**

1. **Deploy-ordering window.** Merging `supabase/migrations/**` to `main`
   auto-applies to PROD, but the Railway worker only redeploys after `main` CI
   is green (and skips entirely while `main` is red). During that gap, the
   *old* `_mark_computing` runs against the *new* schema. On the common queue
   path the bridge has already stamped the row so nothing is lost — but when
   `compute_analytics_from_csv` is the **first** job for a strategy (no prior
   bridge call), the old writer's partial upsert leaves `(computing, NULL)`. If
   that job's row is then reaped by the orphaned-running purge
   (`20260720120000`, 4h window) before a terminal write, the strategy is
   stranded and no mechanism in this phase can ever see it. The migration's
   STEP 2 backfill handles rows already `computing` *at apply time* and nothing
   after.
2. **Out-of-gate writers.** `test_computing_started_at_stamp.py`'s own docstring
   scopes the TS half to `src/app/api/**/*.ts` and explicitly states that a
   future writer in `src/lib/`, a server action, or a page component is outside
   coverage. Such a writer produces exactly this state with a green build.
3. **Direct PostgREST / SQL writes** (ops scripts, manual repair) — no gate
   applies at all.

**Impact.** A user on a stranded strategy sees the wizard/factsheet
loading-or-computing state forever, with no self-heal and no operator signal.
This is the pre-existing status quo rather than a regression the phase
introduces, which is why I am filing it as a warning and not a blocker — but the
phase's stated goal is to close that class, and it leaves a hole in it with zero
observability.

**Fix.** Give the reaper a second, non-destructive arm that *starts the clock*
instead of terminalizing. This preserves the "never destructively reap a writer
bug" rule while removing the permanence:

```sql
-- Companion statement in the same cron body: a NULL-stamp 'computing' row with
-- no active job is a writer bug we cannot date. Do NOT terminalize it — start
-- its clock so the main arm can reap it one threshold from now, and so it shows
-- up in cron.job_run_details rather than vanishing.
UPDATE public.strategy_analytics sa
   SET computing_started_at = now()
 WHERE sa.computation_status = 'computing'
   AND sa.computing_started_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.compute_jobs cj
      WHERE cj.strategy_id = sa.strategy_id
        AND cj.status IN ('pending','running','done_pending_children','failed_retry')
   );
```

If that is judged out of scope for 142, the honest alternative is to log it as a
named backlog item and remove the claim that the static gate is the detection
mechanism for this state — it is not.

---

### WR-03: the SQL gate's neutralization UPDATE is the only unscoped write in `supabase/tests/`, and `sql-tests` has no concurrency group

**File:** `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:340-343`
(and `.github/workflows/ci.yml:830-1000`)

**Issue.**

```sql
UPDATE public.strategy_analytics
   SET computing_started_at = NULL
 WHERE computation_status = 'computing'
   AND strategy_id <> ALL (v_seeded);
```

Every other assertion in this file (and in the sibling SQL gates) is scoped to
its own seeded `strategy_id` set. This one is not: it touches rows belonging to
other tenants and other concurrent CI runs. The `python` job in `ci.yml` carries
an explicit cross-PR `concurrency:` group precisely because the TEST Supabase
project (`qmnijlgmdhviwzwfyzlc`) is shared across concurrent runs — `sql-tests`
carries **no** such group, so two PR runs can execute this statement against the
shared project simultaneously.

**Concrete path.** PR-A's `sql-tests` reaches Part 2 while PR-B holds an
uncommitted row-lock on a *committed* `strategy_analytics` row at
`computation_status='computing'` (e.g. the bridge write inside
`test_sync_status_supersede_failed_per_kind.sql`, which alphabetically follows
this file and therefore runs concurrently with it across two runs). PR-A's
UPDATE matches that row, blocks on PR-B's xid, hits
`SET LOCAL lock_timeout = '5s'`, and raises `55P03 lock_not_available`. Under
`psql -v ON_ERROR_STOP=1` the `sql-tests` job goes RED on PR-A for a reason with
nothing to do with PR-A's diff. This is the repo's known shared-test-DB flake
class.

**Honest probability caveat.** Under READ COMMITTED, uncommitted *inserts* from
a concurrent transaction are invisible and take no lock, and both the authoring
census and the rollback discipline of the SQL gates mean the count of
*committed* `'computing'` rows on TEST is normally zero. So the collision needs
a committed `'computing'` row that a concurrent run has locked — reachable
(e2e-seeded runs drive real syncs) but not frequent. The header reasons about
this and chooses fail-loud; my objection is that fail-loud here means a red gate
on an *innocent* PR, which is the outcome the `python` job's concurrency group
exists to prevent.

**Fix.** Cheapest and matching existing repo practice — add the same cross-run
serialization the `python` job already has:

```yaml
  sql-tests:
    concurrency:
      group: shared-test-supabase-sql
      cancel-in-progress: false
```

Optionally also narrow the neutralization to rows this run could plausibly be
crowded out by (`AND computing_started_at < v_fresh - interval '16 hours'`),
which is the only subset that can actually consume the LIMIT 25 budget.

---

### WR-04: the `JOB_CHAIN_FOLLOW_ON` tuple-unpack moved outside the try/except that the surrounding comment says must never let this block crash the handler

**File:** `analytics-service/services/ingestion/long_fetch.py:588-592`

**Issue.** The replaced code was a self-contained conditional expression that
could not raise. The new code performs a dict lookup and a **fixed-arity 2-tuple
unpack** on a constant that is explicitly advertised as the editable topology
map, and it sits *above* the `try:` at line 599 — whose comment states the
requirement in so many words:

> "The verification is already 'published', so a worker retry short-circuits on
> that status (idempotency check above) and would NOT re-run this tail —
> therefore we must NOT let an enqueue blip crash the handler."

**Concrete path (latent — requires a source edit, stated honestly).** Someone
adds a third follow-on edge to `process_key_long` in `job_worker.py:505-506` —
a natural-looking edit, since the constant's own docstring invites topology
maintenance and its coverage test
(`TestReaperThresholdInvariant`, "Coverage (i)") only checks *membership* in
`TIMEOUT_PER_KIND`, never arity. `ledger_tail, trade_tail = (...)` then raises
`ValueError: too many values to unpack` **outside** the guard, propagating out
of `run_process_key_long_job`. Because the verification is already `published`,
the retry short-circuits on the idempotency check and never re-runs the tail —
so the strategy is left published with no analytics chain enqueued and no
`strategy_analytics` write at all. That is a worse outcome than the enqueue blip
the guard was written for.

**Fix.** Index explicitly (self-documenting, arity-tolerant) and move the lookup
inside the guard:

```python
try:
    from services.job_worker import JOB_CHAIN_FOLLOW_ON

    _tails = JOB_CHAIN_FOLLOW_ON["process_key_long"]
    # Order is load-bearing: index 0 = ledger-backed tail, 1 = trade-backed.
    tail_kind = _tails[0] if is_ledger_backed else _tails[1]
    supabase.rpc(...)
except Exception as exc:  # noqa: BLE001
    log.error("process_key_long.enqueue_tail_failed", ...)
```

and add an arity pin to the topology test so the coupling is visible at edit
time:

```python
assert len(JOB_CHAIN_FOLLOW_ON["process_key_long"]) == 2, (
    "long_fetch.py selects the tail by POSITION (ledger, trade). Changing this "
    "tuple's arity changes real enqueue behavior — update both together."
)
```

---

## Notes on things deliberately NOT filed

Per the standing stopping rule (block only on user-facing or data-integrity
impact), I dropped the following after constructing and then rejecting the path:

- **Reaper's outer `WHERE` fence re-checks only `computation_status`, not the
  `NOT EXISTS` conjunct.** A retry enqueued between the sub-select and the
  `UPDATE` could see a momentary `failed` flash. The window is intra-statement
  (microseconds) and the next bridge call self-heals it via Arm 2. Not a
  finding.
- **`StrategyAnalytics.computing_started_at` is now required in TS but absent
  from `ANALYTICS_COLUMNS` / `PUBLIC_ANALYTICS_COLUMNS` select lists**, so it is
  `undefined` at runtime while typed `string | null`. Nothing in `src/` reads
  it. No user impact.
- **The static gate's `ast.Name` status arm assumes variable-status writers are
  always exits.** True today (`csv_status`, `composite_status`); would enforce
  the wrong rule for a future variable-status *entry* writer. Requires a future
  edit and produces a red build rather than a wrong result. Dropped.
- Prose, comment wording, citation accuracy and stale integers in the migration
  header — out of scope by policy, except where a stated number is falsified by
  shipped code (WR-01), which is why that one is filed.

---

_Reviewed: 2026-08-02_
_Reviewer: Claude (gsd-code-reviewer), independent second pass_
_Depth: deep_
