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

import type { ApiKeyAccountShareKind } from "@/lib/types";
import { formatDay } from "@/lib/utils";

/** The fields of a key the rule reads. `is_active` defaults to true when absent. */
export interface DepartedHistoryKey {
  id: string;
  exchange: string;
  venue_account_id: string | null;
  /**
   * Phase 225 CONN-03 (CONTEXT Q6): the broker server a key reads. Part of the
   * account identity: one login on two set servers is two accounts. Absent or
   * null means no server recorded.
   */
  venue_server?: string | null;
  account_shared_with_api_key_id?: string | null;
  account_share_kind?: string | null;
  is_active?: boolean;
  disconnected_at: string | null;
  sync_status: string | null;
  history_inclusion: string | null;
  first_returns_day: string | null;
  last_returns_day: string | null;
  /**
   * False when the key has no saved balance to level its history from (its
   * key_inputs row is missing or carries a null anchor). Default true.
   * WR-R2-02: such a key neither covers nor bounds another key.
   */
  anchored?: boolean;
}

export type DepartedHistoryReason =
  | "distinct_account"
  | "same_account_as_connected_key"
  | "same_account_as_connected_key_pending"
  | "same_account_as_later_key"
  | "same_account_as_earlier_key"
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

/**
 * Which `account_share_kind` values join two keys into one account (IN-03).
 * Keyed by the closed union, so a kind added to `ApiKeyAccountShareKind` fails
 * to compile here until someone decides it; the Python twin reads the derive's
 * `SHARED_ACCOUNT_KINDS` itself, never a copy.
 */
const MARKER_KIND_IS_SHARED: Record<ApiKeyAccountShareKind, boolean> = {
  duplicate: true,
  composite_member: true,
};
const SHARED_ACCOUNT_MARKER_KINDS: ReadonlySet<string> = new Set(
  Object.entries(MARKER_KIND_IS_SHARED)
    .filter(([, shared]) => shared)
    .map(([kind]) => kind),
);

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
 * Phase 225 CONN-03, CONTEXT Q6 (founder ruling 2026-11-25 and the marked agent
 * decision): each key's login identity and the ids of its AMBIGUOUS keys. One
 * canonical identity per key, never a pairwise wildcard: union-find is
 * transitive, so a key with no server unioned pairwise with servers a and b
 * would merge a and b again.
 *
 * - login: `venue_account_id` trimmed; a blank or non-string login has no
 *   identity.
 * - server: `venue_server` when it is a non-empty string, else none. Read as
 *   stored, never trimmed or case-folded (every writer already stores the
 *   normalised form).
 * - for each (exchange case-blind, login), S is the set of distinct servers
 *   among `keys`. A key's canonical server is its own, else "" when S is empty,
 *   else the single member when S has one, else NONE: the key is AMBIGUOUS and
 *   its identity is null.
 */
function loginIdentities(keys: readonly DepartedHistoryKey[]): {
  identities: Map<string, string | null>;
  ambiguous: Set<string>;
} {
  const servers = new Map<string, Set<string>>();
  const parsed = new Map<string, { pair: string; own: string | null } | null>();
  for (const key of keys) {
    const venue = key.venue_account_id;
    if (typeof venue !== "string" || venue.trim() === "") {
      parsed.set(key.id, null);
      continue;
    }
    const pair = `${key.exchange.trim().toLowerCase()}\u0000${venue.trim()}`;
    const own =
      typeof key.venue_server === "string" && key.venue_server !== ""
        ? key.venue_server
        : null;
    parsed.set(key.id, { pair, own });
    if (own !== null) {
      const seen = servers.get(pair) ?? new Set<string>();
      seen.add(own);
      servers.set(pair, seen);
    }
  }
  const identities = new Map<string, string | null>();
  const ambiguous = new Set<string>();
  for (const [id, item] of parsed) {
    if (item === null) {
      identities.set(id, null);
      continue;
    }
    const { pair, own } = item;
    if (own !== null) {
      identities.set(id, `${pair}\u0000${own}`);
      continue;
    }
    const seen = servers.get(pair);
    if (seen === undefined || seen.size === 0) {
      identities.set(id, `${pair}\u0000`);
    } else if (seen.size === 1) {
      identities.set(id, `${pair}\u0000${[...seen][0]}`);
    } else {
      identities.set(id, null);
      ambiguous.add(id);
    }
  }
  return { identities, ambiguous };
}

/**
 * Each key's login identity `exchange\0login\0canonical server`, or null for a
 * key with no login or an ambiguous one (CONTEXT Q6, `loginIdentities`).
 * Twins: Python `_login_identities` and the SQL `commit_scenario_batch`; the
 * `tokens` section of analytics-service/tests/fixtures/venue_server_identity.json
 * pins all three. Pure.
 */
