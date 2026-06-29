/**
 * DS-04 — ban a `rem`-less CSS `clamp()` preferred term in TS/TSX string source.
 *
 * Phase 49's fluid type spine requires every `clamp()` to carry a `rem`
 * component in its PREFERRED (middle) term: `clamp(<rem-min>, <rem> + <vw>,
 * <rem-max>)`. A `vw`-only preferred term never re-scales under user zoom (the
 * viewport does not change when you zoom), failing WCAG 1.4.4 / F94. The
 * canonical `--text-*` clamps live in `globals.css` and are guarded by a Vitest
 * grep; THIS rule is the edit-time backstop for ad-hoc CSS `clamp()` strings
 * authored inside className / style props in component source.
 *
 * Detection — scoped to string/template-literal contexts only (Pitfall 3):
 * a string `Literal` or `TemplateElement` whose text contains a `clamp(...)`
 * call, where the MIDDLE (preferred) argument contains a viewport unit (`vw`)
 * but NO `rem`/`em` length. The middle term is the load-bearing one: a clamp
 * like `clamp(2rem, 3vw, 4rem)` has `rem` in its min/max bounds yet a `vw`-only
 * preferred term — that IS a violation (the zoom-unsafe shape), so a blunt
 * "string contains rem anywhere" check is insufficient. We split the args and
 * inspect the middle.
 *
 * Deliberately NO call-expression visitor (Pitfall 3): the numeric `Math`-style
 * `clamp(a, b, c)` helpers in `scenario-montecarlo.ts` / `peer-cohort.ts` are
 * pure number math, not CSS, and must NOT be flagged. The visitor map below
 * covers only `Literal` + `TemplateElement`, so a call to a local `clamp(...)`
 * identifier is invisible to this rule.
 *
 * Exemptions: any file carrying a `DS-04 sanctioned-exception:` comment (via
 * `fileHasMarker`), plus the eslint.config glob layer (chart / designer-bundle /
 * test exemptions).
 *
 * Ceiling: a text-shape backstop. A clamp string assembled at runtime from
 * fragments, or one using `cqw`/other viewport-relative units we don't enumerate,
 * is not caught — it trips the realistic literal `clamp(..., Nvw, ...)` shape.
 */
import { fileHasMarker } from "./_shared.mjs";

// A length carrying rem/em (the zoom-safe anchor). `\d` guards against matching
// e.g. a stray "rem" in prose; CSS lengths are number+unit.
const REM_EM = /\d(?:\.\d+)?(?:rem|em)\b/;
// A viewport unit in the preferred term (the zoom-unsafe driver). All of
// vw/vh/vmin/vmax track the viewport, not text-zoom, so a `3vh` preferred term
// is equally F94-unsafe as `3vw`. Deliberately NOT cqw: container-query units
// are an intentional, separately-scoped pattern, not a zoom-safety regression.
const VW_UNIT = /\d(?:\.\d+)?v(?:w|h|min|max)\b/;

const MESSAGE =
  "rem-less clamp(): the preferred (middle) term must include a rem/em component " +
  "(clamp(<rem-min>, <rem> + <vw>, <rem-max>)) so the text re-scales under zoom " +
  "(DS-04, WCAG 1.4.4 / F94). A vw-only preferred term never resizes on zoom. " +
  "Prefer a named --text-* token; for a one-off exception add a " +
  "`DS-04 sanctioned-exception:` comment in this file.";

/**
 * Split a clamp argument list into its top-level comma-separated terms,
 * respecting nested parens (e.g. `calc(...)`, `min(...)`). Returns the raw
 * argument substrings.
 *
 * @param {string} argText  the text BETWEEN the outermost clamp parens
 * @returns {string[]}
 */
function splitTopLevelArgs(argText) {
  const args = [];
  let depth = 0;
  let current = "";
  for (const ch of argText) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      args.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  args.push(current);
  return args;
}

/**
 * Scan a string/template chunk for a CSS `clamp(...)` whose preferred (middle)
 * term has a vw unit but no rem/em. Walks every `clamp(` occurrence, extracting
 * its balanced argument list.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasRemLessClamp(text) {
  let from = 0;
  for (;;) {
    const idx = text.indexOf("clamp(", from);
    if (idx === -1) return false;
    const open = idx + "clamp(".length;
    // Find the matching close paren for this clamp(.
    let depth = 1;
    let i = open;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    if (depth === 0) {
      const inner = text.slice(open, i - 1);
      const args = splitTopLevelArgs(inner);
      if (args.length === 3) {
        const middle = args[1];
        if (VW_UNIT.test(middle) && !REM_EM.test(middle)) return true;
      }
    }
    from = i; // continue past this clamp (handles multiple clamps in one string)
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a rem-less clamp() preferred term in CSS string contexts (DS-04).",
      recommended: true,
    },
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (fileHasMarker(sourceCode, ["DS-04 sanctioned-exception:"])) return {};

    function check(node, text) {
      if (typeof text !== "string") return;
      if (text.includes("clamp(") && hasRemLessClamp(text)) {
        context.report({ node, messageId: "raw" });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
    };
  },
};
