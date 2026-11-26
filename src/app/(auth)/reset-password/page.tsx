import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Set a new password",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string | string[] }>;
}) {
  // /auth/callback sends a recovery link it could not verify here with
  // ?link=expired, so the form opens on its "request a new link" card.
  const { link } = await searchParams;
  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-text-primary">Quantalyze</h1>
        <p className="mt-2 text-sm text-text-secondary">Set a new password</p>
      </div>
      <ResetPasswordForm
        linkExpired={link === "expired"}
        linkError={link === "error"}
      />
      <p className="mt-6 text-center text-sm text-text-muted">
        <Link
          href="/login"
          className="font-medium text-accent hover:text-accent-hover"
        >
          Back to sign in
        </Link>
      </p>
    </>
  );
}
