package app.fiftybar.divecurrent.ui.map

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiShelter
import app.fiftybar.divecurrent.data.api.ApiShelterScale
import app.fiftybar.divecurrent.data.api.ApiShelterShapes
import app.fiftybar.divecurrent.domain.ShelterField
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The map's view: its box and zoom (MapLibre's). */
data class MapViewBox(val south: Double, val west: Double, val north: Double, val east: Double, val zoom: Double)

/** A tapped spot's sea state, as the web map's popup words it. */
data class ShelterReadout(val head: String, val detail: String)

data class ShelterUiState(
  val images: List<ShelterImage> = emptyList(),
  /** The hour shown, and the hours that can be picked. */
  val time: String? = null,
  val hours: List<String> = emptyList(),
  val scale: ApiShelterScale? = null,
  val loading: Boolean = false,
  /** The legend's line under the scale: zoom in, loading, old data, clear patches, tap for details. */
  val note: String? = null,
  val readout: ShelterReadout? = null,
)

/**
 * The "Sheltered water" layer, as the web map's (lib/shelter-layer.ts): each atoll's lagoon and the sea round it shaded
 * by felt wave height at one hour, fetched for the view once the map is zoomed in on an atoll, an hour picker, and a
 * tap readout. Outlines are kept once fetched; a failed one is asked for again on the next view.
 */
class ShelterViewModel(private val repository: DataRepository) : ViewModel() {
  private val _state = MutableStateFlow(ShelterUiState())
  val state: StateFlow<ShelterUiState> = _state.asStateFlow()

  private var on = false
  private var view: MapViewBox? = null
  /** The hour picked, or null for the current one. */
  private var chosen: String? = null
  private var load: Job? = null
  private var read: Job? = null
  private val kept = HashMap<String, ApiShelterShapes>()
  private val asking = HashMap<String, Deferred<ApiShelterShapes?>>()

  fun setOn(value: Boolean) {
    if (on == value) return
    on = value
    if (!value) {
      load?.cancel()
      read?.cancel()
      chosen = null
      _state.value = ShelterUiState()
    } else refresh(0)
  }

  /** The map settled on a new view. */
  fun onView(next: MapViewBox) {
    view = next
    if (on) refresh(DEBOUNCE_MS)
  }

  fun step(by: Int) {
    val hours = _state.value.hours
    val at = hours.indexOf(_state.value.time)
    if (at < 0) return
    val target = hours.getOrNull(at + by) ?: return
    chosen = target
    refresh(0)
  }

  fun backToNow() {
    chosen = null
    refresh(0)
  }

  fun closeReadout() {
    read?.cancel()
    _state.update { it.copy(readout = null) }
  }

  /** A tap on the map away from the pins: true when the layer took it (it is on and showing an hour). */
  fun tap(lat: Double, lon: Double): Boolean {
    val time = _state.value.time
    val zoom = view?.zoom ?: return false
    if (!on || time == null || zoom < MIN_ZOOM) return false
    read?.cancel()
    read =
      viewModelScope.launch {
        val readout =
          try {
            val point = repository.shelterPoint(lat, lon, time)
            if (!point.inLayer) null else ShelterReadout(point.head.orEmpty(), point.detail.orEmpty())
          } catch (e: ApiException) {
            ShelterReadout("Sea state unavailable", e.message ?: "Try again in a moment.")
          }
        _state.update { it.copy(readout = readout) }
      }
    return true
  }

  private fun refresh(waitMs: Long) {
    load?.cancel()
    val box = view ?: return
    if (box.zoom < MIN_ZOOM) {
      _state.update { it.copy(images = emptyList(), loading = false, note = "Zoom in on an atoll to see it.") }
      return
    }
    load =
      viewModelScope.launch {
        if (waitMs > 0) delay(waitMs)
        _state.update { it.copy(loading = true) }
        val body =
          try {
            repository.shelter(box.south, box.west, box.north, box.east, chosen)
          } catch (_: ApiException) {
            _state.update { it.copy(loading = false, note = "Sea state is unavailable right now.") }
            return@launch
          }
        val images = images(body)
        _state.update {
          it.copy(images = images, time = body.time, hours = body.hours, scale = body.scale, loading = false, note = note(body))
        }
      }
  }

  private suspend fun images(body: ApiShelter): List<ShelterImage> {
    val outlines = body.atolls.map { shapesFor(it.wayId) }.awaitAll()
    val color = ShelterField.palette(body.scale)
    return withContext(Dispatchers.Default) {
      body.atolls.zip(outlines).mapNotNull { (field, outline) -> outline?.let { ShelterRaster.render(field, it, color) } }
    }
  }

  private fun shapesFor(wayId: String): Deferred<ApiShelterShapes?> {
    kept[wayId]?.let { return CompletableDeferred(it) }
    asking[wayId]?.let { return it }
    val asked =
      viewModelScope.async {
        val answer =
          try {
            repository.shelterShapes(wayId)
          } catch (_: ApiException) {
            null
          }
        // A failed outline is not kept: that atoll is skipped this time and asked for again on the next view.
        if (answer != null) kept[wayId] = answer
        asking.remove(wayId)
        answer
      }
    asking[wayId] = asked
    return asked
  }

  private fun note(body: ApiShelter): String =
    if (body.atolls.isEmpty()) "Waves for this area are still loading. Move the map in a moment."
    else
      listOfNotNull(
          "From old wave data.".takeIf { body.stale },
          "Clear patches: no wave or wind data for that hour.".takeIf { body.atolls.any { ShelterField.hasUnknown(ShelterField.decode(it.values)) } },
          "Tap the water for details.",
        )
        .joinToString(" ")

  companion object {
    /** The web's zoom 8: MapLibre's tiles are twice Leaflet's, so one zoom less. */
    const val MIN_ZOOM = 7.0
    /** Wait this long after the map stops before asking, so a pan in steps asks once. */
    private const val DEBOUNCE_MS = 250L
  }
}
