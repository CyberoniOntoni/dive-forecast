/** The data credit as HTML for the map's attribution control, which shows it with the tile credits. */
export const DATA_CREDIT_HTML =
  '<a href="https://open-meteo.com/">Open-Meteo</a> and Meteo-France SMOC and MFWAM. Atoll and island outlines &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

/** The same credit at the foot of a page without the map; one string, so the two cannot drift apart. */
export function Attribution() {
  return <footer className="chart-credit" dangerouslySetInnerHTML={{ __html: DATA_CREDIT_HTML }} />;
}
