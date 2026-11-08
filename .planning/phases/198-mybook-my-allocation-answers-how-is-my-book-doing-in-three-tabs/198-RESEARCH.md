# Phase 198: MYBOOK - Research

**Researched:** 2026-11-08
**Domain:** Next.js 16 App Router client shell (`/allocations`), Supabase-backed allocation write paths, Holdings/exposure presentation, figure-gate parity
**Confidence:** MEDIUM. Code evidence is HIGH (every claim opened at worktree HEAD `3b5e46f0a`, branch `feat/198-mybook`, rebased on `e9277565e`). PROD measurements were run afterwards by the orchestrator (see "PROD reads").

> Citation convention: `file:line` readings are at HEAD above. Line numbers drift; every one is paired with a symbol. Paths are repo-relative on purpose (public repo, planning-hygiene lint).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(copied verbatim from `198-CONTEXT.md` `## Implementation Decisions`)

**Missing-data message (discussed with the founder)**
- **D-01 Key + days + action.** Founder pick (2026-11-08). Replace the generic "We are holding back your equity history" with a message naming the key, the missing day range and what to do, e.g. 'Binance key "Main": no data for 3–11 Oct. Reconnect the key or wait for the next sync.' The rest of the overview still renders with what is available. A key's problem affects only that key (founder rule: a dead key affects only itself, never other keys/venues of the account).

**Settled on the recommendation (founder left these to me, 2026-11-08)**
- **D-02 Three tabs:** Overview (return, risk, holdings at a glance, same values as Scenario and Holdings), Holdings (each position once, dust hidden), Scenario. Outcomes, Mandate and Risk content folds into Overview or Holdings; nothing is deleted silently; the plan lists where each moved panel lands.
- **D-03 "+ Allocation":** an allocator flow on every tab: pick a strategy (search) and enter amount/date, reusing existing allocation APIs; never the manager's `WizardClient`. Phase 196's factsheet "Add to my allocation" (196 D-02) opens this same flow pre-filled with the strategy; expose an entry (route or query param) 196 can link to.
- **D-04 Dust:** a position worth under $50 or under 0.1% of the book is dust, hidden by default behind "Show n small positions".

**Carried forward**
- Phase 194: book values agree across Scenario and Holdings (D-22 AUM rule where relevant).
- Phase 195: Tweaks panel gone.
- Founder rule: a strategy-linked key can also be in an allocator book.

### Claude's Discretion
- Exact panel placement inside Overview/Holdings per DESIGN.md 9-State Matrix; how cash is classified (not as Spot exposure, SC-3 test RED first).

### Deferred Ideas (OUT OF SCOPE)
- None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROUTE-06 | "+ Allocation" on My allocation opens the allocator's flow, not the manager's add-strategy wizard. | Q1 (write-path comparison, two-route dispatch), Q2 (`?add=` entry), pitfalls P1, P4, P9; UI-SPEC premise corrections C3, C4 |
| ROUTE-07 | My allocation's first tab answers "how is my book doing?" with return, risk and holdings at a glance, or names exactly what is missing. | Q3 (per-key missing ranges), figure-basis finding F1 (Founder decision FD-2), Book-equity definition, pitfall P3 |
| ROUTE-08 | Holdings labels positions correctly: allocated positions are not "not allocated", cash is not Spot. | Q4 (label predicate, cash set, exposure strip/series), UI-SPEC correction C5 |
| LEAN-06 | At most three tabs, positions listed once, dust hidden by default. | Q4 (listing census, dust inputs), Q5 (tab fan-out and tests), Q6 (194.1 overlap) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives the plans must honour (CLAUDE.md, AGENTS.md, DESIGN.md, user memory as recorded in the project instructions):

- **Next.js here is not the Next.js of training data.** Read `node_modules/next/dist/docs/` before any routing/searchParams work. The worktree has no `node_modules`, so this research read the docs from the main checkout's install (read-only): `01-app/02-guides/single-page-applications.md` (native `pushState`/`replaceState` integrate with `useSearchParams`) and `02-pages/04-api-reference/03-functions/use-search-params.md` (dynamic route: `useSearchParams` is available on the server during the initial render). Version at that install: `next` 16.4.2 [VERIFIED: `node_modules/next/package.json` `"version"` line].
- **DESIGN.md governs every visual decision** (Numbers Contract: amounts whole dollars, null = em-dash; data density > card density; 9-State Matrix). No new tokens.
- **CHANGELOG discipline:** every ship writes one unified entry and bumps `VERSION` + `package.json` as byte-equal 4-digit strings in the same `chore(release)` commit; never `npm version`. Never write a CI-skip token in any commit message or PR body, even to deny it. Count checks bound to the head SHA.
- **Public repo hygiene:** no PROD ids, uuids, amounts, home paths, key nicknames in tracked text (`scripts/check-planning-hygiene.ts` runs in `npm run lint`).
- **Verification frontmatter:** `covered_digest`/`covered_files` are banned; use `verified_at_sha` + `drift_subjects` (never `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` in `drift_subjects`).
- **GSD handlers:** `git diff` after every `gsd-tools` state handler run. A ship branch must change nothing under `.planning/`.
- **Tests must be able to fail:** neuter, see RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). Always `grep -a`. A new `supabase/tests` file moves several censuses (none expected here).
- **Founder rules binding this phase:** a dead key affects only itself; a strategy-linked key can also be in an allocator book; withhold KPIs only under ~3 months TOTAL record (60 obs / 90 d crypto); no AI attribution trailers; never use Grok/Codex; ask before `/simplify`.
- **Migrations:** none expected. If one appears it auto-applies to PROD after TEST on merge with no human gate, so review before merge.

## Summary

The phase is a client-shell restructure of `src/app/(dashboard)/allocations/AllocationsTabs.tsx` (six tabs to three, one header button that opens a new allocator slide-over), a new at-a-glance panel and missing-data message on Overview, and Holdings fixes (label, cash, dedupe, dust). Almost everything the UI-SPEC proposes is implementable with existing primitives. Four of its premises do not survive contact with the code and must be corrected in the plans before they cost an executor a day (section "UI-SPEC premise corrections").

The single largest planning risk is Q1, the write path. **No single existing route adds an arbitrary strategy to an allocator's book AND produces a Holdings row.** `/api/portfolio-strategies/allocation` only accepts the caller's own strategies marked own-capital; `/api/allocator/scenario/commit` `voluntary_add` accepts any published strategy but writes decision/outcome rows (`match_decisions` + `bridge_outcomes`), never `portfolio_strategies`; `/api/bridge/outcome` only works for strategies the allocator was sent as an intro. Book equity, exposure and the Holdings Strategies table are built from exchange positions and `portfolio_strategies`, so a `voluntary_add` changes none of them. The recommended dispatch (own strategy -> allocation route; other strategy -> `voluntary_add`) satisfies D-03's "reusing existing allocation APIs" literally, but the UI-SPEC sentence "the row on Holdings appears from the refreshed server data" is false for the second branch. That is surfaced as Founder decision FD-1.

The second risk is figure parity (ROUTE-07/SC-2). At HEAD there is no rendered "Book equity" figure anywhere, the Scenario live strip's Sharpe is not gated by the 194 D-15 rule when no scenario is active, the Scenario live strip stays populated while the equity history is "rebuilding" (167.1.2 D-03), and the Overview's own factsheet body computes YTD/Sharpe/Max DD from a different series than the Scenario live strip. "Same values as Scenario" therefore needs one shared pure figure module that both surfaces read, plus a founder-level call on the rebuilding-state behaviour (FD-2).

**Primary recommendation:** Plan 1 extracts three pure, test-first modules (`book-figures` for Book equity / Positions count / glance figures, `cash-symbols` for the cash set, `key-data-gaps` computed server-side from the per-key series `getMyAllocationDashboard` already drains). Everything else (tabs, glance panel, flow, Holdings) consumes them. Sequence all execution after Phase 194.1 merges, and run the tab-collapse plan before the panels move.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tab strip, `?tab=` aliases, `?add=` consume | Browser / Client | Frontend Server (initial `useSearchParams`) | URL state is read by `useSearchParams` in `AllocationsTabs`; writes use `history.replaceState` (no RSC refetch). |
| At-a-glance figures | Browser / Client (pure helper over payload) | API / Backend (producer of `liveBaselineMetrics`, `holdingsSummary`) | Values must be byte-equal to Scenario, which formats client-side from the same SSR payload. |
| Per-key missing-day ranges | API / Backend (`getMyAllocationDashboard`) | Database (`csv_daily_returns`, `api_keys`) | Needs the 730-day per-key series, which is already drained server-side; shipping the series to compute gaps client-side would bloat the payload. |
| Allocation write | API / Backend (existing routes) | Database (RLS + SECURITY DEFINER RPC) | Role, CSRF, rate limit, idempotency and ownership are enforced in the routes/RPC; client only builds the request. |
| Strategy picker list | API / Backend (`/api/strategies/browse`) | Browser (client-side filter) | Existing allocator-gated read; no new list endpoint (UI-SPEC). |
| Dust, cash classification, dedupe | Browser / Client (pure helpers) | — | Presentation rules over rows the payload already carries; Book equity is shared with the glance panel. |
| Legacy-tab redirects | Browser / Client | — | Tab keys are query-param state on one route; the route contract (path-level) is unchanged. |

