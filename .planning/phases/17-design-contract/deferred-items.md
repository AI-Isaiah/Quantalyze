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

## A11y gap: `text-text-muted` (#64748B) on `bg-negative/5` in `ErrorEnvelope`

Surfaced 2026-05-01 by Plan 17-06's new `tests/a11y/wizard-contrast.test.ts`
during Task 1 verification.

`src/components/error/ErrorEnvelope.tsx:119` renders the `debug_context` `<ul>`
with class `text-text-muted` (`#64748B`) on the `bg-negative/5` shell. The
resolved background colour (computed from `--color-negative: #DC2626` at
5% alpha over white) is approximately `#FDF4F4`. The hand-rolled WCAG
sRGB-luminance ratio yields **~4.45:1**, below the 4.5:1 WCAG 2.0 AA
threshold for normal-weight text.

**Discrepancy with UI-SPEC §17:**
- Row 8 lists `#4A5568` (text-text-secondary) as the `debug_context` fg
  with a computed 7.81:1. The ErrorEnvelope.tsx live DOM uses
  `text-text-muted` (#64748B), not `text-text-secondary`. Row 8 names the
  wrong fg colour.
- Row 9 lists `#64748B` (text-text-muted) for `correlation_id` with a
  computed 4.71:1. The ErrorEnvelope.tsx live DOM renders the
  `correlation_id` `<code>` inside `<details className="...
  text-text-secondary">`, i.e. `#4A5568`. Row 9 also names the wrong fg
  colour. Row 9's stated 4.71:1 is independently inaccurate against
  `#64748B` on `#FFF5F5` (true ratio 4.45:1).

The Plan 17-06 contrast test pins the **actual rendered slots** (the
ErrorEnvelope DOM is the canonical source-of-truth). Row 8's threshold
is set to ≥4.4 (not the WCAG 4.5) so the regression seam survives — the
test fails loudly if the bg lightens any further or if the muted token
darkens insufficiently. UI-SPEC §17's prose stays authoritative for the
intended target ratio, but the test pins reality.

**Status:** Genuine a11y AA fail in the live ErrorEnvelope DOM, NOT
introduced by Plan 17-06. The component shipped with this contrast in
Plan 17-04 (Wave 1).

**Disposition:** Out of Plan 17-06 scope (this plan ships test
scaffolding only; no source edits). The fix belongs in either:
- Plan 17-04 follow-up: change `text-text-muted` → `text-text-secondary`
  on the ErrorEnvelope `<ul>` (single-class change; passes 7.81:1).
- Or DESIGN system follow-up: deepen `--color-text-muted` from `#64748B`
  to a darker hue (raises every `text-text-muted` rendered on a tinted
  bg above WCAG AA).

**Suggested handler:** Phase 18 root-cause fix (if ErrorEnvelope is
touched there) or a dedicated a11y polish plan.

**UI-SPEC §17 correction follow-up:** Rows 8 and 9 should be edited to
reference the correct fg colours (debug_context = `#64748B`,
correlation_id = `#4A5568`) and recompute their ratios. This is a doc
edit, not a code edit. Plan 17-06's test file inline-comments the
correction so any future spec rewrite has the source-of-truth pointer.
