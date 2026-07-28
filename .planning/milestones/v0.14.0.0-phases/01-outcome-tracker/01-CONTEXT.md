# Phase 1: Outcome Tracker - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Allocators record outcomes (allocated or rejected) on Bridge-introduced strategies via an inline banner on the My Allocation Holdings widget. Outcomes persist to a new `bridge_outcomes` table with three-tier RLS. A daily cron computes realized 30/90/180-day delta from `strategy_analytics.returns_series` (idempotent via `WHERE delta_30d IS NULL`). Every recording/update is audit-logged.

Scope is end-to-end for Phase 1: migration + RPC surface (`/api/bridge/outcome` POST) + banner UI + recording form + estimated-delta computation + daily cron.

</domain>

<decisions>
## Implementation Decisions

### Banner UX
- **D-01:** Row-integrated strip appears beneath each eligible Holdings row: text prompt "Did you act on this Bridge suggestion?" with `[Allocated]` `[Rejected]` `[×]` buttons. No card-above-table; no expand-to-open chip. Strip styling must align with DESIGN.md (DM Sans body, Geist Mono for numeric labels elsewhere).
- **D-02:** Banner surface is the **My Allocation Holdings widget** only (`src/app/(dashboard)/allocations/`). No standalone Bridge Outcomes page in Phase 1.
- **D-03:** Eligibility filter runs **server-side**: banner never renders unless the row has a matching `match_decisions.decision = 'sent_as_intro'` AND no existing `bridge_outcomes` row AND not currently snoozed. Client relies on the server list; no client-only filter fallback.
- **D-04:** OUTCOME-04 enforcement is strict: server-side join verification at list-time means banner is never shown for non-eligible rows. POST handler still performs belt-and-suspenders check and returns 403 with structured error if called for an ineligible strategy (defense in depth — no user-facing toast expected).

### Dismiss Behavior (server-side snooze)
- **D-05:** Dismiss is **server-side with TTL**, not client sessionStorage. Rationale: persists across tabs/devices, works for the typical allocator workflow (multi-device logins). Cost: adds a small table.
- **D-06:** Add table `bridge_outcome_dismissals` (allocator_id, match_candidate_id or strategy_id reference, dismissed_at, expires_at). RLS: owner-read, owner-insert, owner-delete; admin-read; service-role-all.
- **D-07:** Snooze TTL = **24 hours** (reappears next visit after a day). Banner query excludes rows where a non-expired dismissal exists. No manual "undismiss" UI — outcome recording or TTL expiry clears it.

### Recording Form
- **D-08:** **Two separate flows**, not a single toggle form. `[Allocated]` opens the allocated form; `[Rejected]` opens the rejected form. Forms render inline (replace the banner strip on that row, not a modal).
- **D-09:** Allocated fields: `percent_allocated` (required, 0.1–50%; if the allocator has `max_weight` set from Phase 2, soft-warn but do not block when exceeding it — Phase 2 ships in parallel), `allocated_at` (date, required, not future, not >365d past), `note` (optional textarea, nullable). All fields validated client + server.
- **D-10:** Rejected fields: `rejection_reason` (required; enum: `mandate_conflict`, `already_owned`, `timing_wrong`, `underperforming_peers`, `other`), `note` (optional textarea; required when reason = `other`). Enum drives structured signal for Phase 4 feedback engine.
- **D-11:** Save behavior: **inline replace + success toast**. On successful POST, the banner strip for that row is replaced by a status line: `Recorded: Allocated 12% on 2026-04-17 • Estimated +1.2% (3d)` (or `Recorded: Rejected — Mandate conflict`). Toast copy: "Outcome recorded".

### Estimated Delta Labels
- **D-12:** Label progression follows **exact days available**:
  - Days 0 (immediately after recording): `Pending` pill if zero returns data exists.
  - Days 1–29 (partial): `Estimated: +X.X% (Nd)` where N = days of returns data available since `allocated_at`.
  - Day 30+: upgrade to `30-day: +X.X%`; at day 90 to `90-day: +X.X%`; at day 180 to `180-day: +X.X%`.
  - Always show the most-mature label available on the row.
