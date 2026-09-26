export default function Loading() {
  return (
    <main
      className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8"
      aria-busy="true"
    >
      <p className="sr-only">Loading</p>
      <div
        className="inline-flex min-h-11 w-fit items-center self-start rounded-md border border-foam/25 bg-ink px-4 text-sm font-medium text-foam/40"
        aria-hidden="true"
      >
        Back to map
      </div>
      <header className="flex min-w-0 flex-col gap-2">
        <div className="h-8 w-2/3 max-w-sm rounded-md bg-foam/15 sm:h-9" />
      </header>
      <section className="rounded-2xl border border-foam/15 bg-glass p-4 sm:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="h-28 w-28 shrink-0 animate-pulse rounded-full bg-foam/15" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="h-12 w-48 max-w-full animate-pulse rounded-md bg-foam/20 sm:h-16" />
            <div className="h-6 w-24 animate-pulse rounded-md bg-foam/15" />
            <div className="h-4 w-36 animate-pulse rounded-md bg-foam/10" />
          </div>
        </div>
        <div className="mt-6 px-6">
          <div className="h-11 w-full animate-pulse rounded-full bg-foam/15" />
        </div>
      </section>
    </main>
  );
}
