# Deferred items found by plan 201.1-14 (out of scope, not fixed)

Measured 2026-11-12 on the local-stack lane (seeded composer, `next dev --webpack`).

## 1. Composer page overflows horizontally by 7px at 320px (KpiStrip nowrap suffix)

- Whole-page reflow walk on the composed scenario at a 320x700 viewport:
  `reflow: main=7 doc=0 scroller=main offender=SPAN.whitespace-nowrap.text-text-muted`.
- The offender is `KpiStrip`'s `<span className="whitespace-nowrap text-text-muted">vs current allocation</span>`
  (Phase 170.1 D-11). The existing N-KPI and N-FOOT sweeps run at 390px and up (the "390px floor"),
  so nothing measured 320px.
- It is present with the footer unchanged (it reproduces on HEAD's footer), so it is not caused by this plan.
- Consequence in this plan: the new N-FOOT narrow test asserts the sticky bar's own bounds at 320px
  instead of the whole-page reflow walk, and runs the whole-page walk at 390 and 768.
- Fix owner: a plan that touches `KpiStrip` (the suffix needs to be allowed to wrap, or the tile needs
  a smaller floor at 320px). It is a design call with its own vitest pins, so it is booked, not patched here.

## 2. `next dev` generates route types that fail `npm run typecheck`

- `.next/dev/types/app/api/allocator/scenario/saved/route.ts`: `Property 'MAX_DRAFT_BODY_BYTES' is incompatible with index signature`.
  `src/app/api/allocator/scenario/saved/route.ts` exports a non-route constant (`MAX_DRAFT_BODY_BYTES`).
- `tsconfig.json` includes `.next/dev/types/**/*.ts`, so any checkout that has run `next dev` fails
  `tsc --noEmit` on that file. CI typechecks a tree that never ran `next dev`.
- Out of scope; `.next` is gitignored. Typecheck for this plan was run with the generated dev types set aside.
