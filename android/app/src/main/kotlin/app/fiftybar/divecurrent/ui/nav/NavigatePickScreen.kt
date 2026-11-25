package app.fiftybar.divecurrent.ui.nav

import app.fiftybar.divecurrent.ui.components.RouteLimitation
import android.annotation.SuppressLint
import android.content.Context
import android.location.LocationManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiSites
import app.fiftybar.divecurrent.domain.BoatNav
import app.fiftybar.divecurrent.domain.Destination
import app.fiftybar.divecurrent.domain.Destinations
import app.fiftybar.divecurrent.domain.LatLon
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PickState(val sites: List<Destination> = emptyList(), val loading: Boolean = true, val error: String? = null)

/** Every site as a destination: the phone's copy at once, then the server's. */
class NavigatePickViewModel(private val repository: DataRepository) : ViewModel() {
  private val _state = MutableStateFlow(PickState())
  val state: StateFlow<PickState> = _state.asStateFlow()

  init {
    viewModelScope.launch {
      repository.cachedSites()?.let { cached -> _state.update { it.copy(sites = destinations(cached.value)) } }
      try {
        val fresh = repository.sites()
        _state.update { it.copy(sites = destinations(fresh.value), loading = false, error = fresh.offlineError?.message) }
      } catch (e: ApiException) {
        _state.update { it.copy(loading = false, error = e.message) }
      }
    }
  }

  private fun destinations(body: ApiSites): List<Destination> =
    body.sites.map { Destination(it.id, it.name, it.atollName, it.lat, it.lon, null) }
}

/** The phone's last position from any provider, for sorting the list nearest first; null without one. */
@SuppressLint("MissingPermission")
private fun lastPosition(context: Context): LatLon? {
  if (!hasLocationPermission(context)) return null
  val manager = context.getSystemService(LocationManager::class.java) ?: return null
  return try {
    manager
      .getProviders(true)
      // With only approximate location allowed, the GPS provider throws: skip it and keep the others.
      .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
      .maxByOrNull { it.time }
      ?.let { LatLon(it.latitude, it.longitude) }
  } catch (_: SecurityException) {
    null
  }
}

/**
 * Where to take the boat: every site by name or atoll, nearest first when the phone knows where it is, as the web's
 * Navigate tab. A point on the map is picked with a long press on the map instead.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NavigatePickScreen(onBack: (() -> Unit)?, onPick: (Destination) -> Unit) {
  val repository = appRepository()
  val viewModel: NavigatePickViewModel = viewModel { NavigatePickViewModel(repository) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  val context = LocalContext.current
  var query by rememberSaveable { mutableStateOf("") }
  var from by remember { mutableStateOf(lastPosition(context)) }
  var asked by rememberSaveable { mutableStateOf(false) }
  val launcher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { from = lastPosition(context) }
  // Navigating needs the location anyway: ask here, where it also sorts the list.
  LaunchedEffect(Unit) {
    if (!hasLocationPermission(context) && !asked) {
      asked = true
      launcher.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION))
    }
  }
  val (shown, total) = remember(state.sites, query, from) { Destinations.list(state.sites, query, from) }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text("Boat route") },
        actions = { RouteLimitation(Modifier.padding(end = 12.dp)) },
        navigationIcon = { onBack?.let { back -> IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to the map") } } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
      if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
      OutlinedTextField(
        value = query,
        onValueChange = { query = it },
        singleLine = true,
        placeholder = { Text("Find a site or atoll") },
        trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Clear, "Clear") } },
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
      )
      Text(
        buildString {
          append(if (from != null) "Nearest first" else "By name")
          if (total > shown.size) append(" · ${shown.size} of $total, search for more")
          append(". Or long-press the map to head for a point.")
        },
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.7f),
        modifier = Modifier.padding(horizontal = 16.dp),
      )
      state.error?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = colors.stop, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
      }
      LazyColumn(Modifier.fillMaxWidth().weight(1f)) {
        items(shown, key = { it.id }) { site ->
          Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable { onPick(site) }.padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Column(Modifier.weight(1f)) {
              Text(site.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
              site.atoll?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.7f), maxLines = 1) }
            }
            site.km?.let { Text(BoatNav.formatNm(it), style = MaterialTheme.typography.bodyMedium, color = colors.foam.copy(alpha = 0.8f)) }
          }
          HorizontalDivider(color = colors.foam.copy(alpha = 0.08f))
        }
      }
    }
  }
}
