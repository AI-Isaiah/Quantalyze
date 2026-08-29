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

  it("reports MEASURE_FAIL when .planning/phases exists but cannot be READ", (ctx) => {
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
        // ⛔ R2-I05: `expect(readableAnyway).toBe(true)` is TRUE BY THE BRANCH
        // CONDITION — it records nothing and the arm counts as a pass. A
        // permanently-skipped arm that reads as green is the shape this whole
        // phase exists to refuse. Running as root or on a filesystem without
        // POSIX modes is a real reason not to assert, so it is announced on
        // stderr where a CI reader can see it, and the arm reports SKIPPED
        // rather than pretending to have measured something.
        console.warn(
          "SKIPPED (not a pass): chmod 000 did not make .planning/phases unreadable — running " +
            "as root, or on a filesystem without POSIX modes. The 'unreadable corpus is a " +
            "MEASURE_FAIL' half of CR-02 was NOT exercised in this environment.",
        );
        ctx.skip();
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
      // R2-W05: the marker must name a DATE and an OWNING PHASE. "Non-empty"
      // was satisfiable by one byte, and both deferral routes are writable by
      // the same PR that adds the plan.
      ".planning/phases/99-open/99-01-DEFERRED.md":
        "Deferred 2026-08-29 by founder decision: the substrate does not exist. Owner: Phase 164.5.\n",
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

  it("an EMPTY or UNDATED/UNOWNED -DEFERRED.md does NOT exempt — a marker with no record in it is a checkbox", () => {
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

  it("`status: deferred` in the PLAN's own frontmatter also exempts it — WITH the record", () => {
    // ⚠️ R3-W02: the fixture carries a date and an owning phase because the
    // rule now demands them on BOTH routes. It was updated rather than the rule
    // being carved out around it — the bare two-word flag this used to assert
    // was measured exempting a plan with a stale claim at exit 0.
    const root = tree("deferred-frontmatter", {
      ".planning/phases/99-open/99-01-PLAN.md":
        "---\nphase: 99\nstatus: deferred\ndeferred_on: 2026-08-29\ndeferred_to: Phase 164.5\n---\n\nbody\n",
    });

    const found = findPendingPlans(root);

    expect(found.pending).toEqual([]);
    expect(found.deferred[0].marker).toBe("frontmatter status: deferred");
  });

  it("R3-W02: the frontmatter flag ALONE — no date, no owner — does not exempt", () => {
    // MEASURED at HEAD before this fix: exit 0, `deferred: 1`, and the plan's
    // stale claim was never resolved. A two-word line written by the same PR
    // that adds the plan retired the plan from the scanned set.
    const root = tree("deferred-frontmatter-flag-only", {
      ".planning/phases/99-open/99-01-PLAN.md": "---\nphase: 99\nstatus: deferred\n---\n\nbody\n",
    });

    const found = findPendingPlans(root);

    expect(found.deferred).toEqual([]);
    expect(found.pending.map((p) => p.replace(/\\/g, "/"))).toEqual([
      ".planning/phases/99-open/99-01-PLAN.md",
    ]);
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

  // ⛔ R2-W05 + R3-W02. The old rule was "non-whitespace content", which a
  // one-byte file satisfies — and both deferral routes are writable by the SAME
  // PR that adds the plan. That is a self-service switch, not a record.
  //
  // R2-W05 floored ONE route and the shipped test only ever wrote
  // `-DEFERRED.md` bodies, so the OTHER route — `status: deferred` in the
  // plan's own frontmatter — kept exempting on a two-word flag with no date and
  // no owner, MEASURED at exit 0 with a stale claim unchecked, while the
  // function's own header claimed both routes required a record.
  //
  // So the cases are now a CROSS-PRODUCT of {record body} x {route}, generated,
  // not listed per route. A rule floored on one route and not the other is
  // unrepresentable here.
  //
  // Failing towards MORE scanning is the only safe direction for a switch whose
  // purpose is to switch a gate off, so each rejected marker leaves its plan
  // PENDING and its claims checked.
  const DEFERRAL_RECORDS: Array<[string, string, boolean]> = [
    ["x", "one byte", false],
    ["Deferred because it is hard.\n", "prose with no date and no owner", false],
    ["Deferred 2026-08-29 because it is hard.\n", "a date but no owning phase", false],
    ["Deferred; owned by Phase 164.5.\n", "an owner but no date", false],
    [
      "Deferred 2026-08-29. Owner: Phase 164.5. Measurement: 69 of 262 fail.\n",
      "dated and owned",
      true,
    ],
  ];

  /** The two documented routes, as file layouts. Both must obey one rule. */
  const DEFERRAL_ROUTES: Record<string, (record: string) => Record<string, string>> = {
    "sibling -DEFERRED.md": (record) => ({
      ".planning/phases/99-fixture/99-01-PLAN.md": "Edit src/a.ts:50-60 here.\n",
      ".planning/phases/99-fixture/99-01-DEFERRED.md": record,
    }),
    "frontmatter status: deferred": (record) => ({
      ".planning/phases/99-fixture/99-01-PLAN.md":
        `---\nstatus: deferred\n---\n${record}Edit src/a.ts:50-60 here.\n`,
    }),
  };

  it("the deferral cross-product is generated over BOTH routes", () => {
    // Non-vacuity: if either table were empty the arms below would silently
    // vanish and this file would still report green.
    expect(Object.keys(DEFERRAL_ROUTES)).toHaveLength(2);
    expect(DEFERRAL_RECORDS.filter(([, , ok]) => ok)).toHaveLength(1);
    expect(DEFERRAL_RECORDS.filter(([, , ok]) => !ok).length).toBeGreaterThan(0);
  });

  for (const [route, layout] of Object.entries(DEFERRAL_ROUTES)) {
    for (const [record, label, shouldExempt] of DEFERRAL_RECORDS) {
      it(`R2-W05/R3-W02: via "${route}", a marker that is ${label} ${shouldExempt ? "exempts" : "does NOT exempt"}`, () => {
        const root = tree(`defer-${route.replace(/\W+/g, "-")}-${label.replace(/\W+/g, "-")}`, {
          "src/a.ts": linesFile(10),
          ...layout(record),
        });

        const res = spawnSync("node", [join(REPO_ROOT, VERIFIER), "--pending", "--root", root], {
          cwd: REPO_ROOT,
          encoding: "utf8",
        });
        const out = `${res.stdout}${res.stderr}`;

        if (shouldExempt) {
          expect(out, `a dated, owned marker must exempt (${route}, ${label})`).toMatch(
            /^scanned: 0 pending plan file\(s\) of 1$/m,
          );
          expect(out).toMatch(/^deferred: 1 plan file\(s\)/m);
          expect(res.status).toBe(0);
        } else {
          expect(out, `a marker that is ${label} must NOT exempt via ${route}`).toMatch(
            /^scanned: 1 pending plan file\(s\) of 1$/m,
          );
          expect(out).toMatch(/^deferred: 0 plan file\(s\)/m);
          // And the plan's claims really are still being checked — the point of
          // refusing the marker. src/a.ts is 10 lines; the claim names 50-60.
          expect(
            res.status,
            `a non-exempt plan's stale claim must still redden (${route}, ${label})`,
          ).toBe(1);
        }
      });
    }
  }

  it("R2-W05: the REAL marker in the tree satisfies the tightened rule", () => {
    // Non-vacuity for the arm above: the tightened rule must not have been
    // satisfied by making it unsatisfiable. 164.3-07-DEFERRED.md is the one
    // marker that exists, and it must still exempt.
    const res = spawnSync("node", [VERIFIER, "--pending"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const out = `${res.stdout}${res.stderr}`;
    expect(out).toMatch(/^deferred: 1 plan file\(s\) exempted by an explicit deferral marker$/m);
    expect(out).toMatch(/^ {2}deferred: .+164\.3-07-PLAN\.md {2}\[164\.3-07-DEFERRED\.md\]$/m);
    expect(res.status).toBe(0);
  });

  describe("R2-W05: ci.yml asserts the deferral COUNT, not just that a line was printed", () => {
    // ⛔ The finding: "it is printed" is not a control, because nothing
    // compared the print to anything. These arms drive the SHIPPED shell block
    // — extracted from ci.yml, not retyped — against synthesized logs, so a
    // change to ci.yml that drops the assertion reds this file.
    const CI = join(REPO_ROOT, ".github", "workflows", "ci.yml");

    /** The `run:` body of the plan-anchor-verify assertion step, dedented. */
    function assertionScript(): string {
      const lines = readFileSync(CI, "utf8").split("\n");
      const marker = lines.findIndex((l) => l.includes('if [ ! -s "$ANCHOR_LOG" ]; then'));
      expect(marker, "could not find the plan-anchor-verify assertion step in ci.yml").toBeGreaterThan(-1);
      let start = marker;
      while (start >= 0 && !/^\s*run: \|\s*$/.test(lines[start])) start -= 1;
      expect(start, "the assertion step has no `run: |` block").toBeGreaterThan(-1);
      const indent = (lines[start].match(/^\s*/) as RegExpMatchArray)[0].length + 2;
      const body: string[] = [];
      for (let i = start + 1; i < lines.length; i += 1) {
        const l = lines[i];
        if (l.trim().length === 0) {
          body.push("");
          continue;
        }
        if ((l.match(/^\s*/) as RegExpMatchArray)[0].length < indent) break;
        body.push(l.slice(indent));
      }
      const script = body.join("\n");
      // Non-vacuity: an empty or truncated extraction would "pass" every arm.
      expect(script).toContain("DEFERRED_CEILING");
      expect(script).toContain("claims_line");
      return script;
    }

    function drive(log: string): { status: number | null; out: string } {
      const dir = tree(`ci-assert-${Math.random().toString(36).slice(2)}`, {
        "assert.sh": assertionScript(),
        "anchor.log": log,
      });
      const res = spawnSync("bash", [join(dir, "assert.sh")], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, ANCHOR_LOG: join(dir, "anchor.log") },
      });
      return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
    }

    const logFor = (pending: number, total: number, deferred: string[]) =>
      [
        `scanned: ${pending} pending plan file(s) of ${total}`,
        `deferred: ${deferred.length} plan file(s) exempted by an explicit deferral marker`,
        ...deferred.map((p) => `  deferred: ${p}  [x-DEFERRED.md]`),
        "claims: 7 checked",
        "OK.",
      ].join("\n") + "\n";

    it("PASSES on the real tree's current log (1 exemption, at the pinned ceiling)", () => {
      const real = spawnSync("node", [VERIFIER, "--pending"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      const r = drive(`${real.stdout}${real.stderr}`);
      expect(r.status, r.out).toBe(0);
    });

    it("FAILS when the exempt set grows past the pinned ceiling", () => {
      const r = drive(logFor(1, 70, ["a/1-PLAN.md", "b/2-PLAN.md"]));
      expect(r.status).toBe(1);
      expect(r.out).toContain("DEFERRAL_CEILING regression");
    });

    it("FAILS when the count and its detail lines disagree — the count cannot lie", () => {
      const log =
        [
          "scanned: 1 pending plan file(s) of 70",
          "deferred: 1 plan file(s) exempted by an explicit deferral marker",
          "claims: 7 checked",
        ].join("\n") + "\n";
      const r = drive(log);
      expect(r.status).toBe(1);
      expect(r.out).toContain("printed 0 exemption detail line(s)");
    });

    it("still FAILS when the deferred line vanishes entirely", () => {
      const log =
        ["scanned: 1 pending plan file(s) of 70", "claims: 7 checked"].join("\n") + "\n";
      const r = drive(log);
      expect(r.status).toBe(1);
      expect(r.out).toContain("printed NO 'deferred: N plan file(s)");
    });

    it("does NOT fail on the honest all-executed-plus-one-deferral state", () => {
      // The reviewer's suggested arm — fail when pending==0 && deferred>0 —
      // would redden CI here, and this state is legitimate and imminent: phase
      // 164.3 is 9/10 executed with plan 07 deferred, so it arrives the moment
      // plan 10 lands a SUMMARY. A ceiling asserts the value without
      // criminalising an honest tree.
      const r = drive(logFor(0, 70, ["164.3/07-PLAN.md"]));
      expect(r.status, r.out).toBe(0);
    });
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
