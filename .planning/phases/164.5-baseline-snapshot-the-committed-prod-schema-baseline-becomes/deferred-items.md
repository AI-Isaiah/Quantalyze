# Phase 164.5 — deferred items (out-of-scope discoveries)

Logged, deliberately NOT fixed. The executor's scope boundary: only issues DIRECTLY
caused by the current plan's changes are auto-fixed. Each entry below was proven
independent of the plan that found it, by diff, before being deferred.

---

## D-1 — `src/__tests__/gate-family-meta.test.ts` is RED on this branch (found by plan 07)

**Failing arm:** `164.3.1-12 — META-ARM diagnostic-first over the family's shell gates
(SC-7) > every failure emission prints a runtime value — exact against
DIAGNOSTIC_FIRST_ALLOWLIST, both directions`

**What it reports:** five bare-conclusion emissions, ALL in
`scripts/prod-body-drift-check.sh`:

```
scripts/prod-body-drift-check.sh :: fail-call :: BODY_NAME_INDEX_CMD is unset — there is no way t (line 227)
scripts/prod-body-drift-check.sh :: fail-call :: node is not on PATH; the shared name readers can (line 229)
scripts/prod-body-drift-check.sh :: fail-call :: the independent name reader failed on the commit (line 267)
scripts/prod-body-drift-check.sh :: fail-call :: PROD's function-name index came back EMPTY. A pr (line 280)
scripts/prod-body-drift-check.sh :: error-block :: echo "::error::" echo "::error::⛔ This leg is ga (line 335)
```

**Why it is out of scope for plan 07, proven rather than asserted.** BOTH inputs to the
assertion — the shell gate and the spec — are byte-identical to the pre-plan tree:

```
$ git diff --stat HEAD~3 HEAD -- scripts/prod-body-drift-check.sh src/__tests__/gate-family-meta.test.ts
(empty)
$ git log -1 --format='%h %ad %s' --date=short -- scripts/prod-body-drift-check.sh
79d03399 2026-09-07 feat(164.5-04): DRIFT-05 gate (b) — baseline-vs-LIVE leg, exit 1 when uncredentialed
```

The script was last touched by **plan 04** of this same phase, which added emissions
without the runtime values the SC-7 meta-arm requires. `FAMILY_SHELL_GATES`
(`gate-family-meta.test.ts:403-405`) covers shell scripts only — `ci.yml` is NOT in its
scan set — so plan 07's workflow edit cannot reach it.

⛔ **The fix is NOT to add these five sites to `DIAGNOSTIC_FIRST_ALLOWLIST`.** The spec
says so in its own failure message, and that list is for emissions that legitimately
have no quantity. Four of the five have an obvious one to print (the variable name is
already known at the site; the empty-index arm should print the count it read).

**Owner:** whoever closes plan 04's leg, or the phase's review pass.

---

## D-2 — `src/__tests__/gdpr-export-coverage-hook.test.ts` MEASURE_FAILs in a git worktree

**What it reports:**

```
Error: MEASURE_FAIL: the repo's pinned tsx is absent at
<worktree>/node_modules/.bin/tsx — run `npm ci`.
```

**Why it is environmental, not a regression.** The spec spawns the repo's pinned `tsx`
by ABSOLUTE path on purpose (each spawn's cwd is a node_modules-less scratch repo), and
a GSD executor worktree has no install of its own — measured:

```
$ ls -ld node_modules            # in the worktree
drwxr-xr-x  4 …  node_modules    # 2 entries, build caches only
$ ls node_modules/.bin
ls: node_modules/.bin: No such file or directory
```

`npx vitest` resolves from the PARENT checkout's install by upward walk, so the suite
runs; the absolute-path spawn does not. The spec is behaving exactly as designed —
it MEASURE_FAILs rather than silently falling back to a registry `npx tsx`, which would
be a different tsx version. It passes in CI, where `npm ci` populates `node_modules/.bin`
in the checkout itself.

⛔ Do NOT "fix" this by relaxing the absolute-path spawn. The alternative it refuses is
the one the message names.

**Owner:** nobody — it is a property of running the suite from a worktree. Recorded so
the next executor does not re-investigate it.

---

## D-3 — `src/__tests__/drift-check-scripts.test.ts` times out under full-suite contention

**What it reports:** `Test timed out in 5000ms` on
`[VAC04-C1] … CORPUS: on REAL repo migrations the masked tripwire …`.

**Measured:** RED inside a full `npx vitest run` (867 files); **GREEN in isolation** on
the same tree, same commit, 32 s for the three-file batch it was re-run in. It scans all
262 repo migrations under a 5 s default timeout, so it is a contention flake, not a
regression — the same class this repo already records as "full vitest must not share the
box".

**Candidate fix (not taken here, out of scope):** give that one `it` an explicit timeout
argument sized to the corpus scan, the way other corpus arms in this repo do, rather than
leaving it on the 5 s default.
