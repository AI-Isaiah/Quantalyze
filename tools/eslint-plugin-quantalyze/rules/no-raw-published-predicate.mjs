/**
 * B10 — ban a raw `.eq("status","published")` visibility predicate outside the
 * `withPublishedOnly` helper.
 *
 * `src/lib/visibility.ts` (`withPublishedOnly`) is the ONE place the
 * published-only predicate lives, so a future strategy fetcher cannot silently
 * forget the defence-in-depth filter (the `strategies_read` RLS policy is
 * `status = 'published' OR user_id = auth.uid()`, so a fetcher missing this
 * predicate leaks an owner's own draft rows). This rule is the edit-time
 * complement to the CI-level grep sweep in `visibility.test.ts`.
 *
 * AST is formatting-blind, so this matches every quote style and spacing
 * (`.eq("status","published")`, single quotes, multi-line) without the
 * whitespace-tolerant regex the grep test needs.
 *
 * Exemptions (file-level markers, already present): the helper itself
 * (`B10 visibility:` in visibility.ts) and the single sanctioned exception
 * (`B10 sanctioned-exception:` in notes/ownership.ts, whose strategy-arm gate
 * is spied on by route tests).
 */
import { fileHasMarker } from "./_shared.mjs";

const MESSAGE =
  'Raw `.eq("status","published")` visibility predicate. Route strategies ' +
  "queries through withPublishedOnly() from @/lib/visibility (B10) so the " +
  "published-only filter is enforced by construction. If this is a genuinely " +
  "different shape, add a `B10 sanctioned-exception:` comment in this file.";

function isStringLiteral(arg, value) {
  return arg && arg.type === "Literal" && arg.value === value;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow raw .eq("status","published") outside withPublishedOnly (B10).',
      recommended: true,
    },
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (fileHasMarker(sourceCode, ["B10 sanctioned-exception:", "B10 visibility:"]))
      return {};

    return {
      "CallExpression[callee.property.name='eq']"(node) {
        const args = node.arguments;
        if (
          args.length === 2 &&
          isStringLiteral(args[0], "status") &&
          isStringLiteral(args[1], "published")
        ) {
          context.report({ node, messageId: "raw" });
        }
      },
    };
  },
};
