package app.fiftybar.divecurrent.ui.map

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.input.pointer.pointerInput
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import app.fiftybar.divecurrent.ui.components.Tab
import app.fiftybar.divecurrent.ui.components.TabIcons
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.filled.Search
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.semantics.Role
import app.fiftybar.divecurrent.data.api.Strength
import app.fiftybar.divecurrent.domain.strengthWord
import app.fiftybar.divecurrent.domain.NowCounts
import app.fiftybar.divecurrent.ui.components.rememberReducedMotion
import app.fiftybar.divecurrent.ui.site.strengthLevel
import app.fiftybar.divecurrent.ui.theme.SpaceGrotesk
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import app.fiftybar.divecurrent.domain.SiteSearch
import app.fiftybar.divecurrent.domain.ageLabel
import app.fiftybar.divecurrent.domain.confidenceLabel
import app.fiftybar.divecurrent.ui.appOffline
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.domain.OfflineArea
import app.fiftybar.divecurrent.domain.SavedArea
import app.fiftybar.divecurrent.ui.components.CurrentArrow
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MapScreen(
  onOpenSite: (String) -> Unit,
  onNavigateTo: (id: String, name: String, lat: Double, lon: Double) -> Unit,
  onAddSite: (lat: Double, lon: Double) -> Unit,
  // Sent from a site page to see where the site is: the map moves there and rings it, once.
  showSite: ShowOnMap? = null,
  onShown: () -> Unit = {},
  // A site page being pulled down over the map: the map previews the site (moves there, rings it, hides the list)
  // without changing anything, and goes back as it was if the pull is let go short.
  peekSite: ShowOnMap? = null,
  // Another screen is on top: the map stays alive under it (so it is there at once on the way back, and shows through
  // a site page being pulled down), but holds still and leaves Back to that screen.
  covered: Boolean = false,
) {
  val repository = appRepository()
  val offline = appOffline()
  val viewModel: MapViewModel = viewModel { MapViewModel(repository, offline) }
  val savedAreas by offline.areas.collectAsStateWithLifecycle()
  val saving by offline.saving.collectAsStateWithLifecycle()
  val saveErrors by offline.errors.collectAsStateWithLifecycle()
  val offlineChoice = OfflineChoice(savedAreas, saving, saveErrors, onSave = { offline.save(it) }, onRemove = offline::remove)
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
  val atlas: AtlasViewModel = viewModel { AtlasViewModel(repository) }
  val atlasState by atlas.state.collectAsStateWithLifecycle()
  LaunchedEffect(layers.atlas) { atlas.setOn(layers.atlas) }
  var layersOpen by remember { mutableStateOf(false) }
  var query by rememberSaveable { mutableStateOf("") }
  // The web list's atoll picker: "" for all atolls. Picking one also moves the map there.
  var atollId by rememberSaveable { mutableStateOf("") }
  var focus by remember { mutableStateOf<MapFocus?>(null) }
  // Map or list, one at a time, switched by the pill over the map: no sheet under the tab bar to compete with it.
  var listOpen by rememberSaveable { mutableStateOf(false) }
  BackHandler(enabled = listOpen && !covered) { listOpen = false }
  // Kept out here: the list leaves composition while the map shows, and should come back where it was.
  val listState = rememberLazyListState()
  val colors = CurrentTheme.colors
  // A point long-pressed on the map, waiting for "Navigate here" or "Add a dive site here".
  var pressed by remember { mutableStateOf<LatLon?>(null) }
  // "Add a dive site" asked from the list: says where the pin goes.
  var addHint by remember { mutableStateOf(false) }
  LifecycleResumeEffect(viewModel) {
    viewModel.refreshIfHourPassed()
    onPauseOrDispose {}
  }

  // A strength picked from the counts narrows the list and the pins to sites running that strength now.
  var strength by rememberSaveable { mutableStateOf<Strength?>(null) }
  val reducedMotion = rememberReducedMotion()
  val inAtoll =
    remember(state.rows, query, atollId) {
      state.rows.filter { (atollId.isEmpty() || it.site.atollId == atollId) && SiteSearch.matches(it.site.name, it.site.atollName, query) }
    }
  val counts = remember(inAtoll) { NowCounts.of(inAtoll.map { it.glance }) }
  // An outdated offline copy shows no arrows (but saved atolls' weeks do), so no strengths: a strength kept from before
  // must not hide every site.
  val hasHour = state.outdatedWall == null || state.savedRows > 0
  val picked = strength.takeIf { hasHour }
  val shown = remember(inAtoll, picked) { inAtoll.filter { NowCounts.matches(it.glance, picked) } }
  // The map keeps every atoll's pins when one is picked, as the web map does: the pick narrows the list and frames the
  // atoll. A search or a strength still narrows the pins too.
  val pins =
    remember(state.rows, query, picked) {
      state.rows.filter { SiteSearch.matches(it.site.name, it.site.atollName, query) && NowCounts.matches(it.glance, picked) }
    }
  var highlight by rememberSaveable { mutableStateOf<String?>(null) }
  // A site sent here whose search or strength check waits for the sites to load.
  var reveal by rememberSaveable { mutableStateOf<String?>(null) }
  // Where the map last settled, and where it was before a pull-down preview moved it.
  var settled by remember { mutableStateOf<MapViewBox?>(null) }
  var beforePeek by remember { mutableStateOf<MapViewBox?>(null) }
  fun moveTo(lat: Double, lon: Double, zoom: Double) {
    focus = MapFocus((focus?.count ?: 0) + 1, lat, lon, lat, lon, zoom = zoom)
  }
  // Before the preview's effect below, so a pull let go past the point keeps the map on the site.
  LaunchedEffect(showSite) {
    val show = showSite ?: return@LaunchedEffect
    beforePeek = null
    listOpen = false
    reveal = show.siteId
    highlight = show.siteId
    moveTo(show.lat, show.lon, 13.5)
    onShown()
  }
  LaunchedEffect(peekSite) {
    val peek = peekSite
    if (peek != null) {
      if (beforePeek == null) beforePeek = settled
      moveTo(peek.lat, peek.lon, 13.5)
    } else {
      val was = beforePeek ?: return@LaunchedEffect
      beforePeek = null
      if (showSite == null) moveTo((was.south + was.north) / 2, (was.west + was.east) / 2, was.zoom)
    }
  }
  // A search or a strength (even one not applied while the copy is outdated) that hides the site would leave the map
  // with nothing to ring: they go. Waits for the sites if they are still loading.
  LaunchedEffect(reveal, state.rows) {
    val id = reveal ?: return@LaunchedEffect
    if (state.rows.isEmpty()) return@LaunchedEffect
    state.rows.firstOrNull { it.site.id == id }?.let { row ->
      if (!SiteSearch.matches(row.site.name, row.site.atollName, query)) query = ""
      if (!NowCounts.matches(row.glance, strength)) strength = null
    }
    reveal = null
  }
  // While previewing, the list steps aside and the site is on the map even if a search or strength hides it.
  val listShown = listOpen && peekSite == null
  val pinsShown =
    remember(pins, peekSite, state.rows) {
      val id = peekSite?.siteId
      if (id == null || pins.any { it.site.id == id }) pins else pins + state.rows.filter { it.site.id == id }
    }
  val atolls = remember(state.rows) { SiteSearch.atollChoices(state.rows.map { it.site.atollId to it.site.atollName }) }
  fun pickAtoll(id: String) {
    atollId = id
    val sites = state.rows.filter { it.site.atollId == id }
    if (id.isEmpty() || sites.isEmpty()) return
    focus =
      MapFocus(
        (focus?.count ?: 0) + 1,
        sites.minOf { it.site.lat },
        sites.minOf { it.site.lon },
        sites.maxOf { it.site.lat },
        sites.maxOf { it.site.lon },
      )
  }

  // The search pill, atoll chip and counts float over the map and over the list; the list starts below them.
  Box(Modifier.fillMaxSize()) {
    Box(Modifier.fillMaxSize()) {
      SiteMapView(
        rows = pinsShown,
        layers = layers,
        colors = colors,
        onOpenSite = onOpenSite,
        modifier = Modifier.fillMaxSize(),
        // Only where a route can go: far outside the Maldives the server would refuse it.
        onLongPress = { lat, lon -> LatLon(lat, lon).takeIf(PointDestination::inRouteArea)?.let { pressed = it } },
        shelterImages = if (layers.shelter) shelterState.images else emptyList(),
        shelterOpacity = shelterState.scale?.opacity?.toFloat() ?: 0.85f,
        onView = { box ->
          settled = box
          shelter.onView(box)
          atlas.onView(box)
        },
        onTap = shelter::tap,
        atlas = atlasState.shapes,
        focus = focus,
        // Under the list the map is hidden: its arrows hold still rather than animate unseen.
        reducedMotion = reducedMotion || listShown || covered,
        highlight = peekSite?.siteId ?: highlight,
      )
      Column(
        // Several legends can be on at once: they scroll rather than run off a small screen.
        Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = TOP_BAR_ROOM - 8.dp, end = 12.dp, bottom = 12.dp).widthIn(max = 300.dp).verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        if (layers.shelter) {
          ShelterLegend(
            state = shelterState,
            onStep = shelter::step,
            onNow = shelter::backToNow,
            onCloseReadout = shelter::closeReadout,
            modifier = Modifier.fillMaxWidth(),
          )
        }
        // In the web menu's order.
        for (overlay in MapOverlay.entries.mapNotNull { it.atlas }.filter { it in layers.atlas }) {
          AtlasLegend(overlay, zoomedOut = overlay in atlasState.zoomedOut)
        }
      }
    }
    AnimatedVisibility(
      visible = listShown,
      enter = if (reducedMotion) EnterTransition.None else fadeIn(tween(180)) + slideInVertically(tween(220)) { it / 12 },
      exit = if (reducedMotion) ExitTransition.None else fadeOut(tween(150)) + slideOutVertically(tween(180)) { it / 12 },
    ) {
      NowList(
        state = state,
        offlineLine = atollId.takeIf { it.isNotEmpty() }?.let { offlineChoice.line(it) },
        rows = shown,
        total = state.rows.size,
        strength = picked,
        onOpenSite = onOpenSite,
        onRefresh = viewModel::refresh,
        onAddSite = { addHint = true },
        listState = listState,
        modifier =
          Modifier.fillMaxSize()
            // The map is still under the list: touches on the list's empty parts must not pan it or long-press a
            // point no one can see.
            .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }
            .background(colors.ink)
            .statusBarsPadding()
            .padding(top = TOP_BAR_ROOM),
      )
    }
    TopBar(
      query = query,
      onQuery = { query = it },
      // Matches show in the list, above the keyboard.
      onSearchFocus = { listOpen = true },
      listOpen = listShown,
      onToggleList = { listOpen = !listOpen },
      loading = state.loading,
      // Over the map nothing else says the data is old or missing, so a chip does, with the list header's words.
      status = state.dataStatus().takeIf { !state.loading }?.words,
      atolls = atolls,
      atollId = atollId,
      onAtoll = ::pickAtoll,
      offline = offlineChoice,
      counts = counts.takeIf { hasHour },
      strength = picked,
      onStrength = { strength = if (strength == it) null else it },
      onLayers = { layersOpen = true },
      layersMenu = { LayersMenu(expanded = layersOpen, layers = layers, onChoose = ::choose, onDismiss = { layersOpen = false }) },
      modifier = Modifier.align(Alignment.TopCenter),
    )
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
            listOpen = false
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

