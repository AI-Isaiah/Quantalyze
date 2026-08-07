# Phase 151: AUM — A book you can reach and a size you can set - Research

**Researched:** 2026-08-07
**Domain:** In-repo defect repair across three tiers — React composer state (AUM input + sizing),
Next.js SSR query gate (book-entry eligibility), Python job worker (non-ccxt venue holdings dispatch)
**Confidence:** HIGH (every claim below is `[VERIFIED: codebase]` against live source read this session;
the two PROD-data claims are `[CITED: in-repo census]` and flagged)

## Summary

This phase adds **zero external dependencies**. Every fix is a surgical edit inside existing,
heavily-commented seams. The research work was therefore not "what library should we use" but
"where exactly do the four defects live, what else reads those same values, and what breaks if we
change them naively". Three of the four fixes have a **clean existing seam** that makes them small;
one (AUM-04) has a **blast radius the CONTEXT decision does not mention** and is the single biggest
planning risk in the phase.

The load-bearing discoveries:

1. **AUM-02/05 has an elegant seam that already exists.** `fetch_allocator_holdings` already returns
   `(rows, warning)`, and `run_poll_allocator_positions_job` already maps a non-null `warning` to
   `sync_status='complete_with_warnings'` + `sync_error=warning`. An honest skip is therefore
   `return ([], "…human copy…")` — **no new status, no new plumbing, no frontend change**, exactly
   matching 151-UI-SPEC §4. `aclose_exchange` is *already* MT5- and sFOX-safe. The only genuinely
   new work is the venue dispatch, the MT5 read bracket, and one migration-shaped question about
   the `allocator_holdings` unique index (below).

2. **AUM-04's gate flag is load-bearing in five other places.** `perKeyDailiesGateSatisfied` does
   not only drive `canEnterBook` — it selects the SSR `liveBaselineMetrics` source (the Phase-36/63
   "never a mixed annualization basis inside one curve" honesty invariant), it drives
   `usePerKeySources` (which engine set feeds the projection), it drives the MEMBER-04 membership
   STAMP, and it drives the calm-fallback note. **Relaxing that one boolean in place would silently
   present a 2-of-8-key blend as "your live book".** The gate must be SPLIT.

3. **Manager-key exclusion alone probably fixes the founder's book.** The Phase-149 PROD census
   (recorded in-repo) is 8 active keys → 4 strategies → **exactly 2 bare keys**, and Phase 149
   already shipped the exact role discriminator as a pure, exported, tested function
   (`deriveStrategylessKeys`). The 2 bare keys are almost certainly bybit (155 dailies) + okx (100)
   — meaning after role-based exclusion the *existing* all-or-nothing predicate is already
   satisfied. This reorders the phase's risk: the exclusion is high-value/low-risk, the ≥1
   relaxation is the risky half and can be gated behind its own tests.

4. **Manual AUM cannot ride `size_at_decision_usd`.** The commit route deliberately *stopped*
   trusting the client's dollar figure (NEW-C18-04): the audit trail recomputes size from
   `allocator_holdings`. A manual-AUM commit will land data-correct (the RPC dimensions on
   `percent_allocated` and ignores dollars entirely) but will audit as
   `_size_source: "no_holdings_snapshot"`, size 0. Recording manual AUM must be an ADDITIVE,
   clearly-labelled client-asserted field — never an overwrite of the server-verified number.

**Primary recommendation:** Split the phase into four independently-verifiable slices in this order —
(A) non-ccxt holdings dispatch + honest-skip copy [Python only, no UI]; (B) manager-key exclusion via
the existing Phase-149 discriminator, exposed as a NEW payload field, leaving
`perKeyDailiesGateSatisfied` semantics untouched; (C) partial-book gate + contributing-key narrowing
+ partial-book note; (D) the AUM input, per-strategy dollar input, refusal copy, and draft/commit
persistence. A and D are near-independent; B must land before C.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Direct AUM input & sizing (AUM-01 + AUM-03 copy)**
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

**Non-ccxt holdings-sync class (AUM-02, AUM-05)**
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

**Book gate & cross-role contamination (AUM-04)**
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

### Deferred Ideas (OUT OF SCOPE)
- Per-symbol MT5 holdings (`positions_get`) — separate decision, guarded by the deliberate
  client-facade pin; would mean consciously re-cutting a trust-integrity fence.
- FX conversion seam for non-USD MT5 account currencies — honest skip for now.

**Also out of scope (from `<domain>`):** the 0.00 metrics (SCEN-01, closed in Phase 147 — do NOT
plan AUM-01 as that fix); composer legibility (Phase 152).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUM-01 | Allocator can set AUM directly; weights follow. "Allocate $500k to this strategy" expressible. | §Pattern 4 (AUM as a derived-with-override memo), §Pattern 5 (dollar input → existing `setWeightOverride` path), §Pattern 6 (draft persistence as an OPTIONAL additive field — no schema bump), §Pitfall 7 (commit-audit trust boundary) |
| AUM-02 | MT5 account equity can contribute to AUM; no raw Python exception in `sync_error`. | §Pattern 1 (venue dispatch inside `fetch_allocator_holdings`), §Pattern 2 (MT5 read bracket reuse), §Pattern 3 (honest-skip via the EXISTING `warning` channel), §Pitfall 1 (unique-index collision across 3 MT5 accounts), §Pitfall 2 (duplicate lock registry) |
| AUM-03 | AUM-zero refusal copy names only real affordances. | §Code Example C (copy strings + the two greppable never-strings), §Pitfall 8 (the existing test at `ScenarioComposer.test.tsx:2468` pins the OLD copy) |
| AUM-04 | Allocator with a live book can always reach it; manager keys don't pin the allocator gate. | §Pattern 7 (SPLIT the gate — do not mutate `perKeyDailiesGateSatisfied`), §Pattern 8 (reuse `deriveStrategylessKeys` as the role discriminator), §Pitfall 3 (five other consumers), §Pitfall 4 (`dataSourceKeys` ⊅ contributing keys once the gate is relaxed) |
| AUM-05 | sFOX will not crash holdings sync when its first real key exists. | §Pattern 1 + §Code Example B (the parametrized non-ccxt table), §Open Question 2 (sFOX per-asset USD pricing has no seam in the GET-only facade) |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

| Directive | Source | Consequence for this phase |
|-----------|--------|----------------------------|
| Read `node_modules/next/dist/docs/` before writing Next.js code — this Next.js differs from training data | AGENTS.md | No new routes/route conventions needed; only an additive zod field on an existing `POST` handler. Low exposure, but any new file under `app/` must consult the local docs. |
| Coverage is a **blocking** CI gate: lines 82 / statements 80 / functions 74 / branches 72 (vitest thresholds), merged across shards by the `frontend-coverage` job | CLAUDE.md | New composer branches (blank/book AUM seeding, dollar-input arms, partial-book note) must ship with tests in the same commit or the ratchet fails. |
| `analytics-service/` Python suite enforces `--cov-fail-under=80` | CLAUDE.md | The new non-ccxt dispatch needs branch coverage for mt5 / sfox / unknown / non-USD arms. |
| DESIGN.md is binding; read before any visual decision; flag deviations in QA | CLAUDE.md | 151-UI-SPEC already discharges this — it is the approved contract. Do not re-derive tokens. |
| `mypy --strict` before shipping `analytics-service`; fix via `cast()` not `# type: ignore` | MEMORY / CLAUDE.md | The dispatch touches the `ccxt.Exchange \| SfoxClient \| Mt5Session` union — narrowing MUST use `cast()`/`isinstance`, mirroring `job_worker.py:3480` (`cast(Mt5Session, ctx.exchange)`). |
| `pytest` must be run from `analytics-service/` (VCR cassette dir) | MEMORY | Every Python verification command in the plan must be `cd analytics-service && pytest …`. |
| `.planning/` is TRACKED and the repo is PUBLIC | MEMORY | Do not paste credentials, MT5 logins, or full PROD key rows into plans. The already-published key id `46293712-…` is acceptable precedent; do not add new secrets. |
| Banned packages list | CLAUDE.md | N/A — this phase installs nothing. |

**Project skills:** `.claude/skills/` does not exist in this repo. `[VERIFIED: codebase]`

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Direct AUM value + per-strategy dollar sizing | Browser / Client (`ScenarioComposer` React state) | — | Weights and AUM are draft state; the projection engine runs client-side. No server round-trip exists or is needed for sizing. |
| Manual-AUM persistence across reloads | Browser / Client (localStorage via `scenarioDraftCodec`) | Frontend Server (saved-scenario blob) | The draft is already a client-owned, versioned localStorage blob; saved scenarios persist the same blob server-side. Adding a field follows the `window` / `leverageOverrides` precedent. |
| Manual AUM in the commit record | API / Backend (`POST /api/allocator/scenario/commit` → `commit_scenario_batch`) | Database (audit_log metadata) | Commit is a financial audit event; the audit-trust boundary (NEW-C18-04) means client dollars are a *sidecar*, never authority. |
| Book-entry eligibility (which keys count) | Frontend Server (SSR `getMyAllocationDashboard` in `src/lib/queries.ts`) | Browser (renders from the payload; **never re-derives** — the SoT-mirror rule) | Eligibility needs `api_keys` + `strategies` + `strategy_keys` + `csv_daily_returns`, all owner-scoped SSR reads. The composer's existing contract is "the client never re-derives eligibility". |
| Manager-vs-allocator role discrimination | Frontend Server (SSR query) | Database (`strategies.api_key_id`, `strategy_keys`) | Two link forms live in Postgres; the pure predicate (`deriveStrategylessKeys`) already exists and is unit-tested. |
| Venue-capability dispatch for holdings | Python worker (`analytics-service/services/allocator_positions.py`) | Python worker (`services/job_worker.py` for the MT5 terminal lock) | Credentials, the RPyC terminal, and the sFOX bearer session only exist in the worker process. |
| MT5 terminal serialization | Python worker (module-level lock registry in `services/job_worker.py`) | — | The registry MUST stay the single module-level dict — see Pitfall 2. |
| Human-readable sync copy | Python worker (writes `api_keys.sync_error`) | Browser (`AllocatorSyncStatus` renders it verbatim) | Per 151-UI-SPEC §4 the component is a pass-through; the copy contract is owned by the worker. |

---

## Standard Stack

### Core

**No new libraries. Nothing to install.** `[VERIFIED: codebase]`

Every capability this phase needs already exists in-repo:

