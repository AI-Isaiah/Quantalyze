/**
 * B20 — ban raw numeric parsing of a `Retry-After` header outside the shared
 * parser.
 *
 * `src/lib/retry/retry-after.ts` (`parseRetryAfterSeconds`) is the ONE
 * `Retry-After` parser. It handles both RFC 9110 §10.2.3 forms (delta-seconds
 * AND HTTP-date, resolved against the response's own Date header) and NEVER
 * returns `NaN`/`0`/negative. A raw `Number(headers.get("retry-after"))` yields
 * `NaN` for an HTTP-date and `0` for an empty header; fed into a `setTimeout`
 * backoff it collapses to a ~0ms hot-retry that re-trips the very limiter the
 * 429 signals — the NEW-C05-01 thundering-herd root cause.
 *
 * Detection is a hybrid: an `Number(...)`/`parseInt(...)`/`parseFloat(...)`
 * call whose first argument's source text references a retry-after header
 * (`retry-after`, `Retry-After`, `retryAfter`). This matches the real
 * violation shape precisely without over-flagging unrelated numeric coercions.
 *
 * Exemption: the parser's own directory (`src/lib/retry/**`, via an
 * eslint.config override) and any file carrying a `B20 sanctioned-exception:`
 * comment.
 */
import { fileHasMarker } from "./_shared.mjs";

const COERCERS = new Set(["Number", "parseInt", "parseFloat"]);
const RETRY_AFTER_REF = /retry-?after/i;

/**
 * A coercer call is either a bare global — `Number(x)` / `parseInt(x)` /
 * `parseFloat(x)` — or the ES2015 static-method form `Number.parseInt(x)` /
 * `Number.parseFloat(x)` (a MemberExpression callee, which the Identifier-only
 * check would miss — the idiomatic modern spelling this codebase itself uses).
 */
function isCoercerCallee(callee) {
  if (callee.type === "Identifier") return COERCERS.has(callee.name);
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Number" &&
    callee.property.type === "Identifier" &&
    (callee.property.name === "parseInt" || callee.property.name === "parseFloat")
  );
}

const MESSAGE =
  "Raw numeric parse of a Retry-After header. Use parseRetryAfterSeconds() " +
  "from @/lib/retry (B20) — raw Number()/parseInt() yields NaN/0/negative on " +
  "an HTTP-date or empty header and collapses backoff to a ~0ms hot-retry " +
  "(thundering herd, NEW-C05-01). If this is a deliberate exception, add a " +
  "`B20 sanctioned-exception:` comment in this file.";

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw Number()/parseInt() parsing of a Retry-After header outside parseRetryAfterSeconds (B20).",
      recommended: true,
    },
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (fileHasMarker(sourceCode, ["B20 sanctioned-exception:"])) return {};

    return {
      CallExpression(node) {
        if (!isCoercerCallee(node.callee)) return;
        if (node.arguments.length === 0) return;
        const argText = sourceCode.getText(node.arguments[0]);
        if (RETRY_AFTER_REF.test(argText)) {
          context.report({ node, messageId: "raw" });
        }
      },
    };
  },
};
