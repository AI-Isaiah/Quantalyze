# Phase 174 MARKPAUSE - Context

**Gathered:** 2026-10-27
**Status:** Ready for planning

<domain>
## Phase Boundary

A strategy whose marks have paused (`marks_trailing_since`) is re-derived by the ledger fan-out weekly instead of daily, and a strategy- or key-mode mark refusal token with its first-seen day is kept where only the owner or an admin can read it, never in public `data_quality_flags`. Not user-facing.

</domain>

<decisions>
## Implementation Decisions

### Carried (not re-asked)
- NAVMTM 167.2.1.1.1 L3 (a refusal names a reason and writes nothing), D-01 (owner-only marks table, migration reviewers required), D-05, D-06, D-12 (`data_quality_flags` is the published surface).
- NAVMTM REVIEW-2 WR-04: refusal tokens never go into public flags. WR-03 routed here.
- 161.1 D-01: composites keep fan-out coverage; `enqueue_ledger_composite_refresh` is not touched.
- The staleness view's verdict fails toward stale and is not changed (its static gate bans time columns in the verdict).
- `MARK_REFUSAL_TOKENS` is a closed, pinned set.

### Premise correction (measured at HEAD 53f25ac3)
The fan-out ticks hourly but its single-key body keeps a 20-hour attempt cooldown, so a paused strategy costs about one extra derive a day, not 24. That daily derive is also the only recurring path that clears `marks_trailing_since` for deribit, sfox and mt5 strategies once marks resume.

### D-01 Re-crawl: re-admit weekly
Founder 2026-10-27, AskUserQuestion: "Re-admit weekly (Recommended)". `enqueue_ledger_refresh_for_strategies` (single-key arm only) re-admits a strategy whose analytics carry `marks_trailing_since` once every 7 days instead of daily. Migration re-based on the latest definition (20260924120000 re-base, `ledger_fanout_failure_count`), catalogue-only verify block, no `cron.schedule`, baseline re-dump with the carried-migrations marker, migration-reviewer and rls-policy-auditor clean before merge. Matched-pair SQL gate arms (paused excluded within 7 days, unpaused included, paused re-admitted after 7 days).

### D-02 Private record: owner-only rows, no migration
Founder 2026-10-27: "Owner-only rows, no migration (Recommended)". A new row family `nav_mark_refusal:<api_key_id>` in `allocator_equity_derived` (owner SELECT, service-role write; a new family needs no migration). Payload: token, first-seen day, last-seen day. Written from the shared `_write_nav_mark_for_this_derive` seam for both strategy and key mode; deleted when the key marks again; the worker validates the token against `MARK_REFUSAL_TOKENS`.

### D-03 Reader (Claude's call, analyzer recommendation)
A documented read-only SQL readout of the refusal rows in `docs/runbooks/navmtm-chain-move-go-live.md` (or a short new runbook), with the query's shape tested, so the record is not write-only.

### D-04 Weekly window starts after 3 days paused (founder 2026-10-27, review round 1)
Founder 2026-10-27, AskUserQuestion: "Weekly only after 3 days paused (Recommended)". Refines D-01 after REVIEW MR-01 / SFH F1: one transient refusal stamps `marks_trailing_since`, and a weekly window from day one froze a deribit/sfox/mt5 strategy's public chart for up to 7 days. The fan-out keeps the 20-hour cooldown while the pause (the flag's own first trailing day) is under 3 days old and switches to 7 days once it is 3 or more days old. A malformed flag value falls back to 20 hours and never raises inside the tick.

### Claude's Discretion
- How first-seen is preserved (read-before-write) and whether key mode's existing `nav_mark_refusal` in `key_inputs` is kept beside the new rows.

</decisions>

<code_context>
## Evidence and starting points
- `supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql` (cooldown, per-venue cap); `supabase/tests/test_ledger_refresh_fanout.sql` (twins point at the last re-creating migration; recount occurrences/nth); census files (`ci.yml` sentinel table, `scripts/mutation-floors.mjs`, `src/__tests__/mutation-runner-floors.test.ts`, annotation-parser and anti-skip contract tests).
- `analytics-service/services/job_worker.py` mark write seam, `marks_trailing_since` stamp, prestamp; `nav_marks.py` tokens; `key_capture:` row-family helper as precedent.
- Unmeasured: how many PROD strategies carry `marks_trailing_since` today (read-only count at plan time).
</code_context>

<canonical_refs>
## Canonical References
- NAVMTM `167.2.1.1.1-REVIEW-2.md` WR-03, WR-04; `167.2.1.1.1-SFH-2.md` F3; CONTEXT D-01..D-24 (branch feat/167.2.1.1.1-navmtm).
- `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql`, `.planning/phases/161.1-*/161.1-CONTEXT.md`.
</canonical_refs>

<deferred>
## Deferred Ideas
- An alert after N nights of the same refusal token.
- A dedicated refusal table with an admin RLS read policy.
</deferred>
