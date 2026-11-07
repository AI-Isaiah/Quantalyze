# Roadmap: Quantalyze

## Milestones

- 🚧 **v1.21 UX — trustworthy, navigable, lean** — Phases 192–202 (started 2026-11-06)
- ✅ **v1.20 Backlog Burndown** — Phases 158–191 (shipped 2026-11-06)
- ✅ **v1.19 JOB/RATE** — Phases 143–146, 146.1, 146.2 (shipped 2026-08-20)
- ⏸️ **v1.18 MT5-VERIFY & founder confirmations** — Phases 155, 157 (parked, founder-gated)
- ✅ **v1.17 MT5 — ingested, wizardable, surfaced** — Phases 147–154, 156 (shipped 2026-08-14)
- ✅ **v1.16 Production Resilience & Reliability** — Phases 140–142 (shipped 2026-08-14)
- Earlier milestones: see "Shipped Milestones" below.

## Phases

<details>
<summary>✅ v1.20 Backlog Burndown (Phases 158–191) — SHIPPED 2026-11-06</summary>

150 phases in the roadmap: 142 delivered and verified, 8 retired or absorbed (164.6.6.3.6, 165, 165.1, 165.2, 181, 182, 187, 189). Audit `tech_debt`: 62/64 requirements (DEPS-01 descoped, HONEST-07 deferred). Phase 188's SC-4 residual moves to a follow-up phase in the next milestone (D-13). Full detail: [`milestones/v1.20-ROADMAP.md`](milestones/v1.20-ROADMAP.md), requirements: [`milestones/v1.20-REQUIREMENTS.md`](milestones/v1.20-REQUIREMENTS.md), audit: [`milestones/v1.20-MILESTONE-AUDIT.md`](milestones/v1.20-MILESTONE-AUDIT.md), phase directories: `milestones/v1.20-phases/`.

</details>

<details>
<summary>✅ v1.19 JOB/RATE (Phases 143–146, 146.1, 146.2) — SHIPPED 2026-08-20</summary>

6/6 phases passed, 9/9 requirements (JOB-04/05/06/08, RATE-01..05), audit `tech_debt`. Full detail: [`milestones/v1.19-ROADMAP.md`](milestones/v1.19-ROADMAP.md).

</details>

<details>
<summary>✅ v1.17 MT5 — ingested, wizardable, surfaced (Phases 147–154, 156) — SHIPPED 2026-08-14</summary>

Phase 155 was carried to v1.18 and the title amended to match what was delivered. ⛔ MT5 is NOT advertised: nobody has compared our numbers to the terminal's. Full detail: [`milestones/v1.17-ROADMAP.md`](milestones/v1.17-ROADMAP.md).

</details>

<details>
<summary>✅ v1.16 Production Resilience & Reliability (Phases 140–142) — SHIPPED 2026-08-14</summary>

Full detail: [`milestones/v1.16-ROADMAP.md`](milestones/v1.16-ROADMAP.md).

</details>

---

## Current Milestone: v1.21 UX — trustworthy, navigable, lean (Phases 192–202)

**Goal:** An allocator or a manager, new or experienced, can trust what every page says, reach the
next step without a dead end, and is not buried in duplicate surfaces.

**Scope:** 32 requirements — TRUST-01..06, ROUTE-01..11, CLAR-01..06, LEAN-01..07, RESID-01..02 —
per `.planning/REQUIREMENTS.md`. Source: the five-persona UX review of the live app, 2026-11-06,
plus the Phase 188 SC-4 residual (188-CONTEXT D-13). Research: skipped (founder 2026-11-06).

**Scope decisions (founder 2026-11-06):** trust first; fix and trim only. No new manager-entered
data: TERMS-01/02 (fees, terms, thesis, net vs gross, base currency, data source) are Future and
map to no phase here. The empty "— on request" rows are hidden instead (LEAN-05). Legal entity and
jurisdiction text in Terms and Privacy stays out of scope: the founder supplies it.

⛔ **Every finding is a claim until its phase re-measures it at HEAD.** The roadmapper spot-checked
the findings each success criterion rests on at `8e592536` on 2026-11-06; every phase lists what was
confirmed and what was not under **Evidence at HEAD**. A PROD figure quoted from the review (a
return, a VaR, an AUM) was read by the reviewers and has not been re-read here.

⭐ **Every phase that touches UI checks the change against `DESIGN.md`** (voice and microcopy,
Numbers Contract, data density, the dated-document principle) and records the check in its
UI-SPEC or VERIFICATION. `DESIGN.md` wins over a finding's suggested fix.

**Ordering rationale (dependencies, not preferences):**

- **192–194 first (trust).** 192 is the public site and the demo, the first thing a visitor reads.
  193 makes viewing a strategy passive. 194 runs after 193 because its metric mismatches must be
  re-read on full-history views, with no silently saved clipped range distorting them.
- **195 TRIM before the surfaces it touches.** It removes `/portfolios`, the Tweaks panel, the
  dark-mode option and the do-nothing toggles, so no later phase polishes a surface that is about
  to go. It does NOT hide Compare: 197 makes Compare startable (ROUTE-05).
- **196 ONESTRATEGYPAGE after 193, 194 and 195.** The factsheet becomes the one strategy page and
  the tearsheet its print view, so the developer text (193) and the tearsheet's own figures (194)
  are settled first, and the "add to portfolio" next step is replaced after `/portfolios` goes
  (195). LEAN-05 (the slim factsheet) sits in the same phase so the print view is built once, on
  the final layout.
- **197 SCREEN and 198 MYBOOK after 194 and 195.** Discovery columns state the period and
  definition 194 settles; My allocation's first tab shows the book values 194 reconciles.
- **199 MANAGERHOME after 198.** ROUTE-01 sends an allocator to My allocation, which must answer
  "how is my book doing?" first. LEAN-01 merges the two strategies lists before ROUTE-11 adds the
  health column, so the column is built once, on the merged list.
- **200 MANAGERKEYS after 192 and 199.** The one security explanation carries 192's corrected
  account, and adding a strategy's one entry point lives on 199's merged list.
- **201 PLAINWORDS last of the UX phases.** Renames, tooltips and section numbering apply to the
  surfaces the earlier phases leave, so nothing is renamed and then deleted.
- **202 RESIDCHURN is a parallel track, not last in time.** It starts now, beside 192. Its control
  capture needs a 00:40Z nightly with **no deploy between its two captures**, and the UX phases
  deploy often, so it books its window, and inside it only `analytics-service/` and migration merges are held.

### Phases (v1.21)

