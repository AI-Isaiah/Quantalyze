# Phase 135: MT5SRC — Source lockstep + read-only validate/encrypt + key routes + constraint migration - Research

**Researched:** 2026-07-23
**Domain:** Cross-layer "source" registration seam (Python worker registry + FastAPI validate/encrypt branch, Next.js key routes, Postgres CHECK-constraint migration) — a verbatim sFOX/Deribit-seam clone
**Confidence:** HIGH — every site below is cited to shipped code; this is a mechanical clone, not a discovery task.

## Summary

`mt5` must become a first-class `Source`/exchange value at every key chokepoint. This is three
layers of lockstep editing, all with a live shipped precedent (`sfox`, Phase 119/120; `deribit`,
Phase 68/70): (1) the Python ingestion registry + boundary Literals + a fail-loud `Mt5Adapter`;
(2) an `is_mt5` read-only branch in the FastAPI `/validate-key` router mirroring `_validate_sfox_key`;
(3) the three Next.js key routes (via the single TS `SUPPORTED_EXCHANGES` source of truth) plus a
RED-guarded constraint-widening migration cloning `20260718182056_sfox_exchange_boundary_checks.sql`.

The read side stubs against the Phase-134 `Mt5Client` contract (`services/mt5_client.py`), which
already exposes `login` / `account_info` / `order_check` / `close` and a typed `Mt5ClientError`.
The one genuinely MT5-specific wrinkle is credential-slot reuse (login → `api_key`, investor
password → `api_secret`, broker server → `passphrase`) and the investor-vs-master rejection, which
has NO sfox analog and carries an `[ASSUMED]` retcode rule.

