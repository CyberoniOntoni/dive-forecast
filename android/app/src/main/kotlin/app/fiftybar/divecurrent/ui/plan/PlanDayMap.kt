package app.fiftybar.divecurrent.ui.plan

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.fiftybar.divecurrent.data.api.ApiPlanLeg
import app.fiftybar.divecurrent.data.api.ApiPlanStop
import app.fiftybar.divecurrent.ui.map.BaseMap
import app.fiftybar.divecurrent.ui.map.LABEL_FONT
import app.fiftybar.divecurrent.ui.map.styleJson
import app.fiftybar.divecurrent.ui.theme.CurrentColors
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression.eq
import org.maplibre.android.style.expressions.Expression.get
import org.maplibre.android.style.expressions.Expression.literal
import org.maplibre.android.style.expressions.Expression.toColor
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.circleColor
import org.maplibre.android.style.layers.PropertyFactory.circleRadius
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeColor
import org.maplibre.android.style.layers.PropertyFactory.circleStrokeWidth
import org.maplibre.android.style.layers.PropertyFactory.lineCap
import org.maplibre.android.style.layers.PropertyFactory.lineColor
import org.maplibre.android.style.layers.PropertyFactory.lineDasharray
import org.maplibre.android.style.layers.PropertyFactory.lineJoin
import org.maplibre.android.style.layers.PropertyFactory.lineOpacity
import org.maplibre.android.style.layers.PropertyFactory.lineWidth
import org.maplibre.android.style.layers.PropertyFactory.textAllowOverlap
import org.maplibre.android.style.layers.PropertyFactory.textColor
import org.maplibre.android.style.layers.PropertyFactory.textField
import org.maplibre.android.style.layers.PropertyFactory.textFont
import org.maplibre.android.style.layers.PropertyFactory.textIgnorePlacement
import org.maplibre.android.style.layers.PropertyFactory.textSize
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

private const val LEGS = "legs"
private const val STOPS = "stops"

/**
 * One plan day on a small satellite map, as the web plan page's (components/PlanMap.tsx): the dives numbered in order,
 * coloured as their markers there (warned red, incoming teal, outgoing amber, else plain), and the boat route between
 * them, dashed where no way round the reef was found. It sits in a scrolling list, so it holds still: the list scrolls
 * over it, and the site page has the full map.
 */
@Composable
fun PlanDayMap(stops: List<ApiPlanStop>, legs: List<ApiPlanLeg>, colors: CurrentColors, modifier: Modifier = Modifier) {
  val context = LocalContext.current
  val lifecycle = LocalLifecycleOwner.current.lifecycle
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
      stops.firstOrNull()?.let { m.cameraPosition = CameraPosition.Builder().target(LatLng(it.lat, it.lon)).zoom(12.0).build() }
      m.uiSettings.setAllGesturesEnabled(false)
      m.uiSettings.isCompassEnabled = false
      m.uiSettings.isLogoEnabled = false
      map = m
    }
    onDispose {
      lifecycle.removeObserver(observer)
      mapView.onPause()
      mapView.onStop()
      mapView.onDestroy()
    }
  }

  LaunchedEffect(map, colors) {
    val m = map ?: return@LaunchedEffect
    style = null
    m.setStyle(Style.Builder().fromJson(styleJson(BaseMap.Satellite))) { loaded ->
      addDayLayers(loaded, colors)
      style = loaded
    }
  }

  LaunchedEffect(style, stops, legs, colors) {
    val s = style ?: return@LaunchedEffect
    val m = map ?: return@LaunchedEffect
    s.getSourceAs<GeoJsonSource>(LEGS)?.setGeoJson(
      FeatureCollection.fromFeatures(
        legs.mapNotNull { leg ->
          val points = leg.points.filter { it.size >= 2 }.map { Point.fromLngLat(it[1], it[0]) }
          if (points.size < 2) null
          else Feature.fromGeometry(LineString.fromLngLats(points)).apply { addBooleanProperty("routed", leg.routed) }
        }
      )
    )
    s.getSourceAs<GeoJsonSource>(STOPS)?.setGeoJson(
      FeatureCollection.fromFeatures(
        stops.mapIndexed { at, stop ->
          Feature.fromGeometry(Point.fromLngLat(stop.lon, stop.lat)).apply {
            addStringProperty("number", "${at + 1}")
            addStringProperty("color", String.format("#%06x", stopColor(stop, colors) and 0xFFFFFF))
          }
        }
      )
    )
    // The web's fit: every dive and the whole route, a little in from the edges, never closer than zoom 14.
    val lats = stops.map { it.lat } + legs.flatMap { leg -> leg.points.mapNotNull { it.getOrNull(0) } }
    val lons = stops.map { it.lon } + legs.flatMap { leg -> leg.points.mapNotNull { it.getOrNull(1) } }
    if (lats.isEmpty()) return@LaunchedEffect
    mapView.post {
      if (lats.max() - lats.min() < 1e-4 && lons.max() - lons.min() < 1e-4) {
        m.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(lats.first(), lons.first()), 12.0))
      } else {
        val pad = (28 * context.resources.displayMetrics.density).toInt()
        m.moveCamera(CameraUpdateFactory.newLatLngBounds(LatLngBounds.from(lats.max(), lons.max(), lats.min(), lons.min()), pad))
        if (m.cameraPosition.zoom > 14.0) m.moveCamera(CameraUpdateFactory.zoomTo(14.0))
      }
    }
  }

  val spoken = stops.mapIndexed { at, stop -> "${at + 1}. ${stop.name}" }.joinToString(", ")
  AndroidView(factory = { mapView }, modifier = modifier.semantics { contentDescription = "Map of the day's dives: $spoken" })
}

/** The web plan page's marker colours (lib/plan-words.ts stopTone, sent as `tone`). */
private fun stopColor(stop: ApiPlanStop, colors: CurrentColors): Int =
  when (stop.tone) {
    "stop" -> colors.stop
    "incoming" -> colors.incoming
    "outgoing" -> colors.outgoing
    else -> colors.foam
  }.toArgb()

private fun addDayLayers(style: Style, colors: CurrentColors) {
  val empty = FeatureCollection.fromFeatures(emptyList())
  style.addSource(GeoJsonSource(LEGS, empty))
  style.addSource(GeoJsonSource(STOPS, empty))
  val ink = colors.ink.toArgb()
  style.addLayer(
    LineLayer("$LEGS-edge", LEGS)
      .withProperties(lineColor(ink), lineWidth(6f), lineOpacity(0.55f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND))
  )
  style.addLayer(
    LineLayer(LEGS, LEGS)
      .withProperties(lineColor(android.graphics.Color.WHITE), lineWidth(3f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND))
      .withFilter(eq(get("routed"), literal(true)))
  )
  style.addLayer(
    LineLayer("$LEGS-straight", LEGS)
      .withProperties(lineColor(android.graphics.Color.WHITE), lineWidth(3f), lineDasharray(arrayOf(2.5f, 2.5f)))
      .withFilter(eq(get("routed"), literal(false)))
  )
  style.addLayer(
    CircleLayer(STOPS, STOPS)
      .withProperties(circleRadius(13f), circleColor(toColor(get("color"))), circleStrokeColor(ink), circleStrokeWidth(2f))
  )
  style.addLayer(
    SymbolLayer("$STOPS-numbers", STOPS)
      .withProperties(
        textField(get("number")),
        textFont(arrayOf(LABEL_FONT)),
        textSize(13f),
        textColor(ink),
        textAllowOverlap(true),
        textIgnorePlacement(true),
      )
  )
}