- [x] **Phase 192: PUBLICTRUTH — the public site and the demo tell a visitor one true story** - Key storage, encryption, TLS, factsheet access, listing cost and exchange count read the same on the home page, `/security`, `/for-quants` and Terms, each matched to a measurement; no key form for anonymous visitors on the home page; `/demo` looks finished (completed 2026-11-07)
- [x] **Phase 193: QUIETVIEW — viewing a strategy changes nothing and shows only its own content** - Scrolling never changes a factsheet's date range, a narrowed range is labelled with a reset and never restored on a later visit, no developer or demo text, and opening a page writes no row (completed 2026-11-07)
- [ ] **Phase 194: FIGURETRUTH — a figure means one thing everywhere and shows only when it can mean something** - One value per metric name across My Strategies, factsheet, tearsheet, Scenario and Holdings, deliberate differences labelled, impossible figures withheld or qualified
- [x] **Phase 195: TRIM — leftover and duplicate surfaces are gone** - `/portfolios` removed and Decks hidden with no link left to them; the Tweaks panel, the dark-mode option, the do-nothing toggles, the single-card `/browse` and duplicated disclaimers removed (completed 2026-11-07)
- [ ] **Phase 196: ONESTRATEGYPAGE — a strategy has one page, the factsheet, and it reads as a short document** - Every strategy detail route leads to the factsheet, the tearsheet is its print view, signed-in users are not treated as visitors, there is a way back and a next step, and the factsheet opens as a summary with the rest under "Advanced"
- [ ] **Phase 197: SCREEN — discovery reads plainly and a shortlist can be compared** - Compare startable from discovery rows; every column states its period and annualisation; stale strategies flagged and not ranked as current; shared exchange accounts named
- [ ] **Phase 198: MYBOOK — My allocation answers "how is my book doing?" in three tabs** - "+ Allocation" opens the allocator's flow; the first tab shows the book's return, risk and holdings or names what is missing; Holdings labels correct; at most three tabs, positions listed once, dust hidden
- [ ] **Phase 199: MANAGERHOME — each role lands on its own page, and a manager has one strategies list that shows health** - Role-aware landing after sign-in; `/strategies` and `/my-strategies` merged; a health column and a chip legend; every degrade warning names the days or key and the next step
- [ ] **Phase 200: MANAGERKEYS — keys, names and adding a strategy each have one place** - Each key shows the strategies it feeds and nothing re-points a key without confirmation; rename in one place with the public name shown; one entry point each for adding a strategy and managing keys; one security explanation
- [ ] **Phase 201: PLAINWORDS — one name per concept, explained, and the small inconsistencies fixed** - Tooltips or a glossary for specialist terms; one word per concept; factsheet sections in order, one date format, Escape closes the filter drawer, the egress-IP link fixed, the disclaimer typo fixed
- [x] **Phase 202: RESIDCHURN — the value churn left by 188 is attributed and book b3's earlier reasons are explained** - Parallel track, starts now: two captures around one nightly with no deploy between, each of the 1214 moved values attributed or named unexplained, b3's two reasons explained and fixed where a defect (completed 2026-11-07)
- [x] **Phase 203: B3TRUNC — why book b3 carries window_truncated** - Follow-up to 202 (founder D-17): find why b3 carries `window_truncated`, with 202's evidence as input (completed 2026-11-07)

### Phase 192: PUBLICTRUTH — the public site and the demo tell a visitor one true story

**Goal:** A first-time visitor reading the home page, `/security`, `/for-quants`, the Terms and `/demo` gets one consistent, true account of how API keys are stored and encrypted, which TLS versions are accepted, who can view a factsheet, what listing costs and how many exchanges are supported, and sees a demo that looks finished. The home page no longer asks an anonymous visitor for a key and secret.
**Requirements**: TRUST-01, ROUTE-03
**Depends on:** Nothing (first phase)
**Plans:** 15/15 plans complete
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: the home page (`src/app/(marketing)/page.tsx:212`) mounts `VerificationSection`, whose form (`src/components/landing/VerificationForm.tsx:219`) says "Your keys are never stored." `/security` describes AES-256-GCM with a Vault-held KEK (`src/app/(marketing)/security/page.tsx:140-143`) and says "We disable TLS 1.0, 1.1, and 1.2 at the edge" (`:108-109`). `/for-quants` describes a per-row Fernet data key (`src/app/(marketing)/for-quants/page.tsx:293`), "Listed to qualified allocators only" (`:300`) and "Free to list" (`:97`). Terms §7 names a success fee (`src/app/(marketing)/legal/terms/page.tsx:73-76`). `/demo` renders "Demo data is loading" (`src/app/(marketing)/demo/page.tsx:359`). `/demo/founder-view` exists as a route.
- Not confirmed at HEAD: the live TLS 1.2 handshake (a network fact, not a code fact), which pages state 3, 5 or 6 exchanges (the home page reads `EXCHANGES.length`), that `/demo/founder-view` renders empty, and the BTC "—" under the demo's headline (PROD data).

**Success Criteria** (what must be TRUE):
1. Key storage and encryption are described once, the same way, on the home page, `/security`, `/for-quants` and Terms, and the description matches the code path that stores credentials.
2. `/security`'s TLS sentence matches a recorded handshake for each TLS version against the production host, and `/for-quants`' sentence about who can view a factsheet matches what a signed-out request for a factsheet returns. Where the founder chooses to change the behaviour instead of the sentence, the decision is recorded in the phase CONTEXT and the ROADMAP.
3. The listing cost reads the same on `/for-quants` and in Terms §7, and every page that states an exchange count reads it from one shared value.
4. The home page shows an anonymous visitor no form asking for an API key or secret.
5. After `/demo` has loaded it shows no loading notice, no "—" under a headline claim (the claim shows its figure or is removed), no empty founder view, and no raw id in place of a strategy name. Never invent data: a demo figure that cannot be computed is removed with its claim, not filled in.

Copy and layout changes are checked against `DESIGN.md` (Voice / microcopy, AI-Slop Ban).

**Founder override, 2026-11-07 (D-11 in 192-CONTEXT.md, recorded under the CLAUDE.md deviation policy):** the public demo is retired in code. Plan 192-06 measured the demo's missing data as `strategies-missing`. The founder's answer was "delete demo", which he clarified as "Page only", and then: "retire the whole demo part".
- This retires `/demo`, its sub-routes, API routes, components, demo-only readers and persona wiring, its e2e and visual specs, and every link to it.
- PROD demo rows stay untouched. No PROD writes or deletes are made.
- Plan 192-06 is superseded. Its evidence records `D-08 repair: not needed (demo retired, founder 2026-11-07)`.
- Plan 192-08's screenshot gate is retired ("Retire it (Recommended)"), and no seeded-render baseline is booked.
- Success criterion 5 now reads: `/demo` and every link to it are gone, and no public page links to a retired route.
- D-07 still holds. D-08, D-09 and D-10 are amended in CONTEXT.
- Plan 192-10's ship gate no longer needs a demo repair.
- Phase 193 keeps the factsheet "Demo portfolios" section and `[193-DEMO-PAYLOAD-PRODUCERS]`.

