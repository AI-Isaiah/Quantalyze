# Phase 105: Composite → the one CSV finalize route — Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Source:** discuss-phase (assumptions mode, fable second-mind pressure-test of 105-RESEARCH.md, run research-first per the research-dependent-decisions ordering)

<domain>
## Phase Boundary

Phase 105 is where CASH stops being a bypass. Composite-cash + the CSV runner route through the shared `derive_basis_series`; cash SCALARS become a cache of a persisted cash series (the round-trip anti-divergence guard now covers cash); and four Tier-2 collapses land. The CENTRAL gate is **SC-4 byte-identity** of every existing cash factsheet (single-key CSV, single-key broker, published composite) surviving the cash-scalar re-route — Phase 104 deliberately deferred scalar-cache-ification to HERE because `derive_basis_series`'s gap-fill(0.0) diverges from all three legacy cash conditionings.

**IN SCOPE (Phase 105):** collapse #1 (composite cash → `derive_basis_series` + DELETE `_metrics_result_for`), #2 (CSV single-key inline swap `analytics_runner.py:2318` — co-lands here), #5 (collapse the two `periods_per_year` rules), #6 (venue-source + allocated-capital forks move upstream into preparation), the transactional-finalize hardening (SC-5), the two Phase-104 carry pre-reqs (MED-1 stale-row heal, MED-2 venue-agnostic conventions echo), and the series-store fold DECISION (execute in 106).

**CARVED OUT → Phase 105.1 (unconditional):** collapse #4 (unify onboarding). Decoupling is strong AND it carries its own unsolved design problem (see Decision 2) — it must NOT bloat the SC-4 core.
</domain>

<decisions>
## Implementation Decisions (LOCKED — do not re-open in planning)

