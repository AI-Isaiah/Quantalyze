/**
 * SEAM-01 — ban a raw `fetch()` of the analytics service base URL outside the
 * shared resilience core.
 *
 * `src/lib/resilient-fetch.ts` (`resilientFetch`) is the ONE way to cross the
 * Vercel → Railway seam. It owns the per-call-site timeout budget
 * (`SEAM_BUDGETS`) and the shared `breaker:railway` circuit breaker. A raw
 * `fetch()` against the analytics base URL has NEITHER: it can hang until the
 * function ceiling, holding a concurrency slot, and it keeps hammering a
 * Railway deployment that the breaker has already judged to be down.
 *
 * This is not a hypothetical. Phase 140 found a THIRD seam
 * (`/internal/keys/{id}/permissions`) that had existed for months with two
 * verbatim-duplicated timeout constants and no breaker, plus a dormant handler
 * with no timeout at all — precisely because "route it through the client" was
 * a convention rather than a mechanism. Convention demonstrably did not hold,
 * so this rule is the mechanism.
 *
 * DETECTION IS INIT-TRACKING, NOT NAME-MATCHING
 * --------------------------------------------
 * Two passes, resolved at `Program:exit` so declaration ORDER cannot hide a
 * violation (a `fetch` inside a function hoisted above the `const` it uses is
 * still a violation):
 *
 *   (a) Every `VariableDeclarator` whose initializer references
 *       `process.env.ANALYTICS_SERVICE_URL` anywhere — including `??` / `||`
 *       fallback chains, parenthesised expressions and nested calls — binds a
 *       TAINTED name, whatever that name happens to be. Destructuring out of
 *       `process.env` under a new local name is tracked too.
 *   (b) Any `fetch(...)` / `globalThis.fetch(...)` whose FIRST argument
 *       references a tainted name or the env member directly — as a bare
 *       identifier, inside a template-literal slot, or in a `+` concatenation
 *       — is reported.
 *
 * Matching on the name `ANALYTICS_URL` would be simpler and wrong: the whole
 * failure mode is a call site that does not look like the ones already known.
 *
 * IDENTIFIERS IN NON-REFERENCE POSITION ARE IGNORED. A property key
 * (`{ base: 1 }`) or a static member name (`obj.base`) that happens to collide
 * with a tainted binding is not a reference to it.
 *
 * CEILING (honest): tainting is ONE hop. `const a = process.env.X; const b = a;`
 * taints `a` but not `b`, so a fetch of `b` is not reported. A fixed-point
 * alias pass would close it; it is not built because the shape has never
 * appeared in this repo and an order-dependent half-measure would be worse
 * than a documented limit. The rule targets the realistic regression — a new
 * seam written directly against the env var — not an adversarial author.
 *
 * NO IN-FILE ESCAPE HATCH — deliberate, and a departure from the `B<n>
 * sanctioned-exception:` convention the sibling rules use. The legitimate
 * non-core call sites are a CLOSED, enumerated set (the core itself plus the
 * `SEAM_EXCLUSIONS` health warmers and the bespoke debug SSE route), and they
 * are allowlisted by PATH in eslint.config.mjs where adding a fifth entry is
 * visible in review. A greppable in-file comment would let a new seam be
 * minted by editing only the file that introduces it, which is the exact
 * failure this rule exists to prevent.
 */

const ENV_VAR = "ANALYTICS_SERVICE_URL";

const MESSAGE =
  "Raw fetch() of the analytics service base URL. Route Vercel->Railway calls " +
  "through resilientFetch() from @/lib/resilient-fetch (SEAM-01): a raw fetch " +
  "has no timeout budget and no circuit breaker, so it can hold a function " +
  "slot until the ceiling and keep hammering a deployment the breaker has " +
  "already judged to be down. That is exactly how the third unbudgeted seam " +
  "appeared. The only legitimate exceptions are the core itself and the " +
  "documented SEAM_EXCLUSIONS, which are allowlisted by path in " +
  "eslint.config.mjs -- add the call site to the core, never to the allowlist.";

