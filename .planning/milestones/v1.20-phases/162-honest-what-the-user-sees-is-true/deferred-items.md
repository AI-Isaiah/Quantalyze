# Phase 162 — deferred items

Discovered while executing, out of the current plan's scope. Not fixed here.

## From 162-02 (HONEST-01, computation_error curation)

### D1 — Name the failing MEMBER on a composite analytics failure (regression this plan accepts)

**What changed.** `SyncPreviewStep`'s failure envelope used to append
`Details: {computation_error}.`, and on the composite branch that appendix was the
only thing that said anything member-specific. UI-SPEC C-2 removes the appendix and
migration 20260826120000 replaces the column's contents with kind-derived copy, so
the envelope now says "Analytics computation failed." and nothing about which member
broke.

**How large the loss actually is — measured, because the test that pinned it
overstated it.** `SyncPreviewStep.composite.render.test.tsx` Pin 2 supplied the
fixture `"Key 2 (deribit) failed to reconstruct: geo-blocked"` and asserted the
envelope named the member. No writer produces that string. What the composite path
actually writes is `DispatchResult.error_message`, e.g.
`run_stitch_composite_job: ccxt member crawl geo-blocked — <scrubbed ccxt exception>`
(analytics-service/services/job_worker.py, the per-member arms). So the shipped
behaviour was a function name plus an exception tail, not a member label. The
affordance being "lost" was mostly fictional; what is really lost is the venue token
buried inside that operator string.

**What a real fix looks like.** A STRUCTURED channel: the composite failure path
records the failing member's id/venue in a typed field the envelope can format
(`WizardErrorContext` gaining e.g. `failingMemberVenue`), and `wizardErrors.ts` owns
the sentence. Explicitly NOT: re-adding a free-text server column to the envelope
body, which is the pattern this phase removed.

**Why not now.** It needs a new persisted field and a copy decision; 162-02's scope
was the write boundary. Naming the member is the single most useful thing a composite
failure could say, so this is worth scheduling rather than dropping.

### D2 — Two SQL writers put operator jargon in `portfolio_analytics.computation_error`

Both are pre-existing, neither is raw exception text, so neither violates HONEST-01's
letter — but both are visible to the account holder through the portfolio dashboard's
StaleWarning and neither reads like user copy:

- `supabase/migrations/20260516122247_portfolio_analytics_stuck_row_reaper.sql:45` —
  `'watchdog: stale row'`
- `supabase/migrations/20260714090000_portfolio_recompute_inflight_unique.sql:66` —
  `'PI-07 dedupe: superseded duplicate computing row (migration 20260714090000)'`

The second one shows a user a migration filename. The strategy-side equivalent
(`20260803130000`) was already rewritten to user copy — "Analytics was interrupted
before it could finish and did not recover. Retry the sync." — so the pattern and the
precedent both exist; the portfolio side just never got the pass.

### D3 — `src/lib/database.types.ts` does not know about `computation_error_copy`

The generated types are regenerated from PROD, so the new function is absent until
the next regeneration. Nothing in CI checks that file against `supabase/migrations/**`
(verified: no workflow references it), and nothing in the app calls the function from
TypeScript — it is service-role-only and called from inside a SECURITY DEFINER bridge.
Harmless today; noted so a future "why is this type missing" does not read as a bug.
