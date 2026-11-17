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
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.runtime.key
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import app.fiftybar.divecurrent.domain.SiteOutlook
import app.fiftybar.divecurrent.ui.components.rememberReducedMotion
import app.fiftybar.divecurrent.ui.theme.Eyebrow
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

  val reducedMotion = rememberReducedMotion()
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
      Surface(
        color = colors.deep,
        contentColor = colors.foam,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        border = BorderStroke(1.dp, colors.line),
        modifier = Modifier.fillMaxWidth(),
      ) {
        Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 0.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
            readout == null -> Text("Waiting for GPS…", style = MaterialTheme.typography.titleMedium, color = colors.mist)
            else -> Cockpit(readout, state.routeError, reducedMotion)
          }
          if (granted && !hasPreciseLocation(context)) {
            Text(
              "Only approximate location is allowed, so the boat's position can be off by a kilometre or more. Allow precise location in the app's settings.",
              style = MaterialTheme.typography.bodySmall,
              color = colors.outgoing,
            )
          }
          OutlinedButton(
            onClick = onBack,
            shape = RoundedCornerShape(18.dp),
            border = BorderStroke(1.dp, colors.stop.copy(alpha = 0.6f)),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.stop),
            modifier = Modifier.fillMaxWidth().height(52.dp),
          ) {
            Text("End navigation", style = MaterialTheme.typography.titleMedium)
          }
          Spacer(Modifier.height(4.dp))
        }
      }
    }
  }
}

/**
 * The cockpit: the steer as one huge bearing with its compass word and a dial, then distance to go, speed and arrival
 * in three cells, then any warning as a banner. Readable at arm's length on a moving boat.
 */
@Composable
private fun Cockpit(readout: NavReadout, routeError: String?, reducedMotion: Boolean) {
  val colors = CurrentTheme.colors
  val steer = readout.steerDeg?.let(BoatNav::formatBearing)
  Row(
    verticalAlignment = Alignment.CenterVertically,
    modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = steer?.let { "Steer $it" } ?: "No steer yet" },
  ) {
    Column(Modifier.weight(1f)) {
      Text("STEER", style = Eyebrow, color = colors.incoming)
      Row(verticalAlignment = Alignment.Bottom) {
        // "247° WSW" from the shared formatter: the number rolls, the word sits beside it.
        RollingText(steer?.substringBefore(" ") ?: "—", MaterialTheme.typography.displayMedium, colors.foam, reducedMotion)
        steer?.substringAfter(" ", "")?.takeIf { it.isNotEmpty() }?.let {
          Text(it, style = MaterialTheme.typography.headlineMedium, color = colors.mist, modifier = Modifier.padding(start = 10.dp, bottom = 12.dp))
        }
      }
    }
    SteerDial(readout.steerDeg, reducedMotion)
  }
  Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    Cell(if (readout.byRoute) "TO GO · ROUTE" else "TO GO", readout.remainingKm?.let(BoatNav::formatNm), reducedMotion)
    Cell("SPEED", readout.motion?.let { "${"%.1f".format(Locale.ROOT, it.knots)} kn" }, reducedMotion)
    Cell(
      readout.etaMinutes?.let { "ARRIVE · ${BoatNav.formatDuration(it).uppercase()}" } ?: "ARRIVE",
      readout.arrival
        ?: when {
          readout.stopped -> "Stopped"
          readout.currentBeatsBoat -> "Current"
          else -> null
        },
      reducedMotion,
    )
  }
  val danger =
    listOfNotNull(
      readout.veryStrongLine,
      if (readout.currentBeatsBoat) "At this speed the current ahead is stronger than the boat makes through the water." else null,
    )
  val caution =
    listOfNotNull(
      readout.trouble?.let { trouble ->
        // With no route at all, the server's reason (a start outside the Maldives) says what to do.
        routeError?.takeIf { trouble.startsWith("No route") && it.isNotBlank() }?.let { "$trouble ${it.trimEnd('.')}." } ?: trouble
      },
      if (readout.shallow) "The route crosses a shallow reef-flat gap: check the depth before you go through." else null,
    )
  danger.forEach { Banner(it, colors.stop) }
  caution.forEach { Banner(it, colors.outgoing) }
  readout.referenceLine?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.mist) }
  Text(readout.note, style = MaterialTheme.typography.bodySmall, color = colors.dim)
}

