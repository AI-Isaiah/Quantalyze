---
phase: 96-draft-key-hygiene-onboarding-polish
plan: 03
subsystem: cron / draft-key-hygiene
tags: [cron, cleanup, rpc, vercel, security, tdd]
requires:
  - "public.cleanup_abandoned_wizard_drafts() RPC (96-02)"
  - "finalize_wizard_strategy guarded UPDATE under FOR UPDATE (96-01)"
provides:
  - "CLEAN-01 + CLEAN-02 live end-to-end: Vercel Cron (daily) → authed route → one atomic RPC"
  - "monitor-stable response shape {deleted, orphaned_keys_revoked, key_sweep_errors:0}"
affects:
  - "src/app/api/cron/cleanup-wizard-drafts/route.ts"
  - "vercel.json (cron schedule)"
tech-stack:
  added: []
  patterns:
    - "thin route = auth gate + single admin.rpc() dispatch + response shaping; DB owns atomicity"
    - "generic 500 envelope on RPC error, raw PostgREST detail to log only (least-disclosure)"
key-files:
  created: []
  modified:
    - "src/app/api/cron/cleanup-wizard-drafts/route.ts"
    - "src/app/api/cron/cleanup-wizard-drafts/route.test.ts"
    - "vercel.json"
decisions:
  - "Kept planner discretion: cron schedule weekly (0 2 * * 0) → daily (0 2 * * *) so the 7d window yields 7-8d effective draft lifetime, not 7-14d. Trivially reversible."
  - "key_sweep_errors retained in the response shape as a constant 0 for monitor-shape continuity, even though partial sweep is now structurally impossible (one transaction)."
metrics:
  duration: "~10 min"
  completed: "2026-07-12"
  tasks: 2
  files: 3
---

# Phase 96 Plan 03: Cron → single cleanup RPC Summary

Rewired `/api/cron/cleanup-wizard-drafts` from a racy SELECT-then-DELETE plus a per-key `delete_api_key_if_unreferenced` orphan-sweep loop to a single atomic `admin.rpc("cleanup_abandoned_wizard_drafts")` call (RPC shipped in 96-02), and moved the Vercel Cron schedule from weekly to daily so the RPC's 7d abandonment window is effective. This is the first observable real run path of the cleanup — the migration's apply-time self-test is isolated/rolled-back, so the cron is where real deletion happens.

## What was built

**Task 1 (TDD RED) — `route.test.ts` rewritten to the single-RPC contract.**
Replaced the chain-recorder machinery (`.from/.select/.eq/.lt/.in/.delete` recorders + per-key `rpcResultByKey`) with a simple `rpcMock`/`fromMock` on the mocked `createAdminClient`. Five behaviors:
1. Auth — 401 on missing header / wrong bearer / unset `CRON_SECRET`.
2. Auth — `safeCompare` (timing-safe) is the comparator, reached on an equal-length wrong bearer; a `true` return alone accepts.
3. Happy path — valid bearer → `rpc` called **exactly once** with `"cleanup_abandoned_wizard_drafts"` and no args; `data: [{deleted_drafts:3, swept_keys:2}]` → `200 {deleted:3, orphaned_keys_revoked:2, key_sweep_errors:0}`.
4. Zero-work — `[{deleted_drafts:0, swept_keys:0}]` → `200 {deleted:0, orphaned_keys_revoked:0, key_sweep_errors:0}` (uniform monitor shape).
5. RPC error — PostgREST error → `500` generic body (asserts body does NOT contain `23503` / `allocator_holdings` / `foreign key constraint`) while `console.error` carries the detail; plus purity — zero `.from()` calls and zero `delete_api_key_if_unreferenced` RPCs.

**RED evidence** (new tests against the unmodified select/delete/loop route):
```
Test Files  1 failed (1)
     Tests  6 failed | 8 passed (14)
```
The 8 passing are the auth cases (contract-preserved, GET+POST); the 6 failing are happy-path, zero-work, and RPC-error × {GET, POST} — the single-RPC assertions the old route cannot satisfy.

