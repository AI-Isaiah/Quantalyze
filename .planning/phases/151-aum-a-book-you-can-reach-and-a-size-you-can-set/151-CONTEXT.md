# Phase 151: AUM — A book you can reach and a size you can set - Context

**Gathered:** 2026-08-07
**Status:** Ready for planning

<domain>
## Phase Boundary

An allocator can always reach their live book, size a hypothetical one directly, and no
venue crashes the holdings sync. Four root-caused defects, all verified with file:line
evidence in REQUIREMENTS.md (AUM-01..05 section):

- **AUM-01** — AUM is derived-only (`scenarioAum` sums only `holding:` scope-refs); a
  blank-slate scenario cannot size or commit. Add a direct AUM input.
- **AUM-02/05** — holdings sync is ccxt-only: `_fetch_spot_rows` calls
  `exchange.fetch_balance()` unconditionally (`allocator_positions.py`), so MT5 stamps a raw
  Python `AttributeError` into the user-visible `sync_error` column on PROD (key
  `46293712-59e6-46c0-8204-5dd32afe2503`), and sFOX carries the identical latent crash
  (`get_balances` not `fetch_balance`). Fix the non-ccxt venue CLASS.
- **AUM-04** — `perKeyDailiesGateSatisfied` is all-or-nothing over every eligible key
  (`allActiveKeysHavePerKeyDailies`, `queries.ts:2854/:3725`); one zero-dailies key hides a
  ~$460k book, and MANAGER-side MT5 keys pin the ALLOCATOR's gate false permanently
  (cross-role contamination). Blank mode structurally forces AUM=0
  (`holdingsSummary = entryMode === "blank" ? [] : rawHoldingsSummary`).
- **AUM-03** — the AUM-zero refusal copy (`ScenarioComposer.tsx:3677`) names a
  live-holding toggle that deliberately does not exist (CONSTIT-03).

Out of scope: the 0.00 metrics (that was SCEN-01, closed in Phase 147 — ⚠️ do NOT plan
AUM-01 as that fix); per-symbol MT5 holdings (guarded by the deliberate client-facade pin
in `tests/test_mt5_client_contract.py` — a separate decision, do not quietly widen);
composer legibility (Phase 152).

</domain>

<decisions>
## Implementation Decisions

### Direct AUM input & sizing (AUM-01 + AUM-03 copy)
- ONE editable AUM field in the composer summary, both modes: blank mode starts empty
  (required to size/commit); book mode pre-fills from the live-holdings sum and stays
  editable as an override.
- Weights remain the single source of truth. Editing AUM keeps weights fixed and rescales
  dollar sizes. The per-strategy dollar figure becomes an INPUT that back-computes
  `weight = amount / AUM` — "allocate $500k to this strategy" is expressible directly.
  ⚠️ Respect the v1.11 weight-basis landmines (sole-unit weight edit → REFUSE not renorm;
  per-key refs invisible to naive diff).