/** Text whose characters each roll up into place when they change, as a mechanical counter; still with motion off. */
@Composable
private fun RollingText(text: String, style: TextStyle, color: Color, reducedMotion: Boolean) {
  Row {
    text.forEachIndexed { i, ch ->
      // Keyed by place from the right, so 99 -> 100 rolls the units, tens and hundreds rather than shifting them.
      key(text.length - i) {
        AnimatedContent(
          targetState = ch,
          transitionSpec = {
            if (reducedMotion) EnterTransition.None togetherWith ExitTransition.None
            else (slideInVertically(tween(220)) { it / 2 } + fadeIn(tween(220))) togetherWith (slideOutVertically(tween(180)) { -it / 2 } + fadeOut(tween(140)))
          },
          label = "digit",
        ) { c ->
          Text(c.toString(), style = style, color = color, maxLines = 1)
        }
      }
    }
  }
}

/** Which way to steer: an arrow on a compass rose (north up) that swings the short way to a new steer. */
@Composable
private fun SteerDial(steer: Double?, reducedMotion: Boolean) {
  val colors = CurrentTheme.colors
  val angle = remember { Animatable((steer ?: 0.0).toFloat()) }
  LaunchedEffect(steer) {
    val to = steer?.toFloat() ?: return@LaunchedEffect
    val target = SiteOutlook.shortTurnTarget(angle.value, to)
    if (reducedMotion) angle.snapTo(target) else angle.animateTo(target, spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessLow))
  }
  Box(
    Modifier.size(96.dp).clip(CircleShape).background(colors.reef).border(1.5.dp, colors.edge, CircleShape),
    contentAlignment = Alignment.Center,
  ) {
    val mark = MaterialTheme.typography.labelSmall
    Text("N", style = mark, color = colors.dim, modifier = Modifier.align(Alignment.TopCenter).padding(top = 4.dp))
    Text("E", style = mark, color = colors.dim, modifier = Modifier.align(Alignment.CenterEnd).padding(end = 6.dp))
    Text("S", style = mark, color = colors.dim, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 4.dp))
    Text("W", style = mark, color = colors.dim, modifier = Modifier.align(Alignment.CenterStart).padding(start = 6.dp))
    if (steer != null) CurrentArrow(bearing = angle.value.toDouble(), color = colors.incoming, size = 56.dp, edge = colors.ink)
  }
}

/** One readout cell: a small label over its value, a dash until it is known; numbers roll as they change. */
@Composable
private fun RowScope.Cell(label: String, value: String?, reducedMotion: Boolean) {
  val colors = CurrentTheme.colors
  Column(
    Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(16.dp)).background(colors.reef).padding(horizontal = 12.dp, vertical = 10.dp)
      .semantics(mergeDescendants = true) {},
  ) {
    Text(label, style = Eyebrow, color = colors.dim, maxLines = 2)
    Spacer(Modifier.height(4.dp))
    RollingText(value ?: "—", MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp), if (value != null) colors.foam else colors.dim, reducedMotion)
  }
}

/** A warning with a bar of its colour down the left: red for the current, amber for the route. */
@Composable
private fun Banner(text: String, tone: Color) {
  Row(
    Modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(14.dp)).background(tone.copy(alpha = 0.12f)),
  ) {
    Box(Modifier.width(4.dp).fillMaxHeight().background(tone))
    Text(text, style = MaterialTheme.typography.bodyMedium, color = CurrentTheme.colors.foam, modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp))
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
