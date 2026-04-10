import { NextRequest, NextResponse } from "next/server";
import { encryptKey } from "@/lib/analytics-client";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import type { User } from "@supabase/supabase-js";

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(userActionLimiter, `keys-encrypt:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json();
  const { exchange, api_key, api_secret, passphrase } = body;

  if (!exchange || !api_key || !api_secret) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const result = await encryptKey(exchange, api_key, api_secret, passphrase);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Encryption failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
