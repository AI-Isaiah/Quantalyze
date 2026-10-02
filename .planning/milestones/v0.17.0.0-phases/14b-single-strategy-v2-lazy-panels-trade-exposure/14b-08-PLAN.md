---
phase: 14b
plan: 08
type: execute
wave: 4
depends_on: [14b-07]
files_modified:
  - src/lib/strategy-ui-v2-flag.ts
  - src/lib/strategy-ui-v2-flag.test.ts
  - .github/PULL_REQUEST_TEMPLATE.md
  - DESIGN.md
autonomous: true
requirements: [KPI-23b]
requirements_addressed: [KPI-23b]
tags: [flag-flip, pr-template, design-decisions-log, milestone-final]
must_haves:
  truths:
    - "isStrategyUiV2Enabled() returns true by default in client browser context (no localStorage / no URL override)"
    - "SSR returns false (NOT true) — keeps server-rendered HTML on the v1 path so users with localStorage='false' do not see a hydration mismatch (Grok B-05)"
    - "isStrategyUiV2EnabledClient() is the new browser-only helper consumers call from useEffect, mirroring the Phase 11 widget-state-flag.ts SSR-safe pattern"
    - "URL override ?strategy_v2=off still forces v1 (regression-tested)"
    - "URL override ?strategy_v2=on still forces v2"
    - "localStorage 'strategy.ui_v2'='false' still forces v1 (legacy users who manually opted out keep their choice)"
    - "PR template extended with 4-history-band × 7-panel partial-data matrix (Pitfall 17 KPI-23b)"
    - "DESIGN.md decisions log gains a new dated entry stamping the strategy.ui_v2 flag flip OFF→ON with the SSR-safe two-pass mount note"
    - "All Phase 14b panels render against the default-on path without env-var overrides, in the browser, after hydration"
  artifacts:
    - path: "src/lib/strategy-ui-v2-flag.ts"
      provides: "Default-ON behavior for browsers, SSR returns false (Grok B-05 — prevents hydration mismatch). Explicit OFF override paths preserved."
    - path: "src/lib/strategy-ui-v2-flag.test.ts"
      provides: "Updated test cases asserting the new default + override precedence + SSR-safe two-pass behavior"
    - path: ".github/PULL_REQUEST_TEMPLATE.md"
      provides: "4×7 partial-data matrix table extending the existing 8-box chart-identity checklist"
    - path: "DESIGN.md"
      provides: "Decisions log entry: 2026-04-29 strategy.ui_v2 default OFF→ON (SSR-safe two-pass mount per Grok B-05)"
  key_links:
    - from: "src/lib/strategy-ui-v2-flag.ts"
      to: "consumer call sites (Plan 14a's redirect logic that may key off this flag)"
      via: "Client-only flag read via useEffect — server returns false, client useEffect upgrades to true on default. Mirrors src/lib/widget-state-flag.ts pattern."
---

<objective>
**Final commit of Phase 14b.** Three coordinated changes:

1. **Flip `strategy.ui_v2` default OFF → ON in CLIENT context only** (Grok B-05). The current implementation returns `false` when neither URL override nor localStorage is set; flip the BROWSER fall-through to return `true` while keeping the SSR branch returning `false`. This avoids the hydration mismatch where SSR would render v2, then a user with `localStorage='false'` would re-render v1 on mount, causing flash + React hydration warning.
   - Server-side render (`typeof window === "undefined"`): returns **false** (NOT changed; matches the safe pattern from `src/lib/widget-state-flag.ts:isWidgetStateV2Enabled`).
   - URL `?strategy_v2=off|false` → false (force v1)
   - URL `?strategy_v2=on|v2|true` → true (force v2)
   - localStorage `strategy.ui_v2='false'` → false (legacy opt-out persists)
   - localStorage `strategy.ui_v2='true'` → true
   - localStorage absent / other → **true** (NEW default; client-side only)
   - Consumer pattern: route components read the flag in a `useEffect` after hydration. SSR renders the v1 path; client mount swaps to v2 ONLY when the flag resolves true post-hydration. Document the consumer pattern in the JSDoc for future readers.

