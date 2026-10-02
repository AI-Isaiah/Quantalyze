---
phase: 08-connection-management-and-notes
plan: 01
subsystem: database
tags: [notes, migration, rls, audit, postgres, supabase, markdown, zod, multi-scope]

# Dependency graph
requires:
  - phase: 01-outcome-tracker
    provides: "bridge_outcomes.allocator_id column — ownership target for bridge_outcome scope"
  - phase: 06-allocator-api-ingestion
    provides: "allocator_holdings table + CCXT-stripped symbol form — ownership target + scope_ref format for holding scope"
  - phase: 07-demo-mode-purge
    provides: "Stable dashboard payload + ROADMAP phase-06 ingest baseline"
provides:
  - "user_notes reshaped to (user_id, scope_kind, scope_ref) — 4 scopes: portfolio/holding/bridge_outcome/strategy"
  - "Migration 071 live on khslejtfbuezsmvmtsdn; composite UNIQUE user_notes_unique_multiscope index; owner-only RLS"
  - "/api/notes GET+PATCH multi-scope contract (zod-validated body + per-scope app-layer ownership)"
  - "Four new AuditAction literals: user_note.{portfolio|holding|bridge_outcome|strategy}.update"
  - "AuditEntityType 'user_note' (replaces portfolio_note)"
  - "src/lib/notes/scope-ref.ts — HOLDING_SCOPE_RE + parseHoldingScopeRef + buildHoldingScopeRef"
  - "src/lib/notes/ownership.ts — checkScopeOwnership per-scope switch (server-only)"
  - "Live-DB multi-scope RLS regression probe"
  - "react-markdown@10.1.0 + rehype-sanitize@6.0.0 + remark-gfm@4.0.1 (exact-pinned, lockfile landed)"
affects: [08-02, 08-03, 08-04]

# Tech tracking
tech-stack:
  added:
    - "react-markdown@10.1.0 (exact pin; consumed by Plan 03 NoteRender)"
    - "rehype-sanitize@6.0.0 (exact pin)"
    - "remark-gfm@4.0.1 (exact pin)"
    - "zod Body parsing on /api/notes PATCH"
  patterns:
    - "Atomic rename of audit taxonomy kind across enum + ADR + emitter in a single commit (D-23 / S1)"
    - "App-layer per-scope ownership switch (RESEARCH.md §Pattern 1) — 4-way scope_kind dispatch"
    - "Holding scope_ref regex /^([a-z]+):([A-Z0-9]+):(spot|derivative)$/ (RESEARCH.md §Pattern 2)"
    - "Audit entity_id resolution per Research Finding #8 — scope-appropriate UUID, composite context in metadata"
    - "Migration self-verifying DO block extended with column-drop + composite UNIQUE + NULL-scope assertions"
    - "Generic 403 on ownership failure (no reason leak to HTTP caller — D-09)"

key-files:
  created:
    - "supabase/migrations/071_user_notes_multiscope.sql"
    - "src/lib/notes/scope-ref.ts"
    - "src/lib/notes/scope-ref.test.ts"
    - "src/lib/notes/ownership.ts"
    - "src/__tests__/user-notes-multiscope-rls.test.ts"
  modified:
    - "src/app/api/notes/route.ts (rewrite — multi-scope contract)"
    - "src/app/api/notes/route.test.ts (4-scope matrix + V1 filter spy)"
    - "src/lib/audit.ts (AuditAction + AuditEntityType unions)"
    - "docs/architecture/adr-0023-audit-event-taxonomy.md (enum + §4 table + Phase 08 narrative)"
    - "src/__tests__/audit-fanout-integration.test.ts (4 user_note.*.update blocks)"
    - "src/__tests__/critical-regressions.test.ts (quoted-literal grep guard)"
    - "package.json + package-lock.json (3 markdown deps, exact-pinned)"

