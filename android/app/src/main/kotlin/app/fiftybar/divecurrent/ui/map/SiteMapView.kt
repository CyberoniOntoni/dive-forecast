package app.fiftybar.divecurrent.ui.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.RectF
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.util.Locale
import app.fiftybar.divecurrent.BuildConfig
import app.fiftybar.divecurrent.data.api.GlanceTone
import app.fiftybar.divecurrent.domain.AtlasOverlay
import app.fiftybar.divecurrent.domain.CoordinateGrid
import app.fiftybar.divecurrent.ui.theme.CurrentColors
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngQuad
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression.eq
import org.maplibre.android.style.expressions.Expression.geometryType
import org.maplibre.android.style.expressions.Expression.get
import org.maplibre.android.style.expressions.Expression.literal
import org.maplibre.android.style.expressions.Expression.toColor
import org.maplibre.android.style.expressions.Expression.interpolate
import org.maplibre.android.style.expressions.Expression.linear
import org.maplibre.android.style.expressions.Expression.stop
import org.maplibre.android.style.expressions.Expression.zoom
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.fillColor
import org.maplibre.android.style.layers.PropertyFactory.fillOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.layers.PropertyFactory.textAllowOverlap
import org.maplibre.android.style.layers.PropertyFactory.textIgnorePlacement
import org.maplibre.android.style.layers.PropertyFactory.iconAllowOverlap
import org.maplibre.android.style.layers.PropertyFactory.iconIgnorePlacement
import org.maplibre.android.style.layers.PropertyFactory.iconImage
import org.maplibre.android.style.layers.PropertyFactory.iconOpacity
import org.maplibre.android.style.layers.PropertyFactory.iconRotate
import org.maplibre.android.style.layers.PropertyFactory.iconRotationAlignment
import org.maplibre.android.style.layers.PropertyFactory.iconSize
import org.maplibre.android.style.layers.PropertyFactory.textAnchor
import org.maplibre.android.style.layers.PropertyFactory.textColor
import org.maplibre.android.style.layers.PropertyFactory.textField
import org.maplibre.android.style.layers.PropertyFactory.textFont
import org.maplibre.android.style.layers.PropertyFactory.textHaloColor
import org.maplibre.android.style.layers.PropertyFactory.textHaloWidth
import org.maplibre.android.style.layers.PropertyFactory.textOffset
import org.maplibre.android.style.layers.PropertyFactory.textOptional
import org.maplibre.android.style.layers.PropertyFactory.textSize
import org.maplibre.android.style.layers.PropertyFactory.rasterFadeDuration
import org.maplibre.android.style.layers.PropertyFactory.rasterOpacity
import org.maplibre.android.style.layers.PropertyFactory.rasterResampling
import org.maplibre.android.style.layers.RasterLayer
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.style.sources.ImageSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

private const val SOURCE = "sites"
private const val ARROWS = "site-arrows"
private const val NAMES = "site-names"

/**
 * The site-name font, served by the app's own server from public/map-fonts/ (Open Sans Semibold glyphs), not from
 * MapLibre's demo server. The name is the folder there.
 */
private const val LABEL_FONT = "open-sans-semibold"

/** The middle of the Maldives, wide enough to show the chain. */
private val START = CameraPosition.Builder().target(LatLng(3.6, 73.3)).zoom(6.4).build()

/**
 * The site map: a raster base (Esri imagery or OpenStreetMap, the same sources as the web map) and an arrow per site
 * pointing the way the water runs this hour, coloured and faded like the web pins. Tapping an arrow opens the site;
 * a long press offers boat navigation to that point.
 */
