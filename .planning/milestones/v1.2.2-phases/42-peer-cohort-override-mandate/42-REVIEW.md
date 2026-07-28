---
phase: 42-peer-cohort-override-mandate
reviewed: 2026-06-26T16:00:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - src/app/api/scenario/peer-rank/route.ts
  - src/app/api/scenario/peer-rank/route.test.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
  - src/app/factsheet/[id]/v2/BatchDPanels.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/lib/sample-basis-ratios.ts
  - src/lib/scenario-peer-request.ts
  - src/lib/factsheet/types.ts
  - src/lib/ratelimit.ts
  - src/lib/diversification.ts
  - src/lib/factsheet/audit-c20.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 42: Code Review Report

**Reviewed:** 2026-06-26T16:00:00Z
**Depth:** deep
**Files Reviewed:** 14
**Status:** issues_found (no BLOCKER; 2 WARNING + 3 INFO)

## Summary

Adversarial deep review of the Phase 42 scenario peer-cohort carve-out, mandate
chips, and own-book delta — focused on the highest-value invariants the prompt
flagged: cohort-leak resistance (#1), additive csv-arm carve-out / no
ingestSource flip (#2), basis/convention correctness (#3), and the frozen
scenario engine (#4).

**All four highest-value invariants hold.** The cohort distribution is
structurally unreachable from the client; `ingestSource` is never flipped and
the three genuinely-synthetic api panels stay structurally absent; the peer rank
and own-book delta both use the engine's sample/252 basis (proven equal to the
frozen engine by a real `computeScenario` parity test, not a stub); and
`src/lib/scenario.ts` is **zero-diff vs `origin/main`** (the phase-diff change is
a *revert* of a P41 freeze violation back to the frozen baseline — verified
below). Typecheck is clean (0 errors). The route test suite (15 cases), the
audit-c20 replacement, the parity pin, the convention pin, the panel render
suites, and the frozen-spine guards all pass (212 tests across the touched
suites).

The two WARNINGs are robustness/efficiency concerns, not correctness or security
holes; both are capped by existing controls (the limiter + honest-absence
fallback). No BLOCKER.

### Verification of the four critical invariants

| Invariant | Result | Evidence |
|-----------|--------|----------|
| #1 No cohort leak to client | PASS | Route projects EXACTLY 4 aggregate scalars; `PeerPercentilePayload` has EXACTLY those 4 fields; panel reads only those 4. Error path returns a constant string, never the raw DB message (route.ts:179-186, TC12). RPC error/identity strip + decile-quantization live inside the audited SECDEF body. |
| #2 ingestSource never flipped + byte-identity | PASS | `buildScenarioFactsheetPayload` always sets `ingestSource:"csv"` and conditionally spreads `scenarioPeer`/`scenarioMandate`/`scenarioOwnBookDelta` so the KEY is OMITTED when absent (payload.ts:466-478). audit-c20 proves the 4 synth fields absent (`f in payload === false`) and `ingestSource==="csv"` on a csv+scenarioPeer payload. |
| #3 sample/252 convention | PASS | Peer rank fed `scenarioMetrics` (engine `computeScenario`, sample/252) NOT `payload.strategyMetrics` (population). Own-book delta uses `sampleBasisRatios` on book returns — same formula, pinned EQUAL to `computeScenario` by a real engine call (scenario-sample-ratios.test.ts:139-152). |
| #4 scenario.ts frozen | PASS | `git diff origin/main..HEAD -- src/lib/scenario.ts` is EMPTY. The `4bcedb12..HEAD` change reverts P41's `DEFAULT_INCLUDE_FROM` export (commit 3be64980) back to the inline literal that matches origin/main. Frozen-spine guards (phase-29..32) green. |

## Warnings

### WR-01: Peer-rank fetch effect has no debounce — discrete blend edits fan out one POST each, uncapped except by the rate limiter

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1544-1582`
**Issue:** The fetch effect is keyed on the rounded engine metrics triple + `n`
(`[peerSharpe, peerSortino, peerMaxDD, peerN]`). Every distinct weight/leverage
edit recomputes `scenarioMetrics` and, when the rounded triple changes, fires a
new `POST /api/scenario/peer-rank`. There is no debounce/throttle, and the
stale-guard is a `cancelled` boolean — **not an `AbortController`**, so a
superseded in-flight request still completes server-side and burns a
`scenarioPeerLimiter` token. A user adjusting several constituents in quick
succession issues a burst of probe requests. This is bounded (the inputs are
`type="number"` spinners, not per-pixel range sliders, so it's per-edit not
per-drag-tick) and capped by the 60/min limiter (which fail-closes to 429 → the
`.catch`/null path hides the panel honestly), so it is a robustness/efficiency
concern, not a correctness or leak hole. But it both amplifies egress and
slightly weakens the probe-resistance budget the limiter is sized for.
**Fix:** Debounce the effect (e.g. 300-500ms) and/or thread an `AbortController`
into the fetch so the cleanup aborts the in-flight request:
```ts
useEffect(() => {
  const body = buildScenarioPeerRankRequest({ sharpe: peerSharpe, sortino: peerSortino, max_drawdown: peerMaxDD, n: peerN });
  if (!body) { setScenarioPeer(null); return; }
  const ctrl = new AbortController();
  const t = setTimeout(() => {
    fetch("/api/scenario/peer-rank", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { const peer = d && typeof d === "object" && "peer" in d ? (d as { peer: PeerPercentilePayload | null }).peer : null; setScenarioPeer(peer ?? null); })
      .catch(() => { if (!ctrl.signal.aborted) setScenarioPeer(null); });
  }, 350);
  return () => { ctrl.abort(); clearTimeout(t); };
}, [peerSharpe, peerSortino, peerMaxDD, peerN]);
```
(The current code is functionally correct for the no-stale-overwrite property —
this is a defense-in-depth + egress refinement, not a bug fix.)

### WR-02: Own-book delta compares same-FORMULA but potentially different observation WINDOWS; the basis note discloses `book_n` but not the window mismatch

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1628-1664`, `src/app/factsheet/[id]/v2/BatchDPanels.tsx:164-167`
**Issue:** The blend leg is `scenarioMetrics` (engine output over the
constituents' *overlap* window, from their include-from dates). The book leg is
`sampleBasisRatios(bookReturns)` derived from `baselineEquityDailyPoints` — the
allocator's *full live-book equity history*, which is generally a different
(and often longer) date range than the blend overlap. The two legs share the
sample/252 *formula* (so the subtraction is "like-for-like" in basis, as the
comment claims), but they are NOT necessarily over the same calendar window. The
delta is therefore a head-to-head of two differently-windowed series. This is
disclosed only indirectly: the panel note shows `{book_n} book observations`,
which lets a careful reader notice `book_n != blend_n`, but the copy
("sample/252 basis") implies full comparability. Not a data-loss or leak bug —
the number is honestly computed — but the window mismatch is a latent honesty
gap given the panel's "vs Your Book" framing.
**Fix:** Either (a) clip both legs to the common overlapping date window before
computing each leg's ratios, or (b) make the disclosure explicit, e.g. append
"over each series' own window ({blend_n}d blend · {book_n}d book)" so the reader
sees the window difference rather than inferring it from a lone `book_n`.

## Info

### IN-01: `sample-basis-ratios.ts` docstring references a non-existent test filename

**File:** `src/lib/sample-basis-ratios.ts:13-15`
**Issue:** The module docstring says it is pinned by
`sample-basis-ratios.test.ts`, but the actual parity test file is
`scenario-sample-ratios.test.ts` (there is no `sample-basis-ratios.test.ts`).
A future maintainer searching for the named pin will not find it.
**Fix:** Update the docstring reference to `scenario-sample-ratios.test.ts`.

### IN-02: `MIN_COHORT_N` constant in the route is documented as never-branched-on but IS branched on

**File:** `src/app/api/scenario/peer-rank/route.ts:40-45` and `:203`
**Issue:** The comment at :42-44 says "the route never branches on it directly
(a NULL sharpe_pct is the authoritative 'suppressed' signal)", but line 203
literally branches on it: `row.cohort_n < MIN_COHORT_N`. The branch is harmless
belt-and-suspenders (the RPC already NULLs the percentiles below the floor, so
the prior `sharpe_pct === null` disjuncts already short-circuit), but the
comment contradicts the code. Minor doc/code drift.
**Fix:** Reword the comment to "the route also belt-and-suspenders re-checks the
floor (line 203) in case a future RPC change returns a non-NULL pct with a thin
cohort_n", or drop the now-redundant `cohort_n` disjunct since the NULL-pct
checks already cover it.

### IN-03: Live-DB RLS integration tests skip silently outside a credentialed environment

**File:** `src/__tests__/verified-cohort-rank-rls.test.ts:131,203,291,344`
**Issue:** Four `it.skipIf(!HAS_LIVE_DB)` cases (the cross-tenant aggregate
correctness, min-N suppression, anon-reject, and decile-quantization integration
checks) skip in CI/local without Supabase creds. The migration was separately
audited (migration-reviewer + rls-policy-auditor, per the objective), and the
file includes a non-skipped advertisement of the skip reason, so this is
acceptable — but the load-bearing security properties (anon-reject, min-N
suppression, identity strip) are proven by the SQL audit, not by an
always-running test in this suite. Noted so the skip is not mistaken for
coverage.
**Fix:** None required for this phase (migration audited). Optionally wire these
into a periodic credentialed integration job so the in-DB guarantees stay
regression-tested independent of the migration review.

---

_Reviewed: 2026-06-26T16:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
