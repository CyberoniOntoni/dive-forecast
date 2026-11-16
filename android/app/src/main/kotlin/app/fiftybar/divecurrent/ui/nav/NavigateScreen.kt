package app.fiftybar.divecurrent.ui.nav

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.domain.BoatNav
import app.fiftybar.divecurrent.domain.Fix
import app.fiftybar.divecurrent.domain.LatLon
import app.fiftybar.divecurrent.domain.NavReadout
import app.fiftybar.divecurrent.domain.NavReadouts
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.components.CurrentArrow
import app.fiftybar.divecurrent.ui.map.BaseMap
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import java.util.Locale

private val LOCATION_PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

fun hasLocationPermission(context: Context): Boolean =
  LOCATION_PERMISSIONS.any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

/** Precise location allowed, not only approximate (which Android 12 and later let a diver pick). */
fun hasPreciseLocation(context: Context): Boolean =
  ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

/**
 * Boat navigation to a site or a point, as the web's Navigate panel: follows the phone's GPS while the screen is open
 * (and keeps the screen on), asks the server for a route round the known reef, and shows distance left, speed, the
 * steer allowing for the current, and the ETA. Satellite outlines, not a chart: the panel says so.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NavigateScreen(destinationId: String, name: String, lat: Double, lon: Double, onBack: () -> Unit) {
  val repository = appRepository()
  val viewModel: NavigateViewModel = viewModel(key = "navigate/$destinationId") { NavigateViewModel(destinationId, repository) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  val context = LocalContext.current
  val target = remember(lat, lon) { LatLon(lat, lon) }
  var baseMap by rememberSaveable { mutableStateOf(BaseMap.Satellite) }
  var granted by remember { mutableStateOf(hasLocationPermission(context)) }
  var asked by rememberSaveable { mutableStateOf(false) }
  // Refused with "don't ask again": Android shows no dialog any more, so the button opens the app's settings instead.
  var blocked by rememberSaveable { mutableStateOf(false) }
  val launcher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
      granted = result.values.any { it } || hasLocationPermission(context)
      blocked = !granted && context.findActivity()?.let { activity -> LOCATION_PERMISSIONS.none { activity.shouldShowRequestPermissionRationale(it) } } == true
    }
  // Back from the settings screen with location allowed.
  LifecycleResumeEffect(Unit) {
    granted = hasLocationPermission(context)
    onPauseOrDispose {}
  }
  LaunchedEffect(Unit) {
    if (!granted && !asked) {
      asked = true
      launcher.launch(LOCATION_PERMISSIONS)
    }
  }
  if (granted) FollowGps(context, viewModel)
  KeepScreenOn()

  val readout = remember(state, target) { NavReadouts.of(target, state.fixes, state.route, state.routeFailed, System.currentTimeMillis()) }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Stop navigating") } },
        actions = {
          if (state.fixes.isNotEmpty()) {
            IconButton(onClick = viewModel::frame) { Icon(Icons.Filled.LocationOn, "Show the whole route") }
          }
          TextButton(onClick = { baseMap = if (baseMap == BaseMap.Satellite) BaseMap.Street else BaseMap.Satellite }) {
            Text(if (baseMap == BaseMap.Satellite) "Street" else "Satellite")
          }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    Column(Modifier.fillMaxSize().padding(padding)) {
      NavMapView(
        target = target,
        boat = state.fixes.lastOrNull(),
        route = state.route,
        frame = state.frame,
        baseMap = baseMap,
        colors = colors,
        modifier = Modifier.weight(1f).fillMaxWidth(),
      )
      Surface(color = colors.glass, contentColor = colors.foam, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          val gps = state.gps
          when {
            !granted ->
              Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Navigation needs the phone's location. Allow it to follow the boat.", color = colors.stop)
                OutlinedButton(
                  onClick = {
                    if (blocked) {
                      context.startActivity(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                      )
                    } else {
                      launcher.launch(LOCATION_PERMISSIONS)
                    }
                  },
                  modifier = Modifier.heightIn(min = 44.dp),
                ) {
                  Text(if (blocked) "Open the app's settings" else "Allow location")
                }
              }
            gps is GpsStatus.Error -> Text(gps.message, color = colors.stop)
            readout == null -> Text("Waiting for GPS…", color = colors.foam.copy(alpha = 0.8f))
            else -> Readouts(readout, state.routeError)
          }
          if (granted && !hasPreciseLocation(context)) {
            Text(
              "Only approximate location is allowed, so the boat's position can be off by a kilometre or more. Allow precise location in the app's settings.",
              style = MaterialTheme.typography.bodySmall,
              color = colors.outgoing,
            )
          }
        }
      }
    }
  }
}

@Composable
private fun Readouts(readout: NavReadout, routeError: String?) {
  val colors = CurrentTheme.colors
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    SteerDial(readout.steerDeg)
    Stat(if (readout.byRoute) "To go, by route" else "To go", readout.remainingKm?.let(BoatNav::formatNm), big = true)
    Stat("Speed", readout.motion?.let { "${"%.1f".format(Locale.ROOT, it.knots)} kn" })
    Stat(
      readout.etaMinutes?.let { "In ${BoatNav.formatDuration(it)}" } ?: "Arrive",
      readout.arrival
        ?: when {
          readout.stopped -> "Stopped"
          readout.currentBeatsBoat -> "Current"
          else -> null
        },
    )
  }
  readout.referenceLine?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.8f)) }
  Text(readout.note, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.7f))
  val warnings =
    listOfNotNull(
      readout.trouble?.let { trouble ->
        // With no route at all, the server's reason (a start outside the Maldives) says what to do.
        routeError?.takeIf { trouble.startsWith("No route") && it.isNotBlank() }?.let { "$trouble ${it.trimEnd('.')}." } ?: trouble
      },
      if (readout.currentBeatsBoat) "At this speed the current ahead is stronger than the boat makes through the water." else null,
      readout.veryStrongLine,
      if (readout.shallow) "The route crosses a shallow reef-flat gap: check the depth before you go through." else null,
    )
  warnings.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.outgoing) }
}

/** Which way to steer, as an arrow on a small compass rose (north up). */
@Composable
private fun SteerDial(steer: Double?) {
  val colors = CurrentTheme.colors
  Surface(
    shape = CircleShape,
    color = colors.foam.copy(alpha = 0.06f),
    modifier =
      Modifier.size(56.dp).semantics { contentDescription = steer?.let { "Steer ${BoatNav.formatBearing(it)}" } ?: "No steer yet" },
  ) {
    Box(contentAlignment = Alignment.Center) {
      Text("N", fontSize = 9.sp, color = colors.foam.copy(alpha = 0.6f), modifier = Modifier.align(Alignment.TopCenter).padding(top = 1.dp))
      if (steer != null) CurrentArrow(bearing = steer, color = colors.incoming, size = 34.dp)
    }
  }
}

