# Phase 119: SFOX Read adapter + key validation + DB constraint-widen - Research

**Researched:** 2026-07-18
**Domain:** Non-ccxt exchange key-connect end-to-end (DB CHECK-constraint widen + lockstep allowlists + non-ccxt worker validate branch), on the deribit key-connect precedent
**Confidence:** HIGH (every lockstep site + the 4 constraint definitions + the parity-test mechanics verified against source 2026-07-18; the credential-shape gap is a genuine open decision, flagged)

## Summary

Phase 119 is a **precedent-cloning** phase: the deribit key-connect path (Phase 68 migration `20260704200446` + the Phase-68 lockstep) is an exact template, and the load-bearing risk is a **missed lockstep site → red parity test at CI**, or the **DB migration not MCP-applied to the TEST project before merge → red RED-guarded SQL tests**. The sFOX read adapter (`SfoxClient`) already exists and is code-complete from Phase 118. What 119 adds is: (a) one RED-guarded constraint-widening migration admitting `'sfox'` at the 4 boundary CHECKs, (b) the TS + pydantic allowlist edits that must land in the SAME change or two parity tests go red, (c) a **non-ccxt branch** in the worker's legacy `validate_key` path (which today calls `create_exchange` → ValueError on `sfox`), and (d) the read-only-scope assertion + honest AUTH_FAILED mapping.

Two findings materially shape the plan. **First — the credential shape mismatch (top open question):** sFOX authenticates with a **single Bearer token**, but the entire key-connect stack (the 3 TS routes, `encrypt_credentials`, `api_keys`) assumes an `(api_key, api_secret[, passphrase])` pair. The 2 gating routes reject `api_secret.length < 8`. This must be resolved (relax `api_secret` for sfox / store token as `api_key`) before a sFOX key can flow through — it is not covered by the deribit precedent (deribit is a real key+secret pair). **Second — the read-only assertion is structural, not probed:** sFOX exposes **no per-key scope endpoint** (unlike binance's `apiRestrictions` or deribit's `public/auth` scope string), so `validate_key` cannot verify "this key cannot trade/withdraw" the way it does for ccxt exchanges. Read-only rests on (i) the `SfoxClient`'s structural no-write surface and (ii) the founder minting a read-only key. The honest copy must not claim a scope we cannot observe.

**Primary recommendation:** Clone `20260704200446` for `'sfox'` (widen the SAME 4 constraints; SKIP funding_fees/position_snapshots; NEVER touch the verification_requests VIEW; do NOT touch `finalize_terminal_status_param.sql:188`). Add `'sfox'` to `SUPPORTED_EXCHANGES`, `EXCHANGE_DISPLAY`, `STRATEGY_SOURCES`, and the 3 pydantic Literals in lockstep, and bump the `_KEY_SAVE_EXCHANGES` fixture in the python boundary-parity test. Add an `is_sfox` branch in `routers/exchange.py::validate_key` that proves auth+read via `SfoxClient.get_balances()`, asserts `read_only=True` structurally, and maps `SfoxApiError` 401/403 to the exact `"Authentication failed. Check your API key and secret."` string so the TS `classifyKeyValidationError` returns `KEY_AUTH_FAILED`. MCP-apply the migration to the TEST project `qmnijlgmdhviwzwfyzlc` **before** merge.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **DB constraint-widen (SFOX-04) — follow the deribit precedent EXACTLY.** Template `20260704200446_deribit_exchange_boundary_checks.sql`. Widen the SAME 4 columns, add `'sfox'`: `api_keys.exchange`, `compute_jobs.exchange` (PRESERVE the nullable `exchange IS NULL OR` form), `strategies.source` (append to the 9-value set), `strategy_verifications.source`. Each with a self-verifying DO block that RAISEs if the new def is missing `sfox` OR any pre-existing value. Forward-only, no DOWN. `SET lock_timeout='3s'`.
- **SKIP** (parity-pinned exclusions, same as deribit): `funding_fees` exchange CHECK, `position_snapshots` exchange CHECK (both derivative/funding-specific — sFOX is SPOT), and the `verification_requests` VIEW + its frozen Phase-19 legacy table (DROP CONSTRAINT on a VIEW errors — NEVER touch).
- **LOCKSTEP** (or the parity contract test fails): add `sfox` to TS `SUPPORTED_EXCHANGES` (`src/lib/closed-sets.ts`) AND the pydantic Literals (`schemas.py`, `debug_key_flow.py`, `adapter.py`). The migration + allowlists must land together.
- **Worker validate/encrypt — the non-ccxt branch (SFOX-03).** `routers/exchange.py::validate_key` calls `create_exchange` (ccxt) → `validate_key_permissions`. Add a branch: when `exchange == 'sfox'`, use `SfoxClient` to validate (auth + read-only scope) instead of the ccxt path. Auth failure → the same `KEY_AUTH_FAILED` classification the TS side expects. Credentials trimmed at the SAME shared chokepoint (the v1.11 `.trim()` fix), not a parallel one.
- **Key routes (SFOX-03).** All 3 routes (`validate-and-encrypt`, `create-with-key`, `composite/add-key`) already share `classifyKeyValidationError`; sFOX flows through the SAME shared error mapping. Confirm each route's exchange allowlist admits `sfox`.
- **Read adapter pull (SFOX-02).** Use the Phase-118 `SfoxClient` (read-only, Bearer, proxy-seamed) to pull balances + trades + transactions. Actual daily-return reconstruction is phase 120 — here it's the read pull + read-only-scope assertion + honest failure.

