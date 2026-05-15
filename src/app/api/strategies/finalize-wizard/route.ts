import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { STRATEGY_NAMES } from "@/lib/constants";
import { notifyFounderNewStrategy, resolveManagerName } from "@/lib/email";
import { isUuid } from "@/lib/utils";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { postProcessKey } from "@/lib/process-key-client";
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
        { status: 400 },
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
  } = body;

  if (!isUuid(strategy_id)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "strategy_id must be a valid UUID" },
        { status: 400 },
      ),
    };
  }
  if (typeof name !== "string" || !STRATEGY_NAME_SET.has(name)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "name must be one of the allowed codenames" },
        { status: 400 },
      ),
    };
  }
  if (
    typeof description !== "string" ||
    description.length < 10 ||
    description.length > 5000
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "description must be 10-5000 characters" },
        { status: 400 },
      ),
    };
  }
  if (!isUuid(category_id)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "category_id must be a valid UUID" },
        { status: 400 },
      ),
    };
  }

  const MAX_DOLLAR_VALUE = 1_000_000_000_000;
  const aumNum =
    typeof aum === "number" &&
    Number.isFinite(aum) &&
    aum >= 0 &&
    aum < MAX_DOLLAR_VALUE
      ? aum
      : null;
  const maxCapacityNum =
    typeof max_capacity === "number" &&
    Number.isFinite(max_capacity) &&
    max_capacity >= 0 &&
    max_capacity < MAX_DOLLAR_VALUE
      ? max_capacity
      : null;

  return {
    ok: true,
    fields: {
      strategy_id: strategy_id as string,
      name,
      description,
      category_id: category_id as string,
      strategy_types: validateStringArray(strategy_types),
      subtypes: validateStringArray(subtypes),
      markets: validateStringArray(markets),
      supported_exchanges: validateStringArray(supported_exchanges),
      leverage_range:
        typeof leverage_range === "string" && leverage_range.length > 0
          ? leverage_range
          : null,
      aumNum,
      maxCapacityNum,
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
    console.error(
      "[strategies/finalize-wizard] live permissions probe failed:",
      probeErr,
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Could not verify key scopes", code: "KEY_NETWORK_TIMEOUT" },
        { status: 502 },
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
        { status: 502 },
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
        { status: 403 },
      ),
    };
  }
  return { ok: true };
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-finalize-wizard:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => null);

  // M-18: payload validation extracted so POST() reads as flow control.
  const validation = validatePayload(body as Record<string, unknown> | null);
  if (!validation.ok) return validation.response;
  const fields = validation.fields;

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
      { status: 500 },
    );
  }
  if (!strategyRow) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const apiKeyId =
    typeof strategyRow.api_key_id === "string" ? strategyRow.api_key_id : null;

  // M-18: scope-broadening probe extracted. Phase 19 / Open Question 1 —
  // RETAINED at the thin-adapter layer; runs BEFORE both legacy and unified
  // paths so the defense covers either code path.
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
      const { data: keyRow } = await admin
        .from("api_keys")
        .select("exchange")
        .eq("id", apiKeyId)
        .single();
      if (keyRow?.exchange) {
        resolvedSource = keyRow.exchange;
      }
    }
    return await unifiedFinalizeWizardHandler({
      strategy_id: fields.strategy_id,
      userId: user.id,
      payload: body as Record<string, unknown>,
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
      p_leverage_range: fields.leverage_range,
      p_aum: fields.aumNum,
      p_max_capacity: fields.maxCapacityNum,
    },
  );

  if (error) {
    console.error(
      "[strategies/finalize-wizard] RPC error:",
      error.message,
      error.code,
    );
    if (error.code === "P0002" || error.code === "02000") {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }
    if (error.code === "42501" || error.code === "22023") {
      return NextResponse.json(
        { error: "This draft cannot be finalized" },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "Could not finalize wizard draft" },
      { status: 500 },
    );
  }

  const resolvedId =
    typeof finalizedId === "string" ? finalizedId : fields.strategy_id;

  // Both side effects are fire-and-forget: the row is already in
  // pending_review, so failures to notify or touch last_sync_at must
  // not block the response or reverse the finalize.
  after(async () => {
    const admin = createAdminClient();
    const [managerName, { data: keyLink }] = await Promise.all([
      resolveManagerName(admin, user),
      admin
        .from("strategies")
        .select("api_key_id")
        .eq("id", resolvedId)
        .single(),
    ]);

    // audit-2026-05-07 G10.E.1: name each side effect so a future grep /
    // Sentry filter can disambiguate. Index-based logging (`side effect 0`)
    // was impossible to triage and didn't reach Sentry — console.warn on
    // Vercel is best-effort log capture, not alertable.
    const sideEffects: Array<{
      label: "notify_founder_new_strategy" | "api_keys_last_sync_at_touch";
      run: () => Promise<unknown>;
    }> = [
      {
        label: "notify_founder_new_strategy",
        run: () => notifyFounderNewStrategy(fields.name, managerName),
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
          // @audit-skip: denormalization timestamp. api_keys.last_sync_at is a
          // sync-state hint, not a user-visible state change. The user-intent
          // event for this flow is finalize_wizard_strategy (RPC) which
          // promoted the draft to pending_review.
          await admin
            .from("api_keys")
            .update({ last_sync_at: new Date().toISOString() })
            .eq("id", keyLink.api_key_id);
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
        console.warn(
          `[strategies/finalize-wizard] side effect ${label} failed (non-blocking):`,
          r.reason,
        );
        if (process.env.SENTRY_DSN) {
          try {
            const Sentry = await import("@sentry/nextjs");
            Sentry.captureException(r.reason, {
              tags: {
                surface: "finalize-wizard-after",
                side_effect: label,
              },
              extra: {
                strategy_id: resolvedId,
                manager_name: managerName,
              },
            });
          } catch (sentryErr) {
            console.warn(
              "[strategies/finalize-wizard] Sentry capture failed:",
              sentryErr,
            );
          }
        }
      }
    }
  });

  return NextResponse.json({
    strategy_id: resolvedId,
    status: "pending_review",
  });
}

/**
 * Phase 19 / BACKBONE-01 unified path. Delegates to /process-key with
 * `flow_type=onboard` (finalize step). The force-refresh permissions probe
 * has already run in the caller (Open Question 1 — RETAINED at this layer).
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
  const upstream = (result.body ?? {}) as Record<string, unknown>;
  if (upstream && typeof upstream === "object" && "queued" in upstream) {
    return NextResponse.json({
      strategy_id: args.strategy_id,
      status: "pending_review",
      verification_id: upstream.verification_id ?? null,
      queued: upstream.queued ?? true,
      ...(typeof upstream.code === "string" ? { code: upstream.code } : {}),
      ...(upstream.idempotent === true ? { idempotent: true } : {}),
    });
  }
  return NextResponse.json(upstream);
}
