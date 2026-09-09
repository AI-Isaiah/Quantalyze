/**
 * Reference-data allowlist — CONTRACT test (Phase 164.8.1 Plan 01, decision L-02).
 *
 * WHY THIS FILE EXISTS. `scripts/restore-test-refdata-allowlist.txt` decides
 * which DML reaches SHARED TEST during a baseline restore. A line added to it
 * is a line of SQL replayed into a database that carries other people's CI, so
 * the two failure modes it must not have are (a) the human judgement rots — an
 * entry stops describing the migration it pins — and (b) the CLASSIFIER rots,
 * leaving every count assertion trivially satisfied because nothing is
 * classified any more. Two devices, one per failure mode, both taken from the
 * repo's own precedents:
 *
 *   * the AIM block (`src/__tests__/vac08-ledger-dispositions.test.ts:248+`)
 *     drives the parser and the classifier over SYNTHETIC corpora whose answers
 *     are known and are NOT the empty set, and it is declared BEFORE anything
 *     reads the live file;
 *   * the count agreement (`scripts/lint-app-guc.mjs:188-190`) re-measures every
 *     pinned count against the real migration bytes and fails in BOTH
 *     directions, with a calibration proving ±1 flips it.
 *
 * ⛔ UNLIKE the VAC-08 test, this one IMPORTS the extractor's parser and
 * classifier rather than re-deriving them. That is deliberate and it is the
 * plan's instruction: the artifact under test here is the ALLOWLIST, and the
 * question is whether its 22 human judgements still describe the corpus. A
 * second, divergent parser would answer a different question — "do two parsers
 * agree" — and would let the allowlist rot behind a parser that the RESTORE
 * does not use. The classifier's own non-vacuity is carried by the AIM block
 * below and by `node scripts/extract-reference-inserts.mjs --self-test`, which
 * drives 16 refusal kinds red+green and is wired into two workflows.
 *
 * ── WHAT CAN AND CANNOT FAIL TODAY ─────────────────────────────────────────
 *   LIVE — every assertion in this file can fail against the repo as it stands:
 *     the AIM block (non-empty synthetic answers); ENTRY_COUNT in both
 *     directions; the per-entry count agreement (calibrated ±1 in-memory); the
 *     basename/schema existence checks; the two masthead-sentence assertions;
 *     the four workflow-wiring assertions (each calibrated by mutating a copy
 *     of the workflow text).
 *   DORMANT — none. This file pins no empty set.
 *   INERT — none.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  matchTable,
  parseAllowlist,
  prepareFile,
  schemaAllowed,
} from "../../scripts/extract-reference-inserts.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ALLOWLIST_PATH = join(REPO_ROOT, "scripts", "restore-test-refdata-allowlist.txt");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const VAC08_PATH = join(REPO_ROOT, "scripts", "vac08-ledger-baseline.txt");
const CI_WF = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const RESTORE_WF = join(REPO_ROOT, ".github", "workflows", "test-restore-from-baseline.yml");

/**
 * PINNED ENTRY COUNT.
 *
 * ⛔ BOTH DIRECTIONS ARE FAILURES, and they are different failures:
 *   GREW  — a reference statement was authored. Cite its consumer in the entry
 *           and raise this number in the same commit.
 *   SHRANK — a consumer went away. Say WHICH consumer in the commit message;
 *           an entry is never deleted to make something go green, and a missing
 *           reference row is a NAMED failure of the restore's own gate, never a
 *           hand-run INSERT against shared TEST.
 *
 * ⛔ Do not restate the file's other cardinalities here — and that injunction
 * used to be followed by a restatement, which is why this paragraph now carries
 * none. `node scripts/extract-reference-inserts.mjs --audit` prints entries,
 * files, tables and statements; the allowlist's own masthead carries them as a
 * dated reading. This test re-derives only the ones it asserts.
 * (The deleted sentence explained the entries-over-files gap with "one migration
 * carries two entries", which accounts for ONE of the three surplus entries:
 * 20260515095804 carries THREE. Wrong arithmetic in a comment that forbids
 * arithmetic in comments.)
 */
export const ENTRY_COUNT = 22;

const SELF_TEST_CMD = "node scripts/extract-reference-inserts.mjs --self-test";
const AUDIT_CMD = "node scripts/extract-reference-inserts.mjs --audit";

