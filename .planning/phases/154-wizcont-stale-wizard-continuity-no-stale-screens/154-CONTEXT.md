# Phase 154: WIZCONT/STALE — Wizard continuity, no stale screens - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 3 grey areas, 12 questions, all recommendations accepted

<domain>
## Phase Boundary

Three defects on the wizard surface, all found live during the MT5-05 founder run on 2026-08-04:

1. **WIZCONT-01** — re-entering "add a strategy" restarts instead of continuing from an existing draft.
2. **STALE-01** — a wizard screen shows a state the backend has already left. Two observed
   instances: (a) stuck on "Fetching trades…" after the job chain finished at 11:39:35; (b) a
   refusal rendered from a stale analytics row while a re-derive was in flight.
3. **WIZCONT-02** (LOW) — re-connecting the same credentials from a context that has lost the
   `wizard_session_id` localStorage token can mint a duplicate strategy + `api_keys` row.

**Out of scope:** the MT5 numbers themselves (Phase 155), the wizard's inline field validation
(shipped in 153.1/153.2), and the `attested_venue` writer refactor (Phase 156).

⭐ Per the milestone framing: almost none of this is an MT5 defect. MT5 is simply the first venue
to traverse the whole path from a cold start. A fix scoped to `exchange === 'mt5'` is the wrong
fix for all three.

</domain>

<decisions>
## Implementation Decisions

### WIZCONT-01 — Resume entry path

- **The entry point to fix is `ContributionWizardOverlay.tsx:146` (`initialDraft={null}`)**, an
  explicit Phase 110 deferral, reached from `+ Strategy` (allocations/scenario) and the My
  Strategies empty state. ⚠️ **The ROADMAP's and REQUIREMENTS' inferred entry path is WRONG at
  HEAD** — they say `/strategies/new` is "a branch chooser with no draft awareness". It is not:
  `src/app/(dashboard)/strategies/new/page.tsx` is a pure `redirect()` (7 lines of body), and
  `…/wizard/page.tsx:79-91` already queries the draft and passes `initialDraft` down. This is
  exactly the re-observation the requirement demanded ("this was inferred from code, not observed
  click-by-click"). **Record the correction in REQUIREMENTS.md as part of this phase.**
- **Do NOT rebuild the resume state machine.** `WizardClient.tsx:198-201` already resumes to
  `sync_preview` when `initialDraft` is present. The overlay must supply the draft, nothing more.
- The overlay learns the draft through a **client-callable read that reuses the wizard page's exact
  query shape** (same columns, same `source='wizard' AND status='draft'` predicate, same
  `order created_at desc limit 1`), passed in as `initialDraft`. One query shape, two callers — a
  second divergent shape is how the two paths drift apart.
- Resume is an **explicit choice, not silent** — reuse the existing `showResumeBanner` mechanism so
  the founder picks Resume vs Start fresh. Silent resume can strand a half-typed new key.
- **The CSV short-circuit is in scope.** `WizardClient.tsx:198` returns `"csv_upload"` for
  `source === "csv"` *before* it consults `initialDraft`, so a CSV draft never resumes on either
  path. Same defect class, found during the scout; fixing only the overlay would leave the twin
  alive — the exact failure Phase 153.6 (PARITY) existed to clean up.

### STALE-01 — Investigation gate

- ⛔ **Hard gate, from both ROADMAP criterion 2 and REQUIREMENTS: "Do not plan a fix before
  answering it."** Root cause is NOT established. The docblock at
  `SyncPreviewStep.tsx:109-111` states the poll loop "has no time-based abort (it stops only on
  success / terminal failure / 3 consecutive network errors)" — so it *should* have terminated at
  11:39:35. Why it did not is the open question.
- The investigation is a **dedicated plan (154-01) that must complete and be reviewed before any
  STALE fix plan is written**. A RESEARCH.md section alone is too easy to plan straight past.
- **"Root cause established" closes only on a failing regression test that reproduces the stall
  without the fix** — the mechanism pinned, not the symptom. A written trace plus PROD logs is the
  self-referential-oracle shape that let three money bugs survive six review passes; it is not
  sufficient here.
- **Fix at the root cause wherever it lives**, including `analytics-service/` (Python) if the job
  chain never wrote a terminal status, or the DB/RLS layer if a read is being denied. No bandaids,
  no frontend-only containment of a backend cause.
- **Both instances are in scope.** (a) the stuck "Fetching trades…" and (b) the refusal computed
  from a stale analytics row mid-re-derive. They may well share one cause; the investigation should
  test that hypothesis explicitly rather than assume two bugs.

### WIZCONT-02 — Token-less credential dedup (LOW priority)

- **Narrow scope: only venues that already return a stable non-secret account id at validation**
  (e.g. the MT5 login). Venues without one are left unchanged and **the residual gap is written
  down**, not papered over.
