---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 01
subsystem: ui
tags: [glossary, tooltip, term, react, accessibility, copy-registry]
status: complete

requires:
  - phase: 197
    provides: DISCOVERY_COLUMNS tooltips and the Tooltip primitive this plan moves into a registry
provides:
  - "GLOSSARY, TermKey, TermContext, termDefinition, termLabel, FULL_RECORD_BASIS (src/lib/glossary.ts)"
  - "Term (Form A focusable trigger) and PlainTerms (print switch) in src/components/ui/Term.tsx"
  - "Tooltip opt-in function child that hands aria-describedby to a focusable element"
affects: [201-06, 201-08, 201-09, 201-13, 201-16, 201-22, 201-27]

actuals:
  tokens: 8500
  tasks: 3
  commits: 3

plan_head_before: 8dbc36a02d92b8659c4807bd21ec248246a96756
plan_head_after: b765a431393e5dd4ced09c0d026507dc7a5715bd

tech-stack:
  added: []
  patterns:
    - "Closed-union registry: `as const satisfies Record<string, GlossaryEntry>` with `TermKey = keyof typeof GLOSSARY`"
    - "Tooltip function child for a self-focusable trigger; node children keep today's markup byte for byte"
    - "React context print switch (PlainTerms) instead of prop threading"

key-files:
  created:
    - src/lib/glossary.ts
    - src/lib/glossary.test.ts
    - src/components/ui/Term.tsx
    - src/components/ui/Term.test.tsx
  modified:
    - src/components/ui/Tooltip.tsx
    - src/components/ui/Tooltip.test.tsx

key-decisions:
  - "Registry lives in src/lib (outside figure-gate-census walk roots) and imports only SIX_MONTH_WINDOW_DAYS from @/lib/factsheet/compute."
  - "FULL_RECORD_BASIS is copied into the registry and exported; plan 201-16 deletes the private copy in discovery-columns.ts. The glossary test pins the two equal through the full-record tooltips."
  - "Accessibility mechanism: Tooltip children may be a function receiving { aria-describedby }; the inner span then carries no attribute. Wrapper and inner spans, and so DOM depth, are unchanged."
  - "Print switch is a React context (PlainTerms), set by FactsheetView under printView in plan 201-09."
  - "Term passes className=inline to Tooltip so the wrapper is not inline-flex around running label text."

requirements-completed: [CLAR-03]

coverage:
  - id: D1
    description: "One registry of 46 term keys with definitions, aliases and the discovery and last12m contexts"
    requirement: CLAR-03
    verification:
      - kind: unit
        ref: "src/lib/glossary.test.ts"
        status: pass
  - id: D2
    description: "Term opens the registry definition on hover and keyboard focus, describedby on the focusable span, no added text"
    requirement: CLAR-03
    verification:
      - kind: unit
        ref: "src/components/ui/Term.test.tsx"
        status: pass
  - id: D3
    description: "Under PlainTerms a Term is plain text (print view)"
    requirement: CLAR-03
    verification:
      - kind: unit
        ref: "src/components/ui/Term.test.tsx#Term inside PlainTerms (print view)"
        status: pass
  - id: D4
    description: "Screen reader announces the label and then the definition on Term focus"
    requirement: CLAR-03
    verification:
      - kind: manual_procedural
        ref: "VoiceOver on a Term trigger (backstop)"
        status: unknown
---

# Phase 201 Plan 01: Term registry and trigger Summary

One 46-key glossary registry (pure data, closed `TermKey` union, discovery tooltips moved byte-identical) and one `Term` wrapper that opens a definition on hover and keyboard focus through the shared `Tooltip`, plain under the `PlainTerms` print switch.

## What shipped

- **`src/lib/glossary.ts`**: 40 UI-SPEC inventory keys plus the six discovery-only keys (`track`, `return_full`, `return_6m`, `aum`, `return_curve`, `underwater`). Ten `discovery` contexts interpolate `FULL_RECORD_BASIS` and `SIX_MONTH_WINDOW_DAYS` (never resolved to literals); `max_drawdown` carries the `last12m` context. The three optimizer keys take the `METRIC_TOOLTIPS` copy with "portfolio" changed to "allocation"; the `corr_with_allocation` label is "Corr w/ allocation" (U-17, plan 201-13 changes the column label to match).
- **`src/components/ui/Tooltip.tsx`**: `children` may be a function receiving `{ "aria-describedby" }` (the bubble id while open). A node child renders byte for byte as at HEAD. No change to timers, geometry, portal or classes.
- **`src/components/ui/Term.tsx`**: `Term({ k, context, children })` renders `Tooltip className="inline"` around a `span tabIndex=0 data-term` carrying the UI-SPEC Form A classes verbatim and no typography class. `PlainTerms` is a context provider; under it `Term` returns only its label, no element. The docblock states the two forms and the two known limits (no Escape-dismiss, no tap handler; U-04).

