---
phase: 244-accessguards
verified: 2026-11-27T12:40:00Z
status: passed
score: 4/4 must-haves verified (SC-1 by founder override, as narrowed)
verified_at_sha: 4c4285659a8a219c7e356dfead7942f8dfa730b7
drift_subjects:
  - src/lib/types.ts
  - src/lib/queries.ts
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/__tests__/api-key-id-compile-guard.test.ts
  - src/__tests__/api-key-id-owner-read-pin.test.ts
  - src/__tests__/audit-coverage.test.ts
  - src/__tests__/discovery-watchlist-e2e-wiring.test.ts
  - src/__tests__/e2e-seeded-hydration-guard.test.ts
  - src/app/api/admin/partner-import/route.ts
  - src/app/api/cron/flag-monitor/route.ts
  - src/app/api/keys/sync/route.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - e2e/discovery-watchlist.spec.ts
  - .github/workflows/ci.yml
behavior_unverified: 0
overrides_applied: 1
overrides:
  - truth: "SC-1: every owner read lacking api_key_id fails to compile"
    decision: "Founder 2026-11-27, 'Accept as narrowed': SC-1 / DBACC-04 is met by tsc assignability for public-typed rows plus the blocking owner-read source-scan pin for cast-typed owner reads. Recorded in CONTEXT, ROADMAP and REQUIREMENTS (commit 94089f90b). TODOS 170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD repointed at the shared-table remainder."
human_verification_resolved:
  - test: "PR-head e2e-seeded log check"
    result: "PR #1391 head 29cd0d26: e2e-seeded 310 passed / 9 skipped vs main's 306 / 9 on the same base, so the 4 discovery-watchlist tests passed with none skipped. Merged as c0a27ee9 on 2026-11-27."
  - test: "Founder acceptance of SC-1 as narrowed"
    result: "Accepted 2026-11-27 (see overrides)."
---

# Phase 244: ACCESSGUARDS Verification Report

**Phase Goal:** An owner read without its key id fails to compile, every route writes its audit row or carries an exemption, and the watchlist RLS assertions run in CI.
**Verified:** 2026-11-27 at `4c4285659a8a219c7e356dfead7942f8dfa730b7`
**Status:** human_needed
**Re-verification:** No, initial verification (REVIEW rounds 1 and 2 are code-review rounds, not a prior VERIFICATION)

## Commands run at HEAD (verifier's own runs)

| Command | Result |
|---|---|
| `npx tsc --noEmit --incremental false` | exit 0, 0 bytes of output |
| `npx vitest run` on the six named files (compile-guard, owner-read-pin, audit-coverage, discovery-watchlist-e2e-wiring, e2e-seeded-hydration-guard, manager-keys-e2e-wiring) | exit 0, 6 files, 78 tests passed |
| `npm run lint` | exit 0, 0 errors, 4 warnings (unused vars in `src/lib/queries.stale-analytics-detail.test.ts` etc., not a phase file); planning-hygiene rules OK |
| Independent neuter (verifier): delete the flag-monitor increment-upsert `@audit-skip` lines (`route.ts:499-500`), rerun `audit-coverage.test.ts` | RED: `Found 1 uninstrumented mutation(s) NOT in the H-0001 allowlist: src/app/api/cron/flag-monitor/route.ts:499` (1 failed, 27 passed). Restored from byte backup, `cmp=0`, `git status` clean for the file, rerun 28 passed |

