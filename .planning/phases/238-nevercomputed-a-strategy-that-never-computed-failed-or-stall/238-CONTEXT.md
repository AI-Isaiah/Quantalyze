# Phase 238: NEVERCOMPUTED — a strategy that never computed, failed or stalled never claims a compute time or tells its owner to wait - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning

<domain>
## Phase Boundary

A strategy that never computed, failed or stalled never claims a compute time or tells its owner to wait. Requirements: FACT-03, FACT-05. TODOS entries this phase closes: `[170.1-STRATEGIES-NOTE-WAIT-WORDING]` (FACT-05, PR-1) and `[166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT]` (FACT-03, PR-2).

The phase ships as two PRs (founder ruling 2026-11-24, below):
- **PR-1 (FACT-05, no migration):** the /strategies share notes for a failed, stalled or never-started row, and the published row's public-link note, name an action instead of telling the owner to wait.
- **PR-2 (FACT-03, migration):** `strategy_analytics.computed_at` becomes nullable, never-computed rows carry NULL, and every reader is censused and moved in the same PR. PR-2 is planned now and executed only after Phase 233 has merged (ROADMAP: "FRESH-02's check is among those readers, so this phase then comes after 233") and the coordinator confirms the one serial migration lane is free.

Out of scope: Phase 237's factsheet seam beyond what a `computed_at` reader census requires in PR-2; STALE-01 (`[166.5-STALE01-PREMISE]`); the PDF mixed-vintage window (`[166.5-PDF-MIXED-VINTAGE-WINDOW]`).

</domain>

<decisions>
## Implementation Decisions

### FACT-03: how a never-computed row is encoded (founder ruling, 2026-11-24)
- Founder answer "A: allow an empty date (Recommended)": `strategy_analytics.computed_at` becomes nullable (DROP DEFAULT, DROP NOT NULL), never-computed rows are set to NULL, and `StrategyAnalytics.computed_at` becomes `string | null`. This reverses 166.5 CONTEXT R-04 ("first-ever rows keep the column `DEFAULT now()` (NOT NULL); recorded as a known limit"). — **Reversibility:** one-way — a PROD migration that auto-applies with no human stop, plus a reader contract change across TS, SQL and Python; the rollback cannot restore NOT NULL without writing a false date back.
- The migration answers the four caveats of `[166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT]` in its own gate: (1) the backfill gets past `strategy_analytics_hold_computed_at_until_success()` (all 11 never-computed PROD rows measured 2026-11-24 are `failed`, exactly the rows the trigger holds), and a post-UPDATE `DO` block fails loud if any never-completed row still carries a date; (2) R-04 reversal recorded here; (3) the rollback names the value it writes into NULLs and why; (4) every reader gets a NULL arm (ORDER BY NULL placement, comparisons that turn false on NULL, the factsheet cache key and the PDF ETag treating NULL as a distinct value, the baseline INSERT sites).
- The never-computed predicate for the backfill must not be status alone: on 2026-11-24 PROD held 11 `failed` rows with no stored figures and 7 `failed` rows with figures (computed before; their date is an honest last-good date and must stay).
- A census of `strategy_analytics.computed_at` readers fails on an unclassified new reader (SC-1).
- Migration gates: migration-reviewer and rls-policy-auditor clean with no MEDIUM+ finding, in the one serial migration lane.

### FACT-05: the note wording (founder ruling, 2026-11-24)
- Founder answer "(a) Reuse the remedy (Recommended)": for an unpublished row whose recipient arm is `not_available` and whose state is `failed`, `stalled` or `never_started`, the private-link note (today `MINT_TOKEN_NOTES.not_available`, "…The numbers appear there once a computation succeeds.") names the same action `ownerRemedy` already names for that state and strategy shape (edit page to start a new computation, contact form, or upload a new CSV strategy), and never says to wait.

### FACT-05: the public-link note (founder ruling, 2026-11-24)
- Founder answer "Yes, same PR (Recommended)": `PUBLIC_URL_NOTE` ("Right now, this strategy's factsheet link shows that the factsheet is not available yet. The numbers appear there once a computation succeeds.") is in scope and is fixed in PR-1 so it no longer tells the owner to wait when nothing is running.

### Shipping split (founder ruling, 2026-11-24)
- Q4 followed from Q1=A, per the coordinator's relay of the founder's answers: FACT-05 plus the public note ship now as PR-1, with no migration. FACT-03 (the nullable migration and the reader census) is PR-2, which waits for Phase 233 per the ROADMAP and for a free migration lane.

### Decided autonomously
- [FACT-05] Q: "Where do the FACT-05 tests live?" → Selected: "a `page.key-pill.test.tsx` case per state (failed, stalled, never_started) asserting the rendered sentence, with the existing `it.each` over those states re-pointed rather than deleted" — test layout only; it is the TODOS closing condition.
- [FACT-05] Q: "Does the in-progress note (KCS12-MINT-A) change?" → Selected: "No. Something is running, so a wait is true there" — one copy constant, untouched.
- [FACT-05] Q: "Do the `analytics_failed` and `finished_not_built` notes change?" → Selected: "No. 170.1 D-08 already gave them action-naming notes" — untouched constants.
- [FACT-03] Q: "What shape is the reader census?" → Selected: "a vitest source-reading pin that lists every reader of `strategy_analytics.computed_at` with a classification and fails on an unclassified one" — a test file, cheap to reshape.
- [Ship] Q: "Which TODOS entries are deleted, and when?" → Selected: "`[170.1-STRATEGIES-NOTE-WAIT-WORDING]` in PR-1, `[166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT]` in PR-2, each named in its CHANGELOG entry" — CLAUDE.md rule (b).

