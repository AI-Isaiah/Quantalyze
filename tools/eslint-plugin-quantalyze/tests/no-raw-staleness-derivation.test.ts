import { afterAll, describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../rules/no-raw-staleness-derivation.mjs";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

ruleTester.run("no-raw-staleness-derivation", rule, {
  valid: [
    // The canonical fold + reading its booleans (no raw comparison).
    { code: "const f = deriveSyncFreshness(keys);" },
    { code: "if (f.allStale && !f.syncing) renderBanner();" },
    // Formatting the timestamp is not a staleness comparison.
    { code: "const age = formatRelativeAge(lastSyncAt);" },
    // Comparing two sync TIMES (the max/sort idiom) is not deriving staleness:
    // both operands reference a sync timestamp, so it is allowed.
    { code: "const newest = a.last_sync_at > b.last_sync_at ? a : b;" },
    // Equality/null checks are not ordering comparisons.
    { code: "const never = k.last_sync_at === null;" },
    // Unrelated ordering comparison.
    { code: "const big = a > b;" },
    // File-level sanctioned-exception marker.
    {
      code: "// B14 sanctioned-exception: bespoke audit window\nconst stale = k.last_sync_at < cutoff;",
    },
  ],
  invalid: [
    // The original inline derivation shape (queries.ts pre-migration).
    {
      code: "const stale = k.last_sync_at < cutoff;",
      errors: [{ messageId: "raw" }],
    },
    {
      code: "const ok = key.last_sync_at >= cutoffIso;",
      errors: [{ messageId: "raw" }],
    },
    // camelCase: re-deriving staleness from the primitive's lastSyncAt instead
    // of reading the derived allStale boolean.
    {
      code: "const stale = freshness.lastSyncAt < cutoff;",
      errors: [{ messageId: "raw" }],
    },
    // The real fold predicate — the inner comparison is the violation (the
    // leading `!k.last_sync_at` is a unary check, not flagged).
    {
      code: "const all = keys.every((k) => !k.last_sync_at || k.last_sync_at < cutoff);",
      errors: [{ messageId: "raw" }],
    },
  ],
});