| Capability | Existing asset | Location | Why it is the standard |
|------------|----------------|----------|------------------------|
| Dollar validation | `isValidDollar` (bound `[0, 1e12)`) | `src/lib/dollar-validation.ts` | Phase 150 extracted it precisely so a second validator is never minted. |
| USD formatting | `formatUsd` (null → `—`, never `$0`) | `src/lib/dollar-validation.ts` | 150-UI-SPEC: "a second money formatter on this surface is forbidden". |
| Magnitude caps | `MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD` | `src/lib/closed-sets.ts` | Five existing importers; not re-declared in `dollar-validation.ts` by design. |
| Weight clamp + clamp banner | `handleWeightChange` → `scenario.setWeightOverride` / `scenario.applyWeightOverrides` | `ScenarioComposer.tsx:1160-1272` | The dollar input MUST route through this, not fork a second write path. |
| Role discriminator (manager vs allocator key) | `deriveStrategylessKeys` (pure, exported, tested) | `src/lib/queries.ts:342-374` | Phase 149 already solved both link forms; re-deriving would fabricate the exact bug 149 fixed. |
| Eligible-key predicate | `isPerKeyDailiesEligibleKey` | `src/lib/queries.ts:2895-2903` | Cross-language SoT mirror of the Python backfill filter; must stay in lockstep. |
| MT5 equity | `Mt5Client.account_info()` → `{equity, balance, currency, login, …}` | `analytics-service/services/mt5_client.py:327-332` | Already consumed by the derive arm at `job_worker.py:3692-3694`. |
| sFOX balances | `SfoxClient.get_balances()` → `list[{"currency": str, "balance": str, …}]` | `analytics-service/services/sfox_client.py:272-277` | GET-only facade; shape pinned by `tests/test_sfox_client.py:73-79`. |
| MT5 terminal lock | `_mt5_terminal_lock_for(terminal_key)` + `_MT5_TERMINAL_LOCKS` | `analytics-service/services/job_worker.py:382-387` (registry `:379`) | Module-level by design; a per-session lock "serializes NOTHING" (the documented Pitfall-1 anti-pattern). |
| Bounded MT5 restart | `_mt5_bounded_restart(client)` | `analytics-service/services/job_worker.py:332-352` | Comment states it was "kept module-level … because plan 137-02 reuses it" — reuse is the intended contract. |
| Read timeout ceiling | `_MT5_DERIVE_READ_TIMEOUT_S` (`MT5_REQUEST_TIMEOUT_S + 10s`) | `analytics-service/services/job_worker.py:296-298` | FLIPRETRY-01 baseline; derived from the rpyc bound so a retune carries through. |
| Venue kill-switches | `mt5_enabled_server()` / `sfox_enabled_server()` | `analytics-service/services/closed_sets.py:66,107` | Fail-closed, read per-call (never a module const) so a go-live flip needs no reimport. |
| Bounded venue-aware close | `aclose_exchange` — **already** routes `SfoxClient` (`:914`) and `Mt5Session` (`:925`) | `analytics-service/services/exchange.py:872` | The `finally:` in `run_poll_allocator_positions_job` is already venue-safe. No edit needed. |
| Honest-skip channel | `fetch_allocator_holdings` → `(rows, warning)`; handler maps `warning` → `complete_with_warnings` + `sync_error` | `allocator_positions.py:268-303`, `job_worker.py:7203-7212` | Exactly the 151-UI-SPEC §4 contract, already built. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dispatch inside `fetch_allocator_holdings` | Dispatch inside `run_poll_allocator_positions_job` | The handler already imports `allocator_positions` lazily; putting venue logic there would split the holdings concern across two files and make the sFOX/MT5 parametrized test need the whole job-worker stack. `allocator_positions.py`'s own docstring states exception→status mapping lives there "so the handler's error-UX logic is co-located with the worker concern it serves and can be unit-tested without importing the whole job_worker stack" — follow that precedent. |
| Reusing `perKeyDailiesGateSatisfied` with new semantics | A NEW payload field (`bookEntryGateSatisfied` + `contributingApiKeyIds`) | Reuse is 1 line and 5 silent regressions (Pitfall 3). A new additive field is ~10 lines and zero. **Take the new field.** |
| `deriveStrategylessKeys` (allocator = strategyless) | A new `deriveManagerLinkedKeys` | Same data, inverted. Prefer exporting a small shared `deriveStrategyLinkedKeyIds` used by BOTH, so the two views cannot drift. Either way, do not re-implement the two-link-form join. |
| MT5 symbol = account currency | MT5 symbol = account-scoped token | Currency collides across the founder's 3 MT5 accounts (Pitfall 1). |

**Installation:** none.

---

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** `[VERIFIED: codebase]`

Confirmed by reading the locked decisions and every integration point: all work is edits to existing
TypeScript/Python modules plus test files. No `npm install`, no `pip install`, no new
`requirements.in` / `package.json` entry. The slopcheck gate is therefore vacuous here; if the
planner discovers a need for a new dependency, that is a scope change and must run the gate.

---

## Architecture Patterns

### System Architecture Diagram

```
 ┌──────────────────── DAILY CRON (pg_cron jobid 15, 0 4 * * *) ────────────────────┐
 │ enqueue_poll_allocator_positions_for_all_keys()                                  │
 │   SELECT id FROM api_keys WHERE is_active AND sync_status<>'revoked'             │
 │                          AND disconnected_at IS NULL       ← VENUE-AGNOSTIC       │
 └───────────────┬──────────────────────────────────────────────────────────────────┘
                 │  (also: user "Sync now" → request_allocator_holdings_sync RPC)
                 ▼
        compute_jobs(kind='poll_allocator_positions', api_key_id)
                 │
                 ▼
  ┌──────────────────────── PYTHON WORKER (sequential dispatch) ─────────────────────┐
  │ run_poll_allocator_positions_job            job_worker.py:7083                   │
  │   └─ _allocator_key_preflight               :1144   (circuit breaker + decrypt)  │
  │        └─ _make_exchange_client             :996                                 │
  │             ├─ sfox → SfoxClient            ├─ mt5 → Mt5Session                  │
  │             └─ else → ccxt.Exchange                                              │
  │   └─ fetch_allocator_holdings(venue, ex)    allocator_positions.py:268           │
  │        │                                                                         │
  │        │   ★ TODAY: unconditional ccxt calls → AttributeError on mt5/sfox        │
  │        │   ★ PHASE 151: venue-capability dispatch BEFORE any call                │
  │        │                                                                         │
  │        ├─[ccxt]───► _fetch_spot_rows (:138, fetch_balance :154)                  │
  │        │            + _fetch_derivative_rows (:235, fetch_positions)             │
  │        │            → (rows, warning|None)                                       │
  │        ├─[mt5 ]───► mt5_enabled_server()? ──no──► ([], "MT5 integration…")       │
  │        │            └─yes─► async with _mt5_terminal_lock_for(terminal_key):     │
  │        │                      wait_for(to_thread(login→account_info→             │
  │        │                                  login-bracket), TIMEOUT)               │
  │        │                      TimeoutError → _mt5_bounded_restart + transient    │
  │        │                    currency == USD ? ONE spot row(equity)               │
  │        │                                    : ([], "MT5 account currency is …")  │
  │        ├─[sfox]───► get_balances() → USD/stable rows; non-stable → warning       │
  │        └─[else]───► ([], "Holdings sync isn't supported for {venue} yet — …")    │
  │   └─ persist_allocator_holdings  → UPSERT allocator_holdings                     │
  │        ON CONFLICT (allocator_id, venue, symbol, asof)   ← ★ COLLISION RISK      │
  │   └─ UPDATE api_keys SET sync_status = warning ? 'complete_with_warnings'        │
  │                                                : 'complete',                     │
  │                          sync_error  = warning                job_worker.py:7203 │
  └──────────────────────────────────┬───────────────────────────────────────────────┘
                                     ▼
  ┌───────────────── NEXT.JS SSR — getMyAllocationDashboard (queries.ts) ────────────┐
  │ allocator_holdings ──► derivePhase07Fields (:2983) ──► holdingsSummary (:3122)   │
  │ csv_daily_returns  ──► buildPerKeyReturnsByApiKeyId (:2911)                      │
  │ api_keys           ──► isPerKeyDailiesEligibleKey (:2895) ──► eligibleKeyIds     │
  │                                                                                  │
  │  perKeyDailiesGateSatisfied = allActiveKeysHavePerKeyDailies(...)   :2854/:3725  │
  │      ├──► SELECTS liveBaselineMetrics source (per-key blend | emptyDefault) :3756│
  │      └──► rides the payload on BOTH return branches           :3800 and :4224    │
  │                                                                                  │
  │  ★ PHASE 151 ADDS (do not mutate the above):                                     │
  │      strategies + strategy_keys ──► deriveStrategyLinkedKeyIds  (from :342-374)  │
  │      allocatorEligibleKeyIds  = eligibleKeyIds \ strategyLinked                  │
  │      contributingApiKeyIds    = allocatorEligible ∩ keys-with-per-key-dailies    │
  │      bookEntryGateSatisfied   = contributingApiKeyIds.length ≥ 1                 │
  └──────────────────────────────────┬───────────────────────────────────────────────┘
                                     ▼
  ┌───────────────────── BROWSER — ScenarioComposer.tsx ─────────────────────────────┐
  │ canEnterBook = hasLiveBook && bookEntryGateSatisfied            (:848 repoint)   │
  │ entryMode    = useState(canEnterBook ? "book" : "blank")        (:849 unchanged) │
  │ holdingsSummary = entryMode==="blank" ? [] : rawHoldingsSummary (:859 unchanged) │
  │ dataSourceKeys  = apiKeys ∩ contributingApiKeyIds  ← ★ NARROWED (was :2488-2492) │
  │ partial-book note when allocatorEligible \ contributing ≠ ∅     ← ★ NEW          │
  │ usePerKeySources = entryMode==="book" && perKeyDailiesGateSatisfied  ← DECIDE     │
  │                                                                                  │
  │ liveHoldingsSum = Σ holdings whose scope-ref is toggled on      (was scenarioAum)│
  │ manualAum       = draft.manualAumUsd            ← ★ NEW additive draft field     │
  │ scenarioAum     = manualAum ?? liveHoldingsSum  ← ★ single derived value         │
  │      ├──► DrawdownChart USD scaling                              (:3531)         │
  │      ├──► "Illustrative shape only" note gate                    (:4426)         │
  │      ├──► commit refusal + per-row size gate                     (:3675, :3684)  │
  │      ├──► ScenarioCommitDrawer prop                              (:5125)         │
  │      └──► per-strategy dollar input  amount = weight × scenarioAum   ← ★ NEW     │
  │                editing amount → handleWeightChange(ref, amount/scenarioAum)      │
  └──────────────────────────────────┬───────────────────────────────────────────────┘
                                     ▼
  ┌───── POST /api/allocator/scenario/commit  →  commit_scenario_batch RPC ──────────┐
  │ CommitBodySchema (:150)  { diffs[], init_holdings_fingerprint? }                 │
  │      ★ ADD: manual_aum_usd?: number   (additive, optional, bounded)              │
  │ RPC dimensions on percent_allocated — IGNORES size_at_decision_usd entirely      │
  │ AUDIT recompute (:722-905): serverAum ← allocator_holdings; client value kept as │
  │      size_at_decision_usd_client + _size_source sentinel  ← trust boundary       │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended file scope

```
analytics-service/
├── services/allocator_positions.py     # venue dispatch + mt5/sfox/unknown branches + copy
├── services/job_worker.py              # (only if lock helpers must be re-exported/shared)
└── tests/test_allocator_positions.py   # parametrized non-ccxt table (mt5 + sfox + unknown)

