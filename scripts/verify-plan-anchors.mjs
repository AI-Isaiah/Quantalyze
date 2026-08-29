#!/usr/bin/env node
/**
 * The PLAN.md anchor/symbol verifier (Phase 164.3, VAC-05).
 *
 * ── THE DEFECT CLASS THIS EXISTS FOR ───────────────────────────────────────
 * A plan is a set of claims about the tree — "the branch at page.tsx:563-573",
 * "deriveShareToken(strategyId, generation)" — and nothing ever compares those
 * claims to the tree. Both of Phase 164's wave-3 plans were STALE ON ARRIVAL,
 * measured:
 *
 *   • `164-04-PLAN.md` anchored edits at `v2/page.tsx:563-573` in a file that a
 *     previous plan had shrunk to 423 lines. The lines it described did not
 *     exist.
 *   • `164-03-PLAN.md` specified a two-argument `deriveShareToken(strategyId,
 *     generation)` against a source whose signature had grown a third
 *     parameter. Followed literally, it would have minted share links that fail
 *     verification.
 *
 * Both were caught by a human reading carefully. This script is that reading,
 * mechanized: every anchor is re-resolved and every bound quote is re-found,
 * and a miss is a non-zero exit with the file, the line, the claim and the
 * reason.
 *
 * ── HONEST SCOPE — READ THIS BEFORE TRUSTING IT ────────────────────────────
 * There are TWO invocation seams and they are NOT equally strong:
 *
 *   1. CI (machine, every PR). The `plan-anchor-verify` job runs
 *      `--pending` over every pending plan in the tree. This one is mechanical:
 *      nobody has to remember it.
 *   2. Execute time (convention, NOT mechanical). Each PLAN's first task is
 *      supposed to invoke `node scripts/verify-plan-anchors.mjs <plan-path>`
 *      and halt on non-zero. The installed gsd-core exposes no hook that could
 *      enforce this — `gsd_run loop render-hooks execute:wave:pre --raw`
 *      returns `"activeHooks": []` and registering one needs an undocumented
 *      capability manifest (measured 2026-08-29, RESEARCH §Q6) — and gsd-core
 *      is out of this repo's scope. So seam 2 is a PLANNER CONVENTION backed by
 *      seam 1, not a guarantee. Saying otherwise would be a claim about a
 *      control that nothing compares to the thing, which is this phase's whole
 *      subject.
 *
 * ── WHAT COUNTS AS A CLAIM (the grammar, RESEARCH §Q6) ─────────────────────
 * • ANCHOR-RANGE — `path:start` or `path:start-end`. The path resolves against
 *   the repo root, or (shorthand) against exactly one tracked file whose path
 *   ends with it. Fails when the path resolves to nothing, resolves
 *   ambiguously, or the range falls outside the file's line count.
 * • ANCHOR-QUOTE — a backtick-quoted snippet on the anchor's own line (after
 *   it) or on the line immediately below binds a CONTENT claim to that range.
 *   Fails when the snippet is not inside the range; the message says whether it
 *   moved (and to which line) or is gone entirely.
 * • SYMBOL-PRAGMA — `<!-- verify-symbol: <path> <symbol> -->`, an opt-in
 *   existence claim: `<symbol>` must appear somewhere in `<path>`.
 *   ⚠️ Deliberately opt-in. A heuristic that treated every backticked
 *   identifier near a path as an existence claim would fire on the thing plans
 *   mostly contain — names of code that does NOT exist yet — so it would be
 *   wrong far more often than right.
 * • CONTEXT-REF — a line beginning `@<path>`, the GSD convention for "the
 *   executor must read this". An in-repo target that does not exist means the
 *   executor reads nothing and never notices. Refs starting `~`, `/` or `$`
 *   point outside the repo and are ignored.
 *
 * ── WHAT IS DELIBERATELY NOT A CLAIM ───────────────────────────────────────
 * A path-like token with NO line range is IGNORED (threat T-164.3-23). Plans
 * name historical paths, external paths and files they are about to create;
 * failing those would make the gate a nuisance that gets switched off, which is
 * a worse outcome than the drift it prevents. A line range is what turns a
 * mention into a claim about the tree as it is NOW.
 *
 * Anchors are recognised only for a known file extension (EXTENSIONS below).
 * This is a real limitation with a real reason: without it, `164.3:450-519` —
 * a phase number followed by a section range — parses as a path, and the gate
 * starts inventing failures. An anchor into an exotic extension is silently not
 * checked; that is stated here rather than discovered later.
 *
 * ── SCOPE BOUNDARY, stated rather than implied ─────────────────────────────
 * • TEXT ONLY. No database, no network, no secret, no execution. Hermetic: it
 *   cannot flake.
 * • Reads through `node:fs`, NEVER shell grep. This repo carries a MEASURED
 *   NUL-blind file (`src/lib/wizardErrors.test.ts`, deliberate NUL at line
 *   1572): ugrep skips the whole file and its exit 1 reads as "clean". An
 *   anchor into such a file must still resolve, and
 *   `src/__tests__/verify-plan-anchors.test.ts` pins that in both polarities.
 * • "COULD NOT MEASURE" AND "MEASURED ZERO" ARE DIFFERENT ANSWERS. A named plan
 *   file that does not exist, an empty argument list, or a `.planning/phases`
 *   tree containing NO plan files at all are all MEASURE_FAIL and exit 1. They
 *   are never reported as "0 misses" — an empty scan and a clean scan look
 *   identical to every numeric test, and that is exactly how a broken glob
 *   passes for a green board.
 *   ⚠️ Zero PENDING plans while plan files DO exist is a genuine measurement
 *   (every plan has been executed) and exits 0, printing the counts.
 * • PENDING PLANS ONLY, in `--pending` mode. A plan with a sibling SUMMARY has
 *   been executed; its anchors describe a tree that has legitimately moved on
 *   since, and re-checking them would pin the corpus to a frozen past and read
 *   as permanently green work.
 *
 * ── USAGE (CI pastes these lines VERBATIM — mode identity, RESEARCH Pitfall 2)
 *   node scripts/verify-plan-anchors.mjs --self-test   # the engine's own fixtures
 *   node scripts/verify-plan-anchors.mjs --pending     # every pending plan in the tree
 *   node scripts/verify-plan-anchors.mjs <plan.md>...  # named plans (the execute-time seam)
 *
 *   --root <dir> retargets the tree. It exists for the fixtures and the
 *   self-test; the CI invocation never passes it.
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const SCRIPT_REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The claim kinds this verifier ships. Pinned EXACTLY by
 * `src/__tests__/verify-plan-anchors.test.ts`: adding one reds the suite until
 * it has red AND green coverage there, and dropping one reds it immediately.
 */