@Composable
fun SiteMapView(
  rows: List<SiteRow>,
  layers: MapLayers,
  colors: CurrentColors,
  onOpenSite: (String) -> Unit,
  modifier: Modifier = Modifier,
  /** A long press on the map, with where: to head the boat for that point. */
  onLongPress: (lat: Double, lon: Double) -> Unit = { _, _ -> },
  /** The sheltered-water shading, drawn under the seamarks and pins, at [shelterOpacity]. */
  shelterImages: List<ShelterImage> = emptyList(),
  shelterOpacity: Float = 0.85f,
  /** The map settled on a view. */
  onView: (MapViewBox) -> Unit = {},
  /** A tap away from the pins; true when it was taken. */
  onTap: (lat: Double, lon: Double) -> Boolean = { _, _ -> false },
  /** The Atlas overlays' shapes in view, by overlay (AtlasViewModel); an overlay left out is not drawn. */
  atlas: Map<AtlasOverlay, FeatureCollection> = emptyMap(),
) {
  val context = LocalContext.current
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  val openSite by rememberUpdatedState(onOpenSite)
  val longPress by rememberUpdatedState(onLongPress)
  val viewChanged by rememberUpdatedState(onView)
  val tapped by rememberUpdatedState(onTap)
  // The shading's sources and layers on the current style; a new style starts with none.
  val shelterIds = remember { mutableListOf<String>() }
  val mapView = remember { MapView(context).apply { onCreate(null) } }
  var map by remember { mutableStateOf<MapLibreMap?>(null) }
  var style by remember { mutableStateOf<Style?>(null) }
  // Where the map settled, for the coordinate grid.
  var view by remember { mutableStateOf<MapViewBox?>(null) }

  DisposableEffect(lifecycle, mapView) {
    val observer = LifecycleEventObserver { _, event ->
      when (event) {
        Lifecycle.Event.ON_START -> mapView.onStart()
        Lifecycle.Event.ON_RESUME -> mapView.onResume()
        Lifecycle.Event.ON_PAUSE -> mapView.onPause()
        Lifecycle.Event.ON_STOP -> mapView.onStop()
        else -> Unit
      }
    }
    lifecycle.addObserver(observer)
    mapView.getMapAsync { m ->
      m.cameraPosition = START
      m.uiSettings.isRotateGesturesEnabled = false
      m.uiSettings.isTiltGesturesEnabled = false
      m.addOnMapClickListener { point ->
        val screen = m.projection.toScreenLocation(point)
        val hit = siteAt(m, screen)
        if (hit != null) openSite(hit)
        hit != null || tapped(point.latitude, point.longitude)
      }
      m.addOnCameraIdleListener {
        val box = viewBox(m)
        view = box
        viewChanged(box)
      }
      m.addOnMapLongClickListener { point ->
        longPress(point.latitude, point.longitude)
        true
      }
      map = m
    }
    onDispose {
      lifecycle.removeObserver(observer)
      mapView.onPause()
      mapView.onStop()
      mapView.onDestroy()
    }
  }

  // Only the raster overlays are in the style itself; the rest are drawn on it, so switching them keeps the style.
  val rasters = layers.overlays.intersect(RASTER_ORDER.toSet())
  LaunchedEffect(map, layers.shownBase, rasters, colors) {
    val m = map ?: return@LaunchedEffect
    style = null
    val background = String.format(Locale.ROOT, "#%06x", colors.ink.toArgb() and 0xFFFFFF)
    m.setStyle(Style.Builder().fromJson(styleJson(layers.shownBase, rasters, background))) { loaded ->
      addSiteLayers(context, loaded, colors)
      shelterIds.clear()
      style = loaded
      val box = viewBox(m)
      view = box
      viewChanged(box)
    }
  }

  LaunchedEffect(style, atlas) {
    val s = style ?: return@LaunchedEffect
    showAtlas(s, atlas, shelterIds)
  }

  LaunchedEffect(style, layers.grid, view) {
    val s = style ?: return@LaunchedEffect
    val box = view
    s.getSourceAs<GeoJsonSource>(GRID)?.setGeoJson(if (layers.grid && box != null) gridFeatures(box) else FeatureCollection.fromFeatures(emptyList()))
  }

  LaunchedEffect(style, rows) {
    val s = style ?: return@LaunchedEffect
    s.getSourceAs<GeoJsonSource>(SOURCE)?.setGeoJson(features(rows))
  }

  LaunchedEffect(style, shelterImages, shelterOpacity) {
    val s = style ?: return@LaunchedEffect
    showShelter(s, shelterIds, shelterImages, shelterOpacity)
  }

  AndroidView(factory = { mapView }, modifier = modifier)
}

/**
 * Puts the shading on the style afresh: the 500 m fields first, the 125 m ones over them, over the raster overlays and
 * the Atlas shapes and under the grid and the pins, as the web stacks them.
 */
private fun showShelter(style: Style, shown: MutableList<String>, images: List<ShelterImage>, opacity: Float) {
  shown.forEach { id ->
    style.removeLayer("shelter-layer-$id")
    style.removeSource("shelter-source-$id")
  }
  shown.clear()
  val below = drawnUnder(shelterIds = emptyList())
  for (image in images.sortedBy { it.fine }) {
    val corners =
      LatLngQuad(
        LatLng(image.north, image.west),
        LatLng(image.north, image.east),
        LatLng(image.south, image.east),
        LatLng(image.south, image.west),
      )
    style.addSource(ImageSource("shelter-source-${image.id}", corners, image.bitmap))
    style.addLayerBelow(
      RasterLayer("shelter-layer-${image.id}", "shelter-source-${image.id}")
        .withProperties(rasterOpacity(opacity), rasterResampling(Property.RASTER_RESAMPLING_LINEAR), rasterFadeDuration(0f)),
      below,
    )
    shown += image.id
  }
}

