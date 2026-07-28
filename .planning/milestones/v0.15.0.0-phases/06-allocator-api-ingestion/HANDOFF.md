# Phase 06 — Handoff (2026-04-20)

**Status:** Code complete, migration applied to production, tests green. **3 human checkpoints run via `/qa` on 2026-04-20 (report: `.gstack/qa-reports/qa-report-phase-06-allocator-2026-04-20.md`).**

| Checkpoint | Status | Notes |
|---|---|---|
| 1. Visual /qa — all 7 sync_status states + f4 + f8 | **PASS WITH FINDINGS** | 4 bugs fixed (ISSUE-001/002/004), 4 deferred (ISSUE-003/005/006/007/008) |
| 2. SC1 — fresh allocator adds OKX key, holdings populate ≤3 min | **PASS** | Real OKX read-only key; 41s from add to complete; 3 holdings rows (types `{derivative, spot}`, symbols `{BTC, ETHUSDT, USDT}`) |
| 3. SC3 — force 401 + 429 via SQL | **PARTIAL PASS** | UI copy correct on reload; "≤5s polling flip" broken by ISSUE-005 (polling is gated on a row being in `syncing`) |

**Fixes landed during /qa** (atomic commits + regression tests):
- `ISSUE-001` `medium`   Worker healthz reports "stale" when job queue is empty → fix `4e7e109`, test `7396d19`
- `ISSUE-002` `critical` `EncryptKeyResponseSchema` mismatched envelope-encryption shape (blocked every add-key attempt) → fix `c521cad`, test `e7e0c33`
- `ISSUE-004` `medium`   "Synced {time}" pill collapsed whitespace ("Synced1m ago") → fix `1dfd35b`, test `2ad3f3d`

**Deferred findings** (need migrations, RPC rewrites, or design decisions — out of scope for a single /qa session; see report for full detail):
- `ISSUE-003` `low`    `account_balance_usdt` not populated after allocator sync (BALANCE shows `—`) — likely Phase 07/08
- `ISSUE-005` `high`   Polling only runs while a row is `syncing` → revoked/rate_limited transitions on a `complete` row are invisible until reload
- `ISSUE-006` `medium` `rate_limited` pill always shows "retry in 0s" — `retryAtSeconds` never computed; `last_429_at` not in projection
- `ISSUE-007` `low`    `titleCase("okx")` gives "Okx" not "OKX" in helper text
- `ISSUE-008` `high`   **f8 Queued helper is unreachable through the real RPC** — `_enqueue_compute_job_internal` uses `ON CONFLICT DO NOTHING` + optimistic lookup, so `request_allocator_holdings_sync`'s `EXCEPTION WHEN unique_violation THEN … already_inflight` branch is dead code. The rendering logic is correct (unit tests green), but the plumbing to deliver `queued_next_attempt_at` from the server is broken.

**Branch:** `phase-06-allocator-api-ingestion` (not yet merged to `main`)

**Production Supabase:** `khslejtfbuezsmvmtsdn` — migration `066_allocator_holdings` applied, post-apply smokes green.

---

## What shipped

### Commits on the branch (in chronological order)

