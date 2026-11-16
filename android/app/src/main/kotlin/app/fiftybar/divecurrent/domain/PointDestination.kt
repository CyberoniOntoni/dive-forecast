package app.fiftybar.divecurrent.domain

import java.util.Locale
import kotlin.math.abs

/**
 * A boat destination picked on the map instead of a site, as the web keeps it (lib/point-destination.ts): its id is
 * "lat,lon" to five decimals (about a metre), which the route endpoint takes in place of a site id. No site id holds
 * a comma.
 */
object PointDestination {
  private val ID = Regex("^(-?\\d{1,2}(?:\\.\\d+)?),(-?\\d{1,3}(?:\\.\\d+)?)$")

  fun id(point: LatLon): String = "${"%.5f".format(Locale.ROOT, point.lat)},${"%.5f".format(Locale.ROOT, point.lon)}"

  /** [id] read back, or null for a site id or anything off the globe. */
  fun read(id: String): LatLon? {
    val match = ID.matchEntire(id) ?: return null
    val lat = match.groupValues[1].toDouble()
    val lon = match.groupValues[2].toDouble()
    return if (abs(lat) <= 90 && abs(lon) <= 180) LatLon(lat, lon) else null
  }

  /**
   * Whether boat routes reach this point: the Maldives with a margin round the outer atolls, the server's ROUTE_BOX
   * (lib/actions.ts). A point outside it would only be refused.
   */
  fun inRouteArea(point: LatLon): Boolean = point.lat in -3.0..10.0 && point.lon in 70.0..77.0

  /** "Point 4.1234° N, 73.5123° E". */
  fun name(point: LatLon): String {
    val ns = if (point.lat < 0) "S" else "N"
    val ew = if (point.lon < 0) "W" else "E"
    return "Point ${"%.4f".format(Locale.ROOT, abs(point.lat))}° $ns, ${"%.4f".format(Locale.ROOT, abs(point.lon))}° $ew"
  }
}
