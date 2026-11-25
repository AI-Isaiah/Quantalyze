# Phase 241: DEMOCREDS - Research

**Researched:** 2026-11-24
**Domain:** public-repo credential hygiene (digest absence guard, archived-text scrub, gitleaks), plus a one-way PROD auth-user delete rehearsed on the local-stack lane
**Confidence:** HIGH on the guard, the wiring and the repo mechanics (measured this session); MEDIUM on the PROD delete ordering (static analysis of the dump plus Postgres docs, to be confirmed by the PROD catalog preflight and the lane rehearsal)

⛔ **This file names the two credential pairs by role only.** Pair A is the shared e2e login. Pair B is the `seed-full-app-demo` allocator. No login, password, email, PROD id or login hash appears here. Every measurement below that touched a literal was done by loading it into a process variable and printing counts or paths only.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(Copied from `241-CONTEXT.md` `<decisions>`; the founder rulings of 2026-11-24.)

- ⛔ **SC-1 is NARROWED.** The ROADMAP says "Neither demo account exists on TEST or PROD." PROD measurement on 2026-11-24 disproved the premise that both accounts are unused. Pair A holds the admin role (1 admin would remain without it), owns 1 of PROD's 2 published strategies plus 18 others, has an OKX key that syncs daily, and last signed in on 2026-09-24. Founder ruling, option (c): **KEEP Pair A.** The founder resets its password himself, and no agent touches credentials. With that, the leaked credential is dead and scrubbed from the tree, and the account stays. Pair B is deleted on both projects as SC-1 originally said. The same dated note goes into the ROADMAP Phase 241 entry. Reversibility: one-way for Pair B (hard delete of an auth user and its cascade).
- SC-1's evidence is therefore: Pair B is absent on TEST and PROD (dated); Pair A's password reset is the founder's step, recorded with its date once he confirms it, never by an agent.
- **Pair B deletion — TEST:** done 2026-11-24. One auth user was deleted by a scoped statement matched on the login hash. It had auth rows only (1 identity, 11 sessions) and no profile, so nothing else cascaded.
- **Pair B deletion — PROD:** scoped pre-deletes in this order: (1) Pair B's `allocator_holdings` rows, (2) Pair B's `api_keys` rows (their own cascades), (3) the auth user through the Supabase admin API. This is rehearsed on the local-stack lane first against a fixture with the same FK shape. ⛔ **STOP before any PROD write.** The exact statement list and expected counts go to the coordinator for the founder's go. Reversibility: one-way.
- Guards on Pair B's path, checked against the baseline: `api_keys_published_composite_delete_guard` fires only when a deleted key is a `strategy_keys` member of a published strategy (Pair B has 0 strategies and 0 `strategy_keys` rows, so it does not fire); `audit_log.user_id` is nullable and `ON DELETE SET NULL` by design (about 3.7k audit rows keep their events with the subject set to NULL; `audit_log_retention_guard` is an AFTER DELETE statement guard, 100k ceiling, and does not fire on SET NULL updates); `allocator_holdings.api_key_id` is ON DELETE RESTRICT (why holdings are pre-deleted before the keys); `match_decisions.decided_by` is NO ACTION with 2 Pair B rows, and **the plan must verify they are the same rows that cascade through `match_decisions.allocator_id`, or delete them explicitly.**
- **Literal removal and sequencing.** Order: (1) a **records PR** scrubs the archived `.planning/` files that hold a password literal (7 distinct files: Pair A's password in 7, Pair B's in 1, overlapping in `158-REVIEW.md`) and the login literals (5 more archived files); (2) the **code PR** adds the whole-tree digest guard and removes Pair A's login and password literals from `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` (constants and docblock). Run a range-form gitleaks scan before each push. Never print a literal. **The ship branch changes nothing under `.planning/`.**
- **Seed and drain coupling (keep as proposed).** `scripts/seed-full-app-demo.ts` keeps reading `DEMO_SEED_ALLOCATOR_EMAIL` / `DEMO_SEED_ALLOCATOR_PASSWORD`. No CI workflow reads either account. `scripts/drain-test-compute-backlog.ts` parses only the seed's fixed `API_KEY_IDS`. Unchanged: the `observ12-fixtures-presence` byte pin, the `critical-regressions` seed block, the drain parse and `knip.json`.
- **Decided autonomously (adjustable, "cheap to rework"):** guard hashes sha256 of each password literal and slides a window of the literal's length over every tracked file's bytes; scans every file from `git ls-files`, binary files skipped, the guard file itself included; also covers the two logins by digest; the e2e absence test keeps its env-sourcing and shape assertions, credential absence moves to the whole-tree guard; archived files get a role placeholder such as `<pair-A-password: redacted 2026-11-24, Phase 241>`; the PROD delete is rehearsed on the local-stack lane against a fixture user with the same FK shape.

### Claude's Discretion
- Guard file name and location under `src/__tests__/`. Whether the digest table is shared with a script.

### Deferred Ideas (OUT OF SCOPE)
- `sanitize_user` deletes api_keys while `allocator_holdings.api_key_id` is RESTRICT, so it would likely fail for any allocator with holdings. Out of scope here. Book it if it is confirmed.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SECR-01 | The two demo accounts no longer exist on TEST or PROD, and the deletion is recorded with its date (F-3). Narrowed by the founder ruling: Pair B on both, Pair A kept with the founder resetting its password. | The PROD delete is order-sensitive and needs an explicit, order-independent pre-delete chain (see "PROD delete"). Existence evidence can reuse the guard's own login digest. The rehearsal needs Docker (daemon currently down). |
| SECR-02 | No tracked file contains either demo password literal; the absence guard checks a digest and is shown RED by planting a matching literal. | A rolling-fingerprint plus sha256 scanner, measured over the real tree (12,168 files, 263 MB). Always-on wiring through `npm run lint` is recommended because vitest shards are skipped on docs-only pushes. Scrub list measured: 12 archived files plus 1 test file. |
| PROOF-01 | Every gate a v1.22 requirement relies on is shown able to fail (neuter, RED with the named arm first, byte restore, GREEN). | The 226 SUMMARY row shape is the template; plant-in-a-tracked-file mechanics and the arm list are in "Validation Architecture". |
</phase_requirements>

## Summary

The guard is cheap and measurable. The tracked tree is 12,168 files and 263,116,843 bytes. A scan that keeps one 32-bit rolling fingerprint per stored digest row and confirms every fingerprint match with sha256 reads the whole tree in about 11 to 17 seconds on this machine under a load average of 28 to 47 (so a few seconds unloaded), with 33 candidates for 32 true hits and one fingerprint collision rejected by sha256. It matched all four literals in the right files and nothing else. The window-per-literal-length approach needs only the four known lengths (6, 14, 27, 30), handles CRLF and binary bytes by construction (no literal contains whitespace), and folds case for logins only. The false-positive risk of the 6-character password window is measured at zero today (it matches only the 8 files that hold it) and is negligible in expectation.

The most consequential finding is wiring. `scripts/classify-changed-paths.mjs` treats a push or PR whose paths are all under `.planning/` as docs-only and skips the vitest shards, while `frontend-lint` (`npm run lint`, which already chains `tsx scripts/check-planning-hygiene.ts`) is deliberately unfiltered for exactly this class. A guard that lives only in a vitest file would not run on the PR class most likely to paste a literal. Recommendation: put the scanner and digest table in `scripts/check-demo-credential-digests.ts`, chain it into `npm run lint`, and add a vitest test under `src/__tests__/` that imports it for the synthetic arms, the live-tree arm and the PROOF-01 named arms. This also answers the "share the table with a script" discretion item.

The PROD delete is one-way and its ordering is not safe to leave to cascade order. `allocator_holdings.api_key_id` is RESTRICT, and `match_decisions.decided_by` and `match_decisions.candidate_id` are non-deferrable NO ACTION; Postgres fires same-event triggers alphabetically by name and row-level AFTER triggers at end of statement, so whether those checks see already-cascaded rows depends on trigger-name order, which embeds OIDs that differ between PROD and the lane. A green lane rehearsal therefore cannot prove PROD's order. The plan should delete the order-sensitive children explicitly, in an order that does not depend on firing order, inside one atomic block with expected counts re-measured at go time. Two execution blockers: the Docker daemon is not running (the local-stack lane needs it), and the worktree has no `node_modules`.

