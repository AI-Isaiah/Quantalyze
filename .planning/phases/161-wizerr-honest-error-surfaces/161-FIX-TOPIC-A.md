# 161 REVIEW FIX — TOPIC A: coverage-law derivation (WR-02, WR-03, IN-04)

**Fixed at:** 2026-08-25
**Source review:** `.planning/phases/161-wizerr-honest-error-surfaces/161-REVIEW.md`
**Branch:** `feat/v1.20-phase-161-wizerr` (MAIN working tree — no worktree, no commit)
**Where verification ran:** the MAIN checkout, so every number below is reproducible
from the tree the reader is looking at.

| Finding | Status | Files |
|---|---|---|
| WR-02 | fixed, falsifiability proven by observed RED | `src/lib/dialog-envelope.invariant.test.ts` |
| WR-03 | fixed, regression pin proven by observed RED | `src/app/api/keys/[id]/permissions/route.ts`, `…/route.test.ts` |
| IN-04 | fixed (documentation correction, re-measured at HEAD) | `src/lib/wizardErrors.invariant.test.ts` |

⛔ Left UNCOMMITTED, per the orchestrator's sequential-commit protocol.

---

## WR-02 — the ARRIVAL law's population is now DERIVED from the route

**File:** `src/lib/dialog-envelope.invariant.test.ts`

### What changed

1. **`ROUTE_PATHS`** — a new `Record<DashboardDialogRoute, string>` mapping each roster key
   to its route handler on disk. This is the third independent artefact the derivation
   reads (the roster is the first, the hand-typed list is the second).
2. **`deriveEmittedCodes(source)`** + **`EMITTER_BODY_MAX_CHARS = 180`** — the emitter
   scanner, modelled on the sibling `emitterRe` / `deriveEmittedCodes` in
   `wizardErrors.invariant.test.ts:155-161, 404-410`.
3. **The ARRIVAL case now iterates `new Set(derived)`**, not `dialog.emittedCodes`. A hard
   `expect(derived.length).toBeGreaterThan(0)` vacuity fence sits above the loop.
4. **A new `A. DRIFT` case** holds the derivation against **two** hand-typed oracles:
   `emittedCodes` (WHICH codes) and the new `expectedEmitterSites` (HOW MANY ARMS).
   Neither is `derived.length` or `[...new Set(derived)]`.
5. **Four new SELF-TESTs** — both call shapes (positive); `{ error, code }` / success body /
   lowercase code / computed code (negative); a commented-out emitter (negative); and the
   swallow hazard (below).
6. Header docblock part **A** corrected — it claimed a property the case did not have.

### The predicate, and why it departs from the sibling

The sibling requires `NextResponse.json(` **and** a `{ status: … }` second argument.
Measured at HEAD, that predicate derives **zero** emitters on
`portfolio-strategies/allocation`, because that route answers through its own
`json(body, status)` helper (`route.ts:124-131`) which passes the status **positionally**.
Applying the review's suggested snippet verbatim would have wired an assertion over an
empty population on a third of the law — the exact defect the file's own header forbids.

The predicate used instead: `(?:NextResponse\.)?json\(` + first argument opening
`code: "<UPPER_SNAKE>"` immediately followed by `error:` + a second argument present. The
`error:` key does the work the status did — every success body on these three routes is
`{ ok: true, … }` and carries no `error:`. Verified by the negative self-test.

The two levers the sibling refuses to relax are preserved: **`code:`-first key order** and
the **`[A-Z][A-Z0-9_]*` literal class**.

### The cap: an honest downgrade, not a copied argument

The sibling justifies `EMITTER_BODY_MAX_CHARS = 160` arithmetically (longest real body 90 <
160 < 202 nearest neighbour). **That argument does not hold on these routes.** Measured
2026-08-25 on the comment-stripped sources:

| Route | longest real `error:` … `}` body | shortest emitter-`error:` → next emitter `code:` |
|---|---|---|
| `strategies/[id]/name` | 22 | 150 |
| `strategies/[id]/ownership` | 81 | 150 |
| `portfolio-strategies/allocation` | **107** | **77** |

