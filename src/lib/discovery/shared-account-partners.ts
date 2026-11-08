import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminUser } from "@/lib/admin";
import { captureToSentry } from "@/lib/sentry-capture";
import { createAdminClient } from "@/lib/supabase/admin";
import { withPublishedOnly } from "@/lib/visibility";

/**
 * Phase 197 plan 02 (CLAR-05 data side; D-01, D-02) - which published strategies
 * draw on the same exchange account as each listed strategy.
 *
 * Why a service-role read: `api_keys` and `strategy_keys` are owner-only under RLS
 * (`api_keys_owner`, `strategy_keys_owner`), so no user-scoped client can see
 * another manager's keys. This module reads them with the service role, gated on
 * admin INSIDE the module (D-01): a non-admin gets `null` and the service-role
 * client is never created, whatever the caller does.
 *
 * The service role bypasses RLS, so `withPublishedOnly` on the strategies read is
 * the ONLY fence (D-02). Reading published strategies only means an unpublished
 * strategy can never enter a group, so it is never named, counted or hinted at,
 * and never makes a published strategy show a notice.
 *
 * What never leaves this function: the exchange, the venue account id, any key id
 * or label, and every encrypted column. `api_keys` is selected with identity
 * columns only, and the return value is a map from strategy id to the NAMES of its
 * published partners. No wording about the relationship lives here: names, no
 * verdict.
 *
 * Failures return `null` (the caller renders no notices) and are captured to
 * Sentry; the reader never throws, so an admin-only informational line cannot take
 * discovery down.
 *
 * Never import this module from a client component: it holds the service role.
 */

export type PartnerMap = Record<string, string[]>;

type StrategyRow = { id: string; name: string; api_key_id: string | null };
type StrategyKeyRow = { strategy_id: string; api_key_id: string };
type ApiKeyRow = {
  id: string;
  exchange: string | null;
  venue_account_id: string | null;
  account_shared_with_api_key_id: string | null;
};

/**
 * Ids per `.in()` filter. PostgREST takes the filter in the URL, so an unbounded
 * id list on a growing catalogue would eventually exceed the request-line limit.
 */
const IN_CHUNK = 100;

/**
 * Rows per strategies page. PostgREST truncates a response at `max_rows` (1000 in
 * supabase/config.toml) without an error, so the published read is paged to stay
 * at or under it. The chunked `.in()` reads below stay unpaged on purpose: a chunk
 * is at most 100 ids, so `api_keys` returns at most 100 rows and `strategy_keys`
 * would need more than ten links per strategy to reach the cap.
 */
const PAGE = 1000;

/**
 * The identity tokens a key contributes. Two strategies share an account when any
 * token of theirs matches:
 *   - `key:<id>`: the same key (a key id with no `api_keys` row still counts).
 *   - `key:<account_shared_with_api_key_id>`: the holder key the daily identity
 *     stamper marked this key against, so a marked key and its holder are one
 *     account whatever their venue ids say.
 *   - `venue:<exchange lowercased and trimmed>:<venue id trimmed>`, only when the
 *     trimmed venue id is non-empty. A blank or null venue id is unknown identity
 *     and never groups two strategies on its own. This is the
 *     `account_identity_collisions` rule in analytics-service/services/job_worker.py,
 *     minus its interval-overlap test: a listing has no counted days, so any shared
 *     identity counts (RESEARCH A1; admin-only and informational).
 */
function identitiesOf(keyId: string, k: ApiKeyRow | undefined): string[] {
  const out = [`key:${keyId}`];
  if (!k) return out;
  if (k.account_shared_with_api_key_id) out.push(`key:${k.account_shared_with_api_key_id}`);
  const venueId = k.venue_account_id?.trim();
  if (venueId) out.push(`venue:${(k.exchange ?? "").trim().toLowerCase()}:${venueId}`);
  return out;
}

