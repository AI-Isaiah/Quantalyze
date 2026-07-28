---
phase: 08-connection-management-and-notes
plan: 03
subsystem: frontend
tags: [notes, markdown, autosave, aria-live, widget, layout-version, react-markdown, rehype-sanitize, remark-gfm]

# Dependency graph
requires:
  - phase: 08-connection-management-and-notes
    plan: 01
    provides: "Multi-scope /api/notes GET+PATCH route shape ({scope_kind, scope_ref, content}); react-markdown@10.1.0 + rehype-sanitize@6.0.0 + remark-gfm@4.0.1 lockfile-pinned; user_note.{scope}.update audit enum"
  - phase: 08-connection-management-and-notes
    plan: 02
    provides: "Sequencing — Plan 02 intentionally deferred the LAYOUT_VERSION bump to Plan 03 (NotesWidget integration owns it per UI-SPEC §8)"
provides:
  - "src/components/notes/NoteRender.tsx — shared react-markdown+rehype-sanitize renderer for all 4 scopes"
  - "src/components/notes/sanitize-schema.ts — noteSanitizeSchema (module-scope, hast-util-sanitize defaultSchema extended; img/input/details/summary/picture/source stripped; href restricted to http/https)"
  - "src/components/notes/useNoteAutoSave.ts — on-blur PATCH hook with generation-guard + single 5xx retry; NO unmount flush (S2 fire-and-forget exit contract)"
  - "src/components/notes/NoteSaveStatus.tsx — aria-live status line mirroring MandateSaveStatus (role=status, 2s Note-saved flash, 15s self-tick, formatRelativeTime reused)"
  - "NotesWidget upgraded in place to consume the three primitives; legacy unmount flush DELETED per S2"
  - "dashboard-defaults.ts: LAYOUT_VERSION bumped 2→3 with notes-1 tile at x:0 y:27 w:4 h:4 bound to the existing notes-widget registry slug"
  - ".prose-note CSS block in globals.css (p / h1..h3 / ul / ol / li / code / pre / blockquote / table / th / td / del / hr — design-token keyed, no @tailwindcss/typography dep)"
affects: [08-04]

# Tech tracking
tech-stack:
  added: []  # All three markdown deps shipped in Plan 01; Plan 03 consumes them
  patterns:
    - "Module-scope sanitize schema constant (Pitfall 1 avoidance — prevents ReactMarkdown remount flicker on unrelated re-renders)"
    - "Fire-and-forget exit contract for autosave hooks — no unmount flush; generation-guard is the correctness anchor for in-flight-during-unmount"
    - "Single-retry 5xx simplification of the useMandateAutoSave pattern (drops fieldErrors map, 429 Retry-After, 4-attempt exponential chain)"
    - "LAYOUT_VERSION bump cadence — major DEFAULT_LAYOUT changes force localStorage reset per Voice-D8 accepted tech debt (no user-facing banner)"

key-files:
  created:
    - "src/components/notes/sanitize-schema.ts"
    - "src/components/notes/NoteRender.tsx"
    - "src/components/notes/NoteRender.test.tsx"
    - "src/components/notes/useNoteAutoSave.ts"
    - "src/components/notes/useNoteAutoSave.test.ts"
    - "src/components/notes/NoteSaveStatus.tsx"
    - "src/components/notes/NoteSaveStatus.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx"
    - "src/app/(dashboard)/allocations/widgets/meta/meta.test.tsx"
    - "src/app/(dashboard)/allocations/lib/dashboard-defaults.ts"
    - "src/app/globals.css"

