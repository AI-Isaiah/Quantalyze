# Requirements: Quantalyze

**Defined:** 2026-11-06
**Core Value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked — and can model the impact of composition changes before they make them.

**Source:** the five-persona UX review of the live app, 2026-11-06 (new allocator, experienced allocator, new manager, experienced manager, first-time visitor), plus the Phase 188 SC-4 residual (D-13). Every finding is a claim until a phase re-measures it at HEAD.
**Scope decisions (founder 2026-11-06):** trust first; fix and trim only (no new manager-entered data).

## Milestone v1.21 Requirements

### Trust — what the app says is true

- [x] **TRUST-01**: A visitor reading the home, `/security`, `/for-quants` and Terms pages gets one consistent, true account of how API keys are stored and encrypted, which TLS versions are accepted, who can view a factsheet, what listing costs, and how many exchanges are supported. The home page no longer asks an anonymous visitor for a key and secret.
- [x] **TRUST-02**: Scrolling over a factsheet chart never changes its date range by itself. A narrowed range is always labelled with a one-click reset, and is never silently restored on a later visit.
- [x] **TRUST-03**: No factsheet shows developer notes, placeholder copy, or demo content that belongs to another strategy or portfolio.
- [ ] **TRUST-04**: A metric with the same name shows the same value for the same strategy and period on every page (My Strategies, factsheet, tearsheet, Scenario, Holdings). Where two figures differ on purpose (gross vs net, a different period or definition), the label says so.
- [ ] **TRUST-05**: A figure that cannot be meaningful (an implausible cumulative return, an annualised ratio on a record shorter than a year) is withheld or plainly qualified, never shown at full confidence.
- [x] **TRUST-06**: Opening any page writes nothing on the user's behalf (for example, viewing a strategy no longer creates an empty note).

### Route — no dead ends

- [ ] **ROUTE-01**: After sign-in, an allocator, a manager and an admin each land on a page made for their role, not on a discovery category.
- [ ] **ROUTE-02**: A signed-in user is never shown visitor prompts ("Sign up") on `/browse` or `/strategy/<id>`, and an owner can open their own unpublished strategy.
- [x] **ROUTE-03**: `/demo` shows no stuck loading notice, no "—" under a headline claim, no empty founder view and no raw ids.
  - *Amended 2026-11-07 (Phase 192 D-11, founder: "retire the whole demo part"; recorded in 192-CONTEXT.md and the ROADMAP):* the public demo is retired, not repaired. ROUTE-03 is met when `/demo` and every link to it are gone, a request for it gets the same answer as an unknown URL, and no public page links to a retired route. The sentence above is kept as lineage.
- [ ] **ROUTE-04**: From a factsheet, a signed-in user can go back to where they came from and take a next step (request an intro, add to their allocation). A shared factsheet carries a header and a sign-up link.
- [ ] **ROUTE-05**: An allocator can select strategies in discovery and open Compare from the UI.
- [ ] **ROUTE-06**: "+ Allocation" on My allocation opens the allocator's flow, not the manager's add-strategy wizard.
- [ ] **ROUTE-07**: My allocation's first tab answers "how is my book doing?" with the book's return, risk and holdings at a glance, or names exactly what is missing.
- [ ] **ROUTE-08**: Holdings labels positions correctly: allocated positions are not called "not allocated", and cash is not counted as Spot exposure.
- [ ] **ROUTE-09**: A manager can see which strategies each key feeds, and no one-click control re-points a strategy's key without an explicit confirmation.
- [ ] **ROUTE-10**: A manager renames a strategy in one place and can see which name is public.
- [ ] **ROUTE-11**: Every degrade warning names the affected days or key and says what the user can do. My Strategies shows each strategy's health, and its status chips have a legend.

### Clarity — screening reads plainly

- [ ] **CLAR-01**: Every discovery column states its period and whether it is annualised; volatility carries no sign; a track-length column exists.
- [ ] **CLAR-02**: A strategy whose data is stale is flagged in discovery and does not rank as if it were current.
- [ ] **CLAR-03**: Specialist terms (Omega, Ulcer, Common-sense ratio, Kolmogorov-Smirnov, Bridge, mandate, TWR and the like) carry a tooltip or a glossary entry.
- [ ] **CLAR-04**: Each concept has one name across the app (allocation / book / portfolio; watchlist / favorites / star; mandate / preferences / profile).
- [ ] **CLAR-05**: A listing says when two strategies draw on the same exchange account.
- [ ] **CLAR-06**: Factsheet sections are numbered in order, dates use one format, Escape closes the filter drawer, the egress-IP link leads to the IPs (or is removed), and the disclaimer typo is fixed.