export const CLAIM_KINDS = ["anchor-range", "anchor-quote", "symbol-pragma", "context-ref"];

/**
 * Extensions a `path:line` token must carry to be read as an anchor. See the
 * header: without this list a version or phase number parses as a path.
 */
const EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|json|sql|yml|yaml|sh|bash|py|md|css|scss|html|toml|txt|tf|rs|go|rb|java|kt|swift|c|h|cpp";

/**
 * `path:start[-end]`. The lookbehind stops a match mid-token (so `164.3` in
 * `v164.3:450` cannot become a path), and the trailing lookahead stops a match
 * inside a longer number or a dotted version.
 */
const ANCHOR_RE = new RegExp(
  `(?<![\\w/.@$-])((?:[A-Za-z0-9_.@-]+/)*[A-Za-z0-9_.@-]+\\.(?:${EXTENSIONS})):(\\d+)(?:-(\\d+))?(?![\\d.])`,
  "g",
);

/** `<!-- verify-symbol: <path> <symbol> -->` */
const SYMBOL_PRAGMA_RE = /<!--\s*verify-symbol:\s*(\S+)\s+(\S+)\s*-->/;

/** A leading `@<path>` context reference (the GSD "read this" convention). */
const CONTEXT_REF_RE = /^\s*@(\S+)\s*$/;

