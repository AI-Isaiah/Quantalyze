# Phase 201: PLAINWORDS — one name per concept, explained, and the small inconsistencies fixed - Context

**Gathered:** 2026-11-11
**Status:** Ready for planning
**Mode:** `--auto`. The founder was not available. Every decision below that is not quoted from ROADMAP.md or an earlier CONTEXT.md is an **orchestrator default, founder to confirm**. Decisions marked with a reversibility rating other than `reversible` are flagged in the phase report.

<domain>
## Phase Boundary

From ROADMAP `### Phase 201` (requirements CLAR-03, CLAR-04, CLAR-06):

> Specialist terms are explained where they appear, each concept has one name across the app, and the small inconsistencies are fixed: factsheet sections numbered in order, one date format, Escape closes the filter drawer, the egress-IP link leads to the IPs or is removed, and the disclaimer typo is gone. Added 2026-11-10 (founder, Phase 196/197 UAT, "Real name everywhere"): a strategy reads under its real name on every surface, including the browse route behind compare's "Add strategy" and the tearsheet card and title (`TODOS.md` `197-STRATEGY-NAME-PSEUDONYM-01`).

Success criteria (ROADMAP, verbatim):
1. Every specialist term (Omega, Ulcer, Common-sense ratio, Kolmogorov-Smirnov, Bridge, mandate, TWR and the like) carries a tooltip or links to a glossary entry wherever it appears.
2. Each concept has one name across the app (allocation / book / portfolio; watchlist / favorites / star; mandate / preferences / profile), and a test goes RED on a retired word in user-visible copy.
3. Factsheet sections are numbered in order and dates use one format across the app.
4. Escape closes the discovery filter drawer, the egress-IP link leads to the IPs or is removed, and the disclaimer reads "does not operate".

Wording and tooltips are checked against `DESIGN.md` (Voice / microcopy, Typography).

This phase changes words, labels, tooltips and a few small behaviours. It adds no new page, no new data and no migration.

</domain>

<decisions>
## Implementation Decisions

### Specialist terms (SC-1, CLAR-03)
- **D-01:** **One term registry, rendered as tooltips; no glossary page.** Orchestrator default, founder to confirm. Every definition lives in one module (e.g. `src/lib/glossary.ts`: term key → label → one or two sentences). A single wrapper component renders a term through the existing `src/components/ui/Tooltip.tsx` primitive (hover and keyboard focus, `role="tooltip"`). SC-1 allows "a tooltip or a glossary entry"; tooltips meet it without adding a page. Existing per-surface definitions (the discovery header tooltips from 197 D-05, any KPI tooltips) move into the registry so each term has one definition. — **Reversibility:** reversible.
- **D-02:** **Term list.** Orchestrator default, founder to confirm. At least the SC-1 terms: Omega, Ulcer Index, Common-sense ratio, Kolmogorov-Smirnov, Bridge, mandate, TWR. "And the like" is enumerated by the researcher from the surfaces where specialist statistics appear: the factsheet (opening view, Advanced, Detailed metrics rail, Style Drift), the tearsheet, My allocation (KPI strip, glance, Scenario), discovery and compare. Candidates seen at HEAD: Sortino, Calmar, CAGR, Max DD, tail ratio, skew, kurtosis, VaR / CVaR, correlation (ρ), profit factor, θ in "Omega (θ=0)". Plain words (Return, Volatility in a column that already states period and annualisation) do not need one.
- **D-03:** **"Wherever it appears" is tested.** Orchestrator default, founder to confirm. A test enumerates the registry and fails when a registered term renders on a covered surface without its tooltip. Definitions follow DESIGN.md Voice / microcopy (declarative, sentence case, a threshold or formula where one exists, no adjectives where a number exists). The trigger keeps the label's existing typeface (Geist Mono stays on data labels); only the bubble uses the Tooltip primitive's DM Sans.