export function accountLoginIdentity(
  keys: readonly DepartedHistoryKey[],
): Map<string, string | null> {
  return loginIdentities(keys).identities;
}

/**
 * The ids of keys whose account cannot be placed: a non-blank login, no
 * server, and two or more distinct set servers on their (exchange, login). Such
 * a key joins no login union, so `keyAccountOf` gives it its own `key:<id>`
 * account and `departedHistoryInclusion` reads it as `account_unknown`. Only
 * the Python derive refuses. Twin of Python `ambiguous_server_key_ids`. Pure.
 */
export function ambiguousServerKeyIds(
  keys: readonly DepartedHistoryKey[],
): Set<string> {
  return loginIdentities(keys).ambiguous;
}

/**
 * One token per exchange account, or null when the account is unknown. Two
 * keys read one account when they share a login identity (`accountLoginIdentity`:
 * exchange case-blind, login, canonical server; one login on two set servers is
 * TWO accounts) or when one is MARKED against the other. The marker is the
 * stamper's evidence: a marked key's own venue id stays null because the holder
 * already holds the account's index slot. The token is `account:<smallest id>`.
 * Twin of Python `account_identity_tokens` and SQL `commit_scenario_batch`.
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
  const { identities } = loginIdentities(keys);
  for (const key of keys) {
    const identity = identities.get(key.id) ?? null;
    if (identity === null) continue;
    known.add(key.id);
    const seen = byVenue.get(identity);
    if (seen === undefined) byVenue.set(identity, key.id);
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
  // WR-R2-02: a key with no saved balance is never counted by the book, so it
  // covers and bounds no other key; it is ordered only when it is the key
  // being decided.
  const countedDeparted = [...sameAccount, key]
    .filter(
      (k) =>
        !isLiveKey(k) &&
        k.history_inclusion !== "exclude" &&
        ownWindow(k) !== null &&
        (k.id === key.id || k.anchored !== false),
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
  // SFH-C4-07: a key that stops counting before a key ordered ahead of it is
  // COVERED — that earlier key reads the account over all its days. It counts
  // zero days and bounds nothing; otherwise the earlier key's tail after the
  // covered key's end would count nowhere.
  const lastCountable = new Map(
    [...sameAccount, key].map((k) => [k.id, ownWindow(k)?.[1] ?? BEFORE_EVERY_DAY]),
  );
  const covered = new Set(
    countedDeparted
      .filter((entry, index) =>
        countedDeparted
          .slice(0, index)
          .some((earlier) => lastCountable.get(entry[2])! < lastCountable.get(earlier[2])!),
      )
      .map((entry) => entry[2]),
  );
  const isCovered = covered.has(key.id);
  const successor = isCovered
    ? null
    : (countedDeparted.slice(position + 1).find((entry) => !covered.has(entry[2])) ?? null);

  const bounds = [until];
  if (liveFirsts.length > 0) {
    bounds.push(dayBefore(liveFirsts.reduce((a, b) => (b < a ? b : a))));
  }
  if (isCovered) bounds.push(BEFORE_EVERY_DAY);
  if (successor !== null) bounds.push(dayBefore(successor[0]));
  const countedUntil = bounds.reduce((a, b) => (b < a ? b : a));

  // WR-04: a live key on this account with no returns yet reads none of these
  // days today; the decision is made again once it has returns.
  const reason: DepartedHistoryReason = liveFirsts.includes(BEFORE_EVERY_DAY)
    ? "same_account_as_connected_key_pending"
    : liveFirsts.length > 0
      ? "same_account_as_connected_key"
      : isCovered
        ? "same_account_as_earlier_key"
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
 * What the derive can level a departed key's history from: its
 * `key_inputs:<id>` row in allocator_equity_derived. `missing` is no row (the
 * pre-plan-09 orphan cleanup deleted it); `unusable` is a row whose last
 * balance read stamped a null anchor with `anchor_null_reason` (SFH-C4-06).
 * Either way the derive leaves the key out under `departed_history_unavailable`.
 */
export type DepartedAnchor =
  | { state: "anchored" }
  | { state: "missing" }
  | { state: "unusable"; reason: string | null };

/** The anchor state of a key_inputs row, or `missing` when there is none. */
export function departedAnchorOf(row: { payload: unknown } | undefined): DepartedAnchor {
  if (row === undefined) return { state: "missing" };
  const payload =
    row.payload !== null && typeof row.payload === "object"
      ? (row.payload as { anchor_usd?: unknown; anchor_null_reason?: unknown })
      : {};
  if (typeof payload.anchor_usd === "number" && Number.isFinite(payload.anchor_usd)) {
    return { state: "anchored" };
  }
  const reason = payload.anchor_null_reason;
  return {
    state: "unusable",
    reason: typeof reason === "string" && reason !== "" ? reason : null,
  };
}