**Primary recommendation:** ship an always-on digest guard (`scripts/check-demo-credential-digests.ts` in the lint chain, plus a named-arm vitest test), scrub the 12 archived files in a records PR first, and make the PROD Pair B delete an explicit leaf-to-root pre-delete chain in one atomic block, rehearsed on the lane with both the admin API and raw SQL.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Digest absence guard | CI / repo tooling (`scripts/` in the always-on lint chain) | vitest (`src/__tests__/`) for named arms | Must run on docs-only pushes; vitest shards do not. |
| Archived-text scrub | Repo content (`.planning/` records PR) | — | Text-only; no runtime state. |
| Pair B auth user delete | Database / Storage (PROD Postgres + GoTrue) | Operator (founder-gated) | FK cascade and guards live in the database; credential action stays human-gated. |
| Pair A password reset | Operator (founder) | — | Founder ruling: no agent touches credentials. |
| Secret scanning of the diff | CI (`secret-scan`, gitleaks) | Local range scan before push | Pushes to public repo. |

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `node:crypto` (sha256) | Node stdlib (v25.8.1 here; CI Node 22) | Digest of each literal | Already the stack decision in `.planning/research/v1.22/STACK.md`; no dependency. |
| `node:fs` + `git ls-files -z` | stdlib / git | Enumerate and read every tracked file byte-exact | Same enumeration `scripts/check-planning-hygiene.ts` uses (`listTrackedFiles`, latin1 byte-exact read). |
| vitest | repo-pinned | Named-arm test | Existing test framework. |
| gitleaks | 8.30.1 (local, `/opt/homebrew/bin/gitleaks`) | Range scan before push | Same version the repo's own config comments measure with. |
| Supabase CLI + Docker | CLI 2.84.2; Docker client 29.9.2 | Local-stack lane for the rehearsal | `scripts/local-stack/run.sh up`. |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `psql` 18.6 | Fixture seeding and assertions against the lane's `DB_URL` | Rehearsal. |
| `tsx` | Run the guard script as a lint link | `npm run lint`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Rolling fingerprint then sha256 | sha256 of every window of each length | About 1 billion hashes for 263 MB x 4 lengths, minutes to hours. Rejected. |
| Rolling fingerprint | Tokenise on delimiters and hash tokens | Misses a literal embedded in a longer alphanumeric run (for example `xxZq7Kd2yy`). Rejected: embedding is exactly how a pasted password hides. |
| Skip binary files | Scan every byte | Binary-by-extension files are 38 files and 2.1 MB of 263 MB (under 1%), so skipping saves nothing and opens a blind spot. Recommend scanning everything. |

**Installation:** none. No external package is added by this phase.

## Package Legitimacy Audit

Not applicable: this phase installs no external package. The scanner uses `node:crypto`, `node:fs` and `node:child_process`; the digest approach was already chosen in the v1.22 stack research as "no dependency". `[VERIFIED: .planning/research/v1.22/STACK.md:57]`

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 git ls-files -z  ──►  for each tracked path ──► readFileSync (bytes, no decode, no binary skip)
        │                                              │
        │ (unreadable path / gitlink: skip,            ▼
        │  NOT counted as scanned)          per-file scan, per digest row:
        │                                     rolling 32-bit fingerprint over window of row.length
        │                                     (case-folded A-Z only when row.foldCase)
        │                                              │ fingerprint equal?
        │                                              ▼
        │                                     sha256(window) === row.sha256 ?  ── no ──► discard (collision)
        │                                              │ yes
        │                                              ▼
        │                                     offender = { role, path, line }   (NEVER the window bytes)
        ▼
 anti-vacuity: filesScanned >= floor, bytesScanned >= floor, synthetic canary row found in a synthetic buffer
        │
        ▼
 verdict:  script exits 1 and prints role/path/line  |  vitest arm per role fails by name
        ▲
 always-on: `npm run lint` (frontend-lint, every event incl. docs-only)      named arms: vitest shards (skipped on docs-only)
