---
phase: 241-democreds-the-two-demo-accounts-are-gone-and-their-passwords
reviewed: 2026-11-25T00:00:00Z
depth: standard
diff_base: 6e8df792ac7b15ae2886e7d4aec1e1337dfc527c
files_reviewed: 6
files_reviewed_list:
  - scripts/check-demo-credential-digests.ts
  - src/__tests__/check-demo-credential-digests.test.ts
  - src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts
  - package.json
  - vitest.node-env.ts
  - TODOS.md
round: 2
round2_diff: fcb98c6dd^..fcb98c6dd
resolved: [WR-01, WR-02]
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
  necessity: 0
status: clean
---

# Phase 241: Code Review Report

**Reviewed:** 2026-11-25
**Depth:** standard
**Files Reviewed:** 6
**Status:** clean after round 2. WR-01 and WR-02 are resolved; only LOW and INFO remain (see Round 2 below).

## Summary

Scope: the non-planning diff `6e8df792..HEAD` on `gsd/phase-241-democreds`. That is the new
whole-tree digest guard, its vitest file, the e2e admin-gate test edit, the `package.json` lint
link, the `vitest.node-env.ts` entry and the one deleted `TODOS.md` entry. The phase CONTEXT and
plans 02 and 04 were read as the contract. Every digest-table row is named by role only in this
report. It quotes no literal, login or digest.

**What holds, measured rather than assumed:**
- **The scan core is correct.** The rolling update (`h*M + b_in - b_out*M^len`, mod 2^32) is
  right, the sha256 confirm folds only login rows, and the window bytes never leave `scanBuffer`.
  `npx tsx scripts/check-demo-credential-digests.ts` in the worktree prints the OK line over
  12,190 tracked files and 263,466,958 bytes, exit 0.
- **The file set fails closed.** `git ls-files -z` goes through `execFileSync` with array args.
  A `git` error throws, so the CLI exits non-zero. An unreadable path, whether deleted, a
  directory, a dangling symlink or a non-UTF-8 name mangled by the decode, becomes an
  `UNREADABLE:` violation. An empty list is `EMPTY-SCAN`, and the floors catch a partial walk. The
  tree has no symlinks or gitlinks (all entries are mode 100644 or 100755), and `.gitattributes`
  is absent, so there is no LFS pointer and no `working-tree-encoding` transcoding at checkout.
- **The CI wiring is real.** `ci.yml` triggers on `push` and `pull_request` to `main` with no
  `paths` filter. `frontend-lint` has no `if:` and no `needs:`, runs `npm run lint`, and is a row
  in the `frontend` aggregator's `needs:` list and its `ALWAYS_ON` set. So the guard runs on every
  event, docs-only included, and a red blocks the aggregate.
- **No current leak sits in the guard's blind spots.** Scratch checks (now deleted) ran the
  guard's own `scanBuffer` and `DIGEST_TABLE` over three inputs, each printing role counts only:
  the decoded UTF-16LE fixture, 0 hits; the 200 inflatable Flate streams of
  `public/security-packet.pdf`, 0 hits; the NUL-joined tracked path names, 0 hits.
  The tracked `bundle.zip` is a 10-byte text file, not an archive.
- **The TODOS deletion matches plan 04 Task 3.** Exactly the closed entry goes (33 lines, the
  `[158-OPS-04]` entry after it stays). No non-planning file cites the deleted id.
- **No changed file holds an email-shaped string.** `grep -acE` on the three changed source
  files counts 0 each.

**Key concerns (MEDIUM, actionable):**
1. Nothing tests the CLI. `main()` is the only path that runs on a docs-only event, and no test
   pins its exit decision, its entry guard or the shape of its lint link (WR-01).
2. The `case` arm cannot see a fold drop on the byte that leaves the window. A scratch neuter of
   that one site left the arm green while uppercase text ahead of a login made it blind (WR-02).

Necessity rubric read. No finding qualifies, so `necessity: 0`. The guards here sit on file and
git input, which is a trust boundary, or are deliberate defence in depth.

Severity mapping for the caller: **WR-01 and WR-02 are MEDIUM.** WR-03 and WR-04 are LOW. IN-01
and IN-02 are INFO. Per the repo rule, LOW and INFO are recorded here only.

## Warnings

### WR-01 [MEDIUM, RESOLVED in round 2]: The CLI's exit decision, entry guard and lint-link shape are untested, and the CLI is the only gate on docs-only events

**File:** `scripts/check-demo-credential-digests.ts:236-267`, `src/__tests__/check-demo-credential-digests.test.ts:100-105`
**Issue:** The guard is in the lint chain because docs-only pushes skip the vitest shards (header
lines 18-22). So on exactly the event class this phase is most worried about, the CLI is the
only thing that runs. Nothing automated pins it:
- **`main()` is never executed by a test.** `git grep` finds no import of `main` and no spawn of
  the CLI. If an edit dropped `...result.violations` or `...checkFloors(result)` from `problems`,
  or weakened the `problems.length > 0` branch, all 15 arms would stay green. The vitest arms test
  `scanTree` and `checkFloors` as functions, never their composition into an exit code. PROOF-01
  ran the CLI by hand, once.
