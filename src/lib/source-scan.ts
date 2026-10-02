/**
 * Phase 140.5 / SEAMPROSE-04 — ONE comment handler for every structural guard.
 *
 * WHY THIS MODULE EXISTS. `grep -rn 'function stripComments' src/ tests/ tools/`
 * → 17 definitions at the time of writing, with THREE different semantics
 * (block comments removed vs blanked; line numbers preserved vs not; string
 * contents erased vs kept). A scanner replicated 17 times has 17 places to
 * drift, and a guard whose scanner has drifted reads as protection while
 * measuring nothing. Four guards written in this phase import this module, so
 * its semantics are a CONTRACT, not an implementation detail.
 *
 * COVERAGE-LAW ROW. **Row 1 for its importers** — one shared artefact, so a
 * tokenizer fix reaches every guard that calls it without an edit. It is
 * explicitly **NOT** a repo-wide closure: the 17 existing in-repo copies are
 * NOT rewired by this phase and remain what they were. That consolidation is
 * deferred and named in `140.5-01-SUMMARY.md`.
 *
 * WHY COMMENT HANDLING AT ALL (DEF-16-2). grep is line-based, and this
 * milestone's subject matter is prose, so a needle is MORE likely to appear in
 * a comment than anywhere else. Measured specimens:
 *   - widening `ci.yml:1633` to `src/**` reddens a clean tree on exactly one
 *     hit, and that hit is a COMMENT (`ResponsiveChartFrame.test.tsx:6`);
 *   - `seam-copy.purity.test.ts:39-45` records that the leaf's own docblock
 *     would satisfy the purity needles if the source were not stripped first.
 * A count taken without stripping is not a count.
 *
 * ---------------------------------------------------------------------------
 * THE TWO FUNCTIONS ARE DUALS OVER ONE TOKENIZER.
 *
 * `stripCommentsPreserveLines` blanks exactly the spans that `extractComments`
 * returns. That is deliberate: a guard that counts occurrences uses the strip;
 * a guard that reads what the prose CLAIMS (a citation lives inside a comment)
 * uses the extract. Two implementations would be two places to drift, which is
 * the defect this module closes.
 *
 * SEMANTICS, stated so an importer does not have to read the code:
 *
 *  1. LINE-PRESERVING. Comment characters are replaced by SPACES, one for one;
 *     newlines inside a block comment survive. `wc -l` of the output equals
 *     `wc -l` of the input and every surviving character keeps its column, so a
 *     line/column a guard reports is the real one. This is
 *     `seam-log-coverage.test.ts:299-305`'s variant, NOT
 *     `seam-copy.purity.test.ts:55-61`'s (which DELETES block comments and
 *     therefore cannot report a location — PATTERNS §2 names picking the wrong
 *     one of the two as a live hazard).
 *
 *  2. STRING CONTENTS SURVIVE, in both directions. `const s = "// x"` keeps
 *     `// x`, and `extractComments` does NOT return it. A `//` inside a string
 *     is not a comment; a citation inside a string literal is not a citation
 *     about this repo. ⚠️ This is the one place this module deliberately
 *     DIFFERS from `scripts/check-route-contract.ts:47-52`, whose tokenizer
 *     also erases string bodies so that a `"/legal"` literal cannot satisfy a
 *     lockstep. A guard that needs THAT property needs a third mode; it is not
 *     this one, and adding it here silently would break the citation guards.
 *
 *  3. TRAILING COMMENTS ARE BLANKED. Both in-repo variants leave a trailing
 *     `//` in, on the stated grounds that doing so can only produce a FALSE
 *     POSITIVE. That reasoning is sound for an absence assertion and WRONG for
 *     a population count — this phase's guards do both. Blanking is the honest
 *     answer, and it costs the false-positive safety net: a guard built on this
 *     module MUST carry a vacuity fence (a hand-typed floor on what its scanner
 *     found), because a tokenizer bug here now fails SILENT rather than loud.
 *     `seam-log-coverage.test.ts:956-1037` is the fence to copy.
 *
 *  4. `extractComments` emits ONE ENTRY PER LINE OF COMMENT CONTENT, not one
 *     per comment. A block comment spanning lines 40-58 with a citation on 51
 *     yields an entry whose `line` is 51 — which is the whole point, since the
 *     consumer's job is to report where the rot is. Blank comment lines are not
 *     emitted (there is nothing to match).
 *
 *  5. `text` is the exact source slice that `stripCommentsPreserveLines` blanks
 *     on that line, INCLUDING the introducer (`// x`, `/*`, `"""`). The two
 *     functions therefore agree by construction rather than by convention.
 *
 * ---------------------------------------------------------------------------
 * TYPESCRIPT: the tokenizer tracks quote state, template literals (including
 * `${...}` interpolation, at any nesting depth) and REGEX LITERALS. The regex
 * half is not decoration. `.replace(/\/\*[\s\S]*?\*\//g, "")` — a line this
 * repo contains in three separate `stripComments` copies — holds the character
 * pair `//` inside the pattern, and a scanner without regex awareness reads it
 * as a line comment and blanks the rest of the REAL line. That is a scanner
 * going blind on the exact files these guards exist to watch.
 *
 * Regex-vs-division is decided by the preceding significant token, the standard
 * heuristic: a `/` opens a regex at the start of input, after one of
 * `( , = : [ ! & | ? { } ; + - * % ^ ~ < >`, or after a keyword that cannot end
 * an expression (`return`, `typeof`, `case`, …). ⚠️ KNOWN LIMIT, stated rather
 * than hidden: after `)` this module chooses DIVISION, so `if (x) /re/.test(s)`
 * is mis-tokenized. `(a + b) / 2` is common in this repo and a regex directly
 * after `)` is not; the failure mode of the other choice (swallowing real code
 * up to the next `/`) is worse. No occurrence of the mis-tokenized shape exists
 * on the surfaces these guards scan.
 *
 * PYTHON is deliberately MINIMAL and its limit is stated: `#` comments plus
 * triple-quoted strings. ⚠️ Every triple-quoted string is treated as a
 * docstring, including one used as a value (`SQL = """SELECT …"""`). That is
 * the same call `140.5-citation-census.mjs` made, and for a prose scanner it
 * errs toward reading MORE text as prose, which cannot hide a citation. A guard
 * that needs Python VALUE strings preserved needs a different mode.
 *
 * The census hit a docstring DOUBLE-EXTRACTION bug (RESEARCH §3.1 bug 3) and
 * fixed it with a dedup key. This module cannot reproduce that bug: the Python
 * scanner is a single pass over one state machine, so a `#` inside a docstring
 * is part of the docstring span and is emitted exactly once, by construction.
 * Dedup-after-the-fact would have hidden the same class of bug next time.
 */