### One name per concept (SC-2, CLAR-04)
- **D-04:** **"allocation" is the name for an allocator's set of holdings.** Orchestrator default, founder to confirm. It matches the sidebar's "My allocation" and the names Phases 196 and 198 locked ("Add to my allocation", 196 D-02; "+ Allocation", 198 D-03). "portfolio" and "book" (as a noun for that concept) are retired from user-visible copy. Code identifiers, routes (`/api/portfolio-strategies/...`), table names and test ids are NOT renamed (copy only). — **Reversibility:** costly — every renamed string is a call site; the census (D-08) pins the result.
- **D-05:** **"watchlist" is the name for a strategy an allocator marks to follow.** Orchestrator default, founder to confirm. It matches the existing "Watchlist" panel and "My Watchlist" discovery tab. The star stays as the control; its accessible name says "Add to watchlist" / "Remove from watchlist". "favorites" and "starred" are retired from user-visible copy.
- **D-06:** **"mandate" is the name for an allocator's investment criteria; "Profile" names only the account page.** Orchestrator default, founder to confirm. "preferences" is retired where it means the mandate, including admin copy (`PreferencesPanel`'s "Preferences saved"). The factsheet's constituent "Mandate" heading (`MandatePanels.tsx`, constituent strategy types and markets) is a different concept and gets a different name (planner picks the words) so "mandate" means one thing.
- **D-07:** **Navigation names, sentence case.** Orchestrator default, founder to confirm. "My allocation" everywhere (no "My Allocation"); "Strategies" replaces "My Strategies" (199 D-01 merged the lists at `/strategies`); the mobile bottom nav's "Bridge" item, which opens the Scenario tab, is labelled "Scenario" to match the tab. "Bridge" stays the name of the replacement flow inside Scenario and carries a tooltip (D-02). The back-link label map (196 UI-SPEC: "they live in ONE map, so Phase 201 renames change one place") is updated in that one map.
- **D-08:** **Retired-word census.** Orchestrator default, founder to confirm. One vitest test scans user-visible copy under `src/` (JSX text, user-visible attributes such as `label`, `title`, `placeholder`, `aria-label`, `alt`, and the string maps that feed them) and goes RED on a retired word. Each permitted exception is listed with a reason and the exception list is count-pinned (adding one is visible in review). Verb uses (e.g. "book a call") and job titles are handled explicitly by the planner, never by loosening the matcher. The test must be shown RED by neutering a renamed string and restored from a byte backup.

### Strategy name (TODOS `197-STRATEGY-NAME-PSEUDONYM-01`)
- **D-09:** **Real name everywhere.** Founder decision 2026-11-10, quoted in ROADMAP and TODOS: "Real name everywhere": the strategy's real name on every surface; the manager's identity stays pseudonymous until an intro. Implementation default (orchestrator, founder to confirm): one resolver decides a strategy's displayed name for every surface: `strategies.name`, then the codename only when there is no name, then `Strategy #<id-prefix>` only when there is neither. It covers `/api/strategies/browse` (compare's "Add strategy"), the tearsheet manager card and `<title>`, and Phase 200's `publicNamePreview` (whose "discovery" leg must then equal what discovery prints). Manager names, firm names and contact details are not touched. Closed per TODOS when the browse route, the tearsheet card and title print the same name as discovery for a published strategy, and a test searching a discovery-visible name in "Add strategy" goes RED if the pseudonym returns. The researcher must check whether any surface still relies on `disclosure_tier` to hide a strategy name and list it. — **Reversibility:** one-way — a strategy name once printed on a surface cannot be un-shown to whoever saw it; mitigated by the TODOS reading that the name is already public on anonymous `/browse`.