/** One base and the overlays, as the web map's layer menu (same names, same order); the choice is kept between launches. */
@Composable
private fun LayersMenu(expanded: Boolean, layers: MapLayers, onChoose: (MapLayers) -> Unit, onDismiss: () -> Unit) {
  DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
    Text("Base map", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
    for (base in BaseMap.entries) {
      DropdownMenuItem(
        text = { Text(base.label) },
        leadingIcon = { RadioButton(selected = layers.base == base, onClick = null) },
        onClick = { onChoose(layers.copy(base = base)) },
      )
    }
    HorizontalDivider()
    Text("Overlays", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
    for (overlay in MapOverlay.entries) {
      DropdownMenuItem(
        text = { Text(overlay.label) },
        leadingIcon = { Checkbox(checked = overlay in layers.overlays, onCheckedChange = null) },
        onClick = {
          onChoose(layers.toggled(overlay))
          // Sheltered water brings its own legend and hour picker: show them.
          if (overlay == MapOverlay.Shelter) onDismiss()
        },
      )
    }
  }
}

@Composable
private fun NowList(
  state: MapUiState,
  /** The picked atoll's offline state in words; null with all atolls. */
  offlineLine: String?,
  rows: List<SiteRow>,
  total: Int,
  strength: Strength?,
  onOpenSite: (String) -> Unit,
  onRefresh: () -> Unit,
  onAddSite: () -> Unit,
  listState: LazyListState,
  modifier: Modifier = Modifier,
) {
  val colors = CurrentTheme.colors
  val status = state.dataStatus()
  // imePadding lifts the list above the keyboard, so a short list of matches is not hidden behind it.
  Column(modifier.fillMaxWidth().imePadding()) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(
          text =
            when {
              status == DataStatus.NoCurrentHour -> DataStatus.NoCurrentHour.words
              state.maldivesWall != null -> "Now · ${MaldivesTime.label(state.maldivesWall)}"
              else -> "Now"
            },
          style = MaterialTheme.typography.titleLarge,
        )
        val line =
          buildList {
            add(if (rows.size == total) "$total sites" else "${rows.size} of $total sites")
            state.savedAt?.let { add("updated ${ageLabel(it)}") }
            if (status == DataStatus.OfflineCopy) add(DataStatus.OfflineCopy.words.lowercase())
          }
        Text(line.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = colors.mist)
      }
      IconButton(onClick = onAddSite, modifier = Modifier.size(48.dp)) {
        Icon(Icons.Filled.Add, contentDescription = "Add a dive site")
      }
      IconButton(onClick = onRefresh, modifier = Modifier.size(48.dp)) {
        Icon(Icons.Filled.Refresh, contentDescription = "Refresh the forecast")
      }
    }
    if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 4.dp))
    offlineLine?.let {
      Text(it, style = MaterialTheme.typography.bodySmall, color = colors.mist, modifier = Modifier.padding(horizontal = 20.dp, vertical = 2.dp))
    }
    state.outdatedWall?.let {
      Text(
        if (state.savedRows > 0)
          "No signal for the latest map (the last was for ${MaldivesTime.label(it)}). Saved atolls show this hour from their saved week; other sites need signal."
        else "The last map saved was for ${MaldivesTime.label(it)}. Open a site for its saved week, or refresh when online.",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.85f),
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
      )
    }
    state.error?.let {
      Text(it, color = colors.stop, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
    }
    if (strength != null && rows.isEmpty() && total > 0) {
      Text(
        "No site runs ${strengthWord(strength)} now. Tap the count again to show them all.",
        style = MaterialTheme.typography.bodyMedium,
        color = colors.mist,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
      )
    }
    LazyColumn(Modifier.fillMaxWidth(), state = listState, contentPadding = PaddingValues(bottom = 16.dp)) {
      items(rows, key = { it.site.id }) { row ->
        NowRow(row, onClick = { onOpenSite(row.site.id) })
        HorizontalDivider(color = colors.line, modifier = Modifier.padding(start = 68.dp))
      }
    }
  }
}

