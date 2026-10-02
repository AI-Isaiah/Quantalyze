# Phase 06 — Deferred bugs from /qa (2026-04-20)

**Source:** `.gstack/qa-reports/qa-report-phase-06-allocator-2026-04-20.md` + session commits `4e7e109..2ad3f3d`
**Branch:** `phase-06-allocator-api-ingestion`
**Scope:** 5 deferred issues surfaced while running the 3 HANDOFF human checkpoints. Fixes in this session covered ISSUE-001 / ISSUE-002 / ISSUE-004 (atomic commits + regression tests). These 5 remain.

## Suggested attack order

1. **ISSUE-008** (high, f8 dead code) — small RPC rewrite, high symbolic value, unblocks SC3 f8 Queued validation.
2. **ISSUE-005** (high, polling gate) — ~10-line UI change; unblocks SC3's "≤5s flip" contract and makes future allocator work observable without reload.
3. **ISSUE-006** (medium, retry in 0s) — needs a migration (add `last_429_at` to projection GRANT) + small plumbing. Bundles well with ISSUE-005 since both touch `AllocatorExchangeManager.tsx`.
4. **ISSUE-007** (low, `Okx` vs `OKX`) — one `EXCHANGE_DISPLAY_NAME` map + callsite swap.
5. **ISSUE-003** (low, BALANCE `—` for fresh OKX row) — arguably Phase 07/08 scope; defer until demo-mode purge lands.

Item 2 + 3 can be one PR. Items 1 + 7 are independent of everything else.

Total estimated effort: ~1.5–2 hours if ISSUE-008 doesn't need deep schema changes.

---

## ISSUE-008 — f8 Queued helper is unreachable through the real sync-request path

**Severity:** high — silent UX gap, and the feature is explicitly on the spec.

**User impact:** When a user clicks "Sync now" during a rate-limit contagion window (another strategy's sync is blocking the exchange's cooldown), the UI should render "Queued — exchange cooldown, retry in {N}s" under the syncing pill. It never does; the helper stays blank.

**Where:**
- `public._enqueue_compute_job_internal` (migration 032 / migration 066)
- `public.request_allocator_holdings_sync` (migration 066)
- `src/components/exchanges/AllocatorExchangeManager.tsx:229, 362` (reads `json.next_attempt_at`)

**Reproduce:**

```sql
-- Pin a pending job far in the future so the worker won't claim it
INSERT INTO compute_jobs (kind, api_key_id, exchange, status, next_attempt_at, max_attempts, attempts)
VALUES ('poll_allocator_positions', '<YOUR_KEY_ID>', 'okx', 'pending', now() + interval '600 seconds', 3, 0);

UPDATE api_keys SET sync_status='idle' WHERE id='<YOUR_KEY_ID>';
```

Then in the UI, click **Sync now** on the row. Expected: helper "Queued — exchange cooldown, retry in {N}s". Actual: helper blank, pill transitions to `syncing` normally. Next log shows `POST /api/allocator/holdings/sync 200`, response body is `{ok: true, job_id: "<existing id>"}` — not the `{already_inflight: true, next_attempt_at: "…"}` that `AllocatorExchangeManager` expects.

**Root cause:**

```sql
-- from pg_get_functiondef('_enqueue_compute_job_internal')
-- 1) Optimistic lookup — if a live job for this api_key_id + kind exists,
--    return its id and bail. No INSERT is ever attempted.
IF v_existing_id IS NOT NULL THEN
  RETURN v_existing_id;
END IF;

-- 2) Race-safe INSERT — swallows duplicates at the index level.
INSERT INTO compute_jobs (...) VALUES (...)
ON CONFLICT DO NOTHING
RETURNING id INTO v_new_id;
```

Neither path raises `unique_violation`. So the outer handler in `request_allocator_holdings_sync`:

```sql
EXCEPTION WHEN unique_violation THEN
  -- f8: surface next_attempt_at …
  RETURN jsonb_build_object('already_inflight', true, 'next_attempt_at', v_next_attempt);
```

**can never fire.** The RPC always returns `{ok: true, job_id}` — the client can't distinguish a fresh enqueue from a duplicate.

Unit tests miss it because `AllocatorExchangeManager.test.tsx` mocks the fetch response and injects `already_inflight: true` directly; `AllocatorSyncStatus.test.tsx` tests rendering in isolation with `queuedNextAttemptAt` set manually. The plumbing layer between the DB and the client was never exercised end-to-end.

