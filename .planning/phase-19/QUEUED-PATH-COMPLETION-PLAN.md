# Phase 19 / BACKBONE-09 — Complete the unified queued path (`process_key_long`)

**Status:** PLAN — investigation complete, no fix shipped yet (user chose "stop and plan").
**Date:** 2026-05-27
**Author:** investigation via `/investigate` (Claude)
**Owner decision pending:** scope + sequencing (see "Decision needed").

---

## TL;DR

The unified `/process-key` **queued** flow (`flow_type ∈ {onboard, resync}` → `process_key_long`
compute job → `run_process_key_long_job`) is an **unfinished scaffold**. It was shipped
flag-gated in #133 and the flag (`process_key_unified_backbone`) was flipped **ON in prod on
2026-05-25**, but this code path had **never executed in production** until a real user hit it —
because `resync` 422'd at the request validator before any job was enqueued.

Connecting an exchange API key (OKX **and** Bybit) in the wizard "Verify data" step fails with
`SYNC_FAILED` ("We fetched your trades but the analytics computation did not complete"). Both
brokers fail identically → it is the shared queued path, not broker-specific.

Three independent defects, in order of how they surface:

| # | Defect | Status |
|---|--------|--------|
| 1 | `_ProcessKeyBody` validator required `api_key`/`api_secret` for `resync` → **422**, no job enqueued | Fix designed + unit-tested (reverted to clean tree; see below) |
| 2 | `run_process_key_long_job` never resolves the **stored** credentials for `resync` (reads `context["api_key"]` which is empty) | Fix designed; **breaks 6 existing tests** as written — needs design (see "Open design decisions") |
| 3 | The queued handler **never persists trades, never persists positions, never writes `strategy_analytics`** (what the wizard polls). Even with #1+#2 fixed, the wizard still times out. | **Not started** — this is feature-completion, not a bug fix |

The legacy path (flag OFF) does all of this correctly via the proven `sync_trades` +
`compute_analytics` job chain.

---

## Symptom (user-facing)

- Wizard `/strategies/new` → step 02 "Verify data" → red "We could not verify this strategy /
  Sync failed. We fetched your trades but the analytics computation did not complete. The
  failure is on our side, not on your exchange."
- Maps to `SYNC_FAILED` in `src/lib/wizardErrors.ts:218`. Set **client-side** in
  `SyncPreviewStep.tsx` when polling `strategy_analytics.computation_status` never reaches
  `complete` (timeout/error).

## Evidence (production, project `khslejtfbuezsmvmtsdn`)

- Draft `6d20ec0a-…` ("Silent Thunder", bybit, `created 20:26:27Z`, `status=draft`,
  `api_key_id=0ea9ec5f-…`) — the Bybit attempt. Matches the screenshot ("Draft saved 10:26 PM"
  = 20:26 UTC / 22:26 CEST).
- Railway analytics deploy `562ca001` (commit `8904b204`), deploy logs:
  ```
  20:24:31  POST /process-key  422 Unprocessable Entity   (OKX)
  20:26:31  POST /process-key  422 Unprocessable Entity   (Bybit)
  ```
  Sequence each time: `POST /api/validate-key 200` → `POST /api/encrypt-key 200` →
  `POST /process-key 422`.
- `compute_jobs`: newest row `13:01:43Z` (none at ~20:26) → **no job enqueued** for the user's sync.
- `strategy_analytics`: newest activity `13:05Z` (synthetic seed rows `51a111ed-0000-…`) → **no row**
  written for the user's strategy.
- `feature_flags.process_key_unified_backbone = 'on'` (since `2026-05-25 15:51Z`).

## Why it never showed up before

- `resync` (the wizard verify-data sync via `/api/keys/sync` → `unifiedKeysSyncHandler`) sends
  `{flow_type:'resync', context:{strategy_id, user_id}}` — **no credentials, no `step`**.
- The validator's required-keys branch fires for `resync` → 422 → handler never runs → queued
  path never exercised. The two `onboard` callers
  (`validate-and-encrypt` `step='validate'`, `finalize-wizard` `step='finalize'`) skip the
  required-keys branch, so they never tripped it either.

---

## Root causes (detail)

### Bug #1 — validator rejects credential-less `resync` (422)

`analytics-service/routers/process_key.py`, `_ProcessKeyBody._validate_per_flow_required_keys`:

```python
if self.flow_type in {"teaser", "onboard", "resync"}:
    missing = [k for k in ("api_key", "api_secret") if k not in ctx]
    if missing:
        raise ValueError(...)
```

