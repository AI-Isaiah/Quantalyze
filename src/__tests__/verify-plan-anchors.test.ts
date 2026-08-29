/**
 * Red/green proof for the PLAN.md anchor verifier (Phase 164.3, VAC-05).
 *
 * ⛔ FOUNDER RULE, MACHINE-CHECKED HERE: a control that cannot fail is worse
 * than no control. Both failure shapes this verifier exists for were MEASURED
 * on this repo's own wave-3 plans in Phase 164, and both are reproduced below
 * as fixtures the verifier MUST flag:
 *
 *   1. A range that outlives its file. `164-04-PLAN.md` anchored edits at
 *      `v2/page.tsx:563-573` in a file that had shrunk to 423 lines. The
 *      fixture here is a file of EXACTLY 423 lines and a plan claiming
 *      `:563-573` in it.
 *   2. A quote that no longer exists in the anchored range. `164-03-PLAN.md`
 *      specified a two-argument `deriveShareToken(strategyId, generation)`
 *      against a source whose signature had grown a third parameter — a plan
 *      followed literally would have minted links that fail verification. The
 *      fixture here quotes the two-argument form against a three-argument
 *      source.
 *
 * Both fixtures are asserted RED. A green fixture is asserted GREEN in the same
 * run, because "everything fails" is as useless as "nothing fails".
 *
 * ⛔ THE CLAIM-KIND SET IS PINNED EXACTLY (same discipline as the linter's rule
 * pin): adding a kind reds this file until it has red AND green coverage here,
 * and dropping one reds it immediately.
 *
 * ⛔ "COULD NOT MEASURE" IS NOT "MEASURED ZERO". A scan that discovers no plan
 * files must report MEASURE_FAIL and exit non-zero — never `0 misses`, which is
 * what an empty glob would otherwise look like. Asserted below in both
 * polarities, because an empty variable satisfies a numeric `-eq 0` test and
 * that is precisely how a broken scan reads as a clean one.
 *
 * ⛔ READS GO THROUGH node:fs, NEVER shell grep. This repo carries a MEASURED
 * NUL-blind file (`src/lib/wizardErrors.test.ts`, deliberate NUL at line 1572):
 * ugrep skips such a file entirely and its exit 1 reads as "clean". The
 * NUL-byte fixture below pins that an anchor into such a file still RESOLVES,
 * so a future rewrite that reaches for `grep` reds this file.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CLAIM_KINDS,
  findPendingPlans,
  selfTest,
  verifyPaths,
} from "../../scripts/verify-plan-anchors.mjs";

const REPO_ROOT = process.cwd();
const VERIFIER = "scripts/verify-plan-anchors.mjs";

/** The exact set of claim kinds this verifier is allowed to ship (VAC-05). */
const EXPECTED_CLAIM_KINDS = [
  "anchor-range",
  "anchor-quote",
  "symbol-pragma",
  "context-ref",
] as const;

// ───────────────────────────────────────────────────────────────────────────
// Fixture trees. Built on disk under a temp dir rather than committed under
// `src/`, for one reason that matters: the 423-line reproduction needs a file
// of EXACTLY 423 lines, and a committed one would be 423 lines of noise that
// the next person reformats. Built here, the number is an assertion.
// ───────────────────────────────────────────────────────────────────────────

let SCRATCH: string;