## Standard Stack

No package is added. Everything below is already in `package.json` at HEAD [VERIFIED: package.json dependency lines read this session].

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | ^16.4.2 | App Router, `useSearchParams`, `history.replaceState` integration | Project framework; docs read as above |
| react | 19.3.1 | Client components, `createPortal` slide-over | Project pin |
| vitest | ^5.0.3 | Unit/component tests (colocated `*.test.tsx`) | Project runner (`npm test`) |
| @playwright/test | ^1.64.1 | e2e (`e2e/*.spec.ts`) | Project runner (`npm run test:e2e`) |
| zod | (existing) | Request validation already on the commit route | No new schema needed client-side |

### Supporting (repo-internal, reuse, do not re-implement)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `@/lib/factsheet/display-sign` (`signTone`, `drawdownTone`, `formatFixedSigned`) | The ONE sign/tone rule; `src/__tests__/display-sign-single-source.test.ts` fails on a private one | Every toned figure in the glance panel |
| `@/lib/figure-gate` (`gateAnnualized`, `gatedValue`, `FigureRecord`) | D-15 total-record verdict | Sharpe in the glance panel |
| `@/lib/dollar-validation` `formatUsd`, `@/lib/utils` `formatPercent`/`formatNumber`, `@/lib/factsheet/returns-unit` `formatCloseDay` | Only formatters; bare `.toFixed` is census-pinned (R6) | All new figures |
| `@/lib/api-key-label` `apiKeyLabelById`, `dataSourceLabel` | The ONE key-label rule | Missing-data lines |
| `StrategyBrowseDrawer` / `ScenarioCommitDrawer` shell | Slide-over idiom (portal, Esc, hooks above the null gate) | The new flow's shell |
| `@/lib/envelope` `buildEnvelope`, `recogniseDashboardDialogCode` | Error envelopes (see `AllocateDialog`) | Flow write failures |
| `FIXED_MARK_SET` (`src/app/(dashboard)/compare/lib/holding-compare-adapter.ts`) | Existing TS mirror of the Python stablecoin set | Seed for the cash set (Q4) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Query param `?add=` | New route `/allocations/add` | Route needs a manifest entry, proxy review and a new page; the UI-SPEC and 196's UI-SPEC both already name the param. Keep the param. |
| Two-route dispatch for the write | New endpoint writing `portfolio_strategies` for any strategy | A new write endpoint on a money path is a founder decision (FD-1). The removed `AddToPortfolio` did this as a client-side insert; Phase 195 D-02 removed it, so do not resurrect it. |

**Installation:** none.

**Version verification:** not applicable (no new package). `package.json` pins read at HEAD.

## Package Legitimacy Audit

No external package is installed by this phase. `gsd_run query package-legitimacy check` was therefore not run.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
No banned package (CLAUDE.md table) is touched.

## UI-SPEC premise corrections (verified against code)

The UI-SPEC's Assumptions A-1..A-10 and Open questions OQ-1..OQ-10 were checked. These are the ones the code contradicts or leaves unresolved. The planner must carry the corrected form.