/** One line's worth of comment content, with its 1-based line number. */
export interface CommentSpan {
  /** 1-based line number in the ORIGINAL source. */
  line: number;
  /** The exact source slice on that line that `stripCommentsPreserveLines` blanks. */
  text: string;
}

/** Languages this module tokenizes. Defaults to `"ts"` (covers .ts/.tsx/.js/.mjs). */
export type SourceLang = "ts" | "py";

/** Half-open `[start, end)` offsets of one comment span in the source. */
interface Span {
  start: number;
  end: number;
}

/**
 * Characters after which a `/` opens a REGEX rather than a division.
 * `}` is included (a block just closed); `)` is deliberately NOT — see the
 * KNOWN LIMIT in the module docblock.
 */
const REGEX_OPENS_AFTER_CHAR: ReadonlySet<string> = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*",
  "%", "^", "~", "<", ">",
]);

/** Keywords that cannot end an expression, so a following `/` opens a regex. */
const REGEX_OPENS_AFTER_KEYWORD: ReadonlySet<string> = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

function isIdentChar(c: string): boolean {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "_" ||
    c === "$"
  );
}

/**
 * Advance past a `'`/`"` string starting at `i`.
 *
 * An unterminated string stops at the newline rather than running to EOF: a
 * scanner that swallows the rest of the file on one stray quote is a scanner
 * that reports zero findings for the rest of the file.
 */
function skipQuoted(src: string, i: number): number {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === "\n") return j;
    j += 1;
  }
  return src.length;
}

/**
 * Advance past a regex literal starting at `i`, or return `i + 1` when the
 * token turns out not to be one (unterminated before the line ends). Character
 * classes are tracked because `/[/]/` is legal and its `/` does not close.
 */
function skipRegex(src: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "\n") return i + 1;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      j += 1;
      while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
      return j;
    }
    j += 1;
  }
  return i + 1;
}

function regexOpensHere(prevChar: string, prevWord: string): boolean {
  if (prevWord !== "") return REGEX_OPENS_AFTER_KEYWORD.has(prevWord);
  return prevChar === "" || REGEX_OPENS_AFTER_CHAR.has(prevChar);
}

