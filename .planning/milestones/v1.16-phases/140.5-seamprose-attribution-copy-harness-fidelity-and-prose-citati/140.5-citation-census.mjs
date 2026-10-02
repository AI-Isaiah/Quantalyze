#!/usr/bin/env node
// 140.5 citation census. Predicate: extract `<name>.<ext>:<line>` tokens that
// appear INSIDE a comment (line or block) of a TS/TSX/PY source file, resolve
// the referenced file by basename against the repo's tracked file list, and
// compare <line> to that file's line count.
//
// Usage: node citations.mjs <glob-root...>   (paths relative to repo root)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const roots = process.argv.slice(2);
if (!roots.length) { console.error("usage: citations.mjs <path>..."); process.exit(2); }

// ---- repo file index (tracked files only) -------------------------------
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\n").filter(Boolean);
const byBase = new Map();
for (const f of tracked) {
  const b = path.basename(f);
  if (!byBase.has(b)) byBase.set(b, []);
  byBase.get(b).push(f);
}
const lineCache = new Map();
function lineCount(f) {
  if (lineCache.has(f)) return lineCache.get(f);
  let n = 0;
  try {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    n = s.split("\n").length;
    if (s.endsWith("\n")) n -= 1; // trailing newline is not a line
  } catch { n = -1; }
  lineCache.set(f, n);
  return n;
}

// ---- comment extraction --------------------------------------------------
// Returns array of {line, text} for comment-only content. Naive but
// string-literal-aware enough for this corpus: we ignore `//` and `/*` that
// appear inside a quoted string on the same line.
function commentSpans(src, ext) {
  const out = [];
  const lines = src.split("\n");
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (ext === ".py") {
      // python: `#` comments + triple-quoted docstrings
      const h = L.indexOf("#");
      if (h >= 0) out.push({ line: i + 1, text: L.slice(h) });
      // docstrings handled crudely by treating any line inside """...""" as comment
      continue;
    }
    let rest = L, col = 0, emitted = "";
    if (inBlock) {
      const end = L.indexOf("*/");
      if (end < 0) { out.push({ line: i + 1, text: L }); continue; }
      out.push({ line: i + 1, text: L.slice(0, end) });
      rest = L.slice(end + 2); col = end + 2; inBlock = false;
    }
    // scan rest for // or /* outside quotes
    let q = null;
    for (let j = 0; j < rest.length; j++) {
      const c = rest[j], c2 = rest[j + 1];
      if (q) { if (c === "\\") { j++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === "`") { q = c; continue; }
      if (c === "/" && c2 === "/") { emitted += rest.slice(j); break; }
      if (c === "/" && c2 === "*") {
        const end = rest.indexOf("*/", j + 2);
        if (end < 0) { emitted += rest.slice(j); inBlock = true; break; }
        emitted += rest.slice(j, end + 2); j = end + 1; continue;
      }
    }
    if (emitted) out.push({ line: i + 1, text: emitted });
  }
  return out;
}

// python docstring pass: mark lines inside triple quotes as comment
function pyDocstringLines(src) {
  const lines = src.split("\n"); const out = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let j = 0;
    while (j < L.length) {
      if (!open) {
        const a = L.indexOf('"""', j), b = L.indexOf("'''", j);
        const k = (a < 0) ? b : (b < 0 ? a : Math.min(a, b));
        if (k < 0) break;
        open = L.substr(k, 3); j = k + 3;
        out.push({ line: i + 1, text: L.slice(j) });
      } else {
        const k = L.indexOf(open, j);
        if (k < 0) { out.push({ line: i + 1, text: L.slice(j) }); break; }
        out.push({ line: i + 1, text: L.slice(j, k) }); open = null; j = k + 3;
      }
    }
    if (open && j >= L.length) { /* continues */ }
    else if (open) out.push({ line: i + 1, text: L });
  }
  return out;
}

