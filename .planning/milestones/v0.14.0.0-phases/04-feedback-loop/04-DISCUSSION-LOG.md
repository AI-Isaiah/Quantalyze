# Phase 4: Feedback Loop - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 04-feedback-loop
**Areas discussed:** Success definition, Dimension attribution, Execution cadence, Threshold shape + boundaries

---

## Gray-area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Success definition | What counts as a 'positive outcome' for FEEDBACK-02's success_rate? | ✓ |
| Dimension attribution | How does a bridge_outcomes row map to one of the 4 weight dimensions? | ✓ |
| Execution cadence | When does feedback_engine run? Inline, async, cron, or admin-triggered? | ✓ |
| Threshold shape + boundaries | Literal step function vs linear; hysteresis; per-dim vs pool min-5; cold-start shape | ✓ |

**User's choice:** All four areas selected.

---

## Success Definition

### Positive-outcome signal

| Option | Description | Selected |
|--------|-------------|----------|
| Realized delta sign | Positive realized delta vs pre-intro baseline → success; 0/negative → failure. Uses delta_Xd columns the Phase 1 cron populates. | ✓ |
| Binary allocated-vs-rejected | kind='allocated' → success, kind='rejected' → failure. Doesn't depend on delta maturation. Conflates conviction with validation. | |
| Composite allocated AND delta>0 | Success requires BOTH allocated AND positive delta. Rejected = failure. Strictest; 30–90 day maturation latency. | |

**User's choice:** Realized delta sign (D-01).
**Notes:** kind='allocated' alone is a conviction signal, not a validation signal — what matters is whether the suggestion actually outperformed.

### Delta window

| Option | Description | Selected |
|--------|-------------|----------|
| Most-mature-available | 180d → 90d → 30d fallback, first non-NULL. Matches Phase 1 D-12 pattern; converges over time. | ✓ |
| 90d only | Fixed quarterly window. Excludes <90d-old outcomes. | |
| 30d only | Fastest feedback; noisier. | |
| All three averaged | Mean of non-NULL deltas. Smoother, more complex. | |

**User's choice:** Most-mature-available (D-02).
**Notes:** Outcome auto-reclassifies once longer windows mature. Matches the D-12 'always show most mature label' UX pattern.

### Pending handling

| Option | Description | Selected |
|--------|-------------|----------|
| Exclude from success_rate AND min-5 | Pending excluded until first delta matures. 'We don't know yet' default. | ✓ |
| Include as neutral 0.5 | Counts toward threshold but not signal. | |
| Include as success | Biased positive during first 30d. | |

**User's choice:** Exclude entirely (D-03).
**Notes:** Outcome flips into the calc automatically once cron populates delta_30d. No bias for new allocators.

### Rejected handling

| Option | Description | Selected |
|--------|-------------|----------|
| Count as failure + use rejection_reason for attribution | Uses BOTH Phase 1 signals. | ✓ |
| Count as failure only | Ignores rejection_reason enum. | |
| Exclude entirely | Wastes the structured enum Phase 1 designed for this. | |
| Use for attribution only | Decouples 'did they act' from 'which dim'. | |

**User's choice:** Count as failure + use for attribution (D-04).
**Notes:** Phase 1 D-10 explicitly designed the rejection_reason enum for Phase 4 attribution.

---

## Dimension Attribution

### Top-level attribution rule

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: enum → rejected, score-dominant → allocated | Rejected uses enum mapping; allocated uses max score_breakdown dimension at intro time. | ✓ |
| Uniform — every outcome hits all 4 equally | Simplest; loses signal. | |
| Proportional by score contribution | Weighted by each dimension's share of the final score. Smoother but diffuse. | |
| Enum only — skip allocated-negative | Only rejected drives attribution. Wastes the delta signal. | |

**User's choice:** Hybrid (D-05).
**Notes:** Leverages BOTH Phase 1 & Phase 3 structured signals. Requires match_candidates lookup per outcome.

### Rejection-reason → dimension mapping

| Option | Description | Selected |
|--------|-------------|----------|
| mandate_conflict→PREF, underperforming_peers→TRACK, timing_wrong→PORTFOLIO, already_owned→excluded, other→score-dominant | Full enum mapping. | ✓ |
| mandate_conflict→PREF, all others→score-dominant | Only mandate_conflict is unambiguous. | |
| Custom mapping | User defines. | |

**User's choice:** Full enum mapping (D-06).

### Missing-history fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Uniform attribution fallback | Preserves outcome's contribution; blurs which dim took the hit. | ✓ |
| Exclude the outcome entirely | Shrinks outcome pool; painful for early adopters. | |
| Re-score against fresh universe | Expensive and stale. | |

**User's choice:** Uniform fallback (D-07).

### Noise-floor filtering

