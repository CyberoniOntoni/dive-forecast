package app.fiftybar.divecurrent.ui.map

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.domain.LatLon
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.NewSite
import app.fiftybar.divecurrent.domain.PointDestination
import app.fiftybar.divecurrent.domain.ageLabel
import app.fiftybar.divecurrent.domain.confidenceLabel
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.components.CurrentArrow
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapScreen(
  onOpenSite: (String) -> Unit,
  onAccount: (signedIn: Boolean) -> Unit,
  onPlans: () -> Unit,
  onNavigate: () -> Unit,
  onNavigateTo: (id: String, name: String, lat: Double, lon: Double) -> Unit,
  onAddSite: (lat: Double, lon: Double) -> Unit,
) {
  val repository = appRepository()
  val session by appAccount().sessions.session.collectAsStateWithLifecycle()
  val viewModel: MapViewModel = viewModel { MapViewModel(repository) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val shelter: ShelterViewModel = viewModel { ShelterViewModel(repository) }
  val shelterState by shelter.state.collectAsStateWithLifecycle()
  val context = LocalContext.current
  var layers by remember { mutableStateOf(MapLayersPrefs.read(context)) }
  fun choose(next: MapLayers) {
    layers = next
    MapLayersPrefs.write(context, next)
  }
  LaunchedEffect(layers.shelter) { shelter.setOn(layers.shelter) }
  var layersOpen by remember { mutableStateOf(false) }
  var query by rememberSaveable { mutableStateOf("") }
  val scaffold = rememberBottomSheetScaffoldState()
  val scope = rememberCoroutineScope()
  val colors = CurrentTheme.colors
  // A point long-pressed on the map, waiting for "Navigate here" or "Add a dive site here".
  var pressed by remember { mutableStateOf<LatLon?>(null) }
  // "Add a dive site" asked from the list: says where the pin goes.
  var addHint by remember { mutableStateOf(false) }
  LifecycleResumeEffect(viewModel) {
    viewModel.refreshIfHourPassed()
    onPauseOrDispose {}
  }

  val shown =
    remember(state.rows, query) {
      val q = query.trim().lowercase()
      if (q.isEmpty()) state.rows
      else state.rows.filter { it.site.name.lowercase().contains(q) || it.site.atollName?.lowercase()?.contains(q) == true }
    }

  BottomSheetScaffold(
    scaffoldState = scaffold,
    sheetPeekHeight = 132.dp,
    sheetContainerColor = colors.glass,
    sheetContentColor = colors.foam,
    sheetContent = {
      NowList(
        state = state,
        rows = shown,
        query = query,
        onQuery = { query = it },
        // The keyboard would cover a sheet left at its peek height, field and results with it.
        onSearchFocus = { scope.launch { scaffold.bottomSheetState.expand() } },
        onOpenSite = onOpenSite,
        onRefresh = viewModel::refresh,
        onPlans = onPlans,
        onNavigate = onNavigate,
        onAddSite = { addHint = true },
      )
    },
  ) { padding ->
    Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
      SiteMapView(
        rows = shown,
        layers = layers,
        colors = colors,
        onOpenSite = onOpenSite,
        modifier = Modifier.fillMaxSize(),
        // Only where a route can go: far outside the Maldives the server would refuse it.
        onLongPress = { lat, lon -> LatLon(lat, lon).takeIf(PointDestination::inRouteArea)?.let { pressed = it } },
        shelterImages = if (layers.shelter) shelterState.images else emptyList(),
        shelterOpacity = shelterState.scale?.opacity?.toFloat() ?: 0.85f,
        onView = shelter::onView,
        onTap = shelter::tap,
      )
      // Who is signed in, or a way to sign in: reports need it.
      AssistChip(
        onClick = { onAccount(session != null) },
        label = { Text(session?.nickname ?: "Sign in", maxLines = 1) },
        leadingIcon = { Icon(Icons.Filled.AccountCircle, contentDescription = null) },
        colors = AssistChipDefaults.assistChipColors(containerColor = colors.glass, labelColor = colors.foam, leadingIconContentColor = colors.foam),
        modifier =
          Modifier.align(Alignment.TopStart).statusBarsPadding().padding(12.dp).heightIn(min = 44.dp).semantics {
            contentDescription = session?.let { "Signed in as ${it.nickname}. Account" } ?: "Sign in"
          },
      )
      Column(
        Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(12.dp).widthIn(max = 300.dp),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        Box {
          AssistChip(
            onClick = { layersOpen = true },
            label = { Text("Layers") },
            colors = AssistChipDefaults.assistChipColors(containerColor = colors.glass, labelColor = colors.foam),
            modifier = Modifier.heightIn(min = 44.dp).semantics { contentDescription = "Map layers" },
          )
          LayersMenu(expanded = layersOpen, layers = layers, onChoose = ::choose, onDismiss = { layersOpen = false })
        }
        if (layers.shelter) {
          ShelterLegend(
            state = shelterState,
            onStep = shelter::step,
            onNow = shelter::backToNow,
            onCloseReadout = shelter::closeReadout,
            modifier = Modifier.fillMaxWidth(),
          )
        }
      }
    }
  }
  if (addHint) {
    AlertDialog(
      onDismissRequest = { addHint = false },
      title = { Text("Add a dive site") },
      text = { Text("Long-press the map on the site's spot to put its pin there, then pick Add a dive site here.") },
      confirmButton = {
        TextButton(
          onClick = {
            addHint = false
            scope.launch { scaffold.bottomSheetState.partialExpand() }
          }
        ) {
          Text("OK")
        }
      },
    )
  }
  pressed?.let { point ->
    val name = PointDestination.name(point)
    AlertDialog(
      onDismissRequest = { pressed = null },
      title = { Text(name) },
      text = {
        Text(
          "Navigate there by boat, round the islands and reef the app knows of" +
            if (NewSite.inBounds(point.lat, point.lon)) ", or add a dive site at this spot." else "."
        )
      },
      confirmButton = {
        Column(horizontalAlignment = Alignment.End) {
          TextButton(
            onClick = {
              pressed = null
              onNavigateTo(PointDestination.id(point), name, point.lat, point.lon)
            }
          ) {
            Text("Navigate here")
          }
          // Only where the server takes a new pin: the Maldives box, a little smaller than the boat routes'.
          if (NewSite.inBounds(point.lat, point.lon)) {
            TextButton(
              onClick = {
                pressed = null
                onAddSite(point.lat, point.lon)
              }
            ) {
              Text("Add a dive site here")
            }
          }
          TextButton(onClick = { pressed = null }) { Text("Cancel") }
        }
      },
    )
  }
}

