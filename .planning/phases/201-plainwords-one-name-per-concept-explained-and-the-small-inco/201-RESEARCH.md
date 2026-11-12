# Phase 201: PLAINWORDS - Research

**Researched:** 2026-11-11
**Domain:** Next.js / React copy, labels and tooltips; a static copy census; a name resolver; a date helper; a handful of small UI behaviours. No new page, no new data, no migration.
**Confidence:** HIGH on file locations and the mechanisms to reuse; MEDIUM on scanner counts (heuristic estimates, filter stated below); LOW on three scope questions listed under Open Questions.

**Research method note.** The `research-plan` seam and the package-legitimacy gate were not used: the phase uses no external library and installs no package (the scanner reuses `typescript`, already a dev dependency, see Standard Stack). All findings are from reading this worktree at HEAD (`30171627e`). All paths in this file are repo-relative. Counts marked "heuristic" come from a throwaway TypeScript-compiler-API scanner run over `src/` (non-test files only); its filter is stated where the count appears, and the real census must be rebuilt in Wave 1, not trusted from this file.

<user_constraints>
## User Constraints (from CONTEXT.md)

Copied verbatim from `201-CONTEXT.md`. Mode `--auto`: every decision not quoted from ROADMAP or an earlier CONTEXT is an orchestrator default, founder to confirm; treat as locked for planning.

### Locked Decisions

#### Specialist terms (SC-1, CLAR-03)
- **D-01 One term registry, rendered as tooltips; no glossary page.** Orchestrator default, founder to confirm. Every definition lives in one module (e.g. `src/lib/glossary.ts`: term key → label → one or two sentences). A single wrapper component renders a term through the existing `src/components/ui/Tooltip.tsx` primitive (hover and keyboard focus, `role="tooltip"`). SC-1 allows "a tooltip or a glossary entry"; tooltips meet it without adding a page. Existing per-surface definitions (the discovery header tooltips from 197 D-05, any KPI tooltips) move into the registry so each term has one definition. — **Reversibility:** reversible.
- **D-02 Term list.** Orchestrator default, founder to confirm. At least the SC-1 terms: Omega, Ulcer Index, Common-sense ratio, Kolmogorov-Smirnov, Bridge, mandate, TWR. "And the like" is enumerated by the researcher from the surfaces where specialist statistics appear: the factsheet (opening view, Advanced, Detailed metrics rail, Style Drift), the tearsheet, My allocation (KPI strip, glance, Scenario), discovery and compare. Candidates seen at HEAD: Sortino, Calmar, CAGR, Max DD, tail ratio, skew, kurtosis, VaR / CVaR, correlation (ρ), profit factor, θ in "Omega (θ=0)". Plain words (Return, Volatility in a column that already states period and annualisation) do not need one.
- **D-03 "Wherever it appears" is tested.** Orchestrator default, founder to confirm. A test enumerates the registry and fails when a registered term renders on a covered surface without its tooltip. Definitions follow DESIGN.md Voice / microcopy (declarative, sentence case, a threshold or formula where one exists, no adjectives where a number exists). The trigger keeps the label's existing typeface (Geist Mono stays on data labels); only the bubble uses the Tooltip primitive's DM Sans.

#### One name per concept (SC-2, CLAR-04)
- **D-04 "allocation" is the name for an allocator's set of holdings.** Orchestrator default, founder to confirm. It matches the sidebar's "My allocation" and the names Phases 196 and 198 locked ("Add to my allocation", 196 D-02; "+ Allocation", 198 D-03). "portfolio" and "book" (as a noun for that concept) are retired from user-visible copy. Code identifiers, routes (`/api/portfolio-strategies/...`), table names and test ids are NOT renamed (copy only). — **Reversibility:** costly — every renamed string is a call site; the census (D-08) pins the result.
- **D-05 "watchlist" is the name for a strategy an allocator marks to follow.** Orchestrator default, founder to confirm. It matches the existing "Watchlist" panel and "My Watchlist" discovery tab. The star stays as the control; its accessible name says "Add to watchlist" / "Remove from watchlist". "favorites" and "starred" are retired from user-visible copy.
- **D-06 "mandate" is the name for an allocator's investment criteria; "Profile" names only the account page.** Orchestrator default, founder to confirm. "preferences" is retired where it means the mandate, including admin copy (`PreferencesPanel`'s "Preferences saved"). The factsheet's constituent "Mandate" heading (`MandatePanels.tsx`, constituent strategy types and markets) is a different concept and gets a different name (planner picks the words) so "mandate" means one thing.
- **D-07 Navigation names, sentence case.** Orchestrator default, founder to confirm. "My allocation" everywhere (no "My Allocation"); "Strategies" replaces "My Strategies" (199 D-01 merged the lists at `/strategies`); the mobile bottom nav's "Bridge" item, which opens the Scenario tab, is labelled "Scenario" to match the tab. "Bridge" stays the name of the replacement flow inside Scenario and carries a tooltip (D-02). The back-link label map (196 UI-SPEC: "they live in ONE map, so Phase 201 renames change one place") is updated in that one map.
- **D-08 Retired-word census.** Orchestrator default, founder to confirm. One vitest test scans user-visible copy under `src/` (JSX text, user-visible attributes such as `label`, `title`, `placeholder`, `aria-label`, `alt`, and the string maps that feed them) and goes RED on a retired word. Each permitted exception is listed with a reason and the exception list is count-pinned (adding one is visible in review). Verb uses (e.g. "book a call") and job titles are handled explicitly by the planner, never by loosening the matcher. The test must be shown RED by neutering a renamed string and restored from a byte backup.

#### Strategy name (TODOS `197-STRATEGY-NAME-PSEUDONYM-01`)
- **D-09 Real name everywhere.** Founder decision 2026-11-10, quoted in ROADMAP and TODOS: "Real name everywhere": the strategy's real name on every surface; the manager's identity stays pseudonymous until an intro. Implementation default (orchestrator, founder to confirm): one resolver decides a strategy's displayed name for every surface: `strategies.name`, then the codename only when there is no name, then `Strategy #<id-prefix>` only when there is neither. It covers `/api/strategies/browse` (compare's "Add strategy"), the tearsheet manager card and `<title>`, and Phase 200's `publicNamePreview` (whose "discovery" leg must then equal what discovery prints). Manager names, firm names and contact details are not touched. Closed per TODOS when the browse route, the tearsheet card and title print the same name as discovery for a published strategy, and a test searching a discovery-visible name in "Add strategy" goes RED if the pseudonym returns. The researcher must check whether any surface still relies on `disclosure_tier` to hide a strategy name and list it. — **Reversibility:** one-way — a strategy name once printed on a surface cannot be un-shown to whoever saw it; mitigated by the TODOS reading that the name is already public on anonymous `/browse`.

#### Small inconsistencies (SC-3, SC-4, CLAR-06)
- **D-10 Factsheet sections numbered in rendered order.** ROADMAP evidence: they run I, II, III, V, IV (`MetricsColumn.tsx`). Numbering follows render order, with a test pinning the sequence.
- **D-11 One date format.** Orchestrator default, founder to confirm. Day dates in UI copy read `Oct 9, 2026` (en-US, short month, numeric day, numeric year, UTC so server and client agree); month-granularity dates read `Oct 2026`. One helper in `src/lib/utils.ts` produces them and the existing ad-hoc formatters (`toLocaleDateString()` with no options, `formatAbsoluteDate`'s yearless `Oct 9`, `formatIsoDay`'s `2026-10-09` in table cells) move to it. Exempt: machine-facing values (CSV and export files, file names, `<input type="date">` values, URLs), relative ages ("3d ago") which are not dates, and the frozen chart islands under the `FROZEN_ISLANDS` git-diff-zero guard (DESIGN.md decision log 2026-06-30). A test goes RED on a new non-helper date format in user-visible code. — **Reversibility:** costly — many call sites; if the founder prefers another format, the one helper changes and the call sites stay.
- **D-12 Escape closes the discovery "All Filters" panel.** Measured at HEAD: the panel in `src/components/strategy/StrategyFilters.tsx` closes on backdrop and Close only; `CustomizeDrawer.tsx` already handles Escape. Default: Escape behaves like Close (the draft is discarded), respects an Escape a nested popover already handled (same idiom as `CustomizeDrawer`), and focus returns to the "All Filters" button.
- **D-13 The egress-IP link is removed.** Orchestrator default, founder to confirm. The IPs are not published: `/security#egress-ips` tells the reader to use the contact form for the current IP set, and the sFOX static egress does not exist until it is stood up (ROADMAP evidence). The wizard hint (`WizardIpAllowlistHint.tsx`) stops linking to `/security#egress-ips` and instead says, in one sentence, to ask for the current IP set through the security contact form (`SECURITY_CONTACT_HREF`). The `/security` section itself is unchanged.
- **D-14 The disclaimer reads "does not operate".** ROADMAP evidence: `</strong>` followed by a line break renders "notoperate" (`legal/disclaimer/page.tsx:60-61`). Fix with an explicit space; a rendered-text test pins "does not operate". The researcher checks the same page and `src/components/ui/Disclaimer.tsx` for the same `</strong>`-newline pattern.

#### Folded routed items
- **D-15 Volatility prints unsigned on the tearsheet and in `CompareTable`.** TODOS `[197-VOL-SIGN-TEARSHEET-COMPARE]` names Phase 201 as owner: closed when both surfaces print volatility unsigned and `src/__tests__/figure-parity-pages.test.tsx` compares volatility as exact text again.
- **D-16 Custody sentence per trust tier (Phase 195 UC-10, routed to Phase 201 in `195-05-SUMMARY.md`).** At HEAD the `strategy-page` variant of `Disclaimer.tsx` is already tier-aware (195 D-09), but the `custody` variant still prints "Strategy monitored via read-only exchange API" unconditionally. The researcher lists its callers; if any renders for a non-`api_verified` tier, it gets the same tier rule. If none does, record that and change nothing.

### Claude's Discretion
- Exact definition wording (within DESIGN.md Voice / microcopy), the term wrapper's API, and how the census distinguishes verbs and job titles.
- Plan split and wave order. Plans that touch the same files (factsheet, Sidebar, StrategyTable) are ordered so they do not conflict.
- The wording that replaces the factsheet constituent "Mandate" heading (D-06).