### D1 — SC-4 cash-scalar reproduction: `scalar_returns` param + `densify_policy` echo + composite `nan_dates` key
- Add `scalar_returns: pd.Series | None = None` (keyword) to `derive_basis_series`. Default `None` → today's `gap_fill(_drop_nonfinite(returns))` — so MTM + every current caller is **byte-identical by construction** (composite MTM `job_worker.py:4411`, single-key `:3200` unchanged).
- Cash callers pass the **exact legacy-conditioned series** built UPSTREAM in preparation (this upstream conditioning IS collapse #6) → the cash scalar is byte-identical to the legacy path by construction. Persisted ROWS stay `_drop_nonfinite(sparse)` (honest).
- Echo a `densify_policy` string in `conventions` ∈ `{"sparse", "broker_nan", "zero_fill"}` so the round-trip guard / 106 reader can rebuild the scalar input from the sparse rows.
- **⚠️CRITICAL AMENDMENT (fable caught; the research's tag-alone is INSUFFICIENT for composites):** the composite legacy input is `gap_fill(stitched)` — 0.0-fills inter-member gaps but PRESERVES in-index member-guard NaN. The persisted `_drop_nonfinite` rows drop BOTH kinds and `gap_spans` merges them, so a `"zero_fill"` reconstruction would put 0.0 where the real input had NaN → the round-trip guard reddens on the composite guard-NaN fixture. FIX: the composite (`"zero_fill"`) basis payload MUST also carry an **additive `nan_dates` (guard-NaN dates) key** in the JSONB (NO DDL — bump `_PAYLOAD_SCHEMA_VERSION` at `basis_series.py:84`). Reconstruction per policy: `sparse` → rows verbatim; `broker_nan` → `reindex(date_range(min,max))` (every in-span absence is a guard day); `zero_fill` → `gap_fill(rows)` then reinstate NaN at `nan_dates`. The round-trip guard must stay VALID on all three surfaces incl. the composite guard-NaN fixture — never weakened/skipped for composites.

### D2 — Split: Phase 105 = #1/#2/#5/#6 + finalize + MED-1/MED-2 + fold-decision; onboarding #4 → **Phase 105.1 (unconditional carve)**
- #4 is decoupled: the teaser arm (`routers/process_key.py:854-948`) writes ONLY `strategy_verifications.metrics_snapshot` via `transition_strategy_verification`, computes on a different primitive (`trades_to_daily_returns(account_balance=None)` heuristic capital), touches neither `strategy_analytics` nor the cash `derive_basis_series` change.
- **Unsolved design problem forcing the carve:** at teaser time there may be NO strategy row (landing-page verify; the wizard creates the strategy at finalize), but `persist_basis_series` is keyed `(strategy_id, kind)` — so #4 CANNOT reuse the shared persist as-is; it needs its own persistence design (verification-scoped payload, or defer series persist to finalize). That is a separate phase's work.

### D3 — MED-1 (stale-row heal): read-side status-gate primary
- Exhaustive reader sweep: the ONLY basis-series readers are `readMtmSeries` (`composite-read-path.ts:94-114`), both surfaces already gated by `shouldReadSingleKeyMtmSeries` (requires `computation_status ∈ {complete, complete_with_warnings}` + the by-basis scalar object). GDPR export does NOT touch `strategy_analytics_series`; admin reads `csv_daily_returns`. So a single read-side status-gate for the cash series is sufficient.
- **Two caveats (write into scope):** (a) the 106 cash reader is REQUIRED to route through the `shouldReadSingleKeyMtmSeries` predicate family (lock in the fold decision); (b) the 105 round-trip guard / any dual-run harness MUST itself respect the gate (skip / expect-absent when status ≠ complete) or it reddens on legitimately-failed strategies.
- Defense-in-depth heal-deletes at the known terminal arms (`job_worker.py:2801-2821` etc.) are cheap/optional secondary; the GATE is the guarantee.

### D4 — #5 periods_per_year collapse: collapse to `periods_per_year_for_asset_class`, KEEP a fail-loud assert
- Safe with NO live-scalar change: the F-1 backstop (`job_worker.py:4214-4231`) landed in `044bee50` — the SAME commit that introduced `stitch_composite.py` (composite GA), so no composite job has EVER run without it → no published composite can carry a divergent clock.
- Collapse to the single `asset_class` rule; keep `_COMPOSITE_DEGRADE_VENUES` as the unknown-venue backstop. **Do NOT silently delete the fail-loud check** — retain an equivalent sanity assert (a future wrong-`asset_class` composite from the non-blocking finalize-wizard force-derive would otherwise silently annualize √252).

### D5 — Transactional finalize (SC-5): ordered-idempotent, NO DDL
- supabase-py has no cross-`.table()` transaction; the existing `persist_csv_daily_returns` SECDEF is `auth.uid()`-gated (worker can't call it) → true cross-table atomicity would need a NEW service-role SECDEF = prod DDL.
- LOCK ordered-idempotent for 105: order the series-row RPC (single-row atomic) + dailies BEFORE the scalar/status flip LAST → a `complete` scalar never exists without its series; MED-1's gate un-trusts every partial predecessor; a worker death → an authoritative-re-derive retry (`_reconcile_full_delete` idempotence).
- **Honest boundary (write into CONTEXT):** ordered-idempotent = GATED EVENTUAL CONSISTENCY, not atomicity. On a RE-derive of an already-`complete` strategy, a death between the dailies delete and the scalar flip leaves old-scalar + partial-dailies visible until retry — a transient chart/KPI mismatch window that is **PRE-EXISTING today** (`job_worker.py:4466-4492`), so 105 makes nothing worse. If strict atomicity is wanted, ship the finalize SECDEF RPC as part of **106's fold migration** (which already carries DDL + test-project catch-up + migration-reviewer) — do NOT make 105 prod-DDL-affecting for a window that already exists.

### D6 — Series-store fold (DECISION only; EXECUTE in 106): tall `daily_returns` + `basis`
- Tall table required (a per-strategy JSONB blob cannot serve these): `allocator_id`+date index (`20260625120000`), per-key axis (`20260624120000`), owner-coherence trigger, GDPR manifest date-range/allocator queries, admin/discovery/wizard readers. ~70 files reference `csv_daily_returns` (advisory count).
- Fold MTM (and the 104 cash) `strategy_analytics_series` daily-return kinds INTO the tall table. **Bonus (lock the rationale):** `strategy_analytics_series` is ABSENT from the GDPR export manifest today — folding those user daily returns into the tall table makes them exportable via the existing axes, closing a latent GDPR-completeness gap.

### Claude's Discretion
- Wave shape within 105 (the planner decides; if it still exceeds ~2 waves after the #4 carve, split further, but #4 is already carved).
- Exact `nan_dates` key name/shape (must be additive, no DDL, schema-version-bumped).
</decisions>

<canonical_refs>
## Canonical References (downstream agents MUST read)

### The shared route + guard
- `analytics-service/services/basis_series.py` — `derive_basis_series`/`persist_basis_series`, `_KIND_BY_BASIS`, `conventions` echo, `_PAYLOAD_SCHEMA_VERSION:84`, round-trip guard anchor.
- `analytics-service/tests/test_basis_series.py:73` — `_roundtrip_recompute` (the guard the D1 amendment must keep valid on the composite fixture).

### Composite finalize (the re-route target)
- `analytics-service/services/job_worker.py` — `_metrics_result_for` ~:4178 (DELETE), `gap_fill(stitched)` scalar input ~:4279-4287, venue-blend periods ~:4115, F-1 backstop :4214-4231, `_reconcile_full_delete` :4466-4492, venue-source forks :2045/1954, `denominator_config` :2149, terminal-failure arms :2801-2821.

### Legacy cash conditioning (the SC-4 targets)
- `analytics-service/services/analytics_runner.py` — broker NaN-reinstatement ~:2272-2277, sparse user-CSV gate :2259-2262 + compute :2318, venue-agnostic `denominator_config` :2304-2316, `asset_class` periods ~:2299.

### Readers / fold
- `src/lib/factsheet/composite-read-path.ts:94-114` (`readMtmSeries`), `:402+` (`shouldReadSingleKeyMtmSeries` — the MED-1 gate).
- `src/lib/gdpr-export-manifest.ts` (fold GDPR argument).

### Onboarding (→105.1)
- `analytics-service/routers/process_key.py:854-948` (teaser arm), `transition_strategy_verification` RPC, `strategy_verifications.metrics_snapshot`.
</canonical_refs>

<specifics>
## Standing constraints (LOCKED)
- SC-4 is THE gate; behind the existing flag. No-invented-data.
- Migrations auto-apply to PROD on merge → 105 ships NO DDL (the `nan_dates` key is JSONB-additive + schema-version bump; the fold DDL is 106). Any SECDEF fn hardened + migration-reviewer + rls-policy-auditor.
- Tests: DB/RLS gates in `supabase/tests/test_*.sql`; `*_live.py` SKIP in CI; the executor has NO Supabase MCP (plan pytest-against-fixtures + the SC-4 dual-run harness); new milestone migs need test-project MCP catch-up before merge.
- NO git branch ops in subagents (only `git add <explicit paths>`, never `-A`/`.planning/`).
</specifics>

<deferred>
## Deferred
- Collapse #4 (onboarding unify) → Phase 105.1.
- Series-store fold EXECUTION + the `metrics_snapshot` delete-tail → Phase 106.
- Strict-atomicity finalize SECDEF RPC → optional, rides 106's fold migration.
</deferred>

---
*Phase: 105-composite-the-one-csv-finalize-route*
*Context locked 2026-07-14 via discuss-phase assumptions mode (fable second-mind, research-first).*