```
0337877  feat(phase-06): migration 066 — allocator_holdings + compute-job extensions
fb62439  feat(phase-06): extend audit taxonomy + api_keys.sync_error projection
e66fbdb  test(06-02): add failing pytest suite for allocator_positions worker (RED)
57903a2  test(06-03): RED — route unit tests + live-DB RLS anti-leak spec
e1c057a  feat(06-02): allocator_positions.py + Deribit in EXCHANGE_CLASSES (GREEN for 7/9 tests)
34a9ee9  feat(06-03): POST /api/allocator/holdings/sync route (f8 passthrough)
545caa8  feat(06-02): wire poll_allocator_positions handler + dispatch + f7/f8 (all 9 tests GREEN)
b8b1fc6  test(06-03): pin ROUTE_PATH constant for routing-plumbing grep gate
c7f7cde  chore: merge Plan 06-02 worktree (FastAPI worker + pytest)
c978988  chore: merge Plan 06-03 worktree (route + RLS regression spec)
afbe2d1  test(06-04): add failing AllocatorSyncStatus copy-verbatim + f4/f8 suite
bf778e8  feat(06-04): implement AllocatorSyncStatus 7-state pill + f4/f8 helpers
b389cfa  test(06-04): add failing AllocatorExchangeManager integration suite
cb73a78  feat(06-04): wire Sync now + awaited first-run + 5s polling + f4/f8 in AllocatorExchangeManager
a7e86e5  docs(06-04): complete allocator sync-status UI + awaited first-run plan
efc43c1  chore: merge Plan 06-04 worktree (UI: AllocatorSyncStatus + manager extension)
```

### Files changed (vs `main`)

- **DB:** `supabase/migrations/066_allocator_holdings.sql` (1,173 lines) — applied to prod
- **Config:** `supabase/config.toml`, `supabase/.gitignore` — local dev port remap (54421/54422/54423/54424) to avoid collision with another project
- **Audit:** `docs/architecture/adr-0023-audit-event-taxonomy.md`, `src/lib/audit.ts` (+3 `allocator.holdings.*` actions)
- **Projection:** `src/lib/constants.ts` (+`sync_error` in `API_KEY_USER_COLUMNS_ARR`), `src/lib/queries.ts` (+`sync_error: string | null`)
- **Worker (Python):** `analytics-service/services/allocator_positions.py` (new, 276 lines), `exchange.py` (+deribit in EXCHANGE_CLASSES), `job_worker.py` (+260 lines: preflight, handler, dispatch elif, `_emit_audit`), `tests/test_allocator_positions.py` (new, 555 lines, 9 tests green), `tests/conftest.py` (+`api_key_row_factory`)
- **Route (Next):** `src/app/api/allocator/holdings/sync/route.ts` (106 lines), `route.test.ts` (219 lines, 7/7 green)
- **RLS spec:** `src/__tests__/allocator-holdings-rls.test.ts` (249 lines, 2/2 live-DB green — carries INGEST-09 / SC4 proof since Category B was stripped from the migration)
- **UI:** `src/components/exchanges/AllocatorSyncStatus.tsx` (253 lines), `AllocatorSyncStatus.test.tsx` (474 lines, 28 tests), `AllocatorExchangeManager.tsx` (+210/-31, real Sync now + awaited first-run + 5s polling + `initialKeys` merge effect + `queued_next_attempt_at` capture), `AllocatorExchangeManager.test.tsx` (488 lines, 13 tests)

### Test totals
- **Vitest:** 49 pass + 1 skip = 50/50 (`src/components/exchanges/` + `src/__tests__/allocator-holdings-rls.test.ts` + `src/app/api/allocator/holdings/sync/`)
- **Pytest:** 9/9 (`test_allocator_positions.py`) + full `analytics-service/` suite 495+ pass / 3 skip / 0 fail
- **tsc:** clean

---

## Voice findings — all 8 applied