2. **Extend PR template** — add the 4-history-band × 7-panel partial-data matrix per UI-SPEC §4.3 + Pitfall 17. PR authors must check off each cell when their change touches the v2 surface.

3. **Stamp DESIGN.md decisions log** — append a new dated row capturing the flag flip and the partial-data matrix institutionalization. Include the SSR-safe pattern note.

This plan ships ONLY after Plans 14b-01 through 14b-07 are complete and the gating tests in 14b-07 are green (axe / keyboard / chart-parity / partial-data extended). It is the milestone-closing commit for v0.17.0.0.

Purpose: KPI-23b mitigation institutionalization (Pitfall 17 partial-data matrix) + flip the route default so allocators visiting `/strategy/[id]` get redirected to `/strategy/[id]/v2` going forward, hydration-safe (Grok B-05). The v1 → v2 redirect itself is OUT of scope (per CONTEXT.md `<deferred>`: "Universal getStrategyDetailV2 adoption / v1 → v2 cutover removing /strategy/[id]/page.tsx — Sprint 13 item; happens AFTER 14b ships and the flag flips"). Plan 14b-08 only changes the FLAG default; the v1 cutover follow-up tracks separately in v0.17.1.

Output: 1 flag-file edit + 1 test file update + 1 PR template extension + 1 DESIGN.md decisions log row.

**Revision (2026-04-29 Grok B-05):** Original plan flipped SSR to return true. That would create a hydration mismatch for users with `localStorage='false'` (SSR true → client false). The fix: SSR keeps returning false (matches widget-state-flag.ts pattern). The default-true semantic applies ONLY to the client-side fall-through. Consumers MUST read the flag in `useEffect` (client-only) and update their state on hydration. The two-pass pattern is documented in the flag's JSDoc.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-CONTEXT.md
@.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md
@DESIGN.md
@src/lib/strategy-ui-v2-flag.ts
@src/lib/strategy-ui-v2-flag.test.ts
@src/lib/widget-state-flag.ts
@.github/PULL_REQUEST_TEMPLATE.md

<interfaces>
<!-- Pre-existing contracts the executor uses. -->

From src/lib/strategy-ui-v2-flag.ts (Phase 14a-01) — current shape:

```typescript
export const STRATEGY_UI_V2_STORAGE_KEY = "strategy.ui_v2";
export const STRATEGY_UI_V2_URL_OVERRIDE = "strategy_v2";

export interface StrategyUiV2Options {
  search?: string;
}

export function isStrategyUiV2Enabled(opts?: StrategyUiV2Options): boolean {
  // SSR-safe default OFF in Phase 14a. Flips to ON in Phase 14b.
  if (typeof window === "undefined") return false;

  const search = opts?.search ?? window.location.search;
  const params = new URLSearchParams(search);
  const override = params.get(STRATEGY_UI_V2_URL_OVERRIDE);
  if (override === "v2" || override === "true" || override === "on") {
    return true;
  }
  if (override === "off" || override === "false") {
    return false;
  }

  // Fall through to localStorage (default OFF — Phase 14a contract).
  try {
    const raw = window.localStorage.getItem(STRATEGY_UI_V2_STORAGE_KEY);
    if (raw === "true") return true;
    return false;
  } catch {
    return false;
  }
}
```

The SSR branch + URL-override paths stay; only the localStorage fall-through changes. **Grok B-05**: the SSR branch keeps returning `false` to prevent hydration mismatch. Only the BROWSER fall-through is flipped to `true`.

From src/lib/widget-state-flag.ts (Phase 11 — canonical SSR-safe pattern, REUSED here):

```typescript
export function isWidgetStateV2Enabled(opts?: WidgetStateV2Options): boolean {
  // SSR-safe default OFF — there is no localStorage on the server, and
  // the long-tail widgets must keep their pre-Phase-11 behavior until a
  // browser-side flip (or URL override on a real request) flips it ON.
  if (typeof window === "undefined") return false;
  // ... URL override / localStorage logic ...
}
```

