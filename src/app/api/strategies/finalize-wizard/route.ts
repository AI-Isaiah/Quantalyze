import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { STRATEGY_NAMES, canonicalizeExchangeList } from "@/lib/constants";
import { MAGNITUDE_CAPS } from "@/lib/closed-sets";
import { notifyFounderNewStrategy, resolveManagerName } from "@/lib/email";
import { isUuid } from "@/lib/utils";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { postProcessKey } from "@/lib/process-key-client";
import { captureToSentry } from "@/lib/sentry-capture";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/strategies/finalize-wizard — wizard SubmitStep endpoint.
 * Validates metadata, re-checks the strategy's exchange-key scopes
 * against the live exchange (force-refreshing both cache layers),
 * calls the SECURITY DEFINER `finalize_wizard_strategy` RPC to
 * promote the draft to `pending_review`, and kicks off the admin
 * notification email via `after()`. Migration 031's guard trigger
 * enforces that the RPC is the only promotion path for wizard
 * drafts.
 *
 * Phase 19 / Open Question 1
 * --------------------------
 * The force-refresh permissions probe (fetchLivePermissions below) is
 * RETAINED at the thin-adapter layer when the unified backbone path is
 * active. The probe runs BEFORE delegating to /process-key so the
 * scope-broadening defense is preserved end-to-end. Pushing the probe
 * into IngestionAdapter.validate would lose the strategies.api_key_id
 * lookup that resolves which key to probe.
 *
 * Scope-broadening defense
 * ------------------------
 * A user can connect a read-only key (which passes
 * /api/keys/validate-and-encrypt), then broaden the same key to
 * trade/withdraw on the exchange dashboard, then click Submit — the
 * /api/keys/[id]/permissions cache (60s on the Next layer + 15min on
 * the Python layer) would otherwise mask that broadening. Before
 * calling the finalize RPC we issue a force-refresh probe that
 * bypasses both caches; if the live response shows trade=true or
 * withdraw=true we abort with 403 + KEY_SCOPE_BROADENED so the wizard
 * surfaces the correct re-key copy.
 */

const STRATEGY_NAME_SET = new Set(STRATEGY_NAMES as readonly string[]);

const ANALYTICS_URL =
  process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002";

interface LivePermissions {
  read: boolean;
  trade: boolean;
  withdraw: boolean;
  probe_error?: boolean;
}

/**
 * Force-refresh the live `{read, trade, withdraw}` triple for an
 * api_keys row. Bypasses BOTH cache layers:
 *   - Next `unstable_cache` (60s) is sidestepped by NOT calling the
 *     /api/keys/[id]/permissions route at all — we hit the internal
 *     analytics endpoint directly with `cache: 'no-store'`.
 *   - Python in-memory TTL (15min) is sidestepped by passing
 *     `force_refresh=true` on the request URL, which makes the Python
 *     layer skip its `_cache_get`/`_cache_set` entries for this key.
 *
 * Throws on any non-OK response so the caller can decide between
 * fail-open and fail-closed (we fail-closed: a probe failure blocks
 * finalize, see route handler).
 */
async function fetchLivePermissions(
  keyId: string,
): Promise<LivePermissions> {
  const internalToken = process.env.INTERNAL_API_TOKEN;
  if (!internalToken) {
    throw new Error("INTERNAL_API_TOKEN is not configured");
  }
  const res = await fetch(
    `${ANALYTICS_URL}/internal/keys/${encodeURIComponent(keyId)}/permissions?force_refresh=true`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": internalToken,
      },
      // cache: 'no-store' belt-and-braces against any future Next
      // fetch-level caching being introduced. The internal route is
      // POST so it shouldn't be cacheable today, but routes can change.
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    throw new Error(`permissions probe failed: ${res.status}`);
  }
  return (await res.json()) as LivePermissions;
}

function validateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 20);
}

/**
 * Phase B/C simplify — defense-in-depth token scrub. Replaces any literal
 * occurrence of the live INTERNAL_API_TOKEN inside a stringified value
 * with `<redacted>` before it lands in logs / Sentry. Originally added
 * for the H-0328 probe-error path; promoted to module scope so every
 * error-logging site (after()-block side-effect rejections, Sentry
 * `extra` payloads, etc.) gets the same coverage.
 */
function scrubInternalToken(value: string): string {
  const token = process.env.INTERNAL_API_TOKEN;
  if (!token || token.length === 0) return value;
  return value.split(token).join("<redacted>");
}

function safeErrorString(err: unknown): string {
  if (err instanceof Error) {
    return `${scrubInternalToken(err.name)}: ${scrubInternalToken(err.message)}`;
  }
  try {
    return scrubInternalToken(String(err));
  } catch {
    return "unknown";
  }
}

