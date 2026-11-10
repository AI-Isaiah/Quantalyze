/**
 * Which strategies does an API key feed? (Phase 200 D-01, ROUTE-09.)
 *
 * A key feeds a strategy two ways: `strategies.api_key_id` (a single-key
 * link) and a `strategy_keys` row (a composite membership). Both server reads
 * (`GET /api/keys/feeds` and `GET /api/keys/[id]/memberships`) build the same
 * `KeyFeed` shape from them, and the key managers read it back. A route module
 * may export only its handlers, so the shared type and helpers live here.
 */

export type KeyFeedKind = "single" | "composite";

/**
 * One strategy a key feeds. `strategy_id`, `name` and `status` are `null`
 * ONLY for a composite row whose strategy is not the caller's (or whose embed
 * is missing). Such a row is still listed, so a Delete warning still fires,
 * but it carries nothing that belongs to another tenant: no name, no status
 * and no id, so a consumer cannot link to it.
 */
export type KeyFeed = {
  strategy_id: string | null;
  name: string | null;
  status: string | null;
  kind: KeyFeedKind;
};

/** PostgREST can answer a to-one embed as an object or a one-element array. */
export function unwrapEmbed(embed: unknown): Record<string, unknown> | null {
  const one = Array.isArray(embed) ? embed[0] : embed;
  return one !== null && typeof one === "object" ? (one as Record<string, unknown>) : null;
}

/**
 * The Sentry `code` tag for a failed read: the PostgREST/SQLSTATE code when the
 * error carries one, "none" when it does not, and "no_error" when there was no
 * error object at all (a read that answered no rows array and no error).
 */
export function errorCodeTag(err: { code?: unknown } | null | undefined): string {
  if (!err) return "no_error";
  return typeof err.code === "string" && err.code.length > 0 ? err.code : "none";
}

/**
 * Name order within one key: case-insensitive, nulls last, then `strategy_id`
 * (a null id last), so two strategies with the same name come out in a stable
 * order. Pure: returns a new array.
 */
export function sortFeeds(feeds: readonly KeyFeed[]): KeyFeed[] {
  return [...feeds].sort((a, b) => {
    if (a.name === null && b.name !== null) return 1;
    if (a.name !== null && b.name === null) return -1;
    if (a.name !== null && b.name !== null) {
      const byName = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      if (byName !== 0) return byName;
    }
    if (a.strategy_id === b.strategy_id) return 0;
    if (a.strategy_id === null) return 1;
    if (b.strategy_id === null) return -1;
    return a.strategy_id < b.strategy_id ? -1 : 1;
  });
}

export type CompositeRowProblem = "ownerMismatch" | "dangling";

/**
 * One `strategy_keys` row, selected as
 * `strategy_id, strategies ( name, status, user_id )`, as a `KeyFeed`.
 *
 * The defence-in-depth tripwire (167.2.1-REVIEW-SFH M-4): a row whose strategy
 * is not `ownerId`'s means `enforce_strategy_keys_owner_coherence` regressed,
 * and a row with no strategy embed is dangling. Both are listed (never
 * dropped) with a null id, name and status, and reported as `problem` so the
 * caller can count and capture them.
 */
export function compositeFeedFromRow(
  row: unknown,
  ownerId: string,
): { feed: KeyFeed; problem: CompositeRowProblem | null } {
  const redacted: KeyFeed = { strategy_id: null, name: null, status: null, kind: "composite" };
  const record = row !== null && typeof row === "object" ? (row as Record<string, unknown>) : null;
  const strategy = unwrapEmbed(record?.strategies);
  if (!strategy) return { feed: redacted, problem: "dangling" };
  if (strategy.user_id !== ownerId) return { feed: redacted, problem: "ownerMismatch" };
  return {
    feed: {
      strategy_id: typeof record?.strategy_id === "string" ? record.strategy_id : null,
      name: typeof strategy.name === "string" ? strategy.name : null,
      status: typeof strategy.status === "string" ? strategy.status : null,
      kind: "composite",
    },
    problem: null,
  };
}
