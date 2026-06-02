/**
 * B9 — ban `.passthrough()` / `.catchall()` on a Zod object schema.
 *
 * NEW-C40-01 leak class: a Zod schema that validates data crossing a
 * service / IPC boundary (the Next.js↔Python analytics HTTP responses, the
 * cross-tab `storage` codec) must NOT `.passthrough()` unknown upstream
 * fields. A passthrough'd field flows untyped into downstream code and — in
 * the original live bug — into an `api_keys` INSERT, hard-failing ALL key
 * creation with PostgREST PGRST204 the moment the Python side added a column.
 * The canonical safe shapes are `.strict()` (reject unknowns, fail loud) or
 * the Zod default `.strip()` (drop unknowns silently). `EncryptKeyResponseSchema`
 * in src/lib/analytics-schemas.ts is the converted exhibit — it dropped
 * `.passthrough()` for the default strip precisely because its output is spread
 * into the api_keys INSERT.
 *
 * SCOPE: enforced repo-wide (eslint.config.mjs wires it across `src/**`), NOT
 * file-scoped. In this codebase `.passthrough()`/`.catchall()` only ever sits
 * at a boundary parser, so a global ban with a greppable per-site escape is a
 * stronger lock than a file allowlist that could silently go stale the moment a
 * new boundary module is added — the exact silent-reintroduction the contracts
 * capstone (B25) exists to prevent.
 *
 * AST is formatting-blind, so this catches the chained `z.object({…}).passthrough()`
 * form AND the multi-line `})\n  .passthrough()` form regardless of spacing. It
 * reports on the `.passthrough`/`.catchall` identifier itself so the offending
 * line is the call line — which is what an inline `eslint-disable-line` escape
 * (below) needs to line up with.
 *
 * Escape (deliberate forward-compat boundary schemas — ~13 today, all reviewed
 * as "Python envelope, never spread into a write"): add an inline
 *   `// eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: <reason>`
 * on the `.passthrough()` line. This keeps the rule LIVE for any NEW passthrough
 * in the same file (a file-level marker would blind the rule to exactly that),
 * and every exception stays greppable + batch-tagged + reviewable.
 */

const MESSAGE =
  "`.passthrough()` / `.catchall()` accepts unknown upstream fields — the " +
  "NEW-C40-01 boundary-leak class (an unknown Python field flowing untyped into " +
  "a downstream write). Use `.strict()` (fail loud) or the Zod default `.strip()` " +
  "(drop unknowns). If this passthrough is deliberate forward-compat, escape it " +
  "inline: `// eslint-disable-line quantalyze/no-passthrough-on-ipc -- " +
  "B9 sanctioned-exception: <reason>`.";

const BANNED = new Set(["passthrough", "catchall"]);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Zod .passthrough()/.catchall() at boundary parsers (B9).",
      recommended: true,
    },
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    return {
      "CallExpression[callee.type='MemberExpression']"(node) {
        const callee = node.callee;
        if (
          !callee.computed &&
          callee.property.type === "Identifier" &&
          BANNED.has(callee.property.name)
        ) {
          // Report on the method identifier so the flagged line is the call
          // line (formatting-blind: works for both inline and multi-line forms,
          // and aligns an inline eslint-disable-line escape with the report).
          context.report({ node: callee.property, messageId: "raw" });
        }
      },
    };
  },
};