Plan 14b-08's `strategy.ui_v2` flag mirrors this pattern. The default is "ON in browser, OFF on server"; consumers do a useEffect-based two-pass mount (initial render = SSR-default = v1, then post-hydration upgrade to v2 if the flag resolves true).

CONTEXT.md §"Flag flip" specifies the exact contract shape: "When flipped: visiting `/strategy/[id]` (v1) AUTO-REDIRECTS to `/strategy/[id]/v2` for users without an explicit OFF override. URL override `?strategy_v2=off` still forces v1 for any user." The redirect ITSELF is the v0.17.1 follow-up. Plan 14b-08 only changes the flag's default value — consumers that READ the flag will see `true` going forward (in the browser, post-hydration).

From .github/PULL_REQUEST_TEMPLATE.md (Phase 14a-06 — current shape, 33 LOC):

```markdown
## Summary
...
## Test plan
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] Playwright E2E specs for affected routes pass (if applicable)
- [ ] Manual smoke on the changed surface — describe what was tested and how

## Identity audit (per-chart)
[8-box checklist]

## Notes
```

Per UI-SPEC §4.3 + 14B-CONTEXT.md PR template extension: add a new section "Partial-data matrix" with a 4×7 grid.

From DESIGN.md ## Decisions Log (lines 126-138 — current 9 rows):

```
| Date | Decision | Rationale |
| 2026-04-29 | UC#7 — accept 7-panel single-strategy density-rule deviation | ... |
| 2026-04-29 | v2 single-strategy 4-size / 2-weight type contract | ... |
```

