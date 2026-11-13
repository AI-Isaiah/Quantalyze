---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 16
subsystem: factsheet-json-ld, factsheet-batch-d-panels
tags: [trust-05, d-04, d-11, d-13, d-15, json-ld, cache-key]

requires:
  - phase: 194-03
    provides: gateAnnualized, gateDelta, recordClears, shorterSpan, widened copy
  - phase: 194-04
    provides: payload.figureRecord
  - phase: 194-14
    provides: OwnBookDeltaPayload.span_days / .records (types)
provides:
  - "buildFactsheetJsonLd(payload): interestRate follows gateAnnualized(payload.figureRecord)"
  - "factsheet payload cache key factsheet-v2-payload-v21"
  - "style-drift-figure-gate-note, own-book-delta-note, peer <1y marker"
affects: [194-17, 194-08]

actuals:
  tokens: 21000
  tasks: 3
  commits: 2

commits: 2
plan_head_before: 073c404ad2936d35272665b2b0c670adf7518fd0
plan_head_after: 12148707f4fd64b7308e5bfd3db9ce2e63005062

key-files:
  created:
    - src/lib/factsheet/json-ld.ts
    - src/lib/factsheet/json-ld.test.ts
    - src/app/factsheet/[id]/v2/BatchDPanels.d11.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.tsx
    - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
    - src/lib/factsheet/fetch-and-build-payload.ts

key-decisions:
  - "JSON-LD: withheld omits interestRate; a cleared record under one year publishes a schema.org QuantitativeValue whose description is shortTrackNote(\"record\", days); full, unknown or absent record keeps the plain number (today's behaviour)."
  - "One cache bump v20 to v21, with a dated comment naming plans 04, 14, 21 and 23."
  - "A-194-D13-03: the Style Drift thin-half sentence is muted (text-text-muted, italic as its neighbouring caption), no glyph, no warning colour; words and trigger (n below 126) unchanged."
  - "OwnBookDeltaPanel: when both records fail, the withheld line names the one with the shorter span."

status: complete
---

# Phase 194 Plan 16: JSON-LD CAGR, Batch D panels and the v21 cache key Summary

**The factsheet's machine-readable CAGR now follows the same record verdict a reader sees, the three Batch D panels (Style Drift, Peer Percentile, vs Your Book) withhold on the total record and only qualify on the window (D-04 and D-11 as superseded by D-15), and the public payload cache moves one version for the whole phase.**

## What was built

- **`buildFactsheetJsonLd`** (`src/lib/factsheet/json-ld.ts`, pure). Same object as before for every key but `interestRate`. Withheld record: key omitted. Short (cleared, under 365 days): `{ "@type": "QuantitativeValue", value: cagr, description: shortTrackNote("record", spanDays) }`. Full, unknown span or absent record: the plain CAGR. The existing finite-and-`ingestSource === "api"` condition is kept. `page.tsx` calls the builder and keeps the `</` escaping in `jsonLdStr`.
- **Cache key** `factsheet-v2-payload-v20` to `v21`, with a dated comment for plans 04, 14, 21, 23.
- **StyleDriftPanel**: one verdict, `gateAnnualized(figureRecord, shorterSpan(spanDays(h1), spanDays(h2)))`. Withheld: Sharpe, Sortino and Ann. Volatility print an untoned dash in both halves and in the delta; Skew, Kurtosis, Max Drawdown and Win % never change. One muted line `style-drift-figure-gate-note`: `widenedWithheldReason("half", record)` or `widenedShortNote("half", <shorter half>)`. Thin-half sentence restyled per D-13 (A-194-D13-03).
- **PeerPercentilePanel**: `gateAnnualized(figureRecord)`; short blend puts the plan-06 `<1y` marker (title and sr-only `shortTrackMarkerTitle(days)`) after the Sharpe and Sortino labels; Max DD gets none; a withheld blend (backstop) reads as no rank on Sharpe and Sortino.
- **OwnBookDeltaPanel**: `gateDelta(records.blend, records.book, span_days)` gates the Sharpe and Sortino deltas through `gatedValue`; `own-book-delta-note` carries `widenedWithheldReason("delta", <failing record>)` or `widenedShortNote("delta", span_days)`. Absent `records` is the null state: deltas as before, no note. Max DD delta untouched.