### Claude's Discretion
- The exact sentence for each new note, within DESIGN.md's voice and the house rule that a note states what the link shows now and then the action. The planner and UI-SPEC draft it; reuse the existing `ownerRemedy` remedy texts and ids where the action is the same.
- How a published row's note learns the state it needs: today `armOf` reads no jobs for a published row (167.2-REVIEW IN-04) and passes `state: null`. The planner decides whether `PUBLIC_URL_NOTE` takes a state-free action sentence or the published path reads the state, weighing the one-RPC-per-row cost IN-04 removed.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ownerRemedy(state, shape, strategyId, build?)` and `REMEDY_RULES` in `src/lib/status-surface-copy.ts`: per-state remedies (`stalled`, `failed_*` other than permanent, `never_started` → `shape`; `failed_permanent` → contact form), and `shapeRemedy` per shape (`key` edit page, `composite` contact form, `csv` upload a new CSV strategy).
- `recipientArm(state)` in `src/lib/compute-state.ts`: `stalled`, `failed`, `finished`, `never_started` → `not_available`.
- `MINT_TOKEN_NOTES`, `PUBLIC_URL_NOTE`, `recipientShareNote`, `recipientShareNoteFor` in `src/lib/status-surface-copy.ts`.
- `computeFreshness(null)` in `src/lib/freshness.ts` already returns `stale`.

### Established Patterns
- `/strategies` (`src/app/(dashboard)/strategies/page.tsx`) chooses the note through `uncomputedNote` → `recipientShareNoteFor(mode, arm, kind)`; `armOf` returns the arm and the ComputeState once per row (Phase 199 plan 16) and skips the jobs read for a published row.
- The `stale_no_data` detail line on the same page already renders `ownerRemedy` for the row's real compute state through `viewerRemedyAction`.
- Copy constants carry KCS ids and are pinned by tests that assert the rendered sentence.

### Integration Points
- PR-1: `src/lib/status-surface-copy.ts`, `src/app/(dashboard)/strategies/page.tsx`, `page.key-pill.test.tsx` and the copy tests.
- PR-2: the migration, `supabase/schema/baseline.sql` re-dump and carried-migration marker, `strategy_analytics_hold_computed_at_until_success()` and its SQL gate, `src/lib/types.ts`, `src/lib/database.types.ts`, `SyncBadge.tsx` ("Analytics last computed", line 257) and its mounts (`recommendations/page.tsx`, `StrategyGrid`, `StrategyTable`, `StrategyHeader`), `get_allocator_recommendations`, the `ledger_refresh_staleness` view (informational column; `is_stale` keys on status), the factsheet payload cache key and PDF ETag, and the Python readers under `analytics-service` (runner, job_worker, analytics_status, match, portfolio and others). The TODOS entry's "where it shows" names `src/app/(dashboard)/portfolios/[id]/page.tsx`, which no longer exists at HEAD (measured 2026-11-24).

</code_context>

<specifics>
## Specific Ideas

- Measured on PROD 2026-11-24 (read-only, marker first): 11 never-computed `strategy_analytics` rows, all `failed`, none a portfolio constituent; 7 more `failed` rows carry figures.
- Phase 237 FACTSHEETHONEST owns the factsheet seam and shipped in #1316; PR-2 re-bases on its cache key and ETag code.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

<deviations>
## Deviations

### 2026-11-24 — UI-SPEC §1.7 viewer mapping on the owner pending page (PR-1 review WR-01)
UI-SPEC §1.7 said the owner pending factsheet page needs no viewer mapping ("it is the owner's own page"). Code review round 1 (WR-01, MEDIUM, user-facing) showed that an allocator-only user can own a strategy (wizard drafts, CD-10), and that the page's KCS-09 remedy line, and the new share note, could link them to the manager-only `/strategies/{id}/edit` or the CSV wizard. Under the project's review rule (a user-facing MEDIUM is fixed), fix round 1 reads the owner's `profiles.role` and maps both the note and the remedy line through `viewerRemedyAction`, so they still name one action (238-03's parity truth). Manager and `both` owners render as before; a failed role read falls back to not-a-manager. Also recorded in ROADMAP Phase 238.

### 2026-11-24 — UI-SPEC §1.1 row 5 replaced (founder ruling "Neutral 'unknown' note", relayed by the coordinator)
Silent-failure review round 1 (MEDIUM-1) found that an unpublished row whose jobs read failed kept KCS12-UNREADABLE ("… placeholder page instead of the numbers. They appear there once a computation succeeds."), a promise of numbers about a state nobody read, which UI-SPEC §1.1 row 5 pinned unchanged. Founder ruling 2026-11-24: "Neutral 'unknown' note" — the note uses the same honest wording as the published row's unknown state. PR-1 adds `KCS12_MINT_B_UNKNOWN` ("Right now, a private link to this strategy opens a page without its factsheet. If no computation is running, use the contact form to have it checked.") as the private-link `unreadable` answer (commits d955d487a and its review follow-up). The tail is KCS12-PUBLIC-UNKNOWN's. The lead is not KCS12-MINT-B-LEAD, because the reviewer pass (MEDIUM, user-facing) showed that the private link shows "being prepared" while a computation runs, and an unread state cannot rule that out. It reaches every caller of that arm: the /strategies unpublished row, the owner pending page's string fallback and the string API. Also recorded in ROADMAP Phase 238.
</deviations>