interface Entry {
  lineNo: number;
  file: string;
  qualified: string;
  schema: string;
  table: string;
  count: number;
  consumer: string;
}
interface MatchResult {
  ok: { line: number; sql: string }[];
  body: { line: number }[];
  rejected: { line: number; reason: string }[];
}

/** Classify one file against one table, failing loud rather than returning empty. */
function measure(src: string, qualified: string, label: string): MatchResult {
  const prepared = prepareFile(src);
  if ("error" in prepared) {
    throw new Error(`${label} could not be lexed: ${prepared.error} (line ${prepared.line})`);
  }
  return matchTable(src, prepared, qualified) as MatchResult;
}

/**
 * Assert a mutation of the source text FALSIFIES the predicate. Without this an
 * assertion over a file can pass because the file is shaped in a way the
 * scanner cannot see, rather than because the file is correct.
 */
function calibrate(label: string, text: string, mutate: (s: string) => string, holds: (s: string) => boolean) {
  const mutated = mutate(text);
  expect(mutated, `${label}: the calibration did not change the text — re-anchor it`).not.toBe(text);
  expect(holds(mutated), `${label}: the assertion still holds after the calibration, so it cannot fail`).toBe(false);
}

/** The index of a LIVE (uncommented) `run:` line carrying exactly `cmd`, or -1. */
function liveRunIndex(text: string, cmd: string): number {
  return text
    .split("\n")
    .findIndex((l) => /^[ \t]*run:[ \t]/.test(l) && l.trim() === `run: ${cmd}`);
}

// ───────────────────────────────────────────────────────────────────────────
// AIM, DECLARED FIRST. Synthetic corpora whose answers are known and NOT the
// empty set. Every live-file assertion below stands on these two functions; if
// either quietly stopped classifying, the live block would keep agreeing with
// itself and this block is what reddens instead.
// ───────────────────────────────────────────────────────────────────────────

const AIM_ALLOWLIST = [
  "# a header comment, not an entry",
  "",
  "20260101000000_fx_a.sql\tpublic.fx_ref\t1\t# consumer: fx_child.ref_id FK",
  "20260102000000_fx_b.sql\tpublic.fx_ref",
  "20260103000000_fx_c.sql\tpublic.fx_ref\t2\t# consumer: the AIM block",
].join("\n");

const AIM_SQL = [
  "-- 1) a top-level literal seed: REPLAYABLE",
  "INSERT INTO fx_ref (id, label) VALUES (1, 'top') ON CONFLICT (id) DO NOTHING;",
  "-- 2) a fixture inside a DO body, NOT the body's first statement. maskSql()",
  "--    blanks the delimiters and lexes the body as code, so statements() splits",
  "--    here at the inner `;` and this INSERT surfaces as its own span.",
  "DO $$",
  "BEGIN",
  "  RAISE NOTICE 'self-verify probe';",
  "  INSERT INTO fx_ref (id, label) VALUES (2, 'body fixture');",
  "END",
  "$$;",
  "-- 3) a backfill of existing data: on an empty table it inserts nothing.",
  "INSERT INTO fx_ref (id, label) SELECT id, label FROM fx_source;",
].join("\n");