/** Backtick spans, the carrier of a content claim. */
const BACKTICK_RE = /`([^`]+)`/g;

/** A backtick span that is itself a path or an anchor is a locator, not a quote. */
const LOCATOR_SPAN_RE = new RegExp(`^[^\\s]+\\.(?:${EXTENSIONS})(?::\\d+(?:-\\d+)?)?$`);

/** Shortest snippet accepted as a content claim. Below this it is noise. */
const MIN_QUOTE_LENGTH = 4;

/** Directories never walked when resolving a shorthand anchor. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "coverage",
  "dist",
  "build",
  "out",
  ".turbo",
  ".vercel",
  "playwright-report",
  "test-results",
  ".venv",
  "venv",
  "__pycache__",
]);

const norm = (s) => s.replace(/\s+/g, " ").trim();

// ───────────────────────────────────────────────────────────────────────────
// Tree access. Every read goes through node:fs — see the header's NUL note.
// ───────────────────────────────────────────────────────────────────────────

function readText(abs) {
  return readFileSync(abs, "utf8");
}

/**
 * A lazily-built index of the tree's files, used ONLY to resolve a shorthand
 * anchor (`ci.yml:10` for `.github/workflows/ci.yml`). Lazy on purpose: a plan
 * corpus with no shorthand anchors never pays for the walk.
 */
function createIndex(root) {
  let files = null;
  return {
    suffixMatches(path) {
      if (files === null) {
        files = [];
        const walk = (dir) => {
          let entries;
          try {
            entries = readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const abs = join(dir, entry.name);
            if (entry.isDirectory()) walk(abs);
            else if (entry.isFile()) files.push(relative(root, abs).split("\\").join("/"));
          }
        };
        walk(root);
      }
      return files.filter((f) => f === path || f.endsWith("/" + path));
    },
  };
}

/**
 * Resolve an anchor path. Exact-from-root first, then a unique suffix match.
 * Returns `{ rel }`, `{ ambiguous: [...] }` or `{ missing: true }`.
 */
function resolveAnchorPath(root, path, index) {
  const direct = join(root, path);
  if (existsSync(direct) && statSync(direct).isFile()) return { rel: path };
  const matches = index.suffixMatches(path);
  if (matches.length === 1) return { rel: matches[0] };
  if (matches.length > 1) return { ambiguous: matches };
  return { missing: true };
}

// ───────────────────────────────────────────────────────────────────────────
// Claim extraction
// ───────────────────────────────────────────────────────────────────────────

function anchorsOnLine(line) {
  const found = [];
  ANCHOR_RE.lastIndex = 0;
  let m;
  while ((m = ANCHOR_RE.exec(line)) !== null) {
    found.push({
      raw: m[0],
      path: m[1],
      start: Number(m[2]),
      end: m[3] === undefined ? Number(m[2]) : Number(m[3]),
      at: m.index,
      to: m.index + m[0].length,
    });
  }
  return found;
}

/** The first backtick span in [from, to) that is a content claim, not a locator. */
function contentSpanIn(line, from, to) {
  if (!line) return null;
  BACKTICK_RE.lastIndex = 0;
  let m;
  while ((m = BACKTICK_RE.exec(line)) !== null) {
    if (m.index < from) continue;
    if (m.index >= to) return null;
    const body = m[1].trim();
    if (body.length < MIN_QUOTE_LENGTH) continue;
    if (LOCATOR_SPAN_RE.test(body)) continue;
    return body;
  }
  return null;
}

/**
 * The quote bound to an anchor: the first content span after it on its own
 * line (stopping at the next anchor, so two anchors on one line cannot both
 * claim the same snippet), else — only if it is the last anchor on its line —
 * the first content span on the line below, stopping at that line's first
 * anchor.
 */
function boundQuote(lines, lineIndex, anchor, sameLineAnchors) {
  const line = lines[lineIndex];
  const later = sameLineAnchors.filter((a) => a.at >= anchor.to).map((a) => a.at);
  const stop = later.length ? Math.min(...later) : line.length;
  const sameLine = contentSpanIn(line, anchor.to, stop);
  if (sameLine) return sameLine;
  if (later.length) return null;

  const next = lines[lineIndex + 1];
  if (next === undefined) return null;
  const nextAnchors = anchorsOnLine(next);
  const nextStop = nextAnchors.length ? nextAnchors[0].at : next.length;
  return contentSpanIn(next, 0, nextStop);
}

/**
 * Whitespace-normalize a run of lines into one searchable string, keeping a map
 * from character offset back to the ORIGINAL line number. Blank lines are
 * dropped rather than joined as empty, so a quote that spans a blank line still
 * matches and still reports the line it actually starts on.
 */
function flatten(lines, fromIndex = 0, toIndex = lines.length) {
  const chunks = [];
  const lineOf = [];
  const offsets = [];
  let offset = 0;
  for (let i = fromIndex; i < toIndex && i < lines.length; i++) {
    const text = norm(lines[i]);
    if (!text) continue;
    if (chunks.length) offset += 1; // the joining space
    chunks.push(text);
    lineOf.push(i + 1);
    offsets.push(offset);
    offset += text.length;
  }
  return { text: chunks.join(" "), lineOf, offsets };
}

/**
 * The line (1-based) at which `quote` first appears, whitespace-normalized and
 * possibly spanning several lines. `null` when it is nowhere in the range.
 */
function findQuoteLine(lines, quote, fromIndex = 0, toIndex = lines.length) {
  const needle = norm(quote);
  if (!needle) return null;
  const flat = flatten(lines, fromIndex, toIndex);
  const at = flat.text.indexOf(needle);
  if (at === -1) return null;
  let line = flat.lineOf[0] ?? null;
  for (let i = 0; i < flat.offsets.length; i++) {
    if (flat.offsets[i] <= at) line = flat.lineOf[i];
    else break;
  }
  return line;
}

// ───────────────────────────────────────────────────────────────────────────
// Verification
// ───────────────────────────────────────────────────────────────────────────

function miss(plan, line, kind, code, claim, reason) {
  return { plan, line, kind, code, claim, reason };
}

/**
 * Verify one plan file. Returns `{ claims, misses }`. NEVER throws on a claim
 * failure and never stops at the first one: aggregation is the point (a plan
 * with five stale anchors should cost one run, not five).
 */
export function verifyPlan(planAbs, options = {}) {
  const root = options.root ?? SCRIPT_REPO_ROOT;
  const index = options.index ?? createIndex(root);
  const planRel = relative(root, planAbs).split("\\").join("/");
  const lines = readText(planAbs).split("\n");
  const misses = [];
  let claims = 0;

  // Cache per target file so a plan with 20 anchors into one file reads it once.
  const cache = new Map();
  const linesOf = (rel) => {
    if (!cache.has(rel)) cache.set(rel, readText(join(root, rel)).split("\n"));
    return cache.get(rel);
  };

  lines.forEach((line, i) => {
    const lineNo = i + 1;

    const pragma = SYMBOL_PRAGMA_RE.exec(line);
    if (pragma) {
      claims += 1;
      const [, path, symbol] = pragma;
      const target = join(root, path);
      if (!existsSync(target) || !statSync(target).isFile()) {
        misses.push(
          miss(
            planRel,
            lineNo,
            "symbol-pragma",
            "path-unresolved",
            `${path} ${symbol}`,
            `verify-symbol names ${path}, which is not a file in the tree.`,
          ),
        );
      } else if (!readText(target).includes(symbol)) {
        misses.push(
          miss(
            planRel,
            lineNo,
            "symbol-pragma",
            "symbol-absent",
            `${path} ${symbol}`,
            `\`${symbol}\` does not appear anywhere in ${path}.`,
          ),
        );
      }
    }

    const ctx = CONTEXT_REF_RE.exec(line);
    if (ctx) {
      const ref = ctx[1];
      const outside = ref.startsWith("~") || ref.startsWith("/") || ref.startsWith("$");
      if (!outside && /\.[A-Za-z0-9]+$/.test(ref)) {
        claims += 1;
        if (!existsSync(join(root, ref))) {
          misses.push(
            miss(
              planRel,
              lineNo,
              "context-ref",
              "context-ref-missing",
              `@${ref}`,
              `the plan tells the executor to read ${ref}, which does not exist. An @-reference that does not resolve is read as nothing, silently.`,
            ),
          );
        }
      }
    }

    const anchors = anchorsOnLine(line);
    for (const anchor of anchors) {
      claims += 1;
      const resolved = resolveAnchorPath(root, anchor.path, index);

      if (resolved.missing) {
        misses.push(
          miss(
            planRel,
            lineNo,
            "anchor-range",
            "path-unresolved",
            anchor.raw,
            `${anchor.path} does not resolve to a file in the tree (a path-like token with NO line range would have been ignored; a line range makes it a claim about the tree as it is now).`,
          ),
        );
        continue;
      }
      if (resolved.ambiguous) {
        misses.push(
          miss(
            planRel,
            lineNo,
            "anchor-range",
            "path-ambiguous",
            anchor.raw,
            `${anchor.path} matches ${resolved.ambiguous.length} files (${resolved.ambiguous.join(", ")}). Write the path from the repo root.`,
          ),
        );
        continue;
      }

      const targetLines = linesOf(resolved.rel);
      // A trailing newline yields a final empty element; it is not a line.
      const lineCount =
        targetLines.length > 0 && targetLines[targetLines.length - 1] === ""
          ? targetLines.length - 1
          : targetLines.length;

      if (anchor.start < 1 || anchor.end < anchor.start) {
        misses.push(
          miss(
            planRel,
            lineNo,
            "anchor-range",
            "range-out-of-bounds",
            anchor.raw,
            `the range ${anchor.start}-${anchor.end} is not a range.`,
          ),
        );
        continue;
      }
      if (anchor.end > lineCount) {
        misses.push(
          miss(
            planRel,
            lineNo,
            "anchor-range",
            "range-out-of-bounds",
            anchor.raw,
            `${resolved.rel} has ${lineCount} lines; the anchor claims line ${anchor.end}. This is the measured 164-04 shape: the file shrank and the plan did not.`,
          ),
        );
        continue;
      }

      const quote = boundQuote(lines, i, anchor, anchors);
      if (!quote) continue;
      claims += 1;

      if (findQuoteLine(targetLines, quote, anchor.start - 1, anchor.end) !== null) continue;

      const where = findQuoteLine(targetLines, quote);
      if (where === null) {
        misses.push(
          miss(
            planRel,
            lineNo,
            "anchor-quote",
            "quote-absent",
            quote,
            `the quote does not appear anywhere in ${resolved.rel}. This is the measured 164-03 shape: the plan describes code that is no longer there.`,
          ),
        );
      } else {
        misses.push(
          miss(
            planRel,
            lineNo,
            "anchor-quote",
            "quote-outside-range",
            quote,
            `the quote is in ${resolved.rel} at line ${where}, outside the claimed range ${anchor.start}-${anchor.end}.`,
          ),
        );
      }
    }
  });

  return { claims, misses };
}

