package app.fiftybar.divecurrent.ui.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
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
import app.fiftybar.divecurrent.domain.GlanceTone
import app.fiftybar.divecurrent.ui.theme.CurrentColors
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression.get
import org.maplibre.android.style.expressions.Expression.interpolate
import org.maplibre.android.style.expressions.Expression.linear
import org.maplibre.android.style.expressions.Expression.stop
import org.maplibre.android.style.expressions.Expression.zoom
import org.maplibre.android.style.layers.Property
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
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.Point

enum class BaseMap {
  Satellite,
  Street,
}

private const val SOURCE = "sites"
private const val ARROWS = "site-arrows"
private const val NAMES = "site-names"

/** The middle of the Maldives, wide enough to show the chain. */
private val START = CameraPosition.Builder().target(LatLng(3.6, 73.3)).zoom(6.4).build()

/**
 * The site map: a raster base (Esri imagery or OpenStreetMap, the same sources as the web map) and an arrow per site
 * pointing the way the water runs this hour, coloured and faded like the web pins. Tapping an arrow opens the site.
 */
@Composable
fun SiteMapView(
  rows: List<SiteRow>,
  baseMap: BaseMap,
  colors: CurrentColors,
  onOpenSite: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val context = LocalContext.current
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  val openSite by rememberUpdatedState(onOpenSite)
  val mapView = remember { MapView(context).apply { onCreate(null) } }
  var map by remember { mutableStateOf<MapLibreMap?>(null) }
  var style by remember { mutableStateOf<Style?>(null) }

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
        hit != null
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

  LaunchedEffect(map, baseMap, colors) {
    val m = map ?: return@LaunchedEffect
    style = null
    m.setStyle(Style.Builder().fromJson(styleJson(baseMap))) { loaded ->
      addSiteLayers(context, loaded, colors)
      style = loaded
    }
  }

  LaunchedEffect(style, rows) {
    val s = style ?: return@LaunchedEffect
    s.getSourceAs<GeoJsonSource>(SOURCE)?.setGeoJson(features(rows))
  }

  AndroidView(factory = { mapView }, modifier = modifier)
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
        textFont(arrayOf("Open Sans Semibold")),
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

/** A one-layer raster style. The source's attribution shows behind the map's (i) button. */
private fun styleJson(baseMap: BaseMap): String {
  val (tiles, attribution, maxZoom) =
    when (baseMap) {
      BaseMap.Satellite ->
        Triple(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
          18,
        )
      BaseMap.Street ->
        Triple(
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          "© <a href=\\\"https://www.openstreetmap.org/copyright\\\">OpenStreetMap</a> contributors",
          19,
        )
    }
  return """
    {
      "version": 8,
      "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      "sources": {
        "base": {
          "type": "raster",
          "tiles": ["$tiles"],
          "tileSize": 256,
          "maxzoom": $maxZoom,
          "attribution": "$attribution"
        }
      },
      "layers": [{ "id": "base", "type": "raster", "source": "base" }]
    }
  """
    .trimIndent()
}
