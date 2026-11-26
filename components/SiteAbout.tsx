import Link from "next/link";
import { MAX_PHOTOS_PER_SITE, photoUrl } from "@/lib/site-photos-limits";
import type { Site } from "@/lib/types";
import { ContentActions } from "./ContentActions";
import { SitePhotoAdder } from "./SitePhotoAdder";

/**
 * A site added in the app: its photos and who added it. The diver who added it can add photos here. Nothing on a
 * catalog site with no photos. The site's texts are in SiteWiki, which any diver can edit.
 */
export function SiteAbout({
  site,
  adderNickname,
  isAdder,
  signedIn,
  blockedAdder,
}: {
  site: Site;
  adderNickname: string | null;
  isAdder: boolean;
  signedIn: boolean;
  /** The signed-in diver blocked whoever added the site: their notes and photos are hidden from them. */
  blockedAdder: boolean;
}) {
  if (blockedAdder) {
    if (!site.photos?.length) return null;
    return (
      <section className="surface p-5 copy sm:p-6" aria-label="Photos">
        You blocked the diver who added this site, so their photos are hidden. Unblock them on your{" "}
        <Link href="/account#blocked" className="inline-link">
          account page
        </Link>
        .
      </section>
    );
  }
  const photos = site.photos ?? [];
  const room = MAX_PHOTOS_PER_SITE - photos.length;
  const canAdd = isAdder && room > 0;
  // A pin added in the app keeps this card for its Report, which covers the pin and the adder's own notes (shown in
  // the About card), even once the adder is gone and there are no photos.
  if (photos.length === 0 && !adderNickname && !canAdd && site.sourceUrl !== "user") return null;

  return (
    <section className="flex min-w-0 flex-col gap-3 surface p-5 sm:p-6" aria-labelledby="photos-heading">
      <h2 id="photos-heading" className="card-title">
        Photos
      </h2>
      {photos.length === 0 ? <p className="copy">No photos yet.</p> : null}
      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Photos">
          {photos.map((photo, index) => {
            const src = photoUrl(site.id, photo.id);
            return (
              <li key={photo.id} className="aspect-[4/3] overflow-hidden rounded-lg bg-foam/10">
                <a
                  href={src}
                  target="_blank"
                  rel="noopener"
                  className="block h-full w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-incoming"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- already sized in the browser before upload */}
                  <img
                    src={src}
                    alt={`${site.name}, photo ${index + 1}`}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      {canAdd ? <SitePhotoAdder siteId={site.id} room={room} /> : null}
      {adderNickname && site.addedBy ? (
        <p className="meta">
          Added by{" "}
          <Link
            href={`/divers/${site.addedBy}`}
            className="inline-link"
          >
            {adderNickname}
          </Link>
          . Photos are the diver&apos;s own; the forecast does not read them.
        </p>
      ) : null}
      {site.sourceUrl === "user" && !isAdder ? (
        <ContentActions
          kind="site"
          siteId={site.id}
          userId={site.addedBy}
          nickname={adderNickname ?? undefined}
          signedIn={signedIn}
          returnTo={`/sites/${site.id}`}
        />
      ) : null}
    </section>
  );
}
