# Phase 68: Boundary Wiring & Key Validation - Research

**Researched:** 2026-07-04
**Domain:** Cross-runtime closed-set boundary wiring (TS ↔ pydantic ↔ SQL CHECK) + per-exchange API-key scope validation (Deribit OAuth read-only gate)
**Confidence:** HIGH (all findings are in-repo, verified by file:line; the only LOW item is the exact live Deribit scope string, externally blocked on 67-03)

## Summary

This is a pure **wiring + validation** phase against an existing, well-instrumented codebase — no new packages, no new libraries. `ccxt.deribit` is already registered in `EXCHANGE_CLASSES` (exchange.py:788), and the read-only scope-gate semantics already ship in `scripts/deribit_ground_truth.py`. The work is: (1) add `"deribit"` to the TS single-source-of-truth `SUPPORTED_EXCHANGES` + its display map, the three pydantic `Literal`s, and the SQL CHECK constraints via one migration; (2) add a `detect_deribit_permissions` probe to the existing per-exchange dispatch that parses the `public/auth` scope string; (3) extend the existing byte-parity contract test (`check-zod-db-check-parity.test.ts` + a pytest sibling) to prove the key-boundary allowlists agree AND that the funding surfaces intentionally exclude deribit.

**Two structural hazards dominate this phase and must be designed around, not discovered mid-implementation:**

1. **The TS `SUPPORTED_EXCHANGES` const is over-shared.** It is the SoT not only for the key-save allowlist but also for (a) the derived UI display set `EXCHANGES` (marketing "N exchanges supported" count, public VerificationForm dropdown, MandateForm/StrategyFilters/PreferencesPanel/ApiKeyForm chips), (b) the funding-sync cron filter `PERP_EXCHANGES`, and (c) the reconcile cron filter `RECONCILABLE_EXCHANGES`. Adding `"deribit"` to it auto-widens ALL of these. The funding/reconcile crons are the **funding surface that CONTEXT explicitly excludes** (Phase 70) — so `SUPPORTED_EXCHANGES` must be **decoupled** from the funding-eligible set, exactly mirroring why `funding_fees_exchange_check` stays 3-exchange in SQL. The UI exposure is the Phase-69-gating question (research Q6) and needs an explicit decision.

2. **`verification_requests` is no longer a table** — Phase 19 renamed it to `verification_requests_legacy` and replaced it with a read-only VIEW over `strategy_verifications` (view maps `sv.source AS exchange`). The CHECK the CONTEXT cites as "portfolio_intelligence:81" now lives on the frozen legacy table; the **live** write path's value-space gate is `strategy_verifications.source CHECK (source IN ('okx','binance','bybit','csv'))`. The migration and the parity test must target the real constraints, not the stale ones.