**Primary recommendation:** Clone the sFOX seam verbatim across the enumerated sites below. The
single highest-leverage TS edit is `src/lib/closed-sets.ts:39` `SUPPORTED_EXCHANGES` (+ the paired
`EXCHANGE_DISPLAY` entry, or TS won't compile). The migration widens EXACTLY FOUR constraints — the
ROADMAP/CONTEXT "≥5" count is inaccurate; see the Corrections section.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **AGENTS.md:** "This is NOT the Next.js you know." The three route files were READ directly
  (see Q3). They are existing App Router `route.ts` handlers wrapped in an auth HOF; Phase 135
  introduces NO new route/handler API surface — edits are pure enum-membership + branch logic, so
  no Next.js API-shape assumptions are made.
- **CLAUDE.md Rule 3 (surgical):** touch only the enumerated sites; do not "improve" adjacent code.
- **CLAUDE.md Rule 11 (conform):** match the sfox/deribit precedent byte-for-byte (lockstep
  comments, self-verify DO blocks, shared error-detail constants).
- **Test coverage gate:** vitest thresholds (lines 82 / statements 80 / functions 74 / branches 72)
  are a blocking CI gate; Python suite enforces `--cov-fail-under=80`.
- **Banned packages:** none relevant to this phase (no new npm/pip installs — see Package Legitimacy).
- **Migrations auto-apply:** merging `supabase/migrations/**` to `main` AUTO-APPLIES to PROD
  (`supabase-migrate.yml`). MCP-apply to TEST first (MEMORY / project ops rule).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Source lockstep (MT5SRC-01) — mirror `'sfox'`:** add `'mt5'` in lockstep to the THREE registry
  points: `Source` Literal (`services/ingestion/adapter.py:45`), `SUPPORTED_SOURCES`
  (`services/ingestion/__init__.py:107`), `_FACTORIES` (`:166`). A boundary-literal parity test
  asserts the three stay in lockstep. `Mt5Adapter` registered in `_FACTORIES`; its
  `compute_metrics`/`fetch_raw` fail-loud RAISE until Phase 136 (verbatim `SfoxAdapter` posture).
- **Read-only validate/encrypt branch (MT5SRC-02):** `validate_key`/`encrypt_key` gain an `is_mt5`
  branch alongside `is_sfox`/`is_deribit`. Proves auth + read via `Mt5Client.login` +
  `account_info()`; asserts read-only STRUCTURALLY (no `order_*` surface) PLUS a validate-time
  `order_check` investor-vs-master probe. NEVER calls `order_send`. Master (trade-capable) login
  REJECTED with targeted copy, NEVER persisted; only investor (read-only) accepted. Bad creds →
  honest `KEY_AUTH_FAILED`. Broker server REQUIRED; wrong-server failure distinguishable from
  bad-password. Credential slots: login → `api_key`, investor password → `api_secret`, broker
  server → `passphrase` — commented LOUDLY at the ONE encrypt chokepoint. No new columns.
- **Next.js key routes + constraint migration (MT5SRC-03):** all 3 key routes accept `mt5` (plus
  any shared exchange enum/zod schema they import); invalid values still rejected. RED-guarded
  constraint-widening migration mirroring `20260718182056` + `20260704200446` admits `'mt5'` across
  the hardcoded exchange CHECKs; project timestamp convention; RED guard proves reject-before /
  accept-after. MCP-apply to TEST (`qmnijlgmdhviwzwfyzlc`) FIRST, verify, THEN merge (auto-applies
  to PROD `khslejtfbuezsmvmtsdn`). Route through `migration-reviewer`. Constraint widened, not dropped.

### Claude's Discretion
All decisions are engineering-discretion clones of the shipped sFOX/Deribit seam. No user-preference
grey areas. (See Open Questions for the discretion points surfaced by research: the master-rejection
error copy/code, the go-dark server-enable gate, and `Mt5Adapter.validate` posture.)

### Deferred Ideas (OUT OF SCOPE)
- `Mt5Adapter.compute_metrics`/`fetch_raw` real implementation → Phase 136 (fail-loud raise here).
- Live validation against a real broker demo account → Phase-134 human_needed spike; 135's validate
  branch is unit-tested against the `Mt5Client` contract double.
- UI (138), go-live + prod gateway (139).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MT5SRC-01 | `'mt5'` registered as first-class `Source` in lockstep across `Source` Literal + `SUPPORTED_SOURCES` + `_FACTORIES`, parity tests green | Q1 — exact 3 edit sites + `Mt5Adapter` clone + parity-test map |
| MT5SRC-02 | Worker `validate_key`/`encrypt_key` `is_mt5` read-only branch (login+account_info, structural read-only + order_check investor-vs-master, honest `KEY_AUTH_FAILED`, never `order_send`, 3-cred → 3-slot map) | Q2 — `_validate_sfox_key` template + `Mt5Client` contract wiring + slot-map chokepoint |
| MT5SRC-03 | All 3 Next.js routes accept `mt5`; RED-guarded constraint-widening migration admits `'mt5'` (applied + verified), invalid still rejected | Q3 (routes/enum) + Q4 (migration + RED guard) + Q5 (ops) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Source registration (Literal/registry) | API / Backend (Python worker) | — | Ingestion registry + adapter Protocol live in `analytics-service` |
| Key validate + read-only assertion | API / Backend (FastAPI `/validate-key`) | — | Non-ccxt client probe; TS routes forward here |
| Credential encryption (slot mapping) | API / Backend (`/encrypt-key` → `encrypt_credentials`) | — | KEK-wrapping chokepoint; slot reuse commented here |
| Key-route exchange acceptance | Frontend Server (Next.js route.ts) | API / Backend | Routes gate on TS `SUPPORTED_EXCHANGES`, then forward to worker |
| Exchange/source value admission | Database (Postgres CHECK) | — | Last line of defense; 4 boundary CHECKs |
| Read-only enforcement | API / Backend (structural, `Mt5Client` surface) | — | No `order_*` in facade + validate-time `order_check` probe |

## Standard Stack

No new libraries. This phase edits existing modules and reuses:

| Component | Location | Purpose |
|-----------|----------|---------|
| `Mt5Client` / `Mt5ClientError` | `analytics-service/services/mt5_client.py` | Phase-134 read-only RPyC facade the validate branch stubs against `[VERIFIED: codebase]` |
| `SfoxAdapter` | `analytics-service/services/ingestion/sfox.py` | fail-loud adapter template for `Mt5Adapter` `[VERIFIED: codebase]` |
| `_validate_sfox_key` | `analytics-service/routers/exchange.py:28` | validate-branch template `[VERIFIED: codebase]` |
| `encrypt_credentials` | `analytics-service/services/encryption.py` (via `routers/exchange.py:195`) | KEK-wrap chokepoint — the slot-map comment site `[VERIFIED: codebase]` |
| `SUPPORTED_EXCHANGES` / `exchangeEnum` | `src/lib/closed-sets.ts:39-41` | single TS source of truth for the 3 routes `[VERIFIED: codebase]` |
| `STRATEGY_SOURCES` | `src/lib/strategy-sources.ts:17` | TS strategies.source set (parity with `strategies_source_check`) `[VERIFIED: codebase]` |
| deribit/sfox boundary migrations | `supabase/migrations/20260704200446…`, `20260718182056…` | migration clone template `[VERIFIED: codebase]` |
| `test_sfox_exchange_boundary.sql` | `supabase/tests/test_sfox_exchange_boundary.sql` | RED-guard SQL test template `[VERIFIED: codebase]` |

`mt5linux==1.0.3` is NOT installed and NOT installed in this phase — its install is gated to plan
134-03 (human-verify) and imported lazily only (`mt5_client.py:109`). The 135 validate branch is
unit-tested against the injected `_connect` transport double, exactly like the 134 contract suite.

## Package Legitimacy Audit

**Not applicable** — Phase 135 installs no external packages. All work reuses in-repo modules and
the already-vetted Phase-134 `Mt5Client`. No npm/pip/cargo additions. (`mt5linux` install remains a
separate 134-03 human-verify gate, out of scope here.)

---

## Q1 — Source lockstep (MT5SRC-01)

### The three registry edit sites (mirror `'sfox'` exactly)

1. **`services/ingestion/adapter.py:45`** — the `Source` Literal:
   ```python
   Source = Literal["okx", "binance", "bybit", "csv", "deribit", "sfox"]  # → append "mt5"
   ```
   `[VERIFIED: codebase]` Add a lockstep comment block mirroring the sfox note at lines 32-44.

2. **`services/ingestion/__init__.py:107`** — `SUPPORTED_SOURCES`:
   ```python
   SUPPORTED_SOURCES: tuple[str, ...] = ("okx", "binance", "bybit", "csv", "deribit", "sfox")  # → +"mt5"
   ```
   `[VERIFIED: codebase]`

3. **`services/ingestion/__init__.py:166`** — `_FACTORIES` dict + a new factory fn (~`:161`):
   ```python
   def _make_mt5_adapter() -> IngestionAdapter:
       from .mt5 import Mt5Adapter
       return Mt5Adapter()
   # ... in _FACTORIES:
   "mt5": _make_mt5_adapter,
   ```
   `[VERIFIED: codebase]` `get_adapter`/`_instantiate` (`:176`/`:111`) then resolve mt5 with zero
   further edits (registry-driven dispatch, M-11).

### Does an `Mt5Adapter` class need to exist? — YES

`_FACTORIES` registration constructs an adapter, and `get_adapter` caches an instance. Create
**`services/ingestion/mt5.py`** cloning `services/ingestion/sfox.py` (`SfoxAdapter`, lines 50-158).
The fail-loud posture to clone verbatim:

- **`compute_metrics`** (`sfox.py:126-140`) — RAISE `NotImplementedError` (BYB-02 corruption class:
  a fill-based snapshot would persist a silently-wrong track record). MT5 returns are equity-curve
  reconstructed in Phase 136, never fill-derived. `[VERIFIED: codebase]`
- **`fetch_raw`** (`sfox.py:109-124`) — RAISE `NotImplementedError` (no synchronous flow admits mt5;
  no consumer for a fill list until 136). `[VERIFIED: codebase]`
- **`compute_fingerprint`** (`sfox.py:142-149`) / **`reconstruct_positions`** (`:151-157`) — delegate
  to the shared exchange-agnostic impls (execution-detail axis is correct; only the RETURNS axis is
  guarded — deribit/sfox precedent). `[VERIFIED: codebase]`
- **`validate`** (`sfox.py:56-107`) — see Open Questions Q-A. The `IngestionAdapter` Protocol is
  `@runtime_checkable` and requires `validate` to be PRESENT (`__init__.py:70`). The HTTP validate
  path (MT5SRC-02) lives in the router, NOT the adapter; the adapter's `validate` is only invoked by
  `process_key` orchestration, which is not wired for mt5 in 135. **Recommendation:** implement
  `Mt5Adapter.validate` against `Mt5Client` (login + account_info + order_check) so the class is a
  faithful clone and future-proof, OR keep it minimal — flagged as discretion.

### Where the parity tests live (135 must mirror these)

| Test | File:line | What it pins | Edit needed for mt5 |
|------|-----------|--------------|---------------------|
| `test_source_literal_and_registry_agree` | `tests/test_ingestion_deribit.py:262` | `set(get_args(Source)) == set(SUPPORTED_SOURCES)` | **Auto-green** if all 3 sites updated in lockstep (no edit) `[VERIFIED: codebase]` |
| `test_literal_types` | `tests/test_ingestion_protocol.py:198-218` | hardcoded set-equality on `Source` args | **MUST add `"mt5"`** to the expected set (`:212`) `[VERIFIED: codebase]` |
| sfox lockstep suite | `tests/test_ingestion_sfox.py:200-205` (`test_source_literal_admits_sfox`) | membership + registry resolves + caches | **Mirror**: add `tests/test_ingestion_mt5.py` asserting `"mt5"` in `Source` + `SUPPORTED_SOURCES` + `get_adapter("mt5")` resolves an `Mt5Adapter` (and its `compute_metrics`/`fetch_raw` raise) |
| `TestPydanticLiteralsContain*` + `_KEY_SAVE_EXCHANGES` | `tests/test_boundary_literals_parity.py:61,74-129` | 5-value key-save set == pydantic Literals | **MUST add `"mt5"`** to `_KEY_SAVE_EXCHANGES` (`:61`) + add mt5 CONTAIN assertions (see Q4 for the migration-parity class) `[VERIFIED: codebase]` |

**The SFOX-01 pin precedent (Literal must not widen ahead of the registry):** the Phase-119 deferral
pinned `sfox` OUT of the `Source` Literal precisely because the factory did not yet exist
(`adapter.py:36-38`, `sfox.py:5-9`). For mt5 the factory (`Mt5Adapter`) lands in the SAME change, so
all three widen TOGETHER — no split.

---

## Q2 — `validate_key`/`encrypt_key` `is_mt5` branch (MT5SRC-02)

### Where the branch goes

The HTTP validate/encrypt branches live in **`routers/exchange.py`** (NOT `services/exchange.py`,
which is the ccxt-only `validate_key_permissions` engine). The sfox intercept is the exact template:

- **`routers/exchange.py:139`** — `if req.exchange == "sfox":` intercepts BEFORE the ccxt
  `create_exchange` path (which would `ValueError` since sfox/mt5 are not in `EXCHANGE_CLASSES`,
  `services/exchange.py:809-814`). Add an analogous `if req.exchange == "mt5":` branch here calling
  a new `_validate_mt5_key(...)`. The ccxt branch (`:151-183`) stays byte-identical. `[VERIFIED: codebase]`
- **`_validate_sfox_key`** (`routers/exchange.py:28-116`) is the fail-CLOSED template to clone as
  `_validate_mt5_key`. `[VERIFIED: codebase]`

### How read-only is asserted for sfox (and how mt5 mirrors + extends it)

sfox asserts read-only STRUCTURALLY — the `SfoxClient` hardcodes HTTP verb to GET, no order surface,
no scope endpoint, so `read_only=True` is a structural property, never a probed triple
(`sfox.py:28-32`, `routers/exchange.py:33-37`). MT5 mirrors this: `Mt5Client` composes ONLY read
methods + an `order_check` probe and has NO trade path and NO `__getattr__` passthrough
(`mt5_client.py:12-22`) — read-only by construction.

**MT5 adds a validate-time behavioral probe sfox lacks:** an investor-vs-master rejection. Wire it as:
1. `client = Mt5Client(host, port)` then `client.login(login, password=investor_pw, server=server)`
   — proves auth (`mt5_client.py:200-224`; a falsy login → `Mt5ClientError` via `_raise_last`).
2. `client.account_info()` — proves read (`:226-231`).
3. Combine `account_info()["trade_allowed"]` with an `order_check(...)` probe
   (`:245-259`) to REJECT a trade-capable (master) login. **NEVER call `order_send`** — the facade
   does not expose it (grep-gate `order_send(` == 0, per 134 SUMMARY). `[VERIFIED: codebase]`
4. `client.close()` in a `finally` (`:261-271`, idempotent), mirroring sfox's `await client.aclose()`
   in `finally` (`routers/exchange.py:115-116`).

The `order_check` retcode/comment signal for investor-vs-master is `[ASSUMED]` pending MT5SPIKE-01
leg 2 (`mt5_client.py:249-254`, 134 SUMMARY key-decisions). Code the rule DEFENSIVELY: combine the
`order_check` result with `account_info().trade_allowed` (Pitfall 4). If the live spike refines the
retcode, it's a one-line follow-up, not a rewrite.

### Error copy / `KEY_AUTH_FAILED` surfacing

The cross-language contract is a set of shared detail STRINGS in `services/exchange.py`:
- `AUTH_FAILED_DETAIL` (`:26`) — TS `classifyKeyValidationError` (`src/lib/wizardErrors.ts`) maps any
  detail containing "authentication failed" → `KEY_AUTH_FAILED`.
- `RATE_LIMITED_DETAIL` (`:35`), `NETWORK_ERROR_DETAIL` (`:40`) — mapped to `KEY_RATE_LIMIT` /
  network by the same TS matcher. `[VERIFIED: codebase]`

sfox reuses these verbatim so a sfox failure classifies byte-identically to the ccxt equivalent with
ZERO TS edits (`routers/exchange.py:39-51`, `83-114`). MT5 should map:
- bad password / login → `HTTPException(400, AUTH_FAILED_DETAIL)`.
- **wrong broker server** → distinguishable path/copy (CONTEXT locks "broker server REQUIRED; a
  wrong-server failure is distinguishable"). `Mt5ClientError.code` (`mt5_client.py:95-97`) carries the
  MT5 `(code, text)` so the branch CAN distinguish; the exact copy string is a discretion call
  (see Open Questions Q-B — it likely needs a NEW `KEY_*` mapping in `wizardErrors.ts` or must reuse
  an existing mapped string).
- transient/timeout → `NETWORK_ERROR_DETAIL`.
- **master-login rejection** → NEW targeted copy (no sfox analog). This string MUST be mapped by
  `classifyKeyValidationError` or it falls through to a generic code — flagged `[ASSUMED]` / discretion.

### The 3-credential → 3-slot encryption chokepoint (the one MT5-specific wrinkle)

- The encrypt chokepoint is **`routers/exchange.py:186-196`** (`/encrypt-key` → `encrypt_credentials(req.api_key, req.api_secret, req.passphrase, kek)`),
  which reuses the existing encrypted `{api_key, api_secret, passphrase}` slots. `[VERIFIED: codebase]`
- Slot mapping (comment LOUDLY here per CONTEXT): **login → `api_key`, investor password →
  `api_secret`, broker server → `passphrase`**. No new columns; the Next.js caller populates the
  three slots and the worker's `is_mt5` branch reads them back in the same order.
- `ValidateKeyRequest` (`models/schemas.py:9-13`) and `EncryptKeyRequest` (`routers/exchange.py:21-25`)
  already carry `{exchange, api_key, api_secret, passphrase}` — no schema field additions needed.
  `ValidateKeyRequest.exchange` is a bare `str` (`:10`), so it accepts `"mt5"` with no edit; the
  intercept at `:139` does the routing. `[VERIFIED: codebase]`

### `aclose_exchange` note

`services/exchange.py:872-916` has an `isinstance(exchange, SfoxClient)` chokepoint routing non-ccxt
clients to their own `aclose`. `Mt5Client` is synchronous and closed via `client.close()` in the
validate branch's `finally` — it does NOT flow through `aclose_exchange` in Phase 135 (no ingestion
wiring). Any job-worker close routing for mt5 is a Phase 136/137 concern. **None required this phase.**

---

## Q3 — The 3 Next.js key routes + shared enum

**Single source of truth: `src/lib/closed-sets.ts:39`.** `[VERIFIED: codebase]`
```ts
export const SUPPORTED_EXCHANGES = ["binance", "okx", "bybit", "deribit", "sfox"] as const;  // → +"mt5"
export type SupportedExchange = (typeof SUPPORTED_EXCHANGES)[number];   // :40
export const exchangeEnum = z.enum(SUPPORTED_EXCHANGES);                // :41
export function isSupportedExchange(value: string): boolean { ... }     // :196
```

**Two required edits in `closed-sets.ts` (not one):**
1. `:39` — append `"mt5"` to `SUPPORTED_EXCHANGES`.
2. `:44-54` — **`EXCHANGE_DISPLAY`** is `as const satisfies Record<SupportedExchange, string>`
   (`:54`). Widening the type WITHOUT adding an `mt5: "…"` entry is a **TS COMPILE ERROR**. Add e.g.
   `mt5: "MT5"` (display label per DESIGN.md — confirm wording). `[VERIFIED: codebase]`

**Do NOT touch the UI-offered sets** (`UI_EXCHANGE_CODES` / the `SFOX_UI_ENABLED` gated arrays at
`:143-159`) — those are Phase 138 (UI). mt5 stays OUT of the offered set, keeping the seam dark.
`[VERIFIED: codebase]`

**How each route enforces the accepted set:**

| Route | File:line | Enforcement | mt5 edit |
|-------|-----------|-------------|----------|
| `keys/validate-and-encrypt` | `route.ts` (200 ln) | NO `isSupportedExchange` gate — only `!exchange` check (`:60`); relies on downstream Python `/validate-key` + DB CHECK to reject. Has an `isSfoxEnabledServer()` gate (`:37,53`). | No enum gate to edit; accepts mt5 once forwarded. If mirroring a go-dark gate, add `isMt5EnabledServer()` here (discretion). `[VERIFIED: codebase]` |
| `strategies/create-with-key` | `route.ts:47` | `if (typeof exchange !== "string" \|\| !isSupportedExchange(exchange))` → 400 | **Auto-accepts** once `SUPPORTED_EXCHANGES` widens. `[VERIFIED: codebase]` |
| `strategies/composite/add-key` | `route.ts:67` | same `isSupportedExchange(exchange)` gate | **Auto-accepts** once `SUPPORTED_EXCHANGES` widens. `[VERIFIED: codebase]` |

**Is there a shared enum module? YES — a single edit propagates.** All three routes import from
`@/lib/closed-sets` (`isSupportedExchange`, `isSfoxEnabledServer`). Adding `"mt5"` to
`SUPPORTED_EXCHANGES` (+ the `EXCHANGE_DISPLAY` entry) is the one enum edit; the two gated routes
accept mt5 automatically. `[VERIFIED: codebase]`

**Credential wrinkle — MT5 is the mirror-image of sfox:** the routes special-case sfox to RELAX the
`api_secret` presence requirement (`create-with-key:60-92`, `composite/add-key:82-119`,
`validate-and-encrypt:37-60`). MT5 requires ALL THREE credentials, so it flows the NON-sfox path that
requires `api_secret` — correct by default. The broker **server (`passphrase`)** is REQUIRED for mt5
but the routes treat `passphrase` as optional ("OKX only" historically, `schemas.py:217`). The
worker's `is_mt5` branch is the authoritative enforcement (a `login` without server fails). Whether to
add route-level `passphrase`-presence enforcement for mt5 is discretion (recommend: rely on the worker
+ add a defense-in-depth check symmetric to the sfox `api_secret` relaxation).

**`STRATEGY_SOURCES` (`src/lib/strategy-sources.ts:17-28`)** — the 10-value strategies.source set must
also gain `"mt5"`, paired with the `strategies_source_check` migration widen (Q4). Enforced by
`src/__tests__/strategy-sources-migration-parity.test.ts` (set-equality: TS set == latest
`strategies_source_check` migration). `[VERIFIED: codebase]`

---

## Q4 — The constraint migration + RED guard

### EXACT constraints the deribit/sfox precedents widen — FOUR, not five

Both `20260704200446_deribit_exchange_boundary_checks.sql` and
`20260718182056_sfox_exchange_boundary_checks.sql` widen EXACTLY these four
(`_WIDENED_CONSTRAINTS`, `test_boundary_literals_parity.py:66-71`): `[VERIFIED: codebase]`

| # | Constraint | Table.column | Form | sfox final IN-list |
|---|-----------|--------------|------|--------------------|
| 1 | `api_keys_exchange_check` | `api_keys.exchange` | plain | `('binance','okx','bybit','deribit','sfox')` → +`'mt5'` |
| 2 | `compute_jobs_exchange_check` | `compute_jobs.exchange` | **nullable** (`exchange IS NULL OR …`) | preserve `IS NULL OR` + append `'mt5'` |
| 3 | `strategies_source_check` | `strategies.source` | 10-value vocab | append `'mt5'` (→ 11) |
| 4 | `strategy_verifications_source_check` | `strategy_verifications.source` | 6-value | `('okx','binance','bybit','csv','deribit','sfox')` → +`'mt5'` |

**DELIBERATELY EXCLUDED (parity-pinned, clone the skip set):**
- `funding_fees` exchange CHECK — MT5/sfox are not perp-funding sources
  (`20260718182056…:30-32`, sibling `test_funding_match_key_sql_parity.py`).
- `position_snapshots` exchange CHECK — no derivative positions
  (`20260718182056…:33-34`).
- `verification_requests` VIEW + its frozen Phase-19 legacy table — a `DROP CONSTRAINT` on a VIEW
  errors; never touch (`20260718182056…:35-37`). `[VERIFIED: codebase]`

**⚠️ Correction to CONTEXT/ROADMAP:** they say "≥5 hardcoded exchange CHECKs." The shipped precedent
is **exactly 4**. The faithful clone widens 4. Widening a 5th (funding_fees / position_snapshots)
would BREAK the parity exclusions and contradict the precedent. See Corrections section.

### The migration body pattern (clone `20260718182056` verbatim, s/sfox/mt5/, s/Phase 119/Phase 135/)

Per-constraint (`20260718182056…:58-193`): `[VERIFIED: codebase]`
```sql
BEGIN;
SET lock_timeout = '3s';
ALTER TABLE <t> DROP CONSTRAINT IF EXISTS <name>;
ALTER TABLE <t> ADD CONSTRAINT <name> CHECK (<col> IN (... , 'mt5'));   -- nullable form for #2
DO $$ ... pg_get_constraintdef ... FOREACH expected_value IN ARRAY ARRAY[..., 'mt5'] LOOP
   IF position('''' || expected_value || '''' IN def) = 0 THEN RAISE EXCEPTION ...; END IF;
END LOOP; END $$;   -- self-verify, fail-loud at apply
COMMIT;
COMMENT ON COLUMN strategy_verifications.source IS '... Phase 135 (MT5SRC-03) widened … mt5 …';
```
- Forward-only, no DOWN shim (re-narrowing after an mt5 row exists would fail validation).
- Re-base on the LATEST definition — grep ALL migrations to confirm no later ALTER re-based any of
  the four after `20260718182056` (the sfox migration is the current tip for all four). `[VERIFIED: codebase — no later re-base found for the four]`
- Canonical auto-names are LOAD-BEARING: `resolveColumnCheck` in
  `src/__tests__/contracts/check-zod-db-check-parity.test.ts:87-137` resolves the named
  `<table>_<column>_check` newest-wins, so this migration becomes the compared definition.

### The RED-guard pattern (reject-before / accept-after)

**SQL test** `supabase/tests/test_mt5_exchange_boundary.sql`, cloning
`supabase/tests/test_sfox_exchange_boundary.sql` (203 ln). `[VERIFIED: codebase]` Four `DO $$` blocks,
one per constraint, each proving:
- **(a) admit `'mt5'`** — INSERT succeeds + row exists.
- **(b) reject bogus** — INSERT `'notanexchange'` raises `check_violation` (23514), caught, asserts
  the constraint was WIDENED not DROPPED.
- **compute_jobs (b)** additionally asserts NULL still admitted (nullable form preserved).
- Fixtures use `gen_random_uuid()` + cleanup (concurrent-CI-safe on the shared test project); seeds
  satisfy unrelated pre-existing guards (`compute_jobs_kind_target_coherence`,
  `compute_jobs_one_inflight_per_kind_strategy` — `test_sfox_exchange_boundary.sql:59-67`).
- **RED before migration applied** (the `'mt5'` INSERTs fail the pre-widen CHECK), **GREEN after**.
- Run with `psql -v ON_ERROR_STOP=1` (pgTAP is not set up — assertions RAISE).

**⚠️ CI-visibility rule (MEMORY):** SQL gates MUST live in `supabase/tests/test_*.sql` to run in CI;
`*_live.py` + `skipIf(!HAS_LIVE_DB)` NEVER run in CI. Verify the new SQL test is actually wired into
the CI test runner (the sfox test's presence there is the precedent to check).

**Python byte-parity test** `tests/test_boundary_literals_parity.py`: add `_MT5_BOUNDARY_MIGRATION`
path const (mirror `:48-53`), a `TestMt5MigrationWidensEveryKeyBoundaryCheck` class (mirror
`:171-201` — asserts each of the 4 named `ADD CONSTRAINT` appears exactly once and its CHECK IN-list
contains `'mt5'`), and add `"mt5"` to `_KEY_SAVE_EXCHANGES` (`:61`) + mt5 CONTAIN assertions.
`[VERIFIED: codebase]`

### Timestamp naming convention

Format: **`YYYYMMDDHHMMSS_description.sql`** (14-digit UTC prefix). `[VERIFIED: codebase]`
Latest existing migration tip: `20260720120000_retention_orphaned_running_window_4h.sql`. The new
file MUST use a timestamp **greater than the remote-applied tip** (use current UTC, ~`20260723…`).
Suggested name: `<now>_mt5_exchange_boundary_checks.sql`.

### SECURITY DEFINER / RLS / trigger interactions

None. These are pure CHECK-constraint widenings inside a single `BEGIN…COMMIT`; no RLS policy, no
SECURITY DEFINER function, no trigger, no index. The self-verify `DO $$` blocks run as the migration
role. The nullable form of `compute_jobs_exchange_check` (#2) is the only structural subtlety — the
`IS NULL OR` clause MUST be preserved (self-verify asserts it, `20260718182056…:108-110`).

---

## Q5 — Project migration ops (what `migration-reviewer` checks)

- **MCP-to-TEST-first (locked):** `apply_migration` via Supabase MCP to the TEST project
  `qmnijlgmdhviwzwfyzlc` FIRST, run the RED-guard SQL test there, verify GREEN, THEN merge.
  `[VERIFIED: MEMORY + CONTEXT]`
- **Auto-apply to PROD:** merging `supabase/migrations/**` to `main` AUTO-APPLIES to PROD
  `khslejtfbuezsmvmtsdn` via `.github/workflows/supabase-migrate.yml`. Watch the run + verify
  `/health` + constraint defs post-merge. `[VERIFIED: MEMORY]`
- **MCP `apply_migration` stamps `now()`** in `schema_migrations` — the stamped version differs from
  the file-name timestamp, causing drift; the `schema_migrations` row may need a manual fix
  (MEMORY `feedback_supabase_apply_migration_drift`). `[VERIFIED: MEMORY]`
- **Backdated-migration guard** (`.github/workflows/migration-policy.yml:184-290`): a newly-added
  migration file whose 14-digit timestamp is **older than the remote tip** is BLOCKED (silent
  history-rewrite vector). The basename MUST start with a 14-digit `YYYYMMDDHHMMSS` prefix. Fail-CLOSED
  if it cannot reach the remote DB. → **Use a fresh, forward timestamp; never backdate.** `[VERIFIED: codebase]`
- **`migration-drift-check.yml`** + **`migration-policy-self-test.yml`** also run on migration PRs.
- **NUMERIC vs INTEGER / CONCURRENTLY-in-transaction:** N/A — no column type changes, no index
  creation. (`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block; this migration has no
  index, so the `BEGIN…COMMIT` wrapper is correct and safe.) `migration-reviewer` will confirm these
  are absent.
- Route the migration through the **`migration-reviewer`** agent before PR (CONTEXT locked).

---

## Corrections to Upstream Docs

| Claim (CONTEXT/ROADMAP) | Reality (verified) | Impact |
|-------------------------|--------------------|--------|
| "≥5 hardcoded exchange CHECKs" | The deribit + sfox precedents widen **exactly 4** (`api_keys`, `compute_jobs`, `strategies.source`, `strategy_verifications.source`); `funding_fees` + `position_snapshots` + the `verification_requests` VIEW are DELIBERATELY excluded. | Migration widens 4. Widening a 5th breaks the parity-pinned exclusions. |
| "validate_key/encrypt_key in services/exchange.py + routers/exchange.py" | The HTTP validate/encrypt BRANCH lives in `routers/exchange.py` (`:119`, `:186`); `services/exchange.py` holds the ccxt-only `validate_key_permissions` engine (`:954`) that mt5 does NOT route through. | The `is_mt5` branch goes in `routers/exchange.py`, alongside the sfox intercept at `:139`. |
| "single enum edit" | Requires TWO edits in `closed-sets.ts` (`SUPPORTED_EXCHANGES` + `EXCHANGE_DISPLAY`, else TS won't compile) PLUS `STRATEGY_SOURCES` in `strategy-sources.ts`. | 3 TS const edits total. |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Credential encryption | Custom KEK/DEK crypto | `encrypt_credentials` (`routers/exchange.py:195`) | ASVS V6 — never hand-roll crypto; slots already exist |
| Read-only MT5 access | New client / trade-path wrapper | Phase-134 `Mt5Client` (structural read-only) | facade already omits `order_*`, scrubs secrets |
| Error classification | New error-code strings | shared `AUTH_FAILED_DETAIL` / `RATE_LIMITED_DETAIL` / `NETWORK_ERROR_DETAIL` | cross-language contract with `wizardErrors.ts` |
| Exchange allowlist | Inline per-route lists | `SUPPORTED_EXCHANGES` single SoT | 3 routes + pydantic + SQL kept in lockstep by parity tests |
| Constraint-widen test | ad-hoc | clone `test_sfox_exchange_boundary.sql` | proven reject-before/accept-after RED guard |

## Common Pitfalls

### Pitfall 1: Literal widens ahead of the registry (SFOX-01 class)
Adding `"mt5"` to the `Source` Literal without landing `Mt5Adapter` in `_FACTORIES` reds
`test_source_literal_and_registry_agree`. **Land all three + the adapter TOGETHER.**

### Pitfall 2: `EXCHANGE_DISPLAY` compile break
Widening `SUPPORTED_EXCHANGES` without an `mt5` entry in `EXCHANGE_DISPLAY` (`:54`
`satisfies Record<SupportedExchange,string>`) fails `tsc`. Add both in the same edit.

### Pitfall 3: Backdated migration timestamp
A timestamp ≤ the remote tip is BLOCKED by `migration-policy.yml`. Use current UTC.

### Pitfall 4: `order_check` retcode rule is `[ASSUMED]`
The investor-vs-master signal is unproven until the live spike. Combine `order_check` retcode/comment
WITH `account_info().trade_allowed` defensively; NEVER call `order_send`.

### Pitfall 5: MCP `apply_migration` version drift
MCP stamps `now()` not the filename timestamp — fix the `schema_migrations` row after TEST apply.

### Pitfall 6: Widening the wrong (5th) constraint
`funding_fees` / `position_snapshots` are parity-pinned EXCLUSIONS. Widening them reds the funding
parity tests and contradicts the precedent.

## Runtime State Inventory

This is an additive registration phase (no rename/refactor of existing stored values). No existing
data carries an old string that must migrate. Explicit per category:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `'mt5'` is a NEW admitted value; no existing rows reference it. | None (widen only ADDS a value; no backfill — `20260718182056…:43-44`). |
| Live service config | None — no external service holds an mt5 key yet (live broker validation is deferred to the 134 spike / Phase 139). | None this phase. |
| OS-registered state | None. | None. |
| Secrets/env vars | Potential NEW go-dark gate env `MT5_ENABLED` (if mirroring `SFOX_ENABLED`, `services/closed_sets.py:66-68`) — discretion. No existing env renamed. | If adopting the gate: set `MT5_ENABLED` at go-live (Phase 139), not now. |
| Build artifacts | None — `mt5linux` is not installed (lazy import); no egg-info/binary carries mt5. | None. |

## Code Examples

### The sfox validate intercept to clone (`routers/exchange.py:139-149`)
```python
# Source: analytics-service/routers/exchange.py (VERIFIED)
if req.exchange == "sfox":
    if not sfox_enabled_server():
        raise HTTPException(status_code=400, detail=SFOX_DISABLED_DETAIL)
    return await _validate_sfox_key(req.api_key)
# → add an analogous `if req.exchange == "mt5":` branch calling _validate_mt5_key(...)
```

### The fail-CLOSED error mapping to clone (`routers/exchange.py:83-101`)
```python
# Source: analytics-service/routers/exchange.py (VERIFIED)
except SfoxApiError as e:
    if e.status in (401, 403):
        raise HTTPException(status_code=400, detail=AUTH_FAILED_DETAIL)
    if e.status == 429:
        raise HTTPException(status_code=400, detail=RATE_LIMITED_DETAIL)
    raise HTTPException(status_code=400, detail=NETWORK_ERROR_DETAIL)
# → for mt5, map Mt5ClientError.code: bad creds → AUTH_FAILED_DETAIL,
#   wrong-server → distinct copy, transient → NETWORK_ERROR_DETAIL,
#   master-login → NEW targeted rejection copy (must be mapped by wizardErrors.ts)
```

### The `Mt5Client` read+probe surface to wire (`services/mt5_client.py`)
```python
# Source: analytics-service/services/mt5_client.py (VERIFIED)
client.login(login, password=investor_pw, server=server)   # :200 — falsy → Mt5ClientError
info = client.account_info()                                # :226 — {..., "trade_allowed": ...}
probe = client.order_check(request)                         # :245 — PROBE ONLY, never order_send
client.close()                                              # :261 — idempotent, in finally
```

## Validation Architecture

`nyquist_validation` is enabled (config absent-or-true). Framework: **pytest** (`analytics-service`,
`--cov-fail-under=80`) + **vitest** (frontend) + **psql** SQL gate tests.

### Test Framework
| Property | Value |
|----------|-------|
| Python | pytest (`analytics-service/tests/`) |
| Frontend | vitest (`src/__tests__/`, sharded, `--coverage` gate) |
| SQL gate | `psql -v ON_ERROR_STOP=1 supabase/tests/test_*.sql` (must be CI-wired) |
| Quick run | `cd analytics-service && pytest tests/test_ingestion_mt5.py tests/test_boundary_literals_parity.py -x -q` |
| Full suite | `pytest` (analytics) + `npm run test` (frontend) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MT5SRC-01 | Source Literal + registry + factory lockstep | unit | `pytest tests/test_ingestion_mt5.py -x` | ❌ Wave 0 (clone `test_ingestion_sfox.py`) |
| MT5SRC-01 | Literal set-equality pins | unit | `pytest tests/test_ingestion_protocol.py::test_literal_types tests/test_ingestion_deribit.py::test_source_literal_and_registry_agree -x` | ✅ (edit expected sets) |
| MT5SRC-02 | `is_mt5` validate branch (login+account_info, master-reject, bad-creds→AUTH_FAILED, never order_send) | unit | `pytest tests/test_exchange*.py -k mt5 -x` | ❌ Wave 0 (clone sfox validate tests) |
| MT5SRC-03 | 3 routes accept mt5, reject invalid | unit | `npm run test -- create-with-key composite/add-key validate-and-encrypt` | ✅ (route.test.ts exist; add mt5 cases) |
| MT5SRC-03 | migration parity (byte-read) | unit | `pytest tests/test_boundary_literals_parity.py -x` + `npm run test -- check-zod-db-check-parity strategy-sources-migration-parity` | ✅ (edit) |
| MT5SRC-03 | constraint reject-before/accept-after | SQL gate | `psql -v ON_ERROR_STOP=1 -f supabase/tests/test_mt5_exchange_boundary.sql` | ❌ Wave 0 (clone `test_sfox_exchange_boundary.sql`) |

### Sampling Rate
- **Per task commit:** the targeted pytest / vitest file for that layer.
- **Per wave merge:** full `analytics-service` pytest + frontend vitest.
- **Phase gate:** full suites green + SQL gate GREEN on TEST project before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/services/ingestion/mt5.py` — `Mt5Adapter` (clone `sfox.py`)
- [ ] `analytics-service/tests/test_ingestion_mt5.py` — lockstep/registry/fail-loud (clone `test_ingestion_sfox.py`)
- [ ] `_validate_mt5_key` + tests in `routers/exchange.py` / `tests/test_exchange*.py`
- [ ] `supabase/migrations/<now>_mt5_exchange_boundary_checks.sql` (clone `20260718182056`)
- [ ] `supabase/tests/test_mt5_exchange_boundary.sql` (clone `test_sfox_exchange_boundary.sql`) — confirm CI-wired
- [ ] Edits: `adapter.py:45`, `__init__.py:107,166`, `schemas.py:206`, `debug_key_flow.py:61`,
  `test_ingestion_protocol.py:212`, `test_boundary_literals_parity.py:61` (+ new class),
  `closed-sets.ts:39,54`, `strategy-sources.ts:17`

## Security Domain

`security_enforcement` enabled (absent = enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `Mt5Client.login` proves auth; bad creds → honest `AUTH_FAILED` (fail-CLOSED, never `valid:true`) |
| V4 Access Control | yes | Read-only enforced STRUCTURALLY (no `order_*` surface) + validate-time master-login rejection; RLS unchanged |
| V5 Input Validation | yes | `SUPPORTED_EXCHANGES` enum + pydantic Literals + SQL CHECK (defense-in-depth, invalid still rejected) |
| V6 Cryptography | yes | Reuse `encrypt_credentials` KEK/DEK — never hand-roll; no new crypto |
| V7 Errors & Logging | yes | `Mt5ClientError` scrubs secrets at construction (`mt5_client.py:95-97`); login redacts login/pw/server by value (`:217-222`); never log the interpolated remote code |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Trade-capable (master) key persisted as read-only | Elevation of Privilege | validate-time `order_check` + `trade_allowed` rejection; NEVER persist a master login |
| Credential leak via RPyC remote traceback | Information Disclosure | `scrub_freeform_string` + by-value redaction (134 T-134-01) |
| Unauthenticated RPyC channel (arbitrary RCE) | Tampering/EoP | bridge private-network-only (Phase 139 hardening; documented constraint `mt5_client.py:57-61`) |
| Invalid exchange smuggled past a single layer | Tampering | 3-layer lockstep (TS enum → pydantic Literal → SQL CHECK), each pinned by parity tests |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `order_check` retcode/comment investor-vs-master signal (combined with `trade_allowed`) | Q2 | Master login could be misclassified; live spike (MT5SPIKE-01 leg 2) refines it — one-line follow-up, not a rewrite |
| A2 | Master-login rejection uses a NEW targeted copy that `classifyKeyValidationError` must map (else falls through to a generic code) | Q2 / Open Q-B | Unclassified rejection surfaces a generic wizard error; confirm the `wizardErrors.ts` mapping |
| A3 | mt5 should ship behind a go-dark server gate (`MT5_ENABLED`, mirroring `SFOX_ENABLED`) | Q3 / Open Q-C | If NOT gated, a validate attempt could fire a live probe pre-go-live; recommend gating for parity with the sfox seam |
| A4 | Display label `"MT5"` for `EXCHANGE_DISPLAY` | Q3 | Cosmetic; confirm against DESIGN.md wording |
| A5 | No later migration re-bases the 4 constraints after `20260718182056` (mt5 re-bases on the sfox defs) | Q4 | If a later re-base exists, mt5 must re-base on THAT; grep ALL migrations at plan time to confirm |

## Open Questions

1. **Q-A — `Mt5Adapter.validate` posture.** The Protocol requires the method present; the HTTP
   validate lives in the router. Implement `validate` against `Mt5Client` (faithful clone of
   `SfoxAdapter.validate`) or keep minimal? **Recommendation:** implement it (future-proof, mirrors
   sfox); low cost.
2. **Q-B — Master-rejection error code.** Reuse `AUTH_FAILED` (maps cleanly today) with distinct
   human copy, or introduce a new `KEY_*` code requiring a `wizardErrors.ts` edit? **Recommendation:**
   distinct human copy under a mapped code; verify the TS matcher. This is the one place needing a
   TS logic edit beyond the enum.
3. **Q-C — Go-dark gate.** Add `mt5_enabled_server()` (`services/closed_sets.py`) + `isMt5EnabledServer()`
   (`closed-sets.ts`) mirroring the sfox gate so the seam ships dark until Phase 139?
   **Recommendation:** yes — the sFOX seam shipped FLAG-OFF (MEMORY), and a verbatim clone should too.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `mt5linux` | live MT5 validate (runtime) | ✗ (by design) | — | Lazy import; 135 validate is unit-tested against the injected `_connect` double (no install) |
| pytest | Python tests | ✓ | (repo) | — |
| vitest | frontend tests | ✓ | (repo) | — |
| Supabase MCP → TEST `qmnijlgmdhviwzwfyzlc` | migration apply + SQL gate | ✓ (MCP tools present) | — | — |
| psql | SQL gate test | assumed ✓ in CI | — | run via CI SQL harness |

**Missing dependencies with no fallback:** none block Phase 135 (all live-MT5 work is deferred).

## Sources

### Primary (HIGH confidence — codebase, verified this session)
- `analytics-service/services/ingestion/__init__.py` (SUPPORTED_SOURCES :107, _FACTORIES :166)
- `analytics-service/services/ingestion/adapter.py` (Source Literal :45)
- `analytics-service/services/ingestion/sfox.py` (SfoxAdapter fail-loud template)
- `analytics-service/services/exchange.py` (shared detail constants :26/:35/:40, EXCHANGE_CLASSES :809, aclose isinstance :914, validate_key_permissions :954)
- `analytics-service/routers/exchange.py` (`_validate_sfox_key` :28, validate_key intercept :139, encrypt_key :186)
- `analytics-service/services/mt5_client.py` (Phase-134 contract)
- `analytics-service/models/schemas.py` (ValidateKeyRequest :9, VerifyStrategyRequest.exchange :206)
- `analytics-service/routers/debug_key_flow.py` (Broker Literal :61)
- `analytics-service/services/closed_sets.py` (sfox_enabled_server :66)
- `analytics-service/tests/test_boundary_literals_parity.py`, `test_ingestion_protocol.py`, `test_ingestion_deribit.py`, `test_ingestion_sfox.py`
- `supabase/migrations/20260718182056_sfox_exchange_boundary_checks.sql`, `20260704200446_deribit_exchange_boundary_checks.sql`
- `supabase/tests/test_sfox_exchange_boundary.sql`
- `src/lib/closed-sets.ts` (SUPPORTED_EXCHANGES :39, EXCHANGE_DISPLAY :44, isSupportedExchange :196)
- `src/lib/strategy-sources.ts` (STRATEGY_SOURCES :17)
- `src/app/api/keys/validate-and-encrypt/route.ts`, `src/app/api/strategies/create-with-key/route.ts`, `src/app/api/strategies/composite/add-key/route.ts`
- `src/__tests__/contracts/check-zod-db-check-parity.test.ts`, `src/__tests__/strategy-sources-migration-parity.test.ts`
- `.github/workflows/migration-policy.yml` (backdated-migration guard :184-290)
- `.planning/phases/134-…/134-01-SUMMARY.md` (Mt5Client contract)

### Secondary (MEDIUM — MEMORY / project ops)
- Migration ops rules (MCP→TEST first; auto-apply to PROD; apply_migration now()-stamp drift; test/prod project refs)
- sFOX shipped FLAG-OFF precedent

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all reuse verified against shipped code.
- Architecture (edit sites): HIGH — every site cited to file:line; verbatim clone.
- Pitfalls: HIGH — derived from shipped precedent + parity tests + migration-policy workflow.
- Investor-vs-master rule: MEDIUM — `[ASSUMED]` retcode pending live spike (A1).

**Research date:** 2026-07-23
**Valid until:** 2026-08-22 (stable; re-grep migrations for later constraint re-bases at plan time)