- **When the entry guard misses, the CLI prints nothing and exits 0.** Measured: invoking the CLI
  by an absolute path through a symlinked directory
  (`npx tsx <symlink-to-worktree>/scripts/check-demo-credential-digests.ts`) printed nothing and
  exited 0. The cause is that `import.meta.url` is realpath-resolved while `process.argv[1]` is
  not. Today's `npm run lint` uses a relative path, which matches through the `endsWith` fallback.
  An `npm exec` probe through the same symlinked cwd did print the OK line. **CI does not fail
  open today.** But a refactor of the guard, or a call by absolute path from a workflow step,
  would turn the gate into a silent no-op, and no test would notice. The guard was copied from
  `check-planning-hygiene.ts`, which has the same property.
- **The wiring arm is a substring match.** A lint script of
  `... ; tsx scripts/check-demo-credential-digests.ts || true` would pass `toContain`.

**Fix:** Make the verdict a pure, tested function, and pin the CLI once end to end.
```ts
// scripts/check-demo-credential-digests.ts
export function verdict(result: ScanResult): { code: 0 | 1; problems: string[] } {
  const problems = [
    ...result.offenders.map(formatOffender),
    ...result.violations,
    ...checkFloors(result),
  ];
  return { code: problems.length > 0 ? 1 : 0, problems };
}
function main(): void {
  const result = scanTree(REPO_ROOT);
  const { code, problems } = verdict(result);
  // ...print as today, process.exit(code) on 1
}
// entry guard: compare realpaths so a symlinked invocation still runs main()
if (entryPath && realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url))) main();
```
In the test, add these arms:
- `verdict` returns code 1 on a synthetic result with one offender, on one carrying only a
  violation, and on one below either floor. It returns 0 on a clean result above the floors.
- One subprocess arm runs `node_modules/.bin/tsx scripts/check-demo-credential-digests.ts` and
  asserts exit 0 plus `/OK — \d+ tracked files/` on stdout. This pins that the entry guard
  actually invokes `main()`.
- Tighten the wiring arm to
  `toMatch(/&& tsx scripts\/check-demo-credential-digests\.ts(?=\s*(?:&&|$))/)`.

### WR-02 [MEDIUM, RESOLVED in round 2]: The fold on the outgoing byte (line 130) is not pinned, so login rows can go blind with every arm green

**File:** `scripts/check-demo-credential-digests.ts:130`, `src/__tests__/check-demo-credential-digests.test.ts:157-167`
**Issue:** A login row folds case at four sites: `fingerprint`, the incoming byte (line 128),
the outgoing byte (line 130) and the sha256 input (line 135). The `case` arm builds its buffer as
`x\n` plus the upper-cased literal. The only bytes that ever leave the window before the match
are `x` and `\n`, and folding does not change either. If line 130 loses its `foldByte` call, the
first uppercase ASCII byte to leave the window adds a residue of `32 * M^len`. That residue is
multiplied by an odd `M` at every later step, so it never returns to 0 mod 2^32. Every later
login window in that file is then missed.

Measured on a scratch copy (now deleted) with only line 130's `foldByte` removed:
- the `case` arm's buffer still gave 1 hit, so the arm stays green;
- a buffer with an uppercase word ahead of the literal gave 0 hits, where 1 is correct.

The other arms cannot catch it either: the every-window, edges and canary arms all use
`foldCase: false`. PROOF-01 P-12 neutered the shared helper, which breaks all four sites at once,
so it never tested a partial drop. Real files are full of uppercase text, so this regression
would leave both login rows effectively blind in production while CI stays green.

**Fix:** Put an uppercase byte ahead of the literal in the `case` arm, for example
`Buffer.from(\`X Y\n${literal.toUpperCase()}\n\`)`, still expecting line 2. Better, add a
foldCase-true pass to the every-window arm: run it over a mixed-case random ASCII buffer and
build each row from the lowercased window.

### WR-03 [LOW]: The digest table's row invariants are unpinned, and a malformed row is skipped silently

**File:** `scripts/check-demo-credential-digests.ts:124`, `src/__tests__/check-demo-credential-digests.test.ts:90-98`
**Issue:** The table-shape arm checks role names only. Several malformed rows would leave the
live-tree arm vacuous:
- a non-positive or NaN `length`, which `scanBuffer` skips silently with
  `if (!(len > 0) ...) continue`;
- a login row flipped to `foldCase: false`, which then matches only all-lowercase occurrences;
- a mistyped `sha256`. P-17 in 241-02-SUMMARY already records a flipped hex character going
  silently green.

The digest values themselves cannot be checked without the literal, and that limit is inherent.
The structural invariants can be checked.

**Fix:** Do not copy digests into a second file. Assert shape only:
- every row has an integer `length > 0`;
- `fp32` is an integer in `[0, 2**32)`;
- `sha256` matches `/^[0-9a-f]{64}$/`;
- `foldCase === role.endsWith("-login")`.

Make `scanBuffer` throw on a row with `!(r.length > 0)` instead of `continue`, so a malformed
row fails loud.

