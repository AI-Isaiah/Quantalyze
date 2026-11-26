# Phase 241: DEMOCREDS - Pattern Map

**Mapped:** 2026-11-24
**Files analyzed:** 6 code/config files (plus the records-PR scrub and the PROD chain, which have no code analog)
**Analogs found:** 5 / 6

No credential literal, email, PROD id or hash appears here. The e2e test's two constants are shown as `<redacted>`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/check-demo-credential-digests.ts` (new) | utility / lint gate | batch (whole tracked tree) | `scripts/check-planning-hygiene.ts` | exact |
| `src/__tests__/check-demo-credential-digests.test.ts` (new) | test | batch | `src/__tests__/check-planning-hygiene.test.ts` | exact |
| `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` (modify) | test | file-I/O (readFileSync parity) | itself | exact |
| `vitest.node-env.ts` (modify) | config | n/a | existing sorted list entries | exact |
| `package.json` `lint` (modify) | config | n/a | existing `lint` chain | exact |
| Records PR scrub of 12 archived planning files | one-off script, outside repo | transform | none | no analog |
| PROD Pair B delete chain / lane rehearsal | ops SQL | CRUD | none in tracked source (baseline.sql is the FK source) | no analog |

All analog paths verified tracked via `git ls-files` (check-planning-hygiene.ts, its test, vitest.node-env.ts).

## Pattern Assignments

### `scripts/check-demo-credential-digests.ts` (lint gate, batch)

**Analog:** `scripts/check-planning-hygiene.ts` (1198 lines; read only the sections below).

**Imports pattern** (lines 170-174). Add `createHash` from `node:crypto`; drop `os`:
```typescript
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));   // line 176
```

**Tracked-file enumeration** (lines 606-613). Copy verbatim:
```typescript
export function listTrackedFiles(rootDir: string): string[] {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: rootDir,
    maxBuffer: 1 << 28,
    encoding: "buffer",
  });
  return raw.toString("utf-8").split("\0").filter(Boolean);
}
```

**Injectable-files core with anti-vacuity** (lines 621-697, shape). `files` defaults to the tracked list so tests drive fixtures. An unreadable path is skipped and NOT counted:
```typescript
for (const rel of files) {
  let contents: string;
  try { contents = readFileSync(resolve(rootDir, rel), "latin1"); }
  catch { continue; }          // not counted as scanned
  filesScanned += 1;
  ...
}
if (filesScanned === 0) {
  violations.push("EMPTY-SCAN: zero files were scanned. A gate that walks nothing reports OK forever ...");
}
return { violations, filesScanned, ... };
```
For this phase read a `Buffer` (no decode) as RESEARCH prescribes, and add `bytesScanned` plus floors well below measured (suggested 5,000 files, 100 MB).

**CLI entry guard** (lines 1183-1198). Copy exactly, including the `pathToFileURL` comparison, so importing from vitest never runs `main()`:
```typescript
const entryPath = process.argv[1];
if (entryPath !== undefined && entryPath.length > 0) {
  if (
    import.meta.url === pathToFileURL(entryPath).href ||
    import.meta.url.endsWith(entryPath)
  ) {
    main();
  }
}
```

**Failure output and exit** (around lines 1150-1170): prints each violation (capped at 50 with "... and N more"), then `process.exit(1)`; on success prints `[check-planning-hygiene] OK - N tracked files scanned ...`. Mirror with the prefix `[check-demo-credential-digests]`. Print `role path:line` only, never the window.

**Rolling-fingerprint scanner:** no analog; use the RESEARCH "Pattern 1" skeleton (32-bit `Math.imul` polynomial hash, sha256 confirmation, case fold for logins only). Use neutral names (`role`, `length`, `foldCase`, `fp32`, `sha256`): keyword names such as password or api_key before the hex trip gitleaks `generic-api-key`.

**Header convention:** the hygiene script opens with a long "NO PATH ALLOWLIST - BY CONSTRUCTION" docblock. Carry the same stance (no exclusions, own source included) and the honest-limit sentence that a short digest is brute-forceable, so the table is a tripwire, not secrecy.

---

### `src/__tests__/check-demo-credential-digests.test.ts` (test, batch)

**Analog:** `src/__tests__/check-planning-hygiene.test.ts` (906 lines).

