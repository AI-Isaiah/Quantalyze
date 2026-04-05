import { NextRequest, NextResponse } from "next/server";
import { encryptKey } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
}