### Claude's Discretion
- Exact migration filename timestamp (use the current UTC per the timestamp convention).
- Whether the non-ccxt validate branch lives inline in `validate_key` or a small helper.

### Deferred Ideas (OUT OF SCOPE)
- Equity reconstruction + `api_verified` stamp + ground-truth parity (phase 120).
- Static-IP egress wiring (phase 121) — `SfoxClient` already has the proxy seam; not wired here.
- Add-key wizard exchange picker + onboarding copy + badge + e2e (phase 122).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SFOX-02 | `SfoxClient` reads balances + trades + transactions of a real account, read-only ENFORCED | Adapter is code-complete (Phase 118, 4 read methods, structural read-only). 119 hooks the read pull into the validate branch (`get_balances()` as the auth+read proof) + asserts read-only structurally. Full ingestion adapter / crawl is phase 120. Live prod read gates on phase 121 egress → founder-gated like the 118 smoke test. |
| SFOX-03 | `sfox` accepted through all 3 key routes AND the worker `validate_key`/`encrypt_key` path (non-ccxt branch), fails CLOSED with honest KEY_AUTH_FAILED copy | Route gating is `isSupportedExchange` (2 routes) + delegate (1 route); worker branch spec below; `classifyKeyValidationError` already maps `"authentication failed"`→`KEY_AUTH_FAILED`. **Blocker: single-Bearer-token vs (api_key, api_secret) — see Open Questions Q1.** |
| SFOX-04 | ONE RED-guarded constraint-widening migration admits `'sfox'` at every `exchange IN (...)` CHECK, MCP-applied to TEST first, then merges → auto-applies to prod | The 4 constraints + their EXACT current definitions + the 2 parity tests that force them + the SKIP set + the terminal-status resolution are all pinned below. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DB exchange-value admission | Postgres CHECK constraints (1 migration) | TS/pydantic allowlists | Last line of defense; widened in lockstep with the code allowlists |
| Exchange-vocab lockstep | TS SoT (`closed-sets.ts`, `strategy-sources.ts`) + pydantic Literals | 2 parity tests (vitest) + 1 parity test (pytest) | Hand-typed in 2 languages; parity tests are the anti-drift teeth |
| Route-level exchange gating | Next.js routes (`isSupportedExchange`) | — | 2 routes gate on `SUPPORTED_EXCHANGES`; the 3rd delegates to the worker |
| Key auth + read-only assertion | Python worker `validate_key` (new is_sfox branch) → `SfoxClient` | — | sFOX is non-ccxt; must NOT route through `create_exchange`/`EXCHANGE_CLASSES` |
| Honest failure copy | Next.js (`wizardErrors.ts` `classifyKeyValidationError`) | Python detail strings | Already maps `"authentication failed"`→`KEY_AUTH_FAILED`; reuse the exact string |
| Credential encryption | Python `encrypt_credentials` (exchange-agnostic) | — | No branch needed; tolerates an empty secret (JSON-serializes as-is) |

## Standard Stack

No new packages. This phase edits existing TS/Python source + one SQL migration. `SfoxClient` (Phase 118) and `aiohttp` are already vendored. The migration is plain Postgres DDL.

**Version verification:** N/A — no external dependency added.

## Package Legitimacy Audit

No external packages installed by this phase. slopcheck not applicable.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | No new install |

## LOCKSTEP INVENTORY (load-bearing — a miss = red parity test)

**Headline: 13 lockstep sites.** 8 MANDATORY (forced by a currently-passing parity test, a compile check, or route gating) + 4 PRECEDENT-LOCKSTEP (the pydantic verify/ingestion boundary + its pytest fixture — widen to match deribit EXACTLY per CONTEXT) + the 1 worker validate branch. Plus a CONDITIONAL route credential carve-out (see Q1). All verified against source 2026-07-18.

### MANDATORY — forced by a red test / compile / route gating

| # | Site (file:line) | Current value | Add | Forced by |
|---|------------------|---------------|-----|-----------|
| 1 | `src/lib/closed-sets.ts:39` `SUPPORTED_EXCHANGES` | `["binance","okx","bybit","deribit"]` | `"sfox"` | The 2 gating routes call `isSupportedExchange` (reads this); also the B9 parity SPECs for api_keys.exchange / compute_jobs.exchange / strategy_verifications.source key off `SUPPORTED_EXCHANGES` |
| 2 | `src/lib/closed-sets.ts:48` `EXCHANGE_DISPLAY` | 4 entries `satisfies Record<SupportedExchange,string>` | `sfox: "sFOX"` | **COMPILE error** the moment #1 gains sfox (exhaustive Record) |
| 3 | `src/lib/strategy-sources.ts:17` `STRATEGY_SOURCES` | `[legacy,wizard,admin_import,allocator_connected,csv,okx,binance,bybit,deribit]` | `"sfox"` | `strategy-sources-migration-parity.test.ts` set-equality vs the `strategies_source_check` SQL CHECK (key-created strategies stamp `source='sfox'`) |
| 4 | **NEW migration** `strategies_source_check` constraint | `IN (legacy,wizard,admin_import,allocator_connected,csv,okx,binance,bybit,deribit)` (9→10) | `'sfox'` | Same parity test as #3 (SQL side) |
| 5 | **NEW migration** `api_keys_exchange_check` | `CHECK (exchange IN ('binance','okx','bybit','deribit'))` | `'sfox'` | B9 `check-zod-db-check-parity.test.ts` SPEC `api_keys.exchange` ts=SUPPORTED_EXCHANGES (SQL side) |
| 6 | **NEW migration** `compute_jobs_exchange_check` | `CHECK (exchange IS NULL OR exchange IN ('binance','okx','bybit','deribit'))` — **preserve nullable form** | `'sfox'` | B9 SPEC `compute_jobs.exchange` ts=SUPPORTED_EXCHANGES |
| 7 | **NEW migration** `strategy_verifications_source_check` | `CHECK (source IN ('okx','binance','bybit','csv','deribit'))` | `'sfox'` | B9 SPEC `strategy_verifications.source` ts=`[...SUPPORTED_EXCHANGES,"csv"]` |
| 8 | `analytics-service/routers/exchange.py::validate_key` (:41) | ccxt-only (`create_exchange`→ValueError on sfox) | `is_sfox` branch | SFOX-03 (functional — without it every sfox key 400s "Unsupported exchange") |

