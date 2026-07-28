# Outside Voices — Phase 08

**Voice A (Claude subagent, fresh context):** verdict=revise — Plan 01 sequencing breaks typecheck mid-phase and violates D-23's atomic-commit mandate; Plan 02 assumes a holdings-query-layer extension no task delivers; Plan 04's holding-note surface loses data on first save because it never reads existing note content; PATTERNS.md §13 and shared-patterns sample code directly contradict the Finding #8 / Plan 01 entity_id strategy.

**Voice B (Grok grok-4-1-fast-reasoning):** verdict=revise — Plans exhibit overcomplexity smells, unstated data shape assumptions, and weak automated verification that fails to prove core invariants like RLS functionality.

## Consensus findings (auto-fold into replan)

| # | Priority | Area | Title | Severity (A/B) | Confidence (A/B) | Recommendation |
|---|----------|------|-------|----------------|------------------|----------------|
| — | — | — | *(none — every cross-voice match had materially different recommendations and becomes divergent per spec)* | — | — | — |

## Divergent findings (require user decision)

### Risk / Data Loss

| # | Priority | Area | Title | Voice A says | Voice B says |
|---|----------|------|-------|--------------|--------------|
| R1 | P0 | risk | Plan 04 Task 1 `notesByHoldingScopeRef` default `{}` overwrites existing holding notes on first save | BLOCKER — Lazy GET on HoldingNoteRow mount mirroring BridgeOutcomeNoteSection; remove the prop + default `{}` | WARNING — Accept the stub: document icon assumes `hasNote=false` when prop is empty, defer server prefetch post-v0.15 |

### Sequencing / Atomic Commit

| # | Priority | Area | Title | Voice A says | Voice B says |
|---|----------|------|-------|--------------|--------------|
| S1 | P1 | sequencing | Plan 01 Task 2 removes `portfolio_note.update` from AuditAction union but route.ts still emits it → typecheck break + D-23 atomic-commit violation | BLOCKER — Merge Tasks 2+3: single commit lands migration + audit.ts rename + ADR + `/api/notes` rewrite together | (not flagged) |
| S2 | P2 | sequencing | Plan 03 Task 4 unmount-flush behavior is hedged — Task 3 never specifies; downstream surfaces inherit whichever ships | WARNING — Pin the choice in Task 3 (either `registerDraft` + useEffect flush OR explicit no-unmount-flush) + test | (not flagged) |
| S3 | P3 | sequencing | Plan 02 `depends_on: []` understates dependence on 08-01 migration | (not flagged) | INFO — `depends_on: [08-01]` with orthogonality note |

### Architecture Contradiction

| # | Priority | Area | Title | Voice A says | Voice B says |
|---|----------|------|-------|--------------|--------------|
| A1 | P1 | architecture | 08-PATTERNS.md §13 table + Shared-Patterns audit-emit snippet use composite `{scope_kind}:{scope_ref}` as entity_id — contradicts RESEARCH Finding #8 (UUID-typed) → UUID-cast crash at runtime | BLOCKER — Rewrite PATTERNS.md §13 table + audit-emit snippet to use per-scope UUID + composite in metadata; land in same commit as Plan 01 Task 2/3 | (not flagged) |

### Scope / Data Completeness

| # | Priority | Area | Title | Voice A says | Voice B says |
|---|----------|------|-------|--------------|--------------|
| C1 | P1 | scope | Plan 02 HoldingsTable reads `row.source_key_sync_status` but no task extends `src/lib/queries.my-allocation.ts` to project it → MANAGE-02 fails in production even though unit tests pass | BLOCKER — Add `src/lib/queries.my-allocation.ts` to Plan 02 `files_modified`; prepend a query-extension step with integration test + grep-verifiable acceptance | (not flagged) |
| C2 | P2 | scope | 08-01 bundles 12 files in one commit — overcomplexity smell | (not flagged) | WARNING — Partition: defer scope-ref/ownership helpers to a new Task 2.5 post-migration+route |

### Verification

| # | Priority | Area | Title | Voice A says | Voice B says |
|---|----------|------|-------|--------------|--------------|
| V1 | P2 | verification | Plan 01 Task 1 strategy ownership Tests 10-11 under-specify mocked Supabase chain — permissive mock lets Test 11 pass without exercising the `status='published'` predicate | WARNING — Specify mock shape (record `.eq('status','published')` filter; fixture returns `{data: null}` when filter applied) + grep acceptance | (not flagged) |
| V2 | P2 | verification | Plan 01 Task 4 acceptance criteria lack an automated RLS proof — grep file presence doesn't prove the live-DB leakage probe succeeds | (not flagged) | WARNING — Add `npx vitest run src/__tests__/user-notes-multiscope-rls.test.ts returns 0` to Task 4 acceptance |

---

**Summary:**
- Voice A: 6 findings (4 BLOCKER, 2 WARNING)
- Voice B: 4 findings (0 BLOCKER, 3 WARNING, 1 INFO)
- Consensus: 0 (all cross-voice matches had materially different recommendations)
- Divergent: 9 (R1, S1, S2, S3, A1, C1, C2, V1, V2)