/** "Very strong 12": a strength's word, its count now, and its colour as a dot (very strong in the stop colour). */
@Composable
private fun CountChip(strength: Strength, count: Int, selected: Boolean, onClick: () -> Unit) {
  val colors = CurrentTheme.colors
  val tone = if (strength == Strength.TooStrong) colors.stop else colors.foam
  Row(
    Modifier.heightIn(min = 40.dp)
      .clip(CircleShape)
      .background(if (selected) tone.copy(alpha = 0.18f) else colors.reef)
      .border(1.dp, if (selected) tone else colors.edge, CircleShape)
      .selectable(selected = selected, role = Role.Tab, onClick = onClick)
      .padding(horizontal = 14.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    // The day chart's bar for this strength, so the four read as a scale here too.
    Box(Modifier.size(width = 5.dp, height = 16.dp), contentAlignment = Alignment.BottomCenter) {
      Box(Modifier.fillMaxWidth().fillMaxHeight(strengthLevel(strength)).clip(RoundedCornerShape(2.dp)).background(tone))
    }
    Text(strengthWord(strength).replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelLarge, color = if (selected) tone else colors.foam)
    Text("$count", style = MaterialTheme.typography.titleSmall.copy(fontFamily = SpaceGrotesk), color = if (selected) tone else colors.mist)
  }
}

/**
 * The floating search pill with the layers button beside it, and the atoll chip under it: over the map and over the
 * list alike, so the search is one tap away at any sheet height.
 */
@Composable
private fun TopBar(
  query: String,
  onQuery: (String) -> Unit,
  onSearchFocus: () -> Unit,
  listOpen: Boolean,
  onToggleList: () -> Unit,
  loading: Boolean,
  status: String?,
  atolls: List<SiteSearch.AtollChoice>,
  atollId: String,
  onAtoll: (String) -> Unit,
  offline: OfflineChoice,
  onLayers: () -> Unit,
  layersMenu: @Composable () -> Unit,
  counts: NowCounts?,
  strength: Strength?,
  onStrength: (Strength) -> Unit,
  modifier: Modifier = Modifier,
) {
  val colors = CurrentTheme.colors
  val focus = LocalFocusManager.current
  Column(modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Row(
        Modifier.weight(1f)
          .height(52.dp)
          .clip(RoundedCornerShape(26.dp))
          .background(colors.glass)
          .border(1.dp, colors.line, RoundedCornerShape(26.dp))
          .padding(start = 16.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(Icons.Filled.Search, contentDescription = null, tint = colors.mist, modifier = Modifier.size(22.dp))
        Box(Modifier.weight(1f).padding(start = 10.dp), contentAlignment = Alignment.CenterStart) {
          // Short, so it fits beside the List and layers buttons on a narrow phone; the field's label says the rest.
          if (query.isEmpty()) Text("Search sites", style = MaterialTheme.typography.bodyLarge, color = colors.dim, maxLines = 1, overflow = TextOverflow.Ellipsis)
          BasicTextField(
            value = query,
            onValueChange = onQuery,
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.foam),
            cursorBrush = SolidColor(colors.incoming),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Find a site or atoll" }.onFocusChanged { if (it.isFocused) onSearchFocus() },
          )
        }
        if (query.isNotEmpty()) IconButton(onClick = { onQuery("") }, modifier = Modifier.size(44.dp)) { Icon(Icons.Filled.Clear, "Clear the search") }
      }
      ViewToggle(listOpen, loading, onToggleList)
      Box {
        IconButton(
          onClick = onLayers,
          modifier = Modifier.size(52.dp).clip(CircleShape).background(colors.glass).border(1.dp, colors.line, CircleShape),
        ) {
          Icon(LayersIcon, contentDescription = "Map layers", tint = colors.foam)
        }
        layersMenu()
      }
    }
    // The atoll, then how many sites run each strength now: tap a count to show only those, again to show all.
    // No counts without a current hour.
    Row(
      Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).selectableGroup(),
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      status?.let { StatusChip(it) }
      AtollChip(atolls, atollId, onAtoll, offline)
      if (counts != null) for (s in NowCounts.ORDER) {
        CountChip(s, counts.of(s), selected = strength == s) { onStrength(s) }
      }
    }
  }
}

