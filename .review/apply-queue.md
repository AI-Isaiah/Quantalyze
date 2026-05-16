# PR #183 Retroactive Apply Queue — chore/allocator-dashboard-retroactive-audit-2026-05-16

Date: 2026-05-16
Branch: chore/allocator-dashboard-retroactive-audit-2026-05-16
Base: a24a2b4a (PR #183, allocator dashboard safety)
Threshold: HIGH >=7, MED >=8, LOW skipped.

## Dedup pass

Findings cluster around 6 user-facing failure modes. Multiple specialists flagged each from different angles — combined here so each fix closes 1+ findings.

### Apply (atomic commits)

**Commit 1 — wire consumeDashboardRecoveryFlag**
- HIGH conf-9 silent-failure-hunter L7: recovery flag exported but never imported in production code
- HIGH conf-9 red-team L3: V2 layoutVersion-mismatch reset destroys user layout (cluster fix: once recovery flag has consumer, layout-reset is visible to user)
- MED conf-8 silent-failure-hunter L11: setRecoveryFlag empty catch (add console.warn)
- MED conf-8 silent-failure-hunter L12: consumeDashboardRecoveryFlag drops unknown flag silently (reorder removeItem after validation)
- Visual: minimal banner above existing strip — justified because the original PR's "recovery flag" infrastructure had no consumer

**Commit 2 — OutcomesWidget error state visible + post-unmount guard**
- HIGH conf-9 silent-failure-hunter L8: setError populated but never rendered
- MED conf-9 red-team L5: console.error fires post-unmount (move cancelled-guard above the log)
- Visual: error text in the empty sparkline area when error is non-null — justified because pre-PR-#183 sparkline silently disappeared on failure

**Commit 3 — M-1065 NaN guard + simplify unreachable fallback**
- HIGH conf-9 red-team L4: M-1065 fallback emits NaN array on NaN overlay series (filter Number.isFinite at push-time + filter fallback tick set)
- HIGH conf-8 code-reviewer (not in current jsonl but matches red-team finding): unreachable fallback explicit precondition guard
- Per Rule 2 (Simplicity First): keep the fallback but ensure inputs are sane; do NOT delete since red-team #4 proved NaN can reach yMin/yMax

**Commit 4 — widgetViewsFiredRef reset on toggle + portfolio switch**
- HIGH conf-8 red-team L8: widgetViewsFiredRef persists across showOutcomes toggles
- MED conf-7 red-team L10: unknownLoggedRef persists across portfolio switches (paired)

**Commit 5 — regression tests for H-1197/H-1199/TweaksContext fields (HIGH cluster)**
- HIGH conf-9 pr-test-analyzer L15: H-1197 IntersectionObserver deps regression
- HIGH conf-8 pr-test-analyzer L16: H-1199 unknown-widget console.warn dedupe
- HIGH conf-9 pr-test-analyzer L17: TweaksContext parseTweakState union whitelist
- HIGH conf-8 pr-test-analyzer L18: TweaksContext loadTweaks console.warn assertion
- HIGH conf-8 pr-test-analyzer L19: TweaksContext persist console.warn assertion
- MED conf-8 pr-test-analyzer L20: composite-gate-invariant duplicates source-of-truth (export STRATEGY_COMPOSITE_WIDGETS once)

**Commit 6 — ScenarioCommitDiff discriminated union + MED conf-8 fixes**
- HIGH conf-7 type-design-analyzer (not in current jsonl but cited in runner): ScenarioCommitDiff.kind discriminated union
- MED conf-9 silent-failure-hunter L9: TweaksContext silently coerces unknown union values (add console.warn in pickUnion)
- MED conf-8 silent-failure-hunter L10: EquityChart parseISO NaN drops silently (add isFinite check in filter)
- MED conf-7 red-team L9: ScenarioComposer Map-build memo (split into two memos)
- MED conf-7 red-team L12: parseTweakState prototype-poisoning cast (Object.create(null))
- MED conf-8 red-team L6: TweaksContext persist quota-warn flood (persistWarnedRef dedupe)
- MED conf-7 pr-test-analyzer L23: loadV2Config tiles:null silent-reset (recovery flag + console.warn)

**Commit 7 — docs note**
- DOCS: M-1063 visual-fidelity violation acknowledgement (DOCUMENT only)
- DOCS: WidgetProps.data:any deferred to separate PR (per runner instructions)

### Defer (out of scope)

- HIGH type-design-analyzer: WidgetProps.data:any narrowing — touches ~30 widget files, separate PR per runner instructions
- MED red-team L7: cross-hook localStorage origin sharing (architectural — needs design discussion)
- Visual-fidelity violation (red-team L11 conf-8): M-1063 EquityChart fallback DOES change visual surface on broken data (new empty-state DOM where SVG used to render). This was acknowledged in the original PR #183 commit message ("a graceful, copy-driven fallback on broken data") but the "zero JSX changes" headline claim was not technically accurate. NOT reverting M-1063 because the post-fix behaviour is correct; documenting here so the audit trail is intact. The minor banner addition for the recovery flag in this PR is the second visual change (also justified — the recovery flag's stated purpose was a user-facing notice).

### Skip (below threshold or unrelated)

- All LOW findings
- All findings without retroactive:true,pr:183 marker (these are equity_reconstruction.py from a later audit, unrelated to PR #183 scope)

## Apply summary

7 commits queued. Findings closed: 18 (8 HIGH conf>=7, 10 MED conf>=8).
Findings deferred: 2 (1 HIGH WidgetProps.data:any → separate PR, 1 MED cross-hook localStorage → architectural).
Visual changes: 2 acknowledged (M-1063 already merged, new recovery banner in commit 1).
