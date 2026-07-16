/**
 * CONTRIB-04 — ban a raw owner-OR `.or(...user_id.eq...)` visibility predicate
 * outside the `withPublishedOrOwner` helper.
 *
 * `src/lib/visibility.ts` (`withPublishedOrOwner`) is the ONE place the
 * owner-inclusive predicate (`status.eq.published,user_id.eq.<authUserId>`)
 * lives. A raw owner-OR hand-written at a call site is dangerous for two
 * reasons: (1) the id could come from an untrusted request param instead of the
 * session (T-110-05/07), and (2) run on an admin / service-role client it
 * BYPASSES the `strategies_read` RLS backstop entirely and leaks EVERY user's
 * private/draft rows (Pitfall 4). Routing every owner-inclusive query through
 * the helper keeps the session-only id + RLS-mirroring shape enforced by
 * construction; this rule is the edit-time backstop.
 *
 * AST is formatting-blind, so this matches every `.or(...)` form — a plain
 * string literal, a template literal embedding the id, or a string
 * concatenation — by testing the first argument's source text for the
 * `user_id.eq.` predicate shape. A `.or()` with no owner leg (e.g.
 * `.or('status.eq.published,is_example.eq.true')`) or whose arg is a helper
 * call (`.or(spec.or_filter(userId))`) is untouched.
 *
 * Exemptions (file-level markers, already present): the helper itself
 * (`B10 visibility:` in visibility.ts) and any single sanctioned exception
 * (`B10 sanctioned-exception:`).
 */
import { fileHasMarker } from "./_shared.mjs";

const MESSAGE =
  "Raw owner-OR `.or(...user_id.eq...)` visibility predicate. Route " +
  "owner-inclusive strategies queries through withPublishedOrOwner() from " +
  "@/lib/visibility (CONTRIB-04) so the owner id stays session-only and the " +
  "RLS-mirroring shape is enforced by construction. A raw owner-OR — ESPECIALLY " +
  "on an admin/service-role client — bypasses the RLS backstop and can leak " +
  "every user's private rows. If this is a genuinely different shape, add a " +
  "`B10 sanctioned-exception:` comment in this file.";

// The owner-leg predicate shape PostgREST uses inside an `.or(...)` filter.
const OWNER_OR_LEG = /user_id\.eq\./;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a raw owner-OR .or(...user_id.eq...) predicate outside " +
        "withPublishedOrOwner (CONTRIB-04).",
      recommended: true,
    },
    schema: [],
    messages: { rawOwnerOr: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (
      fileHasMarker(sourceCode, ["B10 sanctioned-exception:", "B10 visibility:"])
    )
      return {};

    return {
      "CallExpression[callee.property.name='or']"(node) {
        const arg = node.arguments[0];
        if (!arg) return;
        // Source-text test is formatting- and node-shape-blind: it catches a
        // Literal, a TemplateLiteral embedding `${id}`, and a string
        // concatenation alike. An Identifier / helper-call arg has no
        // `user_id.eq.` in its text, so those are naturally exempt.
        if (OWNER_OR_LEG.test(sourceCode.getText(arg))) {
          context.report({ node, messageId: "rawOwnerOr" });
        }
      },
    };
  },
};
