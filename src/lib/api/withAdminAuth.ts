import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type AdminHandler = (
  body: Record<string, unknown>,
  admin: SupabaseClient
) => Promise<NextResponse>;

export function withAdminAuth(handler: AdminHandler) {
  return async (request: Request): Promise<NextResponse> => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!(await isAdminUser(supabase, user))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const admin = createAdminClient();
    return handler(body, admin);
  };
}
