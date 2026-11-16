package app.fiftybar.divecurrent.ui.map

import android.content.Context

/**
 * The map layers a diver can switch, as the web map's layer menu (lib/map-layers.ts): one base, and overlays on or off
 * each. Seamarks start on, as on the web; the web's other overlays are not in the app yet.
 */
data class MapLayers(val base: BaseMap = BaseMap.Satellite, val seamarks: Boolean = true, val shelter: Boolean = false)

/** The diver's last choice, kept between launches in shared prefs "map-layers". */
object MapLayersPrefs {
  private const val PREFS = "map-layers"

  fun read(context: Context): MapLayers {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val defaults = MapLayers()
    return MapLayers(
      base = BaseMap.entries.firstOrNull { it.name == prefs.getString("base", null) } ?: defaults.base,
      seamarks = prefs.getBoolean("seamarks", defaults.seamarks),
      shelter = prefs.getBoolean("shelter", defaults.shelter),
    )
  }

  fun write(context: Context, layers: MapLayers) {
    context
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString("base", layers.base.name)
      .putBoolean("seamarks", layers.seamarks)
      .putBoolean("shelter", layers.shelter)
      .apply()
  }
}