- Manual AUM persists on the draft and is recorded in the scenario commit payload.
- AUM-03 refusal copy names only real affordances: "Set portfolio AUM" (and "or switch to
  'From my book'" when that segment is available). Exact wording Claude's discretion.
  Never mention the nonexistent live-holding toggle.

### Non-ccxt holdings-sync class (AUM-02, AUM-05)
- Explicit venue-capability dispatch in the holdings path (not hasattr duck-typing):
  ccxt venues → `fetch_balance`/`fetch_positions` as today; mt5 → `Mt5Client.account_info()`
  equity → ONE holdings row per account; sfox → `get_balances()`; unknown non-ccxt venue →
  honest skip with a clear, human-readable sync status — NEVER a raw Python exception in
  the user-visible `sync_error` column.
- MT5 concurrency (binding trap): the holdings fetch is a SECOND job kind contending for
  the ONE shared Windows terminal — reuse `_mt5_terminal_lock_for`, the login bracket, the
  bounded-restart helper, and the read-timeout discipline (MT5CONC class). Also the
  `mt5_enabled_server()` kill-switch for parity with the derive arm.
- Non-USD MT5 account currency: USD accounts contribute directly; non-USD accounts get an
  honest skip with a visible note (no invented FX rates — per no-invented-data). FX seam
  deferred to a future phase.
- sFOX proof: the SAME parametrized test shape that covers the MT5 branch passes for
  `SfoxClient` (`get_balances`) BEFORE its go-live flip — the class is proven closed, not
  just the MT5 instance. MT5 client facade pin untouched (no `positions_get` widening).

### Book gate & cross-role contamination (AUM-04)
- Gate semantics: satisfied if ≥1 eligible key has per-key dailies (partial book) —
  replaces the all-or-nothing predicate over every eligible key.
- Manager-key exclusion: keys carrying MANAGER-side strategy-linked series are excluded
  from the ALLOCATOR book-gate eligibility. Role-based, not venue-based — a venue-scoped
  (`exchange === 'mt5'`) exclusion is explicitly the wrong fix class per the roadmap.
- Partial-book display: book mode shows contributing keys; non-contributing keys get an
  honest note ("N keys not yet contributing — no per-key history"), never silent.
- Forced-blank removal: when a book exists, the composer never force-initializes to blank;
  entry mode is the user's choice.

### Claude's Discretion
- Exact refusal-copy wording (within the real-affordances constraint above).
- Where the manager-vs-allocator role distinction is read from (schema reality check —
  planner to confirm the discriminator, e.g. strategy linkage on the key).
- Input component details (formatting, debounce, validation) per DESIGN.md.
- Test file placement; dispatch-table shape in the Python holdings path.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Mt5Client.account_info()` (`analytics-service/services/mt5_client.py:327`) already
  returns equity/balance/currency; the derive path already consumes it (`job_worker.py`).
- `SfoxClient.get_balances()` (`analytics-service/services/sfox_client.py:272`).
- `_mt5_terminal_lock_for`, login bracket, bounded-restart helper, read-timeout discipline
  (`analytics-service/job_worker.py`) — MT5CONC class, reuse wholesale.
- `allActiveKeysHavePerKeyDailies` (`src/lib/queries.ts:2854`) — the gate predicate to
  restructure; consumed at `:3725` with `perKeyDailiesGateSatisfied` on the payload.

### Established Patterns
- Venue dispatch precedent: `_make_exchange_client` (`job_worker.py`) already branches
  ccxt/mt5/sfox — the holdings consumer (`services/allocator_positions.py`) is the side
  that never followed.
- Dual-path CCXT fetch documented at top of `allocator_positions.py` (spot via
  fetch_balance + derivatives via fetch_positions) — extend, don't replace.
- Honest degraded states from Phase 147 (two-state: syncing vs no-data; never fabricate).

### Integration Points
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `scenarioAum` memo,
  commit gate + refusal copy (`:3677`), `holdingsSummary` blank-mode filter, "From my
  book" segment render gate (`canEnterBook`).
- `src/lib/queries.ts` — gate predicate + payload plumbing (both return branches).
- `analytics-service/services/allocator_positions.py` — `_fetch_spot_rows`,
  `fetch_allocator_holdings`; `job_worker.py` `run_poll_allocator_positions_job`.
- Enqueue is venue-agnostic at both triggers (cron jobid 15 `0 4 * * *`, "Sync now" RPC) —
  MT5/sFOX keys already get scheduled; only the fetch crashes.

</code_context>

<specifics>
## Specific Ideas

- Founder verbatim (AUM-01): "I should be able to change AUM, and then the weight changes.
  That is it." — the direct-input causality is the founder's stated model.
- SC wording: "allocate $500k to this strategy" becomes expressible — hence the dollar
  input, not just an AUM field.
- PROD facts to verify against: founder's 8 active keys (bybit 155 dailies, okx 100,
  deribit ×3 = 0, mt5 ×3 = 0); the mt5 key with the raw AttributeError in `sync_error`.

</specifics>

<deferred>
## Deferred Ideas

- Per-symbol MT5 holdings (`positions_get`) — separate decision, guarded by the deliberate
  client-facade pin; would mean consciously re-cutting a trust-integrity fence.
- FX conversion seam for non-USD MT5 account currencies — honest skip for now.

</deferred>