### Lean — less to wade through

- [ ] **LEAN-01**: A manager has one strategies list (`/strategies` and `/my-strategies` merged).
- [ ] **LEAN-02**: A strategy has one page, the factsheet. The tearsheet is its print view and `/strategy/<id>` leads to it.
- [ ] **LEAN-03**: `/portfolios` is removed and Decks is hidden until it works.
- [ ] **LEAN-04**: Adding a strategy, managing keys and renaming each have one entry point, and the security explanation lives in one place.
- [ ] **LEAN-05**: The factsheet opens as a summary, one chart and one metrics table, with the rest under "Advanced". No metric is shown twice, the keyboard hint appears once, there is one small-sample warning, and empty sections and "— on request" rows are hidden.
- [ ] **LEAN-06**: My allocation has at most three tabs, lists positions once, and hides dust rows by default.
- [ ] **LEAN-07**: User-visible leftovers are gone: the "Tweaks / Design variations" panel, the dark-mode option, toggles that do nothing useful, the single-card `/browse`, and duplicated disclaimers.

### Residual — carried from v1.20

- [ ] **RESID-01**: A control capture across a nightly with no deploy in between shows whether stored values move without a code change, and each moved value from the 188 re-reading (1214) is attributed to a cause or named as unexplained (Phase 188 D-13).
- [ ] **RESID-02**: Book b3's earlier reasons (`out_of_window_flow`, `window_truncated`) are explained, and fixed where they are a defect.

## Future Requirements

Deferred, tracked, not in this roadmap.

- **TERMS-01**: A manager can enter fees, terms and an investment thesis, and the factsheet shows them (founder 2026-11-06: fix and trim only in v1.21).
- **TERMS-02**: The factsheet states net vs gross and the base currency, and fills "Data source" for every strategy.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Legal entity and jurisdiction text in Terms and Privacy | The founder supplies it; an agent must not invent it. |
| Dark mode | DESIGN.md says it is not planned; LEAN-07 removes the option instead. |
| New exchange venues (Binance income, Deribit option replay) | Owned by TODOS (`187-BINANCEINCOME-NEXT-MILESTONE`, `189-OPTIONREPLAY-NEXT-MILESTONE`); not UX. |
| MT5 parity (v1.18) | Parked, founder-gated. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TRUST-01 | Phase 192 | Satisfied (192-VERIFICATION.md passed, UAT passed 2026-11-07) |
| TRUST-02 | Phase 193 | Complete |
| TRUST-03 | Phase 193 | Complete |
| TRUST-04 | Phase 194 | Pending |
| TRUST-05 | Phase 194 | Pending |
| TRUST-06 | Phase 193 | Complete |
| ROUTE-01 | Phase 199 | Pending |
| ROUTE-02 | Phase 196 | Pending |
| ROUTE-03 | Phase 192 | Satisfied as amended by D-11 (192-VERIFICATION.md passed, UAT passed 2026-11-07) |
| ROUTE-04 | Phase 196 | Pending |
| ROUTE-05 | Phase 197 | Pending |
| ROUTE-06 | Phase 198 | Pending |
| ROUTE-07 | Phase 198 | Pending |
| ROUTE-08 | Phase 198 | Pending |
| ROUTE-09 | Phase 200 | Pending |
| ROUTE-10 | Phase 200 | Pending |
| ROUTE-11 | Phase 199 | Pending |
| CLAR-01 | Phase 197 | Pending |
| CLAR-02 | Phase 197 | Pending |
| CLAR-03 | Phase 201 | Pending |
| CLAR-04 | Phase 201 | Pending |
| CLAR-05 | Phase 197 | Pending |
| CLAR-06 | Phase 201 | Pending |
| LEAN-01 | Phase 199 | Pending |
| LEAN-02 | Phase 196 | Pending |
| LEAN-03 | Phase 195 | Pending |
| LEAN-04 | Phase 200 | Pending |
| LEAN-05 | Phase 196 | Pending |
| LEAN-06 | Phase 198 | Pending |
| LEAN-07 | Phase 195 | Pending |
| RESID-01 | Phase 202 | Pending |
| RESID-02 | Phase 202 | Pending |

**Coverage:**
- Milestone requirements: 32 total
- Mapped to phases: 32
- Unmapped: 0 ✓

---
*Requirements defined: 2026-11-06*
*Last updated: 2026-11-06 after the v1.21 roadmap (traceability filled, 32/32 mapped to Phases 192–202)*