src/lib/
├── queries.ts                          # deriveStrategyLinkedKeyIds + 3 new payload fields
├── queries.test.ts                     # pure-predicate falsifiers
└── dollar-validation.ts                # UNCHANGED — reuse isValidDollar / formatUsd

src/app/(dashboard)/allocations/
├── components/ScenarioComposer.tsx     # AUM input, dollar input, refusal copy, gate repoint,
│                                       #   dataSourceKeys narrowing, partial-book note
├── components/ScenarioCommitDrawer.tsx # thread manual AUM into the commit body
├── lib/scenario-state.ts               # OPTIONAL additive draft field + sanitize-on-read
└── lib/scenario-state.test.ts          # codec round-trip + no-reset proof

src/app/api/allocator/scenario/commit/route.ts   # additive zod field + audit sidecar
```

---

### Pattern 1: Venue-capability dispatch at the ONE holdings chokepoint

**What:** A single explicit `venue → fetch strategy` branch at the top of
`fetch_allocator_holdings`, mirroring the precedent `_make_exchange_client` already set for
construction.

**When to use:** Every call. There is exactly one holdings fetch entry point
(`allocator_positions.py:268`), reached from exactly one handler (`job_worker.py:7118`).

**Why not `hasattr`:** CONTEXT locks this explicitly, and it is right — `hasattr(exchange,
"fetch_balance")` would silently re-open the same class of bug the moment a future client grows a
same-named method with different semantics. The venue string is already in hand (`ctx.key_row["exchange"]`,
passed as `exchange_name`).

**Shape (dispatch table, planner's discretion per CONTEXT):**

```python
# analytics-service/services/allocator_positions.py
# Source: pattern mirrors job_worker.py:996 _make_exchange_client (the construction chokepoint)

# The venues whose holdings this path can fetch. A venue absent from BOTH maps
# is an HONEST SKIP, never a crash — the class fix (AUM-02/AUM-05).
_NON_CCXT_HOLDINGS_FETCHERS: dict[str, NonCcxtFetcher] = {
    "mt5": _fetch_mt5_account_rows,
    "sfox": _fetch_sfox_balance_rows,
}

async def fetch_allocator_holdings(
    exchange_name: str, exchange: Any
) -> tuple[list[dict[str, Any]], str | None]:
    fetcher = _NON_CCXT_HOLDINGS_FETCHERS.get(exchange_name)
    if fetcher is not None:
        return await fetcher(exchange_name, exchange)
    if not _is_ccxt_venue(exchange_name):          # closed-set membership, not isinstance
        return ([], UNSUPPORTED_VENUE_SYNC_NOTE.format(venue=display_name(exchange_name)))
    # ...existing ccxt dual-path body, BYTE-UNCHANGED...
