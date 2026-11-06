# Phase 191: REFUSALRACE - Context

**Gathered:** 2026-11-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Two writers change `compute_jobs.metadata` by reading the whole object, editing one key and writing the whole object back (PostgREST replaces the column):

- the derive's refusal marker, `_mark_job_kept_figures` in `analytics-service/services/job_worker.py` (writes `read_refusal_kept_figures: true`, Phase 186 D-11/D-13);
- a Sync's retraction of an inherited ledger-refresh marker, in two copies: Python `_retract_refresh_marker_on_reuse` (`analytics-service/services/ingestion/long_fetch.py`) and TypeScript `retractInheritedRefreshMarker` (`src/lib/ledger-refresh-marker.ts`). It removes `source`, adds `refresh_marker_retracted` and `correlation_id`, and never touches a `done` job (166.5 D-07).

If one write lands between the other's read and write, it is undone. Marker lost: the status bridge stamps the strategy `failed` over figures the refusal kept. Retraction lost: a user's Sync job stays protected as a refresh. The claim RPC's additive `unified_backbone_at_claim` key is lost the same way (161.1 D-12 residue).

This phase makes every one of those writes a single atomic statement that merges into `metadata`, so interleavings keep every key. Nothing else about the marker, the retraction or the bridge changes.

</domain>

<decisions>
## Implementation Decisions

### The retraction
- **D-01:** The retraction is a new, small, service-role-only SQL function that does the whole retraction in ONE `UPDATE`: drop `source` only when it is a ledger-refresh marker (`ledger-refresh`, `ledger-refresh-composite`), add `refresh_marker_retracted = <old source>` and `correlation_id = <caller's id>`, preserve every other key, and match no `done` row. It reports what it did (retracted with the marker, or not, and why) so the callers keep today's outcomes, log lines and error contracts. Python and TypeScript both call it; their read-modify-write bodies go away. `enqueue_compute_job` is NOT changed. Founder 2026-11-04, AskUserQuestion: "Small dedicated RPC (Recommended)". **This deviates from the ROADMAP booking's SC-2 wording ("a merge arm in `enqueue_compute_job` for the retraction"), which is updated to match.** Reason given in the question: `enqueue_compute_job` runs on every enqueue path, and changing its signature has a history of overload and ACL drift in this repo. — **Reversibility:** one-way — a new function in a PROD migration; undoing it needs a follow-up migration.
- **D-02:** The gap between `enqueue_compute_job` returning a deduped id and the retraction running stays as it is today (it existed before this phase and is not the race this phase closes). Recorded so a reviewer does not read it as missed.

### The refusal marker
- **D-03:** The marker is written by one JSONB merge statement (`metadata = COALESCE(metadata, '{}') || '{"read_refusal_kept_figures": true}'`), through a service-role-only SQL function or an equivalent single-statement write; the planner picks the form. The write still goes through `_stamp_io` with `_STAMP_OP_REFUSAL_MARKER_WRITE`, and a write that did not land still fails the job TRANSIENT with nothing else written (Phase 186 R3-02). Founder's booked SC-2, unchanged.

### Tests and proof
- **D-04:** Each writer gets a test that goes RED on today's replace behaviour (neuter, see RED, restore from a byte backup). A SQL gate interleaves the two writes (and a claim-style additive write) and asserts every key survives (SC-3). New SQL arms move the censuses (ARMS_FLOOR, SENTINEL_FLOOR, scoped-update counts): grep them all.
- **D-05:** SC-1 is a read-only PROD count (marker query first and alone): jobs carrying `read_refusal_kept_figures`, jobs carrying `refresh_marker_retracted`, and any row carrying both. Recorded before any code change. Counts only, no ids.