/** One readout; a dash until it is known. The distance is the big one. */
@Composable
private fun RowScope.Stat(label: String, value: String?, big: Boolean = false) {
  val colors = CurrentTheme.colors
  Column(Modifier.weight(if (big) 1.4f else 1f)) {
    Text(label, style = MaterialTheme.typography.labelSmall, color = colors.foam.copy(alpha = 0.6f), maxLines = 1, overflow = TextOverflow.Ellipsis)
    Text(
      value ?: "—",
      fontSize = if (big) 24.sp else 18.sp,
      fontWeight = FontWeight.SemiBold,
      color = if (value != null) colors.foam else colors.foam.copy(alpha = 0.4f),
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/** Keeps the screen on while navigating. */
@Composable
private fun KeepScreenOn() {
  val view = LocalView.current
  DisposableEffect(view) {
    view.keepScreenOn = true
    onDispose { view.keepScreenOn = false }
  }
}

/**
 * GPS fixes while the screen is started, from the phone's GPS (or its network location when GPS is off), every second.
 * The platform LocationManager, so the app needs no Google Play services.
 */
@SuppressLint("MissingPermission")
@Composable
private fun FollowGps(context: Context, viewModel: NavigateViewModel) {
  LifecycleStartEffect(viewModel) {
    val manager = context.getSystemService(LocationManager::class.java)
    val provider =
      when {
        manager == null -> null
        // GPS needs precise location; with only approximate allowed it would throw, so use the network's.
        hasPreciseLocation(context) && manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
        manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        else -> null
      }
    // Every method overridden: before Android 11 they had no default, and a lambda would crash when one is called.
    val listener =
      object : LocationListener {
        override fun onLocationChanged(location: Location) = viewModel.onFix(location.toFix())

        override fun onProviderDisabled(provider: String) =
          viewModel.onGpsError("Location is off. Turn it on in the phone's settings to follow the boat.")

        override fun onProviderEnabled(provider: String) {}

        @Deprecated("Called only before Android 10")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
      }
    if (manager == null || provider == null) {
      viewModel.onGpsError("Location is off. Turn it on in the phone's settings to follow the boat.")
    } else {
      try {
        manager.getLastKnownLocation(provider)?.takeIf { System.currentTimeMillis() - it.time < 60_000 }?.let { viewModel.onFix(it.toFix()) }
        manager.requestLocationUpdates(provider, 1_000L, 0f, listener, Looper.getMainLooper())
      } catch (_: SecurityException) {
        viewModel.onGpsError("Location is blocked for this app. Allow it in the phone's settings, then try again.")
      }
    }
    onStopOrDispose { manager?.removeUpdates(listener) }
  }
}

private tailrec fun Context.findActivity(): Activity? =
  when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
  }

private fun Location.toFix(): Fix =
  Fix(
    lat = latitude,
    lon = longitude,
    timeMs = time,
    accuracyM = if (hasAccuracy()) accuracy.toDouble() else 50.0,
    speedMs = if (hasSpeed()) speed.toDouble() else null,
    headingDeg = if (hasBearing()) bearing.toDouble() else null,
  )
