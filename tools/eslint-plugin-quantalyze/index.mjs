/**
 * eslint-plugin-quantalyze — local ESLint rules enforcing the by-construction
 * invariants the cross-cutting refactor program (B1–B25) closed via a single
 * source of truth. Each rule is the EDIT-TIME backstop pointing offenders at
 * the canonical helper.
 *
 * B25 is the capstone that creates this plugin. It ships only the genuine
 * AST-rule delta (rules a grep test can't do well, whose runtime SoT is
 * already shipped). Future batches add their rules here:
 *   - B9  no-passthrough-on-ipc           (LANDED — bans Zod .passthrough()/.catchall())
 *   - B14 no-raw-staleness-derivation     (LANDED — bans raw last_sync_at vs cutoff; route via deriveSyncFreshness)
 *   - B17 labeled-metric-consumption      (after B17 ships its runtime half)
 *
 * See .planning/audit-2026-05-07/B25-PLAN.md for the honesty-gate inventory
 * (which classes are already type-enforced and deliberately have NO rule here).
 */
import noRawLocalstorage from "./rules/no-raw-localstorage.mjs";
import noRawPublishedPredicate from "./rules/no-raw-published-predicate.mjs";
import noRawRetryAfterParse from "./rules/no-raw-retry-after-parse.mjs";
import noPassthroughOnIpc from "./rules/no-passthrough-on-ipc.mjs";
import noRawStalenessDerivation from "./rules/no-raw-staleness-derivation.mjs";

const plugin = {
  meta: { name: "eslint-plugin-quantalyze", version: "0.1.0" },
  rules: {
    "no-raw-localstorage": noRawLocalstorage,
    "no-raw-published-predicate": noRawPublishedPredicate,
    "no-raw-retry-after-parse": noRawRetryAfterParse,
    "no-passthrough-on-ipc": noPassthroughOnIpc,
    "no-raw-staleness-derivation": noRawStalenessDerivation,
  },
};

export default plugin;