key-decisions:
  - "D-S2 unmount-flush removed — useNoteAutoSave does NOT flush on unmount. Consumers (NotesWidget here; Plan 04's HoldingNoteRow/BridgeOutcomeNoteSection/StrategyNoteCard next) rely on blur (or explicit save before navigation) to persist. Rationale: unmount-flush races with StrictMode double-mount in dev and creates more noise than it resolves for a rare case. Generation guard ensures in-flight responses during unmount do not mutate unmounted state."
  - "Module-scope noteSanitizeSchema — declared as a const at module scope in sanitize-schema.ts, imported by NoteRender as a stable reference. Inline schema re-creation would cause ReactMarkdown subtree remount + visible flicker on unrelated state changes (Pitfall 1)."
  - "Task-list sanitize policy — <input> is stripped by the schema (UI-SPEC §5 intent: no forms in notes). The `- [x] done` GFM task list renders as a plain <li> containing the text 'done' without a literal `[x]` marker. Test updated to assert the shipped policy rather than require the raw <input type=checkbox>."
  - "LAYOUT_VERSION bump 2→3 — Plan 02 intentionally deferred this to Plan 03 because the NotesWidget entry in DEFAULT_LAYOUT is the only material change; bumping at Plan 02 (HoldingsTable, a page-level section not a grid widget) would have triggered a spurious localStorage reset with no grid change. Side effect: existing users lose custom layouts on next load; Voice-D8 accepted trade-off, no banner."
  - "fireEvent over @testing-library/user-event — user-event is not installed in the project. meta.test.tsx uses fireEvent.click/change/blur wrapped in act() for the NotesWidget upgrade cases; matches the shipped convention (0 call sites use user-event)."

patterns-established:
  - "useNoteAutoSave = useMandateAutoSave minus per-field/429/backoff complexity plus explicit NO-unmount-flush JSDoc + the race-guard 'return if generationRef changed' check before every setState write (mirror pattern for any future single-field autosave hook)."
  - "NoteSaveStatus = MandateSaveStatus with copy swaps + new error branch — aria-live mechanics (role=status, self-ticking interval, formatRelativeTime reuse) are verbatim. Any future save-status variant should clone this pair."
  - "`.prose-note` hand-rolled CSS block keyed off design tokens — establishes the convention for markdown-render surfaces in this project without requiring @tailwindcss/typography."
  - "Read/edit toggle pattern on a widget that consumes a shared autosave hook: `editing` state + `draft` buffer + `notes` source-of-truth, with a useEffect to sync draft←notes while not editing. Plan 04's four per-scope surfaces reuse this shape."

requirements-completed:
  - MANAGE-05

# Metrics
duration: 13 min
completed: 2026-04-21
---

# Phase 08 Plan 03: Shared Notes Primitives + NotesWidget Upgrade Summary

**Three shared client primitives shipped (NoteRender, useNoteAutoSave, NoteSaveStatus) consuming the Plan 01 route contract; portfolio-scope NotesWidget upgraded in place to read/edit markdown with on-blur save + aria-live status; LAYOUT_VERSION bumped 2→3 and DEFAULT_LAYOUT adds the notes-1 tile at x:0 y:27 w:4 h:4 so new allocators see the widget out of the box. S2 unmount-flush removed — consumers rely on blur; the generation guard prevents stale state writes after unmount.**

## Performance

- **Duration:** 13 min (824 s)
- **Started:** 2026-04-21T07:09:18Z
- **Completed:** 2026-04-21T07:23:02Z
- **Tasks:** 4 committed (RED + 3× GREEN per TDD cadence)
- **Files created:** 7
- **Files modified:** 4
- **Commits:** 4

## Accomplishments

