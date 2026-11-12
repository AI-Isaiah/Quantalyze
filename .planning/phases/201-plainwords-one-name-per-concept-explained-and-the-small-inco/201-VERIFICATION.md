---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
verified: 2026-11-11T23:45:00Z
verified_at_sha: f9d80353f0a7c26e23ae833af01dfaa8a70f25d1
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
drift_subjects:
  - src/lib/glossary.ts
  - src/components/ui/Term.tsx
  - scripts/copy-census/policy.ts
  - scripts/copy-census/scan.ts
  - src/__tests__/copy-census.test.ts
  - src/lib/utils.ts
  - src/lib/strategy-display.ts
  - src/app/api/strategies/browse/route.ts
  - src/app/factsheet/[id]/tearsheet/page.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
  - src/app/factsheet/[id]/v2/MasterBrush.tsx
  - src/app/(dashboard)/allocations/components/BlendHeader.tsx
  - src/app/(dashboard)/allocations/components/CustomRangePicker.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
  - src/components/strategy/StrategyFilters.tsx
  - src/app/(marketing)/legal/disclaimer/page.tsx
  - src/app/(marketing)/security/page.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.tsx
  - src/lib/contact.ts
  - src/lib/factsheet/returns-unit.ts
  - src/lib/degrade-warnings.ts
  - src/components/layout/Sidebar.tsx
re_verification:
  previous_status: gaps_found
  previous_score: 7/8
  previous_verified_at_sha: e5fa44e8709ac9c9ad6653da135da31a3fb04578
  gaps_closed:
    - "SC-3 second clause: dates use one format across the app (R3-01 residuals; plans 201-35..40 and review fixes GC-01..GC-04)"
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "Census rule C still has stated blind spots: a date held in a variable or neutral name, a call result, a display prop outside USER_ATTRS (value, subtitle), and a bare hyphen-joined template with no prose. The gate cannot catch a reintroduction of those shapes."
    category: other
    reason: "Documented in scan.ts BLIND SPOTS and the TODOS closure note (GC2-02 option b). My own sweep found no live site of these shapes at HEAD. Closing it needs a bare value rule with a type=date exemption and RED/GREEN arms."
    evidence_status: "my scanSource probe with the shipped POLICY: value={r.asof}, a sliced variable printed as a child, and a hyphen-only template read none; child field, ISO literal, prose template, aria-label, en-dash and arrow range templates read C"
  - finding: "StrategyHeader.tsx still prints Live since {strategy.start_date} raw, held by one count-pinned reasoned exception"
    category: other
    reason: "Component is imported only by its own test; no render path. Delete the file or format it in a later phase."
    evidence_status: "grep of src for StrategyHeader: the component, its test, Badge.tsx and the census files only"
human_verification:
  - test: "Hover, then keyboard-Tab to, the Omega, Ulcer Index, Common-sense Ratio, Kolmogorov-Smirnov, TWR, Scenario and Mandate labels on the factsheet, My allocation and discovery"
    expected: "A one- or two-sentence definition bubble appears on hover and on keyboard focus; the print view and PDF show plain labels"
    why_human: "Bubble placement, legibility and focus ring are visual; tests prove the wiring and registry, not how it reads"
  - test: "In a real browser open discovery, open All Filters, press Escape (also with a nested popover open)"
    expected: "Panel closes, unapplied draft is discarded, focus returns to the All Filters button; an Escape handled by a nested popover does not also close the panel"
    why_human: "jsdom tests cover the keydown path; real focus and popover ordering is a browser behavior"
  - test: "In the strategy wizard's API-key step click 'egress IP status', and click 'Add strategy' in compare and search a published strategy by its real name"
    expected: "The link lands on /security#egress-ips whose first paragraph says there is no static egress IP yet; the compare search finds the strategy by its real name and shows it, while an unpublished strategy of another owner still reads as a codename"
    why_human: "Anchor scroll landing and the live published/unpublished data split are not reproducible in unit tests"
  - test: "Walk the public factsheet and tear sheet Terms panel and chart hover, My allocation (Holdings notes, exposure captions, composer header, compared-scenario table), the custom range picker footer and the wizard's CSV and key-sync steps"
    expected: "Every day date reads like Nov 12, 2026 with a spaced en dash for ranges; no 2024-06-01 form appears beside a helper-formatted date; date input fields still show the browser's own format"
    why_human: "The census is a static gate with stated blind spots; whether the rendered pages read as one format, and how the longer en-dash ranges wrap at narrow widths, is only visible in a browser"
