# Phase 144: JOB — WR-02 orphaned-running DELETE→terminal UPDATE + cadence — Pattern Map

**Mapped:** 2026-08-17
**Files analyzed:** 4 planned artifacts (1 migration, 1 SQL gate, 1 TS gate, 1 optional pytest)
**Analogs found:** 4 / 4 (3 exact, 1 role-match)
**Read-only:** no source was modified; this file is the only write.

---

## File Classification

| New artifact | Role | Data flow | Closest analog | Match |
|---|---|---|---|---|
| `supabase/migrations/2026081?######_retention_orphaned_running_terminalize.sql` | migration (cron re-register) | batch / scheduled mutation | `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` (structure) + `20260802120000_strategy_analytics_stuck_computing_reaper.sql:501-528` (the bounded terminal-UPDATE body) | exact (composite of two) |
| `supabase/tests/test_<name>.sql` | test (CI SQL gate) | batch, EXECUTE-the-deployed-body oracle | `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql` | exact |
| `src/__tests__/<name>.test.ts` | test (migration-content gate) | file-I/O, pure text | `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts` | exact |
| `analytics-service/tests/test_*.py` (only if the writer-bug fix lands) | test (unit) | — | `analytics-service/tests/test_main_worker.py::TestReconcileSweepMarkerContract` (named at `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts:86`) | role-match, not opened |

---

## ⛔ Three HEAD facts that falsify lines in 144-CONTEXT.md — verify before planning

1. **`user_message` is NOT a `compute_jobs` column.** CONTEXT says "there is a `user_message` column in the family — confirm at HEAD". It is a **synthesised output column of the `get_user_compute_jobs` RPC**, computed from `(status, error_kind)` — `20260510181014_compute_jobs_user_message_and_rate_limit_grief.sql:149,181,219`, preserved verbatim at `20260516104201:733,761,797`. The real writable columns are `last_error TEXT` and `error_kind TEXT CHECK (error_kind IN ('transient','permanent','unknown'))` — `20260411144407_compute_jobs_queue.sql:125-126`. ⇒ the "user-facing reason" must be written to `last_error` (+ `error_kind = 'permanent'`, which is what makes the synthesised `user_message` read as terminal), not to a non-existent column. **Any migration written against `user_message` will fail to apply.**
2. **`failed_final` IS in the CHECK vocabulary** — confirmed at `20260411144407:112-120`: `('pending','running','done','done_pending_children','failed_retry','failed_final')`. No later migration redefines it (grep of all migrations, 2026-08-17). CONTEXT's "VERIFY before writing" is discharged: `failed_final` is correct and available.
3. **`compute_jobs` carries an ON-UPDATE trigger.** `compute_jobs_set_updated_at_trigger` (`20260411144407:266`) re-stamps `updated_at` on every UPDATE. Harmless here, but it means the DELETE→UPDATE switch makes rows *mutate* rather than vanish, and it is the only trigger on the table — there is **no** status-bridge trigger on `compute_jobs`, so terminalizing a row does **not** cascade into `strategy_analytics`. State that explicitly in the header rather than leaving a reviewer to wonder.

---

## Pattern Assignments

### 1. The migration → copy from `20260816140000` (skeleton) + `20260802120000` (body)

**Header structure** — `20260816140000:1-576`, in this order, and copy the section headings verbatim:
`-- Migration: <one line> -- (JOB-xx, Phase N, v1.19, date)` → `Why this migration exists` → `CADENCE HONESTY` → `Threshold rationale` → `Scope discipline` → `Idempotency` → `Convention deviation` → `Operator observability` → `PROD-AUTO-APPLY WARNING` → `Prose hygiene`.

Load-bearing paragraphs to reproduce with 144's own content:

