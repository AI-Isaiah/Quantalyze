import { createBrowserClient } from "@supabase/ssr";

// NOTE: This browser-side factory intentionally returns the untyped client.
// Typing it with the generated `Database` generic surfaces a wave of
// type-drift errors in components that select from stale columns. The
// server-side `createClient` in ./server.ts is typed; browser typing is
// tracked as a follow-up under audit-2026-05-07 (see C-0155/C-0157
// close-out report).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
