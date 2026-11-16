package app.fiftybar.divecurrent.domain

import java.text.Normalizer

/** A site in the boat destination list, with how far it is when the phone knows where it is. */
data class Destination(val id: String, val name: String, val atoll: String?, val lat: Double, val lon: Double, val km: Double?)

/** The Navigate destination list, as the web's (lib/navigate-tab.ts destinationList, lib/site-search.ts). */
object Destinations {
  /** Rows shown at most; a search finds the rest. */
  const val LIMIT = 40

  private val MARKS = Regex("\\p{Mn}+")
  private val NOT_WORD = Regex("[^a-z0-9]+")

  /** Lower case, accents dropped, anything but letters and digits as single spaces: "Fesdu Wreck" ≈ "fesdu-wreck". */
  fun normalize(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFD).replace(MARKS, "").lowercase().replace(NOT_WORD, " ").trim()

  /** Every word of the query starts a word in the site's name or its atoll's name, in any order. */
  fun matches(name: String, atoll: String?, query: String): Boolean {
    val words = normalize(query).split(" ").filter { it.isNotEmpty() }
    if (words.isEmpty()) return true
    val haystack = " ${normalize(name)} ${normalize(atoll ?: "")} "
    return words.all { haystack.contains(" $it") }
  }

  /** The matching sites, nearest first when [from] is known, else by name; at most [LIMIT], and how many matched. */
  fun list(sites: List<Destination>, query: String, from: LatLon?): Pair<List<Destination>, Int> {
    val matched =
      sites
        .filter { matches(it.name, it.atoll, query) }
        .map { it.copy(km = from?.let { here -> BoatNav.distanceKm(here, LatLon(it.lat, it.lon)) }) }
    val sorted = if (from != null) matched.sortedBy { it.km } else matched.sortedBy { it.name.lowercase() }
    return sorted.take(LIMIT) to matched.size
  }
}
