/**
 * Phase 164.6.6.3.4 (STATUSBRIDGE), D-05: the kind classification drift gate.
 *
 * WHY THIS FILE EXISTS. `sync_strategy_analytics_status` decides whether a
 * strategy's analytics status reads `failed`. D-05 spelled that rule as a
 * closed NEGATIVE list: four side kinds that produce no analytics
 * (`sync_funding`, `poll_positions`, `reconcile_strategy`,
 * `compute_intro_snapshot`) never enter the live-failure set, and EVERY other
 * kind still counts ("unknown resolves loud"). A negative list is only safe
 * while somebody decides, for each new strategy-carrying kind, which side of the
 * line it is on. Nothing forced that decision: a new kind added to
 * `compute_jobs_kind_target_coherence` would silently join the failure set (the
 * safe direction, but undecided) and a kind quietly added to the side list
 * would silently stop pinning `failed` (the unsafe one).
 *
 * This test is the forcing function. It compares three sources that have no
 * compiler between them:
 *
 *   1. the NEWEST bridge definition's `kind NOT IN (...)` side list (the SQL);
 *   2. the NEWEST `compute_jobs_kind_target_coherence` CHECK, restricted to the
 *      kinds that carry a strategy (`strategy_id IS NOT NULL`), i.e. every kind
 *      that can ever reach the bridge;
 *   3. `FACTSHEET_CHAIN_KINDS` (the TypeScript chain list), plus
 *      `stitch_composite`, which the bridge counts on its own protected branch.
 *
 * and fails when a strategy-carrying kind is in none of the three, or when a
 * kind is classified as both a side kind and a chain kind.
 *
 * WHY TYPESCRIPT. `FACTSHEET_CHAIN_KINDS` is a TypeScript constant. Importing it
 * here is exact; regex-parsing it out of a Python test would be a second,
 * lossy reader of the same list. The scan rule for "the newest bridge
 * definition" mirrors `analytics-service/tests/test_ledger_refresh_kind_scope_drift.py`
 * (line-start CREATE, dollar-quoted body, comments stripped) and is
 * cross-checked against the function snapshot's `-- source migration:` line,
 * which `scripts/dump-sql-functions.ts` derives independently.
 *
 * VACUITY. Every extraction below asserts it found something before it
 * compares. An extractor that silently matches nothing would make every
 * assertion pass against an empty set; each one fails loud instead.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FACTSHEET_CHAIN_KINDS } from "@/lib/compute-state";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS = join(REPO_ROOT, "supabase", "migrations");
const BRIDGE_SNAPSHOT = join(
  REPO_ROOT,
  "supabase",
  "schema",
  "functions",
  "sync_strategy_analytics_status.sql",
);

/** A STATEMENT, not a mention: anchored at line start (header prose never counts). */
const BRIDGE_CREATE_RE =
  /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"public"\.|public\.)?"?sync_strategy_analytics_status"?\s*\(/gim;
/** The dollar-quoted body after the CREATE: `AS $$ ... $$` or `AS $tag$ ... $tag$`. */
const DOLLAR_BODY_RE = /\bAS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/i;
const SQL_LINE_COMMENT_RE = /--[^\n]*/g;
const SNAPSHOT_SOURCE_RE = /^-- source migration: (\S+)$/m;
const SIDE_LIST_RE = /\bkind\s+NOT\s+IN\s*\(([^)]*)\)/gi;
const LITERAL_RE = /'([a-z_]+)'/g;
const COHERENCE_ADD_RE =
  /ALTER\s+TABLE\s+(?:public\.)?compute_jobs\s+ADD\s+CONSTRAINT\s+compute_jobs_kind_target_coherence\s+CHECK\s*\(/i;

const HUMAN =
  "A human must classify it: either add it to the side list in a NEW bridge migration " +
  "(a kind that produces no analytics, D-05), or to FACTSHEET_CHAIN_KINDS in " +
  "src/lib/compute-state.ts (a kind that feeds the factsheet).";

function migrationFiles(): string[] {
  // Top-level *.sql only: `down/` holds manual rollbacks that are not applied.
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  expect(files.length, `no migrations found under ${MIGRATIONS}`).toBeGreaterThan(0);
  return files;
}

function stripComments(sql: string): string {
  return sql.replace(SQL_LINE_COMMENT_RE, "");
}

function literals(list: string): string[] {
  return [...list.matchAll(LITERAL_RE)].map((m) => m[1]);
}

/** The newest migration that CREATEs the bridge, and its comment-stripped body. */
function newestBridgeDefinition(): { file: string; body: string } {
  for (const file of [...migrationFiles()].reverse()) {
    const text = readFileSync(join(MIGRATIONS, file), "utf8");
    const creates = [...text.matchAll(BRIDGE_CREATE_RE)];
    if (creates.length === 0) continue;
    const last = creates[creates.length - 1];
    const rest = text.slice((last.index ?? 0) + last[0].length);
    const m = DOLLAR_BODY_RE.exec(rest);
    expect(
      m,
      `${file} CREATEs sync_strategy_analytics_status but no dollar-quoted body follows it. ` +
        "The body extraction has drifted from the file, so this gate would compare nothing.",
    ).not.toBeNull();
    const body = stripComments(m![2]);
    expect(body.trim().length, `the bridge body in ${file} parsed as empty`).toBeGreaterThan(0);
    return { file, body };
  }
  throw new Error(
    "no migration CREATEs sync_strategy_analytics_status at line start. " +
      "The scan has drifted from the migrations, so this gate would compare nothing.",
  );
}

/** The side-kind literals of the ONE `kind NOT IN (...)` list in a bridge body. */
function sideKinds(body: string): string[] {
  const lists = [...body.matchAll(SIDE_LIST_RE)];
  expect(
    lists.length,
    `expected exactly ONE kind NOT IN (...) list in the newest bridge body, found ${lists.length}`,
  ).toBe(1);
  const kinds = literals(lists[0][1]);
  // Non-empty only, never "exactly four": a side kind REMOVED from the list must
  // fail the classification test below naming the kind, not a bare count here.
  expect(kinds.length, "the side list parsed to no kinds; the extraction has drifted").toBeGreaterThan(0);
  expect(new Set(kinds).size, "the side list repeats a kind").toBe(kinds.length);
  return kinds;
}

/** The kinds the newest coherence CHECK admits with `strategy_id IS NOT NULL`. */
function strategyCarryingKinds(): { file: string; kinds: string[] } {
  for (const file of [...migrationFiles()].reverse()) {
    const code = stripComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    const add = COHERENCE_ADD_RE.exec(code);
    if (!add) continue;
    // The CHECK runs from its opening paren to the statement's closing `);`.
    const afterOpen = code.slice(add.index + add[0].length);
    const end = afterOpen.search(/\)\s*;/);
    expect(end, `${file}: the coherence CHECK has no closing \`);\``).toBeGreaterThan(0);
    const check = afterOpen.slice(0, end);
    // One arm per `OR ((kind = ...) AND ...)`; the first arm has no leading OR.
    const arms = check.split(/\bOR\s+(?=\(\(\s*kind)/i);
    expect(arms.length, `${file}: the coherence CHECK parsed to a single arm`).toBeGreaterThan(1);
    const kinds = new Set<string>();
    for (const arm of arms) {
      if (!/\bstrategy_id\s+IS\s+NOT\s+NULL\b/i.test(arm)) continue;
      const head = /\(\(\s*kind\s*=\s*(?:ANY\s*\(\s*ARRAY\s*\[([^\]]*)\]\s*\)|'([a-z_]+)')/i.exec(arm);
      expect(head, `${file}: a strategy-carrying arm has an unreadable kind head: ${arm.slice(0, 80)}`).not.toBeNull();
      for (const k of head![1] !== undefined ? literals(head![1]) : [head![2]]) kinds.add(k);
    }
    expect(
      kinds.size,
      `${file}: the coherence CHECK parsed to ${kinds.size} strategy-carrying kinds; ` +
        "ten are known at the time of writing, so the extraction has drifted",
    ).toBeGreaterThanOrEqual(10);
    return { file, kinds: [...kinds].sort() };
  }
  throw new Error(
    "no migration adds compute_jobs_kind_target_coherence outside a comment. " +
      "The scan has drifted from the migrations, so this gate would compare nothing.",
  );
}

describe("STATUSBRIDGE D-05: every strategy-carrying job kind is classified by a human", () => {
  it("the coherence set equals side kinds + FACTSHEET_CHAIN_KINDS + stitch_composite", () => {
    const { body } = newestBridgeDefinition();
    const side = sideKinds(body);
    const { file, kinds } = strategyCarryingKinds();
    const chain = [...FACTSHEET_CHAIN_KINDS] as string[];
    expect(chain.length, "FACTSHEET_CHAIN_KINDS is empty").toBeGreaterThan(0);

    const classified = new Set<string>([...side, ...chain, "stitch_composite"]);
    const unclassified = kinds.filter((k) => !classified.has(k));
    expect(
      unclassified,
      `${file} admits strategy-carrying kind(s) ${JSON.stringify(unclassified)} that are in neither ` +
        `the bridge's side list, FACTSHEET_CHAIN_KINDS, nor stitch_composite. ${HUMAN}`,
    ).toEqual([]);

    const phantom = [...classified].filter((k) => !kinds.includes(k));
    expect(
      phantom,
      `kind(s) ${JSON.stringify(phantom)} are classified (side list / chain list) but the newest ` +
        `compute_jobs_kind_target_coherence CHECK in ${file} no longer admits them for a strategy. ` +
        "A retired kind must leave the list it sits in, in the same change.",
    ).toEqual([]);
  });

  it("a kind is never both a side kind and a factsheet chain kind", () => {
    const side = sideKinds(newestBridgeDefinition().body);
    const chain = [...FACTSHEET_CHAIN_KINDS] as string[];
    expect(chain.length, "FACTSHEET_CHAIN_KINDS is empty").toBeGreaterThan(0);
    const both = side.filter((k) => chain.includes(k));
    expect(
      both,
      `kind(s) ${JSON.stringify(both)} sit in BOTH the bridge's side list (never pins failed) and ` +
        "FACTSHEET_CHAIN_KINDS (feeds the factsheet and counts toward failed). Those two claims " +
        `contradict each other. ${HUMAN}`,
    ).toEqual([]);
  });

  it("the newest bridge definition is the one the function snapshot names", () => {
    expect(existsSync(BRIDGE_SNAPSHOT), `${BRIDGE_SNAPSHOT} does not exist`).toBe(true);
    const snapshot = readFileSync(BRIDGE_SNAPSHOT, "utf8");
    const m = SNAPSHOT_SOURCE_RE.exec(snapshot);
    expect(m, "the snapshot carries no `-- source migration:` line").not.toBeNull();
    expect(
      newestBridgeDefinition().file,
      "the scan found a different newest bridge definition than the snapshot's source migration; " +
        "regenerate the snapshot with `npm run schema:functions`, or fix the scan",
    ).toBe(m![1]);
  });
});
