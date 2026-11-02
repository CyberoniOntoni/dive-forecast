import Link from "next/link";
import { MAX_PHOTOS_PER_SITE, photoUrl } from "@/lib/site-photos-limits";
import type { Site } from "@/lib/types";
import { SitePhotoAdder } from "./SitePhotoAdder";

/**
 * What divers wrote about a site added in the app: how to dive it, photos, and who added it. The diver who added it
 * can add photos here. Nothing on a catalog site with none of these.
 */
export function SiteAbout({
  site,
  adderNickname,
  isAdder,
}: {
  site: Site;
  adderNickname: string | null;
  isAdder: boolean;
}) {
  const photos = site.photos ?? [];
  const room = MAX_PHOTOS_PER_SITE - photos.length;
  const canAdd = isAdder && room > 0;
  if (!site.howToDive && photos.length === 0 && !adderNickname && !canAdd) return null;

  return (
    <section className="flex min-w-0 flex-col gap-3 surface p-4 sm:p-5" aria-labelledby="about-heading">
      <h2 id="about-heading" className="text-base font-semibold text-foam">
        How to dive it
      </h2>
      {site.howToDive ? (
        <p className="text-sm leading-6 break-words whitespace-pre-line text-foam/90">{site.howToDive}</p>
      ) : (
        <p className="text-sm text-foam/70">No notes yet.</p>
      )}
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
        <p className="text-xs leading-5 text-foam/70">
          Added by{" "}
          <Link
            href={`/divers/${site.addedBy}`}
            className="font-medium text-foam underline decoration-incoming underline-offset-4"
          >
            {adderNickname}
          </Link>
          . Notes and photos are the diver&apos;s own; the forecast does not read them.
        </p>
      ) : null}
    </section>
  );
}