- **D-13:** Color treatment: **green/red only on realized windows** (30d/90d/180d). Estimated and Pending are neutral (default text color). Rationale: avoids over-reading noise from very short windows.
- **D-14:** Row-level cron failure state: keep the user-facing label as **Pending**. Do not surface backend errors to allocators. Structured error goes to admin operational logs (reuse existing admin logs surface). `needs_recompute` stays `true` so the next cron retry picks it up.

### Cron + needs_recompute (not selected for discussion — inherits defaults)
- **D-15:** Daily cron `compute_bridge_outcome_deltas` runs once per day (schedule: 03:00 UTC, matches other existing Vercel Hobby-plan crons). Idempotent guard: `WHERE delta_30d IS NULL OR needs_recompute = true`. Admin operational logs record batch size + per-row failures. Re-running same day produces identical values.
- **D-16:** `needs_recompute` flag is set `true` on every upsert to `bridge_outcomes` (including updates to `percent_allocated` or `allocated_at`). Cron clears it after successful compute per row.

### Clarifications (post-research, 2026-04-17)
- **D-17:** Outcomes are **editable by owner**. Allocator may re-record `percent_allocated`, `allocated_at`, `note`, `rejection_reason`. Every update sets `needs_recompute = true` and writes a new audit event.
- **D-18:** `bridge_outcome_dismissals` dedupe key = **`strategy_id`** (one dismissal per allocator+strategy). Not `match_candidate_id`.
- **D-19:** Daily cron computes deltas **only for `outcome = 'allocated'`** rows. Rejected rows are feedback-engine input for Phase 4.
- **D-20:** Phase 1 E2E spec ships **gated on `HAS_SEEDED_SUPABASE`** env — seeded Supabase CI is deferred to a follow-up issue. Unit/RLS/contract tests run in CI unconditionally.

### Claude's Discretion
- Database column names, indexes, and constraint naming conventions — follow existing migration style (055–058 range).
- React component structure inside the allocations widget (separate `BridgeOutcomeBanner`, `AllocatedForm`, `RejectedForm` components vs one composite — pick what matches existing allocations widget patterns).
- Toast library: reuse whatever the existing dashboard uses — do not introduce a new one.
- Error copy refinements within the spirit of D-11/D-14.
- Animation/transition specifics for banner → form → recorded-row inline replace.
- Banner visual treatment details (border color, padding, typography) — must follow DESIGN.md.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — Sprint 8 vision, core value, key decisions
- `.planning/REQUIREMENTS.md` — OUTCOME-01 through OUTCOME-08 (locked)
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, plan breakdown
- `DESIGN.md` — Typography (DM Sans body, Geist Mono numerics), color, spacing — all banner/form styling must follow

### Architecture & conventions
- `.planning/codebase/ARCHITECTURE.md` — app layering
- `.planning/codebase/CONVENTIONS.md` — code style
- `.planning/codebase/STACK.md` — Next.js / Supabase / RLS patterns
- `.planning/codebase/STRUCTURE.md` — directory layout
- `.planning/codebase/TESTING.md` — unit + Playwright patterns
- `.planning/codebase/CONCERNS.md` — note: CI runs only 4 of 21 Playwright specs; Phase 1 E2E needs CI wire-up

### Audit logging
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — `entity_type` naming, log schema. Phase 1 uses `entity_type = 'bridge_outcome'` (per OUTCOME-08).
- `supabase/migrations/049_audit_log_hardening.sql` + `058_log_audit_event_service.sql` — `log_audit_event` signature and service-role variant