| # | UI-SPEC says | Code says | Plan impact |
|---|--------------|-----------|-------------|
| C1 | `HoldingsTable.tsx:504` is the "not allocated" literal (ROADMAP/CONTEXT) | The literal is at `src/app/(dashboard)/allocations/components/HoldingsTable.tsx:549` (`not allocated` inside the `isOwnCapital && !isAllocated` branch) [VERIFIED: grep -n]. Existing tests pin it: `HoldingsTable.strategy-rows.test.tsx:447-456` (`expect(cells[3]).toBe("— not allocated")`) and `:705`. | Both tests go RED and must be rewritten deliberately, not deleted. |
| C2 | Step-1 picker rows show `TrustTierLabel` and the manager | `GET /api/strategies/browse` returns `id, name, codename, markets, strategy_types, is_example, isOwn` plus owner-only `created_at`, `status` (interface `BrowseStrategyRow`, `src/app/api/strategies/browse/route.ts`). It carries **no trust tier and no manager/organization name** [VERIFIED: grep for trust/organization/manager in the route returns nothing]. UI-SPEC also forbids a new list endpoint. | Drop `TrustTierLabel` and the manager from picker rows (caption: codename, markets, strategy types, `YoursChip`, `Example` pill). Widening the browse route is the only alternative and needs its own plan; recommend dropping. |
| C3 | "The row on Holdings appears from the refreshed server data" after the write | True only for the own-capital branch (`portfolio_strategies` upsert). A `voluntary_add` writes `match_decisions` + `bridge_outcomes` only (Q1). | FD-1. The success announcement and copy for the third-party branch must say what was recorded (an allocation record in Outcomes), not promise a Holdings row. |
| C4 | `/api/portfolio-strategies/allocation` "has no date"; flow collects "amount/date" | Correct: own-capital route body is `{ strategy_id, allocated_amount }` only; the date is dropped (row's `added_at` is DB default). `voluntary_add` accepts `effective_date` (default `CURRENT_DATE`) with **no server-side 365-day window** (`z.string().date().optional()`); the 365-day rule is enforced only by `/api/bridge/outcome` and the client. | The date field is meaningful for one branch only. Either hide it for the own branch or label it as the record date. Enforce the 365-day/not-future window client-side for `voluntary_add` (the route will not). |
| C5 | Glance `Book equity` equals "the Book equity line in the Holdings Positions header" | **No rendered Book-equity figure exists at HEAD** [VERIFIED: grep "Book equity" in non-test `src` finds only a comment at `HoldingsTable.tsx:495`]. `liveBaselineMetrics.aum` is not rendered (queries.ts comment "UI-SPEC row `queries.ts liveBaselineMetrics.aum`") and is **basis-dependent**: when `bookEntryGateSatisfied` it sums only the contributing keys' holdings (`const contributingHoldings` / `const liveBaselineMetrics = bookEntryGateSatisfied ? ... : emptyLiveBaselineMetrics(...)`, `src/lib/queries.ts:6540-6547`), otherwise all holdings. | Define Book equity once: sum of `holdingEquityContribution` (non-null) over **every** `holdingsSummary` row (spot = `value_usd`, derivative = `unrealized_pnl_usd`, null skipped). Do NOT read `liveBaselineMetrics.aum`. Export one pure helper; glance, Positions header, dust rule and the share line all call it. State the number of derivative rows with no reported P&L next to it when > 0 (otherwise "Book equity" silently excludes them). |
| C6 | Glance `Sharpe` equals the Scenario live-book strip cell | The Scenario strip in live mode prints `analytics?.sharpe ?? metrics?.sharpe` where `metrics = liveMetricsForKpi` (UNGATED). The D-15 gate is applied only to `gatedLiveMetrics`, used for the "Current book" tooltip/pill, and only when own-book returns exist (`liveSharpeState` is `"null"` otherwise, which keeps the stored value) [VERIFIED: `ScenarioComposer.tsx:4474-4506` and the `<KpiStrip ... metrics={liveMetricsForKpi} liveMetrics={gatedLiveMetrics}>` call at `:6012-6020`]. | FD-2: the gated glance and the ungated Scenario cell can differ on the same payload. Recommended fix is below (shared module, Scenario reads the gated value). |
| C7 | When `equityHistoryState !== "ready"` the Return/Risk cells print `—` | The Scenario live KPIs (`liveBaselineMetrics`) are deliberately NOT withheld while history rebuilds ("The live-book KPIs (`liveBaselineMetrics`) are a separate field and stay (D-03)", `ScenarioComposer.tsx:1106-1107`). Glance `—` vs Scenario populated on one payload violates SC-2. | FD-2. |
| C8 | `?add=` removed "after the flow closes, by any path" | Phase 196's UI-SPEC (the cross-phase contract) says remove `add` "once the flow has opened so a reload does not reopen it" [VERIFIED: `git show feat/196-onestrategypage` UI-SPEC "Add to my allocation -> Phase 198" block]. | Lock the 196 semantics: consume `add` into state on open and strip it immediately. A reload then does not reopen (matches "no reopen on reload"). |
| C9 | Flagged holdings become a row chip + inline "Record outcome…" | `ScenarioFlaggedHoldingsList` is a full Bridge V2 state machine (send-intro POST, allocated/rejected forms, recorded row) and is also mounted by `ScenarioStub`, `ScenarioComposer` and `BridgeDrawer`. A flag is keyed per `(venue, symbol, holding_type)`; Holdings rows are per key (`id: ${ref}#${api_key_id}`), so one flag can map to several rows. | Highest-effort item in LEAN-06. Plan it as its own plan with a mapping rule (flag -> every row of that ref gets the chip; the action opens one form, not one per row). Keep the component for the Scenario mounts. Open question OQ-7 should not be silently re-decided in execution. |

## Architecture Patterns

### System Architecture Diagram

```
Browser URL  /allocations?tab=<t>&add=<id>
        |
        v
page.tsx (force-dynamic, server) -- Promise.all reads --> getMyAllocationDashboard(user.id)
        |   (+ NEW: keyDataGaps, bookEquity inputs ride the same payload)
        v
<Suspense> AllocationsTabs (client)
   |-- parseTab(searchParams.tab) --> overview | holdings | scenario   (legacy keys alias, see Q5)
   |-- mount effect: read ?add -> state {open, strategyId} -> history.replaceState (strip add)
   |-- header "+ Allocation" (all tabs) --> AddAllocationFlow (portal slide-over)
   |        step 1: GET /api/strategies/browse (allocator-gated) -> client filter
   |        step 2: dispatch by row.isOwn
   |             own      -> POST /api/portfolio-strategies/allocation {strategy_id, allocated_amount}
   |             other    -> POST /api/allocator/scenario/commit {diffs:[voluntary_add], Idempotency-Key}
   |        success -> router.refresh() -> new SSR payload
   |-- Overview: banners -> GlancePanel(bookFigures) -> MissingDataMessage(keyDataGaps)
   |             -> key notes -> InsightStrip -> equity curve + factsheet body -> Risk -> Mandate
   |-- Holdings: Strategies -> Positions(spot, derivatives, one dust control) -> Exposure(no drilldown)
   |             -> Outcomes -> Watchlist & Optimizer -> Notes
   `-- Scenario: unchanged (ScenarioTabContent)
```

### Recommended Project Structure
```
src/app/(dashboard)/allocations/
  AllocationsTabs.tsx            # 3 tabs, parseTab aliases, add-param consume, single header button
  lib/book-figures.ts            # NEW pure: bookEquityUsd, positionCount, glance cells (+ test)
  lib/cash-symbols.ts            # NEW pure: CASH_SYMBOLS, isCashHolding (+ parity test vs Python set)
  lib/dust.ts                    # NEW pure: isDust(row, bookEquity), partition (+ test)
  lib/key-data-gaps.ts           # NEW server-callable pure: gaps from per-key series (+ test)
  components/AddAllocationFlow.tsx   # NEW slide-over (StrategyBrowseDrawer shell)
  components/GlancePanel.tsx         # NEW
  components/MissingDataMessage.tsx  # NEW (replaces EquityHistoryRebuilding body, keeps its class table export)
```

### Pattern 1: Consume-and-strip a query param
**What:** read `add` once after mount, move it into state, strip it with the same `history.replaceState` idiom `changeTab` uses.
**When to use:** the `?add=` entry. Reading in a mount effect (not in `useState`'s initializer) avoids any server/client divergence for a portal that renders `null` on the server (`if (typeof document === "undefined") return null;` is the shipped guard in `ContributionWizardOverlay.tsx`).
**Example:**
```tsx
// Source: AllocationsTabs.tsx changeTab + the Next docs (single-page-applications.md: replaceState syncs useSearchParams)
useEffect(() => {
  const raw = searchParams.get("add");
  if (raw === null) return;
  setAddFlow({ open: true, strategyId: isUuid(raw) ? raw : null }); // empty/malformed -> step 1 with notice
  const params = new URLSearchParams(searchParams.toString());
  params.delete("add");
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
}, [searchParams, pathname]);
```

### Pattern 2: One pure module per shared figure
`book-figures.ts` returns display strings (not numbers) so the glance panel, the Positions header and the Scenario live strip are byte-equal by construction, and a parity test renders both from one payload (the `OverviewRisk.history-parity.test.tsx` idiom, which already renders two tabs from one payload object).

### Anti-Patterns to Avoid
- **Reading `liveBaselineMetrics.aum` as Book equity** (basis-dependent, C5).
- **Computing gaps client-side from `perKeyReturnsByApiKeyId`**: it is the 730-day series for every key; add a small server-computed field instead.
- **Gating on `equityHistoryState` in the glance while Scenario does not** (C7).
- **A second sign/tone rule** in the glance panel (`display-sign-single-source.test.ts` R1-R8 will fail by name).
- **Mounting a second dialog**: the flow is a portal; `AllocateDialog` stays on `Modal` (native `<dialog>` does not nest).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sign/tone of a figure | local `v > 0 ? "text-positive"` | `signTone` / `drawdownTone` from `display-sign.ts` | Census-pinned single source |
| D-15 withheld Sharpe + reason copy | new wording | `gateAnnualized`, `gatedValue`, the shared withheld-cell copy | 194 rule |
| Key label | `${exchange} ${nickname}` | `apiKeyLabelById` / `dataSourceLabel` | One rule (CLAR-04) |
| Date-range text | custom date formatting | `formatUnpricedDays` / `formatCloseDay` (UTC) | Existing, UTC-safe |
| Stablecoin/cash set | a fresh literal in a component | extend `FIXED_MARK_SET`'s source, or one exported const with a Python parity test | A hand copy is how the two sets drifted before (`closed_sets.py` header) |
| Error rendering | inline error strings | `ErrorEnvelope` + `buildEnvelope`, `recogniseDashboardDialogCode` | `AllocateDialog` pattern |
| Idempotent commit | retry loop | `Idempotency-Key` header (regex `^[A-Za-z0-9._~-]{16,128}$`) | Each `voluntary_add` otherwise mints a NEW decision row (Q1) |

**Key insight:** this phase is mostly re-pointing existing, heavily tested modules. Every "new" figure should be a pure function over `MyAllocationDashboardPayload`, tested against the surface it must equal.

## Q1. Allocator write path (D-03)

Compared at HEAD. All three are existing; none is new.

| | `POST /api/portfolio-strategies/allocation` | `POST /api/allocator/scenario/commit` (`voluntary_add`) | `POST /api/bridge/outcome` |
|---|---|---|---|
| Body | `{ strategy_id, allocated_amount }` (USD, `0 < n <= MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD`) | `{ diffs: [{ kind: "voluntary_add", strategy_id, percent_allocated (0..100), size_at_decision_usd (>=0), effective_date? , note? }], init_holdings_fingerprint?, manual_aum_usd? }` + optional `Idempotency-Key` | `{ strategy_id, kind: "allocated", percent_allocated (0.1..100), allocated_at (within 365d) }` |
| Auth | `assertSameOrigin`, `auth.getUser()`; **no role gate** | `withAllocatorAuth` (role `allocator`/`both`), CSRF via `withAuth` (`withAuth.ts:53-54`), `userActionLimiter` | `withAuthLimited` (auth + `userActionLimiter`), CSRF |
| Gate on the strategy | must be the caller's OWN (`strategies.user_id = user.id`) and `capital_ownership = own_capital` (else 404 `DASHBOARD_ROW_STALE` / 409 `ALLOCATION_NOT_ALLOCATABLE`); DB trigger `trg_portfolio_strategies_own_capital_only` backs it | RPC requires `strategies.status = 'published'` (`IF v_strategy_status IS NULL OR v_strategy_status <> 'published' THEN RAISE ... '23514'`, migration `20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql:581`) | requires an existing `match_decisions` row with `decision = 'sent_as_intro'` for this allocator/strategy |
| Row created | `portfolio_strategies` upsert (PK `(portfolio_id, strategy_id)`; second submit = edit), provisions the caller's real portfolio if absent | `match_decisions` (`decision 'snoozed'`, `kind 'voluntary_add'`) + `bridge_outcomes` (`kind 'allocated'`, `percent_allocated`, `allocated_at`) **in one transaction**; no `portfolio_strategies` row | `bridge_outcomes` upsert on `allocator_id,match_decision_id` |
| Can add a strategy the allocator does not hold? | Only own strategies | **Yes, any published strategy** | Only introduced strategies |
| Duplicate protection | Structural (PK) | **None per strategy**: every call inserts a new decision, so a second submit (new idempotency key) records a second allocation of the same strategy | One outcome per decision |
| Appears in Holdings Strategies table | Yes (`toStrategyRows` Half 1) | **No.** `getMyAllocationDashboard.strategies` is read from `portfolio_strategies` only (`queries.ts:6657`) | Only if the strategy is already positioned |
| Appears in Outcomes | No | Yes (`payload.outcomes` reads `bridge_outcomes` for the allocator, limit 200, `queries.ts:5863-5880`) | Yes |
| Changes Book equity / exposure / AUM | No (those come from exchange positions, `holdingsSummary`) | No | No |
| Machine error codes | Every arm has `code` (`recogniseDashboardDialogCode`) | No `code` field except the RPC envelope's `code` on 409; plain `{ error, message }` otherwise | `{ error }` |

[VERIFIED: route sources, migration `commit_scenario_batch` voluntary_add branch at `...sameday_empty.sql:578-` and `AllocationsTabs`/`queries.ts` readings above.]

**Recommendation:** none fits as ONE route without a new endpoint. Dispatch by `BrowseStrategyRow.isOwn`:
1. `isOwn === true` -> the allocation route (needs the own-capital mark; a 409 `ALLOCATION_NOT_ALLOCATABLE` must render its existing envelope with the pointer to My Strategies). Only branch that creates a Holdings row.
2. `isOwn === false` -> `commit` with a single `voluntary_add` diff. Build `percent_allocated` from `amount / Book equity * 100` (client; Book equity from `book-figures`), `size_at_decision_usd = amount`, `effective_date = chosen date`, a fresh `Idempotency-Key`, and **omit** `init_holdings_fingerprint` (optional; its absence skips the stale-holdings precondition, which is correct for a record-only add). When Book equity is not finite/positive, `percent_allocated` is not derivable: return the field-level refusal `We cannot size this allocation until your book equity is available.` (UI-SPEC OQ-2) rather than guessing. Pass `manual_aum_usd` only if the allocator typed one (not applicable here).
3. "Already in your book" for branch 2 must test **both** `payload.strategies[].strategy_id` and `payload.outcomes` rows with `kind === "allocated"`, because `voluntary_add` has no per-strategy uniqueness. An own strategy that is an unmarked own strategy is not held either.
4. Success copy differs per branch (C3).

This is **Founder decision FD-1** (see that section): a single-route outcome that gives every allocation a Holdings row needs a new write endpoint or a new RPC, which is a money-path change the founder must own. The plan can proceed on the two-route dispatch unless the founder says otherwise.

## Q2. Entry point Phase 196 links to

- **`/allocations?add=<strategyId>` works with this repo's Next.js handling.** `src/app/(dashboard)/allocations/page.tsx` takes no `searchParams` prop; `AllocationsTabs` (client, wrapped in `<Suspense fallback={<div />}>` at `page.tsx:175`) reads `useSearchParams()`. The page is `export const dynamic = "force-dynamic"` (`page.tsx:30`), so per the Next docs `useSearchParams` is available on the server render of a dynamic route; `window.history.replaceState` is documented to sync `useSearchParams` [CITED: node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md, "Shallow routing"; use-search-params.md "Dynamic Rendering"].
- **`parseTab` / `changeTab`:** `changeTab` copies the existing params (`new URLSearchParams(searchParams.toString())`) and sets/deletes only `tab` (`AllocationsTabs.tsx:474-480`), and the overview-cleanup effect does the same (`:438-446`), so `add` survives tab changes and cleanups. `parseTab` ignores unknown params. The unknown-`tab` breadcrumb `invalid_tab_fallback` goes through `warnAudit`; reuse it for a malformed `add`.
- **Proxy / middleware:** `src/proxy.ts` is path-based. A signed-out hit redirects to `/login` by cloning the URL (`:81-83`), which keeps the query string on `/login` but sets **no `redirect=` param**, so `add` is lost after login. That is existing behaviour for every private deep link, not a regression, and 196 shows the action to signed-in allocators only. A wrong-role user is handled by `requireRolePage(supabase, user, "allocator")` (`page.tsx:62`).
- **`route-contract-manifest.ts`:** `/allocations` is `{ route: "/allocations", class: "private", notes: "Allocator workspace — session-gated, must NOT be in PUBLIC_ROUTES." }` (`:181-184`). `scripts/check-route-contract.ts` maps `page.tsx` files to URL paths and compares them with the manifest, `PUBLIC_ROUTES` and `redirects()`; it never reads a query string. **`npm run check:route-contract` (inside `npm run lint`) needs no change** for `?add=`.
- **What must learn it:** (a) `e2e/reflow-sweep-authed.spec.ts` and `e2e/no-clip-sweep.spec.ts` route lists (add `?add=` rows, and remove the three retired-tab rows or point them at the aliases); (b) `e2e/target-size.spec.ts` for the flow's 44px targets (optional); (c) Phase 196's plan must use the exact string `/allocations?add=<strategyId>` and may rely on: valid id -> step 2 pre-filled; held -> step 1 notice; unknown/malformed/empty -> step 1 with the not-available notice. 196's own UI-SPEC already states the contract and the interim (param ignored until 198 merges).
- **Hydration:** an e2e hydration guard exists (`e2e/hydration-guard.self-test.spec.ts`, `e2e/wizard-hydration-probe.spec.ts`). Open the flow from a mount effect, not from a `useState` initializer, so the portal never diverges between server and first client render.
- **Validation of the id:** 196 requires the id be "validated server-side, never trusted from the URL". The flow validates it by resolving it against the list `GET /api/strategies/browse` returns (allocator-gated, `withPublishedOrOwner`), and `isUuid` first. The write routes re-validate (`z.string().uuid()`, ownership/published checks), so the URL is never authoritative.

## Q3. Per-key missing day ranges (D-01)

**What the payload carries today** (all in `src/lib/queries.ts`):
- `equityHistoryRebuildReason` (closed set) and, only for `key_not_syncing`, `equityHistoryNotSyncingKeyIds` (`:3659`). `duplicate_account`, `shared_account_no_working_key`, `account_identity_pending` and the rest name **no key**.
- `failingKeyExits: FailingKeyExit[]` = `{ apiKeyId, label, reason: "sync_failing" | "read_incomplete", day: string | null }` where `day` is the **last day the total counts the key**, so the missing range starts at `day + 1` (`:4784-4790`). `[]` whenever the curve is not shown (rebuilding).
- `unpricedNativeAccounts` = `{ kind: "dated", day } | { kind: "whole" } | { kind: "history", holeDays: number }`. The writer's `hole_days` array is reduced to a COUNT by `classifyUnpricedEntry` (`valid.size`), so the interior days are not available to the UI today.
- `apiKeys[]` already carries `last_sync_at`, `sync_status`, `sync_error`, `disconnected_at`, `is_active`.
- `perKeyReturnsByApiKeyId` (every key's daily returns, 730-day window) is in the payload; its source is the `csv_daily_returns` drain at `queries.ts:5901-5925`, keyed by `(api_key_id, date)`.

**Which producers know a key's missing days:**
1. **`csv_daily_returns`** (per-key dailies, written by the per-key derive): the day set per key. Missing days = every calendar day from the key's first row to the reference day with no row (interior holes), plus the tail from `last row + 1` to the reference day. This is already read; no new query.
2. **Compose payload `failing_key_exits`** (analytics-service `allocator_equity_compose.py`, flag `failing_key_exited`): why a key left the total and its last counted day.
3. **Compose `unpriced_native_keys`**: dated/whole/history facts for native-unit (BTC) accounts, with `hole_days` in the writer payload.
4. **`api_keys.sync_status` / `last_sync_at` / `sync_error`**: whether the key is failing now and since when.
5. Compose also tracks `missing_return_days` (key-days inside a key's coverage with no level; constant `_MISSING_RETURN_INSIDE_COVERAGE`), but it is a blocking-flag count, not a day list reachable from the reader.

**What to add to the SSR payload (recommended, additive, optional so legacy fixtures compile):**
```ts
keyDataGaps?: Array<{
  apiKeyId: string;            // the owner's own key (filtered through the owner's key list, T-186-18 precedent)
  firstMissingDay: string | null;   // ISO UTC day
  ranges: Array<{ from: string; to: string }> | null; // null = range unknown
  cause: "sync_failing" | "read_incomplete" | "not_syncing" | "unknown";
}>;
duplicateAccountKeyGroups?: string[][]; // key-id groups sharing one venue_account_id; the account id itself never ships
```
Computed in `getMyAllocationDashboard` (a pure `lib/key-data-gaps.ts`, unit-tested) from the rows already drained, with the reference day = the latest day in the book's series (or `todayUtc` for a failing key), never a client clock. `duplicate_account` naming "both keys" needs the group list: `venue_account_id` exists on the server-side key rows (`queries.ts:4441`, `:5138`) but is not in the client `apiKeys` projection, so group server-side and ship ids only. For `read_incomplete`/`sync_failing` without a gap list, fall back to `failingKeyExits.day + 1`. When the writer's `hole_days` list is needed for a "history" fact, widen `classifyUnpricedEntry` to carry the days; otherwise render the existing count sentence unchanged. These fields are only meaningful while the curve is not shown or a key exited; keep them `[]` otherwise.

**Rebuilding state caveat:** while `equityHistoryState` is `"rebuilding"` the derived payload is not read, so `failingKeyExits`/`unpricedNativeAccounts` are `[]` by construction. The range for a rebuilding book therefore has to come from item 1 (per-key series) and item 4, not from the compose payload. Plan the producer accordingly and test the rebuilding and ready arms separately.

## Q4. Positions listing, cash-as-Spot, dust inputs

**Where a position is rendered on `/allocations` (Holdings tab) at HEAD** [VERIFIED: `HoldingsTabPanel.tsx` read in full]:
1. **Spot table**: `HoldingsTable holdings={spotHoldingRows}` (`:628-635`), one row per `(key, venue, symbol)`, id `${ref}#${api_key_id}`.
2. **Derivatives table**: `OpenPositionsTable rows={openPositionRows}` (`:653`). Spot and derivatives are a partition of `holdingsSummary` by `holding_type`, so 1 and 2 together list each position once.
3. **`ExposureByClass` drilldown**: re-lists EVERY slice (`widgets/positions/ExposureByClass.tsx:177-224`, `data-testid="drilldown"`) at grain `(api_key_id, holding_type, venue, symbol, side)`. This is the second listing.
4. **`ScenarioFlaggedHoldingsList`**: lists flagged holdings again (`:617-627`), the third listing for flagged rows only.
5. The Scenario tab's composer lists book legs with toggles; it is a model surface on another tab, not a Holdings listing, and is out of LEAN-06's scope.
ROADMAP's "~40 positions listed three times" is therefore **reproducible by code reading for flagged positions (3x) and 2x for the rest**; the size on PROD is unmeasured (no PROD access, below).

**Cash-as-Spot:** nothing classifies cash today. The spot table's Type cell is `h.holding_type === "spot" ? "Spot" : "Derivative"` (`HoldingsTable.tsx:808`); `exposureSnapshotFromHoldings` and `ExposureByClass` put every `holding_type === "spot"` row into `classGross.spot` (`ExposureByClass.tsx:97-98`, `CLASS_ORDER = ["spot", "derivative"]`). So a USDT balance is counted as Spot gross and long exposure. The over-time series (`getNetExposureSeries`, `getAllocationSeries`, `src/lib/portfolio-exposure.ts`, both read `holding_type` from position snapshots) count cash the same way; the UI-SPEC covers only the strip and bar, so the two over-time charts will disagree with the strip unless they are changed too (or labelled). Plan this explicitly.

**Which symbols are cash** (the definitions that exist):
- Python `STABLECOINS` (the "treat-as-cash / skip the price fetch" set), verbatim: `STABLECOINS: frozenset[str] = frozenset({"USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"})` (`analytics-service/services/closed_sets.py:237-239`). Its docstring states it is the "treat as cash" set.
- `STABLECOIN_SPLIT_SUFFIXES: frozenset[str] = frozenset({"USDE", "PYUSD", "USDB"})` (`closed_sets.py:246`), deliberately NOT cash for price-skip purposes.
- TS mirror of the union (`STABLECOINS | SUFFIXES`) in `FIXED_MARK_SET` (`compare/lib/holding-compare-adapter.ts`), verbatim: `stablecoinSymbols: new Set(["USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD", "USDE", "PYUSD", "USDB"])`, with a parity test against the Python literals. That set means "fixed mark", not "cash".
- MT5 rows (`ACCOUNT-<hex>` symbols, `isCryptoExchange` false) are account balances, not tickers; `holdingWithheldReason` returns `account_balance` for them.

**Recommendation (Claude's Discretion):** cash = a spot row whose upper-cased symbol is in the Python `STABLECOINS` literal (7 symbols), exported once from a new `lib/cash-symbols.ts` with a parity test that reads the Python literal (copy the `FIXED_MARK_SET` parity test's approach). Exclude the three split-suffix symbols and MT5/sFOX account-balance rows from "cash" unless the founder says otherwise (their cash-ness is not what the Python set asserts); list them in the Assumptions Log. Cash rows: Type `Cash`; excluded from Gross/Net/Long/Short and from the Spot/Derivatives composition shares; a `Cash` cell prints the cash total with `formatUsd`. The `$0` vs `—` rule in the UI-SPEC (`$0` only when cash rows were read and summed to zero) needs the builder to return `cash: number | null`.

**Dust rule inputs:** spot row = `value_usd` (the table prints `formatUsd(h.value_usd)`; unpriced rows print "No price" via `holdingIsPriceGap` and must never be dust); derivative row = `notional_usd` (`OpenPositionsTable.tsx:290`, printed notional); Book equity from `book-figures` (C5). Untrusted-key rows are filtered by the existing `showRevoked` toggle on the spot table only; derivative table has no such filter, so "never dust on an untrusted key" needs the key status the panel already maps (`keyStatusById`). Strict comparisons per UI-SPEC: `< 50` and `< 0.001 * bookEquity`; with non-finite Book equity only the $50 test. Totals and counts use all rows. **Census caution:** `src/__tests__/holding-scope-key-census.test.ts` pins per-file counts for `HoldingsTabPanel.tsx` (matcher M2 `count: 2`, symbols `spotHoldingRows`, `openPositionRows`); a new key composition in that file moves the count and fails by name, so keep new row-id builders in the new `lib/` modules and update the census deliberately if it moves.

## Q5. Inbound links to retired tabs and tests that pin six tabs

**Live inbound links (non-test source, excluding comments):**
| Where | Link | Resolution |
|---|---|---|
| `src/components/layout/Sidebar.tsx:296` (`buildPrimaryMobileNav`) | `{ label: "Risk", href: "/allocations?tab=risk", ... }` | Alias lands on Overview `#risk`; keep the item (nav label "Risk" still true), update its tests |
| `src/components/layout/MobileNav.tsx:29` | comment only; consumes the list above | none beyond the Sidebar item |
| `src/app/(dashboard)/allocations/components/BridgeWidget.tsx:241` | `href="/allocations?tab=outcomes"` | `BridgeWidget` is not mounted anywhere (194.1 research: `grep "<BridgeWidget"` finds only a CSS comment); alias covers it; update the string and `BridgeWidget.test.tsx:235-272` |
| `AllocationsTabs.tsx:232-234` | docblock only | rewrite |
| `src/app/(dashboard)/allocations/MandateTabPanel.tsx:162` | `href="/profile?tab=mandate"` | **Not a retired tab**: `/profile?tab=mandate` is the Profile page's own tab; keep |
| `src/app/(dashboard)/preferences/page.tsx:8`, `route-contract-manifest.ts:244`, `ProfileTabs.test.tsx` | `?tab=mandate` on `/profile`/`/preferences` | Not retired; leave |
Other `/allocations` links carry no tab (`ExchangesTabContent.tsx:40,52`, `recommendations/page.tsx:352`, `portfolio-pdf/[id]/page.tsx:55`, `email.ts:686`, `requireRolePage.ts:114`) and need nothing. The UI-SPEC's "10 `tab=risk`, 7 `tab=outcomes`, 1 `tab=mandate`" count includes comments and tests; the live-link count is the table above. Also note `next.config.ts` redirects `/scenarios` to `/allocations?tab=scenario` (kept, `scenario` stays a tab).

**Tests that pin six tabs, the old labels or the old header (will go RED and must be updated deliberately):**
- `AllocationsTabs.test.tsx` (52 `it`): tab names `"Outcomes"`, `"Mandate"`, `"Risk"` (`:458-476`), the order array `["Overview", "Holdings", "Outcomes", "Mandate", "Risk", "Scenario"]` (`:598`), `?tab=risk` fixtures (`:685-1212`), `?tab=outcomes` URL stability (`:1304-1344`), `window.location.search` toBe `"?tab=mandate"` (`:585`).
- `AllocationsTabs.scenario-composer.test.tsx`: `setSearchParams("tab=outcomes"/"mandate"/"risk")` (`:510-520`, `:705`), the header aria-label `/Add allocation — connect an exchange or upload a CSV/i` (`:544`), `getByRole("tab", { name: "Risk" })` (`:707`).
- `AllocationsTabs.addalloc.test.tsx` (T_ADDALLOC_1..6, S1..S7): pins header label/aria per tab, overlay open/focus/refresh, the Browse-open registration seam (`onRegisterOpenBrowse`, `onBrowseClosed`, `onBrowseHandoff`), and S7 (rollback `ScenarioStub` opens the wizard). Rewrite around the new flow; the composer's own Browse seam props stay on `ScenarioComposer`, so decide in the plan whether to remove the dead host plumbing (`composerBrowseOpenRef`, `pendingBrowseOpenRef`, `headerBrowseTriggeredRef`) or leave it unreferenced; removing it also removes S1-S6.
- `AllocationsTabs.connect-key-predicate.test.tsx:270` (`describe.each(TABS.map(...))`), `AllocationsTabs.onboarding.test.tsx`, `AllocationsTabs.tabstrip-scroll.test.ts`, `AllocationsTabs.scenario-state-preservation.test.tsx`.
- Holdings: `HoldingsTable.strategy-rows.test.tsx:447-456,705` ("not allocated"); `HoldingsTabPanel.test.tsx:212-223,349-354`, `HoldingsTabPanel.exposure.test.tsx:113-118`, `HoldingsTabPanel.key-read-notes.test.tsx:287-301` (section order and the `"Exchange Positions"` heading, which becomes `Positions` and moves up); `HoldingsTabPanel.exposure-agreement.test.tsx`, `ExposureByClass.test.tsx` (drilldown removal, cash cell).
- Panels that move: `RiskTabPanel.book-series.test.tsx`, `MandateTabPanel.test.tsx`, `OverviewRisk.history-parity.test.tsx` (Overview vs Risk parity becomes a same-tab section; the `[data-widget-id]` count of 6 at `:365,384` moves), `AllocationDashboardV2.*.test.tsx` (rebuilding, failing-key, departed-history, unpriced-account, warmup, history-reconstruct-failed pin the old notes and the generic panel).
- `src/components/layout/MobileNav.test.tsx:44,49,91,116,189` (the `Risk` item), `BridgeWidget.test.tsx:235-272`.
- e2e: `e2e/reflow-sweep-authed.spec.ts:95-97,375-377`, `e2e/no-clip-sweep.spec.ts:212-214` (three retired-tab rows each; aliases make them still pass but they no longer test distinct surfaces), and **`e2e/wizard-resume.spec.ts:114-124`, which clicks the header button (`/Add allocation/i`) and expects the manager wizard dialog named "Add a strategy" with the draft-resume banner**. That spec pins the exact behaviour ROUTE-06 removes. The wizard's resume path is still reachable via the sidebar "Add a Strategy" and My Strategies; re-point the spec there, do not delete it.
- `src/__tests__/trim-removed-surfaces.test.tsx` is Phase 195's guard (Tweaks, AddToPortfolio); it does not pin tab keys but a new test next to it is the natural home for a "no `WizardClient` under `allocations/AllocationsTabs`" assertion.

**Residual manager-wizard entry on the allocator workspace (scope note):** `src/components/layout/DashboardChrome.tsx` hosts a `ContributionWizardOverlay` opened by the sidebar/mobile "Add a Strategy" action (`Sidebar.tsx:13,170,307`, `onNavAction={openContribute}`). ROUTE-06's text covers the "+ Allocation" button only. See FD-3.

## Q6. Overlap with Phase 194.1 (executing in parallel; 198 executes after it merges)

Read from the 194.1 research and plan split (`git show feat/194.1-d04sweep:.planning/phases/194.1-.../194.1-RESEARCH.md`, "Plan split" table, which names 198 explicitly). 194.1 has no code on its branch yet (research + patterns only). Files both phases touch:

| File | 194.1 plan | 198 | Sequencing |
|---|---|---|---|
| `components/ScenarioComposer.tsx` | 07: one hunk near `scenario-detail-cagr-*`/`-sharpe-*` (~`:8508`, `:8525`) plus a prop | the live-metrics gate hunk (`liveMetricsForKpi`/`gatedLiveMetrics`, `:4474-4506`) if FD-2 is accepted; header-seam cleanup | After 194.1; different hunks, rebase and do not re-flow |
| `components/ScenarioCompareTable.tsx`, `ScenarioComparePanel.tsx`, `lib/scenario-compare.ts` | 06 | none expected | none |
| `src/components/portfolio/ReplacementCard.tsx` (reached via Overview `InsightStrip` -> `BridgeTrigger` -> `ReplacementPanel`) | 09 (Bridge delta) | Overview re-layout hosts the card | 198 must not touch the component; re-test after merge |
| `src/lib/queries.ts` | 12: `getStrategyDetailV2` only | adds `keyDataGaps`/`duplicateAccountKeyGroups` in `getMyAllocationDashboard` | Different functions; rebase |
| `src/app/api/strategies/[id]/returns/route.ts` | 07 | none | none |
| `AllocationsTabs.tsx`, `AllocationDashboardV2.tsx`, `HoldingsTabPanel.tsx`, `HoldingsTable.tsx`, `ExposureByClass.tsx`, `EquityHistoryRebuilding.tsx`, `history-gate.ts` | none listed in 194.1's plan table | all | 198 only; but 194.1's census test `figure-gate-census.test.ts` (plan 01, new) scans for ungated annualised figures: the glance Sharpe must go through `figure-gate` or it will fail that test |

Because 194.1 "sweeps a figure gate across signed-in pages", expect its census to cover the new glance panel. Build the glance Sharpe on `gateAnnualized` from the start so it passes untouched. Re-measure the 194.1 file list at merge time (it is a plan, not a diff).

## Common Pitfalls

### P1: Treating `voluntary_add` as a Holdings write
**What goes wrong:** the executor submits the flow, `router.refresh()` runs, and nothing new appears on Holdings or in Book equity.
**Why:** `voluntary_add` writes decision/outcome rows only (Q1). **Avoid:** two-route dispatch and per-branch success copy; test both branches end to end. **Warning sign:** a flow test that asserts a Holdings row for a third-party strategy.

### P2: Duplicate allocation on retry
**What goes wrong:** a double click or a retry with a fresh `Idempotency-Key` records the same strategy twice.
**Why:** each `voluntary_add` inserts a new `match_decisions` row; no per-strategy uniqueness. **Avoid:** one key per submit attempt, reused for retry; disable the primary while in flight; treat the strategy as "In your book" once an `allocated` outcome exists.

### P3: Glance and Scenario disagree on one payload
**What goes wrong:** SC-2 fails; Sharpe differs (gated vs ungated), YTD differs (derived history vs per-key blend), Book equity differs (`liveBaselineMetrics.aum` basis).
**Avoid:** shared `book-figures` module read by both; a parity test that renders glance and Scenario live strip from one payload including a short-record book and a rebuilding book. See FD-2.

### P4: Reading `?add=` in a `useState` initializer
**What goes wrong:** the portal renders on the first client render but not on the server; hydration warning. **Avoid:** mount effect (Pattern 1).

### P5: Moving panels breaks the `historyGate` contract
`historyGate` returns `no_eligible_key` / `rebuilding` / `ready` for BOTH Overview and Risk so they cannot disagree (170.4). Folding Risk into Overview must keep one call site, keep the `EmptyState` connect card replacing items 2-8, and keep `EquityHistoryRebuilding`'s exported `equityHistoryRebuildClass` and `ExchangesPageLink` (imported by `ScenarioComposer` and `RiskTabPanel`). Replacing the generic panel must not change the class table, or the Scenario own-book sentence and the Overview diverge (the stated invariant in that file's docblock).

