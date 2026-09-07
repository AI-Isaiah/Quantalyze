/**
 * BASELINE-CONTENT-DRIFT allowlist — contract test (Phase 164.5, criterion 7).
 *
 * WHY THIS FILE EXISTS. `scripts/baseline-content-drift-check.mjs` carries its
 * known drift as a constant. A constant nobody re-derives is a claim nobody
 * compares to the thing — the defect class this whole phase exists for. So this
 * test re-derives the allowlist's SIZE and its SET OF NAMES from the script's
 * own SOURCE TEXT, with its own line-anchored regexes, deliberately NOT
 * importing the gate's parsing helpers, and fails on drift in EITHER direction:
 *
 *   - a row ADDED without updating the pin  -> the ratchet grew; a REGRESSION
 *     unless the growth was itself reviewed;
 *   - a row REMOVED without updating the pin -> real progress that must be
 *     recorded, because a ratchet whose floor is never lowered stops ratcheting.
 *
 * The two derivations are independent BY CONSTRUCTION: one is JavaScript module
 * evaluation (the imported `CONTENT_DRIFT_ALLOWLIST`), the other is a regex over
 * the same file's bytes. They are then required to AGREE, so a row that exists
 * in only one of them — a hand-edit, a merge artifact, a conditional push — is
 * a failure rather than a silence.
 *
 * ⛔ ANTI-VACUITY. Every pin below sits beside an AIM assertion that drives the
 * re-derivation over a SYNTHETIC source and requires it to compute the right
 * answer there. Without the AIMs, a regex that silently stopped matching would
 * return `[]` forever and every pin would degrade into `0 === 0`.
 *
 * This is the floor-plus-contract-test storage pattern already used here by
 * `src/__tests__/mutation-runner-floors.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTENT_DRIFT_ALLOWLIST,
  FINDABLE_STATUSES,
  FINDING_KINDS,
  checkContentDrift,
  checkRepo,
  validateAllowlist,
} from "../../scripts/baseline-content-drift-check.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE_PATH = join(REPO_ROOT, "scripts", "baseline-content-drift-check.mjs");

// ───────────────────────────────────────────────────────────────────────────
// THE PINS. ⛔ THE LIST MAY ONLY SHRINK, AND IT HAS.
//
// LINEAGE — measured 2026-09-07 on the corpus at commit 415e0a6c, against the
// 2026-08-29 PROD dump: 114 MATCH / 6 DRIFT / 2 SNAPSHOT_MISSING / 0
// SNAPSHOT_ONLY / 0 UNCOMPARABLE, i.e. EIGHT rows —
//   check_fan_in_ready, enqueue_ledger_composite_refresh,
//   enqueue_ledger_refresh_for_strategies, match_engine_cron_tick,
//   reject_sentinel_writes, retention_delete_guard,
//   strategy_analytics_drop_stale_error_provenance, sync_strategy_analytics_status.
//
// CURRENT — measured 2026-09-07 after `supabase db dump --linked` re-took
// supabase/schema/baseline.sql from PROD (119 -> 121 distinct function names):
// 119 MATCH / 3 DRIFT / 0 SNAPSHOT_MISSING / 0 SNAPSHOT_ONLY / 0 UNCOMPARABLE
// over 122 compared functions. FIVE of the eight went MATCH and were deleted.
//
// ⛔ THE THREE SURVIVORS ARE NOT A LEFTOVER — THEY ARE THE FINDING. Every one
// of the eight rows was booked with `clearedBy: "A regeneration of
// supabase/schema/baseline.sql from PROD"`. That act has now happened, and
// these three rows' `snapshotHash` values did not move by a single bit: PROD's
// bodies were never stale. PROD runs an EARLIER revision of each body than the
// migration chain renders, which is a PROD-vs-REPO divergence of the DRIFT-04
// family, tracked as DRIFT-06 in TODOS.md. A further regeneration will NEVER
// clear them, so do not lower this pin again expecting one to.
// ───────────────────────────────────────────────────────────────────────────
const PINNED_SIZE = 3;
const PINNED_NAMES = [
  "check_fan_in_ready",
  "reject_sentinel_writes",
  "retention_delete_guard",
];

/**
 * The INDEPENDENT derivation: slice the array literal out of the source and
 * read each row's fields with line-anchored regexes.
 *
 * It THROWS rather than returning `[]` when the block markers are absent. That
 * matters more than it looks: if the constant were renamed, a forgiving parser
 * would report zero rows, `expect(0).toBe(0)` would be unreachable only by
 * luck, and this whole file would go quietly vacuous. A loud throw is the only
 * honest answer to "I could not measure".
 */
