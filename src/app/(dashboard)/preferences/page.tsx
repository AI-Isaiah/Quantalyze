import { redirect } from "next/navigation";

/**
 * Legacy `/preferences` route → canonical home is now the Mandate tab on
 * `/profile`. Existing bookmarks and inbound links keep working via this
 * permanent redirect. Pre-2026-04-19 this route rendered the mandate form
 * directly; the form itself lives in `<MandateForm />` and is wired into
 * `<ProfileTabs />` under the `?tab=mandate` param.
 */
export default function PreferencesPage() {
  redirect("/profile?tab=mandate");
}
