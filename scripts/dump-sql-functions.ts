#!/usr/bin/env tsx
/**
 * Canonical SQL function snapshot generator (tech-debt #2).
 *
 * Business logic in this project lives in SECURITY DEFINER SQL functions that
 * are repeatedly redefined via `CREATE OR REPLACE FUNCTION` across ~194
 * append-only migrations (mark_compute_job_done alone is redefined 9x). There
 * was no committed current-state artifact, so the only way to know a function's
 * live body was to grep every migration and mentally apply them in order. That
 * opacity already caused a silent prod regression (G23-187: a rewrite copied a
 * stale body and reverted a GIN fan-in to a seq-scan loop) and a near-miss
 * (B5b). See CHANGELOG / docs/architecture for the history.
 *
 * This script replays every migration in chronological (filename) order and
 * writes the LATEST definition of each function to
 * `supabase/schema/functions/<name>.sql`. The committed snapshot makes
 * `CREATE OR REPLACE` diffs reviewable against the canonical body and replaces
 * the manual "sed-extract the latest body" ritual. A CI gate (--check) keeps it
 * honest: it regenerates and fails if the committed snapshot is stale.
 *
 * SCOPE: functions only (the dominant redefine class + the regression class
 * that actually shipped). Tables/columns/policies/triggers are NOT covered —
 * those evolve via incremental ALTERs that text-replay can't reconstruct, and a
 * full-schema snapshot needs the Supabase local stack in CI (deferred; see
 * docs/deferred-findings.md).
 *
 * Hermetic by design: pure text processing, no DB, no Docker, no secrets — so
 * the gate can never flake. Regenerate locally with `npm run schema:functions`.
 *
 * ── DRIFT-05 GATE (a) OF TWO — READ THIS BEFORE TRUSTING IT ──────────────────
 * `--check` also carries the DRIFT-05 name-set assertion: every function name in
 * `supabase/schema/baseline.sql` (the committed PROD schema dump) must also be a
 * name in the migration-replay snapshot, and vice versa. That is gate (a).
 *
 * ⛔ GATE (a) DOES NOT COVER THE LIVE DIRECTION, AND MUST NEVER BE READ AS IF IT
 * DID. It compares two COMMITTED artifacts. `baseline.sql` is a dated dump —
 * 2026-08-29 at the time of writing, see `supabase/schema/BASELINE.md`. So a
 * function created directly in PROD under no migration (DRIFT-04's shape,
 * `create_allocator_connected_strategy`) becomes visible here only ONCE THE
 * BASELINE IS NEXT REFRESHED, which may be months. Between refreshes this gate
 * is green about a question it did not ask.
 *
 * ⭐ GATE (b), which closes the live direction, is
 * `scripts/prod-body-drift-check.sh --baseline-live`. It needs the PROD
 * credential, so it rides VAC-04's existing credentialed job in
 * `.github/workflows/migration-drift-check.yml`. Neither gate covers the other:
 * (a) is hermetic and as-of-the-last-refresh; (b) is live and runs only on
 * migration PRs. Shipping (a) while believing it subsumes (b) would be a control
 * that reads green while blind — the defect class Phase 164.3 exists to remove.
 *
 * ⚠️ STATED LIMIT of (a): names are compared BARE (schema stripped), because
 * `baseline.sql` qualifies every definition `public.` while the committed
 * snapshot leaves 50 of its 121 (schema, name) pairs unqualified — and
 * unqualified resolves through `search_path` into the same schema the dump
 * covers. MEASURED 2026-09-07 with `--function-qualified-names`: baseline 119
 * pairs, all `public`; snapshot 121 pairs, 71 `public` and 50 unqualified. Zero
 * definitions on either side carry a NON-public qualifier, so an explicit
 * `private.f` would today be compared against a `public.f` by bare name. That is
 * a latent hole, recorded rather than implied; it opens with the first
 * non-public definition.
 *
 * Usage:
 *   tsx scripts/dump-sql-functions.ts            # regenerate the snapshot
 *   tsx scripts/dump-sql-functions.ts --check    # CI gate: fail if stale
 *   tsx scripts/dump-sql-functions.ts --self-test # parser self-check
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ⛔ THE DECLARED SINGLE PARSER. Function identifiers are read by
// `sql-body-normalize.mjs` — the same `extractFunctionDefs` behind
// `--function-names`, which VAC-04 and VAC-08 already use. A second identifier
// parser written here would disagree with those gates at exactly the inputs
// that matter (quoted identifiers, `$` in a name, a definition inside a comment)
// and the disagreement would be invisible until it mattered.
import { extractFunctionDefs } from "./sql-body-normalize.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const SNAPSHOT_DIR = join(REPO_ROOT, "supabase", "schema", "functions");
/** The committed PROD schema dump. See supabase/schema/BASELINE.md. */
const BASELINE_FILE = join(REPO_ROOT, "supabase", "schema", "baseline.sql");