---

# Phase 201: PLAINWORDS Verification Report

**Phase Goal:** Specialist terms are explained where they appear, each concept has one name across the app, and the small inconsistencies are fixed: factsheet sections numbered in order, one date format, Escape closes the filter drawer, the egress-IP link leads to the IPs or is removed, and the disclaimer typo is gone. Plus (founder 2026-11-10, "Real name everywhere"): a strategy reads under its real name on every surface, including the browse route behind compare's "Add strategy" and the tearsheet card and title.
**Verified:** 2026-11-11 at `f9d80353f0a7c26e23ae833af01dfaa8a70f25d1` (branch `feat/201-plainwords`, worktree `quantalyze-201`)
**Status:** human_needed (all automated checks pass, four browser checks remain)
**Re-verification:** Yes, after gap closure (previous `gaps_found` at `e5fa44e87`, SC-3 second clause)

Founder decisions F-01..F-15 override the D-decisions they name: "Bridge" is retired from user copy with Scenario the registered term (F-04, F-08); the wizard egress link points at `/security#egress-ips` (F-12, overriding D-13 and D-23); dates read `Nov 12, 2026` through one helper (F-11).

## Goal Achievement

### Observable Truths (ROADMAP success criteria, plus the added goal clause)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | Every specialist term carries a tooltip wherever it appears (label positions, D-19) | VERIFIED (regression check) | `src/lib/glossary.ts` still registers 43 terms; census rule B (a registered term must go through `Term`) reads 0. Wiring sites from the first verification unchanged. `glossary.test.ts` and `Term.test.tsx` green in the full run. |
| SC-2 | One name per concept; a test goes RED on a retired word | VERIFIED (regression check) | `npx tsx scripts/copy-census/run.ts --summary` at HEAD: `remaining  files=0  A=0 B=0 C=0  exceptions=36`. My own grep of non-comment, non-import JSX for Bridge, favorite(s), starred, My Strategies and My Allocation found only code identifiers, props and the lowercase `"bridge"` DB value behind `introSourceLabel`. Page titles and breadcrumbs read "My allocation". |
| SC-3a | Factsheet sections numbered in render order | VERIFIED (regression check) | `MetricsColumn.tsx` `NumberedSections` assigns numerals by position among rendered sections; its tests pass in the full run. |
| SC-3b | Dates use one format across the app | VERIFIED (gap closed) | See "SC-3 re-verification" below. Every site the previous report named now prints through `formatDay`; the census gate that failed to see the field/variable form now reads it and is proved RED/GREEN. |
| SC-4a | Escape closes the discovery filter drawer | VERIFIED (regression check) | `StrategyFilters.tsx:339-351` document keydown listener (skips a handled Escape, discards the draft, restores focus); `StrategyFilters.test.tsx` green. The real-browser check stays in the human items. |
| SC-4b | Egress-IP link leads to the IPs (F-12) | VERIFIED (regression check) | `contact.ts:62-65` `href: "/security#egress-ips"`; `security/page.tsx:602` `<Section id="egress-ips">` carrying the "no static egress IP yet" statement first. Contact, security-page and wizardErrors tests green. |
| SC-4c | Disclaimer reads "does not operate" | VERIFIED (regression check) | `legal/disclaimer/page.tsx:62-63` `does <strong>not</strong>{" "}` then `operate`; `page.test.tsx` pins the rendered text. |
| Goal+ | Real name everywhere: browse route, tearsheet card and title print the name discovery prints, only where the viewer can see it in discovery | VERIFIED (regression check) | `browse/route.ts:9,263` and `tearsheet/page.tsx` use `displayStrategyName` with the visibility predicate; `CompareAddStrategy.real-name.test.tsx` and the `strategy-display` tests green. |

