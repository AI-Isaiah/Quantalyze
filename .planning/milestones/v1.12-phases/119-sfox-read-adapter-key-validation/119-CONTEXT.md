# Phase 119: SFOX Read adapter + key validation + DB constraint-widen - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Mode:** Autonomous (decisions are precedent-determined — the deribit key-connect path `20260704200446` + Phase-68 lockstep is the exact template; grounded in phase-118 RESEARCH)

<domain>
## Phase Boundary

A user can connect an sFOX API key end-to-end: the read adapter pulls the real account,
every validation/encryption chokepoint accepts `sfox`, and the DB admits `'sfox'` everywhere
an exchange value is constrained.

In scope (SFOX-02, SFOX-03, SFOX-04):
- `SfoxClient` reads balances + trades + transactions of a real account, read-only ENFORCED
  (key-permission scope asserted at the ingestion boundary; no order/withdraw ever exercised).
- `sfox` accepted through ALL THREE key routes (`api/keys/validate-and-encrypt`,
  `api/strategies/create-with-key`, `api/strategies/composite/add-key`) AND the worker
  `validate_key`/`encrypt_key` path — which is TODAY ccxt-only (`create_exchange` →
  `validate_key_permissions`). sFOX is NOT ccxt → the worker validate/encrypt path needs a
  non-ccxt branch that uses `SfoxClient` (from phase 118) instead of `create_exchange`.
- Invalid/insufficient-permission sFOX key fails CLOSED with honest copy (shared
  `classifyKeyValidationError` → `KEY_AUTH_FAILED`), never false-verified, never a
  "trading permissions" mislabel.
- ONE RED-guarded constraint-widening migration admits `'sfox'` at every `exchange IN (...)`
  CHECK, MCP-applied to the TEST project FIRST, then merges → auto-applies to prod.

Out of scope (later phases): equity reconstruction + backbone + api_verified stamp (120),
static-IP egress (121), add-key wizard UI + e2e (122).
</domain>

<decisions>
## Implementation Decisions

### DB constraint-widen (SFOX-04) — follow the deribit precedent EXACTLY
- Template: `supabase/migrations/20260704200446_deribit_exchange_boundary_checks.sql`. WIDEN
  the SAME 4 columns, add `'sfox'`: `api_keys.exchange`, `compute_jobs.exchange` (PRESERVE the
  nullable `exchange IS NULL OR` form), `strategies.source` (append to the 9-value set),
  `strategy_verifications.source`. Each with a self-verifying DO block that RAISEs if the new
  def is missing `sfox` OR any pre-existing value (fail-loud at apply). Forward-only, no DOWN.
- SKIP (parity-pinned exclusions, same as deribit): `funding_fees` exchange CHECK,
  `position_snapshots` exchange CHECK (both derivative/funding-specific — sFOX is SPOT), and
  the `verification_requests` VIEW + its frozen Phase-19 legacy table (DROP CONSTRAINT on a
  VIEW errors — NEVER touch).
- ⚠️ INVESTIGATE in research: the function-level `terminal-status` allowlist at
  `finalize_terminal_status_param.sql:188` (phase-118 RESEARCH flagged it still at 3 values —
  likely needs `'sfox'` for verification-row creation). Confirm and widen if load-bearing.
- LOCKSTEP (or the parity contract test `src/__tests__/contracts/check-zod-db-check-parity.test.ts`
  fails): add `sfox` to TS `SUPPORTED_EXCHANGES` (`src/lib/closed-sets.ts`) AND the pydantic
  Literals (`schemas.py`, `debug_key_flow.py`, `adapter.py` — grep for the deribit Literal to
  find all sites). The migration + allowlists must land together.
- ⚠️ OPS GATE (carry-forward): MCP-apply the migration to the TEST project
  (`qmnijlgmdhviwzwfyzlc`) BEFORE merge, or RED-guarded SQL tests fail. Merging
  `supabase/migrations/**` to main auto-applies to PROD — founder-watched.

### Worker validate/encrypt — the non-ccxt branch (SFOX-03)
- `routers/exchange.py::validate_key` calls `create_exchange` (ccxt) → `validate_key_permissions`.
  Add a branch: when `exchange == 'sfox'`, use `SfoxClient` to validate (auth + read-only scope)
  instead of the ccxt path. Mirror the honest-copy shape: auth failure → the same
  KEY_AUTH_FAILED classification the TS side expects.
- Read-only scope asserted at the ingestion boundary — the adapter has no write surface
  (structural, from phase 118), and validation must assert the key authenticates for reads.
- Credentials trimmed at the shared chokepoint (the v1.11 dogfood `.trim()` fix) — sFOX creds
  go through the SAME trim/validate/encrypt chokepoint, not a parallel one.

### Key routes (SFOX-03)
- All 3 routes (`validate-and-encrypt`, `create-with-key`, `composite/add-key`) already share
  `classifyKeyValidationError`; sFOX flows through the SAME shared error mapping. Confirm each
  route's exchange allowlist / branch admits `sfox` (they likely read `SUPPORTED_EXCHANGES`).