/**
 * The raster overlays, bottom to top, as the web's tile pane stacks them (added in its menu order: seamarks, depth
 * shading, sonar depths, depth contours). They are in the style itself; everything else is drawn over them.
 */
private val RASTER_ORDER = listOf(MapOverlay.Seamarks, MapOverlay.DepthShading, MapOverlay.SonarDepths, MapOverlay.DepthContours)

/**
 * Where a drawn overlay goes, as the web's overlay pane stacks them over every tile layer: the Atlas shapes, then the
 * sheltered-water shading, then the grid and the pins. Atlas shapes pass the shading on screen, to stay under it.
 */
private fun drawnUnder(shelterIds: List<String>): String = shelterIds.firstOrNull()?.let { "shelter-layer-$it" } ?: GRID_LINES

private fun atlasSource(overlay: AtlasOverlay) = "atlas-source-${overlay.folder}"

private fun atlasLayer(overlay: AtlasOverlay) = "atlas-layer-${overlay.folder}"

/**
 * The Atlas shapes, as the web draws them: fills at 55 % in the Atlas's colours, or the reef outline as a line. They
 * sit over the raster overlays (seamarks included) and under the sheltered-water shading, the grid and the pins; each
 * feature carries its own colour.
 */
private fun showAtlas(style: Style, shown: Map<AtlasOverlay, FeatureCollection>, shelterIds: List<String>) {
  for (overlay in AtlasOverlay.entries) {
    val shapes = shown[overlay]
    val source = style.getSourceAs<GeoJsonSource>(atlasSource(overlay))
    if (shapes == null) {
      style.removeLayer(atlasLayer(overlay))
      style.removeSource(atlasSource(overlay))
      continue
    }
    if (source != null) {
      source.setGeoJson(shapes)
      continue
    }
    style.addSource(GeoJsonSource(atlasSource(overlay), shapes))
    val layer =
      if (overlay.outline) LineLayer(atlasLayer(overlay), atlasSource(overlay)).withProperties(lineColor(toColor(get("color"))), lineWidth(1.5f), lineOpacity(0.9f))
      else FillLayer(atlasLayer(overlay), atlasSource(overlay)).withProperties(fillColor(toColor(get("color"))), fillOpacity(0.55f))
    style.addLayerBelow(layer, drawnUnder(shelterIds))
  }
}

/** The grid's lines across the view, latitude labels on the left edge and longitude ones along the top. */
private fun gridFeatures(box: MapViewBox): FeatureCollection {
  val lines = CoordinateGrid.lines(box.south, box.west, box.north, box.east)
  val features =
    lines.flatMap { line ->
      if (line.axis == CoordinateGrid.Axis.Lat) {
        listOf(
          Feature.fromGeometry(LineString.fromLngLats(listOf(Point.fromLngLat(box.west, line.value), Point.fromLngLat(box.east, line.value)))),
          Feature.fromGeometry(Point.fromLngLat(box.west, line.value)).apply {
            addStringProperty("label", line.label)
            addStringProperty("anchor", Property.TEXT_ANCHOR_BOTTOM_LEFT)
          },
        )
      } else {
        listOf(
          Feature.fromGeometry(LineString.fromLngLats(listOf(Point.fromLngLat(line.value, box.south), Point.fromLngLat(line.value, box.north)))),
          Feature.fromGeometry(Point.fromLngLat(line.value, box.north)).apply {
            addStringProperty("label", line.label)
            addStringProperty("anchor", Property.TEXT_ANCHOR_TOP_LEFT)
          },
        )
      }
    }
  return FeatureCollection.fromFeatures(features)
}

private fun viewBox(map: MapLibreMap): MapViewBox {
  val bounds = map.projection.visibleRegion.latLngBounds
  return MapViewBox(bounds.latitudeSouth, bounds.longitudeWest, bounds.latitudeNorth, bounds.longitudeEast, map.cameraPosition.zoom)
}

private fun siteAt(map: MapLibreMap, screen: PointF): String? {
  val slop = 24f
  val box = RectF(screen.x - slop, screen.y - slop, screen.x + slop, screen.y + slop)
  return map.queryRenderedFeatures(box, ARROWS).firstOrNull()?.getStringProperty("id")
}