/**
 * M-18 — payload validator. Returns either a `{ ok: true, fields }` tuple of
 * normalized values OR an early NextResponse for the first validation error.
 * Pulled out of POST() so the validation gauntlet is testable in isolation
 * and the route handler reads as flow control, not field-by-field checks.
 */
type ValidatedPayload = {
  strategy_id: string;
  name: string;
  description: string;
  category_id: string;
  strategy_types: string[];
  subtypes: string[];
  markets: string[];
  supported_exchanges: string[];
  leverage_range: string | null;
  aumNum: number | null;
  maxCapacityNum: number | null;
  asset_class: string;
};

function validatePayload(
  body: Record<string, unknown> | null,
):
  | { ok: true; fields: ValidatedPayload }
  | { ok: false; response: NextResponse } {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid request body" },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }

  const {
    strategy_id,
    name,
    description,
    category_id,
    strategy_types,
    subtypes,
    markets,
    supported_exchanges,
    leverage_range,
    aum,
    max_capacity,
    asset_class,
  } = body;

  if (!isUuid(strategy_id)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "strategy_id must be a valid UUID" },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (typeof name !== "string" || !STRATEGY_NAME_SET.has(name)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "name must be one of the allowed codenames" },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (
    typeof description !== "string" ||
    description.length < 10 ||
    description.length > MAGNITUDE_CAPS.MAX_DESCRIPTION_CHARS
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "description must be 10-5000 characters" },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (!isUuid(category_id)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "category_id must be a valid UUID" },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }

  // audit-2026-05-07 H-0325/H-0326 — fail-LOUD on invalid dollar values
  // instead of coercing to NULL. Pre-fix a client typo like '-5' or
  // '1e20' silently dropped to NULL on the server and a strategy
  // finalized with missing AUM — at minimum bad UX, at worst regulatory
  // exposure for a "Verified by Quantalyze" factsheet with no AUM. The
  // contract: client must send a finite number in [0, 1e12), or omit
  // the field (null / undefined) entirely.
  const MAX_DOLLAR_VALUE = MAGNITUDE_CAPS.MAX_DOLLAR_VALUE_USD;
  const isValidDollar = (v: unknown): v is number =>
    typeof v === "number" &&
    Number.isFinite(v) &&
    v >= 0 &&
    v < MAX_DOLLAR_VALUE;
  const isOmitted = (v: unknown): boolean => v === undefined || v === null;
  if (!isOmitted(aum) && !isValidDollar(aum)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `aum must be a finite non-negative number under ${MAX_DOLLAR_VALUE}`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (!isOmitted(max_capacity) && !isValidDollar(max_capacity)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `max_capacity must be a finite non-negative number under ${MAX_DOLLAR_VALUE}`,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      ),
    };
  }
  const aumNum = isValidDollar(aum) ? aum : null;
  const maxCapacityNum = isValidDollar(max_capacity) ? max_capacity : null;

  // #597 — asset class drives Sharpe/Sortino/vol annualization (√365 crypto /
  // √252 traditional). Accept only the two closed-set values; anything else
  // (absent, garbled, a future value) fails SAFE to 'traditional' — the
  // conservative √252 basis and the DB column default.
  const asset_class_validated =
    asset_class === "crypto" || asset_class === "traditional"
      ? asset_class
      : "traditional";

  // audit-2026-05-07 H-0324 — isUuid is a type predicate (value is
  // string), so the prior `as string` casts were redundant. Removing
  // them keeps the parse boundary statically verified end-to-end.
  return {
    ok: true,
    fields: {
      strategy_id,
      name,
      description,
      category_id,
      strategy_types: validateStringArray(strategy_types),
      subtypes: validateStringArray(subtypes),
      markets: validateStringArray(markets),
      // QA report 2026-05-21 ISSUE-004 — canonicalize before persist
      // so the row stores ['Bybit'] not ['bybit', 'Bybit'] even if a
      // stale client (pre-WizardClient-canonicalize) sends mixed case.
      supported_exchanges: canonicalizeExchangeList(
        validateStringArray(supported_exchanges),
      ),
      leverage_range:
        typeof leverage_range === "string" && leverage_range.length > 0
          ? leverage_range
          : null,
      aumNum,
      maxCapacityNum,
      asset_class: asset_class_validated,
    },
  };
}

/**
 * M-18 — force-refresh permissions probe runner. Returns either
 * `{ ok: true }` (proceed to finalize) or an early NextResponse with the
 * appropriate code (KEY_NETWORK_TIMEOUT / KEY_SCOPE_BROADENED). Encapsulates
 * the fail-CLOSED + probe_error decoding logic so the caller is just flow
 * control.
 */