const HEADER =
  "-- @generated by scripts/dump-sql-functions.ts — DO NOT EDIT BY HAND.\n" +
  "-- Canonical current body of this function, replayed from supabase/migrations/**.\n" +
  "-- Regenerate with `npm run schema:functions`. See tech-debt #2.\n";

/**
 * Split SQL into top-level statements, respecting the lexical contexts where a
 * `;` does NOT end a statement: line comments, block comments (Postgres nests
 * them), single-quoted strings ('' escape), and dollar-quoted strings
 * ($tag$ ... $tag$, where only the matching tag closes — so a $cron$ body
 * containing $$ is one opaque blob). Returns each statement's raw text.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  let blockDepth = 0; // /* */ nesting
  let inLine = false; // -- ... \n
  let inSingle = false; // '...'
  let dollarTag: string | null = null; // current open $tag$

  // Try to read a dollar-quote tag at position p: $[A-Za-z_0-9]*$ -> returns the
  // full tag incl. both $, or null.
  const readDollarTag = (p: number): string | null => {
    if (sql[p] !== "$") return null;
    let q = p + 1;
    while (q < n && /[A-Za-z_0-9]/.test(sql[q])) q++;
    if (sql[q] === "$") return sql.slice(p, q + 1);
    return null;
  };

  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];

    if (inLine) {
      buf += c;
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    if (blockDepth > 0) {
      if (c === "/" && c2 === "*") { blockDepth++; buf += "/*"; i += 2; continue; }
      if (c === "*" && c2 === "/") { blockDepth--; buf += "*/"; i += 2; continue; }
      buf += c; i++;
      continue;
    }
    if (inSingle) {
      if (c === "'" && c2 === "'") { buf += "''"; i += 2; continue; } // escaped quote
      buf += c;
      if (c === "'") inSingle = false;
      i++;
      continue;
    }
    if (dollarTag !== null) {
      if (c === "$") {
        const tag = readDollarTag(i);
        if (tag === dollarTag) { buf += tag; i += tag.length; dollarTag = null; continue; }
      }
      buf += c; i++;
      continue;
    }

    // Not in any quoting/comment context.
    if (c === "-" && c2 === "-") { inLine = true; buf += "--"; i += 2; continue; }
    if (c === "/" && c2 === "*") { blockDepth++; buf += "/*"; i += 2; continue; }
    if (c === "'") { inSingle = true; buf += "'"; i++; continue; }
    if (c === "$") {
      const tag = readDollarTag(i);
      if (tag) { dollarTag = tag; buf += tag; i += tag.length; continue; }
    }
    if (c === ";") {
      buf += ";";
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/** Strip leading line/block comments + whitespace to find the statement keyword. */
function stripLeadingNoise(stmt: string): string {
  let s = stmt;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, "");
    s = s.replace(/^--[^\n]*\n/, "");
    s = s.replace(/^\/\*[\s\S]*?\*\//, "");
    if (s === before) break;
  }
  return s;
}

/**
 * Count top-level (paren-depth-1) arguments inside the first balanced (...)
 * group. Must ignore commas that live inside line/block comments, string
 * literals, or dollar-quoted DEFAULT expressions — a parameter-list comment like
 * `-- {asof, value_usd, breakdown}` would otherwise inflate the count and split
 * one function into phantom overloads (this exact bug hit
 * replace_allocator_equity_snapshots, whose real signature is 3 args).
 */
function countArgs(afterName: string): number {
  const open = afterName.indexOf("(");
  if (open === -1) return -1; // no parens -> treat as unknown
  let depth = 0;
  let count = 0;
  let sawAny = false;
  let inLine = false;
  let blockDepth = 0;
  let inSingle = false;
  let dollarTag: string | null = null;
  const n = afterName.length;
  const readDollarTag = (p: number): string | null => {
    if (afterName[p] !== "$") return null;
    let q = p + 1;
    while (q < n && /[A-Za-z_0-9]/.test(afterName[q])) q++;
    return afterName[q] === "$" ? afterName.slice(p, q + 1) : null;
  };
  for (let i = open; i < n; i++) {
    const ch = afterName[i];
    const c2 = afterName[i + 1];
    if (inLine) { if (ch === "\n") inLine = false; continue; }
    if (blockDepth > 0) {
      if (ch === "/" && c2 === "*") { blockDepth++; i++; }
      else if (ch === "*" && c2 === "/") { blockDepth--; i++; }
      continue;
    }
    if (inSingle) {
      if (ch === "'" && c2 === "'") { i++; continue; } // escaped quote
      if (ch === "'") inSingle = false;
      continue;
    }
    if (dollarTag !== null) {
      if (ch === "$") { const t = readDollarTag(i); if (t === dollarTag) { dollarTag = null; i += t.length - 1; } }
      continue;
    }
    // not in any comment/string context
    if (ch === "-" && c2 === "-") { inLine = true; i++; continue; }
    if (ch === "/" && c2 === "*") { blockDepth++; i++; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === "$") { const t = readDollarTag(i); if (t) { dollarTag = t; i += t.length - 1; continue; } }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) break; }
    else if (ch === "," && depth === 1) count++;
    else if (depth === 1 && /\S/.test(ch)) sawAny = true;
  }
  if (!sawAny) return 0; // empty arg list ()
  return count + 1;
}

