package app.fiftybar.divecurrent.domain

import java.text.Normalizer

/** The web site list's search and atoll filter (lib/site-search.ts). */
object SiteSearch {
  /** Lower case, accents dropped, and anything but letters and digits as single spaces: "Fesdu Wreck" ≈ "fesdu-wreck". */
  fun normalize(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFD)
      .replace(Regex("[\\u0300-\\u036f]"), "")
      .lowercase()
      .replace(Regex("[^a-z0-9]+"), " ")
      .trim()

  /** Every word of the query starts a word in the site's name or its atoll's name, in any order. */
  fun matches(name: String, atollName: String?, query: String): Boolean {
    val words = normalize(query).split(" ").filter { it.isNotEmpty() }
    if (words.isEmpty()) return true
    val haystack = " ${normalize(name)} ${normalize(atollName ?: "")} "
    return words.all { haystack.contains(" $it") }
  }

  /** An atoll in the picker: "North Malé (23)". */
  data class AtollChoice(val id: String, val name: String, val count: Int)

  /** The atolls that have sites, by name (lib/site-search.ts atollChoices). */
  fun atollChoices(sites: List<Pair<String, String?>>): List<AtollChoice> =
    sites
      .filter { it.second != null }
      .groupBy { it.first }
      .map { (id, list) -> AtollChoice(id, list.first().second!!, list.size) }
      .sortedBy { normalize(it.name) }
}
