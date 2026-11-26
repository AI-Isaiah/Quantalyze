# Phase 238: NEVERCOMPUTED - Research

**Researched:** 2026-11-24, at worktree HEAD `4b89c54cb` (VERSION `0.133.65.2`)
**Domain:** owner-facing share-note copy (PR-1) and a one-way nullable-column migration plus a `computed_at` reader census (PR-2), in a Next.js 16 / Supabase / FastAPI repo
**Confidence:** PR-1 HIGH. PR-2 MEDIUM: the PROD backfill predicate is not measured against PROD rows (no PROD read tool was available to this agent), and Phase 233's FRESH-02 reader does not exist yet, so the census is valid only until 233 merges.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**FACT-03: how a never-computed row is encoded (founder ruling, 2026-11-24)**
- Founder answer "A: allow an empty date (Recommended)": `strategy_analytics.computed_at` becomes nullable (DROP DEFAULT, DROP NOT NULL), never-computed rows are set to NULL, and `StrategyAnalytics.computed_at` becomes `string | null`. This reverses 166.5 CONTEXT R-04 ("first-ever rows keep the column `DEFAULT now()` (NOT NULL); recorded as a known limit"). — **Reversibility:** one-way — a PROD migration that auto-applies with no human stop, plus a reader contract change across TS, SQL and Python; the rollback cannot restore NOT NULL without writing a false date back.
- The migration answers the four caveats of `[166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT]` in its own gate: (1) the backfill gets past `strategy_analytics_hold_computed_at_until_success()` (all 11 never-computed PROD rows measured 2026-11-24 are `failed`, exactly the rows the trigger holds), and a post-UPDATE `DO` block fails loud if any never-completed row still carries a date; (2) R-04 reversal recorded here; (3) the rollback names the value it writes into NULLs and why; (4) every reader gets a NULL arm (ORDER BY NULL placement, comparisons that turn false on NULL, the factsheet cache key and the PDF ETag treating NULL as a distinct value, the baseline INSERT sites).
- The never-computed predicate for the backfill must not be status alone: on 2026-11-24 PROD held 11 `failed` rows with no stored figures and 7 `failed` rows with figures (computed before; their date is an honest last-good date and must stay).
- A census of `strategy_analytics.computed_at` readers fails on an unclassified new reader (SC-1).
- Migration gates: migration-reviewer and rls-policy-auditor clean with no MEDIUM+ finding, in the one serial migration lane.

**FACT-05: the note wording (founder ruling, 2026-11-24)**
- Founder answer "(a) Reuse the remedy (Recommended)": for an unpublished row whose recipient arm is `not_available` and whose state is `failed`, `stalled` or `never_started`, the private-link note (today `MINT_TOKEN_NOTES.not_available`, "…The numbers appear there once a computation succeeds.") names the same action `ownerRemedy` already names for that state and strategy shape (edit page to start a new computation, contact form, or upload a new CSV strategy), and never says to wait.

**FACT-05: the public-link note (founder ruling, 2026-11-24)**
- Founder answer "Yes, same PR (Recommended)": `PUBLIC_URL_NOTE` ("Right now, this strategy's factsheet link shows that the factsheet is not available yet. The numbers appear there once a computation succeeds.") is in scope and is fixed in PR-1 so it no longer tells the owner to wait when nothing is running.

**Shipping split (founder ruling, 2026-11-24)**
- Q4 followed from Q1=A, per the coordinator's relay of the founder's answers: FACT-05 plus the public note ship now as PR-1, with no migration. FACT-03 (the nullable migration and the reader census) is PR-2, which waits for Phase 233 per the ROADMAP and for a free migration lane.

**Decided autonomously**
- [FACT-05] Q: "Where do the FACT-05 tests live?" → Selected: "a `page.key-pill.test.tsx` case per state (failed, stalled, never_started) asserting the rendered sentence, with the existing `it.each` over those states re-pointed rather than deleted" — test layout only; it is the TODOS closing condition.
- [FACT-05] Q: "Does the in-progress note (KCS12-MINT-A) change?" → Selected: "No. Something is running, so a wait is true there" — one copy constant, untouched.
- [FACT-05] Q: "Do the `analytics_failed` and `finished_not_built` notes change?" → Selected: "No. 170.1 D-08 already gave them action-naming notes" — untouched constants.
- [FACT-03] Q: "What shape is the reader census?" → Selected: "a vitest source-reading pin that lists every reader of `strategy_analytics.computed_at` with a classification and fails on an unclassified one" — a test file, cheap to reshape.
- [Ship] Q: "Which TODOS entries are deleted, and when?" → Selected: "`[170.1-STRATEGIES-NOTE-WAIT-WORDING]` in PR-1, `[166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT]` in PR-2, each named in its CHANGELOG entry" — CLAUDE.md rule (b).

### Claude's Discretion
- The exact sentence for each new note, within DESIGN.md's voice and the house rule that a note states what the link shows now and then the action. The planner and UI-SPEC draft it; reuse the existing `ownerRemedy` remedy texts and ids where the action is the same.
- How a published row's note learns the state it needs: today `armOf` reads no jobs for a published row (167.2-REVIEW IN-04) and passes `state: null`. The planner decides whether `PUBLIC_URL_NOTE` takes a state-free action sentence or the published path reads the state, weighing the one-RPC-per-row cost IN-04 removed.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (CONTEXT also fences out: Phase 237's factsheet seam beyond what a `computed_at` reader census requires in PR-2; STALE-01 `[166.5-STALE01-PREMISE]`; the PDF mixed-vintage window `[166.5-PDF-MIXED-VINTAGE-WINDOW]`.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FACT-03 | A never-computed analytics row never reads "Analytics last computed", and freshness checks never take its insert time as a compute time. Founder ruled nullable `computed_at` (reverses CONTEXT R-04). (REQUIREMENTS.md line 122) | PR-2: measured reader census (section "PR-2 reader census"), migration design with a lint-passing fail-loud guard, tested on a throwaway PostgreSQL 16 cluster (section "PR-2 migration design"), NULL-arm table, census-test design, PROOF-01 neuter points. |
| FACT-05 | For a failed, stalled or never-started row, the /strategies note never tells the owner to wait. (REQUIREMENTS.md line 124) | PR-1: every UI-SPEC code claim re-verified at HEAD, the structural facts that shape the change (TDZ on `shapeOf`, `failedFacts` built after `shareNotes`, import cycle), and the full list of files and tests that move. |
</phase_requirements>

## Summary

**PR-1 is implementable exactly as the UI-SPEC says, with no new RPC.** `armOf` already returns `{ arm, state, jobDay, compositeHistory }` from the row's one jobs read, `failedFactsOf` already returns the same triple for the published rows whose Health is `Analytics failed` or `Stale (no data yet)`, and `viewerRemedyAction(ownerRemedy(state, shape, id))` is the rule the `strategies.stale-no-data` detail line already runs. Three structural facts decide how the change is cut (section "PR-1 structure"): `shareNotes` is built before `shapeOf` and before `failedFacts` exist, so the note must be a descriptor that `noteFor` resolves (or `shapeOf` must be hoisted and the published case deferred); `shareNotes` is `Map<string, string>` today and must carry an action id; and `degrade-warnings.ts` value-imports `status-surface-copy.ts`, so the composition (lead plus action sentence) cannot import `ACTION_SENTENCES` into the copy module without a cycle. The UI-SPEC names about half of the tests that must move; the full list is below, including five `MINT_B` and five `PUBLIC` sites in `page.key-pill.test.tsx` and the `DISTINCT_FLOOR = 50` anti-vacuity floor in `status-surface-copy.test.ts`.

**PR-2 is a migration whose one-time backfill can only be proven by executing the migration file against seeded rows.** A lane gate cannot do it (the lane replays migrations over an empty database), so the PROOF-01 vehicle is a `*-sql-exec.test.ts` file in the style of `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` that boots a throwaway cluster, cuts the real `strategy_analytics` table and its three trigger functions out of the repo, seeds one row per status and figure combination, and applies the real migration text. This session ran that experiment by hand on PostgreSQL 16.13 and measured four things: (1) a plain backfill UPDATE is defeated by the hold trigger on `failed` and `computing` rows; (2) `ALTER TABLE ... DISABLE TRIGGER` around the UPDATE, re-`ENABLE`d before the end of the transaction, backfills them; (3) a `PERFORM 1 FROM ... WHERE <predicate>; IF FOUND THEN RAISE` guard fails loud when the trigger is left on, and passes `lint-migration-data-dependence.mjs` (the `IF EXISTS (SELECT ...)` and `count(*) INTO v` spellings are refused by it as R2 and R1); (4) the rollback cannot restore NOT NULL without disabling the same trigger, and writes the epoch, the instant the factsheet already treats as "never computed". `ALTER TABLE ... DISABLE TRIGGER` has **no precedent** in `supabase/migrations/` (one migration says it deliberately does not use it); migration-reviewer must be told that.

**The reader census is wider than a token grep.** 55 non-test `src/` files carry the token (comment-stripped), 9 non-test Python files carry the quoted literal, 4 SQL objects read or write the strategy column, and two read shapes a token cannot see (the `strategy_analytics (*)` wildcard embed at `src/lib/queries.ts` and the `complete` + NULL rows that branch (c) of the status bridge can now create, on its INSERT arm and on its UPDATE arm). Most TS readers already have a NULL arm; the three that do not are the factsheet Terms row, the footer stamp (both print the 1970 sentinel as `Jan 1, 1970`) and the generated `database.types.ts`.

**Primary recommendation:** Ship PR-1 first as the UI-SPEC describes, cut as "descriptor in `shareNotes`, resolved in `noteFor`", with `Action` exported from `DegradeLine.tsx`. Plan PR-2 as: probe PROD for the predicate (wave 0), migration with `DISABLE`/`ENABLE TRIGGER` and a `PERFORM ... IF FOUND` guard, a node-environment `*-sql-exec.test.ts` as the backfill and rollback proof, a vitest reader census modelled on `src/__tests__/recompute-verdict-census.test.ts`, `computed_at: string | null` with `tsc --noEmit` as the property-reader half of the census, and D3/D4 fixed by recognising the existing epoch sentinel (not by changing the payload type).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Choose the share-note sentence for a row | Frontend Server (SSR) | — | `/strategies` is an async server page; the jobs read, the shape and the viewer role are all server-side facts. |
| Render the note's one action link | Frontend Server (SSR), rendered through the shared `DegradeLine` action renderer | Browser (client bundle, because `FactsheetView` is `"use client"`) | The renderer has no client directive and is already mounted from both server and client trees. |
| Owner pending-page note (`/factsheet/[id]`) | Frontend Server (SSR) builds the node | Browser (`OwnerUnpublishedPanel`, `"use client"`, receives it as a prop) | The page already derives the owner's remedy server-side; the panel only places the note. |
| Never-computed encoding (NULL date) | Database / Storage | — | A column constraint plus a one-time backfill; the writers (analytics runner, composite stitch) stay the only stampers. |
| Hold-until-success of the date | Database / Storage (BEFORE UPDATE trigger) | — | Already table-level; it keeps NULL held for a never-computed row with no change to its body. |
| NULL arm of each reader | API / Backend and Frontend Server per reader (see census) | Browser for the render components | Each reader owns its own NULL arm; the census pins that none was missed. |
| Census of readers | Test layer (vitest source scan) | `tsc --noEmit` for property readers | A token scan cannot see wildcard embeds or typed property access. |

## Standard Stack

No new library is introduced by either PR. Everything below is existing in-repo infrastructure that the plans must reuse and not re-implement.

### Core

