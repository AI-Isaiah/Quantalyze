# Phase 118: SFOX Research + adapter contract - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Mode:** Autonomous (research/contract phase — decisions are empirical, resolved by sFOX's actual API during plan-phase research; no product-taste grey areas)

<domain>
## Phase Boundary

Answer the genuinely-unknown sFOX questions with evidence, and prove a `SfoxClient`
adapter contract against the live sandbox — BEFORE any prod wiring exists.

In scope:
- RESEARCH.md answering the load-bearing unknown: *can a daily equity/return series be
  reconstructed from what sFOX actually exposes?* (balances, trades, transaction endpoints;
  historical depth, granularity, pagination, rate limits) — with an explicit, evidence-cited
  go / adjust-scope determination.
- A `SfoxClient` adapter contract (auth scheme, endpoint set, base URLs prod vs sandbox,
  rate-limit/pagination behavior) that coexists with the ccxt-typed `EXCHANGE_CLASSES` seam
  WITHOUT pretending sFOX is a ccxt exchange.
- A sandbox-key smoke test that runs GREEN against `api.staging.sfox.com`.

Out of scope (later phases): prod key-route wiring + DB constraint-widen (119), equity
reconstruction onto the backbone (120), static-IP egress (121), add-key UI + e2e (122).
</domain>

<decisions>
## Implementation Decisions

### Adapter shape (empirical — confirm in RESEARCH)
- sFOX is NOT in ccxt → a custom, non-ccxt `SfoxClient`. Do NOT add it to `EXCHANGE_CLASSES`
  (that dict is `dict[str, type]` of ccxt classes). It gets its own dispatch seam that the
  ingestion boundary can select alongside ccxt.
- Language/home: Python, in `analytics-service/services/` alongside the existing exchange
  adapters (this is where reads happen; the worker owns credentials). Async via `aiohttp`
  to match the existing async_support exchange sessions.
- Auth scheme is whatever sFOX documents (HTTP Basic vs Bearer API-token) — RESEARCH pins
  the real one against the live sandbox, not from memory.

### Research rigor
- The reconstruction-feasibility answer is the load-bearing deliverable. If daily equity
  CANNOT be reconstructed from exposed data, that surfaces HERE as a scope decision, cited —
  never papered over into phase 120.
- Cite the actual sFOX API docs (endpoint URLs, payload shapes, pagination cursors) in
  RESEARCH.md, not general knowledge.

### Smoke test
- Green = authentication succeeds AND ≥1 read endpoint returns real payload data against
  `api.staging.sfox.com`. Docs-only is NOT green.
- ⚠️ GATE: requires a sFOX SANDBOX key. If no sandbox credential is available at execute
  time, the smoke test is FOUNDER-GATED (human_needed) — the committed test + contract
  carry the phase; the code must not fake a pass.

### Claude's Discretion
- Exact `SfoxClient` method names, file layout, and test harness structure.
- Whether the smoke test lives as a `scripts/` one-off or a `tests/` skipIf(no-key) test
  (prefer a skipIf test so CI stays green without the sandbox key, mirroring the existing
  live-DB skipIf pattern).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/exchange.py` — `EXCHANGE_CLASSES` (line 784), `create_exchange`
  dispatcher (794), `validate_key_permissions` (895). The ccxt seam `SfoxClient` sits beside.
- `analytics-service/services/key_permissions.py` — `detect_permissions` shim for read-only
  scope assertion; the sFOX read-only enforcement (phase 119) will mirror this.
- `analytics-service/scripts/deribit_ground_truth.py` + `tests/test_deribit_ground_truth.py`
  — the ground-truth/parity pattern phase 120 reuses; worth reading now to shape the contract
  so reconstruction is verifiable.
- Existing async ccxt sessions use `ccxt.async_support`; `aiohttp` session lifecycle patterns
  in `exchange.py` (`aclose_exchange`) are the model for `SfoxClient` open/close.

### Established Patterns
- Read-only enforcement asserted at the ingestion boundary (no order/withdraw ever exercised).
- skipIf(!HAS_LIVE_*) gating keeps live-credential tests out of CI (per DB-test wiring).
- Fail-loud, no invented data — degenerate/absent data raises, never fabricates.

### Integration Points
- Ingestion boundary in the worker selects an adapter by exchange name; today all routes
  through `create_exchange`/ccxt. `SfoxClient` needs a parallel selection path that does NOT
  contaminate the ccxt-typed dict.
- `src/lib/wizardErrors.ts` `classifyKeyValidationError` → `KEY_AUTH_FAILED` is the TS-side
  honest-copy pattern phase 119 extends for sFOX.
</code_context>

<specifics>
## Specific Ideas

- Base URLs: prod `api.sfox.com`, sandbox `api.staging.sfox.com` (confirm exact paths in RESEARCH).
- aiohttp proxy trap (carry-forward, matters for phase 121 but note in the contract now):
  aiohttp ignores `HTTPS_PROXY` without `trust_env` → `SfoxClient`'s session must take an
  EXPLICIT proxy argument. Design the session ctor to accept an optional proxy from day one.
</specifics>

<deferred>
## Deferred Ideas

- Static-IP egress wiring (phase 121) — only the proxy-arg seam is designed here, not wired.
- Actual prod key connect + DB constraint widen (phase 119).
- Equity reconstruction + `api_verified` stamp (phase 120).
</deferred>