interface FnDef {
  name: string; // normalized (public. stripped)
  argCount: number;
  body: string; // verbatim CREATE statement
  source: string; // migration filename
}

const CREATE_RE = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+("[^"]+"|[A-Za-z_][\w.]*)\s*(\([\s\S]*)?$/i;
const DROP_RE = /^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[A-Za-z_][\w.]*)\s*(\([\s\S]*)?$/i;

function normalizeName(raw: string): string {
  let name = raw.replace(/"/g, "");
  if (name.startsWith("public.")) name = name.slice("public.".length);
  return name;
}

/** Replay every migration and return the live set of function definitions. */
export function buildSnapshot(migrationSqls: { file: string; sql: string }[]): Map<string, FnDef> {
  // key = `${name}/${argCount}`
  const live = new Map<string, FnDef>();
  for (const { file, sql } of migrationSqls) {
    for (const stmt of splitStatements(sql)) {
      const head = stripLeadingNoise(stmt);
      const cm = head.match(CREATE_RE);
      if (cm) {
        const name = normalizeName(cm[1]);
        const argCount = countArgs(cm[2] ?? "");
        live.set(`${name}/${argCount}`, { name, argCount, body: stmt, source: file });
        continue;
      }
      const dm = head.match(DROP_RE);
      if (dm) {
        const name = normalizeName(dm[1]);
        const argCount = countArgs(dm[2] ?? "");
        if (argCount >= 0) {
          live.delete(`${name}/${argCount}`);
        } else {
          // DROP without a signature: remove all overloads of that name.
          for (const k of [...live.keys()]) {
            if (live.get(k)!.name === name) live.delete(k);
          }
        }
      }
    }
  }
  return live;
}

/** Group live defs by function name; sort overloads by argCount. */
function emitFiles(live: Map<string, FnDef>): Map<string, string> {
  const byName = new Map<string, FnDef[]>();
  for (const def of live.values()) {
    const arr = byName.get(def.name) ?? [];
    arr.push(def);
    byName.set(def.name, arr);
  }
  const files = new Map<string, string>();
  for (const [name, defs] of byName) {
    defs.sort((a, b) => a.argCount - b.argCount);
    const fileName = name.replace(/[^A-Za-z0-9_.]/g, "_") + ".sql";
    const parts = defs.map((d) => `-- source migration: ${d.source}\n${d.body.trim()}\n`);
    files.set(fileName, HEADER + "\n" + parts.join("\n"));
  }
  return files;
}

function readMigrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
}

function generate(): Map<string, string> {
  return emitFiles(buildSnapshot(readMigrations()));
}

function writeSnapshot(files: Map<string, string>): void {
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const [name, content] of files) {
    writeFileSync(join(SNAPSHOT_DIR, name), content);
  }
}

