---
phase: 244-accessguards-an-owner-read-without-its-key-id-fails-to-compi
audited: 2026-11-27
asvs_level: 1
block_on: high
threats_total: 13
threats_closed: 10
threats_accepted: 3
threats_open: 0
status: secured
---

# Phase 244 ACCESSGUARDS - Security verification

Scope: the `<threat_model>` blocks of plans 244-01..04, verified against `git diff 45d7b4e5c..HEAD -- . ':!.planning'` (15 files). ASVS L1 (mitigation present at the cited location), block on high. Implementation files were read only. No new endpoint, auth path or schema surface: the code diff is type declarations, five comment-only pragma edits in routes, one CI list line, and tests/e2e.

## Threat verification

| Threat | Sev | Disposition | Mitigation | Evidence | Status |
|--------|-----|-------------|------------|----------|--------|
| T-244-01 | medium | mitigate | `Strategy.api_key_id` required; key-free `PublicStrategy` (`Omit<Strategy,"api_key_id">`) and `PublicRankedStrategyRow` for the public readers; ARM-1..4 `@ts-expect-error` pins | `src/lib/types.ts` (`Strategy.api_key_id: string \| null`, `PublicStrategy`); `src/lib/queries.ts` (`getStrategiesByCategory` returns `PublicRankedStrategyRow[]`, `getFactsheetDetail` returns `PublicStrategy & ...`); `src/__tests__/api-key-id-compile-guard.test.ts` ARM-1..ARM-4 + ARM-OWNER; owner-read select pin `src/__tests__/api-key-id-owner-read-pin.test.ts` (added in review fix round). Vitest: 5 files / 77 tests pass | CLOSED |
| T-244-02 | low | accept | Select-string widening invisible to types; behavioural backstop is `src/lib/anon-strategies-projection.test.ts` and the live anon probe | Limit stated in the header of `api-key-id-compile-guard.test.ts` ("Honest limit") and in the owner-read pin header | ACCEPTED |
| T-244-03 | medium | mitigate | Site 1 covered by the `admin.partner_import` roll-up row; sites 2-6 carry dated founder-exemption pragmas; exact-set gate at zero | Site 1: `src/app/api/admin/partner-import/route.ts` pragma moved to directly above `const { error: profileErr } = await admin.from("profiles").upsert(` (inside the 8-line window); roll-up `emitAsUser(... action: "admin.partner_import")` at ~:878 (error path) and ~:1006 (success path). Sites 2-3 `src/app/api/cron/flag-monitor/route.ts` (two `@audit-skip: founder exemption 2026-11-26 (Phase 244 DBACC-05)` lines directly above each `feature_flags` upsert); site 4 `src/app/api/keys/sync/route.ts` `stampCompositeFailedUnlessComplete`; sites 5-6 `src/app/api/strategies/finalize-wizard/route.ts` (`compositeMemberCount`, `unifiedFinalizeWizardHandler`). Gate `src/__tests__/audit-coverage.test.ts` `H_0001_UNCOVERED_ALLOWLIST = []` and `toHaveLength(0)`; test file re-run green | CLOSED |
| T-244-04 | medium | mitigate | Allowlist kept as a typed empty array so the new-site arm reds on arrival; header forbids adding an entry | `src/__tests__/audit-coverage.test.ts` `const H_0001_UNCOVERED_ALLOWLIST: ReadonlyArray<{file;snippet;reason}> = [];` with header "It only shrinks; it never gains an entry"; both drift arms (`allowKeys`, `dischargedEntries`) retained, failure text says do NOT add to the list | CLOSED |
| T-244-05 | low | accept | Five exempted writes are an internal cron counter and derived compute-state stamps (founder decision 2026-11-26) | Decision recorded in `244-CONTEXT.md` and in each pragma's text; the audit-coverage header records the exemption class per site | ACCEPTED |
| T-244-06 | medium | mitigate | Bare-SELECT arm runs unconditionally; missing anon key fails; neuter seen RED; spec gated in CI | `e2e/discovery-watchlist.spec.ts`: `expect(anonKey, "TEST_SUPABASE_ANON_KEY missing ...").toBeTruthy()`, `userBClient ... .from("user_favorites").select(...)` (no filter), `aRowsVisibleToB ... toHaveLength(0)` with "RLS LEAK on migration 024 policy"; `signInErr`/`leakErr` asserted null; user-A seed `insertError` asserted null. PROOF-01 A in `244-03-SUMMARY.md` (USING (true) neuter -> named arm red, restore `cmp=0`). Placement: T-244-10 | CLOSED |
| T-244-07 | medium | mitigate | Arm asserts the proxy's 307 to `/login` with redirects off; PROOF-01 neuters `PUBLIC_ROUTES` | `e2e/discovery-watchlist.spec.ts` `maxRedirects: 0`, `expect(res.status(), ...).toBe(307)`, Location pathname `/login`; pinned by the `anonymous PUT arm asserts the status itself is 307` arm. PROOF-01 B in `244-03-SUMMARY.md` (Expected 307, Received 401, `src/proxy.ts` restored `cmp=0`, `git diff --quiet` clean). `src/proxy.ts` not in the diff (verified) | CLOSED |
| T-244-08 | high | mitigate | `ALTER POLICY` only against the disposable lane, after `--assert-local-handoff` and the marker query; never linked CLI or MCP | Procedure + outcomes recorded in `244-03-SUMMARY.md` "Environment (lane only)": `--assert-local-handoff` exit 0 (loopback API_URL/DB_URL) before every psql call, marker query run (answer `default administrative connection database`, names neither TEST nor PROD), teardown `run.sh down` exit 0 and `--assert-teardown` exit 0, policy snapshot restored (`cmp=0`). Code diff touches no migration, no supabase CLI config, no DSN (`git diff --name-only` has no `supabase/` path), so no committed artifact can reach shared TEST or PROD. This is a procedural control; evidence is the executor's record, which cannot be re-measured post hoc (lane torn down) | CLOSED (evidence = recorded run; see note 1) |
| T-244-09 | low | mitigate | Lane keys only in mode-600 scratch `lane.env` / gitignored `.stack-env`; never in a tracked file or SUMMARY | grep of every file changed in the code diff and of `.planning/phases/244-*/` for JWT-shaped (`eyJ...`) and `sb_secret_` / `sb_publishable_` strings: 0 hits. Spec reads keys from `process.env` only. `244-03-SUMMARY.md` records `lane.env` deleted at teardown | CLOSED |
| T-244-10 | medium | mitigate | Spec in the gating `e2e-seeded` list; pin reds on removal, advisory placement, silent anon-key skip, extra skips/fixme/only, lost anchors; census 27 | `.github/workflows/ci.yml` line in the "Run seed-gated specs (MA-8 / BLOCK-3)" `else` arm: `e2e/discovery-watchlist.spec.ts \`; `src/__tests__/discovery-watchlist-e2e-wiring.test.ts` (9 arms incl. seeded list, advisory exclusion, exactly one `.skip(` of form `test.skip(!HAS_SEED_ENV,`, no fixme/only, `HAS_SEED_ENV` exact two env names cross-checked to the lane's `printf` exports, no early return/`if` before the RLS assertion); `SEEDED_SPEC_COUNT = 27` in `src/__tests__/e2e-seeded-hydration-guard.test.ts`; W1-W3 PROOF-01 in `244-04-SUMMARY.md`. Re-run: 5 files / 77 tests pass | CLOSED |
| T-244-11 | medium | mitigate | Runtime `HAS_SEED_ENV` skip cannot be seen by a source scan; the PR head SHA's `e2e-seeded` log must show the four watchlist tests passed, none skipped | Source side present (exact skip form and exact env-name pins above). The runtime half is a declared ship-time gate (`244-04-SUMMARY.md` "Ship gate", plan `<verification>`), by design not satisfiable pre-merge. Not a code gap | CLOSED for code; ship-time check carried (see note 2) |
| T-244-12 | low | mitigate | No step `env:` key added; "Verify build inlined real test-Supabase URL" stays | `git diff 45d7b4e5c..HEAD -- .github` is one list line plus a 4-line comment, no `env:` key; step still present at `ci.yml` "Verify build inlined real test-Supabase URL" | CLOSED |
| T-244-SC (plans 01-04) | low | accept | No package installed | `git diff` contains no `package.json`, lockfile or requirements change | ACCEPTED (x4) |

Count: 13 distinct register IDs (T-244-01..12 plus T-244-SC, which repeats in each plan): 10 mitigate, all CLOSED; 3 accept (T-244-02, T-244-05, T-244-SC), all ACCEPTED with their record located.

## Open threats

None blocking. `threats_open: 0`.

## Notes (non-blocking)

1. T-244-08 (the only high) is a procedural control with no code artifact to grep. Closed on the executor's recorded evidence plus the negative check that the shipped diff contains nothing that could reach a database. If the founder wants an independent re-measurement, it would need a fresh lane boot; none was done here (no Docker per brief).
2. T-244-11: at ship, quote `gh run view --job <e2e-seeded job> --log | grep -a discovery-watchlist` from the PR head SHA showing 4 passed, 0 skipped, before merge. This is the plan's own ship gate, not a code defect.
3. 244-REVIEW.md WR-01 residual (LOW, recorded there): `StrategyGrid` / `StrategyTable` type their row `PublicStrategy & { api_key_id?: string | null }`, so a public projection handed to the shared table still compiles; the owner-read select pin covers the selects, not that component. Defence-in-depth gap on an integrity (not disclosure) threat; anon holds no SELECT on `api_key_id`, so no key can reach a public row. Not counted toward `threats_open`.
4. `getStrategiesByCategory` casts key-free rows `as unknown as Strategy` internally (review finding, LOW, contained to `shapeRankingRows`); declared return type is key-free.

## Unregistered flags

None. SUMMARY `## Threat Flags` for plans 01, 02 and 04 read "None"; plan 03 SUMMARY states no threat flags.