/** One base and the overlays, as the web map's layer menu; the choice is kept between launches. */
@Composable
private fun LayersMenu(expanded: Boolean, layers: MapLayers, onChoose: (MapLayers) -> Unit, onDismiss: () -> Unit) {
  DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
    Text("Base map", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
    for ((base, label) in listOf(BaseMap.Satellite to "Satellite", BaseMap.Street to "Street map")) {
      DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { RadioButton(selected = layers.base == base, onClick = null) },
        onClick = { onChoose(layers.copy(base = base)) },
      )
    }
    HorizontalDivider()
    Text("Overlays", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
    DropdownMenuItem(
      text = { Text("Seamarks") },
      leadingIcon = { Checkbox(checked = layers.seamarks, onCheckedChange = null) },
      onClick = { onChoose(layers.copy(seamarks = !layers.seamarks)) },
    )
    DropdownMenuItem(
      text = { Text("Sheltered water") },
      leadingIcon = { Checkbox(checked = layers.shelter, onCheckedChange = null) },
      onClick = {
        onChoose(layers.copy(shelter = !layers.shelter))
        onDismiss()
      },
    )
  }
}

@Composable
private fun NowList(
  state: MapUiState,
  rows: List<SiteRow>,
  query: String,
  onQuery: (String) -> Unit,
  onSearchFocus: () -> Unit,
  onOpenSite: (String) -> Unit,
  onRefresh: () -> Unit,
  onPlans: () -> Unit,
  onNavigate: () -> Unit,
  onAddSite: () -> Unit,
) {
  val colors = CurrentTheme.colors
  val focus = LocalFocusManager.current
  // imePadding lifts the sheet's content above the keyboard, so a short list of matches is not hidden behind it.
  Column(Modifier.fillMaxWidth().imePadding()) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(
          text =
            when {
              state.outdatedWall != null -> "No current hour offline"
              state.maldivesWall != null -> "Now · ${MaldivesTime.label(state.maldivesWall)} Maldives"
              else -> "Now"
            },
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
        )
        val status =
          buildList {
            add(if (rows.size == state.rows.size) "${rows.size} sites" else "${rows.size} of ${state.rows.size} sites")
            state.savedAt?.let { add("updated ${ageLabel(it)}") }
            if (state.fromCache && state.error != null) add("offline copy")
          }
        Text(status.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.75f))
      }
      IconButton(onClick = onAddSite, modifier = Modifier.size(48.dp)) {
        Icon(Icons.Filled.Add, contentDescription = "Add a dive site")
      }
      IconButton(onClick = onNavigate, modifier = Modifier.size(48.dp)) {
        Icon(Icons.Filled.LocationOn, contentDescription = "Navigate by boat")
      }
      IconButton(onClick = onPlans, modifier = Modifier.size(48.dp)) {
        Icon(Icons.Filled.DateRange, contentDescription = "Dive plans")
      }
      IconButton(onClick = onRefresh, modifier = Modifier.size(48.dp)) {
        Icon(Icons.Filled.Refresh, contentDescription = "Refresh the forecast")
      }
    }
    if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 4.dp))
    state.outdatedWall?.let {
      Text(
        "The last map saved was for ${MaldivesTime.label(it)}. Open a site for its saved week, or refresh when online.",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.85f),
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
      )
    }
    state.error?.let {
      Text(it, color = colors.stop, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
    }
    OutlinedTextField(
      value = query,
      onValueChange = onQuery,
      singleLine = true,
      placeholder = { Text("Find a site or atoll") },
      trailingIcon = {
        if (query.isNotEmpty()) IconButton(onClick = { onQuery("") }) { Icon(Icons.Filled.Clear, "Clear") }
      },
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
      keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
      modifier =
        Modifier.fillMaxWidth()
          .padding(horizontal = 16.dp, vertical = 8.dp)
          .onFocusChanged { if (it.isFocused) onSearchFocus() },
    )
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 520.dp)) {
      items(rows, key = { it.site.id }) { row ->
        NowRow(row, onClick = { onOpenSite(row.site.id) })
        HorizontalDivider(color = colors.foam.copy(alpha = 0.08f))
      }
    }
  }
}