function readCommitted(): Map<string, string> {
  const m = new Map<string, string>();
  if (!existsSync(SNAPSHOT_DIR)) return m;
  for (const f of readdirSync(SNAPSHOT_DIR)) {
    if (f.endsWith(".sql")) m.set(f, readFileSync(join(SNAPSHOT_DIR, f), "utf8"));
  }
  return m;
}

// ── DRIFT-05 GATE (a): THE NAME-SET DIFF, BOTH DIRECTIONS ────────────────────

/** Which side of the comparison a name is currently ONLY on. */
export type NameSetSide = "baseline-only" | "snapshot-only";

export interface NameSetRatchetRow {
  /** Bare function name, exactly as `extractFunctionDefs` reports it. */
  name: string;
  /** The side this disagreement was MEASURED on when it was captured. */
  side: NameSetSide;
  /** ISO date the disagreement was measured. */
  capturedAt: string;
  /** Exactly what removes this row. Not "when it's fixed". */
  clearedBy: string;
  /** Why the disagreement exists. */
  reason: string;
}

/**
 * ⛔ THIS RATCHET MAY ONLY SHRINK.
 *
 * ⚠️ THE PARAGRAPH THAT STOOD HERE IS SPENT — its condition was met on
 * 2026-09-07. It read: "The name-set diff is RED at HEAD … The alternative
 * go-green route — regenerating `supabase/schema/baseline.sql` from PROD —
 * needs the production credential, a secret re-scan, and moves the sha256
 * recorded in `supabase/schema/BASELINE.md`. That is a separate reviewed act,
 * so this gate ships on a dated named ratchet instead (Phase 164.5 P-02,
 * PRECEDENT B …)." That act has now been performed, on a founder decision, and
 * it did exactly what the paragraph predicted: the dump moved from 119 to 121
 * distinct function names and TWO of this ratchet's three rows —
 * `match_engine_cron_tick` and `strategy_analytics_drop_stale_error_provenance`
 * — stopped describing a disagreement and were DELETED.
 *
 * ⛔ ONE ROW SURVIVES ON PURPOSE, and it is not an oversight. The regeneration
 * was taken BEFORE DRIFT-04's DROP applies, so `create_allocator_connected_
 * strategy` is still in PROD and therefore still in the dump, while no
 * migration defines it — it is `baseline-only` for exactly the reason recorded,
 * and a re-dump can never clear it. The shape stays PRECEDENT B (the same shape
 * as `scripts/vac08-ledger-baseline.txt` and `LINEAGE_ALLOWLIST` in
 * `scripts/lint-app-guc.mjs`).
 *
 * ⛔ A ROW MATCHES ON NAME **AND SIDE**. A ratcheted name that has FLIPPED SIDES
 * — recorded `baseline-only`, now `snapshot-only`, or the reverse — is a
 * genuinely NEW disagreement and produces a row. A name-only match would absorb
 * it silently, which is the whole failure mode a ratchet is supposed to not
 * have. (Plan 03 pins a hash PAIR for the identical reason.)
 *
 * ⛔ A ROW THAT HAS STOPPED DESCRIBING A DISAGREEMENT IS A HARD FAILURE, not an
 * advisory: delete it. That covers a name now present on BOTH sides AND a name
 * now present on NEITHER — the second is how
 * `create_allocator_connected_strategy` will end up once DRIFT-04's DROP applies
 * and the baseline is regenerated, and without that arm its row would sit here
 * forever describing nothing.
 *
 * ⛔ DO NOT add a row to make a run green. A new disagreement means either a
 * migration or PROD moved; adding a row records that you looked away.
 */