private fun features(rows: List<SiteRow>): FeatureCollection =
  FeatureCollection.fromFeatures(
    rows.map { row ->
      val g = row.glance
      Feature.fromGeometry(Point.fromLngLat(row.site.lon, row.site.lat)).apply {
        addStringProperty("id", row.site.id)
        addStringProperty("name", row.site.name)
        addStringProperty("icon", g?.tone?.let(::iconName) ?: ICON_NONE)
        addNumberProperty("bearing", g?.arrowBearing ?: 0.0)
        addNumberProperty("opacity", g?.opacity ?: 0.9f)
      }
    }
  )

private const val ICON_NONE = "arrow-none"

private fun iconName(tone: GlanceTone) = "arrow-${tone.name.lowercase()}"

private fun addSiteLayers(context: Context, style: Style, colors: CurrentColors) {
  val density = context.resources.displayMetrics.density
  GlanceTone.entries.forEach { tone -> style.addImage(iconName(tone), arrowBitmap(density, colors.tone(tone).toArgb(), colors.ink.toArgb())) }
  style.addImage(ICON_NONE, dotBitmap(density, colors.foam.toArgb(), colors.ink.toArgb()))
  // The coordinate grid, under the pins: thin white lines and chart-style labels at the view's edges.
  style.addSource(GeoJsonSource(GRID, FeatureCollection.fromFeatures(emptyList())))
  style.addLayer(
    LineLayer(GRID_LINES, GRID)
      .withProperties(lineColor(Color.WHITE), lineOpacity(0.45f), lineWidth(1f))
      .withFilter(eq(geometryType(), literal("LineString")))
  )
  style.addLayer(
    SymbolLayer(GRID_LABELS, GRID)
      .withProperties(
        textField(get("label")),
        textFont(arrayOf(LABEL_FONT)),
        textSize(11f),
        textColor(Color.WHITE),
        textHaloColor(colors.ink.toArgb()),
        textHaloWidth(1.2f),
        textAnchor(get("anchor")),
        textOffset(arrayOf(0.3f, 0f)),
        textAllowOverlap(true),
        textIgnorePlacement(true),
      )
      .withFilter(eq(geometryType(), literal("Point")))
  )
  style.addSource(GeoJsonSource(SOURCE, FeatureCollection.fromFeatures(emptyList())))
  style.addLayer(
    SymbolLayer(ARROWS, SOURCE)
      .withProperties(
        iconImage(get("icon")),
        // Small over the whole chain, where 300 pins share a phone screen; full size inside one atoll.
        iconSize(interpolate(linear(), zoom(), stop(5, 0.4f), stop(8, 0.6f), stop(11, 0.85f), stop(13, 1f))),
        iconRotate(get("bearing")),
        iconOpacity(get("opacity")),
        iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP),
        iconAllowOverlap(true),
        iconIgnorePlacement(true),
      )
  )
  style.addLayer(
    SymbolLayer(NAMES, SOURCE)
      .withProperties(
        textField(get("name")),
        textFont(arrayOf(LABEL_FONT)),
        textSize(12f),
        textColor(colors.foam.toArgb()),
        textHaloColor(colors.ink.toArgb()),
        textHaloWidth(1.5f),
        textAnchor(Property.TEXT_ANCHOR_TOP),
        textOffset(arrayOf(0f, 1.2f)),
        textOptional(true),
      )
      .apply { minZoom = 10.5f }
  )
}

/** An arrow pointing north (the layer rotates it), with a dark edge so it reads on imagery and on the street map. */
private fun arrowBitmap(density: Float, fill: Int, edge: Int): Bitmap {
  val size = (30 * density).toInt()
  val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  val s = size.toFloat()
  val path =
    Path().apply {
      moveTo(s * 0.5f, s * 0.06f)
      lineTo(s * 0.86f, s * 0.6f)
      lineTo(s * 0.6f, s * 0.55f)
      lineTo(s * 0.6f, s * 0.94f)
      lineTo(s * 0.4f, s * 0.94f)
      lineTo(s * 0.4f, s * 0.55f)
      lineTo(s * 0.14f, s * 0.6f)
      close()
    }
  canvas.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fill; style = Paint.Style.FILL })
  canvas.drawPath(
    path,
    Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = edge
      style = Paint.Style.STROKE
      strokeWidth = 1.6f * density
      strokeJoin = Paint.Join.ROUND
    },
  )
  return bitmap
}