- **Cadence honesty** (`:36-49`): the schedule is *post-threshold detection latency*; worst case ≈ threshold + cadence; "it does NOT bound user-visible wait and this file makes no such claim." Also copy the *minute-selection* paragraph — it enumerates every occupied slot and says why the chosen one is clear. ⚠️ `:35` is now `reconcile_dropped_enqueue_sweep`; `*/15` is 142's reaper.
- **Threshold derivation** (`:51-71`): the pattern is "GRACE WINDOW = X, derived rather than guessed", then **each rejected alternative named with HOW it is wrong**, then the sentence "A bare number with no derivation is what Phase 106's janitor was REVERTED for. This paragraph is the derivation." 144's NULL-`claimed_at` arm keys on `created_at` with its own threshold and **must** carry this shape.
- **Anchor rationale / rejected columns** (`:116-150`): each rejected column gets a `* col — REJECTED. <mechanism>` bullet. For 144 the analogous question is: why `created_at` and not `claimed_at` (NULL by construction), not `updated_at` (the `set_updated_at` trigger above re-stamps it on *every* write — a genuine Phase-106-shaped hazard on this table), not `next_attempt_at`.
- **Scope discipline** (`:230-244`): explicit "does NOT touch" list. 143's own list already reserves this cron for 144: `20260816140000:236-237` — "the retention crons, retention_compute_jobs_orphaned_running (**Phase 144 owns that**)". 144's list must in turn exclude jobid 4 / jobid 8 / jobid 9.
- **Invariant checklist** (`:435-477`): the sanctioned `BEGIN`/`COMMIT` + session `SET lock_timeout` deviation from `.claude/agents/migration-reviewer.md` #14, then APPLICABLE vs VACUOUSLY-satisfied invariants enumerated one per line. Copy wholesale; the vacuous list is identical for 144 (no function, no policy, no view, no index, no column).
- **Operator observability** (`:517-540`): ⭐ **already corrected** — `cron.job_run_details.return_message` holds the **command tag** (`'DO'`), not `RAISE NOTICE` text. Do not rebuild the falsified premise. 144 must count rows, not read the log.

**Transaction + fail-loud frame** — `20260816140000:577-599`:
```
BEGIN;
SET lock_timeout = '5s';
DO $$ ... SELECT EXISTS(... extname='pg_cron') ...
  IF NOT v_has_pg_cron THEN RAISE EXCEPTION '...' USING ERRCODE = 'feature_not_supported';
```
⛔ Do **not** copy the silent-skip ELSE arm at `20260717233529:288` — `:584-587` records why.

**Re-apply pattern** — `20260816140000:603-605` (identical at `20260719120000:80-82`, `20260720120000:58-60`, `20260802120000:448-450`):
```sql
IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = '<name>') THEN
  PERFORM cron.unschedule('<name>');
END IF;
PERFORM cron.schedule('<name>', '<sched>', $cron$ ... $cron$);
```
144 re-registers the **existing** name `retention_compute_jobs_orphaned_running` (`20260720120000:65`). Keeping the name is what makes `test_retention_orphaned_running.sql` continuous; renaming would strand it. ⚠️ CORRECTED 2026-08-17: the deployed jobid is NOT continuous — unschedule+schedule drops and re-inserts, measured TEST 11→19 at apply. The jobname is the stable identifier.

**The body: bounded terminal UPDATE** — the *only* in-repo precedent is `20260802120000:501-528`:
```sql
UPDATE public.strategy_analytics sa
   SET computation_status = 'failed', computation_warned = FALSE,
       computation_error = '<fixed literal>', computing_started_at = NULL
 WHERE sa.strategy_id IN (
         SELECT s.strategy_id FROM public.strategy_analytics s
          WHERE ... ORDER BY s.computing_started_at ASC
          LIMIT 25 FOR UPDATE SKIP LOCKED)
   AND sa.computation_status = 'computing';   -- compare-and-set fence
```
Four transferable properties, each documented at `20260802120000:457-496`:
- **Every column in the SET list is justified individually** and the justification names the failure if omitted (`computation_warned` → "a FALSE SUCCESS on a money surface").
- **Fixed-literal user-facing message**: no identifier, no row data, no internal component name, no re-attribution of fault (`:464-469`). 144's `last_error` literal must meet the same bar.
- **The trailing `AND <status> = <pre-state>` compare-and-set fence** — if a real writer terminalizes between subselect and UPDATE, the janitor writes nothing. 144 needs `AND cj.status = 'running'` on the outer UPDATE.
- **NULL-stamp handling is an explicit decision, not an accident** (`:475-476`): "a NULL stamp is a WRITER bug, not a stranded job. SKIP it; never reap it." ⚠️ **144 deliberately reverses this call** for its second arm. That is a genuine contradiction with the 142 precedent and must be argued, not blended — see *Contradictions* below.