export function groupSharedAccountPartners(input: {
  strategies: readonly StrategyRow[];
  strategyKeys: readonly StrategyKeyRow[];
  apiKeys: readonly ApiKeyRow[];
  forStrategyIds: readonly string[];
}): PartnerMap {
  const keyById = new Map(input.apiKeys.map((k) => [k.id, k]));
  const keyIdsByStrategy = new Map<string, Set<string>>();
  const addKey = (strategyId: string, keyId: string | null) => {
    if (!keyId) return;
    const set = keyIdsByStrategy.get(strategyId) ?? new Set<string>();
    set.add(keyId);
    keyIdsByStrategy.set(strategyId, set);
  };
  for (const s of input.strategies) addKey(s.id, s.api_key_id);
  for (const sk of input.strategyKeys) addKey(sk.strategy_id, sk.api_key_id);

  const identitiesByStrategy = new Map<string, Set<string>>();
  for (const s of input.strategies) {
    const ids = new Set<string>();
    for (const keyId of keyIdsByStrategy.get(s.id) ?? []) {
      for (const token of identitiesOf(keyId, keyById.get(keyId))) ids.add(token);
    }
    identitiesByStrategy.set(s.id, ids);
  }

  const wanted = new Set(input.forStrategyIds);
  const out: PartnerMap = {};
  for (const s of input.strategies) {
    if (!wanted.has(s.id)) continue;
    const mine = identitiesByStrategy.get(s.id) ?? new Set<string>();
    const partners = input.strategies.filter((t) => {
      if (t.id === s.id) return false;
      const theirs = identitiesByStrategy.get(t.id);
      return theirs ? [...theirs].some((token) => mine.has(token)) : false;
    });
    if (partners.length > 0) {
      // Names only, sorted by name then id so the rendered line never reshuffles.
      out[s.id] = partners
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((p) => p.name);
    }
  }
  return out;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Report a failed read to Sentry and fail closed: the caller renders no notices. */
function failed(reason: string, detail: string): null {
  captureToSentry(new Error(`shared account partners ${reason}`), {
    tags: { stage: "shared-account-partners", reason },
    extra: { detail },
  });
  return null;
}

export async function getSharedAccountPartners(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null } | null | undefined,
  forStrategyIds: readonly string[],
): Promise<PartnerMap | null> {
  // D-01: the admin check runs BEFORE the service-role client exists.
  if (!(await isAdminUser(supabase, user))) return null;

  try {
    const admin = createAdminClient();

    // Stable order plus a range, until a short page: without it a catalogue past
    // `max_rows` is cut silently and a partner beyond the cut is never named.
    const strategies: StrategyRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = await withPublishedOnly(admin.from("strategies").select("id, name, api_key_id"))
        .order("id")
        .range(from, from + PAGE - 1)
        .returns<StrategyRow[]>();
      if (page.error) return failed("strategies_read_error", page.error.message);
      strategies.push(...(page.data ?? []));
      if ((page.data?.length ?? 0) < PAGE) break;
    }
    if (strategies.length === 0) return {};

    const strategyKeys: StrategyKeyRow[] = [];
    for (const ids of chunk(
      strategies.map((s) => s.id),
      IN_CHUNK,
    )) {
      const { data, error } = await admin
        .from("strategy_keys")
        .select("strategy_id, api_key_id")
        .in("strategy_id", ids)
        .returns<StrategyKeyRow[]>();
      if (error) return failed("strategy_keys_read_error", error.message);
      strategyKeys.push(...(data ?? []));
    }

    const keyIds = [
      ...new Set([
        ...strategies.map((s) => s.api_key_id).filter((id): id is string => !!id),
        ...strategyKeys.map((sk) => sk.api_key_id),
      ]),
    ];
    if (keyIds.length === 0) return {};

    const apiKeys: ApiKeyRow[] = [];
    for (const ids of chunk(keyIds, IN_CHUNK)) {
      const { data, error } = await admin
        .from("api_keys")
        .select("id, exchange, venue_account_id, account_shared_with_api_key_id")
        .in("id", ids)
        .returns<ApiKeyRow[]>();
      if (error) return failed("api_keys_read_error", error.message);
      apiKeys.push(...(data ?? []));
    }

    return groupSharedAccountPartners({ strategies, strategyKeys, apiKeys, forStrategyIds });
  } catch (err) {
    return failed("read_threw", err instanceof Error ? err.message : String(err));
  }
}