**Score:** 8/8 truths verified, 0 present-behavior-unverified. The two folded items (CompareTable unsigned volatility, tier-aware custody sentence) stay green in the full run.

### SC-3 re-verification (the focus)

The previous gap named four sites plus the rest of R3-01, and asked for a gate that can see the field/variable form. Checked at HEAD, in the code, not from the SUMMARYs:

| Site named by the previous report | State at HEAD |
|---|---|
| `MandatePanels.tsx:302-310` local `iso()` | Deleted; the file prints through `formatDay`/`formatMonth` (7 uses) |
| `HoldingsTabPanel.tsx:155,184,272` | The `as last read on ${asof}` notes print through `formatDay` (4 helper uses in the file) |
| `BlendHeader.tsx:77-79` | `{formatDay(effStart)}{" – "}{formatDay(effEnd)}`, spaced en dash (read at `:79-83`) |
| `portfolio-pdf/[id]/page.tsx:62` | `Retired {formatDay("2026-11-07")}` (ISO only as the literal argument) |
| ScenarioCompareTable, NetExposureChart, AllocationOverTime, OutcomeRecordedRow, wizard CsvPreview/CsvSubmit/Review/SyncPreview/MultiKey, legal and security pages, admin usage | each file now holds `formatDay`/`formatMonth` call sites (3 to 7 per file) |
| Review fixes GC-01 (`CustomRangePicker` footer), GC-02 (`TimeSeriesChart` hover header), GC-03 (`MasterBrush` readout, two exception rows dropped), GC-04 (rule C extensions) | merged in `40ca07b68`; the census reads 36 exceptions, down from the 38 plan 40 pinned |

Independent evidence beyond the SUMMARYs:

- **Residual sweep (my own).** Non-comment ISO day literals in non-test `.tsx` outside `formatDay(`: none (every hit was a dated comment). `toLocaleDateString`, `toDateString`, `Intl.DateTimeFormat`, `date-fns` and `dayjs` outside `src/lib/utils.ts`: none. Date fields printed bare through `{x.asof}`, `{x.windowStart}` and the like: only `<input type="date" value=...>` controls (`MultiKeyConnectStep.tsx:2525,2538`, `AddAllocationFlow.tsx:739`; machine values, exempt under D-11) and `StrategyHeader.tsx:78`. The `.slice(0, 10)` sites are machine values (day keys, `max=` bounds, a CSV file name) or values that later reach `formatDay`, `formatCloseDay` or `formatDate` (I traced `jobDayOf`, `utcDay`, the `OutcomesWidget` `dateIso` and `formatUnpricedDays`). The degrade-warning lines in `degrade-warnings.ts` print days through `formatCloseDay`, which calls `formatDay`. The one time-of-day stamp (`WizardChrome.tsx:215`, "Draft saved" plus hh:mm) is outside the date rule per D-21. This sweep is grep-based: it covers the shapes I searched for, not every possible form.
- **Gate probe (my own).** `scanSource` with the shipped `POLICY` over planted files: a raw date field as a JSX child, an ISO day typed in JSX text, a prose template, a bare date field in `aria-label`, and en-dash and arrow range templates each read rule C. `formatDay(r.asof)` reads none. So the gate now fails on a reintroduced raw date in the shapes the first report named. Its limits are in the Advisory section.
- **Review evidence.** `201-REVIEW.md` rounds 1 and 2 record each GC fix reverted on its own in a scratch copy and the matching test going RED, and the census "no hit that is not a reasoned exception" arm going RED when the `MasterBrush` fields were exposed. Round 2 closed GC2-01 (stale TODOS record, corrected) and GC2-02 (stated as a blind spot, option b). I re-ran the census myself rather than relying on that.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/utils.ts` `formatDay`, `formatMonth`, `formatDayTime` | one date helper | VERIFIED | Real, UTC, en-US; used across the files listed above |
| `scripts/copy-census/scan.ts`, `policy.ts` (`DATES.fieldNames`, 36 pinned exceptions) | rule C reads field, literal and template forms | VERIFIED | Substantive and wired into `src/__tests__/copy-census.test.ts`; live scan 0/0/0 |
| `src/lib/glossary.ts`, `src/components/ui/Term.tsx` | registry plus wrapper | VERIFIED | 43 terms, wired |
| `src/lib/strategy-display.ts`, browse route, tearsheet page | one name resolver | VERIFIED | Used on both surfaces |
| `StrategyFilters.tsx`, `WizardIpAllowlistHint.tsx`, `contact.ts`, `security/page.tsx`, `legal/disclaimer/page.tsx` | small fixes | VERIFIED | As above |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Date display sites (about 40 files) | `formatDay` in `src/lib/utils.ts` | direct call | WIRED | Residual sweep above; no local date formatter remains in `MandatePanels.tsx` |
| `copy-census.test.ts` | `scanTree(POLICY)` | the live census test | WIRED | Pins 36 exceptions and the no-unreasoned-hit arm |
| Wizard hint | `/security#egress-ips` | `EGRESS_IP_STATUS_LINK` | WIRED | Anchor exists and states the status |
| Compare "Add strategy" | browse route | `displayStrategyName` | WIRED | Real name for a discovery-visible strategy only |

