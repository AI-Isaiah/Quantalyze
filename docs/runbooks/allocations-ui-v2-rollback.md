# Allocations Dashboard — UI V2 rollback runbook

**Owner:** AI-Isaiah
**Created:** Phase 09.1 → confirmed Phase A7 of the-big-fix saga
**Last reviewed:** 2026-04-25

## What `allocations.ui_v2` actually controls

`allocations.ui_v2` is a per-allocator localStorage feature flag stored
under the key of the same name. The flag is read once per page mount of
`/allocations` and selects which Overview body renders:

| Flag value | Overview tab | Source file |
|------------|--------------|-------------|
| `"true"`   | V2 — designer grid + WidgetChrome + WidgetGrid | `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` |
| `"false"` (default, SSR, Safari private mode) | Legacy — Phase 08 mosaic | `src/app/(dashboard)/allocations/AllocationDashboard.tsx` |

The flag is also overridable for one request via `?ui=v2` on the URL
(gated by `NEXT_PUBLIC_QA_MODE`), used by QA to spot-check V2 without
flipping their own localStorage.

## What this flag DOES NOT roll back

> **Critical for on-call.** Setting `allocations.ui_v2 = false` reverts
> the Overview tab to the legacy mosaic. It does **NOT** revert the new
> tab body code shipped in Phase 09.1 / Plans 07–10.

Specifically, the following surfaces are mounted unconditionally —
`allocations.ui_v2` does not gate them:

- **Holdings tab body** (`HoldingsTabPanel`) — uses the Plan 08 redesigned
  `HoldingsTable` + `HoldingDetail` + per-row `BridgeOutcomeBanner`.
- **Outcomes tab body** (`OutcomesTabPanel`) — uses the Plan 10 designer
  `OutcomesWidget` shape.
- **Mandate tab body** (`MandateTabPanel`) — uses the Plan 10 design.
- **Risk tab body** (`RiskTabPanel`) — uses the Plan 10 design.

If a regression surfaces in any of these tab bodies, **flipping
`allocations.ui_v2` will not fix it.** A real rollback path is required:

## Real rollback paths by impact area

### Bug is in the Overview V2 grid only
Set `allocations.ui_v2 = false` for the affected user(s). This is the
intended use of the flag.

### Bug is in any of Holdings / Outcomes / Mandate / Risk tab bodies
The flag does not help. Choose one of:

1. **Hotfix forward** — if the bug is small (typo, color, single-call
   regression), patch and ship via the normal `/ship` path. Tab body
   code is just React; PRs with targeted fixes are fastest.
2. **Revert the offending PR** — if the bug is structural and isolated
   to a single Phase 09.1 plan, `git revert` that plan's merge commit.
   Cross-reference the PR list at
   [`.planning/phases/`](../../.planning/phases/) to find the right
   commit; each Plan 07–10 PR carries its own revert window.
3. **Block deploys via Vercel** — if the bug is high-severity and a
   forward fix isn't ready, promote a previous deployment via the
   Vercel dashboard or `/land-and-deploy` rollback. This rolls back
   everything, not just the tab bodies.

## Operator checklist

When an allocator reports a broken Allocations dashboard:

1. Check the report for which **tab** is affected. If it says
   "Overview", continue to step 2. Otherwise jump to step 4.
2. Ask the allocator to open DevTools → Application → Local Storage and
   inspect `allocations.ui_v2`. Note the value (or "not set").
3. Try toggling the flag in their browser:
   - If `"true"` → `"false"`: Overview reverts to legacy. If that fixes
     it, the bug is in the V2 grid; flag-off mitigates while we hotfix.
   - If `"false"` → `"true"`: Overview moves to V2. If V2 looks fine,
     the bug is in the legacy mosaic; flag-on mitigates while we hotfix.
4. **For Holdings / Outcomes / Mandate / Risk reports**: do not ask the
   allocator to flip `allocations.ui_v2`. The flag does not gate these
   surfaces. Capture a repro and route to the dashboard team for hotfix
   or PR revert per the table above.

## Smoke test after any rollback

Whatever path you take, confirm:

- [ ] `/allocations` loads (200, no error boundary).
- [ ] Each of the 6 tabs (Overview, Holdings, Outcomes, Mandate, Risk,
      Scenario) renders its body without crashing.
- [ ] Bridge outcome banners appear on flagged holdings (Holdings tab).
- [ ] No console errors in the browser DevTools console.

## Related artifacts

- Phase 09.1 Plan 01 / D-17 — flag introduced (commit history of
  `AllocationsTabs.tsx` for the original wiring).
- Phase A1–A6 of the-big-fix saga — review-finding fixes layered on top
  of the post-Phase-09.1 main branch.
- Phase A6 specifically converts the four non-Overview tab bodies to
  `next/dynamic({ ssr: false })` — they hydrate on first activation,
  so a tab-body bug only surfaces once the user clicks that tab.