/** A site with no forecast this hour: a plain dot, no arrow. */
private fun dotBitmap(density: Float, fill: Int, edge: Int): Bitmap {
  val size = (14 * density).toInt()
  val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
  val canvas = Canvas(bitmap)
  val r = size / 2f
  canvas.drawCircle(r, r, r * 0.8f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = edge })
  canvas.drawCircle(r, r, r * 0.55f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = fill })
  return bitmap
}

private const val SEAMARKS = "seamarks"
private const val GRID = "grid"
private const val GRID_LINES = "grid-lines"
private const val GRID_LABELS = "grid-labels"

/** One raster source and its layer in the style. */
private data class Raster(val id: String, val tiles: String, val attribution: String, val maxZoom: Int, val opacity: Double = 1.0)

private const val OPENSEAMAP = "© <a href=\\\"https://www.openseamap.org/\\\">OpenSeaMap</a> contributors"
private const val DEPTH_WMS = "https://depth.openseamap.org/geoserver/openseamap/wms"

/** A WMS asked for the map's own 256 px tiles, as Leaflet's tileLayer.wms does on the web. */
private fun wms(base: String, layers: String, version: String): String =
  "$base?SERVICE=WMS&REQUEST=GetMap&VERSION=$version&LAYERS=$layers&STYLES=&FORMAT=image/png&TRANSPARENT=true" +
    "&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}"

/**
 * A raster style: the map's dark [background] (all that shows under base "None"), the base, then the web's raster
 * overlays that are on in [overlays], in the web's order (seamarks, depth shading, sonar depths, depth contours), from the same servers as
 * the web map. Each source's attribution shows behind the map's (i) button. The Atlas overlays, the sheltered-water
 * shading and the grid are drawn on top by SiteMapView.
 */
internal fun styleJson(baseMap: BaseMap, overlays: Set<MapOverlay> = emptySet(), background: String = "#07151d"): String {
  val base =
    when (baseMap) {
      BaseMap.Satellite ->
        Raster(
          "base",
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
          18,
        )
      BaseMap.Street ->
        Raster(
          "base",
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          "© <a href=\\\"https://www.openstreetmap.org/copyright\\\">OpenStreetMap</a> contributors",
          19,
        )
      BaseMap.None -> null
    }
  val rasters =
    listOfNotNull(base) +
      RASTER_ORDER.filter { it in overlays }.map { overlay ->
        when (overlay) {
          MapOverlay.Seamarks -> Raster(SEAMARKS, "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", OPENSEAMAP, 18)
          // GEBCO 2021 on a 15 arc-second grid (about 450 m): the shape of the atolls and the deep water, not a pass's sill.
          MapOverlay.DepthShading ->
            Raster(
              overlay.key,
              wms("https://geoserver.openseamap.org/geoserver/gwc/service/wms", "gebco2021:gebco_2021", "1.1.1"),
              "<a href=\\\"https://www.gebco.net/\\\">GEBCO 2021 Grid</a> via OpenSeaMap",
              18,
              opacity = 0.8,
            )
          // Depths logged by boats that share their sonar tracks. Sparse in the Maldives.
          MapOverlay.SonarDepths -> Raster(overlay.key, wms(DEPTH_WMS, "openseamap:tracks_10m", "1.1.0"), OPENSEAMAP, 18)
          MapOverlay.DepthContours -> Raster(overlay.key, wms(DEPTH_WMS, "openseamap:contour2,openseamap:contour", "1.1.0"), OPENSEAMAP, 18)
          else -> error("${overlay.key} is not a raster overlay")
        }
      }
  val sources =
    rasters.joinToString(",\n") {
      """"${it.id}": { "type": "raster", "tiles": ["${it.tiles}"], "tileSize": 256, "maxzoom": ${it.maxZoom}, "attribution": "${it.attribution}" }"""
    }
  val layers =
    listOf("""{ "id": "background", "type": "background", "paint": { "background-color": "$background" } }""") +
      rasters.map {
        val paint = if (it.opacity < 1.0) """, "paint": { "raster-opacity": ${it.opacity} }""" else ""
        """{ "id": "${it.id}", "type": "raster", "source": "${it.id}"$paint }"""
      }
  return """
    {
      "version": 8,
      "glyphs": "${BuildConfig.API_BASE_URL}/map-fonts/{fontstack}/{range}.pbf",
      "sources": { $sources },
      "layers": [${layers.joinToString(", ")}]
    }
  """
    .trimIndent()
}
