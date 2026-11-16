package app.fiftybar.divecurrent.domain

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

/** One Atlas class, in the order a tile refers to them, with the Atlas's own colour ("#rrggbb"). */
data class AtlasClass(val name: String, val color: String)

/**
 * The Allen Coral Atlas overlays, as the web's lib/atlas-overlays.ts: static tiles under public/overlays/ on the app's
 * server (npm run atlas-overlays), each folder with an index.json. Drawn from [minZoom]; below it too many tiles would
 * load at once.
 */
enum class AtlasOverlay(val title: String, val folder: String, val classes: List<AtlasClass>, val outline: Boolean, val minZoom: Double) {
  ReefOutline("Reef outline", "reef-outline", listOf(AtlasClass("Reef", "#ffd166")), outline = true, minZoom = 10.0),
  ReefZones(
    "Reef zones",
    "reef-zones",
    listOf(
      AtlasClass("Reef Crest", "#614272"),
      AtlasClass("Outer Reef Flat", "#c5a7cb"),
      AtlasClass("Inner Reef Flat", "#92739d"),
      AtlasClass("Reef Slope", "#288471"),
      AtlasClass("Sheltered Reef Slope", "#10bda6"),
      AtlasClass("Back Reef Slope", "#bee2e1"),
      AtlasClass("Plateau", "#cd6812"),
      AtlasClass("Shallow Lagoon", "#77d0fc"),
      AtlasClass("Deep Lagoon", "#2ca2f9"),
    ),
    outline = false,
    minZoom = 11.0,
  ),
  BottomTypes(
    "Bottom types",
    "bottom-types",
    listOf(
      AtlasClass("Coral/Algae", "#ff6161"),
      AtlasClass("Rock", "#b19c3a"),
      AtlasClass("Rubble", "#e0d05e"),
      AtlasClass("Sand", "#ffffbe"),
      AtlasClass("Seagrass", "#668438"),
      AtlasClass("Microalgal Mats", "#9bcc4f"),
    ),
    outline = false,
    minZoom = 12.0,
  );

  companion object {
    const val CREDIT = "Allen Coral Atlas, CC BY 4.0"
  }
}

/** One tile in an overlay's index: its file and the bounds of everything in it (shapes can reach past the tile). */
@Serializable data class AtlasTileEntry(val file: String, val south: Double, val west: Double, val north: Double, val east: Double)

@Serializable data class AtlasIndex(val tiles: List<AtlasTileEntry> = emptyList())

/** A shape: its class, and its rings (the first the outside, any others holes), each lon, lat, lon, lat… closed. */
class AtlasShape(val classIndex: Int, val rings: List<DoubleArray>)

object AtlasTiles {
  private const val SCALE = 1e5

  /** The files whose shapes reach into the view. */
  fun inView(index: List<AtlasTileEntry>, south: Double, west: Double, north: Double, east: Double): List<String> =
    index.filter { it.north >= south && it.south <= north && it.east >= west && it.west <= east }.map { it.file }

  /** [x0, y0, dx1, dy1, …] in 1e-5 degree steps (lib/atlas-overlays.ts encodeRing) → lon, lat, … closed. */
  fun decodeRing(flat: LongArray): DoubleArray {
    val pairs = flat.size / 2
    if (pairs == 0) return DoubleArray(0)
    var x = 0L
    var y = 0L
    val out = ArrayList<Double>(pairs * 2 + 2)
    for (i in 0 until pairs) {
      x += flat[2 * i]
      y += flat[2 * i + 1]
      out += x / SCALE
      out += y / SCALE
    }
    // GeoJSON wants a ring to end where it starts.
    if (out[0] != out[out.size - 2] || out[1] != out[out.size - 1]) {
      out += out[0]
      out += out[1]
    }
    return out.toDoubleArray()
  }

  /** A tile file: [[classIndex, ring, ring…], …]. Rings with fewer than three corners are dropped. */
  fun parse(text: String): List<AtlasShape> =
    Json.parseToJsonElement(text).jsonArray.mapNotNull { item ->
      val parts = item as? JsonArray ?: return@mapNotNull null
      val classIndex = parts.firstOrNull()?.jsonPrimitive?.long?.toInt() ?: return@mapNotNull null
      val rings =
        parts.drop(1).mapNotNull { ring ->
          val flat = (ring as? JsonArray)?.map { it.jsonPrimitive.long }?.toLongArray() ?: return@mapNotNull null
          decodeRing(flat).takeIf { it.size >= 8 }
        }
      if (rings.isEmpty()) null else AtlasShape(classIndex, rings)
    }
}