Plans:
**Wave 1**
- [x] 192-01-PLAN.md
- [x] 192-02-PLAN.md

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 192-03-PLAN.md
- [x] 192-04-PLAN.md
- [x] 192-05-PLAN.md
- [x] 192-06-PLAN.md — SUPERSEDED by D-11 (demo retired); Task 3 never executed, no SUMMARY (192-06-DEFERRED.md)
- [x] 192-07-PLAN.md

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 192-08-PLAN.md — SUPERSEDED by D-11; its retire work moved to 192-14, no SUMMARY (192-08-DEFERRED.md)
- [x] 192-09-PLAN.md
- [x] 192-11-PLAN.md — retire the /demo page, its proxy entry, headers and manifest row; a placeholder build shows /demo matches an unknown URL (307 to /login signed out; absent from the route manifest)
- [x] 192-12-PLAN.md — the match queue drops its demo read-only mode and demo source path

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 192-13-PLAN.md — delete the demo-only components and readers and their census rows
- [x] 192-14-PLAN.md — delete the demo e2e and pixel specs, the bake plumbing and the seeded /demo rows

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 192-16-PLAN.md — retire the nightly demo-PDF canary and its spec; the apt census moves from 18 to 17 steps
- [x] 192-17-PLAN.md — delete the demo-page analytics warmer and move the seam exclusion censuses

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 192-15-PLAN.md — retire /api/demo and the demo PDF token, then the demo and persona libraries

**Wave 7** *(blocked on Wave 6 completion)*
- [x] 192-10-PLAN.md — ship gate on the retired state, public-truth census, TODOS bookings

### Phase 193: QUIETVIEW — viewing a strategy changes nothing and shows only its own content

**Goal:** Looking at a factsheet or a strategy page is passive. Scrolling over a chart never changes its date range by itself, a narrowed range is always labelled with a one-click reset and is never restored on a later visit, no developer note, placeholder or another strategy's or portfolio's demo content appears, and opening any page writes nothing on the user's behalf.
**Requirements**: TRUST-02, TRUST-03, TRUST-06
**Depends on:** Nothing
**Plans:** 7/7 plans complete
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: the mouse wheel zooms the factsheet time-series chart (`src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`, `WHEEL_SETTLE_MS`, wheel handler near `:732`). The view state is persisted to the query string and localStorage (`src/app/factsheet/[id]/v2/factsheet-context.tsx:27`, `:258-268`). A "Reset view" control exists (`FactsheetView.tsx:2873`). The factsheet renders "Synthesized peer cohort (deterministic seed). Production: replace with platform strategy DB." (`BatchDPanels.tsx:125`), an allocator section tagged "Demo portfolios" with a "Suggested MultiMarket sleeve" row (`BatchDPanels.tsx:303`, `:351`), and "Commercial terms not yet wired through from the strategy registry." (`MandatePanels.tsx:153`). `/strategy/[id]` mounts `StrategyNoteCard` (`src/app/strategy/[id]/page.tsx:210`), whose textarea is `autoFocus` and saves on blur (`src/components/notes/StrategyNoteCard.tsx:42-60`).
- Not confirmed at HEAD: that this note card is what wrote the empty note row the review saw on PROD (07:47Z, 2026-11-06, left in place). It is a candidate, and the phase measures the write path before fixing it.

**Success Criteria** (what must be TRUE):
1. Turning the mouse wheel over any factsheet chart leaves the date range and every headline figure unchanged; the range changes only through an explicit control.
   ⛔ **AMENDED 2026-11-06 (QUIETVIEW D-01, founder override of the recommendation):** a plain wheel over a factsheet chart no longer zooms and scrolls the page; zoom stays on Ctrl/Cmd + wheel, which this criterion counts as an explicit control. The founder chose "Ctrl+wheel zoom" over removing wheel zoom entirely. Recorded in the phase CONTEXT as D-01; the deviation policy requires both records.
2. A narrowed range is labelled next to the figures it changes, with a one-click reset, and a later visit or reload opens the full history, including for ranges a browser saved before this change.
3. No factsheet renders a developer note, placeholder copy or demo content: the three strings above are gone, the allocator section shows nothing that belongs to another strategy or portfolio, and a test goes RED if any of them returns.
4. Opening a strategy page, a factsheet or any page that carries a note, and leaving without typing, writes no row. A read-only PROD count of empty notes is recorded before the fix (rows are left in place), and a test goes RED on today's behaviour.

UI changes are checked against `DESIGN.md` (the dated-document principle: the label for a narrowed range states the dates shown).

**Founder override, 2026-11-07 (D-09 in `193-CONTEXT.md`, "Allow clearing"):** a note saves on blur when its text changed; a blank draft saves only when it clears a note that was saved non-empty. SC-4 is unchanged: opening and leaving writes no row.

**Founder decision, 2026-11-07 (D-09 refinement in `193-CONTEXT.md`, "Keep it, record it"):** after a failed save the server state is unknown, so clearing a note whose save never got confirmed saves `""`. This refines the "Allow clearing" override and needs no code change.

Plans:
- [x] 193-01-PLAN.md
- [x] 193-02-PLAN.md
- [x] 193-03-PLAN.md
- [x] 193-04-PLAN.md
- [x] 193-05-PLAN.md
- [x] 193-06-PLAN.md
- [x] 193-07-PLAN.md

### Phase 194: FIGURETRUTH — a figure means one thing everywhere and shows only when it can mean something

**Goal:** A metric with the same name shows the same value for the same strategy and period on My Strategies, the factsheet, the tearsheet, Scenario and Holdings, and where two figures differ on purpose the label says why. A figure that cannot be meaningful is withheld or plainly qualified, never shown at full confidence.
**Requirements**: TRUST-04, TRUST-05
**Depends on:** Phase 193 (mismatches are re-read on full-history views, so a saved clipped range cannot pass for a definition difference)
**Plans:** 0 plans
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: the tearsheet shows "Calmar", "VaR (95%)", "CVaR" and "Minimum Allocation" (`src/app/factsheet/[id]/tearsheet/page.tsx:572`, `:582-585`, `:658`). My Strategies and discovery show a "6 Month" column (`src/components/strategy/StrategyTable.tsx:316`).
- Not confirmed at HEAD (PROD readings from the review): 6 Month −21.31% vs −3.79%, the tearsheet VaR/CVaR at about double the factsheet's, Calmar meaning two things, "Minimum Allocation" equal to AUM, the book's AUM at 293,633 vs $367.9K gross / $284.3K net, and Quantum Drift's +1,698,884,891% next to 0.00% in the lists.