```

⚠️ `_is_ccxt_venue` should read a **closed set**, not `isinstance(exchange, ccxt.Exchange)` — the
whole point is that an unknown *venue string* (a future non-ccxt venue added to
`_make_exchange_client`) skips honestly. `services/closed_sets.py` is the established home for such
sets. `[VERIFIED: codebase]`

---

### Pattern 2: MT5 read inside the SAME terminal lock the derive arm uses

**What:** Wrap `login → account_info → login-bracket` in `asyncio.to_thread`, bound it with
`asyncio.wait_for`, and hold `_mt5_terminal_lock_for(client.terminal_key)` for the entire
terminal-IPC region including the restart branch.

**Reference implementation (read it, do not re-invent):** `job_worker.py:3480-3600`. The structure
is: kill-switch gate → `cast(Mt5Session, exchange)` → `_assert_expected_login` closure → `_mt5_read`
sync closure → `async with _mt5_terminal_lock_for(...)` → `wait_for(to_thread(...))` → `except
asyncio.TimeoutError` (bounded restart + transient) → `except Mt5AccountMismatchError` (transient,
never stamp) → `except Mt5ClientError` (classify).

**The holdings read is strictly SHORTER than the derive read** — it needs only
`login → account_info`, no `history_deals_get`. Recommendation: still keep the POST login bracket
(a second `account_info()` re-read) because the holdings read now runs on the same shared terminal
as the derive job and the cross-process gap is unchanged; but note that with only ONE economic read
the PRE bracket alone is nearly sufficient. Planner call — document whichever is chosen.

⚠️ **Import direction.** `allocator_positions.py` is imported *lazily inside the handler*
(`job_worker.py:7101-7105`) precisely to avoid a cycle. If the MT5 branch lives in
`allocator_positions.py`, it must NOT `import services.job_worker` at module scope. Two viable
shapes, both acceptable:

- **(a) Extract-and-share (preferred, root fix):** move `_MT5_TERMINAL_LOCKS`,
  `_mt5_terminal_lock_for`, `_mt5_bounded_restart`, `_MT5_DERIVE_READ_TIMEOUT_S`,
  `_MT5_RESTART_TIMEOUT_S`, and `_Mt5PostReadVerificationError` into a new
  `services/mt5_concurrency.py`; `job_worker.py` re-imports them so its existing call sites are
  byte-unchanged. **The registry dict must move, not be copied.**
- **(b) Lazy import inside the branch:** `from services.job_worker import _mt5_terminal_lock_for`
  *inside* the async function. Works, but imports a private symbol across a module boundary and is
  fragile to a future rename.

---

### Pattern 3: Honest skip = the existing `warning` channel (zero new plumbing)

**What:** `return ([], "<human copy>")` from `fetch_allocator_holdings`.

**Why it works, verbatim from the code:** `job_worker.py:7203` →
`final_status = "complete_with_warnings" if warning else "complete"`, then
`{"sync_status": final_status, "sync_error": warning, "last_sync_at": now()}`.
`AllocatorSyncStatus.tsx:253` → `else if (normalized === "error" || normalized ===
"complete_with_warnings") helperText = syncError ?? ""`. So a worker-written warning string is
rendered verbatim in the `role="status" aria-live="polite"` helper under a **"Synced (warnings)"**
amber pill — exactly what 151-UI-SPEC §4 asks for, with **no frontend change**. `[VERIFIED: codebase]`

**Contrast with the failure path:** any raised exception routes to `job_worker.py:7154-7170` →
`classify_exception(exc)` → the generic fall-through returns `str(exc)` → `sync_error` gets
`"'Mt5Session' object has no attribute 'fetch_balance'"`. That is the PROD defect. Every
venue-specific exception (`Mt5ClientError`, `Mt5AccountMismatchError`, `SfoxApiError`) must be
caught **inside** the venue branch and converted to human copy before it can reach that arm.

**Minor honesty wrinkle to decide:** a skip returns DONE, so `stamp_first_sync_success`
(`job_worker.py:7268`) fires for a key that synced nothing. Low stakes (it only gates a PostHog
onboarding event) but should be a conscious call.

---

### Pattern 4: AUM as ONE derived value with a manual override

**What:** Rename the current sum to `liveHoldingsSum`, keep it byte-identical, and derive:

```ts
// ScenarioComposer.tsx — replaces the body at :3581-3592 (memo itself unchanged)
const liveHoldingsSum = useMemo(() => { /* existing toggle-scan, unchanged */ }, [...]);
// AUM-01: the ONE scenario AUM. Manual value wins in BOTH modes; blank mode has no
// live sum at all (holdingsSummary is [] by construction at :859), so manual is the
// only source there. Book mode SEEDS the input from liveHoldingsSum but the input
// remains authoritative once present — the 151-UI-SPEC override contract.
const scenarioAum = manualAumUsd ?? liveHoldingsSum;
```

Every one of the five existing `scenarioAum` consumers then keeps working unchanged
(`:3531` drawdown scaling, `:3675` refusal, `:3688` per-row size, `:4426` illustrative note,
`:5125` drawer prop). The `:4426` note ("Illustrative shape only — no live capital connected")
disappears automatically once manual AUM > 0, which 151-UI-SPEC records as the intended behaviour.

**Seeding rule:** book mode pre-fills the *input* (state), it does not make the input a controlled
mirror of `liveHoldingsSum`. Use the established one-time-seed-with-touched-ref idiom already in
this file for the coverage window (`windowTouchedRef`, `:1155-1157`) so a live-holdings refresh
never re-snaps a user's typed AUM.

---

### Pattern 5: Per-strategy dollar input back-computes weight through the EXISTING path

**What:** `amount = weight × scenarioAum` at rest; on edit,
`handleWeightChange(ref, amount / scenarioAum)`.

**Why this exact routing (binding):** `handleWeightChange` (`:1160`) is where the >1 clamp banner
lives (`:1176`), where the mixed-book renormalization basis is chosen (`:1226-1240`), and where the
**sole-unit refusal** lives (`:1250-1253`: *"A single constituent is always 100%."*). Forking a
second weight-write path for dollars would bypass all three — that is exactly the v1.11 landmine
CONTEXT flags. 151-UI-SPEC §2 restates it as binding.

**Guards the planner must specify:**
- `scenarioAum <= 0` → the dollar field is a read-only `—` (per UI-SPEC, with BOTH `title` and an
  `sr-only` span). Never divide by zero, never render `$0`.
- Non-finite `amount` → the existing non-finite arm already handles it once divided; still validate
  at the input boundary with `isValidDollar`.
- Round-tripping: `weight × AUM` displayed as whole dollars then re-divided introduces a rounding
  drift. Decide and document: display rounds, but the *stored* weight only changes when the user
  actually edits (do not write back the rounded value on every render).

---

### Pattern 6: Manual AUM as an OPTIONAL, ADDITIVE draft field — no schema bump

**What:** `manualAumUsd?: number` on `ScenarioDraft`.

**Precedent (three existing fields do exactly this):** `userWeightOverrides?`,
`leverageOverrides?`, `window?` — all documented in `scenario-state.ts:112-145` as
"Optional + additive … so no schema_version bump". `SCENARIO_SCHEMA_VERSION` stays 4.
`[VERIFIED: codebase]`

⚠️ **Do NOT add a zod `.refine()` for the range.** The file states it explicitly for
`leverageOverrides`: *"NO range refine (a refine failure = draft-deleting reset; sanitize-on-read
via sanitizeLeverageMap instead)"* (`scenario-state.ts:131-135`). A refine on a corrupt stored AUM
would silently delete the user's entire saved scenario. Sanitize on read: non-finite / negative /
≥ `MAX_DOLLAR_VALUE_USD` → drop to `undefined`.

---

### Pattern 7: SPLIT the gate — add fields, never mutate `perKeyDailiesGateSatisfied`

**What:** Emit three new payload fields alongside the untouched existing one:

```ts
// src/lib/queries.ts — near :3725, on BOTH return branches (:3800 and :4224)
const strategyLinkedKeyIds = deriveStrategyLinkedKeyIds(ownStrategies, strategyKeyLinks);
const allocatorEligibleKeyIds = eligibleKeyIds.filter((id) => !strategyLinkedKeyIds.has(id));
const contributingApiKeyIds = allocatorEligibleKeyIds.filter(
  (id) => (perKeyReturnsByApiKeyId[id]?.length ?? 0) > 0,
);
const bookEntryGateSatisfied = contributingApiKeyIds.length > 0;
// perKeyDailiesGateSatisfied: UNCHANGED, still all-or-nothing, still selects
// liveBaselineMetrics (the Phase 36/63 mixed-basis honesty invariant).
```

**Why:** `perKeyDailiesGateSatisfied` currently has FIVE consumers (see Pitfall 3). Only ONE of them
(`canEnterBook`) is in this phase's scope. A relaxed value flowing into `liveBaselineMetrics`
selection would present a 2-of-8-key blend as "your live book" on the Overview KPI strip — a
silent honesty regression in the exact area Phase 63 ENGINE-04 hardened.

**Both return branches:** `getMyAllocationDashboard` returns twice (`:3800` in the `!portfolio`
branch, `:4224` in the main branch). Existing per-key fields are duplicated across both. A new field
added to only one branch would be `undefined` for fresh allocators. The composer's `?? []` /
`?? false` fallbacks would mask it — so this must be a checklist item, not a hope.

---

### Pattern 8: The role discriminator already exists — reuse the two-link-form join

**What:** A key is MANAGER-side iff it is linked to a **live (non-archived)** strategy via
`strategies.api_key_id` (direct) **OR** `strategy_keys.api_key_id` (composite).

**Source of truth:** `deriveStrategylessKeys` (`src/lib/queries.ts:342-374`) and its data loader
`getStrategylessActiveKeys` (`:392`). Its docstring documents the exact trap:

> "an `api_key_id`-only anti-join fabricates 3 spurious placeholders on the founder's own account
> (PROD census 2026-08-05: 8 active keys → 4 strategies → exactly 2 bare keys)"

and the archived ruling (W-4, 2026-08-05): *"archived strategies are NOT coverage."*

**Recommended refactor:** extract the `covered` Set construction (`:350-364`) into an exported pure
`deriveStrategyLinkedKeyIds(ownStrategies, strategyKeyLinks): Set<string>`, and have
`deriveStrategylessKeys` call it. Then the dashboard gate and `/my-strategies` share ONE join and
cannot drift.

⚠️ **New SSR reads required.** `getMyAllocationDashboard` currently reads `strategies` but **not**
`strategy_keys`. And `strategy_keys` is **not in `database.types.ts`** — `getStrategylessActiveKeys`
works around this with a narrowed one-off client builder (`queries.ts:406-419`) and logs the type
regeneration as deferred. The dashboard query needs the same workaround (or the deferred
regeneration finally done). This is real, non-obvious work — budget for it.

---

### Anti-Patterns to Avoid

- **`exchange === 'mt5'` as the manager-key predicate.** Explicitly named the wrong fix class by
  ROADMAP and CONTEXT. It would also be *wrong*: the founder's 3 deribit keys are equally
  manager-side (Alpha Centauri, the 3-key composite), and a future manager-side bybit key would slip
  straight through.
- **Widening the `Mt5Client` facade.** `tests/test_mt5_client_contract.py:747-763` pins the public
  surface to exactly `{login, account_info, history_deals_get, order_check, close, restart}`, plus a
  parametrized `not hasattr` pin including `positions_get` (`:719-737`) and a no-`__getattr__` pin
  (`:741-745`). Account equity via `account_info()` is fully sufficient; touch nothing else.
- **A second `_MT5_TERMINAL_LOCKS` dict.** See Pitfall 2 — it serializes nothing.
- **Trusting a client-supplied AUM in the audit trail.** NEW-C18-04 exists specifically because
  "a malicious allocator could write any number and have it land in audit forever".
- **Pre-filling the blank-mode AUM input with `0`.** 151-UI-SPEC: "never pre-filled `0` — a zero is
  a claim". Same family as the `formatUsd(null) → "—"` rule.
- **Colouring the partial-book note amber.** 151-UI-SPEC gates it muted: a key that will never
  contribute is a steady state, not a recoverable transient.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Is this key manager-side?" | A fresh `strategies` anti-join | `deriveStrategylessKeys` / extracted `deriveStrategyLinkedKeyIds` (`queries.ts:342`) | Two link forms + the archived ruling. A naive version fabricates 3 phantom bare keys on the founder's own account — the documented Phase-149 bug. |
| Dollar validation / formatting | A local `parseFloat` + `toFixed(0)` | `isValidDollar` + `formatUsd` (`src/lib/dollar-validation.ts`) | Phase 150 extracted both to kill duplicates; 150-UI-SPEC forbids a second money formatter on this surface. |
| Weight clamping + the clamp banner | A dollar-specific clamp | `handleWeightChange` (`ScenarioComposer.tsx:1160`) | Owns the >1 banner, the mixed-book basis choice, and the sole-unit refusal. |
| Serializing the MT5 terminal | A new lock / a session attribute | `_mt5_terminal_lock_for` (`job_worker.py:382`) | Documented: a Session-attached lock is a fresh object per job and "serializes NOTHING". |
| Bounding a wedged MT5 terminal | Bare `try/except` around the read | `wait_for(to_thread(...), _MT5_DERIVE_READ_TIMEOUT_S)` + `_mt5_bounded_restart` | The v1.11 WEDGE-01 class: heavy blocking work on the shared loop froze `/healthz` in PROD. |
| Closing a non-ccxt client | `try: await exchange.close()` | `aclose_exchange` (`exchange.py:872`) | **Already** routes sFOX (`:914`) and MT5 (`:925`). The `finally:` at `job_worker.py:7147` needs no edit. |
| Mapping a skip to a UI state | A new `sync_status` value | The existing `(rows, warning)` return + `complete_with_warnings` | 151-UI-SPEC §4 explicitly forbids widening the status set. |
| Persisting a new draft field | A `schema_version` bump | An OPTIONAL additive field, sanitize-on-read | Three precedents in the same file; a bump drops every user's saved draft. |
| A per-venue error→status table | New mapping logic | `_map_exception_to_sync_status` (`allocator_positions.py:122`) for ccxt; human copy for non-ccxt | The ccxt table stays; non-ccxt venues must never reach the generic `str(exc)` arm at all. |

**Key insight:** this codebase's defects are almost never missing abstractions — they are *existing*
abstractions that one consumer failed to adopt (`_make_exchange_client` grew two non-ccxt venues
while its holdings consumer stayed ccxt-only) or that one flag over-serves (one boolean doing five
jobs). The correct move is nearly always "route through the existing seam" or "split the
overloaded value", not "write a new helper".

---

## Runtime State Inventory

*Included because AUM-02 changes what the worker WRITES to a live PROD table and a live PROD column
already carries a stale bad value that no code change will clear by itself.*

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `api_keys.sync_error` on PROD key `46293712-59e6-46c0-8204-5dd32afe2503` currently holds the raw string `"'Mt5Session' object has no attribute 'fetch_balance'"` (`sync_status='error'`). Deploying the fix does **not** rewrite it — the value only changes on the key's **next successful sync** (cron jobid 15 at 04:00 UTC, or a user "Sync now"). Two of the founder's three MT5 keys plausibly carry the same string. | Post-deploy: trigger "Sync now" (or wait one cron cycle) and re-check the column. Add this to the phase VERIFICATION as a post-merge PROD step, not an in-phase test. |
| **Stored data** | `allocator_holdings` will receive a NEW row shape (mt5 account-equity rows). The unique index `(allocator_id, venue, symbol, asof)` has no `api_key_id` — see Pitfall 1. | Decide the MT5 `symbol` token BEFORE first write; a bad choice silently collapses 3 accounts into 1 and is hard to detect after the fact. No DDL change is strictly required if the symbol is account-scoped. |
| **Live service config** | pg_cron jobid 15 (`0 4 * * *`) already fans out to every active key including mt5/sfox — **no cron change needed**. `[VERIFIED: migration 20260422101911:174-220]` | None. |
| **Secrets / env vars** | `MT5_ENABLED` (worker) is already `true` in PROD per v1.15; `SFOX_ENABLED` is OFF. `MT5_GATEWAY_HOST` is set. No new env var is required unless the planner adds a separate holdings-read timeout knob. | None, unless a new `MT5_HOLDINGS_READ_TIMEOUT_S` is introduced — then it needs a Railway var (with a safe default so the unset case works). |
| **OS-registered state** | The single Windows MT5 terminal (one gateway, one process) is now contended by **two** job kinds instead of one. No re-registration needed; the risk is contention, not registration. | Covered by Pattern 2 (same lock registry). |
| **Build artifacts** | None — no package rename, no `pyproject.toml` change. | None. |
| **Client-side stored state** | `localStorage["allocations.scenario_v0_15.{allocatorId}"]` — existing drafts predate `manualAumUsd`. With the additive-optional pattern they decode "ok" with the field absent. | Verify with a codec round-trip test that a v4 blob WITHOUT the field decodes `ok` (not reset) — this is the exact class of bug Phase-59 Pitfall 1 names ("reusing the reset-on-mismatch path would SILENTLY DELETE every saved scenario"). |

---

## Common Pitfalls

### Pitfall 1: Three MT5 accounts collapse into one holdings row
**What goes wrong:** `allocator_holdings` has `UNIQUE (allocator_id, venue, symbol, asof)` —
**`api_key_id` is not in the key** (`migration 20260420073003:146-148`). If every MT5 account writes
one row with the same `symbol` (e.g. the account currency `"USD"`), the founder's three MT5 accounts
upsert over each other and AUM reflects **one** account. `persist_allocator_holdings` stamps
`api_key_id` on the row, so the surviving row's attribution also flips non-deterministically.
**Why it happens:** the index was designed for per-asset ccxt rows where one asset per venue per day
is the correct grain. An account-level row breaks that assumption.
**How to avoid:** make `symbol` account-scoped. ⚠️ **Hard constraint:** `symbol` must match
`[A-Za-z0-9_-]+` — the commit route's `HOLDING_REF_RE`
(`/^holding:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:(spot|derivative)$/`, `route.ts:81`) and
`buildHoldingRef` both depend on it, and the holdings fingerprint tokens are `symbol:venue:holding_type`.
So **no colons, no slashes, no spaces**. Candidates: `ACCOUNT-{mt5_login}` (readable, but surfaces
the broker account number in the Holdings UI and in scope-refs) or `ACCOUNT-{api_key_id[:8]}`
(non-secret, stable, opaque). Recommend the latter unless the founder wants readability.
**Warning signs:** two MT5 keys, only one holdings row after a sync; AUM lower than the sum of the
terminal equities; `api_key_id` on the row changing between syncs.

### Pitfall 2: A duplicated terminal-lock registry serializes nothing
**What goes wrong:** defining a fresh `_TERMINAL_LOCKS: dict[str, asyncio.Lock] = {}` in
`allocator_positions.py` gives the holdings job a *different* Lock object than the derive job for
the same terminal — the two job kinds then run concurrently against the ONE Wine terminal.
**Why it happens:** it looks like a local implementation detail. The existing comment
(`job_worker.py:361-372`) names this the "Pitfall-1 anti-pattern" for the Session-attribute variant;
a second module-level dict is the same failure with a different shape.
**How to avoid:** ONE module-level registry, shared by import (Pattern 2 option (a) or (b)).
**Warning signs:** a test that asserts serialization passes because both jobs use the same module —
write the test so it asserts the two *call sites* obtain the **identical Lock object**
(`is` comparison), not merely that a lock was acquired.

### Pitfall 3: `perKeyDailiesGateSatisfied` has five consumers, not one
**What goes wrong:** relaxing the predicate in place changes all of them silently.
**The five (all `[VERIFIED: codebase]`):**
1. `queries.ts:3756-3761` — selects `liveBaselineMetrics` source. Relaxed ⇒ a partial blend is
   presented as the whole live book on the Overview KPI strip. Directly contradicts the documented
   invariant *"never a mixed annualization basis inside one curve — honesty over coverage"*.
2. `ScenarioComposer.tsx:848` — `canEnterBook`. **The only one in scope.**
3. `ScenarioComposer.tsx:2406-2407` — `usePerKeySources`, which selects the whole engine strategy set
   (per-key + added vs added-only).
4. `ScenarioComposer.tsx:1627/:1657/:1946/:1966` — MEMBER-04 membership derive/stamp and the
   reopen→Update fingerprint seam.
5. `ScenarioComposer.tsx:2482-2485` — `showDataSourcesFallback`, the calm "connected keys don't have
   a per-key series yet" note; it is gated on `!gate`, so relaxing the gate would delete the note in
   exactly the partial-book case where it is still partly true.
   Also `ScenarioComposer.tsx:1511` gates the mode-switch handler on the same flag.
**How to avoid:** Pattern 7 — new fields, old flag untouched. Then decide consumer 3 explicitly:
does book mode with a partial book use the per-key engine set? (Recommendation: **yes**, gate
`usePerKeySources` on the new `bookEntryGateSatisfied` — otherwise "From my book" renders with an
added-only engine, i.e. an empty projection, which is a worse dead end than the current refusal.)
Consumers 1 and 4 must stay on the OLD flag.

### Pitfall 4: A relaxed gate breaks the `dataSourceKeys` ≡ contributing-keys invariant
**What goes wrong:** `dataSourceKeys = apiKeys ∩ eligibleApiKeyIds` (`:2488-2492`) renders one toggle
row per key. Under the all-or-nothing gate, whenever `usePerKeySources` is true **every** eligible
key has a series, so every rendered row has an engine unit behind it. Relax the gate and the
zero-dailies keys (the founder's 3 deribit + 3 mt5) still render toggle rows — but
`perKeyAdapterOutput` filters to `perKeyReturnsByApiKeyId` (`:2392-2396`), which has no entry for
them. Result: rows whose weight input shows `0.000`, whose toggle does nothing, and whose
`blendShareByRef` lookup misses. Worse, `bookEquity` (`:2515`) sums `equityByApiKeyId` over
`dataSourceKeys`, so the notional column would use a different basis than the engine.
**How to avoid:** narrow `dataSourceKeys` to `contributingApiKeyIds`, and render the excluded ones
as the **partial-book note** (151-UI-SPEC copy: `"{N} of {M} keys not yet contributing — no per-key
history yet."`). Note the counts are over **allocator-eligible** keys only — a manager key must
never be counted as "not yet contributing", because it never will.
**Warning signs:** a per-key row with weight `0.000` that cannot be edited to anything meaningful;
`bookEquity` ≠ Σ engine unit equities.

