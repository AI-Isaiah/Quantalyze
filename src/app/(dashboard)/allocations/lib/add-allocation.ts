/**
 * Phase 198 plan 05 — the pure half of the allocator's "+ Allocation" flow.
 *
 * Everything the flow DECIDES lives here, so it can be tested without a DOM:
 * which route a pick is written through, the body, the refusals, the date
 * window, the held set, the deep-link resolution and the success copy. The
 * component (`AddAllocationFlow.tsx`) only renders and posts what this says.
 *
 * D-05, two routes and no new endpoint:
 *   - a strategy the allocator OWNS (`isOwn === true`) is written to
 *     `ALLOCATION_ROUTE`, which creates a Holdings row (`{ strategy_id,
 *     allocated_amount }`, no date, no Book equity);
 *   - anyone else's strategy is written as ONE `voluntary_add` diff to
 *     `COMMIT_ROUTE`, which records an Outcomes row, never a Holdings row.
 *
 * The commit body deliberately has no fingerprint key: this is a record-only add,
 * and a fingerprint would turn it into a stale-draft fence that answers 409 for a
 * request that never depended on a draft.
 */

import { formatUsd } from "@/lib/dollar-validation";
import { formatDay, isUuid } from "@/lib/utils";
import {
  OUTCOME_DATE_FUTURE_MESSAGE,
  OUTCOME_DATE_TOO_OLD_MESSAGE,
} from "@/lib/bridge-outcome-schema";
import { ALLOCATION_ROUTE, parseAmount } from "../components/AllocateDialog";

/** The scenario commit route a third-party add is recorded through. */
export const COMMIT_ROUTE = "/api/allocator/scenario/commit";

/** Refused at the amount field when Allocation equity is not a usable divisor. */
export const BOOK_EQUITY_UNAVAILABLE_MESSAGE =
  "We cannot size this allocation until your allocation equity is available.";

/** Refused at the date field when the value is empty or not a calendar date. */
export const ALLOCATION_DATE_REQUIRED_MESSAGE = "Enter the allocation date.";

export function aboveBookEquityMessage(bookEquityUsd: number): string {
  return `Enter an amount up to your allocation equity (${formatUsd(bookEquityUsd)}).`;
}

// ───────────────────────────────────────────────────────────────── dispatch

export interface AllocationRow {
  id: string;
  /** Absent means UNKNOWN, which is not own: the gate is `=== true`. */
  isOwn?: boolean;
}

export type VoluntaryAddDiff = {
  kind: "voluntary_add";
  strategy_id: string;
  percent_allocated: number;
  size_at_decision_usd: number;
  effective_date: string;
};

export type AllocationRequest =
  | {
      ok: true;
      route: typeof ALLOCATION_ROUTE;
      body: { strategy_id: string; allocated_amount: number };
      /** The allocation route has no idempotency contract, so no key is sent. */
      idempotent: false;
    }
  | {
      ok: true;
      route: typeof COMMIT_ROUTE;
      body: { diffs: [VoluntaryAddDiff] };
      /** The commit route dedups on `Idempotency-Key`; the caller must send one. */
      idempotent: true;
    }
  | { ok: false; field: "amount"; message: string };

/**
 * Decide the write for one pick. The amount rule (above $0, under the ticket cap)
 * is `parseAmount`'s on BOTH branches, so it has one source.
 *
 * The share of book is never guessed: it is `amount / bookEquityUsd * 100`, and
 * with no finite, positive Book equity the third-party branch refuses instead of
 * sending a percent. The same refusal holds when every key is stale: the share
 * line is hidden then (UI-SPEC OQ-2), and the stored percent is the only size an
 * Outcomes row keeps, so it must not be built from a figure the UI declined to
 * show. Above 100% is refused too (the route accepts 0..100 and an
 * allocation larger than the whole book is a typo, not a request).
 */
