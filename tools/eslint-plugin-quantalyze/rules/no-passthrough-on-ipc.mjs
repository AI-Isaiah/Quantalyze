/**
 * B9 — ban Zod "accept unknown keys" object modes on a schema.
 *
 * NEW-C40-01 leak class: a Zod schema that validates data crossing a
 * service / IPC boundary (the Next.js↔Python analytics HTTP responses, the
 * cross-tab `storage` codec, the widget render-payload contracts) must NOT keep
 * unknown upstream fields. An unknown field flows untyped into downstream code
 * and — in the original live bug — into an `api_keys` INSERT, hard-failing ALL
 * key creation with PostgREST PGRST204 the moment the Python side added a column.
 * The canonical safe shapes are `.strict()` (reject unknowns, fail loud) or the
 * Zod default `.strip()` (drop unknowns silently). `EncryptKeyResponseSchema`
 * in src/lib/analytics-schemas.ts is the converted exhibit — it dropped its
 * passthrough for the default strip precisely because its output is spread into
 * the api_keys INSERT.
 *
 * This repo runs Zod v4 (package.json: zod ^4.3.6). The "keep unknown keys" mode
 * has FOUR spellings here, ALL banned:
 *   - `.passthrough()`  — the v3 method, @deprecated in v4
 *   - `.catchall(...)`  — typed-rest passthrough
 *   - `.loose()`        — the v4 CANONICAL replacement for `.passthrough()`
 *                         (the form a Zod-v4 dev reaches for first; both resolve
 *                         to the identical `$loose` shape)
 *   - `z.looseObject({…})` / bare `looseObject({…})` — the v4 factory form
 * Banning only `.passthrough()` would leave the rule blind to `.loose()` —
 * a silent reintroduction path for the exact class it closes.
 *
 * SCOPE: enforced repo-wide (eslint.config.mjs wires it across `src/**`), NOT
 * file-scoped. In this codebase these modes only ever sit at a boundary parser,
 * so a global ban with a greppable per-site escape is a stronger lock than a
 * file allowlist that could silently go stale the moment a new boundary module
 * is added — the exact silent-reintroduction the contracts capstone (B25)
 * exists to prevent.
 *
 * AST is formatting-blind, so this catches both the chained
 * `z.object({…}).loose()` form AND the multi-line `})\n  .loose()` form
 * regardless of spacing. It reports on the offending method/factory IDENTIFIER
 * so the flagged line is the call line — which is what an inline
 * `eslint-disable-line` escape (below) needs to line up with.
 *
 * NOTE: the match is by method/factory NAME (not Zod-type resolution). These
 * names only ever appear on Zod schemas in this repo today; a future unrelated
 * `.passthrough()`/`.loose()` on a non-Zod object would also flag and need the
 * same greppable escape (an acceptable, auditable trade — see REGISTRY.md).
 *
 * Escape (deliberate forward-compat boundary schemas — ~22 today, all reviewed
 * as read-only "render/display envelope, never spread into a write"): add an
 * inline `// eslint-disable-line quantalyze/no-passthrough-on-ipc --
 * B9 sanctioned-exception: <reason>` on the call line. Per-line (not file-level)
 * keeps the rule LIVE for any NEW boundary mode added to the same file.
 */

const MESSAGE =
  "Zod `.passthrough()` / `.catchall()` / `.loose()` / `z.looseObject()` accepts " +
  "unknown upstream fields — the NEW-C40-01 boundary-leak class (an unknown field " +
  "flowing untyped into a downstream write). Use `.strict()` (fail loud) or the Zod " +
  "default `.strip()` (drop unknowns). NOTE: this repo is Zod v4 — `.loose()` is the " +
  "canonical form and `.passthrough()` is deprecated; both are banned. If this is " +
  "a deliberate read-only forward-compat envelope, escape it inline: " +
  "`// eslint-disable-line quantalyze/no-passthrough-on-ipc -- B9 sanctioned-exception: <reason>`.";

// Member-call modes: `schema.passthrough()`, `.catchall()`, `.loose()`, and the
// `z.looseObject(...)` factory (a member call whose property is `looseObject`).
const BANNED_METHODS = new Set(["passthrough", "catchall", "loose", "looseObject"]);
// Bare-imported factory: `import { looseObject } from "zod"; looseObject(...)`.
const BANNED_FACTORIES = new Set(["looseObject"]);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Zod passthrough/catchall/loose/looseObject at boundary parsers (B9).",
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
          BANNED_METHODS.has(callee.property.name)
        ) {
          // Report on the method identifier so the flagged line is the call
          // line (formatting-blind; aligns an inline eslint-disable-line escape).
          context.report({ node: callee.property, messageId: "raw" });
        }
      },
      "CallExpression[callee.type='Identifier']"(node) {
        if (BANNED_FACTORIES.has(node.callee.name)) {
          context.report({ node: node.callee, messageId: "raw" });
        }
      },
    };
  },
};
