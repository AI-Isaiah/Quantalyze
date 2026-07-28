# Phase 135: MT5SRC — Source lockstep + read-only validate/encrypt + key routes + constraint migration - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (verbatim sFOX-seam clone — decisions locked by roadmap; engineering-discretion only)

<domain>
## Phase Boundary

`mt5` becomes a first-class `Source` accepted at EVERY key chokepoint end-to-end: a user's three
MT5 credentials validate read-only, encrypt, and persist, and the database admits `'mt5'`
everywhere an exchange value is constrained. This is a verbatim sFOX-seam clone across three
layers (Python worker registry + validate/encrypt branch, Next.js key routes, SQL constraint
migration). It stubs the read side against the Phase-134 `Mt5Client` contract.

NOT in this phase: equity reconstruction / `compute_metrics` (Phase 136 — the `Mt5Adapter`
lands registered but its metrics path fail-loud raises until 136, mirroring `SfoxAdapter`); UI
(Phase 138); go-live (Phase 139).
</domain>

<decisions>
## Implementation Decisions

### Source lockstep (MT5SRC-01) — mirror `'sfox'`
- Add `'mt5'` in lockstep to the THREE registry points, exactly mirroring `'sfox'`:
  `Source` Literal (`services/ingestion/adapter.py:45`), `SUPPORTED_SOURCES` tuple
  (`services/ingestion/__init__.py:107`), and `_FACTORIES` dict (`:166`).
- A boundary-literal parity test asserts the three stay in lockstep (the SFOX-01 pin precedent:
  the Literal must not widen ahead of the registry). `Mt5Adapter` registered in `_FACTORIES`;
  its `compute_metrics`/`fetch_raw` fail-loud RAISE until Phase 136 (verbatim `SfoxAdapter`
  posture — a fill-based snapshot here would be the BYB-02 corruption class).

### Read-only validate/encrypt branch (MT5SRC-02)
- `validate_key`/`encrypt_key` (in `services/exchange.py` + `routers/exchange.py`, alongside the
  `is_sfox`/`is_deribit` branches) gain an `is_mt5` branch. It proves auth + read via
  `Mt5Client.login` + `account_info()` (Phase-134 contract), and asserts read-only STRUCTURALLY
  (the client exposes no `order_*` surface) PLUS a validate-time `order_check` investor-vs-master
  probe. NEVER calls `order_send`.
- **Master-password rejection:** a trade-capable (master) login is REJECTED with targeted copy
  and NEVER persisted — only an investor (read-only) login is accepted. Uses the `order_check`/
  `trade_allowed` distinction from the 134 harness (retcode rule `[ASSUMED]` — if the live spike
  refines it, that is a one-line follow-up, not a rewrite).
- Bad creds → honest `KEY_AUTH_FAILED`. Broker server is REQUIRED; a wrong-server failure is
  distinguishable from a bad-password failure (distinct copy/paths).
- **Credential-slot mapping, documented LOUDLY at the ONE chokepoint:** the three MT5 fields map
  onto the existing encrypted `{api_key, api_secret, passphrase}` slots as
  login → `api_key`, investor password → `api_secret`, broker server → `passphrase`. No new
  columns; the slot reuse is commented at the single encrypt chokepoint so a future reader isn't
  surprised.

### Next.js key routes + constraint migration (MT5SRC-03)
- All 3 key routes accept `mt5`: `src/app/api/keys/validate-and-encrypt/route.ts`,
  `src/app/api/strategies/create-with-key/route.ts`,
  `src/app/api/strategies/composite/add-key/route.ts` (plus any shared exchange enum/zod schema
  they import). Invalid exchange values still rejected.
- **RED-guarded constraint-widening migration** mirroring `20260718182056_sfox_exchange_boundary_checks.sql`
  and `20260704200446_deribit_exchange_boundary_checks.sql`: admit `'mt5'` across the ≥5
  hardcoded exchange CHECK constraints. New migration file uses the project timestamp naming
  convention; a RED guard proves the constraint rejected `'mt5'` BEFORE and accepts it AFTER.
- **Migration safety (project ops rules):** MCP-apply to the TEST project FIRST
  (`qmnijlgmdhviwzwfyzlc`), verify, THEN merge — merging `supabase/migrations/**` to main
  AUTO-APPLIES to PROD (`khslejtfbuezsmvmtsdn`). Route the migration through `migration-reviewer`
  before PR. Invalid values must still be rejected after widening (constraint not dropped, only
  widened).

### Claude's Discretion
All decisions above are engineering-discretion clones of the shipped sFOX/Deribit seam. No
user-preference grey areas.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets / Analogs
- `services/ingestion/__init__.py` (`SUPPORTED_SOURCES`, `_FACTORIES`) + `adapter.py`
  (`Source` Literal, `TrustTier` already includes `api_verified`) — the lockstep registry.
- `services/ingestion/sfox.py` (`SfoxAdapter`) — the fail-loud `compute_metrics`/`fetch_raw`
  adapter template for `Mt5Adapter`.
- `services/exchange.py` + `routers/exchange.py` — where the `is_sfox`/`is_deribit` validate/
  encrypt branches live; `is_mt5` goes alongside.
- `services/mt5_client.py` (Phase 134) — `Mt5Client.login`/`account_info`/`order_check` +
  `Mt5ClientError`; the read-only probe mechanism validate stubs against.
- `supabase/migrations/20260718182056_sfox_exchange_boundary_checks.sql` +
  `20260704200446_deribit_exchange_boundary_checks.sql` — the constraint-widening migration
  template (enumerate the ≥5 CHECKs there).
- 3 Next.js routes: `keys/validate-and-encrypt`, `strategies/create-with-key`,
  `strategies/composite/add-key` (+ shared exchange enum/zod schema).

### Established Patterns
- Lockstep registry widening with a parity test; fail-loud adapter until the recon phase;
  RED-guarded constraint migration; MCP-to-TEST-first migration ops.

### Integration Points
- Worker validate/encrypt chokepoint; Next.js key-submission routes; Postgres exchange CHECK
  constraints across ≥5 tables.
</code_context>

<specifics>
## Specific Ideas
- The credential-slot reuse (login/investor-password/server → api_key/api_secret/passphrase) is
  the one genuinely MT5-specific wrinkle — it must be commented loudly at the encrypt chokepoint.
- `order_check` retcode rule is `[ASSUMED]` pending the 134 live spike; code the investor-vs-master
  rejection defensively (combine `order_check` result with `account_info().trade_allowed` if present).
</specifics>

<deferred>
## Deferred Ideas
- `Mt5Adapter.compute_metrics`/`fetch_raw` real implementation → Phase 136 (fail-loud raise here).
- Live validation against a real broker demo account → depends on the Phase-134 human_needed
  spike; 135's validate branch is unit-tested against the `Mt5Client` contract double.
- UI (138), go-live + prod gateway (139).
</deferred>