## Readings recorded for the founder (D-26, no checkpoint)

- **A-7 `twr`: kept the second clause** ("so money moved in or out does not change the figure"). `scenario.ts` computes `twr = cumulative[n - 1] - 1` over a compounded `portDaily` built from each strategy's stored `daily_returns`; those series are produced by `analytics-service/services/nav_twr.py`, which chain-links `r_t = (NAV_t - NAV_{t-1} - F_t) / NAV_{t-1}` with the external flow in the numerator (Phase 73 flow-aware TWR). So the series is flow-adjusted and the clause holds.
- **A-8 `volatility_matched`: UI-SPEC sentence kept.** `comparator-block.ts` scales the comparator's returns by `stratAnnVol / benchVol` and compounds them; the `volMatched` chart subtitle says the same.
- **A-8 `returns_signature`: the compute wins, sentence rewritten.** The UI-SPEC sentence said "the path of returns ... around each win or loss event". `event-signatures.ts` aggregates the cumulative-from-event path (rebased to 0% at t=0) of the benchmark (BTC by construction, `SIG_BENCH`) and of the strategy's own accumulated capital, over a 14-day window each side, with mean, median, P25/P75 and P5/P95 bands. Shipped: "How BTC and the strategy's own capital moved from 14 days before to 14 days after each win or loss event, rebased to 0% at the event. Shown as the mean, the median and percentile bands." (Under 200 characters, two sentences.)
- **A-6 `recovery_factor`: no threshold printed.** The code carries two: `compute.ts` comments "Allocator threshold: >= 2" at `recoveryFactor`, and `MetricsColumn.tsx` accents the "Recovery Factor" row at `>= 3`. They disagree, so the founder may want to reconcile them.

## Verification evidence

- Baseline for the Tooltip regression check: BASE `8dbc36a02d92b8659c4807bd21ec248246a96756`. `git diff "$BASE" -- src/components/ui/Tooltip.test.tsx` exits 0 and `grep -a -c '^-[^-]'` on it prints 0: only added lines, every pre-existing arm passes unedited.
- `node scripts/verify-plan-anchors.mjs <plan>`: `claims: 10 checked`, `OK`.
- RED before GREEN for Task 1 (glossary, Term and the Tooltip function-child arm failed before the implementation existed). Tasks 2 and 3 tests were written after the implementation they pin, so their RED is shown by the neuter proofs below, not by a pre-implementation run.
- `npx vitest run src/lib/glossary.test.ts src/components/ui/Term.test.tsx src/components/ui/Tooltip.test.tsx`: 48 passed. `src/components/strategy` and `src/components/discovery`: 1189 passed (the two Tooltip consumers and the discovery header tests read the same text).

### Neuter proofs (all restored from `cp -p` byte backups, `cmp` exit 0, GREEN re-run)

- gc-201-01-neuter: gate=glossary.test.ts "sharpe: termDefinition(..., "discovery") equals the column tooltip exactly" result=red restored=identical (the neuter changed the sharpe discovery context's final period to an exclamation mark; the equality arm and the sentence-rules arm both went red, 2 failed of 23)
- gc-201-01-neuter: gate=Term.test.tsx "renders only the plain text: no data-term, no tabindex, no underline class" result=red restored=identical (neuter: removed the `PlainTerms` early return so the span rendered inside it; 2 failed of 11, the second being "with no children renders the registry label, plain")
- gc-201-01-neuter: gate=Term.test.tsx "adds no visible text: the surrounding text reads the same with and without the Term" result=red restored=identical (neuter: appended a visible `*` to the trigger; 8 failed of 11, this arm among them)
- gc-201-01-gates: vitest=green eslint=clean tsc=clean

## Deviations from Plan

None. The plan executed as written. Task 3 added tests only: `Term.tsx` from Task 1 already carried every state and the print switch, so no `Term.tsx` change was needed in Task 3 (the neuter proofs show the arms bite).

## Known Stubs

None.

## Threat Flags

None. `content` stays a string rendered as a React text node (T-201-01); keys are the closed `TermKey` union. No package added, lockfile unchanged (T-201-SC).

## Self-Check: PASSED

- FOUND: src/lib/glossary.ts, src/lib/glossary.test.ts, src/components/ui/Term.tsx, src/components/ui/Term.test.tsx
- FOUND commits: d477f5633, da5f01fd1, b765a4313 (ancestors of HEAD on wt/201-p01)
