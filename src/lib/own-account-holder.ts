import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFactsheetHref } from "@/lib/factsheet/origin";
import { captureToSentry } from "@/lib/sentry-capture";
import { isUuid } from "@/lib/utils";

/**
 * WHO ALREADY HOLDS THIS ACCOUNT, as told to the person who just tried to add it
 * again (founder 2026-11-25: the same account may sit on many accounts of the
 * platform; it only goes wrong when ONE person forgets they already added it and
 * adds it twice, which counts it twice. So the refusal names what they already
 * have and links to it).
 *
 * ⭐ THE CALLER'S OWN ROWS, AND ONLY EVER THAT. Every read below carries an
 * explicit `user_id` / `owner_id` filter on the id the caller passes in, which
 * the routes take from `withAuth`'s session and never from a body. The admin
 * client crosses RLS by design, so the filter, not the client, is the tenant
 * boundary. Another account's key or strategy on the same login is never read,
 * so it can never be named. Nothing here returns a login, a server or a key id.
 *
 * ⛔ IT NEVER THROWS AND NEVER DECIDES THE REFUSAL. The refusal is established
 * by the caller before this runs; this only adds a name and a link to it. A
 * faulted read answers `null` (the refusal then carries no `holder`, and its
 * copy is complete and true without one).
 *
 * WHERE THE LINK GOES, verified at the pages rather than assumed:
 *   · a strategy → its factsheet, the same link the `/strategies` list's name
 *     cell renders (`StrategyTable.tsx`, `buildFactsheetHref(s.id, …)`);
 *   · a key with no strategy → `/strategies`. That page serves manager,
 *     allocator and `both` alike (`strategies/page.tsx`: the role gate admits
 *     all three), and its "No strategy yet" rows come from
 *     `getStrategylessActiveKeys`, which has no role filter (`queries.ts`).
 */
export type AccountHolder = {
  kind: "strategy" | "key";
  /** The strategy's name, or the key's nickname. Never blank. */
  name: string;
  /** ISO timestamp the key was added. Only on `kind: "key"`. */
  added_at?: string;
  /** A real in-app route. */
  href: string;
  /**
   * The stored key's own id. Only on `kind: "key"`, and only on the
   * `KEY_ORPHANED` refusal of `strategies/create-with-key`, which adds it so the
   * wizard can finish setup on that key in place (its reuse arm) instead of
   * sending the person to `/strategies` to find the row (founder 2026-11-26).
   * `readOwnAccountHolder` never sets it. It is the caller's own key uuid, which
   * `/api/keys` and the "No strategy yet" rows already hand them; it is not the
   * venue identity (no login, no server).
   */
  api_key_id?: string;
};

type Db = Pick<SupabaseClient, "from">;

type StrategyHolderRow = { id: string; name: unknown; status: unknown };

function strategyHolder(row: StrategyHolderRow | null): AccountHolder | null {
  if (!row || typeof row.id !== "string") return null;
  // A draft is not a strategy the person can open (its factsheet is not
  // built); the key is then what they can find and act on.
  if (row.status === "draft") return null;
  if (typeof row.name !== "string" || row.name.trim().length === 0) return null;
  return {
    kind: "strategy",
    name: row.name.trim(),
    href: buildFactsheetHref(row.id, { key: "strategies" }),
  };
}

