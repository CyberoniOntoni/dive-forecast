import { TideLine } from "@/components/TideLine";

export default function Loading() {
  return (
    <main
      className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8"
      aria-busy="true"
    >
      <p className="sr-only">Loading</p>
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        <div className="button-quiet bg-ink px-4 text-foam/40">
          Map
        </div>
        <div className="button-quiet px-4 text-foam/40">
          Boat route
        </div>
      </div>
      <header className="flex min-w-0 flex-col gap-1">
        <p className="eyebrow">Current forecast</p>
        <div className="h-8 w-2/3 max-w-sm rounded-xl bg-foam/15 sm:h-9" />
      </header>
      {/* Shaped like the forecast card (components/HourSlider.tsx), so the page does not jump when it arrives. */}
      <section className="tideline-card surface px-4 pt-9 pb-4 sm:px-6 sm:pt-10 sm:pb-6">
        <TideLine />
        <div className="flex min-w-0 items-center gap-4">
          <div className="size-28 shrink-0 animate-pulse rounded-full bg-foam/15 sm:size-32" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="h-12 w-48 max-w-full animate-pulse rounded-xl bg-foam/20 sm:h-16" />
            <div className="h-6 w-24 animate-pulse rounded-xl bg-foam/15" />
            <div className="h-4 w-36 animate-pulse rounded-xl bg-foam/10" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="h-[4.5rem] animate-pulse rounded-2xl bg-foam/10" />
          <div className="h-[4.5rem] animate-pulse rounded-2xl bg-foam/10" />
        </div>
        <div className="mt-6 px-3.5">
          <div className="h-11 w-full animate-pulse rounded-full bg-foam/15" />
        </div>
      </section>
    </main>
  );
}