**Proposed fix (option A — cleaner):** Extend `_enqueue_compute_job_internal` to signal duplicate-ness via a second return column:

```sql
CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal(...)
RETURNS TABLE(job_id UUID, was_duplicate BOOLEAN) AS $$
-- existing body, but:
IF v_existing_id IS NOT NULL THEN
  RETURN QUERY SELECT v_existing_id, true;
  RETURN;
END IF;

INSERT ... ON CONFLICT DO NOTHING RETURNING id INTO v_new_id;
IF v_new_id IS NOT NULL THEN
  RETURN QUERY SELECT v_new_id, false;
ELSE
  -- race-lost re-read
  SELECT id INTO v_new_id FROM compute_jobs WHERE ...;
  RETURN QUERY SELECT v_new_id, true;
END IF;
```

Then `enqueue_compute_job` and `request_allocator_holdings_sync` both consume the tuple. The RPC becomes:

```sql
SELECT job_id, was_duplicate
  INTO v_job_id, v_was_duplicate
  FROM enqueue_compute_job(NULL, 'poll_allocator_positions', NULL, '{}'::uuid[], NULL, NULL, NULL, p_api_key_id, NULL);

IF v_was_duplicate THEN
  SELECT next_attempt_at INTO v_next_attempt
    FROM compute_jobs
    WHERE id = v_job_id;
  RETURN jsonb_build_object('already_inflight', true, 'next_attempt_at', v_next_attempt);
END IF;

UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
```

**Proposed fix (option B — local, narrower blast radius):** Skip the internal refactor; have `request_allocator_holdings_sync` check for an existing inflight job before calling `enqueue_compute_job`:

```sql
SELECT next_attempt_at INTO v_next_attempt
  FROM compute_jobs
  WHERE api_key_id = p_api_key_id
    AND kind = 'poll_allocator_positions'
    AND status IN ('pending','running','done_pending_children')
  ORDER BY next_attempt_at DESC
  LIMIT 1;

IF v_next_attempt IS NOT NULL THEN
  RETURN jsonb_build_object('already_inflight', true, 'next_attempt_at', v_next_attempt);
END IF;

-- No inflight job → proceed to enqueue (unchanged)
v_job_id := enqueue_compute_job(...);
UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
```

Option B is smaller but duplicates lookup logic already inside `_enqueue_compute_job_internal`. Recommend Option A if the other callers of `enqueue_compute_job` would benefit from knowing duplicate-ness (they probably would).

**Files to touch:**
- New migration: `supabase/migrations/067_enqueue_duplicate_signal.sql` (or similar)
- `analytics-service/` callers of `enqueue_compute_job` — update to destructure tuple (or add a convenience wrapper that drops `was_duplicate`)

**Tests to add:**
- DB-level: pytest or Vitest against live DB — insert a pending job, call `request_allocator_holdings_sync`, assert response shape is `{already_inflight: true, next_attempt_at: <iso>}`.
- Manager-level: extend `AllocatorExchangeManager.test.tsx` — stop mocking `fetch`, use MSW to route through and verify `queued_next_attempt_at` propagates to the row.

**Rollback:** Drop the new migration + revert the RPC to the current body. The old behavior wasn't useful but wasn't harmful either.

---

## ISSUE-005 — Client polling is gated on a row being in `syncing`; breaks SC3 "≤5s flip"

**Severity:** high — makes server-side state transitions invisible to the user. Every SC3 flow in the HANDOFF implicitly assumes this works.

**User impact:** If a sync lands in `revoked` / `rate_limited` / `error` / `complete_with_warnings` while the user is looking at `/exchanges`, the pill does **not** update until they reload the tab or click Sync now. Discovery of auth failure is delayed to "next time they happen to refresh".

**Where:** `src/components/exchanges/AllocatorExchangeManager.tsx:169-176`

```tsx
useEffect(() => {
  const hasSyncing = keys.some((k) => k.sync_status === "syncing");
  if (!hasSyncing) return;
  const id = setInterval(() => {
    startTransition(() => router.refresh());
  }, 5000);
  return () => clearInterval(id);
}, [keys, router, startTransition]);
```

The gate on `hasSyncing` makes steady-state rows uninspectable.

**Reproduce:** Load `/exchanges` with all rows in `complete`. In Supabase: `UPDATE api_keys SET sync_status='revoked', sync_error='401 ...' WHERE id=<X>`. Wait 30s. UI still shows "Synced N ago".