async function runScopeBroadeningProbe(
  apiKeyId: string,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  let livePerms: LivePermissions;
  try {
    livePerms = await fetchLivePermissions(apiKeyId);
  } catch (probeErr) {
    // audit-2026-05-07 H-0328 + Phase C simplify — log only the safe
    // primitives (name + message) scrubbed of any literal INTERNAL_API_TOKEN
    // occurrence. Some fetch / undici / retry-wrapper stack traces embed
    // the outgoing X-Internal-Token header in either the message or a
    // wrapper-error name; both paths are covered by scrubInternalToken.
    console.error(
      `[strategies/finalize-wizard] live permissions probe failed: ${safeErrorString(probeErr)}`,
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Could not verify key scopes", code: "KEY_NETWORK_TIMEOUT" },
        { status: 502, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (livePerms.probe_error) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Exchange permission probe failed",
          code: "KEY_NETWORK_TIMEOUT",
        },
        { status: 502, headers: NO_STORE_HEADERS },
      ),
    };
  }
  if (livePerms.trade === true || livePerms.withdraw === true) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Key has been broadened beyond read-only on the exchange.",
          code: "KEY_SCOPE_BROADENED",
        },
        { status: 403, headers: NO_STORE_HEADERS },
      ),
    };
  }
  return { ok: true };
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  // PR-2 silent-failure-hunter F5 (2026-05-28): explicit try/catch around
  // req.json() so the parse/transport error class is logged. req.json()
  // collapses transport read failures and JSON-parse errors into one
  // rejection — pre-fix the .catch(() => null) chain dropped both into
  // an unlogged null silently. SRE sees the err.message in console now.
  let body: unknown = null;
  try {
    body = await req.json();
  } catch (err) {
    console.warn(
      "[finalize-wizard] body JSON parse failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const validation = validatePayload(body as Record<string, unknown> | null);
  if (!validation.ok) return validation.response;
  const fields = validation.fields;

  // B15 limiter-ordering — consume the rate-limit token AFTER input
  // validation (body parse + validatePayload), not before. A malformed /
  // invalid request now gets rejected with 400 WITHOUT burning one of the
  // caller's own tokens. Canonical order: auth → input-validation →
  // rate-limit → handler. The deny shape (503 misconfig split + 429) and
  // the exact key string are preserved verbatim.
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-finalize-wizard:${user.id}`,
  );
  if (!rl.success) {
    // PR-2 full-file reviewer #5 (2026-05-28): 503 on rate-limit misconfig.
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Rate limiter unavailable" },
        { status: 503, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }

  const supabase = await createClient();

  // Scope-broadening defense — re-check the live exchange permissions
  // before calling the finalize RPC. The validation at Connect time
  // (/api/keys/validate-and-encrypt) only sees the scopes that
  // existed THEN; a user can broaden the key on the exchange
  // dashboard between Connect and Submit. We force-refresh both
  // caches (60s Next + 15min Python) so the check actually sees the
  // current scopes.
  //
  // The lookup uses the user-scoped client so RLS rejects strategies
  // the caller doesn't own. A "no api_key_id" row is the CSV branch
  // (no exchange key linked) — we skip the probe because the CSV
  // branch's data lives in csv_uploads, not api_keys.
  //
  // audit-2026-05-07 C-0119/H-0329 — belt-and-braces user_id filter so
  // ownership defense does NOT rely on RLS alone. If RLS on `strategies`
  // ever regresses, an attacker who guesses a victim's strategy_id could
  // (a) trigger the Railway probe revealing it's a real API-keyed
  // strategy, then (b) read the api_keys.exchange via the admin client.
  // The downstream SECURITY DEFINER RPC re-checks ownership, but the
  // probe + admin-client lookup BOTH fire before that point.
  const { data: strategyRow, error: strategyErr } = await supabase
    .from("strategies")
    .select("api_key_id")
    .eq("id", fields.strategy_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (strategyErr) {
    console.error(
      "[strategies/finalize-wizard] strategy lookup failed:",
      strategyErr.message,
    );
    return NextResponse.json(
      { error: "Could not load draft" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  if (!strategyRow) {
    return NextResponse.json({ error: "Draft not found", code: "GATE_DRAFT_GONE" }, { status: 404, headers: NO_STORE_HEADERS });
  }

  const apiKeyId =
    typeof strategyRow.api_key_id === "string" ? strategyRow.api_key_id : null;

  // #597 — persist the strategy's asset class onto the draft row. The
  // SECURITY DEFINER `finalize_wizard_strategy` RPC signature does not carry
  // asset_class, so it is written here directly on the owner-scoped client
  // (RLS + the belt-and-braces user_id filter enforce ownership) BEFORE the
  // finalize dispatch, covering both the legacy and unified paths.
  //
  // API-keyed strategies FORCE-DERIVE 'crypto': every supported exchange
  // (binance/okx/bybit/deribit) is a crypto venue, so the picker is only
  // meaningful for CSV uploads. Trusting the submitted value here would let a
  // resumed broker draft (whose DB row carries the NOT NULL DEFAULT
  // 'traditional') silently annualize a crypto strategy on √252 — a regression
  // vs the pre-#597 `api_key_id → √365` proxy. Mirrors the migration backfill
  // rule (api_key_id IS NOT NULL → crypto).
  //
  // Non-blocking on failure: the column default means a failed write leaves a
  // CSV strategy on √252 (harmless for traditional; WRONG for crypto-CSV, so
  // the failure is surfaced to Sentry below) and a broker strategy is
  // re-derived to crypto on the next finalize attempt.
  // @audit-skip: non-security annualization metadata (√365 crypto / √252
  // traditional) written as part of the already-audited strategy finalization;
  // a dedicated audit event would be noise (mirrors the last_sync_at skip below).
  const { error: assetClassErr } = await supabase
    .from("strategies")
    .update({ asset_class: apiKeyId ? "crypto" : fields.asset_class })
    .eq("id", fields.strategy_id)
    .eq("user_id", user.id);
  if (assetClassErr) {
    console.warn(
      `[strategies/finalize-wizard] asset_class persist failed (non-blocking): ${scrubInternalToken(assetClassErr.message)}`,
    );
    captureToSentry(assetClassErr, {
      tags: { op: "finalize-wizard.asset_class_persist" },
      level: "warning",
    });
  }

  // Probe runs BEFORE both legacy and unified paths so the
  // scope-broadening defense covers either code path (Phase 19 /
  // Open Question 1 — RETAINED at the thin-adapter layer).
  if (apiKeyId) {
    const probe = await runScopeBroadeningProbe(apiKeyId);
    if (!probe.ok) return probe.response;
  }

  // Phase 19 / BACKBONE-10 — gate behind unified-backbone flag. The
  // force-refresh probe above ALREADY ran for both code paths.
  if (await isUnifiedBackboneActive()) {
    // API-8: resolve the actual exchange from the linked api_keys row so we
    // don't hardcode `source: 'okx'` for non-OKX strategies. Falls back to
    // 'okx' when the strategy has no api_key (CSV branch) — the unified
    // router treats source as advisory in that case.
    let resolvedSource = "okx";
    if (apiKeyId) {
      const admin = createAdminClient();
      // audit-2026-05-07 H-0323 — capture the error so a transient admin
      // lookup failure doesn't silently fall back to the 'okx' default
      // and route a Binance/Bybit key through the wrong exchange-specific
      // code path with no forensic trail.
      const { data: keyRow, error: keyRowErr } = await admin
        .from("api_keys")
        .select("exchange")
        .eq("id", apiKeyId)
        .single();
      if (keyRowErr) {
        console.warn(
          `[strategies/finalize-wizard] api_keys.exchange lookup failed; falling back to default source: ${scrubInternalToken(keyRowErr.message)}`,
        );
        // Mirror the H-0322 escalation pattern: console.warn on Vercel is
        // best-effort log capture, not alertable. Without Sentry a transient
        // PG blip silently routes a Binance/Bybit key through the OKX-specific
        // code path with no forensic trail.
        captureToSentry(keyRowErr, {
          tags: {
            surface: "finalize-wizard",
            step: "unified-exchange-resolve",
          },
          extra: { strategy_id: fields.strategy_id, api_key_id: apiKeyId },
        });
      }
      if (keyRow?.exchange) {
        resolvedSource = keyRow.exchange;
      }
    }
    return await unifiedFinalizeWizardHandler({
      strategy_id: fields.strategy_id,
      userId: user.id,
      // NEW-C14-06: forward the validated+normalized `fields` object instead
      // of the raw body. Pre-fix: `payload: body as Record<string,unknown>`
      // bypassed canonicalizeExchangeList + string→number coercion so the
      // unified path persisted un-canonicalized exchanges and raw aum/max_capacity
      // strings. The 400-gate still ran, but normalization drift persisted bad
      // data. Forwarding `fields` ensures both paths (legacy + unified) persist
      // identically.
      payload: {
        strategy_id: fields.strategy_id,
        name: fields.name,
        description: fields.description,
        category_id: fields.category_id,
        strategy_types: fields.strategy_types,
        subtypes: fields.subtypes,
        markets: fields.markets,
        supported_exchanges: fields.supported_exchanges,
        leverage_range: fields.leverage_range,
        aum: fields.aumNum,
        max_capacity: fields.maxCapacityNum,
      },
      apiKeyId,
      source: resolvedSource,
    });
  }

  // ── Legacy path ───────────────────────────────────────────────────
  return await runLegacyFinalize({ supabase, user, fields });
});

/**
 * M-18 — legacy finalize path. Calls the SECURITY DEFINER RPC, schedules the
 * after() side-effect fan-out, and returns the legacy 200 envelope. Pulled
 * out of POST() so the legacy code path is grep-able as `runLegacyFinalize`
 * for the eventual M-9 cleanup.
 */
// DEPRECATED: remove after 2026-05-15 (PR-D + 7d)
async function runLegacyFinalize(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
  fields: ValidatedPayload;
}): Promise<NextResponse> {
  const { supabase, user, fields } = args;
  // The generated types declare these RPC params as non-null primitives, but
  // the underlying SQL function accepts nulls for leverage_range, aum, and
  // max_capacity (per the wizard's "skip optional metadata" path). Cast each
  // nullable arg to satisfy the typed-client contract without changing the
  // value the DB receives.
  const { data: finalizedId, error } = await supabase.rpc(
    "finalize_wizard_strategy",
    {
      p_strategy_id: fields.strategy_id,
      p_user_id: user.id,
      p_name: fields.name,
      p_description: fields.description,
      p_category_id: fields.category_id,
      p_strategy_types: fields.strategy_types,
      p_subtypes: fields.subtypes,
      p_markets: fields.markets,
      p_supported_exchanges: fields.supported_exchanges,
      p_leverage_range: fields.leverage_range as unknown as string,
      p_aum: fields.aumNum as unknown as number,
      p_max_capacity: fields.maxCapacityNum as unknown as number,
    },
  );

  if (error) {
    console.error(
      "[strategies/finalize-wizard] RPC error:",
      error.message,
      error.code,
    );
    if (error.code === "P0002" || error.code === "02000") {
      return NextResponse.json({ error: "Draft not found", code: "GATE_DRAFT_GONE" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    // audit-2026-05-07 H-0321: split the two SQLSTATEs so HTTP semantics
    // match the actual failure mode.
    //   - 42501 (insufficient_privilege) → 403 Forbidden. True RLS /
    //     ownership rejection; reserve 403 for permission denials so
    //     forensic readers can distinguish "user wrong" from "system wrong".
    //   - 22023 (invalid_parameter_value) → 409 Conflict. RPC raises this
    //     when the draft is in a non-finalizable state (already published,
    //     missing fields, stale snapshot). 409 lets the client show a
    //     refresh nudge rather than a "permission denied" sign-out prompt.
    if (error.code === "42501") {
      // H-0192 (red-team follow-up): tag with the route's own discriminator so
      // SubmitStep maps off `code`, not raw HTTP status. Keying off status
      // mislabeled pre-handler 403s (CSRF, approval-gate) as draft-finalize
      // failures and conflated them in the wizard_error funnel.
      return NextResponse.json(
        { error: "This draft cannot be finalized", code: "GUARD_BLOCKED" },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    if (error.code === "22023") {
      return NextResponse.json(
        {
          error:
            "This draft is not in a finalizable state. Refresh and try again.",
          code: "draft_state_invalid",
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: "Could not finalize wizard draft" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const resolvedId =
    typeof finalizedId === "string" ? finalizedId : fields.strategy_id;

  // Both side effects are fire-and-forget: the row is already in
  // pending_review, so failures to notify or touch last_sync_at must
  // not block the response or reverse the finalize.
  after(async () => {
    const admin = createAdminClient();
    // audit-2026-05-07 H-0322 — capture the api_key_id lookup error so a
    // transient Postgres blip doesn't silently drop the last_sync_at
    // touch (Sprint-2 cleanup would then treat the key as abandoned and
    // GC it). Failure here logs to Sentry below; the founder email is
    // independent so it still runs.
    // audit-2026-05-07 H-0331 — fetch `name` from the DB row so the
    // founder email matches what the admin UI shows. The validated form
    // input (fields.name) is the user's intent, but the
    // finalize_wizard_strategy RPC may sanitize/transform it; pulling
    // from the row keeps founder email and admin UI on a single source
    // of truth.
    const [managerName, keyLinkResult] = await Promise.all([
      resolveManagerName(admin, user),
      admin
        .from("strategies")
        .select("api_key_id, name")
        .eq("id", resolvedId)
        .single(),
    ]);
    const { data: keyLink, error: keyLinkErr } = keyLinkResult;
    const canonicalName =
      keyLink && typeof keyLink.name === "string" && keyLink.name.length > 0
        ? keyLink.name
        : fields.name;
    if (keyLinkErr) {
      console.warn(
        `[strategies/finalize-wizard] api_key_id lookup failed in after(): ${scrubInternalToken(keyLinkErr.message)}`,
      );
      captureToSentry(keyLinkErr, {
        tags: {
          surface: "finalize-wizard-after",
          side_effect: "api_key_id_lookup",
        },
        extra: { strategy_id: resolvedId },
      });
    }

    // audit-2026-05-07 G10.E.1: name each side effect so a future grep /
    // Sentry filter can disambiguate. Index-based logging (`side effect 0`)
    // was impossible to triage and didn't reach Sentry — console.warn on
    // Vercel is best-effort log capture, not alertable.
    const sideEffects: Array<{
      label:
        | "notify_founder_new_strategy"
        | "api_keys_last_sync_at_touch"
        | "enqueue_sync_trades_job";
      run: () => Promise<unknown>;
    }> = [
      {
        label: "notify_founder_new_strategy",
        run: () => notifyFounderNewStrategy(canonicalName, managerName),
      },
      // @audit-skip: denormalization timestamp. api_keys.last_sync_at
      // is a sync-state hint, not a user-visible state change. The
      // user-intent event for this flow is the finalize_wizard_strategy
      // RPC call that promoted the draft to pending_review (which is a
      // stored-procedure call, not a .insert/.update/.delete — not
      // reached by the grep test).
      {
        label: "api_keys_last_sync_at_touch",
        run: async () => {
          if (!keyLink?.api_key_id) return;
          // @audit-skip: denormalization timestamp — see outer comment.
          // (Pragma kept within 8 lines of the .update chain so the
          // audit-coverage grep sees it.)
          await admin
            .from("api_keys")
            .update({ last_sync_at: new Date().toISOString() })
            .eq("id", keyLink.api_key_id);
        },
      },
      // audit-2026-05-07 H-0330 — enqueue the sync_trades compute job so
      // the strategy advances past computation_status='pending' on Round 2
      // cutover (USE_COMPUTE_JOBS_QUEUE=true). Pre-fix the wizard finalize
      // path NEVER enqueued; the only enqueue lived in /api/keys/sync
      // behind a manual "Sync now" button. Removing that button on cutover
      // would orphan every new wizard submission.
      //
      // Gated by the same env flag /api/keys/sync uses so the legacy path
      // (button-driven sync) keeps working while the flag is off. The
      // partial unique index on compute_jobs handles double-submit, and
      // the after() Promise.allSettled wrapper means a failed enqueue
      // does not block the 200 response or reverse the finalize.
      {
        label: "enqueue_sync_trades_job",
        run: async () => {
          if (process.env.USE_COMPUTE_JOBS_QUEUE !== "true") return;
          // Phase 86 (COMP-02) — composite dispatch. A strategy with one or more
          // strategy_keys members is a MULTI-KEY composite: enqueue
          // `stitch_composite` (the worker fans out over the members, decrypts
          // each key worker-side, clips + stitches). A strategy with zero members
          // is the legacy single-key path → `sync_trades`, byte-identical.
          //
          // The route reads ONLY a count — it NEVER decrypts (worker-only
          // decryption, LOCKED). resolvedId scoping is unchanged (T-86-14).
          const { count, error: countErr } = await admin
            .from("strategy_keys")
            .select("*", { count: "exact", head: true })
            .eq("strategy_id", resolvedId);
          if (countErr) {
            // W-4 FAIL CLOSED: on a count-query error we do NOT know whether this
            // strategy is a composite. Routing a possible member-bearing composite
            // through the single-key `sync_trades` path would silently produce a
            // wrong/partial derivation. Surface the error (Promise.allSettled →
            // Sentry) instead of enqueuing a single-key kind on a possible
            // composite. The reconcile cron re-drives stuck 'pending' rows, so the
            // strategy is not orphaned — it simply is not mis-derived.
            throw new Error(
              `strategy_keys count failed: ${countErr.message}`,
            );
          }
          if ((count ?? 0) > 0) {
            const { error: enqueueErr } = await admin.rpc("enqueue_compute_job", {
              p_strategy_id: resolvedId,
              p_kind: "stitch_composite",
              p_metadata: { source: "finalize-wizard" },
            });
            if (enqueueErr) {
              throw new Error(
                `enqueue_compute_job failed: ${enqueueErr.message}`,
              );
            }
            return;
          }
          // Legacy single-key path (zero strategy_keys members) — unchanged.
          if (!keyLink?.api_key_id) return;
          const { error: enqueueErr } = await admin.rpc(
            "enqueue_compute_job",
            {
              p_strategy_id: resolvedId,
              p_kind: "sync_trades",
              p_metadata: { source: "finalize-wizard" },
            },
          );
          if (enqueueErr) {
            // Throw so Promise.allSettled marks this side effect as
            // rejected and the Sentry capture below picks it up.
            // Backstop: cron/reconcile-strategies re-enqueues stuck
            // computation_status='pending' rows so worst-case latency is
            // ~24h, not "forever". Disabling that cron removes the safety
            // net for this throw.
            throw new Error(
              `enqueue_compute_job failed: ${enqueueErr.message}`,
            );
          }
        },
      },
    ];

    const results = await Promise.allSettled(sideEffects.map((e) => e.run()));
    for (const [i, r] of results.entries()) {
      if (r.status === "rejected") {
        const label = sideEffects[i].label;
        // notify_founder_new_strategy is the ONLY signal a founder gets
        // that a new strategy was submitted. Failure here means the
        // strategy lands in pending_review with nobody told — escalate
        // to Sentry instead of swallowing on stdout. The cosmetic
        // last_sync_at touch goes through the same channel for parity
        // (operators want a single place to read for after()-failures).
        // Phase C simplify — scrub the rejection reason before it lands
        // in Vercel logs. Side-effect errors (notably enqueue_compute_job
        // wrappers) may stringify request init into .message.
        console.warn(
          `[strategies/finalize-wizard] side effect ${label} failed (non-blocking): ${safeErrorString(r.reason)}`,
        );
        captureToSentry(r.reason, {
          tags: {
            surface: "finalize-wizard-after",
            side_effect: label,
          },
          extra: {
            strategy_id: resolvedId,
            manager_name: managerName,
          },
        });
      }
    }
  });

  // H-0309: uniform `ok: true` success discriminator across the wizard
  // endpoints (create-with-key / keys-sync / finalize-wizard).
  return NextResponse.json(
    {
      ok: true,
      strategy_id: resolvedId,
      status: "pending_review",
    },
    { headers: NO_STORE_HEADERS },
  );
}

/**
 * Phase 19 / BACKBONE-01 unified path. Delegates to /process-key with
 * `flow_type=onboard` (finalize step). The force-refresh permissions probe
 * has already run in the caller (Open Question 1 — RETAINED at this layer).
 *
 * ⚠️  Phase C simplify — side-effect parity gap.
 * The legacy `runLegacyFinalize` after() block fans out THREE side
 * effects after the SECURITY DEFINER RPC succeeds:
 *   - `notify_founder_new_strategy` (founder email)
 *   - `api_keys_last_sync_at_touch`  (Sprint-2 GC heartbeat)
 *   - `enqueue_sync_trades_job`      (Round-2 cutover analytics enqueue)
 * The Python unified backbone (analytics-service/routers/process_key.py)
 * only enqueues `process_key_long`. It does NOT fire the founder email,
 * does NOT touch `api_keys.last_sync_at`, and does NOT enqueue
 * `sync_trades`. Flipping `isUnifiedBackboneActive=true` in production
 * silently drops all three.
 *
 * This is an architectural decision (do these live in the Next route or
 * the Python worker?) and is OUT OF SCOPE for /simplify cleanup. The
 * load-bearing comment + Sentry warning below exist so the gap surfaces
 * on the very first unified-path request after cutover instead of
 * silently breaking the founder-notification SLA.
 */
async function unifiedFinalizeWizardHandler(args: {
  strategy_id: string;
  userId: string;
  payload: Record<string, unknown>;
  apiKeyId: string | null;
  source: string;
}): Promise<NextResponse> {
  const result = await postProcessKey({
    flow_type: "onboard",
    // API-8: actual exchange resolved from api_keys.exchange (or 'okx' for
    // CSV-only strategies). The unified router still server-side resolves
    // from strategies.api_keys.exchange when the linkage is present, but
    // forwarding the resolved value here keeps the contract honest.
    source: args.source,
    context: {
      ...args.payload,
      strategy_id: args.strategy_id,
      user_id: args.userId,
      api_key_id: args.apiKeyId,
      step: "finalize",
    },
    routeTag: "strategies/finalize-wizard",
    // CT-4 (army2) — forward tenant id for cross-tenant rate-limit isolation.
    userId: args.userId,
  });
  if (!result.ok) return result.response;

  // API-9: translate the unified `{queued, verification_id}` shape back to the
  // legacy `{strategy_id, status:'pending_review'}` shape that wizard chrome
  // and downstream callers read off `body.strategy_id`. Preserve
  // `verification_id` + `queued` as additive fields for callers that want them.
  //
  // CT-5 (army2) — also preserve `code` and `idempotent` when upstream
  // returns the WIZARD_DUPLICATE envelope. Pre-fix the translation
  // stripped both fields, so SubmitStep.tsx never rendered the
  // wizardErrors WIZARD_DUPLICATE copy on the idempotent-resume path.
  //
  // audit-2026-05-07 H-0327 — narrow the upstream body with a local type
  // guard so each field's type is statically verified at the read site
  // instead of probing an opaque `Record<string, unknown>`. A backbone-
  // side rename of `verification_id` / `queued` now surfaces here as a
  // missing branch, not as a silent null/false fallback.
  const upstream = result.body;
  if (isProcessKeyOnboardResponse(upstream)) {
    if (upstream.queued) {
      return NextResponse.json(
        {
          ok: true,
          strategy_id: args.strategy_id,
          status: "pending_review",
          verification_id: upstream.verification_id,
          queued: true,
        },
        { headers: NO_STORE_HEADERS },
      );
    }
    // queued=false discriminant — duplicate / dedup-hit envelope.
    return NextResponse.json(
      {
        ok: true,
        strategy_id: args.strategy_id,
        status: "pending_review",
        verification_id: upstream.verification_id ?? null,
        queued: false,
        code: upstream.code,
        ...(upstream.idempotent === true ? { idempotent: true } : {}),
      },
      { headers: NO_STORE_HEADERS },
    );
  }
  // Phase B simplify — H-0327 follow-up. The guard miss means the upstream
  // /process-key returned a 2xx body whose shape doesn't match the onboard
  // contract (rename, partial deploy, AI gateway shape drift, proxy strip).
  // Returning `upstream ?? {}` with 200 would leave wizard chrome reading
  // `body.strategy_id === undefined` and showing "success" with no draft to
  // advance — the exact silent failure the guard exists to prevent. Surface
  // via Sentry and a 502 so the contract drift is alertable.
  console.error(
    "[strategies/finalize-wizard] unified upstream returned unrecognized shape",
    {
      keys:
        upstream && typeof upstream === "object"
          ? Object.keys(upstream as Record<string, unknown>)
          : null,
    },
  );
  captureToSentry(new Error("process-key onboard contract violation"), {
    tags: {
      surface: "finalize-wizard",
      step: "unified-response-parse",
    },
    extra: {
      strategy_id: args.strategy_id,
      upstream_keys:
        upstream && typeof upstream === "object"
          ? Object.keys(upstream as Record<string, unknown>)
          : null,
    },
  });
  return NextResponse.json(
    { error: "Upstream service returned unexpected response" },
    { status: 502, headers: NO_STORE_HEADERS },
  );
}

/**
 * audit-2026-05-07 H-0327 — local narrow over the /process-key response
 * shape this handler depends on. Avoids the `Record<string, unknown>`
 * cast at the call site so subsequent property accesses are typed.
 *
 * Phase B simplify — `queued` made required so an upstream
 * `{queued: undefined}` cannot silently coerce into `queued: true` via a
 * `?? true` fallback at the read site.
 *
 * Phase C simplify — split into a discriminated union on `queued`. The
 * Python contract (analytics-service/routers/process_key.py) only ever
 * returns one of two shapes:
 *   - `{queued: true,  verification_id: string}` — newly queued.
 *   - `{queued: false, code: string, verification_id?, idempotent?}` —
 *     dedup hit (WIZARD_DUPLICATE).
 * A mixed envelope (e.g., `{queued: true, code: "WIZARD_DUPLICATE"}`) is
 * a backbone bug; the guard rejects it so the unified-response-parse
 * 502+Sentry path fires instead of silently misrouting wizard chrome.
 */
type ProcessKeyOnboardResponse =
  | { queued: true; verification_id: string }
  | {
      queued: false;
      code: string;
      verification_id?: string | null;
      idempotent?: boolean;
    };

function isProcessKeyOnboardResponse(
  body: unknown,
): body is ProcessKeyOnboardResponse {
  if (body === null || typeof body !== "object") return false;
  const r = body as Record<string, unknown>;
  if (typeof r.queued !== "boolean") return false;
  if (r.queued) {
    // queued=true branch: verification_id MUST be a string, and
    // code/idempotent MUST NOT be present (mixed envelope = bug).
    if (typeof r.verification_id !== "string") return false;
    if ("code" in r || "idempotent" in r) return false;
    return true;
  }
  // queued=false branch: code MUST be a string; verification_id and
  // idempotent are optional but must match types if present.
  if (typeof r.code !== "string") return false;
  if (
    r.verification_id !== undefined &&
    r.verification_id !== null &&
    typeof r.verification_id !== "string"
  ) {
    return false;
  }
  if (r.idempotent !== undefined && typeof r.idempotent !== "boolean") {
    return false;
  }
  return true;
}