export const NAME_SET_RATCHET: readonly NameSetRatchetRow[] = [
  // EMPTY, and that is a MEASURED state, not an unused feature.
  //
  // The single row this list ever held — `create_allocator_connected_strategy`,
  // side `baseline-only`, captured 2026-09-07 — was deleted on 2026-09-08 the
  // moment it stopped describing a disagreement, exactly as the contract above
  // requires. Its own `clearedBy` named the condition: a regeneration of
  // supabase/schema/baseline.sql taken AFTER DRIFT-04's DROP had actually
  // applied to PROD. That happened (migration 20260908120000, PR #758), the
  // re-dump removed the function's 91 lines, and the name went from
  // `baseline-only` to present on NEITHER side.
  //
  // ⭐ The `ratchet-stale` arm was OBSERVED firing on this exact tree before the
  // row was removed — `ratchet-stale: create_allocator_connected_strategy …
  // present on NEITHER side. The row describes nothing: DELETE this
  // NAME_SET_RATCHET entry.`, exit 1. The row was not deleted on the assumption
  // that it had gone stale; the gate said so first.
  //
  // ⛔ An empty ratchet is the CORRECT resting state and must not be read as
  // "this mechanism is unused". `diffNameSets` is still invoked on every
  // `--check` run and its RED fixtures still run in `--self-test`. Do NOT add a
  // row here to make a run green: a new disagreement means a migration or PROD
  // moved, and recording it here records that you looked away.
];

/**
 * Bare function names in `sql`, through the declared single parser.
 *
 * `extractFunctionDefs` THROWS on an identifier that leaves Postgres' unquoted
 * charset rather than dropping it (a refusal is a measurement; a silent drop is
 * not). Left to propagate deliberately: an unreadable side is not a side with no
 * functions in it, and this gate must not report a name set it could not build.
 */
function functionNamesIn(sql: string): Set<string> {
  return new Set(extractFunctionDefs(sql).map((d: { name: string }) => d.name));
}

/**
 * The name-set diff. Returns `drift[]` rows — an empty array is a MEASURED
 * agreement, and the only way to reach it is for every name on each side to be
 * on the other side or to be ratcheted on that same side.
 */
export function diffNameSets(
  baselineNames: Set<string>,
  snapshotNames: Set<string>,
  ratchet: readonly NameSetRatchetRow[],
): string[] {
  const rows: string[] = [];
  const byName = new Map<string, NameSetRatchetRow>();
  for (const r of ratchet) byName.set(r.name, r);

  // ⛔ The lookup is by name AND side. A ratcheted name found on the OTHER side
  // is reported, loudly, with both sides named — see the block comment on
  // NAME_SET_RATCHET.
  const oneSided = (
    name: string,
    side: NameSetSide,
    label: string,
  ): void => {
    const r = byName.get(name);
    if (r && r.side === side) return; // ratcheted, on the recorded side
    if (r) {
      rows.push(
        `  ${label} ${name}  ⛔ RATCHET SIDE FLIP — NAME_SET_RATCHET records it as ` +
          `'${r.side}' (captured ${r.capturedAt}) but it is now '${side}'. That is a NEW ` +
          `disagreement, not the carried one: something moved on both sides. Re-measure before ` +
          `touching the ratchet row.`,
      );
      return;
    }
    rows.push(`  ${label} ${name}`);
  };

  for (const name of baselineNames) {
    if (snapshotNames.has(name)) continue;
    oneSided(name, "baseline-only", "baseline-only:");
  }
  for (const name of snapshotNames) {
    if (baselineNames.has(name)) continue;
    oneSided(name, "snapshot-only", "snapshot-only:");
  }

  // The ratchet may only SHRINK. A row that no longer describes a disagreement
  // is a hard failure, both when the name has appeared on both sides and when it
  // has vanished from both — a row describing nothing is an exemption nobody is
  // re-checking.
  for (const r of ratchet) {
    const inBaseline = baselineNames.has(r.name);
    const inSnapshot = snapshotNames.has(r.name);
    if (inBaseline && inSnapshot) {
      rows.push(
        `  ratchet-stale: ${r.name} — recorded '${r.side}' on ${r.capturedAt}, but it is now ` +
          `present on BOTH sides. The disagreement is gone: DELETE this NAME_SET_RATCHET entry.`,
      );
    } else if (!inBaseline && !inSnapshot) {
      rows.push(
        `  ratchet-stale: ${r.name} — recorded '${r.side}' on ${r.capturedAt}, but it is now ` +
          `present on NEITHER side. The row describes nothing: DELETE this NAME_SET_RATCHET entry. ` +
          `(clearedBy: ${r.clearedBy})`,
      );
    }
  }

  return rows;
}

