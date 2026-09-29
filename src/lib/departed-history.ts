/**
 * Phase 167.1.2 plan 09 (D-05, D-09) — which departed keys' history the
 * allocator's book counts, and until which UTC day.
 *
 * The founder's words (D-05): "do not delete the data when a key is
 * disconnected. Leave it in an overview of disconnected accounts that can be
 * toggled on or off ... included only till the day that the key was deleted."
 *
 * ONE spec, two implementations. The derive job decides with
 * `departed_history_inclusion` (analytics-service/services/job_worker.py); the
 * key card shows the owner that decision with this function. Both read the SAME
 * inputs — first and last `csv_daily_returns` day, `disconnected_at`, the
 * account identity and the owner's choice — and both are tested against every
 * row of analytics-service/tests/fixtures/departed_history_inclusion.json,
 * whose `rule` list is the prose of the spec. Neither reads `created_at`.
 *
 * Pure: no I/O.
 */

/** The fields of a key the rule reads. `is_active` defaults to true when absent. */
export interface DepartedHistoryKey {
  id: string;
  exchange: string;
  venue_account_id: string | null;
  account_shared_with_api_key_id?: string | null;
  account_share_kind?: string | null;
  is_active?: boolean;
  disconnected_at: string | null;
  sync_status: string | null;
  history_inclusion: string | null;
  first_returns_day: string | null;
  last_returns_day: string | null;
}

export type DepartedHistoryReason =
  | "distinct_account"
  | "same_account_as_connected_key"
  | "same_account_as_later_key"
  | "latest_key_on_account"
  | "account_unknown"
  | "owner_excluded"
  | "owner_included"
  | "no_returns";

export interface DepartedHistoryDecision {
  included: boolean;
  /** The last UTC day the history counts; null when not included. */
  until: string | null;
  reason: DepartedHistoryReason;
}

const SHARED_ACCOUNT_MARKER_KINDS = new Set(["duplicate", "composite_member"]);

/** Sorts before every real ISO day. */
const BEFORE_EVERY_DAY = "0000-00-00";

/**
 * The allocator's eligible-key predicate (`eligible_key_predicate` in the
 * derive, `isPerKeyDailiesEligibleKey` in the reader): active, not revoked, not
 * disconnected. Every other key is departed.
 */
export function isLiveKey(key: Pick<DepartedHistoryKey, "is_active" | "sync_status" | "disconnected_at">): boolean {
  return (
    (key.is_active ?? true) === true &&
    key.sync_status !== "revoked" &&
    key.disconnected_at == null
  );
}

export function isDepartedKey(key: DepartedHistoryKey): boolean {
  return !isLiveKey(key);
}