### Small inconsistencies (SC-3, SC-4, CLAR-06)
- **D-10:** **Factsheet sections numbered in rendered order.** ROADMAP evidence: they run I, II, III, V, IV (`MetricsColumn.tsx`). Numbering follows render order, with a test pinning the sequence.
- **D-11:** **One date format.** Orchestrator default, founder to confirm. Day dates in UI copy read `Oct 9, 2026` (en-US, short month, numeric day, numeric year, UTC so server and client agree); month-granularity dates read `Oct 2026`. One helper in `src/lib/utils.ts` produces them and the existing ad-hoc formatters (`toLocaleDateString()` with no options, `formatAbsoluteDate`'s yearless `Oct 9`, `formatIsoDay`'s `2026-10-09` in table cells) move to it. Exempt: machine-facing values (CSV and export files, file names, `<input type="date">` values, URLs), relative ages ("3d ago") which are not dates, and the frozen chart islands under the `FROZEN_ISLANDS` git-diff-zero guard (DESIGN.md decision log 2026-06-30). A test goes RED on a new non-helper date format in user-visible code. — **Reversibility:** costly — many call sites; if the founder prefers another format, the one helper changes and the call sites stay.
- **D-12:** **Escape closes the discovery "All Filters" panel.** Measured at HEAD: the panel in `src/components/strategy/StrategyFilters.tsx` closes on backdrop and Close only; `CustomizeDrawer.tsx` already handles Escape. Default: Escape behaves like Close (the draft is discarded), respects an Escape a nested popover already handled (same idiom as `CustomizeDrawer`), and focus returns to the "All Filters" button.
- **D-13:** **The egress-IP link is removed.** Orchestrator default, founder to confirm. The IPs are not published: `/security#egress-ips` tells the reader to use the contact form for the current IP set, and the sFOX static egress does not exist until it is stood up (ROADMAP evidence). The wizard hint (`WizardIpAllowlistHint.tsx`) stops linking to `/security#egress-ips` and instead says, in one sentence, to ask for the current IP set through the security contact form (`SECURITY_CONTACT_HREF`). The `/security` section itself is unchanged.
- **D-14:** **The disclaimer reads "does not operate".** ROADMAP evidence: `</strong>` followed by a line break renders "notoperate" (`legal/disclaimer/page.tsx:60-61`). Fix with an explicit space; a rendered-text test pins "does not operate". The researcher checks the same page and `src/components/ui/Disclaimer.tsx` for the same `</strong>`-newline pattern.

### Folded routed items
- **D-15:** **Volatility prints unsigned on the tearsheet and in `CompareTable`.** TODOS `[197-VOL-SIGN-TEARSHEET-COMPARE]` names Phase 201 as owner: closed when both surfaces print volatility unsigned and `src/__tests__/figure-parity-pages.test.tsx` compares volatility as exact text again.
- **D-16:** **Custody sentence per trust tier (Phase 195 UC-10, routed to Phase 201 in `195-05-SUMMARY.md`).** At HEAD the `strategy-page` variant of `Disclaimer.tsx` is already tier-aware (195 D-09), but the `custody` variant still prints "Strategy monitored via read-only exchange API" unconditionally. The researcher lists its callers; if any renders for a non-`api_verified` tier, it gets the same tier rule. If none does, record that and change nothing.

### Rulings after research (2026-11-11, orchestrator defaults, founder to confirm)

`201-RESEARCH.md` answered the code questions and raised eight open questions. These rulings settle them and correct three stale premises above. Each "narrows SC-N" item is a recorded narrowing, not a gap.

- **D-17:** **D-09 boundary: a viewer sees the name discovery would show them.** Discovery prints `strategies.name` raw for every row its query returns (`StrategyTable.tsx`, the name cell), whatever the codename. So the rule is: for a strategy that is visible in discovery (published, passing the same visibility predicate discovery's query uses), every surface prints `strategies.name`, then the codename only when the name is null, then `Strategy #<id-prefix>`. For a strategy NOT visible in discovery to that viewer (unpublished, not the viewer's own), nothing changes: the existing redaction and pseudonym stay (197 D-02: an unpublished strategy is never named). The `redactedName` redaction in `src/lib/queries.ts` (audit G8.A.2 / P35) is narrowed to that predicate, not removed; `redactedOrgName` (manager-identifying) is NOT touched. A test must go RED if a strategy not visible in discovery gets its real name through any changed path. The browse route keeps emitting `codename` (no API change); search matches the displayed name, and keeps matching `codename` as well.
- **D-18:** **Senses of "portfolio" and "book" (D-04 extended).** A lexical census cannot tell senses apart, so each sense gets a word that is not retired:

  | Sense at HEAD | Word |
  |---|---|
  | An allocator's live holdings ("portfolio", "book", "My Allocation") | allocation ("My allocation") |
  | A saved Scenario draft ("Save portfolio", "portfolio name") | scenario ("Save scenario") |
  | Manager or firm assets under management ("Portfolio AUM") | AUM, named by owner ("Firm AUM" / "Strategy AUM", whichever the field holds) |
  | A trading desk's positions ("options book") | positions |
  | The verb ("Book a call", "Book Intro Call") | keep the verb only where it is a verb; the census matches the noun forms and lists each verb site as a named exception |
  | Job title ("portfolio manager") | manager |
  | Discovery view settings ("Save preferences" in `CustomizeDrawer`) | view ("Save view") |

  "No preference" (plain English in `RequestIntroButton`) is a named exception.
