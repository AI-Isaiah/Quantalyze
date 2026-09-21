#!/usr/bin/env node
/**
 * The static, credential-free census for live-DB-gated test files (Phase 164.9, plan 03,
 * ROADMAP criterion 13 / `[164.9-CREDENTIALED-TESTS-RED-AND-UNGATED]`).
 *
 * ── THE DEFECT THIS EXISTS FOR ─────────────────────────────────────────────
 * `src/lib/test-helpers/live-db.ts` gates ~284 tests behind `HAS_LIVE_DB` (present ONLY when
 * `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set), and CI's vitest shards
 * deliberately never set them — adding them would un-skip the class and shift the coverage
 * ratchet's denominator. So the class runs nowhere CI can see it go red, and a MEASURED run
 * against shared TEST turned up 38 failures whose signatures RESEARCH traced (only 3 of 38)
 * to defects that follow the tests to ANY host: two live overloads of one function in the
 * COMMITTED baseline (`PGRST203`), a schema `config.toml` never exposes to PostgREST
 * (`Invalid schema: cron`), and a test fixture naming a column that has never existed
 * (`PGRST204` on `api_keys.key_hash`). This tool measures the REST of the corpus the same
 * way RESEARCH measured those three — by reading tracked files, never by touching a
 * database — so the owed per-file census stops being a claim and becomes a gate.
 *
 * ── WHY STATIC, AND WHAT IT CANNOT SEE ─────────────────────────────────────
 * This script opens no database, reads no secret, and starts no server. It is entirely
 * hermetic: read `supabase/schema/baseline.sql` (the committed catalogue) and
 * `supabase/config.toml` (the exposed-schema list), then read every live-DB-gated test file
 * and check the PostgREST call sites it can resolve — a relation named by a string-literal
 * `.from(...)`, a schema named by a string-literal `.schema(...)`, a function named by a
 * string-literal `.rpc(...)`, and the object-literal payload keys of an `.insert(...)`,
 * `.update(...)` or `.upsert(...)` chained off a `.from(...)` call — against that catalogue.
 * A permission-denial failure (`42501`) is NOT statically decidable (it depends on which role
 * the running client authenticates as, not on anything in the text) and this tool never
 * claims to detect it. Anything else not statically resolvable — a computed relation name, an
 * array/spread/variable payload, a dynamic function name — is counted as `unresolved`, NEVER
 * silently as clean. A tool that passes what it cannot read is the exact vacuity this repo's
 * discipline exists to prevent.
 *
 * ── CORPUS DISCOVERY (walked, never globbed, never grepped) ────────────────
 * A file belongs to the corpus when its source contains the substring `HAS_LIVE_DB` — the
 * live-DB gate symbol from `src/lib/test-helpers/live-db.ts`. MEASURED: only a handful of the
 * ~51 gated files follow any filename convention, so a static glob would miss most of the
 * corpus. The walk uses `node:fs` directly and reads every file with `readFileSync(..., "utf8")`
 * — never shell `grep` — because this repo has a MEASURED grep-blind file
 * (`src/lib/wizardErrors.test.ts` carries a deliberate NUL byte that makes `grep` skip the file
 * silently and report success). A `String.prototype.includes` scan over the decoded text does
 * not share that blind spot.
 *
 * ── FOUR FINDING CLASSES ────────────────────────────────────────────────────
 *   absent-table      `.from("x")` names a relation the catalogue's `public` schema does not
 *                      declare.
 *   absent-column      An `.insert`/`.update`/`.upsert` payload chained off a `.from("x")` call
 *                      supplies a key the catalogue does not declare as a column of `x`.
 *   unexposed-schema   `.schema("x")` names a schema `config.toml`'s `[api].schemas` list does
 *                      not expose to PostgREST.
 *   ambiguous-overload  `.rpc("fn", payload)` names a function the catalogue declares more than
 *                      once, and the payload's keys do not select exactly one overload (a
 *                      payload whose keys are a subset of MORE than one overload's parameter
 *                      names — including the empty payload, which is a subset of every
 *                      overload — cannot be disambiguated by PostgREST either).
 *
 * A relation reached through a non-default, EXPOSED schema (e.g. `graphql_public`) is not
 * checked for absent-table/absent-column — this tool's catalogue model only covers `public`,
 * and asserting about a schema it cannot see would be exactly the vacuity it exists to forbid.
 * Such a call site is skipped, not counted as a finding and not counted as unresolved (the
 * schema-exposure question is answered; the table-existence question in another schema is out
 * of this tool's declared scope).
 *
 * ── SCOPE BOUNDARY ──────────────────────────────────────────────────────────
 * • Node builtins ONLY (`node:fs`, `node:path`, `node:url`). No npm import, ever.
 * • TEXT ONLY, like `scripts/lint-sql-gates.mjs` and `scripts/lint-app-guc.mjs` (the SIBLING
 *   convention this tool follows — a separate tool with its own corpus and its own rules,
 *   never an appended rule of either).
 * • "COULD NOT MEASURE" and "MEASURED ZERO" are different answers. An empty corpus is a
 *   MEASURE_FAIL (exit 1), never a clean pass — the summary line always prints the corpus size,
 *   the per-class counts and the `unresolved` count, every count DERIVED from the scan.
 * • The lineage allowlist (`scripts/live-db-fixture-drift-baseline.txt`) is a SHRINK-ONLY
 *   ledger: every entry pins an exact (class, file, identifier) and a non-blank destination
 *   plan/phase; a finding not present there fails the run; the file's own `ENTRY_COUNT` is
 *   verified against its own non-comment line count so a silent edit cannot pass.
 *
 * ── USAGE (CI pastes the first line VERBATIM — mode identity) ──────────────
 *   node scripts/live-db-fixture-drift-census.mjs                     # real corpus + allowlist
 *   node scripts/live-db-fixture-drift-census.mjs --self-test         # the engine's own fixtures
 *   node scripts/live-db-fixture-drift-census.mjs --catalogue <path> --config <path> \
 *        --corpus-dir <path> --allowlist <path>                      # ad-hoc / test-only paths
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_DIR = "scripts/live-db-fixture-drift-fixtures";
const DEFAULT_CORPUS_DIR = "src";
const DEFAULT_CATALOGUE = "supabase/schema/baseline.sql";
const DEFAULT_CONFIG = "supabase/config.toml";
const DEFAULT_ALLOWLIST = "scripts/live-db-fixture-drift-baseline.txt";
const LIVE_DB_GATE_SYMBOL = "HAS_LIVE_DB";

export const CLASSES = ["absent-table", "absent-column", "unexposed-schema", "ambiguous-overload"];

// ───────────────────────────────────────────────────────────────────────────
// JS/TS masking — comments and string/template literals blanked to spaces
// (positions and newlines survive), so a `.from(` sitting in a `//` comment
// or inside a test-description string cannot be mistaken for a call site.
// MEASURED: this repo's corpus contains BOTH cases (a `// ... admin.from() ...`
// comment and a `"[test] ... admin.from() ..."` description string) — an
// unmasked scan reports both as call sites.
// ───────────────────────────────────────────────────────────────────────────

/** Index just past the string/template literal starting at `j` (src[j] is the opening quote). */
function skipStringLike(src, j) {
  const q = src[j];
  if (q === "'" || q === '"') {
    let k = j + 1;
    while (k < src.length) {
      if (src[k] === "\\") {
        k += 2;
        continue;
      }
      if (src[k] === q) return k + 1;
      k++;
    }
    return src.length;
  }
  if (q === "`") {
    let k = j + 1;
    let depth = 0;
    while (k < src.length) {
      if (src[k] === "\\") {
        k += 2;
        continue;
      }
      if (depth === 0 && src[k] === "`") return k + 1;
      if (src[k] === "$" && src[k + 1] === "{") {
        depth++;
        k += 2;
        continue;
      }
      if (depth > 0 && src[k] === "{") {
        depth++;
        k++;
        continue;
      }
      if (depth > 0 && src[k] === "}") {
        depth--;
        k++;
        continue;
      }
      k++;
    }
    return src.length;
  }
  return j + 1;
}

