/**
 * SEAM-01 — ban a raw `fetch()` of the analytics service base URL outside the
 * shared resilience core.
 *
 * STUB (RED gate). Detection lands in the GREEN commit.
 */

const MESSAGE = "Raw fetch of the analytics service base URL.";

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
  create() {
    return {};
  },
};