- **Fail toward the EXISTING row** — return it; never overwrite. A clobber would orphan
  `strategy_keys` membership and synced history that other strategies depend on.
- The check lives **server-side, beside the existing `wizard_session_id` idempotency fence** at
  `src/app/api/strategies/create-with-key/route.ts:263-267`. One fence with two keys, so the two
  cannot drift apart.
- **Add the DB constraint too**: a partial `UNIQUE` on the non-secret identity, `WHERE` it is
  non-null — belt and braces beside the app fence, matching the existing
  `strategies_user_wizard_session_source_uniq` pattern.
  ⛔ **Never a UNIQUE on ciphertext.** `api_key_encrypted` carries a per-row `dek_encrypted` +
  `nonce`, so two encryptions of the same secret differ and the index would dedup nothing.

### Claude's Discretion

- Test placement, file naming, and component decomposition follow existing conventions.
- Whether the overlay's draft read is a route handler, a server action, or a server-component
  wrapper — decide at planning, on the criterion that the query shape stays single-sourced.
- The precise name and column type of the non-secret venue identity field.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `WizardClient.tsx` — already resumes (`:198-201`), already hydrates draft form values
  (`:229-255`), already has a `showResumeBanner` state (`:214`). Accepts a `sourceOverride` prop,
  which the overlay already uses.
- `…/wizard/page.tsx:79-91` — the canonical draft query (columns, predicate, ordering). Reuse this
  shape for the overlay rather than authoring a second one.
- `create-with-key/route.ts:263-267` — the existing `wizard_session_id` idempotency fence, and the
  natural home for the second dedup key.
- `strategies_user_wizard_session_source_uniq` — the partial-UNIQUE precedent on PROD:
  `UNIQUE (user_id, wizard_session_id, source) WHERE wizard_session_id IS NOT NULL`.
- `SyncPreviewStep.tsx` — `POLL_BACKOFF_MS`, `MAX_CONSECUTIVE_POLL_ERRORS`, `KNOWN_KICKOFF_CODES`,
  and the `SLOW_HINT_MS` / `WARN_THRESHOLD_MS` / `RETRY_THRESHOLD_MS` copy ladder.

### Established Patterns

- Next.js App Router; the wizard page is a server component, `WizardClient` is the client island
  behind a mandatory `<Suspense>` boundary (it calls `useSearchParams()`; without the boundary the
  whole tree bails to CSR — documented in `wizard/page.tsx`).
- Hydration discipline: **every `useState` initializer must read only SSR-deterministic inputs**
  (`source`, `initialDraft`). localStorage is read once in a post-mount `useEffect` and applied via
  `setState`. Violating this caused React #418 and unmounted the CSV form. Any new draft-awareness
  code must obey the same rule.
- `key={source}` on `WizardClient` forces the remount across the API↔CSV boundary; the overlay
  reproduces this locally with its own `source` state.
- Colocated `*.test.tsx` beside every component.

### Integration Points

- `ContributionWizardOverlay.tsx` — consumed by `AllocationsTabs.tsx`,
  `StrategyBrowseDrawer.tsx`, `MyStrategiesSection.tsx`, `MyStrategiesEmptyState.tsx`. A prop
  change ripples to all four plus their tests.
- `/api/strategies/create-with-key` — the dedup fence.
- `supabase/migrations/**` — the partial UNIQUE index. ⚠️ Merging to `main` AUTO-APPLIES to PROD;
  apply to TEST via MCP before merge, and run the migration reviewer.

</code_context>

<specifics>
## Specific Ideas

- The requirement text for WIZCONT-01 must be **corrected**, not just satisfied: its stated entry
  path (`/strategies/new` is a branch chooser) does not match HEAD. Leaving the wrong diagnosis in
  REQUIREMENTS.md invites the next reader to re-fix a file that was never broken.
- WIZCONT-01 and the CSV short-circuit are one class ("the draft is not consulted before the step
  is chosen"), not two tickets. Close the class.

</specifics>

<deferred>
## Deferred Ideas

- A cross-venue credential-identity scheme for venues that expose no stable non-secret account id.
  Explicitly out of scope for WIZCONT-02's narrow reading; record the residual instead.
- Phase 156 (CONNECT-REFACTOR) touches the same `create-with-key` → `api_keys` INSERT path. Do not
  pre-empt its service-role writer here; keep this phase's dedup change additive so 156 can move
  the writer without unpicking it.
- ⚠️ **Ledger defect, not phase work:** Phase 156's ROADMAP entry was appended after the v1.16
  section (line ~1239), so `gsd-sdk query roadmap.analyze` does not count it as a v1.17 phase
  (reports 15 phases, 147–155). Fix before the milestone lifecycle runs, or the audit will treat
  the milestone as complete at 155.

</deferred>
