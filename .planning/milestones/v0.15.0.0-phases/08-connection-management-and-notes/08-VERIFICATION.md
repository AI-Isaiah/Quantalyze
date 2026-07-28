---
phase: 08-connection-management-and-notes
verified: 2026-04-21T11:30:00Z
status: resolved
status_was: human_needed (until 2026-04-27)
resolution_pointer: ../UAT-AUDIT-2026-04-27.md#phase-08-connection-management-and-notes-v01500--shipped
resolution_rationale: "3 human-verification items covered by tests + 2026-04-27 milestone-wrap QA report. (1) Cross-allocator strategy-note privacy: covered by user-notes-rls.test.ts live-DB regression. (2) OutcomesWidget lazy-fetch race: cancelled-flag pattern verified by code review. (3) Disconnect modal cascade semantics: covered by disconnect/route.test.ts both-paths assertion. QA report explicitly cleared all three (.gstack/qa-reports/qa-report-quantalyze-v0.15-v0.16-milestone-wrap-2026-04-27.md)."
score: 5/5 roadmap success criteria verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5 roadmap success criteria verified (1 partial)
  gaps_closed:
    - "SC#3 holding-scope note read-back: HoldingNoteRow now lazy-fetches on mount via useEffect mirroring BridgeOutcomeNoteSection. 200 → read mode with seeded content; 404 → empty edit mode; network error → empty edit mode. Loading gate rendered before fetch resolves. 4 regression tests (RED: prefix) green in CI."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Cross-allocator strategy-note privacy on /strategy/[id]"
    expected: >-
      Log in as allocator A, visit any published /strategy/[id], type a strategy
      note, blur to save. Log out, log in as allocator B in a separate browser
      session, visit the same /strategy/[id]. EXPECTED: the card renders with an
      empty editor (B's own note, which does not exist), NOT A's note content.
      RLS + server-side user-scoped fetch should enforce this; worth a live
      confirmation before declaring MANAGE-05 shipped to pilot LPs.
    why_human: "Requires two authenticated sessions + DB state; not feasible under automated test harness for final QA sign-off"
  - test: "OutcomesWidget lazy-fetch race on rapid expand/collapse"
    expected: >-
      Click an outcome row's caret to expand; before the note GET resolves,
      click the caret again to collapse. Expand a different outcome row.
      EXPECTED: only the second row's note content appears; no stale content
      from the first row leaks in. The BridgeOutcomeNoteSection `cancelled`
      flag should prevent this. Verify visually the Notes section never flashes
      unrelated content.
    why_human: "Timing-sensitive behaviour under network latency; jsdom cannot reliably reproduce the race in CI"
  - test: "Disconnect modal cascade semantics against live delete_allocator_api_key RPC"
    expected: >-
      On /profile?tab=exchanges, click Disconnect on a test key with historical
      holdings. Confirm cascade checkbox defaults UNCHECKED. Click Disconnect
      with checkbox unchecked → key row removed, historical allocator_holdings
      rows retained (query via dashboard or SQL). Reconnect, sync, get fresh
      holdings. Disconnect again with cascade checkbox CHECKED → key row
      removed AND historical allocator_holdings rows deleted. RPC call shape
      verified by route test; live-RPC integration worth a smoke check.
    why_human: "Requires live DB + a reconnect-sync cycle to meaningfully test; covered by tests at unit level but not end-to-end"
---

# Phase 08: Connection Management and Notes Verification Report

**Phase Goal:** Allocators have a production-grade settings surface for their connections (list / resync / revoke / delete) and a multi-scope notes capability that works across portfolio, holdings, bridge outcomes, and strategies.

**Verified:** 2026-04-21T11:30:00Z
**Status:** human_needed (5/5 truths automated-verified; 3 manual QA probes remain open)
**Re-verification:** Yes — after Plan 05 gap closure (previous status: gaps_found, score: 4/5 partial)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Allocator visits `/connections`, sees every connected API key with venue/last-sync/status, performs resync, revoke, and delete actions | ✓ VERIFIED | `/connections` retired pre-Phase-08 (migration 069); surface is `/profile?tab=exchanges` via `AllocatorExchangeManager`. Plan frontmatter + 08-UI-SPEC §1 both target this component. Sync-now + revoke + Disconnect rename + cascade modal all present. |
| SC2 | Revoking key stops syncs + flags holdings stale in UI; deleting cascades future syncs but preserves historical rows | ✓ VERIFIED | HoldingsTable renders revoked-key rows with `line-through` on numeric cells + amber "Key revoked" chip (HoldingsTable.tsx:180-209). Cascade semantics in `delete_allocator_api_key` RPC (migration 069); Disconnect modal surfaces `p_cascade_holdings` checkbox (default UNCHECKED per D-02, line 670). |
| SC3 | Allocator can attach a markdown note to portfolio, holding, bridge_outcome, strategy; auto-saves on blur | ✓ VERIFIED | All four scopes now save AND read back correctly. Portfolio (NotesWidget lazy-fetch on mount), holding (HoldingNoteRow lazy-fetch on mount — Plan 05 fix), bridge_outcome (BridgeOutcomeNoteSection lazy-fetch on mount), strategy (StrategyNoteCard server-side prefetch in /strategy/[id]/page.tsx). |
| SC4 | Every note write audit-logged via `log_audit_event`; owner-RLS enforced | ✓ VERIFIED | route.ts:170-179 calls `logAuditEvent` with `user_note.${scope_kind}.update`; audit.ts:107-110 declares 4 new AuditAction literals; migration 071 owner-RLS policy; live-DB multi-actor RLS regression probe green when HAS_LIVE_DB. |
| SC5 | Portfolio-scope notes pinned on `/allocations`; holding-scope notes inline on holdings row; outcome-scope notes on outcomes timeline | ✓ VERIFIED | NotesWidget at default layout x:0 y:27 w:4 h:4 (dashboard-defaults.ts:38); HoldingsTable trailing note-icon column + HoldingNoteRow expandable sub-row; OutcomesWidget ExpandedPanel appends `BridgeOutcomeNoteSection`; StrategyNoteCard on /strategy/[id]. |

**Score:** 5/5 roadmap success criteria fully verified.

### Re-verification Gap Closure

**Gap closed:** SC#3 holding-scope read-back (VERIFICATION.md gaps[0] / IN-04 / MANAGE-05).

**Root cause (prior report):** `HoldingNoteRow` seeded state exclusively from `props.initialContent` (always `""` because `HoldingsTable`'s `notesByHoldingScopeRef` prop was never populated by `AllocationDashboard`). Saved notes appeared lost to the allocator on every sub-row re-open.

**Fix shipped (Plan 05, commit 278c819):** Added a `useEffect` with `cancelled`-flag cleanup that fires `GET /api/notes?scope_kind=holding&scope_ref=${encodeURIComponent(scope_ref)}` on mount — exact pattern mirror of `BridgeOutcomeNoteSection`. State transitions:

- 200 → `setContent(c)` + `setDraft(c)` + `setInitialSavedAt(updated_at)` + `setEditing(!c)` (read mode if content present)
- 404 → `setEditing(true)` (empty edit mode)
- network error → `setEditing(true)` (fallback edit mode; save-state surfaces errors)
- `finally` → `setInitialLoaded(true)` (lifts the loading gate)

A loading gate (`<tr><td colSpan={...}><div><p>Loading…</p></div></td></tr>`) renders while the fetch is in flight so the HTML5 table content model is satisfied and no DOM warnings fire.

**Regression tests (commit 2eb38f9 RED → 278c819 GREEN):** 4 new tests in `HoldingNoteRow.test.tsx` with `"RED:"` prefix now pass:

- `RED: fires lazy GET on mount with URL-encoded holding scope_ref` — confirms fetch fires with `binance%3ABTC%3Aspot` encoding + `credentials: "same-origin"`
- `RED: 200 response seeds read-mode NoteRender with persisted content (IN-04 closure)` — directly proves the lived-experience probe: "saved thesis" appears in `NoteRender`, no textarea
- `RED: 404 response resolves loading gate to empty edit-mode textarea` — confirms empty-state path via network, not the hollow prop
- `RED: renders 'Loading…' gate before the mount fetch resolves` — confirms the deferred-promise loading gate

**HoldingsTable.test.tsx T18+T19 Rule 1 fix (commit 278c819):** Test previously expected 1 fetch call (the PATCH). With the mount GET added, T18+T19 queues 404→200 (2 calls) and asserts `fetchSpy.mock.calls[1]` for the PATCH shape. 14 HoldingsTable sub-row tests still pass.

**Full suite:** 1539 passed / 0 failed / 66 skipped across 158 files (confirmed live run).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/071_user_notes_multiscope.sql` | user_notes reshape + self-verify DO block | ✓ VERIFIED | Applied live per 08-01-SUMMARY; DO-NOTICE confirmed; 7 RAISE-EXCEPTION guards. |
| `src/app/api/notes/route.ts` | GET + PATCH with per-scope ownership | ✓ VERIFIED | Full rewrite; zod validation; 100KB byte-cap; checkScopeOwnership; onConflict string `user_id,scope_kind,scope_ref`. |
| `src/lib/notes/scope-ref.ts` | buildHoldingScopeRef + parseHoldingScopeRef + HOLDING_SCOPE_RE | ✓ VERIFIED | 45 lines; strict regex; unit tests pass. |
| `src/lib/notes/ownership.ts` | Per-scope ownership switch | ✓ VERIFIED | `server-only` import; 4-scope switch; strategies.status='published' filter. |
| `src/lib/audit.ts` | 4 `user_note.*.update` literals | ✓ VERIFIED | Lines 107-110; only a comment reference on line 106. |
| `docs/architecture/adr-0023-audit-event-taxonomy.md` | 4 user_note.*.update rows + narrative | ✓ VERIFIED | 15 `user_note.*.update` matches. |
| `src/components/exchanges/AllocatorExchangeManager.tsx` | Disconnect rename + cascade modal | ✓ VERIFIED | Button label, modal copy, default unchecked, RPC wiring. |
| `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` | Revoked-key UI + toggle + trailing note column | ✓ VERIFIED | Full implementation with Fragment-wrapped sub-rows. |
| `src/app/(dashboard)/allocations/AllocationDashboard.tsx` | showRevoked state + localStorage | ✓ VERIFIED | REVOKED_STORAGE_KEY + loadShowRevoked + useEffect persistence. |
| `src/components/notes/NoteRender.tsx` | Shared markdown render (rehype-sanitize) | ✓ VERIFIED | 55 lines; schema imported from module scope. |
| `src/components/notes/sanitize-schema.ts` | hast-util-sanitize schema | ✓ VERIFIED | 31 lines; tag removals + href http/https allowlist. |
| `src/components/notes/useNoteAutoSave.ts` | On-blur PATCH with generation-guard + 2s retry | ✓ VERIFIED | 117 lines; S2 no-unmount-flush contract documented. |
| `src/components/notes/NoteSaveStatus.tsx` | Aria-live status 5-state | ✓ VERIFIED | 85 lines; reuses mandate-saved-flash CSS. |
| `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx` | Portfolio-scope notes widget | ✓ VERIFIED | Uses new /api/notes?scope_kind=portfolio shape. |
| `src/components/notes/HoldingNoteRow.tsx` | HoldingNoteIconButton + HoldingNoteRow with lazy GET | ✓ VERIFIED | 269 lines; useEffect (grep: 2), scope_kind=holding (grep: 1), cancelled=true (grep: 1), Loading (grep: 2), res.status===404 (grep: 1). Plan 05 fix confirmed present. |
| `src/components/notes/BridgeOutcomeNoteSection.tsx` | Bridge outcome lazy-fetch note section | ✓ VERIFIED | 131 lines; cancelled-flag useEffect; lazy GET on mount. |
| `src/components/notes/StrategyNoteCard.tsx` | Strategy-page full-width note card | ✓ VERIFIED | 86 lines; server-side prefetch from /strategy/[id]/page.tsx. |
| `src/app/strategy/[id]/page.tsx` | StrategyNoteCard insertion + server-side fetch | ✓ VERIFIED | Auth-gated user_notes query + card mount between sparkline and CTA. |
| `package.json` markdown deps pinned exactly | react-markdown@10.1.0, rehype-sanitize@6.0.0, remark-gfm@4.0.1 | ✓ VERIFIED | No `^` prefix on any of the three. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|------|-----|--------|---------|
| /api/notes PATCH | checkScopeOwnership | `await checkScopeOwnership(supabase, user.id, scope_kind, scope_ref)` | ✓ WIRED | route.ts:134-139; 403 on `!own.ok`. |
| /api/notes PATCH | user_notes upsert | onConflict "user_id,scope_kind,scope_ref" | ✓ WIRED | route.ts:155. |
| /api/notes PATCH | logAuditEvent | action: `user_note.${scope_kind}.update` | ✓ WIRED | route.ts:170-179. |
| Migration 071 | user_notes composite UNIQUE | `CREATE UNIQUE INDEX user_notes_unique_multiscope` | ✓ WIRED | 071:84-85. |
| NotesWidget | /api/notes (new shape) | fetch with scope_kind=portfolio + scope_ref=portfolio.id | ✓ WIRED | NotesWidget.tsx:46. |
| HoldingNoteRow | /api/notes GET | `fetch(\`/api/notes?scope_kind=holding&scope_ref=${encodeURIComponent(scope_ref)}\`, { credentials: "same-origin" })` on mount | ✓ WIRED | HoldingNoteRow.tsx:162-165 (Plan 05 fix). Previously NOT_WIRED — now confirmed wired. |
| HoldingNoteRow | buildHoldingScopeRef | `buildHoldingScopeRef({venue, symbol, holding_type})` | ✓ WIRED | HoldingNoteRow.tsx:131-135. |
| HoldingNoteRow | useNoteAutoSave("holding", ...) | scope_ref derived inline; third arg is `initialSavedAt` state (not prop) | ✓ WIRED | HoldingNoteRow.tsx:194-198. |
| OutcomesWidget | BridgeOutcomeNoteSection | `<BridgeOutcomeNoteSection outcomeId={outcome.id} />` inside ExpandedPanel | ✓ WIRED | OutcomesWidget.tsx:395. |
| /strategy/[id]/page.tsx | StrategyNoteCard | server-side user_notes read + conditional render | ✓ WIRED | page.tsx:100-113, 191-196. |
| AllocatorExchangeManager | delete_allocator_api_key RPC | `p_cascade_holdings: cascadeHoldings` | ✓ WIRED | AllocatorExchangeManager.tsx:195-198. |
| AllocationDashboard | localStorage 'allocations.showRevokedHoldings' | useState(loadShowRevoked) + useEffect setter | ✓ WIRED | AllocationDashboard.tsx:48-50, 284, 287-291. |

### Data-Flow Trace (Level 4)

| Surface | Data Variable | Source | Produces Real Data | Status |
|---------|---------------|--------|--------------------|--------|
| NotesWidget | `notes` state | GET /api/notes?scope_kind=portfolio on mount | ✓ DB query + real data | ✓ FLOWING |
| HoldingNoteRow | `content` + `draft` state | GET /api/notes?scope_kind=holding&scope_ref=<encoded> on mount (Plan 05 fix) | ✓ Live /api/notes route queries `user_notes` table with owner-RLS filter | ✓ FLOWING |
| BridgeOutcomeNoteSection | `content` state | GET /api/notes?scope_kind=bridge_outcome&scope_ref=<outcome.id> on mount | ✓ Lazy-fetch on every mount | ✓ FLOWING |
| StrategyNoteCard | `initialContent` prop | /strategy/[id]/page.tsx server-side user_notes query | ✓ Server-side prefetch | ✓ FLOWING |

All four scopes now flow real data from the DB to the UI. The previous HOLLOW_PROP status on HoldingNoteRow is resolved.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| HoldingNoteRow.test.tsx (15 tests incl. 4 RED→GREEN) | `npx vitest run src/components/notes/HoldingNoteRow.test.tsx` | 15 passed / 0 failed | ✓ PASS |
| Full vitest surface | `npx vitest run` | 1539 passed / 0 failed / 66 skipped (158 files) | ✓ PASS |
| useEffect present in HoldingNoteRow.tsx | `grep -c 'useEffect' HoldingNoteRow.tsx` | 2 | ✓ PASS |
| fetch URL with scope_kind=holding present | `grep -c 'scope_kind=holding' HoldingNoteRow.tsx` | 1 | ✓ PASS |
| cancelled-flag cleanup present | `grep -c 'cancelled = true' HoldingNoteRow.tsx` | 1 | ✓ PASS |
| Loading gate present | `grep -c 'Loading' HoldingNoteRow.tsx` | 2 | ✓ PASS |
| 404 branch present | `grep -c 'res.status === 404' HoldingNoteRow.tsx` | 1 | ✓ PASS |
| No out-of-scope drift | `git diff --name-only f72754a..HEAD -- src/ supabase/migrations/` | `HoldingNoteRow.tsx`, `HoldingNoteRow.test.tsx`, `HoldingsTable.test.tsx` only | ✓ PASS |
| Shape parity with BridgeOutcomeNoteSection | Manual comparison of useEffect blocks | Identical pattern: cancelled flag, async IIFE, 200 → seed+setEditing(!c), 404 → setEditing(true), catch → setEditing(true), finally → setInitialLoaded(true) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MANAGE-01 | 08-02 | `/connections` lists every connected API key with venue, last-sync, status, actions | ✓ SATISFIED | AllocatorExchangeManager + 7-state sync pill + Sync now + Disconnect modal. |
| MANAGE-02 | 08-02 | API key revocation: `sync_status='revoked'`, stops enqueueing, retains + flags holdings stale | ✓ SATISFIED | HoldingsTable revoked-key strikethrough + amber chip + showRevoked toggle (D-04 historical inclusion invariant honoured). |
| MANAGE-03 | 08-02 | API key delete removes key row; historical `allocator_holdings` rows retained | ✓ SATISFIED | `delete_allocator_api_key` RPC with `p_cascade_holdings=false` default; migration 069 semantics. |
| MANAGE-04 | 08-01, 08-03 | New `user_notes` table with owner-RLS, multi-scope, markdown body with length cap | ✓ SATISFIED | Migration 071 + checkScopeOwnership + 100KB byte-cap. |
| MANAGE-05 | 08-03, 08-04, 08-05 | Portfolio-scope Notes card on /allocations; per-holding Note on holdings rows; per-outcome Note on outcomes timeline | ✓ SATISFIED | All four surfaces exist, mount correctly, and read back saved notes. Holding-scope read-back closed by Plan 05 lazy GET. |
| MANAGE-06 | 08-01, 08-03 | Notes UI: inline edit, auto-save-on-blur, markdown rendering, every write audit-logged | ✓ SATISFIED | useNoteAutoSave on-blur only (no unmount flush per S2); NoteRender for markdown; PATCH handler logs `user_note.${scope_kind}.update`. |

All 6 MANAGE-* requirement IDs fully satisfied. No orphaned requirements.

**Note on REQUIREMENTS.md traceability table:** The table currently marks MANAGE-04, MANAGE-05, and MANAGE-06 as "Pending". Based on this verification all three are Complete. The orchestrator should update these three rows and flip Phase 08 status to complete in the progress table. This verifier does not modify REQUIREMENTS.md per its mandate.

### Anti-Patterns Found

| File | Line(s) | Pattern | Severity | Impact |
|------|---------|---------|----------|--------|
| `src/app/(dashboard)/allocations/AllocationDashboard.tsx` | 895-899 | HoldingsTable mount omits `notesByHoldingScopeRef` — icon-state always outlined until sub-row opened once | ℹ️ Info (downgraded from Warning; the lived-experience gap is closed by Plan 05) | Icon stays outlined before first open. Accepted tech debt; Phase 11+ follow-up (option b server-side prefetch). |
| `src/components/notes/BridgeOutcomeNoteSection.tsx` | 45-79 | Non-404 load errors silently fall through to empty state (WR-03) | ℹ️ Info | User sees empty placeholder on 401/500 — minor UX inconsistency; does NOT break the phase goal. |
| `src/components/notes/useNoteAutoSave.ts` | 66-110 | `save()` callable with empty `scope_ref` (WR-01) | ℹ️ Info | Defensive guard missing inside the hook; future refactor risk only. |
| `src/components/notes/sanitize-schema.ts` | 24-31 | Mutable module-scope schema const (IN-03) | ℹ️ Info | Object.freeze would close a theoretical mutation surface; not a live issue. |
| `src/components/notes/NoteSaveStatus.tsx` | 41-46 | 15s tick interval always-on regardless of elapsed time (IN-07) | ℹ️ Info | Cost scaling concern when many instances mount at once; not a blocker. |
| `src/components/exchanges/AllocatorExchangeManager.tsx` | 236-256 | 5s always-on poll regardless of sync state (IN-06) | ℹ️ Info | Pre-Phase-08 tech debt (from ISSUE-005); tracked for Phase 11 or later. |
| `supabase/migrations/071_user_notes_multiscope.sql` | 91 | `DROP COLUMN portfolio_id` irreversible without a forward migration (IN-05) | ℹ️ Info | Documentation-only concern; D-23 atomic-commit mandate makes rollback the acceptable forward path. |
| Multiple files | `ScopeKind` type redeclared (IN-01) | ℹ️ Info | Future-addition friction; nothing breaks today. |

No blockers. All remaining anti-patterns are Info-tier and pre-existed Plan 05.

### Human Verification Required

Three items defer to human confirmation (unchanged from prior verification — Plan 05 did not affect any of these):

1. **Cross-allocator strategy-note privacy on /strategy/[id]**
   **Test:** Log in as allocator A, visit any published `/strategy/[id]`, type a strategy note, blur to save. Log out, log in as allocator B in a separate browser session, visit the same `/strategy/[id]`.
   **Expected:** Card renders with an empty editor (B's own note, which does not exist), NOT A's note content. RLS + server-side user-scoped fetch should enforce this.
   **Why human:** Requires two authenticated sessions + DB state; not feasible under automated test harness for final QA sign-off.

2. **OutcomesWidget lazy-fetch race on rapid expand/collapse**
   **Test:** Click an outcome row's caret to expand; before the note GET resolves, click the caret again to collapse. Expand a different outcome row.
   **Expected:** Only the second row's note content appears; no stale content from the first row leaks in. The `BridgeOutcomeNoteSection` `cancelled` flag should prevent this.
   **Why human:** Timing-sensitive behaviour under network latency; jsdom cannot reliably reproduce the race in CI.

3. **Disconnect modal cascade semantics against live delete_allocator_api_key RPC**
   **Test:** On `/profile?tab=exchanges`, click Disconnect on a test key with historical holdings. Confirm cascade checkbox defaults UNCHECKED. Click Disconnect unchecked → key row removed, historical `allocator_holdings` rows retained. Reconnect, sync, get fresh holdings. Disconnect again with cascade CHECKED → key row removed AND historical rows deleted.
   **Expected:** Both cascade=false and cascade=true paths produce the documented DB state.
   **Why human:** Requires live DB + a reconnect-sync cycle to meaningfully test; covered by unit tests but not end-to-end.

**Note:** The prior "Holding note persistence round-trip" human probe (highest-priority, IN-04 lived-experience) is now **closed** by the Plan 05 automated fix. Probes 2–4 (now renumbered 1–3 above) remain open.

### Gaps Summary

No gaps remain. The single partial truth from the initial verification (SC#3 holding-scope read-back) is now fully closed by Plan 05. All five roadmap success criteria are verified against the actual codebase.

The phase goal — "Allocators have a production-grade settings surface for their connections (list / resync / revoke / delete) and a multi-scope notes capability that works across portfolio, holdings, bridge outcomes, and strategies" — is achieved. Automated verification is complete. Status is `human_needed` because the three manual QA probes above remain open; they do not block automated correctness but should be exercised before declaring Phase 08 shipped to pilot LPs.

---

_Verified: 2026-04-21T11:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification after Plan 05 gap closure (previous: gaps_found → current: human_needed)_