### Adjacent surfaces
- `src/lib/admin/match.ts` — existing match-decision admin helpers; banner eligibility join uses `match_candidates` + `match_decisions`
- `src/app/api/admin/match/decisions/route.ts` — pattern for match-decision API routes
- `src/app/api/admin/match/send-intro/route.ts` — mirror structure for new POST /api/bridge/outcome
- `src/app/(dashboard)/allocations/AllocationDashboard.tsx` + `src/app/(dashboard)/allocations/page.tsx` — insertion surface for banner
- `src/lib/queries.ts` + `src/lib/queries.my-allocation.test.ts` — allocations data-fetch patterns
- `docs/superpowers/specs/2026-04-10-my-allocation-dashboard.md` — current Holdings widget layout

### Cron patterns
- `supabase/migrations/056_retention_crons.sql` — example cron registration
- `docs/runbooks/match-engine.md` — operational log conventions

### Returns data source
- `strategy_analytics.returns_series` — delta computation source (per OUTCOME-06). Planner should verify exact schema + timezone handling before writing the SQL function.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `log_audit_event` SQL function — covers OUTCOME-08; no new audit plumbing needed
- Existing RLS helper patterns across migrations 045–058 — owner-select / owner-insert / admin-select / service-role-all is a proven template
- Match pipeline tables (`match_candidates`, `match_decisions`) — the `sent_as_intro` signal for banner eligibility
- Allocations dashboard scaffolding (`src/app/(dashboard)/allocations/`) — React + react-grid-layout widget pattern already in place
- Vercel cron config — existing entries under Hobby plan cap (per commit 786e6c7); new cron must stay within that cap

### Established Patterns
- **RLS three-tier**: owner-* + admin-select + service-role-all is the canonical schema
- **SECURITY DEFINER RPCs** for allocator writes (Phase 2 uses this for mandates; Phase 1 can follow same pattern for outcome upsert if SQL trust boundary is preferred over route-level trust)
- **`ALLOCATOR_PREFERENCES_COLUMNS`-style column sync tests** — consider a similar smoke test for `bridge_outcomes` columns
- **Daily cron via Vercel** — remains within Hobby-plan cap after 786e6c7; new cron must be budgeted

### Integration Points
- New route: `POST /api/bridge/outcome` (allocator-scoped, validated against auth.uid())
- New table: `bridge_outcomes` + `bridge_outcome_dismissals` + cron function
- New component(s): `BridgeOutcomeBanner`, `AllocatedForm`, `RejectedForm` inside allocations Holdings widget
- New query: Holdings widget needs to fetch eligibility (sent_as_intro strategies with no outcome + no active dismissal) — extend or parallel to existing my-allocation queries
- New cron registration: Vercel cron config (stay within Hobby cap)

</code_context>

<specifics>
## Specific Ideas

- Success-criterion #2 example wording `"Recorded: Allocated 12% on 2026-04-17 • Estimated +1.2% (3d)"` is the target UX — planner should use this exact pattern for the inline replace text.
- OUTCOME-05 example `"Estimated: +2.1% (3d)"` → `"30-day: +4.3%"` is the canonical label progression (D-12).
- Rejection reasons are enum-backed for Phase 4 feedback engine attribution (D-10) — do NOT stringify as free text in the column.
- `max_weight` soft-warn (D-09) couples loosely with Phase 2 — Phase 1 should not hard-depend on Phase 2 being shipped; if the column is NULL, no warning.

</specifics>

<deferred>
## Deferred Ideas

- Standalone Bridge Outcomes page (deferred to Phase 5 Outcomes Dashboard — covers history surface)
- Client-only sessionStorage dismiss (rejected in favor of server-side TTL)
- Retry button on cron-failed delta rows (rejected — admin-only concern; user sees Pending)
- Full column-level RLS on `bridge_outcomes` (deferred indefinitely — Postgres limitation; RPC pattern is sufficient)
- Cron observability dashboard / success rate chart — can come with Phase 5 admin-facing work if needed

</deferred>

---

*Phase: 01-outcome-tracker*
*Context gathered: 2026-04-17*
