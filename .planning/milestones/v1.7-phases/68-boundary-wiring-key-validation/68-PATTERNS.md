# Phase 68: Boundary Wiring & Key Validation - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 16 (11 modified + 3 created + 2 SQL/new-test)
**Analogs found:** 16 / 16 (every surface has an in-repo template — this is a pure wiring phase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/closed-sets.ts` (MOD) | config (SoT allowlist) | transform | itself (existing `SUPPORTED_EXCHANGES`/`EXCHANGE_DISPLAY` block :32-61) | exact (in-place widen + new sibling const) |
| `src/lib/closed-sets.test.ts` (MOD) | test | request-response | itself :20-56 (the exchange describe block) | exact |
| `src/__tests__/contracts/check-zod-db-check-parity.test.ts` (MOD) | test (contract) | file-I/O parity | itself — `Spec`/`SPECS`/`EXPECTED_COLUMNS` :179-340 | exact (extend the matrix) |
| `src/app/api/cron/sync-funding/route.ts` (MOD) | route (cron) | event-driven/batch | itself `PERP_EXCHANGES` :42 | exact (decouple from SoT) |
| `src/app/api/cron/reconcile-strategies/route.ts` (MOD) | route (cron) | event-driven/batch | itself `RECONCILABLE_EXCHANGES` :34 | exact (decouple from SoT) |
| `src/app/api/cron/sync-funding/route.test.ts` (MOD) | test | event-driven | itself :429 (subset assertion → exact-set) | exact |
| `analytics-service/models/schemas.py` (MOD) | model (pydantic) | request-response | itself `VerifyRequest.exchange` Literal :210 | exact |
| `analytics-service/routers/debug_key_flow.py` (MOD) | model (pydantic) | request-response | itself `Broker` Literal :61 | exact |
| `analytics-service/services/ingestion/adapter.py` (MOD) | model (pydantic) | transform | itself `Source` Literal :23 | exact |
| `analytics-service/services/key_permissions.py` (MOD + new fn) | service (probe) | request-response | `detect_okx_permissions` :140-172 / `detect_bybit_permissions` :175-243 | exact (add `detect_deribit_permissions` + `_DISPATCH` :251) |
| `analytics-service/services/exchange.py` (MOD) | service (validator) | request-response | itself `validate_key_permissions` read_only+error block :1073-1085 | exact (additive scope_detail branch) |
| SQL migration `2026…_deribit_exchange_check.sql` (NEW) | migration | — | `20260602180000_funding_fees_exchange_check.sql` (whole file) | exact (DROP/ADD + DO-block idiom, ×4 tables) |
| `analytics-service/tests/test_deribit_scope_validation.py` (NEW) | test | request-response (mocked) | `detect_*` probe tests + harness `scope_is_read_only` gate | role-match (mocked `public/auth`) |
| `analytics-service/tests/test_boundary_literals_parity.py` (NEW) | test (contract) | file-I/O parity | `test_funding_match_key_sql_parity.py` (whole file) | role-match (Literal↔SQL pin) |
| `analytics-service/tests/test_funding_match_key_sql_parity.py` (MOD) | test (contract) | file-I/O parity | itself (extend: pin `_FUNDING_BUCKET_HOURS` excludes deribit) | exact |
| Reused helper `scope_is_read_only` | utility | transform | `deribit_ground_truth.py:89-100` (import/reuse, do not re-implement) | exact |

## Pattern Assignments

### `analytics-service/services/key_permissions.py` — add `detect_deribit_permissions` (service, request-response) [THE DRB-03 core]

**Analog:** the three sibling detectors, closest is `detect_bybit_permissions` (`readOnly` flag supersedes arrays — structurally identical to Deribit's scope-string gate).

**Signature + fail-CLOSED pattern to copy** (`detect_okx_permissions` :140-172; the `dict(_FAIL_CLOSED)` on ANY exception is MANDATORY — all three siblings do it, `_FAIL_CLOSED` :48-53 = all-True so the wizard rejects):
```python
async def detect_okx_permissions(exchange: ccxt.Exchange) -> PermissionDict:
    try:
        config = await exchange.private_get_account_config()
    except Exception as exc:
        logger.warning("OKX permission probe failed: %s", exc)
        return dict(_FAIL_CLOSED)   # <-- fail-CLOSED; deribit probe MUST do the same
    ...
    return {"read": True, "trade": has_trade, "withdraw": has_withdraw, "probe_error": False}
```

**Return-shape contract** (`key_permissions.py:42-53`): every detector returns `{"read": bool, "trade": bool, "withdraw": bool, "probe_error": bool}`. The deribit probe extends this ADDITIVELY (OQ1) — add a `scope_detail` (or `error_code`/message) field alongside the triple so it names the offending/missing scope; existing callers ignore it.

**Reuse the shipped scope gate — do NOT re-implement** (`deribit_ground_truth.py:86-100`):
```python
_WRITE_SCOPE_SUFFIXES: tuple[str, ...] = (":read_write", ":read_trade")
def scope_is_read_only(scope: str) -> bool:
    tokens = scope.split()
    if any(tok.endswith(_WRITE_SCOPE_SUFFIXES) for tok in tokens):
        return False
    return any(tok.endswith(":read") for tok in tokens)
# DRB-03 needs MORE: also require 'account:read' AND 'trade:read' present BY NAME.
```
Deribit probe body [ASSUMED shape, A1 — live string 67-03-blocked]: `await exchange.public_get_auth({"grant_type":"client_credentials","client_id":exchange.apiKey,"client_secret":exchange.secret})`, read `result.scope`, then: any `:read_write`/`:read_trade` token → `trade=True` + `scope_detail="key has write scope '<tok>' — create a read-only key"`; missing `account:read` or `trade:read` → `read=False` + `scope_detail="key is missing required scope '<name>'"`; else `{read:True, trade:False, withdraw:False}`.

**Register in the dispatch** (`key_permissions.py:251-255` — the SINGLE wiring point; adding here lights up all 6 call sites of `validate_key_permissions`):
```python
_DISPATCH = {
    "binance": detect_binance_permissions,
    "okx": detect_okx_permissions,
    "bybit": detect_bybit_permissions,
    # add: "deribit": detect_deribit_permissions,
}
```
⚠ Pitfall 4: without this entry the unknown-exchange branch (:286-293) returns `{read:False,trade:False,withdraw:False}` → `read_only=False` but NO error → the key passes with a confusing 200. The wiring-invocation guard test must fail when this line is removed.

---

### `analytics-service/services/exchange.py` — honest-error surfacing (service, request-response) [OQ1]

**Analog:** the existing `read_only` derivation + generic-error block (`exchange.py:1073-1085`):
```python
result["read_only"] = bool(has_read and not has_trade and not has_withdraw)
result["probe_error"] = bool(probe_error)
if has_withdraw:
    result["error"] = "Key has withdrawal permissions. Please use a read-only key."
    result["error_code"] = "WITHDRAW_SCOPE"
elif has_trade:
    result["error"] = "Key has trading permissions. Please use a read-only key."
    result["error_code"] = "TRADE_SCOPE"
```
**Change (additive):** for deribit, prefer `perms["scope_detail"]` over the generic copy so the error NAMES the scope (DRB-03: "key is missing required scope 'account:read'"). Keep the branch deribit-scoped so binance/okx/bybit copy is unchanged. Router surfacing already handled: `routers/exchange.py:82` raises `HTTPException(400, detail=result["error"])`.

---

### `src/lib/closed-sets.ts` — widen SoT + decouple funding/UI (config, transform)

**Analog:** the existing block (in-place). Add `"deribit"` to `SUPPORTED_EXCHANGES` (:32) and a REQUIRED display label (:41-45 — `satisfies Record<SupportedExchange,…>` makes a missing label a COMPILE error):
```typescript
export const SUPPORTED_EXCHANGES = ["binance", "okx", "bybit", "deribit"] as const;
export const EXCHANGE_DISPLAY = {
  binance: "Binance", okx: "OKX", bybit: "Bybit", deribit: "Deribit",
} as const satisfies Record<SupportedExchange, string>;
```
**New sibling const (Claude's discretion on name — e.g. `FUNDING_EXCHANGES`):** a 3-value set that does NOT derive from `SUPPORTED_EXCHANGES`, with a comment citing Phase 70. This is the TS mirror of `funding_fees_exchange_check` staying 3-exchange. The existing `EXCHANGES` derived UI set (:54) and `isSupportedExchange` (:59) auto-follow — that is Pitfall 1 (UI exposure, OQ4 GATE): if gating, the marketing count / public VerificationForm dropdown need their own explicit 3-value const too, NOT `EXCHANGES`.

---

### `src/app/api/cron/{sync-funding,reconcile-strategies}/route.ts` — decouple cron filters (route, event-driven) [Pitfall 2]

**Analog:** both files derive their filter from the SoT and must be repointed at the new 3-value funding const:
```typescript
// sync-funding/route.ts:42   const PERP_EXCHANGES = new Set(SUPPORTED_EXCHANGES);
// reconcile-strategies/route.ts:34   const RECONCILABLE_EXCHANGES = new Set(SUPPORTED_EXCHANGES);
```
Both currently `new Set(SUPPORTED_EXCHANGES)` — after widening they would auto-enroll deribit keys → `funding_fetch.py:857 raise ValueError("Unsupported exchange for funding: deribit")` (cron error-budget burn). Repoint to `FUNDING_EXCHANGES`. The Python mirror already excludes deribit: `_FUNDING_BUCKET_HOURS` (`funding_fetch.py:216-220`) is `{binance:1, okx:1, bybit:1}` with the ⚠ guard comment (:209-215) pinning the Phase-70 deferral.

---

### SQL migration (NEW) — DROP/ADD each `<table>_exchange_check` (migration)

**Analog:** `supabase/migrations/20260602180000_funding_fees_exchange_check.sql` (whole file). Copy the three-part idiom PER TABLE: (1) pre-flight fail-loud DO-block listing offending values, (2) `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT <canonical_name> CHECK`, (3) self-verifying DO-block asserting `pg_get_constraintdef` contains each venue.
```sql
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_exchange_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_exchange_check
  CHECK (exchange IN ('binance', 'okx', 'bybit', 'deribit'));
-- then the self-verify DO-block (:63-79) with 'deribit' added to the position() checks
```
**Canonical names are LOAD-BEARING** — the parity test's `resolveColumnCheck` (:136) resolves a named `<table>_<column>_check` first; use exactly `api_keys_exchange_check`, `compute_jobs_exchange_check`, `position_snapshots_exchange_check`, `strategy_verifications_source_check`.
**Targets** (OQ3, live-schema-verify via Supabase MCP at plan time — Pitfall 3): WIDEN `api_keys.exchange`, `compute_jobs.exchange`, `position_snapshots.exchange`, and `strategy_verifications.source` (the LIVE verify write path — `verification_requests` is now a VIEW; DO NOT `DROP CONSTRAINT` on it or on the frozen `verification_requests_legacy`). Note `strategy_verifications.source` also carries `csv` → widened set is `('okx','binance','bybit','deribit','csv')`. Run the **migration-reviewer agent** before PR (memory rule).

---

### `src/__tests__/contracts/check-zod-db-check-parity.test.ts` — extend the matrix (test, file-I/O parity) [SC1]

**Analog:** the existing `Spec` shape (:179-189), `SPECS` entries (:198-310), and the `EXPECTED_COLUMNS` identity guard (:318-334). Reuse `resolveColumnCheck(table, col, createFile)`.
- **Decouple the funding spec (the central break):** `funding_fees.exchange` currently pins `ts: SUPPORTED_EXCHANGES` (:227-228) — the moment deribit joins the SoT this EXPECTS deribit in the funding CHECK, which stays 3-exchange. Change its `ts` to the explicit 3-value set (or `FUNDING_EXCHANGES`) and add `rejects: ["deribit"]` (mechanism at :186 + :358-363) to assert the funding CHECK EXCLUDES deribit (the "both directions" CONTEXT requirement).
- **Add new specs** (all `ts: SUPPORTED_EXCHANGES`, auto-gains deribit): `api_keys.exchange` (createFile `20260405061911_initial_schema.sql`), `position_snapshots.exchange` (`20260412094450_position_snapshots.sql`), and `strategy_verifications.source`. `compute_jobs.exchange` (:220) already pins `SUPPORTED_EXCHANGES` → auto-passes once the migration lands.
- **Update `EXPECTED_COLUMNS`** (:318) deliberately — the identity guard fails a silent drop-one/add-one otherwise.

---

### `analytics-service/tests/test_deribit_scope_validation.py` (NEW) — DRB-03 [SC2/SC3/SC4 + wiring guard]

**Analog:** the probe siblings (mock `exchange.public_get_auth` the way real probes call it) + `scope_is_read_only` semantics from the harness. Structure per SC:
- SC2 write-scope reject: mocked `result.scope` with a `:read_write` token → 400 asserting the honest text names the scope.
- SC3 missing-scope reject: scope missing `account:read` (then missing `trade:read`) individually → honest "missing required scope '<name>'".
- SC4 accept: LTP-shaped read-only scope → `valid:true, read_only:true`.
- **Wiring guard (memory F1-F12):** a test that removes/neutralizes the `_DISPATCH["deribit"]` entry and asserts the key-save path then FAILS to reject a write-scoped key — proves the validator is INVOKED, not just unit-correct.

---

### `analytics-service/tests/test_boundary_literals_parity.py` (NEW) & `test_funding_match_key_sql_parity.py` (MOD)

**Analog:** `test_funding_match_key_sql_parity.py` (whole file) — the `Path(...).read_text()` + `sql.count(literal)` migration-pin idiom:
```python
_MIGRATION = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / "<file>.sql"
def test_migration_pins_the_same_format(self):
    sql = _MIGRATION.read_text(encoding="utf-8")
    assert sql.count(_SQL_FORMAT_LITERAL) == 4
```
- **New `test_boundary_literals_parity.py`:** assert the pydantic Literals (`schemas.py` VerifyRequest.exchange, `debug_key_flow.py` Broker, `adapter.py` Source) all CONTAIN `"deribit"`, and that the funding surfaces (`_FUNDING_BUCKET_HOURS`, `funding_fees_exchange_check` migration text) EXCLUDE it — both directions, mirroring the vitest contract test.
- **Extend `test_funding_match_key_sql_parity.py`:** add an assertion that `_FUNDING_BUCKET_HOURS` (import from `services.funding_fetch`) has no `deribit` key and the 3-exchange `funding_fees_exchange_check` migration still lists exactly binance/okx/bybit.

---

### `src/lib/closed-sets.test.ts` & `sync-funding/route.test.ts` (MOD) — flip stale assertions

**Analog:** in-place edits to existing assertions.
- `closed-sets.test.ts:22` `toEqual(["binance","okx","bybit"])` → add `"deribit"`.
- `closed-sets.test.ts:53` `isSupportedExchange("deribit")` → **flips `false` → `true`** (and its `// wider ccxt set` comment updates).
- `closed-sets.test.ts:29` `EXCHANGES` derived-display assertion → add `"Deribit"` (order-sensitive).
- `sync-funding/route.test.ts:429` uses `arrayContaining(["binance","okx","bybit"])` (subset — would NOT catch a deribit leak). Add an EXACT-set assertion so the Pitfall-2 leak fails the test.

## Shared Patterns

### Fail-CLOSED probe convention
**Source:** `analytics-service/services/key_permissions.py:48-53` (`_FAIL_CLOSED` all-True) + every `except Exception: return dict(_FAIL_CLOSED)`.
**Apply to:** `detect_deribit_permissions`. Any probe exception (bad creds, network, unexpected `public/auth` shape) must return all-True so the wizard rejects — never fail-open. Security boundary (ASVS V4).

### Credential redaction on error paths
**Source:** `analytics-service/scripts/deribit_ground_truth.py:54-77` (`_redact_secret_values` + `scrub_freeform_string`, withhold-on-residue).
**Apply to:** the deribit probe's error/logging path — a ccxt error may echo `client_id`/`client_secret`; scrub before any log or error string. Scope strings themselves are NOT secrets (printed verbatim in the harness).

### Named-constraint DROP/ADD + self-verify migration idiom
**Source:** `supabase/migrations/20260602180000_funding_fees_exchange_check.sql:36-81`.
**Apply to:** all four CHECK widenings in the ONE migration. Canonical `<table>_<column>_check` names + the pre-flight and post-ADD DO-blocks. This is what the vitest `resolveColumnCheck` depends on.

### Migration-file byte-pin parity
**Source:** `analytics-service/tests/test_funding_match_key_sql_parity.py` (pytest) + `check-zod-db-check-parity.test.ts` `resolveColumnCheck` (vitest).
**Apply to:** both new/extended parity tests. Read the migration file, assert set-equality (widen direction) AND exclusion (`rejects`/count on the funding surface).

## No Analog Found

None. Every surface in this phase has an in-repo template — it is a pure wiring/validation phase against a well-instrumented codebase (`ccxt.deribit` already in `EXCHANGE_CLASSES`, scope gate already shipped in the harness).

## Metadata

**Analog search scope:** `src/lib/`, `src/__tests__/contracts/`, `src/app/api/cron/`, `analytics-service/{services,routers,models,scripts,tests}/`, `supabase/migrations/`.
**Files scanned:** 12 (closed-sets.ts, key_permissions.py, exchange.py, deribit_ground_truth.py, funding_fees migration, both parity tests, closed-sets.test.ts, schemas.py, adapter.py, debug_key_flow.py, funding_fetch.py, both cron routes + process_key.py).
**Pattern extraction date:** 2026-07-04
**Load-bearing caveats for the planner:** (1) A1 — live Deribit scope string is 67-03-blocked; design the probe on token-SUFFIX matching, not exact-string, flag for Phase 72 re-verify. (2) OQ3/Pitfall 3 — verify live constraint names via Supabase MCP before writing the migration; `verification_requests` is a VIEW. (3) OQ4 GATE — decide UI exposure (marketing count / public VerificationForm) explicitly; do NOT let it auto-derive from the widened `EXCHANGES`. (4) Test-DB `qmnijlgmdhviwzwfyzlc` lags prod — apply the migration there via MCP before any deribit-inserting e2e.