- **NoteRender + sanitize-schema shipped.** Module-scope `noteSanitizeSchema` (hast-util-sanitize defaultSchema extended) strips `img`, `input`, `details`, `summary`, `picture`, `source`; href restricted to `http`/`https` (D-13). `components.a` override forces `rel="noopener noreferrer" target="_blank"` on every rendered link (T-08-12 tabnabbing mitigation). No `rehype-raw` — raw HTML attack surface is never introduced. 9/9 XSS fuzz + GFM passthrough tests green (heading/bold, script/img/iframe strip, javascript: href dropped, https <a> rewrite, GFM table/strike/task-list).
- **useNoteAutoSave shipped** — on-blur PATCH to `/api/notes` with `{scope_kind, scope_ref, content}` body, 2s auto-fade `saved→idle`, generation-counter race guard, single retry on 5xx or network error after 2s. Drops the useMandateAutoSave complexity (fieldErrors map, 429 Retry-After, 4-attempt exponential chain). **NO unmount flush** — JSDoc pins the S2 contract: `// Contract: NO unmount flush. Consumers rely on blur or explicit save() to persist.` In-flight fetches during unmount are fire-and-forget; the generation guard prevents stale state writes after unmount. 6/6 tests green including the explicit S2 assertion "does NOT flush on unmount — fire-and-forget exit contract".
- **NoteSaveStatus shipped** — aria-live status line cloned from MandateSaveStatus with copy swaps per UI-SPEC §7 ("Saving…", "Note saved" 2s flash, "Last saved: {relative}", "Save failed — retry", idle+no-timestamp → empty). Reuses `.mandate-saved-flash` CSS animation + the same checkmark SVG + `bg-accent/10 text-accent` circle verbatim. 15s self-tick preserved; `formatRelativeTime` imported directly from `../mandate/formatRelativeTime` (no duplication). 6/6 tests green.
- **NotesWidget upgraded in place.** GET uses `?scope_kind=portfolio&scope_ref=<id>` (new Plan 01 contract); save via `useNoteAutoSave("portfolio", id)`; read mode renders markdown through `NoteRender`; Edit affordance toggles to textarea; `NoteSaveStatus` replaces the hand-rolled `<span aria-live>`. The legacy lines 82-95 unmount-flush effect is DELETED per S2 — blur is the sole persistence trigger for this widget. 5/5 new widget-upgrade assertions green.
- **LAYOUT_VERSION bumped 2→3** with a new `notes-1` tile at `x:0 y:27 w:4 h:4` in DEFAULT_LAYOUT, bound to the existing `notes-widget` registry slug. `useDashboardConfig` compares persisted `layoutVersion` against `LAYOUT_VERSION` and resets to defaults on mismatch — users with custom layouts lose them once (Voice-D8 accepted tech debt, no banner).
- **`.prose-note` CSS block added to globals.css** — institutional typography for rendered markdown nodes (p/h1..h3/ul/ol/li/code/pre/blockquote/table/th/td/del/hr), keyed off design-token CSS vars (`--font-mono`, `--color-border`, `--color-page`, `--color-text-muted`). Appended after the existing `.mandate-saved-flash` keyframe. No `@tailwindcss/typography` dependency introduced.
- **Full targeted surface green** — 21/21 notes-primitives tests (9 NoteRender + 6 useNoteAutoSave + 6 NoteSaveStatus); 11/11 meta.test.tsx including 5 new NotesWidget upgrade cases; 183/183 across 20 allocations-tree files; 204 tests total across 23 files in the combined run. `npm run typecheck` clean; `npm run lint` 0 errors (18 pre-existing warnings unchanged).

## Task Commits

1. **Task 1 RED: notes primitives + NotesWidget upgrade tests** — `6566f77` (test)
2. **Task 2 GREEN: NoteRender + sanitize-schema + prose-note CSS** — `966d731` (feat)
3. **Task 3 GREEN: useNoteAutoSave + NoteSaveStatus** — `f993708` (feat)
4. **Task 4 GREEN: NotesWidget upgrade + LAYOUT_VERSION bump** — `0d8b512` (feat)

Strict RED → GREEN cadence per TDD protocol. Four commits; three `feat(08-03):` + one `test(08-03):`.

## Files Created

- `src/components/notes/sanitize-schema.ts` — `noteSanitizeSchema` exported at module scope from `hast-util-sanitize`'s `defaultSchema`. Filters out `img`, `input`, `details`, `summary`, `picture`, `source`. Restricts `href` protocols to `http`/`https`.
- `src/components/notes/NoteRender.tsx` — `"use client"`; `<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, noteSanitizeSchema]]} components={{a: ...}}>`. Link override drops children as plain text when sanitize strips the href (javascript:, etc.); otherwise renders `<a href rel="noopener noreferrer" target="_blank" className="text-accent underline hover:text-accent-hover">`.
- `src/components/notes/NoteRender.test.tsx` — 9 assertions (heading/bold, script/img/iframe/javascript-href strip, https rel+target rewrite, GFM table/strike/task-list passthrough).
- `src/components/notes/useNoteAutoSave.ts` — on-blur PATCH hook, 2s auto-fade saved→idle, generation-counter race guard, retry-once-on-5xx-or-network after 2s. JSDoc pins "Contract: NO unmount flush".
- `src/components/notes/useNoteAutoSave.test.ts` — 6 assertions: happy path (body shape + 2s fade), 4xx no retry, 5xx retry-once, 5xx exhausted, rapid-blur race, does NOT flush on unmount (S2).
- `src/components/notes/NoteSaveStatus.tsx` — aria-live status with 15s self-tick, reuses `.mandate-saved-flash` + `formatRelativeTime`. Copy per UI-SPEC §7.
- `src/components/notes/NoteSaveStatus.test.tsx` — 6 assertions (5 copy states + aria attrs).