function rederiveAllowlist(source: string): {
  names: string[];
  withSnapshotHashKey: number;
  withCandidateHashKey: number;
  statuses: string[];
} {
  const OPEN = "export const CONTENT_DRIFT_ALLOWLIST = [";
  const start = source.indexOf(OPEN);
  if (start === -1) {
    throw new Error(
      `CANNOT MEASURE: "${OPEN}" not found in the gate source. The constant was renamed or ` +
        "deleted; this test cannot silently report zero rows.",
    );
  }
  const end = source.indexOf("\n];", start);
  if (end === -1) {
    throw new Error("CANNOT MEASURE: the CONTENT_DRIFT_ALLOWLIST array literal is not terminated by `\\n];`.");
  }
  const block = source.slice(start + OPEN.length, end);
  const lines = block.split("\n");

  const names: string[] = [];
  const statuses: string[] = [];
  let withSnapshotHashKey = 0;
  let withCandidateHashKey = 0;
  for (const line of lines) {
    const fn = /^\s{4}function:\s*"([A-Za-z0-9_]+)",\s*$/.exec(line);
    if (fn) names.push(fn[1]);
    const st = /^\s{4}status:\s*"([A-Z_]+)",\s*$/.exec(line);
    if (st) statuses.push(st[1]);
    if (/^\s{4}snapshotHash:\s*/.test(line)) withSnapshotHashKey++;
    if (/^\s{4}candidateHash:\s*/.test(line)) withCandidateHashKey++;
  }
  return { names, statuses, withSnapshotHashKey, withCandidateHashKey };
}

/**
 * A SYNTHETIC gate source with a two-row allowlist. Every AIM below runs the
 * re-derivation over this, so "the regex still computes" is proven rather than
 * assumed. It is deliberately NOT a copy of the real block: the two rows have
 * names that appear nowhere in the corpus, so a parser accidentally reading the
 * real file instead would be caught here.
 */
const SYNTHETIC_SOURCE = [
  "// preamble that must be ignored",
  'const decoy = { function: "not_a_row" };',
  "export const CONTENT_DRIFT_ALLOWLIST = [",
  "  {",
  '    function: "aim_alpha",',
  "    nargs: 0,",
  '    status: "DRIFT",',
  '    snapshotHash: "aa",',
  '    candidateHash: "bb",',
  "  },",
  "  {",
  '    function: "aim_beta",',
  "    nargs: 1,",
  '    status: "SNAPSHOT_MISSING",',
  "    snapshotHash: null,",
  '    candidateHash: "cc",',
  "  },",
  "];",
  'const trailing = { function: "also_not_a_row" };',
].join("\n");

const gateSource = () => readFileSync(GATE_PATH, "utf8");