/**
 * Verify a list of plan files. `measureFail` is separate from `misses` on
 * purpose: "I could not look" must never be reported as "I looked and found
 * nothing".
 */
export function verifyPaths(planPaths, options = {}) {
  const root = options.root ?? SCRIPT_REPO_ROOT;
  const measureFails = [];
  const misses = [];
  let scanned = 0;
  let claims = 0;

  if (!planPaths.length) {
    return {
      scanned: 0,
      claims: 0,
      misses: [],
      measureFail: true,
      measureFails: [
        "no plan files to scan. An empty input set produces zero misses, which is indistinguishable from a clean run — so it is a measurement failure, not a pass.",
      ],
    };
  }

  const index = createIndex(root);
  for (const path of planPaths) {
    const abs = isAbsolute(path) ? path : resolve(root, path);
    if (!existsSync(abs)) {
      measureFails.push(`${path} does not exist, so nothing about it was checked.`);
      continue;
    }
    scanned += 1;
    const result = verifyPlan(abs, { root, index });
    claims += result.claims;
    misses.push(...result.misses);
  }

  return { scanned, claims, misses, measureFail: measureFails.length > 0, measureFails };
}

/**
 * True when a PLAN carries an EXPLICIT, dated deferral rather than a SUMMARY.
 *
 * WR-06: "pending" was defined solely as "a `*-PLAN.md` with no sibling
 * `*-SUMMARY.md`", which has no terminal state for a plan a founder decided
 * NOT to execute. Phase 164.3's plan 07 is exactly that: deferred 2026-08-29
 * on a measurement (the migration chain does not replay from empty), so it can
 * never acquire a SUMMARY, and it therefore sat in the scanned set forever —
 * coupling every unrelated PR's required `frontend` check to its anchors. The
 * only exit available was to FABRICATE a SUMMARY for work nobody did.
 *
 * Two markers are honoured, and BOTH require a written record rather than a
 * flag, so the exemption costs the same as the honesty it stands in for:
 *
 *   1. a sibling `<n>-DEFERRED.md` with non-whitespace content, or
 *   2. `status: deferred` in the PLAN's own YAML frontmatter.
 *
 * ⚠️ An exemption mechanism is a way to silence a gate, so it is never silent:
 * every exempted plan is PRINTED with its marker, and an EMPTY `-DEFERRED.md`
 * does not count — a marker with no reason in it is the checkbox this phase
 * exists to distrust.
 */