| Option | Description | Selected |
|--------|-------------|----------|
| Drop already_owned + require percent_allocated ≥ 1% | Both filters active. | ✓ |
| Drop already_owned only | Keeps all allocated regardless of size. | |
| Keep everything | Leans on min-5 to soak up noise. | |

**User's choice:** Both filters (D-08).
**Notes:** already_owned is data hygiene, not scoring feedback. <1% allocations aren't conviction.

---

## Execution Cadence

### Invocation point

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in _score_one_allocator, pre-scoring | Merges result into prefs['scoring_weight_overrides'] before score_candidates runs. | ✓ |
| Separate entry point | feedback_engine.run_for_allocator as its own concern. Cleaner separation; two writers to coordinate. | |
| Stateless module | Pure-function only; integration is planner detail. | |

**User's choice:** Inline (D-09).

### Persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Persist + in-memory use | Writes column AND returns for immediate use. Satisfies FEEDBACK-04 literally. | ✓ |
| In-memory only | Transient; match_batches.effective_preferences snapshots. | |
| Persist on change only | Equality-check hop. | |

**User's choice:** Persist + in-memory (D-10).

### Trigger set

| Option | Description | Selected |
|--------|-------------|----------|
| Daily cron + delta-cron follow-up enqueue | Two natural triggers reusing Phase 3's rescore_allocator worker. | ✓ |
| Recompute on every scoring run only | Zero new wiring; stale on mandate-edit rescores. | |
| Enqueue on every bridge_outcome INSERT/UPDATE | Postgres trigger; wasted compute when deltas are NULL. | |
| Delta cron only | Saves compute; stale for new signups. | |

**User's choice:** Daily cron + delta-cron follow-up (D-11).

### Delta-hook mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit enqueue in delta cron Python | Strictly additive; visible in cron log. | ✓ |
| Postgres trigger on bridge_outcomes UPDATE | More opaque; duplicates responsibility. | |
| Both (belt-and-suspenders) | Partial unique index dedupes anyway. | |

**User's choice:** Explicit Python enqueue (D-12).

---

## Threshold Shape + Boundaries

### Scale function shape

| Option | Description | Selected |
|--------|-------------|----------|
| Literal step function per spec | <0.4 → 0.5×; 0.4-0.7 → 1.0×; >0.7 → 1.5×. Matches FEEDBACK-02 verbatim. | ✓ |
| Linear interpolation between bands | Smoother; no boundary cliff. | |
| Stepped (three bands below/above) | Five tiers; more granular. | |

**User's choice:** Literal step function (D-13).

### Hysteresis

| Option | Description | Selected |
|--------|-------------|----------|
| Snap back to 1.0× when in neutral zone | Pure-functional, stateless, predictable. | ✓ |
| Sticky — keep until opposite threshold | Requires reading prior override; stateful. | |
| Sticky with decay | Time-dependence complicates testing. | |

**User's choice:** Stateless snap-back (D-14).

### Min-5 gating

| Option | Description | Selected |
|--------|-------------|----------|
| Per-dimension | Each dim independently needs ≥5 attributed outcomes. Aligns with FEEDBACK-05. | ✓ |
| Total pool | ≥5 total unlocks all dims. High-variance. | |
| Total ≥5 + per-dim ≥2 | Middle ground; two thresholds. | |

**User's choice:** Per-dimension (D-15).

### Cold-start / under-threshold write shape

| Option | Description | Selected |
|--------|-------------|----------|
| Omit the key | Engine reads overrides.get(W_i, 1.0); missing = 1.0×. Minimal writes. | ✓ |
| Always write {} with explicit 1.0× | Full 4-key dict; queryable admin signal. | |
| Leave column NULL until ≥5 total | No override for new allocators. | |

**User's choice:** Omit the key (D-16).

---

## Claude's Discretion

Areas the user delegated (explicitly or implicitly):

- Internal helper decomposition of `feedback_engine.py`
- Exact Supabase query shape for outcomes + match_candidates join
- Audit-event emission policy for feedback writes
- Delta-cron enqueue granularity (every transition vs threshold-crossings only)
- Integration-test shape (in-memory mock vs HAS_LIVE_DB)
- Debug endpoint existence
- REJECTION_REASON_TO_DIMENSION constant location
- Test-file placement (extend vs new)

## Deferred Ideas

- FEEDBACK_VERSION constant (future)
- Sub-weight overrides (Phase 6+)
- Alternative shapes (linear, stepped, continuous)
- Hysteresis / decay / sticky adjustments
- Postgres trigger on bridge_outcomes UPDATE
- Admin feedback-observability UI (Phase 5)
- Property-based + mutation tests (Phase 6)
- Continuous percent_allocated conviction weighting
- Score-proportional attribution (alt)
- Re-score against fresh universe for aged-out history (alt)
- Audit-event emission on feedback writes (Claude's Discretion)
- Debug endpoint for feedback state (Claude's Discretion)
