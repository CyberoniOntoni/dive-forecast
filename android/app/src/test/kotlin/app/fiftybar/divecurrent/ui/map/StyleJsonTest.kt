package app.fiftybar.divecurrent.ui.map

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
  fun `no base leaves the background, and the rasters stack as the web tile pane: seamarks, depth shading, sonar, contours`() {
    val style = parse(styleJson(BaseMap.None, MapOverlay.entries.toSet(), background = "#07151d"))
    assertEquals(listOf("background", "seamarks", "depthShading", "sonarDepths", "depthContours"), layerIds(style))
    assertEquals("#07151d", style["layers"]!!.jsonArray[0].jsonObject["paint"]!!.jsonObject["background-color"]!!.jsonPrimitive.content)
    val shading = style["sources"]!!.jsonObject["depthShading"]!!.jsonObject
    val tiles = shading["tiles"]!!.jsonArray[0].jsonPrimitive.content
    assertTrue(tiles.contains("LAYERS=gebco2021:gebco_2021") && tiles.contains("BBOX={bbox-epsg-3857}"))
    assertTrue(shading["attribution"]!!.jsonPrimitive.content.contains("GEBCO"))
    assertEquals("0.8", style["layers"]!!.jsonArray[2].jsonObject["paint"]!!.jsonObject["raster-opacity"]!!.jsonPrimitive.content)
  }
}