**Success Criteria** (what must be TRUE):
1. Before any code change, a read-only PROD reading records, for each metric TRUST-04 names, the value each page shows for the same strategy or book and period, and names the cause of each difference.
2. For the same strategy and period, a metric with the same name shows the same value on My Strategies, the factsheet, the tearsheet, Scenario and Holdings. Where two figures differ on purpose (gross vs net, another period or definition), the label says which. A test goes RED on today's mismatch. The fix lands where the pages read the value, not as a per-page patch, because the tearsheet becomes the factsheet's print view later in this milestone.
3. No field's label contradicts its value (for example, a "Minimum Allocation" that is really AUM is relabelled or removed).
4. A cumulative return past a stated plausibility bound, and an annualised ratio on a record shorter than a year, are withheld or carry a plain qualifier on every surface that shows them, and no list shows 0.00% for a figure it does not have.
5. Never invent data: a withheld figure reads as withheld, never as 0 or a substitute value.

UI changes are checked against `DESIGN.md` (Numbers Contract).

Plans:
- [ ] TBD — plans not listed yet

### Phase 195: TRIM — leftover and duplicate surfaces are gone

**Goal:** `/portfolios` is removed, Decks is hidden until it works, and the user-visible leftovers are gone: the "Tweaks / Design variations" panel, the dark-mode option, toggles that do nothing useful, the single-card `/browse` and duplicated disclaimers.
**Requirements**: LEAN-03, LEAN-07
**Depends on:** Nothing (runs after the trust phases by order, not by need)
**Plans:** 7/7 plans complete
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: `/portfolios` still renders (`src/app/(dashboard)/portfolios/`, with `[id]`, `documents` and `manage`) and is linked from `ExchangesTabContent.tsx:40,52`, `PortfolioOptimizer.tsx:163`, `AddToPortfolio.tsx:121` and `StrategyBreakdownTable.tsx:220`; the last points at `/portfolios/<id>/strategies/<id>`, which has no page at HEAD. Decks is in the sidebar (`src/components/layout/Sidebar.tsx:141`). The "Design variations · live" panel is `src/app/(dashboard)/allocations/components/Tweaks.tsx:105`, mounted from `AllocationsTabs.tsx:23-25`. The factsheet offers "Dark mode" (`FactsheetView.tsx:2944`) while `DESIGN.md` says "Dark mode: Not planned." The discovery table carries a density setting (`StrategyTable.tsx:578-582`). `/portfolio-pdf/[id]` also exists; the phase decides whether it goes with `/portfolios`.
- Not confirmed at HEAD: that `/browse` holds exactly one category on PROD (it renders whatever categories the query returns), the view toggle, and where the disclaimer repeats.

**Success Criteria** (what must be TRUE):
1. `/portfolios` and its sub-routes are gone, a visit to one lands on a named page rather than a 404, and no link in the app points to them. Stored portfolio rows are kept; only the surface goes.
2. Decks appears in no navigation and no link until it works.
3. No user sees the "Tweaks / Design variations" panel or a dark-mode option.
4. The discovery table has no toggle that changes nothing useful at the row counts it shows, `/browse` with one category leads straight to it, and each page shows its disclaimer once.
5. A test lists every removed route and control and goes RED if one renders or is linked again.

Removals are checked against `DESIGN.md` (Dark mode: Not planned; data density principle). Compare is not hidden here: SCREEN makes it startable.

Plans:
- [x] 195-01-PLAN.md — Wave 1: retire the portfolio report as a named public page and hide Decks (D-03, D-04)
- [x] 195-02-PLAN.md — Wave 2: `/portfolios` redirects to My allocation, and Add to portfolio is removed (D-01, D-02)
- [x] 195-03-PLAN.md — Wave 1: remove the Tweaks panel and the discovery table density toggle (D-05, D-07)
- [x] 195-04-PLAN.md — Wave 2: remove the factsheet dark-mode option (D-06)
- [x] 195-05-PLAN.md — Wave 1: single-category `/browse` goes straight to it; one disclaimer per page (D-08, D-09)
- [x] 195-06-PLAN.md — Wave 3: delete the components that only served `/portfolios` (D-01)
- [x] 195-07-PLAN.md — Wave 4: D-10 guard test with neuter, RED and restore proofs; full phase gates (D-10)

### Phase 196: ONESTRATEGYPAGE — a strategy has one page, the factsheet, and it reads as a short document

**Goal:** A strategy has one page, the factsheet. The tearsheet is its print view and every other strategy detail route leads to it. A signed-in user is never shown visitor prompts, an owner can open their own unpublished strategy, a signed-in reader has a way back and a next step, a shared factsheet carries a header and a sign-up link, and the factsheet opens as a summary, one chart and one metrics table with the rest under "Advanced".
**Requirements**: LEAN-02, ROUTE-02, ROUTE-04, LEAN-05
**Depends on:** Phase 193, Phase 194, Phase 195
**Plans:** 0 plans
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: routes that render a strategy's detail today are `/factsheet/[id]` (re-exports `/factsheet/[id]/v2`), `/factsheet/[id]/tearsheet`, `/strategy/[id]`, `/strategy/[id]/v2` (`StrategyV2Shell`), `/discovery/[slug]/[strategyId]`, `/browse/[slug]/[strategyId]` and `/factsheet-share/[token]`. Visitor prompts render with no session check on `/strategy/[id]` ("Sign up to see full analytics", `src/app/strategy/[id]/page.tsx:220-223`, while the note card beside it is gated on `user`) and on `/browse` (`src/app/browse/layout.tsx:32`, `browse/[slug]/page.tsx:73-80`, `browse/[slug]/[strategyId]/page.tsx:170-179`). `/factsheet-share/[token]` has no sign-up link. `AddToPortfolio` links to `/portfolios`, which TRIM removes. The factsheet shows "— on request" rows (`MandatePanels.tsx:143-146`) and a visible "Wheel to zoom · double-click to reset" hint on every histogram (`HistogramChart.tsx:259-260`).
- Not confirmed at HEAD: the 8–9 section tabs, the duplicated Returns/VaR/CVaR/skew/kurtosis, the three small-sample warnings (no shared warning string found), and the owner 404 on `/strategy/<id>` for an unpublished strategy.

**Success Criteria** (what must be TRUE):
1. Every strategy detail route listed above leads to the factsheet, the tearsheet is the factsheet's print view, and existing links and shared URLs keep working.
2. A signed-in user sees no "Sign up" prompt on `/browse` pages or on a strategy's page. An owner can open their own unpublished strategy, and after the owner has viewed it an anonymous request still gets not-found.
3. From a factsheet, a signed-in user can go back to the page they came from and take a next step (request an intro, add the strategy to their allocation) without editing a URL. A shared factsheet carries a header and a sign-up link.
4. The factsheet opens as a summary, one chart and one metrics table, with the rest under "Advanced". No metric is shown twice, the chart hint appears once, there is one small-sample warning, and empty sections and "— on request" rows are hidden.
5. A before/after count of sections, charts, repeated metrics and warnings on three named strategies is recorded, and the print and shared views follow the new layout.

The layout is checked against `DESIGN.md` (dated-document principle, Numbers Contract, data density principle) before planning, in the phase's UI-SPEC.

