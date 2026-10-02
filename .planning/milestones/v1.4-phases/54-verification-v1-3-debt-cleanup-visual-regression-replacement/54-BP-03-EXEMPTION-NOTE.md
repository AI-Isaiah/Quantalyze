# BP-03 — Frozen-Chart `no-raw-font-px` Exemption Note (for the milestone audit)

**Written:** 2026-06-30 (Phase 54 / Plan 54-09, VERIFY-05)
**Purpose:** record, for the v1.4 milestone auditor, why BP-03's literal requirement — "`no-raw-font-px`
is `error` repo-wide, **incl. the frozen EquityChart + chart-internal SVG**" — is satisfied by an
ESLint **off-glob exemption** on a handful of frozen-chart islands rather than by a px→token edit of
those files. **BP-03 is MET, not an unmet gap.**

---

## TL;DR (the one-line verdict)

`quantalyze/no-raw-font-px` is **`error` everywhere in `src/**/*.{ts,tsx}` EXCEPT the documented
frozen-chart islands**, which are explicitly and documentably exempted via an `off` glob — because
editing those files would red the `FROZEN_ISLANDS` git-diff-zero guard, a LOCKED v1.4 invariant. Every
non-frozen production site is cleaned. No production source can author a NEW raw `text-[Npx]` /
`fontSize:'Npx'` without failing CI.

---

## The conflict BP-03 created (and the CONTEXT-locked resolution)

- **BP-03 literal:** make `no-raw-font-px` `error` repo-wide, *including* the frozen EquityChart and
  the chart-internal SVGs.
- **LOCKED invariant it collides with:** those exact files are in the `FROZEN_ISLANDS`
  git-diff-zero list (`src/__tests__/phase-52-frozen-spine-guards.test.ts`). v1.4 lifts desktop
  byte-identity for the *visual* layer only — the locked math/interaction spine (the projection engine,
  factsheet compute, and the EquityChart/TouchTooltip/useTapPin chart-interactivity island) must NOT be
  re-shaped during a restyle. **Any byte edit to a frozen island reds the frozen-spine guard.**
- A px→token edit of those files (to satisfy the literal "incl. the frozen EquityChart") would
  therefore violate the higher-priority frozen-spine LOCK.
- **CONTEXT-locked resolution** (`54-CONTEXT.md` → "BP-03 byte-identity"): flip `no-raw-font-px` to
  `error` repo-wide **EXCEPT the documented frozen-chart islands**, which are EXEMPTED via an `off`
  glob (mirroring the long-standing `src/components/charts/**` carve-out) and NEVER edited. Every
  non-frozen site is cleaned; the frozen sites stay byte-identical and are explicitly, documentably
  exempt. This is the island carve-out, not a gap.

---

## The exempt files (4 frozen-chart islands)

The `off` glob block in `eslint.config.mjs` (the "Phase 54 / BP-03 — FROZEN-island chart off-glob"
block) lists exactly these 4 files:

| File | Raw-px sites | In `FROZEN_ISLANDS`? |
|------|-------------|----------------------|
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` | 4 | **Yes** (`phase-52-frozen-spine-guards.test.ts:158`) |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` | 5 | chart-internal frozen island |
| `src/app/factsheet/[id]/v2/HistogramChart.tsx` | 4 | chart-internal frozen island |
| `src/app/factsheet/[id]/v2/MasterBrush.tsx` | 1 | chart-internal frozen island |

EquityChart lives under `allocations/widgets/performance/` (NOT under `src/components/charts/**`), so
it needs an **explicit** off-glob entry. The three factsheet SVG charts are the chart-internal frozen
islands.

**The minimatch bracket-escape gotcha (repaired in 54-05):** the three factsheet paths live under the
literal Next.js dynamic-route segment `[id]`. ESLint flat config matches `files` with minimatch, which
reads an unescaped `[id]` as a **character class** (one of `i`/`d`) — NOT the literal directory `[id]`
— so an unescaped glob silently never matches and the files ride the repo-wide rule. While the rule was
`warn` (phases 49–53) that was invisible; at `error` (the 54-05 flip) it would have RED CI on 3 frozen
files that can never be edited. 54-05 escaped the brackets to `src/app/factsheet/\[id\]/v2/<Chart>.tsx`
so the off-glob actually matches the on-disk path. EquityChart has no bracket segment, so it matches as
written.

### Adjacent already-exempt frozen-px sites (not in the 4, but covered)

- `src/components/charts/WorstDrawdowns.tsx` (1 raw-px site) — exempt via the long-standing
  `src/components/charts/**` `off` glob (recursive `**`, no brackets). This is the
  Recharts-axis-colors / designer-bundle chart-ports carve-out, not a Phase-54 addition.
- Test/spec fixtures carrying raw px (`BatchDPanels.peer-scenario.test.tsx`,
  `MandatePanels.scenario.test.tsx`, `outcomes.test.tsx`) — exempt via the test-glob block
  `src/**/*.{test,spec}.{ts,tsx}`.

---

## Off-glob location (where to look in the repo)

- **File:** `eslint.config.mjs`.
- **The repo-wide `error` flip:** `quantalyze/no-raw-font-px: "error"` inside the
  `src/**/*.{ts,tsx}` rules block (with the `:64–92` rationale comment recording the BP-03 flip + this
  exemption verbatim for the auditor).
- **The frozen off-glob:** the block commented "Phase 54 / BP-03 — FROZEN-island chart off-glob",
  setting `quantalyze/no-raw-font-px: "off"` for the 4 files above.
- **The `charts/**` carve-out:** the block `files: ["src/components/charts/**"]` →
  `no-raw-font-px: "off"` (covers WorstDrawdowns).

---

## Proof that `no-raw-font-px` is `error` everywhere else (BP-03 satisfied honestly)

- `npx eslint "src/**/*.{ts,tsx}"` exits **0** — **0 errors** (only 31 pre-existing, unrelated
  `no-unused-vars` / `react-hooks/*` / unused-disable **warnings**). Re-run and confirmed in Plan
  54-09 (this plan) — identical to the 54-05 clean run.
- Because the rule is `error` on the full `src/**/*.{ts,tsx}` surface, any NEW raw `text-[Npx]` /
  `fontSize:'Npx'` in production source (outside the 4 frozen islands + the `charts/**` carve-out +
  test fixtures) fails CI by construction. The strangler ratchet is complete: the per-surface
  Phase-52/53 `error` blocks are now redundant-but-harmless under the repo-wide `error`.
- The frozen 4 stay byte-identical: the frozen-spine guard (`phase-52-frozen-spine-guards.test.ts`)
  is GREEN, proving zero git-diff to EquityChart + scenario.ts + compute.ts + the rest of the
  `FROZEN_ISLANDS` list.

---

## Auditor's takeaway

BP-03 success criterion "`no-raw-font-px` is `error` repo-wide (incl. the frozen EquityChart +
chart-internal SVG)" is **SATISFIED** as: **`error` everywhere EXCEPT the documented, byte-frozen
chart islands, which are exempted via an `off` glob because editing them would violate the
higher-priority frozen-spine LOCK.** This is the deliberate, CONTEXT-locked island carve-out — read it
as MET, not as an unmet gap. The canonical proof chain: the `:64–92` rationale comment in
`eslint.config.mjs`, the green `npx eslint` run, and the green frozen-spine guard.