/**
 * What a deferral marker must SAY to be one.
 *
 * ⛔ R2-W05. "non-whitespace content" is satisfied by a one-byte file, and both
 * markers are writable by the same PR that adds the plan. That is a
 * self-service switch, not a record — and this phase's whole subject is the
 * difference between a checkbox and a measurement.
 *
 * A deferral is a dated decision with an owner. Requiring the marker to carry
 * both makes the exemption cost what the honesty costs, and makes it legible to
 * a machine rather than only to a log reader: a marker that names no phase can
 * never be chased, and one that carries no date can never be shown to be stale.
 *
 * MEASURED 2026-08-29: the one marker that exists, `164.3-07-DEFERRED.md`,
 * satisfies both — so this refuses nothing real while making the next one cost
 * a sentence.
 */
const MARKER_DATE = /\b20\d{2}-\d{2}-\d{2}\b/;
const MARKER_OWNER = /\bPhase\s+\d+(\.\d+)?\b/i;

function deferralMarker(absDir, planName) {
  const deferredName = planName.replace(/-PLAN\.md$/, "-DEFERRED.md");
  const deferredPath = join(absDir, deferredName);
  if (existsSync(deferredPath)) {
    let body = "";
    try {
      body = readFileSync(deferredPath, "utf8");
    } catch {
      // Unreadable is NOT deferred. Fall through and let it stay pending.
      return null;
    }
    // ⚠️ A marker that fails these does NOT exempt: the plan stays pending and
    // its anchors keep being checked. Failing towards MORE scanning is the only
    // safe direction for a switch whose whole purpose is to switch a gate off.
    if (body.trim().length > 0 && MARKER_DATE.test(body) && MARKER_OWNER.test(body)) {
      return deferredName;
    }
  }

  let text = "";
  try {
    text = readFileSync(join(absDir, planName), "utf8");
  } catch {
    return null;
  }
  if (!text.startsWith("---")) return null;
  const close = text.indexOf("\n---", 3);
  if (close === -1) return null;
  const frontmatter = text.slice(0, close);
  if (/^status:[ \t]*deferred[ \t]*$/m.test(frontmatter)) return "frontmatter status: deferred";
  return null;
}

