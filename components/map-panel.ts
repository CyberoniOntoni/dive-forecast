/**
 * The docked map panel the site list and the Navigate panel share: a sheet over the bottom of a phone map, a column
 * beside it on a wide window. Each adds its own fill, height and padding.
 */
export const DOCKED_PANEL_CLASS =
  "absolute inset-x-0 bottom-0 z-[500] min-h-0 overflow-y-auto overscroll-contain rounded-t-3xl border border-foam/15 text-foam lg:static lg:inset-auto lg:z-auto lg:h-full lg:max-h-full lg:w-[22rem] lg:shrink-0 lg:rounded-none lg:border-y-0 lg:border-l-0 lg:shadow-none";

/** The grab handle at the top of a docked panel on a phone, as on a phone's own sheets. */
export const GRAB_HANDLE_CLASS = "h-1 w-9 rounded-full bg-foam/30";
