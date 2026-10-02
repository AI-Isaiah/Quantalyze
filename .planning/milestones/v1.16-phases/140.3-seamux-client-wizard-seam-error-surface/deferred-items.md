
---

## Logged by `140.3-11`, 2026-07-27

### DEF-11-1 — `analytics-service/docs/STATUS_CONTRACT.md` still documents `VenueTransientHTTPException` as **400**

`140.3-06` remapped all seven sites to `424` (commit `1f8ad052`) and rewrote the argument at six
places in Python source — but the contract DOC's own app-global-handler table still reads:

> | `VenueTransientHTTPException` | `main.py:608` | **400** (class admits any 4xx) | … |

That is now false, and the doc is the canonical emit-side reference every consumer plan reads.
**Not fixed here:** `140.3-11` is fenced to zero files under `analytics-service/` (its own scope note
and this phase's standing rule), and `140.3-06` is the phase's only sanctioned Python wave.
**Owner: `140.3-16` (phase gate) or Phase 141.** One table cell.

### DEF-11-2 — five `e2e/match-queue.spec.ts` admin-gate cases fail LOCALLY, on routes this plan never opened

Running `npx playwright test match-queue.spec.ts` locally: **2 passed, 5 failed, 6 skipped**. All five
failures are the same assertion, `expect([307, 401, 403]).toContain(res.status())`, receiving **200**:

```
GET  /api/admin/match/allocators   ← NOT touched by 140.3-11
POST /api/admin/match/recompute
POST /api/admin/match/send-intro   ← NOT touched by 140.3-11
GET  /api/admin/match/kill-switch  ← NOT touched by 140.3-11
POST /api/admin/match/decisions    ← NOT touched by 140.3-11
```

**Four of the five are routes this plan never opened**, and the fifth (`recompute`) was changed only
inside its `catch` block, strictly BELOW the admin gate — an anti-regression case in each of the two
route test files pins that the new arm stays behind the gate (T-140-12). The cause is the local
run's auth/storage state (the request context is authenticated as the admin role, so a 200 is the
correct answer to it), not a gate regression. **Not this plan's to fix; recorded rather than
silently skipped.** The `/admin/match/eval` UI case and the redirect cases PASSED.

---

## DEF-15-1 — `SyncPreviewStep` has a SECOND, local wire→wizard table that admits none of
## `process-key-client`'s four codes. Found by `140.3-15`; NOT fixed, deliberately.

**Found:** 2026-07-28, while wiring TS-38's new code. **Owner:** SEAMUX-01 / `140.3-16` to route.

`src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:143` declares
`KNOWN_KICKOFF_CODES`, a local `Record<string, WizardErrorCode>` that is entirely separate from
`recogniseSeamErrorCode` in `wizardErrors.ts` (the ONE table `140.3-05` established). It admits
five codes — `RATE_LIMITED`, `GATE_DRAFT_GONE`, `COMPOSITE_MEMBERSHIP_UNKNOWN`,
`MISSING_STRATEGY_ID`, `INVALID_STRATEGY_ID` — and **none of the four codes
`process-key-client` puts on the wire**. `/api/keys/sync` does `if (!result.ok) return
result.response`, so all four reach this component and all four fall to `SYNC_FAILED`:

| Wire code | At `SubmitStep` | At `SyncPreviewStep` |
|---|---|---|
| `CIRCUIT_OPEN` | `SERVICE_UNAVAILABLE_RETRY` | **`SYNC_FAILED`** |
| `UPSTREAM_TIMEOUT` | `SERVICE_UNREACHABLE` | **`SYNC_FAILED`** |
| `UPSTREAM_NETWORK_ERROR` | `SERVICE_UNREACHABLE` | **`SYNC_FAILED`** |
| `SEAM_MISCONFIGURED` (new) | `SEAM_MISCONFIGURED` | **`SYNC_FAILED`** |

**PRE-EXISTING, not a regression.** The three older codes have been in this position since
`140.3-05`; `-10` and `-12` both opened this file and left them. The new code is treated
IDENTICALLY to its siblings, so nothing got worse.

