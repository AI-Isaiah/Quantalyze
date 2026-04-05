import { NextRequest, NextResponse } from "next/server";
import { encryptKey } from "@/lib/analytics-client";
import { withAuth } from "@/lib/api/withAuth";

export const POST = withAuth(async (req: NextRequest) => {
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
