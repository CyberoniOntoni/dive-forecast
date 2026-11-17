package app.fiftybar.divecurrent.domain

/*
 * What the site page says beside the hour's flow: whether the tide is rising or falling and its next high or low, when
 * the flow next changes, and how the week splits into days. All of it is read from the forecast hours the server sent
 * (the residual sea level `levelM` and each hour's glance); nothing here forecasts anything.
 */

/** A high or low of the residual tide at hour [index]. */
data class TideTurn(val index: Int, val high: Boolean)

enum class TideTrend { Rising, Falling }

object SiteOutlook {
  /**
   * Every high and low in [levels]: an hour higher (lower) than the hour before and not lower (higher) than the hour
   * after. A flat top of two equal hours counts once, at its first hour. The first and last hours are never turns, since
   * what lies beyond them is unknown.
   */
  fun tideTurns(levels: List<Double>): List<TideTurn> {
    val turns = mutableListOf<TideTurn>()
    for (i in 1 until levels.lastIndex) {
      val before = levels[i - 1]
      val here = levels[i]
      val after = levels[i + 1]
      if (here > before && here >= after) turns += TideTurn(i, high = true)
      else if (here < before && here <= after) turns += TideTurn(i, high = false)
    }
    return turns
  }

  /** The first high or low after hour [index], or null when none is left in the week. */
  fun nextTurn(turns: List<TideTurn>, index: Int): TideTurn? = turns.firstOrNull { it.index > index }

  /**
   * Rising or falling at hour [index]: by the hour before it, or for the first hour by the hour after. Null with fewer
   * than two hours or on a dead level.
   */
  fun trend(levels: List<Double>, index: Int): TideTrend? {
    if (levels.size < 2 || index !in levels.indices) return null
    val (a, b) = if (index == 0) levels[0] to levels[1] else levels[index - 1] to levels[index]
    return when {
      b > a -> TideTrend.Rising
      b < a -> TideTrend.Falling
      else -> null
    }
  }

  /**
   * The first hour after [index] whose flow reads differently: another strength word, another tone, or another way
   * (an along-reef "running NE" turning to "running SW" keeps its tone). An hour with no reading counts as a change,
   * so the page can say the forecast stops there. Null when the week ends first, or when [index] has no reading.
   */
  fun nextFlowChange(glances: List<Glance?>, index: Int): Int? {
    val now = glances.getOrNull(index) ?: return null
    for (j in index + 1..glances.lastIndex) {
      val g = glances[j] ?: return j
      if (g.label != now.label || g.tone != now.tone || g.way != now.way) return j
    }
    return null
  }

  /** The heading to animate to from [from] so the turn takes the short way round (at most 180 degrees). */
  fun shortTurnTarget(from: Float, to: Float): Float = from + (((to - from) % 360 + 540) % 360 - 180)

  /** The index each Maldives day starts at: the first hour, then every midnight. */
  fun dayStarts(times: List<String>): List<Int> =
    times.indices.filter { i -> i == 0 || MaldivesTime.parse(times[i])?.hour == 0 }

  /** Which of [starts] hour [index] falls in. */
  fun dayOf(starts: List<Int>, index: Int): Int = starts.indexOfLast { it <= index }.coerceAtLeast(0)
}