`resync` by definition re-syncs an **existing** strategy whose `api_key` is already stored
(`api_key_id` linkage) — the worker resolves credentials server-side, so the request body
carries none. `resync` must be removed from this set.

**Designed fix (verified: regression test fails before, passes after; full `test_process_key.py`
= 38 passed):**

```python
# resync is excluded: it re-syncs an EXISTING strategy whose api_key is stored,
# so the worker resolves credentials server-side; the /api/keys/sync body carries
# no api_key/api_secret and no step. teaser (synchronous, reads creds from context)
# and onboard (may be first-time connect; its callers pass step=validate/finalize,
# skipped above) still require credentials when no step is set.
if self.flow_type in {"teaser", "onboard"}:
    missing = [k for k in ("api_key", "api_secret") if k not in ctx]
    if missing:
        raise ValueError(
            f"flow_type={self.flow_type!r} requires context keys {missing!r}"
        )
```

Regression test added to `tests/test_process_key.py`
(`test_process_key_resync_no_credentials_queues`): posts the exact `keys/sync` body and asserts
it queues `process_key_long` instead of 422.

> ⚠️ **Do NOT ship #1 standalone.** It only changes the failure from "422 at the door" to
> "enqueues a job that then fails in the worker" (bugs #2/#3). Net user outcome is still
> `SYNC_FAILED`, plus queued-job retry churn. Ship #1 only as part of the whole path.

### Bug #2 — worker never resolves stored credentials for `resync`

`analytics-service/services/ingestion/long_fetch.py`, `run_process_key_long_job`:

- The enqueue (`process_key.py` long-fetch dispatch) puts only
  `{correlation_id, verification_id, flow_type, source}` in `compute_jobs.metadata` — **no
  `context`**.
- The handler does `context = metadata.get("context") or {}` → `{}` for resync, then later
  `context["api_key"]` → **KeyError**. The NOTE claims "resync decrypts from
  `strategy_verifications.encrypted_credentials`" but **no such code exists**.

Proven reference: the legacy `sync_trades` handler resolves creds via
`job_worker._load_strategy_and_key(supabase, strategy_id)` (strategy → `api_key_id` → `api_keys`
row, with an owner check) + `services.encryption.decrypt_credentials(key_row, get_kek())`.

**Designed fix (DOES NOT WORK AS-IS):** inserting the load+decrypt block *before*
`adapter.validate()` broke **6 existing `test_long_fetch.py` tests**
(`test_long_fetch_rejects_write_capable_key[*]`, `*_scope_rejection_*`, `*_probe_error_*`,
`*_validation_unexpected_*`). Those tests construct a job with a context that has no `api_key`
and a mock adapter that returns a scope rejection from `validate()`; the new credential-resolution
block intercepts first (mock has no strategy/key → returns FAILED) and preempts the
scope-rejection assertions. **This needs a design decision (below), not a reactive patch.**

### Bug #3 — queued handler never produces the factsheet (`strategy_analytics`)

`run_process_key_long_job` runs the adapter pipeline but the adapter methods are **pure /
in-memory** (`services/ingestion/okx.py`, `bybit.py`):

- `fetch_raw` → returns `list[Trade]` (NOT persisted to the `trades` table)
- `compute_metrics` → `MetricsSnapshot` (stored only as `metrics_snapshot` JSONB on the
  verification row)
- `reconstruct_positions` → `list[Position]` whose **return value is discarded** (line ~378)

The handler's only DB writes are `transition_strategy_verification` (state machine) and a
best-effort `strategies.fingerprint` update. It **never**:

- persists trades (legacy uses the `sync_trades` RPC),
- persists positions,
- writes `strategy_analytics` (sharpe/returns/etc.),
- calls `sync_strategy_analytics_status` to set `computation_status` (`computing`→`complete`).

There is **no** `report` job kind (despite the `report_queued` status name) and **no** DB trigger
materializing `strategy_analytics` from a published verification (verified by grep over
`services/job_worker.py` dispatch + `supabase/migrations/`).

**The wizard polls `strategy_analytics.computation_status` for `complete`**
(`SyncPreviewStep.tsx:191`). Since nothing writes it, the wizard polls until timeout →
`SYNC_FAILED`. This is the defect that makes #1+#2 insufficient on their own.

---

## The contract the queued path must satisfy

End state for a successful resync, matching the legacy path:

1. Trades fetched from the broker and **persisted** (`sync_trades` RPC or equivalent).
2. Positions reconstructed and persisted.
3. `strategy_analytics` row written with full metrics + `computation_status='complete'`
   (this is what `SyncPreviewStep` polls; the factsheet reads it too).
4. `strategy_verifications` advanced to `published` (already done).
5. `api_keys.last_sync_at` / `last_fetched_trade_timestamp` updated (incremental re-sync cursor).

---

## Open design decisions

1. **How should the queued path produce `strategy_analytics`?**
   - (a) **Delegate** (recommended, lowest-risk): after validating + persisting trades,
     `enqueue_compute_job(kind='compute_analytics')` — reuse the proven `analytics_runner`
     path that already writes `strategy_analytics` + sets `computation_status`. Mirrors the
     legacy `sync_trades → compute_analytics` chain.
   - (b) Build the analytics write into `process_key_long` inline (more code in the new path,
     duplicates `analytics_runner`).
   - Decision affects how much of `long_fetch.py` we keep vs. delegate.

2. **Where does credential resolution belong so it doesn't preempt the scope-rejection gate?**
   - Resolve creds, then run `adapter.validate()` on the resolved creds; the 6 broken tests must
     be updated to seed a strategy+key in the mock (or the resolution must be skipped when the
     test injects creds directly). Pick one and make the test contract explicit.

3. **Should we keep the adapter abstraction for the queued path at all, or have the queued path
   thinly trigger the proven `sync_trades` + `compute_analytics` jobs?**
   - Thin-trigger reuses the most-tested code and shrinks the new surface. The adapter
     `fetch_raw/compute_metrics` then become dead on this path (flag-on) — confirm before removing.

4. **Wizard polling target.** Confirm the wizard should keep polling `strategy_analytics`
   (then the worker must write it) vs. poll the verification state machine. Current code polls
   `strategy_analytics`; least-surprise is to make the worker write it.

---

## Infra blocker — Railway analytics deploy is skipping

The last 4 Railway deploys are `SKIPPED` (`e08ddd3d`, `ad79c26f`, `fdb1ca51`, `32fabb7f`); the
**running** deployment is `562ca001` = commit `8904b204` (v0.24.10.2). No analytics-service fix
will reach prod until this is resolved (known pattern: Railway skips when main CI suite is red;
verify with `railway deployment list`, rerun failed CI, or `railway up` to force). **Any fix here
is unverifiable in prod until the deploy actually fires** — budget for this.

---

## Test strategy

- Unit (mock adapter + Supabase + RPCs, as existing `test_long_fetch.py` / `test_process_key.py`
  do):
  - #1: resync body queues, not 422 (added).
  - #2: resync with a stored key resolves creds → reaches validate; the 6 scope/probe tests stay
    green (update their fixtures to seed strategy+key).
  - #3: after a successful run, assert trades persisted + `strategy_analytics` written +
    `computation_status='complete'` (or `compute_analytics` enqueued, per decision 1).
- E2E (`/qa`): real OKX + Bybit keys through the live wizard after deploy; verify a
  `strategy_analytics` row appears and the wizard advances past "Verify data". This is the only
  way to prove #3 end-to-end (cannot be done locally without broker creds).

## Risks & alternative

- **Ships partly-blind:** #2/#3 can't be fully proven until deploy + real-key `/qa`.
- **7-day stability window / flag-monitor auto-rollback** (Phase 19) may react to a spike in
  unified-path errors while iterating — watch `/api/cron/flag-monitor`.
- **Alternative considered — flag OFF mitigation:** flip `process_key_unified_backbone='off'` to
  restore the proven legacy `sync_trades`+`compute_analytics` path (API uploads work immediately).
  Rejected for now because **CSV ingestion currently runs on the unified (synchronous) path**
  (fixed in #322/#324); flag-off would route CSV to the legacy path, an untested regression
  surface. Re-open this if completing the queued path proves too deep — it would unblock API
  dogfooding fastest.

## Adjacent (not blocked by this)

- **CSV ingestion E2E** (the user's second goal) runs on the unified **synchronous** path, which
  computes analytics inline and is reportedly working (Phase 15 closed). Verify separately via
  `/qa` on the CSV wizard; it does **not** depend on the queued-path completion above.

---

## Already done this session (safe, shipped)

- `v0.24.10.6` (#333): cassette-refresh leak gate uses venv `pytest`.
- `v0.24.10.7` (#334): okx rate-limit cassette uses code `50011` (RateLimitExceeded), not `50013`.

Both unrelated to this path (CI-only). The bug #1/#2 code was reverted to keep `main` clean; the
verified fixes are reproduced verbatim above.