**Primary recommendation:** Ship the TS/pydantic/SQL widening + a `detect_deribit_permissions` probe in one PR, but introduce a **separate 3-exchange funding/perp constant** (TS + the parity spec) so the funding exclusion is enforced in BOTH runtimes, not just the SQL CHECK. Pin the exclusion in the contract test. Treat the incidental UI exposure (marketing count, public verify dropdown) as an explicit gating decision for the planner.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Exchange allowlist SoT | Frontend lib (`closed-sets.ts`) | SQL CHECK (last line of defense) | TS const is the single base; SQL is the persistence guard |
| Key scope validation (Deribit read-only gate) | API/Backend (`analytics-service` key_permissions) | — | Auth probe + ccxt live call belong server-side; never client |
| Honest scope-error copy | API/Backend (error string) → Frontend (render) | `wizardErrors.ts` lookup | Backend derives `error_code` + message; Next renders |
| Cross-runtime parity enforcement | Test tier (vitest + pytest, file-read) | CI gate | No DB at test time; migration files are the pinned artifact |
| Funding-surface exclusion | SQL CHECK (`funding_fees`) + TS/PY funding set | Parity test pin | Must resist auto-widening from `SUPPORTED_EXCHANGES` |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Boundary set — what "every boundary" means in THIS phase**
- IN (key-saving surfaces): `src/lib/closed-sets.ts` `SUPPORTED_EXCHANGES` + `exchangeEnum` + display-name map; pydantic `Literal` allowlists (`models/schemas.py`, `routers/debug_key_flow.py`, `services/ingestion/adapter.py`); SQL CHECK constraints on key/strategy-bearing tables (`api_keys`/initial_schema:22, portfolio_intelligence:81, compute_jobs:132, position_snapshots:52) via ONE migration that DROPs + re-ADDs each CHECK re-based on the LATEST definition (grep ALL migrations first — memory rule).
- OUT (funding surfaces, EXPLICITLY EXCLUDED — supersedes the roadmap criterion's "_FUNDING_BUCKET_HOURS entry" line, which predates BYB-02): `_FUNDING_BUCKET_HOURS` gets NO deribit entry and `funding_fees_exchange_check` (20260602180000:59) stays 3-exchange. BYB-02 red-team finding (2026-07-04, PR #577): Deribit funding is continuous (arbitrary intra-hour timestamps) — a floor-bucket entry would silently collapse distinct events. Phase 70 flips both TOGETHER with a native-id/exact-ts dedup axis. The guard comment already exists in `funding_fetch.py`.
- The parity contract test asserts BOTH directions: key-boundary allowlists (TS ↔ pydantic ↔ SQL CHECKs) all contain deribit AND the funding surfaces intentionally exclude it (exclusion pinned with a comment pointing at Phase 70).

**Scope validation (DRB-03)**
- Source of truth for scope semantics: the 67-01/67-02 harness (`deribit_ground_truth.py` scope gate) — Deribit `public/auth` response `result.scope` string; required `account:read` AND `trade:read`; ANY `:read_write` (or `wallet:read_write`, `block_trade:read_write` etc.) → reject.
- Rejection errors name the exact problem: write-scope present → "key has write scope '<scope>' — create a read-only key"; missing scope → "key is missing required scope '<name>'". No generic "invalid key".
- Validation lives where the existing per-exchange probes live: `services/key_permissions` + `validate_key_permissions` (exchange.py:895, `read_only` derivation :1073) — add a deribit probe following the established per-exchange pattern; `EXCHANGE_CLASSES` already carries deribit (exchange.py:788).
- 67-03 (live ground-truth run) is BLOCKED on the founder's key: scope-string format is encoded from Deribit docs + the shipped harness; re-verify the exact live scope string when 67-03 runs — Phase 72 acceptance gates re-verify end-to-end. Do not block this phase on 67-03.

**Credential shape**
- Deribit = Client ID + Client Secret, NO passphrase. The boundary accepts passphrase-less deribit keys; confirm api_keys passphrase column nullability at plan time (OKX requires passphrase — the shape check must be per-exchange, not global).

**Testing**
- Cross-runtime + SQL parity test in the SAME PR as the wiring. Follow the byte-parity pattern from BYB-02 (`test_funding_match_key_sql_parity.py`): pin the SQL CHECK contents by reading the migration file, assert set-equality with TS/pydantic allowlists (vitest + pytest sides).
- Scope-validation tests: write-scope reject, missing-scope reject (each scope individually), compliant LTP-shaped key accept — mocked `public/auth` responses; every rejection asserts the honest error text.
- wiring-invocation guard (memory HIGH-tackle F1-F12): prove the validator is INVOKED at the key-save call site — a test that fails when the deribit branch is neutered, not just a unit test of the helper.

### Claude's Discretion
- Exact migration filename/timestamp; whether the 4 CHECK updates are one migration file (preferred — lockstep) or split.
- Display name ("Deribit") and any icon/asset handling in the TS display map.
- Probe implementation details (raw endpoint vs ccxt method) as long as the scope gate matches the harness semantics.

### Deferred Ideas (OUT OF SCOPE)
- Deribit wizard card + `/security#deribit-readonly` scope guide — Phase 69.
- Funding surfaces (`_FUNDING_BUCKET_HOURS` deribit entry with native-id/exact-ts dedup axis + `funding_fees_exchange_check` update) — Phase 70, flipped together with the parity-test pin.
- Deribit derivative positions (lift f3 Path-B `DeribitNotSupportedError`) — Phase 71.
- OKX funding rows stopped 2026-06-05 (staleness observation from 67-04) — separate investigation, not Deribit scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DRB-02 | Deribit accepted at every boundary — TS `SUPPORTED_EXCHANGES` + display map, pydantic `Literal`, SQL CHECK migration + parity contract test (same PR). **NOTE:** the REQUIREMENTS.md text also lists "`_FUNDING_BUCKET_HOURS` entry" — this is SUPERSEDED by 68-CONTEXT.md (BYB-02): funding surfaces are EXCLUDED this phase and the parity test PINS the exclusion. | Boundary Inventory table (below) enumerates every TS/pydantic/SQL surface with file:line; the parity-test section shows how to assert set-equality + pin the funding exclusion. |
| DRB-03 | Deribit key validation reads named scopes directly — key rejected unless read-only (no `:read_write`) with `account:read` + `trade:read` present; honest error naming the missing scope. | Validation-flow section maps `detect_deribit_permissions` into the existing `_DISPATCH` + `validate_key_permissions`; the harness `scope_is_read_only` is the reusable gate (needs the additional required-scope check). Open Question #1 flags the honest-error-surfacing design gap. |
</phase_requirements>

## Boundary Inventory (Q1 — every key-saving allowlist, with file:line)

### TS surfaces
| Surface | File:line | Current value | Action |
|---------|-----------|---------------|--------|
| **SoT allowlist** | `src/lib/closed-sets.ts:32` | `SUPPORTED_EXCHANGES = ["binance","okx","bybit"]` | Add `"deribit"` |
| Derived zod enum | `src/lib/closed-sets.ts:34` | `exchangeEnum = z.enum(SUPPORTED_EXCHANGES)` | Auto-follows |
| **Display map** | `src/lib/closed-sets.ts:41-45` | `EXCHANGE_DISPLAY {binance,okx,bybit}` (`satisfies Record<SupportedExchange,…>` → missing label = COMPILE error) | Add `deribit: "Deribit"` (REQUIRED or TS won't compile) |
| Derived UI set | `src/lib/closed-sets.ts:54` | `EXCHANGES = SUPPORTED_EXCHANGES.map(EXCHANGE_DISPLAY)` | Auto-follows → **auto-exposes deribit in UI (see Pitfall 1)** |
| Membership guard | `src/lib/closed-sets.ts:59` `isSupportedExchange()` | lowercases + includes-check | Auto-follows |
| Re-export | `src/lib/utils.ts:154` | re-exports `SUPPORTED_EXCHANGES` | Auto-follows |
| Wizard local list | `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:55` | **OWN** `EXCHANGES: ExchangeOption[]` (id/name/caption/requiresPassphrase) — NOT derived | **Do NOT touch** — this is the Phase-69 wizard-card gate. `requiresPassphrase` lives here (per-exchange). |
| create-with-key route | `src/app/api/strategies/create-with-key/route.ts:46` | `isSupportedExchange(exchange)` | Auto-follows (accepts deribit) |
| verify-strategy route | `src/app/api/verify-strategy/route.ts:65` | `SUPPORTED_EXCHANGES.includes(...)` | Auto-follows (public path accepts deribit — see Pitfall 1) |
| debug-key-flow route | `src/app/api/debug-key-flow/route.ts:37` | `broker: exchangeEnum` | Auto-follows |

### Python (pydantic) surfaces — CONTEXT's explicit IN list
| Surface | File:line | Current value | Action |
|---------|-----------|---------------|--------|
| VerifyRequest.exchange | `analytics-service/models/schemas.py:210` | `Literal["binance","okx","bybit"]` (comment :202-208 pins it to the TS boundary) | Add `"deribit"`; update the comment |
| Broker (debug flow) | `analytics-service/routers/debug_key_flow.py:61` | `Broker = Literal["okx","binance","bybit"]` | Add `"deribit"` |
| Source (ingestion) | `analytics-service/services/ingestion/adapter.py:23` | `Source = Literal["okx","binance","bybit","csv"]` | Add `"deribit"` — **but see Open Question #2 (adapter-registry coupling)** |

### Python surfaces NOT in CONTEXT's explicit list — planner MUST decide (coupled to Source)
| Surface | File:line | Current value | Risk if left 3-exchange | Risk if widened |
|---------|-----------|---------------|-------------------------|-----------------|
| `EXCHANGE_CLASSES` | `exchange.py:788` | ALREADY has `deribit` | — | — (already done) |
| `_DISPATCH` (perm probes) | `key_permissions.py:251-255` | `{binance,okx,bybit}` | **Deribit key silently gets `read=False` → not read_only, no scope error** | This is THE DRB-03 target — MUST add deribit |
| ingestion `SUPPORTED_SOURCES` | `services/ingestion/__init__.py:93` | `("okx","binance","bybit","csv")` | `Source` Literal admits deribit but registry rejects it (`_instantiate` raises ValueError :22-25) → inconsistent | Enables ingestion routing (Phase 70) with no adapter → still fails at factory |
| process_key per-flow sets | `routers/process_key.py:131-134` | `{"okx","binance","bybit"}` × 4 flows | deribit onboard/teaser 422'd at /process-key even though `Source` admits it | Enables unified-backbone deribit ingestion (Phase 70) |
| `funding_fetch` dispatch | `services/funding_fetch.py:850-861` | binance/okx/bybit, else `raise ValueError` | Deribit funding fails loud (correct for this phase) | N/A — leave as-is (Phase 70) |

### SQL CHECK surfaces (grep of ALL migrations — no later named ALTER exists for any of the 4)
Inline `CREATE TABLE` column CHECKs are auto-named `<table>_<column>_check` by Postgres. The migration must DROP that auto-name and ADD a named constraint (so the parity resolver picks it up — see parity section).

| Table.column | Defining migration:line | Current CHECK | Nullable form? | Auto constraint name |
|--------------|------------------------|---------------|----------------|----------------------|
| `api_keys.exchange` | `20260405061911_initial_schema.sql:22` | `NOT NULL CHECK (exchange IN ('binance','okx','bybit'))` | No | `api_keys_exchange_check` |
| `compute_jobs.exchange` | `20260411144407_compute_jobs_queue.sql:132` | `CHECK (exchange IS NULL OR exchange IN (...))` | Yes (`IS NULL OR`) | `compute_jobs_exchange_check` |
| `position_snapshots.exchange` | `20260412094450_position_snapshots.sql:52` | `CHECK (exchange IS NULL OR exchange IN (...))` | Yes (`IS NULL OR`) | `position_snapshots_exchange_check` |
| **`verification_requests.exchange`** ⚠️ | `20260407075303_portfolio_intelligence.sql:81` | `NOT NULL CHECK (exchange IN (...))` | No | **STALE — table renamed to `verification_requests_legacy` (VIEW shim, see below)** |
| **Live verify write path** | `20260501055202_strategy_verifications.sql:91` | `source TEXT NOT NULL CHECK (source IN ('okx','binance','bybit','csv'))` | No | `strategy_verifications_source_check` |
| `funding_fees.exchange` (OUT) | `20260602180000_funding_fees_exchange_check.sql:59` | named `funding_fees_exchange_check CHECK (exchange IN ('binance','okx','bybit'))` | No | **STAYS 3-exchange (Phase 70)** |

**`verification_requests` is now a VIEW** [VERIFIED: grep of `20260620120000_verification_requests_view_shim_apply.sql:123,145`]: `ALTER TABLE verification_requests RENAME TO verification_requests_legacy`, then `CREATE OR REPLACE VIEW verification_requests … SELECT sv.source AS exchange … FROM strategy_verifications WHERE flow_type='teaser'` with INSTEAD OF triggers rejecting all writes. New code writes `strategy_verifications` directly. **Consequence:** the CONTEXT's "portfolio_intelligence:81" boundary is a frozen legacy table. The planner must decide (Open Question #3) whether the migration (a) updates `strategy_verifications.source` (the live gate — but it's `source` and includes `csv`), (b) also updates the frozen `verification_requests_legacy.exchange` for completeness, or (c) documents the legacy one as dead and skips it.

## Key-Validation Flow (Q2 — end-to-end)

**Call graph (all callers funnel through one probe point):**
```
TS create-with-key / verify-strategy / wizard
      │  POST (exchange, api_key, api_secret, passphrase?)
      ▼
analytics-service routers/exchange.py:52  validate_key()
      │  create_exchange(exchange, key, secret, passphrase)   # exchange.py:792
      │  → ccxt instance from EXCHANGE_CLASSES (deribit present :788)
      ▼
services/exchange.py:895  validate_key_permissions(exchange)
      │  load_markets() (swallows RateLimit/PermissionDenied)  :922
      │  fetch_balance() → classifies ccxt errors into error_code  :949-1060
      │  detect_permissions(exchange, api_key_id=None)  :1073   ← pre-store, cache-bypassed
      ▼
services/key_permissions.py:258  detect_permissions()
      │  _DISPATCH[exchange.id]  :285  ← deribit MISSING → returns {read:False,…}  :287-293
      ▼
returns {read, trade, withdraw, probe_error}
      ▼
back in validate_key_permissions:1073-1090
      read_only = read and not trade and not withdraw
      if withdraw → error_code=WITHDRAW_SCOPE  "Key has withdrawal permissions…"
      elif trade  → error_code=TRADE_SCOPE     "Key has trading permissions…"
      ▼
routers/exchange.py:82  if result["error"]: HTTPException(400, detail=result["error"])
      returns {valid, read_only}  → TS renders (error_code → wizardErrors.ts lookup)
```

**Other call sites of `validate_key_permissions` (the deribit probe covers ALL uniformly):** routers/exchange.py:54, routers/debug_key_flow.py:130, routers/cron.py:203, routers/portfolio.py:2213, services/ingestion/okx.py:49. `detect_permissions` also called directly from routers/internal.py:228 (Live Key Permission Viewer). Adding deribit to `_DISPATCH` lights up every one.

**Existing per-exchange probe shapes** [VERIFIED: key_permissions.py]:
- `detect_binance_permissions` (:108) — `GET /sapi/v1/account/apiRestrictions`, booleans.
- `detect_okx_permissions` (:140) — `GET /api/v5/account/config`, comma `perm` string.
- `detect_bybit_permissions` (:175) — `GET /v5/user/query-api`, `readOnly` flag supersedes permissions arrays.
- All return the `{read, trade, withdraw, probe_error}` triple; all fail-CLOSED to `_FAIL_CLOSED` (all-True → wizard rejects) on any exception (:48-53).
- `_DISPATCH` dict maps id→detector (:251); unknown id → `{read:False,…}` (:286-293).

**Deribit probe design** [ASSUMED — mirrors harness semantics, live scope string unverified per 67-03]: `detect_deribit_permissions(exchange)` calls `await exchange.public_get_auth({"grant_type":"client_credentials","client_id":exchange.apiKey,"client_secret":exchange.secret})`, reads `result.scope`, then:
- write scope present (any token ending `:read_write`/`:read_trade`) → `trade=True` (drives TRADE_SCOPE reject),
- `account:read` OR `trade:read` missing → `read=False` (drives not-read_only),
- else `{read:True, trade:False, withdraw:False}`.
Reuse `scope_is_read_only()` from the harness (deribit_ground_truth.py:89) for the write-scope half, and ADD a required-scope check (harness only requires "≥1 :read"; DRB-03 requires `account:read` AND `trade:read` specifically). Fail-CLOSED on exception like the siblings.

**⚠ Error-surfacing gap (Open Question #1):** the existing `{read,trade,withdraw}` triple only produces the GENERIC copy `"Key has trading permissions. Please use a read-only key."` (:1085) — it cannot name the specific scope, which DRB-03 requires ("key is missing required scope 'account:read'"). The planner must extend the surface: e.g. `detect_deribit_permissions` returns an extra `scope_detail` string and `validate_key_permissions` prefers it for deribit, OR add a deribit-specific `error_code`/message branch. The generic path is insufficient for the honest-error acceptance criterion.

## Credential Shape (Q3)

- **`api_keys.passphrase_encrypted TEXT`** (nullable — no `NOT NULL`) [VERIFIED: initial_schema.sql:26]. No later ALTER changes nullability. **Passphrase-less deribit keys are safe at the DB layer.**
- `create_exchange(name, key, secret, passphrase=None)` only sets ccxt `password` when passphrase truthy (exchange.py:806) — a `None` passphrase is fine for deribit; ccxt deribit uses `apiKey`=client_id, `secret`=client_secret.
- OKX is the only exchange that requires a passphrase, enforced per-exchange in the **wizard local** `ConnectKeyStep.tsx:55` `requiresPassphrase` field — NOT a global rule. Deribit's entry (Phase 69) will set `requiresPassphrase: false`. No DB-level passphrase requirement exists, so nothing to change here this phase.
- **Deribit scope-string semantics** [CITED: deribit_ground_truth.py:83-100]: `public/auth` (`grant_type=client_credentials`) returns `result.scope`, a whitespace-joined token list. Read-only observed grounding: `"trade:read account:read wallet:read custody:read block_trade:read"`. Write capability = `:read_write`/`:read_trade` suffix. Auth is native to ccxt's `deribit` class (the harness calls `public_get_auth` explicitly, and private calls auto-exchange the OAuth token). **LOW confidence on the exact live string** — 67-03 blocked on founder key; design against the documented shape and flag for Phase 72 re-verify.

## Parity-Test Pattern (Q4)

**Two existing patterns to follow — the second is the one to EXTEND:**

1. **`analytics-service/tests/test_funding_match_key_sql_parity.py`** (BYB-02 pin, pytest) — reads the migration file with `Path(...).read_text()` and asserts exact substring counts of the SQL literal. This is the pytest-side template: pin the migration's `IN ('binance','okx','bybit','deribit')` list by reading the migration file. It also demonstrates the **funding-exclusion pin style** (a runtime predicate mirrored in SQL, pinned byte-for-byte).

2. **`src/__tests__/contracts/check-zod-db-check-parity.test.ts`** (B9 matrix, vitest) — **THIS is the existing cross-runtime allowlist parity test to extend.** It:
   - scans `supabase/migrations/*.sql` ordered by numeric prefix (Postgres last-wins), comment-stripped;
   - `resolveColumnCheck(table, col, createFile)` (:136) prefers a named `ADD CONSTRAINT <table>_<col>_check` (newest wins) else the inline CHECK — **this is why the migration must use the canonical `<table>_exchange_check` name**;
   - asserts `TS set == latest SQL set` (set-equality, both directions) per SPEC (:342);
   - has an **identity guard** on the exact column list (:313-340) — adding coverage requires editing `EXPECTED_COLUMNS` deliberately.
   - **Currently pins `compute_jobs.exchange` (:220) and `funding_fees.exchange` (:227) BOTH against `SUPPORTED_EXCHANGES`.**

**⚠ The parity test breaks the moment you add deribit to `SUPPORTED_EXCHANGES`** — because the `funding_fees.exchange` spec (:227-237) uses `ts: SUPPORTED_EXCHANGES`, it would then EXPECT deribit in the funding CHECK, which must stay 3-exchange. **This is the central refactor:** decouple the funding spec's `ts` from `SUPPORTED_EXCHANGES` — pin it to an explicit 3-value set (or a new `FUNDING_EXCHANGES` const) with a comment citing Phase 70. Then ADD new specs (`api_keys.exchange`, `position_snapshots.exchange`, and the live verify path) to `SPECS` + `EXPECTED_COLUMNS`, all pinned to the widened `SUPPORTED_EXCHANGES`.

**Both-directions assertion required by CONTEXT:** the contract test must prove (a) key-boundary CHECKs CONTAIN deribit, AND (b) `funding_fees.exchange` EXCLUDES it. Use the existing `rejects: ["deribit"]` mechanism (:186, :358-363) on the funding spec to assert deribit is NOT admitted there. Add a matching pytest assertion (mirroring test_funding_match_key_sql_parity.py) that `_FUNDING_BUCKET_HOURS` has no deribit key and `funding_fees_exchange_check` migration text still lists exactly the 3.

**Tests that MUST be updated (they currently assert the OLD state):**
- `src/lib/closed-sets.test.ts:22` — `expect(SUPPORTED_EXCHANGES).toEqual(["binance","okx","bybit"])` → add deribit.
- `src/lib/closed-sets.test.ts:53` — `expect(isSupportedExchange("deribit")).toBe(false)` → **flips to true**.
- `src/lib/closed-sets.test.ts:32-38` — EXCHANGE_DISPLAY-covers-every-code loop auto-covers deribit once the label is added.

## Runtime State Inventory

This is a boundary-wiring phase, not a rename, but it touches persisted state (SQL CHECK) and live-service filters. The relevant inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No existing deribit rows to migrate — CHECK is a WIDENING (adds an allowed value), so no existing row can violate it. `api_keys`/`compute_jobs`/`position_snapshots` have zero deribit rows (deribit not yet accepted). | DROP+ADD each CHECK; no data backfill. Add a pre-flight DO-block like funding_fees migration:42-53 for symmetry. |
| Live service config | Funding-sync cron (`sync-funding/route.ts:42 PERP_EXCHANGES`) + reconcile cron (`reconcile-strategies/route.ts:34 RECONCILABLE_EXCHANGES`) derive their `.in("api_keys.exchange", …)` filter from `SUPPORTED_EXCHANGES`. Widening auto-enrolls deribit keys. | **Decouple** — pin these to the 3-exchange funding/reconcile set (Pitfall 2). |
| OS-registered state | None — verified: no Task Scheduler / pm2 / cron-registration embeds the exchange list; the crons read `SUPPORTED_EXCHANGES` at request time. | None. |
| Secrets/env vars | `DERIBIT_CLIENT_ID` / `DERIBIT_CLIENT_SECRET` (Railway env only, per 67-CONTEXT) — used by the harness/67-03, NOT by this phase's boundary code. Key-save credentials arrive per-request. | None this phase. |
| Build artifacts | None — no generated allowlist file; TS/pydantic are source, SQL CHECK is a migration. | None. |

**Test-DB catch-up** [VERIFIED: memory `project_frontend_column_add_e2e_db_lag`]: the SQL CHECK migration AUTO-APPLIES to prod on merge (Supabase Migrate). The E2E test project `qmnijlgmdhviwzwfyzlc` LAGS — any e2e/SQL-test that inserts a deribit row will fail until the test DB catches up. Plan a catch-up step (apply the migration to the test project via Supabase MCP) before/with any deribit-inserting e2e.

## Common Pitfalls

### Pitfall 1: `SUPPORTED_EXCHANGES` auto-exposes deribit in user-facing UI (Q6)
**What goes wrong:** `EXCHANGES` (closed-sets.ts:54) is DERIVED from `SUPPORTED_EXCHANGES`. Adding deribit auto-adds a "Deribit" entry to: the marketing page count `{EXCHANGES.length} exchanges supported` (page.tsx:115,215 → "3"→"4"), the **public** landing `VerificationForm` dropdown (VerificationForm.tsx:18 — and verify-strategy route accepts it), `MandateForm`/`StrategyFilters`/`PreferencesPanel`/`ApiKeyForm` chips. Phase 69 is supposed to own the deribit UI reveal.
**Why it happens:** the anti-drift design (one base set → derived display set) is exactly what spreads the value.
**How to avoid:** the wizard **ConnectKeyStep has its own local list** (ConnectKeyStep.tsx:55) so the actual key-ADD card stays gated to Phase 69 — good. But the incidental exposures (marketing count over-claiming "4 supported", public verify dropdown offering deribit before the scope guide exists) need an explicit decision: accept them, or introduce a separate "UI-offered" set distinct from the save-boundary allowlist. **Recommend:** flag to planner/discuss; the marketing count and public verify path are the sharp edges. The allocator badge map already renders deribit (`AllocatorExchangeManager.tsx:115 EXCHANGE_TAGS.deribit`) so positions-side exposure is already live and benign.
**Warning signs:** snapshot/visual tests on the marketing page or VerificationForm change; MandateForm/StrategyFilters chip-count tests shift.

### Pitfall 2: Funding/reconcile crons silently enroll deribit keys
**What goes wrong:** `PERP_EXCHANGES` (sync-funding:42) and `RECONCILABLE_EXCHANGES` (reconcile-strategies:34) are `new Set(SUPPORTED_EXCHANGES)`. After widening, a saved deribit key gets enqueued for funding sync → hits `funding_fetch` dispatch (funding_fetch.py:857) → `raise ValueError("Unsupported exchange for funding: deribit")`, and for reconcile → worker "exchange not supported". Enqueue-then-fail burns the cron error budget (and per memory, red main CI can skip Railway deploys).
**Why it happens:** same over-sharing of the SoT const.
**How to avoid:** decouple — introduce a 3-exchange funding/perp constant and point both crons at it (mirrors the SQL `funding_fees_exchange_check` staying 3-exchange). This makes the funding exclusion enforced in TS too, and the parity test can pin TS↔SQL agreement on the funding surface.
**Warning signs:** `sync-funding/route.test.ts:429` uses `arrayContaining(["binance","okx","bybit"])` (subset assertion) so it stays green even with deribit added — the leak would NOT be caught by the existing test. Add an explicit exact-set assertion.

### Pitfall 3: Migration DROPs the wrong (or a non-existent) constraint
**What goes wrong:** inline CHECKs are auto-named `<table>_<column>_check`; `DROP CONSTRAINT <wrong_name>` silently no-ops with `IF EXISTS`, leaving the old 3-value CHECK live while ADD tries to create a duplicate. And `verification_requests` no longer exists as a table (it's a VIEW) — a `DROP CONSTRAINT` on it errors.
**Why it happens:** the CONTEXT cites pre-Phase-19 line numbers; the schema moved.
**How to avoid:** use the exact auto-names (`api_keys_exchange_check`, `compute_jobs_exchange_check`, `position_snapshots_exchange_check`); verify against the live schema (Supabase MCP `list_tables`/`pg_constraint` on the test project) at plan time; target `strategy_verifications.source` (or the legacy table explicitly) not `verification_requests`. Follow the funding_fees migration's self-verifying DO-block idiom (20260602180000:64-72) to fail-loud if the constraint isn't as expected after ADD. Run the **migration-reviewer agent** on the CHECK migration before PR (memory rule).
**Warning signs:** `pg_get_constraintdef` after ADD doesn't contain `'deribit'`; parity test's `resolveColumnCheck` returns the stale inline set.

### Pitfall 4: Deribit key marked valid-but-not-read-only with NO honest error
**What goes wrong:** without a `_DISPATCH` entry, `detect_permissions` returns `{read:False,trade:False,withdraw:False}` (key_permissions.py:287-293) → `read_only = False`, and NO `WITHDRAW_SCOPE`/`TRADE_SCOPE` error is set → `validate_key_permissions` returns `error=None`, so routers/exchange.py:82 does NOT 400. The key passes with `read_only:false` and a confusing UX.
**Why it happens:** the unknown-exchange branch fails silent-open on the error field even though read_only is false.
**How to avoid:** add `detect_deribit_permissions` to `_DISPATCH`; ensure the deribit path sets a specific error (Open Question #1). Include a wiring-invocation guard test that fails when the deribit `_DISPATCH` entry is removed.
**Warning signs:** a write-scoped deribit key returns HTTP 200 `{valid:true, read_only:false}` instead of a 400 naming the scope.

## Code Examples

### Existing scope gate to reuse (harness)
```python
# Source: analytics-service/scripts/deribit_ground_truth.py:86-100
_WRITE_SCOPE_SUFFIXES = (":read_write", ":read_trade")

def scope_is_read_only(scope: str) -> bool:
    tokens = scope.split()
    if any(tok.endswith(_WRITE_SCOPE_SUFFIXES) for tok in tokens):
        return False
    return any(tok.endswith(":read") for tok in tokens)
# DRB-03 needs MORE: also require 'account:read' AND 'trade:read' present by name.
```

### Existing dispatch to extend
```python
# Source: analytics-service/services/key_permissions.py:251-255
_DISPATCH = {
    "binance": detect_binance_permissions,
    "okx": detect_okx_permissions,
    "bybit": detect_bybit_permissions,
    # add: "deribit": detect_deribit_permissions,
}
```

### Existing DROP-then-ADD migration idiom (with self-verify)
```sql
-- Source: supabase/migrations/20260602180000_funding_fees_exchange_check.sql:42-72
-- Pre-flight fail-loud, then DROP IF EXISTS + ADD named CHECK, then a DO-block
-- asserting pg_get_constraintdef matches. Re-runnable no-op; the canonical name
-- lets check-zod-db-check-parity.test.ts resolveColumnCheck() pick it up.
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_exchange_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_exchange_check
  CHECK (exchange IN ('binance', 'okx', 'bybit', 'deribit'));
```

### Existing parity SPEC to extend (and the funding decoupling)
```typescript
// Source: src/__tests__/contracts/check-zod-db-check-parity.test.ts:219-237
{ column: "compute_jobs.exchange", ts: SUPPORTED_EXCHANGES,          // auto-gains deribit ✓
  sql: () => resolveColumnCheck("compute_jobs","exchange","20260411144407_compute_jobs_queue.sql") },
{ column: "funding_fees.exchange", ts: SUPPORTED_EXCHANGES,          // ⚠ MUST decouple → 3-value + rejects:["deribit"]
  sql: () => resolveColumnCheck("funding_fees","exchange","20260602180000_funding_fees_exchange_check.sql") },
// ADD: api_keys.exchange, position_snapshots.exchange (+ EXPECTED_COLUMNS identity list :318)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `verification_requests` base table with `exchange` CHECK | VIEW over `strategy_verifications` (writes via `source`) | Phase 19 (mig 20260620120000) | The CONTEXT's "portfolio_intelligence:81" boundary is frozen; live gate is `strategy_verifications.source` |
| Funding dedup on 8h floor bucket | 1h floor bucket + match_key rekey | 2026-07-04 (mig 20260704150835, BYB-02) | Deribit (continuous funding) can't use ANY floor bucket → funding surface deferred to Phase 70 |
| Inline `read_only` inference | `{read,trade,withdraw}` triple via `services/key_permissions` + TTL cache | Sprint 5 Task 5.8 | Add deribit to `_DISPATCH`, not to inline validate logic |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Deribit read-only scope string format is `"trade:read account:read wallet:read …"` (space-joined, `:read`/`:read_write` suffixes) | Credential Shape, Validation Flow | 67-03 blocked; if live format differs, the probe's parsing needs adjustment — Phase 72 gates re-verify. Design defensively (token-suffix match, not exact-string). |
| A2 | `detect_deribit_permissions` calling `public/auth` with `exchange.apiKey`/`exchange.secret` works inside the validate flow (ccxt deribit native OAuth) | Validation Flow | If ccxt deribit needs a different auth invocation, the probe call shape changes; the harness already proves `public_get_auth` works (deribit_ground_truth.py:504). |
| A3 | Widening `adapter.py Source` Literal without a deribit adapter factory is safe because no ingestion runs for deribit this phase | Boundary Inventory, Open Q2 | If any code path calls `_instantiate("deribit")`, it raises ValueError. Verify no live caller reaches it pre-Phase-70. |
| A4 | The live verify write-path constraint to widen is `strategy_verifications.source` (not the frozen `verification_requests_legacy.exchange`) | SQL surfaces | If the legacy table is still written anywhere, that CHECK also matters. Verify write paths at plan time. |
| A5 | No existing prod rows violate the widened CHECKs (widening only adds a value) | Runtime State | Widening a CHECK never rejects existing rows — structurally safe. |

## Open Questions (RESOLVED — see 68-CONTEXT.md "Research open questions — RESOLVED (2026-07-04)" for the four dispositions; every plan implements them)

1. **How does the honest per-scope error surface through the `{read,trade,withdraw}` triple?** (DRB-03)
   - Know: existing errors are generic (`TRADE_SCOPE`/`WITHDRAW_SCOPE`), set in validate_key_permissions:1082-1087.
   - Unclear: DRB-03 requires naming the exact scope ("missing required scope 'account:read'", "key has write scope '<scope>'").
   - Recommend: `detect_deribit_permissions` returns an extra `scope_detail` (or a deribit-specific `error_code`), and `validate_key_permissions` prefers it for deribit. Planner decides the exact shape; keep it additive so existing callers are unaffected.

2. **Is `adapter.py Source` widened alone, or together with `SUPPORTED_SOURCES` (__init__:93) + process_key per-flow sets (:131-134)?**
   - Know: CONTEXT lists adapter.py IN; the other two are coupled (Source Literal ↔ registry ↔ per-flow validator).
   - Unclear: widening Source alone leaves an internal inconsistency (Literal admits deribit, registry/flow reject it).
   - Recommend: widen ONLY the validation-relevant Literals this phase (schemas.py, debug_key_flow, adapter.py Source for type-consistency), and explicitly LEAVE `SUPPORTED_SOURCES`/process_key per-flow sets/funding_fetch dispatch at 3-exchange (ingestion is Phase 70). Document the deferral in-code. Alternatively, if the planner judges Source shouldn't widen without its adapter, keep adapter.py at 3+csv and note the deviation from CONTEXT's literal list — flag to discuss.

3. **Which verification constraint does the migration target?** (`strategy_verifications.source` live vs `verification_requests_legacy.exchange` frozen)
   - Recommend: verify via Supabase MCP (`list_tables` on test project) at plan time; target the live `strategy_verifications.source` if the verify path must accept deribit, and document the legacy table as dead. Note `source` includes `csv` — widening it to deribit is a `source` change, semantically distinct from the `exchange` columns.

4. **Does the phase accept the incidental UI exposure (marketing "4 exchanges supported", public VerificationForm deribit option), or gate it?** (Q6/Pitfall 1)
   - Recommend: surface to discuss. If gating, the cleanest is a separate "UI-offered" set; if accepting, note the marketing over-claim and that the public verify path will accept a deribit key before the Phase-69 scope guide exists.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ccxt` (python, `ccxt.deribit`) | Deribit probe + validate | ✓ (in `EXCHANGE_CLASSES` exchange.py:788) | as pinned in analytics-service reqs | — |
| Supabase Migrate (auto-apply on merge) | SQL CHECK migration | ✓ | — | manual apply via MCP |
| Test project `qmnijlgmdhviwzwfyzlc` | e2e / SQL-tests inserting deribit | ✓ but LAGS prod | — | apply migration to test DB via MCP before e2e |
| Founder Deribit key (`DERIBIT_CLIENT_ID/SECRET`) | 67-03 live scope verify | ✗ (blocked) | — | design against harness-documented shape; Phase 72 re-verifies |

**Missing dependencies with no fallback:** none block this phase (live scope string re-verify is deferred to Phase 72, not a blocker per CONTEXT).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (TS, `@vitest/coverage-v8`) + pytest (`analytics-service`, `--cov-fail-under=80`) |
| Config file | `vitest.config.ts` (TS); `analytics-service/` pytest config |
| Quick run command | `npx vitest run src/__tests__/contracts/check-zod-db-check-parity.test.ts` / `pytest analytics-service/tests/test_funding_match_key_sql_parity.py -x` |
| Full suite command | `npm run test:coverage` / `pytest analytics-service` |

### Phase Requirements → Test Map
| Success criterion | Behavior | Test Type | Automated Command | File Exists? |
|-------|----------|-----------|-------------------|-------------|
| SC1: deribit at every key-boundary in ONE PR w/ parity | TS↔pydantic↔SQL set-equality includes deribit | contract (file-read) | `npx vitest run src/__tests__/contracts/check-zod-db-check-parity.test.ts` | ✅ extend (add api_keys/position_snapshots specs + EXPECTED_COLUMNS) |
| SC1 (pydantic side) | schemas.py/debug_key_flow/adapter Literals admit deribit | unit | `pytest analytics-service/tests/ -k "literal or boundary" -x` | ❌ Wave 0 (new pydantic-parity test) |
| SC1 (funding exclusion pin) | funding CHECK + `_FUNDING_BUCKET_HOURS` EXCLUDE deribit | contract | vitest `rejects:["deribit"]` on funding_fees spec + `pytest -k funding_match_key_sql_parity` (extend) | ✅ vitest / ✅ pytest (extend both) |
| SC2: write scope rejected honestly | `:read_write` scope → 400 naming the scope | unit (mocked `public/auth`) | `pytest analytics-service/tests/ -k "deribit and scope" -x` | ❌ Wave 0 |
| SC3: missing `account:read`/`trade:read` rejected naming scope | each scope missing individually → honest error | unit (mocked) | `pytest analytics-service/tests/ -k "deribit and missing_scope" -x` | ❌ Wave 0 |
| SC4: compliant read-only key accepted | LTP-shaped scope → `valid:true, read_only:true` | unit (mocked) | `pytest analytics-service/tests/ -k "deribit and read_only_accept" -x` | ❌ Wave 0 |
| DRB-03 wiring guard | validator INVOKED at key-save call site; fails when deribit `_DISPATCH` branch neutered | integration | `pytest analytics-service/tests/ -k "deribit and dispatch_wired" -x` | ❌ Wave 0 (memory F1-F12 rule) |
| closed-sets truths flip | `SUPPORTED_EXCHANGES`/`isSupportedExchange("deribit")` updated | unit | `npx vitest run src/lib/closed-sets.test.ts` | ✅ UPDATE (asserts old state) |

### Sampling Rate
- **Per task commit:** the touched-side quick run (vitest contract test OR the relevant pytest -k).
- **Per wave merge:** `npm run test:coverage` + `pytest analytics-service` (cross-runtime — SC1 spans both).
- **Phase gate:** full suite green before `/gsd:verify-work`; migration-reviewer agent on the CHECK migration; test-DB catch-up applied before any deribit-inserting e2e.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_deribit_scope_validation.py` — SC2/SC3/SC4 + wiring guard (mocked `public/auth`), covers DRB-03.
- [ ] `analytics-service/tests/test_boundary_literals_parity.py` (or extend an existing boundary test) — pydantic Literals include deribit; funding surfaces exclude it.
- [ ] Extend `src/__tests__/contracts/check-zod-db-check-parity.test.ts` — add `api_keys.exchange`, `position_snapshots.exchange` specs; decouple `funding_fees.exchange` from `SUPPORTED_EXCHANGES` (+ `rejects:["deribit"]`); update `EXPECTED_COLUMNS`.
- [ ] Extend `analytics-service/tests/test_funding_match_key_sql_parity.py` (or a sibling) — pin `_FUNDING_BUCKET_HOURS` has no deribit + funding CHECK stays 3-exchange.
- [ ] Update `src/lib/closed-sets.test.ts` (:22, :53) — flip the deribit assertions.
- [ ] Update `src/app/api/cron/sync-funding/route.test.ts:429` — add an EXACT-set assertion so the deribit funding leak (Pitfall 2) is caught, not masked by `arrayContaining`.
- [ ] No framework install needed — both suites exist.

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Deribit OAuth `client_credentials`; ccxt-native token exchange; creds per-request, never logged (scrub_freeform_string) |
| V4 Access Control | yes | Read-only scope GATE is the security boundary — reject any `:read_write`; fail-CLOSED on probe error (`_FAIL_CLOSED` all-True → reject) |
| V5 Input Validation | yes | Closed-set allowlist at every tier (zod enum, pydantic Literal, SQL CHECK) — deribit added to the closed set, not opening it |
| V6 Cryptography | no (unchanged) | api_keys creds encrypted via existing KEK path (encrypt-key route) — no change |
| V7 Error Handling / Logging | yes | Scope strings are NOT secrets (printed verbatim in harness); credential VALUES must never reach logs — reuse existing scrub on the probe's error path |

| Threat Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Write-capable key saved as "read-only" | Elevation of Privilege | Scope gate rejects `:read_write`/`:read_trade`; fail-CLOSED on ambiguous probe |
| Credential leak via ccxt error echo | Information Disclosure | Existing `scrub_freeform_string` + literal-value redaction (deribit_ground_truth.py:54-77) on the probe error path |
| Boundary-drift (TS admits what DB rejects → 23514) | Tampering | The parity contract test (both directions) is the pin — extend it, don't bypass |
| Deribit key enrolled into funding cron pre-Phase-70 | Denial of Service (cron error-budget burn) | Decouple funding/reconcile filters from `SUPPORTED_EXCHANGES` (Pitfall 2) |

## Sources

### Primary (HIGH confidence — in-repo, file:line verified)
- `src/lib/closed-sets.ts:32-61` — SUPPORTED_EXCHANGES SoT + derived EXCHANGES/display map/guard
- `src/__tests__/contracts/check-zod-db-check-parity.test.ts` — the cross-runtime parity matrix to extend
- `analytics-service/services/key_permissions.py` — per-exchange probe pattern + `_DISPATCH`
- `analytics-service/services/exchange.py:788-1090` — EXCHANGE_CLASSES, create_exchange, validate_key_permissions + read_only derivation
- `analytics-service/scripts/deribit_ground_truth.py:83-100,504-522` — shipped scope-gate semantics
- `analytics-service/tests/test_funding_match_key_sql_parity.py` — BYB-02 migration-file pin pattern
- `analytics-service/services/funding_fetch.py:205-219,850-861` — funding exclusion guard + dispatch
- `supabase/migrations/20260602180000_funding_fees_exchange_check.sql` — DROP+ADD+self-verify migration idiom
- `supabase/migrations/20260620120000_verification_requests_view_shim_apply.sql:105-165` — verification_requests → VIEW
- `supabase/migrations/{initial_schema:22, compute_jobs_queue:132, position_snapshots:52, strategy_verifications:91}` — CHECK sites
- CONTEXT.md (68) + REQUIREMENTS.md (DRB-02/03) + memory (test-DB lag, F1-F12 wiring guard, migration-reviewer rule)

### Secondary (MEDIUM)
- `analytics-service/routers/{exchange.py:52-84, debug_key_flow.py:61,130, process_key.py:131-134, internal.py:228}` — validate call sites
- `src/app/api/cron/{sync-funding/route.ts:42, reconcile-strategies/route.ts:34}` — funding/reconcile leak paths

### Tertiary (LOW — flagged for validation)
- Exact live Deribit `public/auth` scope string — 67-03 blocked on founder key; assume harness-documented shape, Phase 72 re-verifies (A1).

## Metadata

**Confidence breakdown:**
- Boundary inventory: HIGH — every surface located by grep + file:line across both runtimes.
- Validation flow: HIGH — single probe point (`_DISPATCH`) confirmed to cover all callers; error-surfacing gap explicitly flagged.
- Parity-test approach: HIGH — the existing B9 test + BYB-02 pytest are the exact templates; the funding-decoupling break is identified.
- SQL migration targets: MEDIUM-HIGH — auto-constraint-names are canonical, but `verification_requests` VIEW rename requires live-schema verification at plan time (Open Q3).
- Deribit live scope string: LOW — externally blocked (A1).

**Package Legitimacy Audit:** N/A — this phase installs NO external packages (`ccxt.deribit` already present in `EXCHANGE_CLASSES`; all work is in-repo wiring/tests/migration).

**Research date:** 2026-07-04
**Valid until:** ~2026-08-04 (stable in-repo domain; re-check if Phase 69/70 land first or the schema moves again)