function utcDay(value: string | null): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function dayBefore(day: string): string {
  if (day === BEFORE_EVERY_DAY) return day;
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * One token per exchange account, or null when the account is unknown. Two
 * keys read one account when they share a non-blank (exchange, venue id) —
 * exchange compared case-blind — or when one is MARKED against the other. The
 * marker is the stamper's evidence: a marked key's own venue id stays null
 * because the holder already holds the account's index slot. Twin of
 * `account_identity_tokens`.
 */
export function accountIdentityTokens(
  keys: readonly DepartedHistoryKey[],
): Map<string, string | null> {
  const parent = new Map<string, string>(keys.map((k) => [k.id, k.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  const known = new Set<string>();
  const byVenue = new Map<string, string>();
  for (const key of keys) {
    const venue = key.venue_account_id;
    if (typeof venue !== "string" || venue.trim() === "") continue;
    const pair = `${key.exchange.trim().toLowerCase()}\u0000${venue.trim()}`;
    known.add(key.id);
    const seen = byVenue.get(pair);
    if (seen === undefined) byVenue.set(pair, key.id);
    else union(seen, key.id);
  }
  for (const key of keys) {
    const holder = key.account_shared_with_api_key_id;
    if (
      key.account_share_kind != null &&
      SHARED_ACCOUNT_MARKER_KINDS.has(key.account_share_kind) &&
      holder != null &&
      holder !== key.id &&
      parent.has(holder)
    ) {
      known.add(key.id);
      known.add(holder);
      union(key.id, holder);
    }
  }
  return new Map(
    keys.map((k) => [k.id, known.has(k.id) ? `account:${find(k.id)}` : null]),
  );
}

/** [first returns day, last day it may count], or null when it has no history. */
function ownWindow(key: DepartedHistoryKey): [string, string] | null {
  const first = key.first_returns_day;
  const last = key.last_returns_day;
  const end = utcDay(key.disconnected_at) ?? last;
  if (!first || !last || !end) return null;
  const until = end < last ? end : last;
  return until >= first ? [first, until] : null;
}

/**
 * The D-09 decision for one departed `key`. `keys` is every key of the owner,
 * live and departed (it may include `key` itself); the rule decides which of
 * them count. Twin of `departed_history_inclusion`.
 */
export function departedHistoryInclusion(
  key: DepartedHistoryKey,
  keys: readonly DepartedHistoryKey[],
): DepartedHistoryDecision {
  const all = keys.some((k) => k.id === key.id) ? [...keys] : [...keys, key];
  if (key.history_inclusion === "exclude") {
    return { included: false, until: null, reason: "owner_excluded" };
  }
  const window = ownWindow(key);
  if (window === null) {
    return { included: false, until: null, reason: "no_returns" };
  }
  const [first, until] = window;
  const identity = accountIdentityTokens(all);
  const token = identity.get(key.id) ?? null;
  if (token === null) {
    return key.history_inclusion === "include"
      ? { included: true, until, reason: "owner_included" }
      : { included: false, until: null, reason: "account_unknown" };
  }

  const sameAccount = all.filter(
    (k) => k.id !== key.id && identity.get(k.id) === token,
  );
  const liveFirsts = sameAccount
    .filter(isLiveKey)
    .map((k) => k.first_returns_day ?? BEFORE_EVERY_DAY);
  // The departed keys that count on this account, this key among them, in
  // D-09 order: first returns day, then last returns day, then id.
  const countedDeparted = [...sameAccount, key]
    .filter(
      (k) =>
        !isLiveKey(k) &&
        k.history_inclusion !== "exclude" &&
        ownWindow(k) !== null,
    )
    .map((k) => [k.first_returns_day!, k.last_returns_day!, k.id] as const)
    .sort((a, b) =>
      a[0] !== b[0]
        ? a[0] < b[0] ? -1 : 1
        : a[1] !== b[1]
          ? a[1] < b[1] ? -1 : 1
          : a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0,
    );
  const position = countedDeparted.findIndex((entry) => entry[2] === key.id);
  const successor = countedDeparted[position + 1] ?? null;

  const bounds = [until];
  if (liveFirsts.length > 0) {
    bounds.push(dayBefore(liveFirsts.reduce((a, b) => (b < a ? b : a))));
  }
  if (successor !== null) bounds.push(dayBefore(successor[0]));
  const countedUntil = bounds.reduce((a, b) => (b < a ? b : a));

  const reason: DepartedHistoryReason =
    liveFirsts.length > 0
      ? "same_account_as_connected_key"
      : successor !== null
        ? "same_account_as_later_key"
        : position > 0
          ? "latest_key_on_account"
          : "distinct_account";
  return countedUntil < first
    ? { included: false, until: null, reason }
    : { included: true, until: countedUntil, reason };
}

/**
 * The one sentence a departed key's card shows for a decision (DESIGN.md
 * Voice: declarative, the limitation stated with its reason). `anchored` is
 * false when the balance the history is measured from is gone (the derive then
 * leaves the key out under `departed_history_unavailable`), so an included key
 * is never said to be in a book that cannot hold it.
 */
export function departedHistorySentence(
  decision: DepartedHistoryDecision,
  anchored: boolean,
): string {
  if (decision.included) {
    if (!anchored) {
      return "History not available: the balance it is measured from was deleted before departed history was kept.";
    }
    switch (decision.reason) {
      case "same_account_as_connected_key":
        return `History included until ${decision.until}. From the next day a key you still have connected reads this account.`;
      case "same_account_as_later_key":
        return `History included until ${decision.until}. From the next day a later key read this account.`;
      default:
        return `History included until ${decision.until}.`;
    }
  }
  switch (decision.reason) {
    case "account_unknown":
      return "History not included: we cannot tell whether this key read the same exchange account as a key you still have connected. Include it if it was a different account.";
    case "owner_excluded":
      return "History not included: you excluded it.";
    case "same_account_as_connected_key":
      return "History not included: a key you still have connected reads the same exchange account over these days.";
    case "same_account_as_later_key":
      return "History not included: a later key read the same exchange account over these days.";
    case "no_returns":
      return "No history to include: this key has no daily returns before it stopped.";
    default:
      return "History not included.";
  }
}