### Data-Flow Trace (Level 4)

This phase changes copy and formatting and adds no data source. Date values stay ISO for state, comparison and CSV; only the printed text moves to the helper. The degrade-warning day chain runs compute job or `last_sync_at`, then `degradeSegments`, then `formatCloseDay`, then `formatDay`: FLOWING.

### Behavioral Spot-Checks and Test Evidence

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Copy census live scan | `npx tsx scripts/copy-census/run.ts --summary` | `files=0  A=0 B=0 C=0  exceptions=36` | PASS |
| Rule C forms fire and the helper form does not | `scanSource` probe over planted shapes | see SC-3 re-verification | PASS (with the stated blind spots) |
| Full suite | `npx vitest run --reporter=dot` | Test Files 1 failed, 1230 passed, 20 skipped (1251); Tests 2 failed, 25801 passed, 306 skipped (26109). Both failures are in `src/lib/factsheet/compute.conventions.test.ts` (fixtures B and C, `skew` last-digit inline-snapshot drift) | PASS with the 2 known pre-existing failures. This phase does not touch `compute.ts` or that test (empty `git diff 19353fd1f..HEAD` for both); I did not re-run base. |

### Probe Execution

No probes declared by this phase. SKIPPED.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| CLAR-03 | 01, 06, 08-19, 22, 24, 25, 27, 28, 33, 34 | Specialist terms carry a tooltip or glossary entry | SATISFIED | SC-1 |
| CLAR-04 | 02, 06, 07, 09-22, 24-31, 33 | One name per concept | SATISFIED | SC-2 and the real-name clause |
| CLAR-06 | 03-06, 08-22, 24, 25, 27, 32, 35-40 | Sections numbered, one date format, Escape, egress link, disclaimer typo | SATISFIED | SC-3a, SC-3b, SC-4a to SC-4c |

