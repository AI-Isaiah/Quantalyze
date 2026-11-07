---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
round: 3
reviewed: 2026-11-07T03:46:51Z
depth: standard
diff_base: 79e5bc0fb
head: 6109c75bf
files_reviewed: 11
files_reviewed_list:
  - .github/workflows/ci.yml
  - lighthouserc.json
  - public/security-packet.pdf
  - scripts/build-security-packet.html
  - src/__tests__/critical-regressions.test.ts
  - src/__tests__/public-truth-census.test.tsx
  - src/__tests__/public-truth-copy.test.tsx
  - src/__tests__/security-packet-date-drift.test.ts
  - src/app/(marketing)/for-quants/page.tsx
  - src/app/(marketing)/security/page.test.tsx
  - src/app/(marketing)/security/page.tsx
findings:
  critical: 0
  warning: 0
  info: 5
  total: 5
status: issues_found
---

# Phase 192: Code Review Report, round 3 (fixer round 2 re-review)

**Reviewed:** 2026-11-07T03:46:51Z
**Depth:** standard
**Scope:** `git diff 79e5bc0fb..HEAD -- . ':!.planning'` at HEAD `6109c75bf` (11 files, commits `2a34b0aea`, `2d1619f40`, `96a7e5da3`, `e65d597ac`)
**Status:** issues_found (info only: no MEDIUM+ finding)

## Narrative Findings (AI reviewer)

## Summary

All three round-2 warnings and SFH-3 are resolved. The fixes introduce no new MEDIUM+ issue. One new info item (IN-05) concerns the wording of the `_ratchet` text. The four round-1 info items carry over unchanged.

What I checked at HEAD:

- **Copy against the trigger.** `api_keys_published_composite_delete_guard` (`supabase/schema/baseline.sql:15617`, body `:4735-4762`) is a `BEFORE DELETE` on `api_keys`. It raises only when the key is a `strategy_keys` member of a `status = 'published'` strategy, and the `sanitize_in_progress` session var is the only exemption. The new sentence, "A key used by a published composite cannot be deleted", describes exactly that population. It does not over-claim for draft, pending or archived composites, or for single-key links.
- **Copy against the in-app text.** The new sentence is byte-identical to `deleteCompositeWarning`'s published arm in `src/components/strategy/key-card-copy.ts:320-321`. It appears in the same words on `/for-quants` (`page.tsx:330`), `/security` (`page.tsx:107-109`, with `&apos;` rendering as `'`) and the packet (`build-security-packet.html:263-265`). "The contact form" resolves to a real route (`src/app/(marketing)/contact`).
- **PDF.** `pdftotext` on the old and new PDFs differs only in the Deletion row, which now carries the new sentence. The PDF is still 1 page, and its metadata holds no path (Title, Creator HeadlessChrome, Producer Skia).
- **Census.** `RAW_ID_TEMPLATE_PATTERN = /(Strategy|Exploratory) #\s*\$?\{/` catches the template form, the JSX form and a JSX form wrapped across lines (`#` and then `{` after whitespace collapse). `RAW_ID_HELPER_PATTERN` hits both the import and the call. No scanned marketing file imports a strategy component that calls `displayStrategyName` transitively today (the marketing import set was checked).
- **SFH-3 pin.** I neutered the critical-regressions regex in node against `ci.yml`. Removing `include-hidden-files: true` makes it fail. Setting `if-no-files-found: ignore` makes it fail. HEAD passes. The step is the last one in the file, and the lookahead stops at the next `- ` step, so the pin cannot pick up another job's step. The `include-hidden-files: true` plus `error` pair matches the repo's existing uploads (`ci.yml:526-527`, `:1601`). lhci's `temporary-public-storage` upload writes `.lighthouseci/`, so the `error` setting only fires when lhci never ran.
- **Gates.** The 5 touched test files pass (288 tests). `eslint` on the 7 changed TS/TSX files is clean. `tsc --noEmit` is clean. `lighthouserc.json` parses, and the assertion reads `minScore: 0.82`. No test pins the old 0.85.