describe("allowlist re-derivation (the instrument itself)", () => {
  it("AIM: computes names, statuses and hash-key counts from a SYNTHETIC source", () => {
    const r = rederiveAllowlist(SYNTHETIC_SOURCE);
    expect(r.names).toEqual(["aim_alpha", "aim_beta"]);
    expect(r.statuses).toEqual(["DRIFT", "SNAPSHOT_MISSING"]);
    expect(r.withSnapshotHashKey).toBe(2);
    expect(r.withCandidateHashKey).toBe(2);
  });

  it("AIM: ignores `function:` outside the array literal — the decoys are not rows", () => {
    // Both decoys sit in SYNTHETIC_SOURCE, one before the block and one after.
    // If either leaked in, the assertion above would already have failed; this
    // states the property directly so the reason is legible.
    expect(SYNTHETIC_SOURCE).toContain('function: "not_a_row"');
    expect(SYNTHETIC_SOURCE).toContain('function: "also_not_a_row"');
    expect(rederiveAllowlist(SYNTHETIC_SOURCE).names).not.toContain("not_a_row");
    expect(rederiveAllowlist(SYNTHETIC_SOURCE).names).not.toContain("also_not_a_row");
  });

  it("AIM: THROWS when the constant is absent rather than reporting zero rows", () => {
    expect(() => rederiveAllowlist("export const SOMETHING_ELSE = [];\n")).toThrow(/CANNOT MEASURE/);
    expect(() => rederiveAllowlist("export const CONTENT_DRIFT_ALLOWLIST = [\n  {}\n")).toThrow(
      /CANNOT MEASURE/,
    );
  });
});

describe("CONTENT_DRIFT_ALLOWLIST ratchet", () => {
  it("has exactly the pinned number of rows — drift in EITHER direction fails", () => {
    const { names } = rederiveAllowlist(gateSource());
    expect(
      names.length,
      names.length > PINNED_SIZE
        ? `RATCHET GREW: the allowlist now has ${names.length} rows, above the pinned ${PINNED_SIZE}. ` +
          "A new row is a REGRESSION unless it was reviewed — a red gate is never cleared by adding " +
          "a row. If the growth is legitimate, raise PINNED_SIZE and PINNED_NAMES in the same commit " +
          "as the row, with the reason."
        : `RATCHET STALE: the allowlist now has ${names.length} rows, below the pinned ${PINNED_SIZE}. ` +
          "That is PROGRESS — a drift was repaired — but a floor that is never lowered stops " +
          "ratcheting. Lower PINNED_SIZE and PINNED_NAMES to match.",
    ).toBe(PINNED_SIZE);
  });

  it("carries exactly the pinned SET OF NAMES", () => {
    const { names } = rederiveAllowlist(gateSource());
    expect([...names].sort()).toEqual([...PINNED_NAMES].sort());
  });

  it("the two INDEPENDENT derivations agree — module evaluation vs regex over bytes", () => {
    // One derivation is `import`; the other is a regex over the same file. A row
    // visible to only one of them is a hand-edit or a merge artifact.
    const fromText = rederiveAllowlist(gateSource()).names.sort();
    const fromModule = CONTENT_DRIFT_ALLOWLIST.map((r: { function: string }) => r.function).sort();
    expect(fromText).toEqual(fromModule);
  });

  it("every row spells BOTH hash fields — a name-only row is not representable", () => {
    const r = rederiveAllowlist(gateSource());
    expect(r.withSnapshotHashKey).toBe(PINNED_SIZE);
    expect(r.withCandidateHashKey).toBe(PINNED_SIZE);
  });

  it("every row's status is one the gate treats as findable", () => {
    const r = rederiveAllowlist(gateSource());
    expect(r.statuses).toHaveLength(PINNED_SIZE);
    for (const s of r.statuses) expect(FINDABLE_STATUSES).toContain(s);
    // MATCH and UNCOMPARABLE must never be allowlistable: the first would pin a
    // non-event, the second would turn "not measured" into a pass.
    expect(FINDABLE_STATUSES).not.toContain("MATCH");
    expect(FINDABLE_STATUSES).not.toContain("UNCOMPARABLE");
  });

  it("every shipped row passes the gate's own startup validation", () => {
    expect(validateAllowlist(CONTENT_DRIFT_ALLOWLIST)).toEqual([]);
  });

  it("AIM: that validation is not vacuous — a name-only row IS refused", () => {
    const bad = validateAllowlist([{ function: "aim_alpha" }]);
    expect(bad).toHaveLength(1);
    expect(bad[0].kind).toBe("allowlist-malformed");
  });
});