| # | Summary | Resolution in production code |
|---|---|---|
| f1 | BYPASSRLS guard on migration RLS probe | Re-homed: Category B two-actor probe moved from migration DO block → Plan 03 Vitest spec `src/__tests__/allocator-holdings-rls.test.ts` (Supavisor `cli_login_postgres` role couldn't INSERT into `auth.users` or DELETE under RLS from inside the MCP `apply_migration` path) |
| f2 | Backward-compat proof for `enqueue_compute_job` DROP+REDEFINE | Post-apply smoke: `SELECT enqueue_poll_positions_for_all_strategies()` returned `0` without exception — strategy cron signature survived. Also verified `enqueue_compute_job(p_strategy_id:=, p_kind:='compute_analytics')` legacy call shape works |
| f3 | Deribit `fetch_balance()` unverified — could silent-empty | Path B taken: `DeribitNotSupportedError(ccxt.NotSupported)` raised explicitly in `_fetch_spot_rows` when `exchange.id == 'deribit'`; `_map_exception_to_sync_status` → `'error'`. Test `test_deribit_balance_per_currency_shape` asserts this. Deferred real Deribit support as an item |
| f4 | `handleAddKey` fire-and-forget → stuck "Syncing…" | `handleAddKey` now awaits POST; on non-2xx reverts pill to `'idle'` and surfaces `helperOverride='Sync request failed — click Sync now to retry'` on AllocatorSyncStatus. Test `handleAddKey_shows_error_when_first_run_sync_fails_with_403` asserts |
| f5 | No DB coupling `allocator_holdings.allocator_id` ↔ `api_keys.user_id` | `enforce_allocator_holdings_owner_coherence()` SECURITY DEFINER + BEFORE INSERT OR UPDATE trigger present. Category C probe in migration DO block verifies the trigger fires on a mismatched INSERT |
| f6 | Cron idempotency key races across day boundaries with ±600s jitter | `v_run_at := now() + v_jitter` computed FIRST; idempotency key uses `to_char(v_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')`. Cron-hour-between-1-and-22 assertion in Category D probe |
| f7 | `_emit_audit` path unverified | `_emit_audit` in `job_worker.py` delegates to `services.audit.log_audit_event` (re-imported at call time for `monkeypatch` test visibility). Test `test_run_poll_allocator_positions_job_emits_sync_completed_audit_on_done` asserts the audit event emits |
| f8 | Strategy-side 429 stalls allocator first-run via shared per-exchange cooldown | Accepted as intentional. Worker comment above `_allocator_key_preflight` documents `DispatchOutcome.DEFERRED` as terminal. Route catches 23505 (already-inflight) and returns `next_attempt_at` in JSONB response. UI: `AllocatorSyncStatus` renders "Queued — exchange cooldown, retry in {N}s" (U+2014) when `queuedNextAttemptAt` ≥30s out |

---

## Human checkpoints (3) — all run on 2026-04-20 via /qa

### 1. Task 06-04-03 — Visual /qa on `/exchanges` — **PASS WITH FINDINGS**

Force each sync_status state via Supabase `execute_sql` UPDATE and visually compare to `DESIGN.md` + `.planning/phases/06-allocator-api-ingestion/06-UI-SPEC.md`.

**States to verify:**
| sync_status | Pill copy (VERBATIM, D-08 locked) | Pill color class | Helper line |
|---|---|---|---|
| idle | "Idle" | `bg-[#F1F5F9]` neutral | — |
| syncing | "Syncing…" (U+2026) | neutral + spinner | — |
| complete | "Synced {relative time ago}" | neutral | — |
| complete_with_warnings | "Synced (warnings)" | `bg-warning/10 text-warning` amber | `sync_error` text |
| rate_limited | "Rate limited — retry in {N}s" (U+2014) | amber | "{Exchange title-case} cooldown remaining" |
| revoked | "Key revoked" | `bg-negative/10 text-negative` red | "Re-add a read-only key from your exchange." VERBATIM |
| error | "Sync failed" | red | sanitized `sync_error` |

**Special cases:**
- **f4 first-run error:** submit an invalid key via add-key modal → modal closes → row pill reverts to `'idle'` → helper line reads "Sync request failed — click Sync now to retry" (aria-live polite announcement)
- **f8 Queued state:** service-role INSERT into `compute_jobs` with `kind='poll_allocator_positions'`, `api_key_id=<visible row's id>`, `next_attempt_at = now() + 90s`, `status='pending'`. Then click Sync now → pill stays `syncing` + helper reads "Queued — exchange cooldown, retry in {N}s" with U+2014 em-dash and N ≥ 30
- **Motion:** spinner frozen under `prefers-reduced-motion: reduce`; 1s linear rotation otherwise
- **VoiceOver:** announces error/Queued/first-run-failed helper; silent on idle→syncing→complete transitions

### 2. SC1 end-to-end — fresh allocator sees holdings populate — **PASS**

Ran with real OKX read-only key (passphrase `Test((!)12`) as `demo-allocator@quantalyze.test`. Add → Syncing → Synced in 41s. 3 holdings rows in `allocator_holdings` (types `{derivative, spot}`, symbols `{BTC, ETHUSDT, USDT}`). api_key_id = `d5cd3afb-a500-404e-9a39-dc7916ec8bb8` (left in idle after /qa; real holdings retained).

<details><summary>Original SC1 instructions (kept for future reruns)</summary>

**Prerequisites:** dev stack running (`npm run dev` + `npm run worker:dev`). A read-only exchange API key.

**Note on dev startup:** as of this handoff, **ports 3000 and 8080 were occupied** by other running processes (likely an older Next dev session on 3000, the analytics-service worker healthz server on 8080). To run locally:
```bash
# Kill older dev/worker
lsof -iTCP:3000 -sTCP:LISTEN -Fp | cut -c2- | xargs -r kill
lsof -iTCP:8080 -sTCP:LISTEN -Fp | cut -c2- | xargs -r kill

# Start fresh
npm run dev          # port 3000 after cleanup
npm run worker:dev   # analytics-service healthz on 8080
```

Test credentials are in Keychain under service `quantalyze-test` (per user memory). Fetch via:
```bash
security find-generic-password -s quantalyze-test -a <exchange> -w
```

**Steps:**
1. Sign up a fresh allocator (or log in as the test user)
2. Navigate to `/exchanges`
3. Paste the read-only key into the add-key modal, pick exchange (binance/okx/bybit)
4. Submit → modal closes → new row appears with pill "Syncing…"
5. Within ~3 min (one sync cycle) the pill should transition to "Synced {relative time ago}"
6. Verify via Supabase: `SELECT count(*), array_agg(DISTINCT holding_type) FROM allocator_holdings WHERE api_key_id = '<new_key_id>'` — should return at least 1 row

</details>

### 3. SC3 error-surface — force 401 and 429 — **PARTIAL PASS**

Forced `revoked` (pill "Key revoked", red, helper "Re-add a read-only key from your exchange." VERBATIM, `aria-live="polite"`) and `rate_limited` (pill "Rate limited — retry in 0s", amber, U+2014 em-dash, helper "Okx cooldown remaining"). Copy + colors + em-dash verified. Final reset to `idle` clean. **However**: the "Wait ≤5s for client polling → pill flip" step does NOT work — polling is gated on a row being in `syncing` (ISSUE-005). All flips required a manual reload.

<details><summary>Original SC3 instructions (kept for future reruns)</summary>

**Steps (requires SC1 first to have a populated key):**
1. Via Supabase MCP `execute_sql` or dashboard, run:
   ```sql
   UPDATE api_keys SET sync_status='revoked', sync_error='401 Unauthorized: Invalid API-key, IP, or permissions for action' WHERE id = '<test_key_id>';
   ```
2. Wait ≤5s for client polling → pill should flip to "Key revoked" + helper "Re-add a read-only key from your exchange."
3. Reset:
   ```sql
   UPDATE api_keys SET sync_status='rate_limited', sync_error='Binance cooldown — 120s' WHERE id = '<test_key_id>';
   ```
4. Pill flips to "Rate limited — retry in {N}s" + helper text.
5. Reset back to `idle`.

</details>

---

## Gaps / known issues

1. **GDPR export coverage** for `allocator_holdings` not yet added (flagged by Plan 03 agent in `deferred-items.md`). Phase 08 (/connections + notes) is the natural home.
2. **Deribit spot ingestion deferred** (f3 Path B). Explicit `DeribitNotSupportedError` raised; derivatives still sync. Future fix-up once a Deribit test key is available.
3. **Per-(exchange, api_key_id) circuit breaker** not implemented (f8 accepted as shared). Strategy-side 429s still delay allocator syncs up to cooldown window. UI "Queued" helper is the surfacing; Phase 11 polish can revisit.
4. **Deferred /qa findings (2026-04-20):**
   - `ISSUE-003` `low` — `account_balance_usdt` not populated after `poll_allocator_positions`. BALANCE column shows `—` for fresh syncs. Likely Phase 07/08.
   - `ISSUE-005` `high` — Client polling gated on a row being in `syncing` (`AllocatorExchangeManager.tsx:169-176`). Live revoked / rate_limited / error transitions on a `complete` row are invisible until reload. Design fix: poll on visibility + at interval while tab is active.
   - `ISSUE-006` `medium` — `rate_limited` pill always renders "retry in 0s" because `AllocatorExchangeManager` never passes `retryAtSeconds` to `AllocatorSyncStatus`. Fix: extend `API_KEY_USER_COLUMNS_ARR` with `last_429_at` (migration + GRANT) and compute `retryAtSeconds = max(0, last_429_at + EXCHANGE_COOLDOWN[exchange] - now)` in the manager.
   - `ISSUE-007` `low` — `titleCase("okx")` gives "Okx"; ditto BNB → "Bnb". Add an exchange-displayName map.
   - `ISSUE-008` `high` — **f8 Queued helper is unreachable**. `public._enqueue_compute_job_internal` uses an optimistic lookup + `INSERT … ON CONFLICT DO NOTHING` and always returns an id — it never raises `unique_violation`. The `EXCEPTION WHEN unique_violation` branch in `request_allocator_holdings_sync` that returns `{already_inflight, next_attempt_at}` is dead code. Fix: either return `(id, was_duplicate bool)` from the internal helper, or have the RPC check for an existing inflight job up front and return the already-inflight shape directly. Unit tests green because they mock the fetch response; end-to-end verification missed this.

---

## To merge & ship

1. Resolve the 3 checkpoints above (or accept them as post-merge QA).
2. `/ship` or manual `gh pr create` from `phase-06-allocator-api-ingestion` → `main`.
3. Production already has the migration — PR just ships the code. Vercel deploy picks it up.

## To resume autonomous execution for Phase 07+

```bash
# After Phase 06 merges (or user accepts remaining checkpoints as deferred)
/gsd-autonomous --from 07
```

Phase 07 (Demo-Mode Purge) depends on Phase 06 `allocator_holdings` being populated (SC1 must be green in practice before 07 can derive dashboards off real data).

---

## Session artifact locations

- `.planning/phases/06-allocator-api-ingestion/06-CONTEXT.md` (D-01..D-19 locked decisions)
- `.planning/phases/06-allocator-api-ingestion/06-RESEARCH.md` (technical research + landmines)
- `.planning/phases/06-allocator-api-ingestion/06-PATTERNS.md` (analog file excerpts)
- `.planning/phases/06-allocator-api-ingestion/06-UI-SPEC.md` (UI design contract)
- `.planning/phases/06-allocator-api-ingestion/06-VALIDATION.md` (per-task verification map)
- `.planning/phases/06-allocator-api-ingestion/VOICES.md` + `VOICES-ACCEPTED.md` (8 adversarial findings)
- `.planning/phases/06-allocator-api-ingestion/06-01..04-PLAN.md` (4 plans with threat models, must-haves, acceptance criteria)
- `.planning/phases/06-allocator-api-ingestion/06-01..04-SUMMARY.md` (per-plan completion reports)
- `.planning/phases/06-allocator-api-ingestion/06-VERIFICATION.md` (phase-level sign-off)
- `.planning/STATE.md` (updated to `code complete; human_needed`)