⚠️ **Bound shape — prefer 143's CTE over 142's IN-subquery.** 142 uses `WHERE ... IN (SELECT ... LIMIT 25 ...)`; 143 replaced it with `WITH batch AS MATERIALIZED (...) ... FROM batch` precisely because the IN-subquery subplan can be re-executed per outer row so the LIMIT is not a bound (D-19: `20260816140000:654-678`, and both gates *forbid* the IN shape — `test_reconcile...sql:332`, `.test.ts:360`). **143 is more recent and its shape was measured; use the materialized CTE.** But copy honestly: `20260816140000:657-669` records that `AS MATERIALIZED` is *not* what creates the bound in that shape (the `FOR UPDATE` locking clause already prevents inlining) — the keyword is shape insurance, and the bound is proven only by executing against LIMIT+1 rows.

**Two arms, one body.** 144's body has arm 1 (`claimed_at` past 4h) and arm 2 (`claimed_at IS NULL`, keyed on `created_at`). Consequence for every gate: 143's occurrence-count gates were calibrated to a one-arm body (`v_mat <> 1`, `AS MATERIALIZED` expected exactly 1). 144 must recount deliberately and say in the message which arm each occurrence belongs to.

**Self-verifying STEP 2** — `20260816140000:775-930`. Copy the discipline, not the assertions:
- Read the body **back out of `cron.job`**, never re-type it (`:796-798`).
- Assert `count(*) = 1` for the jobname first (`:790-794`).
- Schedule compared by **string equality**, never `::INT` cast — four of five fields are `*` (`:804-808`).
- **Every failure message names the CONSEQUENCE**, not the missing token (`:778-780`). Compare `20260720120000:90` ("does not scope to status = 'running'") — that is the *old*, weaker register; 144 should write in 143's.
- Positive anchors, then the bound, then negative anchors, then one summary `RAISE NOTICE` enumerating what passed (`:929`).

---

### 2. The CI SQL gate → copy `supabase/tests/test_reconcile_dropped_enqueue_sweep.sql`

CI auto-discovers `supabase/tests/test_*.sql` (`.github/workflows/ci.yml:1018-1022`) — no registration step.

