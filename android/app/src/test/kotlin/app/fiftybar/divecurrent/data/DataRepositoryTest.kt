package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import app.fiftybar.divecurrent.data.db.CachedBody
import app.fiftybar.divecurrent.data.db.CachedBodyDao
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
  private val dao = FakeDao()
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
    assertEquals(131.0, n.alongHeadingDeg!!, 0.0)
    assertEquals("mild", n.hour!!.strength)
    assertEquals("/api/v1/nowcast", server.takeRequest().path)
    assertNotNull(dao.rows["nowcast"])
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
  fun `reads a forecast with sea state and a null sea state`() = runTest {
    server.enqueue(reply(200, FORECAST))
    val f = repository.forecast("banana-reef").value
    assertEquals("along-reef", f.forecastRoute)
    assertEquals(2, f.hours.size)
    assertEquals("choppy", f.seaState!!.single().band)
    assertNull(f.seaState.single().swell)

    server.enqueue(reply(200, FORECAST.replace(SEA_STATE, "null")))
    assertNull(repository.forecast("banana-reef").value.seaState)
  }

  private class FakeDao : CachedBodyDao {
    val rows = mutableMapOf<String, CachedBody>()

    override suspend fun get(key: String) = rows[key]

    override suspend fun put(body: CachedBody) {
      rows[body.key] = body
    }
  }

  private companion object {
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
          "hour": { "time": "2026-11-15T09:00", "direction": "incoming", "strength": "mild", "confidence": "medium", "levelM": 0.12 },
          "unavailable": false, "stale": false, "fetchedAt": 1763180000000
        }]
      }
      """
        .trimIndent()

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
        "seaState": $SEA_STATE
      }
      """
        .trimIndent()
  }
}
