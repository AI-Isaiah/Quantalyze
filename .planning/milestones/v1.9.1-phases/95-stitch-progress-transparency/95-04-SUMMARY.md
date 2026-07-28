---
phase: 95-stitch-progress-transparency
plan: 04
subsystem: onboarding-wizard
tags: [wizard, composite, progress, PROG-01, PROG-02, PROG-03, sync-progress]
requires:
  - "GET /api/strategies/[id]/sync-progress (95-03)"
  - "@/lib/sync-progress contract (SyncProgressResponse, MemberProgressStatus)"
provides:
  - "Per-key composite progress panel on the wizard waiting surface"
  - "Phase-aware user-facing in-progress copy (PROG-01)"
  - "Route-driven interrupted state + idempotent retry CTA (PROG-03)"
affects:
  - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx"
tech-stack:
  added: []
  patterns:
    - "Fail-open cosmetic fetch piggybacked on an authoritative poll tick"
    - "Route-truth-driven UI state (never elapsed-time inference)"
key-files:
  created:
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.progress.render.test.tsx"
  modified:
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx"
decisions:
  - "Degraded chip carries NO reason text (locked decision 3 — reason stays post-completion via Phase-93 degradedMembers DQ channel)"
  - "Interrupted state uses amber (recoverable) treatment, not negative red"
  - "Degraded/interrupted amber uses the canonical text-warning (#B45309) token for caption-size AA, not the file's pre-existing text-amber-600"
metrics:
  duration_min: 6
  completed: 2026-07-12
  tasks: 3
  files: 2
---

# Phase 95 Plan 04: Wizard Sync-Progress Render (PROG-01/02/03) Summary

Honest, per-key, user-facing composite progress on the wizard waiting surface: a
live Successful/In process/Waiting/Degraded panel fed by
`GET /api/strategies/[id]/sync-progress`, phase-aware in-progress copy replacing
the internal `"Stitching composite…"` string, and a route-driven interrupted
state with an idempotent retry CTA — with the Phase-94 frozen SC pins byte-untouched.

## What was built

- **PROG-01 (copy):** the composite arm of the status line (`SyncPreviewStep.tsx:1660-1665`)
  now keys off the existing `computationStatus` — `"Trades are being processed…"`
  when computing, else `"Trades are being downloaded…"`. The internal
  `"Stitching composite…"` literal is gone from the user surface
  (`grep -c "Stitching composite"` → **0**). No new worker state (A2).
- **PROG-02 (panel + debug removal):** a piggybacked, fail-open
  `void fetch('/api/strategies/${strategyId}/sync-progress')` runs inside the
  existing composite poll tick (`:657-670`) — no new timer, cadence follows
  `POLL_BACKOFF_MS`, failures are `console.warn`-swallowed and never touch
  `consecutiveErrors`/`heavyFetchErrors`. The projection renders a
  `<ul data-testid="wizard-member-progress">` (`:1678-1712`), one
  `member-progress-{seq}` row per entry sorted by seq: left = `Key {seq} — {label
  ?? Capitalized(exchange)}`, right = an exact-string status chip
  (Waiting/In process/Successful/Degraded) via `MEMBER_STATUS_LABEL` +
  `MEMBER_STATUS_CHIP_CLASS` (`:321-345`). The debug `strategy_id/status/elapsed`
  `<pre>` block, its `expandLog` toggle, and the `expandLog` state are **deleted**
  (`grep -c expandLog|wizard-sync-expand-log|strategy_id={strategyId}` → **0**;
  T-95-11 mitigated).
