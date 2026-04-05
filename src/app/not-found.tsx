import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-full items-center justify-center bg-page px-4">
      <div className="text-center">
        <p className="text-6xl font-bold text-accent font-metric">404</p>
        <h1 className="mt-4 text-2xl font-bold text-text-primary">Page not found</h1>
        <p className="mt-2 text-sm text-text-muted">
          The page you're looking for doesn't exist or has been moved.
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