/** TS/JS comment spans: `//` to end of line, and `/* … *\/` across lines. */
function commentSpansTs(src: string): Span[] {
  const spans: Span[] = [];
  const n = src.length;
  // A stack so `${ … }` inside a template can itself contain a template.
  const stack: Array<{ kind: "code"; brace: number } | { kind: "template" }> = [
    { kind: "code", brace: 0 },
  ];
  let prevChar = "";
  let prevWord = "";
  let i = 0;

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];

    if (top.kind === "template") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        stack.pop();
        prevChar = "`";
        prevWord = "";
        i += 1;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        stack.push({ kind: "code", brace: 0 });
        prevChar = "";
        prevWord = "";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (c === "/" && src[i + 1] === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j += 1;
      spans.push({ start: i, end: j });
      i = j;
      continue;
    }

    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close < 0 ? n : close + 2;
      spans.push({ start: i, end });
      i = end;
      continue;
    }

    if (c === '"' || c === "'") {
      i = skipQuoted(src, i);
      prevChar = c;
      prevWord = "";
      continue;
    }

    if (c === "`") {
      stack.push({ kind: "template" });
      i += 1;
      continue;
    }

    if (c === "/") {
      const after = regexOpensHere(prevChar, prevWord) ? skipRegex(src, i) : i + 1;
      i = after;
      prevChar = "/";
      prevWord = "";
      continue;
    }

    if (isIdentChar(c)) {
      let j = i;
      while (j < n && isIdentChar(src[j])) j += 1;
      prevWord = src.slice(i, j);
      prevChar = src[j - 1];
      i = j;
      continue;
    }

    if (c === "{") {
      top.brace += 1;
      prevChar = c;
      prevWord = "";
      i += 1;
      continue;
    }

    if (c === "}") {
      if (top.brace === 0 && stack.length > 1) {
        // Closes the `${` that opened this frame — back into the template.
        stack.pop();
      } else {
        top.brace -= 1;
      }
      prevChar = "}";
      prevWord = "";
      i += 1;
      continue;
    }

    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") {
      prevChar = c;
      prevWord = "";
    }
    i += 1;
  }

  return spans;
}

/** Advance past a `"""`/`'''` span opened at `i`; returns the offset after it. */
function skipPyTriple(src: string, i: number): number {
  const delim = src.slice(i, i + 3);
  let j = i + 3;
  while (j < src.length) {
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    if (src.startsWith(delim, j)) return j + 3;
    j += 1;
  }
  return src.length;
}

/** Python comment spans: `#` to end of line, plus every triple-quoted string. */
function commentSpansPy(src: string): Span[] {
  const spans: Span[] = [];
  const n = src.length;
  let i = 0;

  while (i < n) {
    const c = src[i];

    if (c === "#") {
      let j = i + 1;
      while (j < n && src[j] !== "\n") j += 1;
      spans.push({ start: i, end: j });
      i = j;
      continue;
    }

    if (c === '"' || c === "'") {
      if (src.startsWith(c + c + c, i)) {
        const end = skipPyTriple(src, i);
        spans.push({ start: i, end });
        i = end;
        continue;
      }
      i = skipQuoted(src, i);
      continue;
    }

    i += 1;
  }

  return spans;
}

function commentSpans(src: string, lang: SourceLang): Span[] {
  return lang === "py" ? commentSpansPy(src) : commentSpansTs(src);
}

/** 0-based offset → 1-based line number, via the source's newline offsets. */
function lineNumberLookup(src: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === "\n") starts.push(i + 1);
  }
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Blank every comment character, preserving line count and every column.
 *
 * String and template-literal contents are LEFT INTACT — a `//` inside a string
 * is not a comment. See the module docblock for the full contract and for the
 * vacuity-fence obligation this places on callers.
 */
export function stripCommentsPreserveLines(
  source: string,
  lang: SourceLang = "ts",
): string {
  const spans = commentSpans(source, lang);
  if (spans.length === 0) return source;

  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += source.slice(cursor, span.start);
    out += source.slice(span.start, span.end).replace(/[^\n]/g, " ");
    cursor = span.end;
  }
  out += source.slice(cursor);
  return out;
}

/**
 * The inverse: only the comment text, one entry per LINE, each with its real
 * 1-based line number. This is what a citation guard consumes — a citation
 * lives INSIDE a comment, and the guard has to say which line it is on.
 */
export function extractComments(
  source: string,
  lang: SourceLang = "ts",
): CommentSpan[] {
  const spans = commentSpans(source, lang);
  if (spans.length === 0) return [];

  const lineAt = lineNumberLookup(source);
  const out: CommentSpan[] = [];
  for (const span of spans) {
    let offset = span.start;
    for (const part of source.slice(span.start, span.end).split("\n")) {
      if (part.length > 0) out.push({ line: lineAt(offset), text: part });
      offset += part.length + 1;
    }
  }
  return out;
}
