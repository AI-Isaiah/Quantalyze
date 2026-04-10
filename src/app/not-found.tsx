import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4">
      <div className="max-w-md">
        <p className="font-metric text-6xl text-accent">404</p>
        <h1 className="mt-4 font-display text-3xl text-text-primary md:text-[32px]">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6">
          <Link href="/discovery/crypto-sma">
            <Button>Go to Discovery</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