/** Why a departed key's history cannot be in the book, by its real cause. */
function unavailableSentence(anchor: DepartedAnchor): string {
  if (anchor.state !== "unusable") {
    return "History not available: the balance it is measured from was deleted before departed history was kept.";
  }
  switch (anchor.reason) {
    case "balance_error":
      return "History not available: the last balance read before this key stopped failed, so there is no balance to measure its history from.";
    case "nonfinite":
      return "History not available: the last balance read before this key stopped returned a value that is not a number, so there is no balance to measure its history from.";
    case "nonpositive":
      return "History not available: the last balance read before this key stopped was zero or negative, so there is no balance to measure its history from.";
    case "dust":
      return "History not available: the last balance read before this key stopped was too small to measure its history from.";
    case "flow_drop":
      return "History not available: a deposit or withdrawal on this key could not be read, so its history cannot be measured from its last balance.";
    case "native_unit":
      // 164.6.6.2 D-13: the derive stamps this for an account denominated in a non-USD
      // currency (a BTC MT5 account). The read worked; the balance simply is not dollars.
      return "History not available: this account is measured in its own currency, not USD, so it cannot be added to a USD history.";
    case "native_unpriced":
      // Phase 164.6.6.2.1 D-09: the derive stamps this when a native-unit account's
      // last balance has no stored close for its day. The currency is supported and
      // the read worked; what is missing is a price for that one day.
      return "History not available: no BTC close is stored for this account's last day, so its last balance cannot be priced in USD.";
    default:
      return "History not available: the last balance read before this key stopped gave no usable balance to measure its history from.";
  }
}

/** What a departed key's card shows: its line, its switch state, and the one
 * change the switch may make (null: disabled). */
export interface DepartedHistoryCard {
  sentence: string;
  checked: boolean;
  toggleTo: "include" | "exclude" | null;
}

/**
 * The card for one departed key. The switch is ON only when the book really
 * holds the key's history, and it is live only where flipping it changes what
 * the book holds (SFH-C4-05): 'include' never lifts a known account's bound, a
 * key with no returns has nothing to include, and a key with no usable anchor
 * is left out by the derive whatever the switch says, so its card names that
 * cause instead of inviting a change that cannot take effect.
 */
export function departedHistoryCard(
  key: DepartedHistoryKey,
  keys: readonly DepartedHistoryKey[],
  anchor: DepartedAnchor,
): DepartedHistoryCard {
  const decision = departedHistoryInclusion(key, keys);
  const next = decision.included ? "exclude" : "include";
  const alternative = departedHistoryInclusion({ ...key, history_inclusion: next }, keys);
  if (anchor.state !== "anchored" && (decision.included || alternative.included)) {
    return { sentence: unavailableSentence(anchor), checked: false, toggleTo: null };
  }
  return {
    sentence: departedHistorySentence(decision),
    checked: decision.included,
    toggleTo: alternative.included !== decision.included ? next : null,
  };
}

/**
 * The one sentence a departed key's card shows for a decision (DESIGN.md
 * Voice: declarative, the limitation stated with its reason). A key with no
 * usable anchor takes `departedHistoryCard`'s not-available line instead.
 */
export function departedHistorySentence(decision: DepartedHistoryDecision): string {
  if (decision.included) {
    switch (decision.reason) {
      case "same_account_as_connected_key":
        return `History included until ${formatDay(decision.until)}. From the next day a key you still have connected reads this account.`;
      case "same_account_as_later_key":
        return `History included until ${formatDay(decision.until)}. From the next day a later key read this account.`;
      default:
        return `History included until ${formatDay(decision.until)}.`;
    }
  }
  switch (decision.reason) {
    case "account_unknown":
      return "History not included: we cannot tell whether this key read the same exchange account as a key you still have connected. Include it if it was a different account.";
    case "owner_excluded":
      return "History not included: you excluded it.";
    case "same_account_as_connected_key":
      return "History not included: a key you still have connected reads the same exchange account over these days.";
    case "same_account_as_connected_key_pending":
      return "History not included yet: a key you still have connected reads the same exchange account and has no history yet. Once it has, this key counts for the days before that key's history starts.";
    case "same_account_as_later_key":
      return "History not included: a later key read the same exchange account over these days.";
    case "same_account_as_earlier_key":
      return "History not included: an earlier key read the same exchange account over all of these days.";
    case "no_returns":
      return "No history to include: this key has no daily returns before it stopped.";
    default:
      return "History not included.";
  }
}