### Pitfall 5: The manager-key exclusion changes the gate but NOT the AUM
**What goes wrong:** `holdingsSummary`/`scenarioAum` come from `allocator_holdings`, which is
populated for **every** active key — including manager-side ones. After AUM-02 lands, MT5
**manager-strategy** account equity flows into the allocator's book AUM, while those same keys are
excluded from the book gate and from the partial-book note counts. That asymmetry is defensible
(the capital is the user's, regardless of whether the key also backs a published strategy) but it is
a **decision**, and if it is not made deliberately the note will say "2 of 2 keys contributing"
while the AUM visibly includes money from six other accounts.
**How to avoid:** make it an explicit, commented decision in the plan. Recommended framing:
*"AUM is custody (all keys); the gate is modelling capability (allocator keys with per-key
history)."* Then make sure no copy claims the AUM is "from these N keys".

### Pitfall 6: `usePerKeySources` + blank mode + manual AUM = a weight-basis interaction
**What goes wrong:** `handleWeightChange` branches on `isMixedPerKeyBook`. In blank mode with manual
AUM there are no per-key units, so the added-only branch applies and a **sole** added strategy keeps
its raw typed weight (deliberately NOT renormalized to 1.0, `:1207-1213`). The dollar input then
reads `weight × AUM`, which for a sole added strategy at weight 0.4 shows 40% of AUM — correct, but
easy to mistake for a bug. Conversely, in a **mixed** book a sole selected engine unit triggers the
refusal *"A single constituent is always 100%."* — which the dollar input inherits and which is the
right behaviour but produces a surprising message from a dollar field.
**How to avoid:** do not "fix" either behaviour. Pin both with tests, and make sure the refusal
message surfaced from a dollar edit still reads sensibly (it does — it is about allocation, not
weights).

