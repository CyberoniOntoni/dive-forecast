package app.fiftybar.divecurrent.ui.nav

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
import app.fiftybar.divecurrent.data.api.ApiBoatRoute
import app.fiftybar.divecurrent.domain.Fix
import app.fiftybar.divecurrent.domain.LatLon
import app.fiftybar.divecurrent.domain.NavReadouts
import app.fiftybar.divecurrent.ui.map.BaseMap
import app.fiftybar.divecurrent.ui.map.styleJson
import app.fiftybar.divecurrent.ui.theme.CurrentColors
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression.get
import org.maplibre.android.style.expressions.Expression.match
import org.maplibre.android.style.expressions.Expression.stop
import org.maplibre.android.style.expressions.Expression.color
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
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

private const val ROUTE = "nav-route"
private const val STRAIGHT = "nav-straight"
private const val GAPS = "nav-gaps"
private const val TARGET = "nav-target"
private const val BOAT = "nav-boat"

/**
 * The map while navigating: the base map, the route round the reef (a dashed straight line to the destination until
 * a route comes, or when none was found), the reef gaps it goes through (amber where shallow), the destination and
 * the boat. [frame] bumps fit the boat and the route on screen.
 */
@Composable
fun NavMapView(
  target: LatLon,
  boat: Fix?,
  route: ApiBoatRoute?,
  frame: Int,
  baseMap: BaseMap,
  colors: CurrentColors,
  modifier: Modifier = Modifier,
) {
  val context = LocalContext.current
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  val mapView = remember { MapView(context).apply { onCreate(null) } }
  var map by remember { mutableStateOf<MapLibreMap?>(null) }
  var style by remember { mutableStateOf<Style?>(null) }
  val currentBoat by rememberUpdatedState(boat)
  val currentRoute by rememberUpdatedState(route)

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
      m.cameraPosition = CameraPosition.Builder().target(LatLng(target.lat, target.lon)).zoom(12.0).build()
      m.uiSettings.isRotateGesturesEnabled = false
      m.uiSettings.isTiltGesturesEnabled = false
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
      addNavLayers(loaded, colors)
      style = loaded
    }
  }

  LaunchedEffect(style, target, boat, route) {
    val s = style ?: return@LaunchedEffect
    val points = route?.let(NavReadouts::points).orEmpty()
    s.getSourceAs<GeoJsonSource>(ROUTE)?.setGeoJson(line(if (route?.routed == true) points else emptyList()))
    // Straight to the destination while there is no route, or none round the reef was found.
    val straight = if (route?.routed == true || boat == null) emptyList() else listOf(boat.point, target)
    s.getSourceAs<GeoJsonSource>(STRAIGHT)?.setGeoJson(line(straight))
    s.getSourceAs<GeoJsonSource>(GAPS)?.setGeoJson(
      FeatureCollection.fromFeatures(
        route?.gaps.orEmpty().map { gap ->
          Feature.fromGeometry(Point.fromLngLat(gap.lon, gap.lat)).apply { addBooleanProperty("shallow", gap.shallow) }
        }
      )
    )
    s.getSourceAs<GeoJsonSource>(TARGET)?.setGeoJson(Feature.fromGeometry(Point.fromLngLat(target.lon, target.lat)))
    s.getSourceAs<GeoJsonSource>(BOAT)?.setGeoJson(
      FeatureCollection.fromFeatures(listOfNotNull(boat?.let { Feature.fromGeometry(Point.fromLngLat(it.lon, it.lat)) }))
    )
  }

  LaunchedEffect(map, frame) {
    val m = map ?: return@LaunchedEffect
    if (frame == 0) return@LaunchedEffect
    val points = listOfNotNull(currentBoat?.point, target) + currentRoute?.let(NavReadouts::points).orEmpty()
    val lats = points.map { it.lat }
    val lons = points.map { it.lon }
    val pad = (64 * context.resources.displayMetrics.density).toInt()
    if (lats.max() - lats.min() < 1e-4 && lons.max() - lons.min() < 1e-4) {
      m.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(target.lat, target.lon), 14.0))
    } else {
      val bounds = LatLngBounds.from(lats.max(), lons.max(), lats.min(), lons.min())
      m.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, pad))
    }
  }

  AndroidView(factory = { mapView }, modifier = modifier)
}

private fun line(points: List<LatLon>): FeatureCollection =
  FeatureCollection.fromFeatures(
    if (points.size < 2) emptyList()
    else listOf(Feature.fromGeometry(LineString.fromLngLats(points.map { Point.fromLngLat(it.lon, it.lat) })))
  )

private fun addNavLayers(style: Style, colors: CurrentColors) {
  val empty = FeatureCollection.fromFeatures(emptyList())
  listOf(ROUTE, STRAIGHT, GAPS, TARGET, BOAT).forEach { style.addSource(GeoJsonSource(it, empty)) }
  val ink = colors.ink.toArgb()
  style.addLayer(
    LineLayer("$ROUTE-edge", ROUTE)
      .withProperties(lineColor(ink), lineWidth(7f), lineOpacity(0.7f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND))
  )
  style.addLayer(
    LineLayer(ROUTE, ROUTE)
      .withProperties(lineColor(colors.incoming.toArgb()), lineWidth(4f), lineCap(Property.LINE_CAP_ROUND), lineJoin(Property.LINE_JOIN_ROUND))
  )
  style.addLayer(
    LineLayer(STRAIGHT, STRAIGHT)
      .withProperties(lineColor(colors.foam.toArgb()), lineWidth(3f), lineOpacity(0.8f), lineDasharray(arrayOf(2f, 2f)))
  )
  style.addLayer(
    CircleLayer(GAPS, GAPS)
      .withProperties(
        circleRadius(5f),
        circleColor(match(get("shallow"), color(colors.foam.toArgb()), stop(true, color(colors.outgoing.toArgb())))),
        circleStrokeColor(ink),
        circleStrokeWidth(1.5f),
      )
  )
  style.addLayer(
    CircleLayer(TARGET, TARGET)
      .withProperties(circleRadius(9f), circleColor(colors.outgoing.toArgb()), circleStrokeColor(ink), circleStrokeWidth(2.5f))
  )
  style.addLayer(
    CircleLayer(BOAT, BOAT)
      .withProperties(circleRadius(8f), circleColor(colors.foam.toArgb()), circleStrokeColor(colors.incoming.toArgb()), circleStrokeWidth(3.5f))
  )
}