- **D-19:** **Narrows SC-1: label positions.** "Wherever it appears" means every label position: headings, table row labels, column headers, KPI captions, chart titles, nav items. A term inside running prose is not wrapped. The `Term` trigger is focusable (`tabIndex=0`) so keyboard users reach the definition; it adds no visible text (the 196 factsheet census tallies visible label text).
- **D-20:** **Narrows SC-1: print and PDF.** The print view (`/factsheet/[id]/tearsheet`) and the PDF render no tooltips; that is accepted, they keep the plain label.
- **D-21:** **Narrows SC-3: what "one date format" covers.** Chart axis ticks and time-of-day stamps are outside the date rule (a time stamp uses the D-11 day format followed by the time); machine-facing values stay exempt (D-11). **Correction to D-11:** the FROZEN_ISLANDS guard lists four files (`useBreakpoint`, `montecarlo.worker`, `TouchTooltip`, `useTapPin`), none of which formats a date, so that exemption is empty; chart axis ticks are exempt as a category instead.
- **D-22:** **Narrows SC-2: census scope is `src/`.** The Python analytics service's alert text ("Portfolio drawdown has reached…") is outside the census and recorded in Deferred.
- **D-23:** **Egress links in `wizardErrors.ts` are folded into D-13.** Its two `docsHref: "/security#egress-ips"` links are the same dead link; they point to the security contact path the same way the hint does. **Amended by UI-SPEC U-16 (founder to confirm):** no component renders `docsHref`, so the values stay `/security#egress-ips` and the dead pointer is the bullet sentence "see the docs link below", which is rewritten to name the contact form; the rewritten bullets reach the contact form through `ErrorEnvelope`, which opens the support topic with the error reference, not the security topic.
- **D-24:** **Tearsheet Risk Disclosure custody sentence is folded into D-16.** It hard-codes "monitored via read-only exchange APIs" for every trust tier while `trustTier` is in scope; it follows the `Disclaimer` tier rule (the API sentence only for `api_verified`). **Correction to D-16:** no `src` call site renders the `custody` variant, so the variant itself changes nothing.
- **D-25:** **Correction to D-15:** the tearsheet half is already closed by Phase 196 (the print view's `pct()` is unsigned). Only `CompareTable` still prints a `+`; `figure-parity-pages.test.tsx` gains a `CompareTable` arm.
- **D-26:** **Unattended planning.** The planner runs with `REVERSIBILITY_GATES: false` (ratings recorded, no `checkpoint:decision`), because no founder is available to answer one. D-09/D-17 is rated one-way and is flagged in the phase report.

### Founder decisions, smart discuss 2026-11-11 (supersede the orchestrator defaults above)

The founder ran a smart discuss for Phase 201 on 2026-11-11 (committed on `main` as `c68f69f50`, in a second phase directory with the untruncated slug; that file numbers its decisions F-01..F-15 here to keep the D-numbers above, which commits and plans already cite). Founder picks: "Accept all" (one name per concept), "Central glossary + tooltips" (terms), "Link to /security IPs" (inconsistencies; every other recommendation accepted). Where an F-decision and a D-decision above disagree, **the F-decision wins**; every D-decision not named below as overridden is now founder-confirmed rather than "founder to confirm".

| Founder | Branch decision | Effect |
|---|---|---|
| F-01 Allocation; "book" and "portfolio" retired in user copy | D-04, D-18 | confirmed |
| F-02 Watchlist; star is the control; "favorites" retired | D-05 | confirmed |
| F-03 Mandate = criteria, Profile = account page; "preferences" retired where it means mandate | D-06 | confirmed |
| F-04 The `tab=scenario` surface is named "Scenario" everywhere; the sidebar's "Bridge" is renamed; **"Bridge" is retired** | D-07, D-02 | **OVERRIDES D-07** ("Bridge stays the name of the replacement flow inside Scenario and carries a tooltip") and removes "Bridge" from D-02's term list |
| F-05 Real name everywhere: browse, tearsheet card and `<title>` print the real name, as discovery does; manager identity stays pseudonymous; a compare "Add strategy" test goes RED if the pseudonym returns | D-09, D-17 | confirmed (D-17's boundary, the name discovery would show that viewer, is how "as discovery does" is implemented) |
| F-06 Retired-word test over user-visible copy, count-pinned allowlist, shown RED on a planted word | D-08 | confirmed |
| F-07 One registry rendered through `Tooltip.tsx`; no glossary page | D-01 | confirmed |
| F-08 Coverage: Omega, Ulcer, Common-sense ratio, Kolmogorov-Smirnov, **Scenario (formerly Bridge)**, mandate, TWR, every factsheet metric label and discovery column header (reuse 197 D-05) | D-02, D-19 | confirmed, with "Scenario" replacing "Bridge" as the registered term |
| F-09 One plain sentence per term, DESIGN.md Voice / microcopy | D-03 | confirmed |
| F-10 Gate: RED on a registered term without its tooltip, and on a registered term without a definition | D-03 | confirmed |
| F-11 Dates read "Nov 12, 2026" through one helper; ISO stays in CSV and exports | D-11, D-21 | confirmed |
| F-12 Egress IP: **the wizard link keeps pointing at `/security#egress-ips`**; that anchor must exist and state the static egress IP's status plainly (the IPs once they exist, or that there is none to allowlist yet), and the link must land on that statement | D-13, D-23 | **OVERRIDES D-13** (link removed, contact form instead) and the D-23 / U-16 contact-form rewording. Plan 201-05 shipped the D-13 version on this branch; it is reworked by a follow-up plan |
| F-13 Factsheet sections renumbered I to V in render order | D-10 | confirmed |
| F-14 Escape closes the discovery filter drawer, with a test | D-12 | confirmed |
| F-15 Disclaimer reads "does not operate" | D-14 | confirmed |

Founder deferred: a standalone /glossary page.

**How F-04 applies (orchestrator reading, within the founder's words):** "Bridge" joins the retired words of the D-08 census in user-visible copy (labels, headings, aria names, toasts, API error strings shown to a user, the registry). The replacement flow inside the Scenario tab is described in plain words or as part of Scenario, never as "Bridge"; the exact wording is the UI-SPEC's call. Code identifiers, file names, routes (`/api/bridge/...`), table names, test ids and analytics event names are NOT renamed (copy only, the D-04 principle). The registered term is "Scenario"; its definition may say it was formerly called Bridge, which is the one permitted, count-pinned census exception for the word.

### Claude's Discretion
- Exact definition wording (within DESIGN.md Voice / microcopy), the term wrapper's API, and how the census distinguishes verbs and job titles.
- Plan split and wave order. Plans that touch the same files (factsheet, Sidebar, StrategyTable) are ordered so they do not conflict.
- The wording that replaces the factsheet constituent "Mandate" heading (D-06).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` `### Phase 201` — goal, success criteria, evidence at HEAD.
- `.planning/REQUIREMENTS.md` — CLAR-03, CLAR-04, CLAR-06.
- `TODOS.md` `197-STRATEGY-NAME-PSEUDONYM-01`, `[197-VOL-SIGN-TEARSHEET-COMPARE]`, `[197-COMPARE-NAME-PSEUDONYMITY]` (same defect as the first; close both).

### Design contract
- `DESIGN.md` §Typography (three voices) and §Voice / microcopy; §AI-Slop Ban; decision log 2026-06-30 (FROZEN_ISLANDS).

### Earlier decisions this phase builds on
- `.planning/phases/196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it/196-CONTEXT.md` D-01, D-02 (back links, "Add to my allocation"); `196-UI-SPEC.md` "Phase 201 renames" (one label map).
- `.planning/phases/197-screen-discovery-reads-plainly-and-a-shortlist-can-be-compared/197-CONTEXT.md` D-04, D-05 (compare, header tooltips); `197-UI-SPEC.md` A-3.
- `.planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-CONTEXT.md` D-02, D-03 (three tabs, "+ Allocation").
- `.planning/phases/199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has/199-CONTEXT.md` D-01 (`/strategies` for all owners), D-06 (see Deferred).
- `.planning/phases/195-trim-leftover-and-duplicate-surfaces-are-gone/195-05-SUMMARY.md` UC-10.
- Phase 200 (MANAGERKEYS) shipped in #1251; its `publicNamePreview` is in `src/lib/strategy-display.ts` (its planning directory is not on `main`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/Tooltip.tsx`: portaled, accessible tooltip (hover + focus), `content: string`. Base for D-01.
- `src/lib/strategy-display.ts`: `displayStrategyName` (codename, then real name for institutional only, then `Strategy #<id>`) and `publicNamePreview` (Phase 200 D-11). D-09 changes this resolver or replaces its callers.
- `src/lib/utils.ts`: `formatAbsoluteDate` (yearless), `formatIsoDay` (`YYYY-MM-DD`), `formatRelativeTime`. Home for D-11's helper.
- `src/components/strategy/CustomizeDrawer.tsx:59-64`: Escape idiom that respects a nested popover's handled Escape (D-12).

### Established Patterns
- Census tests with count-pinned exception lists exist (e.g. `FactsheetBody.census.test.tsx`, the degrade-warning registry from 199 D-04). D-08 follows the same shape.
- Volatility formatting: `formatPercent(v, 2, { signed: false })` on discovery (197).

### Integration Points
- `src/components/layout/Sidebar.tsx` (desktop sections and `buildPrimaryMobileNav`: "My allocation", "Risk", "Bridge").
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx` (numbering, Omega/Common-sense/Ulcer rows), `BatchDPanels.tsx` (Kolmogorov-Smirnov), `MandatePanels.tsx`.
- `src/app/(dashboard)/allocations/components/KpiStrip.tsx`, `GlancePanel.tsx` ("YTD TWR").
- `src/app/api/strategies/browse/route.ts`, `src/app/(dashboard)/compare/CompareAddStrategy.tsx`, `src/app/factsheet/[id]/tearsheet/page.tsx` (D-09).
- `src/components/strategy/StrategyFilters.tsx` (D-12), `src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx` (D-13), `src/app/(marketing)/legal/disclaimer/page.tsx` (D-14), `src/components/strategy/CompareTable.tsx` (D-15), `src/components/ui/Disclaimer.tsx` (D-16).

</code_context>

<specifics>
## Specific Ideas

- Founder, 2026-11-10: "Real name everywhere" (D-09).
- 196 UI-SPEC: back-link labels "live in ONE map, so Phase 201 renames change one place".

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
- **199 D-06 residual / `[197-SYNCBADGE-SERIES-LADDER]`** — a non-crypto row 8 to 10 days old reads Healthy on the strategies list and stale on its factsheet `SyncBadge` (3/7-day ladder vs `listSeriesVerdict`'s 7/10). 199 D-06 says "routed to Phase 201", but Phase 201's ROADMAP success criteria do not name it, and the fix changes a freshness threshold in a shared, heavily gated badge (also on the portfolio tables), not a word. **Orchestrator default, founder to confirm: not folded; stays an open TODO needing its own phase.**
- `[197-PERCENTILE-COHORT-STALE]` — cohort rule, not wording. Not folded.
- Python analytics alert text using "portfolio" (D-22) — outside the `src/` census; needs a follow-up if the founder wants it renamed.

</deferred>

---

*Phase: 201-PLAINWORDS*
*Context gathered: 2026-11-11*