function tree(name: string, files: Record<string, string>): string {
  const root = join(SCRATCH, name);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function planPath(root: string, rel: string): string[] {
  return [join(root, rel)];
}

/** A source file of exactly `n` lines — the 423-line reproduction. */
function linesFile(n: number): string {
  return (
    Array.from({ length: n }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n") + "\n"
  );
}

beforeAll(() => {
  SCRATCH = mkdtempSync(join(tmpdir(), "verify-plan-anchors-"));
});

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("verify-plan-anchors: the shipped claim kinds (VAC-05)", () => {
  it("ships exactly the pinned claim kinds", () => {
    expect([...CLAIM_KINDS].sort()).toEqual([...EXPECTED_CLAIM_KINDS].sort());
  });
});

describe("MEASURED FAILURE 1 — a range that outlives its file (164-04)", () => {
  it("flags an anchor whose end line exceeds the file's length", () => {
    const root = tree("range-red", {
      "src/app/strategies/v2/page.tsx": linesFile(423),
      ".planning/phases/99-fixture/99-01-PLAN.md": [
        "<tasks>",
        "<task type=\"auto\">",
        "  <action>",
        "    Replace the branch at src/app/strategies/v2/page.tsx:563-573 with the",
        "    hoisted helper.",
        "  </action>",
        "</task>",
        "</tasks>",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.measureFail).toBe(false);
    expect(res.scanned).toBe(1);
    expect(res.misses).toHaveLength(1);
    expect(res.misses[0].code).toBe("range-out-of-bounds");
    // The file's REAL length has to appear in the message — "out of range" with
    // no number sends the reader back to the file to find out by how much.
    expect(res.misses[0].reason).toContain("423");
    expect(res.misses[0].reason).toContain("573");
  });

  it("passes the same anchor once the range is inside the file", () => {
    const root = tree("range-green", {
      "src/app/strategies/v2/page.tsx": linesFile(423),
      ".planning/phases/99-fixture/99-01-PLAN.md": [
        "<tasks>",
        "  Replace the branch at src/app/strategies/v2/page.tsx:400-410 with the",
        "  hoisted helper.",
        "</tasks>",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.measureFail).toBe(false);
    expect(res.misses).toEqual([]);
    expect(res.claims).toBeGreaterThan(0);
  });

  it("flags a start line past the end of the file even with no end line", () => {
    const root = tree("range-start-red", {
      "src/app/strategies/v2/page.tsx": linesFile(423),
      ".planning/phases/99-fixture/99-01-PLAN.md":
        "Edit src/app/strategies/v2/page.tsx:900 to hoist the helper.\n",
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses.map((m) => m.code)).toEqual(["range-out-of-bounds"]);
  });
});

describe("MEASURED FAILURE 2 — a quote that no longer exists in the range (164-03)", () => {
  const THREE_ARG_SOURCE = [
    "import { createHmac } from \"node:crypto\";",
    "",
    "export function deriveShareToken(",
    "  strategyId: string,",
    "  nonce: string,",
    "  generation: number,",
    "): string {",
    "  return createHmac(\"sha256\", secret()).update(`${strategyId}:${nonce}:${generation}`).digest(\"base64url\");",
    "}",
    "",
  ].join("\n");

  it("flags a quoted signature that is not in the anchored range", () => {
    const root = tree("quote-red", {
      "src/lib/strategy-share-token.ts": THREE_ARG_SOURCE,
      ".planning/phases/99-fixture/99-02-PLAN.md": [
        "<tasks>",
        "  The mint route calls `src/lib/strategy-share-token.ts:3-9`:",
        "  `deriveShareToken(strategyId, generation)` — pass the generation straight",
        "  through.",
        "</tasks>",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-02-PLAN.md"), {
      root,
    });

    expect(res.measureFail).toBe(false);
    expect(res.misses).toHaveLength(1);
    expect(res.misses[0].code).toBe("quote-absent");
    expect(res.misses[0].claim).toContain("deriveShareToken(strategyId, generation)");
  });

  it("passes when the quote is the signature the file actually carries", () => {
    const root = tree("quote-green", {
      "src/lib/strategy-share-token.ts": THREE_ARG_SOURCE,
      ".planning/phases/99-fixture/99-02-PLAN.md": [
        "<tasks>",
        "  The mint route calls `src/lib/strategy-share-token.ts:3-9`:",
        "  `deriveShareToken( strategyId: string, nonce: string, generation: number, )`",
        "  — all three come from the RPC's single returned row.",
        "</tasks>",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-02-PLAN.md"), {
      root,
    });

    expect(res.misses).toEqual([]);
    expect(res.claims).toBeGreaterThanOrEqual(2); // the range AND the quote
  });

  it("distinguishes a quote that moved from one that is gone", () => {
    const root = tree("quote-moved", {
      "src/lib/strategy-share-token.ts": THREE_ARG_SOURCE,
      ".planning/phases/99-fixture/99-02-PLAN.md": [
        "<tasks>",
        "  See `src/lib/strategy-share-token.ts:1-2` and the",
        "  `export function deriveShareToken(` it opens with.",
        "</tasks>",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-02-PLAN.md"), {
      root,
    });

    expect(res.misses).toHaveLength(1);
    expect(res.misses[0].code).toBe("quote-outside-range");
    // Triage value: the reader is told where it actually lives.
    expect(res.misses[0].reason).toMatch(/line 3\b/);
  });
});

describe("aggregation — every miss is reported, never first-miss-exit", () => {
  it("reports both measured shapes from one plan in one run", () => {
    const root = tree("aggregate", {
      "src/app/strategies/v2/page.tsx": linesFile(423),
      "src/lib/strategy-share-token.ts": "export function deriveShareToken(a, b, c) {}\n",
      ".planning/phases/99-fixture/99-03-PLAN.md": [
        "Edit src/app/strategies/v2/page.tsx:563-573 first.",
        "Then `src/lib/strategy-share-token.ts:1-1` where",
        "`deriveShareToken(a, b)` is defined.",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-03-PLAN.md"), {
      root,
    });

    expect(res.misses.map((m) => m.code).sort()).toEqual([
      "quote-absent",
      "range-out-of-bounds",
    ]);
  });

  it("aggregates across several plan files in one invocation", () => {
    const root = tree("aggregate-multi", {
      "src/a.ts": linesFile(10),
      ".planning/phases/99-fixture/99-01-PLAN.md": "Edit src/a.ts:50-60 here.\n",
      ".planning/phases/99-fixture/99-02-PLAN.md": "And src/a.ts:99 there.\n",
    });

    const res = verifyPaths(
      [
        join(root, ".planning/phases/99-fixture/99-01-PLAN.md"),
        join(root, ".planning/phases/99-fixture/99-02-PLAN.md"),
      ],
      { root },
    );

    expect(res.scanned).toBe(2);
    expect(res.misses).toHaveLength(2);
    expect(new Set(res.misses.map((m) => m.plan)).size).toBe(2);
  });
});

describe("false-positive discipline (T-164.3-23)", () => {
  it("ignores a path-like token with NO line range", () => {
    const root = tree("prose-path", {
      "src/a.ts": linesFile(10),
      ".planning/phases/99-fixture/99-01-PLAN.md": [
        "The old `.planning/phases/164-.../pg-harness/run.sh` is promoted here,",
        "and legacy/deleted-module.ts is gone for good.",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.measureFail).toBe(false);
    expect(res.misses).toEqual([]);
  });

  it("flags a path that CARRIES a line range but resolves to nothing", () => {
    const root = tree("anchor-unresolved", {
      "src/a.ts": linesFile(10),
      ".planning/phases/99-fixture/99-01-PLAN.md":
        "Edit legacy/deleted-module.ts:12-20 to hoist the helper.\n",
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses.map((m) => m.code)).toEqual(["path-unresolved"]);
  });

  it("resolves a shorthand anchor when exactly one tracked file matches the suffix", () => {
    const root = tree("anchor-suffix", {
      ".github/workflows/ci.yml": linesFile(50),
      ".planning/phases/99-fixture/99-01-PLAN.md": "See ci.yml:10-12 for the row.\n",
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses).toEqual([]);
  });

  it("refuses a shorthand anchor that matches more than one file", () => {
    const root = tree("anchor-ambiguous", {
      "src/app/a/route.ts": linesFile(50),
      "src/app/b/route.ts": linesFile(50),
      ".planning/phases/99-fixture/99-01-PLAN.md": "See route.ts:10-12 for the CAS.\n",
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses.map((m) => m.code)).toEqual(["path-ambiguous"]);
    expect(res.misses[0].reason).toContain("src/app/a/route.ts");
  });
});

describe("NUL bytes — the file shell grep cannot read", () => {
  it("resolves an anchor and its quote inside a NUL-carrying file", () => {
    // `src/lib/wizardErrors.test.ts` carries a deliberate NUL at line 1572 and
    // ugrep SKIPS the whole file, exiting 1 — which reads as "clean". A
    // verifier built on grep would silently pass every claim about this file.
    const root = tree("nul-file", {
      "src/lib/nul-carrier.ts": `const marker = "\0";\nexport const SENTINEL = "nul-safe-read";\n`,
      ".planning/phases/99-fixture/99-01-PLAN.md": [
        "The constant at `src/lib/nul-carrier.ts:1-2` is",
        "`export const SENTINEL = \"nul-safe-read\"`.",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses).toEqual([]);
    expect(res.claims).toBeGreaterThanOrEqual(2);
  });

  it("still FAILS a false claim about a NUL-carrying file (the check is real, not skipped)", () => {
    const root = tree("nul-file-red", {
      "src/lib/nul-carrier.ts": `const marker = "\0";\nexport const SENTINEL = "nul-safe-read";\n`,
      ".planning/phases/99-fixture/99-01-PLAN.md": [
        "The constant at `src/lib/nul-carrier.ts:1-2` is",
        "`export const SENTINEL = \"a-value-that-is-not-there\"`.",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses.map((m) => m.code)).toEqual(["quote-absent"]);
  });
});

describe("symbol pragma — an existence claim the planner opts into", () => {
  it("passes when the symbol is in the named file", () => {
    const root = tree("symbol-green", {
      "src/lib/strategy-share-token.ts": "export function deriveShareToken(a, b, c) {}\n",
      ".planning/phases/99-fixture/99-01-PLAN.md":
        "<!-- verify-symbol: src/lib/strategy-share-token.ts deriveShareToken -->\n",
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses).toEqual([]);
    expect(res.claims).toBe(1);
  });

  it("flags a symbol that is not in the named file", () => {
    const root = tree("symbol-red", {
      "src/lib/strategy-share-token.ts": "export function deriveShareToken(a, b, c) {}\n",
      ".planning/phases/99-fixture/99-01-PLAN.md":
        "<!-- verify-symbol: src/lib/strategy-share-token.ts mintShareLink -->\n",
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses.map((m) => m.code)).toEqual(["symbol-absent"]);
  });

  it("flags a symbol pragma whose file does not exist", () => {
    const root = tree("symbol-path-red", {
      "src/lib/strategy-share-token.ts": "export function deriveShareToken(a, b, c) {}\n",
      ".planning/phases/99-fixture/99-01-PLAN.md":
        "<!-- verify-symbol: src/lib/gone.ts deriveShareToken -->\n",
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses.map((m) => m.code)).toEqual(["path-unresolved"]);
  });
});

describe("context @-references — the files the executor is told to read", () => {
  it("flags an in-tree @-reference that does not resolve", () => {
    const root = tree("ctx-red", {
      ".planning/STATE.md": "state\n",
      ".planning/phases/99-fixture/99-01-PLAN.md": [
        "<context>",
        "@.planning/STATE.md",
        "@.planning/phases/99-fixture/99-00-SUMMARY.md",
        "</context>",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.misses.map((m) => m.code)).toEqual(["context-ref-missing"]);
    expect(res.misses[0].claim).toContain("99-00-SUMMARY.md");
  });

  it("ignores @-references that point outside the repo", () => {
    const root = tree("ctx-outside", {
      ".planning/phases/99-fixture/99-01-PLAN.md": [
        "@~/.claude/gsd-core/workflows/execute-plan.md",
        "@$HOME/.claude/gsd-core/templates/summary.md",
        "@/etc/hosts",
        "",
      ].join("\n"),
    });

    const res = verifyPaths(planPath(root, ".planning/phases/99-fixture/99-01-PLAN.md"), {
      root,
    });

    expect(res.measureFail).toBe(false);
    expect(res.misses).toEqual([]);
    expect(res.claims).toBe(0);
  });
});

describe("pending-plan discovery — executed plans are archival and exempt", () => {
  it("selects only plans with no sibling SUMMARY", () => {
    const root = tree("pending", {
      ".planning/phases/98-done/98-01-PLAN.md": "a\n",
      ".planning/phases/98-done/98-01-SUMMARY.md": "b\n",
      ".planning/phases/98-done/98-02-PLAN.md": "c\n",
      ".planning/phases/99-open/99-01-PLAN.md": "d\n",
    });

    const found = findPendingPlans(root);

    expect(found.planFiles).toBe(3);
    expect(found.pending.map((p) => p.replace(/\\/g, "/")).sort()).toEqual([
      ".planning/phases/98-done/98-02-PLAN.md",
      ".planning/phases/99-open/99-01-PLAN.md",
    ]);
  });

  it("reports MEASURE_FAIL when .planning/phases cannot be LOCATED", () => {
    // The corpus was never opened. Zero here means "did not look".
    const root = tree("no-phases-dir", { "src/a.ts": "x\n" });

    const found = findPendingPlans(root);

    expect(found.planFiles).toBe(0);
    expect(found.measureFail).toBe(true);
    expect(found.corpusState).toBe("unlocatable");
    expect(found.measureReason).toContain("could not be located");
  });

  it("reports MEASURE_FAIL when .planning/phases exists but cannot be READ", () => {
    // ⛔ The other half of CR-02. An unreadable corpus is not an empty one, and
    // if this ever silently returned zero the gate would go green having
    // enumerated nothing. Skipped where a chmod cannot make a dir unreadable
    // (root, or a filesystem without POSIX modes) rather than asserted
    // vacuously.
    const root = tree("unreadable-phases", {
      ".planning/phases/98-done/98-01-PLAN.md": "a\n",
    });
    const phases = join(root, ".planning", "phases");
    chmodSync(phases, 0o000);
    let readableAnyway = true;
    try {
      readdirSync(phases);
    } catch {
      readableAnyway = false;
    }
    try {
      if (readableAnyway) {
        // Running as root, or no POSIX modes. Say so instead of pretending.
        expect(readableAnyway).toBe(true);
        return;
      }
      const found = findPendingPlans(root);
      expect(found.measureFail).toBe(true);
      expect(found.corpusState).toBe("unreadable");
      expect(found.measureReason).toContain("could NOT be read");
    } finally {
      chmodSync(phases, 0o755);
    }
  });

  it("CR-02: an ARCHIVED corpus — present, readable, zero plan files — is a MEASURED zero, not a broken glob", () => {
    // This is exactly what /gsd-complete-milestone leaves behind: every phase
    // directory moved into .planning/milestones/v{X.Y}-phases/. This repo has
    // produced that state before (e9a57671). Treating it as a MEASURE_FAIL
    // reddened the required `frontend` check on EVERY PR, with no remedy but
    // to switch the job off.
    const root = tree("archived-corpus", {
      ".planning/phases/.keep": "",
      ".planning/milestones/v1.20-phases/164-old/164-01-PLAN.md": "a\n",
    });

    const found = findPendingPlans(root);

    expect(found.planFiles).toBe(0);
    expect(found.pending).toEqual([]);
    expect(found.measureFail).toBe(false);
    expect(found.corpusState).toBe("archived");
  });

  it("does NOT report MEASURE_FAIL when plans exist and all are executed", () => {
    // The load-bearing distinction: zero PENDING plans is a measurement; zero
    // PLAN FILES is a broken glob. Collapsing them is how a scan that read
    // nothing reports success.
    const root = tree("all-executed", {
      ".planning/phases/98-done/98-01-PLAN.md": "a\n",
      ".planning/phases/98-done/98-01-SUMMARY.md": "b\n",
    });

    const found = findPendingPlans(root);

    expect(found.planFiles).toBe(1);
    expect(found.pending).toEqual([]);
    expect(found.measureFail).toBe(false);
    expect(found.corpusState).toBe("populated");
  });
});

describe("WR-06 — a deliberately deferred plan can leave the pending set HONESTLY", () => {
  it("a sibling <n>-DEFERRED.md with content exempts the plan and is reported", () => {
    const root = tree("deferred-sibling", {
      ".planning/phases/99-open/99-01-PLAN.md": "a\n",
      ".planning/phases/99-open/99-01-DEFERRED.md":
        "Deferred 2026-08-29 by founder decision: the substrate does not exist.\n",
      ".planning/phases/99-open/99-02-PLAN.md": "b\n",
    });

    const found = findPendingPlans(root);

    expect(found.planFiles).toBe(2);
    expect(found.pending.map((p) => p.replace(/\\/g, "/"))).toEqual([
      ".planning/phases/99-open/99-02-PLAN.md",
    ]);
    expect(found.deferred.map((d) => d.plan.replace(/\\/g, "/"))).toEqual([
      ".planning/phases/99-open/99-01-PLAN.md",
    ]);
    expect(found.deferred[0].marker).toBe("99-01-DEFERRED.md");
  });

  it("an EMPTY -DEFERRED.md does NOT exempt — a marker with no reason in it is a checkbox", () => {
    // The exemption must cost the same as the honesty it stands in for. If a
    // zero-byte file were enough, this mechanism would be a switch for turning
    // the gate off one plan at a time.
    const root = tree("deferred-empty", {
      ".planning/phases/99-open/99-01-PLAN.md": "a\n",
      ".planning/phases/99-open/99-01-DEFERRED.md": "   \n\n",
    });

    const found = findPendingPlans(root);

    expect(found.deferred).toEqual([]);
    expect(found.pending.map((p) => p.replace(/\\/g, "/"))).toEqual([
      ".planning/phases/99-open/99-01-PLAN.md",
    ]);
  });

  it("`status: deferred` in the PLAN's own frontmatter also exempts it", () => {
    const root = tree("deferred-frontmatter", {
      ".planning/phases/99-open/99-01-PLAN.md":
        "---\nphase: 99\nstatus: deferred\n---\n\nbody\n",
    });

    const found = findPendingPlans(root);

    expect(found.pending).toEqual([]);
    expect(found.deferred[0].marker).toBe("frontmatter status: deferred");
  });

  it("`status: deferred` OUTSIDE the frontmatter does not exempt anything", () => {
    const root = tree("deferred-body-only", {
      ".planning/phases/99-open/99-01-PLAN.md":
        "---\nphase: 99\n---\n\nWe considered writing `status: deferred` here.\n",
    });

    const found = findPendingPlans(root);

    expect(found.deferred).toEqual([]);
    expect(found.pending.length).toBe(1);
  });

  it("G2: an exempted plan is ROUTED — dated reason, owning phase, and no stale unblocker left behind", () => {
    // ⛔ Verification gap G2. The exemption mechanism above is what lets a
    // deferred plan leave the pending set. That must not become a way to make
    // a plan disappear: before this, plan 07's non-execution existed ONLY as
    // an unchecked ROADMAP checkbox — no date, no reason, no owning phase —
    // while Phase 159's two blocked items still named 164.3 as their
    // unblocker and carried a closing recipe plan 04's own measurement had
    // falsified. Closing the phase like that leaves two items blocked on a
    // completed phase.
    //
    // So the deferral marker is not enough on its own: the ledger must carry
    // the routing, and no other artifact may still point at the wrong phase.
    const found = findPendingPlans(REPO_ROOT);
    const deferred = found.deferred.filter((d) =>
      d.plan.replace(/\\/g, "/").includes("/164.3-07-PLAN.md"),
    );
    if (deferred.length === 0) {
      // Plan 07 executed or was removed — this pin no longer applies, and the
      // ledger item should be closed by whoever did that.
      return;
    }

    const marker = readFileSync(
      join(
        REPO_ROOT,
        ".planning/phases/164.3-vacuity-a-control-that-cannot-fail-must-be-caught-by-machine",
        "164.3-07-DEFERRED.md",
      ),
      "utf8",
    );
    expect(marker, "the deferral marker must be DATED").toContain("2026-08-29");
    expect(marker, "the deferral marker must name an OWNING phase").toContain("164.5");
    expect(
      marker,
      "the deferral marker must carry the MEASUREMENT that forced it, not just an assertion",
    ).toContain("69 fail");

    const todos = readFileSync(join(REPO_ROOT, "TODOS.md"), "utf8");
    expect(
      todos,
      "TODOS.md is the single backlog ground truth in this repo. A deferral recorded only in a " +
        "phase directory is routed to nothing once the phase is archived.",
    ).toContain("[VAC-07-DEFER]");

    // And the falsified recipe must be gone from Phase 159's blocked items.
    const v159 = readFileSync(
      join(REPO_ROOT, ".planning/phases/159-rank-public-ranking-integrity/159-VERIFICATION.md"),
      "utf8",
    );
    expect(
      v159,
      "Phase 159's blocked items still carry the 'cheap once 164.3 lands' closing recipe, which " +
        "plan 04's replay measurement falsified. They are blocked on a completed phase.",
    ).not.toContain("cheap once 164.3 lands: 164.3 ships a disposable-PostgreSQL lane");
    expect(v159).toContain("blocked on PHASE 164.5");
  });

  it("phase 164.3 plan 07 — the real deferral this repo carries — is exempt and REPORTED", () => {
    // Pinned against the real tree, not a fixture: the point of WR-06 is that
    // THIS plan stops coupling every unrelated PR to its anchors.
    const found = findPendingPlans(REPO_ROOT);
    const deferredPlans = found.deferred.map((d) => d.plan.replace(/\\/g, "/"));
    expect(deferredPlans).toContain(
      ".planning/phases/164.3-vacuity-a-control-that-cannot-fail-must-be-caught-by-machine/164.3-07-PLAN.md",
    );
    expect(found.pending.map((p) => p.replace(/\\/g, "/"))).not.toContain(
      ".planning/phases/164.3-vacuity-a-control-that-cannot-fail-must-be-caught-by-machine/164.3-07-PLAN.md",
    );
  });
});

describe("MEASURE_FAIL — 'could not measure' never shares a path with 'measured zero'", () => {
  it("fails when a named plan file does not exist", () => {
    const root = tree("missing-plan", { "src/a.ts": linesFile(3) });

    const res = verifyPaths([join(root, ".planning/phases/99-fixture/99-01-PLAN.md")], {
      root,
    });

    expect(res.measureFail).toBe(true);
    expect(res.scanned).toBe(0);
  });

  it("fails when invoked with no plan files at all", () => {
    const root = tree("empty-args", { "src/a.ts": linesFile(3) });

    const res = verifyPaths([], { root });

    expect(res.measureFail).toBe(true);
  });
});

describe("the CLI contract", () => {
  it("--self-test passes in-process", () => {
    expect(selfTest()).toBe(0);
  });

  it("--self-test passes through the real binary", () => {
    const res = spawnSync("node", [VERIFIER, "--self-test"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(`${res.stdout}${res.stderr}`).toContain("SELF-TEST OK");
    expect(res.status).toBe(0);
  });

  it("--pending prints its scan counts and exits 0 on the real tree", () => {
    // The counts have to be PRINTED, because the CI job asserts on them: a run
    // that stopped printing them would otherwise pass while measuring nothing.
    const res = spawnSync("node", [VERIFIER, "--pending"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const out = `${res.stdout}${res.stderr}`;
    expect(out).toMatch(/^scanned: \d+ pending plan file\(s\) of \d+$/m);
    expect(out).toMatch(/^claims: \d+ checked$/m);
    // WR-06: the exemptions are printed on EVERY run, and ci.yml asserts on
    // this exact line. A deferral nobody can see is a way to switch this gate
    // off one plan at a time.
    expect(out).toMatch(
      /^deferred: \d+ plan file\(s\) exempted by an explicit deferral marker$/m,
    );
    expect(res.status).toBe(0);
  });

  it("CR-02: --pending on an ARCHIVED corpus exits 0 and prints the measured zero", () => {
    // The exact input the review measured as wrongly fatal.
    const root = tree("cli-archived", {
      ".planning/phases/00-x/.keep": "",
    });

    const res = spawnSync(
      "node",
      [join(REPO_ROOT, VERIFIER), "--pending", "--root", root],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    const out = `${res.stdout}${res.stderr}`;

    expect(res.status).toBe(0);
    expect(out).toMatch(/^scanned: 0 pending plan file\(s\) of 0$/m);
    expect(out).toMatch(/^measured-zero: /m);
    expect(out).not.toContain("MEASURE_FAIL");
  });

  it("CR-02: --pending on an UNLOCATABLE corpus still exits 1 — the two did not collapse", () => {
    const root = tree("cli-unlocatable", { "src/a.ts": "x\n" });

    const res = spawnSync(
      "node",
      [join(REPO_ROOT, VERIFIER), "--pending", "--root", root],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    const out = `${res.stdout}${res.stderr}`;

    expect(res.status).toBe(1);
    expect(out).toContain("MEASURE_FAIL");
    expect(out).toContain("could not be located");
    expect(out).not.toContain("measured-zero:");
  });

  it("exits 1 and names the plan when a claim misses", () => {
    const root = tree("cli-red", {
      "src/a.ts": linesFile(10),
      ".planning/phases/99-fixture/99-01-PLAN.md": "Edit src/a.ts:50-60 here.\n",
    });

    const res = spawnSync(
      "node",
      [
        join(REPO_ROOT, VERIFIER),
        "--root",
        root,
        join(root, ".planning/phases/99-fixture/99-01-PLAN.md"),
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );

    expect(res.status).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain("99-01-PLAN.md");
  });
});