No orphaned requirement. REQUIREMENTS.md still shows the three as Pending; the orchestrator closes them at phase completion.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/strategy/StrategyHeader.tsx` | 78 | `Live since {strategy.start_date}` raw ISO | Info | Imported only by its own test; one count-pinned reasoned exception. No user can see it. |

No `TBD`, `FIXME` or `XXX` marker appears on any line this phase added to non-test source (`git diff 19353fd1f..HEAD`, filtered). The earlier BLOCKER rows (`MandatePanels.tsx`, `HoldingsTabPanel.tsx`, `BlendHeader.tsx`) are resolved.

### Advisory (stated gate limits, not blocking)

| # | Finding | Category | Why Advisory |
|---|---------|----------|--------------|
| 1 | Rule C cannot see a date in a variable or neutral name, a call result, a `value`/`subtitle` display prop, or a bare hyphen-joined template with no prose | other | Documented in `scan.ts` BLIND SPOTS and the TODOS closure note (GC2-02 option b); no live site found at HEAD; the R3-01 sites of those shapes carry rendered-text pins instead |
| 2 | `StrategyHeader` raw start date | other | Dead component, count-pinned exception |

### Human Verification Required

Four items, in the frontmatter `human_verification` list: tooltip hover and keyboard focus legibility, Escape in a real browser, the egress-link landing with the compare real-name search against live published and unpublished data, and a browser walk over the date surfaces the SC-3 closure touched.

### Gaps Summary

None. The one gap from the previous verification (SC-3, raw `YYYY-MM-DD` display dates) is closed in the code: each named site prints through `formatDay`, no local date formatter or non-helper locale call remains outside `src/lib/utils.ts`, and the census gate now reads the field, literal and template forms, so a reintroduction in those shapes goes RED. Everything else in the roadmap contract held on the regression check. What remains is human verification of how the rendered pages read, plus the gate's stated blind spots, which are advisory.


## UAT 2026-11-12

Founder-authorized UAT on 2026-11-12 moves this verification from `human_needed` to `passed`. The `verified_at_sha` above is the commit the code verdict was issued at; the UAT ran on production and on a local stack at `5ad404c17`.

**Production** (quantalyze.xyz, the founder's signed-in admin browser, 606px wide):
- The edit-page one-key panel works: the picker, then the confirm dialog with Close at 44x44 and Cancel and Change key each 44px tall. After Cancel and a reload, the strategy still feeds from its original key.
- The disclaimer reads "does not operate".
- `/security#egress-ips` states "We have no static egress IP yet…".
- My allocation and discovery show no retired words. Dates read "Nov 11, 2026".
- Escape closes All Filters and focus returns to the opener.
- The factsheet Max DD tooltip shows "The largest fall from a peak to a later low, in percent." inside the viewport.

**Local stack at `5ad404c17`** (v0.133.38.0, both ship PRs merged; screenshots kept in the session scratchpad under `200-201-uat/`, not committed). Every item PASS:
- a. The edit page at 320px and 1280px: Close is 44x44, no overflow.
- b. The Profile key rows at 320, 768, 1024 and 1280px: no overflow, and labels are ellipsised rather than cut to 3 characters.
- c. The Omega, Ulcer, Common-sense, KS, TWR, Scenario and Mandate tooltips open by hover, by keyboard and by tap, and sit inside the viewport. The tear sheet shows plain labels.
- d. Escape discards the All Filters draft and returns focus.
- e. The egress link lands on the anchor.
- f. Compare finds strategies by their real name, and another owner's draft never surfaces.
- g. One date format and the spaced en dash.
- h. A 76-character strategy name causes no clipping.
- i. 0 retired-word hits over 33 pages.
- j. 320px with no overflow on every page.

**Residuals.** The UAT found seven residual UI defects. By founder decision of 2026-11-12 ("One polish phase now") they are routed to Phase 201.1 POLISHRESIDUALS, one success criterion each: WR-13 (a failed key row with a long `sync_error` squeezes the label at 1440px), ISO dates left in the composer CoverageTimeline and the compare chart x-axis ticks, the composer "Coverage window" using "→" instead of the spaced en dash, a date breaking before its year, "My allocation" clipped in the correlation matrix, the composer sticky bar wrapping one word per line at 390px, and the composer opening on a one-day selected range. The founder accepted both phases with these residuals routed to 201.1 rather than reopening either phase. Two of them (the ISO dates and the year orphan) touch Phase 201 SC-3, and 201.1 owns closing them.

Against the frontmatter `human_verification` list:
1. *Tooltip hover and keyboard legibility.* Closed by local item c and the production Max DD tooltip.
2. *Escape in a real browser.* Closed by local item d and the production All Filters check.
3. *Egress link landing and compare real-name search.* Closed by local items e and f and the production `/security#egress-ips` check.
4. *Browser walk over the date surfaces.* Closed by local item g and the production "Nov 11, 2026" dates. The ISO dates that remain in the composer CoverageTimeline and the compare chart ticks, and the year orphan, are booked as Phase 201.1 criteria.

---

_Verified: 2026-11-11_
_Verifier: Claude (gsd-verifier)_