The new entry follows the same format. Date = `2026-04-29` per CLAUDE.md `currentDate`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Flip strategy.ui_v2 default OFF → ON (browser-side only — Grok B-05 SSR-safe pattern)</name>
  <files>src/lib/strategy-ui-v2-flag.ts, src/lib/strategy-ui-v2-flag.test.ts</files>
  <read_first>
    - src/lib/strategy-ui-v2-flag.ts (current 62 LOC implementation)
    - src/lib/strategy-ui-v2-flag.test.ts (Phase 14a — 10 tests, currently asserts default OFF; 2-3 cases need polarity flipped)
    - src/lib/widget-state-flag.ts (Phase 11 — the canonical SSR-safe pattern this plan mirrors)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §11 (pre-flip gating checklist + flag-flip contract)
  </read_first>
  <behavior>
    - **Test 1 (Grok B-05 — SSR returns false): When called in a `typeof window === "undefined"` context, `isStrategyUiV2Enabled()` returns `false`. This is the SAFE default that keeps SSR HTML on the v1 path. The browser useEffect then upgrades to v2 if the flag resolves true. Mirrors `widget-state-flag.ts:isWidgetStateV2Enabled` SSR branch.**
    - Test 2 (browser default → true): In a browser context with no URL params and no localStorage entry, `isStrategyUiV2Enabled()` returns **true**. (NEW: was false in Phase 14a.)
    - Test 3 (URL override ON): `isStrategyUiV2Enabled({ search: "?strategy_v2=on" })` returns true.
    - Test 4 (URL override OFF — regression critical): `isStrategyUiV2Enabled({ search: "?strategy_v2=off" })` returns **false**. This is the canonical opt-out for users who hit issues post-flip.
    - Test 5 (localStorage explicit ON): `localStorage.setItem("strategy.ui_v2", "true")` + no URL override → true.
    - Test 6 (localStorage explicit OFF — Grok B-05 critical): `localStorage.setItem("strategy.ui_v2", "false")` + no URL override → **false**. Legacy users who manually opted out keep their preference. **This is the case Grok B-05 highlighted: SSR returns false → client also returns false → no hydration mismatch.**
    - Test 7 (URL beats localStorage): URL `?strategy_v2=on` + localStorage `false` → true. URL wins.
    - Test 8 (malformed URL value): `?strategy_v2=banana` falls through to localStorage; if localStorage absent → returns true (the new browser default).
    - Test 9 (localStorage exception): When `window.localStorage` throws (e.g. private mode), the function returns the new browser default — true.
    - Test 10 (constants unchanged): `STRATEGY_UI_V2_STORAGE_KEY === "strategy.ui_v2"` and `STRATEGY_UI_V2_URL_OVERRIDE === "strategy_v2"`.
    - **Test 11 (Grok B-05 — hydration-safety integration test): Render a tiny consumer component that reads the flag in a `useEffect` and stores the result in state. Initial render (state = `null`) renders the v1 path. After mount, the useEffect fires → state updates to true → v2 path renders. No `Hydration failed` console.error. The test mounts the consumer in a JSDOM context with `Object.defineProperty(window, 'localStorage', { value: { getItem: () => null }, writable: true })` to simulate a fresh user; with `getItem: () => 'false'` to simulate the legacy opt-out user. In BOTH cases, the initial render uses the SSR-default (v1) path and the post-hydration state matches the localStorage value, eliminating mismatch warnings.**
  </behavior>
  <action>
    Edit `src/lib/strategy-ui-v2-flag.ts`:

    1. Update the JSDoc block at the top — replace the line "Phase 14a default = OFF. Flips to ON when Phase 14b lands the lazy bodies and full coverage." with:

       ```
       Phase 14b default = ON (browser-side). SSR keeps returning false (the safe
       default) — exactly mirrors the widget-state-flag.ts SSR pattern from
       Phase 11. Consumers MUST do a two-pass mount: initial render uses the
       SSR-safe v1 path; on `useEffect`, read this flag and upgrade to v2 if
       it resolves true. This prevents the hydration mismatch flagged by Grok
       B-05 for legacy users with `localStorage["strategy.ui_v2"]="false"`.

       Recommended consumer pattern (mirrors AllocationsTabs.tsx:225-243):

         const [isV2, setIsV2] = useState(false);  // SSR-safe initial value
         useEffect(() => { setIsV2(isStrategyUiV2Enabled()); }, []);
         return isV2 ? <V2 /> : <V1 />;
       ```

    2. **DO NOT change the SSR branch.** It MUST stay:
       ```typescript
       // Grok B-05 — SSR keeps returning false (safe default). Consumers do
       // a two-pass mount via useEffect to upgrade to v2 in the browser.
       if (typeof window === "undefined") return false;
       ```

    3. Update the localStorage fall-through to distinguish explicit OFF from absent (Grok B-05: an explicit "false" must always win, never folded into the new default-true):
       ```typescript
       // Fall through to localStorage. Default-ON contract for the browser:
       //   - "false" → explicit user opt-out → return false (legacy opt-out persists)
       //   - "true"  → explicit user opt-in (redundant but accepted) → return true
       //   - missing / any other value → default ON (new in Phase 14b)
       try {
         const raw = window.localStorage.getItem(STRATEGY_UI_V2_STORAGE_KEY);
         if (raw === "false") return false;
         if (raw === "true") return true;
         return true;
       } catch {
         return true;
       }
       ```

    4. Keep the URL override block exactly as-is. Both "off" and "false" still resolve to false; both "on", "v2", and "true" still resolve to true.

    Update `src/lib/strategy-ui-v2-flag.test.ts` — flip the polarity on the cases that previously asserted default OFF. Add the new Test 11 (hydration-safety integration test) using `@testing-library/react` `render` + `useEffect` + `await waitFor(...)` patterns. The existing test file uses a Map-backed localStorage stub per STATE.md decision; reuse that pattern.

    Concrete value preservation: the export names `STRATEGY_UI_V2_STORAGE_KEY` / `STRATEGY_UI_V2_URL_OVERRIDE` and their string values stay byte-identical. Any consumer that imports them keeps working.

    **Optional ergonomic helper (recommended)**: export a thin wrapper named `isStrategyUiV2EnabledClient(opts?)` that asserts `typeof window !== "undefined"` and forwards to `isStrategyUiV2Enabled` — this gives consumers a strongly-typed signal that they must call from useEffect. Example:

    ```typescript
    /**
     * Browser-only convenience wrapper. Throws in SSR contexts. Call from
     * inside useEffect so initial render uses the SSR-safe default and the
     * upgrade to v2 happens post-hydration only.
     */
    export function isStrategyUiV2EnabledClient(opts?: StrategyUiV2Options): boolean {
      if (typeof window === "undefined") {
        throw new Error("isStrategyUiV2EnabledClient called on the server. Use it from useEffect only.");
      }
      return isStrategyUiV2Enabled(opts);
    }
    ```

    Adding this is at the executor's discretion — if existing consumers already pattern-match the SSR-safe two-pass shape, the wrapper isn't strictly required. If added, also write 1 test asserting it throws in SSR and forwards in browser.
  </action>
  <verify>
    <automated>npm test -- src/lib/strategy-ui-v2-flag.test.ts --run</automated>
  </verify>
  <done>
    - `npm test -- src/lib/strategy-ui-v2-flag.test.ts --run` passes 11/11 (with new polarity + Grok B-05 hydration-safety test).
    - `grep -c "return true" src/lib/strategy-ui-v2-flag.ts` ≥ 3 (URL ON branch + localStorage true branch + final localStorage fallthrough; SSR branch is `return false`).
    - **`grep -c "typeof window === \"undefined\"" src/lib/strategy-ui-v2-flag.ts` ≥ 1 — Grok B-05 SSR branch preserved.**
    - **`grep -c "if (typeof window === \"undefined\") return false" src/lib/strategy-ui-v2-flag.ts` returns 1 — SSR returns false, NOT true (Grok B-05 critical invariant).**
    - `grep -c "return false" src/lib/strategy-ui-v2-flag.ts` ≥ 2 (SSR branch + URL OFF branch + localStorage explicit-false branch — count varies but must be ≥2).
    - `grep -c "Phase 14b default = ON" src/lib/strategy-ui-v2-flag.ts` returns 1.
    - **`grep -c "Grok B-05" src/lib/strategy-ui-v2-flag.ts` ≥ 1 (rationale comment for the SSR branch).**
    - `grep -c "STRATEGY_UI_V2_STORAGE_KEY = \"strategy.ui_v2\"" src/lib/strategy-ui-v2-flag.ts` returns 1 (constant unchanged).
    - `grep -c "STRATEGY_UI_V2_URL_OVERRIDE = \"strategy_v2\"" src/lib/strategy-ui-v2-flag.ts` returns 1.
    - `npx tsc --noEmit` exits 0.
    - `npm run build` exits 0.
  </done>
