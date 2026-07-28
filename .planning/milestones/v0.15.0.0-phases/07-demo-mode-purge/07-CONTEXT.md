# Phase 07: Demo-Mode Purge — Context

**Gathered:** 2026-04-20
**Status:** Ready for research & planning
**Prior-phase pickup:** Phase 06 Allocator API Ingestion verified 10/10. Migrations 066–069 applied. Scope delta shipped during 06 UAT: `/connections` retired, `/exchanges` folded into `/profile?tab=exchanges`, migration 069 `delete_allocator_api_key` RPC + Remove-key modal. Phase 07 inherits that IA.

<domain>
## Phase Boundary

The authenticated `/allocations` dashboard derives every number it shows from real allocator data (allocator_holdings + Bridge V2 tables + reconstructed historical equity series) — zero seed fallback — and the page is tabbed so Performance (daily monitoring) and Scenario (what-if) are first-class surfaces. A brand-new allocator with zero holdings sees a real empty state with one "Connect Exchange" CTA that routes to `/profile?tab=exchanges`.

In scope:
- Historical equity-series reconstruction from exchange APIs (ccxt: trades + deposits + withdrawals + OHLCV) with CoinGecko as fallback (D-01 / D-02)
- `getMyAllocationDashboard(userId)` rewire to read real data (PURGE-02 / PURGE-03)
- `/allocations` tabbed layout: Performance (default) + Scenario (secondary, Phase-10 stub) (PURGE-07)
- Empty-state surface with a single Connect Exchange CTA (PURGE-04)
- Removal of new-user seed-portfolio on signup (PURGE-05)
- Audit + document every `ALLOCATOR_ACTIVE_ID` / seed-UUID call site, confirming authenticated paths are seed-free (PURGE-01 / PURGE-06)

Out of scope (other phases or deferred):
- Full Scenario builder composition + projected KPIs + Commit-scenario flow (Phase 10)
- Bridge wire-up against real allocator_holdings (Phase 09)
- Connection-management notes + health UI (Phase 08 — charter needs revisit given /connections retired)
- Onboarding polish + first-key nudges (Phase 11)
</domain>

<prior_decisions_inherited>
## Inherited from Phase 06 (locked)

- **IA:** `/exchanges` no longer exists as a standalone route. All "manage my API keys" traffic goes to `/profile?tab=exchanges`. The "Connect Exchange" CTA in Phase 07 MUST link to `/profile?tab=exchanges`.
- **Delete-key flow:** Migration 069 `delete_allocator_api_key(p_api_key_id, p_cascade_holdings)` RPC is the authoritative path for key removal. Phase 07 does not need to touch that flow.
- **Sync-status taxonomy:** `api_keys.sync_status` ∈ {idle, syncing, computing, complete, complete_with_warnings, rate_limited, revoked, error}. `last_429_at` readable by `authenticated` (migration 068). `allocator_holdings.api_key_id` is NOT NULL with ON DELETE RESTRICT — cascade-on-user-choice only.
- **Pattern precedent:** Tab-state via URL query param `?tab=...` (proven on `/profile?tab=exchanges`). Phase 07 uses the same pattern for `/allocations?tab=performance|scenario`.
- **Polling cadence:** 5s `router.refresh()` is the live-update pattern for allocator-facing surfaces (D-11 from Phase 06). Phase 07 Performance tab follows the same.
</prior_decisions_inherited>

<decisions>
## Implementation Decisions

### Historical equity series (PURGE-02 / PURGE-03 core)

- **D-01: Reconstruct from exchange APIs first, CoinGecko fallback.** The dashboard's KPI strip and equity/drawdown curves compute from a per-allocator daily equity series. The series is **reconstructed** from the exchange's own history — not just a forward-only snapshot cron. Primary sources (all via ccxt, same worker runtime as Phase 06):
  - `fetch_my_trades` (paginated back as far as the exchange allows) — produces the trade tape
  - `fetch_deposits` + `fetch_withdrawals` — reconstructs position-size changes that aren't trades (transfers in/out of the exchange)
  - `fetch_ohlcv` for each held symbol — daily closes to mark historical quantities → USD value
  - Fallback: **CoinGecko historical price API** only for symbols the connected exchange does not list or doesn't price (rare for top-tier tokens; common for random alts that arrived via deposit). Cached in Postgres (table `token_price_history`) keyed on `(symbol, asof)` to stay inside CoinGecko's free-tier rate limits.
  - Goal: reconstruct the **entire available history** of an API key on first connect, then incrementally append per daily cron.
  - Scope warning: this is meaningfully more work than the original PURGE-02 wording. Likely one dedicated plan file inside Phase 07 (e.g. `07-02-PLAN.md — Historical equity reconstruction worker`) or a new adjacent phase. Researcher should validate feasibility against exchange rate limits + historical-data depth per venue before planner commits.

