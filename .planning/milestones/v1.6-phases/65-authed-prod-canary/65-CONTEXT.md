# Phase 65: Authed Prod Canary (GUARD-04) - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Live verification ONLY — no code changes unless the canary finds a prod bug
(then: bug-queue discipline, regression test per fix, fix via feature branch).
Everything under test shipped in PR #572 (squash f78f036b, v0.36.0.0), verified
deployed: Vercel Production success at exact SHA + Railway analytics SUCCESS.

In scope: GUARD-04 — the purified scenario surfaces verified live on authed
prod with 0 console errors; old drafts compute identically (v3→v4 upgrade).
Out of scope: any refactor, any non-scenario surface, test-project work.
</domain>

<decisions>
## Implementation Decisions (all locked by ROADMAP + P61 precedent — no grey areas)

- **Recipe**: the P61 recipe verbatim — qa-demo@quantalyze.app (role=both,
  is_admin) via service-role magic-link `action_link` (no password typed),
  interactive session in the Playwright MCP browser, Atlas book on
  /allocations. Prod = quantalyze.xyz.
- **Success criteria** (roadmap, verbatim):
  1. Book blend, blank mode, and mixed keys+added render live with 0 console
     errors.
  2. Save→reopen round-trips the persisted membership; compare columns and
     share mint/resolve behave correctly on the live purified surfaces.
  3. The golden P61 verify numbers reproduce for a book-only draft on the
     Atlas book (v3→v4 upgrade computes identically) — no series-space
     regression from the removal.
- **Golden P61 reference numbers** (from 61-VERIFICATION.md, observed live
  2026-07-03 pre-purification): saved book-draft compare column Cum +0.06% /
  Sharpe 0.11 over its 40-day persisted window; Live-book column 155
  overlapping days; drawer-add + "Common period (all in)" → header "Mean of
  5 strategies".
- **New-in-v1.6 surfaces to verify**: scenario KPI strip is return-form only
  (no AUM cell, 4-up @lg); mixed-share public page carries the caption
  "computed from this scenario's catalog strategies only" (book-only mint
  still 409s); Update-portfolio from a reopened book draft preserves
  membership (red-team F-1 fix); blank-slate segment stays honest.
- **Cleanup**: every scenario/share the canary creates is deleted from prod
  before the phase completes (P61 pattern).
- **Bug handling**: queue mid-canary bug reports, finish the current item
  first ([[feedback_bug_queue_dogfooding]]); every found bug gets a
  regression test that fails without the fix.
</decisions>

<code_context>
## Existing Code Insights

- P61 canary artifacts: .planning/milestones/v1.5-phases/61-authed-prod-canary/
  (PLAN checklist shape, VERIFICATION evidence format, login recipe).
- Passwordless authed-prod verification recipe (memory ⭐): service-role
  magic-link → setSession cookie → curl route → grep RSC flight data — the
  fallback if the Playwright MCP browser can't carry the session.
- Share routes are public (proxy.ts PUBLIC_ROUTES) — share-resolve leak
  posture pinned by vitest at resolve + render layers; canary spot-checks the
  live caption + absence of member UUIDs in the page source.
</code_context>

<specifics>
## Specific Ideas
- Console-error capture per step (Playwright MCP read_console_messages), not
  one sweep at the end.
- The v3→v4 identity check (SC3) is the highest-value item: open the
  pre-existing saved Atlas book draft (saved under v1.5) and confirm the
  numbers match the P61 goldens after the engine deletion.
</specifics>

<deferred>
## Deferred Ideas
- 6 remaining phase10-rpc residue *users* in prod auth.users (holders were
  the GUARD-01 scope; users deferred at 63).
- TODOS.md red-team follow-ups F-3/F-4/F-5 (next milestone).
</deferred>