## Files Modified

- `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx` — rewritten to consume the three shared primitives. New GET URL shape (`?scope_kind=portfolio&scope_ref=…`). `useNoteAutoSave` replaces the inline save function + 1s debounce. Read/edit toggle (`editing` state + `draft` buffer + `notes` source-of-truth). `NoteRender` renders markdown in read mode; textarea seeded with `draft` in edit mode; `onBlur={onBlurTextarea}` commits draft→notes + fires `save(draft)` + returns to read mode. `NoteSaveStatus` replaces the hand-rolled `<span aria-live>`. Legacy unmount-flush effect DELETED per S2.
- `src/app/(dashboard)/allocations/widgets/meta/meta.test.tsx` — extended with 5 NotesWidget upgrade cases (new fetch URL shape, markdown render in read mode, Edit reveals textarea, on-blur save with new PATCH body shape + no save on keystroke, NoteSaveStatus wired + shows "Note saved"). Switched from hypothetical `@testing-library/user-event` (not in project) to `fireEvent` + `act()` — matches the shipped convention. Existing 6 tests (CustomKpiStrip + QuickActions) preserved unchanged.
- `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts` — `LAYOUT_VERSION` bumped 2→3 with a Phase 08 comment explaining the bump. New tile appended to DEFAULT_LAYOUT: `{ i: "notes-1", widgetId: "notes-widget", x: 0, y: 27, w: 4, h: 4 }` with an above-line comment referencing MANAGE-05 + UI-SPEC §8.
- `src/app/globals.css` — `.prose-note` typography block appended after the existing `.mandate-saved-flash` keyframe + `@media (prefers-reduced-motion: reduce)` override. 13 rules covering p / h1..h3 / ul/ol/li / code / pre / blockquote / table / th / td / del / hr, all keyed off design-token CSS vars.

## Decisions Made

