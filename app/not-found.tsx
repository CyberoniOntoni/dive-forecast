import Link from "next/link";
import { TideLine } from "@/components/TideLine";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-0 w-full max-w-3xl min-w-0 flex-1 flex-col gap-5 overflow-y-auto bg-ink px-4 py-5 text-foam sm:px-8 sm:py-8">
      <section className="rise-in tideline-card flex flex-col gap-5 surface px-4 pt-10 pb-5 sm:px-6">
        <TideLine />
        <div className="flex flex-col gap-1">
          <p className="eyebrow">Not found</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foam sm:text-3xl">Dive site not found</h1>
        </div>
        <Link
          href="/"
          className="button-quiet w-fit self-start bg-ink px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
        >
          Back to map
        </Link>
      </section>
    </main>
  );
}