```

### Recommended Project Structure
```
scripts/check-demo-credential-digests.ts      # DIGEST_TABLE, scanBuffer, scanTree, CLI (exit 1 + role/path/line)
src/__tests__/check-demo-credential-digests.test.ts   # synthetic arms, live-tree per-role arms, anti-vacuity, wiring pin
src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts   # constants + docblock removed, shape arms kept
vitest.node-env.ts                            # add the new test (opt-in node-env list; recommended)
package.json                                  # append `&& tsx scripts/check-demo-credential-digests.ts` to `lint`
```

### Pattern 1: Rolling fingerprint plus sha256 confirmation (prototype measured)
**What:** For every digest row keep `{ role, length, foldCase, fp32, sha256 }`. Slide a window of `length` bytes with a polynomial hash `h = h*M + b` (32-bit, `Math.imul`), remove the outgoing byte times `M^length`, and only when `h === fp32` compute sha256 of the window and compare. For `foldCase` rows map bytes 65-90 to 97-122 before hashing and hash the lowercased window.
**When to use:** whole-tree scans with a handful of known lengths.
**Example (skeleton, no literals; the prototype run in the scratchpad reproduced 32 true hits and 1 rejected collision over the real tree):**
```typescript
// Source: prototype measured 2026-11-24 over the live tracked tree (this research)
import { createHash } from "node:crypto";
const M = 0x01000193 | 0;
type Row = { role: string; length: number; foldCase: boolean; fp32: number; sha256: string; pow: number };
// pow = M^length mod 2^32, derived once from length at module load, not stored.
export function scanBuffer(buf: Buffer, rows: Row[]): { role: string; offset: number; line: number }[] {
  const out: { role: string; offset: number; line: number }[] = [];
  for (const r of rows) {
    let h = 0;
    for (let i = 0; i < buf.length; i++) {
      let c = buf[i]; if (r.foldCase && c >= 65 && c <= 90) c += 32;
      h = (Math.imul(h, M) + c) | 0;
      if (i >= r.length) { let o = buf[i - r.length]; if (r.foldCase && o >= 65 && o <= 90) o += 32; h = (h - Math.imul(o, r.pow)) | 0; }
      if (i >= r.length - 1 && h === r.fp32) {
        const w = buf.subarray(i - r.length + 1, i + 1).toString("latin1");
        const d = createHash("sha256").update(r.foldCase ? w.toLowerCase() : w, "latin1").digest("hex");
        if (d === r.sha256) out.push({ role: r.role, offset: i - r.length + 1, line: lineOf(buf, i - r.length + 1) });
      }
    }
  }
  return out; // role + position only; the window bytes never leave this function
}
```
Prototype cases that passed: plain, upper-case login, CRLF neighbours, literal at EOF with no newline, literal at offset 0, literal embedded in a longer token, literal inside a buffer with NUL bytes, wrong-case password (correctly not matched), one-byte-short (not matched), clean buffer.

### Anti-Patterns to Avoid
- **Printing the matched window or interpolating the literal into a failure message.** The current e2e test interpolates its needle into the failure text; PROOF-01's RED line is pasted into a tracked SUMMARY that this very guard scans. Failure output is `role + path + line` only, and `expect(offenders).toEqual([])` must hold arrays of those strings only.
- **Defining "binary" by NUL bytes.** The repo records a NUL-carrying text test file. Scan every byte of every file; do not skip.
- **A `const x = "<literal>"; expect(x)...` shape in the new test.** `src/__tests__/self-referential-oracle.test.ts` runs a blocking AST scan over `src/__tests__/**/*.test.ts` for exactly that same-block vacuity shape. Use the repo's accumulator idiom (`offenders.push(...)`, `expect(offenders).toEqual([])`), which the detector deliberately does not flag.
- **A string literal containing the planning directory name in the new test or script.** `src/__tests__/contracts/ci-docs-path-filter.contract.test.ts` lexes every tracked test and its imported modules for `.planning` tokens and fails closed on an unrecognised one. A whole-tree walker that enumerates via `git ls-files` and never names the directory needs no entry; prose in comments is skipped by that lexer.
- **Allowlisting a path or widening the gate to clear a red.** The scanner has no path exclusions, own source included, by the same rule as `check-planning-hygiene.ts` ("NO PATH ALLOWLIST - BY CONSTRUCTION").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tracked-file enumeration | A directory walker with ignore rules | `git ls-files -z` with `execFileSync` (array args, no shell), as `scripts/check-planning-hygiene.ts` `listTrackedFiles` does | Exactly "what is committed and therefore public"; NUL-delimited. |
| Byte-exact read | UTF-8 decode | `readFileSync` returning a `Buffer` (or latin1) | A NUL cannot hide what follows; the repo has a recorded NUL-blind grep trap. |
| Digest | A custom hash | `node:crypto` sha256 | Stack decision; no dependency. |
| Secret scan of the diff | A bespoke regex | gitleaks range scan with the repo `.gitleaks.toml` | Already CI's mode. |
| Anti-vacuity | Trusting a clean run | Floors (files, bytes) plus a synthetic canary row found in a synthetic buffer | Repo convention: `EMPTY-SCAN` in `check-planning-hygiene.ts`; a gate that walks nothing reports OK forever. |

**Key insight:** the only novel part is the fingerprint prefilter. Everything around it already exists in `scripts/check-planning-hygiene.ts` and its test; copy that shape rather than inventing one.

## Runtime State Inventory

This phase is partly a removal of a credential from text and partly a delete of live auth state, so the five categories were answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | PROD Pair B rows (see FK walk below, measured in `241-PROD-MEASUREMENT.md`): holdings, keys, derived series, match rows, portfolios, about 3.7k audit rows. TEST Pair B already deleted 2026-11-24. Pair A is kept with all its data. | Data deletion for Pair B on PROD via the explicit chain; audit rows survive with subject NULL by design. No migration of Pair A data. |
| Live service config | Pair A's OKX key syncs daily; Pair B's OKX key syncs daily (connected today); each OKX key shares its venue account with 3 keys under other logins (venue-account equality, not an FK). Two live Pair B sessions. | Delete in a window with no running or claimed compute job for Pair B's keys (preflight). Sibling keys under other logins are untouched; verify by count before and after. |
| OS-registered state | None found: the demo accounts are not referenced by any launchd, cron-on-host or Task Scheduler entry in this repo; `No CI workflow reads either account` per CONTEXT. | None. |
| Secrets and env vars | `DEMO_SEED_ALLOCATOR_EMAIL` / `DEMO_SEED_ALLOCATOR_PASSWORD` are read by `scripts/seed-full-app-demo.ts` by name; `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` by `e2e/match-queue.spec.ts`. Names are unchanged. Pair A's password value changes when the founder resets it. | Code: none (names unchanged). Operator: the founder resets Pair A's password and updates wherever he stores `E2E_ADMIN_*`; recorded with a date, never by an agent. |
| Build artifacts / installed packages | None: no package or binary carries either literal. The only copies are text: 12 archived planning files and one test file (counts below). Git history keeps them by decision (no rewrite). | Records PR scrub plus the guard. |

**The canonical question answered:** after every tracked file is updated, history still holds both pairs (accepted, no rewrite). Pair B's credential is dead because the account is gone; Pair A's is dead only when the founder resets it, which is why SC-1's evidence for Pair A is a founder-recorded date.

## Measured Facts This Phase Rests On

### Tree and literal census (measured 2026-11-24 at the worktree HEAD, byte-exact, case-insensitive for logins)
| Fact | Value |
|------|-------|
| Tracked files / bytes | 12,168 files, 263,116,843 bytes; 7,778 under `.planning` |
| Files containing a NUL byte | 34; files with CRLF: 34 |
| Binary-by-extension files | 38 files, 2,108,793 bytes (under 1% of bytes) |
| Literal lengths | Pair A login 27, Pair A password 6, Pair B login 30, Pair B password 14 |
| Character classes | Pair A password: letters upper+lower, digits, no symbol. Pair B password: letters, digits and a symbol. Both logins: lowercase, so folding is harmless |
| Files holding each literal | Pair A login 8 (7 archived + the e2e test); Pair A password 8 (7 archived + the e2e test); Pair B login 5; Pair B password 1 (`158-REVIEW.md`) |
| Occurrences (scanner hits) | Pair A login 15, Pair A password 11, Pair B login 5, Pair B password 1 |
| Case-exact vs case-insensitive | Identical file sets: every occurrence is already in canonical case |
| Encoded variants | The percent-encoded (including the `%40` form), JSON-escaped, hex and base64 forms occur in no file beyond the plain-form files |
| Outside `.planning` | Exactly one file holds any literal: the e2e test (Pair A login and password). The e2e spec, `scripts/seed-full-app-demo.ts` and the docs are clean. |
| Archived files to scrub (12) | `.planning/milestones/v0.15.0.0-phases/06-allocator-api-ingestion/{BUGS-FROM-QA,HANDOFF}.md`; `v0.16.0.0-phases/11-onboarding-and-security-readiness/11-PATTERNS.md`; `v0.17.0.0-phases/13-discovery-v2-polish/{13-01-PLAN,13-02-PLAN,13-04-PLAN,INTEGRATION}.md`; `v1.0.0-phases/15-csv-unblock/{15-06-PLAN,15-VERIFICATION}.md`; `v1.0.0-phases/16-diagnostic-spike-observability/16-VERIFICATION.md`; `v1.20-phases/158-ops-ci-a-merge-means-a-deploy/158-REVIEW.md`; `v1.20-phases/164.8-testpreprod-test-becomes-a-real-pre-prod/164.8-04-RESTORE.log`. Matches the CONTEXT "Specifics" list; none has CRLF. |
| References to those files | Only filename mentions in test comments (`13-01-PLAN.md`, `13-02-PLAN.md`); no test, script or workflow reads their content, so a text scrub breaks nothing. |
| Bare local-part of each login (outside the full-login files) | Pair A: 5 further files (the unique 17-character token, including `.planning/STATE.md`). Pair B: 14 files, and only 8 of 31 occurrences are followed by `@`: it is ordinary hyphenated vocabulary in code, not a leak. |

`[VERIFIED: measured this session by an in-process scan of git ls-files; literals loaded from the e2e test constants and from the removed lines of commit 65e1cc52 and never printed]`

### Scan cost (measured, this machine, load average 28.7 to 47, no vitest coverage)
Read 552 ms for all files; scan 11.2 s (four separate passes) and 17.0 s (fused single pass). Candidates 33, true hits 32, one fingerprint collision rejected by sha256. CI has 4 cores and v8 coverage on the vitest shards; keep the scanner outside vitest's coverage by running it from the lint script and give the vitest arms an explicit timeout. `[ASSUMED: CI wall time; only this machine was measured]`

### False-positive risk of the 6-character window
Measured: the Pair A password window matched only the 8 files that hold it, in 12,168 files. Expected random matches: a mixed-case alphanumeric 6-gram has about 1.7e-11 probability per position and the tree has about 2.6e8 positions, so about 0.004 expected over the whole tree, and base64 blobs behave the same. A real future collision would redden the gate with a role-named message and is cleared by editing the offending text, never by an allowlist. The password is case-sensitive; only logins fold case.

### Honest limit to state in the guard's header
A sha256 of a 6-character password is brute-forceable offline. This is accepted, not hidden: the literal is already in public history, Pair A's credential is dead once the founder resets it, and Pair B's account is gone. The table is a tripwire against reintroduction, not secrecy.

## Guard design (prescriptive)

1. **Wiring:** `scripts/check-demo-credential-digests.ts` exports `DIGEST_TABLE`, `scanBuffer`, `scanTree(root, files?)` (files injectable, like `runCheck` in the hygiene script) and a CLI that prints `role path:line` per offender and exits 1. Append it to `lint` in `package.json`. Evidence this is the right home: `[VERIFIED: package.json:11]` `"lint": "eslint --cache --cache-location node_modules/.cache/.eslintcache src/ && tsx scripts/check-admin-route-manifest.ts && tsx scripts/check-route-contract.ts && tsx scripts/check-planning-hygiene.ts && tsx scripts/check-canonical-domain.ts"`; `[VERIFIED: .github/workflows/ci.yml:333-336]` the `frontend-lint` job comment, "THIS JOB IS DELIBERATELY NOT FILTERED ... It is one of the five always-on gates"; `[VERIFIED: scripts/classify-changed-paths.mjs:82]` `export const DOCS_ONLY_PREFIXES = [".planning/"];`.
2. **Table rows:** four, with neutral field names `role`, `length`, `foldCase`, `fp32`, `sha256`. Roles `pair-A-login`, `pair-A-password`, `pair-B-login`, `pair-B-password`. Logins hash the lowercased bytes, passwords the exact bytes.
3. **Scan scope:** every `git ls-files` path, every byte, no skip, no path exclusion, guard source included (the table holds digests only). This overrides the autonomously-decided "binary files skipped" with measured reasoning above; the decision was marked cheap to rework.
4. **Failure output:** `role`, `path`, `line` only.
5. **Anti-vacuity:** `filesScanned` and `bytesScanned` floors set well below measured (suggest 5,000 files and 100 MB, not pinned at 12,168 / 263 MB, per the SRO lesson that a floor pinned at the measurement gets raised by reflex); a runtime-digested synthetic canary row found exactly once in a synthetic buffer and zero times in a clean one; an `EMPTY-SCAN` verdict when zero files were read.
6. **Vitest test arms (named so the first RED names the cause):** one `it` per role asserting that role's offender list is empty (scan once in `beforeAll` with an explicit timeout such as 120 s), plus arms for case fold, CRLF, EOF-without-newline, embedded-in-token, NUL-bearing buffer, wrong-case password not matched, and the anti-vacuity floors. Add the file to `vitest.node-env.ts` (it names no DOM tokens). Optionally register both files in `src/__tests__/contracts/REGISTRY.md` and `contracts-registry.test.ts` beside `scripts/check-canonical-domain.ts` (registry rows are not required; the test only checks listed files exist).
7. **Generating the table (offline, one time, executor):** read Pair A from the two constants in the e2e test **before** editing it, and Pair B from the removed `const ALLOCATOR_EMAIL` / `const ALLOCATOR_PASSWORD` lines of `git show 65e1cc52 -- scripts/seed-full-app-demo.ts`, into a mode-600 file in the session scratchpad; print only `role length foldCase fp32 sha256`. Delete the scratch file at the end. Do not put scratchpad absolute paths into any planning text (hygiene rules 2-3 fail on them).
8. **`git add` before running the guard** on newly created planning files: `git ls-files` lists staged files but not untracked ones, so an untracked SUMMARY would be invisible to a local run.
9. **Pre-fix RED for free:** if the guard lands before the scrub in the worktree, the first run on the real tree must be RED with exactly the measured set (Pair A login 8 files, Pair A password 8, Pair B login 5, Pair B password 1). That is a genuine pre-fix RED for PROOF-01; the scrub then turns it GREEN.

## Gitleaks

- **Config:** `[VERIFIED: .gitleaks.toml]` `[extend] useDefault = true`; `.planning/` is allowlisted for `generic-api-key` only (`targetRules = ["generic-api-key"]`, `paths = ['''(^|/)\.planning/''']`), so the records-PR placeholder text cannot trip the entropy rule; any other rule still applies there.
- **Do digests trip a rule?** Measured with gitleaks 8.30.1 `dir` mode and the repo config, over a real digest table in three shapes: an identifier containing the word "PASSWORD" before the hex (2 leaks, `generic-api-key`), a variable named like `api_key_digest` (1 leak), and neutral names (`role`, `length`, `foldCase`, `fp32`, `sha256`, role strings such as `pair-A-password`) (**no leaks**). The trigger is keyword naming on the digest's line, not the hex itself. **Recommendation: neutral field and constant names; no allowlist entry.** If a name ever has to include a keyword, the repo's own precedent is a rule-scoped, value-keyed allowlist (`condition = "AND"` with `regexes`), never a path exemption.
- **CI mode is range-form, not `dir`.** Before each push run (CLAUDE.md "CI gate integrity"): `gitleaks git . --no-banner --redact --config .gitleaks.toml --log-opts=<base>..<head>`. Measured at this worktree: `--log-opts=origin/main..HEAD` scanned 3 commits and reported no leaks in 0.17 s. Add a plan step to range-scan the REAL guard commit, since `dir` mode on a scratch file is not CI's mode. The push-to-main scan reads one squash commit including `CHANGELOG.md`, so no literal may appear in CHANGELOG, TODOS, a commit message or a PR body.
- **Skip-trailer trap (CLAUDE.md):** never write the CI-skip tokens in any commit message or PR body, even to deny them.

## The e2e test edit

`src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` (listed at `vitest.node-env.ts:70`, `"src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts",`):
- **Remove** the two constants `HARDCODED_CRED` and `HARDCODED_PW` and their long docblock (the docblock also names the account in prose, so it must go). Nothing else imports them: `git grep -l "HARDCODED_CRED\|HARDCODED_PW"` returns only this file.
- **The first `it` loses its needle** ("contains no hardcoded plaintext credential in executable code"). Replace it with a structural, literal-free arm: after `stripComments`, assert that no executable assignment binds a quoted string to an identifier whose name carries `EMAIL` or `PASSWORD`. This still fails if someone pastes a literal into the spec, and it needs no needle. Credential absence itself moves to the whole-tree guard (which covers `e2e/match-queue.spec.ts`, as CONTEXT decided).
- **Keep unchanged:** `sources admin creds from env` (`process.env.E2E_ADMIN_EMAIL`, `process.env.E2E_ADMIN_PASSWORD`, `const HAS_ADMIN_CREDS =`), the REPORTED-skip count arm (`test.skip(!HAS_ADMIN_CREDS` at least 3), the `if (hasDashboard)` and early `return;` arms, and the positive admin-eval arm.
- **Other readers of those constants:** none. Other readers of the seed or the accounts are unchanged by decision (`critical-regressions.test.ts`, `observ12-fixtures-presence.test.ts`, `phase-150-capital-ownership-invariant.test.ts`, `sec-005-api-keys-projection.test.ts`, `scripts/drain-test-compute-backlog.ts`, `knip.json`); none reads a literal of either pair.
- **PROOF-01 for the replacement arm:** plant a quoted-string assignment to an `*_PASSWORD`-named identifier into a byte copy of `e2e/match-queue.spec.ts` (value synthetic, not a real literal), see the structural arm RED first, restore with `cp`, `cmp`, GREEN.

## PROD delete (Pair B) — order-independent chain

### Constraints on the path (read from `supabase/schema/baseline.sql` this session)
Replay set is empty at HEAD: `baseline-carried-migrations.txt` carries all 337 listed migrations against 336 files, so the dump is the FK source of truth for the lane. PROD may still differ from the dump; the preflight catalog query below is what closes that. `[VERIFIED: supabase/schema/baseline-carried-migrations.txt, replay set computed 0]` No FK in the dump is DEFERRABLE (0 of 104 `ADD CONSTRAINT ... FOREIGN KEY`).

| Edge | Dump line and verbatim text | Why it matters |
|------|------------------------------|----------------|
| holdings RESTRICT | `17226: ADD CONSTRAINT "allocator_holdings_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE RESTRICT;` | Deleting a key with live holdings fails unless holdings are gone first. |
| holdings cascade | `17221: ... "allocator_holdings_allocator_id_fkey" ... REFERENCES "auth"."users"("id") ON DELETE CASCADE;` | Order versus the keys' cascade is name-order dependent. |
| decided_by NO ACTION | `17465: ADD CONSTRAINT "match_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id");` | 2 Pair B rows. |
| candidate_id NO ACTION | `17455: ADD CONSTRAINT "match_decisions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."match_candidates"("id");` | Candidates cascade from the allocator; decisions referencing them are also Pair B's, but the check order is name-order dependent. |
| decisions cascade | `17450: ... "match_decisions_allocator_id_fkey" ... REFERENCES "public"."profiles"("id") ON DELETE CASCADE;` | |
| bridge SET NULL | `17296: ... "bridge_outcomes_match_decision_id_fkey" ... REFERENCES "public"."match_decisions"("id") ON DELETE SET NULL;` | Deleting a decision first UPDATEs its bridge rows and fires the sync trigger (below). |
| audit SET NULL | `17276: ... "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;` | Keeps events, drops the subject. |
| profile cascade | `17550: ... "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;` and `17271: ... "api_keys_user_id_fkey" ... REFERENCES "public"."profiles"("id") ON DELETE CASCADE;` | Deleting the auth user cascades to the profile and onward. |
| other NO ACTION into `profiles` / `auth.users` | `allocator_preferences.edited_by_user_id` (17231), `for_quants_leads.processed_by`, `organization_invites.invited_by`, `organizations.created_by`, `system_flags.updated_by`, `system_settings.updated_by`, `relationship_documents.uploaded_by -> auth.users` (17580) | The measurement lists only non-zero rows, and only `decided_by` was non-zero. The preflight must COUNT every one and expect 0. |

Full NO ACTION / RESTRICT list at the dump (16 edges): `allocation_events.strategy_id`, `allocator_holdings.api_key_id` (RESTRICT), `allocator_preferences.edited_by_user_id`, `compute_jobs.kind`, `for_quants_leads.processed_by`, `match_decisions.candidate_id`, `match_decisions.contact_request_id`, `match_decisions.decided_by`, `match_decisions.original_strategy_id` (RESTRICT), `organization_invites.invited_by`, `organizations.created_by`, `relationship_documents.uploaded_by`, `strategies.organization_id`, `system_flags.updated_by`, `system_settings.updated_by`, `verification_requests_legacy.matched_strategy_id`.

**Third level (children of the path's tables):** `api_keys` has 13 child FKs (holdings RESTRICT; `allocator_trade_read_windows`, `allocator_trade_reads`, `api_key_flow_prices`, `api_key_nav_marks`, `compute_job_attempt_failures`, `compute_jobs`, `csv_daily_returns`, `key_permission_audit`, `mt5_server_clock_readings`, `strategy_keys` CASCADE; `api_keys.account_shared_with_api_key_id` and `strategies.api_key_id` SET NULL). `portfolios` has 8 (`allocation_events`, `compute_job_attempt_failures`, `compute_jobs`, `portfolio_alerts`, `portfolio_analytics`, `portfolio_strategies`, `relationship_documents`, `weight_snapshots`, all CASCADE). `match_batches` -> `match_candidates` CASCADE (17440). `compute_jobs` -> `compute_job_dedup_events` CASCADE. `allocator_holdings`, `bridge_outcomes`, `csv_daily_returns`, `allocator_equity_derived`, `api_key_nav_marks`, `allocator_preferences`, `investor_attestations`, `user_app_roles` have no children. Pair B owns no strategies, so the 31 strategy children do not apply.

### Triggers on the path (dump lines; BEFORE DELETE and the SET NULL UPDATE path)
- `17021: CREATE OR REPLACE TRIGGER api_keys_published_composite_delete_guard BEFORE DELETE ON public.api_keys ...` raises only when the key is a `strategy_keys` member of a published strategy, and returns early when `quantalyze.sanitize_in_progress` is `on` (function body read, dump line 4756 onward). Pair B has none. `[VERIFIED: baseline.sql:17021]`
- `17097: ... mt5_server_clock_readings_write_once BEFORE DELETE OR UPDATE ...`: its DELETE branch reads `IF pg_trigger_depth() > 1 THEN RETURN OLD;` and otherwise raises `mt5_server_clock_readings is write-once: a stored reading is never deleted directly, only with its key` (body at `baseline.sql:4850`). A cascade from a key delete passes; a direct delete of readings fails. Pair B has OKX and Bybit keys only, so expect 0 rows; count it anyway. `[VERIFIED: baseline.sql:4850]`
- `17005: ... api_keys_account_share_same_owner BEFORE INSERT OR UPDATE OF account_shared_with_api_key_id`: function body states the NULL-holder branch "is taken by ... the FK's ON DELETE SET NULL action" and requires a holder to be the same `user_id` (`ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER`). So sharing links are same-owner only and deleting Pair B's keys cannot null another user's links; the preflight still counts `api_keys` rows of other users that name a Pair B key. `[VERIFIED: baseline.sql:4662-4720 body read]`
- `17057: ... bridge_outcomes_sync_holding_ref_trigger BEFORE INSERT OR UPDATE OF match_decision_id, former_match_decision_id ON public.bridge_outcomes`: on the SET NULL update it records `former_match_decision_id` only after the decision row is gone and refuses a cross-allocator decision. Unique index at `16453: CREATE UNIQUE INDEX "bridge_outcomes_legacy_per_strategy_holding_when_md_null" ... WHERE ("match_decision_id" IS NULL)` is keyed on `former_match_decision_id`. Deleting `bridge_outcomes` rows first avoids this path entirely. `[VERIFIED: baseline.sql:17057, 16453]`
- Owner-coherence triggers (`allocator_holdings_enforce_owner_coherence` 16993, `api_key_nav_marks_owner_coherence` 17001, `csv_daily_returns_owner_coherence` 17077, `strategy_keys_owner_coherence`) are `BEFORE INSERT OR UPDATE` only. They do not fire on a delete cascade, but they DO constrain the rehearsal fixture's INSERTs (allocator must equal the key's `user_id`). `match_decisions_visibility_check` (17093) is `BEFORE INSERT` and constrains the fixture's decision rows.
- `audit_log_retention_guard` (17049) is `AFTER DELETE ... FOR EACH STATEMENT`, 100,000-row ceiling; SET NULL is an update, so it does not fire.
- `profiles` triggers are `BEFORE INSERT OR UPDATE` only; no BEFORE DELETE trigger exists on `profiles` or on `auth.users` in the dump.

### Why the cascade order cannot be trusted
Postgres docs: "If more than one trigger is defined for the same event on the same relation, the triggers will be fired in alphabetical order by trigger name." and "Row-level `AFTER` triggers fire at the end of the statement" `[CITED: postgresql.org/docs/current/trigger-definition.html]`; `RESTRICT does not allow the check to be deferred until later in the transaction`, and `NO ACTION` is only fixable by "other commands" when the constraint is deferred `[CITED: postgresql.org/docs/current/ddl-constraints.html]`. No FK here is deferrable, so for the non-deferred NO ACTION edges the check runs when that statement's AFTER triggers fire, in trigger-name order. RI trigger names embed constraint OIDs, which differ between PROD (built by migration history) and the lane (built from a dump restore). Inference (not a documented guarantee): `decided_by` and `candidate_id` are order-dependent in the same way as the holdings RESTRICT. `[ASSUMED: the end-of-statement firing of nested RI cascade actions and the OID-in-name ordering are my reading of the docs, not an observed PROD behaviour]`

**Consequence:** a green lane run proves the lane's order only. Make the chain independent of firing order.

### Recommended chain (leaf to root, one atomic block)
One multi-statement call (the PROD SQL channel is one statement per MCP call, so use a single `DO` block, or one transaction, with `RAISE EXCEPTION` on any count mismatch so it is all or nothing). All predicates resolve Pair B by `lower(email)` digest against `auth.users` (the same sha256 the measurement used and the guard table stores), asserting exactly one id first; never by literal.
1. Preflight asserts inside the block (abort on mismatch): exactly 1 Pair B id; for every NO ACTION / RESTRICT edge listed above, the count of referencing rows whose owner is not Pair B is 0 (`match_decisions` rows with `decided_by` = Pair B and `allocator_id` <> Pair B; decisions referencing Pair B's candidates with another `allocator_id`; `allocator_holdings` of other users naming a Pair B key; `strategies` of other users naming a Pair B key; `api_keys` of other users naming a Pair B key via `account_shared_with_api_key_id`; the five organisation / system / lead / preference edges); no `running` or claimed `compute_jobs` for Pair B's keys; `mt5_server_clock_readings` for Pair B's keys is 0.
2. `DELETE allocator_holdings WHERE allocator_id = Pair B` (clears the RESTRICT).
3. `DELETE bridge_outcomes WHERE allocator_id = Pair B` (avoids the SET NULL sync-trigger path).
4. `DELETE match_decisions WHERE allocator_id = Pair B OR decided_by = Pair B` (resolves both NO ACTION edges explicitly; the plan must still show the two `decided_by` rows are inside the `allocator_id` set).
5. `DELETE match_candidates` then `match_batches` for Pair B.
6. `DELETE api_keys WHERE user_id = Pair B` (their own cascades; the published-composite guard does not fire).
7. `DELETE FROM auth.users WHERE id = Pair B` inside the same block if the founder sanctions SQL, or the admin API call immediately after the block commits (CONTEXT names the admin API; see Open Questions on the PROD channel). Cascades remove the profile, portfolios and analytics, preferences, attestations, roles, derived series, sessions, identities. `audit_log` keeps its rows with the subject NULL.
8. Post-assertions (same block): zero Pair B rows in every table the walk lists; total `audit_log` rows not smaller than before; the three sibling keys under other logins and every other allocator's row counts unchanged.

Expected counts must be **re-measured at go time**: Pair B's OKX key syncs daily, so the measured holdings count of 3,511 moves. The numbers in `241-PROD-MEASUREMENT.md` are a shape, not parameters.

### Preflight catalog query (read-only, run on PROD first, then on the lane)
A recursive walk of `pg_constraint` from `auth.users` and `public.profiles` listing every FK with its `confdeltype`, plus `pg_trigger` for non-internal triggers on `auth.users` and on every table reached, so the static dump analysis is confirmed against PROD's actual catalog rather than assumed equal. Run the marker query first (CLAUDE.md "Which database am I on?").

### Local-stack rehearsal
- **Blockers:** `docker info` printed the client only, then `Cannot connect to the Docker daemon` (the per-user Docker socket was unreachable); Docker Desktop must be started. The worktree has no `node_modules` (`ls node_modules` fails), so vitest cannot run there until `npm ci` or equivalent is done in the worktree. `supabase` 2.84.2 and `psql` 18.6 are present.
- **Boot:** `scripts/local-stack/run.sh up` (docs in its header: boots a derived workdir with migrations disabled, loads `supabase/schema/baseline.sql`, replays the carried-marker delta (zero here), pins Postgres image 17.6.1.113, writes `scripts/local-stack/.stack-env` with `API_URL`, `DB_URL`, service key), `down` to stop. It refuses a non-loopback target. The lane is private to the runner, so the rehearsal leaves no residue on shared TEST.
- **Why the lane, not `pg-lane`:** `scripts/pg-lane/` loads hand-built fixtures (a stub `auth.users`), not the real baseline, so it cannot reproduce the FK shape. The lane runs real GoTrue, so `auth.admin.deleteUser` can be exercised.
- **Fixture:** a bystander manager with one published strategy (the candidates and decisions need a strategy owned by someone else; the visibility trigger constrains them); a bystander allocator X with the same row shape, including a key with the same venue-account id as Pair B's; a fixture allocator B created through the GoTrue admin API (so identities and sessions are real) with: `api_keys` (OKX-shaped), `allocator_holdings` (several per key, owner = key owner), `csv_daily_returns`, `compute_jobs`, `api_key_nav_marks`, `match_batches`, `match_candidates`, `match_decisions` (including `decided_by` = B), `bridge_outcomes` (one pointing at a decision), `portfolios` with `portfolio_analytics`, `allocator_equity_derived`, `allocator_preferences`, `investor_attestations`, `user_app_roles` and `audit_log` rows. Derive required columns from the lane DB with `\d`. `scripts/seed-full-app-demo.ts` already builds allocator, portfolios, batches and decisions with fixed ids, but has a staging interlock (`SEED_CONFIRM_STAGING`) and does not build holdings; a small custom SQL fixture is simpler. `[ASSUMED: the seed script may refuse a local URL; not run]`
- **Three rehearsal arms to record:** (a) the plain `DELETE FROM auth.users` in a rolled-back transaction, recording whether the lane's order passes or fails (evidence of order sensitivity, not proof for PROD); (b) the explicit chain then `auth.admin.deleteUser` on fixture B; (c) the same chain then raw `DELETE FROM auth.users` on a second fixture, to show the two channels leave identical row sets. Assert B's rows are 0 everywhere, bystander counts are unchanged, and audit rows persist with a NULL subject.

## Records PR and ship mechanics

- **Shape:** recent records PRs on origin/main are titled `chore(release): vX.Y.Z.B — records: <phase records summary> (#NNNN)` (#1329, #1323, #1322, #1320, #1318, #1313). Each changes `.planning/**` plus **`CHANGELOG.md`, `VERSION` and `package.json`** (bumping the 4th digit), sometimes `TODOS.md` and one script. The CHANGELOG entry states "This is a records PR. It has no source, test, script, workflow or migration change." `[VERIFIED: git show --name-only of 6e8df792a, 5217975b6, 2e683955e, 6bd016974, adfcb0488 this session]` A `.planning`-only PR with no version bump would be docs-only and would not satisfy the `version-gate` job once non-planning paths move; follow the precedent and bump.
- **Digits:** `VERSION` and `package.json` must be byte-equal 4-digit strings (`critical-regressions.test.ts` asserts it); never run `npm version`. The worktree reads `0.133.68.1` while origin/main already shows `v0.133.69.0`; re-pick from origin/main immediately before the single CI run.
- **Order (CONTEXT):** records PR (scrub) merges first; the code PR then runs its CI on a main that no longer holds the literals. If the code PR's guard lands before the scrub is on main, its own CI goes red on the merge ref. The ship branch for the code PR changes nothing under `.planning/`; check before push (`ship-planning-guard` rule).
- **Local order (worktree):** guard first (RED on the unscrubbed tree, the natural pre-fix RED), scrub second (GREEN), ship order the other way round.
- **The scrub itself:** a one-off Node script, outside the repo, reads the four literals from a mode-600 scratch file, replaces case-insensitively for logins and exactly for passwords with the CONTEXT placeholders (`<pair-A-password: redacted 2026-11-24, Phase 241>` and the three siblings), preserves every other byte, prints per-file replacement counts only, then the guard re-scan must show zero. The `.log` file must be edited in place without reformatting. Check-planning-hygiene rules and the SC-1 plan text must not gain a scratchpad or home path.

## TODOS.md and pointers

- **Closed by this phase:** exactly one entry, `TODOS.md:4260-4292`, beginning `- [ ] **[158-OPS-03/SEC] ⛔ ROTATE the two leaked demo accounts ...` and ending with `⭐ **Owned by Phase 241 DEMOCREDS, v1.22; REQUIREMENTS.md SECR-01, SECR-02; tagged 2026-11-23.**` The next entry, `[158-OPS-04] eligibility flip deferred`, starts at line 4293 and stays. The 15 other `[158-OPS-03]` entries (e2e spec dispositions, DB-types residual) are a different topic and stay.
- **Pointers elsewhere:** `git grep -n "158-OPS-03/SEC"` finds only `TODOS.md:4260`, `.planning/STOPPING-RULE-PROPOSAL.md:34` (table text) and `241-CONTEXT.md:112`. `CLAUDE.md` does not cite it. `e2e/wizard-hydration-probe.spec.ts:27` says "(TODOS 158-OPS-03)" and its disposition entry stays, so that pointer remains valid. `CHANGELOG.md:592` and `:1944` mention `158-OPS-03` as history; no edit needed.
- **No test or anchor depends on the entry:** no test names `158-OPS-03`; no pending plan cites `TODOS.md:` at a line above 4260. The TODOS-reading suites (`audit-coverage`, `baseline-content-drift-allowlist`, `lint-migration-data-dependence`, `verify-plan-anchors`, `closed-sets`, `resilient-fetch`, `wizardErrors.invariant`, `gate-family-meta`, the docs-path-filter contract and others) read other entries. Re-run `node scripts/verify-plan-anchors.mjs --pending` after the deletion because 33 lines shift.
- **Rule and timing:** per CLAUDE.md "TODOS.md holds open work only", the entry is deleted in the same PR as the ship and named in the CHANGELOG, without any literal. See Open Questions: the founder's Pair A password reset is still outstanding at ship time, and the entry is the only open pointer to it.

## Common Pitfalls

### Pitfall 1: The guard goes green by not running
**What goes wrong:** a vitest-only guard is skipped on a `.planning`-only PR or push, the exact class that pastes literals.
**Why it happens:** `DOCS_ONLY_PREFIXES = [".planning/"]` makes such a range docs-only and the shards skip.
**How to avoid:** the lint-chain link. **Warning signs:** the guard's check is absent from a docs-only run's check list.

### Pitfall 2: The failure message re-leaks the literal
**What goes wrong:** an interpolated window lands in a SUMMARY or CI log.
**How to avoid:** role, path, line only; a test arm asserts the failure text of a planted run contains none of the window.

### Pitfall 3: PROOF-01 plant into an untracked file
**What goes wrong:** `git ls-files` never lists it, so the guard stays green and the proof is vacuous.
**How to avoid:** plant into an existing tracked file's byte copy (append the literal from a shell variable that came from history), run, restore with `cp`, `cmp`, run again. Never `git checkout`, `restore` or `stash`.

### Pitfall 4: Trusting a lane run for PROD ordering
**How to avoid:** explicit leaf-to-root deletes; the lane run verifies the recipe, not PROD's trigger order.

### Pitfall 5: Expected counts copied from a stale measurement
**How to avoid:** re-measure in the same hour; abort inside the block on a mismatch.

### Pitfall 6: The records scrub breaks a reader
**How to avoid:** none of the 12 files is read by a test; keep filenames; keep the log's other bytes identical; run `check-planning-hygiene` after (it rejects scratchpad and home paths in new planning text).

## Code Examples

### Existence check for SC-1 evidence (read-only, run after the marker query)
```sql
-- Source: this research; the digest is the guard table's own pair-B-login sha256,
-- never the login text. Do not paste the digest into a tracked planning file; a count is the record.
SELECT count(*) AS pair_b_present
  FROM auth.users
 WHERE encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = '<pair-B-login sha256 from the guard table>';
```
Expected 0 on TEST (already deleted 2026-11-24) and 0 on PROD after the delete. The same query with the Pair A digest is expected to return 1 on PROD (account kept).

### Marker query (mandatory before any write, CLAUDE.md)
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Literal needle in an absence test (`HARDCODED_CRED` / `HARDCODED_PW`) | Digest table scanned over the whole tracked tree | This phase | The guard survives literal removal and covers every file, not one spec. |
| Vitest-only whole-tree check | Always-on lint-chain link plus a vitest named-arm test | Precedent: `check-planning-hygiene.ts` (Phase 163 SEC-02) | Runs on docs-only events. |

**Deprecated/outdated:** the e2e test's own docblock ("DELIBERATELY retained - do not scrub them") is superseded by the founder rulings of 2026-11-24; remove it with the constants.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Nested RI cascade actions fire at the end of their own statement in trigger-name order, with names embedding OIDs, so NO ACTION and RESTRICT checks on the path are order-dependent | PROD delete | If wrong the plain delete may be safe, but the explicit chain is still correct and costs little. |
| A2 | `auth.admin.deleteUser` (hard) performs a `DELETE` of the `auth.users` row with the FK cascades and nothing else material for this schema | PROD delete | The lane rehearsal arm (b) vs (c) exists to catch a difference; if they differ, use the admin API on PROD. |
| A3 | PROD's catalog matches the dump on this path | PROD delete | The preflight catalog query is the check; a PROD-only FK or trigger would change the chain. |
| A4 | CI wall time of the scan is a few seconds to about 20 s | Guard design | Only a timeout/budget question; floors and explicit timeouts absorb it. |
| A5 | `scripts/seed-full-app-demo.ts` may refuse a local URL because of its staging interlock | Rehearsal | If it works it saves fixture-writing; otherwise custom SQL, as recommended. |
| A6 | The founder wants SC-1's Pair A evidence recorded by date once he confirms the reset, and the TODOS entry deleted at ship regardless | TODOS | If he wants the entry to stay until the reset, keep a narrow reminder instead of deleting. |

## Open Questions

1. **Which channel performs the PROD auth delete?**
   - What we know: CONTEXT names the Supabase admin API; PROD reads go through the Supabase MCP and PROD writes through one statement per MCP call; TEST's Pair B was deleted by a scoped SQL statement.
   - What's unclear: whether a PROD service key is available to a shell, or the delete is done as SQL inside the atomic block.
   - Recommendation: rehearse both on the lane (arms b and c), then use whichever the coordinator and founder sanction at the STOP gate; prefer the single atomic SQL block if the two leave identical row sets.
2. **Delete the `[158-OPS-03/SEC]` TODOS entry before the founder confirms the Pair A reset?**
   - What we know: CONTEXT says delete at ship; the founder's reset is a human step with no date yet.
   - What's unclear: whether the verification status (for example `human_needed`, as Phase 237 used) is a sufficient carrier for the open step.
   - Recommendation: delete the entry at ship per CONTEXT and carry the reset as the phase's `human_needed` item, recorded with its date in VERIFICATION.
3. **Scrub Pair A's bare local-part in 5 more archived files?**
   - What we know: the full-login digest cannot see a login minus its domain; Pair A's local part is a unique 17-character token in 5 files (including `.planning/STATE.md`); Pair B's local part is ordinary hyphenated vocabulary (only 8 of 31 occurrences are followed by `@`).
   - Recommendation: out of CONTEXT scope; logins are not secrets per CONTEXT. Mention to the coordinator, scrub only if the founder wants the identity gone, and do not add a bare-local-part digest (it would redden unrelated prose for Pair B).
4. **Binary files:** the guard recommendation scans them (measured cost under 1%), overriding the autonomously-decided "binary skipped". Confirm with the coordinator; reverting is a one-line change.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git | Guard enumeration, PROOF-01 | yes | worktree on `gsd/phase-241-democreds` | — |
| node | Guard script, scrub, digest generation | yes | v25.8.1 | — |
| npm dependencies (`node_modules`) | vitest, tsx, eslint in the worktree | **no** | — | `npm ci` in the worktree (heavy under current load); the plain-Node prototype covers algorithm checks meanwhile |
| gitleaks | Range scan before each push | yes | 8.30.1 | — |
| Docker daemon | `scripts/local-stack/run.sh up` | **no** (client 29.9.2 installed, daemon unreachable) | — | Start Docker Desktop; no equivalent fallback for a real-baseline plus GoTrue rehearsal |
| supabase CLI | Local stack | yes | 2.84.2 (v3.4.0 available; lane pins its own Postgres image) | — |
| psql | Fixture and assertions | yes | 18.6 | — |
| PROD / TEST database access | Preflight, delete, evidence | not probed (founder-gated writes) | — | Supabase MCP for reads; ask before PROD writes |

**Missing dependencies with no fallback:** Docker daemon (blocks the rehearsal; start it before the rehearsal plan).
**Missing dependencies with fallback:** `node_modules` in the worktree (install, or run the script under tsx from a populated checkout; do not touch the main checkout).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (repo-pinned; `npm test` = `vitest run`), plus `tsx scripts/check-demo-credential-digests.ts` as a lint link |
| Config file | `vitest.config.ts` (jsdom default; node-env opt-in list in `vitest.node-env.ts`) |
| Quick run command | `npx vitest run src/__tests__/check-demo-credential-digests.test.ts --testTimeout=120000` |
| Full suite command | `npm test` (shards in CI), plus `npm run lint` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SECR-02 | No tracked file matches any of the four digests; each role is its own named arm | unit + live-tree | `npx vitest run src/__tests__/check-demo-credential-digests.test.ts --testTimeout=120000` | Wave 0 |
| SECR-02 | Same verdict on every event incl. docs-only | lint link | `npx tsx scripts/check-demo-credential-digests.ts` (exit 0 clean, 1 with role/path/line) | Wave 0 |
| SECR-02 | e2e spec holds no quoted credential assignment; env sourcing intact | unit | `npx vitest run src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` | exists, edited |
| SECR-02 | Diff carries no secret (range form) | scan | `gitleaks git . --no-banner --redact --config .gitleaks.toml --log-opts=<base>..<head>` | n/a |
| SECR-01 | Pair B absent on TEST and PROD, dated; Pair A present on PROD | read-only SQL | marker query, then the existence query (count only) | n/a |
| SECR-01 | The chain passes on a Pair-B-shaped fixture and bystanders are untouched | lane rehearsal | `scripts/local-stack/run.sh up`, fixture seed, three rehearsal arms, `down` | Wave 0 |
| PROOF-01 | Guard RED on a planted literal with the named arm first, byte-restore, GREEN | neuter | see below | n/a |

### PROOF-01 RED/GREEN steps (recorded verbatim in the plan SUMMARY, one row per arm, 226-01 row shape: arm / neuter edit / command / RED line / restore `cmp` exit 0 / GREEN line)
1. Pre-fix RED (natural): run the guard on the unscrubbed tree. Expect the four roles RED with the measured file counts (8, 8, 5, 1). Record the role/path/line lines.
2. For each of the four roles, plant the real literal into a **byte copy of an existing tracked file**: back up the file (`cp f f.bak` in the scratchpad), append the literal from a shell variable that was read from history, run the quick command, record the first failing arm name (the planted role) with its `path:line`, restore with `cp` back, run `cmp` (no output, exit 0), re-run to GREEN, confirm `git diff --quiet -- <file>` exits 0. The shell variable is never echoed; `set +x`, no `-v`.
3. Variant plants on one role each: upper-cased login, a CRLF-terminated line, no trailing newline at EOF, the literal embedded in a longer token, inside a binary file already tracked (for example a tracked PNG): each must go RED.
4. Neuter the guard itself, one edit at a time, from a byte backup of `scripts/check-demo-credential-digests.ts`: flip one hex character of one stored `sha256` (the planted literal of that role must then go GREEN, proving the row binds), turn off case folding (planted upper-case login goes GREEN while its arm in the synthetic block goes RED first), change the window-start condition `i >= length - 1` so a literal at offset 0 is missed (synthetic start arm RED first), make the scan skip files whose path starts with the planning directory name (the planted-in-archive arm goes RED first). Each RED must be on the named arm; restore with `cp`, `cmp`, GREEN.
5. Failure-text arm: a planted run's output contains the role, path and line and contains none of the window bytes.
6. Replacement structural arm (e2e test): plant a synthetic quoted assignment to a `*_PASSWORD` identifier into a byte copy of `e2e/match-queue.spec.ts`, RED on that arm first, restore, `cmp`, GREEN.
7. Anti-vacuity: with the file list emptied the script reports `EMPTY-SCAN`; with the canary row removed the canary arm goes RED.

### Sampling Rate
- **Per task commit:** the quick command above plus `npx tsx scripts/check-demo-credential-digests.ts`.
- **Per wave merge:** `npm run lint`, the suites below, the gitleaks range scan.
- **Phase gate:** full suite green and the gitleaks range scan clean before `/gsd-verify-work`.

### Suites that must run green pre-push
`src/__tests__/check-demo-credential-digests.test.ts` (new); `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts`; `src/__tests__/check-planning-hygiene.test.ts` and `npm run lint` (scratchpad and home-path rules on every new planning file); `src/__tests__/critical-regressions.test.ts` (seed block and VERSION/package.json byte-equality); `src/__tests__/gitleaks-allowlist.test.ts`; `src/__tests__/self-referential-oracle.test.ts` (new test must not match the vacuity shape); `src/__tests__/gate-family-meta.test.ts`; `src/__tests__/contracts/ci-docs-path-filter.contract.test.ts` and `contracts-registry.test.ts` (new files must not name the planning directory in a string literal; optional registry rows); `src/lib/seam-log-coverage.test.ts` and the `src/lib/*invariant*.test.ts` family (whole-tree invariant suites, unaffected but part of the standing pre-push set); the seed readers `observ12-fixtures-presence.test.ts` and `phase-150-capital-ownership-invariant.test.ts` and `sec-005-api-keys-projection.test.ts`; `node scripts/verify-plan-anchors.mjs --pending` after the TODOS deletion. Tests that read TODOS.md or CHANGELOG.md: the TODOS list above plus `check-canonical-domain.test.ts`, `phase-150-capital-ownership-invariant.test.ts` and `contracts-registry.test.ts` for CHANGELOG; none depends on the deleted entry. `[VERIFIED: git grep this session]`

### Wave 0 Gaps
- [ ] `scripts/check-demo-credential-digests.ts` — SECR-02
- [ ] `src/__tests__/check-demo-credential-digests.test.ts` — SECR-02 named arms and PROOF-01
- [ ] `node_modules` in the worktree and a running Docker daemon — execution blockers, not research blockers
- [ ] Rehearsal fixture SQL and assertion script (kept with the phase records, literal-free) — SECR-01

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Pair A password reset by the founder only; Pair B account deleted; no agent handles credentials. |
| V3 Session Management | yes | Deleting the auth user removes its 2 live sessions by cascade (verify zero sessions after). |
| V4 Access Control | yes | Scoped, atomic delete resolved by id from a digest, with cross-owner counts asserted zero before any write. |
| V5 Input Validation | no | No user input; the PROD SQL contains no interpolated external value. |
| V6 Cryptography | yes | `node:crypto` sha256 only; never hand-rolled. Stated limit: a 6-character digest is brute-forceable and is a tripwire, not a secret. |
| V7 Error Handling and Logging | yes | Failure output carries role, path, line only; never the matched bytes. |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential literal re-enters the public tree | Information Disclosure | Always-on digest guard over every tracked byte; gitleaks range scan; no literal in commit text, CHANGELOG, TODOS or PR body. |
| Guard output re-leaks the literal | Information Disclosure | Role/path/line only; a test arm pins it. |
| Wrong account deleted | Tampering | Resolve by lowercase-login digest, assert exactly one id, assert cross-owner counts zero, atomic block with count assertions. |
| Digest used to recover a short password | Information Disclosure | Accepted and stated: literal already public in history; credential dead after reset or delete. |
| Vacuous guard | Repudiation of control | Floors, synthetic canary and the byte-restore PROOF-01 plants. |

## Sources

### Primary (HIGH confidence)
- Repo files read this session: `241-CONTEXT.md`, `241-PROD-MEASUREMENT.md`, `.planning/REQUIREMENTS.md` (SECR-01, SECR-02, PROOF-01), `.planning/STATE.md`, `.planning/ROADMAP.md` Phase 241, `supabase/schema/baseline.sql` (lines cited above), `supabase/schema/baseline-carried-migrations.txt`, `scripts/local-stack/run.sh`, `scripts/pg-lane/run.sh`, `scripts/check-planning-hygiene.ts`, `scripts/classify-changed-paths.mjs`, `.gitleaks.toml`, `package.json`, `.github/workflows/ci.yml` (frontend-lint), `vitest.config.ts`, `vitest.node-env.ts`, `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts`, `src/__tests__/self-referential-oracle.test.ts`, `src/__tests__/contracts/ci-docs-path-filter.contract.test.ts`, `src/__tests__/contracts/contracts-registry.test.ts`, `TODOS.md`, `CLAUDE.md`.
- Measurements by in-process scan and gitleaks 8.30.1 in the worktree.
- `.planning/phases/226-*/226-01-SUMMARY.md` and `226-05-SUMMARY.md` (PROOF-01 row shape); git history of recent records PRs.

### Secondary (MEDIUM confidence)
- PostgreSQL documentation, trigger firing order and RESTRICT/NO ACTION semantics: https://www.postgresql.org/docs/current/trigger-definition.html and https://www.postgresql.org/docs/current/ddl-constraints.html (fetched this session; the page does not state when a non-deferred check runs, so the end-of-statement reading is marked assumed).

### Tertiary (LOW confidence)
- None used as authority.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; prototype measured over the real tree.
- Architecture (wiring, always-on lint link): HIGH — classifier and CI job comments read in the repo.
- PROD delete ordering: MEDIUM — static dump analysis and docs; closed by the PROD preflight query and the lane rehearsal.
- Pitfalls: HIGH — each traces to a measured repo fact.

**Research date:** 2026-11-24
**Valid until:** 2026-12-08 for the tree census and PROD counts (fast-moving); the design stays valid until the tree or `classify-changed-paths.mjs` changes.
