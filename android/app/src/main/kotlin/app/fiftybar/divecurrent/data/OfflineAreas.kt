package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.data.DataRepository.Keys
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiJson
import app.fiftybar.divecurrent.domain.AtlasOverlay
import app.fiftybar.divecurrent.domain.AtlasTiles
import app.fiftybar.divecurrent.domain.OfflineArea
import app.fiftybar.divecurrent.domain.SavedArea
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer

/**
 * The atolls saved for use without signal (Maldives boats often have none). Saving one fetches every site's page,
 * week of forecast and recent reports, and the Allen Coral Atlas tiles over the atoll, into the phone's copy of each
 * endpoint (DataRepository), where the screens already look when a fetch fails. The map then draws the current hour's
 * arrows from the saved weeks (MapViewModel). The list of saved atolls is a small JSON file beside the copies.
 *
 * Satellite imagery is saved as well, from our own Sentinel-2 tiles ([imagery]): Esri's and OpenStreetMap's terms do
 * not allow downloading an area of theirs ahead of time. The map keeps the Esri tiles a diver has looked at
 * (DiveCurrentApp sets MapLibre's cache size), and draws ours under them where an atoll is saved.
 */
class OfflineAreas(
  private val repository: DataRepository,
  private val file: File,
  private val scope: CoroutineScope,
  /** Where the atoll's satellite imagery is saved; none in tests. */
  private val imagery: OfflineImagery? = null,
  private val now: () -> Long = System::currentTimeMillis,
) {
  private val _areas = MutableStateFlow<Map<String, SavedArea>>(emptyMap())

  /** The saved atolls, by atoll id. */
  val areas: StateFlow<Map<String, SavedArea>> = _areas.asStateFlow()

  private val _saving = MutableStateFlow<Map<String, Float>>(emptyMap())

  /** Atolls being saved now, with the share done (0 to 1). */
  val saving: StateFlow<Map<String, Float>> = _saving.asStateFlow()

  private val _errors = MutableStateFlow<Map<String, String>>(emptyMap())

  /** The last save that failed, by atoll id, in words to show. Cleared by the next try. */
  val errors: StateFlow<Map<String, String>> = _errors.asStateFlow()

  private val read = CompletableDeferred<Unit>()
  private val writing = Mutex()
  private val jobs = HashMap<String, Job>()

  init {
    scope.launch {
      _areas.value = withContext(Dispatchers.IO) { readFile() }.associateBy { it.atollId }
      read.complete(Unit)
    }
  }

  /** Saves the atoll, or saves it again; a save already running for it goes on. [quiet] keeps a failure unshown. */
  fun save(atollId: String, quiet: Boolean = false) {
    synchronized(jobs) {
      if (jobs[atollId]?.isActive == true) return
      jobs[atollId] = scope.launch { run(atollId, quiet) }
    }
  }

  /** Forgets the atoll and drops the copies no other saved atoll holds. Stops a save that is running for it. */
  fun remove(atollId: String) {
    val running = synchronized(jobs) { jobs.remove(atollId)?.also { it.cancel() } }
    scope.launch {
      read.await()
      // Let a stopped save finish stopping first: MapLibre may still be creating its region, which would be left behind.
      running?.join()
      // Imagery too when the atoll was never saved: a first save stopped part way leaves a region behind.
      try {
        imagery?.remove(atollId)
      } catch (e: CancellationException) {
        throw e
      } catch (_: Exception) {
        // Left on the phone; no map draws it once the atoll is gone.
      }
      val area = _areas.value[atollId] ?: return@launch
      repository.deleteCopies(OfflineArea.keysToDrop(area, _areas.value.values))
      update { it - atollId }
      _errors.update { it - atollId }
    }
  }

  /** Saves again every atoll saved longer ago than [OfflineArea.REFRESH_AFTER_MS]: on start, and when the map has signal. */
  fun refreshStale() {
    scope.launch {
      read.await()
      val cutoff = now() - OfflineArea.REFRESH_AFTER_MS
      _areas.value.values.filter { it.savedAt < cutoff }.forEach { save(it.atollId, quiet = true) }
    }
  }

  /** The saved week of each site in a saved atoll that has one, by site id: for the map's arrows without signal. */
  suspend fun savedForecasts(): Map<String, ApiForecast> {
    read.await()
    val ids = _areas.value.values.flatMap { it.siteIds }.distinct()
    // A hundred weeks of hours to decode: off the main thread the map calls this from.
    return withContext(Dispatchers.Default) { ids.mapNotNull { id -> repository.cachedForecast(id)?.value?.let { id to it } }.toMap() }
  }

  private suspend fun run(atollId: String, quiet: Boolean) {
    read.await()
    _errors.update { it - atollId }
    _saving.update { it + (atollId to 0f) }
    try {
      val area = fetch(atollId, quiet)
      update { it + (atollId to area) }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      if (!quiet) _errors.update { it + (atollId to (e.message ?: "Could not save this atoll.")) }
    } finally {
      _saving.update { it - atollId }
    }
  }

  private suspend fun fetch(atollId: String, quiet: Boolean): SavedArea {
    val list = tryOrNull { repository.sites() }
    if (list == null || list.fromCache) throw IOException(NO_SIGNAL)
    val atoll = list.value.atolls.firstOrNull { it.id == atollId }
    val sites = list.value.sites.filter { it.atollId == atollId }
    val box = OfflineArea.box(atoll?.bounds, sites) ?: throw IOException("This atoll has no sites to save.")
    // Each overlay's list of tiles, then the tiles over the atoll.
    val atlas =
      AtlasOverlay.entries.flatMap { overlay ->
        val index = tryOrNull { repository.atlasIndex(overlay.folder).tiles }.orEmpty()
        AtlasTiles.inView(index, box.south, box.west, box.north, box.east).map { overlay.folder to it }
      }
    val total = sites.size + atlas.size
    val done = AtomicInteger(0)
    val missed = AtomicInteger(0)
    // With imagery to fetch after, the forecasts and reef shapes are the first part of the bar.
    val dataShare = if (imagery != null) DATA_SHARE else 1f
    fun tick() = _saving.update { it + (atollId to dataShare * done.incrementAndGet() / total) }
    val gate = Semaphore(PARALLEL)
    coroutineScope {
      val siteJobs =
        sites.map { site ->
          async {
            gate.withPermit {
              if (tryOrNull { repository.forecast(site.id) }?.fromCache != false) missed.incrementAndGet()
              // The page and its reports are worth having but not worth failing the save for.
              tryOrNull { repository.site(site.id) }
              tryOrNull { repository.reports(site.id) }
              tick()
            }
          }
        }
      val tileJobs =
        atlas.map { (folder, tile) ->
          async {
            gate.withPermit {
              // Static files: one already kept is the same file.
              if (!repository.hasCopy(Keys.atlas(folder, tile))) tryOrNull { repository.atlasTile(folder, tile) }
              tick()
            }
          }
        }
      (siteJobs + tileJobs).awaitAll()
    }
    if (sites.isNotEmpty() && missed.get() == sites.size) throw IOException(NO_SIGNAL)
    val keys =
      sites.flatMap { listOf(Keys.site(it.id), Keys.forecast(it.id), Keys.reports(it.id)) } +
        AtlasOverlay.entries.map { Keys.atlas(it.folder, "index.json") } +
        atlas.map { (folder, tile) -> Keys.atlas(folder, tile) }
    val imageryBytes =
      imagery?.let { store ->
        try {
          store.save(atollId, box) { share -> _saving.update { it + (atollId to dataShare + (1 - dataShare) * share) } }
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          // The forecasts are saved all the same; the line under the atoll says the imagery is not.
          if (!quiet) _errors.update { it + (atollId to (e.message ?: "Could not save the satellite imagery.")) }
          null
        }
      }
    // A refresh whose imagery failed leaves the region an earlier save completed (MapLibreOfflineImagery keeps it):
    // the map goes on drawing it.
    val before = _areas.value[atollId]?.takeIf { it.imagery && it.box == box }
    val keptImagery = imageryBytes ?: before?.imageryBytes
    return SavedArea(
      atollId = atollId,
      name = atoll?.name ?: sites.firstOrNull()?.atollName ?: atollId,
      savedAt = now(),
      siteIds = sites.map { it.id },
      keys = keys,
      missedSites = missed.get(),
      bytes = repository.copySize(keys) + (keptImagery ?: 0L),
      box = box,
      imagery = keptImagery != null,
      imageryBytes = keptImagery ?: 0L,
    )
  }

  private suspend fun <T> tryOrNull(block: suspend () -> T): T? =
    try {
      block()
    } catch (_: ApiException) {
      null
    }

  private suspend fun update(change: (Map<String, SavedArea>) -> Map<String, SavedArea>) {
    writing.withLock {
      val next = change(_areas.value)
      // On disk first: whoever sees the new list can count on it being there after a restart.
      withContext(Dispatchers.IO) { writeFile(next.values.toList()) }
      _areas.value = next
    }
  }

  private fun readFile(): List<SavedArea> =
    try {
      if (!file.exists()) emptyList() else ApiJson.decodeFromString(LIST, file.readText())
    } catch (_: IOException) {
      emptyList()
    } catch (_: SerializationException) {
      emptyList()
    } catch (_: IllegalArgumentException) {
      emptyList()
    }

  /** Written beside and renamed over, so a crash mid-write leaves the old list. */
  private fun writeFile(areas: List<SavedArea>) {
    val temp = File(file.parentFile, "${file.name}.tmp")
    temp.writeText(ApiJson.encodeToString(LIST, areas))
    if (!temp.renameTo(file)) {
      file.delete()
      temp.renameTo(file)
    }
  }

  private companion object {
    const val PARALLEL = 4
    /** The share of the progress bar for the forecasts and reef shapes; the imagery takes the rest. */
    const val DATA_SHARE = 0.3f
    const val NO_SIGNAL = "No signal: save this atoll when you are online."
    val LIST = ListSerializer(SavedArea.serializer())
  }
}