- **D-02: Storage.** New table `allocator_equity_snapshots(allocator_id, asof, value_usd, breakdown jsonb, reconstructed_at, source)`:
  - One row per (allocator_id, asof). PK on (allocator_id, asof).
  - `breakdown jsonb` carries the per-symbol decomposition so the drawdown/equity chart can tooltip positions without a second query.
  - `source` ∈ {'exchange_primary', 'coingecko_fallback', 'mixed'} — debuggability.
  - RLS mirrors `allocator_holdings` (3-tier: owner SELECT, admin SELECT, service_role ALL).
  - Writes are service_role only via the worker; authenticated readers never mutate.
  - Backfill semantics: on first connect, worker enqueues a `reconstruct_allocator_history` job that populates rows for every date from the key's oldest reconstructable point forward. Incremental cron appends one row per day thereafter.

- **D-03: Warm-up gate for KPIs.** When fewer than ~30 snapshot days exist, annualised metrics (CAGR, Sharpe, Sortino, Calmar) render as `—` with a neutral "Warming up — need {N} more days of synced data" helper line. AUM (today) and `value_usd` are always available. The dashboard never shows a misleading metric — it degrades gracefully.

### Tabbed layout (PURGE-07)

- **D-04: `/allocations?tab=performance|scenario`.** URL query param for tab state (matches `/profile?tab=exchanges` precedent — proven, shareable, survives reload). Default `performance`. Invalid / missing tab param → default to `performance`.

- **D-05: Performance tab = current `/allocations` surface, rewired.** All existing widgets (KPI strip, equity curve, drawdown chart, "What We Noticed" card, holdings table) stay in place; only their data sources change per PURGE-02 / PURGE-03. No new widgets in Phase 07.

- **D-06: Scenario tab = stub.** Body is one `<Card>` with headline "Scenario builder coming soon", sub-line "Model what-if outcomes by adding or removing strategies and holdings from your live composition. Available in the next update." Zero logic. Phase 10 owns SCENARIO-01…SCENARIO-09. The tab exists now so the allocator's mental model of "this page has two modes" is established; Phase 10 only fills in the tab body.

### Empty state + Connect Exchange CTA (PURGE-04)

- **D-07: Minimal centred card.** Headline: "No positions to analyze yet." Sub-line: "Connect a read-only exchange API key to see your real holdings and performance." One primary button: **"Connect Exchange →"** (links to `/profile?tab=exchanges`). No illustration, no 3-step explainer. Keeps DESIGN.md's minimalist bias + avoids a design-asset decision.

