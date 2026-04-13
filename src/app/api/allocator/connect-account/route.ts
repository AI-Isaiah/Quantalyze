import { NextRequest, NextResponse, after } from "next/server";
import { validateKey, encryptKey, fetchTrades, computeAnalytics } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/allocator/connect-account
 *
 * Allocator-side account connection flow. Validates a read-only exchange
 * API key, encrypts it, creates a strategy (source='allocator_connected',
 * status='published'), links it to the allocator's portfolio, and triggers
 * an async sync.
 *
 * Unlike the wizard flow (source='wizard', status='draft'), allocator-
 * connected strategies are immediately published but private — they do
 * NOT appear on Discovery because queries filter by source.
 */

const ALLOWED_EXCHANGES = new Set(["binance", "okx", "bybit"]);

export const maxDuration = 60;

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(
    userActionLimiter,
    `allocator-connect:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { exchange, api_key, api_secret, passphrase, label } =
    body as Record<string, unknown>;

  // ── Input validation ──────────────────────────────────────────────

  if (
    typeof exchange !== "string" ||
    !ALLOWED_EXCHANGES.has(exchange.toLowerCase())
  ) {
    return NextResponse.json(
      { error: "Unsupported exchange" },
      { status: 400 },
    );
  }

  if (typeof api_key !== "string" || api_key.length < 8) {
    return NextResponse.json(
      { error: "API key is required (min 8 characters)" },
      { status: 400 },
    );
  }

  if (typeof api_secret !== "string" || api_secret.length < 8) {
    return NextResponse.json(
      { error: "API secret is required (min 8 characters)" },
      { status: 400 },
    );
  }

  if (
    exchange.toLowerCase() === "okx" &&
    (typeof passphrase !== "string" || passphrase.length === 0)
  ) {
    return NextResponse.json(
      { error: "OKX requires a passphrase" },
      { status: 400 },
    );
  }

  if (api_key.length > 512 || api_secret.length > 512) {
    return NextResponse.json(
      { error: "Key or secret too long" },
      { status: 400 },
    );
  }
  if (typeof passphrase === "string" && passphrase.length > 512) {
    return NextResponse.json(
      { error: "Passphrase too long" },
      { status: 400 },
    );
  }
  if (typeof label === "string" && label.length > 100) {
    return NextResponse.json({ error: "Label too long" }, { status: 400 });
  }

  const exchangeNormalized = exchange.toLowerCase();
  const passphraseOrNull =
    typeof passphrase === "string" && passphrase.length > 0
      ? passphrase
      : null;
  const labelOrDefault =
    typeof label === "string" && label.trim().length > 0
      ? label.trim()
      : `${exchangeNormalized} account`;
  const strategyName = `${exchangeNormalized.charAt(0).toUpperCase()}${exchangeNormalized.slice(1)} - ${labelOrDefault}`;

  // ── Find or create portfolio ──────────────────────────────────────

  const supabase = await createClient();
  const { data: existingPortfolio } = await supabase
    .from("portfolios")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_test", false)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let portfolioId: string;

  if (existingPortfolio) {
    portfolioId = existingPortfolio.id;
  } else {
    // Auto-create a real portfolio for the allocator on first connect.
    const admin = createAdminClient();
    const { data: newPortfolio, error: portfolioErr } = await admin
      .from("portfolios")
      .insert({
        user_id: user.id,
        name: "Active Allocation",
        is_test: false,
      })
      .select("id")
      .single();

    if (portfolioErr || !newPortfolio) {
      console.error(
        "[allocator/connect-account] Failed to create portfolio:",
        portfolioErr,
      );
      return NextResponse.json(
        { error: "Could not create portfolio" },
        { status: 500 },
      );
    }
    portfolioId = newPortfolio.id;
  }

  // ── Validate + encrypt + create ────────────────────────────────────

  try {
    const validation = await validateKey(
      exchangeNormalized,
      api_key as string,
      api_secret as string,
      passphraseOrNull ?? undefined,
    );

    if (!validation.read_only) {
      const perms = validation.permissions?.join(",").toLowerCase() ?? "";
      const hasWithdraw = perms.includes("withdraw");
      return NextResponse.json(
        {
          error: hasWithdraw
            ? "This key has withdrawal permissions. Only read-only keys are accepted for your security."
            : "This key has trading permissions. Only read-only keys are accepted for your security.",
        },
        { status: 400 },
      );
    }

    const encrypted = (await encryptKey(
      exchangeNormalized,
      api_key as string,
      api_secret as string,
      passphraseOrNull ?? undefined,
    )) as Record<string, unknown>;

    const api_key_encrypted = encrypted.api_key_encrypted as string | undefined;
    const api_secret_encrypted = encrypted.api_secret_encrypted as
      | string
      | undefined;
    const passphrase_encrypted = (encrypted.passphrase_encrypted ?? null) as
      | string
      | null;
    const dek_encrypted = (encrypted.dek_encrypted ?? null) as string | null;
    const nonce = (encrypted.nonce ?? null) as string | null;
    const kek_version =
      typeof encrypted.kek_version === "number" ? encrypted.kek_version : 1;

    if (!api_key_encrypted || !api_secret_encrypted) {
      console.error(
        "[allocator/connect-account] Encryption returned unexpected shape:",
        Object.keys(encrypted),
      );
      return NextResponse.json(
        { error: "Encryption service error" },
        { status: 502 },
      );
    }

    // Atomic insert: api_key + strategy + portfolio_strategies via RPC.
    const { data, error } = await supabase.rpc(
      "create_allocator_connected_strategy",
      {
        p_user_id: user.id,
        p_portfolio_id: portfolioId,
        p_exchange: exchangeNormalized,
        p_label: labelOrDefault,
        p_strategy_name: strategyName,
        p_api_key_encrypted: api_key_encrypted,
        p_api_secret_encrypted: api_secret_encrypted,
        p_passphrase_encrypted: passphrase_encrypted,
        p_dek_encrypted: dek_encrypted,
        p_nonce: nonce,
        p_kek_version: kek_version,
      },
    );

    if (error) {
      console.error("[allocator/connect-account] RPC error:", error.message);
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "This key is already connected." },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: "Could not connect account" },
        { status: 500 },
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.strategy_id || !row?.api_key_id) {
      return NextResponse.json(
        { error: "RPC returned no rows" },
        { status: 500 },
      );
    }

    const strategyId = row.strategy_id as string;

    // ── Trigger async sync ────────────────────────────────────────

    if (process.env.USE_COMPUTE_JOBS_QUEUE === "true") {
      const admin = createAdminClient();
      const { error: rpcError } = await admin.rpc("enqueue_compute_job", {
        p_strategy_id: strategyId,
        p_kind: "sync_trades",
      });
      if (rpcError) {
        console.error(
          `[allocator/connect-account] enqueue failed for ${strategyId}:`,
          rpcError,
        );
        // Non-fatal: the account is connected, sync can be retried.
      }
    } else {
      // Legacy after() path.
      const adminForSync = createAdminClient();
      await adminForSync
        .from("strategy_analytics")
        .upsert(
          {
            strategy_id: strategyId,
            computation_status: "computing",
            computation_error: null,
          },
          { onConflict: "strategy_id" },
        );

      after(async () => {
        try {
          await fetchTrades(strategyId);
          await computeAnalytics(strategyId);
          console.log(
            `[allocator/connect-account] sync complete for strategy=${strategyId}`,
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Sync failed";
          console.error(
            `[allocator/connect-account] sync failed for ${strategyId}:`,
            err,
          );
          try {
            await adminForSync
              .from("strategy_analytics")
              .upsert(
                {
                  strategy_id: strategyId,
                  computation_status: "failed",
                  computation_error: message,
                },
                { onConflict: "strategy_id" },
              );
          } catch (updateErr) {
            console.error(
              `[allocator/connect-account] failed to write error status for ${strategyId}:`,
              updateErr,
            );
          }
        }
      });
    }

    return NextResponse.json(
      {
        strategy_id: strategyId,
        api_key_id: row.api_key_id,
        portfolio_id: portfolioId,
        status: "syncing",
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection failed";
    console.error("[allocator/connect-account] caught exception:", message);

    const lower = message.toLowerCase();
    if (lower.includes("signature") || lower.includes("invalid secret")) {
      return NextResponse.json(
        { error: "Invalid API key or secret. Please check your credentials." },
        { status: 400 },
      );
    }
    if (lower.includes("ip") && lower.includes("allow")) {
      return NextResponse.json(
        {
          error:
            "Your API key has an IP allowlist. Please add our server IP or remove restrictions.",
        },
        { status: 400 },
      );
    }
    if (lower.includes("rate") || lower.includes("429")) {
      return NextResponse.json(
        { error: "Exchange rate limit. Please try again in a moment." },
        { status: 429 },
      );
    }
    if (lower.includes("timeout") || lower.includes("etimedout")) {
      return NextResponse.json(
        { error: "Exchange connection timed out. Please try again." },
        { status: 504 },
      );
    }

    return NextResponse.json({ error: message }, { status: 400 });
  }
});