@Composable
private fun NowRow(row: SiteRow, onClick: () -> Unit) {
  val colors = CurrentTheme.colors
  val g = row.glance
  val spoken =
    if (g == null) "${row.site.name}, no forecast"
    else "${row.site.name}, ${g.spokenWay}, ${g.label}, ${confidenceLabel(g.confidence)} confidence"
  Row(
    Modifier.fillMaxWidth()
      .heightIn(min = 56.dp)
      .clickable(onClick = onClick)
      .padding(horizontal = 16.dp, vertical = 8.dp)
      .semantics(mergeDescendants = true) { contentDescription = spoken },
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
      if (g != null) CurrentArrow(bearing = g.arrowBearing, color = colors.tone(g.tone), alpha = g.opacity, size = 30.dp)
      else Surface(Modifier.size(10.dp), shape = MaterialTheme.shapes.small, color = colors.foam.copy(alpha = 0.5f)) {}
    }
    Spacer(Modifier.width(12.dp))
    Column(Modifier.weight(1f)) {
      Text(row.site.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(
        row.site.atollName ?: "",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.7f),
        maxLines = 1,
      )
    }
    Column(horizontalAlignment = Alignment.End) {
      if (g != null) {
        Text(g.label, color = colors.tone(g.tone), fontWeight = FontWeight.SemiBold)
        Text(
          buildString {
            append(g.way)
            if (row.stale) append(" · old data")
          },
          style = MaterialTheme.typography.bodySmall,
          color = colors.foam.copy(alpha = 0.75f),
        )
      } else {
        Text("no forecast", style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.6f))
      }
    }
  }
}
