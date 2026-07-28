---
phase: 08
slug: connection-management-and-notes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Anchored in RESEARCH.md §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x (JS/TS), pytest 8.x (Python worker), Supabase migration self-verify DO blocks |
| **Config file** | `vitest.config.ts`, `pytest.ini`, migration `DO $$ … $$` appended to `supabase/migrations/071_user_notes_multiscope.sql` |
| **Quick run command** | `npm run test -- <changed-file-pattern>` |
| **Full suite command** | `npm run test && npm run typecheck && npm run lint && pytest -q` |
| **Estimated runtime** | ~45 seconds (vitest) + ~20 seconds (pytest) + ~2 seconds (migration self-verify on `supabase db push`) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- <changed-file>` for the files touched by that task (scoped vitest run, ~5–10s feedback).
- **After every plan wave:** Run the full suite (`npm run test && npm run typecheck && npm run lint`) plus `supabase db push` if schema files changed in the wave.
- **Before `/gsd-verify-work`:** Full suite must be green AND the migration self-verify DO block must have run against the linked project.
- **Max feedback latency:** 45 seconds (scoped vitest); 90 seconds (full suite).

---

## Per-Task Verification Map

> Populated by the planner during plan generation. Each task in each PLAN.md contributes one row with its automated verification command. Planner MUST include a grep-verifiable `<acceptance_criteria>` for every task.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | MANAGE-04, MANAGE-06 | T-08-01 (RLS leak across scopes) | Migration 071 preserves per-user RLS across all four scopes | migration self-verify + unit | `supabase db push && vitest run src/app/api/notes/route.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | MANAGE-04 | T-08-02 (scope_ref injection / ownership bypass) | `/api/notes` PATCH enforces per-scope ownership (portfolio/holding/bridge_outcome/strategy) | integration (Vitest multi-actor RLS harness) | `vitest run src/__tests__/user-notes-multiscope-rls.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | MANAGE-06 | T-08-03 (audit event drift) | ADR-0023 lists four `user_note.*.update` kinds; rename of `portfolio_note.update` applied atomically | grep + unit | `grep -q 'user_note.portfolio.update' docs/architecture/adr-0023-audit-event-taxonomy.md && vitest run src/__tests__/audit-fanout-integration.test.ts` | ✅ | ⬜ pending |
| 08-02-01 | 02 | 2 | MANAGE-04, MANAGE-05 | T-08-04 (stored XSS via markdown) | `rehype-sanitize` default schema + `<img>` removal + `<a>` rel/target rewrite; storage stays plain text | unit | `vitest run src/components/notes/NoteRender.test.tsx` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 2 | MANAGE-05 | — | `useNoteAutoSave` fires save on blur, surfaces aria-live state | unit | `vitest run src/components/notes/useNoteAutoSave.test.ts` | ❌ W0 | ⬜ pending |
| 08-02-03 | 02 | 2 | MANAGE-05 | — | NotesWidget upgraded off 1s-debounce to on-blur; scope_kind=portfolio + scope_ref=<portfolio.id> | unit + snapshot | `vitest run src/app/(dashboard)/allocations/widgets/meta/NotesWidget.test.tsx` | ✅ (existing) | ⬜ pending |
| 08-03-01 | 03 | 3 | MANAGE-05 | — | Holdings-row note icon trailing column + expandable sub-row; scope_ref = `{venue}:{symbol}:{holding_type}` | integration | `vitest run src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx` | ❌ W0 | ⬜ pending |
| 08-03-02 | 03 | 3 | MANAGE-05 | — | OutcomesWidget expandable adds Notes section; scope_ref = `bridge_outcomes.id` UUID | integration | `vitest run src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.test.tsx` | ✅ (existing) | ⬜ pending |
| 08-03-03 | 03 | 3 | MANAGE-05 | — | StrategyNoteCard on `/strategy/[id]` factsheet; scope_ref = `strategies.id` UUID | integration | `vitest run src/app/strategy/[id]/StrategyNoteCard.test.tsx` | ❌ W0 | ⬜ pending |
| 08-04-01 | 04 | 4 | MANAGE-01, MANAGE-02, MANAGE-03 | T-08-05 (accidental cascade delete) | Disconnect cascade checkbox DEFAULT UNCHECKED; `delete_allocator_api_key(p_cascade_holdings)` mapped 1:1 | integration | `vitest run src/components/exchanges/AllocatorExchangeManager.test.tsx` | ✅ (existing) | ⬜ pending |
| 08-04-02 | 04 | 4 | MANAGE-02 | — | Revoked-key holdings: strikethrough + amber chip + toggle; historical KPIs always include revoked rows | integration + snapshot | `vitest run src/app/(dashboard)/allocations/AllocationDashboard.test.tsx` | ✅ (existing) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Planner may refine IDs / commands during planning. This table is a floor, not a ceiling.*

---

## Wave 0 Requirements

- [ ] `src/__tests__/user-notes-multiscope-rls.test.ts` — multi-actor RLS leakage probe (4 scope kinds × 4 operations × 2 users). Mirror `src/__tests__/allocator-holdings-rls.test.ts` two-user harness.
- [ ] `src/components/notes/NoteRender.test.tsx` — markdown sanitizer assertions (script/iframe/img stripped, `<a href>` gets rel/target, tables/strike allowed).
- [ ] `src/components/notes/useNoteAutoSave.test.ts` — on-blur save, generation-guard retry, aria-live state transitions.
- [ ] `src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx` — note-icon trailing column + expandable sub-row.
- [ ] `src/app/strategy/[id]/StrategyNoteCard.test.tsx` — factsheet right-rail card render + scope_ref = `strategies.id`.
- [ ] Migration `071_user_notes_multiscope.sql` self-verify DO block — asserts `scope_kind` + `scope_ref` columns present, unique index exists, RLS enabled, `portfolio_id` column dropped.

*Existing infrastructure covers NotesWidget.test.tsx, AllocatorExchangeManager.test.tsx, OutcomesWidget.test.tsx, AllocationDashboard.test.tsx, audit-fanout-integration.test.ts, gdpr-export-coverage-hook.test.ts, and `/api/notes/route.test.ts` extensions.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Markdown visually renders as expected across four surfaces (portfolio, holding, bridge_outcome, strategy) | MANAGE-04 | Visual fidelity — JSDom render trees can't catch spacing / typography / color regressions against DESIGN.md | 1) Seed a note per scope. 2) Open each surface. 3) Verify institutional tone (DM Sans / Geist Mono / 1px borders / 8px radius). 4) Compare against 08-UI-SPEC.md mockups. |
| On-blur autosave UX feels calm (not jumpy) across all four surfaces | MANAGE-05 | Subjective feel — aria-live transitions render correctly in automated tests but "Saved 3s ago" cadence needs human judgement | Edit a note on each surface, tab out, confirm `Saving…` → `Saved` appears without flash-of-idle. |
| Allocator can see revoked-key holdings always appear in historical KPI strip / equity curve / drawdown chart (D-04) | MANAGE-02 | Cross-time-series visual — requires multi-day data history | Seed a key, generate 30 days of holdings, mark the key revoked. Confirm equity curve, 30d realized return KPI, and drawdown chart ALL include the revoked holdings. Toggle "Show revoked-key holdings" and confirm ONLY the table row count changes. |
| Disconnect modal institutional copy scans correctly | MANAGE-01 | Copy/design review — automated can verify text presence but not tone match | Open Disconnect modal on a real key; verify primary, explainer, checkbox, and destructive button copy match CONTEXT.md D-02 verbatim. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (6 new test files + migration self-verify DO block)
- [ ] No watch-mode flags (`vitest run`, never `vitest`)
- [ ] Feedback latency < 45s for scoped vitest runs
- [ ] `nyquist_compliant: true` set in frontmatter after planner writes PLAN.md files with automated verify per task

**Approval:** pending