Plans:
- [ ] TBD — plans not listed yet

### Phase 197: SCREEN — discovery reads plainly and a shortlist can be compared

**Goal:** An allocator screening in discovery can read every column without guessing (period, annualisation, track length), sees stale strategies flagged and not ranked as current, learns when two listings draw on one exchange account, and can select strategies and open Compare from the UI.
**Requirements**: ROUTE-05, CLAR-01, CLAR-02, CLAR-05
**Depends on:** Phase 194 (columns state the definitions 194 settles, and withheld figures read as withheld), Phase 195 (the do-nothing toggles are already gone)
**Plans:** 0 plans
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: `/compare` says adding strategies from the page "is not available yet" (`src/app/(dashboard)/compare/page.tsx:75`, `:266`); its only entry is the factsheet's "Compare strategies" (`FactsheetView.tsx:2885`). Discovery columns come from `StrategyTable.tsx` (`:316` "6 Month"). A staleness test exists (`StrategyTable.stale-analytics.test.tsx`), so the phase first measures what discovery does with a stale row today. A same-account signal exists for an allocator's own keys ("Two of your keys read the same exchange account", `EquityHistoryRebuilding.tsx:237`).
- Not confirmed at HEAD: the "+" on volatility, the strategy fetched 175 days ago at rank #3, and whether a stored signal links two listed strategies to one exchange account.

**Success Criteria** (what must be TRUE):
1. An allocator can select strategies in a discovery list and open Compare with them from the UI, and Compare no longer says adding is "not available yet".
2. Every discovery column header states its period and whether it is annualised, volatility shows no sign, and a track-length column exists.
3. A strategy whose data is stale (its newest stored day or last successful fetch is older than a threshold the phase states) is flagged in its row and does not rank as if it were current. The phase names the field it reads, and does not use `strategy_analytics.computed_at` as a proxy for data age: a recompute on old data is not fresh data. A test with a stale fixture goes RED on today's ranking.
4. A listing says when two strategies draw on the same exchange account, using only data already stored (no new manager-entered data). A strategy whose account is not shared shows no notice.

UI changes are checked against `DESIGN.md` (Numbers Contract, data density principle, Trust-Tier Badges).

Plans:
- [ ] TBD — plans not listed yet

### Phase 198: MYBOOK — My allocation answers "how is my book doing?" in three tabs

