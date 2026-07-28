# Voice Findings Accepted for Replan — Phase 08

**User decisions:** 4 of 9 divergent findings accepted. No consensus findings (all cross-voice matches had materially different recommendations).

**Rejected findings (do NOT fold — user explicitly declined):**
- R1 (Plan 04 lazy-fetch for holding notes) — user accepts stub behavior; server-prefetch deferred post-v0.15
- A1 (PATTERNS.md entity_id contradiction) — user accepts; PATTERNS.md is internal reference, Plan 01 Task 3's resolveEntityId already uses the correct UUID strategy at runtime
- C1 (query-layer extension for source_key_sync_status) — user accepts; expects executor to adapt field names during implementation
- C2 (partition 08-01 bundle) — user accepts atomic-commit cost in favor of S1 below

---

## Accepted Findings

### S1 — Merge 08-01 Tasks 2+3 into a single atomic commit (BLOCKER, Voice A)

**Area:** sequencing
**Problem:** Task 2 removes `"portfolio_note.update"` from the AuditAction union in `src/lib/audit.ts` but commits separately from Task 3's route rewrite. The existing `src/app/api/notes/route.ts:116` still passes `action: "portfolio_note.update"` — once the literal leaves the union, typecheck fails at Task 2's commit boundary. Task 2 acceptance criterion `npm run typecheck returns 0` is unachievable. Also violates CONTEXT.md D-23 ("same atomic commit" for migration + audit.ts + ADR-0023 + route rewrite).

**Change to apply in `08-01-PLAN.md`:**
- Merge Task 2 and Task 3 into a single task whose commit lands:
  - Migration file `supabase/migrations/071_user_notes_multiscope.sql`
  - `src/lib/audit.ts` AuditAction union rename (`portfolio_note.update` → `user_note.portfolio.update` + 3 new siblings)
  - `docs/architecture/adr-0023-audit-event-taxonomy.md` §2 + §4 updates
  - `src/app/api/notes/route.ts` rewrite (multi-scope GET/PATCH with scope-ref + per-scope ownership + entity_id resolution)
  - `src/lib/notes/scope-ref.ts` (regex + parser helpers)
  - `src/lib/notes/ownership.ts` (per-scope check helpers)
- Single commit message: `feat(08-01): user_notes multiscope reshape — migration 071 + audit rename + /api/notes rewrite + ADR-0023 sync`
- Delete the "Do NOT `supabase db push` yet — Task 3 wires the route first" guidance from the old Task 2 (it's no longer coherent under the merged task).
- Move the `npm run typecheck` acceptance criterion onto the merged task only.
- Leave Task 4 (supabase db push + RLS regression) as its own separate atomic task/commit.
- Renumber subsequent tasks accordingly.

---

### S2 — Pin `useNoteAutoSave` unmount-flush behavior in 08-03 Task 3 (WARNING, Voice A)

**Area:** sequencing
**Problem:** Plan 03 Task 3 lists the hook's required behavior but never addresses unmount flush; Task 4 hedges ("if the hook does NOT flush on unmount by design, retain the current fire-and-forget path"). NotesWidget, HoldingNoteRow, BridgeOutcomeNoteSection, and StrategyNoteCard all inherit whichever behavior ships with no test pinning it down.

**Change to apply in `08-03-PLAN.md`:**
- In Task 3 `<action>`, add an explicit sub-bullet pinning the hook's contract. Recommended choice (institutional calm): **No unmount flush — consumers must trigger save before unmount.** Rationale: blur-triggered save already covers the dominant user path; unmount-flush introduces a race with StrictMode double-mount in dev that adds noise for a rare case.
- In Task 1 `useNoteAutoSave.test.ts`, add a test case: `"does NOT flush on unmount — verifies fire-and-forget exit contract"` that mounts, sets dirty content, unmounts WITHOUT blur, and asserts no PATCH was dispatched.
- In Task 4 `<action>`, delete the hedged branch "if the hook does NOT flush on unmount by design, retain the current fire-and-forget path" — Task 3 now pins the behavior, so Task 4 unconditionally wires the new hook.

---

### V1 — Tighten Plan 01 Task 1 strategy ownership mock chain (WARNING, Voice A)

**Area:** verification
**Problem:** Tests 10–11 require 200 for published strategy and 403 for unpublished, but the route calls `.eq("id", ref).eq("status", "published").maybeSingle()`. With a permissive mock, Test 11 could pass without exercising the `status='published'` filter — the ownership predicate is never actually validated.

**Change to apply in the merged 08-01 task (post-S1) that rewrites `/api/notes/route.test.ts`:**
- In the `<action>` block where Tests 10–11 are authored, add explicit mock-shape guidance: "For Tests 10–11, the `supabase.from('strategies')` mock must record the `.eq('status', 'published')` filter in the chain. Test 11 seeds an unpublished-strategy fixture whose mock returns `{data: null, error: null}` ONLY when `.eq('status', 'published')` has been applied to the chain (use a jest spy / tracking proxy on `.eq` calls)."
- Add acceptance criterion: `grep -Eq "eq\\(\\s*[\"']status[\"']\\s*,\\s*[\"']published[\"']" src/app/api/notes/route.test.ts` returns 0.

---

### V2 — Add RLS vitest assertion to 08-01 Task 4 acceptance (WARNING, Voice B)

**Area:** verification
**Problem:** Task 4's acceptance criteria grep for migration file strings and use manual `psql` column checks but omit the live-DB RLS leakage probe assertion. File presence doesn't prove RLS works after push.

**Change to apply in `08-01-PLAN.md` Task 4 (`supabase db push` + RLS regression):**
- Add to Task 4 `<acceptance_criteria>`:
  - `npx vitest run src/__tests__/user-notes-multiscope-rls.test.ts` returns 0 (live-DB multi-actor RLS matrix — Tests 1–6 + Test 14 from RESEARCH Finding #11 all green)
- Keep the existing migration-file grep + `psql` column checks; the vitest run is additive.

---

### S3 — Set Plan 02 `depends_on: [08-01]` (INFO, Voice B)

**Area:** sequencing
**Problem:** Plan 02 has `depends_on: []` but semantically depends on 08-01's migration landing first (HoldingsTable reads `allocator_holdings` rows that may be affected by RLS changes if the 071 reshape interacts with neighboring tables).

**Change to apply in `08-02-PLAN.md` front-matter:**
- Change `depends_on: []` → `depends_on: ["08-01"]`
- Add a short one-line comment in front-matter: `# HoldingsTable queries allocator_holdings unaffected by user_notes migration, but we sequence after 08-01 so the RLS regression test in 08-01 gates any orthogonality surprises.`
- Update the wave structure accordingly: if this bumps Plan 02 out of Wave 1, confirm Plan 02 is Wave 2 and update the roadmap plan-list if needed. (Note: Plan 03 and 04 continue to honor their existing depends_on chains.)

---

## Summary for the Planner

The five accepted findings collectively:
1. **Consolidate 08-01's commit boundary** (S1) — one atomic commit for the reshape + audit rename + route rewrite + ADR sync, honoring D-23.
2. **Pin one behavioral contract** (S2) — useNoteAutoSave does NOT flush on unmount; consumers rely on blur.
3. **Strengthen two verification gates** (V1 + V2) — strategy ownership mock must exercise `status='published'`; live-DB RLS matrix must be green after `supabase db push`.
4. **Document one dependency edge** (S3) — Plan 02 sequences after 08-01.

No scope changes. No file additions beyond what's already in the plans. No new plans. The replan is a surgical edit of the four existing PLAN.md files.