/**
 * Map or list, beside the layers button and styled like it (dark glass), so it reads as part of the map's controls
 * and stays clear of the tab bar. Shows what a tap switches to; a small spinner takes the icon's place while loading.
 */
@Composable
private fun ViewToggle(listOpen: Boolean, loading: Boolean, onClick: () -> Unit) {
  val colors = CurrentTheme.colors
  Row(
    Modifier.height(52.dp)
      .clip(CircleShape)
      .background(colors.glass)
      .border(1.dp, colors.line, CircleShape)
      .clickable(onClickLabel = if (listOpen) "Show the map" else "Show the list", onClick = onClick)
      .padding(start = 14.dp, end = 16.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    if (loading) CircularProgressIndicator(color = colors.foam, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
    else Icon(if (listOpen) TabIcons.of(Tab.Now) else ListIcon, contentDescription = null, tint = colors.foam, modifier = Modifier.size(20.dp))
    Text(if (listOpen) "Map" else "List", style = MaterialTheme.typography.labelLarge, color = colors.foam, maxLines = 1)
  }
}

/** "Offline copy", "No current hour": the data's state, in amber, first in the chip row. */
@Composable
private fun StatusChip(text: String) {
  val colors = CurrentTheme.colors
  Box(
    Modifier.heightIn(min = 40.dp)
      .clip(CircleShape)
      .background(colors.glass)
      .border(1.dp, colors.outgoing, CircleShape)
      .padding(horizontal = 14.dp),
    contentAlignment = Alignment.Center,
  ) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = colors.outgoing, maxLines = 1)
  }
}

