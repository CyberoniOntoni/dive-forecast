package app.fiftybar.divecurrent.ui.map

import app.fiftybar.divecurrent.data.api.ApiBounds
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The map style is a hand-written JSON string: it has to parse, with the raster overlays over the base in order. */
class StyleJsonTest {
  private fun parse(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

  private fun layerIds(style: JsonObject) = style["layers"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content }

  @Test
  fun `a base alone, or the seamarks over it`() {
    for (base in listOf(BaseMap.Satellite, BaseMap.Street)) {
      assertEquals(listOf("background", "base"), layerIds(parse(styleJson(base))))
      val marked = parse(styleJson(base, setOf(MapOverlay.Seamarks)))
      assertEquals(listOf("background", "base", "seamarks"), layerIds(marked))
      val source = marked["sources"]!!.jsonObject["seamarks"]!!.jsonObject
      assertTrue(source["attribution"]!!.jsonPrimitive.content.contains("OpenSeaMap"))
      assertTrue(marked["sources"]!!.jsonObject["base"]!!.jsonObject["attribution"]!!.jsonPrimitive.content.isNotEmpty())
    }
  }

  @Test
  fun `no base leaves the background, and the rasters stack in the web tile pane order`() {
    val style = parse(styleJson(BaseMap.None, MapOverlay.entries.toSet(), background = "#07151d"))
    assertEquals(listOf("background", "seamarks", "depthShading", "sonarDepths", "depthContours"), layerIds(style))
    assertEquals("#07151d", style["layers"]!!.jsonArray[0].jsonObject["paint"]!!.jsonObject["background-color"]!!.jsonPrimitive.content)
    val shading = style["sources"]!!.jsonObject["depthShading"]!!.jsonObject
    val tiles = shading["tiles"]!!.jsonArray[0].jsonPrimitive.content
    assertTrue(tiles.contains("LAYERS=gebco2021:gebco_2021") && tiles.contains("BBOX={bbox-epsg-3857}"))
    assertTrue(shading["attribution"]!!.jsonPrimitive.content.contains("GEBCO"))
    assertEquals("0.8", style["layers"]!!.jsonArray[2].jsonObject["paint"]!!.jsonObject["raster-opacity"]!!.jsonPrimitive.content)
  }

  @Test
  fun `saved atolls put our imagery under the satellite base, each held to its box`() {
    val boxes = listOf(ApiBounds(4.1, 73.2, 4.7, 73.7), ApiBounds(3.4, 72.6, 4.3, 73.0))
    val style = parse(styleJson(BaseMap.Satellite, imagery = boxes))
    assertEquals(listOf("background", "sentinel2-0", "sentinel2-1", "base"), layerIds(style))
    val source = style["sources"]!!.jsonObject["sentinel2-0"]!!.jsonObject
    assertEquals(SENTINEL2_TILES, source["tiles"]!!.jsonArray[0].jsonPrimitive.content)
    assertTrue(SENTINEL2_TILES.endsWith("/imagery/s2-v1/{z}/{x}/{y}.webp"))
    assertEquals(listOf("73.2", "4.1", "73.7", "4.7"), source["bounds"]!!.jsonArray.map { it.jsonPrimitive.content })
    assertEquals("8", source["minzoom"]!!.jsonPrimitive.content)
    assertEquals("14", source["maxzoom"]!!.jsonPrimitive.content)
    assertTrue(source["attribution"]!!.jsonPrimitive.content.contains("Copernicus"))
    // Not under the street map or no base.
    assertEquals(listOf("background", "base"), layerIds(parse(styleJson(BaseMap.Street, imagery = boxes))))
  }
}