function check(): number {
  const want = generate();
  const have = readCommitted();
  const drift: string[] = [];
  for (const [name, content] of want) {
    if (!have.has(name)) drift.push(`  missing:  supabase/schema/functions/${name}`);
    else if (have.get(name) !== content) drift.push(`  stale:    supabase/schema/functions/${name}`);
  }
  for (const name of have.keys()) {
    if (!want.has(name)) drift.push(`  orphaned: supabase/schema/functions/${name}`);
  }

  // ── DRIFT-05 GATE (a) — the third assertion, pushing into the SAME array ───
  // Deliberately reuses `drift[]`: it inherits the failure rendering below and
  // the existing `sql-function-snapshot.yml` wiring at no cost. A parallel
  // reporting path (or a second CI step) would be a second thing to keep green.
  //
  // The snapshot side is taken from `want` — the migration replay — rather than
  // from `have`. They are the same text whenever the two loops above are quiet,
  // and when they are NOT quiet this run is already failing, so reading the
  // replay keeps the name-set verdict from depending on staleness the run is
  // simultaneously reporting.
  //
  // ⛔ An ABSENT baseline is a hard failure, never an empty name set. "Could not
  // read the baseline" and "the baseline agrees" must not share a code path.
  if (!existsSync(BASELINE_FILE)) {
    console.error(
      `DRIFT-05 gate (a): the committed PROD baseline is missing at ${BASELINE_FILE}.\n` +
        `A baseline this gate could not read is not a baseline that agrees with the migration\n` +
        `chain, so it fails closed rather than comparing against an empty name set.`,
    );
    return 1;
  }
  const baselineNames = functionNamesIn(readFileSync(BASELINE_FILE, "utf8"));
  const snapshotNames = new Set<string>();
  for (const content of want.values()) {
    for (const n of functionNamesIn(content)) snapshotNames.add(n);
  }
  drift.push(...diffNameSets(baselineNames, snapshotNames, NAME_SET_RATCHET));

  if (drift.length) {
    console.error(
      `SQL function snapshot is stale (${drift.length} finding(s)) — a migration changed a function\n` +
        `body but supabase/schema/functions/ wasn't regenerated, and/or the committed PROD\n` +
        `baseline and the migration chain disagree about which functions exist:\n` +
        drift.sort().join("\n") +
        `\n\nRun \`npm run schema:functions\` and commit supabase/schema/functions/.\n` +
        `For a baseline-only:/snapshot-only:/ratchet-stale: row, see NAME_SET_RATCHET in this file.\n` +
        `⛔ Gate (a) is hermetic and only as current as supabase/schema/baseline.sql. The LIVE\n` +
        `direction is gate (b): scripts/prod-body-drift-check.sh --baseline-live. Neither covers\n` +
        `the other.`,
    );
    return 1;
  }
  console.log(`SQL function snapshot is current (${want.size} functions).`);
  // The green path PRINTS its measurement — a gate that reports agreement
  // without saying what it compared is a claim, not a reading.
  console.log(
    `DRIFT-05 gate (a): baseline ${baselineNames.size} name(s) vs migration-replay ` +
      `${snapshotNames.size} name(s) — agree, with ${NAME_SET_RATCHET.length} ratcheted ` +
      `disagreement(s) carried. Gate (a) is hermetic and as-of the last baseline refresh; ` +
      `the live direction is gate (b) in scripts/prod-body-drift-check.sh --baseline-live.`,
  );
  return 0;
}

