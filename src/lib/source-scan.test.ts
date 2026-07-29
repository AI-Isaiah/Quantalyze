import { describe, it, expect } from "vitest";
import { stripCommentsPreserveLines, extractComments } from "./source-scan";

/**
 * Phase 140.5-01 / SEAMPROSE-04 — self-tests for the shared comment handler.
 *
 * WHY THIS FILE IS LOAD-BEARING. Four structural guards written in this phase
 * import `source-scan.ts`. A tokenizer bug here does not fail loud in those
 * guards — it makes them scan blanked-out code and report agreement forever,
 * which is the failure this milestone exists to stop ("a guard asserting an
 * ABSENCE reads as protection while doing nothing if its scanner breaks",
 * `seam-log-coverage.test.ts:962`). So the module's own tests are the only
 * place its blindness can be caught, and ledger row SC-SCAN-1 mutates the
 * module to prove they CAN fail.
 *
 * ORACLE INDEPENDENCE. Every input and every expected value below is a
 * hand-typed literal. Nothing is read back out of the module under test — no
 * constant is imported, no expectation is computed from the implementation, and
 * no assertion compares one of the two exports to the other (they share a
 * tokenizer, so `strip` vs `extract` agreement is a tautology, not evidence:
 * hazard #5, two derivations). Where the duality matters it is pinned with
 * literals typed independently on both sides.
 *
 * BOTH POLARITIES, EVERYWHERE. A comment handler has two ways to be wrong and
 * they are not symmetric: it can fail to blank a comment (a needle then matches
 * prose — DEF-16-2, the defect class) or it can blank real code (the guard goes
 * silently blind). Every case below therefore pins what MUST disappear and what
 * MUST survive.
 */

describe("[140.5-01 / SEAMPROSE-04] stripCommentsPreserveLines — TypeScript", () => {
  it("blanks a line comment without moving any surviving character", () => {
    const src = ["const a = 1; // set a", "// whole line", "const b = 2;"].join(
      "\n",
    );
    const out = stripCommentsPreserveLines(src);
    const lines = out.split("\n");

    // Line count preserved: a guard reporting "line 3" must mean line 3.
    expect(lines.length).toBe(3);
    // Column preservation: line 1 is 21 characters in and 21 characters out.
    expect(lines[0].length).toBe(21);
    expect(lines[1].length).toBe(13);

    expect(lines[0].startsWith("const a = 1;")).toBe(true);
    expect(lines[1].trim()).toBe("");
    expect(lines[2]).toBe("const b = 2;");
    expect(out).not.toContain("set a");
    expect(out).not.toContain("whole line");
  });

  it("leaves a `//` that lives inside a string literal completely alone", () => {
    // The negative polarity of the case above, and the reason a naive
    // line-based strip is not good enough: this `//` is DATA, not a comment.
    const src = 'const s = "// not a comment"; // real';
    const out = stripCommentsPreserveLines(src);

    expect(out).toContain('"// not a comment"');
    expect(out).not.toContain("real");
    expect(out.length).toBe(src.length);
  });

  it("keeps a three-line block comment three lines long", () => {
    const src = [
      "const before = 1;",
      "/* line one",
      "   line two",
      "   line three */",
      "const after = 2;",
    ].join("\n");
    const out = stripCommentsPreserveLines(src);
    const lines = out.split("\n");

    expect(lines.length).toBe(5);
    expect(lines[0]).toBe("const before = 1;");
    expect(lines[1].trim()).toBe("");
    expect(lines[2].trim()).toBe("");
    expect(lines[3].trim()).toBe("");
    expect(lines[4]).toBe("const after = 2;");
    expect(out).not.toContain("line two");
  });

  it("preserves the column of code that follows a block comment on one line", () => {
    // `/* c */` is 7 characters plus one space, so `const` starts at index 8
    // both before and after. A guard that reports a column reports this one.
    const src = "/* c */ const x = 1;";
    const out = stripCommentsPreserveLines(src);

    expect(out.indexOf("const x")).toBe(8);
    expect(out).not.toContain("/* c */");
  });

  it("leaves template-literal contents intact, interpolation included", () => {
    const src = [
      'const name = "x";',
      "const t = `path // not a comment ${name} tail`;",
      "// gone",
    ].join("\n");
    const out = stripCommentsPreserveLines(src);

    expect(out).toContain("`path // not a comment ${name} tail`");
    expect(out).not.toContain("gone");
  });

  it("treats the inside of `${ }` as CODE, so a comment there is blanked", () => {
    // The other half of the template contract: `${ … }` is an expression
    // position, so a comment inside it is a real comment.
    const src = "const t = `a ${ /* gone */ b } c`;";
    const out = stripCommentsPreserveLines(src);

    expect(out).not.toContain("gone");
    expect(out).toContain("`a ${");
    expect(out).toContain("b } c`;");
    expect(out.length).toBe(src.length);
  });

  it("does not mistake the `//` inside a REGEX literal for a comment", () => {
    // This exact line exists in three of the repo's 17 stripComments copies.
    // Without regex awareness the scanner reads `//g, "");` as a line comment
    // and blanks the rest of a REAL line — the scanner-goes-blind failure.
    const src = [
      'const stripped = src.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "");',
      "const keep = 42;",
    ].join("\n");
    const out = stripCommentsPreserveLines(src);

    expect(out).toBe(src);
  });

  it("recognises a regex after a keyword, and division after a value", () => {
    const regexAfterKeyword = "function f(s) { return /a\\/\\/b/.test(s); } // tail";
    const outRegex = stripCommentsPreserveLines(regexAfterKeyword);
    expect(outRegex).toContain("/a\\/\\/b/");
    expect(outRegex).not.toContain("tail");

    // The opposite call: `total / 2` is a division, so the `//` after it is
    // still a comment and must still be blanked.
    const division = "const half = total / 2; // halve";
    const outDivision = stripCommentsPreserveLines(division);
    expect(outDivision).toContain("const half = total / 2;");
    expect(outDivision).not.toContain("halve");
    expect(outDivision.length).toBe(division.length);
  });

  it("returns source with no comments byte-identical", () => {
    const src = "const a = 1;\nconst b = 2;\n";
    expect(stripCommentsPreserveLines(src)).toBe(src);
  });

  it("blanks an unterminated block comment to end of file without throwing", () => {
    const src = ["const a = 1;", "/* never closed", "still comment"].join("\n");
    const out = stripCommentsPreserveLines(src);

    expect(out.split("\n").length).toBe(3);
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("never closed");
    expect(out).not.toContain("still comment");
  });
});