77 < 107, so **no** cap can both clear every real body and make cross-emitter reach
arithmetically impossible. Rather than write 160 and repeat an argument that is false here
(which would be this phase's own defect class in a comment), the docblock states the cap for
what it is: a bound on backtracking at ~1.7× the longest real body. What actually keeps the
scan on the right emitter is the **lazy** quantifier terminating at the emitter's own `},`.

The one shape that defeats it — an emitter with no second argument, whose close is followed
by `)` — is **pinned by a self-test**, and its failure is loud, not silent: it drops the
derived site count and `expectedEmitterSites` reds.

### Measured population (the derivation's own output at HEAD)

| Dialog | route | sites | distinct codes |
|---|---|---|---|
| RenameStrategyDialog | `strategies/[id]/name` | **9** | 7 |
| MarkOwnershipDialog | `strategies/[id]/ownership` | **14** | 7 |
| AllocateDialog | `portfolio-strategies/allocation` | **23** | 7 |

Site counts cross-checked independently against `grep -n 'code: "'` on each route (9 / 14 /
23 code-literal lines after excluding the one docblock mention on each of the first two).

### ⭐ The derivation immediately found a live drift

`RenameStrategyDialog.emittedCodes` carried **`DASHBOARD_WRITE_FAILED`**, and the name route
**does not emit it**. That route has exactly one 500 arm — the UPDATE failure — and
161-REVIEW / CR-01 had already moved it to `DASHBOARD_WRITE_INDETERMINATE`. The hand-typed
list kept a code for a write the route can no longer report, and nothing reddened, because
nothing read the route. Removed, with the reason recorded at the row (it stays a *roster*
member on purpose: ARRIVAL is one-directional, route → roster).

### Falsifiability — OBSERVED RED, first-hand

Mutation: added an unrostered arm to `src/app/api/strategies/[id]/name/route.ts`:

```ts
if (updatedRows.length > 1) {
  return NextResponse.json(
    { code: "MUTATION_PROBE_UNROSTERED", error: "internal error" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}
```

`npx vitest run src/lib/dialog-envelope.invariant.test.ts` → **2 failed | 15 passed**:

```
× A. ARRIVAL: every code the ROUTE emits is rostered OR an explicit disposition
AssertionError: RenameStrategyDialog: MUTATION_PROBE_UNROSTERED is emitted by
strategies/[id]/name but is neither in its roster nor listed as a deliberate
non-envelope. It will render UNKNOWN — 'we could not classify this failure' —
for a failure the route classified.: expected [ Array(1) ] to deeply equal []

× A. DRIFT: the derived emitter set matches BOTH hand-typed oracles
AssertionError: RenameStrategyDialog: strategies/[id]/name now has 10 coded
rejection sites, not 9. … expected 10 to be 9
```

Both oracles fired independently. The probe was reverted with the exact inverse `Edit`
(**not** `git checkout --`); `git diff --stat` on that route is now **empty**, and the law is
back to **17 passed**.

Before the fix this same mutation produced **zero** failures — the arm was simply not in the
population the law iterated.

---

## WR-03 — the 161-01 literal is now `code:`-first

**Files:** `src/app/api/keys/[id]/permissions/route.ts` (~:564-605),
`src/app/api/keys/[id]/permissions/route.test.ts`

### What changed

The `KEY_UNDECRYPTABLE` arm's body literal transposed `{ error, code }` → `{ code, error }`.
**Zero behaviour change** — JSON has no key order; only scanner visibility moves. Matches the
precedent 161-09 set on `keys/validate-and-encrypt`.

A key-order note was added at the arm explaining why the order is load-bearing despite JSON
having none, and **recording the residue** rather than hiding it.

### ⚠️ Recorded residue (not fixed — out of this finding's scope)

Three coded arms in the same file remain `error:`-first and stay invisible to a `code:`-first
predicate. None was minted by 161-01:

| Line | Code | Note |
|---|---|---|
| ~:443 | `CIRCUIT_OPEN` | pre-existing (140.3-04) |
| ~:509 | `PROBE_RATE_LIMITED` | pre-existing (140.4-13) |
| ~:665 | computed `code` | excluded by the literal class regardless of order |

Recommend booking the transposition of ~:443 / ~:509 in TODOS.md. The review explicitly asked
for a *note* on these rather than a reorder, and that is what was done.

### Regression pin — and why it is a source-shape assertion

No behavioural test in that suite can distinguish `{ code, error }` from `{ error, code }`;
all 44 pre-existing cases stay byte-identically green either way. That invisibility *is* the
problem, so the new pin
(`[161-REVIEW / WR-03] the arm is \`code:\`-FIRST, so a coverage law can see it`) scans the
comment-stripped route source with the same `code:`-first predicate the coverage laws use,
asserts a non-empty population first, then asserts membership.

### Falsifiability — OBSERVED RED, first-hand

Mutation: transposed the two keys back. `npx vitest run … -t "WR-03"`:

```
× [161-REVIEW / WR-03] the arm is `code:`-FIRST, so a coverage law can see it
AssertionError: the `code:`-first scanner found NO coded rejection in this route
— every assertion below is vacuous until this is non-zero: expected 0 to be greater than 0
```

⭐ Note what the RED reveals: with that one arm transposed, the route's **entire** `code:`-first
population is **zero**. This arm is currently the route's only `code:`-first coded rejection —
which is the sharpest possible statement of why WR-03 matters. Restored; **45 passed**, and
`probe-vocabulary.invariant.test.ts` (the order-agnostic scanner this arm was surviving on)
stays green — **61 passed** across both files.

---

## IN-04 — the `validate-and-encrypt` roster row no longer reads as complete

**File:** `src/lib/wizardErrors.invariant.test.ts` (the 4th `ROUTES` row)

### What changed

A `⚠️⚠️ 161-REVIEW / IN-04` block added to the row, stating that
`KNOWN_VALIDATE_AND_ENCRYPT_CODES`' six members and `rosterFloor: 4` are the route's
**declared** vocabulary, not its **emittable** set; naming the computed channel (the twelfth
arm, `code: seamCode ?? "UNKNOWN"`, widened by 161-08 to forward the upstream's own code);
enumerating the fifteen forwarded codes; giving the honest arithmetic (**6 declared + ~15
forwarded ≈ 21 emittable, not 6**); recording *why* the gap is accepted rather than rostered;
and naming the condition under which it would stop being safe.

### Measured at HEAD (2026-08-25), not copied from 161-08

161-08's W1 inventory was re-verified rather than cited. For each of the fifteen codes:
non-test Python file count in `analytics-service/`, and membership in
`SEAM_CODE_TO_WIZARD_CODE` (read out of `src/lib/wizardErrors.ts` at HEAD):

| Code | py files | in `SEAM_CODE_TO_WIZARD_CODE` |
|---|---|---|
| `ADAPTER_INIT_FAILED` | 3 | no |
| `ADMIN_CHECK_UNAVAILABLE` | 1 | no |
| `ANALYTICS_ROW_NOT_CREATED` | 1 | no |
| `EGRESS_PROXY_MISCONFIGURED` | 1 | no |
| `EVAL_FAILED` | 1 | no |
| `INTERNAL` | 10 | no |
| `KEK_UNAVAILABLE` | 2 | no |
| `KEY_UNDECRYPTABLE` | 1 | no |
| `MT5_GATEWAY_UNCONFIGURED` | 1 | no |
| `MT5_GATEWAY_UNREACHABLE` | 1 | no |
| `PORTFOLIO_ANALYTICS_FAILED` | 1 | no |
| `ROLE_CHECK_UNAVAILABLE` | 1 | no |
| `SCORING_FAILED` | 1 | no |
| `SIMULATION_FAILED` | 1 | no |
| `SERVICE_KEY_UNCONFIGURED` | 1 | no |

All fifteen still exist in the service; **none** is a `SEAM_CODE_TO_WIZARD_CODE` member, so
each resolves through `recogniseSeamErrorCode`'s `?? "UNKNOWN"` to UNKNOWN copy — the
legitimate rendering fallback, not a false sentence. That is the measured basis on which the
gap is accepted rather than rostered.

`KNOWN_VALIDATE_AND_ENCRYPT_CODES` re-counted at HEAD: **6** members
(`KEY_MISSING_REQUIRED_FIELD`, `KEY_VENUE_NOT_ENABLED`, `KEY_NOT_READ_ONLY`, `STALE_CLIENT`,
`SEAM_MISCONFIGURED`, `UNKNOWN`) — the row's `rosterFloor: 4` is unchanged and still correct.

### Not fixed — file not owned

IN-04 also names `src/lib/wizardErrors.ts` (`KNOWN_VALIDATE_AND_ENCRYPT_CODES`' own
docblock). That file is owned by another fixer this round, so it was **not** edited. The
equivalent sentence should be added at the roster itself; the correction above lives only on
the coverage-law row.

### No test change

IN-04 is a documentation correction: the roster's *membership* is correct, its *description*
was misleading. No literal moved, so no test can red on it. Suite re-run to confirm nothing
regressed.

---

## Verification (MAIN checkout, repo root, never wrapped)

```
npx vitest run src/lib/dialog-envelope.invariant.test.ts \
               src/lib/wizardErrors.invariant.test.ts \
               "src/app/api/keys/[id]/permissions/route.test.ts" \
               src/lib/probe-vocabulary.invariant.test.ts
→ Test Files  4 passed (4)
     Tests  127 passed (127)

npx tsc --noEmit -p tsconfig.json   → clean (exit 0)
npx eslint <the four touched files> → clean (no output)
```

⚠️ `npm run test` (full suite) deliberately **not** run — the orchestrator runs it once after
all three topics land. Contract tests under `src/__tests__/contracts/` scan all of `src/` and
cannot be cleared by file-scoped runs, so the full-suite result is the orchestrator's to
record.

⚠️ `npx prettier --check` reports all four touched files as unformatted — **pre-existing**.
Verified by piping each file's `HEAD` blob through `prettier --check --stdin-filepath`: all
four were already dirty before these edits. Not reformatted, per project Rule 3.

## Files touched (all left uncommitted)

- `src/lib/dialog-envelope.invariant.test.ts`
- `src/lib/wizardErrors.invariant.test.ts`
- `src/app/api/keys/[id]/permissions/route.ts`
- `src/app/api/keys/[id]/permissions/route.test.ts`

Temporarily mutated and fully reverted (empty diff at HEAD, reverted by inverse `Edit`, never
by `git checkout --`): `src/app/api/strategies/[id]/name/route.ts`.

`src/lib/wizardErrors.ts` and `src/lib/wizardErrors.test.ts` were **read only**, never edited.

---

_Fixer: Claude (gsd-code-fixer) — Topic A_