/** `process.env.ANALYTICS_SERVICE_URL` or `process.env["ANALYTICS_SERVICE_URL"]`. */
function isAnalyticsEnvMember(node) {
  if (!node || node.type !== "MemberExpression") return false;
  const named = node.computed
    ? node.property?.type === "Literal" && node.property.value === ENV_VAR
    : node.property?.type === "Identifier" && node.property.name === ENV_VAR;
  return named && isProcessEnv(node.object);
}

/** `process.env` (the object half of the member expression above). */
function isProcessEnv(node) {
  return (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.object?.type === "Identifier" &&
    node.object.name === "process" &&
    node.property?.type === "Identifier" &&
    node.property.name === "env"
  );
}

/**
 * Walk an expression subtree looking for a reference to the env member or to
 * one of `taintedNames`.
 *
 * Recursion deliberately SKIPS the non-reference positions: the static property
 * of a member expression and the key of an object property. `checkTainted` is
 * false during pass (a), where only the env member itself matters.
 */
function referencesSeam(node, taintedNames, checkTainted) {
  if (!node || typeof node !== "object") return false;

  if (Array.isArray(node)) {
    return node.some((child) => referencesSeam(child, taintedNames, checkTainted));
  }
  if (typeof node.type !== "string") return false;

  if (isAnalyticsEnvMember(node)) return true;
  if (
    checkTainted &&
    node.type === "Identifier" &&
    taintedNames.has(node.name)
  ) {
    return true;
  }

  if (node.type === "MemberExpression" && !node.computed) {
    // `a.b` — only `a` is a reference; `b` is a name in this object's namespace.
    return referencesSeam(node.object, taintedNames, checkTainted);
  }
  if (node.type === "Property" && !node.computed) {
    return referencesSeam(node.value, taintedNames, checkTainted);
  }

  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    if (referencesSeam(node[key], taintedNames, checkTainted)) return true;
  }
  return false;
}

/** `fetch(...)` or `globalThis.fetch(...)` / `global.fetch(...)` / `window.fetch(...)`. */
function isFetchCallee(callee) {
  if (callee?.type === "Identifier") return callee.name === "fetch";
  return (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.type === "Identifier" &&
    callee.property.name === "fetch" &&
    callee.object?.type === "Identifier" &&
    ["globalThis", "global", "window", "self"].includes(callee.object.name)
  );
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a raw fetch() of ANALYTICS_SERVICE_URL outside resilientFetch (SEAM-01).",
      recommended: true,
    },
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    /** Identifier names bound to the analytics base URL, whatever they are called. */
    const tainted = new Set();
    /** Candidate fetch calls, resolved at Program:exit so order does not matter. */
    const fetchCalls = [];

    return {
      VariableDeclarator(node) {
        if (!node.init) return;

        // `const { ANALYTICS_SERVICE_URL: local } = process.env;`
        if (node.id.type === "ObjectPattern" && isProcessEnv(node.init)) {
          for (const prop of node.id.properties) {
            if (prop.type !== "Property" || prop.computed) continue;
            const keyName =
              prop.key.type === "Identifier"
                ? prop.key.name
                : prop.key.type === "Literal"
                  ? prop.key.value
                  : null;
            if (keyName === ENV_VAR && prop.value.type === "Identifier") {
              tainted.add(prop.value.name);
            }
          }
          return;
        }

        if (
          node.id.type === "Identifier" &&
          referencesSeam(node.init, tainted, false)
        ) {
          tainted.add(node.id.name);
        }
      },

      CallExpression(node) {
        if (!isFetchCallee(node.callee)) return;
        if (node.arguments.length === 0) return;
        fetchCalls.push(node);
      },

      "Program:exit"() {
        for (const node of fetchCalls) {
          if (referencesSeam(node.arguments[0], tainted, true)) {
            context.report({ node, messageId: "raw" });
          }
        }
      },
    };
  },
};