export function buildAllocationRequest(args: {
  row: AllocationRow;
  amountUsd: number;
  dateIso: string;
  bookEquityUsd: number | null;
  allKeysStale: boolean;
}): AllocationRequest {
  const { row, amountUsd, dateIso, bookEquityUsd, allKeysStale } = args;
  // String(n) round-trips a finite number exactly, and NaN/Infinity come back as
  // the non-positive refusal, which is what an unparsable amount should say.
  const parsed = parseAmount(String(amountUsd));
  if (!parsed.ok) return { ok: false, field: "amount", message: parsed.error };

  if (row.isOwn === true) {
    return {
      ok: true,
      route: ALLOCATION_ROUTE,
      body: { strategy_id: row.id, allocated_amount: parsed.value },
      idempotent: false,
    };
  }

  if (
    allKeysStale ||
    bookEquityUsd === null ||
    !Number.isFinite(bookEquityUsd) ||
    bookEquityUsd <= 0
  ) {
    return {
      ok: false,
      field: "amount",
      message: BOOK_EQUITY_UNAVAILABLE_MESSAGE,
    };
  }
  if (parsed.value > bookEquityUsd) {
    return {
      ok: false,
      field: "amount",
      message: aboveBookEquityMessage(bookEquityUsd),
    };
  }
  return {
    ok: true,
    route: COMMIT_ROUTE,
    body: {
      diffs: [
        {
          kind: "voluntary_add",
          strategy_id: row.id,
          percent_allocated: (parsed.value / bookEquityUsd) * 100,
          size_at_decision_usd: parsed.value,
          effective_date: dateIso,
        },
      ],
    },
    idempotent: true,
  };
}