### P6: Lazy tab chunks and anchors
Holdings/Outcomes/Mandate/Risk panels are `next/dynamic({ ssr: false })` (`AllocationsTabs.tsx:102-123`). A legacy-alias scroll to `#risk` / `#outcomes` / `#mandate` must wait for the panel to mount (the section does not exist until its chunk loads). Overview's Risk/Mandate are small; moving them into the main Overview tree removes the problem for those two; `#outcomes` on Holdings still needs a post-mount scroll.

### P7: Census and lint guards that fail by name
`display-sign-single-source.test.ts` (R1-R8: no private sign/tone, `.toFixed` counts), `holding-scope-key-census.test.ts` (M2 count for `HoldingsTabPanel.tsx`), `contracts-registry.test.ts` (design-lint frozen islands), the 194.1 `figure-gate-census`, `check-planning-hygiene.ts` (this file's own text), and the UI-SPEC's "no new font/token". Run the three census tests after the first panel moves, not at the end.

### P8: PROD reads and migrations
None are needed to implement. If a plan adds a migration (it should not), it auto-applies to PROD after TEST with no human gate; every review happens before merge.

### P9: A key problem leaking into other keys' figures
Founder rule: a dead key affects only itself. A `—` on glance Return/Risk because ONE key failed would withhold the whole book's figures for one key's fault. The Holdings group already renders from holdings; decide explicitly (FD-2) whether Return/Risk are withheld only when the book itself is not computable, and name the failing key in the message either way. Never write "your keys" for a one-key fault (UI-SPEC scope rule).

## Code Examples

### Dispatch by ownership (sketch, values verified in the routes above)
```ts
// Source: src/app/api/portfolio-strategies/allocation/route.ts (body keys) and
//         src/app/api/allocator/scenario/commit/route.ts (VoluntaryAddDiff keys)
const own = await fetch("/api/portfolio-strategies/allocation", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ strategy_id, allocated_amount }),
});
const other = await fetch("/api/allocator/scenario/commit", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": attemptKey /* 16-128 chars */ },
  body: JSON.stringify({
    diffs: [{ kind: "voluntary_add", strategy_id, percent_allocated, size_at_decision_usd, effective_date }],
  }),
});
```
Both go through `assertSameOrigin` (same-origin `fetch`), so no extra header is needed beyond the above.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Router navigation for tab/query changes | `history.replaceState`, `useSearchParams` re-derives | Phase 167.1.2 plan 07 (SC-5c) | `add` consume must use the same idiom |
| `liveBaselineMetrics` all-or-nothing gate | SOME-semantics `bookEntryGateSatisfied` + contributing-key narrowing | Phase 151/AUM-04 | Book equity from `.aum` is basis-dependent (C5) |
| Manager `WizardClient` behind "+ Allocation" | Allocator slide-over (this phase) | Phase 198 | `wizard-resume.spec.ts` and `addalloc` tests re-point |
| Equity history shown from snapshots | Hidden until derived v2 curve is trustworthy (167.1.2 D-02) | Phase 167.1.2 | glance Return/Risk behaviour (FD-2) |

**Deprecated/outdated:** `AddToPortfolio` and `/portfolios` (removed by Phase 195 D-01/D-02); the ROADMAP line number `HoldingsTable.tsx:504` (now `:549`).

## Runtime State Inventory

Not a rename/refactor/migration phase in the data sense (no stored string is renamed). Stated explicitly:
- **Stored data:** None. Tab keys live only in URLs and in no stored preference. The retired `allocations.tweaks` value is already ignored (Phase 195). `allocations.ui_v2` localStorage flag scope is Scenario only and is unchanged.
- **Live service config:** None.
- **OS-registered state:** None.
- **Secrets/env vars:** None.
- **Build artifacts:** None. External inbound bookmarks/emails to `?tab=risk|outcomes|mandate` are handled by the alias (Q5), not by data migration.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node `node_modules` in the worktree | vitest, tsc, lint, Next docs | no (worktree has none) | — | run `npm ci` in the worktree before the first plan task that runs tests; do not symlink the main checkout |
| `next` docs (`node_modules/next/dist/docs`) | AGENTS.md rule | only in the main checkout's install (read-only use by this research) | 16.4.2 | `npm ci` provides them in the worktree |
| Playwright + seeded local stack (`scripts/local-stack/run.sh`) | e2e specs | not probed (execution-time) | — | e2e is CI-run (`e2e-seeded`); unit/component tests carry the phase gate locally |
| Supabase MCP `execute_sql` | PROD measurement | **not available to this research session** | — | orchestrator or a later session runs the statements listed under "PROD reads" |

**Missing dependencies with no fallback:** none block planning.
**Missing dependencies with fallback:** worktree `node_modules` (npm ci), PROD measurement (below).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^5.0.3 (jsdom component tests, colocated `*.test.ts(x)`), Playwright ^1.64.1 for e2e |
| Config file | `vitest.config.ts` (coverage thresholds are a ratchet, read live from the file), `playwright.config.ts` |
| Quick run command | `npx vitest run "src/app/(dashboard)/allocations"` |
| Full suite command | `npm test` (plus `npm run typecheck` and `npm run lint`, which includes `check:route-contract` and `check:planning-hygiene`) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROUTE-06 | Header `+ Allocation` on Overview, Holdings AND Scenario opens the allocator flow and never mounts `WizardClient` (mock it, assert absent) | component | `npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx"` | exists, rewrite |
| ROUTE-06 | Dispatch: own -> allocation route body; other -> `voluntary_add` diff + `Idempotency-Key`, no fingerprint; both error envelopes | component | `npx vitest run "src/app/(dashboard)/allocations/components/AddAllocationFlow.test.tsx"` | ❌ Wave 0 |
| ROUTE-06 | `?add=<valid>` pre-fills step 2; held -> notice; unknown/empty/malformed -> step 1 + notice + `invalid` breadcrumb; `add` stripped on open; survives `changeTab` | component | `npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.add-param.test.tsx"` | ❌ Wave 0 |
| ROUTE-06 | Factsheet link lands in the flow | e2e | `npx playwright test e2e/allocations-add.spec.ts` | ❌ Wave 0 (after 196) |
| ROUTE-07 | Glance cells byte-equal the Scenario live strip and the Positions header from one payload (YTD, Sharpe gated, Max DD, Book equity, Positions) | component | `npx vitest run "src/app/(dashboard)/allocations/lib/book-figures.test.ts" "src/app/(dashboard)/allocations/components/GlancePanel.test.tsx"` | ❌ Wave 0 |
| ROUTE-07 | Missing-data line per reason/arm (each of the 8 rebuild reasons, failing-key exit, unpriced fact), fallback sentences, sort order, "never writes `your keys` for one key" | component | `npx vitest run "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx"` | ❌ Wave 0 |
| ROUTE-07 | `key-data-gaps` from per-key rows: interior holes, tail gap, single day, reference day never a client clock | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts"` | ❌ Wave 0 |
| ROUTE-07 | Generic "We are holding back your equity history" never renders (RED first on the literal) | component | `npx vitest run "src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx"` | exists, rewrite |
| ROUTE-08 | No `not allocated` literal; `—` + `no amount entered`; allocated row prints `formatUsd` + `Edit allocation…` (RED first) | component | `npx vitest run "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx"` | exists, rewrite |
| ROUTE-08 | Cash set equals the Python literal (parity), cash row Type `Cash`, excluded from Gross/Net/Long/Short, `Cash` cell `$0` vs `—` | unit + component | `npx vitest run "src/app/(dashboard)/allocations/lib/cash-symbols.test.ts" "src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.test.tsx"` | ❌ Wave 0 / exists |
| LEAN-06 | Exactly three tabs in order; legacy `tab=risk|outcomes|mandate` alias + scroll + URL after mount; arrow/Home/End over three | component | `npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx"` | exists, rewrite |
| LEAN-06 | Each position appears in exactly one row on the whole Holdings panel (count rows per `(key, venue, symbol, type, side)` across the DOM, flagged positions included) | component | `npx vitest run "src/app/(dashboard)/allocations/HoldingsTabPanel.positions-once.test.tsx"` | ❌ Wave 0 |
| LEAN-06 | Dust: strict `<50`, `<0.1%`, unpriced never dust, untrusted key never dust, no Book equity -> $50 only, totals unchanged, `Show 1 small position`/`Show n`, caption, `aria-expanded`, LiveRegion | unit + component | `npx vitest run "src/app/(dashboard)/allocations/lib/dust.test.ts" "src/app/(dashboard)/allocations/HoldingsTabPanel.dust.test.tsx"` | ❌ Wave 0 |
| All | a11y: flow both steps, 3-tab page, Holdings with dust expanded, zero wcag2a/2aa/best-practice violations; 320px reflow incl. `?add=` | e2e | `npx playwright test e2e/reflow-sweep-authed.spec.ts e2e/composer-axe.spec.ts` | exist, extend |

Every gate above must be neutered, seen RED, and restored from a byte backup (project rule); the RED-first literals are `not allocated`, the old six-tab order array, the cash-in-Spot classification, and the generic notice.

### Sampling Rate
- **Per task commit:** the quick command above for the touched files, plus `npx tsc --noEmit`.
- **Per wave merge:** `npx vitest run "src/app/(dashboard)/allocations" src/components/layout src/__tests__` and `npm run lint`.
- **Phase gate:** full `npm test` green and the CI e2e jobs green, bound to the head SHA, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `lib/book-figures.ts` + test (Book equity, Positions count, glance strings)
- [ ] `lib/cash-symbols.ts` + parity test against `analytics-service/services/closed_sets.py`
- [ ] `lib/dust.ts` + test
- [ ] `lib/key-data-gaps.ts` + test and the `getMyAllocationDashboard` wiring test (`queries.my-allocation.test.ts` is the home for payload-shape pins)
- [ ] `components/AddAllocationFlow.test.tsx`, `GlancePanel.test.tsx`, `MissingDataMessage.test.tsx`
- [ ] `HoldingsTabPanel.positions-once.test.tsx`, `HoldingsTabPanel.dust.test.tsx`
- [ ] `AllocationsTabs.add-param.test.tsx`
- [ ] `npm ci` in the worktree (framework install)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (existing session) | `supabase.auth.getUser()` in page and routes |
| V3 Session Management | no | existing |
| V4 Access Control | yes | page `requireRolePage(..., "allocator")`; `/api/strategies/browse` and `commit` are `withAllocatorAuth`; the allocation route has NO role gate but is bound by ownership + own-capital trigger + RLS (note it; do not widen) |
| V5 Input Validation | yes | `isUuid` on `add`, resolve against the allocator-gated list, never trust the URL; amount/date validated client-side AND by the routes (zod on commit; `parseAmount` on allocation); the 365-day date window is client-only for `voluntary_add` (C4) |
| V6 Cryptography | no | none |
| V13 API / CSRF | yes | `assertSameOrigin` on all three routes (same-origin fetch); `Idempotency-Key` format validated server-side |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged `?add=<other user's strategy id>` | Spoofing/Tampering | Id only pre-fills UI; routes re-check published/own + RPC ownership; `add` stripped after open |
| Double submit minting duplicate allocations | Tampering | Idempotency-Key per attempt, disabled primary in flight (P2) |
| Information leak of other keys/accounts in missing-data text | Information disclosure | Only the owner's own key labels (filter through the owner's key list, T-186-18 precedent); ship group ids, never `venue_account_id` |
| Tier redaction bypass in the picker | Information disclosure | Use `/api/strategies/browse` names as returned (`displayStrategyName`, own-row carve-out); do not join manager/org data client-side (C2) |
| Key nickname/PII in tracked planning text | Disclosure | planning-hygiene lint; this file carries none |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Python `STABLECOINS` literal (7 symbols) is the right cash definition; split-suffix symbols and MT5/sFOX account rows are not cash | Q4 | A USDE/PYUSD/USDB balance would still read as Spot, or an account row would be mislabelled Cash; founder/planner confirmation |
| A2 | `voluntary_add` with `percent_allocated = amount / Book equity * 100` and no fingerprint is an acceptable record of a third-party allocation | Q1 | Allocation recorded with a percent that drifts as Book equity changes; the Scenario drawer has the same property |
| A3 | Reference day for gap ranges is the latest day in the book's series (or UTC today for a failing key) | Q3 | Range end off by a day around the 04:00 UTC poll; test both |
| A4 | Hiding `TrustTierLabel`/manager from picker rows is acceptable (browse read lacks them) | C2 | UI-SPEC visual regression; alternative is widening the browse route |
| A5 | ROADMAP's "~40 positions listed three times" is accurate on PROD | Q4 | Unmeasured here; code reading shows 2x for all and 3x for flagged rows |
| A6 | The ASVS mapping above is the right set for this surface | Security | none material |
| A7 | 194.1 will not touch `AllocationsTabs`/`HoldingsTabPanel`/`AllocationDashboardV2` | Q6 | Rebase conflicts; re-read its diff when it merges |