describe("[140.5-01 / SEAMPROSE-04] stripCommentsPreserveLines — Python", () => {
  it("blanks `#` comments and docstrings but not string values", () => {
    const src = [
      "# cite runner.py:10",
      'x = "# not a comment"',
      "def f():",
      '    """Doc cites helper.py:20"""',
      "    return 1  # trailing",
    ].join("\n");
    const out = stripCommentsPreserveLines(src, "py");
    const lines = out.split("\n");

    expect(lines.length).toBe(5);
    expect(lines[0].trim()).toBe("");
    expect(lines[1]).toBe('x = "# not a comment"');
    expect(lines[2]).toBe("def f():");
    expect(lines[3].trim()).toBe("");
    expect(lines[4].startsWith("    return 1")).toBe(true);

    expect(out).not.toContain("cite runner.py:10");
    expect(out).not.toContain("helper.py:20");
    expect(out).not.toContain("trailing");
  });

  it("blanks a multi-line docstring without changing the line count", () => {
    const src = [
      "def g():",
      '    """',
      "    cites analytics_runner.py:1765",
      '    """',
      "    return 2",
    ].join("\n");
    const out = stripCommentsPreserveLines(src, "py");

    expect(out.split("\n").length).toBe(5);
    expect(out).not.toContain("analytics_runner.py:1765");
    expect(out).toContain("    return 2");
  });
});

describe("[140.5-01 / SEAMPROSE-04] extractComments", () => {
  it("returns comment lines with real 1-based numbers and skips string literals", () => {
    const src = [
      'const label = "see route.ts:42";', // 1 — a citation-shaped token in a STRING
      "// see route.ts:99", //               2 — the same shape in a comment
      "/*", //                               3
      " * block", //                         4
      " * see helper.ts:7", //               5
      " */", //                              6
      "const x = 1;", //                     7
    ].join("\n");

    const found = extractComments(src);

    // POSITIVE: every comment line, numbered as a reader would number it.
    expect(found.map((c) => c.line)).toEqual([2, 3, 4, 5, 6]);
    // The line number of a citation buried mid-block is the citation's line,
    // not the block's first line — the whole reason a guard can report rot.
    expect(found.find((c) => c.line === 5)?.text).toBe(" * see helper.ts:7");
    expect(found.find((c) => c.line === 2)?.text).toBe("// see route.ts:99");

    // NEGATIVE: the string literal on line 1 is not prose about this repo.
    expect(found.some((c) => c.text.includes("route.ts:42"))).toBe(false);
    expect(found.some((c) => c.line === 1)).toBe(false);
    expect(found.some((c) => c.line === 7)).toBe(false);
  });

  it("returns nothing for a source with no comments", () => {
    expect(extractComments('const a = "x";')).toEqual([]);
  });

  it("returns a Python docstring exactly once, hash inside it included", () => {
    // RESEARCH §3.1 bug 3: the census double-extracted docstrings because two
    // passes (one for `#`, one for triple quotes) both matched the same text.
    // One state machine cannot: a `#` inside a docstring IS the docstring.
    const src = [
      '"""Doc with a # hash and cite a.py:1"""', // 1
      "y = '# in a string'", //                    2
      "# real comment cites b.py:2", //            3
    ].join("\n");

    const found = extractComments(src, "py");

    expect(found.map((c) => c.line)).toEqual([1, 3]);
    expect(found.filter((c) => c.line === 1).length).toBe(1);
    expect(found[0].text).toBe('"""Doc with a # hash and cite a.py:1"""');
    expect(found[1].text).toBe("# real comment cites b.py:2");
    expect(found.some((c) => c.text.includes("in a string"))).toBe(false);
  });

  it("numbers every line of a multi-line Python docstring", () => {
    const src = [
      "def g():", //                              1
      '    """', //                               2
      "    cites analytics_runner.py:1765", //    3
      '    """', //                               4
    ].join("\n");

    const found = extractComments(src, "py");

    expect(found.map((c) => c.line)).toEqual([2, 3, 4]);
    expect(found.find((c) => c.line === 3)?.text).toBe(
      "    cites analytics_runner.py:1765",
    );
  });

  it("agrees with the strip on the same input, both sides typed by hand", () => {
    // Duality, pinned with INDEPENDENT literals rather than by comparing the
    // two functions to each other (which share a tokenizer and would agree for
    // any implementation, correct or not).
    const src = ["const x = 1;", "// cite route.ts:8", "const y = 2;"].join("\n");

    expect(extractComments(src)).toEqual([{ line: 2, text: "// cite route.ts:8" }]);

    const blankedLine = stripCommentsPreserveLines(src).split("\n")[1];
    expect(blankedLine.length).toBe(18);
    expect(blankedLine.trim()).toBe("");
  });
});