/**
 * Pending plans: `*-PLAN.md` under a phase directory of `.planning/phases/`
 * with NO sibling `*-SUMMARY.md` and no explicit deferral marker. An executed
 * plan is archival — its anchors describe a tree that has legitimately moved
 * on, and scanning it would pin the corpus to a frozen past.
 *
 * ── CR-02: "could not locate the corpus" vs "the corpus is archived" ────────
 * This function used to MEASURE_FAIL whenever it found zero `*-PLAN.md` files,
 * reasoning that zero-plans-therefore-zero-pending is a broken glob. That is
 * right for a broken glob and WRONG for the state `/gsd-complete-milestone`
 * produces: it moves every phase directory into
 * `.planning/milestones/v{X.Y}-phases/`, leaving `.planning/phases/`
 * legitimately empty. This repo has already produced that state once
 * (`e9a57671`). Under the old rule the gate then exited 1 on EVERY PR until
 * someone created a phase directory, and the only remedy available to the
 * person hitting it was to disable the job.
 *
 * The two states are now kept apart by what they are: a corpus that cannot be
 * LOCATED OR READ is a MEASURE_FAIL; a corpus that is present and readable and
 * holds zero plans is a MEASURED zero, reported explicitly as such and passed.
 * ⛔ Note what did NOT change: the zero is only accepted after the directory
 * has actually been opened and every entry enumerated. An `existsSync` that is
 * never followed by a read would be the same "unmeasured reads as zero" defect
 * wearing the opposite sign.
 */
