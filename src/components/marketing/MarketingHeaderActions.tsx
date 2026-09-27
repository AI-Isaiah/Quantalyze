import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/lib/routing/default-route";

// Byte-identical to the two masthead links this component replaced.
const SIGN_IN_CLASS =
  "inline-flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-page hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const SIGN_UP_CLASS =
  "inline-flex min-h-[44px] items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function SignedOutLinks() {
  return (
    <>
      <Link href="/login" className={SIGN_IN_CLASS}>
        Sign in
      </Link>
      <Link href="/signup" className={SIGN_UP_CLASS}>
        Sign up
      </Link>
    </>
  );
}

/**
 * Async server component. `createClient` reads cookies, which opts the
 * marketing routes that render this into dynamic rendering
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`).
 * No cache directive is added. A failed session read renders the public
 * links; the page does not error, and no name, email or id is shown.
 */
export async function MarketingHeaderActions() {
  // The session read is the only thing in the try. JSX stays outside it:
  // react-hooks/error-boundaries rejects JSX constructed in try/catch, and a
  // render error is not what this catch is for. A failed read fails closed.
  let signedIn = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    signedIn = !error && user != null;
  } catch {
    signedIn = false;
  }
  if (!signedIn) return <SignedOutLinks />;
  return (
    <Link href={DEFAULT_AUTHENTICATED_ROUTE} className={SIGN_UP_CLASS}>
      Go to app
    </Link>
  );
}
