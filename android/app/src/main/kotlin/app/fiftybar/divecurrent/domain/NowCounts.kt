package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.Strength

/**
 * How many sites run each strength this hour, for the map sheet's count chips, read from the server's glances. A
 * site with no reading this hour counts under none of them.
 */
class NowCounts private constructor(private val byStrength: Map<Strength, Int>) {
  fun of(strength: Strength): Int = byStrength[strength] ?: 0

  companion object {
    /** Strongest first, as the list sorts. */
    val ORDER = listOf(Strength.TooStrong, Strength.Strong, Strength.Mild, Strength.Slack)

    fun of(glances: List<Glance?>): NowCounts = NowCounts(glances.mapNotNull { it?.strength }.groupingBy { it }.eachCount())

    /** A site passes a picked strength when it runs that strength now; with none picked, every site passes. */
    fun matches(glance: Glance?, picked: Strength?): Boolean = picked == null || glance?.strength == picked
  }
}