**Note on #5–#7:** [VERIFIED 2026-07-18] no migration re-bases these 4 constraints after `20260704200446` (`grep -rln` returns only `wizard_source_column`, `strategies_source_csv`, and `20260704200446`). So the EXACT current definitions to widen are the 4-value/9-value sets in `20260704200446` — copy them verbatim, append `'sfox'`.

### PRECEDENT-LOCKSTEP — widen to match deribit EXACTLY (CONTEXT mandate)

| # | Site (file:line) | Current | Add | Enforcement |
|---|------------------|---------|-----|-------------|
| 9 | `analytics-service/models/schemas.py:206` `VerifyStrategyRequest.exchange` | `Literal["binance","okx","bybit","deribit"]` | `"sfox"` | `test_boundary_literals_parity.py` **SET-EQUALITY** vs `_KEY_SAVE_EXCHANGES` — adding sfox here **requires** bumping the fixture (#12) |
| 10 | `analytics-service/routers/debug_key_flow.py:61` `Broker` | `Literal["okx","binance","bybit","deribit"]` | `"sfox"` | membership pin (deribit-only assertion today; adding sfox is safe, add a sfox assertion for coverage) |
| 11 | `analytics-service/services/ingestion/adapter.py:31` `Source` | `Literal["okx","binance","bybit","csv","deribit"]` | `"sfox"` | membership pin; **caveat:** `ingestion/__init__.py:98 SUPPORTED_SOURCES` + the `_FACTORIES` registry (`get_adapter`) do NOT get sfox in 119 — that's the phase-120 reconstruction adapter. Since 119 never calls `get_adapter("sfox")` (validate uses the LEGACY `exchange.py` path, not `/process-key`), the Source-Literal-without-registry state is safe. |
| 12 | `analytics-service/tests/.../test_boundary_literals_parity.py:51` `_KEY_SAVE_EXCHANGES = {"binance","okx","bybit","deribit"}` | 4-set | `"sfox"` (fixture update) + add sfox membership assertions + (recommended) a `test_each_widened_constraint_admits_sfox` reading the NEW migration file | This is the **"needs a fixture update, not just adding sfox to both sides"** nuance CONTEXT warned about. The `VerifyStrategyRequest` assertion is set-equality; it fails if #9 changes without #12. |

**Why widen #9–#12 in 119 even though the verify/ingestion write paths land in 120:** CONTEXT locks "follow the deribit precedent EXACTLY," and the deribit migration widened all 3 pydantic Literals in the same phase as the SQL. Keeping the python key-save boundary symmetric is low-cost and prevents a future 120 dev from tripping the set-equality test. The planner MAY defer #9–#12 to 120 if it prefers a tighter 119 scope — **but must then confirm no currently-green test goes red** (it won't: the python parity test only pins deribit today). Recommendation: widen in 119 per CONTEXT.

### DO NOT TOUCH (skip — parity-pinned or out of scope)

| Site | Why NOT |
|------|---------|
| `funding_fees_exchange_check` (SQL) + `FUNDING_EXCHANGES` (closed-sets.ts:82) | sFOX is spot — no perp funding. B9 SPEC pins `funding_fees.exchange` = `FUNDING_EXCHANGES` (3-value) — leaving both untouched keeps it green. Adding sfox to EITHER would need the other + a dedup axis. |
| `position_snapshots_exchange_check` (SQL) | sFOX has no derivative positions. B9 SPEC pins it = `["binance","okx","bybit"]` + `rejects:["deribit"]` (3-value literal). Leave untouched. |
| `verification_requests` VIEW + frozen Phase-19 legacy table | `DROP CONSTRAINT` on a VIEW errors. The deribit migration explicitly warns: never touch either. |
| `finalize_terminal_status_param.sql:188` `IF v_exchange IN ('bybit','okx','binance')` | **RESOLVED — do NOT add sfox in 119** (evidence below). |
| `UI_EXCHANGE_CODES` / `EXCHANGES` (closed-sets.ts:65,100) + `ConnectKeyStep.tsx:62` / `MultiKeyConnectStep.tsx:92` exchange cards | The wizard-OFFERED set. Deribit flipped these in **phase 69** (after the wizard card shipped), NOT phase 68. sFOX's equivalent is **phase 122**. Leave 3+deribit here. |
| `ingestion SUPPORTED_SOURCES` (:98) + `_FACTORIES` registry | The reconstruction ingestion adapter = **phase 120**. |

## RESOLVED OPEN ITEM: terminal-status allowlist at `finalize_terminal_status_param.sql:188`

**Verdict: NO — do NOT add `'sfox'` in phase 119.** [VERIFIED 2026-07-18, resolves 118-RESEARCH A2]

Evidence:
1. **Deribit itself is NOT in this allowlist** — `IF v_exchange IN ('bybit', 'okx', 'binance')` at line 188 of the LATEST finalize function (`20260716130500`, which supersedes `20260521185008:141`). Deribit shipped a full key-connect + verify path (phases 68–72) **without** being added here. So this branch is **not** part of the constraint-widen lockstep — it is a separate behavioral gate that decides whether wizard-finalize inserts an `api_verified` `strategy_verifications` row.
2. **The `api_verified` verification-row stamp is explicitly deferred to phase 120** (CONTEXT Deferred: "Equity reconstruction + `api_verified` stamp (120)"). Widening this branch in 119 would insert `api_verified` rows for sFOX **before** the phase-120 reconstruction/ground-truth parity that justifies the `api_verified` claim — premature and contra the P115 "oracle must be earned" discipline.
3. Widening the `strategy_verifications.source` **CHECK** (constraint #7) to *admit* `'sfox'` while leaving this finalize **branch** to never *insert* a sfox row is exactly the deribit posture — asymmetric but both parity tests stay green (nothing writes sfox to the table until 120).

**Action:** Widen the column CHECK (#7); leave `finalize_terminal_status_param.sql:188` alone. When phase 120 designs sFOX's `api_verified` provenance-write, it decides whether/how this branch gains `'sfox'` (and likely revisits deribit's absence too).

## DB constraint-widen (SFOX-04) — exact current definitions to copy

From `20260704200446` (the newest def of all 4 — no re-base after):

```sql
-- 1. api_keys.exchange (auto-named api_keys_exchange_check)
CHECK (exchange IN ('binance', 'okx', 'bybit', 'deribit'))            -- add 'sfox'
-- 2. compute_jobs.exchange (auto-named; PRESERVE nullable form)
CHECK (exchange IS NULL OR exchange IN ('binance', 'okx', 'bybit', 'deribit'))  -- add 'sfox'
-- 3. strategies.source (NAMED strategies_source_check; 9→10 values)
CHECK (source IN ('legacy','wizard','admin_import','allocator_connected','csv','okx','binance','bybit','deribit'))  -- add 'sfox'
-- 4. strategy_verifications.source (auto-named)
CHECK (source IN ('okx', 'binance', 'bybit', 'csv', 'deribit'))       -- add 'sfox'
```

Each gets the DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT → self-verifying `DO $$ ... FOREACH expected_value IN ARRAY ARRAY[...,'sfox'] LOOP ... RAISE EXCEPTION IF missing` block (clone the 4 DO blocks verbatim, append `'sfox'` to each expected-values array; keep the `compute_jobs` `position('IS NULL' IN def)=0` nullable-form guard). `BEGIN; SET lock_timeout='3s'; ...; COMMIT;` Forward-only. Refresh the `strategy_verifications.source` COMMENT to add sfox to the vocabulary line.

**Timestamp convention** [VERIFIED]: `YYYYMMDDHHMMSS_name.sql` (newest is `20260717233529_allocator_equity_derived_surface.sql`; current UTC at research time `20260718175402`). Name it e.g. `20260718HHMMSS_sfox_exchange_boundary_checks.sql` using the execution-time UTC.

## Worker validate branch (SFOX-03) — the non-ccxt path

**Where:** `analytics-service/routers/exchange.py::validate_key` (:41). `ValidateKeyRequest.exchange` is a plain `str` (schemas.py:10, NOT a Literal) and `EncryptKeyRequest.exchange` is a plain `str` (exchange.py:19) — so **no pydantic schema change is needed for the legacy validate/encrypt path**; the branch just intercepts before `create_exchange`.

**Shape of the branch** (inline or small helper — Claude's discretion):
```
if req.exchange == "sfox":
    client = SfoxClient(api_key=<bearer>, base_url=SFOX_PROD_BASE_URL, proxy=None)
    try:
        await client.get_balances()      # auth + read proof (returns a list even if empty)
        return {"valid": True, "read_only": True}   # read-only asserted STRUCTURALLY
    except SfoxApiError as e:
        if e.status in (401, 403):
            raise HTTPException(400, "Authentication failed. Check your API key and secret.")
        # transport/shape (status==0) or other → generic 400/500 per existing pattern
    finally:
        await client.aclose()
# else: existing ccxt path (create_exchange → validate_key_permissions)
```

**Read-only assertion is STRUCTURAL, not probed** (important honest finding): sFOX exposes **no per-key scope endpoint** (contrast: binance `apiRestrictions`, okx `account/config` perm string, bybit `query-api readOnly`, deribit `public/auth` scope string — all in `key_permissions.py`). There is no sFOX analogue of `detect_permissions`. Read-only rests on (1) `SfoxClient`'s structural no-write surface (HTTP verb hardcoded to GET, only 4 read methods — 118 WR-03) and (2) the founder minting a read-only key ("your permissions as a user define your API key permissions", 118 docs). So the branch returns `read_only=True` on a successful `get_balances()` — it does NOT and CANNOT return a `{read, trade, withdraw}` triple. **The honest copy must not assert a scope we didn't observe** (mirrors the KEY_NOT_READ_ONLY / DOGFOOD-3 discipline). Flag to founder as A1.

**Honest-failure mapping (verified against `classifyKeyValidationError`):** the TS classifier (`wizardErrors.ts:844`) matches `lower.includes("authentication failed") || lower.includes("invalid_credentials")` → `{code:"KEY_AUTH_FAILED", status:400}`. The existing ccxt AUTH_FAILED arm emits the exact string `"Authentication failed. Check your API key and secret."` (`exchange.py:1012`). **Reuse that exact string** in the sfox 401/403 branch and the TS mapping is automatic — no `wizardErrors.ts` edit needed. `SfoxApiError.status` already carries 401/403 vs 0 (shape/transport) semantics (118).

**Credentials `.trim()` chokepoint:** the v1.11 dogfood fix trims `api_key`/`api_secret` at the validate/encrypt chokepoint. Confirm the sfox Bearer token goes through the SAME trim, not a parallel one (grep the `.trim()` sites in the 3 routes / analytics-client and route sfox through them).

**`encrypt_key` needs NO branch** [VERIFIED]: `encrypt_credentials` (encryption.py:57) just JSON-serializes `{api_key, api_secret, ...}` — it is exchange-agnostic and tolerates an empty `api_secret`. Only `validate_key` needs the branch.

## The 3 key routes (SFOX-03) — how each gates exchange

[VERIFIED 2026-07-18]

| Route | Exchange gate | Calls | 119 action |
|-------|---------------|-------|-----------|
| `src/app/api/keys/validate-and-encrypt/route.ts` | **NONE** — no `isSupportedExchange`; delegates straight to `validateKey(exchange,…)` → worker `/api/validate-key` | `validateKey` + `encryptKey` (legacy path, flag-locked) | Adding sfox to the worker branch (#8) suffices; **but** rejects `!api_secret` at :24 → see Q1 |
| `src/app/api/strategies/create-with-key/route.ts:47` | `if (!isSupportedExchange(exchange)) → 400 KEY_INVALID_FORMAT` | `validateKey`→`/api/validate-key`; RPC stamps `source=exchange` | `SUPPORTED_EXCHANGES += sfox` (#1) admits it; **but** rejects `api_secret.length < 8` at :60 → Q1 |
| `src/app/api/strategies/composite/add-key/route.ts:67` | same `isSupportedExchange` gate | same | same as create-with-key + Q1 |

**All 3 call the LEGACY worker `/api/validate-key`** (not the unified `/process-key`) → the worker `is_sfox` branch (#8) is the single validation surface. No per-route validation logic beyond the `isSupportedExchange` gate. The `okx`-passphrase branch (:69/:89) does not affect sfox (no passphrase). **Adding sfox to `SUPPORTED_EXCHANGES` is necessary and sufficient for the 2 gating routes' allowlist** — the remaining blocker is the credential shape (Q1), not the exchange allowlist.

## Read pull (SFOX-02) — where it hooks in

- **Today's ccxt read path (post-validation):** the legacy `/api/fetch-trades` (`exchange.py:88`) → `create_exchange` + `fetch_all_trades`/`fetch_usdt_balance`; the unified path uses `get_adapter(source).fetch_raw`. Neither is the sFOX seam in 119.
- **119's read pull = the validate-time `get_balances()`** in the `is_sfox` branch (the auth+read proof above). That exercises the adapter against a real account and asserts read-only, which is the SFOX-02 minimum for this phase.
- **The full read-pull → dailies reconstruction (balances + trades + transactions + balance/history → daily series) + the `IngestionAdapter`/`get_adapter("sfox")` registration is phase 120.** Do NOT build it here (CONTEXT: "here it's just the read pull + read-only-scope assertion + honest failure").
- **Live prod read caveat:** a real whitelisted-key read gates on phase-121 static-IP egress (an IP-pinned sFOX key 401s from the wrong egress). So a live prod `get_balances()` against the founder's real key may be **founder-gated** (human_needed), exactly like the Phase-118 sandbox smoke test. The committed unit test + the branch carry the phase until then; code must never fake a green.

## Architecture Patterns

### Data flow — a sFOX key connect
```
  wizard/allocator  ──POST──▶ one of 3 key routes
                                 │  create-with-key / composite: isSupportedExchange(sfox)? ── needs #1
                                 │  validate-and-encrypt: no gate, delegates
                                 ▼
                        validateKey(sfox,…) ──▶ worker /api/validate-key
                                                    │  is_sfox? ── needs #8
                                                    ▼
                                    SfoxClient.get_balances()  (auth + read proof)
                                       success ─▶ {valid:true, read_only:true}   (read-only STRUCTURAL)
                                       401/403 ─▶ "Authentication failed…" ─▶ classifyKeyValidationError ─▶ KEY_AUTH_FAILED
                                 ▼
                        encryptKey(sfox,…) ─▶ encrypt_credentials (agnostic) ─▶ api_keys INSERT
                                                    │  DB CHECK: exchange IN (…,'sfox') ── needs #5
                                                    ▼
                        strategy INSERT source='sfox' ── DB CHECK needs #4
```

### Anti-Patterns to Avoid
- **Routing sfox through `create_exchange`/`EXCHANGE_CLASSES`** — the dict is ccxt-typed; `create_exchange` returns `ccxt.Exchange`; sfox ValueErrors. Branch BEFORE it.
- **Returning a `{read,trade,withdraw}` triple for sfox** — there is no scope endpoint; asserting an unobserved trade/withdraw scope is dishonest. Return `read_only=True` structurally.
- **Touching the verification_requests VIEW / funding_fees / position_snapshots / finalize:188** — all pinned skips; each would red a test or error the migration.
- **Adding sfox to only one side of a parity pair** — B9 test flags `onlyInTs` as the dangerous direction; the python set-equality test needs the `_KEY_SAVE_EXCHANGES` fixture bump too.
- **Merging the migration before MCP-applying to the TEST project** — RED-guarded SQL tests on `qmnijlgmdhviwzwfyzlc` go red; prod auto-applies on merge.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Honest key-failure copy | A new `KEY_*` code for sfox | Reuse the exact `"Authentication failed. Check your API key and secret."` string → existing `KEY_AUTH_FAILED` | The classifier already matches it; a new code needs new copy + PostHog event churn |
| Constraint-widen migration | A fresh migration shape | Clone `20260704200446` verbatim (DROP+ADD+DO-block ×4) | The self-verify DO blocks are the anti-silent-no-op guard; re-inventing risks losing the nullable-form guard |
| Exchange-vocab source of truth | A sfox-specific const | Extend the existing `SUPPORTED_EXCHANGES`/`STRATEGY_SOURCES`/Literals | Parity tests already pin these; a parallel const drifts |
| Credential encryption | A sfox path | `encrypt_credentials` unchanged | Exchange-agnostic; tolerates empty secret |

## Runtime State Inventory

119 introduces one new runtime value into the DB value-space (`'sfox'`) via the migration — this is the phase's deliverable, not a migration of existing rows. Widening a CHECK only ADDS an admitted value, so **no row can violate → no data backfill / pre-flight scan** (same as deribit). Categories:

| Category | Items | Action |
|----------|-------|--------|
| Stored data | None to migrate — no existing row carries `'sfox'` yet | None (forward-only CHECK widen) |
| Live service config | The migration auto-applies to PROD on merge (`supabase/migrations/**`); founder-watched | Verify objects post-apply via Supabase MCP |
| OS-registered state | None | None |
| Secrets/env vars | sFOX Bearer token (per-user, entered at connect) — encrypted into `api_keys` like every key; no new env var in 119 (sandbox `SFOX_SANDBOX_KEY` is 118; prod egress is 121) | None |
| Build artifacts | None | None |
| **TEST-project drift** | The migration MUST be MCP-applied to `qmnijlgmdhviwzwfyzlc` BEFORE merge (else RED-guarded SQL tests fail) | **PLAN GATE — see below** |

## Common Pitfalls

### Pitfall 1: Single Bearer token vs (api_key, api_secret) — the real blocker
**What goes wrong:** a sFOX key can't be connected because the routes require `api_secret` (>= 8 chars) but sFOX has only ONE token.
**Why:** deribit (the precedent) is a genuine key+secret pair, so this never surfaced before.
**How to avoid:** resolve Q1 (relax `api_secret` for sfox / store token as `api_key`, empty secret) BEFORE plan tasks touch the routes. `encrypt_credentials` tolerates an empty secret; the blocker is purely the 3 TS route-level length checks.

### Pitfall 2: The python parity test needs a fixture bump, not just a two-sided add
**What goes wrong:** you add sfox to `VerifyStrategyRequest.exchange` and the migration but `test_boundary_literals_parity.py` still asserts `== {"binance","okx","bybit","deribit"}` → red.
**Avoid:** bump `_KEY_SAVE_EXCHANGES` (:51) in the same change and add sfox membership assertions (+ recommended: a sfox migration-parity assertion reading the NEW file).

### Pitfall 3: Migration merged before TEST-project MCP-apply
**Avoid:** MCP `apply_migration` to `qmnijlgmdhviwzwfyzlc` first (fix the `schema_migrations` timestamp row if MCP stamps `now()`), THEN merge → prod auto-apply → verify objects.

### Pitfall 4: Asserting an unobserved read-only scope for sfox
**Avoid:** sfox has no scope endpoint; return `read_only=True` structurally, keep the copy honest.

## State of the Art

| Old (deribit precedent) | sFOX difference | Impact |
|-------------------------|-----------------|--------|
| Key + secret pair | Single Bearer token | Route `api_secret` requirement must be resolved (Q1) |
| ccxt scope probe (`public/auth` scope string) | No per-key scope endpoint | Read-only is structural, not probed (A1) |
| ccxt `create_exchange` path | Non-ccxt `SfoxClient` branch | `validate_key` needs `is_sfox` before `create_exchange` |

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | sFOX read-only can be asserted structurally (no-write adapter + read-only-minted key) since there is no per-key scope endpoint; `read_only=True` on a successful `get_balances()` | Worker branch | If sFOX later exposes a scope/permissions endpoint, a stronger probe should be added; until then a trade-enabled key would pass validate (mitigated by structural no-write adapter + founder minting read-only). Founder must confirm acceptance. |
| A2 | The single Bearer token maps onto the stack by storing it as `api_key` with an empty/relaxed `api_secret` | Q1 / routes | If sFOX actually issues a key+secret pair, or the founder wants both fields, the route carve-out differs. **Founder decision required.** |
| A3 | Widening the 3 pydantic Literals (#9–#11) + fixture (#12) belongs in 119 (per "follow deribit EXACTLY") | Lockstep | If the planner defers to 120, no green test breaks today — but the boundary stays asymmetric. Low risk either way. |
| A4 | Live prod sFOX read is founder-gated (needs phase-121 egress + a whitelisted key) | Read pull | If the founder has an un-IP-pinned prod key, a live read could run in 119; otherwise human_needed, like the 118 smoke test. |

## Open Questions

1. **[Q1 — BLOCKER] How does the single sFOX Bearer token flow through the `(api_key, api_secret)` contract?**
   - Known: sFOX auth = `Authorization: Bearer <token>` (one credential). `SfoxClient(api_key=…)` takes one. `encrypt_credentials` tolerates an empty secret. The 3 routes reject empty/short `api_secret` (`validate-and-encrypt:24 !api_secret`; `create-with-key:60` / `composite/add-key` `api_secret.length < 8`).
   - Unclear: store the token as `api_key` (relax `api_secret` for sfox), or require the founder to paste it in both fields?
   - Recommendation: add a sfox carve-out in the 3 routes making `api_secret` optional for `exchange==='sfox'`, store the token as `api_key`, pass empty secret to `encryptKey`/`validate_key`. **Confirm with founder** (tag ASSUMED until then). This is the single thing that blocks a sFOX key from connecting end-to-end.
2. **[Q2] Does the read-only structural assertion (A1) satisfy the founder's `api_verified` bar?**
   - Recommendation: acceptable for 119 (connect + read); the `api_verified` provenance itself is phase-120's decision. Surface A1 in discuss/verify.
3. **[Q3] Is a live prod `get_balances()` runnable in 119, or founder-gated on phase-121 egress?**
   - Recommendation: assume founder-gated (A4); ship the committed unit test + branch, close SFOX-02's live leg human_needed if no un-pinned prod key exists.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Supabase MCP (TEST project `qmnijlgmdhviwzwfyzlc`) | SFOX-04 apply-before-merge gate | ✓ (MCP tools present) | — | none — hard gate |
| `SfoxClient` + `aiohttp` | worker branch / read pull | ✓ | Phase 118, vendored | — |
| sFOX **prod** whitelisted key + phase-121 egress | live prod read (SFOX-02 live leg) | ✗ (121 not shipped) | — | founder-gated / committed test carries it (A4) |
| `pytest` (analytics-service) / `vitest` (frontend) | validation | ✓ | existing | — |

**Missing with fallback:** live prod read → founder-gated (committed unit test carries the phase).
**Missing, blocking:** none — the credential-shape (Q1) is a decision, not a missing tool.

## Validation Architecture

**nyquist_validation:** enabled (`.planning/config.json workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service) + vitest (frontend) + supabase/tests/*.sql (DB gates) |
| Config | existing pytest config; `vitest.config.ts` (coverage-gated); supabase test project `qmnijlgmdhviwzwfyzlc` |
| Quick run | `pytest analytics-service/tests/test_exchange_validate_sfox.py -x` ; `npx vitest run src/__tests__/contracts/check-zod-db-check-parity.test.ts src/__tests__/strategy-sources-migration-parity.test.ts` |
| Full suite | `pytest --cov-fail-under=80` ; `vitest run --coverage` (CI shards) |

### Phase Requirements → Test Map
| Req | Behavior | Test type | Command | Exists? |
|-----|----------|-----------|---------|---------|
| SFOX-04 | 4 CHECKs admit `'sfox'`, self-verify at apply | migration DO-blocks (RAISE if missing) + apply-time | (runs on `apply_migration`) | ❌ Wave 0 (new migration) |
| SFOX-04 | TS↔SQL parity green | vitest | `check-zod-db-check-parity.test.ts` (api_keys/compute_jobs/strategy_verifications) + `strategy-sources-migration-parity.test.ts` (strategies.source) | ✅ exist — must stay green after edits |
| SFOX-04 | python boundary literals ↔ migration | pytest | `test_boundary_literals_parity.py` (**update `_KEY_SAVE_EXCHANGES` + add sfox assertions**) | ✅ exists — needs fixture bump |
| SFOX-04 | (recommended) RED SQL guard admits sfox / rejects a bad value | `supabase/tests/test_*.sql` | supabase test run | ❌ Wave 0 (optional new) |
| SFOX-03 | `is_sfox` validate branch: `get_balances` success → `{valid,read_only:true}`; `SfoxApiError(401)` → AUTH_FAILED string | pytest unit (mock `SfoxClient`) | `pytest analytics-service/tests/test_exchange_validate_sfox.py -x` | ❌ Wave 0 |
| SFOX-03 | 2 gating routes admit sfox; classifier maps AUTH_FAILED | vitest route/unit | existing `classifyKeyValidationError` tests + route tests | partial — add sfox cases |
| SFOX-03 | credential-shape carve-out (Q1) accepts a token-only sfox request | vitest route | new route test | ❌ Wave 0 (after Q1) |
| SFOX-02 | validate-time `get_balances()` read proof (offline mock) | pytest (covered by the branch test) | as SFOX-03 branch test | ❌ Wave 0 |
| SFOX-02 | live prod read | live, founder-gated | manual w/ whitelisted key (post-121) | founder-gated (A4) |

### Sampling Rate
- **Per task commit:** the touched parity test(s) + the new sfox branch unit test.
- **Per wave merge:** full analytics-service pytest + the vitest contract shard.
- **Phase gate:** both parity tests green + branch unit green + **migration MCP-applied to TEST project** before merge; full suite green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `supabase/migrations/20260718*_sfox_exchange_boundary_checks.sql` — the 4-constraint widen (SFOX-04)
- [ ] `analytics-service/tests/test_exchange_validate_sfox.py` — the is_sfox branch unit test (SFOX-03/02)
- [ ] `analytics-service/tests/.../test_boundary_literals_parity.py` — `_KEY_SAVE_EXCHANGES` bump + sfox assertions (+ recommended sfox migration-parity assertion)
- [ ] frontend route tests for the Q1 credential carve-out + sfox `isSupportedExchange` admission
- [ ] (recommended) `supabase/tests/test_sfox_exchange_boundary.sql` RED-guard

### PLAN GATE (carry-forward, load-bearing)
**MCP-apply the migration to the TEST project `qmnijlgmdhviwzwfyzlc` BEFORE merge**, then merge `supabase/migrations/**` → auto-applies to PROD (founder-watched — verify objects via Supabase MCP; if MCP stamps `now()` in `schema_migrations`, fix the row to the file timestamp).

## Security Domain

**security_enforcement:** enabled (no `security_enforcement` key in config → default enabled).

### Applicable ASVS Categories
| ASVS | Applies | Control |
|------|---------|---------|
| V2 Authentication | yes | Bearer token, stored via existing `encrypt_credentials` envelope encryption; validate proves auth via `get_balances()` |
| V4 Access Control | yes | Read-only asserted structurally (no-write `SfoxClient`); NO order/withdraw ever called; fail-CLOSED on any non-2xx |
| V5 Input Validation | yes | Route allowlist (`isSupportedExchange`) + DB CHECK last line of defense; fail-loud on degenerate sFOX payloads (118 `SfoxApiError`) |
| V6 Cryptography | no (reuse) | Reuse `encrypt_credentials`; never hand-roll |
| V7 Logging | yes | Bearer token scrubbed in `SfoxApiError` (118 T-118-01); never log the Authorization header |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| Bearer token leak in error/log | Info disclosure | 118 scrub-by-value + `scrub_freeform_string`; reuse the AUTH_FAILED string (no raw echo) |
| Trade-enabled sFOX key passes validate (no scope probe) | Elevation/Tampering | Structural no-write adapter + founder mints read-only key; **A1 accepted risk, founder-confirmed** |
| `'sfox'` admitted at DB but a stale allowlist rejects (or vice-versa) | Tampering/DoS | The 2 vitest + 1 pytest parity tests + the migration DO-blocks pin both sides |
| Migration merged before TEST apply → red gates / prod drift | DoS | The MCP-apply-before-merge PLAN GATE |

## Sources

### Primary (HIGH)
- Codebase, verified 2026-07-18: `20260704200446` (4 constraint defs), `finalize_terminal_status_param.sql:188`, `check-zod-db-check-parity.test.ts` (SPECs), `strategy-sources-migration-parity.test.ts`, `test_boundary_literals_parity.py` (`_KEY_SAVE_EXCHANGES` set-equality on `VerifyStrategyRequest.exchange`), `closed-sets.ts` (SUPPORTED_EXCHANGES/EXCHANGE_DISPLAY/FUNDING_EXCHANGES/UI_EXCHANGE_CODES), `strategy-sources.ts`, `exchange.py` (EXCHANGE_CLASSES:784 / create_exchange:792 / validate_key_permissions:895 / AUTH_FAILED:1012), `routers/exchange.py` (validate_key:27 / encrypt_key:75), `key_permissions.py` (per-exchange probes; no sfox analogue), `wizardErrors.ts` (classifyKeyValidationError → KEY_AUTH_FAILED), the 3 key routes (isSupportedExchange gating + api_secret checks), `schemas.py` (ValidateKeyRequest.exchange=str, VerifyStrategyRequest.exchange:206 Literal), `encryption.py` (encrypt_credentials tolerates empty secret), migration filename convention, `.planning/config.json` (nyquist_validation:true).
- 118-RESEARCH.md (SfoxClient contract, DB constraint inventory, SfoxApiError 401/403 semantics), STATE.md (TEST-project MCP-apply carry-forward, 118 landed).

### Secondary (MEDIUM)
- 118 docs cites (sFOX auth = single Bearer token; permissions mirror the user role — basis for A1/A2).

## Metadata
**Confidence breakdown:**
- Lockstep inventory + DB constraints: HIGH — every site + parity mechanic read from source.
- Terminal-status resolution: HIGH — deribit's own absence from :188 is direct evidence.
- Worker branch shape: HIGH — modeled on the verified deribit branch + verified classifier string.
- Credential shape (Q1) / read-only structural (A1): the FACTS are HIGH; the RESOLUTION is a founder decision (flagged ASSUMED).

**Research date:** 2026-07-18
**Valid until:** ~2026-08-01 (re-verify the migration corpus if new `*_exchange_check`/`*_source_check` migrations land before planning).
