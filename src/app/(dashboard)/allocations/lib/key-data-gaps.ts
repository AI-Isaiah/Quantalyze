/**
 * The per-key missing-data producer for the Overview message (Phase 198, D-01,
 * ROUTE-07). RESEARCH Q3: the payload carried a reason, not a range, so the
 * message could not say "which key, which days". This pure module turns the
 * reason, the compose's failing-key exits, the per-key series and the owner's
 * account groups into entries the message can name. `getMyAllocationDashboard`
 * calls it on the server, so the account identity never reaches the browser.
 *
 * Rules, each pinned by `key-data-gaps.test.ts`:
 *
 * - A dead key affects only itself (founder rule). An entry names only the keys
 *   the fault is attributed to. Keys are grouped only when they share a known
 *   exchange account, and a shared-account entry needs EVERY key of the group
 *   failing: one working key means the account is still read.
 * - Owner-only (T-186-18 precedent). Every id is checked against `ownKeyIds`, a
 *   foreign id is dropped, and a group left with fewer than two ids is dropped.
 *   `accountId` is read to group and is never copied into the output.
 * - No day is invented. The reference day is the curve's last day (a failing
 *   exit on a ready book) or yesterday UTC from the server clock; this module
 *   has no clock of its own. A key with no series, or an exit that never counted,
 *   ships `firstMissingDay: null, ranges: null`. An empty tail emits no entry.
 * - Interior holes inside a key's series are NOT reported as missing days. An
 *   MT5 key has no weekend rows, so a calendar hole is not proof of missing data,
 *   and naming a healthy key as held back would break the rule above. Only the
 *   tail after the last row is a gap (Claude's Discretion, recorded in the plan).
 * - The causes with no range by design (`identity_pending`,
 *   `duplicate_account`) ship `null` and `null` too: their line has no days.
 *
 * Pure: no React, no Date, no runtime import of `queries.ts`.
 */
import type { EquityHistoryRebuildReason } from "@/lib/queries";

export type KeyDataGapCause =
  | "not_syncing"
  | "sync_failing"
  | "read_incomplete"
  | "identity_pending"
  | "duplicate_account"
  | "shared_account_failing";

/** An inclusive run of UTC days, `YYYY-MM-DD`. */
export type DayRange = { from: string; to: string };

/**
 * `apiKeyIds` are the owner's own key ids (sorted). `firstMissingDay` and
 * `ranges` are both null when the producer cannot derive a range, or when the
 * cause carries none.
 */
export type KeyDataGap = {
  apiKeyIds: string[];
  cause: KeyDataGapCause;
  firstMissingDay: string | null;
  ranges: DayRange[] | null;
};

/** One of the owner's keys with the account facts the grouping needs. Never shipped. */
export type KeyAccountFact = {
  id: string;
  /** The key's known `venue_account_id`, else null. Server-side only. */
  accountId: string | null;
  /** `account_share_kind`: "duplicate" and "composite_member" are counted once by the derive. */
  shareKind: string | null;
  /** The key's last sync failed (`failingToSync`). */
  failing: boolean;
};