describe("AIM — the parser and the classifier actually classify", () => {
  it("the parser separates 2 well-formed entries from 1 NAMED malformed line", () => {
    const parsed = parseAllowlist(AIM_ALLOWLIST) as {
      entries: Entry[];
      malformed: { lineNo: number; reason: string }[];
    };
    expect(parsed.entries.map((e) => e.file)).toEqual([
      "20260101000000_fx_a.sql",
      "20260103000000_fx_c.sql",
    ]);
    expect(parsed.entries.map((e) => e.count)).toEqual([1, 2]);
    expect(parsed.malformed).toHaveLength(1);
    // NAMED by line number, never silently skipped — line 4 of the fixture.
    expect(parsed.malformed[0].lineNo).toBe(4);
    expect(parsed.malformed[0].reason).toMatch(/TAB-separated fields/);
    // Comments and blanks are not entries, and are not malformed either.
    expect(parsed.entries).toHaveLength(2);
  });

  it("the classifier separates top-level / DO-body / non-literal, none of them empty", () => {
    const m = measure(AIM_SQL, "public.fx_ref", "AIM_SQL");
    expect(m.ok, "a top-level literal seed must be replayable").toHaveLength(1);
    expect(m.ok[0].line).toBe(2);
    expect(m.ok[0].sql).toBe(
      "INSERT INTO fx_ref (id, label) VALUES (1, 'top') ON CONFLICT (id) DO NOTHING;",
    );
    // ⛔ RESEARCH A4 ("maskSql does not split DO bodies at inner `;`") is FALSE.
    // This is the assertion that proves the extractor does not rely on it: the
    // body INSERT is excluded by the dollar-depth scan, not by luck.
    expect(m.body, "a DO-body fixture INSERT must be excluded by C1").toHaveLength(1);
    expect(m.body[0].line).toBe(9);
    expect(m.rejected, "an INSERT ... SELECT must be refused, not replayed").toHaveLength(1);
    expect(m.rejected[0].reason).toMatch(/SELECT\/FROM/);
  });

  it("the classifier is TABLE-specific — it does not match a different table", () => {
    const m = measure(AIM_SQL, "public.fx_other", "AIM_SQL");
    expect(m.ok).toHaveLength(0);
    expect(m.body).toHaveLength(0);
    expect(m.rejected).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The live allowlist.
// ───────────────────────────────────────────────────────────────────────────

describe("the live allowlist still describes the migration corpus", () => {
  // node:fs, never a shell grep: grep is silently NUL-blind in this repo.
  const text = readFileSync(ALLOWLIST_PATH, "utf8");
  const parsed = parseAllowlist(text) as {
    entries: Entry[];
    malformed: { lineNo: number; reason: string }[];
  };

  it("carries no malformed line", () => {
    expect(
      parsed.malformed,
      `scripts/restore-test-refdata-allowlist.txt has malformed line(s): ${parsed.malformed
        .map((m) => `:${m.lineNo} ${m.reason}`)
        .join(" | ")}`,
    ).toEqual([]);
  });

  it(`holds exactly ${ENTRY_COUNT} entries`, () => {
    expect(
      parsed.entries.length,
      parsed.entries.length > ENTRY_COUNT
        ? "GREW: a reference statement was added — cite its consumer in the entry and raise ENTRY_COUNT in the same commit"
        : "SHRANK: a consumer went away — say which one in the commit message; an entry is never deleted to make something go green",
    ).toBe(ENTRY_COUNT);
  });

  it("every entry names a migration that exists and a schema the restore needs replayed", () => {
    for (const e of parsed.entries) {
      expect(
        existsSync(join(MIGRATIONS_DIR, e.file)),
        `:${e.lineNo} names "${e.file}", which is not under supabase/migrations/`,
      ).toBe(true);
      expect(
        schemaAllowed(e.qualified),
        `:${e.lineNo} targets ${e.qualified}; the restore drops ONLY public, so anything else survives and needs no replay (C3). The single exception is auth.users in the teaser file`,
      ).toBe(true);
      expect(["public", "auth"]).toContain(e.schema);
      expect(e.consumer, `:${e.lineNo} cites no consumer (C4)`).toMatch(/#\s*\S/);
    }
  });

  it("every pinned count agrees with the real migration bytes, in BOTH directions", () => {
    const disagreements: string[] = [];
    for (const e of parsed.entries) {
      const src = readFileSync(join(MIGRATIONS_DIR, e.file), "utf8");
      const m = measure(src, e.qualified, e.file);
      if (m.rejected.length > 0) {
        disagreements.push(
          `:${e.lineNo} ${e.file} [${e.qualified}] carries ${m.rejected.length} top-level statement(s) this allowlist claims are reference data but the classifier refuses: ${m.rejected[0].reason}`,
        );
        continue;
      }
      if (m.ok.length !== e.count) {
        disagreements.push(
          `:${e.lineNo} ${e.file} [${e.qualified}] pins ${e.count} but ${m.ok.length} were measured`,
        );
      }
    }
    expect(
      disagreements,
      `a pinned count moves ONLY when an APPLIED migration is edited — understand the edit, do not re-pin the number:\n  ${disagreements.join("\n  ")}`,
    ).toEqual([]);
  });

  it("CALIBRATION — a count off by one in EITHER direction is caught", () => {
    const agrees = (entries: Entry[]) =>
      entries.every((e) => {
        const src = readFileSync(join(MIGRATIONS_DIR, e.file), "utf8");
        return measure(src, e.qualified, e.file).ok.length === e.count;
      });
    expect(agrees(parsed.entries)).toBe(true);
    for (const delta of [1, -1]) {
      const mutated = parsed.entries.map((e, i) => (i === 0 ? { ...e, count: e.count + delta } : e));
      expect(
        agrees(mutated),
        `a pinned count ${delta > 0 ? "raised" : "lowered"} by one still agreed — the re-measurement is not measuring`,
      ).toBe(false);
    }
  });

  it("states the same ledger-presence fact as the VAC-08 masthead, word for word", () => {
    // Both files strip their own `#` comment prefixes and collapse whitespace,
    // so the comparison is about the SENTENCE, not about indentation.
    const flatten = (s: string) =>
      s
        .split("\n")
        .map((l) => l.replace(/^[ \t]*#[ \t]?/, ""))
        .join(" ")
        .replace(/\s+/g, " ");
    const SENTENCE =
      "LEDGER PRESENCE IS NOT EFFECT PRESENCE, and for DML-bearing migrations it is FALSE BY CONSTRUCTION.";
    const here = flatten(text);
    const vac08 = flatten(readFileSync(VAC08_PATH, "utf8"));
    expect(vac08, "the VAC-08 masthead no longer carries the sentence — re-anchor both").toContain(
      SENTENCE,
    );
    expect(
      here,
      "the allowlist masthead must carry the VAC-08 sentence VERBATIM; the two describe one fact and CLAUDE.md requires them to agree",
    ).toContain(SENTENCE);
    calibrate(
      "the ledger-presence sentence is read, not assumed",
      text,
      (s) => s.replace("LEDGER PRESENCE IS NOT EFFECT PRESENCE", "ledger presence is fine"),
      (s) => flatten(s).includes(SENTENCE),
    );
  });

  it("states the DIRECTION rule — a list with no stated direction stops controlling", () => {
    expect(text).toMatch(/THIS FILE GROWS when a new reference statement is AUTHORED/);
    expect(text).toMatch(/SHRINKS only\s*#?\s*when the CONSUMER that reads the row is gone/);
    expect(text, "the shared-TEST rule: a failure is NAMED, never hand-seeded").toMatch(
      /DO NOT HAND-SEED SHARED TEST/,
    );
    calibrate(
      "the direction rule is read, not assumed",
      text,
      (s) => s.replace("THIS FILE GROWS when a new reference statement is AUTHORED", "grow it freely"),
      (s) => /THIS FILE GROWS when a new reference statement is AUTHORED/.test(s),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The wiring. An audit nobody runs is an allowlist with no ratchet.
// ───────────────────────────────────────────────────────────────────────────

describe("the audit is wired into BOTH workflows, self-test FIRST", () => {
  for (const [label, path] of [
    ["ci.yml (sql-gate-lint)", CI_WF],
    ["test-restore-from-baseline.yml", RESTORE_WF],
  ] as const) {
    it(`${label} runs the self-test and then the audit, each exactly once`, () => {
      const text = readFileSync(path, "utf8");
      const selfAt = liveRunIndex(text, SELF_TEST_CMD);
      const auditAt = liveRunIndex(text, AUDIT_CMD);
      expect(selfAt, `${label}: \`${SELF_TEST_CMD}\` is not a LIVE run line — a commented-out command is not a command`).toBeGreaterThan(-1);
      expect(auditAt, `${label}: \`${AUDIT_CMD}\` is not a LIVE run line`).toBeGreaterThan(-1);
      expect(
        selfAt,
        `${label}: the self-test must run BEFORE the corpus audit (the sql-gate-lint idiom — a gate whose red path was not observed in THIS run is not evidence about this run)`,
      ).toBeLessThan(auditAt);
      // Exactly once: a second copy would make the ordering claim ambiguous.
      const count = (cmd: string) =>
        text.split("\n").filter((l) => l.trim() === `run: ${cmd}`).length;
      expect(count(SELF_TEST_CMD)).toBe(1);
      expect(count(AUDIT_CMD)).toBe(1);

      calibrate(
        `${label}: the audit is EXECUTED, not mentioned`,
        text,
        (s) => s.replace(`        run: ${AUDIT_CMD}`, `        # run: ${AUDIT_CMD}`),
        (s) => liveRunIndex(s, AUDIT_CMD) > -1,
      );
      calibrate(
        `${label}: self-test before audit`,
        text,
        (s) =>
          s
            .replace(`run: ${SELF_TEST_CMD}`, "run: __SWAP__")
            .replace(`run: ${AUDIT_CMD}`, `run: ${SELF_TEST_CMD}`)
            .replace("run: __SWAP__", `run: ${AUDIT_CMD}`),
        (s) => liveRunIndex(s, SELF_TEST_CMD) < liveRunIndex(s, AUDIT_CMD),
      );
    });
  }
});
