import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ROLE_HOME_ROUTE } from "@/lib/routing/default-route";

export default function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4">
      <div className="max-w-md">
        <p className="font-metric text-6xl text-accent">404</p>
        <h1 className="mt-4 font-display text-3xl text-text-primary md:text-fixed-32">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <Link href={ROLE_HOME_ROUTE}>
            <Button>Go to your home page</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
