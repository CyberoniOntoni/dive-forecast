package app.fiftybar.divecurrent.domain

import app.fiftybar.divecurrent.data.api.ApiEditablePlan
import app.fiftybar.divecurrent.data.api.ApiPlanLimits
import app.fiftybar.divecurrent.data.api.PlanBody
import app.fiftybar.divecurrent.data.api.PlanDayBody
import app.fiftybar.divecurrent.data.api.PlanStopBody
import java.time.LocalDate
import java.time.format.DateTimeParseException

/** One dive being edited. `key` keeps a row's place on screen while dives move; it is never sent. */
data class DraftStop(val key: Long, val siteId: String = "", val time: String, val note: String = "", val want: String? = null)

data class DraftDay(val key: Long, val date: String, val stops: List<DraftStop> = emptyList())

/**
 * A plan in the app's editor, as the web editor (components/PlanEditor.tsx) keeps it: plain fields, checked with the
 * server's own rules before sending ([problem]), so a missing site or time shows at once. Pure, so it is tested.
 */
data class PlanDraft(
  val title: String = "",
  val notes: String = "",
  val speed: String = "8",
  val days: List<DraftDay> = emptyList(),
  /** The next row key. */
  val nextKey: Long = 1,
) {
  fun withTitle(value: String) = copy(title = value)

  fun withNotes(value: String) = copy(notes = value)

  fun withSpeed(value: String) = copy(speed = value)

  /** A new day after the latest, or [today] for the first. */
  fun addDay(today: String): PlanDraft {
    val latest = days.maxOfOrNull { it.date }
    val date = latest?.let { plusDays(it, 1) } ?: today
    return copy(days = days + DraftDay(nextKey, date), nextKey = nextKey + 1)
  }

  fun removeDay(dayKey: Long) = copy(days = days.filterNot { it.key == dayKey })

  fun setDate(dayKey: Long, date: String) = changeDay(dayKey) { it.copy(date = date) }

  /** A new dive at the next usual time after the day's latest. */
  fun addStop(dayKey: Long): PlanDraft {
    val day = days.firstOrNull { it.key == dayKey } ?: return this
    val latest = day.stops.maxOfOrNull { it.time } ?: ""
    val time = DIVE_TIMES.firstOrNull { it > latest } ?: "12:00"
    return changeDay(dayKey) { it.copy(stops = it.stops + DraftStop(nextKey, time = time)) }.copy(nextKey = nextKey + 1)
  }

  fun removeStop(dayKey: Long, stopKey: Long) = changeDay(dayKey) { day -> day.copy(stops = day.stops.filterNot { it.key == stopKey }) }

  fun changeStop(dayKey: Long, stopKey: Long, change: (DraftStop) -> DraftStop) =
    changeDay(dayKey) { day -> day.copy(stops = day.stops.map { if (it.key == stopKey) change(it) else it }) }

  /** Swaps a dive with the one above or below, each keeping its slot's time, as the web editor does. */
  fun moveStop(dayKey: Long, at: Int, by: Int) =
    changeDay(dayKey) { day ->
      val other = at + by
      if (at !in day.stops.indices || other !in day.stops.indices) return@changeDay day
      val moved = day.stops.toMutableList()
      moved[at] = day.stops[other].copy(time = day.stops[at].time)
      moved[other] = day.stops[at].copy(time = day.stops[other].time)
      day.copy(stops = moved)
    }

  /**
   * What to fix before saving, in the server's words (lib/dive-plan.ts requirePlanInput), or null. [knownSite] is the
   * editor's site list. The server checks again and has the last word.
   */
  fun problem(limits: ApiPlanLimits, knownSite: (String) -> Boolean): String? {
    if (title.isBlank()) return "Give the plan a title"
    if (title.trim().length > limits.titleMax) return "Title must be at most ${limits.titleMax} characters"
    if (notes.trim().length > limits.notesMax) return "Notes must be at most ${limits.notesMax} characters"
    val knots = speed.trim().replace(',', '.').toDoubleOrNull()
    if (knots == null || knots < limits.boatSpeedMinKn || knots > limits.boatSpeedMaxKn) {
      return "Boat speed must be ${trimNumber(limits.boatSpeedMinKn)} to ${trimNumber(limits.boatSpeedMaxKn)} knots"
    }
    if (days.isEmpty()) return "Add at least one day"
    if (days.size > limits.daysMax) return "A plan has at most ${limits.daysMax} days"
    val seen = mutableSetOf<String>()
    for (day in days) {
      val year = runCatching { LocalDate.parse(day.date).year }.getOrNull()
      if (year == null || year < limits.yearMin || year > limits.yearMax) return "Each day needs a date"
      if (!seen.add(day.date)) return "${dayLabel(day.date)} is in the plan twice"
      if (day.stops.size > limits.divesPerDayMax) return "${dayLabel(day.date)} has more than ${limits.divesPerDayMax} dives"
      for (stop in day.stops) {
        if (!knownSite(stop.siteId)) return "Pick a dive site for each dive on ${dayLabel(day.date)}"
        if (!CLOCK.matches(stop.time)) return "Give each dive on ${dayLabel(day.date)} a time"
        if (stop.note.trim().length > limits.diveNoteMax) {
          return "A dive note must be at most ${limits.diveNoteMax} characters"
        }
      }
    }
    return null
  }

  /** The body to send: a wanted way only at a channel, empty text left out. The server sorts days and dives. */
  fun body(channel: (String) -> Boolean): PlanBody =
    PlanBody(
      title = title.trim(),
      notes = notes.trim().ifEmpty { null },
      boatSpeedKn = speed.trim().replace(',', '.').toDoubleOrNull() ?: 0.0,
      days =
        days.map { day ->
          PlanDayBody(
            date = day.date,
            stops =
              day.stops.map { stop ->
                PlanStopBody(
                  siteId = stop.siteId,
                  time = stop.time,
                  note = stop.note.trim().ifEmpty { null },
                  want = stop.want?.takeIf { channel(stop.siteId) },
                )
              },
          )
        },
    )

  private fun changeDay(dayKey: Long, change: (DraftDay) -> DraftDay) =
    copy(days = days.map { if (it.key == dayKey) change(it) else it })

  companion object {
    /** The usual times a boat goes in, for a new dive (components/PlanEditor.tsx DIVE_TIMES). */
    val DIVE_TIMES = listOf("07:00", "10:30", "14:30", "17:30", "19:30", "21:00")
    private val CLOCK = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

    /** A new plan: one day, today in the Maldives. */
    fun new(today: String, limits: ApiPlanLimits): PlanDraft =
      PlanDraft(speed = trimNumber(limits.boatSpeedDefaultKn)).addDay(today)

    /** A saved plan, ready to change. */
    fun from(plan: ApiEditablePlan): PlanDraft {
      var key = 1L
      val days =
        plan.days.map { day ->
          DraftDay(
            key = key++,
            date = day.date,
            stops = day.stops.map { DraftStop(key++, it.siteId, it.time, it.note ?: "", it.want) },
          )
        }
      return PlanDraft(plan.title, plan.notes ?: "", trimNumber(plan.boatSpeedKn), days, key)
    }

    /** Why a new plan cannot be saved when the diver already keeps [count] plans, in the server's words, or null. */
    fun listFull(count: Int, limits: ApiPlanLimits): String? =
      if (count >= limits.plansMax) "You can keep up to ${limits.plansMax} plans. Delete an old one first." else null

    fun trimNumber(value: Double): String = if (value == Math.floor(value)) value.toLong().toString() else value.toString()

    fun plusDays(date: String, days: Long): String =
      try {
        LocalDate.parse(date).plusDays(days).toString()
      } catch (_: DateTimeParseException) {
        date
      }

    /** "Tue 17 Nov", as the server's dayLabel. */
    fun dayLabel(date: String): String = MaldivesTime.label("${date}T00:00").substringBefore(",")
  }
}