**Goal:** An allocator opening My allocation sees the book's return, risk and holdings at a glance (or exactly what is missing), "+ Allocation" opens the allocator's own flow, Holdings labels positions correctly, and the page has at most three tabs with each position listed once and dust hidden.
**Requirements**: ROUTE-06, ROUTE-07, ROUTE-08, LEAN-06
**Depends on:** Phase 194 (the book's values agree across Scenario and Holdings), Phase 195 (the Tweaks panel is already gone)
**Plans:** 0 plans
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: six tabs, Overview, Holdings, Outcomes, Mandate, Risk and Scenario (`src/app/(dashboard)/allocations/AllocationsTabs.tsx:70-222`). On every tab but Scenario, "+ Allocation" opens `ContributionWizardOverlay` (`AllocationsTabs.tsx:587-611`), which embeds the manager wizard's `WizardClient` (`ContributionWizardOverlay.tsx:31`). The notice "We are holding back your equity history" is `EquityHistoryRebuilding.tsx:139`. Holdings renders "not allocated" (`HoldingsTable.tsx:504`).
- Not confirmed at HEAD: cash counted as Spot exposure, the ~40 positions listed three times, the $0–$15 dust rows, and Scenario's three stacked notices.

**Success Criteria** (what must be TRUE):
1. "+ Allocation" opens an allocator's flow on every tab, never the manager's add-strategy wizard.
2. The first tab shows the book's return, risk and holdings at a glance, with the same values Scenario and Holdings show, or names exactly what is missing (which key, which days) instead of a generic notice.
3. Holdings does not call allocated positions "not allocated" and does not count cash as Spot exposure. A test goes RED on today's labels.
4. My allocation has at most three tabs, lists each position once, and hides dust rows by default behind a control that shows them.

UI changes are checked against `DESIGN.md` (Numbers Contract, data density principle, 9-State Matrix).

Plans:
- [ ] TBD — plans not listed yet

### Phase 199: MANAGERHOME — each role lands on its own page, and a manager has one strategies list that shows health

**Goal:** After sign-in, an allocator, a manager and an admin each land on a page made for their role. A manager has one strategies list (`/strategies` and `/my-strategies` merged) that shows each strategy's health, explains its status chips, and whose degrade warnings name the affected days or key and say what to do.
**Requirements**: LEAN-01, ROUTE-11, ROUTE-01
**Depends on:** Phase 194, Phase 198 (an allocator lands on My allocation, which must answer "how is my book doing?" first)
**Plans:** 0 plans
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: sign-in sends every role to `/discovery/crypto-sma` (`src/components/auth/LoginForm.tsx:34`), as do `src/app/(auth)/pending-approval/page.tsx:70` and the allocator branch of `src/components/auth/OnboardingWizard.tsx:91-93` (a manager goes to `/strategies` there). The error and not-found pages link "home" to `/discovery/crypto-sma` (`src/app/error.tsx:57`, `src/app/not-found.tsx:16`, `(dashboard)/error.tsx:40`, `admin/error.tsx:51`). The sidebar lists both `/my-strategies` and `/strategies` (`Sidebar.tsx:156`, `:189`, `:321`). The chips "Own capital" and "Team review" come from `src/components/strategy/OwnershipTag.tsx:39-40`. `StrategyTable.tsx` has no "Health" column label.
- Not confirmed at HEAD: the wording of each degrade warning (the phase inventories them first).

**Success Criteria** (what must be TRUE):
1. After sign-in, an allocator lands on My allocation, a manager on their strategies list and an admin on the admin dashboard, and every post-sign-in and "go home" destination listed above reads one role-aware choice.
2. A manager has one strategies list: `/strategies` and `/my-strategies` are one page, the other route leads to it, and the sidebar has one entry.
3. That list shows each strategy's health, and its status chips ("Team review", "Private", "Own capital" and the rest) have a legend.
4. Every degrade warning names the affected days or key and says what the user can do. A test goes RED on a warning that names neither.

UI changes are checked against `DESIGN.md` (Error Envelope, Voice / microcopy, Trust-Tier Badges).

Plans:
- [ ] TBD — plans not listed yet

### Phase 200: MANAGERKEYS — keys, names and adding a strategy each have one place

**Goal:** A manager can see which strategies each key feeds, and nothing re-points a strategy's key without an explicit confirmation. Renaming happens in one place that shows which name is public. Adding a strategy and managing keys each have one entry point, and the security explanation lives in one place.
**Requirements**: ROUTE-09, ROUTE-10, LEAN-04
**Depends on:** Phase 192 (the one security explanation carries 192's corrected account), Phase 199 (adding a strategy's one entry point lives on the merged list)
**Plans:** 0 plans
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: each key card on the strategy edit page (`src/app/(dashboard)/strategies/[id]/edit/page.tsx`) offers a one-click "Use & Sync" (`src/components/strategy/ApiKeyManager.tsx:1768`). The edit form has a "Strategy Name" field (`StrategyForm.tsx:326`), while "Rename…" lives on the factsheet header (`FactsheetView.tsx:1226`) and in the strategies table (`StrategyTable.tsx:1387`, `RenameStrategyDialog.tsx`). `/strategies` links into the add-strategy wizard four times (`src/app/(dashboard)/strategies/page.tsx:903`, `:973`, `:995`, `:1002`), and My allocation embeds the same wizard (`ContributionWizardOverlay.tsx:31`). In-app copy gives a third encryption description, "per-user KEK" (`AllocatorExchangeManager.tsx:1394`, `:1644`).
- Not confirmed at HEAD: that "Strategy Name" is a dropdown of preset codenames, that the edit page lists every key on the account, and which two surfaces the review calls the two key managers.

**Success Criteria** (what must be TRUE):
1. Each key shows which strategies it feeds, and no control changes a strategy's key without an explicit confirmation that names the strategy and both keys. A test goes RED on today's one-click re-point.
2. A manager renames a strategy in one place, and that place shows which name is public.
3. Adding a strategy and managing keys each have one entry point; every other entry point leads to it or is gone.
4. The security explanation lives in one place, matches 192's public account, and every other surface links to it instead of restating it.

UI changes are checked against `DESIGN.md` (Broker Selector Grid, Error Envelope, Voice / microcopy).

Plans:
- [ ] TBD — plans not listed yet

### Phase 201: PLAINWORDS — one name per concept, explained, and the small inconsistencies fixed

**Goal:** Specialist terms are explained where they appear, each concept has one name across the app, and the small inconsistencies are fixed: factsheet sections numbered in order, one date format, Escape closes the filter drawer, the egress-IP link leads to the IPs or is removed, and the disclaimer typo is gone.
**Requirements**: CLAR-03, CLAR-04, CLAR-06
**Depends on:** Phase 196, Phase 197, Phase 198, Phase 200 (renames, tooltips and numbering apply to the surfaces those phases leave)
**Plans:** 0 plans
**UI hint**: yes

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: factsheet sections run I, II, III, V, IV (`src/app/factsheet/[id]/v2/MetricsColumn.tsx:348-534`). The disclaimer's "notoperate" comes from `</strong>` followed by a line break before "operate" (`src/app/(marketing)/legal/disclaimer/page.tsx:60-61`), which JSX renders without a space. The wizard's egress-IP link goes to `/security#egress-ips` (`WizardIpAllowlistHint.tsx:36`), and `/security` says the static egress IP does not exist until the sFOX egress is stood up (`security/page.tsx:497-522`). The sidebar names the Scenario tab "Bridge" (`Sidebar.tsx:297`). The only "glossary" mention in `src` is in `OptimizerPanel.tsx`.
- Not confirmed at HEAD: which drawer ignores Escape (`CustomizeDrawer.tsx:64` already handles it), and the three date formats.

**Success Criteria** (what must be TRUE):
1. Every specialist term (Omega, Ulcer, Common-sense ratio, Kolmogorov-Smirnov, Bridge, mandate, TWR and the like) carries a tooltip or links to a glossary entry wherever it appears.
2. Each concept has one name across the app (allocation / book / portfolio; watchlist / favorites / star; mandate / preferences / profile), and a test goes RED on a retired word in user-visible copy.
3. Factsheet sections are numbered in order and dates use one format across the app.
4. Escape closes the discovery filter drawer, the egress-IP link leads to the IPs or is removed, and the disclaimer reads "does not operate".

Wording and tooltips are checked against `DESIGN.md` (Voice / microcopy, Typography).

Plans:
- [ ] TBD — plans not listed yet

### Phase 202: RESIDCHURN — the value churn left by 188 is attributed and book b3's earlier reasons are explained

**Goal:** A control capture across a nightly with no deploy in between shows whether stored values move without a code change, each value that moved in 188's re-reading (1214) is attributed to a cause or named as unexplained, and book b3's earlier reasons (`out_of_window_flow`, `window_truncated`) are explained and fixed where they are a defect.
**Requirements**: RESID-01, RESID-02
**Depends on:** Nothing. Parallel track: it starts now, beside 192, and is not held for the UX phases.
**Plans:** 8/8 plans complete

**Calendar constraint.** The control capture is two PROD captures with the same SQL around one 00:40Z nightly, with **no deploy between them** (188-CONTEXT D-13). The UX phases deploy often, so this phase books its window before the first capture. Inside the window only merges touching `analytics-service/` or `supabase/migrations/**` are held (founder 2026-11-06); frontend and planning-only merges continue, because they change no stored value. A deploy inside the window voids the pair, and the next deploy-free nightly is used instead. The earliest chance is the 2026-11-07 00:40Z nightly, if no deploy lands between its captures. Whether an earlier pair qualifies (capture `b1` was taken 2026-11-06 07:04:02Z, after that day's nightly) is measured from the deploy history, not assumed.

**Amendment 2026-11-06 (founder, recorded also as the D-04 amendment in `202-CONTEXT.md`).** "No deploy between" is proven by content, not by an empty deployment list: every Railway deployment in the `c0`→`c1` window, on both the API and the worker services, must have an empty `git diff --stat <c0-live commit>..<its commit> -- analytics-service supabase/migrations`, and the PROD migration ledger gains no row. Other merges may land meanwhile, as long as they do not touch those paths. Success criterion 1's "deploy history between them is shown to be empty" is read under this rule. The text above is kept as lineage.

**Evidence at HEAD** (spot-checked 2026-11-06, `8e592536`):
- Confirmed: D-13 and the residual are recorded in `.planning/milestones/v1.20-phases/188-*/188-CONTEXT.md` and `188-16-SUMMARY.md`, and in the v1.20 audit's tech debt. The reason codes are defined in `analytics-service/services/allocator_equity_derive.py` (`WINDOW_TRUNCATED` at `:109`, `OUT_OF_WINDOW_FLOW` at `:121`).
- Related, not owned here: TODOS `185-BOOK-CUMULATIVE-UNEXPLAINED`.

**Success Criteria** (what must be TRUE):
1. Two PROD captures with the same SQL bracket one nightly, each preceded by the database marker query with its answer recorded, and the deploy history between them is shown to be empty. Their diff says whether stored values move without a code change, and on which scopes.
2. Each of the 1214 values that moved in 188's re-reading is attributed to a cause (the nightly's own movement as measured in criterion 1, or a named code path) or listed by scope as unexplained.
3. Book b3's `out_of_window_flow` and `window_truncated` reasons are each explained from its stored inputs. Where either is a defect it is fixed, with a test that goes RED on today's behaviour, and b3's trust state after the next nightly is recorded.
4. Never invent data.

Plans:
**Wave 1**
- [x] 202-01-PLAN.md — Tracer: b1 rows reproduce c0's 54 PROD digests (b1 stands for c0, D-10 cleared); the self-checking c1 SQL kit and capture gate (RESID-01, RESID-02) [Wave 1]

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 202-02-PLAN.md — The 1214 reproduced under 188's rule with size bands, clusters, the additive-offset oracle and D-08 buckets on b0/b1; the control rule of the final attribution fixed and hashed before c1 (RESID-01) [Wave 2]
- [x] 202-03-PLAN.md — Book b3's two reasons replayed from stored inputs with the repo's own functions; b1 verdict (RESID-02) [Wave 2]
- [x] 202-04-PLAN.md — Before the nightly: Railway deploy anchor on both services, ledger triple, per-subject jobs, book prefix basis (RESID-01) [Wave 2]

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 202-05-PLAN.md — s6/s9/s10: which worker commit wrote each side, code path named only under the evidence rule (RESID-01) [Wave 3]
- [x] 202-06-PLAN.md — c1 after the nightly; content-based no-deploy proof (D-04 amended) and pair verdict; moved scopes and predictions 1/4/5 (RESID-01, RESID-02) [Wave 3]

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 202-07-PLAN.md — Moved-scope rows, criterion 1, the final attribution of the 1214, b3 on c1 (D-12 or D-13), the phase report (RESID-01, RESID-02) [Wave 4]

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 202-08-PLAN.md — D-12 contingency: fires only on a measured c1 defect; founder chooses the fix, RED-first (RESID-02) [Wave 5]

Founder decision D-14 (2026-11-07, 202-CONTEXT.md): book b6's curve leaving out k20's days is its own finding. Plan 07 investigates why the compose omits k20, read-only, and reports it beside the b3 verdict. b3's `window_truncated` stays `unexplained`.

Founder decisions 2026-11-07 (202-CONTEXT.md D-14 closed, D-15 to D-17): D-14 closed as "Intended, no flag", because the omitted departed keys are unknown-account keys that `departed_history_inclusion` excludes by default. **Founder deviation D-15, "Use the plan's wording":** the attribution of record for the 1214 is a 0 / b 1142 / c 0 / d 72, with a one-day offset stretch not scored as a fail. This overrides the pinned `final_attribution.py` reading (a 0 / b 36 / c 0 / d 1178), which stays printed as lineage, and the script is not edited. D-16, "Don't widen; book it": the MT5 server-clock setting is the measured lead for the (d) scopes and a TODOS follow-up is booked. D-17, "book the investigation as a phase": b3 is not re-opened in 202, plan 08 changes no code, and b3's `window_truncated` investigation is a new follow-up phase.

### Phase 203: B3TRUNC — why book b3 carries window_truncated

**Goal:** Find why book b3 carries `window_truncated`, using Phase 202's evidence as input (202-REPORT.md, the 202-03 and 202-07 SUMMARYs, 202-CONTEXT D-14 to D-17). Phase 202 kept b3's `window_truncated` as `unexplained` and did not re-open it (founder D-17, 2026-11-07, "book the investigation as a phase").
**Requirements**: RESID-02 (the window_truncated half)
**Depends on:** Phase 202
**Plans:** 1/1 plans complete

Plans:
- [x] 203-01-PLAN.md — Wave 1: b3's `window_truncated` explained as intended (D-01 second branch); a characterization test that can fail and 203-REPORT.md (RESID-02)

### Progress (v1.21)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 192. PUBLICTRUTH | 15/15 | Complete | 2026-11-07 |
| 193. QUIETVIEW | 7/7 | Complete | 2026-11-07 |
| 194. FIGURETRUTH | 0/0 | Not started | - |
| 195. TRIM | 7/7 | Complete    | 2026-11-07 |
| 196. ONESTRATEGYPAGE | 0/0 | Not started | - |
| 197. SCREEN | 0/0 | Not started | - |
| 198. MYBOOK | 0/0 | Not started | - |
| 199. MANAGERHOME | 0/0 | Not started | - |
| 200. MANAGERKEYS | 0/0 | Not started | - |
| 201. PLAINWORDS | 0/0 | Not started | - |
| 202. RESIDCHURN | 8/8 | Complete    | 2026-11-07 |
| 203. B3TRUNC | 1/1 | Complete    | 2026-11-07 |

### Requirement Coverage (v1.21)

| Phase | Requirements |
|-------|--------------|
| 192 | TRUST-01, ROUTE-03 |
| 193 | TRUST-02, TRUST-03, TRUST-06 |
| 194 | TRUST-04, TRUST-05 |
| 195 | LEAN-03, LEAN-07 |
| 196 | LEAN-02, ROUTE-02, ROUTE-04, LEAN-05 |
| 197 | ROUTE-05, CLAR-01, CLAR-02, CLAR-05 |
| 198 | ROUTE-06, ROUTE-07, ROUTE-08, LEAN-06 |
| 199 | LEAN-01, ROUTE-11, ROUTE-01 |
| 200 | ROUTE-09, ROUTE-10, LEAN-04 |
| 201 | CLAR-03, CLAR-04, CLAR-06 |
| 202 | RESID-01, RESID-02 |
| 203 | RESID-02 (the window_truncated half) |

32/32 mapped, each to exactly one phase, except RESID-02, which 202 and 203 share (203 owns the window_truncated half). TERMS-01/02 are Future and unmapped by founder decision.

---

## Parked Milestone: v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157) — founder-gated

**Goal:** The numbers Quantalyze renders for the live funded MT5 account are proven true against
the terminal's own figures — and the handful of observations only the founder can make are made.

⛔ **EVERY phase in this milestone is founder-gated. That is its defining property, not an
accident of sequencing.** Nothing here can be delivered by an agent. The milestone was created on
2026-08-14 so that the agent-deliverable work in v1.17 could close without waiting on a calendar.

**Blocked on, both required:**

1. ⛔ **New MT5 investor passwords.** The founder changed the account passwords on/around
   2026-08-14, so the stored credentials are stale and will not authenticate. MEASURED on PROD
   that day: three `mt5` keys exist (labels `FX-AI_V`, `MM2`, `MM3` — ⚠️ **there is NO key
   labelled `MM1`**, so the founder's "MM1 and MM2 are erroring" does not map 1:1 onto stored
   rows; **re-verify ALL THREE at reconnect**), all `disconnected_at IS NULL`, all
   `sync_status='complete'` with `last_sync_at` 04:01–04:07 UTC — those are the last *successful*
   syncs, taken **before** the change.
   ⛔ **When these flip to `error`, that is EXPECTED. Do not investigate it as a code defect.**

2. ⛔ **The founder physically at the MT5 terminal, on a TRADING day**, with the live funded
   account's read-only investor password. A demo account, the v1.15 soak account, or a weekend run
   does not satisfy it.

**Settled inputs — do not re-litigate:**

- Parity tolerance **1%, INCLUDING open P&L** (founder call 2026-08-14). Adjustable later; keep it
  a named test constant, never a hardcoded literal.

- ⭐ **The measurement window MUST end before the day of the run.** `broker_dailies` anchors to
  today — initial capital is derived as `current_equity − total_pnl` — so reconstruction error
  accrues *backward into the past*. Comparing today's equity is therefore near-tautological, and a
  historical window is the only one that can actually fail.

**Requirements:** MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella acceptance)