## Open Questions (RESOLVED)

1. **Does the founder accept that a third-party "+ Allocation" records an Outcome, not a Holdings row?** (FD-1.) What we know: the code cannot do otherwise through existing routes. Recommendation: accept two-route dispatch.
   **RESOLVED (2026-11-08) by CONTEXT D-05.** The founder picked "Reuse existing routes (Recommended)". An own strategy goes to `/api/portfolio-strategies/allocation`, and someone else's goes to `/api/allocator/scenario/commit` as a `voluntary_add`, recorded under Outcomes. Planned in 198-05 and 198-08.
2. **Which "return" is the book's return on Overview?** (FD-2.) Three computations exist (factsheet body over derived returns; Scenario live strip over per-key blend; none on Holdings). Recommendation below.
   **RESOLVED (2026-11-08) by CONTEXT D-06.** The glance reads the same shared figures module as Scenario's live strip. The 194 D-15 gate applies on both surfaces, and the figures show independent of `equityHistoryState`. The two YTD figures carry distinct labels. Planned in 198-01.
3. **Should the three over-time exposure charts also exclude cash?** What we know: they read position snapshots by `holding_type`. Recommendation: yes, via the same cash set, or label them; a plan decision, no founder input needed unless the history snapshots lack the symbol granularity (they carry `symbol`).
   **RESOLVED by plan decision in 198-07.** `getNetExposureSeries` excludes cash and keeps every read day. `getAllocationSeries` keeps cash, because that chart shows where capital sits, and its docblock says so.
