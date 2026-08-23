# Phase 159: RANK — Public-ranking integrity - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning
**Mode:** `--auto` (autonomous run; recommended options selected, logged below)

<domain>
## Phase Boundary

Published percentile ranks and anonymous public reads reflect only computed, honestly-annualized analytics — and a resubmit race cannot corrupt a session's classification. Covers RANK-01, RANK-02, RANK-05, RANK-06, RANK-07, RANK-08, RANK-09. RANK-03/RANK-04 (venue provenance) are Phase 160. `StrategyTable`'s ungated KPI cells are OUT of scope (C-D2, logged in ROADMAP).

</domain>

<decisions>
## Implementation Decisions

The ROADMAP success criteria and REQUIREMENTS §RANK already lock most of the shape
(gate constant vs column-append, `isComputedAnalytics` semantics, census-first,
CAS predicate, splat sites). The decisions below resolve only what those leave open.
All were auto-selected (recommended option) under `--auto`; each is logged.

### Census & the C-D1 decision gate
- **D-01:** The C-M1 census is a committed phase artifact (`159-CENSUS.md`) produced BEFORE the filter lands: per-category published-with-analytics counts before/after the gate, checked against BOTH floors (<5 badge floor, RPC min-N 20), plus the per-strategy percentile before/after snapshot. Any category that crosses a floor because of the gate is recorded there as an expected visible change and surfaced in phase UAT — the filter then proceeds regardless (ROADMAP already decides a disappearing rank is the HONEST outcome). No test asserts rank direction (not uniform).
  `[auto] Census gate — Q: "What form does C-D1 take in an autonomous run?" → Selected: "committed census artifact + UAT surfacing, filter proceeds" (recommended; ROADMAP pre-decides the honesty call)`