</task>

<task type="auto">
  <name>Task 2: Extend PR template with 4×7 partial-data matrix</name>
  <files>.github/PULL_REQUEST_TEMPLATE.md</files>
  <read_first>
    - .github/PULL_REQUEST_TEMPLATE.md (current 33-LOC shape — Phase 14a-06)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §4.3 (per-panel × per-history-band partial-data threshold table)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-CONTEXT.md `### PR template extension` (4-history-band × 7-panel grid spec)
  </read_first>
  <action>
    Append a new section to the PR template AFTER the existing `## Identity audit (per-chart)` section and BEFORE the `## Notes` section. Use the literal block below (preserve markdown table syntax exactly):

    ```markdown
    ## Partial-data matrix (panels 4-7 — Pitfall 17 / KPI-23b)

    For PRs that touch `/strategy/[id]/v2` panels 4-7, verify each cell renders correctly across the 4 documented history bands. Mark `✓ banner` when the documented partial-data banner copy renders, `✓ full` when the panel renders its full body, or `—` if the cell is N/A.

    | History band | Panel 1 Overview | Panel 2 Headline + Equity | Panel 3 Drawdown | Panel 4 Returns distribution | Panel 5 Rolling | Panel 6 Trades & positions | Panel 7 Exposure & greeks |
    |--------------|------------------|---------------------------|------------------|------------------------------|-----------------|----------------------------|---------------------------|
    | 7 days       | [ ]              | [ ]                       | [ ]              | [ ]                          | [ ]             | [ ]                        | [ ]                       |
    | 30 days      | [ ]              | [ ]                       | [ ]              | [ ]                          | [ ]             | [ ]                        | [ ]                       |
    | 90 days      | [ ]              | [ ]                       | [ ]              | [ ]                          | [ ]             | [ ]                        | [ ]                       |
    | 365 days     | [ ]              | [ ]                       | [ ]              | [ ]                          | [ ]             | [ ]                        | [ ]                       |

    PRs that do NOT touch /strategy/[id]/v2 panels can leave this section blank or delete it.
    ```

    Verify the file's existing sections remain in order: Summary → Test plan → Identity audit (per-chart) → Partial-data matrix (NEW) → Notes.

    Concrete value: 7 column headers must exactly match the panel display names in UI-SPEC §4.3 panel-name column. The history bands (7d / 30d / 90d / 365d) match e2e/strategy-v2-partial-data.spec.ts HISTORY_BANDS verbatim.
  </action>
  <verify>
    <automated>grep -c "Partial-data matrix" .github/PULL_REQUEST_TEMPLATE.md</automated>
  </verify>
  <done>
    - `grep -c "Partial-data matrix" .github/PULL_REQUEST_TEMPLATE.md` returns 1.
    - `grep -c "Pitfall 17 / KPI-23b" .github/PULL_REQUEST_TEMPLATE.md` returns 1.
    - `grep -cE "^\\| (7|30|90|365) days" .github/PULL_REQUEST_TEMPLATE.md` returns 4.
    - `grep -c "Panel 1 Overview" .github/PULL_REQUEST_TEMPLATE.md` returns 1.
    - `grep -c "Panel 7 Exposure & greeks" .github/PULL_REQUEST_TEMPLATE.md` returns 1.
    - File still parses as valid markdown — `npx markdownlint .github/PULL_REQUEST_TEMPLATE.md` (if installed) reports no errors. If markdownlint is not installed, accept manual visual inspection.
    - Section order preserved: `grep -nE "^## " .github/PULL_REQUEST_TEMPLATE.md` lists Summary → Test plan → Identity audit (per-chart) → Partial-data matrix → Notes in order.
  </done>