4. **`unpricedNativeAccounts` interior days:** widen the reader to carry `hole_days`, or keep the count sentence? Recommendation: keep the count for now (smallest change); the range sentence is only owed where the producer already knows days.
   **RESOLVED on the recommendation.** No plan widens `classifyUnpricedEntry`, so the unpriced-native count sentence renders unchanged. 198-03 records the related interior-hole decision, with its reason: interior holes in a key's series are not reported as missing days.

## Founder decisions needed (RESOLVED)

All three were settled on 2026-11-08: FD-1 by CONTEXT D-05, FD-2 by CONTEXT D-06, and FD-3 by the CONTEXT Deferred Ideas entry (the sidebar "Add a Strategy" stays in this phase, and a follow-up is to be booked). The original entries are kept below as lineage.

**FD-1 Write path for third-party strategies (blocks ROUTE-06 acceptance wording).** **RESOLVED by D-05.**
Options: (a) two existing routes, dispatch by `isOwn` (own -> `/api/portfolio-strategies/allocation`, others -> `commit` `voluntary_add`); a third-party add is recorded under Outcomes and changes no Holdings row, Book equity or exposure. (b) A new endpoint/RPC that writes `portfolio_strategies` for any strategy so every add gets a Holdings Strategies row; this is a new money-path write with RLS/trigger review (the own-capital trigger currently blocks self-owned unmarked strategies, and `AddToPortfolio` was removed in Phase 195). **Recommendation: (a)**, with per-branch success copy. D-03 says "reusing existing allocation APIs", which (a) satisfies literally.

