/**
 * Phase 170.4 plan 11 (D-10, D-08): count one exchange account ONCE per day in
 * a DOLLAR total.
 *
 * Once `allocator_holdings` keeps a row per key (plan 09), two keys that read
 * the same exchange account (the D-09 identity, `accountIdentityTokens`) can
 * both hold rows on the account's newest day, and a reader that sums every row
 * would count the account twice. D-08 stays true for keys on DIFFERENT
 * accounts: each keeps its own rows.
 *
 * THE RULE, one in both runtimes. Among the keys of one account that hold rows
 * of one `holding_type` on that account's newest `asof`, the winner FOR THAT
 * TYPE is the key whose rows OF THAT TYPE carry the latest `updated_at` INSTANT
 * (a key's instant is the maximum over its rows of the type on that day), ties
 * broken by the smallest LOWERCASE `api_key_id`. The winner's rows of the type
 * are the account's rows of the type for the day; every other key's rows of
 * that type on that day do not count. The winner is picked per
 * (account, holding_type) and not per account, so a later poll that read only
 * one type cannot erase the other type's rows another key of the account wrote
 * that day (review WR-01).
 *
 * The instant is compared as an integer number of microseconds since the epoch
 * (`writtenAtMicros`), never as a string (`Z` and `+00:00` and `.5` and
 * `.500000` all name instants) and never through `Date.parse` alone (it keeps
 * milliseconds; Postgres keeps six fraction digits). A plain `number`: the
 * project targets ES2017 (no BigInt literals), and microseconds since the
 * epoch stay below 2^53 until the year 2255.
 *
 * `updated_at` is NOT NULL DEFAULT now() with a BEFORE UPDATE trigger
 * (`supabase/schema/baseline.sql`), so a row without a parseable one is a
 * contract violation, not a tie: it throws `HoldingsUpdatedAtError`.
 *
 * Twin: `one_key_per_account_day` / `written_at_micros` in
 * `analytics-service/services/allocator_equity_derive.py`. Both runtimes are
 * replayed against `analytics-service/tests/fixtures/one_key_per_account_day_cases.json`.
 *
 * DOLLAR TOTALS ONLY (Holdings, Open Positions, Exposure, the AUM, the daily
 * equity snapshot, the commit's server AUM, the scorer's AUM). The Scenario
 * fingerprint keeps today's row set (every contributing key at the account's
 * newest day), because `commit_scenario_batch`'s `contributing` CTE recomputes
 * it that way and this phase's PR 1 carries no migration.
 *
 * What the rule changes under today's index, both pinned by the case table: an
 * earlier same-day poll's leftover row for a symbol the later poll no longer
 * read, of the SAME type, stops counting. A later PARTIAL poll (spot only,
 * `complete_with_warnings`) by one key does NOT hide another key's derivative
 * rows of that account and day, because the two types are decided apart. One
 * residual: two keys that both read a type on the day still count the type once,
 * through the later poller, and a symbol only the earlier poller read within
 * that type stops counting; `partialPositionReads` names the winning key's
 * partial read. The rule stays timestamp-only (no owner-writable audit evidence
 * enters the choice).
 */

/** A holdings row's `updated_at` is missing, null or not an ISO instant. */
export class HoldingsUpdatedAtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoldingsUpdatedAtError";
  }
}

// date, `T`, time, optional fraction (any number of digits), `Z` or +-HH:MM.
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * An ISO-8601 instant as integer microseconds since the epoch. Fraction digits
 * are padded or cut to six; `Z` and any `+-HH:MM` offset are applied. Anything
 * else (a non-string, a missing offset, a space instead of `T`, an impossible
 * calendar date or clock time) throws `HoldingsUpdatedAtError`.
 */
export function writtenAtMicros(ts: string): number {
  if (typeof ts !== "string") {
    throw new HoldingsUpdatedAtError(
      `holdings updated_at must be an ISO timestamp string, got ${ts === null ? "null" : typeof ts}`,
    );
  }
  const m = ISO_INSTANT.exec(ts);
  if (m === null) {
    throw new HoldingsUpdatedAtError(`holdings updated_at is not an ISO instant: ${JSON.stringify(ts)}`);
  }
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const fraction = Number((m[7] ?? "").padEnd(6, "0").slice(0, 6));
  let offsetMinutes = 0;
  if (m[8] !== "Z") {
    const sign = m[8][0] === "-" ? -1 : 1;
    const offHour = Number(m[8].slice(1, 3));
    const offMinute = Number(m[8].slice(4, 6));
    if (offHour > 23 || offMinute > 59) {
      throw new HoldingsUpdatedAtError(`holdings updated_at has an impossible offset: ${JSON.stringify(ts)}`);
    }
    offsetMinutes = sign * (offHour * 60 + offMinute);
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const probe = new Date(ms);
  if (
    !Number.isFinite(ms) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    throw new HoldingsUpdatedAtError(`holdings updated_at is not a real calendar instant: ${JSON.stringify(ts)}`);
  }
  const micros = (ms - offsetMinutes * 60_000) * 1000 + fraction;
  if (!Number.isSafeInteger(micros)) {
    throw new HoldingsUpdatedAtError(`holdings updated_at is out of range: ${JSON.stringify(ts)}`);
  }
  return micros;
}

/**
 * Keep, for each (account, holding_type), only the rows of the one key that
 * wins the type on the account's newest day (see the module docblock). `accountOf` is the identity the reader
 * grouped by (`fetchLatestHoldingsPerKey`'s `accountByKey`); a key it does not
 * know should map to its own token. Input order is preserved and never relied
 * on. Only rows on an account's newest day are parsed, so a stale row's
 * `updated_at` cannot change a total it does not feed.
 */
export function oneKeyPerAccountDay<
  T extends {
    api_key_id: string;
    asof: string;
    updated_at: string;
    holding_type: string;
  },
>(rows: readonly T[], accountOf: (keyId: string) => string): T[] {
  const newestDay = new Map<string, string>();
  for (const r of rows) {
    const account = accountOf(r.api_key_id);
    const current = newestDay.get(account);
    if (current === undefined || r.asof > current) newestDay.set(account, r.asof);
  }
  // (account, holding_type) -> key -> that key's latest instant on the
  // account's newest day, over its rows of that type.
  const slotOf = (account: string, holdingType: string): string =>
    `${account}\u0000${holdingType}`;
  const instants = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const account = accountOf(r.api_key_id);
    if (r.asof !== newestDay.get(account)) continue;
    const at = writtenAtMicros(r.updated_at);
    const slot = slotOf(account, r.holding_type);
    let perKey = instants.get(slot);
    if (perKey === undefined) {
      perKey = new Map();
      instants.set(slot, perKey);
    }
    const current = perKey.get(r.api_key_id);
    if (current === undefined || at > current) perKey.set(r.api_key_id, at);
  }
  const winner = new Map<string, string>();
  for (const [slot, perKey] of instants) {
    let best: { keyId: string; at: number } | null = null;
    for (const [keyId, at] of perKey) {
      if (
        best === null ||
        at > best.at ||
        (at === best.at && keyId.toLowerCase() < best.keyId.toLowerCase())
      ) {
        best = { keyId, at };
      }
    }
    if (best !== null) winner.set(slot, best.keyId);
  }
  return rows.filter((r) => {
    const account = accountOf(r.api_key_id);
    return (
      r.asof === newestDay.get(account) &&
      r.api_key_id === winner.get(slotOf(account, r.holding_type))
    );
  });
}
