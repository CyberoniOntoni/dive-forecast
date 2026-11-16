package app.fiftybar.divecurrent.domain

/**
 * A plan id from what a diver pastes or a link opens: "https://50bar.app/plans/<id>", "/plans/<id>", or the id itself.
 * Ids are 16 letters and digits without the look-alikes I, O, l, 0, 1 (lib/dive-plan.ts PLAN_ID); null for anything else.
 */
object PlanLink {
  private val ID = Regex("^[A-HJ-NP-Za-km-z2-9]{16}$")
  private val IN_PATH = Regex("(?:^|/)plans/([A-HJ-NP-Za-km-z2-9]{16})/?(?:[?#].*)?$")

  fun idOf(text: String?): String? {
    val value = text?.trim() ?: return null
    if (ID.matches(value)) return value
    return IN_PATH.find(value)?.groupValues?.get(1)
  }
}