export function findPendingPlans(root) {
  const phasesDir = join(root, ".planning", "phases");
  const rel = relative(root, phasesDir).split("\\").join("/");
  if (!existsSync(phasesDir)) {
    return {
      planFiles: 0,
      pending: [],
      deferred: [],
      corpusState: "unlocatable",
      measureFail: true,
      measureReason: `${rel} does not exist — the plan corpus could not be located at all.`,
    };
  }

  let topLevel;
  try {
    topLevel = readdirSync(phasesDir, { withFileTypes: true });
  } catch (err) {
    return {
      planFiles: 0,
      pending: [],
      deferred: [],
      corpusState: "unreadable",
      measureFail: true,
      measureReason: `${rel} exists but could NOT be read (${err?.code ?? err?.message ?? "unknown error"}). An unreadable corpus is not an empty one.`,
    };
  }

  let planFiles = 0;
  const pending = [];
  const deferred = [];
  for (const dir of topLevel) {
    if (!dir.isDirectory()) continue;
    const abs = join(phasesDir, dir.name);
    let entries;
    try {
      entries = readdirSync(abs);
    } catch (err) {
      return {
        planFiles: 0,
        pending: [],
        deferred: [],
        corpusState: "unreadable",
        measureFail: true,
        measureReason: `${rel}/${dir.name} exists but could NOT be read (${err?.code ?? err?.message ?? "unknown error"}). Skipping it would let an unreadable phase report as a phase with no plans.`,
      };
    }
    for (const name of entries) {
      if (!name.endsWith("-PLAN.md")) continue;
      planFiles += 1;
      const relPath = join(".planning", "phases", dir.name, name).split("\\").join("/");
      const summary = name.replace(/-PLAN\.md$/, "-SUMMARY.md");
      if (existsSync(join(abs, summary))) continue;
      const marker = deferralMarker(abs, name);
      if (marker !== null) {
        deferred.push({ plan: relPath, marker });
        continue;
      }
      pending.push(relPath);
    }
  }
  pending.sort();
  deferred.sort((a, b) => (a.plan < b.plan ? -1 : a.plan > b.plan ? 1 : 0));

  return {
    planFiles,
    pending,
    deferred,
    // MEASURED zero, not assumed: `phasesDir` was opened, every entry
    // enumerated, and every phase directory read.
    corpusState: planFiles === 0 ? "archived" : "populated",
    measureFail: false,
    measureReason: null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Self-test: the engine's own red/green fixtures, runnable in CI.
//
// The corpus can legitimately contain zero range anchors on any given day (it
// did on 2026-08-29, measured). A corpus scan that reports "0 misses" then
// tells you nothing unless the rules can still fire — so CI runs this FIRST,
// exactly as the `sql-gate-lint` job does.
// ───────────────────────────────────────────────────────────────────────────

export function selfTest() {
  const scratch = mkdtempSync(join(tmpdir(), "verify-plan-anchors-selftest-"));
  const failures = [];
  const write = (rel, content) => {
    const abs = join(scratch, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };

  try {
    // The measured 164-04 shape: a file of EXACTLY 423 lines, anchored at 563-573.
    write(
      "src/page.tsx",
      Array.from({ length: 423 }, (_, i) => `const l${i + 1} = ${i + 1};`).join("\n") + "\n",
    );
    // The measured 164-03 shape: a three-argument signature, quoted as two.
    write(
      "src/token.ts",
      ["export function deriveShareToken(", "  a, b, c", ") {}", ""].join("\n"),
    );
    write(
      ".planning/phases/00-selftest/00-01-PLAN.md",
      "Edit src/page.tsx:563-573 to hoist the helper.\n",
    );
    write(
      ".planning/phases/00-selftest/00-02-PLAN.md",
      "See `src/token.ts:1-3`:\n`deriveShareToken(a, b)` is the signature.\n",
    );
    write(
      ".planning/phases/00-selftest/00-03-PLAN.md",
      "See `src/page.tsx:1-3` and `src/token.ts:1-3` — both real.\n",
    );

    const expect = (label, actual, wanted) => {
      if (actual !== wanted) failures.push(`${label}: expected ${wanted}, got ${actual}`);
    };

    const red1 = verifyPaths([".planning/phases/00-selftest/00-01-PLAN.md"], { root: scratch });
    expect("423-line range fixture miss count", red1.misses.length, 1);
    expect("423-line range fixture code", red1.misses[0]?.code, "range-out-of-bounds");

    const red2 = verifyPaths([".planning/phases/00-selftest/00-02-PLAN.md"], { root: scratch });
    expect("stale-signature fixture miss count", red2.misses.length, 1);
    expect("stale-signature fixture code", red2.misses[0]?.code, "quote-absent");

    const green = verifyPaths([".planning/phases/00-selftest/00-03-PLAN.md"], { root: scratch });
    expect("green fixture miss count", green.misses.length, 0);
    expect("green fixture measureFail", green.measureFail, false);
    if (green.claims < 2) failures.push(`green fixture checked ${green.claims} claims, expected >= 2`);

    // "Could not measure" must not read as "measured zero".
    const empty = verifyPaths([], { root: scratch });
    expect("empty input measureFail", empty.measureFail, true);
    const absent = verifyPaths([".planning/phases/00-selftest/nope-PLAN.md"], { root: scratch });
    expect("absent plan measureFail", absent.measureFail, true);
    expect("absent plan scanned", absent.scanned, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failures.length) {
    for (const f of failures) console.error(`SELF-TEST FAIL: ${f}`);
    console.error(
      "SELF-TEST FAIL: the verifier no longer flags a failure shape it was built to flag. A control that cannot fail is worse than no control.",
    );
    return 1;
  }
  console.log(
    "SELF-TEST OK: both measured failure shapes fire (423-line range, stale two-argument signature), the green fixture passes, and an unmeasurable input reports MEASURE_FAIL rather than zero misses.",
  );
  return 0;
}

// ───────────────────────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────────────────────

function report(result) {
  for (const m of result.misses) {
    console.error(`MISS ${m.plan}:${m.line} [${m.code}] ${m.claim}`);
    console.error(`     ${m.reason}`);
  }
  console.log(`claims: ${result.claims} checked`);
  for (const reason of result.measureFails ?? []) {
    console.error(`MEASURE_FAIL: ${reason}`);
  }
  if (result.measureFail) return 1;
  if (result.misses.length) {
    console.error(
      `FAIL: ${result.misses.length} stale claim(s) across ${result.scanned} plan file(s). Fix the PLAN — a plan is a claim about the tree, and a stale one sends an executor at code that is not there.`,
    );
    return 1;
  }
  console.log(`OK: ${result.scanned} plan file(s), no stale claims.`);
  return 0;
}

function main(argv) {
  const args = [...argv];
  let root = SCRIPT_REPO_ROOT;
  const rootAt = args.indexOf("--root");
  if (rootAt !== -1) {
    root = resolve(args[rootAt + 1] ?? "");
    args.splice(rootAt, 2);
  }

  if (args.includes("--self-test")) return selfTest();

  if (args.includes("--pending")) {
    const found = findPendingPlans(root);
    if (found.measureFail) {
      console.error(`MEASURE_FAIL: ${found.measureReason}`);
      return 1;
    }
    console.log(`scanned: ${found.pending.length} pending plan file(s) of ${found.planFiles}`);
    // The exemptions are never silent — a deferral nobody can see is a way to
    // switch this gate off one plan at a time (WR-06).
    console.log(`deferred: ${found.deferred.length} plan file(s) exempted by an explicit deferral marker`);
    for (const d of found.deferred) console.log(`  deferred: ${d.plan}  [${d.marker}]`);
    if (found.corpusState === "archived") {
      // CR-02: this is the post-/gsd-complete-milestone state, and it is a
      // MEASURED zero — the directory was opened and every entry enumerated.
      // It is printed on its own line precisely so a reader (and the CI
      // assertion) can tell it apart from a corpus that could not be read,
      // which is still a MEASURE_FAIL above.
      console.log(
        "measured-zero: .planning/phases exists, was READ, and contains 0 *-PLAN.md file(s) — every phase directory has been archived into .planning/milestones/. This is a clean corpus, not a broken glob.",
      );
    }
    if (found.pending.length === 0) {
      // A genuine measurement, not a broken glob: the corpus was read and
      // every plan in it is terminal (executed, or explicitly deferred).
      console.log("claims: 0 checked");
      console.log(
        `OK: 0 pending plan file(s) of ${found.planFiles}, no stale claims. Every plan in the tree has a SUMMARY or an explicit deferral.`,
      );
      return 0;
    }
    for (const p of found.pending) console.log(`  pending: ${p}`);
    return report(verifyPaths(found.pending, { root }));
  }

  const paths = args.filter((a) => !a.startsWith("--"));
  if (!paths.length) {
    console.error(
      "MEASURE_FAIL: no plan files given. Usage: node scripts/verify-plan-anchors.mjs [--pending | --self-test | <plan.md>...]",
    );
    return 1;
  }
  console.log(`scanned: ${paths.length} plan file(s) named on the command line`);
  return report(verifyPaths(paths, { root }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