### WR-04 [LOW]: The e2e structural arm misses the env-fallback shape `process.env.X ?? "literal"`

**File:** `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:67-81`
**Issue:** Shape (a) requires the initializer to start with a quote. So the commonest way a
hardcoded credential creeps back next to env-sourcing gets through. Measured with a synthetic
value: `const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "synthetic-x"` and the `||` form
are not matched, while a plain `= "synthetic-x"` is. The "sources admin creds from env" arm
still passes in that case, because `process.env.E2E_ADMIN_PASSWORD` is present. This is not a
regression for the retired pair: the whole-tree digest guard catches either of its literals in
any form. It is a gap in the arm's own claim, "no quoted credential assignment", and P-19 only
proved shape (a).

**Fix:** Add a fourth shape:
`/process\.env\.[A-Z0-9_]*(?:EMAIL|PASSWORD)[A-Z0-9_]*\s*(?:\?\?|\|\|)\s*["'\`]/`.
It does not match the spec today, whose lines 34-35 have no fallback.

## Info

### IN-01 [INFO]: The header's "every byte" claim does not name the encoding blind spots

**File:** `scripts/check-demo-credential-digests.ts:12-14, 28-32`
**Issue:** The scan compares raw bytes. A literal stored in UTF-16 text, inside a compressed
stream (PDF Flate, zip, parquet pages), percent-encoded (`%40` in a login), or JSON- or
HTML-escaped is invisible to it. The tree holds a UTF-16LE fixture, a PDF and a parquet file.
All decoded or inflated inputs scanned clean today (see the Summary). The header's honest-limit
paragraph names only the brute-force limit. The brute-force limit is the accepted T-241-07 and
is not re-raised here.
**Fix:** Add one sentence to the honest-limit paragraph saying that encoded or compressed forms
are out of scope for a raw-byte tripwire.

### IN-02 [INFO]: The failure banner counts every problem as a match

**File:** `scripts/check-demo-credential-digests.ts:244`
**Issue:** `${problems.length} match(es):` also counts EMPTY-SCAN, UNREADABLE and FLOOR lines, so
a floor-only failure reads as a credential match in the CI log.
**Fix:** Print `problem(s)`, or print offenders and violations under separate headings.

## Round 2 (diff `fcb98c6dd^..fcb98c6dd`)

**Verdict: WR-01 and WR-02 are RESOLVED, and the diff adds no MEDIUM or higher regression.
Status is now `clean`. WR-03 and WR-04 (LOW) and IN-01 and IN-02 (INFO) stay listed, and
IN-03 (INFO) below is new.**

Measured on this worktree at `fcb98c6dd`:
- `npx vitest run src/__tests__/check-demo-credential-digests.test.ts --testTimeout=120000`:
  `Tests  17 passed (17)`.
- Running the CLI by absolute path through a symlinked directory now prints the OK line. In
  round 1 it printed nothing and exited 0.
- A plain `import()` of the module does not run `main()`, so the extra realpath branch in the
  entry guard does not fire on import.
- WR-02 neuter, re-run on a scratch copy (now deleted) with only the leaving-byte fold removed:
  the new `case` arm buffer gives 0 hits where the arm expects 1, so the arm goes RED.

**WR-01: RESOLVED.**
- `verdict(result)` is exported and is now the only place the problem list is built.
- The new `verdict` arm pins five failure kinds (offender, EMPTY-SCAN, UNREADABLE, the file
  floor and the byte floor) and the clean pass. An edit that drops any of the three sources
  from `verdict` now goes red.
- The subprocess arm runs `npx tsx scripts/check-demo-credential-digests.ts` from the repo root
  and asserts the OK line. `execFileSync` throws on a non-zero exit, so the arm also covers exit
  0 and that the entry guard reaches `main()`.
- The entry guard now also compares `realpathOrSelf` of both sides. It is an OR on top of the
  two existing checks, so it can only add matches, never remove one.
- The wiring arm now requires `&& tsx ...digests.ts` to be followed by `&&` or the end of the
  string, and separately rejects a trailing `||` or `;`.

**WR-02: RESOLVED.** The `case` arm now puts uppercase text ahead of the literal. Those bytes
leave the rolling window before the match completes, so a fold dropped at line 130 alone turns
the arm red (measured above).

### IN-03 [INFO, new in round 2]: `main()`'s failure branch is still exercised only on a clean tree

**File:** `scripts/check-demo-credential-digests.ts` (`main`), `src/__tests__/check-demo-credential-digests.test.ts` (the CLI arm)
**Issue:** The subprocess arm can only run against the real, clean tree, so it proves the
success path. If the `problems.length > 0` branch lost its `process.exit(1)`, the script would
print the problem lines and then the OK line and exit 0, and no arm would catch it. The risk is
small: the branch is three lines and the problem list is now pinned through `verdict`.
**Fix (optional):** have `main` set `process.exitCode = problems.length > 0 ? 1 : 0` from one
expression, or add a `--root <dir>` test seam so the CLI arm can run once against a fixture tree
holding a synthetic row and expect exit 1.

---

_Reviewed: 2026-11-25 (round 1); round 2 re-review of fcb98c6dd on 2026-11-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
