# Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence — Research

**Researched:** 2026-08-17
**Domain:** PostgreSQL / pg_cron retention janitors on `public.compute_jobs`; worker claim lifecycle
**Confidence:** HIGH on everything answerable from the repo. The two DB-only facts are marked UNVERIFIED and each carries the exact query that settles it.
**Researched at:** branch `feat/v1.19-phase-144`, HEAD `c4615188126c4b7464bb4c783d07809193d9f492`
**Tools available to this agent:** filesystem + git only. **No Supabase MCP, no psql, no DB access.** Every "live" claim below is either quoted from `144-CONTEXT.md`'s census or explicitly marked UNVERIFIED.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**The core change (WR-02)**
- **DELETE → terminal UPDATE.** The founder's open WR-02 DELETE-vs-reset call resolves to a **terminal UPDATE**, per ROADMAP SC#1. The row must survive so a poller sees a real outcome and the audit trail holds until `retention_compute_jobs_failed` (jobid 8, 90 days) collects it. ⛔ Never `DELETE`.
- **Terminal status = `failed_final`, not `failed_retry`.** SC#1 says "a terminal `failed` status"; the `compute_jobs` vocabulary distinguishes `failed_retry` (will be retried) from `failed_final`. An orphan must not be re-queued by the retry path, so `failed_final` is the correct value. ⚠️ VERIFY the exact CHECK vocabulary at HEAD before writing the migration — do not trust this line.
- **Write a user-facing reason.** The point of SC#1 is a poller seeing a *real outcome*; a terminal row with no explanation is only half the fix. Populate whatever `compute_jobs` field the wizard surfaces (there is a `user_message` column in the family — confirm at HEAD) with a cause naming orphan-reaping, not a bare status flip.
- **NEW migration layered on `20260720120000`.** The shipped migration is never edited (SC#3). `cron.unschedule`-then-`cron.schedule` is the repo's canonical re-apply pattern.

**Cadence and threshold**
- **Threshold UNCHANGED at 4 hours.** The WORKER-04 2h→4h lesson is explicit: **the threshold, not the frequency, is what protects live jobs.** Do not shrink it while tightening cadence.
- **Cadence tightened from daily to hourly**, dropping detection latency from ~24h to ~1h. Pick a minute clear of every registered slot — ⚠️ `:35` is now taken by Phase 143's sweep (jobid 18), and 142's reaper occupies the `*/15` grid (`:00/:15/:30/:45`). Verify live before choosing.
- **Cadence honesty**, in 142's and 143's register: the cadence is post-threshold *detection latency*. Worst case end-to-end is ≈ threshold + cadence. It does not bound user-visible wait; say so.

**The NULL-`claimed_at` arm (ADDED by measurement — founder call 2026-08-17)**
- **INCLUDED.** A second arm terminalizes `running` rows with `claimed_at IS NULL`, keyed on **`created_at`** with its **own, longer** threshold — `created_at` is not a claim time, so the 4h figure does not transfer and must be **derived**, not copied. A bare number with no derivation is what Phase 106's janitor was reverted for.
- **Find the writer.** `status='running'` + `claimed_at IS NULL` violates an invariant. Trace what sets `running` without stamping `claimed_at` (start at the claim RPC and the `poll_positions` handler — all 6 rows are that kind). If the root cause is cheap, fix it; if it is a real investigation, record the finding precisely and file it rather than guessing. ⛔ Do **not** ship only the janitor arm and call the invariant closed — that is treating the symptom (Rule 6).
- **Consider an invariant gate** so a future NULL-claim `running` row is detected rather than silently accumulating for 14 days again.

**SC#4 — stale `pending`**
- **WON'T-FIX, carrying the measurement.** SC#4 sanctions this explicitly ("zero on prod is a valid, budget-saving outcome"). PROD exposure is zero and structurally so (Finding 3). Record the numbers and the reasoning in the phase SUMMARY and in `REQUIREMENTS.md` under JOB-08 — a WON'T-FIX without its measurement attached is just a skip.
- ⛔ Two named traps stand regardless: never `DELETE` a `pending` row; never `cron.unschedule(9)`.
- TEST's 2819-row backlog is a **CI hygiene** problem (a known flake mechanism), not a product one. File it separately; do not solve CI's problem in production code.

### Claude's Discretion

- Migration filename/timestamp, cron job name, the NULL-claim threshold value and its derivation, the exact cadence minute, `LIMIT`/bounding shape, and test file names.
- Whether the writer-bug fix lands in this phase or is filed with evidence.

### Deferred Ideas (OUT OF SCOPE)

- TEST's 2819-row stale-`pending` backlog as a CI-hygiene fix (drain or a TEST-only cleanup). → TODOS.
- A stale-`pending` production sweep — WON'T-FIX today on zero measured PROD exposure; revisit only if a future census shows non-zero.
- Correcting `20260802120000` (142's reaper) header, which relies on the same falsified `return_message` premise. Already filed by Phase 143. → TODOS.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description (verbatim from REQUIREMENTS.md) | Research Support |
|----|---------------------------------------------|------------------|
| JOB-05 | "The existing orphaned-`running` `compute_jobs` purge transitions rows to a terminal `failed` status instead of bare `DELETE` (so pollers break out and the audit trail survives), at a tightened cadence with the 4h `claimed_at` threshold UNCHANGED; delivered as a NEW migration layered on `20260720120000`, reconciling the TEST-DELETE / PROD-reset split (WR-02)." (`.planning/REQUIREMENTS.md:55`) | §1 (exact vocabulary), §2 (what "pollers break out" actually means at HEAD), §5 (cadence slot), §7 (retention interaction — the audit trail is NOT automatic), §8 (the shipped gate that asserts DELETE and must change with it) |
| JOB-08 | "The retention family's **stale-`pending` gap is decided on measured evidence, not skipped by default** … the outcome is EITHER a sweep added as a fourth swept status … OR an explicit WON'T-FIX carrying that measurement …" (`.planning/REQUIREMENTS.md:57`) | §9 — WON'T-FIX is correct; the census numbers to carry, and the trap the requirement itself names (`cron.unschedule(9)` reddens `test_derive_allocator_keys_fanout.sql` assertion 6) |
</phase_requirements>

---

## Summary

Six questions were asked. Five are answered from source with file:line; one (the NULL-claim writer) is answered to a named, falsifiable hypothesis with the exact query that confirms or kills it.

**Two CONTEXT.md claims are WRONG and are corrected below.** There is **no `user_message` column** on `compute_jobs` — it is a synthesised output column of the `get_user_compute_jobs` RPC — and **the wizard poller never reads it**, so "populate the user-facing field" as written cannot be done and would not be seen if it could. The live cron-slot list is also incomplete (it omits `15 3 * * *` and the hourly `0 * * * *`).

**Three things nobody has flagged yet, and all three are blockers.** (a) `supabase/tests/test_retention_orphaned_running.sql:161-164` asserts the orphan row is **GONE** — the shipped SQL gate encodes DELETE, so the moment the migration lands on TEST that gate reds; it must change in the same PR. (b) The same file at `:110-114` does `(split_part(schedule,' ',2))::INT` on the cron schedule — an hourly `'50 * * * *'` makes field 2 a literal `*` and that cast raises `22P02`, which is a hard error, not a skip. (c) `retention_compute_jobs_failed`'s deployed body keys on `COALESCE(next_attempt_at, created_at) < now() - interval '90 days'` (`20260515210200:255-259`), and the claim RPC never advances `next_attempt_at` — so flipping status alone can leave a sufficiently old orphan eligible for DELETE on the *very next* nightly tick, destroying the exact audit trail SC#1 promises.

**The strongest positive finding** is the one that turns `failed_final` from a vocabulary guess into a mechanism: Phase 142's deployed reaper skips any strategy holding a `compute_jobs` row in `('pending','running','done_pending_children','failed_retry')` (`20260803130000:118-121` and `:139-142`). `failed_final` is the **only** terminal-failure value not in that set. Terminalizing to `failed_final` therefore *unblocks 142's reaper*, which then writes the real user-facing string on `strategy_analytics`. Choosing `failed_retry` would keep it blocked forever.

**Primary recommendation:** ship ONE migration `20260817xxxxxx_retention_orphaned_running_terminalize.sql` that re-registers `retention_compute_jobs_orphaned_running` at `'50 * * * *'` with a two-arm bounded `UPDATE … SET status='failed_final', next_attempt_at=now(), error_kind='permanent', last_error='<reaper reason>'` (arm A: `claimed_at < now()-4h`; arm B: `claimed_at IS NULL AND created_at < now()-48h`), and **rewrite `supabase/tests/test_retention_orphaned_running.sql` in the same PR**. Do **not** re-enqueue (§6). Do **not** write to `metadata` beyond a small marker (8 KB CHECK, `20260515210000:145-148`).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detect + terminalize orphaned `running` jobs | Database (pg_cron) | — | JOB-07 constrains this to pg_cron; the worker is the thing that is down, so it cannot be the detector |
| Surface the outcome to a wizard poller | API (`/api/strategies/[id]/sync-progress`) | Client (`SyncPreviewStep.tsx`) | Already wired; §2 shows the janitor needs to write nothing new for this to work |
| Surface the outcome on `strategy_analytics` | Database (Phase 142 reaper) | — | Terminalizing unblocks the reaper's `NOT EXISTS` conjunct; no new bridge call needed (§7) |
| Recover the lost work | Database cron fan-outs / user retry | — | §6: per-kind, either an existing cron re-enqueues automatically or a human must; the janitor must do neither |
| Prove the deployed body is right | CI `sql-tests` job | — | `supabase/tests/test_*.sql` is the only path that runs in CI (`.github/workflows/ci.yml:1018-1036`) |

---

## §1 — The exact `compute_jobs.status` CHECK vocabulary at HEAD

**Verdict: CONTEXT.md's `failed_final` / `failed_retry` distinction is CORRECT. Its instruction to distrust it was right to issue, and the check passes.**

### The authoritative definition

The constraint is an **inline column CHECK** created with the table and **never re-defined by any later migration**.

`supabase/migrations/20260411144407_compute_jobs_queue.sql:112-120` — verbatim:

```sql
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending',
                      'running',
                      'done',
                      'done_pending_children',
                      'failed_retry',
                      'failed_final'
                    )),
```

**Allowed values (exact, 6):** `pending`, `running`, `done`, `done_pending_children`, `failed_retry`, `failed_final`. [VERIFIED: supabase/migrations/20260411144407_compute_jobs_queue.sql:112-120]

### Re-base discharge (the standing rule)

I grepped every migration for a later redefinition. `ALTER TABLE compute_jobs … DROP/ADD CONSTRAINT` appears **only** for `compute_jobs_target_xor`, `compute_jobs_kind_target_coherence`, `compute_jobs_kind_check`, `compute_jobs_idempotency_key_safe`, `compute_jobs_metadata_size_bounded` and `compute_jobs_claimed_by_safe`. **No migration touches the status CHECK.** The 032 definition is the latest definition. [VERIFIED: grep over `supabase/migrations/*.sql` for `ALTER TABLE.*compute_jobs`, `compute_jobs_status`, `ADD CONSTRAINT.*compute_jobs`]

### Independent corroboration in TypeScript

`src/lib/sync-progress.ts:80-86` mirrors it exactly and names the migration as its source:

```ts
export type StitchJobStatus =
  | "pending"
  | "running"
  | "done"
  | "done_pending_children"
  | "failed_retry"
  | "failed_final";
```
[VERIFIED: src/lib/sync-progress.ts:80-86]

### ⭐ Why `failed_final` is the ONLY correct choice — the mechanism, not the vocabulary

CONTEXT justified `failed_final` by semantics ("must not be re-queued by the retry path"). True, but there is a much harder reason, and it should go in the migration header.

Phase 142's **deployed** reaper body skips any strategy that still holds a non-terminal job:

`supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql:139-142` — verbatim:

```sql
         AND NOT EXISTS (
               SELECT 1
                 FROM public.compute_jobs cj
                WHERE cj.strategy_id = s.strategy_id
                  AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
             )
```
(the same conjunct appears on the clock-start arm at `:118-121`.)

`failed_retry` **is** in that set. `failed_final` is **not**. So:

- Terminalize to `failed_final` → the strategy leaves 142's exclusion → 142 stamps `computing_started_at` within ≤15 min and, 16h later, writes `computation_status='failed'` with the user-facing string `'Analytics was interrupted before it could finish and did not recover. Retry the sync.'` (`20260803130000:148-151`).
- Terminalize to `failed_retry` → 142's reaper stays blocked **forever**, exactly as it is today with `running`. The phase would have moved the row without moving the outcome.

Also, `failed_retry` is a **claimable** status (`20260719073701:204` re-checks `cj.status IN ('pending','failed_retry')`), so it is not terminal at all. [VERIFIED: supabase/migrations/20260719073701_claim_kind_filter.sql:204]

**Additional constant needed by the migration:** `error_kind TEXT CHECK (error_kind IN ('transient','permanent','unknown'))` — `supabase/migrations/20260411144407_compute_jobs_queue.sql:127`, never re-defined. [VERIFIED: supabase/migrations/20260411144407_compute_jobs_queue.sql:127]

---

## §2 — Is there a user-facing message column on `compute_jobs`? ⛔ CONTEXT.md IS WRONG

**Verdict: NO. There is no `user_message` column on `compute_jobs`. And the wizard poller reads `status` only — it explicitly refuses to project any message field.**

CONTEXT.md line 118 says: *"Populate whatever `compute_jobs` field the wizard surfaces (there is a `user_message` column in the family — confirm at HEAD)."* Both halves are false. This is the Phase-143-style load-bearing claim that had to be caught before the migration was written.

### (a) `user_message` is a synthesised RPC output column, not a table column

The `compute_jobs` DDL at `20260411144407:106-151` has no such column, and no migration adds one. `user_message` was introduced by `20260510181014_compute_jobs_user_message_and_rate_limit_grief.sql` **as a computed member of `get_user_compute_jobs`'s `RETURNS TABLE`**. Its own header says so:

> `-- 15:   user_message TEXT computed inside the RPC based on` … `-- 149: The user_message text is computed from (status, error_kind)`
[VERIFIED: supabase/migrations/20260510181014_compute_jobs_user_message_and_rate_limit_grief.sql:15, :149]

The **latest** definition (re-based per the standing rule — 111's version was dropped and re-created by the audit-residual migration) is `supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql:735-810`. Its message arm, verbatim (`:784-797`):

```sql
    CASE
      WHEN cj.status = 'failed_final' AND cj.error_kind = 'permanent' THEN
        'We hit a problem we can''t retry automatically. Please contact support.'
      WHEN cj.status = 'failed_final' THEN
        'Tried multiple times without success. Please contact support.'
      WHEN cj.status = 'failed_retry' THEN
        'Temporary issue — retrying automatically.'
      WHEN cj.status IN ('pending', 'running', 'done_pending_children') THEN
        NULL
      WHEN cj.status = 'done' THEN
        NULL
      ELSE
        NULL
    END::TEXT AS user_message
```
[VERIFIED: supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql:784-797]

⇒ There is **nothing to populate**. The message is a pure function of `(status, error_kind)`. Setting `status='failed_final'` + `error_kind='permanent'` already yields the first arm. A janitor cannot write a bespoke orphan-reaping string here without changing the RPC.

Note also `last_error` is **hard-redacted** in the same RPC: `NULL::TEXT AS last_error,   -- redacted; see mig 032 STEP 16 comment` (`20260516104201:780`), and the zod contract pins that redaction with `last_error: z.null()` (`src/lib/analytics-schemas.ts:195`). So `last_error` is an **operator/audit** channel, never a user channel — which is exactly the right place for a verbose orphan-reaping reason. [VERIFIED: supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql:780; src/lib/analytics-schemas.ts:195]

### (b) The read path, traced end to end — and it never touches `user_message`

`compute_jobs` is RLS deny-all, so the only owner-scoped read is the SECURITY DEFINER RPC. The one route that calls it:

1. **Route** — `src/app/api/strategies/[id]/sync-progress/route.ts:168-171` calls `supabase.rpc("get_user_compute_jobs", { p_strategy_id: id, p_limit: 20 })`.
2. **Row shape it declares** — `:102-110`, five fields only: `kind`, `status`, `claimed_at`, `created_at`, `metadata`. `user_message` is not in the interface.
3. **The projection** — `:246-247` carries an explicit comment: *"touch ONLY member_progress (never last_error / user_message / source / correlation_id / ciphertext)"*.
4. **What it emits** — `:294`: `const body: SyncProgressResponse = { jobStatus, stalled, memberProgress };` and `jobStatus` is `(latest.status ?? null)` at `:284`.
5. **Wire contract** — `src/lib/sync-progress.ts` header: *"TOP-LEVEL WHITELIST — these three keys and nothing else."*
6. **Client** — `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:207-214`:

```ts
const FINISHED_JOB_STATUSES: readonly StitchJobStatus[] = [
  "done",
  "failed_final",
];

function isJobInFlight(jobStatus: StitchJobStatus | null): boolean {
  return jobStatus !== null && !FINISHED_JOB_STATUSES.includes(jobStatus);
}
```
[VERIFIED: src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:207-214]

### ⭐ Consequence for SC#1 — good news

**The status flip alone satisfies "a poller sees a real outcome."** `failed_final` is already in `FINISHED_JOB_STATUSES`, so the instant the janitor flips the row:
- `isJobInFlight()` → false (`SyncPreviewStep.tsx:212-214`),
- `jobsHaveFinished()` → true (`:238-240`),
- `isAutoRetrying` (`:2524`, gated on `failed_retry`) stays false, so the manual Retry CTA is **not** suppressed — the user gets an exit.

Today the row sits at `running` forever and `isJobInFlight` is permanently true. That is the defect, and `status='failed_final'` is the whole fix on this surface.

**Confirmed non-consumer:** `user_message` appears in exactly two non-test places in `src/` — the zod schema `src/lib/analytics-schemas.ts:203` and the generated `src/lib/database.types.ts:3881`. **No component renders it.** The sync-progress route does not even use the zod schema (it declares its own `ComputeJobRow` at `:102`). [VERIFIED: grep `user_message|userMessage` over `src/` excluding `.test.`]

### Recommendation

| Column | Write? | Value | Why |
|---|---|---|---|
| `status` | **YES** | `'failed_final'` | The only field the poller reads; unblocks 142's reaper (§1) |
| `next_attempt_at` | **YES** | `now()` | Retention correctness — see §7. Non-optional. |
| `error_kind` | **YES** | `'permanent'` | Selects the accurate `user_message` arm ("can't retry automatically"), and matches the column's documented meaning: *"permanent = skip retries, go directly to failed_final"* (`20260411144407:159-160`) |
| `last_error` | **YES** | e.g. `'orphaned_running_reaped: no worker heartbeat past the 4h claim window (retention_compute_jobs_orphaned_running)'` | The audit trail. Redacted from users by design; visible to service-role/admin. |
| `claimed_by` | **NO** | — | Preserve which worker last held it. Precedent: audit M-0779 deliberately stopped `mark_compute_job_failed` from clearing it (`20260516104201:917-928`). Also `compute_jobs_claimed_by_safe` CHECK (`20260515210000:247-253`) constrains the charset. |
| `claimed_at` | **NO** | — | Preserve the forensic timestamp; it is what the predicate matched on. |
| `attempts` | **NO** | — | Not a real attempt outcome; don't fabricate one. |
| `metadata` | Optional, small | a marker key only | ⚠️ `compute_jobs_metadata_size_bounded` CHECK caps `octet_length(metadata::text) <= 8192` (`20260515210000:145-148`). A `||` append on a row that already carries `unified_backbone_at_claim` etc. is fine at this size, but the ceiling is a hard CHECK — a violation aborts the whole pg_cron tick. |

⚠️ Note the mixed-signal risk of a **non-strategy-scoped** orphan (`api_key_id` / `allocator_id` / `portfolio_id` targets, e.g. `derive_broker_dailies`): `get_user_compute_jobs` filters on `COALESCE(s.user_id, p.user_id) = v_auth_uid` (`20260516104201:805`), so those rows are invisible to the wizard poller entirely. That is pre-existing and out of scope, but the header should not claim the poller sees *every* terminalized orphan.

---

## §3 — The NULL-`claimed_at` writer

**Verdict: (a) CHEAP — and it is NOT a production writer bug.** No in-repo production path can produce `status='running' AND claimed_at IS NULL`. The only in-repo code that produces exactly this row shape is a **live-DB test fixture** in `analytics-service/tests/test_compute_jobs_fencing.py`, which writes it with a direct table UPDATE and relies on a `finally:` DELETE that does not run if the process dies.

Confidence: **HIGH on the exclusion** (every writer enumerated and read). **MEDIUM-HIGH on the attribution** — it matches on five independent attributes, but one confirming query is needed and I have no DB access. That query is given below.

### Exclusion: every writer that can set `status='running'`

There are **no** Python or TypeScript writers. `grep -rn "status.*running"` over `analytics-service/**/*.py` outside tests yields only two *reads* — `main_worker.py:997` (a comment) and `routers/process_key.py:647` (`_IN_FLIGHT_JOB_STATUSES = frozenset({"running", "done_pending_children"})`). Over `src/` there are zero writes. [VERIFIED: grep, this session]

Every SQL site that writes `status = 'running'` is a redefinition of the claim RPC, and **every one stamps `claimed_at = now()` in the same `SET` list, in the same statement**:

| Migration:line | Function | `claimed_at` in same SET |
|---|---|---|
| `20260411144407:562-563` | `claim_compute_jobs` (orig) | `claimed_at = now()` |
| `20260428120836:139-140` | claim + priority | `claimed_at = now()` |
| `20260428155809:81-82`, `:144-145` | claim, failed_retry | `claimed_at = now()` |
| `20260428190907:127-128`, `:227-228` | claim dedupe | `claimed_at = now()` |
| `20260510173005:208-209` | process_key_long drain | `claimed_at = now()` |
| `20260515114555:186-187`, `:320-321` | claim-token fencing | `claimed_at  = now()` |
| `20260526100000:166-167` | dpc guard | `claimed_at  = now()` |
| `20260528061155:184-185`, `:325-326` | tie-break | `claimed_at  = now()` |
| `20260601193000:210-211` | failed_retry restore | `claimed_at  = now()` |
| `20260603120000:131-132`, `:297-298` | error clear + fan-in | `claimed_at  = now()` |
| **`20260719073701:181-183`** | **`claim_compute_jobs_with_priority` — LATEST** | **`claimed_at  = now()`** |

Latest, verbatim (`supabase/migrations/20260719073701_claim_kind_filter.sql:181-184`):

```sql
  UPDATE compute_jobs
     SET status      = 'running',
         claimed_at  = now(),
         claimed_by  = p_worker_id,
```
[VERIFIED: supabase/migrations/20260719073701_claim_kind_filter.sql:181-184]

And symmetrically — every writer that sets `claimed_at = NULL` **simultaneously moves `status` OUT of `running`**:

| Migration:line | Function | status set to |
|---|---|---|
| `20260412094449:186-188` | `defer_compute_job` (superseded) | `'pending'` |
| `20260412094449:421-425`, `:441-445` | `reset_stalled_compute_jobs` (superseded) | `'pending'` |
| `20260505115047:186-192` | `mark_compute_job_failed` bridge | `v_new_status` ∈ `failed_retry`/`failed_final` |
| `20260516104201:592-596` | `reclaim_stuck_compute_jobs` — LATEST | `'pending'` |
| `20260516104201:656-660`, `:680-684` | `reset_stalled_compute_jobs` — LATEST | `'pending'` |
| `20260529170000:142-149` | `defer_compute_job` — LATEST | `'pending'` |

[VERIFIED: each read this session; `20260516104201:592-596` and `:656-660` quoted in full during research]

Note further that `mark_compute_job_failed` **no longer nulls `claimed_at` at all** — audit M-0779 removed it and `20260516131500:382-386` installs a body-text regression guard against re-introduction. [VERIFIED: supabase/migrations/20260516131500_compute_jobs_residual_apply.sql:382-386]

⇒ **`running` + `claimed_at IS NULL` is unreachable through any production writer at HEAD.** No `INSERT INTO compute_jobs` in any migration inserts `status='running'` either.

### Attribution: the live-DB fence test

`analytics-service/tests/test_compute_jobs_fencing.py` contains exactly **two** live-DB sites that write `status='running'` by direct table UPDATE. Both are in the C12-06 defer-fence tests. Verbatim, `:1138-1152`:

```python
    job = admin.table("compute_jobs").insert({
        "strategy_id": strategy_id,
        "kind": "poll_positions",
        "status": "pending",
        "priority": "normal",
        "exchange": "okx",
    }).execute().data[0]
    job_id = job["id"]
    try:
        real_token = str(uuid.uuid4())
        admin.table("compute_jobs").update({
            "status": "running",
            "claim_token": real_token,
            "attempts": 1,
        }).eq("id", job_id).execute()
```

The second is `:1191-1205` (`test_defer_compute_job_null_token_backcompat`), byte-identical in shape. The docstring at `:1132-1136` says the direct UPDATE is deliberate: *"Deterministic setup: drive the row to status='running' with a known token via a direct UPDATE (rather than `_claim_one`, which on the shared test DB could claim a different pending job)."* [VERIFIED: analytics-service/tests/test_compute_jobs_fencing.py:1132-1152, :1191-1205]

**Attribute-by-attribute match against the census:**

| Census attribute (`144-CONTEXT.md:40`) | Fixture writes |
|---|---|
| `status = 'running'` | ✅ `"status": "running"` |
| `claimed_at IS NULL` | ✅ never set — insert omits it, update omits it |
| `attempts = 1` | ✅ `"attempts": 1` |
| `kind = 'poll_positions'` | ✅ `"kind": "poll_positions"` |
| TEST only, PROD zero | ✅ gated on `SUPABASE_TEST_URL` (`:553-554`, `:584`) — this suite can only ever touch the TEST project |
| dates 2026-08-03 → 08-12 | ✅ the file's most recent commit is `c726a250`, **2026-08-11** ("scope the claim RPC by kind so shared-DB backlog cannot starve the fence tests") — i.e. someone was iterating this suite against TEST inside the exact window |

[VERIFIED: git log --date=short -- analytics-service/tests/test_compute_jobs_fencing.py]

**Why the cleanup can fail.** The row is removed by a `finally:` DELETE and, belt-and-braces, by the `strategy_id` fixture's teardown (`:672-693`, `admin.table("strategies").delete()`, which cascades via `strategy_id UUID REFERENCES strategies(id) ON DELETE CASCADE`, `20260411144407:108`). **Both are in-process.** A SIGKILL, a `pytest` interrupt, a CI job cancellation, or a PostgREST 504 on the DELETE leaves the row — and the shared TEST project's wedged-PostgREST failure mode is already a documented recurring condition. Six leaks over ten days of iteration is entirely consistent.

### ⛔ The one query that settles it (orchestrator, Supabase MCP, TEST project `qmnijlgmdhviwzwfyzlc`)

```sql
SELECT id, kind, status, attempts, claimed_at, claimed_by, claim_token,
       exchange, priority, strategy_id, created_at, last_error, metadata
  FROM public.compute_jobs
 WHERE status = 'running' AND claimed_at IS NULL
 ORDER BY created_at;
```

**Confirms the hypothesis if:** `claim_token IS NOT NULL` (the fixture's `real_token`), `exchange = 'okx'`, `priority = 'normal'`, `claimed_by IS NULL`, `last_error IS NULL`, `metadata IS NULL`, and each `strategy_id` resolves to a `strategies.name` matching `p97-fence-test-%` (the fixture names them `f"p97-fence-test-{uuid4().hex[:8]}"`, `:676`).

**Kills the hypothesis if:** `claim_token IS NULL`, or `claimed_by IS NOT NULL`, or `metadata->>'enqueued_by' = 'daily_loop'` (that would mean the DAILY FAN-OUT produced them, i.e. a real writer bug and a genuine investigation), or the strategies are not `p97-fence-test-%`.

Note `strategies.name` survives even though the fixture deletes it — if the strategy row is gone, the `compute_jobs` row would have cascaded too, so a surviving job row implies a surviving strategy row. That makes the name check a clean discriminator.

### Recommended disposition

- **Do NOT ship a production "writer fix"** — there is no production writer to fix. Shipping one would be inventing a defect.
- **DO fix the fixture** (cheap, one line each at `:1148` and `:1200`): add `"claimed_at": "now()"`-equivalent (`datetime.now(timezone.utc).isoformat()`) so the fixture stops manufacturing an invariant-violating row. This is Rule 6 root-cause work at the actual root.
- **DO ship the NULL-claim janitor arm anyway.** It is defence-in-depth against exactly this class (any future direct-UPDATE writer, migration, or manual repair), and CONTEXT's founder call already locks it in. It is not "treating the symptom" once the real source is named and fixed.
- **DO add the invariant gate** CONTEXT asks for. Cheapest honest form: a new assertion inside `supabase/tests/test_retention_orphaned_running.sql` that seeds a `running`/NULL-claim row aged past the arm-B threshold, EXECUTEs the deployed body, and asserts it terminalized. That is a behavioural gate on the janitor. A *census* gate ("zero such rows exist globally") would be a shared-DB flake magnet and is explicitly the anti-pattern §8 warns about.

---

## §4 — A DERIVED threshold for the NULL-claim arm

**Proposed value: `interval '48 hours'`, keyed on `created_at`.**

### What the threshold is NOT protecting

§3 establishes it: `running` + `claimed_at IS NULL` is **unreachable via any legitimate path**, because the claim stamps status and `claimed_at` in a *single* `UPDATE` statement (`20260719073701:181-183`) — there is no window, not even one transaction, in which a legitimately-claimed row lacks `claimed_at`. So the threshold is **not** a live-job guard the way the 4h `claimed_at` window is. It is margin against an unknown future two-statement writer, plus legibility. Saying otherwise in the header would be the same overclaim that got Phase 106 reverted.

### The derivation (three observable quantities, all in-repo)

| Quantity | Value | Source |
|---|---|---|
| `poll_positions` enqueue cadence | **86 400 s = 24 h** | `analytics-service/main_worker.py:1089` — `async def daily_enqueue_loop(interval: float = 86400.0)` |
| Worker dispatch tick (max legitimate `created_at` → claim gap on a healthy worker) | **30 s** | `analytics-service/main_worker.py:1054` — `async def dispatch_loop(worker_id: str, interval: float = 30.0)` |
| Max legitimate batch wall-clock once claimed | **2.5 h** = `p_batch_size` 5 × max per-kind handler timeout 30 min | `main_worker.py:556`, `:597` (`"p_batch_size": 5`); `job_worker.py:TIMEOUT_PER_KIND`; and the derivation is already codified in `20260720120000` header lines 22-30 |

**Ceiling on a legitimate `created_at`-age for a `running` row:**

```
max queue wait before the next fan-out supersedes the row   = 24 h   (enqueue cadence)
+ max batch wall-clock once claimed                          =  2.5 h
                                                             = 26.5 h
```

`48 h` is the smallest whole multiple of the enqueue cadence that strictly dominates that ceiling (ratio 1.81×), and it has an independent operational reading: **a `poll_positions` row still `running` after two full daily fan-outs has been superseded twice over.** Rounding to a cadence multiple, rather than to `27h` or `30h`, is the same discipline `20260803130000:550-551` uses (*"the smallest whole 4-hour multiple >= 1.25x that ceiling"*).

### Sanity checks

- **Strictly longer than the `claimed_at` arm.** 48 h ≫ 4 h, as CONTEXT requires ("its own, longer threshold").
- **Does not import a foreign number.** It is explicitly NOT the 4 h from `20260720120000` (that bounds ONE CLAIMED job), NOT the 16 h from `20260803130000` (that bounds a multi-hop chain on `strategy_analytics`), and NOT the 1 h from `20260816140000` (that bounds a route-commit → `after()` gap). Say all three in the header, in 143's register.
- **Falsifiable against real data.** All 6 live TEST fixtures are ≥ 5 days old (`144-CONTEXT.md:33-36`: `2026-08-03 → 08-12`), so a correct arm-B terminalizes all 6 on the first tick. That is the live-fixture verification CONTEXT flags at `:196-197`.
- **Kind-agnostic.** The arm is not scoped to `poll_positions`. 24 h is the *longest* enqueue cadence in the system (every other cron-fanned kind is also daily: `0 4`, `0 5`, `30 5`), so a threshold derived from it dominates for every kind. Chain-follow-on kinds have no cadence at all, and for them 48 h is pure margin. Say that.

### Index note

`compute_jobs_stuck_running` is `ON compute_jobs (claimed_at) WHERE status = 'running'` (`20260411144407:195-197`). NULL-claim rows **are** in that partial index (the predicate is status-only) but with a NULL key, so a `created_at` predicate will not seek on it.

⚠️ **CORRECTED 2026-08-17 by live re-measurement (this section originally read "irrelevant at this scale — TEST holds 6"; that argument is VOID).** TEST holds **402** `running` rows, not 6: **396 claimed** (`derive_broker_dailies`) plus the 6 NULL-claim (`poll_positions`). The "6" in the original census was the NULL-claim subset mislabelled as the total. PROD is still **0**.

⇒ **Arm A must be `LIMIT`-bounded on the strength of a measured 396-row population, not as belt-and-braces.** Arm B must be bounded too, but its case rests on principle (no index seek) rather than scale. Neither arm may be justified with a "the population is tiny" argument.

---

## §5 — Live cron slot availability ⚠️ CONTEXT.md's list is INCOMPLETE

**Proposed cadence: `'50 * * * *'`.**

### Correction

`144-CONTEXT.md:180-181` lists TEST slots as *"`:00 3`, `:05 3`, `:10 3`, `:15 4`, `:20 3`, `:30 3`, `:30 5`, `*/15`, and `:35`."* Reading the migrations at HEAD, that list **omits two registrations**:

- `15 3 * * *` — `resend_message_correlation_retention_90d` (`20260515113637_resend_message_correlation.sql:61-65`)
- `0 * * * *` — `match_engine_cron`, **hourly**, rescheduled from `0 1 * * *` (`20260408215026_schedule_match_cron_hourly.sql:65-67`)

The second matters most: it is the only other **hourly** job, and it lands on `:00` every hour alongside the `*/15` reaper. Any hourly candidate at `:00` would stack three jobs every hour.

Phase 143's own header (`20260816140000:41-42`) says *"Registered slots across all migrations are :00, :10, :15, :20 and :30"* — also incomplete (missing `:05`). Do not copy either list; use the table below.

### Registered slots at HEAD (in-repo, complete)

| Schedule | Job name | Registering migration:line |
|---|---|---|
| `0 * * * *` | `match_engine_cron` | `20260408215026:65-67` |
| `*/15 * * * *` | `reap_strategy_analytics_stuck_computing` | `20260803130000:107-109` (latest of 3 registrations) |
| `35 * * * *` | `reconcile_dropped_enqueue_sweep` | `20260816140000:711-713` |
| `0 3 * * *` | `audit_log_hot_to_cold` | `20260515210200:167-169` |
| `0 3 * * *` | `compute_bridge_outcome_deltas` | `20260418074935:240-242` |
| `5 3 * * *` | `audit_log_cold_purge` | `20260515113853:166-168` |
| `10 3 * * *` | `retention_notification_dispatches` | `20260515210200:210-212` |
| `15 3 * * *` | `resend_message_correlation_retention_90d` | `20260515113637:61-63` |
| `20 3 * * *` | `retention_compute_jobs_done` | `20260515113853:192-194` |
| `30 3 * * *` | `retention_compute_jobs_failed` | `20260515210200:251-253` |
| `0 4 * * *` | `api_key_rotation_reminder` | `20260417110539:333-335` |
| `0 4 * * *` | `poll-allocator-positions` | `20260420073003:692` |
| **`15 4 * * *`** | **`retention_compute_jobs_orphaned_running` ← THIS PHASE REPLACES IT** | `20260720120000:64-66` |
| `0 5 * * *` | `refresh-allocator-equity` | `20260420213754:379-381` |
| `30 5 * * *` | `derive-allocator-key-dailies` | `20260717233529:280-282` |

**Occupied minute-of-hour set:** `{0, 5, 10, 15, 20, 30, 35, 45}` — where `{0,15,30,45}` are occupied EVERY hour by `*/15`, `{0}` additionally every hour by `match_engine_cron`, `{35}` every hour by 143's sweep, and `{5,10,15,20,30}` once daily in hours 3-5.

### Conflicts ruled out

| Candidate | Ruled out because |
|---|---|
| `:00` | `*/15` reaper AND `match_engine_cron` — triple-stack every hour |
| `:15` / `:30` / `:45` | `*/15` reaper every hour |
| `:35` | Phase 143's `reconcile_dropped_enqueue_sweep` — the slot CONTEXT already names |
| `:05` | `audit_log_cold_purge` at 03:05 |
| `:10` | `retention_notification_dispatches` at 03:10 |
| `:20` | `retention_compute_jobs_done` at 03:20 — an unbounded 30-day `DELETE` on the SAME TABLE. Worst possible neighbour for this janitor. |
| `:25`, `:40`, `:55` | Free, but see below |

**Free minutes: `{25, 40, 50, 55}` (and any un-listed minute).** Ranked by clearance from the nearest occupied slot on either side:

| Candidate | Prev occupied | Next occupied | Min clearance |
|---|---|---|---|
| `:25` | `:20` | `:30` | 5 min |
| `:40` | `:35` | `:45` | 5 min |
| `:50` | `:45` | `:00` | **5 min back / 10 min forward** |
| `:55` | `:45` | `:00` | 10 min back / **5 min forward** |

**Recommend `'50 * * * *'`.** It is 5 minutes after the light, bounded `*/15` reaper and 10 minutes before the busiest slot of the hour (`:00`, which stacks `match_engine_cron` + the reaper). It sits off the quarter-hour grid, and no daily job uses minute 50. `:25` is the acceptable alternative if the planner prefers distance from `:00` over distance from the `:20` retention DELETE — but `:25` is only 5 minutes after `retention_compute_jobs_done`'s same-table DELETE, so `:50` is the better call.

⚠️ **UNVERIFIED (no DB access):** this table is derived from migrations, not from `SELECT jobid, jobname, schedule FROM cron.job`. Jobs registered by hand outside `supabase/migrations/**` would not appear. The orchestrator must run that SELECT on **both** TEST and PROD before the migration is written; if it turns up an unlisted `50 * * * *`, fall back to `:25`.

### Cadence honesty (mandatory header paragraph, in 142/143's register)

The cadence is **post-threshold detection latency**, not user-visible wait. Worst case end-to-end for the `claimed_at` arm is `4 h (threshold) + 1 h (cadence) = ~5 h` before the job row itself terminalizes — and for the downstream `strategy_analytics` surface, add Phase 142's own `16 h` (§7), i.e. **~21 h** before the user sees "Analytics was interrupted…". Nothing in the migration should be read as shortening a spinner: `SyncPreviewStep.tsx` already self-escalates a frozen status at `RETRY_THRESHOLD_MS = 900_000` (15 min), long before either window elapses.

---

## §6 — Does a terminalized orphan need re-enqueueing?

**Verdict: NO. Do not re-enqueue from the janitor. For cron-fanned kinds it is unnecessary (and would be a duplicate); for user-initiated kinds it is unsafe. There is a residual gap for chain-mid orphans, named at the end — it belongs in TODOS, not in this migration.**

### The mechanism that makes re-enqueue unnecessary for cron-fanned kinds

The in-flight dedupe that blocks a re-enqueue is a **partial unique index whose predicate excludes `failed_final`**. Latest definition, `supabase/migrations/20260416125430_contact_request_metadata.sql:156-161`, verbatim:

```sql
CREATE UNIQUE INDEX compute_jobs_one_inflight_per_kind_strategy
  ON compute_jobs (strategy_id, kind)
  WHERE strategy_id IS NOT NULL
    AND kind <> 'compute_intro_snapshot'
    AND status IN ('pending', 'running', 'done_pending_children');
```
[VERIFIED: supabase/migrations/20260416125430_contact_request_metadata.sql:156-161]

And the enqueue RPC's own in-flight probe uses the same set — `status IN ('pending', 'running', 'done_pending_children')` at `20260716090000_retire_compute_analytics_kind_rpc_guard.sql:108`, `:115`, `:151`, `:158` and again at `:235-256`, `:289-296`. [VERIFIED]

⇒ **An orphan sitting at `running` BLOCKS its own replacement, forever.** For `poll_positions` specifically, the daily fan-out `enqueue_poll_positions_for_all_strategies` probes exactly that set before calling `enqueue_compute_job` (`20260412094449:249-253`, verbatim):

```sql
    SELECT count(*) INTO v_existing_count
      FROM compute_jobs
      WHERE strategy_id = v_strategy_id
        AND kind = 'poll_positions'
        AND status IN ('pending', 'running', 'done_pending_children');
```

So the orphan is not merely a stale row — **it is the thing suppressing the recovery.** Terminalizing to `failed_final` removes it from the predicate, and the **next daily fan-out (≤24 h) enqueues a fresh job automatically**. That is the recovery, and it requires no re-enqueue code. [VERIFIED: supabase/migrations/20260412094449_compute_jobs_admin_and_defer.sql:249-253, :257-263]

### Per-kind work-loss analysis

Kind registry (16 kinds, from all `INSERT INTO compute_job_kinds` at HEAD): `sync_trades`, `compute_analytics`, `compute_portfolio`, `poll_positions`, `poll_allocator_positions`, `derive_allocator_equity`, `derive_broker_dailies`, `refresh_allocator_equity_daily`, `rescore_allocator`, `reconcile_strategy`, `reconstruct_allocator_history`, `process_key_long`, `stitch_composite`, `sync_funding`, `compute_analytics_from_csv`, `compute_intro_snapshot`. [VERIFIED: grep `INSERT INTO compute_job_kinds` over `supabase/migrations/*.sql`]

| Kind | Enqueued by | One-shot? | Auto-recovers after terminalization? |
|---|---|---|---|
| `poll_positions` | `daily_enqueue_loop` → `enqueue_poll_positions_for_all_strategies` (`main_worker.py:1089`, `:976-986`) | No — daily, idempotent | **YES, ≤24 h.** Terminalizing IS the fix. Re-enqueue would race the fan-out. |
| `poll_allocator_positions` | cron `poll-allocator-positions` `0 4 * * *` (`20260420073003:692`) | No — daily | **YES, ≤24 h**, same mechanism on the per-api_key index |
| `refresh_allocator_equity_daily` / `derive_allocator_equity` | cron `refresh-allocator-equity` `0 5` (`20260420213754:379`), `derive-allocator-key-dailies` `30 5` (`20260717233529:280`) | No — daily | **YES, ≤24 h** |
| `sync_trades`, `derive_broker_dailies`, `compute_analytics_from_csv` | chain follow-on: `JOB_CHAIN_FOLLOW_ON` (`analytics-service/services/job_worker.py:521-529`) or a user action | Chain-linked | **NO.** The chain is dead. See residual gap. |
| `process_key_long`, `stitch_composite` | user wizard action | One-shot | **NO** — but the user gets an exit (§2: `failed_final` ∈ `FINISHED_JOB_STATUSES`, Retry CTA not suppressed) and the freed index lets a re-POST actually INSERT rather than no-op |
| `compute_portfolio`, `compute_analytics`, `rescore_allocator`, `reconcile_strategy`, `sync_funding`, `reconstruct_allocator_history`, `compute_intro_snapshot` | user/event | One-shot | **NO**, same as above |

### Why re-enqueueing from the janitor would be actively dangerous

1. **Duplicate + 23505 risk.** For the daily-fanned kinds the cron already re-enqueues. A janitor INSERT racing the fan-out collides on `compute_jobs_one_inflight_per_kind_*`. A `23505` inside a pg_cron `DO` block **aborts the whole tick**, taking the terminalization with it. Phase 143 only gets away with an INSERT because its predicate demands `NOT EXISTS (any compute_jobs row for the strategy)` — a strictly-empty precondition this janitor cannot have, since it is *editing a row that exists*. (`20260816140000:729-732`, and the header's own warning at `:695-701` that `ON CONFLICT DO NOTHING` is the second line of defence.)
2. **Poison-job amplification.** A job may be orphaned precisely because it killed the worker. Blind re-enqueue turns a one-shot poison job into an infinite loop across worker restarts. The sanctioned retry channel is `attempts`/`max_attempts` + backoff in `mark_compute_job_failed` — and by definition that channel was never reached, because the worker died.
3. **Stale preconditions.** A `process_key_long` orphan from an abandoned wizard session, or from a since-revoked API key, would be silently re-run against state the user has moved on from.
4. **Blast radius.** `supabase/migrations/**` auto-applies to PROD on merge. A janitor that INSERTs is a janitor that can create production work with no human in the loop. A janitor that only UPDATEs a status is bounded by construction.

### ⭐ What DOES recover the user-visible outcome, at zero cost

CONTEXT worried that "the audit trail alone" does not discharge PROD's need. It does more than that, via Phase 142:

`20260803130000:118-121` (clock-start arm) and `:139-142` (reap arm) both carry `NOT EXISTS (… cj.status IN ('pending','running','done_pending_children','failed_retry'))`. A `running` orphan keeps 142 blocked; `failed_final` releases it. Within ≤15 min the clock-start arm stamps `computing_started_at = now()`, and 16 h later the reap arm writes:

```sql
       SET computation_status   = 'failed',
           computation_warned   = FALSE,
           computation_error    = 'Analytics was interrupted before it could finish and did not recover. Retry the sync.',
           computing_started_at = NULL
```
[VERIFIED: supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql:148-151]

**That** is the user-facing message CONTEXT wanted to write — and it already exists, on the surface that actually renders it. The janitor's job is to unblock it, not to duplicate it. Note the cost: the 16 h reaper threshold means the analytics-surface message lags terminalization by up to 16 h. Put that number in the header.

⚠️ The janitor must **not** call `sync_strategy_analytics_status()` itself to shortcut this. That function is called from inside `mark_compute_job_failed` (`20260505115047:195-201`); invoking it from a pg_cron `DO` block would (a) duplicate 142's mechanism with a different threshold, (b) widen the tick's failure surface, and (c) create a second writer to `strategy_analytics.computation_status` with no coordination. There is **no trigger** on `compute_jobs` that bridges status — the only one is `compute_jobs_set_updated_at_trigger BEFORE UPDATE` (`20260411144407:265-268`), which is exactly what we want (the janitor's UPDATE bumps `updated_at`, giving a free terminalization timestamp for audit). [VERIFIED]

### Residual gap — name it, file it, do NOT fix it here

A **chain-mid** orphan (e.g. `derive_broker_dailies` orphaned before it enqueues `compute_analytics_from_csv`, per `job_worker.py:526`) is recovered by nothing:
- Phase 143's sweep requires `NOT EXISTS (… public.compute_jobs cj WHERE cj.strategy_id = s.id)` — **any** row, terminal included (`20260816140000:729-732`) — so the terminalized orphan excludes the strategy forever. CONTEXT is exactly right about this.
- Phase 143 also requires `NOT EXISTS strategy_keys` and `EXISTS csv_daily_returns` (`:733-742`), so it only ever covers CSV-only strategies, and it only enqueues `compute_analytics_from_csv`.
- Phase 142 will terminalize the `strategy_analytics` row (so the user is *told*), but nobody re-runs the work.

**Recommended disposition:** file to `TODOS.md` as a v1.19+ candidate — *"widen `reconcile_dropped_enqueue_sweep`'s zero-jobs conjunct to 'no NON-TERMINAL compute_jobs row' so a terminalized orphan does not permanently exclude a strategy from reconciliation."* That is a change to Phase 143's **shipped** predicate with its own safety analysis (the header at `20260816140000:72-82` explains that the terminal-`strategy_analytics` conjunct is what carries safety, so widening may be tractable — but it is a separate phase). Recording the residual is the honest close; silently letting the phase imply full recovery is not.

---

## §7 — ⚠️ NEW BLOCKER: the audit trail is NOT automatic

Not asked, but it invalidates the naive implementation of SC#1.

`retention_compute_jobs_failed` (jobid 8) deployed body — `supabase/migrations/20260515210200_retention_crons_high_hardening.sql:255-259`, verbatim:

```sql
    DELETE FROM compute_jobs
     WHERE status IN ('failed_final', 'failed_retry')
       AND COALESCE(next_attempt_at, created_at) < now() - interval '90 days';
```
[VERIFIED: supabase/migrations/20260515210200_retention_crons_high_hardening.sql:255-259]

The cutoff is **`next_attempt_at`**, not `created_at`. And the claim RPC does **not** advance `next_attempt_at` (`20260719073701:181-190` — it sets status, `claimed_at`, `claimed_by`, `attempts`, `claim_token`, `last_error`, `error_kind`, `metadata`; `next_attempt_at` is untouched). So an orphan's `next_attempt_at` is frozen at roughly its **enqueue** time.

⇒ **If the janitor flips only `status`, an orphan whose `next_attempt_at` is already older than 90 days becomes eligible for `DELETE` on the very next 03:30 tick** — terminalized at 04:50, gone by 03:30 the following morning. The row "survives for audit until the existing retention crons collect it" would be false by 89 days.

The retention migration's own header names the convention that avoids this (`20260515210200:242-245`): *"mig 109 P4 sets `next_attempt_at=now()` for failed_final transitions, so failed_final rows always hit the 90d wall on schedule."*

**⇒ The janitor MUST set `next_attempt_at = now()` alongside `status='failed_final'`.** This is a hard requirement, not a nicety. Not currently reachable on PROD (zero `running` rows) or TEST (oldest orphan 14 days), but it is a one-line omission that silently voids SC#1's central promise, and it should be pinned by an assertion in the SQL gate.

Compare `retention_compute_jobs_done` (jobid 4), which does key on `created_at` (`20260515113853:195-199`) — the asymmetry is real and is why this trap is easy to miss.

---

## §8 — ⚠️ NEW BLOCKER: the shipped SQL gate encodes DELETE and will red

`supabase/tests/test_retention_orphaned_running.sql` runs in CI against the TEST project (`.github/workflows/ci.yml:1018-1036` discovers `supabase/tests/test_*.sql` and runs each under `psql -v ON_ERROR_STOP=1`). It has **two** assertions that break under Phase 144, and CONTEXT.md does not mention the file at all.

### Break 1 — the DELETE oracle

`supabase/tests/test_retention_orphaned_running.sql:158-164`, verbatim:

```sql
  EXECUTE v_command;

  -- (a) orphaned running row is GONE
  SELECT count(*) INTO row_cnt FROM compute_jobs WHERE id = id_a;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (3): orphaned >4h running row survived the purge (count=%), expected 0', row_cnt;
  END IF;
```

Under a terminal UPDATE the row survives ⇒ `row_cnt = 1` ⇒ **this gate fails the instant the migration is applied to TEST**. It must become `count(*) = 1 AND status = 'failed_final' AND next_attempt_at >= <pre-execute clock>`.

### Break 2 — the hour-band cast dies on an hourly schedule

`supabase/tests/test_retention_orphaned_running.sql:110-114`, verbatim:

```sql
  SELECT (split_part(schedule, ' ', 2))::INT INTO v_cron_hour
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_cron_hour IS NULL OR v_cron_hour < 1 OR v_cron_hour > 22 THEN
    RAISE EXCEPTION 'TEST FAILED (2): purge cron hour must stay in the safe 1-22 band (got %)', v_cron_hour;
  END IF;
```

For `'50 * * * *'`, `split_part(schedule,' ',2)` returns the literal `'*'`, and `'*'::INT` raises `22P02 invalid_input_syntax_for_type_integer`. Under `ON_ERROR_STOP=1` that is a **hard CI failure with a confusing message**, not a clean assertion. The safe-hour band assertion is meaningless for an hourly job and must be replaced (e.g. assert `schedule = '50 * * * *'`, or assert field 2 is `'*'` and field 1 is a free minute).

### Also to update in the same file

- The header prose at `:6-7` and `:21-23` argues *"DELETE, never reset-to-pending"* and *"Only removal ends the daily re-pollution."* That reasoning is superseded: a terminal UPDATE also ends the re-pollution, because `failed_final` leaves the claim RPC's partition-dedupe predicate (`x.status IN ('running','done_pending_children')`, `20260719073701:159-179`) and the claimable set (`status IN ('pending','failed_retry')`, `:204`). Rewrite it; a stale rationale in a gate is how a false claim survives (the Rule-7 / scope-amendment failure mode).
- `:34-36` says the WR-02 tradeoff is *"the founder-deferred WR-02 decision, resolved at FLIP-01 go-live."* Phase 144 IS that resolution. Update.
- Assertion 1 (`:91-105`) checks for `%status = 'running'%`, `%interval '4 hours'%`, `%claimed_at%`, `%public.compute_jobs%`. All four still hold for the new body **if the arm-A predicate keeps that exact spacing** — `status = 'running'` with single spaces. Preserve it deliberately, or update the assertions. This is a real trap: CONTEXT's own census (`144-CONTEXT.md:70`) notes TEST and PROD md5s already differ purely because of whitespace.

### New assertions Phase 144 should add

Follow `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` (Phase 143), which is the freshest template and whose header states the contract explicitly:

- **Part 1 UNGATED** and MUST fail when the migration is unapplied — the file's TDD RED proof. It *"deliberately does NOT follow test_retention_orphaned_running.sql:71-83, whose presence gates `RAISE NOTICE … RETURN` and thereby no-op the ENTIRE file when the migration has not reached the project. A gate that green-skips when the object under test is absent is not evidence."* (`test_reconcile_dropped_enqueue_sweep.sql:35-51`). ⇒ **The existing orphan test's presence gates at `:71-83` are exactly the anti-pattern; the rewrite should drop them.**
- **Per-part `BEGIN;` / `SET LOCAL lock_timeout='5s'` / `ROLLBACK;`** — never one outer transaction (`test_reconcile_dropped_enqueue_sweep.sql:53-67` explains that psql's nested BEGIN creates no savepoint, so the first inner rollback autocommits every later part onto the SHARED test project).
- **EXECUTE the deployed body**, never a re-typed predicate (`:26-33`: *"Only executing the deployed body against real rows falsifies it."*).
- **Century-backdating instead of sleeping** for age fixtures.

Assertions the new gate needs, minimum:
1. arm A: `claimed_at` 5 h old → `status='failed_final'`, row present, `next_attempt_at` advanced (§7), `error_kind='permanent'`, `last_error` non-null.
2. arm A negative: `claimed_at` 3 h old → **untouched, still `running`** (the RT-01 batch-tail regression, preserved from `:175-182`).
3. arm B: `claimed_at IS NULL`, `created_at` 5 days old → terminalized (the §3 invariant class).
4. arm B negative: `claimed_at IS NULL`, `created_at` 12 h old → untouched.
5. non-`running` aged row untouched (preserved from `:170-174`).
6. ⛔ **no row was DELETEd** — assert total row count for the seeded ids is unchanged across `EXECUTE`. This is the assertion that makes "never DELETE" checkable.
7. schedule is the chosen hourly expression, and body still says `interval '4 hours'` (threshold UNCHANGED, SC#2).

Every one of these must be shown to go RED when its target is neutered — neuter, run, OBSERVE the red, restore. Phase 143 found two vacuities that way, one in a gate written ten minutes earlier.

---

## §9 — SC#4 / JOB-08: the WON'T-FIX and its measurement

No new research needed; recording the shape so the planner writes it correctly.

**Carry these numbers verbatim into the phase SUMMARY and into `REQUIREMENTS.md` under JOB-08** (from `144-CONTEXT.md:31-36`, census 2026-08-17):

| status | PROD `khslejtfbuezsmvmtsdn` | TEST `qmnijlgmdhviwzwfyzlc` |
|---|---|---|
| `pending` | **0** | 2819 (2026-08-11 → 08-15) |
| `running` | **0** | **402** — 396 claimed (`derive_broker_dailies`) + 6 NULL-claim (`poll_positions`), 2026-08-03 → 08-14 ⚠️ corrected 2026-08-17; the original "6" was the NULL-claim subset |
| `done` | 1545 (07-18 → 08-17) | 0 |
| `failed_final` | 121 (05-20 → 08-17) | 0 |

The structural argument (CONTEXT Finding 3) is the load-bearing part: **nothing sweeps `pending`** — that absence is the whole of JOB-08 — so a zero snapshot is not a snapshot, it is a statement that zero rows have *ever* stranded on PROD. Corroborated in-repo: `20260816140000:82` states *"Nothing sweeps stale 'pending' at all (JOB-08)."*

⛔ Traps that stand regardless, both already stated in the requirement text at `REQUIREMENTS.md:57`: never `DELETE` a `pending` row (auto-applies to PROD, destroys real queued work); never `cron.unschedule(9)` — `supabase/tests/test_derive_allocator_keys_fanout.sql` assertion 6 requires that cron registered, so unscheduling reddens the `sql-tests` gate.

⚠️ **A WON'T-FIX with no measurement attached is a skip.** The measurement must land in a committed artifact, not only in this research file.

---

## Runtime State Inventory

This is a schema/cron change, not a rename — but it edits **live registered cron state**, so the equivalent inventory applies.

| Category | Items found | Action required |
|---|---|---|
| Stored data | `public.compute_jobs` rows at `status='running'`: PROD **0**, TEST **402** ⚠️ corrected 2026-08-17 — **396 claimed** (`derive_broker_dailies`, >48 h old) are a live fixture for **arm A**, and **6 NULL-claim** (`poll_positions`) for **arm B**. All 402 carry non-NULL `claim_token` and non-NULL `next_attempt_at`. | Data transition (the janitor UPDATE itself) — no separate backfill. ⚠️ Arm A will move ~396 rows on TEST on its first ticks; the `LIMIT` bound governs how many per tick and must be asserted. |
| Live service config | `cron.job` entry `retention_compute_jobs_orphaned_running` (jobid 11 per ROADMAP), currently `'15 4 * * *'` with a DELETE body, **on BOTH projects** (CONTEXT Finding 2: bodies semantically identical, md5 differs only by whitespace) | `cron.unschedule`-then-`cron.schedule` in the new migration; applies to TEST via MCP (orchestrator session only) and to PROD automatically on merge |
| OS-registered state | None — pg_cron only, no Railway/Vercel cron involved | None |
| Secrets / env vars | None. `TEST_SUPABASE_DB_URL` already wired for `sql-tests` | None |
| Build artifacts / installed packages | None — no package changes in this phase | None |
| **CI gates carrying the OLD contract** | `supabase/tests/test_retention_orphaned_running.sql` asserts DELETE (`:161-164`) and casts the cron hour field to INT (`:110-114`) | **MUST be rewritten in the same PR** — §8 |
| **Live test fixtures producing the invariant violation** | `analytics-service/tests/test_compute_jobs_fencing.py:1148`, `:1200` — direct UPDATE to `running` without `claimed_at` | One-line fix each, or file with evidence (§3) |

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Prove the cron body is right | A re-typed copy of the predicate inside the test | `SELECT command FROM cron.job` then `EXECUTE v_command` | `test_reconcile_dropped_enqueue_sweep.sql:26-33`: *"A gate that re-implements the predicate passes when the DEPLOYED predicate is wrong — which is exactly how every gate in phases 142/142.1 passed over a bound that did not exist (D-19)."* |
| Age a row for a threshold test | `pg_sleep` | Century-backdating the timestamp | 143's template; a 4h/48h threshold is untestable by sleeping |
| Re-apply a cron job | `cron.alter_job`, or a bare `cron.schedule` | `IF EXISTS … cron.unschedule(name)` then `cron.schedule(name, …)` | Repo canon (`20260720120000:59-66`, `20260816140000`, `20260515113637:58-60`); pg_cron <1.6 errors on duplicate name, ≥1.6 silently overwrites |
| Bound a sweep | A bare `UPDATE … WHERE` | `WITH batch AS MATERIALIZED (… ORDER BY … LIMIT n FOR UPDATE SKIP LOCKED)` | `20260803130000` exists solely because D-19 lost this bound; 143 reuses it |
| Report counts to an operator | `RAISE NOTICE` read back from `cron.job_run_details.return_message` | Nothing — query the table | `return_message` carries the COMMAND TAG, not NOTICE text (measured on TEST and PROD 2026-08-17, CONTEXT `:176-177`). 142's header relies on the falsified premise; already filed. |
| Re-run lost work | A re-enqueue arm in the janitor | Existing daily fan-outs (auto) + the user's Retry CTA | §6 |
| Bridge to `strategy_analytics` | Calling `sync_strategy_analytics_status()` from pg_cron | Phase 142's reaper, which the terminalization unblocks | §6 |

---

## Common Pitfalls

### Pitfall 1 — Flipping `status` without `next_attempt_at`
**What goes wrong:** an old orphan is DELETEd by `retention_compute_jobs_failed` on the next 03:30 tick, so the audit trail SC#1 promises lasts hours instead of 90 days.
**Root cause:** that cron keys on `COALESCE(next_attempt_at, created_at)`, and the claim RPC never advances `next_attempt_at`.
**Avoid:** set `next_attempt_at = now()` in the same SET list. Pin it with a gate assertion.
**Warning sign:** a `failed_final` row whose `next_attempt_at` predates its `updated_at` by weeks.

### Pitfall 2 — Landing the migration without touching the SQL gate
**What goes wrong:** `sql-tests` reds on `TEST FAILED (3): orphaned >4h running row survived the purge (count=1), expected 0` — a *correct* migration failing a *stale* gate, which reads like a regression.
**Avoid:** §8. Rewrite `test_retention_orphaned_running.sql` in the same commit.

### Pitfall 3 — An hourly schedule crashing assertion 2
**What goes wrong:** `'*'::INT` → `22P02`, an opaque psql error rather than a named assertion.
**Avoid:** §8 Break 2.

### Pitfall 4 — Whitespace drift breaking assertion 1
**What goes wrong:** the gate does `v_command NOT ILIKE '%status = ''running''%'`. Writing `status='running'` (no spaces), or splitting the predicate across lines differently, fails a check that has nothing to do with behaviour.
**Avoid:** keep `status = 'running'` with single spaces in arm A, or relax the assertion to a regex.
**Evidence this is live:** CONTEXT `:70` — TEST and PROD md5s already differ purely because TEST joined two clauses onto one line.

### Pitfall 5 — Writing a bespoke "orphan reaped" string into a user-visible field
**What goes wrong:** there is no such field (§2). `user_message` is computed from `(status, error_kind)`; `last_error` is hard-redacted to NULL for users; the sync-progress route projects neither.
**Avoid:** put the verbose reason in `last_error` (audit), rely on `status` for the poller, and rely on Phase 142 for the user-facing analytics string.

### Pitfall 6 — Terminalizing to `failed_retry`
**What goes wrong:** it is claimable (`20260719073701:204`) AND it is inside Phase 142's exclusion set (`20260803130000:141`). The row gets re-claimed, and 142 stays blocked forever.
**Avoid:** `failed_final`, only.

### Pitfall 7 — Adding a presence gate that green-skips
**What goes wrong:** the existing file's `RAISE NOTICE … RETURN` at `:71-83` no-ops the WHOLE file when the migration has not reached the project, so the PR's first `sql-tests` run is green and proves nothing.
**Avoid:** Part 1 ungated, per 143's anti-green-skip contract.

### Pitfall 8 — Exceeding the `metadata` CHECK
**What goes wrong:** `compute_jobs_metadata_size_bounded` caps `octet_length(metadata::text) <= 8192`. A violation inside a pg_cron `DO` block aborts the whole tick.
**Avoid:** if writing a marker, keep it to one or two small keys, or skip `metadata` entirely.

### Pitfall 9 — Assuming the census is current
**What goes wrong:** PROD's `running` count was 0 on 2026-08-17. A ledger claim is a dated CLAIM, not a fact.
**Avoid:** re-run the census in the orchestrator session immediately before applying, and again before merging.

---

## Code Examples

### The migration skeleton (shape only — every literal below is sourced above)

```sql
BEGIN;
SET lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'WR-02: pg_cron is NOT installed — the orphaned-running terminalizer cannot be registered, so orphaned running jobs would stay running forever and every wizard poller on them would spin indefinitely.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running') THEN
    PERFORM cron.unschedule('retention_compute_jobs_orphaned_running');
  END IF;

  PERFORM cron.schedule(
    'retention_compute_jobs_orphaned_running',
    '50 * * * *',
    $cron$
    DO $sweep$
    BEGIN
      -- ARM A: claimed but orphaned past the UNCHANGED 4h window.
      WITH batch AS MATERIALIZED (
        SELECT id FROM public.compute_jobs
         WHERE status = 'running'
           AND claimed_at IS NOT NULL
           AND claimed_at < now() - interval '4 hours'
         ORDER BY claimed_at ASC
         LIMIT 500
         FOR UPDATE SKIP LOCKED
      )
      UPDATE public.compute_jobs cj
         SET status          = 'failed_final',
             next_attempt_at = now(),          -- §7: retention keys on this
             error_kind      = 'permanent',
             last_error      = 'orphaned_running_reaped: no worker completed this job within the 4h claim window'
        FROM batch b
       WHERE cj.id = b.id
         AND cj.status = 'running';

      -- ARM B: never-stamped claim, keyed on created_at (§4 derivation).
      WITH batch AS MATERIALIZED (
        SELECT id FROM public.compute_jobs
         WHERE status = 'running'
           AND claimed_at IS NULL
           AND created_at < now() - interval '48 hours'
         ORDER BY created_at ASC
         LIMIT 500
         FOR UPDATE SKIP LOCKED
      )
      UPDATE public.compute_jobs cj
         SET status          = 'failed_final',
             next_attempt_at = now(),
             error_kind      = 'permanent',
             last_error      = 'orphaned_running_reaped: status=running with claimed_at NULL (invariant violation) older than 48h'
        FROM batch b
       WHERE cj.id = b.id
         AND cj.status = 'running';
    END $sweep$;
    $cron$
  );
END $$;

-- STEP 2: self-verify. Failure messages name the CONSEQUENCE, not the symptom.
-- (assert: job registered exactly once; body contains interval '4 hours';
--  body contains interval '48 hours'; body contains status = 'running';
--  body contains next_attempt_at; body is schema-qualified to
--  public.compute_jobs; body contains NO 'DELETE'.)

COMMIT;
```

⚠️ The `DELETE`-absence assertion in STEP 2 is the one that makes "never DELETE" mechanically checkable at the deployed body — do not omit it.

---

## State of the Art

| Old approach | Current approach | When changed | Impact on this phase |
|---|---|---|---|
| 2h `claimed_at` window | 4h | `20260720120000` (RT-01) | Threshold stays 4h — SC#2 |
| Unbounded janitor UPDATE | `MATERIALIZED` CTE + `LIMIT` + `FOR UPDATE SKIP LOCKED` | `20260803130000` (D-19) | Both arms must be bounded |
| Re-typed predicate in gates | `EXECUTE` the deployed `cron.job.command` | `20260719120000` gate, hardened by 143 | Keep the oracle, drop the presence gates |
| Presence gates that `RAISE NOTICE … RETURN` | Ungated Part 1 that MUST red | `20260816140000` gate (Phase 143) | The existing orphan gate is the named counter-example |
| Operator counts via `return_message` | Query the table | Measured 2026-08-17 | Do not design an operator story on the run log |

**Deprecated / superseded:**
- `test_retention_orphaned_running.sql:21-23` "DELETE, never reset-to-pending" — superseded by this phase.
- `test_retention_orphaned_running.sql:34-36` "founder-deferred WR-02 decision, resolved at FLIP-01 go-live" — this phase IS the resolution.
- CONTEXT.md's `user_message` column claim — refuted, §2.
- CONTEXT.md's cron-slot list — incomplete, §5.

---

## Package Legitimacy Audit

**Not applicable.** This phase installs **zero** external packages. It ships one `.sql` migration, one `.sql` test rewrite, and (optionally) a two-line edit to an existing Python test file. No `package.json`, `requirements.txt` or `pyproject.toml` change is in scope.

| Package | Registry | Verdict | Disposition |
|---|---|---|---|
| — | — | — | No packages introduced |

Packages removed due to `[SLOP]`: none. Packages flagged `[SUS]`: none.

---

## Environment Availability

| Dependency | Required by | Available to THIS agent | Available to the orchestrator | Fallback |
|---|---|---|---|---|
| `pg_cron` extension | The whole phase | ✗ (no DB) | Presumed ✓ — asserted by every cron migration's guard | None — migration RAISEs |
| Supabase MCP (TEST apply + live tick) | Pre-merge verification | ✗ — **stripped from subagents** | ✓ | None. Any apply/live-tick task MUST run in the orchestrator session (Phase 143 Plan 04 hit this exactly). |
| `psql` + `TEST_SUPABASE_DB_URL` | `sql-tests` CI job | ✗ | ✓ in CI | None |
| git / filesystem | Research | ✓ | ✓ | — |

**Blocking for the planner:** every step that reads live `cron.job`, applies the migration to TEST, or observes a real tick must be assigned to the **orchestrator session**, not to a subagent plan.

---

## Validation Architecture

### Test framework

| Property | Value |
|---|---|
| Framework (DB gates) | Plain PL/pgSQL under `psql -v ON_ERROR_STOP=1` — **pgTAP is NOT installed** (`test_retention_orphaned_running.sql:42-44`) |
| Config / runner | `.github/workflows/ci.yml` job `sql-tests`, discovery loop at `:1018-1036` |
| Location contract | `supabase/tests/test_*.sql` — anywhere else and it never runs in CI |
| Quick run | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_retention_orphaned_running.sql` |
| Full suite | the `sql-tests` job (all `supabase/tests/test_*.sql`) |
| Python side | `pytest` from **`analytics-service/`** only (repo-root run causes VCR cassette misses → live broker calls) |

### Phase requirements → test map

| Req | Behavior | Type | Command | Exists? |
|---|---|---|---|---|
| JOB-05 | Orphan >4h `claimed_at` → `failed_final`, row survives | SQL gate | `psql … -f supabase/tests/test_retention_orphaned_running.sql` | ❌ **asserts the OPPOSITE today** — Wave 0 rewrite |
| JOB-05 | 3h batch-tail row untouched (SC#2) | SQL gate | same | ✅ exists at `:175-182`, preserve |
| JOB-05 | NULL-claim row >48h → `failed_final` | SQL gate | same | ❌ Wave 0 |
| JOB-05 | NULL-claim row <48h untouched | SQL gate | same | ❌ Wave 0 |
| JOB-05 | `next_attempt_at` advanced (§7) | SQL gate | same | ❌ Wave 0 |
| JOB-05 | **No row DELETEd** by the tick | SQL gate | same | ❌ Wave 0 — the assertion that makes "never DELETE" checkable |
| JOB-05 | Body still carries `interval '4 hours'` | SQL gate | same | ✅ `:94-99`, preserve |
| JOB-05 | Schedule is the chosen hourly expression | SQL gate | same | ❌ **replaces** the broken hour-band cast at `:110-114` |
| JOB-05 | Migration self-verify (STEP 2) | in-migration `DO` | applied on TEST via MCP | ❌ Wave 0 |
| JOB-08 | WON'T-FIX carrying the measurement | doc artifact | n/a | ❌ Wave 0 (SUMMARY + REQUIREMENTS.md) |
| §3 fixture fix | fence test stops writing `running` w/o `claimed_at` | pytest (live, auto-skip) | `cd analytics-service && python3 -m pytest tests/test_compute_jobs_fencing.py -k defer` | ✅ file exists; two-line edit |

### Sampling rate
- **Per task commit:** `psql … -f supabase/tests/test_retention_orphaned_running.sql`
- **Per wave merge:** full `sql-tests` discovery loop
- **Phase gate:** full `sql-tests` green + a real observed tick on TEST (orchestrator session) before merge

### Wave 0 gaps
- [ ] Rewrite `supabase/tests/test_retention_orphaned_running.sql` — 6 new/changed assertions, §8
- [ ] Add the "no DELETE" assertion
- [ ] Neuter-and-observe-RED for **every** new assertion, restore, record the observation
- [ ] Fix `analytics-service/tests/test_compute_jobs_fencing.py:1148` and `:1200` (or file with §3's evidence)

---

## Security Domain

| ASVS category | Applies | Standard control at HEAD |
|---|---|---|
| V2 Authentication | no | Change is a pg_cron job with no auth surface |
| V3 Session management | no | — |
| V4 Access control | **yes** | `compute_jobs` is RLS deny-all + `FORCE ROW LEVEL SECURITY`. Phase 143 **proved by live tick** that the pg_cron role (`postgres`, `rolbypassrls = true`) can write it (`143-CENSUS.md` part B §(10)-(11)). 144 inherits that; it does not re-litigate it. |
| V5 Input validation | **yes** | No parameters — the cron body is a fixed, schema-qualified literal. Keep it that way; never build the predicate from a variable. |
| V6 Cryptography | no | — |
| V7 Error handling / logging | **yes** | `last_error` is hard-redacted from `get_user_compute_jobs` (`20260516104201:780`) and pinned by `analytics-schemas.ts:195` (`z.null()`). Never write a secret or a raw upstream error into it. |

| Threat | STRIDE | Mitigation |
|---|---|---|
| A janitor that DELETEs production work | Denial of service | UPDATE-only + a STEP 2 assertion that the deployed body contains no `DELETE`; `supabase/migrations/**` auto-applies to PROD, so the assertion is the last line of defence |
| Unbounded UPDATE holding locks during an incident | DoS | `MATERIALIZED` CTE + `LIMIT 500` + `FOR UPDATE SKIP LOCKED` (D-19 precedent) |
| Secret leakage via `last_error` | Information disclosure | Fixed literal strings only; redaction already enforced at the RPC and zod layers |
| `metadata` heap DoS | DoS | `compute_jobs_metadata_size_bounded` ≤ 8192 B (`20260515210000:145-148`) |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | The 6 TEST NULL-claim rows were produced by `test_compute_jobs_fencing.py`'s live fixtures | §3 | If wrong, there IS an unknown production writer and the phase would ship a janitor over an undiagnosed invariant violation. **Mitigated:** §3 gives the exact confirming query and its kill criteria. Run it before planning closes. |
| A2 | No hand-registered cron job exists outside `supabase/migrations/**` occupying `:50` | §5 | A collision at `:50`. **Mitigated:** orchestrator runs `SELECT jobid, jobname, schedule FROM cron.job` on both projects; fallback `:25`. |
| A3 | pg_cron on both projects is ≥1.4 so `cron.unschedule`-then-`schedule` behaves as the repo assumes | §Migration skeleton | A duplicate-name error or a silent overwrite. **Mitigated:** every prior cron migration makes the same assumption and has ticked in production. |
| A4 | ROADMAP's jobid mapping (11 = orphaned_running, 4 = done, 8 = failed) still holds | §7, §9 | Cosmetic only — the migration keys on `jobname`, never on jobid. |
| A5 | 48 h is acceptable as arm B's threshold | §4 | Too long → the 6 TEST rows still clear it (all ≥5 days), so no observable loss. Too short is the real hazard and 48 h is 1.81× the derived ceiling. Founder may prefer 72 h; the derivation supports either as "≥26.5 h rounded to a cadence multiple". |

**Everything else in this document is `[VERIFIED]` against a file read this session, with path and line range, and quoted verbatim where the value is discrete.**

---

## Open Questions

1. **Does the terminalization need a Sentry / operator signal?**
   - Known: `cron.job_run_details.return_message` carries the command tag only, so the run log cannot report counts. Phase 143 solved the analogous problem by writing a `metadata` marker (`{source: reconcile-sweep, detected_at}`) that the analytics worker reads to fire its alert (`test_reconcile_dropped_enqueue_sweep.sql:5-8`).
   - Unclear: whether PROD terminalizing a job is alert-worthy at all, given PROD's `running` population is structurally zero.
   - Recommendation: **defer.** A first terminalization on PROD is by definition the first time a worker has been down >4h — which Railway/Sentry already surfaces by other means. If wanted later, a `metadata` marker mirroring 143's is the sanctioned shape (watch the 8 KB CHECK).

2. **Should the chain-mid residual (§6) be closed by widening Phase 143's predicate?**
   - Known: 143 requires `NOT EXISTS (any compute_jobs row)`; a terminalized orphan excludes the strategy permanently. 143's own header argues safety is carried by the terminal-`strategy_analytics` conjunct, not the zero-jobs conjunct — so widening to "no NON-TERMINAL row" may be tractable.
   - Unclear: whether that widening is safe for the 31-day-retention interaction 143's header warns about at `:76-82`.
   - Recommendation: **out of scope.** File to `TODOS.md` with this note.

3. **Does arm B need a kind filter?**
   - Known: all 6 observed rows are `poll_positions`, but the arm as written is kind-agnostic and 48 h dominates every kind's cadence (§4).
   - Recommendation: **no filter.** A kind filter would be a bare assumption that the class is `poll_positions`-only, and §3 shows the class is defined by the *writer shape*, not the kind.

4. **`error_kind = 'permanent'` vs leaving it NULL?**
   - Known: `permanent` selects the "can't retry automatically" `user_message` arm and matches the column's documented meaning (`20260411144407:159-160`). Neither string is rendered anywhere today (§2).
   - Recommendation: `'permanent'` — costless now, correct if a surface ever renders `user_message`.

---

## Sources

### Primary (HIGH confidence — read in full this session)
- `supabase/migrations/20260411144407_compute_jobs_queue.sql` — status CHECK `:112-120`, `error_kind` CHECK `:127`, cascade `:108`, in-flight indexes `:179-188`, watchdog index `:195-197`, `updated_at` trigger `:265-268`
- `supabase/migrations/20260416125430_contact_request_metadata.sql:154-161` — latest in-flight partial unique index
- `supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql:719-820` — latest `get_user_compute_jobs`; `:568-624` `reclaim_stuck_compute_jobs`; `:626-700` `reset_stalled_compute_jobs`
- `supabase/migrations/20260719073701_claim_kind_filter.sql:150-230` — latest claim RPC
- `supabase/migrations/20260529170000_defer_compute_job_claim_token_fence.sql:120-165` — latest `defer_compute_job`
- `supabase/migrations/20260720120000_retention_orphaned_running_window_4h.sql` (entire) — the mechanism being replaced
- `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql:105-160` — Phase 142 deployed reaper body
- `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql:1-82`, `:690-760` — Phase 143 header + deployed body
- `supabase/migrations/20260515210200_retention_crons_high_hardening.sql:240-262` — `retention_compute_jobs_failed` deployed body
- `supabase/migrations/20260515113853_retention_crons_safe.sql:190-212` — `retention_compute_jobs_done` deployed body
- `supabase/migrations/20260412094449_compute_jobs_admin_and_defer.sql:221-280` — `enqueue_poll_positions_for_all_strategies`
- `supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql:108-296` — latest `enqueue_compute_job` in-flight probes
- `supabase/migrations/20260515210000_compute_jobs_high_hardening.sql:142-153`, `:244-262` — metadata + claimed_by CHECKs
- `supabase/tests/test_retention_orphaned_running.sql` (entire, 192 lines)
- `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql:1-70` — gate template contract
- `src/app/api/strategies/[id]/sync-progress/route.ts` (entire) — the poller read path
- `src/lib/sync-progress.ts:1-92` — wire contract + `StitchJobStatus`
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:185-245`, `:2524`, `:2549`
- `src/lib/analytics-schemas.ts:190-215`
- `analytics-service/main_worker.py:230-260`, `:550-600`, `:976-1100`
- `analytics-service/services/job_worker.py:485-560`
- `analytics-service/tests/test_compute_jobs_fencing.py:1-60`, `:553-700`, `:1130-1215`
- `.github/workflows/ci.yml:833-1040` — `sql-tests` job
- `.planning/ROADMAP.md` § Phase 144; `.planning/REQUIREMENTS.md:55,57,1406-1407`

### Secondary (MEDIUM confidence)
- `144-CONTEXT.md` live census, 2026-08-17 — treated as ground truth for row counts (per the task brief), independently corroborated where possible

### Tertiary (LOW confidence)
- None. No web search was needed or performed; every question was answerable from the repository.

---

## Metadata

**Confidence breakdown:**
- §1 status vocabulary — **HIGH.** Constraint read verbatim; re-base discharged by exhaustive grep; corroborated in TS.
- §2 user_message / poller path — **HIGH.** Full read path traced route → RPC → client, and the route carries an explicit comment naming `user_message` as a field it refuses to project.
- §3 NULL-claim writer — **HIGH on the exclusion** (every SQL writer enumerated and read; zero Python/TS writers), **MEDIUM-HIGH on the attribution** (5-attribute + date-window match; one query would make it HIGH).
- §4 threshold derivation — **HIGH** on the inputs (three constants read from source), **MEDIUM** on the rounding choice (a judgement call, stated as such).
- §5 cron slots — **HIGH** on the in-repo table (exhaustive grep of `cron.schedule`), **UNVERIFIED** against live `cron.job`.
- §6 re-enqueue — **HIGH.** Index predicate, enqueue probe, fan-out RPC and 142's exclusion set all read verbatim.
- §7 retention interaction — **HIGH.** Both deployed bodies read; the claim RPC's non-advancement of `next_attempt_at` verified.
- §8 gate breakage — **HIGH.** Both breaking assertions read verbatim; CI discovery loop read.

**Research date:** 2026-08-17
**Valid until:** 2026-09-16 (30 days — stable schema). ⚠️ Two facts are shorter-lived: the live cron-slot set and the `compute_jobs` census, both of which must be re-measured in the orchestrator session immediately before the migration is written and again before merge.