| Item | Where | Purpose | Why standard here |
|------|-------|---------|-------------------|
| `ownerRemedy`, `REMEDY_RULES`, `shapeRemedy` | `src/lib/status-surface-copy.ts` | The one source of the action per state and shape | The founder ruled "reuse the remedy". |
| `ACTION_SENTENCES`, `viewerRemedyAction`, `ownerRemedyAction`, `ANALYTICS_FAILED_ACTIONS` | `src/lib/degrade-warnings.ts` | The action vocabulary and the viewer mapping | `degrade-warnings.test.tsx` already sweeps `ownerRemedy` against it. |
| `DegradeLine` (file-local `Action`) | `src/components/degrade/DegradeLine.tsx` | Renders an action sentence with its one link | The Health detail on the same row already renders through it. |
| `stripCommentsPreserveLines` | `src/lib/source-scan.ts` | The one comment handler for structural guards | Used by every census in `src/__tests__`. |
| `src/__tests__/recompute-verdict-census.test.ts` | repo | The census pattern: `file::symbol` exact counts, closed class set, planted self-tests, anti-vacuity floors | Phase 237's own answer to the same question ("every reader of X, classified, fails on a new one"). |
| `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` | repo | Boots a throwaway cluster via `scripts/pg-lane/run.sh --print-pgbin`, cuts real tables and function bodies from the repo, executes a one-time SQL file, measures byte-identical decoys | The only way a one-time backfill is exercised before PROD. |
| `scripts/lint-migration-data-dependence.mjs` | repo | Refuses a data-reading `DO` guard (R1 to R5) | CI `sql-gate-lint`; no opt-out marker exists. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Descriptor in `shareNotes`, resolved in `noteFor` | Move the whole `shareNotes` block below `failedFacts` | A ~125-line move across the probe fan-out for no behavioural gain; the descriptor keeps the diff local. |
| Recognise the epoch sentinel at D3/D4 | Pass `null` through `FactsheetPayload.computedAt` | Changing the payload type to `string \| null` ripples into `src/lib/factsheet/types.ts`, `build-payload.ts`, `allocator-portfolio-payload.ts`, `scenario-factsheet-payload.ts`, the census fixtures and `FreshnessChip`, and needs the `factsheet-v2-payload-v27` cache key bumped. The sentinel route touches two render sites and one shared constant. |
| `ALTER TABLE ... DISABLE TRIGGER` around the backfill | Re-issue `strategy_analytics_hold_computed_at_until_success()` to let an explicit NULL through | Re-issuing the function moves its snapshot under `supabase/schema/functions/`, the `baseline-content-drift` floor and the RED-UNDER-M twins in `test_strategy_analytics_computed_at_success_only.sql`, whose header says a twin's edit must land on a definition nothing later replaces. DISABLE/ENABLE changes no function body. |

**Installation:** none. **Version verification:** not applicable, no package is added.

## Package Legitimacy Audit

**No packages are installed by this phase.** `gsd-tools query package-legitimacy check` and the research-plan seam were not run, because nothing external is fetched: every finding below comes from reading this repository, running its own scripts, and one throwaway local PostgreSQL cluster.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none. **Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### PR-1 system diagram (one `/strategies` request, share-note path)

```
GET /strategies (async server page)
  |
  +-- owner list read (rows, analytics embed) ------------------------------+
  |                                                                          |
  +-- per row s: mode = shareAffordanceMode(isPublished)                     |
  |     |                                                                    |
  |     +-- embed computed + buildable? --yes--> no note                     |
  |     +-- probe could not check -----------> PROBE-UNREADABLE (unchanged)  |
  |     +-- unbuildable kind ----------------> UNBUILDABLE-* (unchanged)     |
  |     +-- not computed / in flight:                                        |
  |           unpublished: armOf(s) = ONE jobs read -> {arm,state,history}   |
  |               arm in_progress ----> MINT-A (unchanged)                   |
  |               arm unreadable  ----> UNREADABLE (unchanged)               |
  |               arm not_available:                                         |
  |                  kind (analytics_failed / finished_not_built) -> as today|
  |                  else  descriptor { lead, state, history }  <-- NEW      |
  |           published: descriptor { public-uncomputed }       <-- NEW      |
  |                                                                          |
  v                                                                          |
rows + signals + rank reads -> healthByRow -> failedFacts (ONE read per      |
  Analytics-failed / Stale-no-data row; published rows get their own read) <-+
  |
  v
noteFor(s):
  descriptor -> shape = shapeOf(s, history)
             -> actionId = viewerRemedyAction({ remedy: ownerRemedy(state, shape, id),
                                                 managerSurface: isManager, shape })
             -> <p data-testid="strategy-row-share-note" data-degrade-id="strategies.share-note">
                  LEAD + " " + <Action id={actionId} strategyId={id}/> </p>
  published descriptor -> state from failedFacts.get(id):
        unknown/unreadable -> PUBLIC-UNKNOWN (string, ContactPointerText)
        queued/retrying/running -> PUBLIC (unchanged words)
        finished -> public finished_not_built (existing)
        failed/stalled/never_started -> PUBLIC-LEAD + action
```

### PR-1: UI-SPEC claims, re-verified at HEAD

| UI-SPEC claim | Verdict | Evidence |
|---|---|---|
| `armOf` returns the arm and ComputeState once per row | CONFIRMED | `src/app/(dashboard)/strategies/page.tsx:195-201` `interface ArmFacts { arm: RecipientArm; state: ComputeState \| null; jobDay: string \| null; compositeHistory: CompositeHistory; }` and `:286` `return { arm: recipientArm(state), state, jobDay, compositeHistory };` |
| `armOf` skips the read for a published row and passes `state: null` | CONFIRMED | `:767-774` `if (mode === "public-url") { return Promise.resolve({ arm: "not_available", state: null, jobDay: null, compositeHistory: "unreadable", }); }` |
| `failedFactsOf` reads a published row's jobs only for Health `analytics_failed` or `stale_no_data` | CONFIRMED | `:1107-1116` the `failedFacts` map filters on `kind === "analytics_failed" \|\| kind === "stale_no_data"`; `:1058-1062` an unpublished row reuses `armOf`, a published row does its own `readOwnerComputeJobs` |
| `viewerRemedyAction(ownerRemedy(...))` is the rule the Health detail runs | CONFIRMED | `:1176-1186` `const remedy = ownerRemedy(state, shape, s.id);` ... `action: viewerRemedyAction({ remedy, managerSurface: isManager, shape }),` |
| The viewer mapping returns an id that is already in `ACTION_SENTENCES` | CONFIRMED | `src/lib/degrade-warnings.ts:401-413` `ANALYTICS_FAILED_ACTIONS = ["A-CONTACT-RESOLVE","A-OWNER-RELOAD","A-RELOAD","A-CONTACT-CHECK","A-RESYNC-EDIT","A-LINK-KEY-EDIT","A-COMPOSITE-CONTACT","A-CSV-FIXED","A-EXCHANGES-KEY"] as const satisfies readonly ActionId[]` |
| `recipientArm` maps stalled, failed, finished, never_started to `not_available` | CONFIRMED | `src/lib/compute-state.ts:570-574` `case "stalled": case "failed": case "finished": case "never_started": return "not_available";` |
| The share `<p>` keeps its marker and test id | CONFIRMED | `page.tsx:1291-1303` `data-testid="strategy-row-share-note"` `data-degrade-id="strategies.share-note"` `className="text-caption font-normal text-text-muted"` |
| `DegradeLine`'s action renderer must be exported | CONFIRMED needed | `src/components/degrade/DegradeLine.tsx:62` `function Action({ id, strategyId }: { id: ActionId; strategyId?: string })` is file-local; `DegradeLine` itself needs a registry `id` and cannot render a marker-only entry |
| `OwnerUnpublishedPanel` is the second caller of the same constant | CONFIRMED | `src/app/factsheet/[id]/v2/page.tsx:929-939` `recipientShareNoteFor("mint-token", recipientArm(ownerStatus.state), ownerBuildability?.kind ?? null)`; panel prop `shareNote?: string` at `FactsheetView.tsx:1399`, rendered `:1432-1439` through `ContactPointerText` |
| `strategies.share-note` is a marker-only registry entry | CONFIRMED | `src/lib/degrade-warnings.ts:1083-1090` `id: "strategies.share-note", surface: "strategies-list", class: "share_status", scope: "none", action: null,` |
| `page.tsx` `tripHits` is 3 | CONFIRMED | `src/__tests__/degrade-warning-scan.test.ts` ledger row for `LIST_PAGE`: `tripHits: 3`; the action renderer adds no `role`, `aria-live` or warning class |
| The `it.each` fixtures resolve to `failed` -> CONTACT-RESOLVE, `never_started` -> LINK-KEY-EDIT, `stalled` -> RELOAD | CONFIRMED BY READING, re-run to be certain | `strategy-shape.ts:177-183` `resolveStrategyShape`: a stitch job with no key and no members gives `compositeHistory "seen"` -> `"unknown"` -> `ownerRemedy` returns the retry-read remedy -> `A-RELOAD`; `jobs: []` gives history `none` -> `"unlinked"` -> `A-LINK-KEY-EDIT`; `failed_final` with `error_kind: "permanent"` -> `failed_permanent` -> `A-CONTACT-RESOLVE` regardless of shape |

**One correction to the UI-SPEC's wording.** Row 8 of its §1.1 table (published, state known `queued`/`retrying`/`running` -> `KCS12-PUBLIC`) is reachable only for a `Stale (no data yet)` published row, because that is the only published, kind-less case whose jobs are read. `src/lib/strategy-health.ts` (`strategyHealthOf`) gives `Updating` to any `pending` or `computing` embed, and `deriveEmptySeriesState` (`src/lib/closed-sets.ts`) gives `computing` to a missing embed younger than `MISSING_ROW_COMPUTING_WINDOW_MS` (16 h). So a published `pending`/`computing` row with running jobs (today's `FIRST-COMPUTE-PUBLISHED`, `PUBLIC`, `PUBLIC-NO-READ` and `D-08 PUBLISHED-FINISHED` fixtures) gets **no** jobs read and therefore `KCS12-PUBLIC-UNKNOWN`. A fixture that reaches `KCS12-PUBLIC` needs a missing analytics row older than 16 h plus a running job.

### PR-1 structure: three facts that shape the change

1. **`shareNotes` is `Map<string, string>` and is built before everything the action needs.** `page.tsx:814` `const shareNotes = new Map<string, string>(` is built at lines 814-939; `rows` (which needs the `signals` and `own` reads) is built at `:1007`, `healthByRow` at `:1037`, `failedFacts` at `:1107`, and `shapeOf` is a `const` arrow at `:1119`. Calling `shapeOf` from inside the `shareNotes` build is a temporal-dead-zone `ReferenceError`. `shareNotes` is read in exactly one place (`noteFor`, `:1257`).
   - **Recommended cut:** make each map value a descriptor (`{ kind: "text"; text }` for every unchanged note, `{ kind: "remedy"; state; compositeHistory }` for an unpublished kind-less `not_available` row, `{ kind: "public-uncomputed" }` for a published kind-less row) and resolve it in `noteFor`, where `shapeOf`, `isManager` and `failedFacts` all exist. Keep the `entry[1] !== null` filter semantics. This needs no read re-ordering and no hoist. (If the planner prefers to compute eagerly, `shapeOf` only depends on `memberCountOf` at `:746`, so it can be hoisted above `shareNotes`, but the published case still needs `failedFacts`, so the descriptor is needed anyway.)