⛔ **Do not advertise MT5 until Phase 155 passes.** Carried verbatim from v1.17.

---

## Shipped Milestones

> Collapsed index — one line per shipped milestone. Full per-milestone detail
> lives in `.planning/MILESTONES.md` and the `.planning/milestones/` archives.
> (Rebuilt 2026-07-25 from MILESTONES.md after a truncation accident; the prior
> inline v1.12/v1.13 detail sections were duplicative of their archives.)

- ✅ **v0.14.0.0 — Sprint 8: Bridge V2**
- ✅ **v0.15.0.0 — Sprint 9: Demo-to-Production**
- ✅ **v0.16.0.0 — Phase 11: Onboarding & Security Readiness**
- ✅ **v0.17.0.0 — Sprint 12: KPI Parity and Discovery v2**
- ✅ **v1.0.0 — API-Key Rewrite** (Diagnose → Fix → Unify → Ship to LPs)
- ✅ **v1.1.0 — Scenario Analysis** (Surface → Honesty → Persist → Read → Quant)
- ✅ **v1.2 — Allocator Cohesion** (tag `v1.2` @ `11775460`)
- ✅ **v1.2.1 — scenario-tab-hardening** (tag `v1.2.1` @ `e5e4f3d2`)
- ✅ **v1.2.2 — scenario-tab-factsheet-parity** (tag `v1.2.2` @ `43e57dd0`)
- ✅ **v1.3 — Mobile & Adaptive UI** (2026-06-28)
- ✅ **v1.4 — Frontend Excellence** (tag `v1.4` @ `4c4ca537`)
- ✅ **v1.5 — Scenario Coverage-Window Blend** (tag `v1.5` @ `f8b502e7`)
- ✅ **v1.6 — Scenario Series-Space Purification** (tag `v1.6` @ `f78f036b`)
- ✅ **v1.7 — Deribit Exchange Coverage & Carry-Forward Burn-Down** (tag `v1.7` @ `9a1e7b8e`)
- ✅ **v1.8 — Flow-Aware Time-Weighted Returns + Native-Unit NAV** (tag `v1.8` @ `eb8e357e`)
- ✅ **v1.9 — Multi-Key Composite Strategy** (tag `v1.9` @ `044bee50`). Archive: `milestones/v1.9-ROADMAP.md`.
- ✅ **v1.9.1 — Composite Onboarding Hardening** (tag `v1.9.1` @ `be215b15`). Archive: `milestones/v1.9.1-ROADMAP.md`.
- ✅ **v1.10 — Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification** (2026-07-15). Archive: `milestones/v1.10-ROADMAP.md`.
- ✅ **v1.11 — Scenario Composer v2** (tag `v1.11` @ `a42f4bcf`, Phases 109–117). Every source is a daily-series constituent under a coherent manager/allocator role model. Archive: `milestones/v1.11-ROADMAP.md`.
- ✅ **v1.12 — sFOX Verified Integration (Foundation, flag-OFF)** (tag `v1.12` @ `92be47af`, Phases 118–123). Live sFOX `api_verified` foundation shipped dormant; go-live re-homed to v1.13. Archive: `milestones/v1.12-ROADMAP.md`.
- ✅ **v1.13 — Infra: sFOX go-live foundation + worker rebuild** (tag `v1.13`, Phases 125–130, shipped FLAG-OFF 2026-07-19, closed 2026-07-22). Railway static-egress + worker rebuild + trust-tier SECDEF. Archive: `milestones/v1.13-ROADMAP.md`.
- ✅ **v1.14 — Smoothed options MTM (third factsheet basis)** (tag `v1.14` @ `0adde939`, v0.48.0.x, Phases 131–133, shipped + flipped LIVE 2026-07-23; PRs #633 + #635). Additive third `pnl_basis` `smoothed_mtm` (daily ΔMTM redistribution, total-preserving; cash/MTM byte-identical). Archive: `milestones/v1.14-ROADMAP.md`. Review: `v1.14-BIG-REVIEW.md` (SHIP).
- ✅ **v1.15 — MetaTrader 5: live api_verified account sync** (tag `v1.15`, v0.49.0.0→v0.49.4.0, Phases 134–139, shipped DARK 2026-07-24 + flipped LIVE 2026-07-25; PRs #636 + #637/#640/#641/#642). Self-hosted Wine gateway + `mt5linux` net client → deal-ledger equity reconstruction → the ONE backbone with `api_verified`; √252 traditional; 3-field creds. Prod gateway private+live, Vantage acct 26547876 soaked green, flags flipped LIVE. Archive: `milestones/v1.15-ROADMAP.md` + `v1.15-REQUIREMENTS.md`. Audit: `v1.15-MILESTONE-AUDIT.md`.
- ✅ **v1.16 — Production Resilience & Reliability** (Phases 140–142, closed 2026-08-14). Archive: `milestones/v1.16-ROADMAP.md`.
- ✅ **v1.17 — MT5: ingested, wizardable, surfaced** (Phases 147–154, 156, closed 2026-08-14, v0.62.0.0). Archive: `milestones/v1.17-ROADMAP.md`.
- ✅ **v1.19 — JOB/RATE** (tag `v1.19`, Phases 143–146, 146.1, 146.2, closed 2026-08-20, v0.68.1.0). Archive: `milestones/v1.19-ROADMAP.md`.
- ✅ **v1.20 — Backlog Burndown** (tag `v1.20`, Phases 158–191, closed 2026-11-06, v0.133.23.2, audit `tech_debt`). Archive: `milestones/v1.20-ROADMAP.md`.


## Current position

🚧 **v1.21 UX — trustworthy, navigable, lean — Phases 192–202, roadmap written 2026-11-06.** Next: `/gsd-plan-phase 192` (PUBLICTRUTH). 202 RESIDCHURN runs in parallel from now: its control capture needs a 00:40Z nightly with no deploy between its two captures.

⭐ **v1.20 Backlog Burndown — CLOSED 2026-11-06.** Its Phase 188 SC-4 residual (D-13) is 202 RESIDCHURN in v1.21.

⏸️ **v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157)** — PARKED, founder-gated twice over: new MT5 investor passwords AND the founder at the terminal on a trading day. Phase numbers 155 and 157 stay reserved.

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._