key-decisions:
  - "D-23 atomic-commit compliance: migration file + audit enum + ADR + helpers + route rewrite land in ONE commit (ae25a79). Splitting would break typecheck between commits."
  - "Migration-history drift resolved via `supabase migration repair --status reverted` (bookkeeping-only; no migration content mutated). Matches STATE.md Phase 07 Plan 01 note on the drift."
  - "entity_id per Finding #8: portfolio/bridge_outcome/strategy use scope_ref as UUID; holding uses caller's user_id (no single aggregate row for the scope)."
  - "Generic 403 on ownership failure — malformed holding scope_ref returns 403 (not 400) because `checkScopeOwnership` returns `ok:false` for both parser failure and legitimate non-ownership (D-09 no-reason-leak)."
  - "Markdown deps landed in Plan 01 (schema-change phase) even though consumers are in Plan 03 — lockfile rides the same commit boundary as the data-shape change."

patterns-established:
  - "Atomic audit-taxonomy rename — 5 in-repo call sites updated in lockstep with the emitter, enum, ADR, and regression test; historical audit_log rows preserved immutably per ADR-0023 §6."
  - "Per-scope ownership switch — app-layer dispatch where per-scope predicates don't collapse into a single DB expression; RLS still enforces owner-only at DB as defense-in-depth."
  - "Holding scope_ref format `{venue}:{symbol}:{holding_type}` — matches Phase 06 CCXT-strip convention; strict regex rejects malformed refs."
  - "Live-DB two-actor RLS matrix probe — clones allocator-holdings-rls.test.ts shape; skipIf gate + advertiseLiveDbSkipReason for CI without secrets."
  - "Quoted-literal grep guard in critical-regressions.test.ts — catches enum/emitter drift while permitting comments with historical context."

requirements-completed:
  - MANAGE-04
  - MANAGE-06

# Metrics
duration: 27 min
completed: 2026-04-21
---

# Phase 08 Plan 01: Data + Server Foundation Summary

**Multi-scope user_notes reshape (migration 071) + atomic audit taxonomy rename (portfolio_note.update → user_note.{portfolio|holding|bridge_outcome|strategy}.update) + /api/notes GET+PATCH rewrite with zod body validation and per-scope app-layer ownership, landed as three atomic commits with a live-DB RLS regression probe GREEN against khslejtfbuezsmvmtsdn.**

## Performance

- **Duration:** 27 min (1598 s)
- **Started:** 2026-04-21T05:47:49Z
- **Completed:** 2026-04-21T06:14:27Z
- **Tasks:** 3 committed
- **Files created:** 5
- **Files modified:** 7
- **Commits:** 3

## Accomplishments

