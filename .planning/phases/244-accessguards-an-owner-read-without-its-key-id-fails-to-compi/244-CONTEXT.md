# Phase 244: ACCESSGUARDS - Context

**Gathered:** 2026-11-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Three access guards, each provable RED on a neutered copy (PROOF-01):

- **DBACC-04 compile guard.** An owner-surface read of a `strategies` row that lacks `api_key_id` fails to compile. `src/lib/types.ts` `Strategy.api_key_id` is optional today (`api_key_id?: string | null`, comment "anon-safe projections (STRATEGY_PUBLIC_COLUMNS) omit it"). Closes TODOS `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD`.
- **DBACC-05 audit law.** "The six routes" are the six entries of `H_0001_UNCOVERED_ALLOWLIST` in `src/__tests__/audit-coverage.test.ts`. They are six write sites in four route files. Each site gets an audit row or a recorded founder exemption. The exact-set allowlist only shrinks, ending at 0 with its `toHaveLength(6)` literal lowered to match. Closes TODOS `[H-0001]` (section "Phase 163 / SEC-03 — H-0001 census RE-MEASURED").
- **DBACC-06 watchlist in CI.** `e2e/discovery-watchlist.spec.ts` (the RLS proof that user-B cannot read user-A's `user_favorites`, the unauthenticated `PUT /api/watchlist/[id]` 401, and the anon `/browse/[slug]` chrome check) runs in the gating `e2e-seeded` job, and a neutered `user_favorites` policy turns it red. Closes the TODOS `[158-OPS-03] discovery-watchlist.spec.ts` bullet.

Out of scope: the other 158-OPS-03 bullets, and the silent upsert error-handling in flag-monitor and finalize-wizard (not this phase's requirement; reviewers may book it).

</domain>

<decisions>
## Implementation Decisions

### DBACC-05 per-site judgment (FOUNDER DECISION 2026-11-26: "Approve as proposed", relayed by the coordinating session from the founder's AskUserQuestion answer)
- Site 1, `src/app/api/admin/partner-import/route.ts` `profiles` upsert: COVERED by a real audit row. The import writes one roll-up `admin.partner_import` row via `emitAsUser` (route.ts ~:878 and ~:1006). The existing `@audit-skip` pragma sits outside the gate's 8-line window; move it into the window.
- Sites 2-3, `src/app/api/cron/flag-monitor/route.ts`, the two `feature_flags` upserts of `ZERO_DENOM_STREAK_KEY` (increment in `handleZeroDenominator`, reset on the first non-zero window): FOUNDER EXEMPTION 2026-11-26, internal cron counter written every 15 minutes.
- Site 4, `src/app/api/keys/sync/route.ts` `stampCompositeFailedUnlessComplete`'s `strategy_analytics` upsert: FOUNDER EXEMPTION 2026-11-26, derived `strategy_analytics` compute state ('failed' stamp).
- Sites 5-6, `src/app/api/strategies/finalize-wizard/route.ts`, the `strategy_analytics` upserts in `compositeMemberCount` and `unifiedFinalizeWizardHandler`: FOUNDER EXEMPTION 2026-11-26, same class as site 4.
- Exemption form: an in-window `// @audit-skip:` pragma at each of sites 2-6 whose reason cites "founder exemption 2026-11-26 (Phase 244 DBACC-05)" and names the class (internal cron counter / derived strategy_analytics compute state). The allowlist goes 6 -> 0 by deleting its entries, and the `toHaveLength(6)` literal moves with it. — **Reversibility:** costly — an exemption is a compliance judgment the founder owns; undoing it later means designing audit actions and probably a migration that auto-applies to PROD.
- Not chosen: real audit rows for sites 2-6 (new `AuditAction` values, possibly a migration).

### Decided autonomously
- [DBACC-04] Q: "How is the compile guard shaped?" → Selected: "Keep `Strategy.api_key_id` REQUIRED (`string | null`) and add `PublicStrategy = Omit<Strategy, 'api_key_id'>` in `src/lib/types.ts` for the readers that select `STRATEGY_PUBLIC_COLUMNS` (`getFactsheetDetail`, `getStrategiesByCategory` and any other found by grep in `src/lib/queries.ts`, which today cast to `Strategy`). Measured 2026-11-26: flipping the field to required alone gives 0 tsc errors at HEAD, so the work is the public types plus the test." — local type edit, no runtime or schema change
- [DBACC-04] Q: "How is the guard tested?" → Selected: "A type-level test file with `@ts-expect-error` lines inside a never-invoked function (the `src/__tests__/audit-event-union-types.test.ts` pattern). The RED comes from `npx tsc --noEmit` (the `frontend-typecheck` job), because vitest strips types and cannot fail on it. Neuter = make the field optional again; tsc must report `Unused '@ts-expect-error' directive` on the named line." — test-only
- [DBACC-05] Q: "How does the ratchet end?" → Selected: "Delete each discharged allowlist entry and lower the `toHaveLength` literal in the same commit; the gate's own discharge arm demands it. Never add an entry. Update the header prose to record the closure date." — test file edit
- [DBACC-05] Q: "PROOF-01 for the audit gate?" → Selected: "Neuter = remove one new in-window pragma (or move it out of the window); the gate must go red naming that file and snippet in its 'NOT in the H-0001 allowlist' message; restore from a byte backup (`cp` back, `cmp`)." — proof procedure only
- [DBACC-06] Q: "How is the watchlist spec wired?" → Selected: "Add `e2e/discovery-watchlist.spec.ts` to the `e2e-seeded` Playwright list in `.github/workflows/ci.yml` (place 1 of the MA-8 contract; its `HAS_SEED_ENV` skip is place 2), and add a wiring pin test modelled on `src/__tests__/manager-keys-e2e-wiring.test.ts` so dropping it from the list, adding it to the advisory `e2e` list, or a tolerated-failure spelling goes red. Grep `src/__tests__` for every census of the seeded list and update each." — CI list and test edits
- [DBACC-06] Q: "What about the RLS arm's silent skip?" → Selected: "Remove the `if (anonKey)` guard around the bare `user_favorites` SELECT (spec ~:376-377) so a missing `TEST_SUPABASE_ANON_KEY` FAILS rather than skipping the primary RLS proof. The `e2e-seeded` lane already exports `TEST_SUPABASE_ANON_KEY`." — spec edit
- [DBACC-06] Q: "Where is the neutered-policy proof run?" → Selected: "On the local-stack lane only (`scripts/local-stack/run.sh up`), never shared TEST or PROD: replace the `user_favorites` SELECT policy with `USING (true)`, run the spec, see the 'RLS LEAK on migration 024 policy' arm fail first, restore, see green. Also prove the 401 arm by neutering the route's auth check in a byte-backed copy. Stop the Docker stack and clean up afterwards." — local proof procedure
- [DBACC-06] Q: "Run-and-repair?" → Selected: "Run the spec against the local-stack lane before wiring; repair spec rot found there within the spec file only. The spec has never run in CI." — spec-local

- [DBACC-04] Q: "What scope does the PublicStrategy retype reach (research 2026-11-26)?" → Selected: "The two STRATEGY_PUBLIC_COLUMNS readers at HEAD (getStrategiesByCategory, getFactsheetDetail; TODOS said three) return types without api_key_id (PublicStrategy, PublicRankedStrategyRow = Omit<RankedStrategyRow,'api_key_id'>); the shared StrategyTable and StrategyGrid take a row type that tolerates both public and owner rows; the two category pages and one test file follow. Prototyped green by the researcher (tsc 0 errors, vitest green)." — type-only edits, no runtime or schema change
- [DBACC-06] Q: "The unauthenticated PUT /api/watchlist/[id] never reaches the route's 401 (src/proxy.ts redirects it 307 to /login because /api/watchlist is not in PUBLIC_ROUTES). How is that arm repaired?" → Selected: "Option A: request with maxRedirects: 0 and assert the 307 to /login, which is the guard that actually stops an anonymous caller; its PROOF-01 neuter is a byte-backed src/proxy.ts copy with /api/watchlist added to PUBLIC_ROUTES. The route's own 401 stays proven by its route.test.ts. This replaces the '401' and 'neuter the route's auth check' wording above." — test assertion and proof procedure only; the product behaviour (anonymous caller refused) is unchanged
- [DBACC-06] Q: "How is a live policy byte-restored for PROOF-01?" → Selected: "Snapshot pg_policy for user_favorites (polname, polcmd, pg_get_expr(polqual), pg_get_expr(polwithcheck)) to a file before the neuter and after the restore, and cmp the two files; on the local-stack lane only." — proof procedure only
- [DBACC-06] Q: "First DBACC-06 task?" → Selected: "Boot the lane and run the spec as-is (expect 4 executed, 0 skipped after repairs) before wiring; Docker cleaned up afterwards." — procedure only

### DBACC-04 scope (FOUNDER DECISION 2026-11-27: "Accept as narrowed", relayed by the coordinating session from the founder's AskUserQuestion answer)
- SC-1 is met as narrowed: the compile guard (`PublicStrategy`/`PublicRankedStrategyRow`, type test under `tsc`) plus the blocking CI source-scan pin `src/__tests__/api-key-id-owner-read-pin.test.ts` and its cast-site census. Owner reads typed by casts are not compiler-checked. TODOS `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD` is re-pointed at the shared StrategyTable/StrategyGrid optional-key remainder, not deleted. — **Reversibility:** costly — reopening it means removing the owner-read casts across four readers.

### Claude's Discretion
- Plan split and wave layout (the three requirements are independent: one plan per requirement fits; DBACC-05 can split site 1 from sites 2-6 so the founder wait blocks only the second).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/__tests__/audit-event-union-types.test.ts` and `src/__tests__/seed-demo-data-types.test.ts` — type-level test pattern gated by `tsc --noEmit`.
- `src/__tests__/manager-keys-e2e-wiring.test.ts` and `src/__tests__/e2e-seeded-hydration-guard.test.ts` — seeded-list parser and wiring-pin pattern.
- `src/lib/constants.ts` `STRATEGY_PUBLIC_COLUMNS_ARR` — the anon-safe column list (no `api_key_id`).

### Established Patterns
- `@audit-skip: <reason>` pragma within 8 lines above the mutation chain start (73 in `src/app/api` today); `logAuditEvent*` within 60 lines after.
- e2e-seeded MA-8 contract: place 1 = listed in the ci.yml seeded step, place 2 = the spec's `HAS_SEED_ENV` skip.
- `e2e-seeded` boots the local-stack lane private to its runner and hands over `TEST_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY` via `GITHUB_ENV`.

### Integration Points
- `src/lib/queries.ts` public readers (`.single<Strategy & …>()` casts) move to `PublicStrategy`.
- `src/__tests__/critical-regressions.test.ts` pins the `e2e-seeded` job shape.
- `TODOS.md` entries closed by this phase are deleted in the ship PR and named in the CHANGELOG.

</code_context>

<specifics>
## Specific Ideas

- PROOF-01 per gate: RED on a neutered copy with the named arm first, restore from a byte backup (`cp` back, `cmp`), GREEN, all recorded verbatim in the plan SUMMARY.
- Merge constraint for this run: nothing merges to main before 23:15 UTC 2026-11-26 (a read-only probe on the Railway analytics service).

</specifics>

<deferred>
## Deferred Ideas

- flag-monitor's two streak upserts and finalize-wizard's two `strategy_analytics` upserts ignore their `error` result. That is a silent-failure question outside DBACC-05's audit-row scope.

</deferred>
