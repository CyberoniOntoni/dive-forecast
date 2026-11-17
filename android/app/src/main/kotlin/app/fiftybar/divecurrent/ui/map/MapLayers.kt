package app.fiftybar.divecurrent.ui.map

import android.content.Context
import app.fiftybar.divecurrent.domain.AtlasOverlay

/** The base maps, as the web map's (lib/map-layers.ts BASE_LAYERS). "None" is the map's own dark background. */
enum class BaseMap(val label: String) {
  Satellite("Satellite"),
  Street("Street map"),
  None("None"),
}

/**
 * The web map's overlays (lib/map-layers.ts OVERLAYS), in its menu order, with the same defaults: seamarks and the
 * coordinate grid start on. [key] is the web's id and the saved preference's name.
 */
enum class MapOverlay(val key: String, val label: String, val defaultOn: Boolean, val atlas: AtlasOverlay? = null) {
  Seamarks("seamarks", "Seamarks", true),
  ReefOutline("reefOutline", "Reef outline", false, AtlasOverlay.ReefOutline),
  ReefZones("reefZones", "Reef zones", false, AtlasOverlay.ReefZones),
  BottomTypes("bottomTypes", "Bottom types", false, AtlasOverlay.BottomTypes),
  DepthShading("depthShading", "Depth shading", false),
  SonarDepths("sonarDepths", "Sonar depths", false),
  DepthContours("depthContours", "Depth contours", false),
  Shelter("shelter", "Sheltered water", false),
  Grid("grid", "Coordinate grid", true),
}

/** Overlays drawn as colour fills or labels that clash with satellite imagery (lib/map-layers.ts NEEDS_STREET_BASE). */
private val NEEDS_STREET_BASE = setOf(MapOverlay.DepthShading, MapOverlay.DepthContours)

/** The map layers a diver can switch, as the web map's layer menu: one base, and overlays on or off each. */
data class MapLayers(
  val base: BaseMap = BaseMap.Satellite,
  val overlays: Set<MapOverlay> = MapOverlay.entries.filter { it.defaultOn }.toSet(),
) {
  val seamarks: Boolean
    get() = MapOverlay.Seamarks in overlays

  val shelter: Boolean
    get() = MapOverlay.Shelter in overlays

  val grid: Boolean
    get() = MapOverlay.Grid in overlays

  /** The Atlas overlays switched on. */
  val atlas: Set<AtlasOverlay>
    get() = overlays.mapNotNull { it.atlas }.toSet()

  /**
   * The base to show, as the web's readableBase: depth shading or contours over satellite move to the street map,
   * since they read badly over imagery. The choice itself stays satellite; None stays none.
   */
  val shownBase: BaseMap
    get() = if (base == BaseMap.Satellite && overlays.any { it in NEEDS_STREET_BASE }) BaseMap.Street else base

  fun toggled(overlay: MapOverlay): MapLayers = copy(overlays = if (overlay in overlays) overlays - overlay else overlays + overlay)
}

/** The diver's last choice, kept between launches in shared prefs "map-layers", one boolean per overlay key. */
object MapLayersPrefs {
  private const val PREFS = "map-layers"

  fun read(context: Context): MapLayers {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return MapLayers(
      base = BaseMap.entries.firstOrNull { it.name == prefs.getString("base", null) } ?: BaseMap.Satellite,
      overlays = MapOverlay.entries.filter { prefs.getBoolean(it.key, it.defaultOn) }.toSet(),
    )
  }

  fun write(context: Context, layers: MapLayers) {
    val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("base", layers.base.name)
    MapOverlay.entries.forEach { editor.putBoolean(it.key, it in layers.overlays) }
    editor.apply()
  }
}
