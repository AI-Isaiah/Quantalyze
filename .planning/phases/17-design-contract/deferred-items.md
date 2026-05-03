# Phase 17 Deferred Items

Out-of-scope discoveries logged during plan execution. Per Rule 4 deviation
scope-boundary, items here are NOT auto-fixed by the executor — they belong
to a separate plan or pre-existing tech-debt backlog.

## Pre-existing TypeScript error in `src/app/api/debug-key-flow/route.ts:257`

Flagged independently by Plans 17-01, 17-03, 17-04, and 17-05 during
their respective verification passes.

```
src/app/api/debug-key-flow/route.ts(257,15): error TS2322: Type
'{ code?: string | undefined; human_message?: string | undefined; } | undefined'
is not assignable to type
'{ code: string; human_message: string; } | undefined'.
```

**Status:** Pre-existing on the Phase 17 worktree base commit
(`9519478d90303783559b8a76c716fe129b1fa640`); NOT introduced by any
Phase 17 plan. Verified independently by each executor via `git stash &&
tsc --noEmit` cycles.

**Disposition:** Out of Phase 17 scope per executor scope-boundary rule
(only auto-fix issues directly caused by the current task's changes).
Phase 17 deliverables (DESIGN.md additions, trust-tier tokens, ErrorEnvelope
rebrand, wizardErrors CSV absorption, a11y test scaffolding) do not import
or reference `debug-key-flow`.

**Suggested handler:** Phase 16 follow-up, Phase 18 root-cause fix (if
`debug-key-flow` is touched there), or Phase 19 unified-backbone rewrite
of the `/api/debug-key-flow` endpoint.

**Suggested fix:** Tighten the narrowing on the `code` / `human_message`
extraction at the call site:
```ts
if (parsed.code !== undefined && parsed.human_message !== undefined) {
  // assign to the typed slot
}
```

---

## A11y gap: `text-text-muted` (#64748B) on `bg-negative/5` in `ErrorEnvelope` — **RESOLVED in /ship 2026-05-03**

**Resolution:** During /ship of Phase 17 the design specialist correctly
flagged that deferring an AA fail in the a11y-minimums phase contradicts
the phase contract. Fix applied inline:

- `src/components/error/ErrorEnvelope.tsx` debug_context `<ul>` swapped from
  `text-text-muted` (#64748B → ~4.45:1) to `text-text-secondary`
  (#4A5568 → ~7.81:1 on resolved `bg-negative/5`). One-class change, no
  consumer churn.
- `tests/a11y/wizard-contrast.test.ts` threshold restored from 4.4 to 4.5
  on the debug_context pair. Suite now uniformly enforces WCAG 2.0 AA
  (≥4.5:1) across all 16 fg/bg pairs.
- UI-SPEC §17 row 8 was originally correct in naming `text-text-secondary`
  as the debug_context fg colour; the source code is now aligned.
- Row 9 (correlation_id) already rendered through `text-text-secondary`
  via the `<details>` inheritance — no change needed.

**Original disposition** (kept for history): Out of Plan 17-06 scope
(test-scaffolding plan, no source edits). Was suggested as Phase 18
follow-up. /ship caught the contradiction at the gate.
