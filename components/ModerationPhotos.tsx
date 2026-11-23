/** User photos for a moderator on /moderation: thumbnails, each opening the full photo. */
export function ModerationPhotos({ urls, alt }: { urls: readonly string[]; alt: string }) {
  if (urls.length === 0) return null;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {urls.map((url) => (
        <li key={url} className="aspect-square overflow-hidden rounded-lg bg-foam/10">
          <a href={url} target="_blank" rel="noopener" className="block h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- moderator view of user photos */}
            <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}
