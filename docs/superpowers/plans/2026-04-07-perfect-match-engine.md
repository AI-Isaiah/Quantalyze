# Perfect Match Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

<!-- /autoplan restore point: ~/.gstack/projects/AI-Isaiah-Quantalyze/feat-perfect-match-engine-autoplan-restore-20260407-100511.md -->

**Goal:** Make the founder 10x faster at matching allocators with quant teams, *without* exposing the algorithm directly to allocators. The math runs in Python and the founder is the only person who sees the ranked list. Allocators receive matches the way they always have — through the founder's intro flow — except now the founder works from a pre-ranked, pre-explained candidate set instead of mental model + spreadsheets.

**Why this shape (revised after dual-voice CEO review):** The original draft pointed the recommendation algorithm at allocators directly with scores and "perfect match" cards. Both Codex and the Claude subagent independently warned this would substitute for the founder's personal-trust moat instead of amplifying it — turning Quantalyze into a worse Bloomberg Terminal instead of a better Telegram group. The user chose Approach D (founder-amplifier) at the premise gate. This plan is the result.

**The 10/10 vision (founder's words):** "Match allocators and quant teams, AND provide additional value to allocators where they can see the performance of their portfolio, and what teams are the perfect match for them."

The portfolio performance piece already exists. Allocators already see "what teams are the perfect match for them" — but the *current* version of "perfect match" is a Telegram message from the founder. This plan keeps that surface (the founder's voice) and rebuilds the *back* of it (the founder's analysis time) with computation. Once the founder ships 20+ algorithm-suggested intros and at least 5 convert, the same engine can later be exposed allocator-facing — but only after the founder has tuned it against their own mental model.

**Architecture:** Four-phase build. Database + lightweight preferences first (everything reads from here), then Python match engine (same scoring math, fed allocator-by-allocator), then founder admin "match queue" surface (the only UI in v1), then eval + observability (so we know if it's actually working). No allocator-facing surface in v1. No `/recommendations` page. No PerfectMatchPanel widget on the dashboard. Discovery stays untouched.

**Why the rewrite:** Plan v0 (16 tasks, 5 phases) is preserved in git history at `becc478` for reference. Plan v1 (this version, ~7 tasks, 4 phases) is the post-CEO-review plan. The reduction is ~60% — most of it is "things that point at allocators" that are now deferred until the founder validates the engine internally first.

**Tech Stack:** Same as the rest of the product. Next.js 16 (App Router), Supabase (Postgres + RLS), Python FastAPI in `analytics-service/`, lightweight-charts where relevant, no new dependencies. The match scoring lives in Python because it needs pandas/numpy for correlation math and sits next to the existing `portfolio_optimizer.py`.

**Spec / Origin doc:** This plan extends the original product design at `~/.gstack/projects/AI-Isaiah-Quantalyze/helios-mammut-main-design-20260405-010321.md` (the office-hours session), specifically Premise 5 ("self-service discovery, founder-routed intros") and the cross-model insight: "this is a preference discovery problem, not a dashboard problem. The real product is a search/filter engine with allocator-defined weighting."

---

## What already exists (do not rebuild)

| Sub-problem | Existing code |
|---|---|
| Strategy directory + filters | `src/components/strategy/StrategyFilters.tsx`, `StrategyTable.tsx`, `discovery/[slug]` pages |
| Strategy metrics computation | `analytics-service/services/metrics.py`, `strategy_analytics` table |
| Portfolio intelligence dashboard | `(dashboard)/portfolios/[id]/page.tsx`, `portfolio_analytics` table, `portfolio_optimizer.py::find_improvement_candidates` |
| Pairwise correlation + sharpe lift scoring | `portfolio_optimizer.find_improvement_candidates` (already returns top-5 candidates with score) |
| Founder-routed intros | `contact_requests` table, `RequestIntroButton.tsx`, founder admin view |
| Allocations hub | `(dashboard)/allocations/page.tsx` |
| Compare strategies | `(dashboard)/compare/page.tsx`, `CompareTable.tsx` |
| Allocator profile (basic) | `profiles` table — has role, status, but no investment criteria |

**Critical reuse:** The existing `find_improvement_candidates` function already does *half* the matching math (sharpe lift, correlation reduction, drawdown improvement). The match engine extends it with: (a) preference fit, (b) the no-portfolio case (cold-start allocators), (c) explanation generation, (d) ranking against the *full directory* not just user-provided candidates.

## NOT in scope (defer)

- **Allocator-facing `/recommendations` page** — deferred to v2 once the founder has shipped 20+ algorithm-suggested intros and 5+ have converted. Reason: dual-voice CEO review.
- **`PerfectMatchPanel` widget on the portfolio dashboard** — deferred for the same reason.
- **Match score column on Discovery** — deferred for the same reason.
- **Save / dismiss / "show me more like this" feedback loop on the allocator side** — deferred. The founder records the same signal (thumbs up/down) on the admin side instead, which is the ground truth we actually need.
- **Allocator preference machine learning** — no implicit feedback model. Founder writes the rules in v1.
- **Two-sided matching** — managers don't see "good-fit allocators." Privacy default.
- **Cross-asset class recommendations** — crypto only.
- **Custom benchmark per allocator** — BTC default.
- **Notifications when a new high-score match appears** — defer pending allocator usage data.
- **"Smart" auto-rebalancing** — this plan only *suggests candidates to the founder*, it does not move money.
- **Charging for recommendations** — V1 free, matches existing monetization deferral.

## Premises (revised after CEO review premise gate)

1. **The founder is the moat. The algorithm is the leverage.** Allocators pay for the founder's judgment, not for ranking math. The algorithm's job is to compress the founder's analysis time from "1 hour per allocator" to "5 minutes per allocator," not to replace the founder's voice in front of customers.
2. **Score the candidates, but show the founder.** Compute a transparent, defendable score in Python. Surface that score in an admin view *for the founder only*. The allocator never sees the number — they see "Isaiah recommends these 3 for you" with a hand-written 1-line note.
3. **Lightweight preferences capture is opt-in, not gating.** Allocators do not need to fill out a 6-field form to receive recommendations. The founder can view and edit each allocator's preferences from the admin (think of it like a CRM note). When an allocator does fill in preferences, the founder sees it as additional signal.
4. **Cold-start is honest about being cold-start.** With no allocator portfolio, the algorithm produces a "screening shortlist" filtered by mandate archetype (preferred types/markets, min track record, capacity), not a "personalized rank." The founder reviews the shortlist and uses their own judgment. No "94/100 perfect match" score is ever shown.
5. **Ground truth comes from the founder's choices.** Every time the founder picks (or skips) a candidate the algorithm suggested, that decision is recorded. After 50+ founder decisions, we have actual training data — and only then is it worth considering an allocator-facing surface or implicit-feedback model.

## Implementation alternatives considered

### Approach A: ML-based collaborative filtering
Train a recommender on historical intro requests.
- Effort: XL (human: ~6 weeks / CC: ~3-5 days)
- Verdict: **Rejected**. Premature. Comes back as P2 once we have >500 historical intros AND founder ground truth.

### Approach B: Allocator-facing recommender (original draft)
Allocators see scored recommendations directly. PerfectMatchPanel widget on the dashboard, dedicated `/recommendations` page, score column on Discovery, save/dismiss feedback loop.
- Effort: L (human: ~3-4 weeks / CC: ~1 day)
- Verdict: **Rejected at premise gate.** Both Codex and Claude subagent independently warned this substitutes for the founder's personal-trust moat instead of amplifying it. User chose Approach D.

### Approach C: Hybrid (admin + flagged allocator-facing)
Founder admin view in Phase 1, allocator-facing page in Phase 3 behind a per-allocator feature flag.
- Effort: M (human: ~2.5 weeks / CC: ~6 hours)
- Verdict: **Rejected at premise gate.** Bigger scope without enough evidence the allocator-facing path is needed yet.

### Approach D: Founder-amplifier (this plan, post-CEO-review)
Algorithm computes scores in Python. ONLY the founder sees them, in an admin "match queue" view. Founder picks 3 candidates per allocator, writes a 1-line note, sends via the existing intro flow. Allocator sees "Isaiah recommends these 3" with the founder's note. No allocator-facing surface in v1. Eval harness compares the algorithm's top-3 against the founder's actual picks weekly so we can tune the weights.
- Effort: S-M (human: ~1.5 weeks / CC: ~4 hours)
- Risk: Lowest. Reuses 90% of existing infrastructure. Smallest blast radius.
- Reuses: `find_improvement_candidates` (extended), `contact_requests` (existing intro flow), admin sidebar (existing), `portfolio_strategies` + `portfolio_analytics` (existing), `strategies` + `strategy_analytics` (existing).
- Verdict: **Selected at premise gate.**

## Eureka

Both reviewers independently arrived at the same first-principles insight: the founder's personal vouch IS the product. The conventional wisdom on marketplaces (Uber, DoorDash, Airbnb) is "remove the human from the loop as fast as possible to scale." But the conventional wisdom is wrong for this particular case: institutional crypto allocation is small enough (<200 allocators globally that matter) and high-trust enough that *amplifying the human* is the moat. The 10x version is "founder + algorithm," not "algorithm replacing founder." Logged to eureka.jsonl.

---

## Phase 1: Foundation — Schema + lightweight preferences (founder-editable)

### Task 1: Database migration (post-eng-review revisions)

**Files:**
- Create: `supabase/migrations/011_perfect_match.sql`

**Eng review fixes baked in:**
- Admin gate: add `profiles.is_admin BOOLEAN`, **backfill from `ADMIN_EMAIL` env var inside the migration itself**, update both `lib/admin.ts` and `withAdminAuth.ts` in Task 1.5 to check both mechanisms during transition.
- RLS: separate `service_role_insert` and `admin_select` policies (mirrors migration 010 pattern), so cron writes don't get blocked by admin checks failing under service role.
- `match_decisions`: partial UNIQUE INDEX for `sent_as_intro` to enforce idempotency at the DB layer.
- `match_candidates`: split into `match_batches` (parent) + `match_candidates` (children) so retention can DELETE whole batches set-based.
- `system_flags`: simple BOOLEAN column, not JSONB. Public-read scoped to the kill-switch key only.
- `match_batches` carries `engine_version`, `weights_version`, `effective_preferences` JSONB so we can reconstruct ranking decisions later.
- Excluded rows have `rank = NULL`; partial index on candidates excludes them.

- [ ] **Step 1: Write migration SQL**

```sql
-- Migration 011: Perfect Match Engine (founder-amplifier)
-- Schema for the founder-only match queue.

------------------------------------------------------------------
-- 1. Profile extension (admin gate + preferences timestamp)
------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferences_updated_at TIMESTAMPTZ;

-- Backfill is_admin from current ADMIN_EMAIL pattern (founder is the only admin today).
-- The Supabase migration runner runs as service role, which bypasses RLS, so we can match
-- on auth.users.email directly.
UPDATE profiles
SET is_admin = true
WHERE id IN (
  SELECT id FROM auth.users
  WHERE email = current_setting('app.admin_email', true)
);
-- If app.admin_email setting is not set during migration, leave is_admin = false.
-- The setting can be applied via `ALTER DATABASE ... SET app.admin_email = '...'` ahead of time,
-- or the founder can run a one-line UPDATE after the migration applies.
-- Document this in the runbook.

------------------------------------------------------------------
-- 2. system_flags (scoped, single boolean for kill switch)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);
INSERT INTO system_flags (key, enabled) VALUES ('match_engine_enabled', true)
ON CONFLICT (key) DO NOTHING;

------------------------------------------------------------------
-- 3. allocator_preferences (allocator self-edits OR admin edits)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS allocator_preferences (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  -- Self-editable fields (allocator OR admin can write these)
  mandate_archetype TEXT,                              -- e.g. "diversified crypto SMA, low-DD"
  target_ticket_size_usd NUMERIC,
  excluded_exchanges TEXT[],
  -- Admin-only fields (founder fills in over time from conversations)
  -- These are protected by separate RLS policies below
  max_drawdown_tolerance NUMERIC,
  min_track_record_days INT,
  min_sharpe NUMERIC,
  max_aum_concentration NUMERIC,
  preferred_strategy_types TEXT[],
  preferred_markets TEXT[],
  founder_notes TEXT,
  -- Audit
  edited_by_user_id UUID REFERENCES profiles(id),      -- NULL = self-edited, else admin
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

------------------------------------------------------------------
-- 4. match_batches (parent — one row per recompute run per allocator)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mode TEXT NOT NULL CHECK (mode IN ('personalized', 'screening')),
  filter_relaxed BOOLEAN NOT NULL DEFAULT false,
  candidate_count INT NOT NULL DEFAULT 0,
  excluded_count INT NOT NULL DEFAULT 0,
  -- Provenance for "why was X excluded?" debugging
  engine_version TEXT NOT NULL,                        -- e.g. "v1.0.0" — bump on weight changes
  weights_version TEXT NOT NULL,                       -- separate version for the weight set
  effective_preferences JSONB NOT NULL,                -- snapshot of preferences at compute time
  effective_thresholds JSONB NOT NULL,                 -- post-relaxation min_sharpe, min_track, etc.
  source_strategy_count INT NOT NULL,                  -- how many strategies were in the universe
  latency_ms INT
);

CREATE INDEX idx_match_batches_allocator_recent ON match_batches (allocator_id, computed_at DESC);

------------------------------------------------------------------
-- 5. match_candidates (children — one row per scored candidate)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES match_batches(id) ON DELETE CASCADE,
  allocator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  score NUMERIC NOT NULL,                              -- 0..100; ignored for excluded rows
  score_breakdown JSONB NOT NULL,                      -- per-component scores + raw values
  reasons TEXT[] NOT NULL DEFAULT '{}',                -- 3 short reasons; empty for excluded rows
  rank INT,                                            -- 1..30 for candidates; NULL for excluded
  exclusion_reason TEXT CHECK (exclusion_reason IN (
    'below_min_sharpe', 'below_min_track_record', 'excluded_exchange',
    'exceeds_max_dd', 'off_mandate_type', 'owned', 'thumbs_down'
  )),                                                  -- NULL for candidates; set for excluded
  exclusion_provenance TEXT,                           -- e.g. specific decision_id for thumbs_down
  CHECK (
    (rank IS NOT NULL AND exclusion_reason IS NULL) OR
    (rank IS NULL AND exclusion_reason IS NOT NULL)
  )
);

-- Partial index excludes excluded rows from the hot path query
CREATE INDEX idx_match_cand_batch_rank
  ON match_candidates (batch_id, rank)
  WHERE exclusion_reason IS NULL;

CREATE INDEX idx_match_cand_strategy ON match_candidates (strategy_id);

------------------------------------------------------------------
-- 6. match_decisions (founder thumbs-up / down / sent-as-intro / snoozed)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES match_candidates(id),
  decision TEXT NOT NULL CHECK (decision IN ('thumbs_up', 'thumbs_down', 'sent_as_intro', 'snoozed')),
  founder_note TEXT,
  contact_request_id UUID REFERENCES contact_requests(id),
  decided_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_match_dec_allocator_recent ON match_decisions (allocator_id, created_at DESC);
CREATE INDEX idx_match_dec_strategy ON match_decisions (strategy_id);

-- DB-level idempotency: at most one sent_as_intro per (allocator, strategy)
CREATE UNIQUE INDEX uniq_match_dec_sent_per_pair
  ON match_decisions (allocator_id, strategy_id)
  WHERE decision = 'sent_as_intro';

-- DB-level idempotency: at most one thumbs_up per (allocator, strategy)
-- (allocator can flip thumbs_up → thumbs_down; that's a separate row insert + UI handles latest state)
CREATE UNIQUE INDEX uniq_match_dec_thumbup_per_pair
  ON match_decisions (allocator_id, strategy_id)
  WHERE decision = 'thumbs_up';

CREATE UNIQUE INDEX uniq_match_dec_thumbdown_per_pair
  ON match_decisions (allocator_id, strategy_id)
  WHERE decision = 'thumbs_down';

------------------------------------------------------------------
-- 7. SECURITY DEFINER function for atomic Send Intro
-- Wraps contact_requests insert + match_decisions insert in one transaction.
-- Returns existing contact_request if one already exists for the pair.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_intro_with_decision(
  p_allocator_id UUID,
  p_strategy_id UUID,
  p_candidate_id UUID,
  p_admin_note TEXT,
  p_decided_by UUID
) RETURNS TABLE (
  contact_request_id UUID,
  match_decision_id UUID,
  was_already_sent BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_cr_id UUID;
  v_new_cr_id UUID;
  v_decision_id UUID;
  v_was_already_sent BOOLEAN := false;
BEGIN
  -- Check if contact_requests already has a row for this pair (UNIQUE constraint exists in 001)
  SELECT id INTO v_existing_cr_id
  FROM contact_requests
  WHERE allocator_id = p_allocator_id AND strategy_id = p_strategy_id;

  IF v_existing_cr_id IS NOT NULL THEN
    v_was_already_sent := true;
    v_new_cr_id := v_existing_cr_id;
  ELSE
    INSERT INTO contact_requests (allocator_id, strategy_id, status, admin_note, message)
    VALUES (p_allocator_id, p_strategy_id, 'pending', p_admin_note, p_admin_note)
    RETURNING id INTO v_new_cr_id;
  END IF;

  -- Insert decision (idempotent via UNIQUE INDEX uniq_match_dec_sent_per_pair)
  INSERT INTO match_decisions (
    allocator_id, strategy_id, candidate_id, decision,
    founder_note, contact_request_id, decided_by
  ) VALUES (
    p_allocator_id, p_strategy_id, p_candidate_id, 'sent_as_intro',
    p_admin_note, v_new_cr_id, p_decided_by
  )
  ON CONFLICT (allocator_id, strategy_id) WHERE decision = 'sent_as_intro' DO NOTHING
  RETURNING id INTO v_decision_id;

  -- If we hit ON CONFLICT, fetch the existing decision id
  IF v_decision_id IS NULL THEN
    SELECT id INTO v_decision_id
    FROM match_decisions
    WHERE allocator_id = p_allocator_id
      AND strategy_id = p_strategy_id
      AND decision = 'sent_as_intro';
  END IF;

  RETURN QUERY SELECT v_new_cr_id, v_decision_id, v_was_already_sent;
END;
$$;

REVOKE ALL ON FUNCTION send_intro_with_decision FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_intro_with_decision TO authenticated;
-- The function checks admin authorization at the call site (Next.js handler).

------------------------------------------------------------------
-- 8. RLS — separate service-role + admin policies (mirrors migration 010)
------------------------------------------------------------------
ALTER TABLE allocator_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_flags ENABLE ROW LEVEL SECURITY;

-- allocator_preferences: allocator reads/writes own self-editable fields; admin reads/writes all
-- Self-editable columns enforced at the API layer (Next.js handler whitelists which fields can change)
CREATE POLICY "allocator_prefs_self_read" ON allocator_preferences
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "allocator_prefs_admin_read" ON allocator_preferences
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "allocator_prefs_self_write" ON allocator_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "allocator_prefs_self_update" ON allocator_preferences
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "allocator_prefs_admin_write" ON allocator_preferences
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- match_batches: admin SELECT only (no allocator access). Service role inserts.
CREATE POLICY "match_batches_service_insert" ON match_batches
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "match_batches_admin_select" ON match_batches
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "match_batches_admin_delete" ON match_batches
  FOR DELETE USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- match_candidates: same shape
CREATE POLICY "match_cand_service_insert" ON match_candidates
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "match_cand_admin_select" ON match_candidates
  FOR SELECT USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "match_cand_admin_delete" ON match_candidates
  FOR DELETE USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- match_decisions: admin reads/writes (no allocator access)
CREATE POLICY "match_dec_admin_all" ON match_decisions
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- system_flags: scoped public-read for the kill switch only; admin and service role write
CREATE POLICY "system_flags_match_engine_public_read" ON system_flags
  FOR SELECT USING (key = 'match_engine_enabled');
CREATE POLICY "system_flags_admin_write" ON system_flags
  FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY "system_flags_service_write" ON system_flags
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply migration locally** with `app.admin_email` set to the founder's email beforehand:
  ```sql
  ALTER DATABASE postgres SET app.admin_email = 'founder@quantalyze.io';
  ```
  Run migration 011.
- [ ] **Step 3: Verify the founder is_admin = true.** If not (env var missing during migration), run a one-line manual UPDATE:
  ```sql
  UPDATE profiles SET is_admin = true WHERE id = (SELECT id FROM auth.users WHERE email = 'founder@quantalyze.io');
  ```
- [ ] **Step 4: Apply same flow on staging Supabase**
- [ ] **Step 5: RLS verification tests** (write as part of Task 1.5):
  - Service role token can INSERT to `match_batches`, `match_candidates`, `match_decisions`
  - Founder user can SELECT from all three for any allocator
  - Regular allocator user CANNOT SELECT from `match_batches`, `match_candidates`, `match_decisions`
  - Regular allocator user CAN SELECT their own `allocator_preferences`
  - Regular allocator user CANNOT SELECT another allocator's `allocator_preferences`
  - Regular allocator can read `system_flags` row where key = 'match_engine_enabled'
  - Regular allocator cannot INSERT new rows to `system_flags`

### Task 1.5: Sync the admin gate across both layers + safety net

**Files:**
- Modify: `src/lib/admin.ts` — add `isAdminUser(userId)` that checks BOTH email AND `profiles.is_admin = true`
- Modify: `src/lib/api/withAdminAuth.ts` — same
- Modify: `src/proxy.ts` — same
- Modify: `src/app/(dashboard)/layout.tsx` — same
- Create: `supabase/migrations/011_perfect_match_test.sql` — staging-only smoke test that asserts founder profile has `is_admin = true` after migration

- [ ] Both checks in OR pattern: `email === ADMIN_EMAIL || profile.is_admin === true`. Allows zero-downtime rollout regardless of column-population timing.
- [ ] Add a startup-time runtime assertion in `src/lib/admin.ts`: log a warning if `is_admin` is false for the configured `ADMIN_EMAIL` user.
- [ ] In a follow-up PR (TODOS.md), drop the email check once both layers are confirmed in sync. NOT in this plan's scope — backwards-compatibility shim is correct here per Phase 1's rollout safety.

### Task 2: Lightweight preferences capture (allocator-readable, founder-editable)

**Files:**
- Create: `src/app/api/preferences/route.ts` (GET read self, PUT upsert self, admin can edit any via `?user_id=`)
- Create: `src/app/(dashboard)/preferences/page.tsx` (allocator self-edit page, optional)
- Create: `src/components/preferences/PreferenceForm.tsx` (3 fields only in v1 — not 6)
- Modify: `src/components/auth/OnboardingWizard.tsx` (single optional question after role selection)

- [ ] **Step 1: Three fields only** — minimum viable preferences:
  - Mandate archetype (free text 1-line, e.g. "diversified crypto SMA, low-drawdown")
  - Target ticket size USD (number, optional)
  - Excluded exchanges (multi-select, optional)
  - Everything else (max DD, min Sharpe, etc.) goes in `founder_notes` as free text. The founder fills this in over time from conversations. Allocators can't be expected to articulate these from a cold start.
- [ ] **Step 2: Founder admin can edit any allocator's preferences** — under `/admin/match/[allocator_id]` (Task 5). Sets `edited_by_user_id` for audit.
- [ ] **Step 3: Onboarding** — single question: "How would you describe your mandate in one sentence?" Free text, skippable. Stores `mandate_archetype`. No multi-field form in v1.

### Task 3: Defaults helper (Python-side, used by match engine)

**Files:**
- Create: `analytics-service/services/match_defaults.py`

- [ ] `DEFAULT_PREFERENCES` constant: `max_drawdown_tolerance=0.30, min_track_record_days=180, min_sharpe=0.5, target_ticket_size_usd=50000, max_aum_concentration=0.20, preferred_strategy_types=[], preferred_markets=[], excluded_exchanges=[]`. Generous defaults so the eligibility filter doesn't strip the universe.
- [ ] `merge_with_defaults(prefs: dict) -> dict` — fills in missing fields.
- [ ] Pure function, unit-testable.

---

## Phase 2: Match Engine (Python)

### Task 4: Match scoring module (post-eng-review revisions)

**Files:**
- Create: `analytics-service/services/match_engine.py`
- Create: `analytics-service/tests/test_match_engine.py`

**Eng review fixes baked in:**
- `add_weight` derived from `target_ticket_size_usd / portfolio_aum`, not hardcoded 0.10. Test for tiny vs whale allocators.
- DO NOT extract helpers from `portfolio_optimizer.py`. Instead, `match_engine.py` imports the existing private helpers via a `from services.portfolio_optimizer import _compute_sharpe, _avg_corr, _max_drawdown` line. Comment in both files marks them as shared. Adds a regression test that imports them from both locations. (Smaller diff, zero risk to existing optimizer.)
- `_corr_with_portfolio` returns `None` (not `0.0`) when overlap is insufficient; the reason generator skips reasons whose underlying metric is `None`.
- Min-max normalization handles single-element sets without NaN (falls back to absolute scoring).
- Eligibility filter splits into `hard_excluded` (owned, thumbs-down, excluded_exchange — never relaxed) and `soft_excluded` (sharpe, track, dd — what relaxation operates on).

**Function signature:**

```python
def score_candidates(
    allocator_id: str,
    preferences: dict,
    portfolio_strategies: list[dict],         # may be empty (cold-start)
    portfolio_returns: dict[str, pd.Series],  # per-strategy daily returns
    portfolio_weights: dict[str, float],
    candidate_strategies: list[dict],         # all eligible strategies in directory
    candidate_returns: dict[str, pd.Series],
    excluded_strategy_ids: set[str],          # already in portfolio + thumbs-down history
) -> ScoreResult:
```

Where `ScoreResult` is:
```python
{
  "candidates": [
    {
      "strategy_id": str,
      "score": float,                # 0..100 (founder-only)
      "rank": int,
      "score_breakdown": {
        "portfolio_fit": float,      # 0..1
        "preference_fit": float,
        "track_record": float,
        "capacity_fit": float,
        "raw": {
          "corr_with_portfolio": float,
          "sharpe_lift": float,
          "dd_improvement": float,
          "track_record_days": int,
          "manager_aum": float,
          "ticket_concentration": float,
        },
      },
      "reasons": [str, str, str],    # founder uses these to write the 1-line note
    },
    ...
  ],
  "excluded": [
    {
      "strategy_id": str,
      "exclusion_reason": str,        # "below_min_sharpe", "owned", "thumbs_down", etc.
    },
    ...
  ],
  "filter_relaxed": bool,             # true if eligibility was relaxed to find candidates
  "mode": "personalized" | "screening",  # personalized = portfolio context, screening = cold-start
}
```

**Both candidates AND excluded are returned.** The founder admin shows excluded strategies too, with the reason — so the founder can answer "why isn't team Y on the list?" without re-running anything.

- [ ] **Step 1: Eligibility filter** — split into hard and soft exclusions
  - **Hard exclusions** (NEVER relaxed):
    - `strategy_id IN owned_set` → exclusion_reason="owned", exclusion_provenance=portfolio_strategy_id
    - `strategy_id IN thumbs_down_set` → exclusion_reason="thumbs_down", exclusion_provenance=match_decision_id
    - `exchange IN preferences.excluded_exchanges` → exclusion_reason="excluded_exchange", exclusion_provenance=preference field
  - **Soft exclusions** (subject to relaxation):
    - `track_record_days < preferences.min_track_record_days` → exclusion_reason="below_min_track_record"
    - `sharpe < preferences.min_sharpe` → exclusion_reason="below_min_sharpe"
    - `max_drawdown_pct > preferences.max_drawdown_tolerance` → exclusion_reason="exceeds_max_dd"
    - `strategy_type NOT IN preferences.preferred_strategy_types` (skip if list is empty) → exclusion_reason="off_mandate_type"
  - **Relaxation rule:** if `len(candidates_after_both_filters) < 5`, drop the soft filter (min_sharpe → 0, min_track → 90 days, max_dd → 1.0), re-apply hard filter only, set `filter_relaxed=true`. If still < 5, return whatever there is. Hard filter always applies — relaxation never resurrects owned/thumbs-down/excluded-exchange strategies.

- [ ] **Step 2: Mode selection (cold-start vs personalized)**
  - If `len(portfolio_strategies) == 0` → `mode="screening"`. Skip portfolio-fit math entirely. Score = `0.6 * preference_fit + 0.25 * track_record + 0.15 * capacity_fit`. **Do not produce a "94/100 personalized for you" number** — the founder admin labels these as "Screening shortlist" not "Personalized matches."
  - Else → `mode="personalized"`. Full 4-component score with portfolio_fit weighted at 0.4.

- [ ] **Step 3: Sub-scores (each in [0, 1])**
  - **`portfolio_fit`** — wraps existing `find_improvement_candidates` math:
    - **Compute `add_weight = clamp(target_ticket_size_usd / portfolio_aum, 0.01, 0.5)`**. Don't use the hardcoded 0.10 default — that's wrong for tiny vs whale allocators. If `portfolio_aum` is 0 or unknown, fall back to 0.10.
    - Compute `sharpe_lift`, `corr_reduction`, `dd_improvement` using shared helpers from `portfolio_optimizer.py` (imported via `from services.portfolio_optimizer import _compute_sharpe, _avg_corr, _max_drawdown`).
    - Normalize each to [0,1] via min-max within the *eligible* candidate set (fairness within the slate).
    - **Single-element handling:** if `len(eligible) == 1`, skip min-max and use absolute scoring: `sharpe_lift_norm = clamp(sharpe_lift, 0, 1)`, etc. Test for this with `test_single_eligible_candidate_does_not_nan`.
    - **Insufficient overlap handling:** the existing `find_improvement_candidates` returns `corr_with_portfolio = 0` when overlap < 10 days. Override that to `None` in `match_engine.py` so the reason generator knows the metric is unreliable. Test with `test_short_overlap_returns_none_corr`.
    - Combined: `0.5 * sharpe_lift_norm + 0.3 * corr_reduction_norm + 0.2 * dd_improvement_norm`
  - **`preference_fit`**:
    - `pref_sharpe_score = clamp((sharpe - min_sharpe) / max(min_sharpe, 0.5), 0, 1)`
    - `pref_track_score = clamp((track_record_days - min_track_record_days) / min_track_record_days, 0, 1)` (capped at 2x floor)
    - `pref_dd_score = clamp(1 - (max_drawdown_pct / max_drawdown_tolerance), 0, 1)`
    - Average the three.
  - **`track_record`**: `min(1, track_record_days / 730)` — 2 years = full credit.
  - **`capacity_fit`**:
    - `concentration = ticket_size_usd / manager_current_aum`
    - If `manager_current_aum` unknown → 0.5 (neutral, don't penalize unknowns harshly)
    - If `concentration > preferences.max_aum_concentration` → 0 (hard fail)
    - Else → `1 - (concentration / max_aum_concentration)`

- [ ] **Step 4: Final score**
  - Personalized: `final = 100 * (0.4*portfolio_fit + 0.3*preference_fit + 0.15*track_record + 0.15*capacity_fit)`
  - Screening: `final = 100 * (0.6*preference_fit + 0.25*track_record + 0.15*capacity_fit)`
  - Sort descending. Top 30 returned (more than 20 because the founder needs depth to pick from).

- [ ] **Step 5: Reason generation** (rule-based, 3 reasons per candidate, founder uses these to write the intro note)
  - If `corr_with_portfolio < 0.2 AND mode==personalized` → "Diversifies the book (correlation 0.X with existing strategies)"
  - If `sharpe_lift > 0.1 AND mode==personalized` → "Lifts portfolio Sharpe by +0.X"
  - If `track_record_days > 730` → "Long track record ({Y} years)"
  - If `track_record_days > preferences.min_track_record_days * 1.5` → "Comfortably above the minimum track record we screen for"
  - If `concentration < 0.05` → "Capacity headroom for the ticket size"
  - If `strategy_type IN preferences.preferred_strategy_types` → "Matches the {type} mandate"
  - If `mode==screening AND track_record_days > 365 AND sharpe > 1.5` → "High-conviction screening pick"
  - Pick the top 3 reasons by sub-score contribution.

- [ ] **Step 6: Determinism**
  - Given the same inputs, the function MUST return identical output (modulo Python dict ordering). No randomness, no timestamps in the score.
  - Tie-breaks: by `strategy_id` (lexicographic) so rank is stable.

- [ ] **Step 7: Tests** (16 minimum after eng review)
  - `test_cold_start_returns_screening_mode` — empty portfolio, mode="screening", no portfolio_fit in score
  - `test_personalized_returns_personalized_mode` — non-empty portfolio, mode="personalized"
  - `test_eligibility_excludes_low_sharpe_with_reason` — strategy with sharpe 0.3, min 1.0, in excluded[] with reason
  - `test_owned_strategy_excluded_with_reason` — owned strategy in excluded[]
  - `test_thumbs_down_strategy_excluded_with_reason`
  - `test_excluded_exchange_excluded_with_reason`
  - `test_preference_fit_rewards_track_record`
  - `test_portfolio_fit_uses_correlation` — uncorrelated candidate beats correlated one
  - `test_relaxed_filter_when_sparse` — <5 eligible, filter_relaxed=true
  - `test_relaxed_filter_does_not_resurrect_thumbs_down` — hard filter survives relaxation
  - `test_relaxed_filter_does_not_resurrect_owned`
  - `test_relaxed_filter_does_not_resurrect_excluded_exchange`
  - `test_no_eligible_candidates_returns_empty_with_relaxed_flag`
  - `test_determinism` — same inputs → identical output (json.dumps comparison)
  - `test_screening_mode_does_not_produce_portfolio_fit_in_breakdown` — guards against future changes hiding the cold-start collapse
  - `test_add_weight_derived_from_ticket_size` — small allocator (1% concentration) and whale (30%) produce different sharpe_lift values for the same candidate
  - `test_short_overlap_returns_none_corr` — candidate with 5 days of overlap → corr_with_portfolio = None, reason about correlation skipped
  - `test_single_eligible_candidate_does_not_nan` — eligible set of size 1 → score is finite, no NaN
  - `test_zero_aum_falls_back_to_neutral_capacity` — manager_current_aum = 0 → capacity_fit = 0.5
  - `test_helper_imports_from_both_locations` — `from services.portfolio_optimizer import _compute_sharpe` AND `from services.match_engine import compute_sharpe` (the alias) both work

### Task 5: API + persistence

**Files:**
- Create: `analytics-service/routers/match.py` (Python service)
- Create: `src/app/api/admin/match/route.ts` (Next.js → Python; admin only)
- Modify: `analytics-service/main.py` (register router)

- [ ] **Step 1: Python endpoint** `POST /match/recompute`
  - Body: `{ allocator_id: str, force?: bool }`
  - Auth: service-role token (existing pattern from `portfolio_optimizer` route)
  - **Kill switch check (FIRST):** Read `system_flags.enabled WHERE key='match_engine_enabled'`. If false → return `{ disabled: true }`, do not compute, do not write. (Cheaper than building the whole load.)
  - Reads from Supabase:
    - allocator preferences (defaults if none)
    - allocator's portfolio strategies + weights + returns
    - all eligible strategies + returns (use the cached universe in cron path; per-request load in single-allocator path)
    - excluded set (owned + thumbs-down history from `match_decisions`)
  - Calls `score_candidates`
  - **Persist as one transaction:**
    - INSERT a single `match_batches` row with metadata (mode, filter_relaxed, candidate_count, excluded_count, engine_version, weights_version, effective_preferences, effective_thresholds, source_strategy_count, latency_ms)
    - INSERT N `match_candidates` rows (top 30 with rank 1..30, excluded with rank=NULL and exclusion_reason set)
  - Returns: `{ batch_id, candidate_count, excluded_count, mode, filter_relaxed, latency_ms }`
  - Concurrency: `asyncio.Semaphore(3)` for the per-allocator scoring (this is what `find_improvement_candidates` already uses; same shape).
  - **Excluded list cap:** persist top 50 most-relevant excluded rows (the ones closest to passing thresholds), not all 200. Caps batch row count at 80 (30 + 50). The excluded list UI in Task 8 paginates with search; founder rarely needs more than top-50.
  - Logging: structured log with `allocator_id, batch_id, mode, candidate_count, excluded_count, filter_relaxed, latency_ms, source_strategy_count`

- [ ] **Step 2: Next.js admin endpoint** `POST /api/admin/match/recompute`
  - Auth: requires logged-in admin user (`profiles.is_admin = true`). 403 otherwise.
  - Body: `{ allocator_id: str }`
  - Forwards to Python `/match/recompute` with service-role token + idempotency key (`recompute:{allocator_id}`)
  - Returns the Python response

- [ ] **Step 3: Next.js admin read** `GET /api/admin/match/[allocator_id]`
  - Auth: admin only (`isAdminUser(auth.uid)` check)
  - Returns the latest `match_batches` row for that allocator, with:
    - Top 30 `match_candidates` joined to `strategies(id, name, codename, exchange, strategy_type, manager_aum_usd, max_capacity_usd)` and `strategy_analytics(sharpe, sortino, max_drawdown, cagr, volatility, six_month_return, sparkline_returns)` — explicit column projection, NOT `select *`. Caps payload at ~200KB.
    - Up to 50 excluded `match_candidates` with the same projection
    - The full `allocator_preferences` row (admin can read everything including `founder_notes`)
    - Recent 50 `match_decisions` for this allocator
  - **Payload-size assertion:** integration test asserts response body < 500KB at N=30. Otherwise the two-pane UI ships a 6-second blank page on a fast laptop.
  - **Pre-existing intro check:** also returns the set of `(strategy_id)` for which `contact_requests` already exists for this allocator. The Send Intro modal uses this to show the "already sent" state before submission, addressing C2 from the eng review.

### Task 5.5: Send Intro RPC wrapper

**Files:**
- Create: `src/app/api/admin/match/send-intro/route.ts`

- [ ] Auth: admin only (`isAdminUser(auth.uid)`).
- [ ] Body: `{ allocator_id, strategy_id, candidate_id, admin_note }`
- [ ] Calls `supabase.rpc('send_intro_with_decision', { ... })` (the SECURITY DEFINER function from migration 011) — single-transaction insert.
- [ ] Returns `{ contact_request_id, match_decision_id, was_already_sent }`
- [ ] On `was_already_sent === true`: client shows "Intro already exists from {created_at}, no new message sent."
- [ ] No cross-service writes. The entire transaction lives in Postgres.
- [ ] Idempotency at the DB layer via the `uniq_match_dec_sent_per_pair` partial index AND the existing `contact_requests UNIQUE(allocator_id, strategy_id)` constraint. The RPC handles both gracefully.

### Task 6: Cron recompute (post-eng-review revisions)

**Files:**
- Modify: `analytics-service/main.py` (or `routers/cron.py` if it exists)

**Eng review fixes:**
- Cache the candidate universe (all strategies + analytics + returns) ONCE per cron run, not per allocator. Cron loads once → loops 50 allocators against in-memory data → ~10x faster than the original spec.
- Performance benchmark required BEFORE shipping the cron. Run on real staging data with 200 strategies. If per-allocator > 10s, optimize further (vectorized numpy, drop per-candidate concat).

- [ ] **Step 1:** Daily cron at 01:00 UTC (1h after the data sync at 00:00 UTC)
- [ ] **Step 2: Kill switch check first.** Read `system_flags.enabled WHERE key='match_engine_enabled'`. If false → log and return.
- [ ] **Step 3: Universe load (ONCE):**
  - Load all eligible strategies (active, has analytics) once into a dict keyed by strategy_id
  - Load each strategy's daily returns once into a dict keyed by strategy_id
  - Load each strategy's manager AUM once
- [ ] **Step 4: Per-allocator loop:**
  - For each profile where `role IN ('allocator', 'both')`:
    - Re-check kill switch (founder may flip mid-run)
    - Skip if last `match_batches.computed_at` < 12h old (avoid double work, unless `force=true`)
    - Skip if profile is soft-deleted (FK already enforces hard delete via CASCADE, but we should also skip recently-deactivated allocators)
    - Load this allocator's preferences, portfolio strategies + weights + returns, excluded set
    - Call `score_candidates` against the in-memory universe
    - Persist as one transaction (Task 5 Step 1)
    - Log structured per-allocator line
  - On per-allocator failure: log + continue. Do NOT fail the cron run.
- [ ] **Step 5: Retention sweep (Task 7) at end of cron**
- [ ] **Step 6: Cron summary metric** at end: `match_engine_cron_runs_total`, `match_engine_candidates_generated_total`, `match_engine_recompute_latency_seconds` histogram, `match_engine_excluded_total{reason}` (constrained label cardinality — see eng review M2).
- [ ] Concurrency: `asyncio.Semaphore(3)` for per-allocator scoring (each allocator's `score_candidates` call is independent).

**Cron loop tests** (added per eng review H8):
- `test_cron_kill_switch_off_returns_early`
- `test_cron_handles_per_allocator_failure_continues_loop`
- `test_cron_skips_recent_batches_unless_forced`
- `test_cron_respects_concurrency_semaphore` (counts max concurrent in-flight)
- `test_cron_runs_retention_at_end_of_loop`
- `test_cron_with_zero_allocators_does_not_crash`

### Task 7: Retention policy (post-eng-review revisions)

**Files:**
- Modify: cron router (above)

- [ ] **Strategy:** delete whole batches set-based via the parent `match_batches` table. CASCADE handles `match_candidates` cleanup.
- [ ] At end of cron run, for each allocator that had a new batch:
  ```sql
  DELETE FROM match_batches
  WHERE allocator_id = $1
    AND id NOT IN (
      SELECT id FROM match_batches
      WHERE allocator_id = $1
      ORDER BY computed_at DESC
      LIMIT 7
    );
  ```
  CASCADE deletes the corresponding `match_candidates` rows automatically.
- [ ] Keeps last 7 batches per allocator. Bounds growth at ~7 × 80 candidates = 560 rows per allocator (top-30 + top-50 excluded).
- [ ] **Race protection:** retention runs AFTER the per-allocator scoring loop, not concurrently. No overlap with concurrent inserts from manual `/api/admin/match/recompute` because manual recomputes use the same batch insert (a manual recompute right after retention DELETE is fine — it just creates batch #1 of the new generation).
- [ ] Test: `test_retention_keeps_last_7_batches_per_allocator` — insert 10 batches, run retention, assert 7 remain, others' candidates are gone via CASCADE.

---

## Phase 3: Founder admin surface — the "Match Queue"

This is the only UI in v1. Allocators do not see anything new from this plan.

> **Design refinements (post-design-review).** Both design voices flagged the same structural issues: index page sorted by the wrong axis, candidate rows overloaded, no two-pane detail layout, interaction states named-not-designed, no keyboard nav, DESIGN.md violations (emoji thumbs, traffic-light colors, "big red toggle" against the restrained color rule). The Phase 3 task specs below are the *post-review* version with those structural fixes baked in.

### Layout primitives (DESIGN.md alignment, applies to all admin/match pages)

- **Two-pane layout** at desktop ≥1024px: left rail = compact ranked list (44px row height per DESIGN.md), right pane = sticky detail view for the selected candidate.
- **Single-column** below 1024px (tablet read-only). Below 768px → "Best on desktop" CTA, no inline actions.
- **Typography:** Page title in 32px Instrument Serif. Section headers in 16px DM Sans semibold (DESIGN.md H3). Numbers in Geist Mono tabular. No `text-lg` (18px) for H3 — that's the bug already in TODOS.md from the prior /design-review.
- **Color discipline:** Score = Geist Mono number + 1px horizontal accent bar (#1B6B5A) showing distribution. NO traffic-light scoring (#16A34A green / amber / muted). The accent bar varies in fill width 0–100%. Reserves color for actual gain/loss elsewhere.
- **No emoji.** Use `lucide-react` `ThumbsUp` / `ThumbsDown` outline icons at 16px in `text-muted` (#718096), filled `#1B6B5A` on active state. Or text labels `KEEP / SKIP` in 11px uppercase Geist Mono. Decision: text labels (more institutional, clearer for keyboard nav).
- **Modal pattern:** All editing surfaces use right-edge slide-out panels per DESIGN.md component patterns, NEVER center modals. Founder needs to keep the queue visible while editing prefs / writing intro notes.
- **Focus rings:** all interactive elements get a 2px focus ring in #1B6B5A. Visible keyboard tab order.

### Task 8: Match Queue admin page (`/admin/match`)

**Files:**
- Create: `src/app/(dashboard)/admin/match/page.tsx` (allocator list)
- Create: `src/app/(dashboard)/admin/match/[allocator_id]/page.tsx` (per-allocator detail)
- Create: `src/components/admin/AllocatorMatchQueue.tsx`
- Create: `src/components/admin/CandidateRow.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (add "Match Queue" item under Admin)

- [ ] **Index page (`/admin/match`)** — admin only. Triage-first, not data-first.
  - **Default sort: "Needs attention"** computed as: has new candidates since last visit AND no intro shipped in last 14 days. Then by stale-batch (>48h since recompute), then by zero decisions, then by recency. The founder's question at 9am is "who needs me," not "who recomputed last."
  - **Filter chip row** (DM Sans Medium 13px, no rounded pills): `Needs attention | New candidates | Snoozed | All`
  - **Search input** at top right: 260px, 6px radius, accent border on focus per DESIGN.md.
  - Each row (44px height per DESIGN.md):
    - Allocator name (DM Sans 14px) + mandate archetype (13px text-secondary)
    - **Top score delta** since last visit (Geist Mono 13px)
    - **Candidates added** since last visit (small badge)
    - **Days-since-last-intro** (Geist Mono, red if >14)
    - "Open" → `/admin/match/[allocator_id]`
  - **Sidebar badge:** the "Match queue" sidebar item shows a count badge of allocators-needing-attention (Geist Mono 11px, accent on white pill, only renders if count > 0)
  - **"Recompute all" button** → opens a slide-out panel with explicit progress (allocator-by-allocator status with check/spinner/error icons), single-click cancel, disabled while running. NO bare button. Per design review F8.

- [ ] **Allocator detail page (`/admin/match/[allocator_id]`)** — admin only. **Two-pane layout above 1024px.**
  - **Header strip (always visible at top, never scrolls out of view):**
    - Left: allocator name (24px DM Sans semibold) + company (13px text-secondary)
    - Center: **MODE BADGE** — `SCREENING` (uppercase 11px Geist Mono, 1px border #4A5568, text-secondary, with caveat line "No portfolio context — score reflects preference fit only.") OR `PERSONALIZED` (same dimensions, 1px border #1B6B5A, accent text)
    - Right: freshness indicator ("Computed 4h ago" or red "Stale: 3 days" if >48h)
  - **Top action row** below the header:
    - "Recompute now" button (primary, accent bg)
    - "Edit preferences" button (secondary) → opens right-edge slide-out panel
    - Kill switch — moved to a settings row in a right-edge panel, not big-red in the header. Neutral pill when enabled, red banner only in disabled-alert state. Per design review F4 + F6.
    - Decisions count: "5 thumbed up, 2 sent" (Geist Mono)
  - **Shortlist strip (above the fold):** the top 3 candidates as horizontally-arranged cards. Each card: codename (14px DM Sans semibold), score (24px Geist Mono) + accent bar, top 1 reason (13px text-secondary), single primary CTA "Send intro →". Founder picks 3 per allocator from this strip on most visits. The full top-30 only matters when the founder wants more depth.
  - **Two-pane main area:**
    - **Left rail (40% width, scroll-isolated):** compact ranked list of top-30 candidates. Each row 44px: codename, mode-aware score number + accent bar, 1 reason. Selected row has accent left border + #F0F8F6 bg.
    - **Right pane (60% width, sticky):** full detail for the selected candidate — all 7 metrics in a table (Geist Mono numbers), 3 reasons as bullets, score breakdown bar chart (4 sub-scores), and bottom action bar with `KEEP / SKIP / Send intro` buttons.
    - On click of a row: right pane updates (no navigation, no spinner unless data is being fetched lazily — preload all 30 when batch loads).
  - **Excluded list:** collapsible `<details>` below the two-pane area. Each row: codename, exclusion reason ("max DD 45% > tolerance 30%"), open in detail. Search box inside the collapse. Per design review F1.
  - **Decision history:** separate collapsible below excluded. Each row: strategy, decision, date, founder note. Searchable. The founder uses this to remember "I already sent X to this allocator 2 months ago — should I send Y this time?"
  - **Filter-relaxed callout:** if the batch was relaxed (`filter_relaxed=true`), single-line callout above the shortlist strip: 1px border #DC2626, no fill, text "Eligibility was relaxed to find these — review carefully." Founder needs to see this explicitly. Per design review F7.

- [ ] **Keyboard shortcuts** (Phase 3 ergonomics):
  - `j` / `k` — move selection in the left rail
  - `Enter` — focus right pane (no-op if already focused)
  - `s` — open Send Intro modal (`Cmd+Enter` to submit)
  - `u` / `d` — KEEP (thumbs up) / SKIP (thumbs down) on the selected candidate
  - `r` — recompute now
  - `/` — focus search input
  - `?` — open keyboard shortcut help overlay
  - Implementation: one small `useKeyboardShortcuts` hook, ~50 lines.

- [ ] **Inline preference editor (right-edge slide-out panel):** click "Edit preferences" → panel slides from right (per DESIGN.md modal pattern). Fields: mandate archetype, ticket size, excluded exchanges, founder_notes. Save → toast "Preferences saved. Recompute? [Yes / Later]" — explicit prompt prevents the founder from looking at stale candidates after editing prefs. Sets `edited_by_user_id` and `preferences_updated_at`.

### Task 9: "Send as intro" flow integration

**Files:**
- Modify: `src/app/(dashboard)/admin/page.tsx` or wherever the existing intro modal lives
- Create: `src/components/admin/SendCandidateIntroModal.tsx`

- [ ] **Pattern:** right-edge slide-out panel (NOT center modal) per DESIGN.md modal pattern. Founder needs to see the queue while writing the note.
- [ ] Wraps the existing `contact_requests` insert flow
- [ ] Pre-fills:
  - `allocator_id` (from the match queue context)
  - `strategy_id` (from the candidate row)
  - `admin_note` field — auto-generated draft from `candidate.reasons[0]` (e.g. "Diversifies your book — correlation 0.18 with your existing strategies"), founder edits
  - Status: `pending`
- [ ] **Idempotency:** form submission carries an idempotency key (`{allocator_id}:{strategy_id}:{batch_id}`). If the founder spams submit, the second insert no-ops. Per error map.
- [ ] **Already-sent state:** if `match_decisions` already has `sent_as_intro` for this (allocator, strategy), the panel shows a banner "Intro already sent on {date}" and disables the submit button.
- [ ] On submit:
  - Insert `contact_requests` row (existing flow, existing API route)
  - Insert `match_decisions` row with `decision='sent_as_intro'` and `contact_request_id` linking the two
  - Toast: "Intro sent"
- [ ] Success → row in the left rail marks `SENT` (no emoji) + greys to `text-muted` and moves to bottom of list (already-handled candidates don't compete for attention)

### Task 10: Kill switch UI

**Files:**
- Modify: `src/app/(dashboard)/admin/match/page.tsx` (header area)
- Create: `src/app/api/admin/match/kill-switch/route.ts`
- Create: `src/components/admin/MatchEngineSettingsPanel.tsx`

- [ ] **Pattern:** kill switch lives inside a right-edge slide-out **settings panel**, not big-red in the header. Per design review F4 + F6 (DESIGN.md restraint). Header just shows a small status pill: `ENGINE: ON` (neutral border) or `ENGINE: OFF` (1px border #DC2626, no fill). Click the pill to open the settings panel.
- [ ] Settings panel toggles:
  - Match engine enabled (boolean) — flips `system_flags.match_engine_enabled`
  - Confirmation prompt before disabling: "Disabling stops new recomputes. Existing candidates remain visible. Continue?"
- [ ] When disabled, the queue page shows a banner at the top: "Engine is disabled. Latest candidates shown are from {timestamp}. New recomputes blocked." Banner is the only place red is used in the disabled state.
- [ ] Founder can still see the last batch, send intros, and edit preferences while disabled. The disable just stops new computes.

### Task 10.5: Interaction states (audit + spec)

**Files:** updates to all admin/match components above

- [ ] **Loading (recompute in flight):** skeleton rows in the left rail (44px high, animated shimmer per existing patterns), Recompute button disabled with spinner inside. Single-click prevention via the button's `disabled` state. Idempotency key prevents server-side dupes.
- [ ] **Empty (no batch yet):** "No candidates yet for this allocator. [Recompute now]" — friendly, single-CTA.
- [ ] **All-handled (every candidate has a decision):** "All current candidates handled. Recompute for new ones, or view history." Two CTAs.
- [ ] **Stale (>48h since recompute):** orange-bordered banner top of page: "Last recompute: 3 days ago. Run a fresh recompute?"
- [ ] **Filter relaxed:** the red callout already specified above the shortlist strip.
- [ ] **Network error mid-thumbs:** optimistic UI updates immediately, rolls back on error with toast "Failed to save — try again."
- [ ] **Idempotency conflict on Send Intro:** banner inside the slide-out panel "Intro already sent on {date}" + disabled submit button.
- [ ] **Kill switch off:** red banner at top, "ENGINE: OFF" pill in header, all "Recompute" buttons disabled, all decision buttons still enabled.
- [ ] **Preferences edited mid-session:** after preference save → toast "Preferences saved. Recompute? [Yes / Later]" — explicit prompt, never silent staleness.
- [ ] **Tablet (768-1023px):** single column, no two-pane. Left rail becomes top of page, right pane stacks below. Inline actions still work, keyboard shortcuts disabled (no good keyboard story on touch).
- [ ] **Mobile (<768px):** read-only. Page shows allocator name + top 3 candidates with score + 1 reason each, plus "Open on desktop to take action" CTA. ~30 minutes of work, 80% of the value. No recompute, no edit, no send-intro on mobile.

---

## Phase 4: Eval, observability, and ground truth

### Task 11: Eval harness — algorithm vs. founder ground truth

**Files:**
- Create: `analytics-service/services/match_eval.py`
- Create: `analytics-service/tests/test_match_eval.py`
- Create: `analytics-service/routers/match_eval.py` (admin endpoint)
- Create: `src/app/(dashboard)/admin/match/eval/page.tsx`

- [ ] **Step 1: Ground truth definition** — for each historical week, the founder's "ground truth" set is the strategies they actually sent as intros via `contact_requests` (status != 'declined' if we have post-intro signal).
- [ ] **Step 2: Algorithm baseline** — for the same week, what would the algorithm have recommended? Re-run `score_candidates` against a frozen snapshot of the data as it existed at that time. Take top 3.
- [ ] **Step 3: Metrics** —
  - **Hit rate:** what % of the founder's actual intros appeared in the algorithm's top 3?
  - **Top-of-list rate:** what % were ranked #1?
  - **Discovery rate:** what % of the algorithm's top 3 did the founder NOT send (and why — thumbs-down note)?
  - **Drift over time:** rolling 4-week hit rate, plotted weekly.
- [ ] **Step 4: Admin dashboard** — `/admin/match/eval`, one screen, no card chrome:
  - **Top row:** 4 numbers in 32px Geist Mono separated by hairline dividers (#E2E8F0 per DESIGN.md): Hit rate, Top-of-list rate, Discovery rate, Drift (4-week delta)
  - **Middle:** weekly hit-rate line chart using lightweight-charts. Strategy line in #1B6B5A, no fill, no grid. Same chart library/styling as the existing equity curve so it feels native.
  - **Bottom:** "Intros the algorithm missed" table — date, allocator, strategy the founder sent, where the algorithm ranked it (or "excluded — reason"), founder's thumbs-down note if any. This IS the artifact — make it the focus, not a footnote.
  - Layout: max-width 1100px (DESIGN.md). Right-edge slide-out panel for per-week drilldown.
- [ ] **Step 5: Tests** — synthetic `match_decisions` history, verify hit rate calculation is correct.
- [ ] **Why this matters:** Without this, we have no idea if the algorithm is helping the founder or wasting their time. The whole point of the founder-amplifier approach is that we can measure the algorithm against the founder's mental baseline. Eval is not optional.

### Task 12: Observability + alerts

**Files:**
- Modify: `analytics-service/main.py` (or wherever Prometheus metrics live)
- Modify: cron router

- [ ] Counters:
  - `match_engine_recompute_total{status=success|failure|disabled}`
  - `match_engine_candidates_generated_total`
  - `match_engine_excluded_total{reason}`
  - `match_engine_eligible_count{filter_relaxed=true|false}` (histogram)
- [ ] Histograms:
  - `match_engine_recompute_latency_seconds` (per allocator)
- [ ] Logs (structured):
  - Every recompute: `allocator_id`, `batch_id`, `mode`, `candidate_count`, `excluded_count`, `filter_relaxed`, `latency_ms`
  - Every founder decision: `allocator_id`, `strategy_id`, `decision`, `decided_by`
- [ ] Alerts (Sentry, existing infra):
  - Cron failure (existing pattern)
  - 50% of allocators returning empty candidate sets (filter is too strict OR data is stale)
  - Recompute latency p95 > 30s (perf regression)

### Task 13: Founder onboarding inside the admin

**Files:**
- Modify: `src/app/(dashboard)/admin/match/page.tsx`

- [ ] First time the founder visits `/admin/match`, show a 3-step inline tutorial card:
  - "1. Pick an allocator to see their match queue"
  - "2. Use 👍/👎 to teach the algorithm what you'd actually pick"
  - "3. Use 'Send intro' to ship a candidate to the allocator via the existing intro flow"
- [ ] Dismissible. Stored in localStorage so it doesn't nag.

### Task 14: E2E test (Playwright)

**Files:**
- Create: `e2e/match-queue.spec.ts`

- [ ] As admin: navigate to `/admin/match`, see allocator list
- [ ] As admin: open an allocator, click "Recompute now", see candidates appear
- [ ] As admin: click 👍 on a candidate, verify `match_decisions` row exists
- [ ] As admin: click "Send intro", verify modal opens, submit, verify `contact_requests` row exists AND `match_decisions.contact_request_id` is set
- [ ] As admin: toggle kill switch off, click "Recompute now", verify error toast "Engine disabled"
- [ ] As regular allocator: hit `/admin/match` directly, get 403

---

## Test Plan Summary (post-eng-review)

| Layer | Test type | Coverage |
|---|---|---|
| Python `match_engine.py` | Unit (pytest) | 21 tests covering eligibility (hard + soft split), relaxation invariants, sub-scores, add_weight from ticket size, mode selection, exclusion reasons, single-element normalization, short-overlap None corr, zero-AUM fallback, determinism, helper alias imports |
| Python `match_eval.py` | Unit (pytest) | 3 tests covering hit-rate calculation, ground truth set construction, edge cases |
| Python `routers/match.py` | Integration (FastAPI test client) | 4 tests: kill switch off → no compute; full recompute flow against in-memory Supabase mock; service-role insert works under RLS; payload size budget enforced |
| Python `cron loop` | Integration | 6 tests: kill switch off, per-allocator failure continues, skip recent batches, semaphore concurrency, retention runs after, zero allocators |
| Python `portfolio_optimizer.py` regression | Unit | 1 new test: assert helper imports work from both old and new locations |
| Next.js admin API routes | Integration (vitest) | 5 tests: admin gate (403 for non-admin via both email and is_admin paths), recompute trigger, decision write, send-intro RPC happy path, send-intro RPC with pre-existing contact_request returns was_already_sent=true |
| Migration 011 | SQL (psql + assertions) | 7 RLS tests: service role can insert candidates/batches/decisions; admin can SELECT all; allocator cannot SELECT match_*; allocator can SELECT own preferences; allocator cannot SELECT other's preferences; allocator can SELECT system_flags row; allocator cannot UPDATE system_flags |
| Migration 011 backfill | SQL | 1 test: founder profile has is_admin = true after migration applies with `app.admin_email` set |
| `AllocatorMatchQueue` | Component (vitest + RTL) | 3 tests: thumbs-up writes decision optimistically, send-intro slide-out pre-fills, mode badge renders correctly |
| `CandidateRow` | Component (vitest + RTL) | 2 tests: reasons render, score uses Geist Mono + accent bar (no traffic-light colors) |
| `useKeyboardShortcuts` | Component (vitest) | 1 test: j/k navigation, s opens send-intro, u/d thumbs |
| E2E | Playwright | 8 flows: index navigation, recompute, thumbs-up, send-intro happy path, send-intro already-sent, kill switch, regular-user 403, mobile read-only |
| Manual | Founder uses the queue for 1 week with real allocators | Verify hit rate metric is meaningful, founder workflow is faster than baseline |
| Performance benchmark | Manual on staging | Recompute latency at N=200 strategies. Must be < 10s per allocator. Document baseline. |

---

## Sequencing notes

- **Phase 1 → Phase 2 → Phase 3** is the critical path. Phase 4 (eval + observability) ships in parallel with Phase 3 once Phase 2 lands.
- **Migration 011 must apply cleanly to staging** before any Python work starts.
- **Cron recompute** (Task 6) is not blocking v1 — manual trigger via the admin "Recompute now" button works for the first week. Cron makes it feel alive starting week 2.
- **Eval harness (Task 11)** technically can ship in week 2 once we have at least 5-10 real founder decisions to compare against. Week-1 metric is "the founder ran X recomputes and shipped Y intros" — engagement, not accuracy.
- **Kill switch + retention (Tasks 7, 10)** are mandatory for v1 launch — they bound the worst-case blast radius.

---

## Open questions for the user (will surface at the final gate)

1. **Founder workload.** This plan adds a "Match Queue" admin tab. The founder will visit it daily/weekly. Does this slot into the existing admin workflow, or does it need its own time block? (No code impact, just expectation setting.)
2. **Allocator-facing graduation criteria.** When does the "founder-only" engine graduate to allocator-facing? Suggested gate: 20 founder-shipped intros from the queue + at least 5 conversions to actual allocations + a hit rate above 40%. This gets recorded in TODOS.md as the v2 trigger condition.
3. **Existing optimizer wiring.** TODOS.md P1 has "Wire optimizer suggestions into the dashboard UI" — that's a different feature (allocator-facing optimizer for their existing portfolio). This plan defers that wiring. Confirm OK?
4. **Manager-side visibility.** This plan does *not* show managers which allocators they were recommended to. Privacy-by-default. Confirm OK or build later?

---

## CEO Review — Phase 1 (autoplan)

### Step 0A. Premise Challenge

Five premises stated. Three are weak under scrutiny.

| # | Premise | Verdict | Why |
|---|---|---|---|
| 1 | Allocators want explicit preferences over implicit ML | **WEAK** | Founders consistently overestimate completion rates on multi-field preference forms. With <100 allocators and a 6-field form (DD, sharpe, track record, ticket, concentration, weights), realistic completion is 20-40%. The remaining majority falls back to defaults — meaning the engine ranks everyone identically, which is "Perfect Match for You" in name only. Implicit feedback is the right long-term move; explicit form is fine if framed as "advanced filters" not "preferences." |
| 2 | Transparent score is enough signal for v1 | **WEAK** | Transparency is table stakes, not the moat. The original office-hours design doc says the moat is *exchange-verified data* + *founder's matching judgment*. A transparent algorithm a founder can't defend to a paying allocator is worse than a black-box one that ships with the founder's name on it. |
| 3 | Cold-start gets degraded but useful experience | **WEAK** | Without a portfolio: portfolio_fit=0.5 (neutral), capacity_fit often 0.5 (manager AUM unknown). 60% of the score collapses to track_record + preference_fit, which is *just a filter*. Calling this "personalized" when it isn't is precision theater. |
| 4 | Founder remains the trust layer on top of the algorithm | **CONTRADICTED** | The plan's surfaces (PerfectMatchPanel, /recommendations page, score columns) foreground the algorithm. Curator picks are deferred to Phase 5 — meaning v1 ships an unsupervised algorithm to paying customers with no override path. The premise as written is right; the plan as drafted does NOT honor it. |
| 5 | Scores are not investment advice | **TENABLE WITH FRAMING** | Disclaimers are necessary but insufficient. "Perfect Match for You" + 94/100 score reads as suitability guidance regardless of fine print. Renaming + uncertainty bands lower legal risk meaningfully. |

### Step 0B. Existing code leverage

Already in the "What already exists" section above. Coverage is good — the plan reuses `find_improvement_candidates`, `StrategyTable`, `contact_requests`, `portfolio_analytics`, `portfolios`. New surface area is bounded. Good.

### Step 0C. Dream state mapping

```
CURRENT STATE                     THIS PLAN                          12-MONTH IDEAL
─────────────                     ─────────                          ──────────────
Founder runs matching             Algorithm + founder run            Allocator opens platform,
manually via Telegram.            matching, allocator-facing         sees a 1-line founder note
Strategy directory exists         scores + curator picks.            and 3 hand-picked candidates,
but allocators don't sort/        Founder still does intros.         each with explanation.
filter — they DM founder.                                            Algorithm does the heavy
                                                                     lifting; founder ships
                                                                     the message. Conversion
                                                                     is measurably higher than
                                                                     manual baseline.
```

**Delta this plan creates:** moves from "founder-only matching" to "founder + algorithm side-by-side" — but the plan as drafted points the algorithm AT allocators, which risks substituting for the founder rather than amplifying. The dream state has the algorithm pointed at the FOUNDER as decision support, with the founder remaining the customer-facing voice.

### Step 0C-bis. Implementation alternatives (revisited after dual voices)

Original plan considered 3 approaches (ML, stated-preference, pure portfolio-fit). Both dual voices independently surfaced a 4th:

```
APPROACH D: Founder-amplifier (dual-voice convergent recommendation)
  Summary: Algorithm scores candidates, but ONLY the founder sees the
           ranked list. Founder picks 3 per allocator, writes a 1-line
           thesis, sends via existing intro flow. Allocators see
           "Isaiah recommends these for you" — never "Algorithm 94/100."
  Effort:  S (human: ~1.5 weeks / CC: ~4 hours)
  Risk:    Lowest — preserves the moat, no allocator-facing surface to
           get wrong, can A/B vs the founder's mental baseline.
  Pros:
    - Preserves founder-as-trust-layer (the actual moat)
    - No "Why was X excluded?" support load on allocators
    - Curator picks ARE the product, not a Phase 5 add-on
    - Smallest blast radius — no /recommendations page, no card UI,
      no save/dismiss feedback loop, no public API surface
    - Tests whether ranking math is even useful before exposing it
  Cons:
    - Founder is still the bottleneck (but now informed, not blind)
    - No "self-serve" allocator experience until phase 2
    - Less "wow" demo for fundraising
  Reuses:  find_improvement_candidates, contact_requests, admin view
```

**Recommendation update:** Approach D is a better v1 than Approach B (the original choice). This is a USER CHALLENGE — both Codex and the Claude subagent independently arrived at this reframe, and it changes the user's stated direction ("allocators see what teams are the perfect match for them"). The user must explicitly choose. Surfaced at the premise gate below.

### Step 0D. Mode-specific analysis (SELECTIVE EXPANSION)

**Complexity check:** Original plan touches ~40 files across 16 tasks. Approach D would touch ~12 files across 6 tasks. The original plan is 3x larger than necessary for the value it ships in v1 — that is the smell.

**Auto-decided scope adjustments (logged in audit trail):**
- Curator picks (Task 10): MOVE FROM Phase 5 → Phase 1. Both voices flagged this as critical. Auto-decided per P1 (completeness) + P2 (boil lakes) — without curator picks the algorithm ships unsupervised.
- Add **kill switch** for the founder: a single feature flag the founder can flip to hide the algorithm globally if it recommends nonsense. New Task 1.5. Auto-decided per P5 (explicit over clever) — this is a 30-minute add and the cost of NOT having it is catastrophic.
- Add **batch retention policy**: `DELETE FROM match_recommendations WHERE batch_id NOT IN (latest 7 batches per allocator)`. Auto-decided per P2 (boil lakes) — unbounded growth is a 6-month landmine.
- Add **founder admin "decision trace"**: per-allocator view showing the full ranked list (top 50, not just top 20), the eligibility filter exclusions, the score breakdown, and a thumbs-up/thumbs-down per recommendation. Auto-decided per P2 (boil lakes) — both voices flagged this as essential for support load AND ML training data later.
- Add **impression/click logging from day 1**: feedback table accepts `viewed` action immediately. Already in Task 11 but the table exists from Phase 1 — auto-decided to wire impression tracking in Phase 1, not Phase 4.
- Add **`evaluation harness`**: nightly job that compares the algorithm's top-3 picks against the founder's actual intros for that week. Auto-decided per P1 (completeness) — without ground truth comparison, we can't tune the weights.

**Auto-deferred to TODOS.md (logged in audit trail):**
- ML collaborative filtering (Approach A) — requires >500 historical intros to be useful. P3.
- Allocator-facing /recommendations page in v1 — defer pending Approach D's outcome. P1.5 if Approach D ships first.
- Notifications (email when high-score match appears) — defer pending allocator usage data. P2.
- Manager-side "who was I recommended to" dashboard — defer per privacy default. P2.
- Custom benchmark per allocator — out of scope. P2.

### Step 0E. Temporal interrogation

```
HOUR 1 (foundations):     Migration 011 + DEFAULT_PREFERENCES helper.
                          Decision: do allocators get rows on signup
                          (with defaults) or only on form submit?
                          → AUTO: rows on signup, default values.
                          Reason: simpler queries downstream.

HOUR 2-3 (core logic):    score_candidates() function. Edge cases:
                          - All preferences null (cold-start) → use
                            DEFAULT_PREFERENCES
                          - Eligible candidate set < 5 → relax filters
                            once, flag in result
                          - Manager AUM unknown → capacity_fit = 0.5
                          - portfolio_returns has < 30 days history
                            → portfolio_fit = 0.5

HOUR 4-5 (integration):   API routes + cron. Decision: who triggers
                          the first recompute? On preferences-save or
                          waiting for cron?
                          → AUTO: recompute on preferences-save AND
                          cron daily. Two writes are cheap; latency
                          matters for first impressions.

HOUR 6+ (polish/tests):   Founder admin debug view, eval harness,
                          retention policy. The tests that matter:
                          shouldn't recommend a strategy already in
                          portfolio; shouldn't recommend a dismissed
                          strategy; should produce stable rank for
                          identical inputs.
```

CC compression: this entire human-team week reduces to ~2 hours of CC time.

### Step 0F. Mode confirmation

**SELECTIVE EXPANSION confirmed.** Holding scope to Approach B as baseline (the user's stated direction), but cherry-picking the dual-voice expansions: curator picks → Phase 1, kill switch, retention policy, founder debug view, eval harness, impression logging from day 1.

**The user challenge** (Approach D) is presented at the premise gate, separately. If user approves Approach D, the plan compresses to ~6 tasks. If user keeps Approach B, the plan continues with the cherry-picked expansions above.

### Step 0.5. Dual Voices (CEO)

**CLAUDE SUBAGENT (CEO — strategic independence)** — independent review, no prior context.

Top concerns (verbatim summary):
1. Wrong v1 surface — exposes algorithm directly to allocators instead of routing through founder
2. Curator picks deferred to Phase 5 = unsupervised algorithm shipping to paying customers
3. Building a recommender before validating self-serve discovery (no data shown allocators currently use sort/filter)
4. Premise 1 overestimates preference form completion; Premise 2 confuses transparency with judgment as the moat
5. Cold-start UX collapses to a glorified filter
6. `match_recommendations` grows unbounded — needs retention policy
7. Founder support load: "why isn't X recommended?" — needs debug view
8. Founder ground truth missing — needs thumbs-up/thumbs-down on suggestions

**CODEX SAYS (CEO — strategy challenge)** — independent review, no prior context.

Top concerns (verbatim summary):
1. Premise 1 — allocators discover preferences AFTER seeing options, not before; one-time form captures performative answers
2. Premise 2 — score excludes operational trust / diligence readiness which dominates institutional decisions
3. Premise 4 — product mechanics foreground score, contradicting the "founder is trust layer" claim
4. Building the recommender now is wrong sequencing vs. instrumenting the existing directory funnel
5. Approach C dismissed too quickly — simpler portfolio-fit + founder-overlay path could ship faster
6. Curator picks must move to Phase 1
7. Cold-start is "screening mode" mislabelled as personalization
8. 6-month regret: data growth, founder workflow degradation, support load around "why did rank change?"
9. Add evaluation harness with frozen snapshots for ranking drift
10. Reframe success metric from "recommendation clicks" to "qualified intro conversion"

### CEO Dual Voices — Consensus Table

```
═══════════════════════════════════════════════════════════════
  Dimension                            Claude   Codex   Consensus
  ──────────────────────────────────── ──────── ─────── ──────────
  1. Premises valid?                   NO       NO      NO (4/5 weak)
  2. Right problem to solve?           NO       NO      REFRAME
  3. Scope calibration correct?        NO       NO      TOO BIG
  4. Alternatives sufficiently         NO       NO      MISSING D
     explored?
  5. Competitive/market risks          PARTIAL  PARTIAL PARTIAL
     covered?
  6. 6-month trajectory sound?         NO       NO      RISK HIGH
═══════════════════════════════════════════════════════════════
```

**6/6 dimensions: both models agree the plan needs change.** This is the strongest possible cross-model signal — a USER CHALLENGE per autoplan rules.

### Cross-phase findings (raised here, will recur in Eng phase)
- Unbounded data growth in `match_candidates` → resolved by Task 7 (retention policy)
- Missing eval harness → resolved by Task 11 (eval harness)
- Missing observability around recompute success/failure → resolved by Task 12 (observability)
- Founder support load around "why was X excluded?" → resolved by Task 8 (excluded list with reason in admin queue)
- Need ground truth for tuning → resolved by `match_decisions` table (Task 1) + thumbs-up/thumbs-down in Task 8
- Kill switch for unsupervised algorithm → resolved by Task 10

### Premise gate resolution

**User answered:** Approach D — founder-amplifier. Plan rewritten in-place. Original allocator-facing draft preserved in git history at commit `becc478`. Continuing CEO sections 1-11 against the revised plan.

---

### Section 1: Architecture review (against revised plan)

```
                          PERFECT MATCH ENGINE — DEPENDENCY GRAPH
                          (Approach D: founder-amplifier)

  ┌─────────────────────┐     ┌────────────────────────┐
  │ Existing Postgres   │     │ Existing Python svc    │
  │ ─────────────────   │     │ ──────────────────     │
  │ profiles            │◀───▶│ services/metrics       │
  │ strategies          │     │ services/db            │
  │ strategy_analytics  │     │ services/portfolio_*   │
  │ portfolios          │     │ routers/...            │
  │ portfolio_strategies│     └─────────┬──────────────┘
  │ contact_requests    │               │
  │ portfolio_analytics │               │
  └──────────┬──────────┘               │
             │                          ▼
             │            ┌─────────────────────────────┐
             │            │ NEW: services/match_engine  │
             │            │ score_candidates(...)       │
             │            │ ─ eligibility filter        │
             │            │ ─ mode selection            │
             │            │ ─ sub-scores                │
             │            │ ─ weighted combination      │
             │            │ ─ reason generation         │
             │            └─────────┬───────────────────┘
             │                      │
             ▼                      ▼
  ┌────────────────────┐  ┌────────────────────────────┐
  │ NEW: tables (mig 011)│ │ NEW: routers/match.py     │
  │ allocator_preferences│ │ POST /match/recompute     │
  │ match_candidates    ◀──── (kill-switch checked)    │
  │ match_decisions     │  │  Concurrency Sem(3)       │
  │ system_flags        │  └──────────┬─────────────────┘
  └─────────┬──────────┘              │
            │                         │
            │            ┌────────────▼────────────────┐
            │            │ NEW: cron daily 01:00 UTC   │
            │            │ For each allocator:         │
            │            │   - check kill switch       │
            │            │   - score_candidates        │
            │            │   - persist batch           │
            │            │   - retention DELETE        │
            │            └────────────┬────────────────┘
            │                         │
            ▼                         ▼
  ┌─────────────────────────────────────────────┐
  │ Next.js (admin only — RLS + admin gate)     │
  │ ─────────────────────────────────────────   │
  │ /admin/match                                │
  │   page.tsx (allocator list)                 │
  │ /admin/match/[allocator_id]                 │
  │   page.tsx + AllocatorMatchQueue            │
  │ /api/admin/match/recompute  → Python svc    │
  │ /api/admin/match/[allocator_id]  → Postgres │
  │ /api/admin/match/kill-switch  → system_flags│
  └─────────────────────────────────────────────┘
                │
                ▼
  ┌─────────────────────────────────────────────┐
  │ EXISTING contact_requests intro flow        │
  │ (founder ships intro to allocator;          │
  │  match_decisions row links the two)         │
  └─────────────────────────────────────────────┘
```

**Component boundaries:** Clean. Python service owns the math. Next.js admin owns the surface. Supabase owns persistence. Existing intro flow is reused, not duplicated.

**Coupling concerns:** New `match_decisions.contact_request_id` couples the new domain to the existing intro domain. Justified — that link is the eval harness's ground truth signal. Without it, we can't measure hit rate.

**Scaling characteristics:** Per-allocator recompute is O(N strategies × M allocators). With N=200, M=50, daily cron at concurrency 3 takes ~15 minutes. Not a concern at v1 scale. Becomes a concern at N=2000 — TODOS.md item for v2.

**Single points of failure:** Python service. Same as today. Existing pattern.

**Rollback posture:** All new tables. Drop migration 011 + revert the admin route additions. Existing code paths untouched. Rollback time: < 5 minutes.

**Production failure scenarios:**
- Python service down → cron fails for the day → next day's batch is fresh; no allocator-facing impact (admin queue shows last-known data).
- Postgres connection exhausted during cron → existing portfolio cron pattern handles this with the same Sem(3) limit.
- Kill switch flipped accidentally → "Recompute now" button stops working, founder sees banner. Non-destructive.

**Auto-decided issues (logged in audit trail):**
- A1: Use existing service-role token pattern from `portfolio_optimizer` route. P5 (explicit over clever).
- A2: New tables in their own migration file (011), not piggybacked on portfolio intelligence. P5.
- A3: `system_flags` as a generic singleton table is the right shape (we'll need it for other flags later). P3 (pragmatic).

No new findings requiring user input. Architecture is clean.

### Section 2: Error & Rescue Map

```
METHOD/CODEPATH                           | WHAT CAN GO WRONG               | EXCEPTION CLASS
─────────────────────────────────────────  ────────────────────────────────  ─────────────────
match_engine.score_candidates              | Empty candidate list             | Returns {candidates:[], excluded:[], filter_relaxed:false} (not exception)
                                           | Pandas alignment fails           | KeyError → caught, candidate skipped, logged
                                           | Manager AUM is None               | capacity_fit = 0.5 (existing pattern)
                                           | All sub-scores are nan            | Filtered out + logged
match_engine.compute_portfolio_fit         | Correlation matrix singular       | numpy LinAlgError → caught, candidate gets neutral 0.5
                                           | <30 days overlap                  | Skip, set portfolio_fit = 0.5
routers/match.recompute                    | Kill switch on                    | Return {disabled:true} early, no exception
                                           | Allocator has no portfolio        | mode="screening", continue
                                           | Allocator does not exist          | 404 with allocator_id
                                           | Service-role token invalid        | 401 (existing middleware)
                                           | Postgres connection error         | psycopg2.OperationalError → log + retry once + raise
                                           | Insert fails halfway through      | Wrap in transaction, ROLLBACK
cron.daily_recompute                       | One allocator fails               | Catch + log + continue (per-allocator try/except)
                                           | All allocators fail               | Raise after loop (cron alert fires)
                                           | Kill switch toggled mid-run       | Re-check at top of each iteration
admin/match/recompute API                  | Non-admin user                    | 403
                                           | Allocator ID malformed             | 400
                                           | Python service unreachable        | 503 with retry-after
admin/match/[id] API                       | Allocator ID does not exist       | 404
                                           | No batches yet                     | Return {candidates:[], excluded:[], message:"No batches yet — click Recompute"}
admin/match send-intro modal               | contact_requests insert fails     | Toast error, do NOT write match_decisions
                                           | match_decisions insert fails       | Already wrote contact_request — log inconsistency, manual cleanup, alert
                                           | Both succeed, network drops        | Idempotent retry with same payload, dedupe by (allocator, strategy, timestamp)

EXCEPTION CLASS              | RESCUED?  | RESCUE ACTION                          | USER SEES
────────────────────────────  ─────────   ───────────────────────────────────────  ──────────────
psycopg2.OperationalError    | Y         | Retry once with exponential backoff     | Toast: "Recompute failed, retrying"
numpy.LinAlgError            | Y         | Skip candidate, neutral score           | Nothing (logged)
pandas.errors.MergeError     | Y         | Skip candidate, log full context        | Nothing (logged)
TimeoutError (Python svc)    | Y         | 503 + retry-after                        | Toast: "Service slow, try again in a moment"
401 from Python svc          | N → ALERT | Page founder via Sentry                  | Toast: "Match engine auth misconfigured"
TooManyRequestsError         | N/A       | Cron sem(3) prevents this internally     | —
KeyError (missing column)    | Y         | Skip candidate                           | Nothing (logged at WARNING)
```

**Critical gaps:** None after this map. The "both succeed, network drops" case at the send-intro modal is the trickiest — flagged for the eng review's idempotency check.

**Auto-decided:** Wrap the send-intro flow in idempotency-key middleware. P1 (completeness).

### Section 3: Security & Threat Model

| Vector | Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `/admin/match` route | Non-admin reaches admin pages | Med | High | RLS on `match_candidates` + `match_decisions` denies non-admin entirely; route handler checks `profiles.is_admin` (defense in depth) |
| `/admin/match/[id]` IDOR | Admin enumerates allocator IDs | Low | Low | Admin already has access to all allocators; no escalation possible |
| Allocator preferences | Allocator A reads B's preferences | Low | Medium | RLS policy `user_id = auth.uid() OR is_admin` |
| `match_candidates` table | Allocator infers internal scoring | High | Medium-High | RLS denies non-admin SELECT entirely. Verify in Step 4 of Task 1 with a real auth test. |
| `match_decisions` table | Same | High | Medium | Same RLS pattern |
| Service-role token | Token leak via logs | Low | Critical | Existing pattern from portfolio_optimizer; never log token; rotate via Supabase |
| Kill switch | Non-admin flips it | Low | High | RLS on `system_flags` UPDATE = admin only; SELECT = public (so cron can read without elevated auth) |
| `founder_notes` field | PII / sensitive notes | Med | Medium | Already protected by RLS on `allocator_preferences`. Add note: founder should not write secrets here; it's for context. |
| `contact_requests` link from `match_decisions` | Allocator infers their match_decisions via the join | Low | Medium | `match_decisions` RLS is admin-only; no public join |

**Auto-decided:**
- S1: `is_admin BOOLEAN` column (Task 1 Step 2) over extending `role` enum. P5 (explicit over clever).
- S2: All new tables RLS-enabled by default with admin-only policies. P1 (completeness).
- S3: Service-role token reuse from existing pattern, no new secrets. P5.

No new findings requiring user input.

### Section 4: Data Flow & Edge Cases

```
ALLOCATOR PREFERENCES UPDATE FLOW
INPUT (form) ──▶ VALIDATE ──▶ UPSERT ──▶ TRIGGER RECOMPUTE
   │                │              │              │
   ▼                ▼              ▼              ▼
[null mandate?]  [overlong?]  [conflict?]   [Python down?]
   ↓                ↓              ↓              ↓
allowed         400 error      ON CONFLICT   fire-and-forget,
(it's free      "1024 char     UPDATE        log warning,
 text)           max"          (last write    next cron picks
                               wins)          it up
```

```
RECOMPUTE FLOW (founder clicks "Recompute now")
INPUT ──▶ ADMIN GATE ──▶ KILL SWITCH ──▶ LOAD DATA ──▶ SCORE ──▶ PERSIST ──▶ RESPONSE
  │           │               │              │           │           │           │
  ▼           ▼               ▼              ▼           ▼           ▼           ▼
[non-admin?] [disabled?]  [allocator     [<30d data?] [empty?]    [TX fail?]  [timeout?]
  ↓           ↓             not exist?]      ↓          ↓            ↓            ↓
 403       {disabled}        404           mode=        relax,      ROLLBACK    Toast,
                                          screening   re-score    + alert    leave existing
                                                      OR return                batch intact
                                                      empty
```

**Interaction edge cases (admin queue):**

| Interaction | Edge case | Handled |
|---|---|---|
| Click "Recompute now" | Double-click | Button disables on first click, idempotency key prevents dupe write |
| Click 👍 | Network drops | Optimistic UI, rollback on failure |
| Click "Send intro" → submit | Modal stays open, user navigates away | Form is in admin route; React Router intercepts navigation if dirty |
| Click 👎 | Same strategy thumbs-down twice | Insert is idempotent on (allocator, strategy, decision) — UNIQUE-INDEX to enforce |
| Recompute while one is in flight | Race | Existing in-flight marker (in-memory single-instance) returns the in-flight batch_id |
| Allocator deleted mid-recompute | FK violation | ON DELETE CASCADE on `allocator_id`; cron skips deleted allocators |
| Strategy delisted mid-recompute | candidate exists but strategy was deleted | LEFT JOIN, drop NULLs |
| Founder views queue with 0 candidates | Empty batch | Show "No candidates yet — click Recompute" |
| Kill switch flipped while founder is writing a note | Toggle state changes | Note submission still works (queue is read-only display); only NEW recomputes are blocked |

**Auto-decided:** UNIQUE INDEX on `match_decisions (allocator_id, strategy_id, decision)` to make thumbs-up/down idempotent. Add to migration 011. P1 (completeness).

### Section 5: Code Quality

- **DRY:** `score_candidates` reuses `find_improvement_candidates` math by importing the helper functions (`_compute_sharpe`, `_avg_corr`, `_max_drawdown`). Do NOT duplicate. Refactor those helpers into a shared `services/scoring_helpers.py` module if reuse pulls them sideways.
- **Naming:** `match_candidates` (the algorithm's output) vs `match_decisions` (the founder's choices) — clear separation. `score_breakdown` is the JSONB blob. `reasons` is the `text[]` array. `mode` is `"personalized" | "screening"` to avoid the misleading "personalized for you" framing.
- **Cyclomatic complexity:** `score_candidates` could grow branchy. Keep eligibility filter, sub-scores, and reason generation as separate functions. Each ≤ 5 branches.
- **Over-engineering check:** No new abstractions for "future ML ranking" — explicit rules only in v1. Premature ML is a known anti-pattern.
- **Under-engineering check:** Founder workflow ergonomics (queue UX) deserves thought, not just a bare table. Phase 3 spec explicitly calls out color coding, mode badge, exclusion list, decision history.

**Auto-decided:** Pull `_compute_sharpe`, `_avg_corr`, `_max_drawdown` out of `portfolio_optimizer.py` into `services/scoring_helpers.py` as part of Task 4. P5 (DRY).

### Section 6: Test Review

```
NEW UX FLOWS (admin only):
  - Open /admin/match → see allocator list
  - Open /admin/match/[id] → see queue + excluded + history
  - Click "Recompute now" → see new candidates
  - Click 👍 / 👎 → decision recorded
  - Click "Send intro" → modal pre-filled, submit, contact_requests + match_decisions created
  - Toggle kill switch → engine disabled
  - Edit allocator preferences inline

NEW DATA FLOWS:
  - Form input → preferences upsert → fire-and-forget recompute trigger
  - Admin click → /api/admin/match/recompute → Python POST → Supabase write → response
  - Cron tick → loop allocators → score → persist → retention DELETE
  - Send-intro click → contact_requests insert → match_decisions insert → both linked

NEW CODEPATHS:
  - score_candidates(): eligibility filter, mode selection, sub-scores, reason gen
  - kill switch check (in two places: Python recompute + cron)
  - retention DELETE (cron tail)
  - eval harness (separate Python module, separate cron / on-demand admin trigger)

NEW BACKGROUND JOBS:
  - Daily 01:00 UTC cron — recompute all allocators
  - Same cron tail — retention DELETE per allocator

NEW INTEGRATIONS:
  - None external. Reuses existing Supabase, existing Python service, existing intro flow.

NEW ERROR/RESCUE PATHS:
  - Listed in Section 2 above.
```

**Test plan (cross-references Test Plan Summary table):**

| Item | Test type | Happy path | Failure path | Edge case |
|---|---|---|---|---|
| Eligibility filter | Unit | Strategy passes → in candidates | Strategy fails → in excluded with reason | All strategies fail → relax + flag |
| Mode selection | Unit | Empty portfolio → screening | Non-empty → personalized | Single strategy → personalized |
| Sub-scores | Unit | Each in [0,1] | NaN inputs → 0.5 neutral | All metrics zero → all sub-scores valid |
| Determinism | Unit | Same input → same output (json.dumps eq) | — | Reorder candidates → same output |
| Recompute API | Integration | 200 + batch | Kill switch → 200 + disabled | Allocator missing → 404 |
| Admin gate | Integration | Admin → 200 | Non-admin → 403 | Logged-out → 401 |
| Send-intro flow | E2E | Modal → submit → both rows | contact_requests fails → no match_decisions written | Network drop → idempotency retry |
| Retention | Integration | After 8 batches, only 7 remain | — | Concurrent inserts during DELETE → no race (DELETE within transaction) |
| Eval harness | Unit | Hit rate calculation correct | No history → returns 0 | All hits → 1.0 |
| Kill switch | E2E | Toggle off → recompute returns disabled | Toggle on → resumes | Toggle while recomputing → in-flight batch completes, next blocked |

**LLM/prompt changes:** None in this plan. Reasons are rule-based, not model-generated. (Future work could use an LLM to write the founder's intro note from the reasons[] — flagged in TODOS.md.)

**Test that would make me confident shipping at 2am Friday:** Manual run of the founder workflow on real allocator data — recompute, see real candidates, pick one, send intro, verify the allocator received the email, verify match_decisions row exists. This is the integration test that reflects the actual product loop.

**Test a hostile QA engineer would write:** Spam "Recompute now" 100 times in a second. Must not double-write. (Idempotency key handles this.)

**Auto-decided:** Add the test plan artifact to disk. Done in Phase 3 eng review.

### Section 7: Performance

| Concern | Risk | Mitigation |
|---|---|---|
| `score_candidates` runtime | O(N strategies × per-strategy correlation) | At N=200, this is ~5s per allocator. At M=50 allocators with Sem(3), full cron run is ~85s. Acceptable. |
| `match_candidates` table growth | 30 candidates × N batches × M allocators | Retention to 7 batches caps at ~210 rows per allocator = ~10k rows at v1 scale. Trivial. |
| Cron startup latency | First cron after deploy is cold | Existing portfolio cron uses warmup, reuse pattern |
| Read-side queries on `/admin/match/[id]` | JOIN on strategies + analytics + decisions | Existing indexes cover these joins. Add `idx_match_cand_allocator_recent` already in migration. |
| `find_improvement_candidates` reuse | Pandas DataFrame ops on every recompute | Unchanged from existing portfolio optimizer; baseline is acceptable |
| Eval harness | Replays historical recomputes | Run on demand from admin only, not on cron. Can be slow without affecting hot path. |

**Auto-decided:** Add a `match_candidates` retention test that verifies batches > 7 are deleted. Done in Task 7 spec.

### Section 8: Observability & Debuggability

- **Logs (structured):** every recompute, every cron iteration, every founder decision. Already specified in Task 12.
- **Metrics:** counters + histogram in Task 12.
- **Sentry alerts:** cron failure, half-empty allocators, recompute latency p95 > 30s. Already specified.
- **Admin debugging view:** the entire `/admin/match/[id]` page IS the debugging surface. Founder can see exactly what was excluded and why, and the full decision history.
- **Runbook for "engine returning empty for everyone":** kill switch flipped? Check `system_flags`. Migration not applied? Check Supabase. Service down? Check Railway. (Add to runbook docs in Phase 4.)

**Auto-decided:** Add a runbook stub `docs/runbooks/match-engine.md` in Phase 4 Task 12. P1 (completeness).

### Section 9: Deployment & Rollout

- **Migration 011:** backward-compatible (all new tables + one ALTER TABLE adding nullable column). Apply first.
- **Deploy order:** migration → Python service → Next.js admin route. Each is independently rollback-able.
- **Feature flag:** the kill switch IS the flag. Enable it after first successful recompute on staging.
- **Staging verification:**
  - Run `/admin/match/recompute` against a staging allocator
  - Verify candidates appear in the queue
  - Verify excluded list shows correct reasons
  - Click "Send intro" → verify both rows
  - Toggle kill switch off → verify recompute is blocked
- **Post-deploy verification (production):**
  - Founder uses the queue against 1 real allocator
  - Verify the candidate list looks "right" to the founder's eye
  - Send 1 intro
  - Verify allocator receives the existing intro email
- **Rollback:** Drop tables, revert admin route. ~5 min.

**Auto-decided:** Use existing staging environment + existing deploy pipeline. No new infra. P5.

### Section 10: Long-term trajectory

- **Tech debt introduced:** New domain (match_*) is well-bounded. The `_compute_sharpe` extraction (Section 5) is a positive — reduces existing duplication.
- **Path dependency:** Future ML training data is being collected from day 1 via `match_decisions`. The path to a learned ranker is unblocked.
- **Knowledge concentration:** Algorithm logic is in one Python file with comprehensive tests. Plan + tests are documentation. Anyone joining can read both.
- **Reversibility:** 5/5 — easy to revert.
- **Ecosystem fit:** Aligns with Next.js + Python + Supabase pattern already established.
- **The 1-year question:** A new engineer reading this in 12 months would see: a clean Python scoring function, an admin-only surface, an eval harness. They'd understand it. They'd be able to graduate it to allocator-facing if the founder asks.
- **Platform potential:** Yes — `score_candidates` is reusable for other ranking problems (e.g., allocator-to-manager direction).

**Auto-decided:** None. Trajectory is sound.

### Section 11: Design & UX (Hand-off to Phase 2 Design Review)

Plan has UI scope: the `/admin/match` and `/admin/match/[id]` pages plus inline modals. All admin-facing.

**Information architecture:** Allocator list → per-allocator queue → candidate row → send intro modal. Three-level depth. Predictable.

**State coverage map (admin queue):**

| State | Spec'd? |
|---|---|
| Empty queue (no batches yet) | YES — "click Recompute" |
| Computing (in-flight) | NEEDS SPEC — add a spinner + disabled button |
| Has candidates | YES |
| Kill switch off | YES — banner |
| All candidates dismissed (founder sent intros for all) | NEEDS SPEC — "all candidates handled, recompute for new ones" |
| Network failure | NEEDS SPEC — toast |

**DESIGN.md alignment:** The plan must match Quantalyze's Industrial/Utilitarian aesthetic. No purple. No bubbly cards. Use the existing teal #1B6B5A for accents. Use the existing typography (Instrument Serif for page title, DM Sans for body, Geist Mono for numbers/scores).

**Mobile:** Not in v1. The founder uses desktop. State explicitly: "Admin pages are desktop-only in v1 (1024px+)."

**Accessibility:** Keyboard nav for the candidate rows (arrow keys + enter to expand) is a nice-to-have. Skip in v1, defer to TODOS.md if any user asks.

**Auto-decided:** Add the missing states (computing, all-handled, network failure) to Phase 3 Task 8 spec. Will be checked in detail in Phase 2 design review.

---

## CEO Phase 1 — Completion Summary

```
+====================================================================+
|            MEGA PLAN REVIEW — COMPLETION SUMMARY (CEO)             |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION                          |
| System Audit         | Existing portfolio cron pattern, intro flow,|
|                      | optimizer math all reusable                  |
| Step 0               | Premise gate triggered USER CHALLENGE → D    |
|                      | Plan rewritten in-place, Approach D adopted  |
| Section 1  (Arch)    | 0 issues. ASCII graph produced.              |
| Section 2  (Errors)  | 12 paths mapped, 0 critical gaps             |
| Section 3  (Security)| 9 vectors mapped, 0 high open                |
| Section 4  (Data/UX) | 9 edge cases mapped, 0 unhandled             |
| Section 5  (Quality) | 1 refactor auto-decided (helpers extraction) |
| Section 6  (Tests)   | Diagram produced, plan covers 10 test cases  |
| Section 7  (Perf)    | 0 issues. Retention bounds growth.           |
| Section 8  (Observ)  | Metrics + alerts spec'd. Runbook deferred.   |
| Section 9  (Deploy)  | Reversible. ~5min rollback.                  |
| Section 10 (Future)  | Reversibility 5/5. Platform potential YES.   |
| Section 11 (Design)  | UI scope present. 3 missing states flagged.  |
+--------------------------------------------------------------------+
| NOT in scope         | Written (10 items deferred)                  |
| What already exists  | Written                                      |
| Dream state delta    | Written                                      |
| Error/rescue registry| Written, 0 CRITICAL GAPS                     |
| Failure modes        | Mapped, 0 silent paths                       |
| TODOS.md updates     | Pending Phase 4 final gate                   |
| Scope proposals      | 6 cherry-picked from dual voices, all kept   |
| CEO plan             | This document IS the CEO plan                |
| Outside voice        | Codex + Claude subagent both ran             |
| Lake Score           | 6/6 chose complete option                    |
| Diagrams produced    | 1 (architecture)                             |
| Stale diagrams found | 0                                            |
| Unresolved decisions | 0 — premise gate resolved                    |
+====================================================================+
```

**Phase 1 complete.** Codex: 13 concerns surfaced, all addressed. Claude subagent: 8 issues, all addressed. Consensus: 6/6 dimensions confirmed (both models agreed plan needed change → user accepted reframe). Passing to Phase 2 (design review on the admin queue).

---

## Design Review — Phase 2 (autoplan)

### Step 0. Design scope assessment

Plan UI scope is admin-only after Phase 1's reframe:
- `/admin/match` (allocator triage list)
- `/admin/match/[allocator_id]` (candidate queue + excluded + history + actions)
- `/admin/match/eval` (algorithm-vs-founder hit rate dashboard)
- Right-edge slide-out panels: preference editor, send-intro, settings

DESIGN.md exists and is comprehensive. Style references (existing well-designed code): `StrategyTable.tsx`, `PortfolioKPIRow.tsx`, `Sidebar.tsx`. Anti-references: anything that ships purple (`PortfolioEquityCurve.tsx:14` per TODOS.md), anything using `text-lg` for H3 (`BenchmarkComparison.tsx:25,43` per TODOS.md). The plan must NOT replicate these existing bugs.

Initial DX completeness rating (pre-review): 4/10 — Phase 3 task list described data shape and field names but not visual hierarchy or interaction states.

### Step 0.5. Dual Voices (Design)

**CLAUDE SUBAGENT (design — independent review)** — independent, no prior context.

13 findings, composite score **3.0/10**. Top 3 concerns (verbatim summary):
1. Index page sorts by wrong axis ("last recomputed" vs founder's actual question "who needs me"). At 50+ allocators, default sort makes the page unusable.
2. Top-30 flat list with overloaded rows kills the comparison workflow. 3,600px scroll. Need two-pane layout (rail + sticky detail) with keyboard nav.
3. DESIGN.md violations baked into the plan: emoji thumbs and traffic-light score colors will produce a SaaS dashboard look that contradicts institutional positioning.

Other findings: missing mode badge spec, no recompute-in-flight skeleton, "Recompute all" is a footgun without progress, inline preference editor unscoped, eval dashboard has zero visual spec, mobile dismissed without consideration, zero keyboard nav, sidebar item naming/badge missing.

**CODEX SAYS (design — UX challenge)** — independent, no prior context, fed CEO findings as context.

10 findings, composite score **3.9/10**. Top 3 concerns (verbatim summary):
1. Page is specified as a data dump, not a daily triage workflow.
2. Plan assumes inline row actions scale at founder operating volume — they do not (1,500 rows × 3 buttons = manual grind).
3. Critical states and design-system constraints are implied, not designed → will produce generic admin UI drift during implementation.

Other findings: hierarchy wrong on detail page, kill switch "big red" violates color rule, modal pattern violation (should be slide-out), specificity weak (no sticky columns / pagination / sent-state behavior), desktop-only is unrealistic, accessibility underdefined.

### Design Litmus Scorecard — Consensus

```
═══════════════════════════════════════════════════════════════════
  Dimension                           Claude    Codex    Consensus
  ──────────────────────────────────  ───────   ───────  ──────────
  1. Information hierarchy             3/10      4/10     POOR (3.5)
  2. Interaction state coverage        3/10      3/10     POOR (3.0)
  3. Founder workflow ergonomics       4/10      4/10     POOR (4.0)
  4. UI specificity                    4/10      4/10     POOR (4.0)
  5. DESIGN.md alignment               4/10      5/10     POOR (4.5)
  6. Mobile/responsive                 1/10      3/10     POOR (2.0)
  7. Accessibility basics              2/10      4/10     POOR (3.0)
  ──────────────────────────────────  ───────   ───────  ──────────
  COMPOSITE                            3.0/10    3.9/10   3.4/10
═══════════════════════════════════════════════════════════════════
CONFIRMED = both agree plan needs structural design fixes, not aesthetics.
```

7/7 dimensions: both reviewers independently scored ≤ 5/10. Strong cross-model signal that the plan was engineered, not designed.

### Auto-decided fixes (logged in audit trail)

All structural — auto-applied per autoplan rules ("Structural issues: auto-fix"). The plan's Phase 3 specs above were rewritten in-place to incorporate every fix below.

| # | Fix | Source | Principle |
|---|---|---|---|
| D1 | Default sort on index page = "Needs attention" (new candidates + no intro >14 days), not last_recomputed_at | Both | P1 (completeness) |
| D2 | Filter chip row + search input on index page | Both | P1 |
| D3 | Sidebar badge with allocator-needing-attention count | Subagent | P1 |
| D4 | Two-pane layout (left rail + sticky right detail) on detail page | Both | P5 (explicit) |
| D5 | Shortlist strip (top-3 cards above the fold) for the common case | Subagent | P5 |
| D6 | Mode badge spec (`PERSONALIZED` vs `SCREENING` with explicit border colors and caveat line) | Subagent | P1 |
| D7 | Drop traffic-light scoring. Use Geist Mono number + 1px accent bar instead | Both | DESIGN.md alignment |
| D8 | Drop emoji thumbs. Use text labels `KEEP / SKIP` | Both | DESIGN.md alignment |
| D9 | Move kill switch to right-edge settings panel (small status pill in header), not big red toggle | Both | DESIGN.md restraint |
| D10 | All editing surfaces use right-edge slide-out panels per DESIGN.md modal pattern | Both | DESIGN.md alignment |
| D11 | Keyboard shortcut spec (j/k/Enter/s/u/d/r//?) — 50-line `useKeyboardShortcuts` hook | Both | P5 |
| D12 | Spec all 10 interaction states (Task 10.5): loading, empty, all-handled, stale, filter-relaxed, network error, idempotency conflict, kill-switch-off, preferences-edited, tablet, mobile-readonly | Both | P1 |
| D13 | "Recompute all" → progress slide-out panel with cancel + status, not bare button | Subagent | P1 |
| D14 | Inline preference editor → right-edge slide-out + "Recompute now?" prompt on save | Subagent | P5 |
| D15 | Send Intro modal → right-edge slide-out, idempotency key, already-sent banner | Codex | P1 |
| D16 | Eval dashboard → spec'd layout (4 hairline-divided numbers + lightweight-charts line + miss table) | Subagent | P5 |
| D17 | Tablet (768-1023px) → single column, no two-pane | Codex | P1 |
| D18 | Mobile (<768px) → read-only with "Open on desktop" CTA | Subagent | P1 |
| D19 | Filter-relaxed callout (1px red border, no fill) above shortlist when batch was relaxed | Subagent | P1 (completeness, prevents misreading) |
| D20 | Already-sent state: SENT label (no emoji), greyed row, sorted to bottom of left rail | Subagent | P5 |

### Aesthetic taste decisions (NONE flagged for user)

- Both voices agreed on every structural and DESIGN.md fix. No aesthetic disagreements between the two reviewers. No taste decisions to surface at the final gate.

### Cross-phase findings (raised here, will recur in Eng phase)

- Two-pane layout requires preloading all 30 candidates with their detail data on page load (not lazy on row select) → check perf impact in Eng Section 7
- Keyboard shortcuts need a focus-trap-aware hook → check accessibility in Eng Section 5
- Idempotency key for Send Intro → check error path in Eng Section 2/4

### Design Phase Completion Summary

```
+====================================================================+
|         MEGA PLAN REVIEW — COMPLETION SUMMARY (DESIGN)             |
+====================================================================+
| Mode                 | All structural fixes auto-applied            |
| Initial scorecard    | Composite 3.4/10 — POOR across all 7 dims    |
| Post-fix scorecard   | Spec rewritten to address all 13/13 issues   |
| Pass 1 (visual hier) | Two-pane + shortlist strip + header strip    |
| Pass 2 (states)      | 10 states spec'd in Task 10.5                |
| Pass 3 (workflow)    | Keyboard nav + sticky right pane             |
| Pass 4 (specificity) | Every component now has visual + behavior     |
| Pass 5 (DESIGN.md)   | Emoji removed, traffic-light removed, modal   |
|                      | pattern enforced, color discipline restored  |
| Pass 6 (responsive)  | Tablet single-column + mobile read-only       |
| Pass 7 (a11y)        | Keyboard nav + visible focus rings spec'd     |
+--------------------------------------------------------------------+
| Findings (Subagent)  | 13 issues                                    |
| Findings (Codex)     | 10 issues                                    |
| Consensus            | 7/7 dimensions both reviewers ≤ 5/10         |
| Auto-fixes applied   | 20                                           |
| Taste decisions      | 0 (no inter-reviewer disagreement)           |
| User challenges      | 0                                            |
+====================================================================+
```

**Phase 2 complete.** Codex: 10 design concerns, all addressed. Claude subagent: 13 issues, all addressed. Consensus: 7/7 dimensions both ≤ 5/10 → 20 structural fixes auto-applied to Phase 3 task specs. Plan is now design-ready. Passing to Phase 3 (eng review).

---

## Eng Review — Phase 3 (autoplan)

### Step 0. Scope Challenge — actual code analysis

The eng review read the actual files referenced by the plan, not just the plan text:
- `supabase/migrations/001_initial_schema.sql` — confirmed `profiles.role CHECK ('manager','allocator','both')`, `contact_requests UNIQUE(allocator_id, strategy_id)`
- `supabase/migrations/010_portfolio_intelligence.sql` — confirmed the correct RLS pattern (separate `service_insert` + `owner_read`)
- `analytics-service/services/portfolio_optimizer.py` — confirmed `_compute_sharpe`, `_avg_corr`, `_max_drawdown` are module-private with leading underscore; `find_improvement_candidates` hardcodes `add_weight=0.10`
- `analytics-service/routers/portfolio.py` — confirmed cron uses `asyncio.Semaphore(3)` for portfolio compute
- `src/lib/admin.ts`, `src/lib/api/withAdminAuth.ts`, `src/proxy.ts`, `src/app/(dashboard)/layout.tsx` — confirmed admin gate is currently email-based via `ADMIN_EMAIL`, not `is_admin`
- `src/app/api/intro/route.ts` — confirmed Next.js intro route inserts `contact_requests` with no companion `match_decisions` row

The plan as drafted had real code-grounded bugs that would have shipped silently.

### Step 0.5. Dual Voices (Eng)

**CLAUDE SUBAGENT (eng — independent review)** — independent, no prior context. Composite **4.7/10**.

Top 5 (verbatim summary):
1. **C3** — RLS on `match_candidates` / `match_decisions` will block service-role inserts (mirrors mistake; migration 010 has the correct pattern).
2. **C1** — Admin gate mechanism switch not actually wired. `lib/admin.ts` checks email; plan adds `is_admin` but doesn't sync the layers; `withAdminAuth.ts` and downstream Supabase queries will get out of sync.
3. **C2** — Send Intro will deadlock against pre-existing `contact_requests UNIQUE(allocator_id, strategy_id)`. The "already-sent" check reads the wrong table.
4. **C4** — Helper extraction in `portfolio_optimizer.py` has no compatibility shim. Could break unrelated test.
5. **H4** — `5s/allocator` performance estimate is 3-5× optimistic. No benchmark required before ship.

8 high-severity findings + 8 medium-severity. All read actual source code.

**CODEX SAYS (eng — architecture challenge)** — independent, no prior context, fed CEO+Design phase findings. Composite **3.5/10**.

Top 5 (verbatim summary):
1. Non-atomic Send Intro flow will create partial state and duplicate history.
2. `is_admin` rollout conflicts with `ADMIN_EMAIL` gating across middleware, pages, and APIs.
3. Proposed RLS does not enforce trust boundaries or immutability claims.
4. Refactoring `find_improvement_candidates` risks breaking existing optimizer with minimal regression coverage.
5. Stored data is not rich enough to explain ranking/exclusion decisions after the fact.

7 additional findings: missing UNIQUE constraints on match_decisions for sent_as_intro/thumbs, performance scaling concerns, retention plan under-specified, missing test coverage for failure modes, system_flags too open-ended, observability insufficient.

### Eng Dual Voices — Consensus Table

```
═══════════════════════════════════════════════════════════════════
  Dimension                            Claude    Codex    Consensus
  ──────────────────────────────────── ──────── ──────── ──────────
  1. Architecture sound?                7/10     4/10     PARTIAL (clean topology, broken plumbing)
  2. Test coverage sufficient?          5/10     4/10     NO
  3. Performance risks addressed?       4/10     5/10     NO
  4. Security threats covered?          5/10     3/10     NO (RLS broken in 3 places)
  5. Error paths handled?               5/10     4/10     NO
  6. Deployment risk manageable?        4/10     3/10     NO (admin column not backfilled)
  ──────────────────────────────────── ──────── ──────── ──────────
  COMPOSITE                             4.7/10   3.5/10   POOR (4.1)
═══════════════════════════════════════════════════════════════════
CONFIRMED = both agree plan needs structural eng fixes before implementation.
```

6/6 dimensions: both reviewers independently scored ≤ 5/10 on 5 of 6 dimensions, with strong overlap on the top critical findings.

### Auto-decided fixes (logged in audit trail)

All structural, all safety-critical. Auto-applied per autoplan rules. The plan's task specs above were rewritten in-place to incorporate every fix below.

| # | Severity | Fix | Source | Where in plan |
|---|---|---|---|---|
| E1 | critical | Migration 011 backfills `is_admin` from `current_setting('app.admin_email')` inside the migration itself | Both | Task 1 Step 1 |
| E2 | critical | Add Task 1.5: sync `lib/admin.ts`, `withAdminAuth.ts`, `proxy.ts`, `layout.tsx` to check both email AND `is_admin` (OR pattern) for zero-downtime rollout | Both | Task 1.5 |
| E3 | critical | Split RLS into `service_role_insert` + `admin_select` policies for `match_batches`, `match_candidates`, `match_decisions` (mirrors migration 010 pattern) | Both | Task 1 Step 1 |
| E4 | critical | New `match_batches` parent table carries `engine_version`, `weights_version`, `effective_preferences` JSONB, `effective_thresholds` JSONB, `source_strategy_count`. Provenance for "why was X excluded?" debugging. | Codex | Task 1 Step 1 |
| E5 | critical | `match_candidates` rows for excluded use `rank = NULL`; partial unique index `WHERE exclusion_reason IS NULL` so excluded rows don't pollute the hot-path index. | Subagent (H7) | Task 1 Step 1 |
| E6 | critical | New `send_intro_with_decision` SECURITY DEFINER function in migration 011 — atomic transaction wrapping `contact_requests` upsert + `match_decisions` insert. Returns `was_already_sent` if pair already exists. | Both | Task 1 Step 1 + Task 5.5 |
| E7 | critical | Send Intro modal queries `contact_requests` directly for the already-sent check, not just `match_decisions` (handles pre-engine intros). Returned in `/api/admin/match/[allocator_id]` payload. | Subagent | Task 5 Step 3 |
| E8 | critical | Don't extract helpers from `portfolio_optimizer.py`. `match_engine.py` imports the existing private helpers via `from services.portfolio_optimizer import _compute_sharpe, _avg_corr, _max_drawdown`. Adds regression test that imports work from both old and new locations. | Subagent | Task 4 (top of section) |
| E9 | critical | `add_weight` derived from `target_ticket_size_usd / portfolio_aum`, clamped [0.01, 0.5]. Test for tiny allocator (1%) vs whale (30%). | Subagent | Task 4 Step 3 |
| E10 | high | `match_decisions` partial UNIQUE INDEXES for `decision='sent_as_intro'`, `'thumbs_up'`, `'thumbs_down'` on `(allocator_id, strategy_id)`. DB-enforced idempotency. | Codex | Task 1 Step 1 |
| E11 | high | `system_flags` uses `enabled BOOLEAN NOT NULL`, not `value JSONB`. Single boolean is the right shape; JSONB was premature abstraction. | Subagent (M6) | Task 1 Step 1 |
| E12 | high | `system_flags` public-read scoped to `key='match_engine_enabled'` only, not all rows. | Codex (M10) | Task 1 Step 1 |
| E13 | high | Eligibility filter splits into `hard_excluded` (owned, thumbs_down, excluded_exchange — never relaxed) and `soft_excluded` (sharpe, track, dd — what relaxation operates on). Test that relaxation doesn't resurrect hard-excluded. | Subagent (H3) | Task 4 Step 1 |
| E14 | high | Min-max normalization handles single-element eligible set (falls back to absolute scoring). Test `test_single_eligible_candidate_does_not_nan`. | Subagent (M5) | Task 4 Step 3 |
| E15 | high | `corr_with_portfolio` returns `None` (not `0.0`) when overlap insufficient. Reason generator skips reasons whose underlying metric is `None`. Test `test_short_overlap_returns_none_corr`. | Subagent (M4) | Task 4 Step 3 |
| E16 | high | Cron caches the candidate universe ONCE per run, not per allocator (loads strategies + analytics + returns into memory once, loops 50 allocators against it). Eliminates 50× redundant deserialization. | Both | Task 6 Step 3 |
| E17 | high | Performance benchmark required before shipping cron. At N=200 strategies on staging, recompute must be < 10s per allocator. Document baseline. | Subagent (H4) | Task 6 + Test Plan |
| E18 | high | 6 cron-loop integration tests added (kill switch off, per-allocator failure, skip recent, concurrency limit, retention runs after, zero allocators). | Both | Task 6 + Test Plan |
| E19 | high | `match_candidates` excluded list capped at top 50 per batch (closest to threshold), not all 200. Founder UI paginates with search for the rest. | Subagent (M8) | Task 5 Step 1 |
| E20 | high | Retention deletes from parent `match_batches` table (CASCADE handles `match_candidates` cleanup). Set-based, fast, race-safe because retention runs AFTER the per-allocator scoring loop, not during. | Codex (M8) | Task 7 |
| E21 | medium | RLS split for `allocator_preferences`: separate self-write and admin-write policies. Self-editable columns (mandate, ticket size, excluded_exchanges) enforced at API layer; admin-only columns (founder_notes, min_sharpe, etc.) protected by API whitelist. | Codex | Task 1 Step 1 + Task 2 |
| E22 | medium | Constrain `match_engine_excluded_total{reason}` metric label to a fixed enum to avoid Prometheus cardinality explosion. | Subagent | Task 12 |
| E23 | medium | `/api/admin/match/[allocator_id]` uses explicit column projection, not `select *`. Payload size assertion < 500KB at N=30. Test enforces. | Subagent (H5) | Task 5 Step 3 |
| E24 | medium | Recompute idempotency key includes coarse 1-minute timestamp bucket: `recompute:{allocator_id}:{floor(now/60s)}` so spam clicks dedupe but legitimate retries don't. UI surfaces `Computed at HH:MM:SS` so the founder knows the data is fresh. | Subagent (H6) | Task 5 Step 1 |
| E25 | medium | Migration test that imports helpers from BOTH `services.portfolio_optimizer` AND `services.match_engine` to catch any future regression. | Subagent | Test Plan + Task 4 |

### Cross-phase findings resolved

| Source phase | Finding | Resolution |
|---|---|---|
| CEO | Unbounded `match_candidates` growth | Resolved by E20 (parent table CASCADE retention) |
| CEO | Missing eval harness | Resolved by Task 11 (already in Phase 4) |
| CEO | Missing observability | Resolved by Task 12 + E22 |
| CEO | Founder support load "why was X excluded?" | Resolved by E4 (engine_version + effective_thresholds + provenance in match_batches) + Task 8 (excluded list with reason in admin queue) |
| Design | Two-pane preload all 30 candidates | Resolved by E23 (explicit column projection + payload size budget) |
| Design | Keyboard shortcuts focus-trap-aware | Resolved by Task 8 + design review M7 (Cmd/Ctrl modifiers, exempt from a11y screen-reader conflict) |
| Design | Idempotency key for Send Intro | Resolved by E6 (DB-level via unique partial index) + E7 (UI shows already-sent state) |

### Mandatory artifacts

- [x] **Test plan artifact written to disk** at `~/.gstack/projects/AI-Isaiah-Quantalyze/helios-mammut-feat-perfect-match-engine-test-plan-20260407.md`
- [x] **Architecture ASCII diagram** in CEO Section 1 (above)
- [x] **Failure modes registry** in CEO Section 2 (above)
- [x] **Test diagram mapping codepaths to coverage** in CEO Section 6 (above)

### Eng Phase Completion Summary

```
+====================================================================+
|         MEGA PLAN REVIEW — COMPLETION SUMMARY (ENG)                |
+====================================================================+
| Mode                 | All structural fixes auto-applied            |
| Initial scorecard    | Composite 4.1/10 — POOR across 5 of 6 dims   |
| Post-fix scorecard   | All 25 issues addressed; spec rewritten      |
| Section 0  (Scope)   | Read actual code, found 4 critical bugs      |
| Section 1  (Arch)    | Topology clean; plumbing rewritten           |
| Section 2  (Errors)  | 12 paths mapped, 0 critical gaps remain      |
| Section 3  (Security)| RLS rewritten, 0 high open                   |
| Section 4  (Data/UX) | DB-level idempotency now enforced            |
| Section 5  (Quality) | No helper extraction (zero-risk import alias)|
| Section 6  (Tests)   | Test count: 11 → 51, including cron + RLS    |
| Section 7  (Perf)    | Universe caching + benchmark gate added      |
| Section 8  (Observ)  | engine_version + effective_thresholds added  |
| Section 9  (Deploy)  | Backfill in migration + Task 1.5 sync layer  |
| Section 10 (Future)  | Reversibility 5/5 (parent table CASCADE)     |
+--------------------------------------------------------------------+
| Findings (Subagent)  | 16 issues (4 critical, 8 high, 4 medium)     |
| Findings (Codex)     | 10 issues (4 critical, 4 high, 2 medium)     |
| Critical overlap     | 4/4 — both flagged the same 4 critical bugs  |
| Auto-fixes applied   | 25                                           |
| Taste decisions      | 0 (all structural/safety, no aesthetics)     |
| User challenges      | 0                                            |
+====================================================================+
```

**Phase 3 complete.** Codex: 10 eng concerns, all addressed. Claude subagent: 16 issues, all addressed. Consensus: 4/4 critical findings overlapped between reviewers → 25 structural fixes auto-applied to migration 011 + Task 4-7 + new Task 1.5 + new Task 5.5 + expanded test plan. Plan is now implementation-ready. Passing to Phase 4 (final approval gate).

---

## Decision Audit Trail (autoplan auto-decisions)

| # | Phase | Decision | Classification | Principle | Rejected |
|---|---|---|---|---|---|
| GATE | CEO | Approach D (founder-amplifier) over Approach B (allocator-facing) | USER CHALLENGE | User-decided | Approaches A, B, C |
| C1 | CEO | Move Curator Picks from Phase 5 → Phase 1 | mechanical | P1 (completeness) | "Defer to phase 5" |
| C2 | CEO | Add kill switch to Phase 1 | mechanical | P5 (explicit) | "Build later" |
| C3 | CEO | Add `match_candidates` retention policy | mechanical | P2 (boil lakes) | "Unbounded growth OK" |
| C4 | CEO | Add founder admin debug view (excluded list with reason) | mechanical | P2 | "Founder figures it out manually" |
| C5 | CEO | Wire impression/click logging from day 1 | mechanical | P1 | "Add later when ML is needed" |
| C6 | CEO | Add eval harness as Phase 4 task | mechanical | P1 | "Skip eval" |
| C7 | CEO | Defer ML, allocator-facing /recommendations, notifications, manager-side, custom benchmarks to TODOS.md | mechanical | P3 (pragmatic) | "Build now" |
| A1 | CEO arch | Reuse service-role token pattern from `portfolio_optimizer` | mechanical | P5 | "New token mechanism" |
| A2 | CEO arch | New tables in own migration file (011), not piggybacked | mechanical | P5 | "Combine with portfolio intel" |
| A3 | CEO arch | `system_flags` as generic singleton table | overridden by E11 | P5→ E11 (BOOLEAN) | — |
| S1 | CEO sec | `is_admin BOOLEAN` over extending `role` enum | mechanical | P5 | "Add 'admin' to role enum" |
| S2 | CEO sec | All new tables RLS-enabled by default | mechanical | P1 | "RLS optional" |
| S3 | CEO sec | Service-role token reuse, no new secrets | mechanical | P5 | "New service token" |
| Q1 | CEO quality | Pull `_compute_sharpe`, `_avg_corr`, `_max_drawdown` into shared module | overridden by E8 | P5→ E8 (import alias) | — |
| D1-D20 | Design | 20 structural design fixes (default sort, two-pane, no emoji, no traffic lights, slide-out modals, keyboard nav, interaction states, mobile read-only, eval dashboard spec, etc.) | mechanical | P1 + DESIGN.md alignment | Original "engineered, not designed" specs |
| E1 | Eng | Backfill `is_admin` inside migration 011 from `app.admin_email` setting | mechanical | P1 | "Manual backfill after migration" |
| E2 | Eng | Add Task 1.5: sync admin gate across email + is_admin layers | mechanical | P1 | "Drop email immediately" |
| E3 | Eng | Split RLS into `service_role_insert` + `admin_select` policies | mechanical | P1 | "Single FOR ALL policy" |
| E4 | Eng | Add `match_batches` parent table with engine_version, weights_version, effective_preferences, effective_thresholds | mechanical | P1 | "Single match_candidates table" |
| E5 | Eng | `match_candidates.rank = NULL` for excluded + partial index | mechanical | P5 | "rank=-1 sentinel" |
| E6 | Eng | New `send_intro_with_decision` SECURITY DEFINER RPC | mechanical | P1 | "Cross-service writes from Next.js" |
| E7 | Eng | Send Intro modal queries `contact_requests` directly for already-sent check | mechanical | P1 | "Read only `match_decisions`" |
| E8 | Eng | Don't extract helpers; import existing privates via alias | mechanical | P5 (zero-risk) | Q1 (refactor) |
| E9 | Eng | `add_weight = ticket_size / portfolio_aum`, clamped | mechanical | P1 | "Use hardcoded 0.10" |
| E10 | Eng | Partial UNIQUE indexes on `match_decisions` for sent/thumbs | mechanical | P1 | "Application-layer dedup only" |
| E11 | Eng | `system_flags.enabled BOOLEAN`, not JSONB | mechanical | P5 | A3 (JSONB) |
| E12 | Eng | `system_flags` public-read scoped to `key='match_engine_enabled'` only | mechanical | P3 | "All rows publicly readable" |
| E13 | Eng | Eligibility filter splits hard vs soft exclusions | mechanical | P1 | "Single filter chain" |
| E14 | Eng | Single-element normalization fallback | mechanical | P1 | "NaN OK" |
| E15 | Eng | `corr_with_portfolio = None` for short overlap | mechanical | P1 | "Return 0 (current behavior)" |
| E16 | Eng | Cron caches universe ONCE per run | mechanical | P5 | "Per-allocator load" |
| E17 | Eng | Performance benchmark required before ship | mechanical | P1 | "Trust the estimate" |
| E18 | Eng | Add 6 cron-loop integration tests | mechanical | P1 | "Unit tests only" |
| E19 | Eng | Cap excluded list at top 50 closest to threshold | mechanical | P3 | "Persist all 200" |
| E20 | Eng | Retention via parent batch table CASCADE | mechanical | P5 | "Per-row DELETE on candidates" |
| E21 | Eng | Split RLS for self-write vs admin-write on `allocator_preferences` | mechanical | P1 | "Single FOR ALL policy" |
| E22 | Eng | Constrained Prometheus label for `excluded_total{reason}` | mechanical | P5 | "Free-text label" |
| E23 | Eng | Explicit column projection + payload size assertion | mechanical | P5 | "SELECT *" |
| E24 | Eng | Recompute idempotency key with 1-min bucket | mechanical | P3 | "No timestamp bucket" |
| E25 | Eng | Helper alias regression test | mechanical | P1 | "No regression test" |

**Total auto-decisions:** 50+ across 4 phases. **Taste decisions surfaced for user:** 0. **User challenges:** 1 (the premise gate, resolved → Approach D). **Critical bugs caught before implementation:** 4 (admin gate split, RLS service-role block, Send Intro deadlock, helper extraction risk).

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` (via /autoplan) | Scope & strategy | 1 | clean | 13 (Codex) + 8 (Claude subagent) — all addressed; user adopted Approach D at premise gate |
| Design Review | `/plan-design-review` (via /autoplan) | UI/UX | 1 | clean | 10 (Codex) + 13 (Claude subagent) — 20 structural fixes auto-applied |
| Eng Review | `/plan-eng-review` (via /autoplan) | Architecture & tests | 1 | clean | 10 (Codex) + 16 (Claude subagent), 4/4 critical overlap — 25 structural fixes auto-applied |
| DX Review | `/plan-devex-review` | Developer experience | 0 | skipped | No DX scope detected (no API/SDK/CLI for developers) |

**VERDICT:** REVIEW COMPLETE — plan is implementation-ready. Awaiting user approval at the final gate.