- **D-08: Empty-state trigger condition.** Show the empty state whenever the current allocator has zero rows in `allocator_holdings` (regardless of whether they have an api_keys row — they may have added a key that hasn't finished its first sync yet). While a key exists and `sync_status='syncing'`, show a lightweight "Syncing your first positions — this usually takes under a minute." inline state on the Performance tab instead of empty.

### Insights / "What We Noticed" behaviour at zero & stale

- **D-09: Zero holdings → prompt card.** Card title stays "What we noticed"; body renders a single line: "Connect an exchange to surface insights about your positions." and a small secondary link to `/profile?tab=exchanges`. Card is never hidden — a visible prompt is more inviting than a missing card.

- **D-10: Stale data (last_sync_at > 24h for all the allocator's active keys) → block numbers.** KPI strip numeric values render as `—` greyed out; a "Sync your keys to refresh — last synced {X}h ago" CTA shows inline above the strip (linking to `/profile?tab=exchanges`). Equity/drawdown charts render with an overlay dimmer + "Data may be stale" label. Protective posture — better to block than mislead.

- **D-11: Per-key staleness vs all-key staleness.** Staleness is measured across the **set of the allocator's currently active keys** (`is_active = true`). If at least one active key synced within 24h, data is considered fresh (that key supplies the latest holdings). If ALL active keys are stale, the D-10 blocked mode triggers.

### Seed-path demolition (PURGE-01 / PURGE-05 / PURGE-06)

- **D-12: Audit scope narrower than expected.** Quick scout: authenticated code paths already only branch on seed IDs in two places (`/demo/founder-view/page.tsx` — marketing, allowed; `/api/demo/match/[allocator_id]/route.ts` — marketing, allowed). `portfolio-insights.ts` is docstring-scoped to `/demo`. `ALLOCATOR_ACTIVE_ID` lives in `src/lib/demo.ts` and is NOT imported into any authenticated path. PURGE-01's audit likely confirms this rather than finding new rewires; researcher should still produce the call-site table in `07-RESEARCH.md` for sign-off.

- **D-13: New-user signup.** OnboardingWizard → profile creation only. No seed-portfolio insert. First `/allocations` visit for a brand-new allocator always hits D-07 empty state. Researcher must trace the current onboarding flow and list the specific inserts to remove (likely a one-file change + one migration if there's a trigger).

- **D-14: Keep `/demo` unchanged.** All seed machinery under `/demo` routes + unit-test fixtures keeps running as-is. `src/lib/demo.ts`, `src/__tests__/seed-integrity.test.ts`, `src/lib/demo.test.ts`, and `src/lib/admin/match.ts` (admin-only demo tooling) are all untouched.

- **D-15: Drop ALLOCATOR_ACTIVE feature flag.** There is no live `ALLOCATOR_ACTIVE` flag — the requirements referenced it but grep shows only the ID constant. PURGE-01 in CONTEXT.md reads "confirm no authenticated branch on seed IDs" rather than "remove the flag".
</decisions>

<specifics>
## User vision / specific asks

- **Reconstruct entire history** (from user in this session, verbatim): "reconstruct from prices and API if possible, only if not possible from coingecko. We need to reconstruct the entire history of an API key that is available." → captured in D-01 / D-02; flagged as scope-expanding; researcher gates on exchange feasibility.
- **Minimum surface churn** — user prefers additive (new snapshot table, new worker job kind) over rewriting the existing widget layer. D-05 preserves the current Performance surface verbatim.
- **Don't build Phase 10 here** — Scenario tab is a stub (D-06).
- **DESIGN.md minimalism** — no illustration on empty state (D-07).
</specifics>

<deferred_ideas>
## Captured, not acted on here

- **Real-time holdings badge** — the 5s polling cadence is fine for Phase 07. A postgres_changes realtime subscription could replace polling in Phase 11 polish if UX needs it.
- **Staleness-aware "last synced" chip in the header** — nice-to-have at the page level; leaving this to Phase 11.
- **Manual holdings override / notes** — Phase 08 scope (MANAGE-06).
- **Phase 08 charter revisit** — "/connections" retired during Phase 06 UAT scope delta. Phase 08 "Connection Management and Notes" needs its surface re-anchored (likely merges into `/profile?tab=exchanges`). Flag for re-spec at start of Phase 08.
</deferred_ideas>

<gates_for_research>
## What the researcher should investigate (07-RESEARCH.md inputs)

1. **Exchange historical-data feasibility** — for each of {Binance, OKX, Bybit}:
   - max history depth on `fetch_my_trades` (some exchanges cap at 3–6 months)
   - rate limits + pagination patterns for a full-backfill worker job
   - coverage of `fetch_deposits` / `fetch_withdrawals` for stablecoin & token transfers
   - OHLCV retention depth for both spot and derivatives
   - document expected per-allocator backfill runtime (minutes? hours?) to inform D-01 job timeout + cron backoff
2. **CoinGecko fallback usage envelope** — free-tier rate limit (≈ 30 req/min), how many historical series we realistically need per allocator (likely ≤ 50 symbols × daily close for 2 years = 36k calls one-time; batchable). Whether to upgrade to paid tier is a product call.
3. **Current `/allocations` widget data contracts** — what each widget (KPI strip, equity curve, drawdown, "What We Noticed") currently consumes, so PURGE-03 rewire preserves contracts. Map old → new inputs.
4. **Audit ALLOCATOR_ACTIVE_ID + isDemoPortfolioId call sites** — produce the call-site table for PURGE-01 sign-off. Expected: all marketing/demo-only, zero authenticated rewires needed.
5. **OnboardingWizard seed-insert trace** — find the exact insert(s) that create a new allocator's seed portfolio today; scope the PURGE-05 delete.
</gates_for_research>

<gates_for_planning>
## What the planner should produce (07-PLAN.md expectations)

Likely plan file breakdown (planner may re-slice):
- **07-01:** Migration + new `allocator_equity_snapshots` table + RLS + worker job-kind registration (`reconstruct_allocator_history`, `refresh_allocator_equity_daily`)
- **07-02:** Historical-reconstruction worker implementation (ccxt trades/deposits/withdrawals/OHLCV + CoinGecko fallback + snapshot persistence). This is the heaviest piece; may split further after research.
- **07-03:** `getMyAllocationDashboard` rewire + warm-up gate + staleness detection + per-widget data-contract translation (PURGE-02 / PURGE-03 / D-10 / D-11)
- **07-04:** `/allocations` tabbed layout + Performance-default + Scenario stub + URL query-param state (PURGE-07 / D-04 / D-05 / D-06)
- **07-05:** Empty-state component + Connect Exchange CTA + zero/stale insights behaviour (PURGE-04 / D-07 / D-08 / D-09)
- **07-06:** OnboardingWizard seed-insert removal + PURGE-01 audit documentation (PURGE-05 / PURGE-06 / D-12 / D-13 / D-15)

Each plan must assert what its predecessor plan shipped (no stubs crossing plan boundaries). Plan 07-02 is the scope-risk hotspot — planner should time-box research iteration before locking the plan.
</gates_for_planning>

<open_questions>
None at this time. Research may surface feasibility constraints that reshape D-01 / D-02.
</open_questions>
