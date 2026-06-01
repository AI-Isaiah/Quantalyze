/**
 * eslint-plugin-quantalyze — local ESLint rules enforcing the by-construction
 * invariants the cross-cutting refactor program (B1–B25) closed via a single
 * source of truth. Each rule is the EDIT-TIME backstop pointing offenders at
 * the canonical helper.
 *
 * B25 is the capstone that creates this plugin. It ships only the genuine
 * AST-rule delta (rules a grep test can't do well, whose runtime SoT is
 * already shipped). Future batches add their rules here:
 *   - B9  no-passthrough-on-ipc           (after B9 ships its runtime half)
 *   - B14 freshness-signal-consumption    (after B14 ships its lint half)
 *   - B17 labeled-metric-consumption      (after B17 ships its runtime half)
 *
 * See .planning/audit-2026-05-07/B25-PLAN.md for the honesty-gate inventory
 * (which classes are already type-enforced and deliberately have NO rule here).
 */
import noRawLocalstorage from "./rules/no-raw-localstorage.mjs";
import noRawPublishedPredicate from "./rules/no-raw-published-predicate.mjs";
import noRawRetryAfterParse from "./rules/no-raw-retry-after-parse.mjs";

const plugin = {
  meta: { name: "eslint-plugin-quantalyze", version: "0.1.0" },
  rules: {
    "no-raw-localstorage": noRawLocalstorage,
    "no-raw-published-predicate": noRawPublishedPredicate,
    "no-raw-retry-after-parse": noRawRetryAfterParse,
  },
};

export default plugin;
