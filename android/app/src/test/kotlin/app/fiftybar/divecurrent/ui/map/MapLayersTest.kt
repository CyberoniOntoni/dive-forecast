package app.fiftybar.divecurrent.ui.map

import app.fiftybar.divecurrent.domain.AtlasOverlay
import org.junit.Assert.assertEquals
import org.junit.Test

/** The web's lib/map-layers.ts readableBase, and the Atlas drawing zooms in MapLibre's terms. */
class MapLayersTest {
  @Test
  fun `depth shading or contours over satellite show the street map`() {
    val satellite = MapLayers(base = BaseMap.Satellite, overlays = emptySet())
    assertEquals(BaseMap.Satellite, satellite.shownBase)
    assertEquals(BaseMap.Street, satellite.toggled(MapOverlay.DepthShading).shownBase)
    assertEquals(BaseMap.Street, satellite.toggled(MapOverlay.DepthContours).shownBase)
    assertEquals(BaseMap.Satellite, satellite.toggled(MapOverlay.SonarDepths).shownBase)
    // The choice itself stays satellite, and None stays none.
    assertEquals(BaseMap.Satellite, satellite.toggled(MapOverlay.DepthShading).base)
    assertEquals(BaseMap.None, MapLayers(base = BaseMap.None, overlays = setOf(MapOverlay.DepthShading)).shownBase)
  }

  @Test
  fun `Atlas overlays start one MapLibre zoom below the web's Leaflet zoom`() {
    // Web (Leaflet): reef outline 10, reef zones 11, bottom types 12.
    assertEquals(9.0, AtlasOverlay.ReefOutline.minZoom, 0.0)
    assertEquals(10.0, AtlasOverlay.ReefZones.minZoom, 0.0)
    assertEquals(11.0, AtlasOverlay.BottomTypes.minZoom, 0.0)
  }
}