**⚠️ WHY THE ONE-LINE FIX WAS REFUSED — it trips TRAP-4.** Adding `SEAM_MISCONFIGURED` alone to
`KNOWN_KICKOFF_CODES` makes a NON-RECOVERABLE code reachable at this render. No Retry control
renders (that is correct), and the SOLE remaining control becomes **"Try another key"**, which fires
`handleDeleteDraft()` and **DESTROYS the draft and every `strategy_keys` member under it**. Swapping
the user's key cannot fix a misconfiguration on our side. Closing it therefore requires widening
`DESTRUCTIVE_CONTROL_IS_WRONG_FOR` in the SAME change — exactly the coupling `140.3-12` had to make
when it routed the two 400 arms to `VALIDATION_FAILED`.

**Shape of the real fix (for whoever takes it):** route the kickoff code through
`recogniseSeamErrorCode` FIRST and fall back to the local table — the order `SubmitStep`'s own
comment prescribes — and add every resulting non-recoverable member to
`DESTRUCTIVE_CONTROL_IS_WRONG_FOR` in the same commit. That is a 4-code class change with a
data-loss failure mode, owned by SEAMUX-01, and it is not a drive-by.

---

## Logged by `140.3-16` (phase gate), 2026-07-28

### DEF-16-1 — four PRE-EXISTING test files stub `fetch` with no `vi.unstubAllGlobals()`