**Task 2 (GREEN) — `route.ts` + `vercel.json`.**
- Route body after auth is now: `const { data, error } = await admin.rpc("cleanup_abandoned_wizard_drafts")`; on `error` → `console.error(...)` + generic `{ error: "Cron cleanup failed" }` 500; on success → `const row = Array.isArray(data) ? data[0] : data` mapped to `{ deleted: row?.deleted_drafts ?? 0, orphaned_keys_revoked: row?.swept_keys ?? 0, key_sweep_errors: 0 }`.
- Deleted: `ABANDON_DAYS`, the `.select()→.delete()` two-step, and the entire `sweepErrors`/`delete_api_key_if_unreferenced` loop.
- Header doc-comment rewritten: 7d window (locked deviation, cites 96-VALIDATION decision 1), M-0255 exemption now inside the RPC, CLEAN-01 race note (single guarded DELETE + finalize's `FOR UPDATE` UPDATE / EvalPlanQual), why `key_sweep_errors` is constantly 0, and the daily-schedule rationale. `@audit-skip` annotation retained.
- `vercel.json`: only the `/api/cron/cleanup-wizard-drafts` schedule changed, `0 2 * * 0` → `0 2 * * *`. Nothing else touched.

## Preservation (hard constraints)

- **Auth unchanged**: `Bearer ${CRON_SECRET}` via `safeCompare` (timing-safe), 401 on missing/mismatch, `export const GET = handle; export const POST = handle;`, `export const dynamic = "force-dynamic"`. Pinned by the kept auth tests (T-96-09).
- **Log redaction preserved**: raw PostgREST error stays in `console.error` only; the 500 body is a generic envelope — asserted in Task 1 (T-96-10 least-disclosure).
- **Monitor-stable shape**: `{deleted, orphaned_keys_revoked, key_sweep_errors}` on success (200); `key_sweep_errors` is a constant 0. No monitoring key was removed. On failure the route now returns a plain 500 (Vercel Cron alerts on non-2xx — preserves H-1251's loud-degradation intent; the old 207-vs-500 nuance is moot because partial failure is structurally impossible in one transaction).
- **RPC return mapping** per `RETURNS TABLE(deleted_drafts int, swept_keys int)`: `Array.isArray(data) ? data[0] : data` then `deleted_drafts`/`swept_keys`.

## vercel.json schedule

`{ "path": "/api/cron/cleanup-wizard-drafts", "schedule": "0 2 * * *" }` — daily at 02:00 UTC. Syntax confirmed via `python3 -c "json.load(...)"` assert (`daily ok`). Rationale: a 7d window on a weekly cadence leaves drafts alive 7–14 days; daily keeps effective lifetime 7–8 days.

## Verification

| Gate | Result |
|------|--------|
| `npx vitest run …/route.test.ts` (RED, pre-Task-2) | 6 failed / 8 passed — repro-gate satisfied |
| `npx vitest run …/route.test.ts` (GREEN) | 14 passed / 14 |
| grep-gate `delete_api_key_if_unreferenced\|ABANDON_DAYS` in route.ts | 0 hits |
| vercel.json daily-schedule assert | `daily ok` (`0 2 * * *`) |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 (0 errors; 1 pre-existing warning in unrelated `EquityChart.tsx` — out of scope) |

## Deviations from Plan

None affecting monitoring. The response shape is unchanged from the plan's spec (`{deleted, orphaned_keys_revoked, key_sweep_errors:0}`), so no alerting keys are broken.

Minor: the plan's Task-1 verify grep `grep -qE "fail|FAIL"` and the header doc-comment initially contained the literal token `ABANDON_DAYS` (in prose "the old ABANDON_DAYS constant is gone"), which tripped the Task-2 grep-gate (1 hit). Reworded the comment to "the old route-level day-count constant is gone" so the gate reads 0 hits. No behavior change. `[Rule 3 - Blocking] doc-comment token collision with the grep-gate.`

## Deploy note (advisory, non-blocking)

The offline suite is the gate (per the Nyquist gate in the plan). After the milestone lands, a manual `POST` with the `CRON_SECRET` can smoke-test prod (`orphaned_keys_revoked`/`deleted` observable in the response + Vercel logs). Not required for this plan.

## Commits

- `12ff5395` test(96-03): rewrite cron route tests to single-RPC contract (RED)
- `adb81886` feat(96-03): rewire cron to single cleanup RPC + daily schedule (GREEN)

## TDD Gate Compliance

RED (`test(96-03)…`, 12ff5395) precedes GREEN (`feat(96-03)…`, adb81886). No REFACTOR commit needed. Gate sequence satisfied.

## Self-Check: PASSED

- Files exist: `route.ts`, `route.test.ts`, `vercel.json` — all FOUND.
- Commits exist: `12ff5395`, `adb81886` — both FOUND on the branch.
- Key link `admin.rpc("cleanup_abandoned_wizard_drafts")` present in route.ts.