**Imports pattern** (lines 1-19):
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCheck, listTrackedFiles /* ... */ } from "../../scripts/check-planning-hygiene";
```
Import path from a test to `scripts/` is `"../../scripts/<name>"`.

**Header convention** (lines 21-40): docblock states "NO REAL NEEDLE LIVES IN THIS FILE, IN ANY ENCODING" and that the needle is injected, with synthetic values in every arm. Apply the same: synthetic literals are generated at runtime, and the table row for the synthetic canary is digested at runtime.

**Arms to include** (from RESEARCH): one `it` per role asserting that role's offender list is empty (scan once in `beforeAll`, explicit 120 s timeout); case fold; CRLF; EOF without newline; embedded in a token; NUL-bearing buffer; wrong-case password not matched; floors; failure text contains no window bytes.

**Traps (RESEARCH anti-patterns):**
- Use `offenders.push(...)` then `expect(offenders).toEqual([])`. Do not write `const x = "<literal>"; expect(x)...`, which `src/__tests__/self-referential-oracle.test.ts` flags.
- Do not write the planning directory name as a string literal in the test or script (`src/__tests__/contracts/ci-docs-path-filter.contract.test.ts` lexes for it). Enumerate through `git ls-files` only.
- PROOF-01 plants go into a byte copy of an already tracked file, not an untracked one.

---

### `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` (modify, readFileSync parity)

**Analog:** itself (144 lines).

**Keep** (lines 32-51): imports and helpers.
```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const REPO_ROOT = resolve(__dirname, "..", "..");
function readSpec(rel: string): string { return readFileSync(resolve(REPO_ROOT, rel), "utf-8"); }
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
```

**Remove** (lines 53-~70): the "DELIBERATELY retained" docblock and
```typescript
const HARDCODED_CRED = <redacted>;
const HARDCODED_PW = <redacted>;
```
Before deleting, read the values from these constants into a mode-600 scratch file to generate the digest table. The docblock also names the account in prose (it must go with the constants).

**Replace** the first `it` (lines 78-92, "contains no hardcoded plaintext credential in executable code"). It currently uses `code.includes(HARDCODED_CRED)` and interpolates the needle into its failure message. New structural arm, literal-free, on `stripComments(raw)`: assert no executable assignment binds a quoted string to an identifier whose name contains `EMAIL` or `PASSWORD`. Use the accumulator idiom.

**Keep unchanged:** `sources admin creds from env` (process.env.E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD, `const HAS_ADMIN_CREDS =`), the `test.skip(!HAS_ADMIN_CREDS` count of at least 3, the `if (hasDashboard)` and early `return;` arm, the positive admin-eval arm. This file is listed in `vitest.node-env.ts` already.

---

### `vitest.node-env.ts` (config)

**Analog:** the existing sorted string list (around lines 60-75):
```typescript
  "src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts",
  "src/__tests__/e2e-seeded-hydration-guard.test.ts",
```
Insert `"src/__tests__/check-demo-credential-digests.test.ts",` in alphabetical position beside `check-*` neighbours.

### `package.json` `lint` (config, line 11)
Current chain tail: `... && tsx scripts/check-planning-hygiene.ts && tsx scripts/check-canonical-domain.ts`. Append ` && tsx scripts/check-demo-credential-digests.ts`. Do not run `npm version`; VERSION and package.json stay byte-equal.

---

## Shared Patterns

### No path allowlist, always-on wiring
**Source:** `scripts/check-planning-hygiene.ts` header, `package.json:11`, `.github/workflows/ci.yml` `frontend-lint` (unfiltered), `scripts/classify-changed-paths.mjs:82` (docs-only prefix skips vitest shards).
**Apply to:** the guard. It must live in the lint chain so it runs on `.planning`-only PRs.

### Never print the matched bytes
**Apply to:** guard script, its test, and every failure message. Output `role`, path, line only.

### PROOF-01 (neuter, RED named, byte restore, GREEN)
**Source:** CONTEXT "Established Patterns". Plant a synthetic or from-history literal in a byte copy of a tracked file, run, `cp` back, `cmp`, run again. Never `git checkout`, `restore` or `stash`.

### Gitleaks
Range form before each push: `gitleaks git . --no-banner --redact --config .gitleaks.toml --log-opts=<base>..<head>`. Neutral digest-table names, no allowlist entry.

### Ship hygiene
Code PR changes nothing under `.planning/`. Records PR precedent: `chore(release): vX.Y.Z.B - records: ...` with CHANGELOG, VERSION, package.json bump. TODOS entry `[158-OPS-03/SEC]` deleted at ship and named in the CHANGELOG without any literal. No CI-skip tokens in any commit or PR text.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Records scrub (12 archived files) | one-off script | transform | Not a repo file; run from outside the tree from a mode-600 scratch file, print per-file counts only. Replace with role placeholders per CONTEXT. |
| PROD Pair B delete chain | ops SQL | CRUD | No tracked analog. FK source of truth is `supabase/schema/baseline.sql`; lane via `scripts/local-stack/run.sh up`; chain per RESEARCH "PROD delete". Founder go required before any PROD write. Marker query first. |
| Rolling-fingerprint scanner core | utility | transform | Novel; RESEARCH Pattern 1 skeleton. |

## Metadata

**Analog search scope:** `scripts/`, `src/__tests__/`, `vitest.node-env.ts`, `package.json`
**Files read:** check-planning-hygiene.ts (targeted ranges), its test (header), the e2e gate test (redacted), vitest.node-env.ts (excerpt)
**Pattern extraction date:** 2026-11-24