## Neuter, RED, restore (byte backups via `cp -p`, `cmp` clean after each)

Task 1 (`json-ld.test.ts`): withheld branch dropped: `AssertionError: expected true to be false` (crypto 60-day case) and `AssertionError: expected 0.4321 to be undefined` (59-observation case); 2 of 6 RED.

Task 2 (`BatchDPanels.d11.test.tsx`):
1. Each half gated on its own span alone (superseded reading, `shorterHalf < 90`): `AssertionError: Sharpe: expected '—' not to be '—'` (3 cases RED, including the 60/200 case).
2. Note built from the longer half: `AssertionError: expected 'Half-record figures are annualized fr…' to be 'Half-record figures are annualized fr…'` (3 cases RED, including the 60/200 note).

Task 3:
1. Delta gate skipped (`deltaState` fixed to `"null"`): `AssertionError: Sharpe: expected '+0.24' to be '—'` (4 cases RED, including the crypto 60-day case).
2. Superseded 90-day `span_days` rule on the Sharpe value: `AssertionError: expected '—' to be '+0.24'` (the cleared, 60-day short case RED). An earlier variant of this neuter that forced the whole state to `withheld` also went RED, with `TypeError: Reduce of empty array with no initial value`, because it produced a withheld state with no failing record; that state is unreachable from `gateDelta`.

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2" "src/app/factsheet-share" "src/app/(dashboard)/allocations" --testTimeout=60000`: 271 files, 4179 tests passed.
- `src/__tests__/phase-148-owner-lane-cache-isolation`, `display-sign-single-source`, `critical-regressions`: 226 passed.
- `npm run typecheck`: clean. eslint on the five touched source and test files: clean.
- Plan greps: `buildFactsheetJsonLd(` present in `page.tsx`, `"factsheet-v2-payload-v20"` absent from it, `data-testid="style-drift-figure-gate-note"` and `data-testid="own-book-delta-note"` present in `BatchDPanels.tsx`.
- Tracer gate (Task 1): the verify command re-run end to end after the neuter was restored, green, before the Batch D tasks started.

## Deviations from Plan

**1. [Rule 3 - Blocking] The v20 key was pinned in two more places than `files_modified` lists.** `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` holds `EXPECTED_KEY_PREFIX = "factsheet-v2-payload-v20"` (typed by hand on purpose, an oracle independent of the page) and would have gone red on the bump; updated to v21. A doc comment in `src/lib/factsheet/fetch-and-build-payload.ts` quoting the keyParts was updated to match. No other behaviour changed in either file.

**2. [Process] Tasks 2 and 3 are one commit.** Both edit only `BatchDPanels.tsx` and its one test file, and were developed together; splitting hunks of the same two files into two commits would have needed partial staging for no verification gain. Commit `12148707f` covers both, with each task's neuter pair recorded separately above. Task 1 is its own commit.

**3. [Plan] `BatchDPanels.d11.test.tsx` did not exist** (the plan's Task 2 read_first says to look for the nearest BatchD test). It is created here, using the harness of `BatchDPanels.ownbook.test.tsx`.

**4. [Decision, within the plan] Both-records-failing delta reason.** The plan says "the shorter when both fail" without naming the measure; the code compares `spanDays` (null counted as 0), and a test pins the case.

No Co-Authored-By, Claude-Session or "Generated with" trailers on any commit (project rule overrides the harness attribution reminder).

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. T-194-31 (JSON-LD withheld/short) and T-194-32 (cache key) are mitigated as the plan's register describes; no endpoint, auth path or schema was added.

## Self-Check: PASSED

Created files exist (`json-ld.ts`, `json-ld.test.ts`, `BatchDPanels.d11.test.tsx`, this SUMMARY); commits `7b232893f` and `12148707f` are ancestors of HEAD.
