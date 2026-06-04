import { redirect } from "next/navigation";

/**
 * Legacy `/preferences` route → canonical home is now the Mandate tab on
 * `/profile`. Existing bookmarks and inbound links keep working via this
 * permanent redirect. Pre-2026-04-19 this route rendered the mandate form
 * directly; the form itself lives in `<MandateForm />` and is wired into
 * `<ProfileTabs />` under the `?tab=mandate` param.
 *
 * M-0230: inbound query params (e.g. `?utm_source=onboarding-email`) are
 * carried across the redirect rather than dropped — onboarding-email links
 * point at `/preferences` and their tracking params must survive to
 * `/profile`. `tab` is always forced to `mandate` (a stale inbound `tab`
 * must not override the canonical destination).
 */
export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const merged = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab") continue; // forced to "mandate" below
    if (Array.isArray(value)) {
      for (const v of value) merged.append(key, v);
    } else if (value !== undefined) {
      merged.set(key, value);
    }
  }
  merged.set("tab", "mandate");
  redirect(`/profile?${merged.toString()}`);
}
