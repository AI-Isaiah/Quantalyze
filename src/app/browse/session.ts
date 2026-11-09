import { cache } from "react";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { captureToSentry } from "@/lib/sentry-capture";

/**
 * Whether the reader of a `/browse` page has a session (ROUTE-02: a signed-in
 * user never sees a Log in / Sign up / Get Started Free prompt under /browse).
 *
 * React's request cache makes the layout and the page share ONE `auth.getUser()` per
 * request. `getUser()` validates the token with the auth server; a cookie
 * presence check or `getSession()` would trust an unverified cookie. Any error
 * or a null user is "no session": a public page shows the visitor prompt when
 * it is unsure, which is the safe direction. A failed read (anything but the
 * normal no-session answer) is reported to Sentry, so a signed-in reader shown
 * the visitor prompt by an auth blip leaves a signal.
 */
export const hasBrowseSession = cache(async (): Promise<boolean> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error && !isAuthSessionMissingError(error)) {
      captureToSentry(error, { tags: { area: "browse-session", stage: "get-user" } });
    }
    return !error && !!data?.user;
  } catch (err) {
    captureToSentry(err, { tags: { area: "browse-session", stage: "get-user" } });
    return false;
  }
});