export type KeyDataGapsInput = {
  ownKeyIds: readonly string[];
  reason: EquityHistoryRebuildReason | null;
  notSyncingKeyIds: readonly string[];
  identityPendingKeyIds: readonly string[];
  keyAccounts: readonly KeyAccountFact[];
  failingKeyExits: ReadonlyArray<{
    apiKeyId: string;
    reason: "sync_failing" | "read_incomplete";
    day: string | null;
  }>;
  /** Each key's last per-key returns day. A key with no series is absent. */
  lastSeriesDayByKey: Readonly<Record<string, string>>;
  /** The derived curve's last day when the book is ready, else null. */
  curveLastDay: string | null;
  /** Yesterday in UTC from the SERVER clock. */
  yesterdayUtc: string;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** The UTC day after a valid `YYYY-MM-DD`. Callers guard the input with `isIsoDay`. */
export function nextUtcDay(iso: string): string {
  const m = ISO_DAY.exec(iso);
  if (!m) throw new Error(`nextUtcDay: not a YYYY-MM-DD day: ${iso}`);
  let year = Number(m[1]);
  let month = Number(m[2]);
  let day = Number(m[3]) + 1;
  if (day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The UTC day before a valid `YYYY-MM-DD`. */
export function previousUtcDay(iso: string): string {
  const m = ISO_DAY.exec(iso);
  if (!m) throw new Error(`previousUtcDay: not a YYYY-MM-DD day: ${iso}`);
  let year = Number(m[1]);
  let month = Number(m[2]);
  let day = Number(m[3]) - 1;
  if (day < 1) {
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    day = daysInMonth(year, month);
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function isIsoDay(value: string): boolean {
  const m = ISO_DAY.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(Number(m[1]), month);
}

/**
 * The days after `lastDay` through `referenceDay`, or null when there is no
 * last day, either day is malformed, or the tail is empty.
 */
export function tailRange(lastDay: string | null, referenceDay: string): DayRange | null {
  if (lastDay === null || !isIsoDay(lastDay) || !isIsoDay(referenceDay)) return null;
  const from = nextUtcDay(lastDay);
  return from > referenceDay ? null : { from, to: referenceDay };
}

/**
 * Groups of two or more keys that share one KNOWN account, ids sorted within a
 * group and groups ordered by their first id. With `countedOnly`, a key marked
 * `duplicate` or `composite_member` is excluded first: the derive counts it
 * once, so it is not a double count.
 */
export function accountGroups(
  keys: readonly KeyAccountFact[],
  { countedOnly }: { countedOnly: boolean },
): string[][] {
  const byAccount = new Map<string, string[]>();
  for (const key of keys) {
    if (key.accountId === null) continue;
    if (countedOnly && (key.shareKind === "duplicate" || key.shareKind === "composite_member")) {
      continue;
    }
    const ids = byAccount.get(key.accountId);
    if (ids) ids.push(key.id);
    else byAccount.set(key.accountId, [key.id]);
  }
  return [...byAccount.values()]
    .filter((ids) => ids.length >= 2)
    .map((ids) => [...ids].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function keyDataGaps(input: KeyDataGapsInput): KeyDataGap[] {
  const own = new Set(input.ownKeyIds);
  const out: KeyDataGap[] = [];

  /**
   * `tail` undefined: the cause carries no range. Otherwise the range is the
   * tail after `lastDay` through `referenceDay`. A null `lastDay` or a malformed
   * last day is the honest "no history" fallback (a null-range entry, never a
   * disappearing key). A valid but EMPTY tail emits NOTHING, for every cause: the
   * key's history already reaches the reference day, so "no complete history
   * yet" would be false, and the cause's own fallback ("... is not syncing")
   * is the true sentence. A malformed reference day states nothing either.
   */
  const push = (
    ids: readonly string[],
    cause: KeyDataGapCause,
    minIds: number,
    tail?: { lastDay: string | null; referenceDay: string },
  ): void => {
    const owned = ids.filter((id) => own.has(id)).sort();
    if (owned.length < minIds || owned.length === 0) return;
    if (tail === undefined || tail.lastDay === null || !isIsoDay(tail.lastDay)) {
      out.push({ apiKeyIds: owned, cause, firstMissingDay: null, ranges: null });
      return;
    }
    const range = tailRange(tail.lastDay, tail.referenceDay);
    if (range === null) return;
    out.push({
      apiKeyIds: owned,
      cause,
      firstMissingDay: range.from,
      ranges: [range],
    });
  };

  const lastDayOf = (id: string): string | null => input.lastSeriesDayByKey[id] ?? null;

  switch (input.reason) {
    case "key_not_syncing":
      for (const id of input.notSyncingKeyIds) {
        push([id], "not_syncing", 1, {
          lastDay: lastDayOf(id),
          referenceDay: input.yesterdayUtc,
        });
      }
      break;
    case "account_identity_pending":
      for (const id of input.identityPendingKeyIds) {
        push([id], "identity_pending", 1);
      }
      break;
    case "duplicate_account":
      for (const group of accountGroups(input.keyAccounts, { countedOnly: true })) {
        push(group, "duplicate_account", 2);
      }
      break;
    case "shared_account_no_working_key": {
      const failingById = new Map(input.keyAccounts.map((k) => [k.id, k.failing]));
      for (const group of accountGroups(input.keyAccounts, { countedOnly: false })) {
        if (!group.every((id) => failingById.get(id) === true)) continue;
        // The account stopped when its last key stopped: start after the
        // latest last day in the group.
        let latest: string | null = null;
        for (const id of group) {
          const day = lastDayOf(id);
          if (day !== null && (latest === null || day > latest)) latest = day;
        }
        push(group, "shared_account_failing", 2, {
          lastDay: latest,
          referenceDay: input.yesterdayUtc,
        });
      }
      break;
    }
    default:
      break;
  }

  // Ready arm: the compose names the keys it stopped counting. `failingKeyExits`
  // is empty while the history rebuilds, so this adds nothing there.
  for (const exit of input.failingKeyExits) {
    push([exit.apiKeyId], exit.reason, 1, {
      lastDay: exit.day,
      referenceDay: input.curveLastDay ?? input.yesterdayUtc,
    });
  }

  return out.sort((a, b) =>
    a.cause !== b.cause
      ? a.cause < b.cause
        ? -1
        : 1
      : a.apiKeyIds[0] < b.apiKeyIds[0]
        ? -1
        : a.apiKeyIds[0] > b.apiKeyIds[0]
          ? 1
          : 0,
  );
}