// ───────────────────────────────────────────────────────────────────── date

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isRealIsoDate(dateIso: string): boolean {
  if (!ISO_DATE_RE.test(dateIso)) return false;
  const t = Date.parse(`${dateIso}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === dateIso;
}

/**
 * The allocation-date window: not in the future, not more than 365 days back.
 * It is enforced client-side because the commit route does not enforce it, and it
 * is the same window `ALLOCATED_FIELDS` enforces for a recorded outcome, so the
 * messages are the schema's own constants. `todayIso` is passed in (UTC) so the
 * boundary is testable. Returns the message, or null when the date is allowed.
 */
export function validateAllocationDate(
  dateIso: string,
  todayIso: string,
): string | null {
  if (!isRealIsoDate(dateIso) || !isRealIsoDate(todayIso)) {
    return ALLOCATION_DATE_REQUIRED_MESSAGE;
  }
  if (dateIso > todayIso) return OUTCOME_DATE_FUTURE_MESSAGE;
  if (dateIso < earliestAllocationDateIso(todayIso)) {
    return OUTCOME_DATE_TOO_OLD_MESSAGE;
  }
  return null;
}

/** The UTC calendar day `todayIso` and the form's `max` are both derived from. */
export function todayUtcIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The earliest allowed date for the form's `min`, from the same arithmetic. */
export function earliestAllocationDateIso(todayIso: string): string {
  return new Date(Date.parse(`${todayIso}T00:00:00Z`) - 365 * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// ───────────────────────────────────────────────────────────────────── copy

/**
 * Says WHERE the allocation landed. An own allocation is a Holdings row; a
 * third-party add is an Outcomes record and never claims a Holdings row (C3).
 */
export function successAnnouncement(args: {
  name: string;
  isOwn: boolean;
  amountUsd: number;
  dateIso: string;
}): string {
  const { name, isOwn, amountUsd, dateIso } = args;
  const amount = formatUsd(amountUsd);
  if (isOwn) {
    return `Allocation recorded: ${name}, ${amount}. It is listed under Strategies on Holdings.`;
  }
  return `Allocation recorded: ${name}, ${amount} from ${formatDay(dateIso)}. It is listed under Outcomes on Holdings.`;
}

// ──────────────────────────────────────────────────────────────── held set

/**
 * The strategies already in the allocator's book: every Holdings strategy and
 * every strategy an `allocated` outcome recorded. The commit route has no
 * per-strategy uniqueness (RESEARCH P2), so this set is what stops a strategy
 * recorded under Outcomes from being added a second time. A `rejected` outcome is
 * a decision NOT to allocate and adds nothing.
 *
 * `allocatedOutcomeStrategyIds` is the uncapped read (`heldOutcomeStrategyIds`).
 * The `outcomes` list is capped at 200 rows and a row whose strategy join is null
 * carries no id, so it alone could offer a held strategy again.
 */
export function heldStrategyIdsFrom(
  strategies: readonly { strategy_id: string }[],
  outcomes: readonly {
    kind: string;
    replacement_strategy: { id: string } | null;
  }[],
  allocatedOutcomeStrategyIds: readonly string[],
): Set<string> {
  const held = new Set<string>(allocatedOutcomeStrategyIds);
  for (const s of strategies) held.add(s.strategy_id);
  for (const o of outcomes) {
    if (o.kind === "allocated" && o.replacement_strategy) {
      held.add(o.replacement_strategy.id);
    }
  }
  return held;
}

// ─────────────────────────────────────────────────────────────── deep link

/**
 * The picker's "not selectable" test for an OWN strategy, single-sourced so the
 * picker row and the `?add=` deep link cannot disagree. The allocation route
 * refuses an own strategy that is not marked own capital with a 409 every time,
 * so the flow must stop it before the amount step.
 *
 * The own-capital set omits archived strategies, so it cannot decide them (the
 * route's 409 still refuses an unmarked one, review R3-02). An `undefined` set
 * means the read failed: a blip never disables a row.
 */
export function isNotOwnCapital(
  row: { id: string; isOwn?: boolean; status?: string | null },
  ownCapitalStrategyIds: ReadonlySet<string> | undefined,
): boolean {
  return (
    row.isOwn === true &&
    row.status !== "archived" &&
    ownCapitalStrategyIds !== undefined &&
    !ownCapitalStrategyIds.has(row.id)
  );
}

export type DeepLinkResolution<Row extends { id: string }> =
  | { kind: "none" }
  | { kind: "unavailable"; reason: "malformed" | "unlisted" }
  | { kind: "not_loaded" }
  | { kind: "held"; row: Row }
  | { kind: "unmarked_own"; row: Row }
  | { kind: "prefill"; row: Row };

/**
 * Resolve a `?add=` value against the list the server returned. The URL id is
 * never trusted: it must be a uuid AND be in the allocator-gated list. Absence
 * from a TRUNCATED list proves nothing, so that is `not_loaded`, not
 * `unavailable`. The write routes re-validate regardless.
 *
 * A listed own strategy that is not marked own capital resolves to
 * `unmarked_own` (the picker's own test, `isNotOwnCapital`), so the link lands
 * on the disabled row's reason instead of reaching an amount step whose submit
 * the route refuses. Already-held is checked first: it is the more useful answer.
 */
export function resolveDeepLink<
  Row extends { id: string; isOwn?: boolean; status?: string | null },
>(
  raw: string,
  rows: readonly Row[],
  hasMore: boolean,
  held: ReadonlySet<string>,
  ownCapitalStrategyIds?: ReadonlySet<string>,
): DeepLinkResolution<Row> {
  const value = raw.trim();
  if (value === "") return { kind: "none" };
  if (!isUuid(value)) return { kind: "unavailable", reason: "malformed" };
  const id = value.toLowerCase();
  const row = rows.find((r) => r.id.toLowerCase() === id);
  if (!row) {
    return hasMore
      ? { kind: "not_loaded" }
      : { kind: "unavailable", reason: "unlisted" };
  }
  if (held.has(row.id)) return { kind: "held", row };
  if (isNotOwnCapital(row, ownCapitalStrategyIds)) {
    return { kind: "unmarked_own", row };
  }
  return { kind: "prefill", row };
}

// ──────────────────────────────────────────────────────── commit response

/**
 * The strict success gate for the commit route's response body: exactly one
 * recorded and no errors. Anything else (a malformed body, 0 or 2 recorded, a
 * non-empty error list) is NOT success, and the caller maps it to the
 * indeterminate envelope rather than claiming either outcome.
 */
export function commitSucceeded(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const { recorded, errors } = raw as { recorded?: unknown; errors?: unknown };
  if (recorded !== 1) return false;
  if (errors === undefined || errors === null) return true;
  return Array.isArray(errors) && errors.length === 0;
}
