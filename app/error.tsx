"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto bg-ink px-4 py-5 text-foam sm:px-8 sm:py-8">
      <section className="flex flex-col gap-5 rounded-2xl border border-foam/15 bg-glass p-4 sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foam sm:text-3xl">Something went wrong</h1>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex min-h-11 w-fit items-center rounded-md bg-foam px-4 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 w-fit items-center rounded-md border border-foam/25 bg-ink px-4 text-sm font-medium text-foam focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
          >
            Return to map
          </Link>
        </div>
      </section>
    </main>
  );
}
