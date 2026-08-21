# Phase 134: MT5SPIKE — Feasibility spike + `Mt5Client` contract - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (engineering-discretion decisions; no user-preference grey areas surfaced)

<domain>
## Phase Boundary

Phase 134 is the v1.15 milestone go/no-go gate. It delivers two separable things:

1. **A buildable, offline-testable `Mt5Client` network-client contract** (MT5GW-02) — the
   worker-side interface that phases 135/136 stub against. This lands in CI with an OFFLINE
   contract test suite green (no live terminal, no broker, no Windows-only import).

2. **A feasibility spike + documented go/no-go** (MT5SPIKE-01) resolving four live-broker
   unknowns against a real broker demo/investor account. The spike HARNESS + runbook + go/no-go
   doc TEMPLATE land in code; the actual live proof legs are `human_needed` (they require
   founder-provided demo credentials: login + investor password + exact server string, plus a
   running gmag11 v2.3 gateway container). A skipped live gate is never claimed done — if the
   founder cannot run the live spike this cycle, the verification records those criteria as
   human_needed, not passed.

NOT in this phase: `mt5` Source registration / key routes (Phase 135), equity reconstruction
(Phase 136), prod gateway hosting decision (Phase 139).
</domain>

<decisions>
## Implementation Decisions

### Mt5Client contract (MT5GW-02)
- **Transport:** pure network client via `mt5linux` (`MetaTrader5(host, port)` over RPyC). The
  worker NEVER imports the Windows-only `MetaTrader5` package in-process — the thin client wraps
  the RPyC proxy behind a narrow, typed interface. This is the same isolation posture as
  SfoxClient owning its aiohttp session.
- **Surface (read-only by construction):** `login(account, password, server)`,
  `account_info()`, `history_deals_get(from_ts, to_ts)`, and `order_check(...)` exposed ONLY for
  the investor-vs-master validate probe. There is NO `order_send` on the contract — read-only is a
  STRUCTURAL property (mirrors the sFOX 119 A1 posture), never a probed scope claim.
- **Return discipline (fail-loud, no invented data):** every read distinguishes `None`
  (RPyC/terminal error → raise typed `Mt5ClientError` carrying the `last_error()` (code, text))
  from `()` (honest empty result). Non-dict/degenerate shapes raise. Mirrors `SfoxApiError`.
- **Timeout-bounded:** every call is wrapped with a transport timeout well under the worker
  healthz budget (mirror `SFOX_REQUEST_TIMEOUT_S`≈30s; env-overridable). The RPyC 60s pipe
  timeout is the known ceiling and is documented as such. A hung terminal must fail loud fast,
  never wedge the sequential worker loop (the v1.11 WEDGE-01 failure class).
- **Materialization:** RPyC returns netref proxies; the contract materializes `account_info` and
  each deal to native Python dicts/JSON before returning, so callers never hold live proxies.
- **Secret hygiene:** login/investor password/server never appear in any exception message or
  log; response/error text scrubbed via `services.redact.scrub_freeform_string` (T-118-01 pattern).

### Offline contract test suite (MT5GW-02, load-bearing CI gate)
- An in-memory RPyC-shaped double (no live terminal, no network, no Windows import) drives the
  contract: login success + auth-fail, `account_info` shape, `history_deals_get` returning
  `None` (→ typed raise) vs `()` (honest empty) vs a populated deal tuple, and the
  `order_check` investor-vs-master distinction. Green in CI so 135/136 can stub against a
  proven contract shape.

### Spike harness + go/no-go (MT5SPIKE-01 — live legs are human_needed)
- A standalone `scripts/mt5_spike.py` the founder runs against a demo account, emitting a
  structured go/no-go report over the four unknowns: (1) unattended Wine auto-login reliability
  (repeated unattended login→read cycles, no human dialog-dismissal), (2) `order_check`-based
  investor-vs-master read-only proof WITHOUT ever calling `order_send`, (3) `history_deals_get`
  deal-reconstruction viability (realized profit/swap/commission/fee + `DEAL_TYPE_BALANCE`
  external flows; None-vs-() honesty), (4) broker-server-time-vs-UTC offset.
- **Escape hatch recorded, never papered over:** if unattended Wine login is no-go, the
  native-Windows-VPS fallback (identical adapter code behind the same `Mt5Client` contract) is
  documented as the escape hatch in the go/no-go doc.
- **Time normalization:** establish the broker-server-time vs UTC offset and document a
  normalization approach so deal day-bucketing lands on the correct calendar day (reuses the
  UTC-day-bucketing precedent from Deribit/sFOX ledger reconstruction).

### Annualization (locked upstream, restated for continuity)
- MT5 stays on the shared traditional √252 basis (`DEFAULT_PERIODS_PER_YEAR = 252`,
  comparability-over-per-asset-divergence, user decision 2026-06-24). No per-asset divergence
  here — this phase does not touch metrics.

### Claude's Discretion
All of the above are engineering-discretion calls grounded in the SfoxClient/IngestionAdapter
conventions and the ROADMAP success criteria. No user-preference grey areas required a decision.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/sfox_client.py` — the read-only, fail-loud, timeout-bounded,
  session-owning client template (`SfoxApiError`, `_request` chokepoint, redact scrubbing,
  `*_TIMEOUT_S` env knobs). `Mt5Client` mirrors its posture over an RPyC transport.
- `analytics-service/services/ingestion/adapter.py` — the `IngestionAdapter` Protocol +
  dataclasses (`ValidationResult`, `Trade`, `Position`, `MetricsSnapshot`, `Fingerprint`,
  `KeySubmissionRequest`, `VerificationResult`) that 135/136 will implement for `mt5`.
- `analytics-service/services/ingestion/sfox.py` — the verbatim seam-clone template 135 follows
  (`SfoxAdapter` → `Mt5Adapter`); fail-loud `compute_metrics`/`fetch_raw` raises for the
  broker-dailies ONE-path.
- `analytics-service/tests/test_mt5_golden_fixtures.py` — prior MT5 EA (Approach A, self_reported)
  golden fixtures pinning the √252 basis; v1.15 is the api_verified successor arc.

### Established Patterns
- Client owns its transport; per-request timeout below the ~90s healthz budget; fail-loud on
  non-2xx / degenerate shape / error sentinel; secrets scrubbed from all output.
- Broker returns → daily series via the ONE backbone (`chain_linked_twr` → `derive_basis_series`),
  never a fill-based `MetricsSnapshot` (BYB-02 corruption class).

### Integration Points
- Worker `validate_key`/`encrypt_key` (Phase 135, `is_mt5` branch) will call `Mt5Client.login` +
  `account_info` + the `order_check` investor probe.
- `services/ingestion/__init__.py` + `adapter.py` `_FACTORIES` registry (Phase 135 lockstep).
</code_context>

<specifics>
## Specific Ideas

- gmag11 v2.3 MT5 gateway container is the reference target (amd64-only, ~4 GB, persistent
  volume) — hosting pick deferred to Phase 139.
- Contract mirrors SfoxClient method-for-method in posture so downstream reviewers read it as
  "the sFOX adapter, over RPyC instead of aiohttp."
</specifics>

<deferred>
## Deferred Ideas

- Actual live-broker feasibility proofs (the four MT5SPIKE-01 unknowns) — `human_needed`, blocked
  on founder demo credentials + a running gateway container. Harness + runbook land now.
- Prod gateway hosting decision (Fly vs Railway vs VPS) — Phase 139.
- `mt5` Source registration, key routes, constraint migration — Phase 135.
</deferred>