- **PROG-03 (interrupted state + retry):** when `syncProgress.stalled === true`,
  a distinct amber `role="status"` banner (`wizard-sync-interrupted`, `:1746-1770`)
  renders alongside the spinner card (polling continues — the job may
  self-recover via the watchdog reclaim). Its "Retry sync" CTA (`handleRetrySync`,
  `:1144-1166`) re-POSTs `/api/keys/sync` in the exact kickoff shape; server-side
  `compute_jobs_one_inflight_per_kind_strategy` is the idempotency defense, the
  button disables in flight, a 2xx clears `syncProgress` (banner drops until the
  next poll re-asserts), a non-2xx keeps it visible and never enters the
  SYNC_FAILED terminal gate. The state is **exclusively** `syncProgress.stalled`
  driven — never elapsed-time or `strategy_analytics`-regression inferred (RT-1).

## Tasks & commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | RED — NEW sibling render test | `db235eac` |
| 2 | GREEN — poll wiring + panel + PROG-01 copy + debug removal | `59454222` |
| 3 | GREEN — interrupted state + idempotent retry CTA | `87842686` |

## New sibling test

`src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.progress.render.test.tsx`
(414 lines, **10 tests passing**): per-key panel with exact labels + key
identity; degraded-row-no-reason; empty-panel-no-invented-rows;
PROG-01 downloaded/processed copy + internal-string-absent; debug-toggle/
strategy_id-absent at 61s; interrupted-state + single idempotent retry POST +
polling-continues; not-stalled-never-interrupted past 15 min; fail-open on a
rejecting progress fetch; single-key neutrality (no progress fetch, no panel).
The three frozen Phase-94 siblings are re-declared-not-imported (own minimal mock).

## Verification

- `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/" "src/components/strategy/"` → **348 passed** (33 files).
- Frozen-file gate: `git status --porcelain` for `SyncPreviewStep.render.test.tsx`,
  `SyncPreviewStep.composite.render.test.tsx`, `SyncPreviewStep.test.ts` → **EMPTY** (byte-untouched, all green).
- Copy gate: `grep -c "Stitching composite" SyncPreviewStep.tsx` → **0**.
- `npx tsc --noEmit` → **exit 0**. `npm run lint` → **0 errors** (1 pre-existing
  EquityChart `exhaustive-deps` warning, out of scope).
- Repro-gate: the 6 behavior-adding pins (panel / copy swap / interrupted+retry /
  debug-gone-at-61s) were confirmed RED at Task 1 before implementation.
- No file deletions in the plan diff.

## Deviations from Plan

**1. [Rule 2 — correctness] Degraded/interrupted amber uses `text-warning` (#B45309), not `text-amber-600`.**
- **Found during:** Task 2/3 (visual token choice).
- **Issue:** The plan's action text incidentally suggested `text-amber-600` for
  the Degraded chip, but DESIGN.md (Color) mandates the canonical warning token
  `--color-warning` #B45309 (amber-700) for 12px/caption-size text to meet WCAG
  AA (5.05:1); `amber-600` is an AA-fail at that size. The plan also explicitly
  instructs "read DESIGN.md before choosing anything visual" and to "match the
  amber patterns used elsewhere in the wizard".
- **Fix:** Degraded chip and the interrupted banner use `text-warning` /
  `border-warning/40 bg-warning/5`. The interrupted banner is amber (recoverable),
  not the Error-Envelope negative red, per DESIGN.md's "warning = recoverable" semantic.
- **Files modified:** `SyncPreviewStep.tsx` (`MEMBER_STATUS_CHIP_CLASS`, interrupted block).
- **Commits:** `59454222`, `87842686`.

## Known Stubs

None — the panel, copy, and interrupted state are all wired to live route/poll
data. `syncProgress` is null only on the single-key path (by design; the panel is
composite-only).

## Threat Flags

None — no new network surface introduced by this render-only plan. The consumed
route (95-03) and its projection contract are pre-existing; the retry CTA re-uses
the existing `/api/keys/sync` kickoff.

## Self-Check: PASSED

- FOUND: `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.progress.render.test.tsx`
- FOUND: `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (modified)
- FOUND commit: `db235eac` (test/RED)
- FOUND commit: `59454222` (feat/panel+copy+debug)
- FOUND commit: `87842686` (feat/interrupted+retry)
