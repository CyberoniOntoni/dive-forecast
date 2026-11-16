package app.fiftybar.divecurrent.ui.plan

import app.fiftybar.divecurrent.data.Loaded
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiPlanDay
import app.fiftybar.divecurrent.data.api.ApiPlanLeg
import app.fiftybar.divecurrent.data.api.ApiPlanLegs
import app.fiftybar.divecurrent.data.api.ApiPlanStop
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlanLegsTest {
  private fun stop(time: String) = ApiPlanStop(siteId = "s$time", name = "Site", lat = 4.0, lon = 73.0, time = time)

  private val day = ApiPlanDay(date = "2026-11-17", label = "Tue 17 Nov", stops = listOf(stop("09:00"), stop("11:30"), stop("14:00")))

  private fun legs(count: Int, offline: Boolean): Loaded<ApiPlanLegs> =
    Loaded(
      ApiPlanLegs(1, "Kq7vHtmWpdNrcXfa", 0, List(count) { ApiPlanLeg(from = it, text = "1.0 nm") }),
      savedAt = 1L,
      offlineError = if (offline) ApiException.Network(java.io.IOException("offline")) else null,
    )

  @Test
  fun `uses fresh legs that join the day's dives`() {
    assertEquals(2, PlanViewModel.usableLegs(day, legs(2, offline = false), planIsFresh = true)!!.size)
  }

  @Test
  fun `never puts an old copy of the legs under a plan just fetched`() {
    assertNull(PlanViewModel.usableLegs(day, legs(2, offline = true), planIsFresh = true))
  }

  @Test
  fun `uses the copies together offline, but not legs from another version of the day`() {
    assertEquals(2, PlanViewModel.usableLegs(day, legs(2, offline = true), planIsFresh = false)!!.size)
    assertNull(PlanViewModel.usableLegs(day, legs(1, offline = true), planIsFresh = false))
    assertNull(PlanViewModel.usableLegs(day, legs(3, offline = false), planIsFresh = true))
  }
}