**FD-2 What "same values as Scenario" means for the glance panel (blocks ROUTE-07 test design).** **RESOLVED by D-06.**
Facts: Scenario's live strip reads `liveBaselineMetrics` (per-key blend over contributing keys) and stays populated while history rebuilds (167.1.2 D-03); its live Sharpe cell is not D-15 gated when no scenario is active; the Overview's factsheet body (ready state) computes YTD/Sharpe/Max DD from the derived whole-book returns. Options: (a) glance = Scenario's source via a shared `book-figures` module, D-15 gate applied to BOTH (small change in `ScenarioComposer.tsx` so its live cell uses the gated value), glance shown whenever those figures exist, independent of `equityHistoryState`; label it and accept that the factsheet body below may show a different YTD (different series). (b) UI-SPEC as written: glance `—` while history is not ready, which makes it disagree with Scenario's populated strip. **Recommendation: (a).** It honours SC-2 ("same values Scenario and Holdings show"), the founder rule that a key problem affects only itself, and 194 D-15. Residual: two YTD figures on the ready Overview from different series; name each by its series in the label/caption or ask whether the factsheet body should hide its KPI strip on this surface.

**FD-3 Sidebar/mobile "Add a Strategy" (small, can default to "leave as is").** **RESOLVED: deferred (CONTEXT Deferred Ideas).**
It still opens the manager `WizardClient` for allocators (`DashboardChrome` -> `ContributionWizardOverlay`). ROUTE-06 names only the "+ Allocation" button. **Recommendation:** leave it and book a follow-up; it is also the surviving path for `e2e/wizard-resume.spec.ts`.

