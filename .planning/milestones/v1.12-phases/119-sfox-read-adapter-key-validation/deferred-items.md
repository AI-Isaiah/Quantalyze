# Phase 119 — Deferred / Out-of-Scope Items

## ⏭️ [orchestrator red team, 2026-07-18] Composition-seam findings deferred to Phase 120/122

A connected `'sfox'` key is legally saved by Phase 119, but collides with pre-existing
ccxt-only downstream consumers that only become sfox-aware once Phase 120 ships sfox ingestion.
The credential carve-out itself is SOLID (red team confirmed no security hole). Fixed in
Phase 119: F1 (cron Sentry spam), F4 (transient-failure honesty), F5 (control-char 500).
Deferred (reachable only via direct API — NO UI offers sfox yet; that's Phase 122):

- **F2 → Phase 120 (ingestion) + Phase 122 (UI):** the two wizard routes (`create-with-key`,
  `composite/add-key`) accept sfox and mint a draft + encrypted key, but `finalize-wizard`
  → `internal.py` `create_exchange('sfox')` → ValueError → 502 with a MISLEADING message
  ("Could not verify key scopes" / KEY_NETWORK_TIMEOUT); and `process_key.py` `source: Source`
  Literal excludes sfox (correctly, until 120) → 422. **Phase 120 action:** when sfox ingestion
  lands, the finalize/process path must resolve sfox; until the UI offers sfox (122), an honest
  "sFOX not yet available" rejection at finalize is the interim truth. Do NOT ship a sfox wizard
  card (122) before finalize works (120).
- **F3 → founder disclosure decision:** for sfox, `read_only: true` is STRUCTURAL (adapter has
  no write surface — the locked A1 decision), NOT a probed scope (sFOX has no per-key scope
  endpoint). The allocator UI shows an unconditional "· Read-only ·" label. The platform promise
  "only read-only keys are accepted" means something weaker for sfox specifically. Founder should
  decide whether the sfox connect copy needs an honest "we cannot verify scope; keys are used
  read-only by our adapter" disclosure (Phase 122 copy).
- **F6 → Phase 122 hardening:** WR-01 normalizes the exchange forwarded to the WORKER but the
  allocator client (`AllocatorExchangeManager.tsx:575`) inserts the CLIENT's raw `data.exchange`
  into `api_keys` — a hypothetical mixed-case `"sFOX"` caller gets a 200 validate then a DB 23514
  (lowercase-only CHECK) AFTER burning a live probe. Latent (first-party form lowercases + doesn't
  offer sfox). Phase 122: the client must send/insert canonical lowercase (or the route echoes it).
- **F7 → Phase 120/122:** `debug_key_flow.Broker` + `VerifyStrategyRequest.exchange` admit sfox
  for parity symmetry but every consumer routes through `create_exchange` → ValueError (fail-loud,
  internal/verify-UI-doesn't-offer-sfox). Same admit-at-boundary/unimplemented-behind-it shape as
  F2 — resolved when 120 wires sfox verification/ingestion.

---


## ✅ RESOLVED [orchestrator, 2026-07-18] — ingestion Source-Literal test failures

**Resolution:** Applied option (b) in commit `b82d4d79` — reverted the `'sfox'` add to the
ingestion `Source` Literal (`services/ingestion/adapter.py`) and flipped the boundary-parity
test to pin sfox OUT of `Source` until Phase 120. Rationale: the ingestion `Source` is a
CAPABILITY vocabulary pinned equal to `SUPPORTED_SOURCES`/`_FACTORIES`; its sfox factory is
Phase 120, and the key-save EXCHANGE boundary (`VerifyStrategyRequest.exchange`,
`debug_key_flow.Broker`, the 4 SQL CHECKs) is a distinct concern that DOES admit sfox this
phase. Full analytics-service suite now green (3867 passed, 0 failures). Original report below
for the record.

---

## [119-02 executor, 2026-07-18] Pre-existing ingestion Source-Literal test failures (from 119-01)

**Discovered during:** 119-02 full-suite regression run.

**Failing tests:**
- `analytics-service/tests/test_ingestion_protocol.py::test_literal_types`
- `analytics-service/tests/test_ingestion_deribit.py::test_source_literal_and_registry_agree`

**Root cause:** Commit `ca59a0ba` (119-01, SFOX-04 boundary widen) added `'sfox'` to the
`Source` Literal in `services/ingestion/adapter.py:28`
(`Source = Literal["okx","binance","bybit","csv","deribit","sfox"]`) but did NOT add `'sfox'`
to the ingestion `SUPPORTED_SOURCES` / `_FACTORIES` registry. Both tests assert the `Source`
Literal set equals the registry/expected set, so they now report `'sfox'` as an extra item.

**Why out of scope for 119-02:** 119-02's files_modified are `routers/exchange.py`,
`services/exchange.py`, `tests/test_sfox_validate.py` — none import or affect the ingestion
adapter. The failures predate this plan's first commit (67d93833) and are unrelated to the
non-ccxt validate branch. 119-02 introduces zero new failures.

**Tension to resolve (119-01 / 120 owner decision):** RESEARCH.md lockstep item #11/#96 states
the reconstruction ingestion adapter + `SUPPORTED_SOURCES`/`_FACTORIES` sfox registration is
**phase 120**, and calls the "Source-Literal-without-registry" state "safe" — but the existing
`test_source_literal_and_registry_agree` / `test_literal_types` tests enforce Literal↔registry
agreement, so the state is NOT test-clean. The fix is a 119-01 follow-up: either (a) update the
two ingestion tests' expected sets to include `'sfox'` while the factory stays deferred, or
(b) defer the `Source`-Literal sfox add to 120 alongside the factory. Do NOT silently pass the
suite until this is resolved by the 119-01/120 owner.