2. **A published row's state comes from `failedFacts`, resolved late.** For a published kind-less row: state unknown or `unreadable` -> `KCS12-PUBLIC-UNKNOWN`; `queued`/`retrying`/`running` -> `KCS12-PUBLIC`; `finished` -> the existing `PUBLIC_UNBUILDABLE_NOTES.finished_not_built` (via `unbuildableNoteKindOf("not_computed", { jobsFinished: true })`); `failed`/`stalled`/`never_started` -> `KCS12-PUBLIC-LEAD` + action. `armOf` keeps returning `state: null` for a published row, so IN-04's removed RPC stays removed, and the existing arm comment at `:763-764` ("so a published row can never take the finished-not-built kind") becomes untrue and must be rewritten.
3. **Import cycle.** `src/lib/degrade-warnings.ts` value-imports `./status-surface-copy` (`KCS10_PUBLIC_SENTENCE`, `ownerStateIsDated`, `ownerStateLine`, `untrustedKeyCaption`), so `status-surface-copy.ts` cannot value-import `ACTION_SENTENCES` without a cycle. Keep the copy module dependency-free: it owns the two leads and `KCS12-PUBLIC-UNKNOWN`; the composition `lead + " " + ACTION_SENTENCES[id].sentence` happens in a file that already imports both (the page, `v2/page.tsx`), or in a new `src/lib/` module that imports both. The string API of `recipientShareNote` can stay total by making its `mint-token` / `not_available` answer `lead + " " + CONTACT_CHECK_REMEDY.before` (the contact-form remedy is already in `status-surface-copy.ts` and is true in every state and for every role; it is also the house fallback `ownerRemedyAction` uses, `?? "A-CONTACT-CHECK"`), which keeps the existing sweep tests meaningful and never renders a half sentence.

### PR-1 files that change (non-test)

