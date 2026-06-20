# Pre-Compact Re-Verification of FIX-LIST.md (2026-05-17)

Bookkeeping pass that re-verifies the audit-2026-05-07 `FIX-LIST.md` against
current `origin/main` before the next session `/compact`. The result is a
clean, accurate work-queue that the next iteration can resume from without
depending on the soon-to-be-compacted session memory.

The local artifacts (`.planning/audit-2026-05-07/`) are gitignored, so the
tracked substance of this PR is this runbook plus a VERSION bump.

> **Status note (2026-06-20):** this is a historical snapshot of the 2026-05-17
> pass; its counts are accurate for that date, not today. The campaign's working
> queue has since moved to `.planning/v1.0.0-DEFERRED-AUDIT-DECISIONS.md` (still
> gitignored). The **durable, tracked** record of what remains deferred — IDs,
> rationale, and the "do NOT implement" landmine warnings — is
> [`docs/deferred-findings.md`](../deferred-findings.md). Read that for remaining
> work; the gitignored paths below are per-developer and may not exist locally.
> The per-file `FIX-REPORT-*.md` / `FIX-BRIEF-*.md` reports this pass cited as
> "checked into the repo" were campaign residue and have since been removed
> (their substance is folded into the working queue + `CHANGELOG.md`).

## Summary

| Metric | Value |
|--------|------:|
| Files re-verified (≥1 CRITICAL finding) | 91 |
| CRITICAL findings before | 142 |
| CRITICAL findings after | 135 |
| HIGH findings before | 750 |
| HIGH findings after | 726 |
| Findings closed in this pass | 46 |
| Findings re-classified as `⚠️ AMBIGUOUS-2026-05-17` | 105 |
| Findings kept (still live) | 420 |