/**
 * The web list's atoll select as a chip: all atolls, or one with its site count; picking one frames it. With an atoll
 * picked, the menu also saves it for use without signal, saves it again, or removes it; saved atolls are marked.
 */
@Composable
private fun AtollChip(atolls: List<SiteSearch.AtollChoice>, atollId: String, onAtoll: (String) -> Unit, offline: OfflineChoice) {
  val colors = CurrentTheme.colors
  var open by remember { mutableStateOf(false) }
  val chosen = atolls.firstOrNull { it.id == atollId }
  Box {
    Row(
      Modifier.heightIn(min = 40.dp)
        .clip(CircleShape)
        .background(if (chosen != null) colors.foam else colors.glass)
        .border(1.dp, if (chosen != null) colors.foam else colors.line, CircleShape)
        .clickable { open = true }
        .padding(start = 14.dp, end = 8.dp)
        .semantics { contentDescription = "Atoll: ${chosen?.name ?: "all atolls"}" },
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(
        chosen?.let { "${it.name} · ${it.count}" } ?: "All atolls",
        style = MaterialTheme.typography.labelLarge,
        color = if (chosen != null) colors.ink else colors.foam,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.widthIn(max = 240.dp),
      )
      Icon(Icons.Filled.ArrowDropDown, contentDescription = null, tint = if (chosen != null) colors.ink else colors.foam)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      if (chosen != null) {
        val share = offline.saving[chosen.id]
        val area = offline.saved[chosen.id]
        DropdownMenuItem(
          text = {
            Column {
              Text(
                when {
                  share != null -> "Saving for offline… ${(share * 100).toInt()} %"
                  area != null -> "Update offline copy"
                  else -> "Save ${chosen.name} for offline"
                }
              )
              Text(
                offline.line(chosen.id) ?: "Forecasts, site pages and reef shapes, for use without signal",
                style = MaterialTheme.typography.bodySmall,
                color = colors.mist,
              )
            }
          },
          enabled = share == null,
          onClick = {
            open = false
            offline.onSave(chosen.id)
          },
        )
        if (area != null || share != null) {
          DropdownMenuItem(
            text = { Text("Remove offline copy") },
            onClick = {
              open = false
              offline.onRemove(chosen.id)
            },
          )
        }
        HorizontalDivider()
      }
      DropdownMenuItem(
        text = { Text("All atolls") },
        onClick = {
          open = false
          onAtoll("")
        },
      )
      for (atoll in atolls) {
        DropdownMenuItem(
          text = { Text("${atoll.name} (${atoll.count})" + if (atoll.id in offline.saved) " · saved" else "") },
          onClick = {
            open = false
            onAtoll(atoll.id)
          },
        )
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
    // The map's badge: a dark disc ringed in the hour's colour with the arrow on it.
    val ring = g?.let { colors.tone(it.tone).copy(alpha = it.opacity) } ?: colors.edge
    Box(
      Modifier.size(36.dp).clip(CircleShape).background(colors.ink).border(1.5.dp, ring, CircleShape),
      contentAlignment = Alignment.Center,
    ) {
      if (g != null) CurrentArrow(bearing = g.arrowBearing, color = colors.tone(g.tone), alpha = g.opacity, size = 22.dp, edge = colors.ink)
      else Box(Modifier.size(8.dp).clip(CircleShape).background(colors.foam.copy(alpha = 0.5f)))
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
        Text(g.label.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleSmall, color = colors.tone(g.tone))
        Text(
          buildString {
            append(g.way)
            if (row.stale) append(" · old data")
            if (row.fromSaved) append(" · saved")
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

/** The saved atolls and what is being saved, with the menu's two actions. */
private data class OfflineChoice(
  val saved: Map<String, SavedArea>,
  val saving: Map<String, Float>,
  val errors: Map<String, String>,
  val onSave: (String) -> Unit,
  val onRemove: (String) -> Unit,
) {
  /** "Saved for offline 3 h ago · 4 MB", "Saving for offline… 40 %", or the last failure; null when never saved. */
  fun line(atollId: String): String? {
    saving[atollId]?.let { return "Saving for offline… ${(it * 100).toInt()} %" }
    errors[atollId]?.let { return it }
    val area = saved[atollId] ?: return null
    return buildString {
      append("Saved for offline ${ageLabel(area.savedAt)} · ${OfflineArea.sizeLabel(area.bytes)}")
      if (area.missedSites > 0) append(" · ${area.missedSites} of ${area.siteIds.size} forecasts missing")
    }
  }
}

/** Where a site page sent the diver back to: the site and its pin. */
data class ShowOnMap(val siteId: String, val lat: Double, val lon: Double)

/** What is wrong with the map's data, if anything: one value, so the chip over the map and the list header agree. */
private enum class DataStatus(val words: String) {
  CouldNotLoad("Could not load"),
  SavedForecast("Saved forecast"),
  NoCurrentHour("No current hour"),
  OfflineCopy("Offline copy"),
}

private fun MapUiState.dataStatus(): DataStatus? =
  when {
    rows.isEmpty() && error != null -> DataStatus.CouldNotLoad
    outdatedWall != null && savedRows > 0 -> DataStatus.SavedForecast
    outdatedWall != null -> DataStatus.NoCurrentHour
    fromCache && error != null -> DataStatus.OfflineCopy
    else -> null
  }

/** Room the floating search pill and atoll chip take under the status bar. */
private val TOP_BAR_ROOM = 128.dp

/** Three lines with a dot each: the list. */
private val ListIcon: ImageVector by lazy {
  ImageVector.Builder("list", 24.dp, 24.dp, 24f, 24f)
    .path(stroke = SolidColor(androidx.compose.ui.graphics.Color.White), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
      for (y in listOf(6f, 12f, 18f)) {
        moveTo(4f, y)
        lineTo(4.01f, y)
        moveTo(9f, y)
        lineTo(20f, y)
      }
    }
    .build()
}

/** Two stacked sheets: the layers button. */
private val LayersIcon: ImageVector by lazy {
  ImageVector.Builder("layers", 24.dp, 24.dp, 24f, 24f)
    .path(stroke = SolidColor(androidx.compose.ui.graphics.Color.White), strokeLineWidth = 1.8f, strokeLineJoin = StrokeJoin.Round, strokeLineCap = StrokeCap.Round) {
      moveTo(12f, 4f)
      lineTo(21f, 9f)
      lineTo(12f, 14f)
      lineTo(3f, 9f)
      close()
      moveTo(3f, 13.5f)
      lineTo(12f, 18.5f)
      lineTo(21f, 13.5f)
    }
    .build()
}
