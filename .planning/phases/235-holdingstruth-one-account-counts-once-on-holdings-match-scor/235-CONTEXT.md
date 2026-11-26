# Phase 235: HOLDINGSTRUTH — one account counts once on Holdings, match scoring and the dashboard, and every failing key is named - Context

**Gathered:** 2026-11-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 225 settled the account identity value (S4: exchange, login, and `venue_server`; PR-1..PR-3 on main, last one #1368). This phase makes the readers that consume that identity count one account once, and say so when they cannot:

- HOLD-01: a Holdings row whose `api_key_id` is absent from the owner's `api_keys` identity read fails loud instead of becoming an account of its own (`keyAccountOf`'s `key:<id>` fallback, `fetchHoldings`, and the dollar callers of `fetchLatestHoldingsPerKey`).
- HOLD-02: the matcher (`analytics-service/routers/match.py`, `_load_holding_portfolio_context`) applies the native-unpriced marker per ACCOUNT, as the TS reader does, so a multi-key account's match AUM and unpriced days equal what Holdings reports.
- HOLD-04: when the dashboard's `native_unpriced:` marker read fails (`markerReadError` from `fetchLatestHoldingsPerKey`, dropped today by `getMyAllocationDashboard`), the page shows a one-line note and a Sentry event fires.
- HOLD-05: every failing key of a shared account is named in the missing-data message: the producer `key-data-gaps.ts` emits the attributed key ids for `shared_account_failing`, and `MissingDataMessage.tsx` applies the R3-01 rule to them.

Out of scope: the HOLD-03 writer-basis gate (Phase 229, complete), any migration, the `commit_scenario_batch` SQL twin, Phase 225's open gap plan 225-21 (poll-path refusal), Phase 228.

TODOS entries this phase closes (delete them in the ship PR and name them in the CHANGELOG, per CLAUDE.md rule (b)): `170.4-IDENTITY-READ-COMPLETENESS`, `170.4-MATCH-UNPRICED-PER-KEY`, `170.4-DASHBOARD-MARKER-READ-SILENT`, `198-SHARED-ACCOUNT-FALLBACK-UNNAMED`.

</domain>

<decisions>
## Implementation Decisions

Note on process: this phase ran as a background phase agent with no channel to the founder. No question here was a one-way door (no migration, no public API or URL contract, no new dependency). The one user-facing wording choice (HOLD-04's note) follows the fix already booked in `170.4-DASHBOARD-MARKER-READ-SILENT` ("carry a degraded flag that renders a one-line disclosure") and is recorded under Claude's Discretion so the founder can override it at review.

### HOLD-01 identity completeness
- The fail-loud point is the identity mapping itself: `keyAccountOf` returns a function that THROWS a named error class for a key id absent from the `keys` it was built from. A key that IS in `keys` but that the identity does not group keeps its own token (`key:<id>`); that is legitimate and unchanged.
- `fetchHoldings` (portfolio-exposure.ts) propagates the throw, like its other fail-loud paths (identity read error, row cap): the series read fails rather than yielding a double-counted series.
- The dollar callers that take `fetchLatestHoldingsPerKey`'s `accountByKey` (`derivePhase07Fields` in `src/lib/queries.ts`, the scenario commit route) stop falling back to `?? keyId` for a counted row whose key `accountByKey` does not carry; they throw the same named error. The commit route already turns a throw in that block into `holdingsLookupErr` (lookup_failed, no failed commit) and that stays.
- A test per reader: `fetchHoldings` with a row whose key is absent from the identity read throws; the per-key dollar path with a row whose key is absent from `accountByKey` throws. Each goes RED on pre-fix code (PROOF-01).

### HOLD-02 match marker per account
- The matcher treats a key's marker day as that key's READING day when it is after the key's newest rows (exactly the TS reader's rule in `fetchLatestHoldingsPerKey`: `{day: unpricedAsof, hasRows: false}`), and an account's newest day is the maximum over its keys' reading days. So when key A carries a marker for day D and key B's newest rows are D-1, B's rows stop counting, as on Holdings.
- The marker read covers every one of the owner's keys (from `key_rows`), not only keys that have holdings rows, because a key with no rows and a marker still sets its account's day in the TS reader.
- A failed marker read keeps today's behaviour (logged at ERROR, rows kept): the scorer is request-time and persists nothing.
  - ⛔ CORRECTED 2026-11-26 (review round 1, WR-02): the premise "the scorer is request-time and persists nothing" was false. `_score_one_allocator` persists `holding_flags` and the scores into `match_batches`. The rows are still KEPT, as locked above. What changed: `_load_holding_portfolio_context` returns `unpriced_check_failed`, and the persisted batch carries a book-level `holding_flags` entry (`kind: "book"`, `holding_ref: None`, `unpriced_check_failed: True`, `flagged: False`, the D-22 shape), so the failure is disclosed in the batch as HOLD-04 discloses it on the dashboard.
