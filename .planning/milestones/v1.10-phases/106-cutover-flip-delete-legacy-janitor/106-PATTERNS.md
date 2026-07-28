# Phase 106: Cutover — flip + delete legacy + janitor (106-PROPER) — Pattern Map

**Mapped:** 2026-07-14
**Work items analyzed:** 6 (D1/D2 flag-delete · D3 RPC guard · D4 dark-path delete + grep-gates · D5 M2 ordering · D7 janitor cron · D7 after() fail-loud)
**Analogs found:** 6 / 6 (all in-codebase; this is a deletion/hygiene phase, so "analog" = the existing pattern the change must MIRROR or the discipline it must follow)

> ⚠️ **Every line number below was RE-GREPPED this session (2026-07-14). Several CONTEXT/RESEARCH citations had drifted — corrections are called out inline (search "DRIFT").** Re-grep again at execution time; the worker files are large and churn.

---

## Work-Item Classification

| Work item | Role | Data flow | Closest analog (file:line) | Match quality |
|-----------|------|-----------|----------------------------|---------------|
| D3 — RPC admission guard rejecting retired `compute_analytics` kind | migration (SECDEF RPC) | request-response (RPC reject) | `_enqueue_compute_job_internal` p_kind guard `20260510180226_...g10b.sql:190-193` | **exact** (same RPC, same reject idiom) |
| D7 — `computing`-janitor cron | router/cron | batch / event-driven sweep | `routers/cron.py:566 cron_sync` (recurring tick) + `scripts/reset_stuck_computing_rows.py` (logic seed) | **role+flow match** |
| D7 — `after()` fail-loud wrapper | route (Next `after()`) | fire-and-forget → observability | `captureToSentry(...)` at `csv-finalize/route.ts:620` | **exact** (same file, same helper) |
| D5 — M2 single-key ordering swap | service (worker) | transform / ordered-idempotent write | composite seam `job_worker.py:4735-4782` (correct order) | **exact** (sibling seam, same table) |
| D4 — dark-path deletion + grep-gate | service + router + script + test | deletion discipline | source-scan gate `test_cash_basis_series_sc4.py:705-750` | **exact** (existing grep-gate style) |
| D2/D1 — flag-read deletion | route + lib + worker | request-response gate | `keys/sync/route.ts:292` unified/legacy dispatch | **role match** |

---

## Pattern Assignments

### D3 — `_enqueue_compute_job_internal` RPC admission guard (migration, SECDEF RPC)

**⚠️ CONTEXT DRIFT — re-base target correction.** CONTEXT D3 cites `20260710130000_stitch_composite_kind.sql:53,:85` as the re-base target. Those lines are the **CHECK-constraint** DDL (`compute_jobs_kind_check` / `compute_jobs_kind_target_coherence`) — **NOT the RPC body.** The `20260710130000` migration never touches `_enqueue_compute_job_internal`. The **latest full RPC def is `supabase/migrations/20260510180226_compute_jobs_audit_2026_05_07_g10b.sql:164`** (7-param overload). Re-base the guard's `CREATE OR REPLACE` on THAT, and use `20260710130000:53,:69` only as the reference for *which* kind string to reject.

**⚠️ TWO OVERLOADS EXIST — the guard must land in both (or the actually-dispatched one).** `grep` confirms:
- 7-param: `_enqueue_compute_job_internal(uuid,uuid,text,text,uuid[],text,jsonb)` — latest body at `20260510180226:164`.
- 10-param: `_enqueue_compute_job_internal(uuid,uuid,text,text,uuid[],text,jsonb,uuid,uuid,timestamptz)` — from `20260420073003_allocator_holdings.sql:330` (carries the allocator/api_key arms; `p_kind` NULL guard at `:365`). The public `enqueue_compute_job` wrappers route into the 10-param variant (`20260420073003:486` shows the delegation). **The planner MUST decide/verify which overload the retired-kind enqueue would hit and guard it (likely both).** The g10b migration header (`:284-291`) explicitly warns that unqualified COMMENT/REVOKE fails with SQLSTATE 42725 when two overloads coexist — carry that arg-list-qualification discipline.