### Splat-class closure (RANK-02)
- **D-02:** Close the WHOLE `strategy_analytics (*)` splat class, not the two listed sites. Verified at HEAD (afc90779): `src/lib/queries.ts` has THREE splats (lines 210, 310, 936 — the requirement's `:218` drifted to `:210`) plus `src/app/(dashboard)/compare/page.tsx:68`. Every splat is classified anon-reachable vs owner-only; anon-reachable sites become explicit projections excluding `daily_returns`/`metrics_json`/`data_quality_flags`; owner-only sites keep the splat with a one-line exemption comment at the site. — **Reversibility:** reversible
  `[auto] Splat scope — Q: "Fix only the two named sites or the class?" → Selected: "whole class, classify each site" (house rule: close the whole class across the surface; requirement's line refs already drifted, proving point-fixes rot)`

### Shared gate helper placement (RANK-01)
- **D-03:** The ONE shared computed-analytics filter helper for both TS callers lives in `src/lib/closed-sets.ts` next to `isComputedAnalytics` (the MD-01 single-source module exists precisely for this). `PERCENTILE_GATE_COLUMN` is a separate exported constant; `PERCENTILE_ANALYTICS_COLUMNS` stays byte-unchanged (binding — the csv-finalize mirror prose at three sites depends on it). The `get_verified_cohort_rank` SQL RPC moves in lockstep by default (its prose claims parity-by-construction); if the planner finds a hard reason to exclude it, the exclusion is recorded IN the RPC migration comment — and any RPC change re-bases on the LATEST migration definition (grep ALL migrations first, house rule).
  `[auto] Helper placement — Q: "Where does the shared filter live?" → Selected: "closed-sets.ts, MD-01 pattern" (recommended; module exists for exactly this failure mode)`

### quantstats sign-flip mechanism (RANK-05)
- **D-04:** Kill the guess, don't patch the guesser: the strategy-analytics path must hand quantstats returns explicitly / disable its price auto-detection, mirroring the mechanism already used where this class was previously closed (planner reads the existing closed path and reuses its exact pattern — no new abstraction, no quantstats fork/pin).
  `[auto] RANK-05 — Q: "Patch quantstats behavior or bypass detection at call site?" → Selected: "explicit returns at call site, mirror the existing closed path" (root-cause + consistency)`

### Re-mint fingerprint (RANK-08)
- **D-05:** Default = include classification in the re-mint fingerprint (the real fix, per the requirement's first arm). Fallback ONLY on source evidence that the current fingerprint's classification-blindness is load-bearing (e.g. intentional dedupe across classifications): document the exclusion AT the fingerprint site including the 409-remedy consequence. Planner decides from the source read; both arms satisfy RANK-08 as written.
  `[auto] RANK-08 — Q: "Fingerprint includes classification, or documented exclusion?" → Selected: "include classification, evidence-gated fallback" (requirement offers both; real fix preferred)`

### uid shape validation (RANK-09)
- **D-06:** `withPublishedOrOwner` validates the uid as a strict UUID BEFORE interpolating into the PostgREST `.or()` filter; a non-conforming uid is rejected fail-loud (treated as anon / published-only path — fail CLOSED, never a permissive fallback). — **Reversibility:** reversible
  `[auto] RANK-09 — Q: "Strict validate-and-reject or escape?" → Selected: "strict UUID validation, fail closed" (house style: fail safe, closed, and loud)`

### Claude's Discretion
Exact projection column lists, census SQL, CAS test shape (two-writer race), blend
unknown-`asset_class` implementation detail (RANK-06 — must respect the
`closed_sets.py` MD-01 single-source discipline for anything venue-set-adjacent),
and test placement. Money-math tests pin ECONOMICS via invariant oracles, never the
implementation's own formula (house testing law).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase spec
- `.planning/ROADMAP.md` §Phase 159 (L116-131) — success criteria carry binding research corrections (gate-constant shape, census-first ordering, no-direction-assertion rule)
- `.planning/REQUIREMENTS.md` §RANK (L13-23) — RANK-01..09 with per-requirement research corrections

### RANK-01 / RANK-02 (rank gate + anon projections)
- `src/lib/closed-sets.ts` — `isComputedAnalytics` (terminal-success semantics: `complete_with_warnings` IS a success) + the MD-01 single-source pattern the helper must join
- `src/lib/queries.ts` — splats at L210/L310/L936; `PERCENTILE_ANALYTICS_COLUMNS` (byte-frozen); the L332 comment block documenting the splat's JSONB payload
- `src/app/(dashboard)/compare/page.tsx` L68 — fourth splat site
- `supabase/migrations/20260626120000_get_verified_cohort_rank.sql` — the RPC whose prose claims parity-by-construction with the TS filter

### RANK-05 / RANK-06 (money math)
- `.planning/REQUIREMENTS.md` L855/L858 — original defect records
- `analytics-service/services/closed_sets.py` — `CRYPTO_VENUES` MD-01 single source (L195-213); RANK-06 must not re-introduce a hand-copied venue/asset-class literal

### RANK-07 / RANK-08 (resubmit race + fingerprint)
- `src/app/api/strategies/csv-finalize/route.ts` — FILL-arm discriminator `category_id IS NULL` (L423, L1433, L2595 comment anchors); the mirror prose that `PERCENTILE_ANALYTICS_COLUMNS` must not falsify lives here too

### RANK-09 (visibility filter)
- `src/lib/visibility.ts` — `withPublishedOrOwner` (tests in `src/lib/visibility.test.ts`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isComputedAnalytics` (closed-sets.ts): the gate's semantic core already exists and is tested — the phase wires it to the percentile projection site, it does not re-derive status semantics.
- `readPublicVerificationSignals` / SECDEF `get_published_trust_signals` precedent: the codebase already has a hardened anon-read pattern; RANK-02 projections follow its column-explicitness discipline.
- Close-by-measurement pattern (v1.19): census artifact before behavior change — reuse for C-M1.

### Established Patterns
- MD-01 single-source modules on BOTH sides (`src/lib/closed-sets.ts`, `analytics-service/services/closed_sets.py`) — any new set/constant joins one of these, never a second literal.
- Regression-first: every defect fix lands with a test that fails without it; money-math oracles pin economics, not the impl's formula.
- Anti-vacuity: new pins get RED→GREEN neuter drills.

### Integration Points
- Percentile projection site (queries.ts) — `PERCENTILE_GATE_COLUMN` added alongside, `PERCENTILE_ANALYTICS_COLUMNS` untouched.
- `get_verified_cohort_rank` RPC — SQL-side twin of the TS gate; migration re-based on latest def.
- csv-finalize FILL arm — CAS via `.is("category_id", null)` on the committed row.

</code_context>

<specifics>
## Specific Ideas

- Verified at HEAD (afc90779): requirement line refs have drifted (queries.ts:218 → :210); planner works from fresh greps, not ledger line numbers (house rule: re-measure at HEAD).
- PROD census runs against prod = quantalyze.xyz data via read-only means; census artifact must not contain user PII (repo is PUBLIC, `.planning/` is tracked — counts and percentiles only, no emails/uids).

</specifics>

<deferred>
## Deferred Ideas

- `StrategyTable` ungated KPI cells — C-D2, explicitly out of scope per ROADMAP; logged there.
- RANK-03 / RANK-04 (server-authoritative venue + attested annualization stamp) — Phase 160, with B-M1 census.

</deferred>

---

*Phase: 159-RANK — Public-ranking integrity*
*Context gathered: 2026-08-21*
