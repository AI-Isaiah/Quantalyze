import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// NOTE: This factory intentionally returns the untyped client. Typing it with
// the generated `Database` generic surfaces a large second wave of type-drift
// errors (admin RPC names, SELECT projections against tables whose generated
// columns are stale). The user-scoped `createClient` in ./server.ts is typed;
// admin/service-role typing is tracked as a follow-up under audit-2026-05-07
// (see C-0155/C-0157 close-out report).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY for admin operations");
  }

  return createSupabaseClient(url, serviceKey);
}
