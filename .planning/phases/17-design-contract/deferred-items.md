# Phase 17 Deferred Items

Out-of-scope discoveries logged during plan execution. Per Rule 4 deviation
scope-boundary, items here are NOT auto-fixed by the executor — they belong
to a separate plan or pre-existing tech-debt backlog.

## 17-04 (DESIGN-02 ErrorEnvelope rebrand)

### Pre-existing TypeScript error in `src/app/api/debug-key-flow/route.ts:257`

```
src/app/api/debug-key-flow/route.ts(257,15): error TS2322: Type
'{ code?: string | undefined; human_message?: string | undefined; } | undefined'
is not assignable to type
'{ code: string; human_message: string; } | undefined'.
```

**Status:** Pre-existing on the worktree base commit
(`9519478d90303783559b8a76c716fe129b1fa640`); NOT caused by Plan 17-04.
Verified by `git stash && tsc --noEmit` cycle during Task 1.

**Disposition:** Out of Plan 17-04 scope per executor scope-boundary rule
(only auto-fix issues directly caused by the current task's changes).
Belongs to a future Phase 16 follow-up or Phase 19 rewrite of the
`/api/debug-key-flow` endpoint.

**Suggested next action:** Spot-fix at the call site by tightening the
narrowing on the `code` / `human_message` extraction (likely a missing
`if (parsed.code !== undefined && parsed.human_message !== undefined)`
guard before assigning to the typed slot).
