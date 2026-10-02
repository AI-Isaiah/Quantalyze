# Deferred items — Plan 164.5.1-07

Out-of-scope discoveries surfaced while executing 164.5.1-07-PLAN.md. Per the executor's
scope-boundary rule, none of these were fixed — this plan's files are exactly
`src/__tests__/prod-prober-wiring.test.ts`, `scripts/prod-prober/run.mjs`, and
`scripts/prod-prober/fixtures/cron-drift/manifest-normalization-stale.json`.

## Full-suite `npx vitest run` is NOT green at HEAD — 4 pre-existing, unrelated failures

The plan's own `<verification>` section requires "`npx vitest run` (full suite) green". A full
run (`234.94s`, 14825 passed / 5 failed / 280 skipped before this plan's Task 2; re-run after
Task 2 shows the same 4 files failing) surfaces four failing test files, none of which reference
`prod-prober`, `cron-drift`, or `cron-manifest` (confirmed by `grep`), and all reproduce in
isolation — i.e. before this plan touched anything:

1. **`src/__tests__/contracts/analytics-deploy-tree-compare.contract.test.ts`** — network-dependent
   (`[DEPLOYVERIFY-SHA-NOT-CODE]` convergence test hits a stub `/health` URL and gets no reading in
   this sandbox). Unrelated to cron-drift/prod-prober.
2. **`src/__tests__/lint-sql-gates.test.ts`** — 4 sub-tests timeout at the default 5000ms
   (`Test timed out in 5000ms`) even run in isolation
   (`npx vitest run src/__tests__/lint-sql-gates.test.ts` — same failures, 45.85s wall time for
   the file). Environment-speed sensitive, not a code regression from this plan.
3. **`src/__tests__/verify-plan-anchors.test.ts`** — `expect(res.status).toBe(0)` fails with
   `1` on "the real tree" — some PLAN.md elsewhere in `.planning/` carries a stale `file:line`
   anchor. This plan modified no `PLAN.md`, so the stale anchor is not introduced by this diff.
4. **`src/lib/seam-venue-vocabulary.invariant.test.ts`** — `KILL_SWITCH_UNAVAILABLE` has no
   TypeScript disposition in `VENUE_WIRE_CODE_TO_VERDICT` / `VENUE_WIRE_CODES_WITHOUT_VERDICT`.
   `KILL_SWITCH_UNAVAILABLE` is the status plan `164.5.1-02` introduced (this phase, wave 1) —
   the TS-side disposition is that plan's or a later plan's responsibility, not this gate plan's.

None of the four are auto-fixed here (scope boundary). `npx vitest run
src/__tests__/prod-prober-wiring.test.ts` — the plan's own scoped file — is green (93/93), and
`node scripts/prod-prober/run.mjs --self-test` is green (82/82). This plan's own two files are the
only ones asserted against.