### Pitfall 7: Manual AUM in the commit payload must not touch the verified size
**What goes wrong:** the obvious implementation ("send `size_at_decision_usd` computed from manual
AUM") already happens today and is already *ignored* for data — but the audit path
(`route.ts:846-872`) will record `serverSizeUsd = 0` with `_size_source: "no_holdings_snapshot"`
for a blank-mode manual-AUM commit, because there are no holdings rows. Someone reading that audit
row later sees a $0 allocation.
**How to avoid:** add `manual_aum_usd` as an **additive optional** field on `CommitBodySchema`
(`route.ts:150`; the object is non-strict, so an unlisted field is silently *dropped*, not rejected
— it must be declared to survive), and add a **sixth** `_size_source` sentinel, e.g.
`"client_manual_aum"`, that records `size = percent_allocated × manual_aum_usd / 100` **labelled as
client-asserted**. Never overwrite `size_at_decision_usd` with an unverified number under a
server-sounding sentinel. The `_size_source` comment block at `:889-896` enumerates the states — it
must be updated in the same edit or it becomes a lie.

### Pitfall 8: Existing tests pin the old behaviour
**What goes wrong:** `ScenarioComposer.test.tsx:2468` asserts
`/portfolio AUM is zero/i` on the refusal alert. Changing the copy (AUM-03) fails it. This is a
correct failure — but the test must be **rewritten to assert the new invariants**, not deleted:
the new copy must contain "Set portfolio AUM", and must NOT contain `toggle on a live holding` or
`Connect an exchange API key` (151-UI-SPEC names both as greppable never-strings).
**Also expect churn in:** `src/lib/queries.test.ts` (new payload fields on both return branches),
`src/lib/queries.my-allocation.test.ts`, `analytics-service/tests/test_allocator_positions.py`
(the dispatch changes the call shape for every existing ccxt test — they mock
`mock_exchange.fetch_balance`, and the dispatch must still reach it for `binance`/`bybit`/`okx`).

### Pitfall 9: `[ASSUMED]` — sFOX per-asset balances have no USD price seam
**What goes wrong:** `get_balances()` returns `[{"currency": "USD", "balance": "10"}, …]` — string
quantities, **no USD value**. The `SfoxClient` facade is GET-only with exactly four read methods
(`get_balances`, `get_transactions`, `get_trades`, `get_balance_history`) and **no ticker endpoint**.
So a BTC balance on sFOX cannot be priced without introducing a cross-venue price source.
**How to avoid:** mirror the locked MT5 non-USD rule — USD and stablecoin balances contribute at
`mark_price = 1.0` (reuse `STABLECOINS` from `services/closed_sets.py`, already imported by
`allocator_positions.py`); non-stable assets get an honest warning note. This keeps the *class*
closed (no crash, human copy) which is what AUM-05 requires, and defers pricing with the same
no-invented-data discipline. See Open Question 2.

---

## Code Examples

### A. MT5 account-equity row (the shape `persist_allocator_holdings` expects)

```python
# Column contract from migration 20260420073003:89-131.
# holding_type CHECK IN ('spot','derivative'); side CHECK IN ('long','short','flat');
# mark_price NOT NULL; quantity NOT NULL; value_usd NOT NULL.
{
    "venue": "mt5",
    "symbol": account_token,          # ⚠️ MUST match [A-Za-z0-9_-]+  (HOLDING_REF_RE)
    "holding_type": "spot",           # cash-like account equity
    "side": "flat",                   # spot semantics, per the DDL comment
    "quantity": equity,               # USD account ⇒ quantity == value
    "value_usd": equity,
    "entry_price": None,              # NULL for spot per D-02
    "mark_price": 1.0,                # USD-denominated
    "unrealized_pnl_usd": None,       # available as equity-balance, but NULL keeps spot semantics
    "cost_basis_usd": None,
    "raw_payload": _cap_raw_payload({"currency": ccy, "equity": equity, "balance": balance}),
}
```
Note `equity − balance` is the directly-observable floating-uPnL wedge (`job_worker.py:3686-3689`);
whether to expose it as `unrealized_pnl_usd` on a `spot` row is a planner call — the DDL comment says
that column is derivative-only, so **`None` is the conforming choice**.

### B. The parametrized non-ccxt proof (AUM-05's "class is closed" evidence)

```python
# analytics-service/tests/test_allocator_positions.py
# The SAME test body must pass for mt5 AND sfox — that is the CONTEXT-locked
# proof that the CLASS is closed, not just the MT5 instance.
@pytest.mark.parametrize(
    "venue, client_factory",
    [("mt5", _fake_mt5_session), ("sfox", _fake_sfox_client)],
)
@pytest.mark.asyncio
async def test_non_ccxt_venue_never_calls_ccxt_methods(venue, client_factory):
    client = client_factory()
    rows, warning = await fetch_allocator_holdings(venue, client)
    # The ORIGINAL defect, pinned: no ccxt method is ever reached.
    assert not hasattr(client, "fetch_balance") or not client.fetch_balance.called
    # The USER-VISIBLE invariant (151-UI-SPEC): never a Python identifier in sync_error.
    for banned in ("Traceback", "AttributeError", "object has no attribute",
                   "Mt5Session", "SfoxClient", "fetch_balance"):
        assert warning is None or banned not in warning
```

### C. Refusal copy (151-UI-SPEC, verbatim — greppable acceptance)

```ts
// ScenarioComposer.tsx — replaces the string at :3677
const AUM_REFUSAL_NO_BOOK =
  "Can't record a scenario commit: portfolio AUM is not set. " +
  "Set portfolio AUM before submitting.";
const AUM_REFUSAL_BOOK_REACHABLE =
  "Can't record a scenario commit: portfolio AUM is not set. " +
  'Set portfolio AUM, or switch to "From my book", before submitting.';
// NEVER-STRINGS (AUM-03 / CONSTIT-03): "toggle on a live holding",
// "Connect an exchange API key" — the live-holding toggle was deliberately
// never built, and the founder hit this refusal with four venues connected.
```

### D. Honest-skip copy table (worker-written, = end-user copy)

```python
# analytics-service/services/allocator_positions.py — 151-UI-SPEC §"sync_error copy class"
# Pattern: "{what happened} — {what happens next or what to do}".  U+2014 em dash.
UNSUPPORTED_VENUE_NOTE = "Holdings sync isn't supported for {venue} yet — this key was skipped."
MT5_NON_USD_NOTE = (
    "MT5 account currency is {ccy} — USD conversion isn't supported yet, "
    "so this account was skipped."
)
MT5_UNREACHABLE_NOTE = "MT5 terminal unreachable — sync will retry automatically."
SFOX_FETCH_FAILED_NOTE = "Couldn't fetch balances from sFOX — sync will retry automatically."
# Venue names render in PRODUCT casing ("MT5", "sFOX"), never internal ids.
# EXCHANGE_DISPLAY (services/closed_sets.py, mirrored in src/lib/closed-sets.ts) is the
# lowercase-code → label map already used by AllocatorSyncStatus.exchangeDisplayName.
```

⚠️ For `MT5_UNREACHABLE_NOTE` / `SFOX_FETCH_FAILED_NOTE` the job should still return
`DispatchOutcome.FAILED` with `error_kind="transient"` so the job retries — but the **stamp** must
carry the human copy, not `str(exc)`. That means catching the venue exception inside the branch,
writing the human string via the existing `except Exception` arm's `sanitized` variable path is NOT
enough (it uses `classify_exception`); the venue branch must raise a purpose-built exception whose
`str()` IS the human copy, or the handler must gain a venue-aware stamp. **Planner decision — flag
it explicitly**, because this is the one place where "return a warning" does not suffice.

---

## State of the Art

| Old approach | Current approach | When changed | Impact on this phase |
|--------------|------------------|--------------|----------------------|
| Client-supplied `size_at_decision_usd` trusted into the audit trail | Server recomputes from `allocator_holdings`; client value kept as `size_at_decision_usd_client` + `_size_source` sentinel | NEW-C18-04, PR-2 2026-05-28 | Manual AUM must be a labelled sidecar, never authority (Pitfall 7). |
| Holdings-snapshot reconstruction for the gate=false baseline | Honest `emptyDefault` (AUM preserved, metrics null → "—") | Phase 63 ENGINE-04 | Confirms the all-or-nothing gate is an *honesty* decision, not an oversight — do not relax it for the baseline. |
| Per-holding toggle/weight in the composer | Live holdings are FIXED context (read-only tokens); draft schema v1→v2 dropped legacy toggled state | v1.x read-only-tokens model | The AUM-03 copy's "toggle on a live holding" is a fossil of the pre-v2 model. |
| `strategies.api_key_id` as the only strategy↔key link | `strategy_keys` join table (N keys → 1 strategy) | migration 20260710120000 | Any single-link-form role predicate is wrong on the founder's own account. |
| ccxt-only `_make_exchange_client` | ccxt / sFOX / MT5 three-way | SFOX-05, then MT5RECON-01 | The holdings consumer is the one that never followed — this phase closes it. |

**Deprecated / not to be used:**
- `new_weight` on `voluntary_modify` diffs — legacy 0..1 encoding, normalized server-side to
  `percent_allocated`; migration 128 removed the SQL fallback. Do not emit it from new code.
- Re-deriving eligibility client-side — the composer contract is "the client never re-derives
  eligibility (SoT-mirror)". New gate values ride the payload.

---

## Validation Architecture

### Test framework

| Property | Value |
|----------|-------|
| Framework (TS) | Vitest + jsdom + Testing Library (`vitest.config.ts`, `environment: "jsdom"`) |
| Framework (Python) | pytest + `asyncio_mode = auto` (`analytics-service/pytest.ini`) |
| E2E | Playwright (`e2e/`, `npm run test:e2e`) |
| Quick run (TS) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` |
| Quick run (Python) | `cd analytics-service && pytest tests/test_allocator_positions.py -x -q` |
| Full suite (TS) | `npm run test` (coverage gate: `npm run test:coverage`) |
| Full suite (Python) | `cd analytics-service && pytest -q` |
| Static gates | `npm run typecheck`, `npm run lint`, and `cd analytics-service && mypy .` (strict) |

⚠️ **pytest MUST run from `analytics-service/`** — a repo-root run misses the VCR
`cassette_library_dir` and makes LIVE broker calls. `[CITED: MEMORY]`
⚠️ Local vitest flakes under parallelism → `--no-file-parallelism` when triaging.
⚠️ CI is Node 22, local is Node 25 — a CI-only vitest failure is reproducible with
`PATH=/opt/homebrew/opt/node@22/bin`. Not a flake.

### Requirements → test map

| Req | Behavior | Type | Automated command | Exists? |
|-----|----------|------|-------------------|---------|
| AUM-01 | Blank mode + manual AUM ⇒ commit is permitted and `size = weight × manualAum` | unit | `npx vitest run …/ScenarioComposer.test.tsx -t "manual AUM"` | ❌ Wave 0 |
| AUM-01 | Editing the dollar input back-computes weight through `handleWeightChange` (clamp banner still fires at >AUM) | unit | same file, `-t "dollar input"` | ❌ Wave 0 |
| AUM-01 | Book mode seeds AUM from the live sum; a later holdings refresh does NOT re-snap a typed value | unit | same file | ❌ Wave 0 |
| AUM-01 | Draft codec: a v4 blob WITHOUT `manualAumUsd` decodes `ok` (never reset); a corrupt value sanitizes to `undefined` | unit | `npx vitest run …/lib/scenario-state.test.ts` | ⚠️ file exists, cases ❌ |
| AUM-01 | `manual_aum_usd` survives the commit route schema and lands in audit as a **client-asserted** sentinel | unit | `npx vitest run src/app/api/allocator/scenario/commit/*.test.ts` | ❌ Wave 0 (check for an existing route test) |
| AUM-02 | `fetch_allocator_holdings("mt5", session)` never calls a ccxt method and returns a well-formed equity row | unit | `cd analytics-service && pytest tests/test_allocator_positions.py -k mt5 -x` | ❌ Wave 0 |
| AUM-02 | The MT5 holdings read acquires the **same Lock object** as the derive read for the same `terminal_key` | unit | `pytest tests/test_allocator_positions.py -k terminal_lock -x` | ❌ Wave 0 |
| AUM-02 | `mt5_enabled_server()` false ⇒ no login, no `account_info` call, honest copy | unit | `pytest -k mt5_disabled -x` | ❌ Wave 0 |
| AUM-02 | Non-USD MT5 account ⇒ zero rows + the non-USD note; **no fabricated FX** | unit | `pytest -k non_usd -x` | ❌ Wave 0 |
| AUM-02/05 | **No `sync_error` value ever contains** `Traceback` / `AttributeError` / `object has no attribute` / a Python class name — across mt5, sfox, and an unknown venue | unit (parametrized) | `pytest tests/test_allocator_positions.py -k non_ccxt -x` | ❌ Wave 0 |
| AUM-02 | Existing ccxt venues reach `fetch_balance` unchanged (dispatch is additive) | regression | `pytest tests/test_allocator_positions.py -q` (existing suite must stay green) | ✅ exists |
| AUM-03 | Refusal copy contains "Set portfolio AUM"; does NOT contain "toggle on a live holding" or "Connect an exchange API key"; the book-reachable variant offers the segment only when it renders | unit | `npx vitest run …/ScenarioComposer.test.tsx -t "refusal"` | ⚠️ `:2468` exists, pins OLD copy |
| AUM-04 | `deriveStrategyLinkedKeyIds` covers BOTH link forms and excludes archived strategies (founder census: 8 keys → 4 strategies → 2 allocator keys) | unit (pure) | `npx vitest run src/lib/queries.test.ts -t "strategy-linked"` | ❌ Wave 0 (sibling exists in `queries.my-strategies.test.ts`) |
| AUM-04 | `bookEntryGateSatisfied` is true with 1-of-8 contributing keys; `perKeyDailiesGateSatisfied` stays FALSE in the same fixture | unit (pure) | `npx vitest run src/lib/queries.test.ts -t "book entry gate"` | ❌ Wave 0 |
| AUM-04 | Both `getMyAllocationDashboard` return branches carry the three new fields | unit | `npx vitest run src/lib/queries.my-allocation.test.ts` | ⚠️ file exists |
| AUM-04 | Book mode with a partial book renders only contributing keys AND the "{N} of {M}" note; manager keys are in NEITHER count | unit | `npx vitest run …/ScenarioComposer.test.tsx -t "partial book"` | ❌ Wave 0 |
| AUM-04 | A book holder with a partial book initializes to `book`, not forced blank | unit | same file | ❌ Wave 0 |
| SC-cross | Composer axe pass still clean with the two new inputs + the note | e2e | `npx playwright test e2e/composer-axe.spec.ts` | ✅ exists |

### Economic-invariant oracles (not self-referential)

Per the MEMORY lesson *"money-math oracles pin ECONOMICS not the impl's own formula"* — three money
bugs survived six review passes behind self-referential oracles. Use these instead:

1. **AUM conservation.** For any draft, `Σ over enabled constituents of (dollarAmount) == scenarioAum`
   within one cent — assert against a **hand-computed constant** (`AUM = 1_000_000`,
   weights `{0.25, 0.75}` ⇒ `{250_000, 750_000}`), never against `weight * scenarioAum` recomputed
   in the test.
2. **Sizing invertibility.** Typing `$500,000` into a strategy's dollar field with `AUM = 2,000,000`
   must produce weight `0.25` **and** the commit diff's `size_at_decision_usd` must be exactly
   `500_000` — pinning the founder's literal sentence.
3. **Leverage invariance.** Changing AUM must NOT move Sharpe, Calmar, CAGR, or max-DD
   (`scenarioMetrics` does not depend on `scenarioAum` — `ScenarioComposer.tsx:2814` deps are
   `engineSet, engineState, dateMapCache, blendBasis`). A test that asserts metrics are unchanged
   across an AUM edit is the guard that AUM-01 did not accidentally get wired into the metrics path
   — and simultaneously the guard that nobody mis-plans AUM-01 as the SCEN-01 fix.
4. **MT5 equity fidelity.** Given `account_info() = {equity: 123_456.78, balance: 120_000.00,
   currency: "USD"}`, the persisted row's `value_usd` is exactly `123456.78` — **equity, not
   balance**. Balance would silently drop floating uPnL. Assert the literal, and assert that a
   fixture where `equity != balance` does not produce the balance.
5. **Multi-account non-collapse.** Two MT5 keys under one allocator produce **two** surviving rows
   after the upsert (the Pitfall-1 falsifier). Assert row count, then assert the two `value_usd`
   values are both present.

### Sampling rate
- **Per task commit:** the single focused file (`-t` filter) + `npm run typecheck` for TS tasks;
  `pytest tests/test_allocator_positions.py -x -q` + `mypy .` for Python tasks.
- **Per wave merge:** `npm run test` and `cd analytics-service && pytest -q`.
- **Phase gate:** `npm run test:coverage` (thresholds are blocking), `npm run lint`,
  `cd analytics-service && pytest -q && mypy .`, then `npx playwright test e2e/composer-axe.spec.ts`,
  then `/gsd:verify-work`.

### Wave 0 gaps
- [ ] Python: mt5/sfox fake clients + the parametrized non-ccxt table in
      `analytics-service/tests/test_allocator_positions.py` (or a new
      `tests/test_allocator_positions_non_ccxt.py` — placement is Claude's discretion per CONTEXT).
- [ ] Python: a terminal-lock identity fixture (assert `is` on the Lock object across both job kinds).
- [ ] TS: pure-predicate fixtures for `deriveStrategyLinkedKeyIds` / `bookEntryGateSatisfied`
      reproducing the founder census (8 keys, 4 strategies incl. one 3-key composite, 2 allocator keys).
- [ ] TS: composer fixtures for blank+manual-AUM and partial-book (the existing
      `ScenarioComposer.test.tsx` payload builder should be extended, not forked — 10,691 lines,
      it already has the builders).
- [ ] No framework installs needed.

---

## Security Domain

### Applicable ASVS categories

| ASVS Category | Applies | Standard control (already in place) |
|---------------|---------|--------------------------------------|
| V2 Authentication | no (no change) | Commit route already resolves `auth.getUser()`; the RPC re-asserts `auth.uid() = p_allocator_id` (42501). |
| V3 Session Management | no | — |
| V4 Access Control | **yes** | New SSR reads (`strategy_keys`) must be **owner-scoped literally** (`.eq("owner_id", userId)`), with RLS as backstop — the `getStrategylessActiveKeys` precedent (`queries.ts:427`). Never widen the client. |
| V5 Input Validation | **yes** | `manual_aum_usd`: `isValidDollar` client-side AND a bounded zod field server-side (`z.number().nonnegative().lt(MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD)`). The dollar input feeds a division — reject non-finite before it reaches `handleWeightChange`. |
| V6 Cryptography | no | Credentials continue to flow through `decrypt_credentials` / `get_kek()` unchanged. |
| V7 Error Handling & Logging | **yes** | This phase is *literally* an error-leak fix: a raw Python exception in a user-visible column. The new invariant (no Python identifier in `sync_error`) is a V7 control. MT5 secret scrubbing (`scrub_freeform_string`) already exists and must be applied to any MT5 text that could reach a message. |
| V8 Data Protection | **yes** | If MT5 `symbol` embeds the broker login number, that account identifier becomes visible in the Holdings UI, in scope-refs, and in the holdings fingerprint sent to the commit RPC. Prefer an opaque account token. |

### Known threat patterns for this stack

| Pattern | STRIDE | Standard mitigation (status) |
|---------|--------|------------------------------|
| Verbose error disclosure via a user-facing DB column | Information Disclosure | Human copy at the venue branch; never `str(exc)` (**this phase**). |
| Client-asserted financial figure in an audit trail | Repudiation / Tampering | NEW-C18-04 server recompute + `_size_source` sentinel; manual AUM added as a labelled sidecar only (**this phase must preserve**). |
| Broker account identifier leakage into UI/scope-refs | Information Disclosure | Opaque MT5 account token (**decision needed**). |
| Cross-tenant read via a hand-narrowed Supabase client | Elevation of Privilege | Literal `.eq("owner_id", userId)`; narrow ONE builder, never widen the whole client (`queries.ts:406-419` precedent). |
| Division by attacker-controlled zero (AUM) | Denial of Service (local) | `scenarioAum <= 0` ⇒ dollar field is read-only `—`; the existing commit gate at `:3675` stays. |
| Unbounded worker wedge on a shared blocking resource | DoS | `asyncio.wait_for` + `to_thread` + bounded restart (v1.11 WEDGE-01 class). |

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node + npm (vitest, tsc, eslint) | All TS work | ✓ | local Node 25 / CI Node 22 | Reproduce CI with `PATH=/opt/homebrew/opt/node@22/bin` |
| Python + pytest | Worker tests | ✓ | see `requirements-dev.txt` | — |
| `pandera==0.32.1` | `csv_validator` / `middleware` / `mt5` test modules | ⚠️ often missing locally | 0.32.1 | `pip install 'pandera==0.32.1' --break-system-packages`; CI has it |
| mypy (strict) | Pre-ship gate for `analytics-service` | ✓ (config in `pyproject.toml:1-40`) | — | — |
| Live MT5 gateway (`mt5-gateway.railway.internal:8001`) | **NOT required** for this phase's tests | n/a | — | All MT5 tests use fake sessions; the facade pin means no live terminal is needed. Live confirmation is a **post-merge PROD UAT step**. |
| sFOX API | **NOT required** — flag-off, zero keys | n/a | — | Fake client; this is precisely why AUM-05 must be proven by test, not by observation. |
| PROD Supabase (read) | Verifying the founder's key census + the stale `sync_error` | ✗ from this session (no MCP/DB access) | — | In-repo Phase-149 census is the evidence; re-verify in post-merge PROD UAT. |
| Playwright browsers | `composer-axe.spec.ts` | ✓ (repo runs e2e in CI) | — | — |

**Missing with no fallback:** none.
**Missing with fallback:** live PROD verification of the key census and the stale `sync_error` value
— discharge by post-merge UAT, following the Phase-149 W-3 precedent (no in-phase checkpoint for
PROD-data facts).

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | The founder's 2 "bare" (allocator-only) keys are bybit and okx — i.e. the two WITH per-key dailies — so manager-key exclusion alone satisfies even the existing all-or-nothing gate. | Summary §3, Pattern 8 | If a zero-dailies key is also allocator-only, the exclusion alone does NOT fix the founder's book and the ≥1 relaxation becomes load-bearing. Does not change the design (both changes are in scope), only the risk ordering. **Verify in PROD UAT.** |
| A2 | The 3 deribit keys are the Alpha Centauri composite (via `strategy_keys`) and the 3 MT5 keys link directly via `strategies.api_key_id`. | Pattern 8 | Only affects which link form dominates; the predicate covers both, so the fix is unaffected. |
| A3 | `Mt5Client.account_info()` returns a `currency` key (standard MetaTrader5 `account_info` field). | Pattern 2, Code Example A | If absent, the non-USD guard cannot fire and a non-USD account would be silently counted as USD — a fabricated FX rate of 1.0, violating no-invented-data. **Mitigation: fail loud on a missing/blank `currency` (skip with a note), never default to USD.** Cheap to verify from a live `account_info()` dict or the derive-path fixtures. |
| A4 | sFOX `get_balances()` rows carry only `currency` + `balance` (string) and no USD valuation. | Pitfall 9, Open Q2 | If a `usd_value`-like field exists, per-asset pricing is free and the honest-skip for non-stables is unnecessary. Verify against `services/sfox_read.py` fixtures / the sFOX docs before writing the branch. |
| A5 | `CommitBodySchema` (`z.object`, non-strict) **strips** unknown keys rather than rejecting — so `manual_aum_usd` must be declared to survive the parse. | Pitfall 7 | If the project's zod config is strict-by-default, an undeclared field would 400 instead of being dropped. Either way the field must be declared; only the failure mode differs. |
| A6 | `size_at_decision_usd` is genuinely ignored by `commit_scenario_batch` for dimensioning (the RPC reads `percent_allocated`). | Pitfall 7 | Stated in a code comment at `route.ts:696-699` and corroborated by migration 128's removal of the SQL fallback, but not read end-to-end in the RPC body this session. If wrong, manual-AUM commits could persist a wrong dollar size. **Read the RPC body before finalizing the plan.** |
| A7 | No existing test file covers `POST /api/allocator/scenario/commit` at the schema level. | Validation table | Only affects whether the `manual_aum_usd` test is new or an extension. |

---

## Open Questions (RESOLVED)

> All six questions were resolved at planning time (2026-08-07) — inline markers below.

1. **Does the ≥1 relaxation ship in this phase, or does manager-key exclusion suffice?**
   - What we know: the two changes are independent; exclusion alone very likely fixes the founder
     (A1). The relaxation's blast radius is contained IF the gate is split (Pattern 7), but it also
     forces the `dataSourceKeys` narrowing (Pitfall 4) and a decision on `usePerKeySources`.
   - What's unclear: whether a 1-of-8-key "book" is a *good* book-mode experience or a confusing one.
   - Recommendation: **ship both**, but as separate plans with separate verification, exclusion
     first. That way if the partial-book UX proves poor, the founder's book is already reachable.
   - → **RESOLVED (planned):** ship both — manager-key exclusion (151-02) + the ≥1 relaxation with the dataSourceKeys narrowing (151-05).

2. **How does sFOX price a non-stablecoin balance?**
   - What we know: the GET-only facade has no ticker endpoint (four read methods, pinned by tests).
     `get_balance_history` returns a daily `usd_value` NAV series — an account-level USD anchor
     structurally identical to MT5's `account_info().equity`.
   - What's unclear: CONTEXT locks `get_balances()` for sFOX. Using `get_balance_history`'s latest
     `usd_value` instead would give ONE row per account with no pricing problem at all — but that is
     a different method than the one locked.
   - Recommendation: **honour the lock.** Use `get_balances()`; contribute USD + stablecoin rows at
     `mark_price = 1.0` (reuse `STABLECOINS` from `services/closed_sets.py`); emit an honest warning
     naming the skipped assets. Log the `get_balance_history` alternative as a deferred improvement
     for the sFOX go-live phase. If the founder prefers the NAV anchor, that is a CONTEXT amendment,
     not a planner call.
   - → **RESOLVED (planned):** lock honoured — `get_balances()` in 151-04 Task 1; the `get_balance_history` NAV-anchor alternative is logged to TODOS.md as deferred (same task).

3. **What token goes in `symbol` for an MT5 account row?**
   - What we know: it must match `[A-Za-z0-9_-]+`, must be account-scoped (Pitfall 1), and must be
     stable across syncs. It becomes visible in the Holdings tab and inside the holdings fingerprint.
   - Recommendation: `ACCOUNT-{api_key_id[:8]}` — stable, opaque, non-secret, collision-free in
     practice. If readability wins, `ACCOUNT-{login}` is acceptable but leaks the broker account
     number into the UI and into the commit fingerprint (V8 concern above). **Decide before the
     first PROD write** — changing it later orphans rows under the old symbol.
   - → **RESOLVED (planned):** `ACCOUNT-{api_key_id[:8]}` — 151-03 Task 2 (decided before the first PROD write).

4. **Does `usePerKeySources` follow the new gate or the old one?**
   - Recommendation: **the new one.** "From my book" that renders an added-only (empty) engine is a
     worse dead end than today's refusal. But this must be explicit, tested, and commented — it is
     the single edit that most changes what book mode *shows*.
   - → **RESOLVED (planned):** the NEW gate — 151-05 Task 1 (explicit, tested, commented; the 151-05 objective records the zero-contributing narrowing this implies).

5. **What `sync_status` does a genuine MT5/sFOX transport failure land on, and where is its human
   copy written?**
   - What we know: a returned `warning` gives `complete_with_warnings` for free; a *raised* exception
     routes through `classify_exception` and stamps `str(exc)`.
   - Recommendation: honest skips → `warning` channel (DONE + `complete_with_warnings`); genuine
     failures → raise a purpose-built exception whose `str()` IS the human copy (so the existing
     `except Exception` arm's `sanitized = msg[:500]` stamps human text) AND classify transient so
     the job retries. This keeps `error_kind` honest and `sync_error` human with the smallest edit.
   - → **RESOLVED (planned):** as recommended — warning channel for honest skips; `AllocatorHoldingsSyncTransientError` (str = human copy, error_kind=transient) for genuine failures — 151-03 Task 1.

6. **Should the Overview "your live book" baseline eventually use a partial blend?**
   - Out of scope here (the split keeps it on the old gate), but worth logging to TODOS.md: the
     honest-empty baseline for a partial-coverage book is arguably too conservative now that the
     composer will show a partial book. Not this phase.
   - → **RESOLVED (delegated):** logged to TODOS.md by 151-04 Task 1 (the same TODOS.md edit as the Q2 deferred line).

---

## Sources

### Primary (HIGH confidence — read directly this session)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — gate `:841-862`,
  `handleWeightChange` `:1160-1272`, per-key/engine `:2366-2520`, `scenarioAum` `:3581-3592`,
  commit gate + refusal `:3665-3700`, disclosure `:4423-4432`, drawer prop `:5125`,
  `notionalText` `:5400`, constituent rows `:5560-5720`
- `src/lib/queries.ts` — `deriveStrategylessKeys` `:342-374`, `getStrategylessActiveKeys` `:392-465`,
  `allActiveKeysHavePerKeyDailies` `:2854-2862`, `isPerKeyDailiesEligibleKey` `:2865-2903`,
  `buildPerKeyReturnsByApiKeyId` `:2905-2920`, gate + baseline + payload `:3694-3806`, `:4224`
- `src/app/(dashboard)/allocations/lib/scenario-state.ts` — schema versioning `:42-90`,
  `ScenarioDraft` `:108-165`
- `src/app/api/allocator/scenario/commit/route.ts` — diff schemas `:94-160`, audit recompute
  `:692-760`, `serverSizeUsd` arms `:840-905`
- `src/components/exchanges/AllocatorSyncStatus.tsx` — props `:35-60`, pill map `:66-76`,
  helper resolution `:240-260`
- `src/lib/dollar-validation.ts` — `isValidDollar`, `formatUsd`
- `analytics-service/services/allocator_positions.py` — module docstring `:1-33`,
  `_map_exception_to_sync_status` `:122-135`, `_fetch_spot_rows` `:138-200`,
  `_fetch_derivative_rows` `:235`, `fetch_allocator_holdings` `:268-303`, `persist` `:307-342`
- `analytics-service/services/job_worker.py` — MT5 concurrency doc + helpers `:276-430`,
  `classify_exception` `:606-680`, `_make_exchange_client` `:996-1023`,
  `_allocator_key_preflight` `:1144-1205`, MT5 derive block `:3441-3600`, equity extract
  `:3686-3720`, `run_poll_allocator_positions_job` `:7083-7290`
- `analytics-service/services/mt5_client.py` — `account_info` `:327-332`
- `analytics-service/services/sfox_client.py` — `get_balances` `:272-277`
- `analytics-service/services/exchange.py` — `aclose_exchange` `:872-945`
- `analytics-service/services/closed_sets.py` — `sfox_enabled_server` `:66`,
  `mt5_enabled_server` `:107`, detail strings `:63/:96`
- `analytics-service/tests/test_mt5_client_contract.py` — facade pins `:719-763`
- `analytics-service/tests/test_allocator_positions.py` — existing job/fetch test shapes
- `analytics-service/tests/test_sfox_client.py:69-82` — balance row shape
- `supabase/migrations/20260420073003_allocator_holdings.sql:85-155` — DDL + unique index
- `supabase/migrations/20260422101911_api_keys_disconnected_at.sql:174-222` — cron fan-out predicate
- `supabase/migrations/20260601120000_commit_scenario_batch_fingerprint_precondition.sql` — RPC signature
- `.planning/phases/151-.../151-CONTEXT.md`, `151-UI-SPEC.md`
- `.planning/REQUIREMENTS.md` (AUM-01..05), `.planning/ROADMAP.md:240`
- `.planning/phases/149-.../149-02-PLAN.md:115-121` — PROD key census 2026-08-05
- `CLAUDE.md`, `AGENTS.md`, `vitest.config.ts`, `analytics-service/pytest.ini`,
  `analytics-service/pyproject.toml`, `package.json`

### Secondary (MEDIUM)
- MEMORY entries: pytest-from-analytics-service, CI Node 22 vs local 25, mypy-before-ship,
  money-math oracle discipline, v1.11 weight-basis landmines, v1.15 MT5 live config.

### Tertiary (LOW)
- None. No WebSearch or external documentation was needed — this phase touches no external API
  whose contract is not already pinned by an in-repo test or fixture.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — zero new dependencies; every reusable asset was read at its
  cited line this session.
- Architecture / integration points: **HIGH** — all data flows traced end to end from cron →
  worker → DB → SSR → composer → commit route. Line numbers verified against live source (note:
  REQUIREMENTS.md's `queries.ts:2383-2392` and `job_worker.py` bare path have drifted; the correct
  anchors are `queries.ts:2854` and `analytics-service/services/job_worker.py`).
- Pitfalls: **HIGH** for 1–8 (each derived from code + an in-repo comment documenting the
  invariant it would break); **MEDIUM** for 9 (sFOX shape from a unit-test fixture, not from
  live API observation).
- PROD facts: **MEDIUM** — no DB access from this session. The key census is in-repo and dated;
  the stale `sync_error` string is quoted in REQUIREMENTS from a direct PROD check on 2026-08-04.

**Research date:** 2026-08-07
**Valid until:** 2026-09-06 (30 days — the surface is in-repo and stable; the only external
dependency, the MT5 gateway, is version-pinned via `mt5linux 0.1.9`). Re-verify line anchors after
any Phase-152 composer work, which touches the same file.
