import { connection } from "next/server";
import { Suspense } from "react";
import { SiteMap } from "@/components/SiteMap";
import { listSites } from "@/lib/actions";
import { toMaldivesWall } from "@/lib/forecast";
import { nowcastSites } from "@/lib/nowcast";
import { readCatalog } from "@/lib/store";

async function SiteMapSection() {
  await connection();
  const sites = await listSites();
  const atolls = readCatalog().atolls;
  const maldivesWall = toMaldivesWall(new Date().toISOString());
  const nowcasts = await nowcastSites(sites, atolls, maldivesWall);
  return <SiteMap sites={sites} nowcasts={nowcasts} maldivesWall={maldivesWall} />;
}

export default function Home() {
  return (
    <main className="flex min-h-0 w-full flex-1 flex-col">
      <Suspense
        fallback={
          <div className="flex min-h-[50dvh] flex-1 items-center justify-center text-sm text-foam/80">Loading sites…</div>
        }
      >
        <SiteMapSection />
      </Suspense>
    </main>
  );
}