| Convention | Evidence | Note for 144 |
|---|---|---|
| **Part 1 = STRUCTURAL, UNGATED, no transaction, no skip arm** — it is the TDD RED that fires before the migration reaches TEST | `test_reconcile...sql:170-181, 194-196` | ⛔ Explicitly do **NOT** copy `test_retention_orphaned_running.sql:71-83`, whose two presence gates `RAISE NOTICE … RETURN` and **no-op the entire file** when the migration is unapplied. That file is named as the anti-pattern at `test_reconcile...sql:41-44`. |
| Parts 2+ skip on **one** condition only: genuinely absent `pg_cron`. A missing cron job while pg_cron is present is an EXCEPTION | `:46-50, 402-411` | |
| **Per-part `BEGIN;` / `SET LOCAL lock_timeout='5s'` / `ROLLBACK;`** — never an outer whole-file transaction | `:53-65, 374-375, 632` | The reason is spelled out: psql's nested BEGIN creates no savepoint, so the first inner rollback ends the outer txn and every later part AUTOCOMMITS onto the shared TEST project. `test_retention_orphaned_running.sql:54,191` uses the older whole-file frame — **143 wins**. |
| **Backdate, never sleep** | `:97-102, 417, 447-460` | 144 is easier: `compute_jobs.claimed_at` and `created_at` are both directly INSERT-writable, so both thresholds are crossed by seeding, exactly as `test_retention_orphaned_running.sql:135-152` already does with `now() - interval '5 hours'`. |
| **FROZEN CLOCK**: one txn ⇒ `now()` constant; never assert by comparing two `now()`-derived values — such an assertion cannot fail | `:117-120` | |
| **Oracle = `EXECUTE v_command`** read from `cron.job.command`; never a re-typed predicate | `:27-32, 505` | |
| **Identity-scoped assertions** (`= ANY(v_seeded)` / `WHERE id = id_a`), never a global count or global empty state | `:82-86, 615-624` | |
| **Isolation by construction** — century-backdated seeds outrank foreign rows under the deployed `ORDER BY`; ⛔ never "fix" this with cross-tenant neutralizing UPDATEs (deleted in 142.1 as D-05/D-18) | `:68-95` | 144's arms are `id`-scoped and its bound arm needs the same century trick. |
| **Directional arm table in the part header** (heal arms vs each documented false-positive guard), then a whole-block invariant asserting the exact count | `:350-373, 615-624` | Direct 144 analogue already exists in miniature at `test_retention_orphaned_running.sql:61-68, 175-182` — the 3h batch-tail survivor is the RT-01 regression arm and **must be carried forward**, since 144 keeps the 4h threshold unchanged. |
| **A dedicated bound part**: seed LIMIT+1, run the oracle twice, assert *which* rows moved (25 oldest healed, youngest untouched) then that tick 2 progresses | `:740-848` | "Asserting WHICH rows must move is strictly stronger than counting HOW MANY moved" (`:755-757`). |
| **Parts that state what they do NOT prove** rather than letting a green stand in | `:638-669` (Part 3), `:122-139` | 144 inherits an explicit non-coverage: the cron role's RLS posture cannot be proven by any CI gate — but **143 already discharged it by live tick** (`20260816140000:367-383`), so 144 says "inherited, not re-litigated". |
| No fixed UUID literals — `gen_random_uuid()` everywhere (shared TEST project) | `:155-157` | |
| ⛔ No psql backslash meta-commands **anywhere, comments included** — the preflight greps whole files (`ci.yml:951-1000`); and do not name them in prose either, or the gate refuses itself | `:145-153` | |
| ⛔ Do **not** add the new cron to `test_retention_crons_safe.sql` | `:158-161`; that file's register is `expected_jobs` at `test_retention_crons_safe.sql:92-98` and its loop asserts every body matches `%where%created_at%` | ⚠️ **144 is a borderline case**: `retention_compute_jobs_orphaned_running` is *not* in that array today (only `retention_compute_jobs_done` / `_failed` are), and 144's second arm *does* key on `created_at`. Adding it would make the register look complete while pinning nothing 144 cares about. Keep it out and say why. |

---

### 3. The TS migration-content gate → copy `src/__tests__/reconcile-dropped-enqueue-sweep.test.ts`

| Convention | Evidence |
|---|---|
| `FIX_TS` / `FIX_FILENAME` / `FIX_PATH` constants at top; every expected literal **declared locally** with its production source in a comment — "a gate that reads its expectation out of the artifact it guards cannot fail" | `:57-97` |
| `cronBody(sql)` helper extracting `/\$cron\$([\s\S]*?)\$cron\$/` — **with the anti-vacuity guard** asserting the extracted span contains the mutating statement | `:99-123` |
| **Body-scoping is load-bearing**: the header legitimately *discusses* forbidden tokens while the gate forbids them; a whole-file grep would be tripped by correct prose | `:37-50` |
| Negative assertions: no `IN (SELECT … LIMIT)`, no rejected anchor column, no `CREATE FUNCTION`, no `SECURITY DEFINER` | `:344-384` |
| Migration must contain `pg_extension`, `feature_not_supported`, `RAISE EXCEPTION`, `FROM cron.job` | `:386-413` |
| ⭐ **"no LATER migration silently re-registers the same cron jobname"** — scans `^\d{14}_.*\.sql$` with prefix `> FIX_TS` | `:415-437` |

⚠️ **This last test is a live trap for Phase 144, in the opposite direction.** 143's gate scans later migrations for `cron.schedule('reconcile_dropped_enqueue_sweep'` only — 144 re-registers a *different* jobname, so **it will not break**. But 144's own new TS gate must pin `retention_compute_jobs_orphaned_running`, and the moment it does, **`src/__tests__` will hold a gate whose FIX_TS points at 144's migration while `test_retention_orphaned_running.sql` still asserts the 20260720120000 body**. Both must move in the same commit, exactly as `:428-435` demands.

