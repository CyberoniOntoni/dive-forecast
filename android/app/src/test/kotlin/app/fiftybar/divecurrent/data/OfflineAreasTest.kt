package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.data.api.ApiBounds
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OfflineAreasTest {
  private val server = MockWebServer()
  private val dao = FakeCacheDao()
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private lateinit var dir: File
  private lateinit var repository: DataRepository
  private var online = true
  private val asked = java.util.Collections.synchronizedList(mutableListOf<String>())

  @Before
  fun setUp() {
    server.dispatcher =
      object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
          val path = request.path ?: ""
          asked += path
          if (!online) return MockResponse().setResponseCode(503)
          val body =
            when {
              path == "/api/v1/sites" -> SITES
              path.endsWith("/forecast") -> """{ "apiVersion": 1, "modelVersion": "m", "siteId": "x", "hours": [] }"""
              path.endsWith("/reports") -> """{ "apiVersion": 1, "siteId": "x", "reports": [] }"""
              path.startsWith("/api/v1/sites/") -> """{ "id": "x", "name": "X", "atollId": "north-male", "lat": 4.2, "lon": 73.4 }"""
              path.endsWith("/index.json") -> INDEX
              path.startsWith("/overlays/") -> "[]"
              else -> return MockResponse().setResponseCode(404)
            }
          return MockResponse().setBody(body)
        }
      }
    server.start()
    dir = Files.createTempDirectory("offline").toFile()
    repository = DataRepository(DiveCurrentApi(server.url("/").toString()), dao)
  }

  @After
  fun tearDown() {
    scope.cancel()
    server.shutdown()
    dir.deleteRecursively()
  }

  private fun areas(imagery: OfflineImagery? = null) = OfflineAreas(repository, File(dir, "areas.json"), scope, imagery)

  /** Imagery saved in memory, or failing like a dropped signal. */
  private class FakeImagery(@Volatile var fail: Boolean = false) : OfflineImagery {
    val saved = java.util.concurrent.ConcurrentHashMap<String, ApiBounds>()

    override suspend fun save(atollId: String, box: ApiBounds, progress: (Float) -> Unit): Long {
      progress(0.5f)
      if (fail) throw java.io.IOException("No signal: the satellite imagery stopped part way.")
      saved[atollId] = box
      return 1_000_000
    }

    override suspend fun remove(atollId: String) {
      saved.remove(atollId)
    }
  }

  @Test
  fun `saves the imagery over the outline's box with the forecasts, and removes it with them`() = runBlocking {
    val imagery = FakeImagery()
    val offline = areas(imagery)
    offline.save("north-male")
    val area = withTimeout(10_000) { offline.areas.first { it.isNotEmpty() } }.getValue("north-male")
    assertTrue(area.imagery)
    assertEquals(4.08, area.box!!.south, 1e-9)
    assertEquals(area.box, imagery.saved["north-male"])
    assertTrue(area.bytes > 1_000_000)
    offline.remove("north-male")
    withTimeout(10_000) { offline.areas.first { it.isEmpty() } }
    assertTrue(imagery.saved.isEmpty())
  }

  @Test
  fun `a refresh whose imagery fails keeps drawing what an earlier save completed`() = runBlocking {
    val imagery = FakeImagery()
    val offline = areas(imagery)
    offline.save("north-male")
    withTimeout(10_000) { offline.areas.first { it.isNotEmpty() } }
    imagery.fail = true
    offline.save("north-male")
    withTimeout(10_000) {
      offline.errors.first { "north-male" in it }
      offline.saving.first { "north-male" !in it }
    }
    val again = offline.areas.value.getValue("north-male")
    assertTrue(again.imagery)
    assertEquals(1_000_000L, again.imageryBytes)
    assertTrue(offline.errors.value.getValue("north-male").startsWith("No signal"))
  }

  @Test
  fun `removing an atoll never saved still drops its imagery`() = runBlocking {
    val imagery = FakeImagery()
    imagery.saved["north-male"] = ApiBounds(4.0, 73.0, 5.0, 74.0)
    val offline = areas(imagery)
    offline.remove("north-male")
    withTimeout(10_000) { while (imagery.saved.isNotEmpty()) kotlinx.coroutines.delay(10) }
  }

  @Test
  fun `keeps the forecasts when the imagery fails, and says why`() = runBlocking {
    val offline = areas(FakeImagery(fail = true))
    offline.save("north-male")
    val area = withTimeout(10_000) { offline.areas.first { it.isNotEmpty() } }.getValue("north-male")
    assertFalse(area.imagery)
    assertNotNull(dao.rows["forecast/kuda-haa"])
    assertTrue(offline.errors.value.getValue("north-male").startsWith("No signal"))
  }

  @Test
  fun `saves an atoll's forecasts and the Atlas tiles over it, then removes them`() = runBlocking {
    val offline = areas()
    offline.save("north-male")
    val area = withTimeout(10_000) { offline.areas.first { it.isNotEmpty() } }.getValue("north-male")
    assertEquals(listOf("kuda-haa", "banana-reef"), area.siteIds)
    assertEquals(0, area.missedSites)
    assertNotNull(dao.rows["forecast/kuda-haa"])
    // Only the tile inside the atoll's box, not the one far south.
    assertNotNull(dao.rows["atlas/reef-outline/4.00_73.25.json"])
    assertFalse(dao.rows.containsKey("atlas/reef-outline/-0.50_73.25.json"))
    assertTrue(area.bytes > 0)
    // Kept between launches.
    assertEquals(area, withTimeout(10_000) { areas().areas.first { it.isNotEmpty() } }["north-male"])
    // The other atoll's site is not saved.
    assertFalse(dao.rows.containsKey("forecast/far-away"))

    offline.remove("north-male")
    withTimeout(10_000) { offline.areas.first { it.isEmpty() } }
    assertFalse(dao.rows.containsKey("forecast/kuda-haa"))
    assertFalse(dao.rows.containsKey("atlas/reef-outline/4.00_73.25.json"))
  }

  @Test
  fun `says so without signal and saves nothing`() = runBlocking {
    online = false
    val offline = areas()
    offline.save("north-male")
    val error = withTimeout(10_000) { offline.errors.first { it.isNotEmpty() } }.getValue("north-male")
    assertTrue(error, error.startsWith("No signal"))
    assertTrue(offline.areas.value.isEmpty())
  }

  @Test
  fun `feeds the map the saved weeks`() = runBlocking {
    val offline = areas()
    offline.save("north-male")
    withTimeout(10_000) { offline.areas.first { it.isNotEmpty() } }
    assertEquals(setOf("kuda-haa", "banana-reef"), offline.savedForecasts().keys)
  }

  private companion object {
    val SITES =
      """
      {
        "apiVersion": 1,
        "atolls": [
          { "id": "north-male", "name": "North Malé", "bounds": { "south": 4.1, "west": 73.3, "north": 4.7, "east": 73.7 } },
          { "id": "addu", "name": "Addu", "bounds": null }
        ],
        "sites": [
          { "id": "kuda-haa", "name": "Kuda Haa", "atollId": "north-male", "lat": 4.31, "lon": 73.46 },
          { "id": "banana-reef", "name": "Banana Reef", "atollId": "north-male", "lat": 4.24, "lon": 73.53 },
          { "id": "far-away", "name": "Far Away", "atollId": "addu", "lat": -0.6, "lon": 73.1 }
        ]
      }
      """
        .trimIndent()

    val INDEX =
      """
      { "tiles": [
        { "file": "4.00_73.25.json", "south": 4.0, "west": 73.25, "north": 4.25, "east": 73.5 },
        { "file": "-0.50_73.25.json", "south": -0.5, "west": 73.25, "north": -0.25, "east": 73.5 }
      ] }
      """
        .trimIndent()
  }
}
