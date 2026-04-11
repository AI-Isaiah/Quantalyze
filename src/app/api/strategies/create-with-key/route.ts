import { NextRequest, NextResponse } from "next/server";
import { validateKey, encryptKey } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { STRATEGY_NAMES } from "@/lib/constants";
import { isUuid } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/strategies/create-with-key — atomic wizard ConnectKeyStep
 * endpoint. Validates + encrypts a read-only exchange key server-side,
 * then calls the SECURITY DEFINER `create_wizard_strategy` RPC to
 * insert both the `api_keys` and `strategies` (source='wizard',
 * status='draft') rows in one transaction. Errors are mapped to stable
 * wizardErrors.ts codes — raw server messages never reach the client.
 */

const ALLOWED_EXCHANGES = new Set(["binance", "okx", "bybit"]);

function pickPlaceholderCodename(): string {
  // The codename is overwritten at finalize time, so collisions during
  // the draft window are harmless.
  const index = Math.floor(Math.random() * STRATEGY_NAMES.length);
  return STRATEGY_NAMES[index];
}

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(
    userActionLimiter,
    `strategies-create-with-key:${user.id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { code: "KEY_RATE_LIMIT", error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Invalid request body" },
      { status: 400 },
    );
  }

  const {
    exchange,
    api_key,
    api_secret,
    passphrase,
    label,
    wizard_session_id,
  } = body as Record<string, unknown>;

  if (
    typeof exchange !== "string" ||
    !ALLOWED_EXCHANGES.has(exchange.toLowerCase())
  ) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Unsupported exchange" },
      { status: 400 },
    );
  }

  if (typeof api_key !== "string" || api_key.length < 8) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "api_key is required" },
      { status: 400 },
    );
  }

  if (typeof api_secret !== "string" || api_secret.length < 8) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "api_secret is required" },
      { status: 400 },
    );
  }

  if (
    exchange.toLowerCase() === "okx" &&
    (typeof passphrase !== "string" || passphrase.length === 0)
  ) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "OKX requires a passphrase" },
      { status: 400 },
    );
  }

  if (!isUuid(wizard_session_id)) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "wizard_session_id required" },
      { status: 400 },
    );
  }

  if (api_key.length > 512 || api_secret.length > 512) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Key or secret too long" },
      { status: 400 },
    );
  }
  if (typeof passphrase === "string" && passphrase.length > 512) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Passphrase too long" },
      { status: 400 },
    );
  }
  if (typeof label === "string" && label.length > 100) {
    return NextResponse.json(
      { code: "KEY_INVALID_FORMAT", error: "Label too long" },
      { status: 400 },
    );
  }

  const exchangeNormalized = exchange.toLowerCase();
  const passphraseOrNull =
    typeof passphrase === "string" && passphrase.length > 0 ? passphrase : null;
  const labelOrDefault =
    typeof label === "string" && label.trim().length > 0
      ? label.trim()
      : `${exchangeNormalized} key`;

  // validate + encrypt are TOCTOU-safe back-to-back on the server side.
  try {
    const validation = await validateKey(
      exchangeNormalized,
      api_key,
      api_secret,
      passphraseOrNull ?? undefined,
    );

    if (!validation.read_only) {
      const perms = validation.permissions?.join(",").toLowerCase() ?? "";
      const code = perms.includes("withdraw")
        ? "KEY_HAS_WITHDRAW_PERMS"
        : "KEY_HAS_TRADING_PERMS";
      return NextResponse.json(
        {
          code,
          error:
            "This key has trading or withdrawal permissions. Only read-only keys are accepted.",
        },
        { status: 400 },
      );
    }

    const encrypted = await encryptKey(
      exchangeNormalized,
      api_key,
      api_secret,
      passphraseOrNull ?? undefined,
    ) as Record<string, unknown>;

    // Railway returns the encrypted payload using DB-native column
    // names (api_key_encrypted, api_secret_encrypted, etc.).
    const api_key_encrypted = encrypted.api_key_encrypted as string | undefined;
    const api_secret_encrypted = encrypted.api_secret_encrypted as string | undefined;
    const passphrase_encrypted = (encrypted.passphrase_encrypted ?? null) as string | null;
    const dek_encrypted = (encrypted.dek_encrypted ?? null) as string | null;
    const nonce = (encrypted.nonce ?? null) as string | null;
    const kek_version =
      typeof encrypted.kek_version === "number"
        ? encrypted.kek_version
        : 1;

    if (!api_key_encrypted || !api_secret_encrypted) {
      console.error(
        "[strategies/create-with-key] Railway returned unexpected encrypted payload shape",
        Object.keys(encrypted),
      );
      return NextResponse.json(
        { code: "UNKNOWN", error: "Encryption service returned an unexpected response" },
        { status: 502 },
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_wizard_strategy", {
      p_user_id: user.id,
      p_exchange: exchangeNormalized,
      p_label: labelOrDefault,
      p_api_key_encrypted: api_key_encrypted,
      p_api_secret_encrypted: api_secret_encrypted,
      p_passphrase_encrypted: passphrase_encrypted,
      p_dek_encrypted: dek_encrypted,
      p_nonce: nonce,
      p_kek_version: kek_version,
      p_placeholder_name: pickPlaceholderCodename(),
      p_wizard_session_id: wizard_session_id,
    });

    if (error) {
      console.error(
        "[strategies/create-with-key] RPC error:",
        error.message,
        error.code,
      );
      if (error.code === "23505") {
        return NextResponse.json(
          {
            code: "DRAFT_ALREADY_EXISTS",
            error:
              "A wizard session with this key is already in progress.",
          },
          { status: 409 },
        );
      }
      if (error.code === "42501") {
        return NextResponse.json(
          {
            code: "UNKNOWN",
            error: "Permission denied. Please sign out and back in.",
          },
          { status: 403 },
        );
      }
      return NextResponse.json(
        { code: "UNKNOWN", error: "Could not create draft strategy" },
        { status: 500 },
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.strategy_id || !row?.api_key_id) {
      return NextResponse.json(
        { code: "UNKNOWN", error: "RPC returned no rows" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      strategy_id: row.strategy_id,
      api_key_id: row.api_key_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Validation failed";
    console.error("[strategies/create-with-key] caught exception:", message);

    // Classify the error into a wizardErrors code so the client never
    // sees the raw Railway message.
    const lower = message.toLowerCase();
    let code = "UNKNOWN";
    if (lower.includes("signature") || lower.includes("invalid secret")) {
      code = "KEY_INVALID_SIGNATURE";
    } else if (lower.includes("ip") && lower.includes("allow")) {
      code = "KEY_IP_ALLOWLIST";
    } else if (lower.includes("rate") || lower.includes("429")) {
      code = "KEY_RATE_LIMIT";
    } else if (lower.includes("timeout") || lower.includes("etimedout")) {
      code = "KEY_NETWORK_TIMEOUT";
    } else if (lower.includes("trading") || lower.includes("withdraw")) {
      code = "KEY_HAS_TRADING_PERMS";
    }

    return NextResponse.json({ code, error: message }, { status: 400 });
  }
});