Found while adjudicating **Oracle Independence hazard 8** ("no global `unstubGlobals` safety net —
a leaked `vi.stubGlobal("fetch")` is this repo's known CI-only failure cause, CI Node 22 vs local
Node 25"). Enumerated rather than sampled: **38 test files stub `fetch`; four never unstub.**

| File | Introduced by |
|---|---|
| `src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx` | `6c8b5e08` feat(116-01) |
| `src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx` | `b8a0337b` v0.29.0.0 |
| `src/app/(dashboard)/allocations/components/WatchlistPanel.test.tsx` | `98f4472c` v0.42.0.0 (v1.10) |
| `src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx` | `044bee50` v0.41.0.0 (v1.9) |

**ALL FOUR ARE PRE-EXISTING and none is a seam file.** Verified: **zero** of Phase 140.3's own test
files stub `fetch` without unstubbing, so the hazard is clean for this phase.

**NOT FIXED HERE, deliberately.** Out of scope under the executor scope boundary (only issues
directly caused by the current task's changes), and specifically out of scope for a *gate*: this
plan changes no production behaviour, because a gate that repairs what it is measuring cannot
measure it. The leak is latent — it surfaces only if one of these files runs before an unrelated
test that expects the real `fetch`, which is why it has survived four separate phases.

**Owner:** any future test-hygiene pass. Four `afterEach(() => vi.unstubAllGlobals())` lines.

### DEF-16-2 — two acceptance criteria in `140.3-16-PLAN.md` were unsatisfiable or stale as written

Recorded because this phase's own count of such criteria (~33) is the reason the "measure the grep on
the untouched tree FIRST" rule exists, and the gate was not exempt from it.

1. **The ledger-completeness grep is VACUOUS.** It anchors on the empty-box glyph followed by the
   word *pending*; the ledger's marker is a bare glyph alone in a table cell. **Pre-value on the
   untouched tree: 0 — while three rows (M57, M58, M75) were genuinely unrun.** The criterion would
   have passed a tree with every row pending. Real anchor: the glyph delimited by pipes; pre-value
   **3**, post-value **0**.
2. **The hazard-1 count criterion is STALE BY ONE.** It requires *exactly 12*; the untouched tree
   already measured **13**. The thirteenth is `src/lib/seam-copy.pin.test.ts`, the cross-copy pin
   `140.3-04` added — an ADDITIONAL independent hand-typed oracle, which is the opposite of the
   consolidation TRAP-9 forbids. The twelve originals all predate the phase.

**Owner:** none — both are adjudicated in `140.3-16-SUMMARY.md` with measured pre-values. Logged so
a future reader re-running the plan's criteria verbatim is not misled by either.

---

## Logged by `140.3-G2` (gap closure), 2026-07-28

### DEF-G2-1 — the SC2 residual: two wire codes reach `SubmitStep` with no wizard member

`finalize-wizard` can put two codes in front of a user that are not `WizardErrorCode` members:

| Code | Emitted at | Pinned at |
|---|---|---|
| `draft_state_invalid` | `finalize-wizard/route.ts:1190` (409) | `SubmitStep.test.tsx` — pre-existing, added before this plan |
| `COMPOSITE_UNSUPPORTED_UNIFIED` | `finalize-wizard/route.ts:1551` (409, the LIVE unified-backbone path) | `SubmitStep.test.tsx` — **added by this plan** |

Both fall through the `KNOWN_FINALIZE_CODES` membership check in `SubmitStep.tsx` (measured: **9**
members at HEAD) and resolve to `UNKNOWN`. `UNKNOWN`'s copy is recoverable, so the user still gets a
Retry affordance; what is lost is *specificity* — SC2's recognition clause and SC6's specificity
clause — and the `wizard_error` funnel reports `UNKNOWN`, so telemetry cannot separate this arm from
any other unrecognised one.

**Already honest in production source.** `wizardErrors.ts:1543` names both codes and states that
they are deliberately out of scope. This item does not discover the residual; it gives it an owner
and a falsifiable pin.

**⚠️ WHY THE ONE-LINE FIX WAS REFUSED HERE — it trips TRAP-4, the same coupling as DEF-15-1.**
Admitting a code to `KNOWN_FINALIZE_CODES` is a CODE-SET change. If the admitted member's copy is
non-recoverable it renders no Retry, and the sole remaining control on that render can become "Try
another key" → `handleDeleteDraft()`, which destroys the composite draft and every `strategy_keys`
member under it. Closing this therefore requires widening `DESTRUCTIVE_CONTROL_IS_WRONG_FOR`
(`SyncPreviewStep.tsx:1341`) in the SAME commit. TRAP-4 is a locked `140.3-CONTEXT.md` decision and
the verifier ENDORSED `140.3-15`'s refusal of the adjacent one-liner for exactly this reason.

⚠️ **Measured, additional obstacle that route (a) must budget for:**
`COMPOSITE_UNSUPPORTED_UNIFIED` is **not a `WizardErrorCode`** (`grep -c '"COMPOSITE_UNSUPPORTED_UNIFIED"'
src/lib/wizardErrors.ts` → **0**). `KNOWN_FINALIZE_CODES` is declared `new Set<WizardErrorCode>([…])`,
so adding the string literal to it does not type-check. Route (a) is therefore not one line: it is
either (i) a new `WIZARD_ERROR_COPY` member with authored copy — which moves the copy-table size and
so must bump BOTH `EXPECTED_TABLE_SIZE` literals in `src/lib/wizardErrors.test.ts` in the same
commit — or (ii) an alias row in `SEAM_CODE_TO_WIZARD_CODE` (`wizardErrors.ts`), the ONE wire→wizard
table, which is the mechanism the production comment in `SubmitStep.tsx` prescribes. Option (ii) is
cheaper but note `wizardErrors.ts:1530-1535`'s own warning that minting or aliasing a second member
with the same meaning is how a vocabulary starts lying — pick the alias only if an existing member is
genuinely the same fact.

**Owner: `Phase 140.4`** — named directly and deliberately. DEF-15-1's own owner line
(`deferred-items.md:43`) reads *"SEAMUX-01 / `140.3-16` to route"*, and `140.3-16` completed without
routing it, so that owner now resolves to a closed plan and the item has no live home. Naming a phase
rather than a plan or an indirection is what stops that happening a second time.

**Do DEF-G2-1 and DEF-15-1 together.** They are the same TRAP-4 coupling on the two sibling code sets
(`KNOWN_FINALIZE_CODES` and `KNOWN_KICKOFF_CODES`). Doing them separately trips TRAP-4 twice and
requires the destructive-control review twice.

### DEF-G2-2 — two PARTIAL source-scan guards, defeatable by a wrapper. No live violation at HEAD.

Recorded because `140.3-GAP-PATTERNS.md` §7.2 ranks these 2nd and 3rd by exposure and neither
gap-closure plan closes either. **The point of the record is that "unmentioned" must not be allowed
to read as "unfound."**

| Guard | Needle | How it is defeated |
|---|---|---|
| `src/lib/seam-log-coverage.test.ts:329` | `CREDENTIAL_BEARING_CALLS` matched by literal `code.includes("validateKey(")` / `"encryptKey("` | An aliased import (`import { validateKey as vk }`) or a new local helper wrapping the call is invisible to it (§2.4) |
| `src/lib/seam-budgets.invariant.test.ts:755` | `/\bresilientFetch\s*\(/`, plus the import-edge check at `:749` | The two provably do NOT compose: a path reaching the core through `analyticsRequest(` or any of the 9 public `analytics-client` wrappers passes BOTH checks while never naming `resilientFetch` (§2.5) |

**No live violation at HEAD for either.** These are latent guard-decay hazards, not open defects —
which is precisely why they are deferrable and precisely why they must be written down rather than
left to be rediscovered.

**The wrapper-aware idiom to copy** is already in this repo:
`src/__tests__/audit-coverage.test.ts:309` plus `:431-441` (`HELPER_MUTATORS` — module edge AND a
per-name `\b<name>\s*\(` matcher; path re-verified at HEAD, `GAP-PATTERNS` §7.2 cites it without the
`src/__tests__/` prefix), which resolves through wrappers instead of matching one spelling. The same lesson in
its most expensive form is `140.3-G1`'s finding that the poll pin's `/\bfetch\s*\(/` needle saw 0 of
11 real call sites because every one was spelled `wizardFetch(`.

**Owner: `Phase 140.4`**, alongside `complete-status-scan.test.ts` (6 live invisible sites, §7.2
rank 1 — the one with actual violations today) and the ~50 unmapped Python source-reading tests.

### DEF-G2-3 — three stale prose counts in `TouchTooltip.tsx` are BLOCKED by the Phase 52 frozen-island gate

`140.3-G2` / GC-4 deleted five hand-maintained counts. **Three of them could not be landed**, and the
reason is a working fence, not an oversight.

| Site | Stale text | Actual (measured 2026-07-28) |
|---|---|---|
| `src/components/charts/TouchTooltip.tsx:10` | *"across 18 files"* | **20** importers |
| `src/components/charts/TouchTooltip.tsx:10` | *"18× inline `trigger` duplication"* | same population, **20** |
| `src/components/charts/TouchTooltip.tsx:37-38` | *"all / 18 charts pass only `formatter` + `contentStyle`"* (wraps across two lines) | same population, **20** |

Measured three independent ways, all agreeing on 20: the `@/components/charts/TouchTooltip` import
edge, the relative `./TouchTooltip` edge (10 files under `src/components/charts/` use it — a naive
absolute-specifier grep sees only half and returns 10), and `grep -rl '<TouchTooltip'`.

**Why it is blocked.** `src/__tests__/phase-52-frozen-spine-guards.test.ts` lists this file in
`FROZEN_ISLANDS` and asserts it is **zero-diff** vs `git merge-base origin/main HEAD`. The
assertion is content-blind: a comment-only edit reddens it exactly like an RSC-ification would. The
full suite caught the attempt (`1 failed | 9791 passed`) and the edit was reverted in `a77d607e`.

**Why it was NOT force-landed.** The gate has a documented carve-out mechanism — Phase 103 removed
`HistogramChart.tsx` and `MasterBrush.tsx` from `FROZEN_ISLANDS` — but that was a *reviewed* unfreeze
with a substantive cause (they read `usePayload()` directly and rendered cash under an MTM label) and
a replacement gate (`HistogramChart.basis.test.tsx` / `MasterBrush.basis.test.tsx`). Unfreezing an
island to land a **comment** meets none of that bar, and the guard's own inline note reads
*"TouchTooltip.tsx + useTapPin.ts STAY FROZEN below."* Deleting a working fence to fix documentation
is TRAP-9, which `140.3-G2` is explicitly bound by.

**Partial mitigation already shipped.** The neighbouring guard docblock
(`tests/visual/recharts-touchtooltip-usage.test.ts`) — which is NOT frozen — now states that no chart
count is asserted anywhere, that the guard compares the derived importer list against a
single-entry allow-list (`toEqual([ALLOWED])`) and never reads the population size, and that a count
must not be reintroduced. A reader who arrives at the stale numbers from the guard side is warned.
The numbers themselves remain in the frozen file.

**Owner: `Phase 140.4`**, to be taken **only** alongside a genuine reason to open the island — never
as a standalone comment edit. Two acceptable shapes: (i) ride the correction on the next reviewed
unfreeze of the chart-interactivity spine, or (ii) re-baseline the frozen set at the next phase
boundary, where `merge-base origin/main HEAD` moves and the zero-diff window resets.

⚠️ **Do not "fix" this by removing `TouchTooltip.tsx` from `FROZEN_ISLANDS`.** That converts a
documentation defect into a coverage hole.