---

## Shared Patterns

**Filename timestamp convention.** `^\d{14}_snake_case_description.sql`, i.e. `YYYYMMDDHHMMSS`, and the prefix must be **strictly greater than the repo tip** or the backdated-migration CI guard fails (invariant #1/#2, stated at `20260816140000:450-452`). The 14 digits are *not* a real clock time — the house style is authoring date + a round slot (`120000`, `130000`, `140000`, `150000`; see 20260803's three files). Repo tip today is **`20260816140000`**. ⇒ 144 should take `20260817120000_…` (or later same-day slot). ⚠️ Applying via the Supabase MCP stamps `now()` in the remote ledger, producing PR-Y2-style drift — a known, already-recorded hazard.

**Fail-loud on absent pg_cron.** `RAISE EXCEPTION … USING ERRCODE = 'feature_not_supported'` in every one of `20260719120000:74-77`, `20260720120000:53-56`, `20260802120000:441-445`, `20260816140000:596-599`. Never the `RAISE NOTICE`-and-continue arm at `20260717233529:288`.

**Prose hygiene (bidirectional).** `20260816140000:556-575`: keep every token a mechanical gate forbids **out of the cron-body literal**, keep every gate **scoped to the body** — and never write the opening dollar tag in a comment, because the non-greedy extraction regex will match the prose pair and return a comment span with no statement in it. That incident was caught only by the anti-vacuity guard.

**PROD-auto-apply warning + apply order.** `20260816140000:545-554`: merging `supabase/migrations/**` to `main` auto-applies to PROD. Apply to TEST via MCP first, run the SQL gate, and inspect **one real tick** in `cron.job_run_details` before merge. ⚠️ The MCP is stripped from subagents — that step belongs to the orchestrator session.

---

## Anti-patterns / traps these analogs encode

1. ⭐ **`toContain("LIMIT 25")` passes for `LIMIT 2500`.** Fixed 2026-08-17 in all three sibling gates. The word-bounded forms:
   - PL/pgSQL (migration self-verify + SQL gate): `IF v_command !~ 'LIMIT[[:space:]]+25([^0-9]|$)' THEN` — `20260816140000:876`, `test_reconcile...sql:288`. The `|$` arm is required or a body ending exactly at the limit false-REDs.
   - TypeScript: `.toMatch(/LIMIT\s+25(?![0-9])/)` — `.test.ts:280`.
   **144 must use these forms for its own bound.**
2. ⭐ **A token gate on a name that appears twice cannot fail.** `NOT ILIKE '%public.compute_jobs%'` was satisfied by the INSERT target alone after the guarded conjunct was deleted — measured green. Fix: **occurrence count** — `(length(upper(x)) - length(replace(upper(x), 'PUBLIC.COMPUTE_JOBS','')))/length('PUBLIC.COMPUTE_JOBS')` and assert `= 2` (`20260816140000:830-833`, `test_reconcile...sql:243-246`, `.test.ts:183-192`). ⚠️ **144's body will name `public.compute_jobs` more than once too** (UPDATE target + possibly both arms). Count deliberately and say which occurrence is which.
3. **Regex windows that match nothing.** `'\mIN\M[[:space:]]*\([[:space:]]*SELECT[^)]*LIMIT'` could never fire because no realistic predicate avoids a `)` before the LIMIT. Corrected to `[^;]*` (single-statement bound) — `20260816140000:907-918`, `.test.ts:349-360`.
4. **`AS MATERIALIZED` grepping is shape enforcement, never a bound proof.** Measured: removing it changes neither plan nor result for a locking CTE. Every gate in phases 142/142.1 passed over a bound that did not exist. Only executing against LIMIT+1 real rows falsifies it (`20260816140000:894-904`, `test_reconcile...sql:744-750`).
5. **A gate that green-skips when its subject is absent is not evidence** — `test_retention_orphaned_running.sql:71-83` is the named offender.
6. **Comparing two `now()`-derived values inside one transaction is an assertion that cannot fail** (`test_reconcile...sql:117-120`).
7. **A bare threshold number with no derivation is what Phase 106's janitor was REVERTED for** (`20260816140000:70-71`). Directly binding on 144's new `created_at` threshold.
8. **`cron.job_run_details.return_message` is the command tag** (`'DO'`), not NOTICE text — measured 2026-08-17 (`20260816140000:517-533`). 142's reaper header still rests on the falsified premise; already filed, not 144's to fix.
9. **A one-file scope amendment is incomplete**: when the cron body's shape legitimately changes, the occurrence counts in *all three* siblings (migration STEP 2, `supabase/tests/*.sql` Part 1, `src/__tests__/*.test.ts`) move in the **same commit** (`20260816140000:826-829`).
10. **A caller-suppliable INTERVAL on a cross-tenant SECDEF job is the `20260516170100` incident class — the parameter IS the attack surface.** Keep the body an inline dollar-quoted literal; no function, no grant, no parameter (`20260816140000:239-244`).

---

## Contradictions between analogs — pick one, do not blend

**(A) NULL-stamp handling — 142 vs 144's second arm.** `20260802120000:475-476` states the rule: *"a NULL stamp is a WRITER bug, not a stranded job. SKIP it; never reap it."* 144's CONTEXT adds an arm that does the opposite: it terminalizes `running` rows with `claimed_at IS NULL`. **Recommendation: 144's arm is correct and 142's rule is not universal — but the divergence must be argued explicitly in 144's header, not silently.** The two situations differ materially: 142's NULL-stamp row has no key at all to age from, whereas `compute_jobs.created_at` is `NOT NULL DEFAULT now()` (`20260411144407:132`) and gives a real, derivable anchor. 142's own rule is *also* what has kept the 6 TEST rows immortal for 14 days. ⛔ Do **not** blend by "skipping NULL rows but logging them" — that reproduces the current silent accumulation. And per CONTEXT + Rule 6, shipping the janitor arm without tracing the writer does not close the invariant.

**(B) Gate framing — `test_retention_orphaned_running.sql` vs `test_reconcile_dropped_enqueue_sweep.sql`.** The former uses a whole-file `BEGIN;…ROLLBACK;`, two green-skip presence gates, and terse "does not scope to X" failure messages. The latter uses per-part transactions, a deliberately ungated Part 1, and consequence-naming messages. **143 wins: more recent (2026-08-16 vs 2026-07-19), more tested, and it names the older file as the anti-pattern by path and line.** ⚠️ 144 will be *editing the world the older file guards*: `test_retention_orphaned_running.sql:94-99` asserts `interval '4 hours'` present and `interval '2 hours'` absent, and `:160-182` asserts the orphan row is **DELETEd** (`count = 0`). **That DELETE assertion turns RED the moment 144's UPDATE ships.** Decide in planning whether to rewrite that file in 143's register or supersede it with the new gate — but it cannot be left untouched, and leaving it is not a green.

**(C) Bound shape — 142's `IN (SELECT … LIMIT)` vs 143's materialized CTE.** 143 wins; 142's shape is the D-19 defect and both 143 gates actively forbid it.

---

## No Analog Found

| Artifact | Reason |
|---|---|
| A worker-side writer fix for `status='running' AND claimed_at IS NULL` | No analog mapped — the claim RPC / `poll_positions` path was not traced in this pass (out of a pattern-mapper's remit). CONTEXT sanctions filing it with evidence if it is a real investigation. |
| An invariant gate detecting future NULL-claim `running` rows | No in-repo precedent for a standing data-invariant probe on `compute_jobs`; nearest relatives are the shape self-verify blocks, which assert on catalogs and not on data. Treat as first-principles work deserving extra review weight, in the register `20260802120000:485-487` and `20260816140000:348-359` use for their own precedent-free arms. |

---

## Metadata

**Search scope:** `supabase/migrations/`, `supabase/tests/`, `src/__tests__/`, `.github/workflows/ci.yml`
**Files read in full:** 4 · **targeted reads:** 4 · **Date:** 2026-08-17
