import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import Link from "next/link";

export default function ResetPasswordPage() {
  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-text-primary">Quantalyze</h1>
        <p className="mt-2 text-sm text-text-secondary">Set a new password</p>
      </div>
      <ResetPasswordForm />
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