- **S2 unmount-flush removed (plan-level decision, inherited from the plan's `<behavior>` spec).** `useNoteAutoSave` exposes no cleanup effect that triggers a PATCH. The JSDoc on the hook's exported function pins this invariant: `// Contract: NO unmount flush. Consumers rely on blur or explicit save() to persist.` The explicit unit test ("does NOT flush on unmount — fire-and-forget exit contract (S2)") mounts the hook, does not call save(), unmounts, and asserts zero fetch calls. Rationale: unmount-flush would race with StrictMode double-mount in dev and create noise for a rare case; blur covers the dominant user path. For in-flight fetches during unmount, the generation-counter guard ensures any state-update after unmount is a no-op — the fetch is fire-and-forget.
- **Module-scope `noteSanitizeSchema` (Pitfall 1 avoidance).** The schema is declared as a module-scope `const` in `sanitize-schema.ts` and imported by `NoteRender` as a stable reference. Re-creating the schema inline (e.g. `rehypePlugins={[[rehypeSanitize, {...defaultSchema, tagNames: [...]}]]}`) would make the plugin argument array unstable across renders and cause `ReactMarkdown` to remount its subtree — visible flicker on unrelated state changes.
- **Task-list sanitize policy: `<input>` stripped.** The GFM task-list syntax `- [x] done` normally renders as `<li><input type="checkbox" disabled checked>done</li>`. My schema filters `<input>` (UI-SPEC §5 intent: no forms in notes), so the rendered output is a plain `<li>` containing the text "done" without a literal `[x]` marker. The Task 1 plan text left this as "checked checkbox (remark-gfm behaviour)", then gave the planner explicit permission to adjust per the shipped policy. I adjusted the test assertion to match reality ("li contains 'done' and does NOT contain literal '[x]'") — keeping the shipped policy aligned with UI-SPEC §5.
- **fireEvent over user-event.** `@testing-library/user-event` is not installed in the project (only `@testing-library/react@^16.3.2` and `@testing-library/jest-dom`). meta.test.tsx's new NotesWidget upgrade cases use `fireEvent.click/change/blur` wrapped in `act()` — matches the shipped convention across the allocations tree.
- **LAYOUT_VERSION bump timing — Plan 03 owns it (not Plan 02).** Plan 02's HoldingsTable is a page-level `<section>` mounted outside the react-grid-layout container — no DEFAULT_LAYOUT change. Plan 03's NotesWidget addition to DEFAULT_LAYOUT is the first actual grid change in Phase 08; bumping LAYOUT_VERSION here (not earlier) ensures the localStorage reset coincides with the visible DEFAULT_LAYOUT shift users see. Matches Plan 02's deferred-to-Plan-03 hook-forward note.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Test infrastructure] `@testing-library/user-event` not installed**
- **Found during:** Task 1 RED gate run
- **Issue:** My first pass at meta.test.tsx imported `userEvent` from `@testing-library/user-event` as the plan suggested ("Use `userEvent` to click Edit, type into the textarea, and `userEvent.tab()` to blur"). The package is not in `package.json` (only `@testing-library/react` and `@testing-library/jest-dom` are). Vite import-analysis failure on test run.
- **Fix:** Rewrote the NotesWidget upgrade test block to use `fireEvent.click/change/blur` wrapped in `act()`. Matches the shipped convention across the allocations tree (0 call sites consume user-event). Assertion logic is unchanged — just the interaction primitive swap.
- **Files modified:** src/app/(dashboard)/allocations/widgets/meta/meta.test.tsx (import swap + 3 userEvent→fireEvent conversions)
- **Verification:** 11/11 meta.test.tsx GREEN (3 CustomKpiStrip + 5 new NotesWidget upgrade + 3 QuickActions).
- **Committed in:** 6566f77 (Task 1 RED) — the correction was in-line during RED gate authoring.

**2. [Rule 3 — Typecheck hygiene] Literal `\u2026` / `\u2014` in JSX text rendered as escape-sequence text**
- **Found during:** Initial read-back of NoteSaveStatus.tsx after Write
- **Issue:** I initially wrote `<span>Saving\u2026</span>` intending the unicode escape in a string literal. In JSX text content, `\u2026` is NOT interpreted as an escape — it renders as the literal 7-character string `Saving\u2026`. Test assertions use the actual codepoint (`"Saving\u2026"` in a TypeScript string literal IS interpreted as the ellipsis character), so the two would not have matched.
- **Fix:** Replaced `\u2026` → `…` and `\u2014` → `—` (actual unicode characters) in NoteSaveStatus.tsx's JSX text. The test file's string literals (which use TypeScript escape semantics) correctly match against the rendered textContent.
- **Files modified:** src/components/notes/NoteSaveStatus.tsx (2 escape→actual-char swaps)
- **Verification:** 6/6 NoteSaveStatus tests green.
- **Committed in:** f993708 (Task 3 GREEN).

**3. [Rule 3 — Lint hygiene] Unused `waitFor` import in useNoteAutoSave.test.ts**
- **Found during:** `npm run lint` after Task 4
- **Issue:** My Task 1 RED test imported `waitFor` from `@testing-library/react` but ended up using `act` + `vi.advanceTimersByTimeAsync` for the async flows — `waitFor` was never actually called. ESLint flagged the unused import as a warning.
- **Fix:** Dropped `waitFor` from the import list.
- **Files modified:** src/components/notes/useNoteAutoSave.test.ts (1 import line)
- **Verification:** Lint 0 errors; 6/6 useNoteAutoSave tests still green.
- **Committed in:** 0d8b512 (Task 4 commit — the lint cleanup rode the Task 4 commit since it was a single line found during Task 4's lint gate).

---

**Total deviations:** 3 auto-fixed (all Rule 3 — test/code infrastructure hygiene; zero functional deviation from the plan's behavior spec).
**Impact on plan:** The plan executed verbatim at the contract level — all behaviors in `<behavior>` sections landed as specified, all acceptance-criterion greps pass, all test counts match. The three deviations are surface-level hygiene issues that surfaced during writing; none shift the architectural contract.

## Authentication Gates

None. Plan 03 is pure frontend; no external service auth required beyond the Plan 01 route contract already in place.

## Issues Encountered

- **jsdom + LAYOUT_VERSION bump side effect — none observed.** `useDashboardConfig.test.ts` asserts the version-mismatch reset behavior via parametrized expectations (not a hardcoded `layoutVersion: 2` check), so the 2→3 bump required no test edits. Full allocations suite (183/183) ran clean against the new version.

## Hooks for Plan 04 and Beyond

**Plan 04 (per-scope note UIs — holding / bridge_outcome / strategy):**
- Import `NoteRender`, `useNoteAutoSave`, and `NoteSaveStatus` from `@/components/notes/*`. The three primitives are now the authoritative source — Plan 04 should not create duplicate autosave/render/status logic.
- Consumers rely on blur (or an explicit `save()` before navigation) to persist. Unmount flush is NOT provided — if Plan 04 introduces a navigation path where unmount precedes blur (e.g. a modal close button that does not blur the textarea first), the consumer must call `save()` explicitly before closing. The S2 contract is system-wide.
- `buildHoldingScopeRef({venue, symbol, holding_type})` (from `src/lib/notes/scope-ref.ts`, shipped Plan 01) feeds the `scope_ref` argument for holding-scope usage. Plan 02's `HoldingRow` type already exposes `venue`/`symbol`/`holding_type`/`source_key_sync_status` for the inline sub-row.
- Read/edit toggle pattern used in NotesWidget is the reference shape — `editing` state + `draft` buffer + source `notes` + `useEffect(() => { if (!editing) setDraft(notes); }, [notes, editing])` to keep draft in sync when entering read mode.
- For the amber-tinted note icon on revoked-holding rows (UI-SPEC §3), the three-state class can derive directly from the shared `source_key_sync_status === 'revoked'` — no new API or data-layer work.

**Beyond Plan 04 (Phase 09+):**
- If a future phase adds a rate limiter to `/api/notes`, extend `useNoteAutoSave` with the 429 Retry-After branch by cloning from `useMandateAutoSave.ts:134-144`. Until then, the single-retry-on-5xx is correct.
- If unmount flush becomes necessary for a future surface (e.g. a page-level strategy-note card where the user navigates via the browser back button with an unsaved draft), add an OPTIONAL hook parameter `{ flushOnUnmount?: boolean }` rather than flipping the default — the S2 contract is load-bearing for the existing four surfaces' StrictMode stability.

## UI-SPEC / RESEARCH Adherence

No deviations from the locked UI-SPEC §5 + §7 copy or the RESEARCH.md §Pattern 3 / §Pattern 4 code samples. Exact-string adherence:

- Schema filter list: `["img", "input", "details", "summary", "picture", "source"]` (verbatim per RESEARCH.md §Pattern 3).
- Schema href protocols: `["http", "https"]` (verbatim per D-13).
- `<a>` rewrite: `rel="noopener noreferrer" target="_blank" className="text-accent underline hover:text-accent-hover"` (verbatim per RESEARCH.md §Pattern 3).
- NoteSaveStatus copy (UI-SPEC §7): "Saving…", "Note saved", "Last saved: {relative}", "Save failed — retry", idle+no-timestamp → empty.
- `.prose-note` CSS rules: 13 selectors (p / h1..h3 / ul / ol / li / code / pre / blockquote / table / th / td / del / hr) with design-token CSS vars, per UI-SPEC §5 verbatim.
- DEFAULT_LAYOUT entry: `{ i: "notes-1", widgetId: "notes-widget", x: 0, y: 27, w: 4, h: 4 }` (verbatim per UI-SPEC §4a).

## Test Count Delta

- **Before (Phase 08 Plan 02 baseline):** 245/245 across allocations + exchanges (per 08-02-SUMMARY.md).
- **After (Plan 03 delta):**
  - +9 NoteRender.test.tsx
  - +6 useNoteAutoSave.test.ts (includes S2 unmount-flush assertion)
  - +6 NoteSaveStatus.test.tsx
  - +5 meta.test.tsx (NotesWidget upgrade — replaces 2 legacy NotesWidget tests, net +3 on that file: 8→11)
- **Net:** +26 new tests. Combined notes-primitives + allocations run: **204/204 across 23 files GREEN.** No regressions in the broader allocations surface (LAYOUT_VERSION bump does not break useDashboardConfig.test.ts — the version-reset assertion is parametrized).

## Known Stubs

None. All primitives render real data:

- `NoteRender` consumes arbitrary markdown content (no stub — real user-input rendering path).
- `useNoteAutoSave` is a pure hook with no hardcoded UI data; its only "stub" behavior is the initial idle state before any save fires, which is correct.
- `NoteSaveStatus` renders based on `saveState` / `lastSavedAt` props — the idle+no-timestamp empty-render is the shipped UI-SPEC §7 policy, not a stub.
- `NotesWidget` fetches on mount; the loading placeholder ("Loading…") is a transient state, not a stub. The empty-note read mode shows a placeholder paragraph ("Portfolio notes — markdown supported.") which matches the textarea placeholder — consistent across read/edit modes, not a "TODO" marker.

## Threat Flags

No new trust boundaries beyond those cataloged in the plan's `<threat_model>`. The NoteRender XSS surface, the `<a>` tabnabbing mitigation, the rapid-blur race, the markdown bundle lazy-import strategy, the schema-remount flicker, and the accepted-risk unmount-draft loss are all mitigated/accepted per the register. No additional surface introduced.

## Self-Check: PASSED

- [x] `src/components/notes/sanitize-schema.ts` exists
- [x] `src/components/notes/NoteRender.tsx` exists
- [x] `src/components/notes/NoteRender.test.tsx` exists
- [x] `src/components/notes/useNoteAutoSave.ts` exists
- [x] `src/components/notes/useNoteAutoSave.test.ts` exists
- [x] `src/components/notes/NoteSaveStatus.tsx` exists
- [x] `src/components/notes/NoteSaveStatus.test.tsx` exists
- [x] `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx` upgraded (grep `scope_kind=portfolio` returns match; grep `useNoteAutoSave` returns match; grep `NoteRender` returns match; grep `NoteSaveStatus` returns match)
- [x] `src/app/(dashboard)/allocations/lib/dashboard-defaults.ts` has `LAYOUT_VERSION = 3` + `notes-1` tile
- [x] `src/app/globals.css` has `.prose-note` block
- [x] Commit `6566f77` present in `git log` (Task 1 RED)
- [x] Commit `966d731` present in `git log` (Task 2 GREEN)
- [x] Commit `f993708` present in `git log` (Task 3 GREEN)
- [x] Commit `0d8b512` present in `git log` (Task 4 GREEN)
- [x] 204/204 notes + allocations tests green across 23 files
- [x] `npm run typecheck` clean
- [x] `npm run lint` 0 errors
- [x] S2 unmount-flush contract pinned via JSDoc + test

## TDD Gate Compliance

Plan 03's `type: execute` (not `type: tdd`) means the plan-level RED→GREEN→REFACTOR gate is not enforced at the plan level, but each task had `tdd="true"`, and the git log confirms strict task-level cadence:

- `6566f77` — `test(08-03):` RED (all four tests written before any implementation)
- `966d731` — `feat(08-03):` GREEN Task 2 (NoteRender + sanitize-schema + CSS)
- `f993708` — `feat(08-03):` GREEN Task 3 (useNoteAutoSave + NoteSaveStatus)
- `0d8b512` — `feat(08-03):` GREEN Task 4 (NotesWidget upgrade + LAYOUT_VERSION)

RED gate verified: the Task 1 commit's tests all failed when run against the pre-Task-2 tree (module resolution errors on NoteRender/useNoteAutoSave/NoteSaveStatus + assertion failures on the legacy NotesWidget URL shape). GREEN gates verified after each feat commit.

---

*Phase: 08-connection-management-and-notes*
*Plan: 03*
*Completed: 2026-04-21*