The CRITICAL count drops by 7 (142 → 135) — modest because the prior closure
pass on 2026-05-16/17 already absorbed most of the explicit PR-named
closures. This pass adds the per-file `FIX-REPORT-*.md` extras that the
PR-body extraction missed (e.g., `FIX-REPORT-portfolio-py.md` lists 38
finding IDs vs the 21 named directly in PR #184's body).

## Methodology

For each finding in the 91 CRITICAL-bearing files, classify into one of:

- **CLOSED-by-PR-#NNN** — the finding ID appears in a merged-PR body
  (#169–#205) **or** in the per-file `FIX-REPORT-*.md` checked into the repo.
  Action: delete from `FIX-LIST.md`, append a row to `FIX-LIST-FIXED.md`.
- **CLOSED-by-current-state-2026-05-17** — the file path no longer exists,
  or a `grep`-level evidence check shows the bad pattern is gone.
  Action: same as above.
- **CLOSED-by-existing-test-\<file>** — the "no test" finding is satisfied
  by an existing test file (e.g., `test_portfolio_router_audit_2026_05_07.py`).
  Action: same as above.
- **STILL_LIVE-2026-05-17** — bad pattern persists in current `main`.
  Action: keep in `FIX-LIST.md`, status badge updated.
- **⚠️ AMBIGUOUS-2026-05-17** — file was touched by a merged PR but the
  specific finding ID was not enumerated in the PR body or runbook.
  Action: keep in `FIX-LIST.md` with status `⚠️ AMBIGUOUS-2026-05-17`,
  manual re-read required before further action.

**Conservative bias:** when in doubt, classify `AMBIGUOUS` not `CLOSED` —
under-closure is recoverable, false-closure silently buries real bugs.

## Inputs cross-referenced

- 31 merged PRs in this campaign: #169 #170 #171 #172 #173 #174 #175 #176
  #177 #178 #179 #180 #181 #182 #183 #184 #185 #186 #187 #188 #189 #190
  #191 #192 #193 #194 #195 #196 #197 #203 #204 #205
- Per-file fix reports: `FIX-REPORT-portfolio-py.md`,
  `FIX-REPORT-equity-reconstruction-py.md`, `.review/FIX-REPORT-2026-05-16-take2.md`
- Test inventory: `analytics-service/tests/test_portfolio_*.py`,
  `analytics-service/tests/test_equity_*.py`,
  `src/__tests__/*.test.ts`, `e2e/*.spec.ts`

## Results

### Tier counts

| Tier | Before | Closed this pass | After |
|------|-------:|----------------:|------:|
| CRITICAL | 142 | 7 | 135 |
| HIGH (≥7) | 750 | 24 | 726 |
| MEDIUM (≥8) | 1032 | 14 | 995 |
| LOW (≥9) | 77 | 1 | 73 |
| **All** | **2001** | **46** | **1929** |

### Hotspots after re-verification (top 12)

| File | C | H |
|------|--:|--:|
| `src/app/api/account/export/route.ts` | 6 | 4 |
| `src/app/api/admin/partner-import/route.ts` | 6 | 2 |
| `analytics-service/routers/cron.py` | 4 | 0 |
| `src/app/api/demo/match/[allocator_id]/route.ts` | 4 | 0 |
| `analytics-service/tests/test_match_engine.py` | 3 | 1 |
| `e2e/demo-public.spec.ts` | 3 | 4 |
| `e2e/discovery-watchlist.spec.ts` | 3 | 4 |
| `e2e/portfolio-pdf-demo.spec.ts` | 3 | 3 |
| `src/app/api/portfolio-optimizer/route.ts` | 3 | 0 |
| `src/lib/database.types.ts` | 3 | 1 |
| `src/proxy.ts` | 3 | 0 |
| `analytics-service/routers/portfolio.py` | 2 | 5 |

`analytics-service/routers/portfolio.py` dropped from 8 CRITICAL to 2
CRITICAL — the heaviest movement in the pass, driven by
`FIX-REPORT-portfolio-py.md` enumerating C-0206 / C-0207 / C-0208 / C-0214 /
C-0215 / C-0216 / C-0314 closure that PR #184's body alone did not name.

### Known unknowns (the AMBIGUOUS-2026-05-17 bucket)

105 findings now carry `⚠️ AMBIGUOUS-2026-05-17` — file was touched by a
merged PR but the specific finding ID was not enumerated. These cluster on:

- `src/app/api/account/export/route.ts` (10 findings) — touched by PR #180,
  but the CHAIN findings (C-0021..0028) are defense-in-depth concerns the
  PR body did not call out by ID.
- `src/app/(dashboard)/allocations/*` — touched by PRs #183 / #189 (allocator
  dashboard sweep) but only some IDs (C-0012, C-0332, C-0335) enumerated.
- `.github/workflows/*` — touched by PRs #179 / #188 / #190 / #193 / #194
  but only C-0293 named.

Each AMBIGUOUS entry still has its original Title / Summary / Evidence — the
next session can re-read the file in 5-10 minutes and decide CLOSED vs
STILL_LIVE per finding.

## Method limitations

1. **Did not run** any source-file `grep`/AST checks for the 105 AMBIGUOUS
   entries — only matched against PR bodies and `FIX-REPORT-*.md` files.
   A second pass that does targeted source reads could close 20–40 more.
2. **Did not run** the test suite to confirm the test-coverage claims for
   the closed `C-0206`-class findings — `FIX-REPORT-portfolio-py.md`
   asserts 128 passed in 1.62s, but this pass did not re-execute.
3. **Did not deep-dive** the 14 file blocks with non-`C-NNNN` IDs (G23
   format from retroactive PR-specific specialist audits). Those entries
   were preserved as-is.

## Next session

1. Read [`docs/deferred-findings.md`](../deferred-findings.md) for the durable,
   tracked list of what remains deferred (incl. the do-NOT-implement landmines).
   The full working queue (if present locally) is
   `.planning/v1.0.0-DEFERRED-AUDIT-DECISIONS.md` — formerly
   `.planning/audit-2026-05-07/FIX-LIST.md`; both gitignored, per-developer.
   (Counts here — 1929 findings: 135 C / 726 H / 995 M / 73 L — are the
   2026-05-17 snapshot; the campaign has since closed the criticals and the
   bulk of the queue.)
2. The closure log (`FIX-LIST-FIXED.md`) lives alongside the working queue in
   the gitignored `.planning/` dir.
3. Top priority hotspots: `src/app/api/account/export/route.ts` (6 C),
   `src/app/api/admin/partner-import/route.ts` (6 C),
   `analytics-service/routers/cron.py` (4 C),
   `src/app/api/demo/match/[allocator_id]/route.ts` (4 C).
4. Resume the fix-loop pattern: per-file `/gsd-discuss-phase` →
   `/gsd-plan-phase` → `/gsd-execute-phase` → `/ship` → merge.

## File map

| Artifact | Type | Status |
|----------|------|--------|
| `docs/deferred-findings.md` | tracked | durable deferred-findings record (added 2026-06-20) |
| `.planning/v1.0.0-DEFERRED-AUDIT-DECISIONS.md` | gitignored | current working queue (was `FIX-LIST.md`) |
| `.planning/audit-2026-05-07/FIX-LIST.md` | gitignored | rewritten 2026-05-17 (since relocated) |
| `.planning/audit-2026-05-07/FIX-LIST-FIXED.md` | gitignored | appended 2026-05-17 |
| `.planning/audit-2026-05-07/FIX-LIST.backup-precompact-2026-05-17.md` | gitignored | snapshot pre-pass |
| `docs/runbooks/fix-list-reverify-2026-05-17.md` | tracked | this file |
| `VERSION` | tracked | bumped |
| `package.json` | tracked | bumped (matches `VERSION`) |
| `CHANGELOG.md` | tracked | entry appended |
