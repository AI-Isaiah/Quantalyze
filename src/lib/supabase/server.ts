import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch (err) {
            // Next's "Cookies can only be modified in a Server Action or Route
            // Handler" is the expected Server Component case: the proxy
            // refreshes the session instead, so it is only a warning. Anything
            // else is a real failure: name and stack, never a cookie value.
            if (
              err instanceof Error &&
              err.message.includes("Cookies can only be modified")
            ) {
              console.warn(
                "[supabase/server] cookie write skipped (Server Component context)",
              );
            } else {
              console.error(
                "[supabase/server] cookie write failed:",
                err instanceof Error ? err.name : typeof err,
                err instanceof Error ? err.stack : undefined,
              );
            }
          }
        },
      },
    }
  );
}