export async function readOwnAccountHolder(
  db: Db,
  userId: string,
  keyId: string,
  logLabel: string,
): Promise<AccountHolder | null> {
  // Which read faulted, for the log and the Sentry tag.
  let step = "direct-strategy";
  try {
    // 1. A strategy built on this key, oldest first (the one the account was
    //    first connected for). Drafts and archived rows are skipped IN the query,
    //    so an older draft never hides a newer real strategy (225 review M-1).
    const { data: direct, error: directErr } = await db
      .from("strategies")
      .select("id, name, status")
      .eq("user_id", userId)
      .eq("api_key_id", keyId)
      .not("status", "in", "(draft,archived)")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (directErr) throw directErr;
    const viaStrategy = strategyHolder(direct as StrategyHolderRow | null);
    if (viaStrategy) return viaStrategy;

    // 1b. A non-archived strategy still covers the key (a draft, or a blank
    //     name). `/strategies` then shows no "No strategy yet" row for it
    //     (`deriveStrategyLinkedKeyIds`: anything but archived is coverage), so
    //     a key link would point at a page that does not list the key. Name
    //     nothing rather than send the person looking for a row that is not there.
    step = "covering-strategy";
    const { data: covering, error: coveringErr } = await db
      .from("strategies")
      .select("id")
      .eq("user_id", userId)
      .eq("api_key_id", keyId)
      .neq("status", "archived")
      .limit(1)
      .maybeSingle();
    if (coveringErr) throw coveringErr;
    if (covering) return null;

    // 2. A composite strategy that uses the key through `strategy_keys`.
    step = "composite-link";
    const { data: member, error: memberErr } = await db
      .from("strategy_keys")
      .select("strategy_id")
      .eq("owner_id", userId)
      .eq("api_key_id", keyId)
      .limit(1)
      .maybeSingle();
    if (memberErr) throw memberErr;
    const memberStrategyId = (member as { strategy_id?: unknown } | null)?.strategy_id;
    if (typeof memberStrategyId === "string") {
      step = "composite-strategy";
      const { data: composite, error: compositeErr } = await db
        .from("strategies")
        .select("id, name, status")
        .eq("user_id", userId)
        .eq("id", memberStrategyId)
        .neq("status", "archived")
        .maybeSingle();
      if (compositeErr) throw compositeErr;
      const viaComposite = strategyHolder(composite as StrategyHolderRow | null);
      if (viaComposite) return viaComposite;
      // A non-archived composite that cannot be named (a draft) still covers
      // the key on `/strategies`, exactly as in 1b.
      if (composite) return null;
    }

    // 3. No strategy to open: name the key itself. Reached only when nothing
    //    but archived strategies use the key, which is exactly when
    //    `/strategies` lists it as "No strategy yet".
    step = "key";
    const { data: key, error: keyErr } = await db
      .from("api_keys")
      .select("label, created_at")
      .eq("user_id", userId)
      .eq("id", keyId)
      .maybeSingle();
    if (keyErr) throw keyErr;
    const row = key as { label?: unknown; created_at?: unknown } | null;
    if (!row || typeof row.label !== "string" || row.label.trim().length === 0) {
      return null;
    }
    return {
      kind: "key",
      name: row.label.trim(),
      ...(typeof row.created_at === "string" ? { added_at: row.created_at } : {}),
      href: "/strategies",
    };
  } catch (err) {
    // The error is logged by code only: a PostgREST error can echo filter
    // values, and the filter values here are ids, never credentials, but the
    // message is not needed to act on a dark read.
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : "unknown";
    console.error(
      `[${logLabel}] own-account holder read failed at ${step} (refusal sent without it): code=${code}`,
    );
    // 225 review (SFH M1): a dark read degrades every refusal to the unnamed
    // copy, so it must be visible beyond a log line. The reads carry ids only,
    // never credentials; `captureToSentry` scrubs at its chokepoint anyway.
    void captureToSentry(err, { tags: { surface: logLabel, step: `own-account-holder:${step}` } });
    return null;
  }
}

/** The response fragment: `{ holder }` or nothing, so an absent holder leaves the body byte-identical to before. */
export function holderField(holder: AccountHolder | null | undefined): { holder?: AccountHolder } {
  return holder ? { holder } : {};
}

/**
 * Read a `holder` off a refusal body in the browser. Shape-checked, because it
 * becomes an `href`: a name must be a non-blank string and the href an in-app
 * path (a slash then a lowercase letter, never `//host` or an absolute URL).
 * Anything else is "we were not told".
 */
export function parseAccountHolder(raw: unknown): AccountHolder | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "strategy" && r.kind !== "key") return null;
  if (typeof r.name !== "string" || r.name.trim().length === 0) return null;
  if (typeof r.href !== "string" || !/^\/[a-z]/.test(r.href)) return null;
  return {
    kind: r.kind,
    name: r.name.trim(),
    ...(typeof r.added_at === "string" ? { added_at: r.added_at } : {}),
    href: r.href,
    // Only a key holder's id, and only uuid-shaped: it becomes a request body.
    ...(r.kind === "key" && isUuid(r.api_key_id)
      ? { api_key_id: r.api_key_id }
      : {}),
  };
}