**Proposed fix:** Poll while the tab is visible AND any row is in a non-terminal state (or simpler: always, as long as the tab is visible):

```tsx
useEffect(() => {
  const poll = () => {
    if (document.visibilityState !== 'visible') return;
    startTransition(() => router.refresh());
  };
  const id = setInterval(poll, 5000);
  document.addEventListener('visibilitychange', poll);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', poll);
  };
}, [router, startTransition]);
```

5s is probably too aggressive if always-on; consider 10s or 15s. OR gate on "any row not in terminal state" where terminal = `idle` (idle is the resting state after a reset but shouldn't change spontaneously). The set of "interesting" states = `syncing | revoked | rate_limited | error | complete_with_warnings` — all of which can transition server-side without the user doing anything.

**Files to touch:** `src/components/exchanges/AllocatorExchangeManager.tsx` only.

**Tests to add:** Extend `AllocatorExchangeManager.test.tsx` to vary the initial state to each of (complete, revoked, rate_limited) and assert `router.refresh` is called on the interval.

---

## ISSUE-006 — `rate_limited` pill always shows "retry in 0s"

**Severity:** medium — visible copy bug on a state that will realistically hit users the moment any kind of traffic spike lands on Binance / OKX / Bybit.

**User impact:** Even when the worker has correctly detected a 429 and set `sync_status='rate_limited'` with `last_429_at=now()`, the UI pill renders "Rate limited — retry in 0s". Gives no actionable countdown — user is told to wait 0 seconds and then nothing changes.

**Where:**
- `src/components/exchanges/AllocatorExchangeManager.tsx:458-465` — only passes `syncStatus`, `syncError`, `lastSyncAt`, `exchange`, `queuedNextAttemptAt`, `helperOverride`. No `retryAtSeconds`.
- `src/components/exchanges/AllocatorSyncStatus.tsx:196` — `const n = Math.max(0, retryAtSeconds ?? 0);` → 0 when the prop is missing.
- `src/lib/constants.ts:83` — `API_KEY_USER_COLUMNS_ARR` does not include `last_429_at`, so the client has nothing to compute from.

**Reproduce:** `UPDATE api_keys SET sync_status='rate_limited', last_429_at=now()-interval '35 seconds' WHERE id=<X>`. Reload `/exchanges`. Pill: "Rate limited — retry in **0s**".

**Proposed fix:**

1. **Migration:** `supabase/migrations/068_api_keys_last_429_at_grant.sql` — `GRANT SELECT (last_429_at) ON api_keys TO authenticated`.

2. **Projection:** `src/lib/constants.ts` — append `"last_429_at"` to `API_KEY_USER_COLUMNS_ARR`.

3. **Cooldown map:** Duplicate the Python-side `EXCHANGE_COOLDOWNS` into a new shared constants block (`src/lib/allocator-cooldowns.ts` or similar):

   ```ts
   export const EXCHANGE_COOLDOWN_SECONDS: Record<string, number> = {
     binance: 120,
     okx:     300,
     bybit:   600,
   };
   ```

4. **Wire in the manager:** Compute and pass `retryAtSeconds`:

   ```tsx
   const retryAtSeconds = key.last_429_at
     ? Math.max(0, Math.floor(
         (new Date(key.last_429_at).getTime()
           + (EXCHANGE_COOLDOWN_SECONDS[key.exchange] ?? 120) * 1000
           - Date.now()) / 1000
       ))
     : undefined;

   <AllocatorSyncStatus
     …
     retryAtSeconds={retryAtSeconds}
   />
   ```

   Note: because the value depends on `Date.now()`, it should update between renders — the polling from ISSUE-005's fix will drive that. Without fixing ISSUE-005 first, the countdown won't tick. Bundle these two.

**Files to touch:** migration + `constants.ts`, new `allocator-cooldowns.ts`, `AllocatorExchangeManager.tsx`, SEC-005 projection test (if it asserts the exact column list — it does).

**Tests to add:**
- `AllocatorExchangeManager.test.tsx` — set a row with `sync_status='rate_limited'` + `last_429_at` 35s ago on exchange `okx` (cooldown 300s), assert the rendered pill contains "retry in 265s" (ish — allow ±2s for timing tolerance).
- Update `sec-005-api-keys-projection.test.ts` to include `last_429_at`.
- Live-DB spec: extend `allocator-holdings-rls.test.ts` (or a new sibling) to assert the GRANT made `last_429_at` readable to `authenticated` but not to `anon`.

---

## ISSUE-007 — Exchange display name reads "Okx" instead of "OKX"

**Severity:** low — polish.

**User impact:** `rate_limited` helper reads "Okx cooldown remaining". "OKX" is an acronym, not a title-case proper noun. For BNB the same function would produce "Bnb". Spec says "Exchange title-case" which is literally satisfied — but it's clearly not what a user expects.

**Where:** `src/components/exchanges/AllocatorSyncStatus.tsx:101-104` — the `titleCase` helper.

**Proposed fix:** Add a display-name map that wins over the generic `titleCase` fallback:

```ts
const EXCHANGE_DISPLAY_NAME: Record<string, string> = {
  okx:     "OKX",
  binance: "Binance",
  bybit:   "Bybit",
};

function exchangeDisplayName(exchange: string): string {
  return EXCHANGE_DISPLAY_NAME[exchange.toLowerCase()] ?? titleCase(exchange);
}
```

Callsite: replace `titleCase(exchange)` at line 224 with `exchangeDisplayName(exchange)`.

**Files to touch:** `src/components/exchanges/AllocatorSyncStatus.tsx` only.

**Tests to add:** Single parameterized test: `exchangeDisplayName("okx") === "OKX"`, `binance → "Binance"`, `bybit → "Bybit"`, unknown `"foo"` → `"Foo"`.

---

## ISSUE-003 — `account_balance_usdt` not populated for a freshly synced allocator row

**Severity:** low — cosmetic.

**User impact:** After SC1 completes, the new row renders "OKX · READ-ONLY · BALANCE —" (em-dash) while the seeded demo rows render "BALANCE $5.00M". The row looks unfinished/empty next to the demos.

**Where:** Almost certainly `analytics-service/services/allocator_positions.py` — the `poll_allocator_positions` handler writes `allocator_holdings` rows but never updates `api_keys.account_balance_usdt`.

**Reproduce:** SC1 with a real exchange key. After `sync_status='complete'`, query:

```sql
SELECT account_balance_usdt FROM api_keys WHERE id='<NEW_KEY_ID>';
-- returns NULL
```

**Proposed fix:** In `allocator_positions.py`, after the holdings have been fetched and written, compute the total USDT-equivalent from the holdings and write it back:

```python
total_balance_usdt = sum(h['usd_value'] or 0 for h in holdings_rows)
supabase.table('api_keys').update({'account_balance_usdt': total_balance_usdt}) \
  .eq('id', api_key_id).execute()
```

Exact column names depend on the `allocator_holdings` row shape — may need joining with a price feed for non-USDT symbols. Might be simpler to compute from the raw CCXT balance fetch before it's rolled into allocator_holdings.

**Caveat:** This may be intentionally deferred to Phase 07 (Demo-Mode Purge) since that phase rips out the hardcoded "$5.00M" demo values and rebuilds the balance path against real data. Confirm scope before fixing here.

**Files to touch:** `analytics-service/services/allocator_positions.py`, possibly `migrations/066_allocator_holdings.sql` if the schema needs a tweak.

**Tests to add:** `test_allocator_positions.py` — after a successful poll, assert `api_keys.account_balance_usdt` equals the sum of `allocator_holdings.usd_value`.

---

## Quick environment notes for next session

- `npm run dev` binds :3000; **if you see `address already in use`**, it's likely a stale Next from a previous session — `lsof -iTCP:3000 -sTCP:LISTEN -Fp | cut -c2- | xargs -r kill`.
- `npm run worker:dev` binds :8080; same kill-stale pattern. After ISSUE-001 fix, `curl :8080/healthz` returns `{"status":"ok"}` within a few seconds of startup — if it stays `"stale"` you've got a zombie.
- Test creds: `security find-generic-password -s quantalyze-test -a demo-allocator@quantalyze.test -w`.
- Prod Supabase: project id `khslejtfbuezsmvmtsdn`. Use Supabase MCP `execute_sql` for forced-state checks.
- Next's `.env.local` points at prod Railway analytics — `curl https://quantalyze-analytics-production.up.railway.app/api/encrypt-key -H "X-Service-Key: $ANALYTICS_SERVICE_KEY" …` reproduces any schema-contract issue directly.
- `api_key_id = d5cd3afb-a500-404e-9a39-dc7916ec8bb8` (label "OKX Read-key (/qa)") is the test row from this session, currently `idle`. Real holdings in `allocator_holdings`.