function selfTest(): number {
  // Synthetic migrations exercising: $$ body, named-tag body, nested $cron$ in a
  // DO block (must not confuse the splitter), an overload (same name, diff
  // argcount), a redefine (last wins), and a DROP+recreate (arg evolution).
  const m1 = {
    file: "001_a.sql",
    sql: `
      CREATE OR REPLACE FUNCTION foo(a int) RETURNS int LANGUAGE plpgsql AS $$
      BEGIN RETURN a; END; $$;
      DO $$ BEGIN PERFORM cron.schedule('x', $cron$ SELECT 1; $cron$); END $$;
      CREATE OR REPLACE FUNCTION bar() RETURNS void LANGUAGE sql AS $func$ SELECT 1; $func$;
    `,
  };
  const m2 = {
    file: "002_b.sql",
    sql: `
      -- redefine foo(int): new body must win
      CREATE OR REPLACE FUNCTION foo(a int) RETURNS int LANGUAGE plpgsql AS $$
      BEGIN RETURN a + 1; END; $$;
      -- overload foo with 2 args
      CREATE OR REPLACE FUNCTION foo(a int, b int) RETURNS int LANGUAGE sql AS $$ SELECT a + b; $$;
    `,
  };
  const m3 = {
    file: "003_c.sql",
    sql: `
      DROP FUNCTION IF EXISTS foo(int, int);
      CREATE FUNCTION baz(x text DEFAULT '), not a paren') RETURNS text LANGUAGE sql AS $$ SELECT x; $$;
    `,
  };
  // Comment/string commas in the signature must NOT inflate the arg count
  // (the replace_allocator_equity_snapshots bug: a `-- {a, b, c}` param comment
  // split one 3-arg function into phantom /6 and /7 overloads).
  const m4 = {
    file: "004_d.sql",
    sql: `
      CREATE OR REPLACE FUNCTION qux(
        p_id uuid,
        p_rows jsonb, -- array of {asof, value_usd, breakdown, source}
        p_limit int /* inline, block, comment */ DEFAULT 10
      ) RETURNS void LANGUAGE sql AS $$ SELECT 1; $$;
      CREATE OR REPLACE FUNCTION quux(a text DEFAULT 'x,y,z') RETURNS text LANGUAGE sql AS $$ SELECT a; $$;
    `,
  };
  const live = buildSnapshot([m1, m2, m3, m4]);
  const get = (name: string, n: number) => live.get(`${name}/${n}`);
  const assert = (cond: boolean, msg: string) => {
    if (!cond) { console.error(`SELF-TEST FAIL: ${msg}`); process.exit(1); }
  };
  assert(get("foo", 1) !== undefined, "foo(1 arg) should be live");
  assert(get("foo", 1)!.body.includes("a + 1"), "foo(int) latest body should win");
  assert(get("foo", 1)!.source === "002_b.sql", "foo(int) source should be the redefining migration");
  assert(get("foo", 2) === undefined, "foo(int,int) overload was DROPped -> should be gone");
  assert(get("bar", 0) !== undefined, "bar() (named-tag body) should be live");
  assert(get("baz", 1) !== undefined, "baz(text) (CREATE FUNCTION, paren-in-default) should be live");
  assert(get("baz", 1)!.argCount === 1, "baz default with a ')' literal must still count 1 arg");
  // The DO block + nested $cron$ must not have leaked into any function body.
  assert(![...live.values()].some((d) => d.body.includes("cron.schedule")), "DO block must not be captured as a function");
  // Comment/string commas must not inflate the arg count.
  assert(get("qux", 3) !== undefined, "qux must be 3 args (comment/block commas ignored), not 6+");
  assert([...live.keys()].filter((k) => k.startsWith("qux/")).length === 1, "qux must be a SINGLE def, not phantom overloads");
  assert(get("quux", 1) !== undefined, "quux must be 1 arg (comma inside string literal ignored)");

  // ── DRIFT-05 GATE (a) — a RED FIXTURE IN EACH DIRECTION ────────────────────
  // Synthetic corpora, driven through the REAL comparator. Each arm asserts the
  // comparator produces a row AND names WHICH row, so an arm cannot pass on a
  // row raised for some other reason.
  const S = (...names: string[]) => new Set(names);
  const R = (name: string, side: NameSetSide): NameSetRatchetRow => ({
    name,
    side,
    capturedAt: "2026-09-07",
    clearedBy: "self-test fixture",
    reason: "self-test fixture",
  });

  // RED 1 — baseline-only: in the PROD dump, in no migration. DRIFT-04's shape.
  const red1 = diffNameSets(S("shared_fn", "only_in_baseline"), S("shared_fn"), []);
  assert(red1.length > 0, "a baseline-only name must produce a drift row");
  assert(
    red1.some((r) => r.includes("baseline-only:") && r.includes("only_in_baseline")),
    "the baseline-only row must name the side AND the function",
  );

  // RED 2 — snapshot-only: a migration defines it, the committed baseline does
  // not. The opposite direction, with its own fixture (one arm proving "the
  // comparator fires" would leave the other direction untested).
  const red2 = diffNameSets(S("shared_fn"), S("shared_fn", "only_in_snapshot"), []);
  assert(red2.length > 0, "a snapshot-only name must produce a drift row");
  assert(
    red2.some((r) => r.includes("snapshot-only:") && r.includes("only_in_snapshot")),
    "the snapshot-only row must name the side AND the function",
  );

  // GREEN — a ratcheted name on the SIDE it was recorded on is absorbed.
  assert(
    diffNameSets(S("shared_fn", "known"), S("shared_fn"), [R("known", "baseline-only")]).length === 0,
    "a ratchet row matching name AND side must absorb its disagreement",
  );

  // RED 3 — SIDE FLIP. Ratcheted as baseline-only, now snapshot-only. A
  // name-only match would swallow this; it is a genuinely NEW disagreement.
  const flip = diffNameSets(S("shared_fn"), S("shared_fn", "known"), [R("known", "baseline-only")]);
  assert(flip.length > 0, "a ratcheted name that FLIPPED SIDES must still produce a drift row");
  assert(
    flip.some((r) => r.includes("known") && r.toUpperCase().includes("FLIP")),
    "the side-flip row must say the ratchet row's recorded side no longer matches",
  );

  // RED 4 — STALE, both sides. The ratchet may only shrink.
  const stale = diffNameSets(S("known"), S("known"), [R("known", "baseline-only")]);
  assert(stale.length > 0, "a ratchet row for a name now on BOTH sides must fail, not go quiet");
  assert(
    stale.some((r) => r.includes("ratchet-stale:") && r.includes("known")),
    "the both-sides stale row must be labelled ratchet-stale and name the entry to delete",
  );

  // RED 5 — STALE, neither side. This is how create_allocator_connected_strategy
  // ends after DRIFT-04's DROP plus a baseline regeneration; without this arm its
  // row would sit in the ratchet forever describing nothing.
  const gone = diffNameSets(S(), S(), [R("known", "baseline-only")]);
  assert(gone.length > 0, "a ratchet row for a name now on NEITHER side must fail, not go quiet");
  assert(
    gone.some((r) => r.includes("ratchet-stale:") && r.includes("known")),
    "the neither-side stale row must be labelled ratchet-stale and name the entry to delete",
  );

  console.log("SELF-TEST PASS: 22 assertions.");
  return 0;
}

const arg = process.argv[2];
if (arg === "--check") process.exit(check());
else if (arg === "--self-test") process.exit(selfTest());
else {
  const files = generate();
  writeSnapshot(files);
  console.log(`Wrote ${files.size} function snapshot file(s) to supabase/schema/functions/.`);
}