### After research (founder 2026-11-04, AskUserQuestion)
- **D-06:** Ship as TWO PRs. PR 1 carries the two SQL functions and the SC-3 gate; PR 2 switches the Python and TypeScript writers once PR 1 is applied on PROD. Answer: "Two PRs, migration first (Recommended)". Reason: migrations auto-apply on merge and the Vercel deploy is not ordered against the apply.
- **D-07:** The refusal marker counts as written only when the function confirms it changed a row (`true`). Anything else fails the job TRANSIENT, the same path as a write error today. Answer: "Require a confirmed write (Recommended)". **This deviates from D-03's "nothing else changes"** (today a zero-row update is silent success); recorded in the ROADMAP too.
- **D-08:** Python treats the retraction function's `no_row` outcome as loud (warning log plus one Sentry capture), as TypeScript already does. Answer: "Loud (Recommended)".
- **D-09 (Claude's discretion, from RESEARCH Open Questions 4-7, recommendations taken):** no `claim_token` fence on the marker (parity with today); a live two-connection concurrency probe in the `HAS_LIVE_DB` idiom; a new gate file `supabase/tests/test_compute_job_metadata_merge.sql`; the gate's claim-style write is a copied expression, not a call to the real claim RPC.

### Claude's Discretion
- Function names, return shape, and whether the marker uses its own function or a narrow generic merge.
- Whether the TypeScript and Python callers share one result contract test.

</decisions>

<specifics>
## Specific Ideas

- Keep the SQL `is_protected` predicate of `sync_strategy_analytics_status` reading `metadata->>'source'` exactly as today: the retraction must still remove `source` itself (161.1 D-13 reasoning in `_retract_refresh_marker_on_reuse`'s docstring).
- The parity pin between `LEDGER_REFRESH_JOB_SOURCES` in Python and TypeScript (`ledger-refresh-marker.test.ts`) must cover the marker set the SQL function uses too, so the three cannot drift.
- Migrations: re-base on the latest definitions, SECURITY DEFINER with a pinned search_path, EXECUTE revoked from PUBLIC/anon/authenticated and granted to service_role only; migration-reviewer and rls-policy-auditor clean before merge (SC-4).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/ROADMAP.md` — `### Phase 191` (goal, evidence, success criteria; SC-2 as amended by D-01)
- `TODOS.md` — `[186-REFUSAL-MARKER-RMW-RACE]` (the reading and the trigger)
- `.planning/phases/186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed/186-CONTEXT.md` — D-11, D-13 (why the marker exists and why the race was routed here)
- `.planning/phases/186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed/186-REVIEW.md` — the round-4 review section rating the race
- `supabase/migrations/20261105120000_sync_status_protect_refused_derive.sql` — the bridge that reads the marker
- `CLAUDE.md` — "Which database am I on?", SQL gate integrity, CHANGELOG discipline

</canonical_refs>

<code_context>
## Existing Code Insights

### Writers to replace
- `analytics-service/services/job_worker.py` — `_mark_job_kept_figures` (nested in the refusal stamp), `READ_REFUSAL_KEPT_FIGURES_KEY`, `_stamp_io`
- `analytics-service/services/ingestion/long_fetch.py` — `_retract_refresh_marker_on_reuse` (best-effort; caller's `try:` contains failures; zero-row update → status re-read; `done` is a quiet skip)
- `src/lib/ledger-refresh-marker.ts` — `retractInheritedRefreshMarker` (throws with PostgREST `cause`; `retractionFailureCode`)

### Readers that must keep working
- `sync_strategy_analytics_status` (`is_protected`, `metadata->>'source'`, `read_refusal_kept_figures`)
- `services/job_worker.py` honour sites for `LEDGER_REFRESH_JOB_SOURCES`
- `claim_compute_jobs_with_priority` (5-arg) writes `unified_backbone_at_claim` additively

</code_context>

<deferred>
## Deferred Ideas

- Moving the retraction into `enqueue_compute_job`'s dedup (closes D-02's gap too). Not chosen (D-01); book it only if D-02's gap is ever observed.

</deferred>

---

*Phase: 191-refusalrace*
*Context gathered: 2026-11-04*

## Deviations recorded at close (2026-11-06)

- **D-08, error rather than warning.** D-08 asks for a warning log plus one Sentry capture on `no_row`. Plan 191-07 kept the existing `refresh_marker_retraction_matched_no_row` line at error level, plus the one Sentry capture. That is the louder of the two, and it keeps today's log line as the plan's task text asked (191-07-SUMMARY, Deviations). Review rounds and the verifier accepted it.
- **Plan 191-08, neuter reading (c).** The plan expected that deleting the `@audit-skip` pragma above the retraction call would turn the audit corpus test red. It cannot: both routes emit `logAuditEventAsUser(... "sync.start" ...)` in the same function, so the site counts as covered without the pragma. The reading that does fail is the pragma removed together with that emission, and it names the site. A control with the allowlist entry also removed does not name it. The mutator pin is still what fails first on a lost allowlist entry (191-08-SUMMARY, Deviations). No route file was changed.
