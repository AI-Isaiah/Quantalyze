# Phase 68: Boundary Wiring & Key Validation - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — recommendations auto-accepted per user's standing decide-autonomously directive)

<domain>
## Phase Boundary

"deribit" is accepted at every KEY-SAVING system boundary in lockstep (TS allowlist + display map, pydantic Literals, SQL CHECK migration, parity contract test — ONE PR), and key validation admits only correctly-scoped read-only Deribit keys with honest errors (DRB-02, DRB-03). No wizard UI (Phase 69), no ingestion/funding/dailies (Phase 70), no positions (Phase 71).
</domain>

<decisions>
## Implementation Decisions

### Boundary set — what "every boundary" means in THIS phase
- IN (key-saving surfaces): `src/lib/closed-sets.ts` `SUPPORTED_EXCHANGES` + `exchangeEnum` + display-name map; pydantic `Literal` allowlists (`models/schemas.py`, `routers/debug_key_flow.py`, `services/ingestion/adapter.py`); SQL CHECK constraints on key/strategy-bearing tables (`api_keys`/initial_schema:22, portfolio_intelligence:81, compute_jobs:132, position_snapshots:52) via ONE migration that DROPs + re-ADDs each CHECK re-based on the LATEST definition (⭐grep ALL migrations first — memory rule).
- OUT (funding surfaces, EXPLICITLY EXCLUDED — supersedes the roadmap criterion's "_FUNDING_BUCKET_HOURS entry" line, which predates BYB-02): `_FUNDING_BUCKET_HOURS` gets NO deribit entry and `funding_fees_exchange_check` (20260602180000:59) stays 3-exchange. BYB-02 red-team finding (2026-07-04, PR #577): Deribit funding is continuous (arbitrary intra-hour timestamps) — a floor-bucket entry would silently collapse distinct events, the exact loss class just fixed. Phase 70 flips both TOGETHER with a native-id/exact-ts dedup axis. The guard comment already exists in `funding_fetch.py`.
- The parity contract test asserts BOTH directions: key-boundary allowlists (TS ↔ pydantic ↔ SQL CHECKs) all contain deribit AND the funding surfaces intentionally exclude it (exclusion pinned with a comment pointing at Phase 70, so the flip is conscious, not drift).

### Scope validation (DRB-03)
- Source of truth for scope semantics: the 67-01/67-02 harness (`deribit_ground_truth.py` scope gate) — Deribit `public/auth` response `result.scope` string; required `account:read` AND `trade:read`; ANY `:read_write` (or `wallet:read_write`, `block_trade:read_write` etc.) → reject.
- Rejection errors name the exact problem: write-scope present → "key has write scope '<scope>' — create a read-only key"; missing scope → "key is missing required scope '<name>'". No generic "invalid key".
- Validation lives where the existing per-exchange probes live: `services/key_permissions` + `validate_key_permissions` (exchange.py:895, `read_only` derivation :1073) — add a deribit probe following the established per-exchange pattern; `EXCHANGE_CLASSES` already carries deribit (exchange.py:788).
- 67-03 (live ground-truth run) is BLOCKED on the founder's key: scope-string format is encoded from Deribit docs + the shipped harness; CONTEXT flag: re-verify the exact live scope string when 67-03 runs — Phase 72 acceptance gates re-verify end-to-end regardless. Do not block this phase on 67-03.

### Credential shape
- Deribit = Client ID + Client Secret, NO passphrase (roadmap P69 wording). The boundary accepts passphrase-less deribit keys; confirm api_keys passphrase column nullability at plan time (OKX requires passphrase — the shape check must be per-exchange, not global).

### Testing
- Cross-runtime + SQL parity test in the SAME PR as the wiring (success criterion). Follow the byte-parity pattern from BYB-02 (`test_funding_match_key_sql_parity.py`): pin the SQL CHECK contents by reading the migration file, assert set-equality with TS/pydantic allowlists (vitest + pytest sides).
- Scope-validation tests: write-scope reject, missing-scope reject (each scope individually), compliant LTP-shaped key accept — mocked `public/auth` responses; every rejection asserts the honest error text.
- ⭐wiring-invocation guard (memory HIGH-tackle F1-F12): prove the validator is INVOKED at the key-save call site — a test that fails when the deribit branch is neutered, not just a unit test of the helper.

### Research open questions — RESOLVED (2026-07-04, autonomous)
- **OQ1 honest per-scope errors:** extend the probe result surface ADDITIVELY (scope-naming error fields alongside the existing `{read,trade,withdraw}` triple) — deribit's probe emits the exact missing/offending scope; other exchanges' probes unchanged.
- **OQ2 ingestion Source widening:** `adapter.py Source` / `SUPPORTED_SOURCES` / process_key flow sets do NOT widen this phase (ingestion is Phase 70) — the parity test pins this as an intentional exclusion, same as funding.
- **OQ3 migration targets (live prod schema verified via MCP 2026-07-04):**
  - WIDEN: `api_keys_exchange_check`, `compute_jobs_exchange_check`, `strategies_source_check` (key-created strategies stamp source=exchange).
  - PLANNER DECIDES with lockstep-bias-to-WIDEN: `strategy_verifications_source_check` (verification is a boundary; Phase 72 needs it — widen unless a concrete hazard emerges).
  - STAYS + parity-pinned exclusions: `funding_fees_exchange_check` (BYB-02/Phase 70), `position_snapshots_exchange_check` (Phase 71).
  - NEVER TOUCH: `verification_requests_exchange_check` on `verification_requests_legacy` (Phase 19 frozen table; `verification_requests` is now a VIEW).
- **OQ4 incidental UI exposure:** GATE. User-facing surfaces (marketing "N exchanges" count, public VerificationForm dropdown, filter chips, `PERP_EXCHANGES`/`RECONCILABLE_EXCHANGES` cron sets) must NOT auto-derive deribit from the widened allowlist — decouple them into explicit consts that stay 3-exchange until Phase 69/70 flips each consciously. The wizard `ConnectKeyStep` local list already gates correctly.

### Claude's Discretion
- Exact migration filename/timestamp; whether the CHECK updates are one migration file (preferred — lockstep) or split.
- Display name ("Deribit") and any icon/asset handling in the TS display map.
- Probe implementation details (raw endpoint vs ccxt method) as long as the scope gate matches the harness semantics.
- Shape of the decoupled consts (e.g., `UI_EXCHANGES`, `FUNDING_EXCHANGES`) and where they live in closed-sets.ts.
</decisions>

<canonical_refs>
## Canonical References (full paths — MANDATORY reading for downstream agents)
- `analytics-service/scripts/deribit_ground_truth.py` — the shipped scope-gate semantics (67-01/67-02); the validation logic must match its read-only gate.
- `analytics-service/docs/deribit-ground-truth.md` — recorded-answers TEMPLATE (PENDING LIVE RUN placeholders; 67-03 blocked on founder key). Design against the documented shape; flag every assumption that 67-03 will confirm.
- `analytics-service/services/funding_fetch.py` (~line 205) — the BYB-02 Deribit exclusion guard comment; the parity test pins this exclusion.
- `supabase/migrations/20260602180000_funding_fees_exchange_check.sql` — the funding CHECK that STAYS 3-exchange this phase.
- `analytics-service/tests/test_funding_match_key_sql_parity.py` — the SQL↔runtime parity-pin pattern to follow.
- `.planning/phases/67-deribit-live-harness-exchange-ground-truth/67-CONTEXT.md` — prior phase decisions (credential handling: env/Keychain only, never tracked files).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/closed-sets.ts:32-34` — SUPPORTED_EXCHANGES + derived zod enum + type (single TS source of truth; display map nearby).
- `analytics-service/services/exchange.py:895` `validate_key_permissions` + `services/key_permissions` per-exchange probes; `read_only` derivation at :1073.
- `EXCHANGE_CLASSES` already includes deribit (exchange.py:788) — construction works; only allowlists/validation gate it.
- SQL CHECK sites: initial_schema.sql:22 (api_keys), portfolio_intelligence.sql:81, compute_jobs_queue.sql:132, position_snapshots.sql:52 — each needs the LATEST re-based definition (grep all migrations for later ALTERs before writing the DROP/ADD).
- migration-reviewer agent — run on the CHECK migration before PR (memory rule).

### Integration Points
- Key-save flow: TS wizard → API route → pydantic schema → validate_key_permissions → api_keys INSERT (SQL CHECK last line of defense).
- Supabase migrations AUTO-APPLY to prod on merge to main; test project (qmnijlgmdhviwzwfyzlc) must be caught up before e2e (memory: frontend column-add e2e DB lag).
</code_context>

<deferred>
## Deferred Ideas
- Deribit wizard card + `/security#deribit-readonly` scope guide — Phase 69.
- Funding surfaces (`_FUNDING_BUCKET_HOURS` deribit entry with native-id/exact-ts dedup axis + `funding_fees_exchange_check` update) — Phase 70, flipped together with the parity-test pin.
- Deribit derivative positions (lift f3 Path-B `DeribitNotSupportedError`) — Phase 71.
- OKX funding rows stopped 2026-06-05 (staleness observation from 67-04) — separate investigation, not Deribit scope.
</deferred>

<discussion_log>
[auto] Boundary set — Q: "Does phase 68 include the funding surfaces the roadmap criterion lists?" → Selected: "Exclude funding surfaces; pin exclusion in parity test" (BYB-02 red-team finding supersedes pre-BYB-02 roadmap wording; Rule-7 conflict resolved toward the newer, evidence-backed pattern).
[auto] Scope validation — Q: "Block on 67-03 live scope strings?" → Selected: "Proceed with harness-encoded semantics; flag live re-verify" (67-03 externally blocked; Phase 72 gates re-verify).
[auto] Validation placement — Q: "New module vs existing key_permissions probes?" → Selected: "Existing per-exchange probe pattern" (convention over invention).
[auto] Parity test shape — Q: "New contract test vs extend existing?" → Selected: "Follow test_funding_match_key_sql_parity.py pattern, both runtimes" (established this milestone).
</discussion_log>