const CITE = /([A-Za-z0-9_./\[\]()@-]*[A-Za-z0-9_\])])\.(ts|tsx|py|mjs|cjs|js|jsx|sql|yml|yaml|md|json)\s*:\s*(\d+(?:\s*[-\u2013,]\s*\d+)*)/g;

const files = [];
for (const r of roots) {
  for (const f of tracked) if (f === r || f.startsWith(r.endsWith("/") ? r : r + "/")) files.push(f);
}
const exts = new Set([".ts", ".tsx", ".py", ".mjs", ".cjs", ".js", ".jsx"]);

let total = 0, resolved = 0, unresolvedName = 0, ambiguous = 0, pastEof = 0;
const pastEofRows = [], ambiguousRows = [], missingRows = [];
for (const f of files) {
  const ext = path.extname(f);
  if (!exts.has(ext)) continue;
  let src;
  try { src = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
  let spans = commentSpans(src, ext);
  if (ext === ".py") spans = spans.concat(pyDocstringLines(src));
  const seen = new Set();
  for (const { line, text } of spans) {
    CITE.lastIndex = 0;
    let m;
    while ((m = CITE.exec(text))) {
      let [, base, ex, ln] = m;
      // Un-eat leading delimiters the char class greedily absorbed:
      // "(route.ts:172)" would otherwise resolve as target "(route.ts".
      while (base.length && "([".includes(base[0])) {
        const open = base[0], close = open === "(" ? ")" : "]";
        const nOpen = base.split(open).length - 1, nClose = base.split(close).length - 1;
        if (nOpen > nClose) base = base.slice(1); else break;
      }
      const target = `${base}.${ex}`;
      const dedupKey = `${line}|${target}|${ln}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const bn = path.basename(target);
      total++;
      let cands = byBase.get(bn) || [];
      if (target.includes("/")) {
        // A PATH-QUALIFIED citation must resolve on its full suffix. Falling
        // back to the bare basename is what bound `dist/index.mjs` (a
        // node_modules path) to tools/eslint-plugin-quantalyze/index.mjs.
        cands = cands.filter((c) => c === target || c.endsWith("/" + target));
      }
      if (cands.length === 0) { unresolvedName++; missingRows.push([f, line, target, ln]); continue; }
      if (cands.length > 1) { ambiguous++; ambiguousRows.push([f, line, target, ln, cands.length]); continue; }
      resolved++;
      const lc = lineCount(cands[0]);
      const nums = ln.split(/[-\u2013,]/).map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
      const maxLn = Math.max(...nums);
      if (lc >= 0 && maxLn > lc) { pastEof++; pastEofRows.push([f, line, cands[0], ln, lc]); }
    }
  }
}
const mode = process.env.MODE || "summary";
console.log(`roots            : ${roots.join(" ")}`);
console.log(`source files     : ${files.filter(f=>exts.has(path.extname(f))).length}`);
console.log(`citations total  : ${total}`);
console.log(`  uniquely resolved: ${resolved}`);
console.log(`  ambiguous basename (>1 tracked file): ${ambiguous}`);
console.log(`  basename not in repo: ${unresolvedName}`);
console.log(`PAST-EOF (resolved & line > EOF): ${pastEof}`);
if (mode !== "summary") {
  console.log("\n--- PAST EOF ---");
  for (const r of pastEofRows) console.log(`${r[0]}:${r[1]}  ->  ${r[2]}:${r[3]}  (EOF ${r[4]})`);
  if (mode === "full") {
    console.log("\n--- AMBIGUOUS ---");
    for (const r of ambiguousRows) console.log(`${r[0]}:${r[1]}  ->  ${r[2]}:${r[3]}  (${r[4]} candidates)`);
    console.log("\n--- MISSING FILE ---");
    for (const r of missingRows) console.log(`${r[0]}:${r[1]}  ->  ${r[2]}:${r[3]}`);
  }
}