### Read adapter pull (SFOX-02)
- Use the phase-118 `SfoxClient` (already read-only, Bearer, proxy-seamed) to pull balances +
  trades + transactions. The actual daily-return reconstruction is phase 120 — here it's just
  the read pull + read-only-scope assertion + honest failure.

### Credential shape — Q1 RESOLVED (autonomous, dictated by sFOX auth model; founder may veto)
- sFOX auth is a SINGLE Bearer token (no `api_secret` — confirmed phase-118 RESEARCH). The
  existing key schema/routes require both `api_key` AND `api_secret`. DECISION: a conditional
  carve-out — for `exchange == 'sfox'`, `api_secret` is NOT required; store the Bearer token
  as `api_key`, leave `api_secret` empty/null. Apply the carve-out at the SHARED trim/validate/
  encrypt chokepoint + wherever each of the 3 routes enforces the secret presence — do NOT fork
  a parallel path. Keep the requirement intact for all ccxt exchanges (they still need a secret).
- ⚠️ This relaxes a credential-presence check for one exchange — flag it for the code-review +
  red-team security pass (must not weaken ccxt-exchange validation).

### Read-only scope — A1 RESOLVED (honest copy, fail-loud principle)
- sFOX exposes NO per-key scope endpoint → we CANNOT probe read/trade/withdraw the way ccxt
  `detect_permissions` does. DECISION: read-only is enforced STRUCTURALLY (the phase-118 adapter
  has no order/withdraw/transfer surface). The validate branch returns a permissions shape that
  is HONEST — auth succeeded + connected, NOT a claim that we verified the key is read-scoped.
  The copy must never assert an unobserved "read-only verified" scope (no invented data). A
  `{read: true, trade: unknown, withdraw: unknown}`-style honest shape or equivalent, matching
  how the UI/verification consumes `key_permissions` — confirm the consumer during planning.

### Live prod read — Q3 RESOLVED
- SFOX-02's LIVE prod-account read leg is founder-gated (needs a real sFOX key + likely the
  phase-121 static egress). The unit/mock test carries the phase; the live-read leg closes
  `human_needed` if no un-pinned prod key exists in-session. Do NOT fake a live read.

### Claude's Discretion
- Exact migration filename timestamp (use the current UTC per the timestamp convention).
- Whether the non-ccxt validate branch lives inline in `validate_key` or a small helper.
- The exact honest `key_permissions` shape for sFOX (subject to what the UI/verification consumer expects).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/sfox_client.py` — phase-118 read-only adapter (Bearer, 4 read
  methods, structural read-only, `SfoxApiError` with status semantics: `status==0` = shape/
  transport violation, real status = HTTP error).
- `supabase/migrations/20260704200446_deribit_exchange_boundary_checks.sql` — the migration template.
- `analytics-service/routers/exchange.py` — `validate_key` (27), `encrypt_key` (77); imports
  `create_exchange`, `validate_key_permissions` from `services.exchange`.
- `analytics-service/services/key_permissions.py` `detect_permissions` — the read-only scope
  probe pattern (ccxt-shaped; sFOX needs an analogous read-only assertion).
- `src/lib/wizardErrors.ts` `classifyKeyValidationError` → `KEY_AUTH_FAILED`; used by all 3 routes.

### Established Patterns
- Constraint-widen = DROP + re-ADD with a self-verifying DO block; widening only ADDS a value
  (no row can violate → no backfill). `SET lock_timeout='3s'`.
- Exchange vocab pinned in LOCKSTEP across SQL CHECK ↔ TS `SUPPORTED_EXCHANGES` ↔ pydantic
  Literals; the parity contract test enforces it.
- Fail-closed on invalid key; honest copy; credentials `.trim()`ed at the shared chokepoint.

### Integration Points
- The worker validate path is ccxt-typed (`exchange.id not in EXCHANGE_CLASSES` guards at
  exchange.py:1093) — the sFOX branch must NOT route through `create_exchange`/EXCHANGE_CLASSES.
- Migration → TEST project via MCP first, then merge → prod auto-apply.
</code_context>

<specifics>
## Specific Ideas

- The migration self-verify DO block is the anti-silent-no-op guard — keep it, add `'sfox'` to
  the expected-values array for each of the 4 constraints.
- Grep the deribit `Literal[` / `'deribit'` occurrences across `analytics-service/**/*.py` and
  `src/**/*.ts` to find EVERY lockstep site — miss one → parity test red.
</specifics>

<deferred>
## Deferred Ideas

- Equity reconstruction + `api_verified` stamp + ground-truth parity (phase 120).
- Static-IP egress wiring (phase 121) — `SfoxClient` already has the proxy seam; not wired here.
- Add-key wizard exchange picker + onboarding copy + badge + e2e (phase 122).
</deferred>