## PROD reads

**Run by the orchestrator on 2026-11-08** after this research returned (the researcher had no MCP tool). Instrument: `mcp__claude_ai_Supabase__execute_sql`, one read-only statement per call. Aggregates only; no ids, amounts or labels are recorded here.

1. Marker query (`SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();`): named PRODUCTION. All reads below ran after it.
2. `information_schema.columns` for `public.allocator_holdings`: columns include `api_key_id, venue, symbol, asof, holding_type ('spot' | 'derivative'), side, quantity, value_usd, mark_price, quantity_unit`.
3. Latest-read rows (each key's newest `asof`), one aggregate statement: 7 books, 317 rows (39 spot, 278 derivative), 0 rows with a NULL `value_usd`.
   - **Cash typed as Spot: 16 of the 39 spot rows** have a symbol in the seven-symbol `STABLECOINS` set. All of them are counted as Spot exposure today. This confirms ROUTE-08 / SC-3 on live data.
   - **Spot dust:** 13 spot rows are under $50, and 12 of them are under $15. 13 are under 0.1% of their book's spot total. This confirms the "$0-$15 dust rows" in the ROADMAP evidence.
4. Derivative dust (same latest-read set): 22 derivative rows have `|value_usd| < 50`, and 22 have `|quantity x mark_price| < 50`. No derivative row has a zero quantity. So with D-04's rule about 35 of the 317 rows would be hidden by default.
5. Same position under several keys (latest read, grouped by book, venue, symbol, type and side):
   - 241 positions are read by one key.
   - 29 positions are read by two keys (in 4 books).
   - 6 positions are read by three keys (in 2 books).
6. The keys behind each multi-key position, joined to `api_keys.venue_account_id`:
   - Most have no `venue_account_id` recorded.
   - Quantities differ between the keys for 29 of the 35 multi-key positions and are identical for 6.
   - **Reading:** the bulk are separate accounts that hold the same symbol, so they are correctly separate rows. The founder rule is that one exchange account under several logins is intended. The "listed three times" symptom is therefore the render-level repetition named in Q4 (positions table + `ExposureByClass` drilldown + `ScenarioFlaggedHoldingsList`). It is not a data-level duplicate, and this phase must not merge rows across keys.
7. `portfolio_strategies` joined to `strategies` by `capital_ownership` and amount-missing: **0 rows**. Follow-up totals in one statement: `portfolio_strategies` 0, `portfolios` 16, `bridge_outcomes` 2, `match_decisions` 2.
   - Consequence for FD-1: no allocator has a single allocation row in PROD today, through either branch.
   - The "not allocated" label the founder saw therefore renders on rows built from key-linked strategies, not from `portfolio_strategies`. The planner must confirm which producer feeds `HoldingsTable`'s Strategies rows before writing the RED test.

## Sources

### Primary (HIGH confidence, opened this session)
- Worktree HEAD `3b5e46f0a` source: `src/app/(dashboard)/allocations/{AllocationsTabs,AllocationDashboardV2,HoldingsTabPanel,page}.tsx`, `components/{HoldingsTable,EquityHistoryRebuilding,KpiStrip,ScenarioComposer,ContributionWizardOverlay,StrategyBrowseDrawer}.tsx`, `lib/{history-gate,exposure-snapshot,strategies-row-adapter}.ts`, `widgets/positions/ExposureByClass.tsx`, `RiskTabPanel.tsx`, `ScenarioFlaggedHoldingsList.tsx`
- Routes: `src/app/api/portfolio-strategies/allocation/route.ts`, `src/app/api/allocator/scenario/commit/route.ts`, `src/app/api/bridge/outcome/route.ts`, `src/app/api/strategies/browse/route.ts`, `src/lib/api/withAllocatorAuth.ts`, `withAuth.ts`
- DB: `supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql` (voluntary_add branch), `20260806120000_strategies_capital_ownership.sql` (own-capital trigger), `20260426131719_bridge_outcomes_relax_for_voluntary.sql`
- `src/lib/queries.ts` (payload type, `readFailingKeyExits`, `equityHistoryReadiness`, `liveBaselineMetrics` wiring, `csv_daily_returns` drain), `src/proxy.ts`, `src/lib/routing/route-contract-manifest.ts`, `scripts/check-route-contract.ts`, `next.config.ts`
- `analytics-service/services/closed_sets.py` (`STABLECOINS`), `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts` (`FIXED_MARK_SET`)
- Next.js 16.4.2 bundled docs: `01-app/02-guides/single-page-applications.md`, `02-pages/04-api-reference/03-functions/use-search-params.md`
- Planning: `198-CONTEXT.md`, `198-UI-SPEC.md`, `REQUIREMENTS.md`, ROADMAP `### Phase 198`, `194-CONTEXT.md`; `git show feat/196-onestrategypage` (196 CONTEXT D-02, 196 UI-SPEC "Add to my allocation -> Phase 198"); `git show feat/194.1-d04sweep` (194.1 RESEARCH plan-split table)

### Secondary (MEDIUM confidence)
- 194.1 research's claim that `BridgeWidget` is unmounted (import-chain grep by that session; not re-run here)

### Tertiary (LOW confidence)
- None used.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new package, all modules opened.
- Architecture / write path: HIGH for the route comparison; MEDIUM for the dispatch recommendation (founder-gated).
- Pitfalls: HIGH for code-derived ones (P1-P7); P3/P9 depend on FD-2.
- Sizes on PROD: none (unmeasured).

**Research date:** 2026-11-08
**Valid until:** about 2026-11-15 (fast-moving: 194.1 and 196 are in flight and both touch adjacent files; re-measure the Q6 overlap table and the `ScenarioComposer.tsx` line numbers at the 194.1 merge).
