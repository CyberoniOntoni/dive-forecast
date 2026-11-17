package app.fiftybar.divecurrent.ui.map

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.domain.AtlasOverlay
import app.fiftybar.divecurrent.domain.AtlasShape
import app.fiftybar.divecurrent.domain.AtlasTileEntry
import app.fiftybar.divecurrent.domain.AtlasTiles
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point
import org.maplibre.geojson.Polygon

data class AtlasUiState(
  /** The shapes in view for each overlay that is on; an overlay zoomed out too far has an empty collection. */
  val shapes: Map<AtlasOverlay, FeatureCollection> = emptyMap(),
  /** The overlays that are on but zoomed out below their drawing zoom: their legend says "Zoom in to see them". */
  val zoomedOut: Set<AtlasOverlay> = emptySet(),
)

/**
 * The Allen Coral Atlas overlays, as the web map's atlasLayer (lib/map-layers.ts): only the tiles in view are fetched,
 * each once, from the overlay's minimum zoom. A failed fetch is tried again on the next view. Tiles are kept in memory
 * up to [KEEP_TILES] per overlay, the oldest dropped first.
 */
class AtlasViewModel(private val repository: DataRepository) : ViewModel() {
  private val _state = MutableStateFlow(AtlasUiState())
  val state: StateFlow<AtlasUiState> = _state.asStateFlow()

  private var on: Set<AtlasOverlay> = emptySet()
  private var view: MapViewBox? = null
  private val index = HashMap<AtlasOverlay, List<AtlasTileEntry>>()
  private val askingIndex = HashSet<AtlasOverlay>()
  /** Fetched tiles by overlay, in fetch order (access order, so the least used goes first). */
  private val tiles = HashMap<AtlasOverlay, LinkedHashMap<String, FeatureCollectionPart>>()
  private val asking = HashSet<Pair<AtlasOverlay, String>>()
  /** What each overlay last showed, so an unchanged view does not hand the map the same shapes again. */
  private val shownFiles = HashMap<AtlasOverlay, List<String>>()

  /** One tile's features, built once. */
  private class FeatureCollectionPart(val features: List<Feature>)

  fun setOn(next: Set<AtlasOverlay>) {
    if (next == on) return
    on = next
    (shownFiles.keys - next).forEach { shownFiles.remove(it) }
    refresh()
  }

  fun onView(next: MapViewBox) {
    view = next
    refresh()
  }

  private fun refresh() {
    val box = view
    val shapes = HashMap<AtlasOverlay, FeatureCollection>()
    val zoomedOut = HashSet<AtlasOverlay>()
    var changed = _state.value.shapes.keys != on
    for (overlay in on) {
      if (box == null || box.zoom < overlay.minZoom) {
        zoomedOut += overlay
        shapes[overlay] = EMPTY
        if (shownFiles[overlay] != emptyList<String>()) changed = true
        shownFiles[overlay] = emptyList()
        continue
      }
      val entries = index[overlay]
      if (entries == null) {
        loadIndex(overlay)
        shapes[overlay] = _state.value.shapes[overlay] ?: EMPTY
        continue
      }
      val wanted = AtlasTiles.inView(entries, box.south, box.west, box.north, box.east)
      val kept = tiles.getOrPut(overlay) { LinkedHashMap(16, 0.75f, true) }
      wanted.filter { it !in kept }.forEach { loadTile(overlay, it) }
      val ready = wanted.filter { it in kept }
      if (ready != shownFiles[overlay]) changed = true
      shownFiles[overlay] = ready
      shapes[overlay] = FeatureCollection.fromFeatures(ready.flatMap { kept.getValue(it).features })
    }
    if (changed || zoomedOut != _state.value.zoomedOut) _state.value = AtlasUiState(shapes, zoomedOut)
  }

  private fun loadIndex(overlay: AtlasOverlay) {
    if (!askingIndex.add(overlay)) return
    viewModelScope.launch {
      try {
        index[overlay] = repository.atlasIndex(overlay.folder).tiles
        refresh()
      } catch (_: ApiException) {
        // Tried again on the next view.
      } finally {
        askingIndex.remove(overlay)
      }
    }
  }

  private fun loadTile(overlay: AtlasOverlay, file: String) {
    if (!asking.add(overlay to file)) return
    viewModelScope.launch {
      try {
        val text = repository.atlasTile(overlay.folder, file)
        val part = withContext(Dispatchers.Default) { FeatureCollectionPart(features(overlay, AtlasTiles.parse(text))) }
        val kept = tiles.getOrPut(overlay) { LinkedHashMap(16, 0.75f, true) }
        kept[file] = part
        // Drop the least used, never one on screen (that would only fetch it again).
        val onScreen = shownFiles[overlay].orEmpty().toSet() + file
        while (kept.size > KEEP_TILES) {
          val oldest = kept.keys.firstOrNull { it !in onScreen } ?: break
          kept.remove(oldest)
        }
        refresh()
      } catch (e: CancellationException) {
        throw e
      } catch (_: Exception) {
        // A failed or unreadable tile: tried again on the next view.
      } finally {
        asking.remove(overlay to file)
      }
    }
  }

  private fun features(overlay: AtlasOverlay, shapes: List<AtlasShape>): List<Feature> =
    shapes.map { shape ->
      val rings = shape.rings.map { ring -> (ring.indices step 2).map { Point.fromLngLat(ring[it], ring[it + 1]) } }
      Feature.fromGeometry(Polygon.fromLngLats(rings)).apply {
        addStringProperty("color", overlay.classes.getOrNull(shape.classIndex)?.color ?: "#ffffff")
      }
    }

  private companion object {
    const val KEEP_TILES = 48
    val EMPTY: FeatureCollection = FeatureCollection.fromFeatures(emptyList())
  }
}
