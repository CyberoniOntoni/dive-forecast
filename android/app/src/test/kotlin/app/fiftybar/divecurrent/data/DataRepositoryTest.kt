package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import app.fiftybar.divecurrent.data.db.CachedBody
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class DataRepositoryTest {
  private val server = MockWebServer()
  private val dao = FakeCacheDao()
  private lateinit var repository: DataRepository

  @Before
  fun setUp() {
    server.start()
    repository = DataRepository(DiveCurrentApi(server.url("/").toString()), dao, now = { 1_000L })
  }

  @After fun tearDown() = server.shutdown()

  private fun reply(code: Int, body: String) = MockResponse().setResponseCode(code).setBody(body)

  @Test
  fun `reads the API_md nowcast example and ignores fields it does not know`() = runTest {
    server.enqueue(reply(200, NOWCAST))
    val loaded = repository.nowcast()
    assertFalse(loaded.fromCache)
    val n = loaded.value.nowcasts.single()
    assertEquals("banana-reef", n.siteId)
    assertEquals("mild", n.hour!!.strength)
    assertEquals("running SE along the reef", n.hour.glance!!.spokenWay)
    assertEquals("along", n.hour.glance.tone)
    assertEquals("/api/v1/nowcast", server.takeRequest().path)
    assertNotNull(dao.rows["nowcast"])
  }

  @Test
  fun `keeps each Atlas tile and draws it again without signal`() = runTest {
    server.enqueue(reply(200, "[]"))
    assertEquals("[]", repository.atlasTile("reef-outline", "4.00_73.25.json"))
    assertEquals("/overlays/reef-outline/4.00_73.25.json", server.takeRequest().path)
    assertTrue(repository.hasCopy("atlas/reef-outline/4.00_73.25.json"))
    server.enqueue(reply(503, "down"))
    assertEquals("[]", repository.atlasTile("reef-outline", "4.00_73.25.json"))
  }

  @Test
  fun `drops copies and sizes what is left`() = runTest {
    server.enqueue(reply(200, NOWCAST))
    repository.nowcast()
    assertEquals(NOWCAST.length.toLong(), repository.copySize(listOf("nowcast", "nothing")))
    repository.deleteCopies(listOf("nowcast"))
    assertNull(repository.cachedNowcast())
  }

  @Test
  fun `asks for a boat route with the position and destination, and keeps no copy`() = runTest {
    server.enqueue(reply(200, BOAT_ROUTE))
    val route = repository.boatRoute(4.123456, 73.5, "4.25000,73.60000")
    assertTrue(route.routed)
    assertEquals(listOf(4.17, 73.51), route.points.first())
    assertEquals(true, route.gaps.single().shallow)
    val source = route.current!!.sources.first()
    assertEquals("Banana Reef", source.name)
    assertEquals("mild", source.hours.single().strength)
    assertEquals(listOf(0, 0, 1, -1), route.current.samples)
    assertEquals("/api/v1/boat-route?from=4.12346%2C73.50000&to=4.25000%2C73.60000", server.takeRequest().path)
    assertTrue(dao.rows.isEmpty())
  }

  @Test
  fun `a refused boat route reaches the caller in the server's words`() = runTest {
    server.enqueue(reply(400, """{"error":{"code":"bad_request","message":"Routes start in the Maldives."}}"""))
    try {
      repository.boatRoute(51.5, -0.1, "banana-reef")
      fail("expected a refusal")
    } catch (e: ApiException.Server) {
      assertEquals(400, e.status)
      assertEquals("Routes start in the Maldives.", e.message)
    }
  }

  @Test
  fun `falls back to the last copy when the server cannot be reached`() = runTest {
    dao.rows["nowcast"] = CachedBody("nowcast", NOWCAST, savedAt = 500L)
    server.enqueue(reply(503, """{"error":{"code":"server_error","message":"Down for a minute."}}"""))
    val loaded = repository.nowcast()
    assertTrue(loaded.fromCache)
    assertEquals(500L, loaded.savedAt)
    assertEquals("Down for a minute.", loaded.offlineError!!.message)
  }

  @Test
  fun `does not hide a 404 behind an old copy`() = runTest {
    dao.rows["forecast/gone"] = CachedBody("forecast/gone", "{}", savedAt = 500L)
    server.enqueue(reply(404, """{"error":{"code":"not_found","message":"No such site."}}"""))
    try {
      repository.forecast("gone")
      fail("expected not_found")
    } catch (e: ApiException.Server) {
      assertEquals("not_found", e.code)
      assertEquals("No such site.", e.message)
    }
  }

  @Test
  fun `loads one site from its own endpoint and keeps a copy`() = runTest {
    server.enqueue(reply(200, SITE))
    val site = repository.site("hp-reef").value
    assertEquals("Rim pass", site.siteTypeLabel)
    assertEquals("North Malé", site.atollName)
    assertEquals("/api/v1/sites/hp-reef", server.takeRequest().path)
    assertEquals("HP Reef", repository.cachedSite("hp-reef")!!.name)
  }

  @Test
  fun `reads a forecast with sea state and a null sea state`() = runTest {
    server.enqueue(reply(200, FORECAST))
    val f = repository.forecast("banana-reef").value
    assertTrue(f.seaStale)
    assertEquals(2, f.hours.size)
    assertEquals("choppy", f.seaState!!.single().band)
    assertNull(f.seaState.single().swell)

    server.enqueue(reply(200, FORECAST.replace(SEA_STATE, "null")))
    assertNull(repository.forecast("banana-reef").value.seaState)
  }

  @Test
  fun `reads the API_md plan example, sends the token and keeps a copy for offline`() = runTest {
    server.enqueue(reply(200, PLAN))
    val plan = repository.plan("Kq7vHtmWpdNrcXfa", token = "app1.abc").value
    val request = server.takeRequest()
    assertEquals("/api/v1/plans/Kq7vHtmWpdNrcXfa", request.path)
    assertEquals("Bearer app1.abc", request.getHeader("Authorization"))
    val stop = plan.days.single().stops.single()
    assertEquals("Tue 17 Nov", plan.days.single().label)
    assertEquals("stop", stop.tone)
    assertEquals(2, stop.warnings.size)
    assertNull(stop.reportTime)
    assertTrue(stop.veryStrong)
    assertEquals("Forecast: fairly sure", stop.confidenceLabel)
    assertEquals("North Malé week", repository.cachedPlan("Kq7vHtmWpdNrcXfa")!!.value.title)
  }

  @Test
  fun `reads a day's boat legs without a token`() = runTest {
    server.enqueue(reply(200, LEGS))
    val legs = repository.planLegs("Kq7vHtmWpdNrcXfa", 0).value
    val request = server.takeRequest()
    assertEquals("/api/v1/plans/Kq7vHtmWpdNrcXfa/days/0/legs", request.path)
    assertNull(request.getHeader("Authorization"))
    assertEquals("Leave by 10:35", legs.legs.single().leaveBy)
    assertTrue(legs.legs.single().routed)
  }

  private companion object {
    /** The API.md boat-route example. */
    val BOAT_ROUTE =
      """
      {
        "apiVersion": 1,
        "points": [[4.17, 73.51], [4.19, 73.52]],
        "lengthKm": 3.2,
        "directKm": 2.9,
        "routed": true,
        "gaps": [{ "lat": 4.18, "lon": 73.515, "widthM": 300, "shallow": true }],
        "current": {
          "stepKm": 0.25,
          "samples": [0, 0, 1, -1],
          "sources": [
            { "siteId": "banana-reef", "name": "Banana Reef",
              "hours": [{ "timeMs": 1763269200000, "eastKn": 0.57, "northKn": -0.57, "strength": "mild" }] },
            { "siteId": null, "name": "Open sea", "hours": [] }
          ]
        }
      }
      """
        .trimIndent()

    val NOWCAST =
      """
      {
        "apiVersion": 1,
        "modelVersion": "tide+throughflow+head+alongreef+lagoon+strait/23",
        "maldivesWall": "2026-11-15T09:12",
        "somethingNew": [1, 2, 3],
        "nowcasts": [{
          "siteId": "banana-reef", "atollId": "north-male", "inwardBearingDeg": 41, "outgoingBearingDeg": null,
          "bearingSource": "rim-derived", "forecastRoute": "along-reef", "alongHeadingDeg": 131,
          "hour": {
            "time": "2026-11-15T09:00", "direction": "incoming", "strength": "mild", "confidence": "medium", "levelM": 0.12,
            "glance": {
              "arrowBearing": 131, "way": "running SE", "spokenWay": "running SE along the reef",
              "wayToward": "running SE along the reef", "label": "mild", "tone": "along", "opacity": 0.74, "rank": 2,
              "estimatedHeading": false
            }
          },
          "unavailable": false, "stale": false, "fetchedAt": 1763180000000
        }]
      }
      """
        .trimIndent()

    val PLAN =
      """
      {
        "apiVersion": 1, "id": "Kq7vHtmWpdNrcXfa", "title": "North Malé week", "notes": null, "boatSpeedKn": 8,
        "span": "17–23 Nov 2026", "ownerNickname": "Ann", "isOwner": false, "webPath": "/plans/Kq7vHtmWpdNrcXfa",
        "updatedAt": "2026-11-15T03:00:00.000Z", "nowWall": "2026-11-17T07:12",
        "days": [{
          "date": "2026-11-17", "label": "Tue 17 Nov", "today": true, "past": false, "toCheck": 1,
          "stops": [{
            "siteId": "kuda-haa", "name": "Kuda Haa", "lat": 4.31, "lon": 73.46, "facts": "Channel thila · North Malé · 5–30 m",
            "howToDive": null, "time": "09:00", "note": "Hook in on the corner.", "want": "Wanted: incoming",
            "status": "forecast", "message": null, "way": "Outgoing, toward W", "arrowBearing": 270, "strength": "Very strong",
            "veryStrong": true, "tone": "stop", "sea": "Sea moderate · 0.8 m", "seaRough": false, "confidence": "fairly sure",
            "confidenceLabel": "Forecast: fairly sure",
            "warnings": ["Very strong current at this time", "Running outgoing; you wanted incoming"],
            "better": "Better 13:00–15:00, best 14:00: incoming, toward E, mild.", "reportTime": null
          }]
        }]
      }
      """
        .trimIndent()

    const val LEGS =
      """{ "apiVersion": 1, "planId": "Kq7vHtmWpdNrcXfa", "dayIndex": 0, "legs": [{ "from": 0, "text": "2.1 nm · about 20 min at 8 kn", "leaveBy": "Leave by 10:35", "tight": false, "tightNote": null, "note": null, "lengthKm": 3.9, "minutes": 20, "routed": true, "points": [[4.31, 73.46], [4.33, 73.48]] }] }"""

    const val SITE =
      """{ "id": "hp-reef", "name": "HP Reef", "atollId": "north-male", "lat": 4.3, "lon": 73.6, "siteType": "pass", "siteTypeLabel": "Rim pass", "atollName": "North Malé" }"""

    const val SEA_STATE =
      """[{ "time": "2026-11-15T09:00", "band": "choppy", "feltM": 0.9, "swell": null, "windWaveM": 0.4, "wind": { "speedMs": 7.2, "fromDeg": 270 }, "againstCurrent": false }]"""

    val FORECAST =
      """
      {
        "apiVersion": 1, "modelVersion": "x/23", "siteId": "banana-reef",
        "hours": [
          { "time": "2026-11-15T09:00", "direction": "incoming", "strength": "mild", "confidence": "medium", "levelM": 0.12 },
          { "time": "2026-11-15T10:00", "direction": "outgoing", "strength": "too_strong", "confidence": "low", "levelM": -0.2 }
        ],
        "unavailable": false, "stale": false, "notice": "Forecast, not a guarantee.",
        "inwardBearingDeg": 41, "bearingSource": "rim-derived", "siteType": "outer-reef",
        "forecastRoute": "along-reef", "alongHeadingDeg": 131, "siteNote": null, "fetchedAt": 1763180000000,
        "seaState": $SEA_STATE, "seaStale": true
      }
      """
        .trimIndent()
  }
}