### Deferred Ideas (OUT OF SCOPE)
- **199 D-06 residual / `[197-SYNCBADGE-SERIES-LADDER]`** — a non-crypto row 8 to 10 days old reads Healthy on the strategies list and stale on its factsheet `SyncBadge` (3/7-day ladder vs `listSeriesVerdict`'s 7/10). Not folded; stays an open TODO needing its own phase.
- `[197-PERCENTILE-COHORT-STALE]` — cohort rule, not wording. Not folded.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLAR-03 | Specialist terms (Omega, Ulcer, Common-sense ratio, Kolmogorov-Smirnov, Bridge, mandate, TWR and the like) carry a tooltip or a glossary entry. | Term inventory with file:line (section 1), registry shape and `Term` wrapper, Tooltip limits (section 1.3), coverage census design (section 1.4). |
| CLAR-04 | Each concept has one name across the app (allocation / book / portfolio; watchlist / favorites / star; mandate / preferences / profile). | Retired-word census, bucketed by sense (section 2), scanner mechanism (section 2.3), nav and back-link map (section 11), strategy-name resolver (section 3). |
| CLAR-06 | Factsheet sections numbered in order, dates use one format, Escape closes the filter drawer, the egress-IP link leads to the IPs (or is removed), and the disclaimer typo is fixed. | Sections 4 to 10: date census and helper, derived numerals, Escape idiom, egress hint, disclaimer, volatility sign, custody callers. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

From the repo `CLAUDE.md`, `AGENTS.md` and the global instructions; the planner verifies every plan against these.

- **AGENTS.md:** this Next.js has breaking changes; read `node_modules/next/dist/docs/` before touching a Next API. This phase uses no Next API beyond existing patterns (client components, `next/link`), so no docs read was needed. [ASSUMED: no new Next API is introduced; re-check if a plan adds one]
- **DESIGN.md is binding** for every visual and copy choice: three voices (Instrument Serif / DM Sans / Geist Mono uppercase), sentence-case declarative captions, a threshold where one exists, no adjectives where a number exists, no new font, no decorative gradient. The ESLint rules `quantalyze/no-raw-font-px` and `quantalyze/no-rem-less-clamp` are `error`: use `text-fixed-N` / token classes, never `text-[Npx]`.
- **No skip-CI tokens** in any commit message or PR body, not even to deny them (CLAUDE.md "CI gate integrity" section 1).
- **CHANGELOG entry on every ship**, same commit as the `VERSION` bump (byte-equal `VERSION` and `package.json`, 4-digit); never run `npm version`.
- **Tests must be able to fail:** each census and each tightened gate is shown RED by neutering (restore from a byte backup, never `git checkout`/`stash` on uncommitted work), then restored. Always `grep -a`.
- **A new `supabase/tests` file moves several censuses:** not relevant (no SQL in this phase).
- **No AI authorship trailers** in commits (memory: founder 2026-10-20), no home paths, PROD ids or account numbers in tracked text (public repo, `.planning/` tracked).
- **Ship branch must change nothing under `.planning`** (ship-planning guard); bookkeeping goes to main afterwards.
- **`plan-anchor-verify` CI job** re-resolves `file:line` anchors in pending PLAN.md files: cite by symbol in plans (section 13).
- Banned packages list: nothing here installs a package.

## Summary

Phase 201 is a wide, shallow change: roughly 250 copy sites, ~90 test files that pin old strings, one new registry, one new wrapper, one new census, one resolver change that crosses a query-layer redaction, one date helper, and five small behaviour fixes. The risk is not any single change; it is **file collisions between parallel plans** (the same ten files carry terms, retired words, dates and numerals at once) and **tests that pin the old strings**. Everything it needs already exists in the repo: the `Tooltip` primitive, `ContactPointerText`, `stripCommentsPreserveLines`, the `figure-gate-census` pending-map idiom, and `typescript` as a dev dependency.

Four findings change what the planner builds. (1) **D-09 is not a one-resolver change**: `displayStrategyName` is the front, but `src/lib/queries.ts` also nulls `strategy.name` for non-institutional rows at the query layer (`redactedName`, `queries.ts:6310`), so My allocation holdings never receive the name; the browse route keeps a `codename` field beside `name` that three search surfaces match on; and the factsheet page already inlines "name, then codename, then resolver" in three places. (2) **The FROZEN_ISLANDS premise in D-11 is stale**: the list has four entries and none formats a date (section 4.3). (3) **D-10's conditional sections**: Style (III) and Benchmark (IV) are conditional, and Terms is labelled "V" unconditionally, so numerals must be derived from what renders, in both the `detailed` and `all` arms of `MetricsColumn`. (4) **D-15's tearsheet half is already closed** by Phase 196 (the tearsheet mounts the factsheet print view, whose `pct()` is unsigned); only `CompareTable` still prints `+`, and `figure-parity-pages.test.tsx` has no `CompareTable` arm.

**Primary recommendation:** Build four small modules first (term registry plus `Term`, a date helper, the name-resolver change, and a copy-scan census whose pending map lists every current offender per file), then split the application work by **file ownership**, one plan per surface directory applying terms, words and dates together, then empty the pending map and run the RED proofs. Never split by topic: topic plans collide on `MetricsColumn`, `FactsheetView`, `ScenarioComposer`, `StrategyTable`, `KpiStrip`, `tearsheet/page.tsx` and `wizardErrors.ts`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Term definitions (registry) | Shared lib (`src/lib/glossary.ts`, pure data) | — | Imported by server and client components; no React, no runtime dependency (same shape as `src/lib/contact.ts`). |
| Term tooltip rendering | Browser / Client (`"use client"` `Term` over `Tooltip`) | — | Tooltip is hover/focus state in a portal; server components import the client wrapper. |
| Strategy display name | API / Backend (query layer + `/api/strategies/browse`) | Shared lib resolver | The null-redaction is applied in `queries.ts` before the payload reaches the client; the resolver is the last line. Both must move together. |
| Date formatting | Shared lib (`src/lib/utils.ts`) | Components | UTC fields only so server render and client first paint agree (hydration). |
| Retired-word and term census | Test tier (vitest, TS compiler API) | — | A static scan of `src/`; no runtime behaviour. |
| Escape closes All Filters | Browser / Client (`StrategyFilters.tsx`) | — | Pure client state. |
| Wizard egress hint | Browser / Client (`WizardIpAllowlistHint.tsx`) | Shared lib `contactHref` | Link target built by the one contact-href encoder. |
| Disclaimer text | Frontend Server (RSC page) | — | Static JSX text; whitespace bug is a JSX collapse rule. |
| Factsheet numerals | Browser / Client (`MetricsColumn`) | — | Derived from which section nodes render. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.3.1 | UI | Project stack. [VERIFIED: package.json `"react": "19.3.1"`] |
| Next.js | ^16.4.2 | Framework | Project stack. [VERIFIED: package.json] |
| `src/components/ui/Tooltip.tsx` | in-repo | The one tooltip primitive (portaled, `role="tooltip"`, hover + focus, 150 ms delay) | D-01 locks it; 3 consumers today. |
| vitest | ^5.0.3 | Test runner | [VERIFIED: package.json] |
| @testing-library/react | ^16.3.3 | Render tests | [VERIFIED: package.json] |
| typescript | ^6 (dev; 6.0.3 in the primary checkout's `node_modules`) | The compiler API for the census scanner | Already imported by two tests: `import ts from "typescript"` in `src/__tests__/self-referential-oracle.test.ts` and `src/lib/seam-log-coverage.test.ts`. No new dependency. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@/lib/source-scan` (`stripCommentsPreserveLines`, `extractComments`) | in-repo | Comment-blanking tokenizer, line-preserving | Use for the static scan's pre-pass if the plan prefers regex over AST; the AST route does not need it (comments are not nodes). |
| `ContactPointerText` + `contactHref` | in-repo (`src/components/contact/ContactPointerText.tsx`, `src/lib/contact.ts`) | The one renderer and href builder for "contact form" pointer sentences | D-13 hint rewrite. |
| `formatFixedSigned` / `pct` / `formatPercent` | in-repo | Number formatting with the display-sign rule | D-15: `formatPercent(v, 2, { signed: false })` (signature `formatPercent(value, decimals = 2, options?: { signed?: boolean })`). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `Term` over `Tooltip` | A glossary page | D-01 rules it out (no new page). |
| TS compiler API scan | Regex over comment-stripped source | Regex cannot tell JSX text from a JSX `className`/`data-testid` value or a log argument; the AST can. The repo precedent for regex is `figure-gate-census`; the precedent for AST is the two `typescript` importers. Recommend AST. |
| Date helper in `utils.ts` | `date-fns` / `Intl` per call site | The repo carries no date library; six hand-rolled `Oct 9, 2026` formatters already exist (section 4.1). One helper retires them. |

**Installation:** none. **Version verification:** not applicable (no new package). `typescript` is already in `devDependencies`.

## Package Legitimacy Audit

No external package is installed by this phase, so the audit table is empty by construction.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                       src/lib/glossary.ts  (pure data: key -> label, definition, match aliases)
                                 |
        +------------------------+-----------------------------+
        |                                                      |
  <Term k="omega"/>  (client; focusable span inside Tooltip)    copy-scan test (scripts/copy-census/scan.ts)
        |                                                      |
  surfaces (factsheet rail, KPI strips, tables, nav)            walks src/**/*.tsx|ts with ts.createSourceFile
        |                                                      |
        |                                       extracts: JsxText, whitelisted JSX attrs,
        |                                       string/template literals (prose-shaped, not log/query args)
        |                                                      |
        |                                   +------------------+-------------------+
        |                                   |                                      |
        |                          rule set A: retired words            rule set B: raw specialist-term
        |                          (portfolio, book, favorites,         label in a covered file that is
        |                           starred, preferences, My Allocation, not rendered through Term
        |                           My Strategies)                       (label position only)
        |                                   |                                      |
        |                                   +----------- PENDING map (file -> count) + EXCEPTIONS (file,literal,reason; count-pinned)
        |                                                      |
        +------------------ RED/GREEN verdict -----------------+

Strategy name:   strategies row --(queries.ts redactedName, :6310)--> RSC payload --> displayName()/displayStrategyName --> UI
                 strategies row --(browse route own-row branch + displayStrategyName)--> JSON --> client search (CompareAddStrategy, AddAllocationFlow, StrategyBrowseDrawer)
Dates:           ISO string --> formatDay()/formatMonth() (UTC fields) --> UI text      (chart axis ticks, exports, inputs, time stamps exempt)
```

### Recommended Project Structure
```
src/lib/glossary.ts                      # registry (new)
src/lib/glossary.test.ts                 # registry invariants (new)
src/components/ui/Term.tsx               # wrapper over Tooltip (new)
src/components/ui/Term.test.tsx          # (new)
scripts/copy-census/scan.ts              # AST scanner, no app imports (new; mirrors scripts/factsheet-census/)
scripts/copy-census/scan.test.ts         # planted red + green fixtures (new)
src/__tests__/copy-census.test.ts        # runs the scanner over src/, PENDING + EXCEPTIONS maps (new)
src/lib/utils.ts                         # + formatDay, formatMonth (edit)
```
Put the scanner under `scripts/` (vitest already collects `scripts/**/*.test.{ts,tsx}`, `vitest.config.ts` INCLUDE list) so `typescript` is never imported by anything the app bundles. [VERIFIED: vitest.config.ts INCLUDE contains `"scripts/**/*.test.{ts,tsx}"`]

### Pattern 1: Registry + `Term` wrapper (D-01, D-03)
**What:** `GLOSSARY` is a `const` object keyed by a closed `TermKey` union; each entry carries `label` (the text printed), `definition` (1-2 sentences, DESIGN Voice), and `aliases` (other label spellings that must also route through the registry, e.g. `"Max DD"`, `"Max DD 12m"`, `"Omega (θ=0)"`). `Term` renders `<Tooltip content={def}><span tabIndex={0} data-term={key} className="...dotted underline...">{children ?? label}</span></Tooltip>`.
**When to use:** any label-position occurrence (a table row label, KPI label, column header, section heading) of a registered term.
**Constraints found (all verified in `src/components/ui/Tooltip.tsx`):**
- The trigger wrapper only reacts to `onMouseEnter/Leave` and `onFocus/Blur` on the wrapper span; React `onFocus` bubbles, but a **non-focusable child never receives focus**, so a plain label gets hover only. `Term` must render its own focusable element (`tabIndex={0}`). The two existing consumers wrap a `<button>` (focusable already); `StrategyTable.tsx:1615` wraps the plain `{col.label}` of the non-sortable headers, so those headers are hover-only today. [VERIFIED: Tooltip.tsx lines 190-197 handler props; StrategyTable.tsx:1615 `<Tooltip content={col.tooltip}>{col.label}</Tooltip>`]
- `aria-describedby` is set on the inner wrapper `<span>`, not on the focusable element, and only while open. For a focusable `Term` child this is a weak association for screen readers. Recommend one optional, default-off prop on `Tooltip` (or have `Term` own its trigger) so the focusable element carries `aria-describedby`; existing `Tooltip.test.tsx` locates the wrapper by `.parentElement.parentElement`, so any change must keep that DOM depth when the prop is off. [VERIFIED: Tooltip.tsx lines 191-193; Tooltip.test.tsx `screen.getByText("info").parentElement!.parentElement!`]
- No touch path (no tap handler). A tapped `tabIndex={0}` element normally takes focus, which fires `onFocus`; this is browser behaviour. [ASSUMED: iOS Safari focuses a tapped tabindex span]. `src/components/charts/TouchTooltip.tsx` and `src/hooks/useTapPin.ts` are FROZEN and not a base for this.
- **The tearsheet print view and the PDF cannot show a tooltip** (hover/focus only). See Open Question 3.
- `content` is a `string`; the bubble is fixed `w-56` (224 px): keep a definition to one or two sentences.
- The 196 factsheet census reads label text through `readText`, which drops only `sr-only` and `aria-hidden` descendants, so wrapping a label in `Term` leaves its counted text unchanged **provided `Term` adds no visible text node** (no "(i)" glyph with text). [VERIFIED: scripts/factsheet-census/count.ts `readText`, lines 134-143]

### Pattern 2: Copy census with a pending map (D-08, D-03)
**What:** follow `src/__tests__/figure-gate-census.test.ts`: the scan runs over the real tree; each offending file sits in a `PENDING` map with its current hit count and the plan id that clears it; a `PENDING` entry whose file now has zero hits **fails** ("stale entry"), so each surface plan is forced to delete its own entries; the permanent `EXCEPTIONS` list is `(file, literal, reason)` rows, count-pinned. [VERIFIED: figure-gate-census header comments, `EXCLUDED` reason set and "every map key must name a file the walk finds" anti-vacuity rule]
**Why a pending map:** the census cannot be green at HEAD otherwise, and a census written last (after all renames) is never shown RED honestly.
**Scanner rules (prototype, heuristic):** visit `JsxText`; `StringLiteral`/`NoSubstitutionTemplateLiteral`/template parts that are not an import/export specifier, a literal type, a property name, an element-access key or a `case` label; JSX attributes only from a whitelist (`label`, `title`, `placeholder`, `aria-label`, `ariaLabel`, `alt`, `heading`, `body`, `helper`, `tooltip`, `description`, `caption`); skip any string that is an argument of `console.*`, `logger.*`, `Sentry.*`, `captureMessage`/`captureException`, or a Supabase query-builder call (`.from/.select/.rpc/.eq/.in/.order/.insert/.update/.delete/.channel`); keep only prose-shaped strings (contains whitespace, does not start with `[`) or capitalised single tokens; ignore `data-testid`, `className`, `id`, `htmlFor`, `href`, `key` attributes.
**Verbs and job titles:** at HEAD the verb "book a call" and "portfolio manager" do not occur in the scanned surface (all `book` hits are the noun, "options book" aside), so no verb exemption is needed today; the matcher should still match a whole-word list and keep an explicit `EXCEPTIONS` reason column for any future one. [heuristic: scanner over src, non-test files]

### Pattern 3: Derived section numerals (D-10)
Build the list of sections that actually render (`[{ key, name, node }]`, dropping a `null` node), then assign roman numerals by index. Do it once in a helper used by both the `detailed` and the `all` arms. See section 5.

### Anti-Patterns to Avoid
- **Splitting plans by topic** (terms / words / dates): collides on `MetricsColumn.tsx`, `FactsheetView.tsx`, `ScenarioComposer.tsx`, `StrategyTable.tsx`, `KpiStrip.tsx`, `tearsheet/page.tsx`, `wizardErrors.ts`.
- **Relabelling Terms to "IV" and Benchmark to "V" statically:** still wrong whenever Style (III) or Benchmark is absent.
- **Loosening the census regex to clear a hit:** D-08 forbids it; use `EXCEPTIONS` with a reason.
- **Adding visible text inside `Term`:** changes the 196 census label tally.
- **Editing the `PENDING` map by hand to make the test pass:** the stale-entry rule exists to prevent a silent skip.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tooltip bubble, positioning, delay | A new popover | `src/components/ui/Tooltip.tsx` | Portaled, viewport-clamped, flips below, z-[210] clears dialogs; 30+ lines of timer lifecycle already pinned by `Tooltip.test.tsx`. |
| "contact form" pointer sentence with a link | Inline `<a>` | `ContactPointerText` + `contactHref({ topic: "security" })` | The one renderer; tests pin the exact `contact form` phrase and the href encoder. |
| Comment-blanked source text | A new tokenizer | `@/lib/source-scan` | One shared tokenizer; 17 divergent copies were already consolidated onto it. |
| JSX-text vs attribute vs log-argument classification | Regex | `ts.createSourceFile` (already a dev dependency) | A regex cannot distinguish a `className` string from prose. |
| An `Oct 9, 2026` formatter | An eighth copy | One `formatDay` in `src/lib/utils.ts` | Six hand-rolled copies exist (section 4.1). |
| Esc-handling idiom | A new key handler | The `CustomizeDrawer.tsx` effect (document `keydown`, skip `defaultPrevented`, `preventDefault`, `onClose`) | Pinned by two tests; same nested-popover cooperation. |
| Sentence-final sign handling for percents | Manual `+` stripping | `formatPercent(v, 2, { signed: false })` | Display-sign rule (rounded zero prints unsigned) already centralised in `display-sign.ts`. |

**Key insight:** this phase is mostly re-pointing existing, tested mechanisms. The risky part is not building but *finding every call site*, which is why the census with a stale-entry rule is the central deliverable.

## 1. Term inventory (D-02, D-01, D-03)

### 1.1 Where specialist terms print (label position), with file:line at HEAD

Line numbers are for orientation; plans must cite symbols (section 13). "KPI" = a labelled strip cell; "row" = a metric table row label.

| Term (printed) | Surfaces (file, symbol/line) |
|---|---|
| **Omega (θ=0)**, **Tail Ratio (P95/\|P5\|)**, **Common-sense Ratio**, **Recovery Factor**, **Pain Index**, **Ulcer Index**, Avg Win / Avg Loss | `src/app/factsheet/[id]/v2/MetricsColumn.tsx:1402-1408`, `ExtendedMetricsPanel` (Advanced, Detailed metrics rail, section II). Only `Row label=` strings. |
| **Kolmogorov-Smirnov** | `src/app/factsheet/[id]/v2/BatchDPanels.tsx:106` — inside a *prose sentence* ("Two-sample Kolmogorov-Smirnov: D = …, p = …"), below the Style Drift table; the term is not a label. |
| Style Drift rows (Sharpe, Sortino, Ann. Volatility, Skew, Kurtosis, Max Drawdown, Win % (days)) | `BatchDPanels.tsx:57-64` (tuple array whose first member is also the React `key`). Sortino also at `:156` (`PercentileBar`) and `:238` (`DeltaRow`). |
| Sharpe / Sortino / Calmar | KPI strip `src/app/factsheet/[id]/v2/FactsheetView.tsx:2158-2160`; rail `MetricsColumn.tsx:622-624`; rolling rows `:1269-1270`; `AnalyticalPanels.tsx` Calmar by Year `:307-320`, Bootstrap CI `:451-463`; `src/components/strategy/CompareTable.tsx:47-49`; `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx:150`; `src/components/strategy/PercentileRankBadge.tsx:7-8`; `src/components/strategy/StrategyFilters.tsx:577` (Calmar filter); `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:1772,2209`; `src/app/scenario-share/[token]/page.tsx:444`. |
| CAGR | `FactsheetView.tsx:2157`; `MetricsColumn.tsx:620,1342`; `src/components/strategy/discovery-columns.ts` (`cagr`); `CompareTable.tsx:46`. |
| Max DD / Max Drawdown | `FactsheetView.tsx:2161`; `MetricsColumn.tsx:671`; `discovery-columns.ts` (`max_drawdown`, label "Max DD"); `CompareTable.tsx`; `KpiStrip.tsx:444` ("Max DD 12m"); `GlancePanel.tsx` ("Max DD 12m"); `ScenarioComposer.tsx:4987` (delta label "Max DD"). |
| **TWR** | `src/app/(dashboard)/allocations/components/GlancePanel.tsx:159` ("YTD TWR"); `KpiStrip.tsx:426` (label "YTD TWR", sub `"year-to-date time-weighted return"` at `:429`); `ScenarioComposer.tsx:4995` (delta label "TWR"); `src/components/landing/VerificationResults.tsx:58` (marketing metric card "TWR"). |
| **Avg \|ρ\|**, correlation, ρ | `KpiStrip.tsx:456` ("Avg \|ρ\|"); `MetricsColumn.tsx:806` ("Correlation"); `src/app/factsheet/[id]/v2/DistributionPanels.tsx:452` (prose "ρ near 0 implies…"); `OptimizerPanel.tsx:66-67` ("Corr w/ portfolio", has a tooltip already). |
| Skew / Kurtosis (excess) / VaR 95% / CVaR 95% / Profit Factor | `MetricsColumn.tsx:525-536` (opening-adjacent table), `:625-626`, `:656`, `:673-674`, `:1392-1399`. |
| Alpha (ann), Beta, R², Information Ratio, Treynor, Tracking Error, Up/Down Capture | `MetricsColumn.tsx:799-812` (`BenchmarkMetricsBody`); strip cells `FactsheetView.tsx:2193,2198` (`α vs ${cn}`, `IR vs ${cn}`). |
| **Bridge** | `src/components/layout/Sidebar.tsx:295` (mobile nav, to be relabelled "Scenario"); `BridgeWidget.tsx:134,153,195,259-262,286,325,336`; `BridgeDrawer.tsx:308` (`aria-label="Bridge review"`); `OutcomesWidget.tsx:145,883`; `src/components/portfolio/InsightStrip.tsx:164`; `MandateTabPanel.tsx:165`; `MandateQuickSetCard.tsx:145,180`; `ScenarioComposer.tsx:6647,6839`; `ScenarioCommitDrawer.tsx:902,990,1171`; `HoldingDetail.tsx:248`; `BridgeOutcomeBanner.tsx:65`; `src/lib/display-labels.ts:222`; `src/app/api/bridge/route.ts` error strings. |
| **mandate** | ~29 files (heuristic). Label-position: `AllocationDashboardV2.tsx:247,387` (h2 "Mandate"), `MandateTabPanel.tsx:50,95,171`, `BridgeWidget.tsx:214` ("Within mandate."), `StrategyBrowseDrawer.tsx:131-133` ("Strong/Partial/Weak mandate fit"), `src/components/auth/ProfileTabs.tsx:19` (tab "Mandate"), `src/components/mandate/MandateForm.tsx:312`, `MandateSaveStatus.tsx:66`, `RequestIntroButton.tsx:289`, `src/app/(dashboard)/recommendations/page.tsx:412-575`. |

Existing definitions to consolidate: the 11 discovery column tooltips in `discovery-columns.ts` (`DISCOVERY_COLUMNS`), the three `METRIC_TOOLTIPS` in `OptimizerPanel.tsx:57-73` (and the duplicate in `src/components/portfolio/PortfolioOptimizer.tsx:221-237`, which `OptimizerPanel` lazy-imports for its types only), `SimulateImpactButton.tsx:68-69` tooltip copy, `KpiStrip.tsx` `sub` captions. `Tooltip` has exactly three consumers: `StrategyTable.tsx`, `SimulateImpactButton.tsx`, and itself. [VERIFIED: grep of `ui/Tooltip` imports; `Tooltip.test.tsx` is the only direct test]

### 1.2 Registry shape (recommended)

```ts
// src/lib/glossary.ts  — pure data, no React, no "use client"
export const GLOSSARY = {
  omega: {
    label: "Omega",
    aliases: ["Omega (θ=0)"],
    definition: "Gains above a 0% daily return divided by losses below it. 1.00 means they balance.",
  },
  ulcer: { /* ... */ },
  // ...
} as const satisfies Record<string, GlossaryEntry>;
export type TermKey = keyof typeof GLOSSARY;
```
Add an optional `contexts?: Readonly<Record<string, string>>` so the 197 column tooltips (period- and basis-qualified, e.g. `Total return over the whole record. ${FULL_RECORD_BASIS}`) can move **byte-identically** into the registry as a context override; `StrategyTable.headers.test.tsx` and `StrategyGrid.test.tsx` pin those literal strings (`tip.textContent` equals the column tooltip), so changing a byte is a test failure, and the generic term definition must not replace the column-specific one. [VERIFIED: StrategyTable.headers.test.tsx:378-382 asserts `tip.textContent` toBe `tooltip`]
Definition wording is the planner's discretion; formulas the code already states can be reused (e.g. Tail Ratio is labelled "P95/|P5|", Omega "θ=0", `Kurtosis (excess)`).

### 1.3 `Term` placement notes
- Table row labels: `Row`/`RollingRow`/`BwRow` in `MetricsColumn.tsx` take `label: string`; add an optional `term?: TermKey` prop rather than changing every call site's label type.
- `KpiPanel` (`src/components/kpi/KpiPanel.tsx`) takes `label: string` and uses it for the cell key and aria text (`KpiStrip.tsx:531-549`); add an optional `term` to the cell type. `GlancePanel.tsx`'s local `Cell` takes `label: string`.
- Factsheet KPI strip labels are rendered under `data-testid="factsheet-kpi-label"` with a first-letter class for "α vs …" (`FactsheetView.tsx:2352-2363`); a wrapper must keep the text content "α vs BTC" and the `first-letter:normal-case` behaviour, which several `getByText("α vs ...")` locators depend on.
- Prose occurrences (K-S sentence, "Bridge flagged 3 holdings") take an inline `<Term>` around the word.
- `BatchDPanels.tsx` is the file named in TODOS `196-STYLE-DRIFT-CENSUS-BLIND-01`'s trigger ("the next edit to … `BatchDPanels.tsx`"): editing it for K-S and Style Drift rows trips that entry, so the plan that edits it should either close or restate the entry. [VERIFIED: TODOS.md `196-STYLE-DRIFT-CENSUS-BLIND-01` Trigger line]

### 1.4 Term-coverage test (D-03): feasible design
**Layer 1, static (the gate).** Same scanner, rule set B: in a closed list of *covered files*, a label-position string (JSX text whose trimmed value equals/starts with a registered label or alias, a whitelisted attribute value, or a `label:`/`title:` property value) that is not rendered through `Term`/a `term` prop is a hit. Prose sentences are *not* label position (the K-S line gets an inline `<Term>` by plan, not by gate). Hits are `PENDING` per file until the surface plan clears them.
**Layer 2, render smoke (the proof it renders).** A few render tests (factsheet `ExtendedMetricsPanel` rows, `KpiStrip`, `GlancePanel`, one `CompareTable` row) assert `[data-term="<key>"]` exists and that focusing it opens `role="tooltip"` with the registry definition. Reuse the fake-timer idiom from `Tooltip.test.tsx` (focus then `vi.advanceTimersByTime(150)`).
Why not render-only: a render test covers only the fixtures it mounts; a registered term in a rarely-mounted panel (Stress, Heatmaps) would escape it. Why not static-only: it cannot prove the wrapper actually opens.

## 2. Retired-word census (D-04 to D-08)

### 2.1 Heuristic counts (non-test `src/`, prose-shaped strings and JSX text; excludes comments, logs, query-builder args)
| Retired word / phrase | Hits | Files | Notes |
|---|---|---|---|
| portfolio(s) | 168 | 51 | JSX text 34, JSX attrs 23, strings 95, template parts 16 |
| book / books (noun) | 48 | 22 | includes `options book` ×2 (`src/app/factsheet/[id]/v2/basis-context.tsx:891,895`) |
| favorites / starred | 3 real | 3 | `WatchlistPanel.tsx:100`, `src/app/(dashboard)/discovery/[slug]/page.tsx:95`, `src/components/strategy/EmptyWatchlist.tsx:8` ("Star strategies …", verb). 3 more hits are Tailwind `--pin-star-left` class names (false positives of a loose `star` pattern). |
| preference(s) | 28 | 14 | includes SQL select lists and field names (`preferences_updated_at`, `liquidity_preference`) that are identifiers, not copy |
| "My Allocation" / "My Strategies" / "my strategies" | 22 | 15 | the five-character-class split below |
Total with the combined pattern: **262 hits, ~85 files** (heuristic). About 40 are internal prose strings in `src/lib` (e.g. `seam-retry-registry.ts`, `wizardErrors.ts` doc notes at `:5382-5533`, `route-contract-manifest.ts`, `resilient-fetch.ts`), ~18 are `src/app/api/**` error envelopes, ~200 are UI/copy. These are estimates from a throwaway scan, not an authoritative census.

### 2.2 "portfolio" and "book" by SENSE (D-04 only rules on the first)
D-04 retires the noun for an allocator's live set of holdings. At least five other senses exist in copy; each needs a ruling, not a blanket rename. Bucket sizes are estimates from reading the listing. [ASSUMED: bucket sizes]

| Sense | Examples (file) | Rough size | Needs |
|---|---|---|---|
| (a) The allocator's live holdings | "your portfolio" `OptimizerPanel.tsx:63-128,169`, `MandateQuickSetCard.tsx:180`, `PortfolioImpactPanel.tsx` (10), `PortfolioOptimizer.tsx` (8), `AllocationDashboardV2.tsx:257,427`, `KpiStrip.tsx:591` ("Portfolio KPIs"), `src/components/kpi/KpiPanel.tsx:70`, `SimulateImpactButton.tsx:68-81`, `ExchangesTabContent.tsx:35,48,57`, `DeleteAccountButton.tsx:78`, `src/lib/portfolio-insights.ts` (5), `src/lib/email.ts:688`; and "book": `GlancePanel.tsx:149,196` ("Book at a glance", "Book equity"), `AddAllocationFlow.tsx:97,508,582,831`, `KpiStrip.tsx:548-560`, `add-allocation.ts:34,40`, `dust.ts:48`, `book-figures.ts:38`, `degrade-warnings.ts:697,708,810,897,902` | ~90 | rename to "allocation" per D-04 |
| (b) A saved scenario draft | "Save portfolio", "Saved portfolios", "Name this portfolio", "Start a portfolio", "Scenario portfolio" in `ScenarioComposer.tsx:797-2397,5124-5455` and `SavedScenariosList.tsx` (15 hits), `ScenarioCompareTable.tsx:240` ("scenarios (or the live book)") | ~45 | **D-04 does not cover this sense.** "scenario" is the obvious name (the tab is "Scenario"; `ScenarioCompareTable` already says "scenarios"). Founder/planner ruling needed (Open Question 2). e2e pins "Start a portfolio" (`e2e/composer-axe.spec.ts:137`). |
| (c) Portfolio AUM (the size of a scenario) | `ScenarioComposer.tsx:821,823,855,1535,4862-4863,5524 ("PORTFOLIO AUM (USD)"),7532,7648-7652,7762,7827,7874` | ~12 | follows (b)'s ruling |
| (d) API error envelopes | `src/app/api/bridge/route.ts:138`, `portfolio-alerts/route.ts:53`, `simulator/route.ts:132,158,252`, `alerts/critical/route.ts:39`, `allocator/scenario/commit/route.ts:714` ("Portfolio changed since you started this scenario"), `admin/match/send-intro/route.ts:318,324` | ~18 | user-reachable (e.g. `ReplacementPanel` shows a route `error`); rename the text, not the route or field names |
| (e) Internal doc strings / identifiers in string form | `seam-retry-registry.ts` (10), `wizardErrors.ts` doc notes (14), `route-contract-manifest.ts` (4), `resilient-fetch.ts` (2), `seam-citations-needle.ts` (1), SQL select strings | ~40 | count-pinned `EXCEPTIONS` (not user-visible) or exclude the files by rule with a reason |
| (f) The retired product's own name | `src/app/portfolio-pdf/[id]/page.tsx` (5, "Portfolio report retired"), "Open My Allocation" link | 5 | planner decision: it names what the visitor's old link opened |
| (g) Not the allocator concept | "options book" (`basis-context.tsx:891,895`), "Diversified Crypto Book" demo name (`src/lib/factsheet/build-payload.ts:1252`, key `crypto_book`), `"Portfolio fit"` (`src/components/admin/CandidateDetail.tsx:152-167`, admin) | ~6 | reword or `EXCEPTIONS` with reason |

### 2.3 Preferences, favorites, My Strategies (D-05 to D-07)
- **preferences meaning mandate (rename):** `recommendations/page.tsx:475,483,543` ("Set preferences →"), admin `PreferencesPanel.tsx:159-485` (6), `AllocatorMatchQueue.tsx:545,586`, `MatchEvalDashboard.tsx:268`, `CandidateDetail.tsx:174` ("Preference fit"), `ModeBadge.tsx:17`.
- **preferences NOT meaning mandate (different concept, decide):** `src/components/strategy/CustomizeDrawer.tsx:296,298` ("Save preferences" saves discovery *view* settings, persisted via `useDiscoveryPrefs`); `RequestIntroButton.tsx:298,315,362` ("style preferences…", "— No preference —", a select option); API failures `"Failed to save preferences"` (`api/preferences/route.ts:79`, admin route `:86`) which save the mandate. The `/api/preferences` route and `allocator_preferences` table are identifiers (not renamed).
- **favorites/starred (rename):** the three files above. The star control's accessible name already reads "Add {name} to watchlist" / "Remove {name} from watchlist" (`src/components/strategy/StarToggle.tsx:136-138`), so the control half of D-05 is already met. [VERIFIED: StarToggle.tsx:136-138]
- **My Strategies (rename to "Strategies"):** `HoldingsTable.tsx:482,490`, `AddAllocationFlow.tsx:99`, `SubmitStep.tsx:56,874`, `CsvSubmitStep.tsx:142` ("Add to my strategies"), `src/lib/capital-ownership.ts:114-115`, `src/lib/wizardErrors.ts:2682,2759,3276,4292`. **My Allocation (rename to "My allocation"):** `src/app/portfolio-pdf/[id]/page.tsx:57`, `ExchangesTabContent.tsx:66`. Already correct: `Sidebar.tsx:119,293`, `AllocationsTabs.tsx:807`, `allocations/page.tsx:51`, `src/lib/factsheet/origin.ts:24`, `ViewerBar.tsx:55` ("Add to my allocation").
- Sentence-case tidy-ups seen but not census-enforced: `src/components/strategy/WatchlistTabs.tsx:69` ("My Watchlist"), `HoldingsTabPanel.tsx:871` ("Watchlist & Optimizer"). D-07 says sentence case; decide whether the census list includes exact-case `My Allocation` only (recommended) or a broader title-case rule.

### 2.4 Tests that pin retired strings
Heuristic count of test/spec files containing sample retired strings: saved-draft strings 8, book strings 20-44 (the wide count includes identifiers like `own-book`), "My Strategies" 15, "preferences" copy 6, favorites/starred 3, "My Portfolio"/"Open My Allocation" 3, "your portfolio"-style 19. Expect **60 to 90 test files** to change. Named pins that will break: `src/components/layout/MobileNav.test.tsx` ("Bridge" at lines ~58, 155, 192), `src/components/layout/Sidebar.test.tsx`, `src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx:598-599` ("Set the mark from My Strategies…", "Go to My Strategies →"), `AddAllocationFlow.test.tsx:295,410`, `AllocateDialog.test.tsx:539`, `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.test.tsx:1204`, `MandatePanels.scenario.test.tsx` ("Mandate", "no mandate metadata"), `src/app/portfolio-pdf/[id]/page.test.tsx:86` ("Open My Allocation"), `e2e/composer-axe.spec.ts:137`. Rule for the executor: for each renamed string, grep `src`, `e2e`, `tests` for the old literal in the same plan and update in that commit.

### 2.5 Existing census / registry models to copy
- `src/__tests__/figure-gate-census.test.ts` (pending/excluded map, closed reason set, anti-vacuity, planted self-test, `stripCommentsPreserveLines`).
- `src/__tests__/no-email-in-copy.test.ts` (walks exported copy-module values; source arm with a reasoned `SOURCE_ALLOWLIST` of `(file, literal, reason)`).
- `src/__tests__/public-truth-census.test.tsx` (scans public surfaces for a raw `Strategy #<hex>` id pattern; its `RAW_ID_*` patterns are relevant to D-09: after the change a raw-id fallback must still be caught).
- `src/app/factsheet/[id]/v2/FactsheetBody.census.test.tsx` + `scripts/factsheet-census/count.ts` (render-based counters; positive controls beside zero-arms).
- `src/lib/degrade-warnings.ts` registry and `src/lib/degrade-warnings.test.tsx` (count-pinned id lists such as `WHOLE_HISTORY_IDS`); `degrade-warnings.ts:697,708,810,897,902` carry "book" copy, and any word change there is a registered-copy change.
- No existing test scans for banned words in degrade warnings (`banned`/`retired` do not appear in `degrade-warnings.test.tsx`), so the census is the first.

## 3. Strategy name (D-09)

### 3.1 The resolver and where `name` is hidden today
`displayStrategyName` order today: codename, then `name` only when `disclosure_tier === "institutional"`, then `Strategy #<first 8 of id>`; a null input is `"Unnamed strategy"`. [VERIFIED: src/lib/strategy-display.ts] `DisclosureTier` is `"institutional" | "exploratory"`. [VERIFIED: src/lib/types.ts:154 `export type DisclosureTier = "institutional" | "exploratory";`] `publicNamePreview` returns `{ factsheet: name ?? codename ?? displayStrategyName, discovery: displayStrategyName }`. [VERIFIED: strategy-display.ts]

**The factsheet already uses the D-09 chain, inlined three times:** `src/app/factsheet/[id]/v2/page.tsx` `generateMetadata` (`publicNamePreview(...).factsheet`, ~`:342`), the pending-state `pendingName` (`signature.name ?? signature.codename ?? displayStrategyName(...)`, ~`:750`), and `src/lib/factsheet/fetch-and-build-payload.ts` `factsheetName` (~`:1008`). The OG route does its own `data?.name ?? data?.codename ?? "Strategy"` (`src/app/api/og/factsheet/[id]/route.tsx:174`). Changing `displayStrategyName` to `name (trimmed, non-empty) -> codename -> Strategy #id` makes all four collapse to one rule; keep the three inline chains until their plan replaces them, or the resolver change plus a dedup in the same plan.

**Surfaces that call `displayStrategyName` (every one changes behaviour when the resolver changes):** `src/app/api/strategies/browse/route.ts` (~`:271`), `src/app/factsheet/[id]/tearsheet/page.tsx` (`:41` `<title>`, `:183` `displayName` used for the H1 at `:205`, the pending H1, `ManagerIdentityPanel strategyCodename` at `:291`, and "Interested in {displayName}?" at `:300`), `src/components/strategy/StrategyHeader.tsx:40`, `src/lib/allocation-helpers.ts` (`displayName`), `src/app/(dashboard)/allocations/lib/holdings-adapter.ts:219`, `strategies-row-adapter.ts:230,273`, `src/lib/queries.ts` (`:5367` outcome embeds, `:5636` flagged-candidate names), admin: `AllocatorMatchQueue.tsx:662,752,829`, `SendIntroPanel.tsx:155`, `CandidateDetail.tsx:52`, `ShortlistCard.tsx:44`, `AdminTabs.tsx:257`, `PendingIntros.tsx:152`, plus `src/app/(dashboard)/strategies/[id]/edit/page.tsx:174` (`publicNamePreview`).

### 3.2 Surfaces that rely on `disclosure_tier` to hide the NAME (the list D-09 asks for)
1. **`src/lib/queries.ts` ~`:6303-6310` `redactedName`:** `strategy.disclosure_tier === "institutional" ? strategy.name : null`, with the type doc at `:2543-2551` ("redacted to `null` server-side when `disclosure_tier !== 'institutional'`"). My allocation's `strategies[].strategy.name` is therefore `null` for exploratory strategies and the client falls to the codename. **A resolver change alone does not show the real name here**; this query-layer redaction must be removed or kept in lockstep. (`organization_name`, ~`:6329-6330`, is manager identity and stays redacted.) [VERIFIED: queries.ts:6299-6330 read this session]
2. **`/api/strategies/browse`:** `name` is `r.name` only for the caller's OWN rows, else `displayStrategyName` (codename or `Strategy #…`). The route also still emits `codename`, and the three consumers match search on `name` OR `codename` client-side: `CompareAddStrategy.tsx` (`:130-133`), `AddAllocationFlow.tsx` (`:346`, placeholder "Search by name or codename" at `:603`), `StrategyBrowseDrawer.tsx` (`:348-349`, placeholder at `:518`, renders the codename line at `:690`). Ordering is by `name` server-side with `LIMIT 200 + 1`; search is **client-side over that capped set**, so a typed name finds a row only if it is inside the first 200 alphabetically. [VERIFIED: browse/route.ts read this session]
3. `getFlaggedHoldings`-style candidate names and outcome embeds (`queries.ts:5340-5375,5585-5645`): they pass raw `name` into `displayStrategyName`; fixed by the resolver alone.
4. Admin match surfaces (list above): same.
5. `src/app/api/strategies/[id]/name/route.ts` documents that "public surfaces render the codename per the disclosure rules in browse/route.ts and displayStrategyName regardless of what `name` holds" (`:94-100`) and that rename "is not read, not written, and not widened". After D-09 that comment is false; the owner-set free-text name is now what everyone sees. Phase 200's public-name preview in `StrategyNameBlock.tsx` states "Discovery shows other signed-in viewers {preview.discovery}" (`:50-52`); with one resolver both legs are equal, but the sentence stays true. Admin review before publish (`guard_strategies_publish_transition`, per that comment) is the residual control. [VERIFIED: name/route.ts:85-110 read]
6. **Tearsheet manager card:** `ManagerIdentityPanel strategyCodename={displayName}` (`tearsheet/page.tsx:291`); `ManagerIdentityPanel.tsx:60` prints it as the exploratory-lane header and `:75` falls back `manager.display_name ?? manager.company ?? strategyCodename`. With a real name the fallback would print the **strategy** name as the manager's display name. Rename the prop and decide what the exploratory-lane card prints (manager identity must stay pseudonymous; D-09 says only the strategy name changes). The identity gate (`isAttested`, `effectiveManager`, C-0189) is untouched.
7. `getFactsheetDetail`/`ManagerIdentityPanel` identity loading stays `institutional`-gated (`queries.ts:137`); not a name matter.

### 3.3 Decision for the planner: what the browse route emits
D-09 says the manager's identity stays pseudonymous, not the codename. Emitting `name` (real) beside `codename` links a real name to its codename; the route comment (C-0112) names exactly that as the reason for the old rule, and the TODOS reading says the name is already public on anonymous `/browse`. The three consumers need `codename` only for search and one display line. Recommend: keep `codename` on the wire only if the founder wants it searchable and shown (the placeholders say so); otherwise drop it and the `codename` match. Flag as Open Question 1.

### 3.4 Tests that pin the pseudonym today (all need updating)
`src/lib/strategy-display.test.ts` (8 cases: codename wins, exploratory placeholder, institutional name, null inputs, `publicNamePreview` block), `src/app/api/strategies/browse/route.test.ts` (T12a "codename present → response name === codename", T12b "`Strategy #44444444`", T12c institutional, plus the ordering tests that avoid `Strategy #` labels), `src/app/(dashboard)/strategies/[id]/edit/page.test.tsx:539-556` (`discovery: "Strategy #13f7b07f"`), `holdings-adapter.test.ts:359-377` (`"Strategy #abc12345"`), `strategies-row-adapter.test.ts:521-536`, `src/components/admin/AdminTabs.test.tsx:140-162` (`Strategy #explor01`), `src/lib/queries.my-allocation.test.ts:965` and `queries.match-batches-rls.regression-1.test.ts:123,169` and `src/__tests__/outcomes-join-rls.test.ts:142` (comments/expectations about the synthetic label), `src/components/strategy/StrategyHeader.test.tsx`, `StrategyNameBlock.test.tsx`, `RenameStrategyDialog.test.tsx`, `CompareAddStrategy.test.tsx` (matches codename, `:60`). `public-truth-census.test.tsx` keeps a `RAW_ID_PATTERN` guard for a raw `Strategy #<hex>` shown instead of a name; it stays meaningful. [VERIFIED by grep of test files for `Strategy #`/`displayStrategyName`]
**Required new test (TODOS close condition):** feed the route's actual handler output (mocked supabase as in `route.test.ts`) for an exploratory-tier, non-own row that has a codename into the `CompareAddStrategy` filter and assert that typing the real name returns the row; it must go RED if the pseudonym returns (neuter `r.name` back to `displayStrategyName` and see RED).

## 4. Dates (D-11)

### 4.1 Census (call sites in user-visible code, heuristic; machine-facing noted)
**Already `Oct 9, 2026` (6 named helpers + 2 inline):** `isoToMonthDay` (`src/app/factsheet/[id]/v2/MetricsColumn.tsx:1121-1126`, pinned format `${MONTHS[...]} ${getUTCDate()}, ${getUTCFullYear()}`), `formatIsoDate` (`src/app/factsheet/[id]/trade-fetch-lines.tsx:30`), `formatCloseDay` (`src/lib/factsheet/returns-unit.ts:102`, optional `{ year: false }`), `formatSpanDate` (`src/components/strategy/CompareEquityOverlay.tsx:62`, a deliberate copy of `isoToMonthDay` to avoid importing the rail), `formatCalendarDate` (`src/app/(dashboard)/allocations/lib/add-allocation.ts:193`), `formatDate` (`widgets/outcomes/OutcomesWidget.tsx:79`), plus inline `toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"})` in `StrategyBrowseDrawer.tsx:737` and `BridgeWidget.tsx:93` (>1 year branch). Each carries its own `MONTHS` array (also `BatchDPanels.tsx:361`, `returns-unit.ts:82`).
**Month granularity `Oct 2026`:** `monthYear` (`BatchDPanels.tsx:363`), `formatIsoMonth` (`ScenarioComposer.tsx:538`, own `MONTH_ABBR`), `monthRowLabel` (`MetricsColumn.tsx:1053`, "Last month (Oct 2026)").
**Yearless `Oct 9`:** `formatAbsoluteDate` (`src/lib/utils.ts:130`; callers `FreshnessBadge.tsx:58`, `ForQuantsLeadsTable.tsx:176`, `src/lib/factsheet/joint.ts:44`, and `formatRelativeTime`'s >30-day branch `utils.ts:126`). Pinned by `src/lib/utils.test.ts:275-281` (`"Apr 11"`, `"Jan 1"`).
**`YYYY-MM-DD`:** `formatIsoDay` (`utils.ts:150`; callers `StrategyTable.tsx:1647` track tooltip, `:2057` Created cell, `StaleSeriesChip.tsx:77` "Data from …"), `ymd` (`MetricsColumn.tsx:1525`, worst-drawdown table dates), `StressWindowsPanel.tsx:134` (`w.start.slice(0, 10)`), `WatchlistPanel.tsx:246` (`row.created_at.slice(0, 10)`), `UserRolesPanel.tsx:37` (`formatGrantDate`, admin), `strategy-health.ts:107` (`staleSince`, check whether it reaches copy). Pinned by `utils.test.ts:285-299`, `src/app/(dashboard)/strategies/page.table.test.tsx`, `src/components/strategy/StrategyTable.manager-rows.test.tsx`.
**Locale/zone-dependent `toLocaleDateString()` with NO options (hydration risk, ~14 sites):** `strategies/page.tsx:1417-1418`, `OrganizationTab.tsx:170`, `PreferencesPanel.tsx:467`, `AdminTabs.tsx:266`, `DeckCard.tsx:25`, `AllocatorMatchQueue.tsx:818,825`, `MatchEvalDashboard.tsx:299`, `FactsheetPreview.tsx:68`, `PendingIntros.tsx:166`, `ApiKeyManager.tsx:1540`, `SyncProgress.tsx:702`. `SavedScenariosList.tsx:96` uses `toLocaleDateString(undefined, {year, month: "short", day})`. These print in the viewer's locale, so "three formats" is understated.
**Not date formats under D-11 (state as exempt categories, each with a reason):** time-of-day stamps (`WizardChrome.tsx:215` "Draft saved · 09:41", `admin/csv-status/page.tsx:122` `toLocaleString` with a time) fit neither D-11 format; chart axis ticks and chart tooltips (`EquityChart.tsx:1169,1184,1958`, `TimeSeriesChart`, `NetExposureChart.tsx:186`, `AllocationOverTime.tsx:227` print ISO in a tooltip); `CustomRangePicker.tsx:666` month heading; machine values (CSV/export names `AuditLogSubsection.tsx:49`, `<input type="date">`, cron subjects, `usage-metrics.ts`); relative ages (`formatRelativeTime`, `BridgeWidget.formatRelativeDate`).
Email and PDF paths (`src/lib/email.ts`) are user-visible but outside React; include them in the scan scope decision (Open Question 5).

### 4.2 Helper
Add to `src/lib/utils.ts`: `formatDay(iso)` -> `Oct 9, 2026`, `formatMonth(iso)` -> `Oct 2026`, both UTC fields, `"—"` for empty/unparseable (the existing `formatIsoDay` contract). Reuse one shared `MONTHS` array. The consolidation order is: helper plus `utils.test.ts` (Wave 1), then each surface plan swaps its own formatters. `formatAbsoluteDate` and `formatIsoDay` should be deleted or turned into thin deprecated aliases in the last wave so a stale caller fails loud (knip is in devDependencies and will flag an unused export).
A "RED on a non-helper date format" test: scan rule set C over the same AST: flag a `toLocaleDateString`/`toLocaleString`/`Intl.DateTimeFormat`/`getUTCMonth` use or a `MONTHS`-like month-name array outside `src/lib/utils.ts` and a count-pinned exemption list (charts, time stamps, machine values, emails).

### 4.3 FROZEN_ISLANDS: the premise is stale
The list at HEAD, verbatim (the array literal after its comments):
```
const FROZEN_ISLANDS: string[] = [
  "src/hooks/useBreakpoint.ts",
  "src/app/(dashboard)/allocations/lib/montecarlo.worker.ts",
  "src/components/charts/TouchTooltip.tsx",
  "src/hooks/useTapPin.ts",
];
```
[VERIFIED: src/__tests__/phase-52-frozen-spine-guards.test.ts:222-239 and 258; read this session] The same file's comments record that `EquityChart.tsx`, `TimeSeriesChart.tsx`, `HistogramChart.tsx`, `MasterBrush.tsx` and `factsheet-context.tsx` were each removed from the frozen set by reviewed edits. None of the four remaining entries formats a date, so **D-11 has nothing to exempt under the git-diff-zero guard**. The `eslint.config.mjs` comment near `:293-304` still says the three factsheet SVGs and `EquityChart` "are in the FROZEN_ISLANDS git-diff-zero list"; that comment is stale (the `no-raw-font-px` `off`-glob it justifies still exists). Chart axis ticks are exempt instead as the category "axis tick labels", and the chart files carry their own pin tests (`TimeSeriesChart.markers.test.tsx`, `TimeSeriesChart.ticks.test.tsx`, `edge-tick-labels.test.tsx`, `heatmap-month-labels.test.tsx`). Phase 31/32 guards read `ScenarioComposer.tsx` and `Sidebar.tsx` source but only for `href="/scenarios"` absence and the `CollapsibleSection` wrap, so renames there do not touch them. [VERIFIED: phase-32 guard lines 254-275 assert `/scenarios` absence only]

### 4.4 Hydration constraints
`formatRelativeTime`'s doc says both branches use `en-US` and UTC "so SSR and client-first-paint produce identical strings"; `formatIsoDay`'s doc explains why not `toLocaleDateString` or `iso.slice(0, 10)`. The new helper must use UTC fields only (no locale, no `Date.now()`). The ~14 no-option `toLocaleDateString()` sites are server-rendered pages or client components with the same risk today; moving them to the helper fixes that class. [VERIFIED: utils.ts:110-160]

## 5. Factsheet numbering (D-10)
`MetricsColumn.tsx` writes each numeral as a literal `label` on `EditorialSection`, rendered as `§{label}` in a mono span (`EditorialSection` at ~`:726-748`). Render order and literals:
- `part === "detailed"` (~`:544-580`): I Performance, II Risk, III Style (only `hasStyleDrift || scenarioMode`), V Terms, then `benchmarkSection("document")` = IV (only when there is a BTC-unit reason line, a joint, or a paired-floor withhold; else `null`).
- `part === "all"` (default, ~`:586-722`): I Performance, II Risk, III Style (conditional), V Terms, `benchmarkSection("full")` = IV (conditional).
- `part === "main"`: no numerals (Panel + `GroupHeading`).
So a strategy without style drift renders I, II, V, IV; with it, I, II, III, V, IV; with no benchmark, I, II, V. Numerals must derive from the rendered list in both arms. Section names (`Performance`, `Risk`, `Style`, `Terms`, `Benchmark — vs {bn}`) are pinned by tests that read the `h2` text, not the numeral: `usd-view-withholdings.test.tsx:139,160`, `FactsheetView.returns-unit-comparisons.test.tsx:140,165` (via `sectionIV`, which finds the `h2` that starts with "Benchmark"), `FactsheetBody.joint-floor.test.tsx:119`, `FactsheetBody.flat-leg.test.tsx:105,142`. The only test that reads a numeral is `MetricsColumn.window.test.tsx:235` (`span` with text `"§I"`, "the rail eyebrow … before §I"); no test reads "§IV" or "§V" as a span text, so a derived numeral does not break them. Add a new test pinning the sequence: render detailed/all with and without Style and with and without a comparator and assert the numeral spans read I..N in DOM order. [VERIFIED by reading MetricsColumn.tsx and grepping tests]
Also note section `Terms` hosts `ConstituentMandatePanel` (heading "Mandate", D-06 rename) in `scenarioMode`.
`scripts/factsheet-census/count.ts` counts a section as a `<section>` whose own header holds an `<h2>`; numerals are in a sibling `span`, so renumbering does not change the census.

## 6. Escape (D-12)
`StrategyFilters.tsx`: state `filtersOpen`/`draft` (`useState`), `openFilters` copies `advancedFilters` into `draft` and opens; the panel is a plain `fixed inset-0 z-50` div (no `role="dialog"`, no `aria-modal`, no focus move, no body scroll lock), closed by the backdrop `onClick` and the Close button only; `applyFilters` and `clearAll` also close. The "All Filters" control is the shared `Button` (no `forwardRef`; no ref available), so "focus returns to the All Filters button" needs the `CustomizeDrawer` idiom of capturing `document.activeElement` on open and restoring it on close. [VERIFIED: StrategyFilters.tsx:297-313,331-340,435-460 read; Button.tsx has no `forwardRef`/`ref` match]
The reusable idiom (`CustomizeDrawer.tsx:59-64`): a `document` `keydown` listener registered while open; return if `e.key !== "Escape"` or `e.defaultPrevented`; `e.preventDefault()`; `onClose()`. Initial focus + restore-on-close at `:80-92`. Closing via Escape must discard the draft (it already is discarded by `openFilters` re-seeding from `advancedFilters`).
Tests: `CustomizeDrawer.test.tsx:70-95` (ESC calls `onClose`; a pre-handled Escape does not). There is **no `StrategyFilters` test file**; the only test mentioning "All Filters" is `src/components/strategy/StrategyTable.test.tsx`, so add `StrategyFilters.test.tsx` modelled on those two arms plus a focus-return arm. This file is also where Term wrapping of filter labels (Calmar etc.) lands: one plan owns `StrategyFilters.tsx`.

## 7. Egress link (D-13)
`WizardIpAllowlistHint.tsx` renders a `WarningBanner` with `role="note"` and the sentence "Locking your exchange key to an IP allowlist? Allow our egress IPs — see {link}." where the link is `<a href="/security#egress-ips">/security#egress-ips</a>`. `WizardIpAllowlistHint.test.tsx:25-33` pins the regex and `getByRole("link", { name: "/security#egress-ips" })` with `href` `/security#egress-ips` — both must be rewritten. `SECURITY_CONTACT_HREF` is a **module-private** `const` in `src/app/(marketing)/security/page.tsx:44` (`contactHref({ topic: "security" })`); the hint must import `contactHref` from `@/lib/contact` and build the same href (do not export from a page file). The `/security#egress-ips` section text ("Use the contact form for the current IP set — we rotate infrequently…") is pinned by `security/page.test.tsx:72-90` and is unchanged by D-13. [VERIFIED: files read this session]
**Scope flag (report, do not expand):** `src/lib/wizardErrors.ts` carries two more `docsHref: "/security#egress-ips"` links (`:1776`, `:2259`) on error entries whose `fix` text says "add our egress IPs — see the docs link below". They lead to a section that tells the reader to use the contact form, so they are not broken, but they are the same "link leads to the IPs" claim. Recommend leaving them and recording that decision (Open Question 6). Use `ContactPointerText` for the new sentence if the exact phrase `contact form` appears in it.

## 8. Disclaimer (D-14)
`src/app/(marketing)/legal/disclaimer/page.tsx:59-62` (custody paragraph): `…{PLATFORM_NAME} does <strong>not</strong>` ends a line and `operate a fund, act as…` starts the next, so JSX drops the whitespace (a text line that begins after a newline is trimmed) and the page reads "notoperate". Fix with `{" "}` after the closing tag, and a rendered-text test asserting `does not operate`.
Scan across `src/**/*.tsx` (AST: a `JsxText` whose leading whitespace contains a newline, whose previous sibling is an inline element or `{expr}` and whose trimmed text starts with a letter or digit, and the mirror case): the only **true** inter-word join bug found is `disclaimer/page.tsx:61` after `</strong>`. Inspect these remaining flagged joins (each is likely an icon/dot span plus text, or already compensated, but unverified): `BridgeWidget.tsx:219,232`, `ScenarioComposer.tsx:6190`, `OutcomesWidget.tsx:483`, `FactsheetView.tsx:1819`, `MatchQueueIndex.tsx:415`, `MandateSaveStatus.tsx:66`, `NoteSaveStatus.tsx:73`, `PortfolioImpactPanel.tsx:789,797`, `RequestIntroButton.tsx:289`; `src/app/factsheet/[id]/not-found.tsx:21-23` joins "recent" to a `<code className="mx-1">` and compensates with margin (intentional). `src/components/ui/Disclaimer.tsx` builds its text as template strings in one `<p>{text}</p>`, so it cannot have this bug. `Disclaimer` call sites in `src`: `footer` at `src/app/browse/page.tsx:84`, `src/app/browse/[slug]/page.tsx:98`, `DashboardChrome.tsx:181` and `:257`; `strategy` (trust tier `api_verified`) at `src/components/landing/VerificationResults.tsx:128`. [VERIFIED: grep of `<Disclaimer` call sites]

## 9. Volatility sign (D-15)
- **Tearsheet:** the page formats no volatility itself; it mounts `FactsheetView ... printView`, whose strip cell `Ann. Vol` is `pct(gv(m.ann_vol), 1)` (`FactsheetView.tsx:2162`), and `pct` is `formatFixedSigned(v, { dp, scale: 100, suffix: "%" })` with `plus` defaulting to `false` (`src/app/factsheet/[id]/v2/format.ts:54-56`; `display-sign.ts:68-76`), i.e. **unsigned**. `PeerRanksSection` formats no volatility. The rail row `Ann. Volatility` (`MetricsColumn.tsx:621`) is `pct(...)`, also unsigned. So the tearsheet half of `[197-VOL-SIGN-TEARSHEET-COMPARE]` was closed by Phase 196's print-view change (the TODOS entry predates it, booked 2026-11-08). [VERIFIED: format.ts, display-sign.ts, FactsheetView.tsx:2162, MetricsColumn.tsx:621]
- **CompareTable:** `METRICS` has `{ label: "Volatility", key: "volatility", format: "percent", ... }` and `formatValue` uses `formatPercent(value)` whose `signed` option defaults to `true` (`utils.ts:4-17`), so it prints `+23.46%`. Fix: add a `percentUnsigned` format (or a per-row `signed:false`) that calls `formatPercent(value, 2, { signed: false })`. [VERIFIED: CompareTable.tsx:36-55,69-74; utils.ts:4-17]
- **Parity test:** `src/__tests__/figure-parity-pages.test.tsx` already compares the `StrategyTable` Volatility cell as exact text, unsigned (`:616-617`, `expect(tableCell("Volatility"), "Volatility").toBe(formatPercent(stored.volatility, 2, { signed: false }))`); its factsheet and tearsheet arms compare **numbers** (`disagreements([...["Volatility", m.ann_vol, stored.volatility]...])`, `:585,632`), and there is **no `CompareTable` arm**. So "compares volatility as exact text again" means: add a `CompareTable` arm (render it with the fixture's stored row and assert the Volatility cell equals `formatPercent(stored.volatility, 2, { signed: false })`), and, if the founder wants it, a printed-text arm for the tearsheet `Ann. Vol` cell. `CompareTable.test.tsx` already references Volatility in its figure-gate arms (`:63,204,236`); any exact `+` text there must be updated. Update the TODOS entry on close.

## 10. Custody variant (D-16)
`Disclaimer` variants: `footer`, `strategy`, `factsheet`, `custody`, `strategy-page`. `src` call sites (enumerated in section 8): five, using `footer` (four) and `strategy` (one, `api_verified`). **No `src` call site renders `custody`, `strategy-page` or `factsheet`**; they are exercised only by `Disclaimer.test.tsx` (the `custody` case pins `Strategy monitored via read-only exchange API. Manager retains asset custody. {ANALYTICS_ONLY_TEXT}`, `:156-162`). By D-16's rule: record this and change the `custody` variant nothing. [VERIFIED: grep of `<Disclaimer` and `variant=` in src; Disclaimer.tsx read]
**Adjacent finding (report; planner/founder decide):** the tearsheet's Risk Disclosure hand-writes the same claim for every tier: `src/app/factsheet/[id]/tearsheet/page.tsx` ~`:321-322` "Strategies are monitored via read-only exchange APIs; managers retain asset custody. {ANALYTICS_ONLY_TEXT}". The page already computes `trustTier` (`:225-230`, from `verificationSignals.get(id)?.trust_tier`). That is the live instance of UC-10 (the `strategy-page` variant is already tier-aware and unused). Recommend applying the `strategy-page` rule there (`trustTier === "api_verified"` keeps the monitoring clause, other tiers say only "managers retain asset custody."). D-16's literal text is satisfied by "no caller", so this is an Open Question, not a locked task.

## 11. Navigation (CLAR-04, D-07)
- Desktop `Sidebar.tsx`: allocator workspace "My allocation" (`:119`), "Recommendations", "Compare", "Strategies" (`:151,187`), "Add a strategy" (`:164`); admin items; "Profile" (`:233`). Nothing to rename on desktop.
- `buildPrimaryMobileNav`: `{ label: "My allocation" … }`, `{ label: "Risk", href: "/allocations?tab=risk" }`, `{ label: "Bridge", href: "/allocations?tab=scenario" }` (`:293-295`), then "Add a strategy", "Discovery", manager "Strategies". Rename only the third to "Scenario" (D-07). Pins: `MobileNav.test.tsx` (`labels` contains `"Bridge"` ~`:58`, exact list ~`:155`, `getByText("Bridge")` ~`:192`, header comment `:18-21`). `Sidebar.test.tsx` references "My allocation" only. [VERIFIED: Sidebar.tsx:293-295 read via grep+sed]
- **Back-link label map:** `src/lib/factsheet/origin.ts` `FACTSHEET_ORIGINS` = `discovery: "Back to Discovery"`, `browse: "Back to Browse"`, `allocations: "Back to My allocation"`, `strategies: "Back to Strategies"`, `recommendations: "Back to Recommendations"`, `admin: "Back to Admin"`; `LEGACY_ORIGIN_KEYS` maps `"my-strategies"` to `strategies`. It already matches D-07; no label there needs to change. Pinned by `HoldingsTable.strategy-rows.test.tsx:249-262` ("Back to My allocation"). [VERIFIED: origin.ts:19-27,40-42]
- Other "My Strategies"/"My Allocation" copy is in section 2.3. `e2e` anchors on `h1:has-text("My allocation")` (lower-case a) and is unaffected.
- Breadcrumb at `recommendations/page.tsx:417` already reads "My allocation".

## Runtime State Inventory

This is a copy rename (D-04 to D-07, D-09), so the five categories are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Allocator-named saved scenarios live in a table whose `name` is user data (SavedScenariosList names, "My Portfolio" fallback written at `AllocationDashboardV2.tsx:190` and `src/lib/factsheet/allocator-portfolio-payload.ts:111`). Strategy `name` is read, never written, by D-09. No stored string holds a *label* we rename (labels are code). [ASSUMED: no table stores UI label text; not queried, PROD reads are MCP-only] | Code edit only. The `"My Portfolio"` fallbacks are code and are renamed with the copy; rows already holding a user-typed portfolio name are user data and not migrated. |
| Live service config | Tearsheet PDF route sets `max-age=300` (and `s-maxage 3600 + stale-while-revalidate 86400` was the prior value) with a "disclosure-tier downgrade flush" note (`src/app/api/factsheet/[id]/tearsheet.pdf/route.ts` ~`:270-285`); CDN-cached PDFs and `/api/og/factsheet/[id]` cards can carry the OLD strategy name or old terms until they expire. [ASSUMED: expiry window; the OG route's cache headers were not read] | None to ship; note the lag in the ship report. |
| OS-registered state | None. No scheduled task, launchd or pm2 entry carries these strings. [ASSUMED: not inspected] | None. |
| Secrets / env vars | None reference these words. | None. |
| Build artifacts | None carry the old strings. | None. |
**Outside `src/` (not covered by the census, state explicitly):** server-generated user-visible text in the analytics service ("Portfolio drawdown has reached …", "… is trailing the portfolio …", "of the portfolio (equal-weight baseline …") in `analytics-service/routers/portfolio.py` (~`:1420,1495,1513`), email templates in `src/lib/email.ts` (inside `src/`, so scanned: 2 hits), and DB-stored alert messages written by that service. Rewording the Python messages is a separate analytics-service change (mypy strict and pytest from `analytics-service/` belong in its brief); decide whether it is in scope (Open Question 5).

## Common Pitfalls

### Pitfall 1: Resolver changed, query layer not
**What goes wrong:** `displayStrategyName` is flipped, but My allocation still shows the codename, because `queries.ts` hands the client `name: null` for non-institutional rows.
**Why it happens:** the redaction is applied twice (query layer and resolver), and only the second is named "the resolver".
**How to avoid:** change `queries.ts` `redactedName` (and its type doc) in the same plan; assert on the RSC payload (`queries.my-allocation.test.ts`), not only the rendered label.
**Warning signs:** an exploratory holding still prints a codename on `/allocations` after the change.

### Pitfall 2: Term wrapper breaks the 196 census or the "α vs" locators
**What goes wrong:** a visible `(i)` text node, or a re-parented label, changes `readText` and the label tally (`FactsheetBody.census.test.tsx`), or breaks `getByText("α vs BTC")`.
**How to avoid:** `Term` adds no visible text, keeps the label text node as the direct text of the trigger, keeps `data-testid="factsheet-kpi-label"` on the original element, and run `FactsheetBody.census.test.tsx`, `FactsheetView.joint-floor`/`basis` tests after each factsheet edit.

### Pitfall 3: Tests that assert retired strings
~60-90 test files and `e2e/composer-axe.spec.ts:137` pin old copy (section 2.4). A rename without the same-commit test update leaves red CI.
**How to avoid:** the plan's task list names each pinned file; the verifier greps the old literal across `src`, `e2e`, `tests`.

### Pitfall 4: Renumbering "static" instead of derived
Relabelling Terms IV and Benchmark V still prints I, II, IV for a strategy with no style drift. Derive from the render list (section 5).

### Pitfall 5: Hydration mismatch from date formatting
`toLocaleDateString()` without options or `Date.now()` in render differs between server and client. The helper uses UTC fields only (section 4.4).

### Pitfall 6: Tooltips with no keyboard or touch path
A plain label wrapped in `Tooltip` is hover-only (Tooltip's wrapper handlers need a focusable child). The `Term` trigger must be focusable (`tabIndex={0}`), and the tearsheet/PDF cannot show it at all.

### Pitfall 7: FROZEN_ISLANDS assumption
Plans that avoid chart files "because they are frozen" are working from a stale premise (section 4.3); only four files are frozen, none relevant. Chart axis formats are exempt on their own merits.

### Pitfall 8: `plan-anchor-verify` rot
A PLAN that cites `file.tsx:1402-1408` fails CI the day a prior plan shifts those lines. Cite by symbol (`ExtendedMetricsPanel`), and use `<!-- verify-symbol: path symbol -->` only for names that already exist. [VERIFIED: scripts/verify-plan-anchors.mjs header grammar: a `path:range` is an ANCHOR-RANGE claim; a path with no range is ignored]

### Pitfall 9: Editing `BatchDPanels.tsx` trips an open TODO
`196-STYLE-DRIFT-CENSUS-BLIND-01`'s trigger is "the next edit to … `BatchDPanels.tsx`"; the plan that adds the K-S `Term` should close or restate it in `TODOS.md`.

### Pitfall 10: Parallel agents share the git index
Per-plan worktrees off the phase branch, explicit `git add` paths (memory: manual plan worktrees). This research worktree has **no `node_modules`**; every plan needs `npm ci` or a link before `vitest`/`tsc` can run.

## Code Examples

### Scanner core (AST; prototype, heuristic)
```ts
// scripts/copy-census/scan.ts  (shape only; typescript is already a dev dependency)
import ts from "typescript";

export type Hit = { file: string; line: number; kind: string; text: string };
const USER_ATTRS = new Set([
  "label", "title", "placeholder", "aria-label", "ariaLabel", "alt",
  "heading", "body", "helper", "tooltip", "description", "caption",
]);
const LOG_CALL = /^(console\.|logger\.|log\.|Sentry\.|captureMessage|captureException|[A-Za-z.]*\.(from|select|rpc|eq|in|order|insert|update|delete|channel))/;

export function scanSource(file: string, src: string): Hit[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Hit[] = [];
  const inLogOrQuery = (n: ts.Node) => {
    for (let a = n.parent; a; a = a.parent)
      if (ts.isCallExpression(a) && LOG_CALL.test(a.expression.getText(sf))) return true;
    return false;
  };
  const visit = (n: ts.Node) => {
    let text: string | null = null; let kind = "";
    if (ts.isJsxText(n)) { text = n.text; kind = "jsx-text"; }
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      const skip = ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)
        || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isElementAccessExpression(p) && p.argumentExpression === n)
        || ts.isCaseClause(p);
      if (!skip) {
        if (ts.isJsxAttribute(p)) { if (USER_ATTRS.has(p.name.getText(sf))) { text = n.text; kind = "jsx-attr"; } }
        else { text = n.text; kind = "string"; }
      }
    } else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) { text = n.text; kind = "template"; }
    if (text != null && !inLogOrQuery(n)) {
      const t = text.replace(/\s+/g, " ").trim();
      const prose = /\s/.test(t) && !t.startsWith("[");
      if (t && (prose || /^[A-Z]/.test(t) || kind === "jsx-text"))
        out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, kind, text: t });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