</task>

<task type="auto">
  <name>Task 3: Stamp DESIGN.md decisions log with the flag-flip entry (Grok B-05 SSR-safe note included)</name>
  <files>DESIGN.md</files>
  <read_first>
    - DESIGN.md lines 126-138 (current decisions log table — last entry is "v2 single-strategy 4-size / 2-weight type contract" 2026-04-29)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-CONTEXT.md `## Phase Boundary` (flag flip is final commit of 14b)
  </read_first>
  <action>
    Append a single new row to the DESIGN.md ## Decisions Log table, immediately AFTER the existing 2026-04-29 row "v2 single-strategy 4-size / 2-weight type contract". Use the format established by Phase 14a-06:

    ```
    | 2026-04-29 | strategy.ui_v2 default flipped OFF→ON (browser-side; SSR-safe two-pass mount per Grok B-05) | Phase 14b shipped Panel 4-7 lazy bodies (Returns Distribution / Rolling / Trades & positions / Exposure & benchmark greeks), DailyHeatmap SVG/Canvas dual renderer (Pitfall 4 mitigation), axe-core CI on `/strategy/[id]/v2` + `/discovery/[slug]` (zero violations on `wcag2a` + `wcag2aa` + `best-practice`), full keyboard navigation with skip-link mechanism (UI-SPEC §7.3 focus order), and Playwright chart-snapshot parity (±2% per panel; ±5% full-page) — gating checklist in UI-SPEC §11 fully green before this flip. The Pitfall 17 partial-data matrix (4 history bands × 7 panels) is institutionalized in `.github/PULL_REQUEST_TEMPLATE.md` to keep KPI-23b coverage from regressing on future PRs. The v1 → v2 cutover (removing `src/app/strategy/[id]/page.tsx`) remains a v0.17.1 follow-up; this flip only changes the flag's default value, not the v1 route's existence. URL override `?strategy_v2=off` and localStorage `strategy.ui_v2='false'` continue to force v1 for any user. **Grok B-05 SSR-safety**: the SSR branch of `isStrategyUiV2Enabled()` keeps returning `false` (mirrors `src/lib/widget-state-flag.ts` Phase 11 pattern). Consumers do a two-pass mount via `useEffect` so initial server render uses v1, post-hydration upgrades to v2 if the flag resolves true. This prevents hydration mismatches for legacy users with `localStorage="strategy.ui_v2"="false"`. |
    ```

    Place the new row as the LAST entry in the table (preserving the existing 9 rows verbatim — do NOT modify any prior row's content). The table now has 10 rows.

    Concrete values:
    - Date: `2026-04-29` (matches CLAUDE.md `currentDate`)
    - Decision label (verbatim): `strategy.ui_v2 default flipped OFF→ON (browser-side; SSR-safe two-pass mount per Grok B-05)` (Unicode arrow `→`)
    - Rationale: full text per the block above. References UI-SPEC §11 + .github/PULL_REQUEST_TEMPLATE.md + Pitfall 17 + KPI-23b + widget-state-flag.ts pattern + Grok B-05.
  </action>
  <verify>
    <automated>grep -c "strategy.ui_v2 default flipped OFF→ON" DESIGN.md</automated>
  </verify>
  <done>
    - `grep -c "strategy.ui_v2 default flipped OFF→ON" DESIGN.md` returns 1.
    - **`grep -c "Grok B-05 SSR-safety" DESIGN.md` returns 1 (rationale references the Grok review item explicitly).**
    - `grep -cE "^\\| 2026-04-29 \\|" DESIGN.md` returns 3 (was 2 — UC#7 + 4-size/2-weight; now +1).
    - `grep -c "## Decisions Log" DESIGN.md` returns 1 (heading not duplicated).
    - All prior 9 rows preserved — `grep -cE "^\\| 2026-04-(06|09|11|27) \\|" DESIGN.md` returns 7 (4 entries on 2026-04-06 + 1 on 04-09 + 1 on 04-11 + 1 on 04-27 = 7 rows; verify by counting via wc -l on the date-prefix grep).
    - DESIGN.md line count delta: +1 line.
  </done>
</task>

</tasks>

<verification>
- All 3 tasks committed atomically as the milestone-final commit of v0.17.0.0.
- `npm run build` exits 0.
- `npm test --run` exits 0 (full suite — Phase 14a + Phase 14b + all prior tests pass).
- `npm run typecheck` exits 0.
- `npm run lint` exits 0.
- `grep -c "return true" src/lib/strategy-ui-v2-flag.ts` ≥ 3 (URL ON, localStorage true, final fallthrough).
- **`grep -c "if (typeof window === \"undefined\") return false" src/lib/strategy-ui-v2-flag.ts` returns 1 — Grok B-05 SSR-safety invariant.**
- `grep -c "Partial-data matrix" .github/PULL_REQUEST_TEMPLATE.md` returns 1.
- `grep -c "strategy.ui_v2 default flipped OFF→ON" DESIGN.md` returns 1.
- The 4 Playwright specs from Plan 14b-07 still enumerate via `npx playwright test --list` (no spec deletion).
</verification>

<success_criteria>
- KPI-23b Pitfall 17 mitigation institutionalized in PR template — every future PR carries the partial-data matrix to fill in.
- `strategy.ui_v2` flag default flipped OFF → ON in the browser; SSR keeps returning false. Explicit OFF overrides preserved (URL `?strategy_v2=off` and localStorage `'false'`).
- DESIGN.md decisions log permanently records the flip with full context references and the Grok B-05 SSR-safety note.
- **Grok B-05 mitigation: hydration mismatches eliminated. Server returns false (v1) → client useEffect upgrades to v2 if flag resolves true post-hydration. Mirrors src/lib/widget-state-flag.ts pattern from Phase 11.**
- Phase 14b is feature-complete. v0.17.0.0 milestone is feature-complete pending the final post-execution review/checker pipeline.
</success_criteria>

<output>
After completion, create `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-08-SUMMARY.md` documenting:
- Exact diff on src/lib/strategy-ui-v2-flag.ts (with before/after of each branch — including the preserved SSR `return false` per Grok B-05)
- Test polarity flips + new Grok B-05 hydration-safety integration test
- PR template section addition + 4×7 grid table position
- DESIGN.md decisions log new row at line N, including the Grok B-05 rationale
- Confirmation that all Plan 14b-07 gates were green BEFORE this commit landed
</output>
