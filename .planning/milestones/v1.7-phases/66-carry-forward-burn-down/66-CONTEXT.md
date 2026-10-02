# Phase 66: Carry-Forward Burn-Down - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — recommendations auto-accepted per user's standing decide-autonomously directive)

<domain>
## Phase Boundary

The accumulated v1.6 debt is honestly gone: the three red-team findings (F-3, F-5, F-4) fixed at root, the dead `holdingReturnsByScopeRef` + `holdingsSummary` SSR pipeline removed, planning-ledger smalls closed (prod residue rows, D3 decision, gantt labels, AllocationsTabs payload cast), and TODOS.md triaged so it ends reflecting only live, verified debt. No Deribit work — this phase clears the baseline before v1.7 feature phases.

</domain>

<decisions>
## Implementation Decisions

### Red-team fixes (F-3 / F-5 / F-4)
- F-3 (CF-01): DELETE the dead `isBookOnlyDraft` disjunct from the share-mint gate rather than promoting it — promotion would change share-eligibility semantics (product change out of scope). Correct the overstated "the ONE definition of shareable" comment. Add a regression test proving a book-only draft remains blocked by the surviving `addedStrategies.length === 0` disjunct (test must fail if the block is removed).
- F-5 (CF-02): RAISE the `memberKeyIds` `.max(64)` cap (scenario-state.ts:793) to the real eligible-key ceiling — planner researches the actual bound on eligible api_key ids per allocator; if effectively unbounded, pick a defensible generous cap. Do NOT silently clamp the save-time stamp — dropping membership entries silently breaks share-caption honesty (fail-loud).
- F-5 error surface: the composer save path must map the over-cap 400 to honest copy naming the real ceiling, replacing the misleading generic "Couldn't save this portfolio. Check your connection and try again." for this case.
- F-4 (CF-03): one-off re-derive/re-stamp sweep (script, not permanent infra) that finds v4 rows downgraded to v3 shape during the mixed-version deploy window and re-stamps them; run against prod and verify with before/after row evidence. The deploy window is past — no cron, no migration-embedded backfill.

### Deletions & prod cleanup (CF-04 / CF-05)
- CF-04: remove the dead `holdingReturnsByScopeRef` SSR pipeline end-to-end (producer → props → any consumers) with the FULL vitest suite green as the gate. Straight deletion — no deprecation flag. **Scope correction (research finding RISK-1):** `holdingsSummary` is LIVE — it renders the Holdings tab, mandate AUM gates, composer seeding, and drift reference; do NOT delete it. The ROADMAP criterion's `holdingsSummary` half is already satisfied by the v1.6 phase-63 engine-input removal — record that in the SUMMARY rather than deleting live code.
- Prod residue: SELECT-verify the 6 `phase10-rpc-*` auth.users rows match the exact expected pattern and count before DELETE; record the evidence in the SUMMARY.
- D3 source-toggle persistence: DECIDED — no persistence (YAGNI). Document the decision where D3 is tracked; revisit only on user demand.
- Gantt: friendly key labels using the existing label-mapping idiom in the surrounding code.
- AllocationsTabs.tsx:964: replace the payload cast with a parsed/narrowed type (zod parse or type guard consistent with nearby idiom).

### TODOS.md triage policy (CF-06)
- Quick-win threshold: fix in-phase only entries that are small, decision-free, and test-coverable (e.g. `99+` flagged-count badge cap, stale DesktopGate comment rot). Anything requiring product judgment or non-trivial effort stays as a recorded live-debt entry.
- Stale/done entries: verify against live code, then DELETE in the same pass (user's delete-closed-immediately rule) — no strike-through graveyard.
- Verification standard: every surviving entry re-verified against the live codebase with file/symbol evidence; nothing survives on memory alone.
- End state: TODOS.md contains only live, verified debt. The v1.6 red-team section (F-3/F-4/F-5) is removed once CF-01..03 land.

### Claude's Discretion
- Exact new memberKeyIds cap value (research-driven).
- Sweep implementation shape (Node script vs SQL via MCP) and how downgraded rows are detected.
- Which additional TODOS.md entries qualify as quick wins under the threshold above.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isBookOnlyDraft` lives in `src/app/(dashboard)/allocations/lib/scenario-state.ts` with usages in `scenario-share/[token]/share-resolve.ts` and `api/allocator/scenario/share/route.ts` (+ tests).
- `memberKeyIds: z.array(z.string().max(MAX_DRAFT_KEY_LENGTH)).max(64).optional()` at `scenario-state.ts:793`; consumers in `scenario-compare.ts`, `share-resolve.ts`, `api/allocator/scenario/saved/route.ts`.
- `holdingReturnsByScopeRef`/`holdingsSummary` touch `AllocationDashboardV2.tsx`, `HoldingsTabPanel.tsx`, `AllocationsTabs.tsx` and their tests — removal must sweep all of these.

### Established Patterns
- Regression test per found bug, failing without the fix (user standing rule).
- Prod SQL via Supabase MCP with SELECT-before-DELETE evidence; prod project khslejtfbuezsmvmtsdn.
- Vitest with --no-file-parallelism locally for contention flakes.

### Integration Points
- Composer save error copy path (where the generic connection-error message is produced).
- v1.6 membership-v4 code (PR #572) is the substrate for F-3/F-4/F-5 — read its SUMMARY/red-team notes in `.planning/milestones/` archive before editing.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 5 requires TODOS.md to END the phase reflecting only live debt — the triage is a deliverable, not housekeeping.
- Phase 19.1 P1 section in TODOS.md (Plans 07-10) references gated deploy work — triage verifies whether it's still live, does not execute it.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