/**
 * @returns masked text: `//`/`/* *\/` comments and `'...'`/`"..."`/`` `...` `` literals
 * (interpolations included) blanked to spaces, same length, newlines preserved.
 * KNOWN LIMITATION: regex literals are not masked — a `.from(` substring inside a regex
 * literal would be misread as code. None exist in this corpus; documented rather than silently
 * assumed away.
 */
export function maskJs(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const j = skipStringLike(src, i);
      blank(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

/**
 * Reads a single argument that is a PLAIN (non-interpolated) string/template literal,
 * immediately followed by `,` or `)`. `idx` is the index right after the call's `(`, in the
 * ORIGINAL (unmasked) source — the literal's real text lives there, never in the masked skeleton.
 * @returns {{value:string, endIdx:number} | null}
 */
export function readLiteralArg(src, idx) {
  let i = idx;
  while (i < src.length && /\s/.test(src[i])) i++;
  const c = src[i];
  if (c !== "'" && c !== '"' && c !== "`") return null;
  let j = i + 1;
  let value = "";
  if (c === "`") {
    while (j < src.length) {
      if (src[j] === "\\") {
        value += src[j + 1];
        j += 2;
        continue;
      }
      if (src[j] === "`") {
        j++;
        break;
      }
      if (src[j] === "$" && src[j + 1] === "{") return null; // interpolated — not a plain literal
      value += src[j];
      j++;
    }
  } else {
    while (j < src.length) {
      if (src[j] === "\\") {
        value += src[j + 1];
        j += 2;
        continue;
      }
      if (src[j] === c) {
        j++;
        break;
      }
      if (src[j] === "\n") return null; // unterminated on this line
      value += src[j];
      j++;
    }
  }
  let k = j;
  while (k < src.length && /\s/.test(src[k])) k++;
  if (src[k] !== ")" && src[k] !== ",") return null;
  return { value, endIdx: j };
}

/**
 * Reads the top-level entries of an object literal starting at `idx` (src[idx] === "{"), in the
 * ORIGINAL source. Depth-aware over `(`/`[`/`{` and skips string/template literal contents so a
 * comma or brace inside a value never splits or terminates early.
 * @returns {{rawEntries:string[], endIdx:number} | null}
 */
export function readObjectLiteralKeys(src, idx) {
  if (src[idx] !== "{") return null;
  let depth = 0;
  const entries = [];
  let entryStart = idx + 1;
  const n = src.length;
  for (let j = idx; j < n; j++) {
    const c = src[j];
    if (c === "'" || c === '"' || c === "`") {
      j = skipStringLike(src, j) - 1;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      depth++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0 && c === "}") {
        entries.push(src.slice(entryStart, j));
        return { rawEntries: entries, endIdx: j + 1 };
      }
      continue;
    }
    if (c === "," && depth === 1) {
      entries.push(src.slice(entryStart, j));
      entryStart = j + 1;
      continue;
    }
  }
  return null; // never closed
}

/**
 * The key of one object-literal entry's raw text, or null when it cannot be statically
 * resolved (spread, computed key, or an unrecognised shape).
 */
export function parseEntryKey(entryText) {
  const t = entryText.trimStart();
  if (t.startsWith("...")) return null; // spread
  if (t.startsWith("[")) return null; // computed key
  let m = /^(['"])((?:\\.|(?!\1).)*)\1\s*:/.exec(t);
  if (m) return m[2];
  m = /^([A-Za-z_$][\w$]*)\s*:/.exec(t);
  if (m) return m[1];
  m = /^([A-Za-z_$][\w$]*)\s*$/.exec(t.trimEnd());
  if (m) return m[1]; // shorthand property
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// SQL catalogue masking + parsing (supabase/schema/baseline.sql).
// `--`/`/* */` comments, `'...'` literals (with `''` escape) and `$tag$...$tag$`
// bodies are blanked; `"quoted identifiers"` are CODE and are never blanked —
// they are exactly what the table/function-name regexes below read.
// ───────────────────────────────────────────────────────────────────────────

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

export function maskSqlLite(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = n;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j === -1 ? n : j + 2;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "'" && src[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (src[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "$") {
      const m = DOLLAR_TAG.exec(src.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const closeIdx = src.indexOf(tag, i + tag.length);
        const end = closeIdx === -1 ? n : closeIdx + tag.length;
        blank(i, end);
        i = end;
        continue;
      }
    }
    i++;
  }
  return out.join("");
}

/** The matching `)` for the `(` at `openIdx`, scanning the (already-masked) text, or -1. */
function matchParen(text, openIdx) {
  let depth = 0;
  for (let p = openIdx; p < text.length; p++) {
    if (text[p] === "(") depth++;
    else if (text[p] === ")") {
      depth--;
      if (depth === 0) return p;
    }
  }
  return -1;
}

/** Top-level comma split over already-masked SQL text (no quotes remain to confuse it). */
function splitTopLevelSql(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

function extractQuotedLeadingName(entryText) {
  const m = /^\s*"([A-Za-z0-9_]+)"/.exec(entryText);
  return m ? m[1] : null;
}

/**
 * Parses `supabase/schema/baseline.sql` (or a stub with the same shapes) into a catalogue.
 * @returns {{relations: Map<string, Set<string>>, functions: Map<string, string[][]>}}
 */
export function parseCatalogue(sqlSrc) {
  const masked = maskSqlLite(sqlSrc);
  const relations = new Map();
  const functions = new Map();

  const tableRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"public"\."([A-Za-z0-9_]+)"\s*\(/g;
  let m;
  while ((m = tableRe.exec(masked)) !== null) {
    const name = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchParen(masked, openIdx);
    if (closeIdx === -1) continue;
    const inner = masked.slice(openIdx + 1, closeIdx);
    const cols = relations.get(name) ?? new Set();
    for (const entry of splitTopLevelSql(inner)) {
      const col = extractQuotedLeadingName(entry);
      if (col) cols.add(col);
    }
    relations.set(name, cols);
  }

  const alterRe =
    /ALTER TABLE(?:\s+ONLY)?\s+"public"\."([A-Za-z0-9_]+)"\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"([A-Za-z0-9_]+)"/g;
  while ((m = alterRe.exec(masked)) !== null) {
    const [, table, col] = m;
    const cols = relations.get(table) ?? new Set();
    cols.add(col);
    relations.set(table, cols);
  }

  const funcRe = /CREATE (?:OR REPLACE )?FUNCTION\s+"public"\."([A-Za-z0-9_]+)"\s*\(/g;
  while ((m = funcRe.exec(masked)) !== null) {
    const name = m[1];
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchParen(masked, openIdx);
    if (closeIdx === -1) continue;
    const inner = masked.slice(openIdx + 1, closeIdx);
    const params = [];
    for (const entry of splitTopLevelSql(inner)) {
      const p = extractQuotedLeadingName(entry);
      if (p) params.push(p);
    }
    const list = functions.get(name) ?? [];
    list.push(params);
    functions.set(name, list);
  }

  return { relations, functions };
}

/** Parses `supabase/config.toml`'s `[api].schemas` list. */
export function parseExposedSchemas(tomlSrc) {
  const result = new Set();
  const lines = tomlSrc.split("\n");
  let inApi = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[.*\]$/.test(trimmed)) {
      inApi = trimmed === "[api]";
      continue;
    }
    if (!inApi) continue;
    const m = /^schemas\s*=\s*\[(.*)\]/.exec(trimmed);
    if (m) {
      const items = m[1].match(/"([^"]*)"|'([^']*)'/g) || [];
      for (const it of items) result.add(it.slice(1, -1));
      break;
    }
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// Call-site classification
// ───────────────────────────────────────────────────────────────────────────

const NON_SUPABASE_FROM_RECEIVERS = new Set(["Array", "Buffer"]);
const PAYLOAD_METHODS_RE = /\.(insert|update|upsert)\(/;
const FROM_RE_G = /\.from\(/;

function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

/**
 * Forward from `fromIdx` (index right after a `.from(` call's closing paren, in `code`), finds
 * the nearest `.insert`/`.update`/`.upsert(` chained BEFORE the next `.from(` call, within a
 * bounded window. Returns `null` (no payload to check — a plain read, or the chain ended),
 * `"unresolved"` (a payload exists but is not a plain object literal, or one of its keys is not
 * statically resolvable), or a `Set<string>` of payload keys.
 */
function findNearbyPayload(code, src, fromIdx) {
  const WINDOW = 800;
  const end = Math.min(code.length, fromIdx + WINDOW);
  const slice = code.slice(fromIdx, end);
  const insertM = PAYLOAD_METHODS_RE.exec(slice);
  if (!insertM) return null;
  const fromM = FROM_RE_G.exec(slice);
  if (fromM && fromM.index < insertM.index) return null; // another .from() intervenes first

  const absIdx = fromIdx + insertM.index + insertM[0].length; // index right after '('
  let idx = absIdx;
  while (idx < src.length && /\s/.test(src[idx])) idx++;
  if (src[idx] !== "{") return "unresolved"; // array / variable / spread payload
  const obj = readObjectLiteralKeys(src, idx);
  if (!obj) return "unresolved";
  const keys = new Set();
  for (const raw of obj.rawEntries) {
    const t = raw.trim();
    if (t === "") continue; // trailing comma
    const key = parseEntryKey(raw);
    if (key === null) return "unresolved";
    keys.add(key);
  }
  return keys;
}

/**
 * Classifies one corpus file's PostgREST call sites against the catalogue.
 * @returns {{findings: Array<{class:string,file:string,identifier:string,line:number}>, unresolvedCount:number}}
 */
export function classifySource(src, filePath, catalogue, exposedSchemas) {
  const code = maskJs(src);
  const findings = [];
  let unresolvedCount = 0;

  // ── Pass 1: variable -> schema bindings, e.g. `const scoped = admin.schema("cron")`.
  const varSchemaMap = new Map();
  {
    const re = /\.schema\(/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const lit = readLiteralArg(src, openIdx + 1);
      if (!lit) continue;
      const before = code.slice(Math.max(0, m.index - 200), m.index);
      const am = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^=;]*$/.exec(before);
      if (am) varSchemaMap.set(am[1], lit.value);
    }
  }

  // ── Pass 2: unexposed-schema, from every `.schema("x")` call site directly.
  {
    const re = /\.schema\(/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const lit = readLiteralArg(src, openIdx + 1);
      if (!lit) {
        unresolvedCount++;
        continue;
      }
      if (!exposedSchemas.has(lit.value)) {
        findings.push({
          class: "unexposed-schema",
          file: filePath,
          identifier: lit.value,
          line: lineOf(src, m.index),
        });
      }
    }
  }

  // ── Pass 3: ambiguous-overload, from every `.rpc("fn", payload)` call site.
  {
    const re = /\.rpc\(/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const openIdx = m.index + m[0].length - 1;
      const lit = readLiteralArg(src, openIdx + 1);
      if (!lit) {
        unresolvedCount++;
        continue;
      }
      const overloads = catalogue.functions.get(lit.value);
      if (!overloads || overloads.length <= 1) continue; // absent or single-overload: out of scope here

      let idx = lit.endIdx;
      while (idx < src.length && /\s/.test(src[idx])) idx++;
      let payloadKeys = new Set();
      if (src[idx] === ",") {
        idx++;
        while (idx < src.length && /\s/.test(src[idx])) idx++;
        if (src[idx] === "{") {
          const obj = readObjectLiteralKeys(src, idx);
          if (!obj) {
            unresolvedCount++;
            continue;
          }
          let bad = false;
          for (const raw of obj.rawEntries) {
            const t = raw.trim();
            if (t === "") continue;
            const key = parseEntryKey(raw);
            if (key === null) {
              bad = true;
              break;
            }
            payloadKeys.add(key);
          }
          if (bad) {
            unresolvedCount++;
            continue;
          }
        } else if (src[idx] !== ")") {
          // a non-object, non-empty second argument (variable, array) — cannot statically read keys
          unresolvedCount++;
          continue;
        }
      }
      const matches = overloads.filter((paramNames) => [...payloadKeys].every((k) => paramNames.includes(k)));
      if (matches.length !== 1) {
        findings.push({
          class: "ambiguous-overload",
          file: filePath,
          identifier: lit.value,
          line: lineOf(src, m.index),
        });
      }
    }
  }

  // ── Pass 4: absent-table / absent-column, from every `.from("x")` call site.
  {
    const re = /\.from\(/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      // Receivers can sit on the PREVIOUS line of a multi-line chain (e.g.
      // `await schemaScoped\n  .from(...)`), so the window must be wide enough to reach
      // back across trailing whitespace/newlines to the identifier.
      const before = code.slice(Math.max(0, m.index - 60), m.index);
      const recv = /([A-Za-z_$][\w$]*)\s*$/.exec(before);
      if (recv && NON_SUPABASE_FROM_RECEIVERS.has(recv[1])) continue;

      const openIdx = m.index + m[0].length - 1;
      const lit = readLiteralArg(src, openIdx + 1);
      if (!lit) {
        unresolvedCount++;
        continue;
      }
      const relation = lit.value;

      // Resolve the schema: an inline `.schema("x").from(...)` chain, else a variable this
      // receiver was bound from in Pass 1, else the PostgREST default (`public`).
      let schema = "public";
      const windowStart = Math.max(0, m.index - 80);
      const window = code.slice(windowStart, m.index);
      const inlineMatch = /\.schema\(\s*\)\s*$/.exec(window);
      if (inlineMatch) {
        const parenOffset = inlineMatch[0].indexOf("(");
        const schemaOpenIdx = windowStart + inlineMatch.index + parenOffset;
        const schemaLit = readLiteralArg(src, schemaOpenIdx + 1);
        if (schemaLit) schema = schemaLit.value;
      } else if (recv && varSchemaMap.has(recv[1])) {
        schema = varSchemaMap.get(recv[1]);
      }

      if (schema !== "public") {
        // Unexposed-schema is reported by Pass 2; this tool's table catalogue only covers
        // `public`, so a relation reached through ANY other schema (exposed or not) is out of
        // scope for absent-table/absent-column — skipping is honest, not silent.
        continue;
      }

      if (!catalogue.relations.has(relation)) {
        findings.push({
          class: "absent-table",
          file: filePath,
          identifier: relation,
          line: lineOf(src, m.index),
        });
        continue;
      }

      const payload = findNearbyPayload(code, src, m.index + m[0].length);
      if (payload === "unresolved") {
        unresolvedCount++;
      } else if (payload) {
        const cols = catalogue.relations.get(relation);
        for (const key of payload) {
          if (!cols.has(key)) {
            findings.push({
              class: "absent-column",
              file: filePath,
              identifier: `${relation}.${key}`,
              line: lineOf(src, m.index),
            });
          }
        }
      }
    }
  }

  return { findings, unresolvedCount };
}

// ───────────────────────────────────────────────────────────────────────────
// Corpus walk, allowlist, driver
// ───────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);

function walkCorpus(dirAbs) {
  const out = [];
  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const p = join(d, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(p);
      } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        out.push(p);
      }
    }
  }
  walk(dirAbs);
  return out.filter((f) => {
    let text;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      return false;
    }
    return text.includes(LIVE_DB_GATE_SYMBOL);
  });
}

/** Parses `scripts/live-db-fixture-drift-baseline.txt`. */
export function parseAllowlist(text) {
  let declaredCount = null;
  const entries = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("#")) {
      const m = /ENTRY_COUNT:\s*(\d+)/.exec(trimmed);
      if (m) declaredCount = Number(m[1]);
      continue;
    }
    const m = /^(\S+)\s+file=(\S+)\s+identifier=(\S+)\s+Destination:\s*(.*)$/.exec(trimmed);
    if (!m) return { error: `unparseable allowlist line: "${trimmed.slice(0, 100)}"` };
    const [, cls, file, identifier, destination] = m;
    if (!CLASSES.includes(cls)) return { error: `allowlist line names unknown class "${cls}"` };
    if (!destination || destination.trim() === "") {
      return { error: `allowlist entry "${cls} ${identifier}" (${file}) has a blank destination` };
    }
    entries.push({ cls, file, identifier, destination: destination.trim() });
  }
  return { entries, entryCount: declaredCount };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--catalogue") opts.cataloguePath = argv[++i];
    else if (a === "--config") opts.configPath = argv[++i];
    else if (a === "--corpus-dir") opts.corpusDir = argv[++i];
    else if (a === "--allowlist") opts.allowlistPath = argv[++i];
    else return { error: `unknown argument "${a}"` };
  }
  return opts;
}

/**
 * Runs the census over the corpus + catalogue + config + allowlist named by `opts` (each
 * overridable so the self-test — and any future ad-hoc invocation — can point at stub files).
 */
export function runCorpus(opts = {}) {
  const catalogueAbs = resolve(REPO_ROOT, opts.cataloguePath ?? DEFAULT_CATALOGUE);
  const configAbs = resolve(REPO_ROOT, opts.configPath ?? DEFAULT_CONFIG);
  const corpusDirAbs = resolve(REPO_ROOT, opts.corpusDir ?? DEFAULT_CORPUS_DIR);
  const allowlistAbs = resolve(REPO_ROOT, opts.allowlistPath ?? DEFAULT_ALLOWLIST);

  if (!existsSync(catalogueAbs)) {
    return { fatal: `catalogue not found: ${relative(REPO_ROOT, catalogueAbs)}` };
  }
  if (!existsSync(configAbs)) {
    return { fatal: `config not found: ${relative(REPO_ROOT, configAbs)}` };
  }

  const catalogue = parseCatalogue(readFileSync(catalogueAbs, "utf8"));
  const exposedSchemas = parseExposedSchemas(readFileSync(configAbs, "utf8"));
  const corpusFiles = existsSync(corpusDirAbs) ? walkCorpus(corpusDirAbs) : [];

  if (corpusFiles.length === 0) {
    return { emptyCorpus: true, corpusSize: 0 };
  }

  const findings = [];
  let unresolvedCount = 0;
  for (const abs of corpusFiles) {
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    const src = readFileSync(abs, "utf8");
    const res = classifySource(src, rel, catalogue, exposedSchemas);
    findings.push(...res.findings);
    unresolvedCount += res.unresolvedCount;
  }

  const classCounts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  for (const f of findings) classCounts[f.class] += 1;

  let allowlistEntries = [];
  let allowlistError = null;
  let entryCountDeclared = null;
  if (existsSync(allowlistAbs)) {
    const parsed = parseAllowlist(readFileSync(allowlistAbs, "utf8"));
    if (parsed.error) {
      allowlistError = parsed.error;
    } else {
      allowlistEntries = parsed.entries;
      entryCountDeclared = parsed.entryCount;
      if (entryCountDeclared === null) {
        allowlistError = "allowlist has no `# ENTRY_COUNT: N` line";
      } else if (entryCountDeclared !== allowlistEntries.length) {
        allowlistError = `ENTRY_COUNT declares ${entryCountDeclared} but ${allowlistEntries.length} non-comment entries were found`;
      }
    }
  }

  const allowlistSet = new Set(allowlistEntries.map((e) => `${e.cls}::${e.file}::${e.identifier}`));
  const newFindings = findings.filter((f) => !allowlistSet.has(`${f.class}::${f.file}::${f.identifier}`));

  const ok = newFindings.length === 0 && !allowlistError;
  return {
    ok,
    corpusSize: corpusFiles.length,
    findings,
    newFindings,
    classCounts,
    unresolvedCount,
    allowlistError,
    allowlistCount: allowlistEntries.length,
  };
}

function report(result) {
  if (result.fatal) {
    console.error(`::error::live-db-fixture-drift: ${result.fatal}`);
    return 1;
  }
  if (result.emptyCorpus) {
    console.error(
      "::error::MEASURE_FAIL — the corpus is empty. An empty corpus proves nothing about the " +
        "live-DB test class; most likely --corpus-dir is wrong. This is not a pass.",
    );
    console.log(
      "live-db-fixture-drift: corpus 0 file(s); 0 finding(s) " +
        "(0 absent-table, 0 absent-column, 0 unexposed-schema, 0 ambiguous-overload), 0 unresolved.",
    );
    return 1;
  }
  for (const f of result.newFindings) {
    console.error(`::error file=${f.file},line=${f.line}::[${f.class}] ${f.identifier}`);
  }
  if (result.allowlistError) {
    console.error(`::error::[allowlist] ${result.allowlistError}`);
  }
  console.log(
    `live-db-fixture-drift: corpus ${result.corpusSize} file(s); ${result.findings.length} finding(s) ` +
      `(${result.classCounts["absent-table"]} absent-table, ${result.classCounts["absent-column"]} absent-column, ` +
      `${result.classCounts["unexposed-schema"]} unexposed-schema, ${result.classCounts["ambiguous-overload"]} ambiguous-overload), ` +
      `${result.unresolvedCount} unresolved.`,
  );
  if (!result.ok) {
    console.error(
      "::error::live-db-fixture-drift FAILED. Each finding above names a call site whose schema " +
        "shape does not resolve against the committed catalogue. See " +
        "scripts/live-db-fixture-drift-baseline.txt for the seeded, dated backlog and " +
        "scripts/live-db-fixture-drift-census.mjs for the four classes.",
    );
  }
  return result.ok ? 0 : 1;
}

/** Round-trips each of the four classes through its own red/green fixture pair. */
function selfTest() {
  const stubCataloguePath = join(REPO_ROOT, FIXTURE_DIR, "stub-baseline.sql");
  const stubConfigPath = join(REPO_ROOT, FIXTURE_DIR, "stub-config.toml");
  if (!existsSync(stubCataloguePath) || !existsSync(stubConfigPath)) {
    console.error("SELF-TEST FAIL: stub catalogue/config fixtures are missing.");
    return 1;
  }
  const catalogue = parseCatalogue(readFileSync(stubCataloguePath, "utf8"));
  const exposedSchemas = parseExposedSchemas(readFileSync(stubConfigPath, "utf8"));

  let bad = 0;
  for (const cls of CLASSES) {
    for (const arm of ["red", "green"]) {
      const p = join(REPO_ROOT, FIXTURE_DIR, `${cls}.${arm}.ts`);
      if (!existsSync(p)) {
        console.error(`SELF-TEST FAIL: ${cls} has no ${arm} fixture at ${relative(REPO_ROOT, p)}`);
        bad = 1;
        continue;
      }
      const src = readFileSync(p, "utf8");
      const res = classifySource(src, relative(REPO_ROOT, p), catalogue, exposedSchemas);
      const fired = new Set(res.findings.map((f) => f.class));
      if (arm === "red") {
        if (!fired.has(cls)) {
          console.error(`SELF-TEST FAIL: ${cls} did not fire on its own red fixture — the rule cannot fail.`);
          bad = 1;
        }
        if (fired.size !== 1) {
          console.error(
            `SELF-TEST FAIL: ${cls} red fixture fired {${[...fired].join(", ")}} — it must isolate one defect.`,
          );
          bad = 1;
        }
      } else if (fired.size !== 0) {
        console.error(`SELF-TEST FAIL: ${cls} fired {${[...fired].join(", ")}} on its green fixture.`);
        bad = 1;
      }
    }
  }
  if (bad === 0) {
    console.log(`live-db-fixture-drift self-test OK (${CLASSES.length} rules, red+green each.)`);
  }
  return bad;
}

function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  const opts = parseArgs(argv);
  if (opts.error) {
    console.error(`live-db-fixture-drift: ${opts.error}`);
    return 1;
  }
  return report(runCorpus(opts));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
