/**
 * B14 — ban re-deriving sync staleness from a raw `last_sync_at` comparison
 * outside the shared freshness fold.
 *
 * `src/lib/sync-freshness/types.ts` (`deriveSyncFreshness`) is the ONE place the
 * staleness decision is made: it folds active keys' `last_sync_at` /
 * `sync_status` into a `SyncFreshness` (the 24h cutoff + the all-keys-stale and
 * any-key-syncing predicates). The #348 banner originally derived this inline
 * in `getMyAllocationDashboard` (`last_sync_at < cutoff`), so a NEW dashboard
 * surface could re-implement the comparison with a different cutoff and
 * silently drift from the contract every other surface shows (NEW-C09-04).
 * Routing through `deriveSyncFreshness` keeps one definition of "stale".
 *
 * Detection (hybrid, mirroring `no-raw-retry-after-parse`): an ordering
 * comparison (`<` `>` `<=` `>=`) where exactly ONE operand's source text
 * references a sync timestamp (`last_sync_at` / `lastSyncAt`) and the other does
 * NOT — i.e. a sync time compared against a cutoff. A comparison of two sync
 * times (`a.last_sync_at > b.last_sync_at`, the max/sort idiom `deriveSyncFreshness`
 * itself uses) is NOT a staleness decision and is deliberately allowed, so the
 * rule fires on the real "derive staleness" shape without over-flagging.
 *
 * Exemptions: the fold's own module (`src/lib/sync-freshness/**`, via an
 * eslint.config override) and any file carrying a `B14 sanctioned-exception:`
 * comment.
 *
 * Ceiling: like its `no-raw-retry-after-parse` sibling, this is a text-shape
 * backstop, not a proof. A comparison laundered through an intermediate
 * variable (`const t = k.last_sync_at; t < cutoff`) or a renamed field
 * (`lastSyncMs`) is not caught. It trips the obvious copy-paste of the inline
 * fold — the realistic regression vector — not every conceivable re-derivation.
 */
import { fileHasMarker } from "./_shared.mjs";

const ORDER_OPS = new Set(["<", ">", "<=", ">="]);
const SYNC_TS_REF = /last_?sync_?at/i;

const MESSAGE =
  "Raw `last_sync_at` staleness comparison. Derive sync freshness through " +
  "deriveSyncFreshness() from @/lib/sync-freshness (B14) so the 24h cutoff lives " +
  "in one place — an inline comparison drifts the staleness contract per surface " +
  "(NEW-C09-04). Comparing two sync times (max/sort) is fine. If this is a " +
  "deliberate exception, add a `B14 sanctioned-exception:` comment in this file.";

function refsSyncTs(sourceCode, operand) {
  return SYNC_TS_REF.test(sourceCode.getText(operand));
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw last_sync_at staleness comparisons outside deriveSyncFreshness (B14).",
      recommended: true,
    },
    schema: [],
    messages: { raw: MESSAGE },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (fileHasMarker(sourceCode, ["B14 sanctioned-exception:"])) return {};

    return {
      BinaryExpression(node) {
        if (!ORDER_OPS.has(node.operator)) return;
        const leftRefs = refsSyncTs(sourceCode, node.left);
        const rightRefs = refsSyncTs(sourceCode, node.right);
        // Exactly one side is a sync timestamp → comparing it to a cutoff.
        if (leftRefs !== rightRefs) {
          context.report({ node, messageId: "raw" });
        }
      },
    };
  },
};
