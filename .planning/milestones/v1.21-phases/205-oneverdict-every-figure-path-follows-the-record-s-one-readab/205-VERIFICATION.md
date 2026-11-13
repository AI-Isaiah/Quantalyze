---
phase: 205-oneverdict-every-figure-path-follows-the-record-s-one-readab
verified: 2026-11-10T21:00:00Z
status: passed
score: 4/4 must-haves verified
verified_at_sha: 8fd26b026a4400ac9ada2914bab118f326f0ca3a
drift_subjects:
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
behavior_unverified: 0
overrides_applied: 0
---

# Phase 205: ONEVERDICT Verification Report

**Phase Goal:** The stress-windows block, the api-arm allocator blends and the USD view each follow the record's one readability verdict (`totalRecord.unreadable`) instead of testing dates themselves, so an unreadable record is withheld the same way on every path and an unparseable first date never reaches an error page.
**Verified:** 2026-11-10 at `8fd26b026` (branch `feat/205-oneverdict`)
**Status:** passed
**Re-verification:** No, initial verification

The completion rule in CLAUDE.md is followed: `covered_files` and `covered_digest` are not written; `verified_at_sha` and `drift_subjects` are.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D-01: the USD view's record verdict equals the native verdict by construction; `recordSourceDates` is gone; one Sentry report per record | VERIFIED | `grep recordSourceDates src` has 0 hits in code. `fetch-and-build-payload.ts:1075` threads `nativeUnreadable: nativePayload.figureRecord?.unreadable === true`, and `:1168` passes `inheritedUnreadable: true`. `build-payload.ts:968-969` ORs it into `totalRecord`. The Sentry report at `:976` is gated on `!opts?.inheritedUnreadable` and on the build's own scan, so an inherited verdict is reported once, by the native build (WR-01 / `cfe54acd3`). |
| 2 | D-02: `stressWindows` is the withheld form on every bundle (cash, MTM, smoothed), the leverage re-derive and the USD view whenever the record is unreadable | VERIFIED | `deriveSeriesBundle` (`build-payload.ts:663-666`) tests `args.figureRecord?.unreadable === true` first. All three bundle calls pass `figureRecord: totalRecord` (`:1010, :1035, :1060`). The browser re-derive passes `view.figureRecord` (`basis-context.tsx:257-290`). The `dates[0]` guard stays only to keep `computeStressWindows` from throwing when the record is `null`. The only other `computeStressWindows` caller, the Scenario factsheet payload, follows its own `record.unreadable` (`scenario-factsheet-payload.ts:483-488`, WR-02 / `1baa4c9b0`). |
| 3 | D-03: on an unreadable record the api arm returns `allocatorPortfolios: null`, so no error page. The five bad first dates (`""`, `2023-13-01`, `2023-02-32`, `2024-1-5`, `2024-02-30`) build without throwing. | VERIFIED | `build-payload.ts:1228` is `totalRecord.unreadable ? null : [...]`. `alignBlend` / `isoDayBefore` (`allocator.ts:112, :170`) are reached only through that array literal. `isReadableDay` is stricter than `Date.parse`, so a readable record cannot throw there. No code outside the type and the builder reads `allocatorPortfolios`, so null does not trigger any false "no data" text. The `D-03` test cases pass for all five dates, and the fetch path resolves a withheld payload for `"2024-01-1"`, with and without a BTC native unit. |
| 4 | D-05: payload cache key `factsheet-v2-payload-v22` becomes `v23`, with a dated comment | VERIFIED | `v2/page.tsx:284-285` carries the v23 key and the "Bumped v22→v23" comment. `page.public-cache-key.test.tsx` and `page.cache-isolation.test.tsx` were updated and pass. Phase files contain no stale `v22` key (only the historical "Bumped v21→v22" comment). |

**Score:** 4/4 truths verified, 0 behavior-unverified.

Readable records stay byte-identical: the phase diff does not touch `src/lib/factsheet/__snapshots__/build-payload.test.ts.snap`, and `build-payload.test.ts` passes against it.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/factsheet/build-payload.ts` | VERIFIED | `inheritedUnreadable` opt, stress predicate, blend gate, Sentry gate. Wired through the three bundle calls. |
| `src/lib/factsheet/fetch-and-build-payload.ts` | VERIFIED | `buildUsdView` takes `nativeUnreadable` and passes it on. The single caller supplies it. |
| `src/app/factsheet/[id]/v2/page.tsx` | VERIFIED | v23 key. |
| `scenario-factsheet-payload.ts` | VERIFIED | The stress block follows `record.unreadable`. |

### Key Link Verification

| From | To | Status |
|------|----|--------|
| native `figureRecord.unreadable` | `buildUsdView` | WIRED (`fetch-and-build-payload.ts:1075 -> :1168`) |
| `totalRecord` | all three bundle `figureRecord` args | WIRED |
| `view.figureRecord` | leverage and window re-derive (`rederiveArgs`) | WIRED |
| `totalRecord.unreadable` | `allocatorPortfolios` | WIRED |

### Data-Flow Trace (Level 4)

The verdict is computed from the real series dates by `firstUnreadableDate` and `figureRecord`. It is not a static value, and the USD view takes the native build's computed value. FLOWING.

### Behavioral Spot-Checks

| Behavior | Command | Result |
|----------|---------|--------|
| Types | `npx tsc --noEmit` | exit 0 |
| Phase test files (9 files) | `npx vitest run <the nine named files>` | 9 files, 347/347 pass |
| D-03 gate bites | Neutered the blend gate (byte backup, restored, `cmp` identical) | 7 tests RED |
| D-02 gate bites | Neutered the `figureRecord?.unreadable` stress predicate | 5 tests RED |
| D-01 gate bites | Neutered the `inheritedUnreadable` OR | 6 tests RED |

The working tree is clean after the probes. The known pre-existing `compute.conventions.test.ts` fixtures B and C were not run (outside the allowed set) and do not touch this phase.

### Probe Execution

None declared by the phase. Step 7c does not apply.

### Requirements Coverage

ROADMAP lists `Requirements: TBD` and no PLAN claims a requirement id, so there is nothing orphaned or unmet.

### Anti-Patterns Found

None in the changed lines: no TBD, FIXME or XXX markers, no stub returns. The one `null` is the intended withheld form.

### Review Status

`205-REVIEW.md` (round 1) raised WR-01 and WR-02. Both were fixed in `cfe54acd3` and `1baa4c9b0`. `205-REVIEW-R2.md` is clean (0 findings). Both fixes were re-verified here against the code and the tests above.

### Human Verification Required

None. The phase changes no rendered copy or layout. The stress panel's existing sentence was reused (D-02), and nothing renders `allocatorPortfolios`.

### Notes (not gaps)

- `VERSION` and `CHANGELOG.md` are not in the phase diff. That belongs to the ship step (CLAUDE.md "CHANGELOG discipline"), not to the phase goal.
- D-01's clause "the USD build's own scan still reports" is narrowed: when the verdict is inherited, the USD build sends nothing. The review accepted this and gave the reasoning: the USD dates are a subset of the native dates, so the USD scan cannot find a bad date the native build missed.

### Gaps Summary

No gaps. All three paths (USD view, stress block, api-arm blends) follow `totalRecord.unreadable`. An unparseable first date yields a withheld payload, not a throw. The neuter probes confirm each gate fails when its fix is removed.

---

_Verified: 2026-11-10_
_Verifier: Claude (gsd-verifier)_
