/**
 * DS-04 — ban raw px font-sizes in TS/TSX source.
 *
 * Phase 49 formalizes a fluid `--text-*` type spine (a plain `@theme` block of
 * `clamp(rem, rem+vw, rem)` tokens, mirrored in `src/lib/design-tokens/
 * typography.ts`). A raw px font-size — `text-[14px]` in a className string or
 * `fontSize: '14px'` in a style object — pins the type at a fixed pixel value
 * that does NOT re-scale under user zoom (it bypasses the fluid token), which is
 * exactly the WCAG-1.4.4 regression the spine exists to prevent. This rule is
 * the edit-time backstop pointing offenders at the named tier utilities
 * (`text-hero` / `text-page-title` / `text-h2` / … `text-micro`).
 *
 * Detection (two shapes, both string-valued — never numeric expressions):
 *   - `text-[NNpx]` (Tailwind arbitrary font-size) inside any string `Literal`
 *     or `TemplateElement` (template-literal chunk) — the className case.
 *   - a `fontSize: 'NNpx'` style-object property — matched on the `Property`
 *     node (key `fontSize`, string value `NNpx`), because the literal value
 *     `'14px'` on its own carries no `fontSize:` text.
 * A px value in pure arithmetic (`const m = 14;`) is never inspected.
 *
 * Scope (see eslint.config.mjs): the baseline is DIRTY — recon found 558
 * `text-[NNpx]` sites across the tree, so this rule is `error` ONLY on the new
 * clean token/primitive surface (`src/lib/design-tokens/**`) and `warn` over the
 * broader `src/**`. The strangler migration (phases 52/53) ratchets surfaces to
 * `error` one at a time. Chart / designer-bundle ports are turned `off` by glob.
 *
 * Exemptions: any file carrying a `DS-04 sanctioned-exception:` comment (via
 * `fileHasMarker`, the same greppable escape every other rule uses), plus the
 * eslint.config glob layer.
 *
 * Ceiling: this is a text-shape backstop, not a proof. A px value assembled at
 * runtime (`` `text-[${n}px]` ``) is not caught — it trips the obvious literal
 * `text-[14px]` / `fontSize: '14px'`, the realistic regression vector.
 */
import { fileHasMarker } from "./_shared.mjs";

const FONT_PX = /\btext-\[\d+px\]/; // text-[14px]
const PX_VALUE = /^\d+px$/; // the string value of a fontSize: '14px' property

const MESSAGE =
  "Raw px font-size. Use a fluid --text-* token (text-hero / text-page-title / " +
  "text-h2 / … / text-micro) so type stays zoom-safe (DS-04, WCAG 1.4.4). " +
  "Chart / designer-bundle ports are exempted via eslint.config.mjs globs; for a " +
  "one-off exception add a `DS-04 sanctioned-exception:` comment in this file.";

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow raw px font-sizes; use a fluid --text-* token (DS-04).",
      recommended: true,
    },
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (fileHasMarker(sourceCode, ["DS-04 sanctioned-exception:"])) return {};

    // className case: an arbitrary px font-size token in a string/template chunk.
    function checkClassText(node, text) {
      if (typeof text === "string" && FONT_PX.test(text)) {
        context.report({ node, messageId: "raw" });
      }
    }

    // style-object case: a `fontSize` property whose string value is `NNpx`.
    function keyName(key) {
      if (key.type === "Identifier") return key.name;
      if (key.type === "Literal" && typeof key.value === "string") return key.value;
      return null;
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") checkClassText(node, node.value);
      },
      TemplateElement(node) {
        checkClassText(node, node.value.raw);
      },
      Property(node) {
        if (node.computed) return;
        if (keyName(node.key) !== "fontSize") return;
        const value = node.value;
        if (
          value.type === "Literal" &&
          typeof value.value === "string" &&
          PX_VALUE.test(value.value)
        ) {
          context.report({ node, messageId: "raw" });
        }
      },
    };
  },
};
