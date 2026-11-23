import { banRefusal, FLAG_REASON_LABELS } from "./moderation";
import { strengthLabel } from "./nowcast-glance";
import { photoUrl } from "./site-photos-limits";
import type { ContentFlag, FlagKind, Report, StoreData, User } from "./types";

/**
 * Everything divers did lately, newest first, for moderators at /moderation: dive reports, ratings and reviews with
 * their photos, sites added in the app, dive plans, sign-ups and content reports. Built from the store as it stands;
 * nothing here is shown to anyone but a moderator, and never an email.
 */

export const ACTIVITY_KINDS = ["report", "review", "rating", "site", "plan", "signup", "flag"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** The filter tabs on /moderation, each a set of kinds. */
export const ACTIVITY_FILTERS = {
  all: { label: "Everything", kinds: ACTIVITY_KINDS },
  reports: { label: "Dive reports", kinds: ["report"] },
  reviews: { label: "Reviews and ratings", kinds: ["review", "rating"] },
  sites: { label: "New sites", kinds: ["site"] },
  plans: { label: "Dive plans", kinds: ["plan"] },
  divers: { label: "Sign-ups", kinds: ["signup"] },
  flags: { label: "Content reports", kinds: ["flag"] },
} as const satisfies Record<string, { label: string; kinds: readonly ActivityKind[] }>;
export type ActivityFilter = keyof typeof ACTIVITY_FILTERS;

export const ACTIVITY_DAYS = 30;
/** Items to a page on /moderation; older ones are on the next pages, so the whole window can be read. */
export const ACTIVITY_PAGE_SIZE = 100;

export type ActivityDiver = {
  userId: string;
  nickname: string;
  banned: boolean;
  /** The store-review account (lib/review-account.ts): its content is hidden from everyone else. */
  storeReview: boolean;
};

/** What a moderator can take down from the feed, in the shape of a content report (ContentFlag). */
export type ActivityTarget = { kind: FlagKind; siteId?: string; userId?: string };

export type ActivityItem = {
  key: string;
  kind: ActivityKind;
  /** ISO UTC. */
  at: string;
  /** Who did it. Null for a deleted account or a rating from before sign-in. */
  diver: ActivityDiver | null;
  site: { id: string; name: string; hidden: boolean } | null;
  /** One line: what happened. */
  summary: string;
  /** The diver's own words, if any: review, site notes, About me, plan notes, a content report's note. */
  text: string | null;
  photos: string[];
  /** A page to open, besides the site and the diver. */
  href: string | null;
  /** What "Remove" takes down; null when there is nothing to remove. */
  removable: ActivityTarget | null;
  /** Whether Ban diver is offered for whoever did it (banRefusal: never oneself or the store-review account). */
  canBan: boolean;
  /** Open content reports on the same thing. */
  openFlags: number;
};

export type ActivitySiteLookup = (siteId: string) => { name: string; hidden?: boolean } | null | undefined;

/** When a report was filed, ISO UTC; reports from before filedAt was kept fall back to the dive time (UTC+5). */
function reportAt(report: Report): string | null {
  if (report.filedAt) return report.filedAt;
  const ms = Date.parse(`${report.time}:00+05:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Recent activity, newest first: the last `days` days of the given kinds, all of it unless `max` is given. Ban is
 * offered on items whose diver `moderatorId` may ban (none without one).
 */
export function recentActivity(
  store: StoreData,
  lookupSite: ActivitySiteLookup,
  nowMs: number,
  {
    days = ACTIVITY_DAYS,
    max = Number.POSITIVE_INFINITY,
    kinds = ACTIVITY_KINDS,
    moderatorId,
  }: { days?: number; max?: number; kinds?: readonly ActivityKind[]; moderatorId?: string } = {},
): ActivityItem[] {
  const since = nowMs - days * 24 * 60 * 60 * 1000;
  const recent = (at: string | null | undefined): at is string => {
    const ms = at ? Date.parse(at) : NaN;
    return Number.isFinite(ms) && ms > since && ms <= nowMs + 60_000;
  };
  const wanted = new Set(kinds);
  const users = new Map(store.users.map((user) => [user.id, user]));
  const diver = (id: string | undefined): ActivityDiver | null => {
    const user: User | undefined = id ? users.get(id) : undefined;
    return user ? { userId: user.id, nickname: user.nickname, banned: Boolean(user.bannedAt), storeReview: Boolean(user.storeReview) } : null;
  };
  const siteCache = new Map<string, ActivityItem["site"]>();
  const site = (id: string | undefined): ActivityItem["site"] => {
    if (!id) return null;
    if (!siteCache.has(id)) {
      const found = store.sites.find((item) => item.id === id) ?? lookupSite(id);
      siteCache.set(id, found ? { id, name: found.name, hidden: Boolean(found.hidden) } : { id, name: id, hidden: false });
    }
    return siteCache.get(id)!;
  };
  const openFlags = (target: ActivityTarget) =>
    store.flags.filter((flag) => !flag.resolvedAt && flag.kind === target.kind && flag.siteId === target.siteId && flag.userId === target.userId).length;
  const items: ActivityItem[] = [];
  // Content reports name their reporter as the diver; banning is for whose content it is, so they get no Ban.
  const push = (item: Omit<ActivityItem, "openFlags" | "canBan">) =>
    items.push({
      ...item,
      openFlags: item.removable ? openFlags(item.removable) : 0,
      canBan: moderatorId != null && item.kind !== "flag" && item.diver != null && banRefusal(store, item.diver.userId, moderatorId) == null,
    });

  if (wanted.has("report")) {
    for (const report of store.reports) {
      const at = reportAt(report);
      if (!recent(at)) continue;
      const shown = report.predicted?.shown;
      const forecast = shown ? `; forecast said ${shown.direction}, ${strengthLabel(shown.strength)}` : "";
      push({
        key: `report:${report.id}`,
        kind: "report",
        at,
        diver: diver(report.userId),
        site: site(report.siteId),
        summary: `Dive report: ${report.direction}, ${strengthLabel(report.strength)} at ${report.time.replace("T", " ")} (Maldives)${forecast}`,
        text: null,
        photos: [],
        href: null,
        removable: null,
      });
    }
  }

  if (wanted.has("review") || wanted.has("rating")) {
    for (const rating of store.ratings) {
      if (rating.removedAt || !recent(rating.updatedAt)) continue;
      const written = Boolean(rating.review || rating.photos?.length);
      if (!wanted.has(written ? "review" : "rating")) continue;
      const photos = (rating.photos ?? []).map((photo) => photoUrl(rating.siteId, photo.id));
      push({
        key: `rating:${rating.siteId}:${rating.userId ?? "anonymous"}`,
        kind: written ? "review" : "rating",
        at: rating.updatedAt,
        diver: diver(rating.userId),
        site: site(rating.siteId),
        summary: written
          ? `Review, ${rating.score}/5${photos.length ? `, ${plural(photos.length, "photo")}` : ""}`
          : `Rating, ${rating.score}/5`,
        text: rating.review ?? null,
        photos,
        href: null,
        removable: written && rating.userId ? { kind: "review", siteId: rating.siteId, userId: rating.userId } : null,
      });
    }
  }

  if (wanted.has("site")) {
    for (const added of store.sites) {
      if (added.sourceUrl !== "user" || !recent(added.addedAt)) continue;
      const photos = (added.photos ?? []).map((photo) => photoUrl(added.id, photo.id));
      const depths = added.diveTopM != null || added.diveMaxM != null ? `, ${added.diveTopM ?? "?"}–${added.diveMaxM ?? "?"} m` : "";
      push({
        key: `site:${added.id}`,
        kind: "site",
        at: added.addedAt,
        diver: diver(added.addedBy),
        site: site(added.id),
        summary: `New site${added.diverSiteType ? ` (${added.diverSiteType.replace(/-/g, " ")})` : ""}${depths}${photos.length ? `, ${plural(photos.length, "photo")}` : ""}${added.hidden ? ", hidden" : ""}`,
        text: added.howToDive ?? null,
        photos,
        href: null,
        removable: added.hidden ? null : { kind: "site", siteId: added.id, ...(added.addedBy ? { userId: added.addedBy } : {}) },
      });
    }
  }

  if (wanted.has("plan")) {
    for (const plan of store.plans) {
      if (!recent(plan.updatedAt)) continue;
      const dives = plan.days.reduce((sum, day) => sum + day.stops.length, 0);
      const edited = plan.updatedAt !== plan.createdAt;
      push({
        key: `plan:${plan.id}`,
        kind: "plan",
        at: plan.updatedAt,
        diver: diver(plan.ownerId),
        site: null,
        summary: `Dive plan ${edited ? "edited" : "made"}: “${plan.title}”, ${plural(plan.days.length, "day")}, ${plural(dives, "dive")}`,
        text: plan.notes ?? null,
        photos: [],
        href: `/plans/${plan.id}`,
        removable: null,
      });
    }
  }

  if (wanted.has("signup")) {
    for (const user of store.users) {
      if (!recent(user.createdAt)) continue;
      push({
        key: `signup:${user.id}`,
        kind: "signup",
        at: user.createdAt,
        diver: diver(user.id),
        site: null,
        summary: `Signed up${user.acceptedTermsAt ? "" : " (has not agreed to the content rules)"}`,
        text: user.about ? `About me: ${user.about}` : null,
        photos: [],
        href: null,
        removable: user.bannedAt ? null : { kind: "diver", userId: user.id },
      });
    }
  }

  if (wanted.has("flag")) {
    const what: Record<FlagKind, string> = { review: "a review", site: "an added site", diver: "a diver's profile" };
    for (const flag of store.flags as ContentFlag[]) {
      if (!recent(flag.createdAt)) continue;
      const owner = diver(flag.userId);
      const status = flag.resolvedAt ? `closed: ${flag.resolution ?? "done"}` : "open";
      push({
        key: `flag:${flag.id}`,
        kind: "flag",
        at: flag.createdAt,
        diver: diver(flag.reporterId),
        site: flag.kind === "diver" ? null : site(flag.siteId),
        summary: `Reported ${what[flag.kind]}${owner ? ` by ${owner.nickname}` : ""}: ${FLAG_REASON_LABELS[flag.reason]} (${status})`,
        text: flag.note ?? null,
        photos: [],
        href: null,
        removable: null,
      });
    }
  }

  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key)).slice(0, max);
}

/** Counts of recent activity by kind, for the filter tabs. */
export function activityCounts(items: readonly ActivityItem[]): Record<ActivityKind, number> {
  const counts = Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, 0])) as Record<ActivityKind, number>;
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

export function readActivityFilter(value: unknown): ActivityFilter {
  return typeof value === "string" && Object.hasOwn(ACTIVITY_FILTERS, value) ? (value as ActivityFilter) : "all";
}