Not run by the verifier: the Playwright spec, the type-level neuter of `types.ts` (tsc ~3 min), the RLS and proxy neuters. These rely on the verbatim records in 244-01/03-SUMMARY and 244-REVIEW fix notes; the spec and the PR-head log are routed to human/ship (below).

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | An owner-surface read that lacks `api_key_id` fails to compile, shown by a type-level test (DBACC-04) | ✓ VERIFIED as NARROWED (founder acceptance requested, see below) | `Strategy.api_key_id: string \| null` required (`src/lib/types.ts:162`); `PublicStrategy = Omit<Strategy,"api_key_id">` (`:234`); `src/__tests__/api-key-id-compile-guard.test.ts` ARM-1..4 `@ts-expect-error` + ARM-OWNER/ARM-OWNER-READ under tsc (exit 0 at HEAD); `api-key-id-owner-read-pin.test.ts` (6 tests, passing) |
| 2 | Each of the six routes writes an audit row or carries a recorded founder exemption; the exact-set allowlist only shrinks (DBACC-05) | ✓ VERIFIED | `H_0001_UNCOVERED_ALLOWLIST = []` (`audit-coverage.test.ts:1718-1722`), `toHaveLength(0)` (`:1857`); in-window `@audit-skip` at partner-import `:703-706` (moved above the profiles upsert at `:707`, rolled up into `admin.partner_import`), founder-exemption pragmas at flag-monitor `:499,:640`, keys/sync `:593`, finalize-wizard `:2539,:2686`; route diffs are comment-only (per 244-02-SUMMARY, diff stat 4+2+4+8 lines); gate green; verifier's own neuter reds the gate naming file:line |
| 3 | The `discovery-watchlist` RLS and auth assertions run in a CI job, and a neutered policy turns that job red (DBACC-06) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Wired and pinned: spec in the `e2e-seeded` `else` list (`ci.yml:7166`), census `SEEDED_SPEC_COUNT = 27`, wiring pin 9 arms pass; `e2e-seeded` is in the `frontend` aggregator `needs` (review: `ci.yml:3819`); spec has 4 tests. The spec's execution and the RLS neuter RED are lane records only (244-03: 4 passed, none skipped; policy `USING (true)` neuter reds "RLS LEAK on migration 024 policy"; restored, snapshot `cmp=0`). Not re-executed here |
| 4 | PROOF-01: each gate RED on a neutered copy with its named arm first, restored from byte backup, GREEN, recorded verbatim in plan SUMMARY | ✓ VERIFIED | 244-01 (types.ts optional: TS2578 on ARM-1 first, `cmp=0`, tsc 0), 244-02 (N1 pragma removed, N2 block moved out: each 1 failed 27 passed naming the file, `cmp=0`), 244-03 (RLS neuter, proxy neuter, `cmp=0`), 244-04 (W1-W3 each RED by arm, `cmp=0`), review fix rounds 1-2 (per-neuter REDs, `cmp` clean). Spot-confirmed by the verifier's own audit-gate neuter above |

**Score:** 3/4 verified (SC-1 counted verified as narrowed, subject to founder ruling), 1 present-but-behavior-unverified (SC-3 execution in CI).

### SC-1 ruling: met as NARROWED, not met as written

Stated plainly: SC-1 and DBACC-04 say "an owner-surface read that lacks `api_key_id` fails to compile". That is literally true only for **values already typed as public rows**: `const a: Strategy = pub` (ARM-1), the tearsheet reader row (ARM-2), `pub.api_key_id` (ARM-3) and a category row (ARM-4) all fail to compile, and a regression that makes the key optional again or makes a public reader return `Strategy` flips the directives into `Unused '@ts-expect-error'`, which fails `tsc --noEmit` (the `frontend-typecheck` job, in the aggregator `needs`).

It is **not** true for owner reads typed by a cast. `getMyStrategies` (`select("*, strategy_analytics (*)")` cast `as unknown as {...}[]`, then `as unknown as Strategy` in `shapeRankingRows`), the `/strategies` `ownerList` read, `[id]/edit` (`.single<Strategy & {...}>()`) and `/compare` take their row type from the cast, so changing the select to `STRATEGY_PUBLIC_COLUMNS` leaves tsc green (fix-round NEUTER A: `tsc` exit 0, no output). ARM-OWNER-READ is derived from `getMyStrategies`' declared return type, so it can only go red if that annotation changes, never because the read lost its key.

That hole is closed by a different mechanism, not by the compiler: `src/__tests__/api-key-id-owner-read-pin.test.ts` enumerates exactly those four owner reads, requires each `.from("strategies")` to chain directly to a literal `.select(...)` that starts with `*` or names `api_key_id` (a bare identifier or helper call fails: "no literal .select(...) chained to .from(\"strategies\")"), and a census arm pins the per-file count of owner-type cast tokens so a new cast site reds until enrolled. It was seen RED on three byte-backed neuters plus the SFH2-M1 neuter and restored (`cmp` clean). It runs in the blocking vitest shards.

