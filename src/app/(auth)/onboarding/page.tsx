import { OnboardingWizard } from "@/components/auth/OnboardingWizard";

export default function OnboardingPage() {
  return (
    <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-text-primary">Welcome</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Tell us about yourself to get started
        </p>
      </div>
      <OnboardingWizard />
    </>
  );
}
