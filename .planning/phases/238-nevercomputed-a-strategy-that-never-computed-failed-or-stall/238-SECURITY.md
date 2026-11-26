---
phase: "238"
slug: "nevercomputed"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-26"
verified_at_sha: 350a288538d4af759a828f1f2edf8da9697d9f83
---

# Phase 238 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (all nine PLANs carry a `<threat_model>`). Audited by gsd-security-auditor
> at branch HEAD `350a28853`, ASVS level 1, block_on high. Static reads plus targeted vitest runs
> (`--maxWorkers=2`). No database was queried. The SQL and e2e lanes were not run, because they run only in CI.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Viewer to /strategies and factsheet remedy notes | The remedy action a note links to depends on the viewer's role. An allocator-only viewer must never be sent to a manager's edit page. | Role-derived action id, encoded strategy id |
| Migration role to `strategy_analytics` (PROD) | Plan 05's migration backfills `computed_at` to NULL. It briefly disables the hold trigger inside one transaction. | Row timestamps, trigger state |
| Developer tooling to PROD | Plan 04's PROD probe ran through Supabase MCP only, with the marker query first. The checkout's CLI is linked to PROD. | Aggregate counts only |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-238-01 | Elevation of privilege | `noteFor` remedy descriptor | medium | mitigate | The `remedy` branch of `noteFor` in `src/app/(dashboard)/strategies/page.tsx` takes its action only from `viewerRemedyAction` (`src/lib/degrade-warnings.ts`). The allocator-only pins are in `page.merged.test.tsx` and `page.owner-compute-state.test.tsx`. | closed |
| T-238-02 | Tampering | `DegradeAction` link href | low | mitigate | `src/components/degrade/DegradeLine.tsx`: the edit href uses `encodeURIComponent(strategyId)`, and `contactHref` (`src/lib/contact.ts`) encodes every value. No markup string is built. | closed |
| T-238-03 | Information disclosure | new copy constants | low | mitigate | `KCS12_*` constants in `src/lib/status-surface-copy.ts` name no address or status. `no-email-in-copy.test.ts` passes. | closed |
| T-238-04 | Elevation of privilege | published `noteFor` action | medium | mitigate | The `public-uncomputed` branch also takes its action from `viewerRemedyAction`. | closed |
| T-238-05 | Denial of service | per-row jobs RPC | low | mitigate | `armOf` makes no RPC call for `public-url`; the state comes from `failedFacts`. `rpcCalls` pins exist in `page.merged.test.tsx` and `page.key-pill.test.tsx`. | closed |
| T-238-06 | Tampering | `shareNote` node prop | low | mitigate | `FactsheetView.tsx` types it `string \| ReactNode`. The node is built from static copy plus `DegradeAction` (`src/app/factsheet/[id]/v2/page.tsx`). | closed |
| T-238-07 | Information disclosure | owner panel note | low | accept | The note renders only under `lane === "owner"` and names an action only. Copy passes `no-email-in-copy`. | closed (accepted) |
| T-238-08 | Information disclosure | PROD probe output in SUMMARY | medium | mitigate | `238-04-SUMMARY.md` has aggregate counts only. A grep for ids, refs, emails, paths, tokens and DSNs found nothing. | closed |
| T-238-09 | Tampering | probe against wrong database | high | mitigate | The probe used MCP only, read-only aggregates, and the marker query first; all three marker answers named PRODUCTION. See caveat 1. | closed |
| T-238-10 | Tampering | backfill UPDATE | high | mitigate | Conservative predicate (status AND no figures AND empty series), a `PERFORM ... IF FOUND` guard, and six decoys in `nevercomputed-backfill-sql-exec.test.ts`. | closed (runtime arms CI-only) |
| T-238-11 | Tampering | hold trigger left disabled | high | mitigate | One DISABLE and one ENABLE in the same implicit transaction. The catalogue check asserts `tgenabled = 'O'`. The exec test has arms for re-enabled and for a left-disabled trigger. | closed (runtime arms CI-only) |
| T-238-12 | Denial of service | SHARE ROW EXCLUSIVE lock | medium | mitigate | `SET LOCAL lock_timeout = '3s'` before the ALTERs, and a single UPDATE. The exec test asserts the string. | closed |
| T-238-13 | Elevation of privilege | grants and RLS on `strategy_analytics` | medium | mitigate | The migration has no GRANT, REVOKE, POLICY or CREATE FUNCTION. | closed |
| T-238-14 | Tampering | CLI write against PROD | high | mitigate | No `.github` or `scripts/local-stack` diff. CI applies the migration on merge. The rollback file's header carries the marker-query warning. | closed |
| T-238-15 | Tampering | reader treating NULL as fresh or as a date | medium | mitigate | `database.types.ts` has `strategy_analytics.computed_at` as `string \| null`. No `!` or cast on that column; the one `computed_at!` hit reads a different RPC and is classified other-table by the census. | closed |
| T-238-16 | Tampering | hand-patched generated types | low | mitigate | The branch diff is exactly three lines, in the generator's form. | closed |
| T-238-17 | Tampering | missed or later reader | medium | mitigate | `src/__tests__/computed-at-reader-census.test.ts` has exact counts, floors and planted self-tests over the TS, Python and SQL corpora. It passes. | closed |
| T-238-18 | Tampering | unreviewed PROD migration | high | mitigate | `238-MIGRATION-REVIEW.md`: migration-reviewer and rls-policy-auditor both clean. The forward migration is unchanged since that review. `238-REVIEW-PR2.md` has no open MEDIUM+. | closed |
| T-238-19 | Tampering | lane command at a remote database | high | mitigate | `scripts/local-stack/run.sh --assert-local-handoff` refuses a non-loopback DSN or URL. The phase made no change there. | closed |
| T-238-20 | Tampering | later edit dropping a NULL arm | low | mitigate | NULL-arm pins in `AdminTabs`, `SyncBadge.trade-fetch`, `StrategyTable.stale-analytics`, `FactsheetView` and `never-computed-stamp` tests. The census requires one per reader. | closed |
| T-238-SC | Tampering | npm installs | low | accept | `package.json` and `package-lock.json` are unchanged on the branch. | closed (accepted) |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Caveats (non-blocking)

1. **T-238-09 ordering.** Plan 04 sent its last two marker and read pairs in one parallel batch. So marker-before-read order is guaranteed only for the aggregate read. Every call was a read-only aggregate on the same project, and every marker answer named PRODUCTION.
2. **CI-only proof.** The exec-test arms for T-238-10 and T-238-11 need a Postgres cluster, and the SQL lane runs in CI. The migration role's permission to `DISABLE TRIGGER` is proven only by TEST `apply-test` on merge. If TEST refuses, the apply rolls back and blocks the PROD apply, which is a safe failure.
3. **Unregistered surface (informational).** The PR2-WR-01 fix added an owner-lane `profiles.role` read in `src/app/factsheet/[id]/v2/page.tsx`. It uses the session client, reads only the owner's own row, and fails closed (`ownerManagerSurface` stays false). The value only picks which action link to show and is never rendered. It feeds `managerSurface` into `viewerRemedyAction`, so it is covered by T-238-01.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-238-01 | T-238-07 | The owner panel note sits behind the unchanged owner lane gate. It names an action and carries no status detail or address. | plan 238-03 threat model | 2026-11-26 |
| AR-238-02 | T-238-SC | The phase installs no package. | plan threat models (all) | 2026-11-26 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-26 | 21 | 21 | 0 | gsd-security-auditor (sonnet), branch HEAD 350a28853 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-26