Residual limits (recorded, not hidden): (1) the pin is a source scan — a read typed by an idiom `CAST_RE` does not name (`.maybeSingle<Strategy>()`, `.returns<…>()`, `as Array<Strategy>`; review IN-09) or a select assembled elsewhere escapes it; (2) `StrategyTable`/`StrategyGrid` type their row `PublicStrategy & { api_key_id?: string | null }`, so the key is optional again inside the shared component at the `(s.trust_tier === "api_verified" || s.api_key_id)` truth-test; the only owner mount (`StrategiesSection`) takes `RankedStrategyRow[]` with the key required, so the exposure needs a future mount that bypasses it (review: LOW); (3) a structurally typed local helper (`shapeOf`) is invisible to both guards.

**Judgment:** the goal's *intent* (a public projection cannot silently masquerade as an owner row, and an owner read dropping the key is caught before merge) is achieved by two mechanisms; the roadmap's *wording* ("fails to compile") is narrowed. I treat this as **met-as-narrowed**, not an open gap, because the review ruling and the evidence agree that the full wording cannot be delivered by tsc over `as unknown as` casts without restructuring the owner readers, which was out of scope. But the SC text is the contract, so it needs the founder to accept the narrowing (human item 2), and the TODOS entry `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD` must be **re-pointed at the shared-table remainder at ship, not deleted** (review IN-03 / round-2 verdict).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/lib/types.ts` | required `Strategy.api_key_id`, `PublicStrategy` | ✓ VERIFIED | `:162`, `:234` |
| `src/lib/queries.ts` | public readers return key-free types | ✓ VERIFIED | in diff, tsc 0; `getFactsheetDetail`/`getStrategiesByCategory` types consumed by ARM-2/ARM-4 |
| `src/__tests__/api-key-id-compile-guard.test.ts` | type-level guard | ✓ VERIFIED | 75 lines, ARM-1..4 + OWNER arms; vitest 1 passed, tsc 0 |
| `src/__tests__/api-key-id-owner-read-pin.test.ts` | owner-read select pin | ✓ VERIFIED | 171 lines, 6 tests pass |
| `src/__tests__/audit-coverage.test.ts` | allowlist empty, length 0 | ✓ VERIFIED | 28 pass |
| Route pragmas (4 files) | in-window exemptions | ✓ VERIFIED | grep confirms 6 sites; flag-monitor neuter reds |
| `e2e/discovery-watchlist.spec.ts` | 4 tests, no `if (anonKey)` skip, 307 arm | ✓ VERIFIED (static) | 4 `test(` blocks; pins verify shape |
| `.github/workflows/ci.yml` | spec in seeded else-list | ✓ VERIFIED | `:7166`, dated place-1/place-2 note below |
| `src/__tests__/discovery-watchlist-e2e-wiring.test.ts` | wiring pin | ✓ VERIFIED | 234 lines, 9 arms pass |
| `src/__tests__/e2e-seeded-hydration-guard.test.ts` | census 27 | ✓ VERIFIED | `SEEDED_SPEC_COUNT = 27`, 30+ tests pass |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `ci.yml` seeded `else` list | `e2e/discovery-watchlist.spec.ts` | listed path (place 1) + `HAS_SEED_ENV` skip (place 2, pinned to exactly the two lane-exported env names) | WIRED |
| `e2e-seeded` job | `frontend` aggregator | `needs` (review cites `ci.yml:3819`; not re-read line-by-line by the verifier beyond grep of `e2e-seeded` mentions) | WIRED per review |
| `frontend-typecheck` | `tsc --noEmit` including `src/__tests__` | `npm run typecheck`, in aggregator `needs` (review) | WIRED per review |
| owner reads | `api_key_id` | owner-read pin (blocking vitest) | WIRED |
| partner-import `profiles` upsert | `admin.partner_import` roll-up | `@audit-skip` in window + `emitAsUser` roll-up | WIRED (review confirmed `managers_created` reaches the roll-up on success and catch paths) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Audit gate can fail | remove one pragma, run `audit-coverage.test.ts` | RED naming `flag-monitor/route.ts:499`; restore `cmp=0`; GREEN 28 | ✓ PASS |
| Phase test files green | six-file vitest | 78 passed | ✓ PASS |
| Type guard compiles | tsc | exit 0 | ✓ PASS |
| Spec runs on lane, RLS neuter reds | Playwright | not runnable | ? SKIP (human) |

### Requirements Coverage

| Requirement | Plan | Description | Status | Evidence |
|---|---|---|---|---|
| DBACC-04 | 244-01 | owner read lacking `api_key_id` fails to compile | ✓ SATISFIED AS NARROWED | see SC-1 ruling; founder acceptance requested |
| DBACC-05 | 244-02 | six routes audit row or recorded founder exemption; allowlist only shrinks | ✓ SATISFIED | allowlist 6 to 0, pragmas, founder decision recorded in 244-CONTEXT |
| DBACC-06 | 244-03, 244-04 | watchlist RLS/auth assertions run in CI and can fail | ✓ SATISFIED statically, execution awaiting PR-head log | wiring verified; lane record 4/4 |

No orphaned requirements: REQUIREMENTS.md maps only DBACC-04/05/06 to Phase 244 and all three appear in plans. (REQUIREMENTS.md still shows `Pending`; ticking is the ship/close step.)

### Anti-Patterns Found

No unreferenced TBD/FIXME/XXX markers introduced in the phase diff (route diffs are comment-only pragmas). Open LOW/INFO findings are recorded in 244-REVIEW (IN-01, IN-02, IN-04..IN-12) and by rule are not booked in TODOS.md. Review round-2 status returned to `issues_found` for SFH2-M1/SFH2-M2, which the fix round (`1cb0e4673`) closed with recorded neuters; the final notes commit is HEAD, and no re-review of `1cb0e4673` is recorded beyond the fixer's own PROOF-01 (the verifier re-ran those pins green; see Gaps Summary caveat).

### Human Verification Required

1. **PR-head e2e-seeded log check.** Test: on the PR head SHA read the `e2e-seeded` job log (`gh run view --job <id> --log | grep -a discovery-watchlist`). Expected: 4 discovery-watchlist tests passed, none skipped. Why human: the spec runs only on the local-stack lane / CI; ship gate per 244-04-SUMMARY.
2. **Founder acceptance of SC-1 narrowing.** Expected: accept met-as-narrowed (assignability + blocking select pin), or rule it a gap. If accepted, add an `overrides:` entry here (accepted_by/accepted_at) and re-point TODOS `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD` at the shared-table remainder at ship.

### Ship-step reminders (not gaps)

- TODOS entries to delete in the ship PR and name in the CHANGELOG: `[H-0001]` and the `[158-OPS-03] discovery-watchlist.spec.ts` bullet. `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD` is **re-pointed, not deleted**, if SC-1 is accepted as narrowed. All three still exist on the branch today (TODOS.md:1781, :3126, :3990), and the `audit-coverage.test.ts` lineage comment already says the H-0001 entry was deleted, so the ship PR must make that true.
- `244-SECURITY.md` is untracked in the worktree (not verified here).
- The `e2e-seeded` merge-time CI is the first place the spec runs outside the founder's lane; the 244-VALIDATION.md frontmatter still reads `status: draft`, `wave_0_complete: false` (stale bookkeeping, not a goal item).

## Gaps Summary

No FAILED must-haves and no blocker anti-patterns. DBACC-05 is fully verified (allowlist empty, six dispositions in code, gate proven able to fail by an independent neuter). DBACC-04 is delivered in narrowed form and disclosed honestly in the guard's own header; the wording gap versus SC-1 is a decision for the founder, not a code defect. DBACC-06 is wired, pinned and lane-proven per records, but the verifier could not execute the spec, so the final proof is the PR-head `e2e-seeded` log. Caveat: the round-2 fixer commit `1cb0e4673` had no independent reviewer re-read; the verifier confirmed only that its pins pass at HEAD (78 tests green, tsc 0, lint 0).

---

_Verified: 2026-11-27T12:40:00Z_
_Verifier: Claude (gsd-verifier)_