| File | Change |
|---|---|
| `src/lib/status-surface-copy.ts` | Add the two leads (`KCS12-MINT-B-LEAD`, `KCS12-PUBLIC-LEAD`) and `KCS12-PUBLIC-UNKNOWN`; retire the `MINT_TOKEN_NOTES.not_available` sentence (type becomes `Record<Exclude<RecipientArm, "not_available">, string>` or the key is kept for totality and never reached; the UI-SPEC grep invariant decides); `PUBLIC_URL_NOTE` keeps its words for the known-running case; update the docblocks at `:464-477`, `:609-621`, `:635-646`. Current text, `:452-462`: `not_available: "Right now, a private link to this strategy shows that its factsheet is not available yet. The numbers appear there once a computation succeeds.",` and `const PUBLIC_URL_NOTE = "Right now, this strategy's factsheet link shows that the factsheet is not available yet. The numbers appear there once a computation succeeds.";` |
| `src/components/degrade/DegradeLine.tsx` | `export` the `Action` renderer (rename to a public name; `knip` requires a user, and there are two). |
| `src/app/(dashboard)/strategies/page.tsx` | Descriptor values in `shareNotes`; `uncomputedNote` returns the descriptor for the kind-less arm; resolve in `noteFor`; the `<p>` stays here with its two attributes; refresh the comments at `:758-766` and `:784-791`. Keep the `<p>` in `page.tsx`: moving it to a new file under `strategies/` makes that file a walked file for `degrade-warning-scan.test.ts` and moves the `strategies.share-note` ledger row. |
| `src/app/factsheet/[id]/v2/page.tsx` | Build the panel note from `KCS12-MINT-B-LEAD` plus the action of the page's own `ownerRemedyLine` (`ownerRemedyAction(ownerRemedyLine)`), for the kind-less `not_available` case only. |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | `OwnerUnpublishedPanel`'s `shareNote?: string` becomes `string \| ReactNode`; a string keeps the `ContactPointerText` path, a node renders as is. The file is `"use client"`; a server-built node is passed as a prop (precedent in the repo: the strategies page passes server-built `note` nodes into the client table, `page.tsx:1309-1316`; tagged `[ASSUMED]` for this exact prop until the executor's render test and `tsc` pass). |
| `TODOS.md` | Delete `[170.1-STRATEGIES-NOTE-WAIT-WORDING]` (line 281) in the same PR. No test or script reads that id (grep over `src/`, `scripts/`, `e2e/`: none). |
| `CHANGELOG.md`, `VERSION`, `package.json` | CLAUDE.md "CHANGELOG discipline": one entry written before the push, naming the deleted TODOS id; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`. The ship branch must change nothing under `.planning/`. |

### PR-1 tests that must move (line numbers measured at HEAD `4b89c54cb`; re-grep before editing)

**`src/app/(dashboard)/strategies/page.key-pill.test.tsx`** (constants `MINT_B` at `:778-779`, `PUBLIC` at `:782-783`)

| Site | Today | After PR-1 (derive by running; reasoning below) |
|---|---|---|
| `:1289` race test, stitch `failed_final` permanent, no key, no members | `MINT_B` | `KCS12-MINT-B-CONTACT-RESOLVE` (`failed_permanent` ignores shape) |
| `:1432` `MINT-B` test, same stitch job | `MINT_B` | `KCS12-MINT-B-CONTACT-RESOLVE` |
| `:1498`, `:1499` `s-comp` / `s-pend`, same stitch job | `MINT_B` | `KCS12-MINT-B-CONTACT-RESOLVE` |
| `:1592` `IN05-ZERO-UNLINKED`, no key, no members, stitch `failed_final` with no `error_kind` plus a newer chain job | `MINT_B` | shape `unknown` (history `seen`) -> `A-RELOAD` -> `KCS12-MINT-B-RELOAD` |
| `:1856` `REASK`, 100 `cron` rows then exhaustive at 1000, no chain job | `MINT_B` | history `none`, no key -> `unlinked` -> `KCS12-MINT-B-LINK-KEY-EDIT` |
| `:1747` `it.each` over `variants` (`:1671-1745`) | `stalled`, `failed`, `never_started` all `MINT_B` | re-point: `stalled` -> `KCS12-MINT-B-RELOAD`, `failed` -> `KCS12-MINT-B-CONTACT-RESOLVE`, `never_started` -> `KCS12-MINT-B-LINK-KEY-EDIT`. Re-point, do not delete (CONTEXT). |
| `:1361` `FIRST-COMPUTE-PUBLISHED` (published, `computing`, running job) | `PUBLIC` | `KCS12-PUBLIC-UNKNOWN` (no jobs read for an `Updating` row) |
| `:1562` `PUBLIC` (published `pending`, running) | `PUBLIC` | `KCS12-PUBLIC-UNKNOWN` |
| `:1603` `PUBLIC-NO-READ` (published `pending`, jobs RPC errors) | `PUBLIC` | `KCS12-PUBLIC-UNKNOWN`; the `rpcCalls === []` and no-error-log assertions stay |
| `:1777` `D-08 PUBLISHED-FINISHED` (published `pending`, jobs finished) | `PUBLIC` | `KCS12-PUBLIC-UNKNOWN`; `rpcCalls === []` stays (UI-SPEC re-points it) |
| `:1336` `HELD-RERUN-PUBLISHED` `not.toContain(PUBLIC)` | passes | still passes but becomes weaker; add `KCS12-PUBLIC-UNKNOWN` to the negative |
| comments at `:1021-1042`, `:1304`, `:1317`, `:1620` | cite the retired wording | refresh |

The per-state cases CONTEXT asks for (`failed`, `stalled`, `never_started`) go in this file with typed-out sentences. **The file's profile mock fixes the viewer role to `manager`** (`:373` `maybeSingle: async () => ({ data: { role: "manager" }, error: null })`), so the allocator-only matrix (UI-SPEC Test Contract 3) belongs in `page.merged.test.tsx`, which has `asRole(...)`, `noDataRow(...)` and `failedRow(...)`.

**`src/app/(dashboard)/strategies/page.merged.test.tsx`:** add the role-by-action matrix, the parity test (a `Stale (no data yet)` row: the detail's trailing action sentence equals the note's) and the published cases. Existing container-wide assertions that already protect the viewer rule stay valid and are the neuter sentinel for `managerSurface`: `a[href*="/edit"]` null at `:1402`, `:1468`, `:1517`, `:1547`; `a[href*="/strategies/new"]` null at `:1403`, `:1413`, `:1484`. Re-run the whole file: a Stale (no data yet) row now carries a second link-bearing line.

**`src/app/(dashboard)/strategies/page.table.test.tsx` (`:600-630`):** asserts the footer has 3 children with the note last; expected to hold. **`page.share-affordance.test.tsx`:** no note-text assertion found; re-run.

**`src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx`:** `MINT_B` literal at `:910`; `SHARE-NOTE-B` at `:956-964` (TRIGGER_ROWS is a permanent `stitch_composite` failure, so the new panel note is `Right now, a private link to this strategy shows that its factsheet is not available. Use the contact form to have it resolved.` and the test should also assert the same action ends the page's remedy line); the loop at `:1000-1002` `for (const note of [MINT_A, MINT_B, MINT_UNREADABLE])` stays valid; comments at `:1276`, `:1294`.

**`src/lib/status-surface-copy.test.ts`:** `KCS12-MINT-B` pin (`:278-282`), `KCS12-PUBLIC: public URL, any arm` (`:290-296`, no longer true for every arm), `SELECTION: no unbuildable kind is exactly recipientShareNote` (`:423-427`), `H-2 NO FALSE TAIL` (`:462-474`, extend to the kind-less `not_available` arm), the `no share note names an address` loop (`:~772`), and the **anti-vacuity walk** at `:761-838`: `DISTINCT_FLOOR = 50` is documented as exactly "17 state lines + 8 remedies + 4 arm notes + 12 unbuildable notes + 2 probe notes + 7 exported constant strings", so retiring `MINT-B` lowers the count and adding the composed notes to `everyRenderedString()` raises it. Re-measure and raise the floor ("Never lower it to fit").

**Unchanged pins that must stay green:** `strategies.share-note` marker-only pin in `src/lib/degrade-warnings.test.tsx` (`:223`, `:999`), the `ownerRemedy` to `ACTION_SENTENCES` sweep there, `src/__tests__/degrade-warning-scan.test.ts` (re-measure `tripHits` 3 and the id set for `LIST_PAGE`, and the factsheet rows if `FactsheetView.tsx` or `v2/page.tsx` change), `src/__tests__/no-email-in-copy.test.ts` (walks exported copy by value), `src/__tests__/copy-census.test.ts` (rule A retires `portfolio|book|favorites|starred|preference|my strategies|My Allocation|My Watchlist|Bridge`; rule B matches glossary labels; the new sentences use none of them, but run it, because `status-surface-copy.ts` is scanned).

### PR-1 exact copy

Typed out in `238-UI-SPEC.md` (Copywriting Contract, 8 private-link rows, 8 public rows, the two leads and `KCS12-PUBLIC-UNKNOWN`). Not repeated here. Grep invariants from the UI-SPEC: no new row contains `yet`, `once a computation succeeds`, `appear there` or `wait`; the 16 lead-plus-action rows never contain `no computation is running`; only `KCS12-PUBLIC-UNKNOWN` uses it, as a condition.

### PR-2 reader census (measured)

**Method.** `src/lib/source-scan.ts` `stripCommentsPreserveLines` over every non-test `.ts`/`.tsx` under `src/`, token regex `\b(computed_at|computedAt|analytics_computed_at|last_success_computed_at)\b`: **55 files hit, 758 walked**. Python: quoted `"computed_at"` / `'computed_at'` on non-comment lines of non-test `analytics-service/**/*.py`: **9 files, 38 hits**. SQL: `supabase/schema/functions/*.sql` (137 snapshot files, regenerated by `npm run schema:functions` and gate-checked in the same PR as any body change) plus the views in `supabase/schema/baseline.sql`. Comment-only mentions (stale-comment candidates) are listed after the table.

**Classes (closed set; extend `recompute-verdict-census`'s `LEGAL_CLASSES` idiom):** `reader-render` (prints a date), `reader-fresh` (freshness verdict or score), `reader-key` (cache key, ETag, equality baseline), `reader-evidence` (snapshot binding, held re-run, resume or re-run freshness), `plumbing` (select list, type, prop, passthrough, no decision), `sort-name` (the column name as a sort option), `writer-stamp`, `synthetic` (not a column read), `excluded-generated`, `other-table`.

**TS, by file (`token:count` comment-stripped; classes are research proposals for the census map):**

| File | Tokens | Class | NULL arm at HEAD |
|---|---|---|---|
| `src/components/strategy/SyncBadge.tsx` | `computedAt:4` | reader-render | present: `computedAt ? new Date(computedAt) : null` then suffix only when finite (`:254-258`) |
| `src/components/admin/AdminTabs.tsx` | `computed_at:3` | reader-render | present: `computeRecency` returns `—` unless `everComputed`; type `computed_at: string` at `:78` must become `string \| null` |
| `src/components/strategy/FactsheetPreview.tsx` | `computedAt:6` | reader-render | present: `dateLabel` null for a falsy value |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | `computedAt:9` | reader-render | `FreshnessChip` has the sentinel arm; **footer stamp `:3439` has none** |
| `src/app/factsheet/[id]/v2/MandatePanels.tsx` | `computedAt:1` | reader-render | **none**: `formatDay(payload.computedAt)` on the sentinel prints `Jan 1, 1970` |
| `src/lib/freshness.ts` | `computedAt:9` | reader-fresh | present: `computeFreshness(null)` returns `stale` (`:81`) |
| `src/lib/health-score.ts` | `computedAt:3`, `computed_at:1` | reader-fresh | present: `if (!computedAt) return 0;` (`:27`) |
| `src/components/strategy/FreshnessBadge.tsx` | `computedAt:11` | reader-fresh | present (NaN timestamp); generic, callers decide the table |
| `src/app/factsheet/[id]/v2/page.tsx` | `computedAt:5`, `computed_at:3` | reader-key | present: `const computedAt = signAnalytics?.computed_at ?? "0";` (`:731`), cache key `["factsheet-v2-payload-v27", id, computedAt, tradesFetchedAtKey, provenanceKey, computationStatus]` (`:342`) |
| `src/app/api/factsheet/[id]/pdf/route.ts` | `computed_at:2` | reader-key | present: `` `"${id}:${analytics.computed_at ?? ""}${hold.updating ? ":held" : ""}"` `` (`:328`) |
| `src/components/strategy/SyncProgress.tsx` | `computedAt:4` | reader-evidence | NULL compares as a value: `(computedAt ?? null) !== evidenceBaseline.computedAt` (`:412`) |
| `src/components/strategy/ApiKeyManager.tsx` | `computed_at:2`, `computedAt:1` | reader-evidence | `computedAt: outcome.data?.computed_at ?? null` (`:978`) |
| `src/hooks/useStrategySyncPoller.ts` | `computedAt:1`, `computed_at:2` | reader-evidence | `data.computed_at ?? null` (`:245`) |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` | `computedAt:7`, `computed_at:8` | reader-evidence + plumbing | present: `existing?.computed_at ? Date.parse(...) : null`, fresh only when finite and under the window (`:963-971`) |
| `src/lib/finalize-rerun.ts` | `computedAt:3`, `computed_at:3` | reader-evidence | present: `Date.parse(computedAt ?? "")` NaN -> `enqueue: true, reason: "inputs_changed"` (`:172-174`) |
| `src/lib/stored-analytics-result.ts` | `computed_at:5`, `last_success_computed_at:2` | reader-evidence | present, **fails closed**: `isSameInstant` returns false unless both are strings (`:73-78`), so a NULL date never binds a `last_success_snapshot` |
| `src/lib/analytics-hold.ts` | `computed_at:1`, `last_success_computed_at:1` | reader-evidence | type only; flows into `isSameInstant` |
| `src/app/api/og/factsheet/[id]/route.tsx`, `src/lib/factsheet/og-metrics.ts` | `computed_at:2`, `:1` | reader-evidence (embed binds a derive hop's snapshot) | via `isSameInstant` |
| `src/app/api/admin/strategy-review/route.ts` | `computed_at:2` | reader-evidence | via `isSameInstant` |
| `src/app/api/strategies/[id]/returns/route.ts` | `computed_at:2` | reader-evidence | via `isSameInstant` |
| `src/lib/factsheet/fetch-and-build-payload.ts` | `computed_at:5`, `computedAt:2` | reader-render (creates the sentinel) + reader-evidence | `analytics?.computed_at ?? "1970-01-01T00:00:00Z"` (`:977`) |
| `src/lib/factsheet/build-payload.ts`, `src/lib/factsheet/types.ts`, `src/lib/factsheet/og-metrics.ts` | `computedAt:3`, `:1`, `computed_at:1` | plumbing | type `computedAt: string` |
| `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts` | `computed_at:1` | plumbing (select feeds `analyticsHold`) | n/a |
| `src/app/(dashboard)/admin/page.tsx` | `computed_at:1` | plumbing (select) | via `AdminTabs` |
| `src/components/strategy/StrategyGrid.tsx` | `computedAt:1`, `computed_at:1` | plumbing (`SyncBadge`, `HealthScore`) | via both |
| `src/components/strategy/StrategyHeader.tsx` | `computedAt:5` | plumbing (no caller at HEAD per UI-SPEC) | `{computedAt && ...}` |
| `src/components/strategy/StrategyTable.tsx` | `computed_at:3`, `computedAt:1` | sort-name + plumbing | `s.analytics.computed_at ?? ""` (`:654`) |
| `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` | `computedAt:2` | plumbing | via `FactsheetPreview` |
| `src/app/(marketing)/for-quants/page.tsx` | `computedAt:1` | plumbing (`null` literal) | n/a |
| `src/app/(dashboard)/compare/page.tsx` | `last_success_computed_at:1` | plumbing (deletes the alias) | n/a |
| `src/lib/utils.ts` | `computed_at:1` | plumbing (`EMPTY_ANALYTICS` `computed_at: ""`) | `""` is falsy everywhere it is read |
| `src/lib/types.ts` | `computed_at:7`, `last_success_computed_at:1` | `StrategyAnalytics.computed_at` (`:307`, becomes `string \| null`) is plumbing; the other four are `other-table` types | typecheck decides |
| `src/components/strategy/CustomizeDrawer.tsx`, `StrategyFilters.tsx`, `src/lib/discovery-prefs.ts`, `src/lib/discovery-types.ts` | `computed_at:1` each | sort-name | n/a |
| `src/app/(dashboard)/recommendations/page.tsx` | `computed_at:10`, `analytics_computed_at:2`, `computedAt:2` | **mixed**: match batch header (other-table, `:206`, `:435-437`) and the strategy select (`:295`) feeding `SyncBadge` (`:588`, `:622`), `computed ? row.analytics_computed_at : null` (`:411`) | present |
| `src/lib/queries.ts` | `computed_at:17`, `last_success_computed_at:3` | **mixed**: strategy projections and `usesLastSuccessSnapshot` (plumbing / reader-evidence); `portfolio_analytics` orders (`:2309`, `:2317`, `:6035`) and `allocator_equity_derived` (`:5286`, `:4906`) and `match_batches` (`:5192`) are other-table; the wildcard embed at `:1057` is invisible to the token | per site |
| `src/app/factsheet/[id]/v2/test-fixtures/census-payloads.ts` | `computedAt:1` | synthetic | n/a |
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` | `computedAt:1` (`""`) | synthetic | n/a |
| `src/lib/factsheet/allocator-portfolio-payload.ts` | `computedAt:3` | synthetic (portfolio) | **adjacent defect, out of scope**: `computedAt: meta.computedAt ?? new Date().toISOString()` claims "now" for a missing portfolio date |
| `src/lib/database.types.ts` | `computed_at:20`, `analytics_computed_at:1` | excluded-generated | `tsc` is its check |
| `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx`, `HoldingsTabPanel.tsx`, `components/OptimizerPanel.tsx`, `lib/watchlist-read.ts`, `src/components/portfolio/PortfolioOptimizer.tsx`, `src/lib/portfolio-analytics-adapter.ts`, `src/lib/intro/snapshot.ts` | | other-table (`portfolio_analytics`) | n/a |
| `src/app/api/admin/match/allocators/route.ts`, `src/lib/admin/match.ts`, `src/components/admin/AllocatorMatchQueue.tsx`, `MatchQueueIndex.tsx` | | other-table (`match_batches`) | n/a |

**Wildcard and implicit readers (a token cannot see these; the census needs a second pattern, `strategy_analytics\s*\(\s*\*\s*\)`, and the typecheck):**
- `src/lib/queries.ts:1057` `.select(\`*, strategy_analytics (*)\`)` in `getMyStrategies`, owner-scoped. Its rows type as `StrategyAnalytics`, so the `string | null` change reaches every consumer through the compiler, not through a grep.
- Select lists read this session that name no `computed_at` and need no NULL arm: `src/app/scenario-share/[token]/page.tsx:290` (`strategy_id, returns_series, data_quality_flags`), `src/app/api/bridge/outcome/[id]/curves/route.ts:211` (`strategy_id, returns_series`), `src/app/(dashboard)/admin/compute-jobs/page.tsx:65` (count only), `src/app/api/keys/sync/route.ts:569` and `src/app/api/strategies/csv-finalize/route.ts:1882` (`computation_status`), `src/hooks/useStrategySyncPoller.ts:289` (`computation_status, computation_error`). `src/lib/admin/match.ts:204` selects `STRATEGY_ANALYTICS_MATCH_COLUMNS` and `RECORD_SCALAR_ALIASES` (no `computed_at` in the token census of either file's strategy read) and `src/app/api/strategies/csv-finalize/route.ts:1560` selects `CLOCK_SAFETY_KPI_COLUMNS` plus `PERCENTILE_GATE_COLUMN`; neither constant's value was read, so a one-line check of those two constants is wave-0 work (Assumption A6).

**Python (quoted-literal census, 9 files, 38 hits):**

| File | Hits | Class |
|---|---|---|
| `services/analytics_runner.py` | 1 | writer-stamp (`"computed_at": "now"`, CSV and stored-trades success, `:2435`) |
| `services/job_worker.py` | 13 | writer-stamp (composite success, `:14458`); reader-evidence (`_last_success_snapshot` `:3541-3553`, the prestamp read `:11121`, NULL-safe via `_non_empty_str`); other-table (`allocator_equity_derived` upserts at `:4013`, `:4080`, `:4230`, `:10196`, `:16579`, `:17986`; `portfolio_analytics` order at `:15678`) |
| `services/mt5_parity_findings.py` | 4 | reader-render (ops report; `_minute(None)` returns `n/a`, `:175-179`) |
| `services/mt5_parity_capture.py` | 5 | reader-evidence (`isinstance(row.get("computed_at"), str)` guard, `:518-519`) |
| `routers/match.py`, `services/match_eval.py`, `services/feedback_engine.py` | 5, 6, 1 | other-table (`match_batches`) |
| `routers/portfolio.py` | 2 | other-table (`portfolio_analytics`, `:1176`, `:2009`, both read this session) |
| `services/allocator_positions.py` | 1 | other-table (`allocator_equity_derived`, `:1968`) |

The **writer** side already has a census: `analytics-service/tests/test_computed_at_stamp_census.py` pins the two Python stamp sites (`analytics_runner._mark_complete`, `job_worker.run_stitch_composite_job`) as success-only, DB-clock (`"now"`), and asserts no TS `strategy_analytics` payload names the column. PR-2's new census is the reader half and must not re-assert the writers.

**SQL (strategy column only; the other `computed_at` hits in `supabase/schema/functions/` are `match_batches`, `portfolio_analytics`, `strategy_analytics_series`, `bridge_outcomes.deltas_computed_at`):**

| Object | Role | NULL behaviour |
|---|---|---|
| `strategy_analytics_hold_computed_at_until_success()` | restores `OLD.computed_at` on a write to `failed` or `computing` | with OLD NULL it holds NULL: no body change needed |
| `get_allocator_recommendations(uuid)` | `sa.computed_at AS analytics_computed_at` from a `LEFT JOIN strategy_analytics` | NULL passes through; the RETURNS TABLE column is already nullable in practice, and `recommendations/page.tsx` types it `string \| null` |
| view `ledger_refresh_staleness` (`baseline.sql`, not in the functions dir) | `"sa"."computed_at" AS "analytics_computed_at"`, informational; `is_stale` keys on status and the series | NULL passes through; the view's COMMENT is already stale (it says the bridge re-stamps on every transition) |
| `sync_strategy_analytics_status(uuid, uuid)` | writes no date on any path (166.5 D-03) | see "complete plus NULL" below |

**Writers and INSERT sites, reconciled.** TODOS `[166.5-COMPUTED-AT-NEVER-COMPUTED-DEFAULT]` says "5 in the baseline, including the wizard RPCs and `finalize_csv_strategy_with_returns`". Measured at HEAD with a multi-line-aware regex over `supabase/schema/baseline.sql` (`INSERT\s+INTO\s+("public".)?"strategy_analytics"\s*[\s(]`): **3** sites, all inside `sync_strategy_analytics_status` (`baseline.sql:12004`, `:12107`, `:12276`), and `finalize_csv_strategy_with_returns` has 0 mentions of `strategy_analytics` in its snapshot. The TODOS count is stale at HEAD. `UPDATE strategy_analytics ... SET` sites: `apply_okx_archive_rebuild` (`:1675`), `cutover_strategy_metrics_keys_atomic` (`:4284`), `set_wizard_composite_members` (`:10724`), the bridge (`:12158`, `:12279`); none sets `computed_at`. TS writers (`finalize-wizard/route.ts:2539`, `:2684`, `csv-finalize/route.ts:1921`, `keys/sync/route.ts:593`) upsert `computation_status: "failed"` with no date, so after DROP DEFAULT a first-ever failed row is NULL, which is the intent.

**"complete plus NULL" is reachable, and it is the one new state.** `baseline.sql:12276-12277`: `INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at, computation_error_source, computation_error_job_id) VALUES (p_strategy_id, 'complete', NULL, NULL, NULL, NULL)`. Branch (c) inserts a `complete` row with no figures when a non-side job finishes and no analytics row exists, and its `ON CONFLICT ... DO UPDATE SET computation_status = CASE ... ELSE 'complete' END` (`:12278-12298`) moves an existing `pending`/`computing`/`failed-without-sentence` row to `complete` without touching `computed_at`. Before PR-2 such a row carried the insert-time default; after PR-2 it carries NULL (the hold trigger keeps OLD, and OLD is NULL). It stores no figures, so NULL is the honest value, but every reader must tolerate `complete` with NULL (the table above shows they do, except D3/D4). The backfill deliberately leaves `complete` rows alone (see predicate), so a pre-existing `complete` row with an insert-time date and no figures would keep its false date; the wave-0 probe must count them (expected 0; CONTEXT measured only `failed`).

**Comment-only mentions to refresh in the same PR (stale after the change, not behaviour):** `src/lib/queries.ts` (`:704`, `:739-757`, `:976`), `src/lib/types.ts` (`:452`), `src/components/strategy/StrategyTable.tsx` (`:274-276`, `:1938-1975`), `src/components/admin/AdminTabs.tsx` (`:389`), `src/lib/stored-analytics-result.ts` (`:11`), `src/app/factsheet/[id]/v2/FactsheetView.tsx` (`:1710`), `supabase/schema` view COMMENT (re-dump owns it).

**Census validity.** Phase 233's FRESH-02 (an arm of `ops_staleness_check()` or its own check) is a future reader. The census is measured at `4b89c54cb` and must be re-run when 233 merges and before PR-2 executes.

### PR-2 migration design (tested)

**Version.** Pick a timestamp above the PROD tip at execution time (backdate policy, `.github/workflows/migration-policy.yml`); re-pick after 233 merges. Header, `SET LOCAL lock_timeout = '3s';`, no explicit `BEGIN`/`COMMIT` (Supabase wraps one implicit transaction), house conventions as in `supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql`.

```sql
SET LOCAL lock_timeout = '3s';

-- STEP 1: nullable, no default (founder ruling A, reverses 166.5 R-04). Metadata-only.
ALTER TABLE public.strategy_analytics
  ALTER COLUMN computed_at DROP DEFAULT,
  ALTER COLUMN computed_at DROP NOT NULL;

-- STEP 2: backfill. The hold trigger restores OLD.computed_at on every UPDATE whose NEW status is
-- failed or computing, so a plain UPDATE reports success and changes nothing for exactly the rows
-- it targets. Switch that one trigger off for this statement only; the transaction restores it.
ALTER TABLE public.strategy_analytics
  DISABLE TRIGGER strategy_analytics_hold_computed_at_until_success_trigger;

UPDATE public.strategy_analytics
   SET computed_at = NULL
 WHERE computation_status IN ('pending', 'computing', 'failed')
   AND computed_at IS NOT NULL
   AND cumulative_return IS NULL
   AND COALESCE(daily_returns,  'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)
   AND COALESCE(returns_series, 'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb);

ALTER TABLE public.strategy_analytics
  ENABLE TRIGGER strategy_analytics_hold_computed_at_until_success_trigger;

-- STEP 3: fail loud. Catalogue-only checks (column shape, all three triggers 'O') plus ONE row guard
-- in the only shape the linter allows: PERFORM ... ; IF FOUND THEN RAISE.
DO $$
BEGIN
  PERFORM 1 FROM public.strategy_analytics
   WHERE computation_status IN ('pending', 'computing', 'failed')
     AND computed_at IS NOT NULL
     AND cumulative_return IS NULL
     AND COALESCE(daily_returns,  'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb)
     AND COALESCE(returns_series, 'null'::jsonb) IN ('null'::jsonb, '[]'::jsonb, '{}'::jsonb);
  IF FOUND THEN
    RAISE EXCEPTION 'NEVERCOMPUTED: a never-completed row with no stored figures still carries a date (the hold trigger was not bypassed)';
  END IF;
END $$;
-- plus the catalogue arm (pg_attribute attnotnull = false, atthasdef = false; pg_trigger tgenabled = 'O'
-- for the hold trigger, tgtype 19 as the existing gate pins it) written the way the 20261013120000
-- migration's STEP 3 does.
```

**Measured, this session.** Throwaway PostgreSQL 16.13 cluster (PROD runs 17.x; nothing here is version-specific), the real `strategy_analytics` `CREATE TABLE` cut from `supabase/schema/baseline.sql:14028-14070` and the three real trigger functions and triggers (`hold_computed_at_until_success`, `stamp_computing_started`, `drop_stale_error_provenance`), eight seeded rows (failed, computing and pending without figures; failed with figures and marker; `complete` without figures; `complete` with figures; failed with a series but no headline; failed with a headline but no `daily_returns`):

| Experiment | Result |
|---|---|
| A. DROP DEFAULT/NOT NULL, plain UPDATE, trigger left ON, guard | `ERROR: NEVERCOMPUTED: a never-completed row ... still carries a date`; transaction rolled back, all eight rows keep their dates (the neutered migration fails loud). |
| B. same, with `DISABLE`/`ENABLE TRIGGER` around the UPDATE | rows 1, 2, 3 (never computed) become NULL; rows 4 (failed with figures), 5 (`complete`, no figures), 6 (`complete` with figures), 7 (failed with series, no headline), 8 (failed with headline, no daily series) keep their dates byte-identical. |
| B2. after the migration | `UPDATE ... SET computation_status='computing', computed_at=now()` on the NULL `failed` row leaves `computed_at` NULL (the trigger now holds NULL); `UPDATE ... SET computation_status='complete', computed_at=now()` stamps it; `INSERT` with no date gives NULL. |
| B3. second run | 0 rows updated (idempotent). |
| C. rollback `SET NOT NULL` with NULLs present | `ERROR: column "computed_at" of relation "strategy_analytics" contains null values` |
| D. rollback: disable trigger, fill NULLs with `TIMESTAMPTZ 'epoch'`, re-enable, `SET DEFAULT now()`, `SET NOT NULL` | succeeds; every NULL row (including the `computing` and `pending` ones) reads `1970-01-01`. |
| D2. rollback fill without disabling the trigger | the UPDATE reports success, NULLs remain, `SET NOT NULL` fails: the same defeat the forward path has. |

**Linter, measured** (`node scripts/lint-migration-data-dependence.mjs --migrations <dir> --baseline <dir>/zero-baseline.txt`, scratch corpora outside the repo):

```
PERFORM 1 FROM ...; IF FOUND THEN RAISE   -> corpus 1 migration(s), 1 anonymous block(s); 0 refusal(s), 0 allowlisted, 0 NEW.
SELECT count(*) INTO v; IF v > 0 THEN RAISE -> 1 refusal(s) ... [R1-variable-conditioned-raise]
IF EXISTS (SELECT ...) THEN RAISE          -> 1 refusal(s) ... [R2-subquery-conditioned-raise]
```

and over the real corpus: `lint-migration-data-dependence: corpus 328 migration(s), 410 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.`, self-test `lint-migration-data-dependence self-test OK (5 refusals, red+green each.)`. R1 and R2 refuse by structure, not polarity (the lint header explains: only `NOT FOUND` has a polarity carve-out), so `IF FOUND THEN RAISE` is the one allowed spelling. It is also semantically the right polarity here: it fires only when a bad row survives, so it cannot withhold a PROD apply through the data-empty TEST database. Do not add a baseline-ledger entry (the ledger only shrinks and has no opt-out).

**For migration-reviewer, stated plainly.** `ALTER TABLE ... DISABLE TRIGGER` has no precedent in `supabase/migrations/`; `20260719120000_retention_orphaned_running_compute_jobs.sql` says in a comment that it uses neither `session_replication_role` nor `DISABLE TRIGGER`. It takes `SHARE ROW EXCLUSIVE` on `strategy_analytics` until commit, which blocks concurrent writers for the duration of one small UPDATE (bounded by `lock_timeout = '3s'`, which fails the apply loud and rolls back, to be retried). It is inside the one transaction, so an abort restores the trigger; the post-check asserts `tgenabled = 'O'`. The other two BEFORE UPDATE triggers still fire on the backfill: `strategy_analytics_stamp_computing_started` would stamp `computing_started_at := now()` on a `computing` row whose stamp is NULL (`supabase/schema/functions/strategy_analytics_stamp_computing_started.sql`, ARM (b)), and clears it on a non-computing row where it is already NULL; both are no-ops for rows with a stamp. The PROD probe should count `computing` rows with a NULL stamp.

**The backfill predicate** (`[ASSUMED]` against PROD rows; wave 0 verifies):
- `computation_status IN ('pending','computing','failed')`: never touches a success row. A legitimate `complete` row can have a NULL headline ("uncomputable metrics are null") and its date is a real compute date.
- `cumulative_return IS NULL` AND no entries in `daily_returns` and `returns_series`: raw figure presence, **not** the `cumulative_method` marker. A legacy row computed before the marker existed (series and headline, no marker) must keep its date, and a `failed` row with figures is the 7 CONTEXT measured. This is narrower than `hasStoredAnalyticsResult` (`src/lib/stored-analytics-result.ts`, which needs a series AND a finite headline AND the marker): it nulls a row only when it has neither a series nor a headline, so when in doubt the date stays.
- `daily_returns` may be an array, a `{date: value}` dict or a nested dict (`storedEntryCount`, `stored-analytics-result.ts:24-38`), so emptiness is `IN ('null','[]','{}')` on the jsonb and any other shape counts as "has a series".
- The CONTEXT counts (11 never-computed, all `failed`; 7 `failed` with figures; none a portfolio constituent) are `[CITED: 238-CONTEXT.md]` and were not re-measured here.

**Rollback file** `supabase/migrations/down/<version>-rollback.sql` (convention: see `20261013120000-rollback.sql` and `20261123180100-rollback.sql`): marker-query warning header; `DISABLE` the hold trigger; `UPDATE ... SET computed_at = TIMESTAMPTZ 'epoch' WHERE computed_at IS NULL`; `ENABLE`; `SET DEFAULT now()`, `SET NOT NULL`. **Fill value: the epoch.** Reasons, to be written in the file: (1) `now()` would reintroduce the false "computed just now" date this phase removes; (2) the epoch is the instant the factsheet already treats as "never computed" (`src/lib/factsheet/fetch-and-build-payload.ts:977`, `FactsheetView.tsx:1713` `EPOCH_SENTINEL`), `computeFreshness` reads it as `stale` and `freshnessScore` as 0; (3) the one visible cost is `SyncBadge` saying "Analytics last computed" with an enormous age until the rollback is undone, accepted because the rollback is manual and off the auto-apply path. The ledger row is left in place (house rule in the existing rollbacks).

**What does not change.** No function body changes, so `supabase/schema/functions/` needs no regeneration, `baseline-content-drift-check.mjs` has no new function to floor, and the RED-UNDER-M twins in `test_strategy_analytics_computed_at_success_only.sql` keep biting. `RLS`, grants and policies are untouched.

**Baseline and carried-migration obligations (`supabase/schema/BASELINE.md`).** The re-dump is automated (Phase 164.9.5): after `supabase-migrate.yml`'s `apply` succeeds on `main`, `redump-dump` re-dumps PROD read-only and `redump-pr` opens one pull request from `automation/baseline-redump` that carries the new `baseline.sql`, regenerates `baseline-carried-migrations.txt` in the same commit and updates `BASELINE.md`. The migration PR therefore does not hand-edit either file. Until that bot PR merges, `sql-tests`, `frontend-local-stack`, `frontend-live-db-lane`, `python` and `e2e-seeded` load the old dump and **replay** the new migration (Decision F), which is what makes the migration visible to the lane; `restore-test-from-baseline.sh` refuses a dump older than the migrations by design, so a TEST restore is blocked until the re-dump merges (known, not a regression).

**`database.types.ts` is generated from the live schema and PROD auto-applies on merge**, so the nullable type cannot come from a post-merge regeneration. Recommended: regenerate against the local-stack lane after the replay (`supabase gen types typescript --local`) and keep only the three `strategy_analytics` hunks (`Row` `computed_at: string` at `:2802` becomes `string | null`; `Insert` `:2840` and `Update` `:2878` become `computed_at?: string | null`); if the lane is not available, hand-patch those three lines to exactly what the generator will emit and say so in the SUMMARY. The next real regeneration produces the same bytes, so nothing is silently overwritten. `src/lib/database.types.test.ts` has no `strategy_analytics` pin.

**Factsheet D3 and D4 (UI-SPEC §2.2).** Recommended: recognise the existing epoch sentinel. Export one constant (the same `"1970-01-01T00:00:00Z"` literal is duplicated today in `fetch-and-build-payload.ts:977` and `FactsheetView.tsx:1713`) and one `isNeverComputedStamp(value)` helper, use it at `MandatePanels.tsx:93` (Terms `Factsheet computed` -> `—`), `FactsheetView.tsx:3439` (footer `QSF · {ID8} · —`) and in `FreshnessChip` (replacing the local constant). Cost: two render sites, one shared helper, no payload-shape change and no `factsheet-v2-payload-v27` bump. The alternative (pass `null` through the payload) is rejected above. `FreshnessChip`'s `Computed · not yet` / `N/A` arm stays (237's seam, UI-SPEC FLAG 2) and is recorded as an assumption.

**Census test design.** Model it on `src/__tests__/recompute-verdict-census.test.ts` (header and structure read this session): key `file::token` with an **exact count** and one class from a closed set (never a per-file allowance), a stale-entry check, an unclassified-reader failure that names the file, token, count and legal classes, a second pattern for the wildcard embed, an `EXCLUDED` list (the generated types) with a reason, the Python and SQL corpora as separate maps, anti-vacuity floors (files walked, classified pairs, every ledger anchor reached) and planted self-tests over a temp directory (an unclassified reader fails, a comment-only mention does not count, a stale entry fails, a count change fails). It reads the repo with `node:fs` and `stripCommentsPreserveLines`, never shell `grep`. `tsc --noEmit` after `computed_at: string | null` is the property-reader half: a reader that does `s.analytics.computed_at.slice(...)` fails to compile, which no token scan can see. **No `tsc` run was possible here** (no `node_modules` in the worktree), so the typecheck fallout of the type change is **no observation**; the plan must run it and fix what it reports.

**Moves in other gates when PR-2 adds a SQL gate file** (CLAUDE.md "a new supabase/tests file or arm moves several censuses: grep them all"): `scripts/mutation-floors.mjs` (`FILES_FLOOR`, `ARMS_FLOOR`), `src/__tests__/mutation-runner-floors.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`, `src/__tests__/gate-family-meta.test.ts` (`ARMS_FLOOR=940` string pin), `src/__tests__/lint-sql-gates.test.ts` (`scanned N`), `docs/sql-gate-lineage.md`. **Recommendation: do not add a lane gate.** A lane gate sees only post-migration state, because the lane replays migrations over an empty database. Put the backfill and rollback proof in a node-environment `src/__tests__/nevercomputed-backfill-sql-exec.test.ts` (no SQL-gate floors move; register it in `vitest.node-env.ts` only if it uses no DOM global, as the sibling `*-sql-exec` files do), and cover the post-migration behaviours (B2) either there or as new arms appended to a gate the executor chooses after measuring the census cost. The existing `F1-EDGE` arm in `test_strategy_analytics_computed_at_success_only.sql` derives its expectation from `pg_attribute.atthasdef` (default absent -> NULL), so it stays green after the migration on the real table; `analytics-service/tests/test_sql_gate_scoped_updates.py` forbids unscoped `UPDATE strategy_analytics` in gate files.

### Anti-Patterns to Avoid

- **Status alone as the never-computed predicate.** Founder ruling; it would null the 7 honest last-good dates.
- **`IF EXISTS (SELECT ...)` or `count(*) INTO v; IF v > 0` as the post-UPDATE guard.** Both are refused by the data-dependence linter (R2, R1).
- **Re-issuing the hold trigger function** to let an explicit NULL through. It moves the function snapshot, the content-drift floor and the RED-UNDER-M twins for no gain.
- **Reading `armOf` for a published row to learn its state.** It reverses 167.2-REVIEW IN-04; the state comes from `failedFacts` where the page already read it.
- **Raw `ownerRemedy` on `/strategies`.** The note renders for every role; only `viewerRemedyAction` keeps an allocator-only viewer off the manager-guarded edit page and CSV wizard (199 CD-11).
- **A new file under `src/app/(dashboard)/strategies/` or `src/components/degrade/` that names `strategies.share-note` or `data-degrade-id`.** `degrade-warning-scan.test.ts` walks both and fails an unledgered file.
- **Hand-typing the 1970 sentinel a third time.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| The action words and links in a note | New sentences or a second link renderer | `ACTION_SENTENCES` + the exported `DegradeLine` action renderer | `degrade-warnings.test.tsx` already pins the words to `ownerRemedy`; a copy would drift. |
| Which action a viewer gets | A role check in the page | `viewerRemedyAction` | It already encodes CD-11. |
| A never-computed test at each reader | A per-reader `if (!computedAt)` variant | the existing NULL arms (`computeFreshness`, `freshnessScore`, `formatDay`, `isSameInstant`) plus one shared sentinel helper | The readers already agree; the census pins that. |
| A reader census | A new scanner | `stripCommentsPreserveLines` and the `recompute-verdict-census` structure | One comment handler, one idiom. |
| Proving a one-time backfill | A lane gate or a prose claim | a `*-sql-exec.test.ts` over a throwaway cluster with the real migration text | The lane has no rows at migration time. |
| The backfill's trigger bypass | `session_replication_role`, the status-flicker trick (set `pending`, then back), or editing the trigger | `DISABLE`/`ENABLE TRIGGER` in the migration transaction | The flicker trick fires `strategy_analytics_stamp_computing_started` on a status change; `session_replication_role` needs a privilege not shown to be available on the managed database. |

**Key insight:** every piece of this phase already exists as a seam. The risk is in the joins (TDZ on `shapeOf`, a published row's late state, a trigger that silently defeats a backfill, a census that cannot see a wildcard embed), not in any missing capability.

## Runtime State Inventory

This phase is a schema migration, so the five categories are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `strategy_analytics.computed_at` on PROD: 11 never-computed `failed` rows to NULL (`[CITED: 238-CONTEXT.md]`, 2026-11-24); 7 `failed` rows with figures keep their dates. `pending`/`computing` never-computed rows (count unmeasured) and any `complete` row with an insert-time date and no figures (expected 0, unmeasured). | **Data migration** (the UPDATE) and a **code edit** (the DEFAULT is gone, so new first-ever rows are NULL). Two separate tasks. Wave 0 runs the probe in Open Question 1. |
| Live service config | None. No external service stores this column. The Railway analytics deploy is unaffected: its two stamp sites write `"now"` on success and the writer census is unchanged. | None. |
| OS-registered state | None. Neither the pg_cron jobs nor any scheduler names `computed_at` of this table (the reaper keys on `computing_started_at`; verified by `test_strategy_analytics_stuck_computing_reaper.sql` asserting the reaper body never references `computed_at`). | None. |
| Secrets and env vars | None. | None. |
| Build artifacts / installed packages | (a) `src/lib/database.types.ts` generated type (three hunks). (b) `supabase/schema/baseline.sql` and `baseline-carried-migrations.txt` re-dumped by the bot PR after apply. (c) Next `unstable_cache` entries for the factsheet payload are keyed on `computedAt`; a backfilled row's key changes from its old date to `"0"`, which is a cache miss, never a stale hit. (d) PDF `ETag`s already handed to clients for a backfilled row change from `"<id>:<date>"` to `"<id>:"`, which is a revalidation, not an error. (e) `supabase/schema/functions/` needs no regeneration because no function body changes. | Regenerate the types (or patch three lines); let the bot re-dump; no manual cache action. |

## Common Pitfalls

### Pitfall 1: the hold trigger turns the backfill into a silent no-op
**What goes wrong:** `UPDATE ... SET computed_at = NULL` on a `failed` or `computing` row reports `UPDATE n` and changes nothing.
**Why it happens:** `strategy_analytics_hold_computed_at_until_success()` (`baseline.sql:10944-10947`) does `IF NEW.computation_status IN ('failed', 'computing') THEN NEW.computed_at := OLD.computed_at; END IF;`.
**How to avoid:** disable that one trigger inside the migration transaction and assert afterwards, with the `PERFORM ... IF FOUND` guard.
**Warning signs:** the guard raises; or a PROD probe after apply still shows dated never-computed rows.

### Pitfall 2: a guard the linter refuses
**What goes wrong:** `sql-gate-lint` goes red on the migration PR.
**How to avoid:** use the measured shape; never add a baseline-ledger line or an opt-out.

### Pitfall 3: `complete` with NULL breaks a reader that assumed "complete means dated"
**What goes wrong:** a surface prints `Jan 1, 1970` (D3, D4) or an age computed from NULL.
**How to avoid:** the NULL-arm column of the census table; D3/D4 fixed in PR-2; a test per row.

### Pitfall 4: PR-1 resolves the published note too early
**What goes wrong:** `shareNotes` is built before `failedFacts`, so a published `Stale (no data yet)` row gets `KCS12-PUBLIC-UNKNOWN` even though its state was read.
**How to avoid:** the descriptor resolved in `noteFor`; the parity and published tests of UI-SPEC Test Contract 4 and 5.

### Pitfall 5: `shapeOf` called before it is declared
**What goes wrong:** a `ReferenceError` (temporal dead zone) when `shareNotes` calls `shapeOf`.
**How to avoid:** resolve in `noteFor`, or hoist `shapeOf` (it needs only `memberCountOf`).

### Pitfall 6: the anti-vacuity floors
**What goes wrong:** `DISTINCT_FLOOR = 50` (`status-surface-copy.test.ts`) goes red when `MINT-B` retires, or goes vacuous if the new strings are not walked.
**How to avoid:** add the composed notes to `everyRenderedString()` and re-measure the floor.

### Pitfall 7: `ReactNode` through a client boundary
**What goes wrong:** the panel renders `[object Object]` or a serialization error.
**How to avoid:** a render test of `OwnerUnpublishedPanel` with a node and with a string, and `tsc`.

### Pitfall 8: editing the generated types by guess
**How to avoid:** regenerate against the lane, or patch exactly three lines and record it.

## Code Examples

### The note element (PR-1)
```tsx
// Source: composed from src/app/(dashboard)/strategies/page.tsx:1291-1303 and
// src/components/degrade/DegradeLine.tsx:62-110 at HEAD 4b89c54cb.
<p
  data-testid="strategy-row-share-note"
  data-degrade-id="strategies.share-note"
  className="text-caption font-normal text-text-muted"
>
  {lead}{" "}
  <Action id={actionId} strategyId={s.id} />
</p>
```
`textContent` must equal the UI-SPEC string exactly; an `A-RELOAD` note has no link.

### Resolving the action (PR-1)
```ts
// Source: the stale_no_data branch of healthDetailFor, page.tsx:1164-1186.
const shape = shapeOf(s, facts.compositeHistory);
const remedy = ownerRemedy(state, shape, s.id); // no build facts, as strategies.stale-no-data
const actionId = viewerRemedyAction({ remedy, managerSurface: isManager, shape });
```

### The derived-state post-check (PR-2 test)
```sql
-- Source: measured this session on PostgreSQL 16.13, the real strategy_analytics table.
-- After the migration, the hold trigger holds NULL:
UPDATE strategy_analytics SET computation_status = 'computing', computed_at = now()
 WHERE strategy_id = :never_computed_id RETURNING computed_at;   -- NULL
UPDATE strategy_analytics SET computation_status = 'complete',  computed_at = now()
 WHERE strategy_id = :never_computed_id RETURNING computed_at;   -- stamped
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "not available yet ... once a computation succeeds" for every non-running state | the state-appropriate remedy (the `analytics_failed` and `finished_not_built` notes, 170.1 D-08, 164.6.6.3.3 D-08) | 2026-09 / 2026-10 | PR-1 extends the same rule to `failed`, `stalled`, `never_started`. |
| `computed_at DEFAULT now() NOT NULL`, with per-reader workarounds (`AdminTabs.computeRecency`'s `everComputed`, `StrategyTable` status gates, `stored-analytics-result` not using the column as evidence) | NULL for a never-computed row | PR-2 | The workarounds become redundant but stay valid; do not remove them in this phase. |
| bridge stamps `computed_at` on every transition | runner stamps only on success (166.5), table-level hold (166.3.1) | 2026-10 | Makes NULL stable until the first real success. |

**Deprecated or stale after PR-2:** the comment-only mentions listed in the census section; the `ledger_refresh_staleness` COMMENT (re-dump owns it).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The backfill predicate (status in pending/computing/failed AND no headline AND no stored series) matches exactly the 11 never-computed PROD rows and none of the 7 with figures. | PR-2 migration design | A one-way PROD write that nulls an honest date or misses a fake one. The migration's own `FOUND` guard catches a miss only against the same predicate, so a wrong predicate fails silently. **Wave-0 probe required.** |
| A2 | No PROD `complete` or `complete_with_warnings` row is figure-less with an insert-time date. | Runtime State Inventory | Those rows would keep a false date. |
| A3 | `ALTER TABLE ... DISABLE TRIGGER` is permitted for the migration role on the managed database, and the brief `SHARE ROW EXCLUSIVE` lock is acceptable under the 3 s `lock_timeout`. | PR-2 migration design | The apply fails on TEST first (`apply-test`), which blocks PROD: safe, but a retry. Tested only as a superuser on a local cluster. |
| A4 | A server-built `ReactNode` can be passed as `OwnerUnpublishedPanel`'s `shareNote` prop (client component). | PR-1 files | A serialization error on the owner pending page; the executor's render test and `tsc` catch it. |
| A5 | `frontend-test` on `ubuntu-latest` provides PostgreSQL server binaries for `*-sql-exec.test.ts` (the sibling files have no skip gate and `ci.yml:2257` records `/usr/lib/postgresql/16/bin`). | Validation Architecture | The new exec test throws in CI; the executor confirms by reading the `frontend-test` job. |
| A6 | `STRATEGY_ANALYTICS_MATCH_COLUMNS` and `CLOCK_SAFETY_KPI_COLUMNS` do not include `computed_at`. | PR-2 census | One more reader without a classification. |
| A7 | The per-state `it.each` fixtures resolve as derived by reading `strategy-shape.ts` and `compute-state.ts` (`stalled` -> `A-RELOAD`, `failed` -> `A-CONTACT-RESOLVE`, `never_started` -> `A-LINK-KEY-EDIT`; `:1592` -> `A-RELOAD`, `:1856` -> `A-LINK-KEY-EDIT`). | PR-1 tests | A wrong expected sentence; the executor re-derives by running. |
| A8 | The epoch rollback fill is acceptable to the founder (it makes `SyncBadge` print an enormous age on a rolled-back, never-computed row). | PR-2 rollback | A different fill value is chosen; one line in one file. |
| A9 | `FreshnessChip`'s `N/A` / `Computed · not yet` copy for a missing date stays (237's seam). | PR-2 D5 | UI-SPEC FLAG 2 already records it. |

## Open Questions (RESOLVED)

1. **What does PROD say about the predicate?**
   - What we know: CONTEXT measured 11 never-computed (`failed`) and 7 `failed` with figures on 2026-11-24.
   - What's unclear: counts by status for rows with no headline and no series (including `pending`, `computing`, and figure-less `complete`), and `computing` rows with a NULL `computing_started_at`.
   - Recommendation: PR-2 wave 0 runs, through the Supabase MCP only, the marker query first and then one aggregate returning counts only, for example `SELECT computation_status, (cumulative_return IS NOT NULL) AS has_headline, (COALESCE(daily_returns,'null'::jsonb) NOT IN ('null','[]','{}')) AS has_daily, (COALESCE(returns_series,'null'::jsonb) NOT IN ('null','[]','{}')) AS has_returns_series, (computing_started_at IS NULL) AS no_clock, count(*) FROM public.strategy_analytics GROUP BY 1,2,3,4,5 ORDER BY 1,2,3,4,5;` Never print ids or emails. Record the counts in the plan and the CHANGELOG.
   - **RESOLVED (MEASURED, re-measured at execution in 238-04-PLAN.md Task 2):** see below.
   - **MEASURED 2026-11-24 by the orchestrator (PROD via Supabase MCP, marker query first, counts only):** `complete` / headline / returns_series / no clock = 17; `complete_with_warnings` / headline / returns_series = 9; `failed` / no headline / no daily / no returns_series = **11**; `failed` / headline / returns_series = 7. No `pending` or `computing` rows, no figure-less success rows, and no row with a series but no headline (or the reverse). The predicate (status in pending/computing/failed AND no headline AND no stored series) selects exactly the 11 rows and none of the 7. Re-run at PR-2 wave 0, because the numbers will move before 233 merges.
2. **Does the founder want the figure-less `complete` rows nulled too?**
   - **RESOLVED:** no; the backfill predicate leaves success rows alone. 238-04 Task 2 re-measures figure-less success rows and HALTs to a founder `checkpoint:decision` if any exist (238-04-PLAN.md, step 5).
   - Recommendation: no, unless Open Question 1 finds some; a success row's date is a real compute date by the writer census.
3. **Where does PR-2's SQL gate live?**
   - **RESOLVED:** no new lane gate. The backfill, rollback and post-migration proof is `src/__tests__/nevercomputed-backfill-sql-exec.test.ts` (238-05-PLAN.md); the existing SQL gates that name `computed_at` are run on the local-stack lane after the replay (238-09-PLAN.md Task 1).
   - Recommendation: no new lane gate (see "Moves in other gates"); the exec test is the proof. If the planner wants post-migration arms on the lane, budget the six census files.
4. **Adjacent defects, not fixed here:** `allocator-portfolio-payload.ts` claims "now" for a missing portfolio date; `FreshnessChip` prints `N/A` where DESIGN.md's null rule is `—`; the `ledger_refresh_staleness` COMMENT. Book only if a review raises them to MEDIUM+ (CLAUDE.md TODOS rule).
   - **RESOLVED:** out of scope and not booked; each is raised only if a review rates it MEDIUM+ (CLAUDE.md TODOS rule (a)). The `FreshnessChip` copy is recorded as a flagged assumption in 238-06-PLAN.md.
5. **Unpublished row with a `pending`/`computing` embed and `failed` jobs** reads `Updating` beside a note that names a remedy. Predates the phase (UI-SPEC unresolved row); the note stays free of "no computation is running" so it stays true. Record, do not fix.
   - **RESOLVED:** recorded, not fixed: flagged assumption in 238-01-PLAN.md ("Assumptions"); the lead-plus-action notes never contain "no computation is running" (pinned in 238-01 and 238-03).

## Environment Availability

Nothing below was executed against a server except the throwaway cluster; the Docker daemon's state was not probed.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | scripts, census scan | yes | v25.8.1 (`engines` is `>=22`) | none needed |
| `node_modules` in the worktree | vitest, `tsc`, `eslint`, `tsx` | **no** (the worktree has none; the main checkout has one) | n/a | `npm ci` in the worktree before any test. Until then the typecheck fallout of `computed_at: string \| null`, every vitest run in this document, and `npm run lint` are **no observation**. |
| PostgreSQL server binaries | `*-sql-exec.test.ts`, the throwaway cluster | yes | 16.13 (the Homebrew postgresql@16 keg that `scripts/pg-lane/run.sh --print-pgbin` resolves); `psql` client 18.6 | none needed |
| Supabase CLI | `gen types --local` | present on PATH | not probed | hand-patch three lines |
| Docker | local-stack lane | client present, daemon state not probed | 29.9.2 client | the exec test does not need it |
| Supabase MCP (marker query, PROD aggregate) | wave-0 predicate probe | **not available to this agent** | n/a | the orchestrator or executor runs the probe; marker query first, one query per call |
| Python venv | analytics tests | not needed (PR-2 changes no Python) | n/a | n/a |

**Missing dependencies with no fallback:** none. **With a fallback:** `node_modules` (`npm ci`), Supabase MCP (run by another agent).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest `^5.0.3`, two projects (jsdom default, node list in `vitest.node-env.ts`); TypeScript `^6`; pytest for `analytics-service/` (not touched) |
| Config file | `vitest.config.ts`; `vitest.node-env.ts`; the SQL-exec pattern boots its own cluster |
| Quick run command | `npx vitest run "src/app/(dashboard)/strategies" src/lib/status-surface-copy.test.ts "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx" src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts src/__tests__/copy-census.test.ts src/__tests__/no-email-in-copy.test.ts` |
| Full suite command | `npm test` (all of `vitest run`), `npx tsc --noEmit`, `npm run lint` |
| SQL lint | `node scripts/lint-migration-data-dependence.mjs --self-test` then `node scripts/lint-migration-data-dependence.mjs`; `node scripts/lint-sql-gates.mjs --self-test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FACT-05 | A failed, stalled or never-started row's `/strategies` note names the remedy action and never says wait (sentence per state) | component (server page render) | `npx vitest run "src/app/(dashboard)/strategies/page.key-pill.test.tsx"` | exists, extend |
| FACT-05 | Allocator-only viewer never gets the edit or CSV link; parity with the Health detail | component | `npx vitest run "src/app/(dashboard)/strategies/page.merged.test.tsx"` | exists, extend |
| FACT-05 | Published row: unknown state -> `KCS12-PUBLIC-UNKNOWN` with `rpcCalls === []`; known failed -> `KCS12-PUBLIC-{action}` with exactly one jobs read | component | key-pill file | exists, re-point and extend |
| FACT-05 | Owner pending page panel note ends on the page's own remedy action | component | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx"` | exists, re-point `SHARE-NOTE-B` |
| FACT-05 | Leads and `KCS12-PUBLIC-UNKNOWN` character for character; no rendered string contains `yet`, `once a computation succeeds`, `appear there` for the kind-less not-available arm; floor re-measured | unit | `npx vitest run src/lib/status-surface-copy.test.ts` | exists, extend |
| FACT-05 | Marker-only registry entry and the scan ledger unchanged | unit | `npx vitest run src/lib/degrade-warnings.test.tsx src/__tests__/degrade-warning-scan.test.ts` | exists |
| FACT-03 | The migration nulls exactly the never-computed rows, keeps the 7-style rows byte-identical, re-enables the trigger, fails loud when the bypass is removed, is idempotent | node, throwaway cluster | `npx vitest run src/__tests__/nevercomputed-backfill-sql-exec.test.ts` | **no, Wave 0** |
| FACT-03 | The rollback restores NOT NULL and DEFAULT and writes the epoch | node, throwaway cluster | same file | **no, Wave 0** |
| FACT-03 | Post-migration: first-ever failed INSERT is NULL; `failed`/`computing` writes hold NULL; a success stamps | node, throwaway cluster | same file | **no, Wave 0** |
| FACT-03 | Reader census fails on an unclassified or stale reader (TS, Python, SQL, wildcard embed) | unit (source scan) | `npx vitest run src/__tests__/computed-at-reader-census.test.ts` | **no, Wave 0** |
| FACT-03 | `SyncBadge` with `computedAt={null}` has no `Analytics last computed` in any `title` branch | component | `npx vitest run src/components/strategy/SyncBadge.trade-fetch.test.tsx` | exists, extend |
| FACT-03 | Factsheet Terms row and footer stamp read `—` for a NULL or sentinel date, no `1970` anywhere | component | `npx vitest run src/app/factsheet` (a new focused file) | **no, Wave 0** |
| FACT-03 | Admin card `Computed —`, wizard caption, `HealthScore` 0, sort position for a NULL row | component | `AdminTabs.test.tsx`, wizard preview tests, `StrategyGrid.test.tsx`, `StrategyTable.stale-analytics.test.tsx` | exist, pin NULL |
| FACT-03 | Typecheck after `computed_at: string \| null` | static | `npx tsc --noEmit` | n/a |
| FACT-03 | Migration lint | static | `node scripts/lint-migration-data-dependence.mjs` | exists |

### PROOF-01 neuter points (each: back up with `cp`, neuter, expect RED with the named arm first, `cp` back, `cmp`, GREEN, paste verbatim in the SUMMARY)

| Gate | Neuter | Expected first RED |
|------|--------|--------------------|
| PR-1 per-state cases (key-pill) | restore the old `MINT_TOKEN_NOTES.not_available` sentence on the kind-less path | all three per-state cases and the re-pointed `it.each` rows |
| PR-1 grep invariant | put `yet` (or `once a computation succeeds`) back into a lead | the invariant arm, naming the offending string |
| PR-1 viewer mapping | pass `managerSurface: true` unconditionally | the allocator-only cases and the container-wide `a[href*="/edit"]` null assertions in `page.merged.test.tsx` |
| PR-1 parity | feed the note a different shape than the detail | the parity test |
| PR-1 published | force the published state to `null` | the failed-jobs published case |
| PR-1 owner page | revert the panel note to the arm-only string | the re-pointed `SHARE-NOTE-B` |
| PR-1 copy walk | drop the new composed notes from `everyRenderedString()` | the distinct-string floor |
| PR-2 backfill (exec test) | delete the `DISABLE TRIGGER` statement from a byte-backed copy of the migration | apply aborts with `NEVERCOMPUTED: ...`; the test names the arm |
| PR-2 predicate | change the predicate to status alone | the "keeps the 7-style row" arm |
| PR-2 re-enable | delete the `ENABLE TRIGGER` statement | the `tgenabled = 'O'` arm (the migration's own catalogue check also raises) |
| PR-2 shape | delete `DROP DEFAULT` (or `DROP NOT NULL`) | the column-shape arm |
| PR-2 rollback | fill with `now()`, or skip the disable | the rollback arm (epoch value, or `SET NOT NULL` failure) |
| PR-2 D3/D4 | drop the sentinel arm at `MandatePanels.tsx:93` | the Terms row reads `Jan 1, 1970` |
| PR-2 census | add an unclassified `computed_at` read to a `src/` file, and separately delete a classified entry | the census naming the file and the count; the stale-entry arm |

### Sampling Rate
- **Per task commit:** the quick run command for the files that task touched.
- **Per wave merge:** the quick run command plus `npx tsc --noEmit` and `node scripts/lint-migration-data-dependence.mjs`.
- **Phase gate:** `npm test`, `npm run lint`, `npx tsc --noEmit`, migration-reviewer and rls-policy-auditor clean (PR-2), review rounds per the project rules, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/__tests__/computed-at-reader-census.test.ts` — covers FACT-03 SC-1 (model: `recompute-verdict-census.test.ts`)
- [ ] `src/__tests__/nevercomputed-backfill-sql-exec.test.ts` — covers FACT-03 backfill, rollback and post-migration behaviour (model: `oneaccountonce-delete-sql-exec.test.ts`)
- [ ] a focused factsheet NULL-date test (Terms, footer, chip arm)
- [ ] `npm ci` in the worktree (no `node_modules`)
- [ ] PROD aggregate probe (Open Question 1), run by an agent that has the Supabase MCP

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, so it is treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | none touched |
| V3 Session Management | no | none touched |
| V4 Access Control | yes | `viewerRemedyAction` keeps an allocator-only viewer off manager-guarded routes; the migration adds no policy and no grant; RLS on `strategy_analytics` (`analytics_insert_deny`, `analytics_update_deny`) is untouched; rls-policy-auditor still runs on the migration |
| V5 Input Validation | yes | note text is static copy; `ContactPointerText` and `Action` render text nodes plus one `Link`, never markup; `strategyId` is `encodeURIComponent`-ed in the edit href and `contactHref` is the one encoder |
| V6 Cryptography | no | none |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A one-time backfill that silently rewrites the wrong rows | Tampering | conservative predicate (status AND no figures), fail-loud `FOUND` guard, exec test with byte-identical decoys, PROD probe before apply |
| A trigger left disabled by an aborted or partial migration | Tampering | disable and enable inside one implicit transaction, `SET LOCAL lock_timeout`, post-check `tgenabled = 'O'` |
| An allocator-only viewer sent to a manager-only page | Elevation of privilege | `viewerRemedyAction`; container-wide href assertions in `page.merged.test.tsx` |
| A note leaking an address or a status | Information disclosure | `no-email-in-copy.test.ts` and the rendered-string walk |
| Public repo hygiene | Information disclosure | this document and the plan carry repo-relative paths, no PROD identifiers and no credentials; probes print counts only |

## Sources

### Primary (HIGH confidence): files read this session at HEAD `4b89c54cb`
- `src/lib/status-surface-copy.ts` (`:225-679`), `src/lib/degrade-warnings.ts` (`:60-420`, `:1075-1100`), `src/components/degrade/DegradeLine.tsx` (whole), `src/components/contact/ContactPointerText.tsx`
- `src/app/(dashboard)/strategies/page.tsx` (`:180-299`, `:730-975`, `:975-1320`), `src/app/factsheet/[id]/v2/page.tsx` (`:820-975`), `src/app/factsheet/[id]/v2/FactsheetView.tsx` (`:1370-1445`, `:1700-1860`), `src/lib/compute-state.ts` (`:562-578`), `src/lib/strategy-shape.ts` (`:133-210`), `src/lib/strategy-health.ts`, `src/lib/closed-sets.ts` (`:800-945`)
- `src/app/(dashboard)/strategies/page.key-pill.test.tsx`, `page.merged.test.tsx`, `page.table.test.tsx`, `src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx`, `src/lib/status-surface-copy.test.ts`, `src/__tests__/degrade-warning-scan.test.ts`, `src/__tests__/no-email-in-copy.test.ts`, `src/__tests__/copy-census.test.ts`, `src/__tests__/recompute-verdict-census.test.ts`, `src/__tests__/oneaccountonce-delete-sql-exec.test.ts` (headers and the cited ranges)
- `supabase/schema/baseline.sql` (`:10940-10950`, `:12140-12304`, `:14028-14070`, `:16383`), `supabase/schema/functions/*.sql` (hold, stamp-computing-started, sync status, recommendations), `supabase/schema/BASELINE.md`, `supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql` and its rollback
- `scripts/lint-migration-data-dependence.mjs` (header, rule table, `resolveCondition`, CLI), run live
- `analytics-service/tests/test_computed_at_stamp_census.py`, `analytics-service/services/job_worker.py` and `mt5_parity_*.py` (cited ranges)
- `.planning/phases/238-.../238-CONTEXT.md`, `238-UI-SPEC.md`, `.planning/REQUIREMENTS.md` (FACT-03, FACT-05), `.planning/ROADMAP.md` (`### Phase 238`, `### Phase 233`), `.planning/STATE.md` (head), `TODOS.md` (the two entries), `DESIGN.md` (null rule), `CLAUDE.md`, `AGENTS.md`

### Secondary (MEDIUM confidence)
- `node` scripts run over `src/` and `analytics-service/` for the census counts (scripts live outside the repo; the counts are reproducible with `stripCommentsPreserveLines` and the token regex above)
- A throwaway PostgreSQL 16.13 cluster for the backfill, trigger and rollback experiments (removed afterwards)

### Tertiary (LOW confidence)
- None used. Assumptions A1 to A9 are listed above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new; every seam read.
- PR-1 architecture and test list: HIGH for structure and anchors; MEDIUM for the derived expected sentences (A7: re-run).
- PR-2 migration mechanics: HIGH for trigger, lint and rollback behaviour (executed); MEDIUM for the predicate against PROD (A1) and the managed-database privilege (A3).
- PR-2 census: HIGH for counts at HEAD; the census is time-bound to Phase 233 and to the missing typecheck.
- Pitfalls: HIGH.

**Research date:** 2026-11-24
**Valid until:** PR-1: 30 days or the next edit to `strategies/page.tsx`. PR-2: until Phase 233 merges or any migration lands that touches `strategy_analytics` (re-run the census and re-pick the migration version).