## Round 2 dispositions

| Round-2 id | Verdict | Evidence at HEAD |
|---|---|---|
| WR-01 "Delete a key anytime" is false for a published-composite key | **Resolved** | Title is now "Delete a key". The exception sentence is on all three surfaces and the PDF, in the same words as `key-card-copy.ts:321`. Pins: `public-truth-copy.test.tsx:172-181` (new sentence, and rejects "Delete a key anytime"), `security/page.test.tsx:668`, `security-packet-date-drift.test.ts:165-174` (packet and page). The scope matches the trigger's `s.status = 'published'` predicate. |
| WR-02 raw-id guard misses JSX and the shared helper | **Resolved** | Pattern widened to `#\s*\$?\{`. `displayStrategyName` is banned by name in `SCAN_ROOTS`. The self-test plants real JSX and helper files (`public-truth-census.test.tsx:331-337`) and checks a negative case (`displayStrategyNames`). The docblock now limits the claim to "labels a scanned file builds ITSELF". The rendered-half test name says it sees literal ids only. Residual, not raised: string concatenation (`"Strategy #" + id`) and a transitive import through a component outside the roots are not caught. No marketing file has either form today. |
| WR-03 0.85 floor had no noise margin | **Resolved** | `minScore` is 0.82, which is the lowest observed median (`/browse` 0.84, run `41840603606`) minus 0.02. `_ratchet` records the 17-run range, says the assertion is best-of-3 (lhci `optimistic`) and says the derivation is conservative for that reason. See IN-05 for one wording slip. |
| SFH-3 Lighthouse upload uploaded nothing | **Resolved** | `include-hidden-files: true` and `if-no-files-found: error` are at `ci.yml:7313-7314`. The new pin at `critical-regressions.test.ts:922-943` bites on both keys (neuter-checked). |
| IN-01 to IN-04 | Open, info, unchanged | No fix touched them. |

## Info

### IN-05: `_ratchet` says the first check comes after merge, but `lighthouse-mobile` runs on every PR

**File:** `lighthouserc.json:30` (the `_ratchet` text, "the first lighthouse-mobile run after merge is the check")

**Issue:** The job header at `ci.yml:7178-7182` and the aggregator note at `:3636-3637` both say the job "still runs on every PR". So the first run on this phase's own code is the PR run, not the post-merge run. Round 2 asked for confirmation on this PR's own `lighthouse-mobile` run before merge. The text moves that check to after merge. The job is advisory and does not block the merge, but a red on `main` still reaches Railway's check-run gate.

**Fix:** Say "this PR's own lighthouse-mobile run is the check", and read that run's medians before merge.

### IN-01: ADR-0014 names `HMAC_SECRET`, but the code reads `DEMO_PDF_SECRET`
**File:** `docs/architecture/adr-0014-secret-handling.md:37`, `:124`. Unchanged since round 1.

### IN-02: The link census does not scan `src/lib`
**File:** `src/__tests__/public-truth-census.test.tsx:173` (`LINK_SCAN_ROOTS`). Unchanged since round 1.

### IN-03: Comments still cite deleted demo files as live
**Files:** `e2e/svg-chart-parity.spec.ts:95`, `e2e/helpers/reflow.ts:7`, `e2e/reflow.spec.ts:25`, `src/components/ui/CardShell.tsx:9`, `src/app/portfolio-pdf/[id]/page.tsx:123`, `src/app/(marketing)/security/page.tsx:14`. Unchanged since round 1.

### IN-04: An old shared `/demo` link sends a signed-out visitor to the login form
**File:** `src/proxy.ts:18`. Unchanged. This was a deliberate decision.

---

_Reviewed: 2026-11-07T03:46:51Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Round: 3_