```
Important AST note: `JsxText.getText()` skips leading whitespace (it is treated as trivia), so a whitespace-sensitive check (the D-14 scan) must read `node.text`, not `node.getText(sf)`. [VERIFIED by running both: `getText` lost the leading newline and hid the `disclaimer/page.tsx` hit until switched to `.text`]

### Derived numerals
```tsx
const ROMAN = ["I", "II", "III", "IV", "V", "VI"] as const;
function numbered(sections: Array<{ name: string; node: ReactNode } | null>) {
  return sections.filter((s): s is { name: string; node: ReactNode } => s?.node != null)
    .map((s, i) => <EditorialSection key={s.name} label={ROMAN[i]} name={s.name}>{s.node}</EditorialSection>);
}
```
(Illustrative: `benchmarkSection` currently *returns* an `EditorialSection`, so it must return the name+children pair instead, with the name still `Benchmark — vs {bn}`.)

### Escape idiom (copy of `CustomizeDrawer.tsx:59-64`)
```tsx
useEffect(() => {
  if (!filtersOpen) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    setFiltersOpen(false);
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [filtersOpen]);
```
Focus return: capture `document.activeElement` when opening, restore on close (as `CustomizeDrawer.tsx:80-92`).

### D-14 fix and test
`{PLATFORM_NAME} does <strong>not</strong>{" "}` then `operate a fund …`; assert `container.textContent` contains `does not operate a fund`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tearsheet derived its own figures | Tearsheet mounts the factsheet print view | Phase 196 D-03 | D-15's tearsheet half is closed; only `CompareTable` prints `+`. |
| My allocation had `/my-strategies` | One `/strategies` list for all owners | Phase 199 D-01 | "My Strategies" copy is stale; `FACTSHEET_ORIGINS` already says "Back to Strategies". |
| `Disclaimer` `custody` variant per page | `strategy-page` variant (tier-aware) unused; tearsheet inlines the sentence | Phase 195 D-09 | UC-10 survives as hard-coded tearsheet copy. |
| Frozen chart islands (8) | 4 frozen files | v1.4 to v1.11 reviewed carve-outs | D-11's chart-island exemption is by tick-label category, not by freeze. |

**Deprecated/outdated:** the `eslint.config.mjs` comment claiming the factsheet SVG charts and `EquityChart` are in `FROZEN_ISLANDS`; `name/route.ts`'s statement that public surfaces render the codename regardless of `name`; `browse/route.ts` C-0112 comments; `strategy-display.ts` docblock "Tear sheet / discovery / factsheet already fetch full identity via the DAL and do not need the guard".

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | iOS Safari focuses a tapped `tabIndex={0}` span, so `Term` works on touch via `onFocus` | Pattern 1 | Tooltips unreachable on phones; add an explicit tap handler to `Term` (not to the frozen `useTapPin`). |
| A2 | "portfolio"/"book" sense-bucket sizes (a) to (g) | Section 2.2 | Wrong effort estimate only; the real count comes from the Wave 1 census. |
| A3 | No table stores UI label text (Runtime State Inventory, stored data) | Runtime State Inventory | A data migration would be needed for a stored label; not found, but PROD was not queried. |
| A4 | CDN lag for PDF and OG cards is bounded by their cache headers (OG headers not read) | Runtime State Inventory | Old name or terms visible on cached shares until expiry. |
| A5 | No new Next API is introduced, so `node_modules/next/dist/docs/` was not consulted | Project Constraints | If a plan adds one (e.g. a `useEffect`-free focus pattern in a server component), read the docs first. |
| A6 | `strategy-health.ts` `staleSince` and `strategy-health`-derived text may or may not reach copy | Section 4.1 | One more date site to convert. |
| A7 | The Python analytics messages mentioning "portfolio" are user-visible (stored in alert rows) | Runtime State Inventory | Census scope question; if invisible, drop from scope. |
| A8 | Scanner prose-shape filter keeps nearly all real copy and drops identifiers | Pattern 2 | A genuinely user-visible single-word lowercase string (e.g. a tab label "portfolio") would be missed; mitigated by the attr whitelist plus a planted self-test. |

## Open Questions (RESOLVED)

All nine are resolved in `201-CONTEXT.md` (2026-11-11, orchestrator defaults, founder to confirm): Q1 RESOLVED by D-17 (keep `codename` on the wire; search matches the displayed name and codename). Q2 RESOLVED by D-18 and UI-SPEC U-07 (scenario; "Scenario AUM"). Q3 RESOLVED by D-20 (print and PDF exempt). Q4 RESOLVED by D-18 ("Save view"; "No preference" is a named exception). Q5 RESOLVED by D-22 (census scope is `src/`). Q6 RESOLVED by D-23 as corrected by UI-SPEC U-16. Q7 RESOLVED by D-24 (folded). Q8 RESOLVED by D-09/D-17 (`Strategy #<id>` stays the last fallback). Q9 RESOLVED: not touched in this phase (title-case panel headings are outside D-04..D-08; recorded, not changed).

1. **Should the browse route keep emitting `codename`, and should search still match it?**
   - Known: D-09 shows the real name; `codename` is on the wire and matched by three search surfaces; the route's C-0112 comment names "real name beside codename" as the leak it prevented; TODOS says the name is already public on anonymous `/browse`.
   - Unclear: whether linking name to codename is acceptable now.
   - Recommendation: keep `codename` only if the founder wants codename search and the drawer's codename line; otherwise drop the field and the three matches. Plan it either way as a deliberate choice, not a side effect.
2. **What is a saved scenario draft called, and what is "Portfolio AUM"?** D-04 only rules on live holdings. Recommend "scenario" for the draft (`ScenarioCompareTable` already says it) and "scenario AUM"; founder to confirm (about 57 strings, one e2e pin).
3. **Print/PDF tearsheet and tooltips.** Hover/focus tooltips do not exist on paper. SC-1 says "wherever it appears". Recommend scoping the covered-files list to interactive surfaces and recording the print view as an exemption with reason; alternatives (a footnote legend) add a new element to the print layout.
4. **Preferences that are not the mandate.** `CustomizeDrawer`'s "Save preferences" (discovery view settings) and `RequestIntroButton`'s "No preference" are a different concept; recommend renaming the first to "Save" or "Save view" and leaving the second as ordinary English with an `EXCEPTIONS` row.
5. **Census scope outside `src/` and in emails/PDFs.** D-08 says `src/`. The analytics-service alert/insight text and any PDF template are out of the scan; decide to book them or accept.
6. **wizardErrors `docsHref: "/security#egress-ips"` (×2).** Leave (the section tells how to get the IPs) and record, or retarget; D-13 names only the hint.
7. **Tearsheet Risk Disclosure custody sentence for non-`api_verified` tiers.** Section 10; recommend the `strategy-page` rule.
8. **Whether `Strategy #<id>` should survive as a fallback at all**, now that `strategies.name` is always set (admin-reviewed before publish). Keep it as the last resort; the `public-truth-census` raw-id guard stays.
9. **Title case in panel headings** ("Main Metrics", "Style Drift — First Half vs Second Half") versus DESIGN's sentence-case rule is not in D-04 to D-08; not touched unless the founder asks.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | vitest, tsc, scanner | ✓ | v25.8.1 | — |
| `node_modules` in this worktree | every test/typecheck command | ✗ | — | Run `npm ci` here, or link the primary checkout's `node_modules` (a Wave 0 step; do not edit the primary checkout) |
| `typescript` (compiler API) | census scanner | ✓ in the primary checkout's `node_modules` (6.0.3); declared `^6` | 6.0.3 | — |
| Playwright / e2e | `e2e/composer-axe.spec.ts` update | not probed | — | Update the spec text; run in CI |
| PROD / TEST database | nothing | not needed | — | No PROD or DB access in this phase |

**Missing dependencies with no fallback:** none beyond the `node_modules` install.
**Missing dependencies with fallback:** worktree `node_modules` (install or link).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^5.0.3 + @testing-library/react ^16.3.3 (jsdom) [VERIFIED: package.json] |
| Config file | `vitest.config.ts` (INCLUDE: `src/**/*.test.{ts,tsx}`, `scripts/**/*.test.{ts,tsx}`, `tests/**`, `tools/eslint-plugin-quantalyze/tests/**`) |
| Quick run command | `npx vitest run <path/to/file.test.tsx>` |
| Full suite command | `npm test` (= `vitest run`); typecheck `npm run typecheck` (= `tsc --noEmit`, whole project, no per-file mode); lint `npx eslint <touched files>` or `npm run lint` (src/ plus planning hygiene and route checks) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLAR-03 | Registry invariants: every key has label + non-empty one/two-sentence definition; no duplicate label/alias | unit | `npx vitest run src/lib/glossary.test.ts` | ❌ Wave 1 |
| CLAR-03 | `Term` opens `role="tooltip"` with the registry text on focus and hover; adds no visible text | unit | `npx vitest run src/components/ui/Term.test.tsx` | ❌ Wave 1 |
| CLAR-03 | Rule B: a registered label in a covered file without `Term` is RED; planted fixture proves it fires | unit + census | `npx vitest run scripts/copy-census/scan.test.ts src/__tests__/copy-census.test.ts` | ❌ Wave 1 |
| CLAR-03 | Render smoke: factsheet Extended metrics rows, KpiStrip, GlancePanel, CompareTable carry `[data-term]` | integration | `npx vitest run "src/app/factsheet/[id]/v2/MetricsColumn.terms.test.tsx" ...` | ❌ Wave 2 |
| CLAR-03 | Discovery column tooltips unchanged byte-for-byte | unit | `npx vitest run src/components/strategy/StrategyTable.headers.test.tsx src/components/strategy/StrategyGrid.test.tsx` | ✅ |
| CLAR-04 | Rule A: no retired word in user-visible copy; PENDING empty at close; EXCEPTIONS count-pinned | census | `npx vitest run src/__tests__/copy-census.test.ts` | ❌ Wave 1 (green with PENDING), final wave empties it |
| CLAR-04 | Mobile nav third item reads "Scenario" | unit | `npx vitest run src/components/layout/MobileNav.test.tsx src/components/layout/Sidebar.test.tsx` | ✅ (edit) |
| CLAR-04 | Real name on browse route, tearsheet, My allocation payload, compare search | unit | `npx vitest run src/lib/strategy-display.test.ts src/app/api/strategies/browse/route.test.ts "src/app/(dashboard)/compare/CompareAddStrategy.test.tsx" src/lib/queries.my-allocation.test.ts "src/app/factsheet/[id]/tearsheet/page.test.tsx"` | ✅ (edit) |
| CLAR-06 | Numerals follow render order (with/without Style, with/without comparator, `detailed` and `all`) | unit | `npx vitest run "src/app/factsheet/[id]/v2/MetricsColumn.numerals.test.tsx" "src/app/factsheet/[id]/v2/MetricsColumn.window.test.tsx"` | ❌ Wave 2 (+ ✅ edit) |
| CLAR-06 | `formatDay`/`formatMonth` outputs and malformed input; no non-helper date format (rule C) | unit + census | `npx vitest run src/lib/utils.test.ts src/__tests__/copy-census.test.ts` | ✅ edit / ❌ |
| CLAR-06 | Escape closes All Filters, skips a pre-handled Escape, returns focus | unit | `npx vitest run src/components/strategy/StrategyFilters.test.tsx` | ❌ Wave 2 |
| CLAR-06 | Egress hint has no `/security#egress-ips` link, links the security contact form | unit | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.test.tsx" "src/app/(marketing)/security/page.test.tsx"` | ✅ (edit) |
| CLAR-06 | Disclaimer text contains `does not operate` | unit | `npx vitest run "src/app/(marketing)/legal/disclaimer/page.test.tsx"` | ❌ Wave 2 (the `legal/disclaimer/` directory holds only `page.tsx`, no test) |
| CLAR-06 | CompareTable Volatility unsigned; parity test has a CompareTable exact-text arm | unit | `npx vitest run src/components/strategy/CompareTable.test.tsx src/__tests__/figure-parity-pages.test.tsx` | ✅ (edit) |
| CLAR-06 | Custody: `Disclaimer` `custody` test unchanged; tearsheet Risk Disclosure tier arm (if founder accepts) | unit | `npx vitest run src/components/ui/Disclaimer.test.tsx "src/app/factsheet/[id]/tearsheet/page.test.tsx"` | ✅ |

### Sampling Rate
- **Per task commit:** the touched test files plus `npx eslint <touched files>`.
- **Per wave merge:** `npm run typecheck`, `npx vitest run` over the wave's directories, plus the regression guards named below.
- **Phase gate:** `npm test` full suite green, `npm run lint`, `node scripts/verify-plan-anchors.mjs <each PLAN.md>` clean, before `/gsd-verify-work`.
- **Always-run regression guards for this phase:** `src/__tests__/figure-gate-census.test.ts`, `src/__tests__/public-truth-census.test.tsx`, `src/__tests__/public-truth-copy.test.tsx`, `src/__tests__/no-email-in-copy.test.ts`, `src/app/factsheet/[id]/v2/FactsheetBody.census.test.tsx`, `scripts/factsheet-census/count.test.tsx`, `src/__tests__/phase-52-frozen-spine-guards.test.ts` (4 frozen files must stay zero-diff), `src/__tests__/phase-31-frozen-spine-guards.test.ts`, `src/__tests__/phase-32-frozen-spine-guards.test.ts`, `src/lib/degrade-warnings.test.tsx`.
- **.planning-reading tests** (they read planning files, so planning edits can red them): `src/__tests__/check-planning-hygiene.test.ts` (rules over ROADMAP/STATE; this phase edits neither), `src/__tests__/verify-plan-anchors.test.ts`, `src/__tests__/contracts/ci-docs-path-filter.contract.test.ts`; `src/__tests__/critical-regressions.test.ts` reads `.planning/config.json`. [VERIFIED: grep of `src/__tests__` for planning reads]

### RED proofs (D-08 and the new gates)
For each new gate, neuter, run, see the named RED, restore from a byte backup, run GREEN. Required: (1) put "portfolio" back in one renamed string -> `copy-census` RED naming file and line; (2) delete a `Term` wrapper on one registered label in a covered file -> rule B RED; (3) set `redactedName` back to the tier rule -> `queries.my-allocation` RED; (4) revert `WizardIpAllowlistHint` link -> test RED; (5) re-introduce a bare `toLocaleDateString()` -> rule C RED; (6) reintroduce `+` on CompareTable volatility -> parity arm RED; (7) hard-code the old numeral list -> numerals test RED.

### Wave 0 Gaps
- [ ] `node_modules` in the worktree (`npm ci` or link) — nothing runs without it.
- [ ] `src/lib/glossary.test.ts`, `src/components/ui/Term.test.tsx`
- [ ] `scripts/copy-census/scan.ts`, `scripts/copy-census/scan.test.ts` (planted red and green fixtures), `src/__tests__/copy-census.test.ts` (PENDING + EXCEPTIONS)
- [ ] `src/components/strategy/StrategyFilters.test.tsx` (no file exists)
- [ ] a `CompareTable` arm in `src/__tests__/figure-parity-pages.test.tsx`
- [ ] `MetricsColumn` numerals test and Term render-smoke tests
- [ ] `src/app/(marketing)/legal/disclaimer/page.test.tsx` (none exists at HEAD)

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json` (the key is absent), so it is treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no auth change |
| V3 Session Management | no | none |
| V4 Access Control | **yes** | D-09 changes what a signed-in or anonymous viewer can read: the strategy `name` reaches the My allocation RSC payload and the browse JSON for exploratory-tier rows. The manager identity gate (`institutional` + `isAttested`, `queries.ts:137`, `tearsheet/page.tsx` `effectiveManager`) must stay untouched; `organization_name` redaction stays. |
| V5 Input Validation | yes (light) | `Term` takes keys from a closed `TermKey` union, never user text; the new hint uses `contactHref` (the one encoder that `encodeURIComponent`s values). |
| V6 Cryptography | no | none |
| V8 Data Protection | **yes** | Public repo, tracked `.planning/`: no secrets, PROD ids, home paths or email-shaped literals in fixtures; the census fixtures use synthetic names. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Real strategy name linked to its codename by the browse payload (the C-0112 correlation) | Information Disclosure | Founder-accepted by D-09 (name already public on `/browse`); decide whether to stop emitting `codename` (Open Question 1); keep admin pre-publish review. |
| Open redirect via the back-link `from` param | Tampering | `FACTSHEET_ORIGINS` is a closed map; `parseOrigin` never uses the raw value as an href (T-196-06). Do not widen it. |
| Reflecting link text into the contact page | Tampering | `contactHref` encodes every value; `parseContactPrefill` fences ids. |
| Cached PDF/OG with the old name | Information Disclosure | Cache headers bound staleness; note in the ship report. |
| Raw `Strategy #<id>` shown where a name should be | (UX integrity) | `public-truth-census` `RAW_ID_PATTERN` guard stays. |

## Plan Split (waves and file ownership)

Split by **file ownership**, not topic. Wave 1 builds new modules and edits almost no shared file; Wave 2 plans own disjoint directories and apply terms, words and dates together; Wave 3 empties the pending map and runs the RED proofs. Same-wave plans run in parallel in per-plan worktrees (memory: one executor per plan; `use_worktrees` is true).

**Wave 0 (environment, trivial):** make `node_modules` available in each plan worktree.

**Wave 1 (new modules; disjoint files; parallel)**
- **P01 Registry + `Term`:** `src/lib/glossary.ts` (+ test), `src/components/ui/Term.tsx` (+ test), optional default-off prop on `src/components/ui/Tooltip.tsx` (keep DOM depth for `Tooltip.test.tsx`). Definitions for the ~35 registered terms; the discovery-column strings go in as `contexts` byte-identical.
- **P02 Copy census:** `scripts/copy-census/scan.ts` (+ test with planted red/green), `src/__tests__/copy-census.test.ts` with rule A (retired words), rule B (raw registered term in covered files), rule C (non-helper date format), `PENDING` filled from the live scan (green at HEAD), `EXCEPTIONS` empty, pinned counts, stale-entry rule. Depends on P01 only for the registry import in rule B; if sequential is needed, P02 follows P01 within the wave.
- **P03 Name resolver (D-09):** `src/lib/strategy-display.ts`, `src/lib/queries.ts` (`redactedName` and type doc), `src/app/api/strategies/browse/route.ts` (and `codename` decision), dedup the inline chains in `src/app/factsheet/[id]/v2/page.tsx` and `src/lib/factsheet/fetch-and-build-payload.ts` only if the plan chooses to; update the ~12 pinning tests in section 3.4; add the compare-search RED test. `tearsheet/page.tsx` needs no edit unless `ManagerIdentityPanel`'s prop is renamed (then it belongs to the factsheet plan P05).
- **P04 Date helper:** `src/lib/utils.ts` (`formatDay`, `formatMonth`), `src/lib/utils.test.ts`. No consumer edits yet.

**Wave 2 (one plan per directory; each also clears its `PENDING` entries; parallel)**
- **P05 Factsheet:** `src/app/factsheet/**` (all of `v2/`, `trade-fetch-lines.tsx`, `tearsheet/page.tsx`), `src/lib/factsheet/**` (`joint.ts`, `returns-unit.ts`), `src/components/strategy/ManagerIdentityPanel.tsx`. D-10 numerals, D-06 constituent "Mandate" heading rename (`MandatePanels.tsx`), D-16 tearsheet sentence (if accepted), Terms for factsheet/KPI strip/rail/Style Drift (K-S), dates, retired words, closes or restates `196-STYLE-DRIFT-CENSUS-BLIND-01`. Owns `MetricsColumn.tsx`, `FactsheetView.tsx`, `BatchDPanels.tsx`.
- **P06 My allocation and shared allocator chrome:** `src/app/(dashboard)/allocations/**` (including the 8k-line `ScenarioComposer.tsx`: if one plan is too large, split P06a composer and P06b the rest of the directory, sequential on that one file), `src/components/kpi/**`, `src/components/portfolio/**`, `src/components/discovery/SimulateImpactButton.tsx`, `src/components/exchanges/**`, `src/components/layout/Sidebar.tsx` + `MobileNav.test.tsx` (D-07 "Scenario"), `src/lib/degrade-warnings.ts`, `src/lib/capital-ownership.ts`, `src/lib/portfolio-insights.ts`, `src/lib/display-labels.ts`, `e2e/composer-axe.spec.ts`. Terms: TWR, Avg |ρ|, Sharpe, Max DD, Bridge, mandate. D-04/D-05/D-06 words.
- **P07 Discovery, compare, recommendations, strategy components:** `src/components/strategy/**` (`StrategyTable.tsx`, `StrategyGrid.tsx`, `StrategyFilters.tsx` D-12 Escape + term labels, `CompareTable.tsx` D-15, `discovery-columns.ts` into the registry, `WatchlistTabs.tsx`, `EmptyWatchlist.tsx`, `PercentileRankBadge.tsx`, `FreshnessBadge.tsx`, `StaleSeriesChip.tsx`, `CustomizeDrawer.tsx` wording), `src/app/(dashboard)/compare/**`, `discovery/**`, `recommendations/**`, `src/app/browse/**`, `src/components/org/**`, `src/components/deck/**`. D-05 (favorites/starred), D-06 on recommendations, dates (`formatIsoDay` callers), `figure-parity-pages.test.tsx` CompareTable arm.
- **P08 Manager, wizard, admin, marketing, misc:** `src/app/(dashboard)/strategies/**`, `src/lib/wizardErrors.ts`, `src/app/(dashboard)/admin/**`, `src/components/admin/**`, `src/components/auth/**`, `src/components/landing/**` (TWR term), `src/app/(marketing)/**` (D-14 disclaimer, security), `src/app/portfolio-pdf/**`, `src/lib/email.ts`, `WizardIpAllowlistHint.tsx` (D-13), `src/app/api/**` error strings (excluding the browse route owned by P03), `src/lib/preferences.ts`/`admin/match.ts` copy only.
No two Wave 2 plans own the same file; tests that cross directories (for example `Sidebar.test.tsx`, `MobileNav.test.tsx`) belong to the plan that owns the source.

**Wave 3 (single plan)**
- **P09 Close-out:** `PENDING` maps empty, `EXCEPTIONS` populated with reasons and count-pinned, `formatAbsoluteDate`/`formatIsoDay` removed or aliased, the RED proofs above, TODOS entries `197-STRATEGY-NAME-PSEUDONYM-01`, `[197-COMPARE-NAME-PSEUDONYMITY]`, `[197-VOL-SIGN-TEARSHEET-COMPARE]` closed (each with its stated closing evidence), stale-comment fixes (`eslint.config.mjs`, `name/route.ts`, `browse/route.ts`, `strategy-display.ts`), CHANGELOG entry, `VERSION`/`package.json` bump.

## Sources

### Primary (HIGH confidence) — files read this session
- `src/components/ui/Tooltip.tsx`, `Tooltip.test.tsx`; `src/components/strategy/discovery-columns.ts`, `StrategyTable.tsx` (`renderSortHeader`, plain headers), `StrategyTable.headers.test.tsx`
- `src/lib/strategy-display.ts`, `strategy-display.test.ts`, `src/lib/queries.ts` (:2538-2560, :5335-5375, :5585-5645, :6296-6345), `src/lib/allocation-helpers.ts`, `src/app/api/strategies/browse/route.ts`, `src/app/api/strategies/[id]/name/route.ts`, `src/app/factsheet/[id]/tearsheet/page.tsx`, `src/app/factsheet/[id]/v2/page.tsx` (:326-352, :740-762), `src/lib/factsheet/fetch-and-build-payload.ts` (:995-1015), `src/components/strategy/StrategyNameBlock.tsx`
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx` (headings, `Panel`, `Row`, `EditorialSection`, extended metrics), `BatchDPanels.tsx` (Style Drift), `FactsheetView.tsx` (KPI strip items), `MandatePanels.tsx`, `scripts/factsheet-census/count.ts`
- `src/lib/utils.ts` (date and percent helpers), `src/lib/factsheet/display-sign.ts`, `src/app/factsheet/[id]/v2/format.ts`, `src/components/strategy/CompareTable.tsx`, `src/__tests__/figure-parity-pages.test.tsx` (:560-660)
- `src/components/strategy/StrategyFilters.tsx`, `src/components/strategy/CustomizeDrawer.tsx`, `CustomizeDrawer.test.tsx`
- `src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx` (+ test), `src/app/(marketing)/security/page.tsx`, `security/page.test.tsx`, `src/lib/contact.ts`, `src/components/contact/ContactPointerText.tsx`, `src/lib/wizardErrors.ts` (docsHref entries)
- `src/app/(marketing)/legal/disclaimer/page.tsx`, `src/components/ui/Disclaimer.tsx`, `Disclaimer.test.tsx`
- `src/components/layout/Sidebar.tsx`, `src/lib/factsheet/origin.ts`
- `src/__tests__/phase-52-frozen-spine-guards.test.ts` (:220-259), `phase-31`/`phase-32` guards, `src/lib/types.ts:154`, `eslint.config.mjs` (:84-96, :293-304)
- `src/__tests__/figure-gate-census.test.ts`, `no-email-in-copy.test.ts`, `src/lib/source-scan.ts`, `scripts/verify-plan-anchors.mjs` (header), `vitest.config.ts`, `package.json`
- `201-CONTEXT.md`, `.planning/ROADMAP.md` `### Phase 201`, `.planning/REQUIREMENTS.md`, `DESIGN.md` (Typography, Voice / microcopy, AI-Slop Ban, decision log 2026-06-30), `TODOS.md` (the three named entries and `196-STYLE-DRIFT-CENSUS-BLIND-01`), `195-05-SUMMARY.md` UC-10, `196-UI-SPEC.md` "Phase 201 renames"

### Secondary (MEDIUM confidence)
- Throwaway TypeScript-compiler-API scans of `src/` (retired words, inline-element whitespace joins, date formatters): counts are heuristic and filter-dependent.

### Tertiary (LOW confidence)
- None used as a basis for a recommendation; unverified items are in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every mechanism to reuse was opened and read.
- Architecture: HIGH for resolver/query-layer, numerals, Escape, egress hint, disclaimer, volatility, custody (all read); MEDIUM for the census design (prototype scan only).
- Pitfalls: HIGH for the code-evidenced ones; MEDIUM for hydration and touch behaviour (browser-dependent).

**Research date:** 2026-11-11
**Valid until:** 2026-11-18 (the tree changes daily: other phases merge to `main` and renumber lines; re-resolve every symbol before planning, cite by symbol).