describe("finding registry", () => {
  it("pins the finding-kind id set EXACTLY", () => {
    expect(FINDING_KINDS.map((k: { id: string }) => k.id)).toEqual([
      "content-drift",
      "allowlist-hash-moved",
      "allowlist-stale",
      "allowlist-malformed",
    ]);
  });

  it("AIM: the imported gate is the real comparator, not a stub — a synthetic drift fires", () => {
    const body = (n: string) =>
      `CREATE OR REPLACE FUNCTION public.aim_alpha()\nRETURNS void\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  PERFORM ${n};\nEND;\n$$;\n`;
    const res = checkContentDrift({
      snapshotSql: body("1"),
      chainSql: body("2"),
      allowlist: [],
    });
    expect(res.ok).toBe(false);
    expect(res.findings.map((f: { kind: string }) => f.kind)).toEqual(["content-drift"]);
    expect(res.findings[0].message).toContain("aim_alpha");
    // The output contract: hashes and counts, never body text. This repo is PUBLIC.
    expect(res.findings[0].message).not.toContain("PERFORM");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// [CR-01] THE ZERO-COMPARISON FLOOR
//
// Code review 2026-09-08 found `checkRepo` guarding that both paths EXIST and
// that the chain directory is non-empty, while NOTHING guarded the number of
// functions actually compared. Both sides run through ONE parser, so a
// definition it stops recognising vanishes from both at once and they agree by
// construction — the SP-C05 shape `prod-body-drift-check.sh` defends against
// with a zero-name refusal.
//
// MEASURED before the fix, on a 120-file chain the parser recognised nothing
// in, with the allowlist at the zero rows its own header says it may shrink to:
//   compared 0, findings 0, ok true, EXIT 0.
// The three live allowlist rows were the ONLY thing making that red, via their
// staleness findings — a mask that is scheduled to be removed.
//
// ⛔ Both arms are needed. The first proves the floor FIRES; the second proves
// it is not simply always-on, which is the failure mode that would make the
// first arm unfalsifiable.
// ───────────────────────────────────────────────────────────────────────────
describe("[CR-01] zero comparisons is a MEASURE_FAIL, never a clean run", () => {
  /** A chain dir of real .sql FILES whose contents the extractor cannot parse. */
  function corpus(sqlByName: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "bcd-floor-"));
    const chainDir = join(dir, "functions");
    mkdirSync(chainDir);
    for (const [name, sql] of Object.entries(sqlByName)) {
      writeFileSync(join(chainDir, `${name}.sql`), sql);
    }
    const snapshotFile = join(dir, "baseline.sql");
    return { dir, chainDir, snapshotFile };
  }

  it("FIRES: 120 chain files the parser recognises nothing in -> ok false", () => {
    const unparseable: Record<string, string> = {};
    for (let i = 0; i < 120; i += 1) {
      unparseable[`f${i}`] = "-- a comment only; no CREATE FUNCTION head\n";
    }
    const { dir, chainDir, snapshotFile } = corpus(unparseable);
    try {
      writeFileSync(snapshotFile, "");
      const res = checkRepo({ snapshotFile, chainDir, allowlist: [] });
      // The pre-fix reading was exactly this, minus the refusal.
      expect(res.compared).toBe(0);
      expect(res.findings).toEqual([]);
      expect(res.chainFiles).toBe(120);
      // The floor itself.
      expect(res.ok).toBe(false);
      expect(res.measureFails).toHaveLength(1);
      expect(res.measureFails[0].reason).toContain("ZERO functions were compared");
      // It must report the file count it DID see, so "no files" and "no parses"
      // are distinguishable in a CI log.
      expect(res.measureFails[0].reason).toContain("chain files 120");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("AIM: does NOT fire when the same harness parses one real definition", () => {
    const real =
      "CREATE OR REPLACE FUNCTION public.aim_floor_probe()\n" +
      "RETURNS void\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  PERFORM 1;\nEND;\n$$;\n";
    const { dir, chainDir, snapshotFile } = corpus({ aim_floor_probe: real });
    try {
      writeFileSync(snapshotFile, real);
      const res = checkRepo({ snapshotFile, chainDir, allowlist: [] });
      expect(res.compared).toBeGreaterThan(0);
      expect(res.measureFails).toEqual([]);
      expect(res.ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