**Analog — the exact reject idiom to copy** (`20260510180226:190-193`):
```sql
  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
```
The guard is a one-block insert immediately after this, same idiom:
```sql
  IF p_kind = 'compute_analytics' THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: kind ''compute_analytics'' is retired (Phase 106) — no enqueue path remains'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
```

**Why this satisfies D3 (validates no existing rows):** it's a `CREATE OR REPLACE` on the fn body — it touches ZERO table data, so unlike `ALTER TABLE ... ADD CONSTRAINT CHECK` (which validates the 45 historical `compute_analytics` rows and fails mid-deploy), this reverses cleanly and passes on prod. The registry row + both CHECKs stay admitting the kind (they must — the 45 rows FK-reference it).

**Migration-timestamp + re-base discipline to mirror** (`20260710130000:22-34` header + `:110-168` self-verifying DO block):
- New file name `2026071X...` AFTER the latest migration timestamp (grep `ls supabase/migrations/ | tail`).
- `SET LOCAL lock_timeout = '3s';` (`20260710130000:39`).
- No explicit BEGIN/COMMIT (Supabase wraps each migration — `20260710130000:32-34`).
- End with a self-verifying `DO $$ ... $$;` block asserting the guard body contains the reject (mirror `20260710130000:110-168` which greps `pg_get_functiondef`/`pg_get_constraintdef` and RAISEs on regression). Each RAISE format string a single literal (no `||` — invariant #21).
- Route through migration-reviewer + rls-policy-auditor; test-project MCP catch-up before merge (CONTEXT §specifics).

---

### D7 — `computing`-janitor cron (router/cron, batch sweep)

**Recurring-tick analog:** `analytics-service/routers/cron.py:566` — `@router.post("/cron-sync")` on `router = APIRouter(prefix="/api", ...)` (`:14`). Ticks are **HTTP endpoints triggered by an external scheduler**, not in-process timers. The janitor is a new sibling tick: `@router.post("/cron-janitor")` (or a reap block folded into `cron_sync`).

**⚠️ Scheduling analog — NOTE the two-runtime split.** The Vercel Cron registry is `vercel.json:6-15` (9 crons, e.g. `{ "path": "/api/cron/flag-monitor", "schedule": "*/15 * * * *" }`). Those hit **Next.js** routes under `src/app/api/cron/`. The **Python** `routers/cron.py` `/api/cron-sync` tick is triggered separately (proxied — see `src/app/api/admin/strategy-review/route.ts`, the only TS caller of `cron-sync`). The planner must pick ONE: (a) new Python `@router.post("/cron-janitor")` + a scheduler entry that reaches it, or (b) fold the reap into the already-scheduled `cron_sync`. RESEARCH recommends the Python home; a `*/15` cadence mirrors `flag-monitor`.

**Logic seed to promote** (`scripts/reset_stuck_computing_rows.py`, whole file — 112 lines):
- Threshold: `datetime.now(timezone.utc) - timedelta(minutes=5)`; `.lt("updated_at", threshold)` (`:61-66`). CONTEXT D7 wants **10–15 min, > the ~20–25 min per-kind watchdog ceiling** (`main_worker.py:140`) — re-grep that ceiling and set threshold above it so the janitor never races a legitimately-slow job.
- Active-job probe (`:82-89`): `compute_jobs` where `strategy_id = sid` and `status IN ('pending','running','done_pending_children','failed_retry')` → skip if present.
- Conditional idempotent update (`:97-102`): `update({computation_status:'failed', ...}).eq("strategy_id", sid).eq("computation_status","computing")` — the second `.eq` makes it a compare-and-set (won't stomp a row the worker just flipped).

**⭐ CRITICAL — the janitor race is ALREADY CLOSED by a coherence CHECK (resolve the CONTEXT open item):**
- CONTEXT D7 warns the janitor could reset a LIVE `process_key_long` onboarding to `failed` if `strategy_id` lives only in job metadata, not the column. `long_fetch.py:200` (DRIFT: CONTEXT says `:497`; the resolution is at **`services/ingestion/long_fetch.py:200`**) reads `cred_strategy_id = context.get("strategy_id") or job.get("strategy_id")` — a metadata-first read *for credential resolution*.
- **BUT** the coherence CHECK at `20260710130000_stitch_composite_kind.sql:93` forces `((kind = 'process_key_long') AND (strategy_id IS NOT NULL) ...)` at the **column** level. So every `process_key_long` job row carries a non-null `strategy_id` **column** — which is exactly what the active-job probe (`reset_stuck_computing_rows.py:85`, `.eq("strategy_id", sid)`) matches on. **The column-level probe already catches a live onboarding.** Planner action: KEEP the column probe, and confirm the probe's status set includes every non-terminal status `process_key_long` uses (grep `long_fetch.py` for the statuses it writes — `pending`/`running`/`done_pending_children`). Prefer this proof over extending the probe to metadata (simpler, and the CHECK guarantees it).

**Test analog (SC-5):** new `tests/test_cron_router.py` janitor case, seeded from the script logic; assert reap-when-stale and skip-when-active-job. Mirror the supabase-mock harness style used across `tests/test_job_worker.py`.

---

### D7 — `after()` fail-loud wrapper (Next route, fire-and-forget → Sentry)

**Analog — the exact fail-loud idiom to copy** (`src/app/api/strategies/csv-finalize/route.ts:620`, already correct):
```typescript
      captureToSentry(selectErr, {
        tags: { surface: "csv-finalize", step: "placeholder-precheck" },
        extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
      });
```
Import already present: `import { captureToSentry } from "@/lib/sentry-capture";` (`csv-finalize:13`). A second correct exemplar: `csv-finalize:799` (`captureToSentry(updateError, …)`).

**The console.warn-only GAP to close** (the `after()` placeholder-write failure paths — all silent today):
- `csv-finalize:658-660` — placeholder upsert `placeholderErr` → `console.warn` only.
- `csv-finalize:662-665` — placeholder upsert `catch (placeholderThrow)` → `console.warn` only.
- `csv-finalize:711-713` and `:718-720` — the `after()` enqueue-failure paths (inside `enqueueCsvAnalyticsAfter`, `:669-674`) → `console.warn` only.
- Mirror the same gap in `finalize-wizard/route.ts` (also uses `after`/`isUnifiedBackboneActive` — `:1,:11`).

**Fix pattern:** add a `captureToSentry(err, { tags: { surface, step }, extra: { strategy_id, correlation_id } })` alongside each `console.warn` above (keep the warn), so a silent `after()` failure that leaves a strategy stuck `computing` becomes alertable. This is the *prevention* half; the janitor is the *reaping* half — they pair (RESEARCH §Scope 6).

---

### D5 — M2 single-key ordering swap (worker service, ordered-idempotent write)

**The bug (harmful order today), single-key broker-derive seam** (`job_worker.py`):
1. `:3163-3167` sets `_prestamp_payload["metrics_json_by_basis"]` (the DONE-gating MTM scalar).
2. `:3169-3175` `db_execute(_prestamp_dq_flags)` — **the scalar upsert lands FIRST.**
3. `:3197-3201` `db_execute(_persist_mtm_series)` — MTM series.
4. `:3271-3275` `db_execute(_persist_cash_series)` — cash series.
→ Scalar-before-series = the harmful "fresh scalar over stale/absent series" direction.

**The correct-order analog to MIRROR — composite seam** (`job_worker.py:4735-4782`):
```python
    await db_execute(_persist_cash_series)     # :4743  cash series
    await db_execute(_persist_mtm_series)      # :4775  MTM series
    await db_execute(_write_headline_and_by_basis)   # :4782  DONE-bearing scalar LAST
```
The rationale comment (`:4744-4766`) is the canonical explanation of why series-first reverses the partial-write window into the self-healing direction — copy its reasoning into the single-key fix comment.

**The swap:** move the single-key scalar prestamp (the `_prestamp_payload["metrics_json_by_basis"]` assignment `:3163-3167` + `_prestamp_dq_flags` def `:3169-3173` + `await db_execute(_prestamp_dq_flags)` `:3175`) to AFTER both `persist_basis_series` calls (`:3201` MTM, `:3275` cash). No data dependency; no reader consumes the prestamp between the writes (CONTEXT D5).
- **⚠️ Subtlety for the planner:** `_prestamp_payload` also carries `data_quality_flags` (`:3136`) and `strategy_id` (`:3135`), written in the SAME upsert. Confirm the downstream CSV finalizer (`_enqueue_csv_analytics` at `:3278`) doesn't depend on `data_quality_flags` being written BEFORE the series persists. If it does, split the payload: move only the `metrics_json_by_basis` key to the post-series write, keep the `data_quality_flags` prestamp where it is. CONTEXT frames it as moving the whole prestamp — verify against the finalizer's read order.

**Stale-comment fix (DRIFT):** CONTEXT D5 cites `:4747`. Re-grep lands the stale anchor at **`job_worker.py:4747`** (`"matching the single-key route (:3112-3136), which lands the series before the DONE-gating headline"`). That claim is now FALSE — the current single-key order (`:3163-3275`) lands the scalar FIRST. After the swap makes single-key series-first, either update the anchor to the swapped line range or drop the cross-reference. There is no `:3112-3136` prestamp today; the seam starts ~`:3108`.

**Test:** update any single-key sibling test pinning scalar-first order (expected red → fixed by the swap). Grep `tests/test_job_worker.py` + `tests/test_csv_analytics_runner.py` for prestamp/ordering assertions.

---

### D4 — dark-path deletion + grep-gates (deletion discipline)

**Grep-gate analog to MIRROR** — `tests/test_cash_basis_series_sc4.py:722-750` (`test_single_cash_settlement_persist_seam`): reads the worker source text, strips comments via `_strip_comment(ln, lang="py")`, and asserts a literal count. Also the INERT-read boundary scan `:705-719` (walks scanned files, flags offenders, asserts `not offenders`). **This is the exact style for a new `tests/test_dark_path_deleted.py`:**
```python
    code = "\n".join(
        ln for ln in worker.read_text().splitlines()
        if not _strip_comment(ln, lang="py")
    )
    total = code.count('run_strategy_analytics')
    assert total == 0, "dark path re-entry survived deletion: ..."
```
Mirror the Phase-105 `_metrics_result_for == 0` gate (STATE.md) for `run_strategy_analytics` / `run_compute_analytics_job`, and assert the `compute_analytics` dispatch arm + `TIMEOUT_PER_KIND` entry are gone. The existing seam test at `:727` already NAMES `run_compute_analytics_job` as "the 106-slated dark-path re-entry point" — after deletion, its own warning premise disappears; verify the count invariant (2 cash persists) still holds post-delete.

**Deletion inventory — re-grepped, TS vs Python tagged** (retire-ALL-before-delete-core, D4 zombie order):

| # | Target | File:line (re-grep at exec) | Runtime |
|---|--------|------------------------------|---------|
| 1 | `run_compute_analytics_job` handler | `job_worker.py:1590` (calls `run_strategy_analytics` at `:1607`, import `:1605`) | Python |
| 2 | `compute_analytics` dispatch arm | `job_worker.py:5830-5831` (re-grep — CONTEXT cites `:5831`) | Python |
| 3 | `TIMEOUT_PER_KIND` entry | `job_worker.py:262` | Python |
| 4 | `main_worker.py` watchdog map (6th residue) | `main_worker.py:140` | Python |
| 5 | funding ternary — sync epilogue | `job_worker.py:1519-1521` | Python |
| 6 | funding ternary — **5th LIVE site** periodic re-sync | `cron.py:451` (`"derive_broker_dailies" if BROKER_DAILIES_VIA_FUNDING else "compute_analytics"`; import `:448`) | Python |
| 7 | `routers/analytics.py` (whole file) + unregister router | `routers/analytics.py:24` | Python |
| 8 | `run_strategy_analytics` chain | `analytics_runner.py:1208` (computes at `:1678`) — **KEEP shared helpers + `run_csv_strategy_analytics`** | Python |
| 9 | `phase12_backfill_enqueue.py` + deploy wiring | `scripts/phase12_backfill_enqueue.py:54,:121`; `phase12_deploy.py:350-353` | Python |
| 10 | `legacyKeysSyncHandler` (sole `computeAnalytics` caller) | `keys/sync/route.ts:526` (def; DEPRECATED comment `:524`), `computeAnalytics` call `~:617` | **TS** |
| — | Cosmetic residue (leave or tidy) | `ComputeJobsTable.tsx:62`, `types.ts:1582` | TS |

**Grep-gate to enforce ZERO callers at delete time:** `git grep run_strategy_analytics` (only 2 non-test callers today: `routers/analytics.py:24`, `job_worker.py:1607` — both deleted here); `.eq("kind","compute_analytics")` / `p_kind: "compute_analytics"` → 0. NOTE: the `compute_analytics` **kind teardown is D3's RPC guard, NOT a CHECK drop** — the 45 historical rows keep the registry/CHECK admitting it. In-flight/poisoned rows are not a zombie (unknown-kind dispatch → permanent FAILED `job_worker.py:5870-5882`).

**Test surface to prune same-wave:** `test_analytics_runner.py` (~40 `run_strategy_analytics` tests), `test_job_worker.py` (`run_compute_analytics_job` mocks), `test_phase12_backfill_enqueue.py`, `test_phase12_deploy.py`, `test_phase35_backfill_enqueue.py`.

---

### D2/D1 — flag-read deletion (route + lib + worker gate)

**Dispatch analog (the shape all flag deletions collapse toward)** — `keys/sync/route.ts:292`:
```typescript
  if (await isUnifiedBackboneActive()) {
    ...
    return await unifiedKeysSyncHandler({ strategy_id, userId: user.id, source: resolvedSource });
  }
  return await legacyKeysSyncHandler({ supabase, strategy_id, userId: user.id });  // :~322 — DELETE
```
→ delete the `false` arm (`legacyKeysSyncHandler`, D4 #10), make the unified call unconditional, drop the `if` wrapper.

**Per-flag handling (D2 semantics — delete-and-make-unconditional vs convert-to-503):**

| Site | Current arm | Action |
|------|-------------|--------|
| `keys/sync/route.ts:183-192` | `USE_COMPUTE_JOBS_QUEUE !== "true"` → 503 (`:199`) | env pinned-on → **delete the false arm** (dead) |
| `keys/sync/route.ts:292` + `:322` | `isUnifiedBackboneActive()` unified/legacy split | **delete legacy arm, make unified unconditional** |
| `csv-finalize/route.ts:684-694` | `USE_COMPUTE_JOBS_QUEUE !== "true"` → placeholder-write | **delete the false arm** (D2: failed-placeholder, guards nothing) |
| `csv-finalize/route.ts:1247` | `USE_COMPUTE_JOBS_QUEUE` gate on enqueue | delete gate, unconditional enqueue |
| `finalize-wizard/route.ts` | `USE_COMPUTE_JOBS_QUEUE` 503 arm(s) + `isUnifiedBackboneActive()` (`:11,:314-area`) | **delete false arms** |
| `analytics-service/routers/process_key.py:545` | hard-503 when unified off (OUTAGE, not rollback) | **delete the off arm**, unified unconditional (re-grep `:545`) |

**`isUnifiedBackboneActive()` reader** (`feature-flags.ts:111`, cache/kill-switch machinery `:35 KILL_SWITCH_KEY`, `:90-108 _refreshCache`): D1 Stage B deletes the branches that read it. Keep or retire the reader per the kill-switch's fate.

**⭐ flag-monitor auto-flip → ALERT-ONLY (D1 same-PR edit)** — `src/app/api/cron/flag-monitor/route.ts`:
- The auto-rollback flips the `feature_flags` kill-switch row to `off` (header `:6-10`, `KILL_SWITCH_KEY` `:61`) and sends a Resend email (`:266-270`).
- **Neuter to alert-only:** remove/short-circuit the kill-switch upsert (locate the `.upsert`/`.update` on `feature_flags` — grep `KILL_SWITCH_KEY` writes in this file) while **keeping the error-rate ALERT email** (`:266-270`, the `[ALERT]` send). CONTEXT D1: the kill-switch, its readers, and its monitor die together with the arms they controlled.
- Also repoint/retire the 2nd kill-switch-row reader `phase19-error-rollup/route.ts:41`.

---

## Shared Patterns

### Fail-loud → Sentry
**Source:** `src/lib/sentry-capture.ts` (`captureToSentry`), exemplar `csv-finalize/route.ts:620`.
**Apply to:** every `after()` console.warn-only path (D7 fail-loud). Org `metaworld-fund-ltd` (Sentry MCP is read-only).

### SECDEF RPC reject idiom
**Source:** `20260510180226_...g10b.sql:190-193` (`RAISE EXCEPTION ... USING ERRCODE = 'invalid_parameter_value'`).
**Apply to:** D3 guard. `SET search_path = public, pg_catalog` + `SECURITY DEFINER` preserved (`:175-176`); arg-list-qualify COMMENT/REVOKE when overloads coexist (`:284-303`).

### Source-scan grep-gate test
**Source:** `tests/test_cash_basis_series_sc4.py:705-750` (`_strip_comment`, `_repo_root`, literal-count assertion).
**Apply to:** new `test_dark_path_deleted.py` (D4) — assert 0 `run_strategy_analytics`, 0 `compute_analytics` dispatch/enqueue.

### Ordered-idempotent write (series-before-scalar)
**Source:** composite seam `job_worker.py:4735-4782`.
**Apply to:** D5 single-key swap; any future finalize seam.

### Migration self-verification + timestamp discipline
**Source:** `20260710130000_stitch_composite_kind.sql:22-34` (header re-base rules), `:39` lock_timeout, `:110-168` self-verifying DO block.
**Apply to:** D3 migration. migration-reviewer + rls-policy-auditor + test-project MCP catch-up before merge (auto-applies to prod on push).

---

## No Clean Analog / Flag for Planner

| Item | Gap | Planner guidance |
|------|-----|------------------|
| D3 re-base target | CONTEXT cites `20260710130000:53,:85` (CHECK DDL, not the RPC) | **Correct:** re-base RPC on `20260510180226:164`; TWO overloads (7-param + 10-param `20260420073003:330`) — guard the dispatched one(s). |
| D7 janitor scheduling | No existing Python-side cron scheduler entry (Vercel crons hit Next routes; `cron_sync` is proxied) | Decide: new `@router.post("/cron-janitor")` + reach it via a scheduler, OR fold reap into `cron_sync`. No 1:1 "Python tick registered in vercel.json" analog. |
| flag-monitor kill-switch upsert line | Not pinned by exact line this pass | grep `KILL_SWITCH_KEY` **writes** (`.upsert`/`.update` on `feature_flags`) in `flag-monitor/route.ts`; keep the `:266-270` email, remove the write. |
| D5 prestamp payload split | `_prestamp_payload` bundles `metrics_json_by_basis` + `data_quality_flags` in one upsert (`:3134-3175`) | Verify the CSV finalizer (`:3278`) doesn't depend on `data_quality_flags` landing before the series; split the payload if it does. |
| M2 sibling test | Unconfirmed which test pins scalar-first order | grep `test_job_worker.py`/`test_csv_analytics_runner.py`; expect red → green on swap. |

---

## Parallelization — disjoint-file waves

**Wave 0 (BLOCKING, serial — gates every deletion):** env audit + pin `USE_COMPUTE_JOBS_QUEUE`=`true` (Vercel), `PROCESS_KEY_UNIFIED_BACKBONE`=`on` + `BROKER_DAILIES_VIA_FUNDING` (Railway); re-run empirical Stage-B query (`compute_analytics` count over 30d == 0). No file edits — verification only.

After Wave 0, three **file-disjoint** waves run in parallel:

- **Wave A — SQL only (fully independent):** D3 RPC guard migration + `test_dark_path_deleted.py`'s CHECK/RPC assertions. Touches only `supabase/migrations/` + one new test file. Zero overlap with A/C/D.
- **Wave C — TS routes (one wave; these files are shared so must NOT be split):** D2 flag-arm deletions + D7 after()-fail-loud + D4 #10 `legacyKeysSyncHandler` deletion + flag-monitor neuter + `phase19-error-rollup` repoint. All touch `csv-finalize/route.ts`, `finalize-wizard/route.ts`, `keys/sync/route.ts`, `flag-monitor/route.ts`. Disjoint from Python.
- **Wave D — Python worker (one wave; `job_worker.py` + `cron.py` are shared):** D5 M2 swap + D4 Python deletions (#1–9) + D7 janitor cron. All touch `job_worker.py` / `routers/cron.py` / `analytics_runner.py` / `main_worker.py` / `scripts/`. Disjoint from TS. **Internal order (D4 zombie trap, LOCKED):** pin `BROKER_DAILIES_VIA_FUNDING` → delete both funding ternaries (`job_worker.py:1519`, `cron.py:451`) + `phase12_*` → delete `routers/analytics.py` + dispatch arm + handler + `TIMEOUT_PER_KIND` + watchdog map → grep-gate 0 `run_strategy_analytics` → delete `analytics_runner.py:1208` chain. M2 swap and janitor are additive/orthogonal within this wave but share `job_worker.py`/`cron.py`, so land them as coordinated edits, not parallel sub-agents on the same file.

**Cross-wave note:** `cron.py` appears in Wave D twice (D4 `:451` deletion + D7 janitor tick) — same file, coordinate. `keys/sync/route.ts` appears in Wave C twice (D2 flag arm + D4 legacy handler) — same file, coordinate. Keep TS (C) and Python (D) as separate agents; SQL (A) is fully standalone.

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `analytics-service/services/`, `analytics-service/routers/`, `analytics-service/scripts/`, `analytics-service/tests/`, `src/app/api/strategies/`, `src/app/api/keys/`, `src/app/api/cron/`, `src/lib/`.
**Files scanned (targeted reads/greps):** `20260710130000_stitch_composite_kind.sql`, `20260510180226_...g10b.sql`, `20260420073003_allocator_holdings.sql`, `reset_stuck_computing_rows.py`, `routers/cron.py`, `services/ingestion/long_fetch.py`, `job_worker.py` (seams), `test_cash_basis_series_sc4.py`, `csv-finalize/route.ts`, `finalize-wizard/route.ts`, `keys/sync/route.ts`, `feature-flags.ts`, `flag-monitor/route.ts`, `process_key.py`, `vercel.json`.
**Pattern extraction date:** 2026-07-14
**Read-only:** no source files modified; PATTERNS.md is the only write.