- One shared case (fixture consumed by both the TS reader test and the match test) proves the two runtimes agree on the A-marker / B-older case.

### HOLD-04 dashboard marker-read failure
- `getMyAllocationDashboard` reports a non-null `markerReadError` to Sentry (`captureToSentry`, level warning, an `area` tag, the supabase message in `extra`, user id; no raw key ids beyond what existing captures carry) and carries a boolean degraded flag in the payload.
- The rows are KEPT (the marker read failing must not blank Holdings, as the reader's own comment requires) and the note says the latest figures may include an account whose newest day could not be priced-checked. "Stale rows are never shown silently" is met by the note, not by hiding rows.
- The note is a new `degrade-warnings.ts` registry entry rendered through `DegradeLine`, shown wherever the Holdings / live total reads the affected rows (exact mount points and copy at planning, per DESIGN.md Voice).

### HOLD-05 every failing shared-account key named
- `key-data-gaps.ts` (`deriveKeyDataGapsField` path) emits the attributed key ids for the `shared_account_failing` cause (every key of each all-failing group, whether or not its tail has a range), and the payload carries them to `missingDataLines`.
- `missingDataLines` applies the R3-01 rule to `shared_account_failing` as it does to `not_syncing`: the book-level fallback stays unless every attributed key is in a printed line.
- ⛔ CORRECTED 2026-11-26 (UI-SPEC check, before planning): 'covered (named, or the fallback prints)' was weaker than ROADMAP SC-4 and REQUIREMENTS HOLD-05, which say every failing key is NAMED. The requirement governs (it is the more authoritative source; CLAUDE.md Rule 7). Every attributed `shared_account_failing` key must appear BY LABEL in a printed line. A key that no dated gap line names (its account's history reaches yesterday, so no tail range) is named in a labelled line of its own that states no day (no invented date, no 'no complete history yet' claim). That line is a new `degrade-warnings.ts` registry entry; its copy is Claude's discretion in DESIGN.md Voice (no founder channel in this run), modelled on the shipped `allocation.key-gap.shared-account-failing` sentence minus its coverage clause. The unnamed book-level fallback then stays only for a key the owner's list cannot label (review SFH-4 behaviour unchanged).
- ⛔ CORRECTED 2026-11-26 (review round 1, WR-01): the TS groups (login identity, every owner key, `sync_status`) are not the derive's groups (marker links, eligible keys, the working-holder predicate), and the derive's `no_working_groups` count is not carried in the payload (it is only logged), so there is no cheap path to compare counts. So a group named ONLY by the undated labelled line no longer suppresses the book-level shared-account line: the book line stays beside it. Every failing key is still named by label (SC-4 holds). The book line is suppressed only when every group is named by a printed dated gap, as before this phase.
- The RED fixture is the two-account case from UI-SPEC S3 (two all-failing shared accounts, one with a tail gap, one whose history reaches yesterday): it fails on pre-fix code. The TODOS entry's literal two-key case is kept too; under the naming rule its expected output changes from the book fallback to the undated labelled line, so it is also RED at HEAD (plan 06, planner decision 2).

### Decided autonomously
- [HOLD-01] Q: 'Throw inside keyAccountOf or check in each caller?' → Selected: 'In keyAccountOf, plus strict accountByKey lookups in the two dollar callers' — internal helpers, one call site each to revert.
- [HOLD-01] Q: 'Should the per-key reader issue an extra query to find holdings rows of keys outside the identity read?' → Selected: 'No; it reads rows per identity key, so such a row is never counted; the strict accountByKey lookup covers the counted path' — adding a query later is local.
- [HOLD-02] Q: 'Group-level marker day or per-key filter only?' → Selected: 'Marker as a reading day, account newest = max over keys (the TS reader's rule)' — one function in match.py.
- [HOLD-02] Q: 'Where does the shared case live?' → Selected: 'A JSON fixture under analytics-service/tests/fixtures replayed by a TS test and a pytest, like one_key_per_account_day_cases.json' — test-only file.
- [HOLD-04] Q: 'Sentry level and tags?' → Selected: 'warning, area tag, like the scenario commit route's capture of the same condition' — one call site.
- [HOLD-05] Q: 'Payload shape for the attributed ids?' → Selected: 'An extra field next to the gaps (or on the reason), server-built, owner ids only' — internal payload, not a public contract.

### Claude's Discretion
- HOLD-04 note wording and placement, within DESIGN.md Voice and the degrade registry's conventions. Founder may override at review.
- Plan split and wave layout.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `keyAccountOf`, `KEY_IDENTITY_COLUMNS`, `fetchLatestHoldingsPerKey` (with `markerReadError`, `accountByKey`) in `src/lib/latest-holdings-per-key.ts`.
- `oneKeyPerAccountDay`, `HoldingsUpdatedAtError` (named-error pattern) in `src/lib/holdings-account-day.ts`.
- `fetchHoldings` in `src/lib/portfolio-exposure.ts` (already throws on identity read error / row cap).
- `read_native_unpriced_days`, `account_identity_tokens`, `one_key_per_account_day` (Python twins) in `analytics-service/services/`.
- `captureToSentry` usage for the same condition in `src/app/api/allocator/scenario/commit/route.ts` (markerReadError branch).
- `degrade-warnings.ts` registry + `DegradeLine` for every user-facing degrade sentence.
- `missingDataLines` R3-01 logic for `not_syncing` in `MissingDataMessage.tsx`.

### Established Patterns
- Fail loud: an error and an empty result are distinct; named error classes; never collapse an error into `[]`.
- Cross-runtime twins replayed against one JSON case table (`analytics-service/tests/fixtures/one_key_per_account_day_cases.json`).
- PROOF-01: each gate neutered, RED with its named arm first, restored from a byte backup (`cp` + `cmp`), GREEN, recorded verbatim in the plan SUMMARY.
- Analytics gates include mypy strict.

### Integration Points
- `getMyAllocationDashboard` / `derivePhase07Fields` in `src/lib/queries.ts` (around the `phase07HoldingsRes` use).
- `_load_holding_portfolio_context` in `analytics-service/routers/match.py` (Step 1b and Step 2).
- `src/app/(dashboard)/allocations/lib/key-data-gaps.ts` and `components/MissingDataMessage.tsx`; the Holdings tab (`HoldingsTabPanel.tsx`) for the HOLD-04 note.

</code_context>

<specifics>
## Specific Ideas

- HOLD-05 test case is fixed by the TODOS entry: two keys, both shared-account failing, one with a gap and one with data through yesterday; both covered.
- HOLD-02 case is fixed by the TODOS entry: key A marker on D, key B newest rows on D-1, same account; match AUM equals Holdings (B's rows out).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