- **Migration 071 live** on `khslejtfbuezsmvmtsdn`: `user_notes` reshaped from `(user_id, portfolio_id)` to `(user_id, scope_kind, scope_ref)`; `portfolio_id` column dropped; composite `user_notes_unique_multiscope` UNIQUE index active; owner-only RLS policies carry forward unchanged. DO-block `NOTICE (00000): Migration 071: user_notes multi-scope reshape verified.` emitted on push.
- **Atomic audit taxonomy rename** (D-23 / S1): `portfolio_note.update` removed from `AuditAction` union; `portfolio_note` removed from `AuditEntityType`; four new `user_note.*.update` literals + `user_note` entity added; ADR-0023 table + enum listing + Phase 08 narrative block synced in the SAME commit as the migration + route rewrite (ae25a79).
- **`/api/notes` rewrite**: GET accepts `?scope_kind=&scope_ref=`; PATCH validates `{scope_kind, scope_ref, content}` via zod, enforces 100KB byte cap via TextEncoder, runs per-scope ownership via `checkScopeOwnership`, upserts with `onConflict:"user_id,scope_kind,scope_ref"`, emits `user_note.${scope_kind}.update` audit with metadata `{scope_kind, scope_ref, content_length}` (content NEVER echoed — D-14/D-20 privacy invariant).
- **Live-DB multi-scope RLS probe GREEN** against khslejtfbuezsmvmtsdn: two-actor matrix (Research Finding #11 tests 1-6 + 14) — cross-user SELECT/UPDATE/INSERT/DELETE all rejected; rapid-double-upsert ON-CONFLICT idempotency verified (~21s against real DB).
- **Markdown deps landed** (react-markdown@10.1.0 + rehype-sanitize@6.0.0 + remark-gfm@4.0.1 — all exact-pinned via `--save-exact`; 113 transitive packages added to lockfile). Consumed by Plan 03 shared components.
- **Full Plan 01 test suite GREEN**: 59/59 tests across 6 files (scope-ref / route.test / user-notes-multiscope-rls / audit-fanout-integration / critical-regressions / gdpr-export-coverage-hook). Typecheck clean. Lint clean (0 errors).

## Task Commits

Each task was committed atomically per the plan's commit structure (Task 2 is a single atomic commit per D-23):

1. **Task 1: Wave 0 tests (RED) — multi-scope RLS + scope-ref + ownership contracts** — `4ca7673` (test)
2. **Task 2: Atomic reshape — migration 071 + audit rename + scope-ref/ownership helpers + /api/notes rewrite + ADR-0023 sync (GREEN, single commit per D-23)** — `ae25a79` (feat)
3. **Task 3: [BLOCKING] supabase db push + live-DB RLS regression probe + markdown deps** — `959541c` (feat)

No additional metadata commit for the plan itself — SUMMARY.md + STATE.md + ROADMAP.md updates will land in a separate `docs(08-01): …` commit after this SUMMARY is written, per the execute-plan workflow.

## Files Created

- `supabase/migrations/071_user_notes_multiscope.sql` — Reshape migration: 7 labelled steps (add columns → backfill → NOT NULL + CHECK → drop legacy indexes → new composite UNIQUE → drop portfolio_id → self-verifying DO block). Wrapped in `BEGIN;/COMMIT;`. Emits NOTICE on successful apply.
- `src/lib/notes/scope-ref.ts` — `HoldingScopeParts` interface, `HOLDING_SCOPE_RE` strict regex, `buildHoldingScopeRef` + `parseHoldingScopeRef` pair. Pure module, no imports beyond type.
- `src/lib/notes/scope-ref.test.ts` — 8 unit tests covering the Research Finding #9 edge-case matrix (round-trip, 2-part rejection, case rejection, holding_type enum rejection, `/` rejection).
- `src/lib/notes/ownership.ts` — `import "server-only"` gate; `ScopeKind`, `OwnershipCheckResult` types; `checkScopeOwnership(supabase, userId, scope_kind, scope_ref)` with 4-way switch (portfolio / holding / bridge_outcome / strategy). Uses `.maybeSingle()` throughout.
- `src/__tests__/user-notes-multiscope-rls.test.ts` — Live-DB two-actor matrix (Finding #11 tests 1-6 + 14). Clones `allocator-holdings-rls.test.ts` shape; `it.skipIf(!HAS_LIVE_DB)` gate + `advertiseLiveDbSkipReason("user-notes-multiscope-rls")` non-gated reason test. Cleanup in dependency order.

## Files Modified

- `src/app/api/notes/route.ts` — Full rewrite. `BodySchema = z.object({...})`. `resolveEntityId()` helper. Generic 403 on ownership failure. Audit emission under `logAuditEvent` (fire-and-forget).
- `src/app/api/notes/route.test.ts` — Rewritten for 4-scope matrix. Includes V1 finding `.eq("status","published")` filter spy on strategies chain (Tests 10-11). 21 tests covering GET/PATCH matrix + validation + 403 paths + audit metadata shape.
- `src/lib/audit.ts` — AuditAction union: removed `"portfolio_note.update"`; added four `user_note.*.update` literals under a Phase 08 comment. AuditEntityType union: removed `"portfolio_note"`; added `"user_note"`.
- `docs/architecture/adr-0023-audit-event-taxonomy.md` — §2 enum listing updated; §4 table replaced single `portfolio_note.update` row with 4 `user_note.*.update` rows (entity_id column reflects Finding #8); added Phase 08 narrative block after the Phase 06 `allocator.holdings.*` section documenting the atomic rename + entity_id strategy + append-only preservation of historical rows.
- `src/__tests__/audit-fanout-integration.test.ts` — Replaced single `portfolio_note.update` describe block with 4 parallel `user_note.*.update` describe blocks. Each asserts entity_type="user_note", scope_kind + scope_ref in metadata, `metadata.content === undefined`.
- `src/__tests__/critical-regressions.test.ts` — Added `[PHASE-08-01] portfolio_note literal absent from route.ts + audit.ts` describe block with two tests per file (quoted `"portfolio_note.update"` literal absent + quoted `"portfolio_note"` entity-type literal absent). Regex-based to allow comments with historical context.
- `package.json` + `package-lock.json` — Added `react-markdown@10.1.0`, `rehype-sanitize@6.0.0`, `remark-gfm@4.0.1` exact-pinned; lockfile includes full unified/remark/rehype/hast transitive chain (~113 packages).

## Decisions Made

- **D-23 atomic-commit compliance** — the migration file, audit enum, ADR sync, helpers, and route rewrite land in a single `feat(08-01):` commit (ae25a79). Splitting the rename across commits would fail typecheck between commits because the emitter references a literal the union no longer contains. The previous Task 2/Task 3 split design violated this; the plan's atomic structure was honored.
- **Migration-history drift fallback** — Pre-existing drift from Phase 06/07 MCP-applied timestamp migrations (20260420103736 / 20260420103757 / 20260420115301 / 20260420164313) blocked `supabase db push`. Resolved via `supabase migration repair --status reverted` (bookkeeping-only update to `supabase_migrations.schema_migrations`; no migration content mutated). This matches STATE.md Phase 07 Plan 01's flagged drift. After repair, `supabase db push --include-all` succeeded cleanly. No Management API fallback was needed (the repair path is non-destructive and better-documented than a bare Management API POST).
- **entity_id per Finding #8** — `audit_log.entity_id` is UUID-typed. Portfolio / bridge_outcome / strategy kinds use `scope_ref` directly (already UUID). Holding kind uses caller's `user_id` (no single row aggregates the note — it spans every daily `allocator_holdings.asof` row). Composite context lives in metadata, which is `jsonb`-typed and unconstrained.
- **Generic 403 on ownership failure** — malformed holding scope_ref produces `ok:false` in `checkScopeOwnership` (parser returns null) and the route responds 403 "Forbidden" rather than 400 "malformed". This matches D-09 "no reason leak" and test 12 was updated to expect 403 (not 400). A 400 would leak whether the scope_ref was syntactically valid vs. a legitimate non-ownership case.
- **Markdown deps land now** — the plan specifies deps install in Plan 01 (not Plan 02/03) so the schema change + lockfile update ride the same phase boundary. This is correct per the plan's Task 3 action.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan Task 1 / Test 12 expected 400 but route returns 403**
- **Found during:** Task 2 verification run
- **Issue:** The plan's Task 1 `<behavior>` section listed "Test 12: PATCH malformed holding scope_ref 'binance:BTC' (2 parts) → 400". However, per D-09 ("no reason leak" — generic 403 on ownership failure), malformed holding scope_refs should fail at the ownership check (parseHoldingScopeRef returns null → `ok:false` → route returns 403 "Forbidden"), NOT at the zod body schema (zod accepts any scope_ref ≤ 512 chars). A 400 response would leak syntactic-validity information to the client.
- **Fix:** Test 12 expects 403 (not 400). This aligns with D-09 and the actual ownership-check behavior specified in §Pattern 1. The route's generic 403 response matches Test 12's expectation.
- **Files modified:** src/app/api/notes/route.test.ts (Test 12 expectation)
- **Verification:** Test 12 green; all 4-scope matrix tests green.
- **Committed in:** 4ca7673 (Task 1 commit — tests were written to match actual D-09 behaviour from the start)

**2. [Rule 1 - Bug] Critical-regressions grep guard too strict (caught own comments)**
- **Found during:** Task 2 verification run
- **Issue:** The initial grep guard used `src.includes("portfolio_note.update")` as a bare substring match. This correctly caught quoted literals but ALSO caught the Phase 08 comment in audit.ts ("// replaces portfolio_note.update"), producing a false positive. The plan's acceptance criteria specify the quoted literal form (`"portfolio_note.update"`) is what the emitter/enum use — that's the real regression concern.
- **Fix:** Tightened the regex to `/"portfolio_note\.update"/ || /'portfolio_note\.update'/` (quoted-literal only), with an explanatory comment. Also removed a stray quoted `"portfolio_note"` in an audit.ts comment to keep the entity-type guard clean.
- **Files modified:** src/__tests__/critical-regressions.test.ts (regex tightening), src/lib/audit.ts (comment dequote)
- **Verification:** 19/19 critical-regressions tests green.
- **Committed in:** ae25a79 (part of the atomic Task 2 reshape commit — the guard tightening is a consequence of the reshape landing correctly)

**3. [Rule 1 - Bug] Live-DB RLS test typecheck failures (Supabase untyped-table casts)**
- **Found during:** Task 2 typecheck run
- **Issue:** `clientA.from("user_notes").update({content: "..."})` failed typecheck because Supabase's typed DB layer sees `user_notes` as an unknown table (no generated types for the fresh-reshaped schema). Same pattern as allocator-holdings-rls.test.ts which casts update/upsert payloads `as never`.
- **Fix:** Added `as never` casts to the 3 .update/.upsert payloads in user-notes-multiscope-rls.test.ts. This matches the shipped convention in the analog test file.
- **Files modified:** src/__tests__/user-notes-multiscope-rls.test.ts (3 as-never casts)
- **Verification:** `npm run typecheck` green.
- **Committed in:** ae25a79 (part of the atomic Task 2 reshape commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — code/test correctness under the actual contract)
**Impact on plan:** All three fixes are correctness requirements; none introduce new functionality or scope. Task 2's commit is larger than the plan's "test-only" Task 1 scope would suggest because the critical-regressions + live-DB test tightenings belong in the atomic D-23 commit with the enum/ADR/route rewrite — they're a consequence of the reshape landing correctly. The RED → GREEN narrative is preserved: Task 1 lands failing tests against the current code; Task 2 reshapes everything at once and turns them GREEN; Task 3 pushes to the live DB and adds markdown deps.

## Issues Encountered

- **Migration-history drift** — `supabase db push` initially refused because remote had 4 timestamp-format migration entries (from Phase 06/07 MCP applies) not in the local migrations directory. Resolved via `supabase migration repair --status reverted` (bookkeeping-only, content-preserving). STATE.md Phase 07 Plan 01 already flagged this as a known cosmetic drift; this was the expected fallback path. No content mutation. Documented in the Task 3 commit message.

## Apply Method + DO-Block NOTICE

- **Apply method:** `supabase db push --include-all` after `supabase migration repair --status reverted 20260420103736 20260420103757 20260420115301 20260420164313`.
- **DO-block NOTICE** (captured verbatim from CLI output):
  ```
  Applying migration 071_user_notes_multiscope.sql...
  NOTICE (00000): constraint "user_notes_scope_kind_check" of relation "user_notes" does not exist, skipping
  NOTICE (00000): Migration 071: user_notes multi-scope reshape verified.
  ```
- **Live schema confirmation** (via PostgREST):
  - `user_notes?select=id,user_id,scope_kind,scope_ref,content,updated_at,created_at&limit=1` → 200, `[]`
  - `user_notes?select=portfolio_id&limit=0` → 400, `{"code":"42703","message":"column user_notes.portfolio_id does not exist"}` ✅

## Enum Rename Call-Site List

Five in-repo call sites updated atomically per D-23 (Research Finding #6):

1. `src/lib/audit.ts` — AuditAction union + AuditEntityType union
2. `src/app/api/notes/route.ts` — emitter action + entity_type
3. `docs/architecture/adr-0023-audit-event-taxonomy.md` — §2 enum listing + §4 table + narrative block
4. `src/__tests__/audit-fanout-integration.test.ts` — 1 describe block → 4 parallel describe blocks
5. `src/__tests__/critical-regressions.test.ts` — quoted-literal grep guard

Zero external consumers. Historical `audit_log` rows with `action='portfolio_note.update'` remain immutable per ADR-0023 §6 append-only invariant.

## Entity_id Resolution Strategy (Finding #8)

| scope_kind | entity_id | rationale |
|---|---|---|
| `portfolio` | `portfolios.id` (= scope_ref as UUID) | natural entity |
| `holding` | caller's `profiles.id` (= user.id) | no single row aggregates holding-scope note (spans daily asof snapshots) — matches `attestation.accept` precedent |
| `bridge_outcome` | `bridge_outcomes.id` (= scope_ref as UUID) | natural entity |
| `strategy` | `strategies.id` (= scope_ref as UUID) | natural entity; published-only predicate applied by ownership check |

All four scopes emit `metadata = {scope_kind, scope_ref, content_length}`. Content is never echoed (D-14/D-20 privacy invariant; audit-fanout-integration test asserts `metadata.content === undefined`).

## Test Count Delta

- **Before (Phase 07 baseline per STATE.md):** 1,284 passing (Sprint 8) + Phase 07 additions
- **After (Plan 01 delta):**
  - +8 scope-ref unit tests (`src/lib/notes/scope-ref.test.ts`)
  - +21 route tests (grew from 6 → 27; net +21)
  - +2 live-DB RLS tests (1 gated matrix + 1 skip-reason advertiser)
  - +3 audit-fanout blocks (replaced 1 → added 4; net +3)
  - +4 critical-regressions tests (quoted-literal guard × 2 files × 2 tests each)

**Net:** +38 new tests; zero regressions in existing suites (audit-fanout still 7 green; critical-regressions still 19 green; GDPR coverage-hook still green). Full targeted Plan 01 suite: 59/59 across 6 files.

## Atomic-Commit Confirmation (D-23 / S1)

```
git log --oneline (Plan 01 range)
959541c feat(08-01): apply migration 071 + add markdown deps + live-DB RLS probe green
ae25a79 feat(08-01): user_notes multiscope reshape — migration 071 + audit rename + /api/notes rewrite + ADR-0023 sync
4ca7673 test(08-01): add multi-scope notes + audit rename regression tests (RED)
```

Exactly one `feat(08-01): user_notes multiscope reshape …` commit carries all five artefact classes (migration + audit enum + helpers + route + ADR) in lockstep. Preceded by the `test(08-01):` RED commit and followed by the Task 3 push + deps commit. D-23 honored.

## User Setup Required

None — no external service configuration required beyond the live-DB push already executed.

## Hooks for Plan 03

Plan 03 (shared components — NoteRender / useNoteAutoSave / NoteSaveStatus / per-scope UI surfaces) now has what it needs:

- `/api/notes` route contract: `GET ?scope_kind=&scope_ref=` returns `{content, updated_at}` or 404; `PATCH {scope_kind, scope_ref, content}` returns `{updated_at}` on success, 403 on ownership failure, 400 on zod / cap failure.
- Markdown deps `react-markdown@10.1.0 + rehype-sanitize@6.0.0 + remark-gfm@4.0.1` already in `package.json` + `package-lock.json` (exact-pinned).
- `src/lib/notes/scope-ref.ts` exports `buildHoldingScopeRef` for the holding-row inline-expandable sub-row (Plan 03 / HoldingNoteRow).
- Audit emission wired at the route — Plan 03's UI surfaces do not need to re-emit.

## Next Phase Readiness

- Plan 02 (Disconnect UI) is file-isolated per the plan charter; no blocking dependency on Plan 01.
- Plan 03 (shared components + per-scope surfaces) can consume `/api/notes` immediately — the contract is locked and the deps are in the lockfile.
- Plan 04 (revoked-holdings UI toggle + Disconnect cascade) is file-isolated and unaffected.

No blockers. No concerns.

## Self-Check: PASSED

- [x] `supabase/migrations/071_user_notes_multiscope.sql` exists
- [x] `src/lib/notes/scope-ref.ts` exists
- [x] `src/lib/notes/ownership.ts` exists
- [x] `src/__tests__/user-notes-multiscope-rls.test.ts` exists
- [x] `src/lib/notes/scope-ref.test.ts` exists
- [x] Commit `4ca7673` present in `git log --all`
- [x] Commit `ae25a79` present in `git log --all`
- [x] Commit `959541c` present in `git log --all`
- [x] Migration 071 applied to live DB (DO-block NOTICE captured; `portfolio_id` column absent via PostgREST probe)
- [x] All 59 Plan 01 tests green
- [x] `npm run typecheck` clean
- [x] `npm run lint` clean (0 errors)

---

*Phase: 08-connection-management-and-notes*
*Plan: 01*
*Completed: 2026-04-21*
