package app.fiftybar.divecurrent.ui.map

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The map style is a hand-written JSON string: it has to parse, with the seamarks over the base when asked for. */
class StyleJsonTest {
  private fun parse(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

  @Test
  fun `a base alone, or the seamarks over it`() {
    for (base in BaseMap.entries) {
      val plain = parse(styleJson(base))
      assertEquals(listOf("base"), plain["layers"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content })
      val marked = parse(styleJson(base, seamarks = true))
      assertEquals(listOf("base", "seamarks"), marked["layers"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content })
      val source = marked["sources"]!!.jsonObject["seamarks"]!!.jsonObject
      assertTrue(source["attribution"]!!.jsonPrimitive.content.contains("OpenSeaMap"))
      assertTrue(marked["sources"]!!.jsonObject["base"]!!.jsonObject["attribution"]!!.jsonPrimitive.content.isNotEmpty())
    }
  }
}
