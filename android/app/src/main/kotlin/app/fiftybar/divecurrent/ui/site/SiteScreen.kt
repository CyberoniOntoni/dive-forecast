package app.fiftybar.divecurrent.ui.site

import android.content.Intent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.BuildConfig
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.ApiSeaStateHour
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.SeaBand
import app.fiftybar.divecurrent.domain.Glance
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.ageLabel
import app.fiftybar.divecurrent.domain.compassWord
import app.fiftybar.divecurrent.domain.confidenceLabel
import app.fiftybar.divecurrent.domain.depthLabel
import app.fiftybar.divecurrent.domain.glance
import app.fiftybar.divecurrent.domain.heightLabel
import app.fiftybar.divecurrent.domain.seaBandLabel
import app.fiftybar.divecurrent.domain.windLabel
import app.fiftybar.divecurrent.ui.components.CurrentArrow
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun SiteScreen(
  siteId: String,
  onBack: () -> Unit,
  onSignIn: () -> Unit,
  onNavigate: (ApiSite) -> Unit,
  reportAt: String? = null,
) {
  val repository = appRepository()
  val account = appAccount()
  val viewModel: SiteViewModel = viewModel(key = "site/$siteId/${reportAt.orEmpty()}") { SiteViewModel(siteId, repository, account, reportAt) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val session by viewModel.session.collectAsStateWithLifecycle()
  // Opened from a plan's "Report the current": show the form, once the forecast above it has laid out.
  val reportFocus = remember { BringIntoViewRequester() }
  val forecastShown = state.forecast != null
  LaunchedEffect(reportAt, forecastShown) {
    if (reportAt != null && forecastShown) {
      delay(300)
      reportFocus.bringIntoView()
    }
  }
  val colors = CurrentTheme.colors
  val context = LocalContext.current
  val hours = state.forecast?.hours.orEmpty()
  val selectedTime = hours.getOrNull(state.selected)?.time

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text(state.site?.name ?: "Site", maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to the map") } },
        actions = {
          IconButton(onClick = viewModel::refresh) { Icon(Icons.Filled.Refresh, "Refresh the forecast") }
          IconButton(
            onClick = {
              val url = shareText(siteId, state.site?.name, hours.getOrNull(state.selected))
              val send =
                Intent(Intent.ACTION_SEND).apply {
                  type = "text/plain"
                  putExtra(Intent.EXTRA_TEXT, url)
                }
              context.startActivity(Intent.createChooser(send, "Share this hour"))
            }
          ) {
            Icon(Icons.Filled.Share, "Share this hour")
          }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    Column(
      Modifier.fillMaxSize()
        .padding(padding)
        .verticalScroll(rememberScrollState())
        .padding(horizontal = 16.dp)
        .navigationBarsPadding(),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
      StatusLine(state)
      val forecast = state.forecast
      when {
        state.notFound -> Text("This site is not on the map any more.", color = colors.stop)
        forecast == null -> if (!state.loading) Text(state.error ?: "No forecast yet.", color = colors.stop)
        forecast.unavailable || hours.isEmpty() -> UnavailableCard(forecast)
        else -> {
          HourCard(forecast, state.selected)
          HourPicker(forecast, state.selected, onSelect = viewModel::select, onNow = viewModel::selectNow)
          SeaStateCard(forecast, selectedTime)
          NoticeCard(forecast)
        }
      }
      state.site?.takeIf { !state.notFound }?.let { site ->
        OutlinedButton(onClick = { onNavigate(site) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
          Text("Navigate here by boat")
        }
      }
      if (!state.notFound) {
        Box(Modifier.bringIntoViewRequester(reportFocus)) {
        ReportCard(
          state = state,
          nickname = session?.nickname,
          timeOf = viewModel::reportTime,
          onSignIn = onSignIn,
          onQuick = viewModel::reportQuick,
          onOther = viewModel::reportOther,
          onDirection = viewModel::reportDirection,
          onStrength = viewModel::reportStrength,
          onSend = viewModel::sendReport,
          onAsForecast = viewModel::sendAsForecast,
        )
        }
        RecentReportsCard(state.reports, state.reportsSavedAt)
      }
      state.site?.let { AboutCard(it, photoUrl = viewModel::photoUrl) }
      Spacer(Modifier.height(24.dp))
    }
  }
}

/**
 * The hour in words, then the site's page. Not `?at=`: on the web that only fills the report form's dive time, and the
 * page opens on the current hour, so the hour itself goes in the text.
 */
internal fun shareText(siteId: String, siteName: String?, hour: ApiHour?): String {
  val url = "${BuildConfig.WEB_URL}/sites/$siteId"
  if (hour == null) return url
  val g = glance(hour)
  val reading = if (g == null) "" else ": ${g.wayToward}, ${g.label}"
  return "${siteName ?: "Site"}, ${MaldivesTime.label(hour.time)} Maldives$reading\n$url"
}

@Composable
private fun StatusLine(state: SiteUiState) {
  val colors = CurrentTheme.colors
  val parts =
    buildList {
      state.forecast?.fetchedAt?.let { add("Ocean data from ${ageLabel(it)}") }
      if (state.forecast?.stale == true) add("server could not refresh it")
      if (state.fromCache) state.savedAt?.let { add("offline copy saved ${ageLabel(it)}") }
    }
  if (parts.isNotEmpty()) {
    Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.75f))
  }
  if (state.error != null && state.forecast != null) {
    Text(state.error, style = MaterialTheme.typography.bodySmall, color = colors.stop)
  }
}

@Composable
internal fun SurfaceCard(content: @Composable () -> Unit) {
  val colors = CurrentTheme.colors
  Card(
    shape = RoundedCornerShape(24.dp),
    colors = CardDefaults.cardColors(containerColor = colors.glass, contentColor = colors.foam),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
  }
}

@Composable
private fun HourCard(forecast: ApiForecast, selected: Int) {
  val colors = CurrentTheme.colors
  val hour = forecast.hours.getOrNull(selected) ?: return
  val g: Glance? = glance(hour)
  SurfaceCard {
    Text(MaldivesTime.label(hour.time) + " Maldives", style = MaterialTheme.typography.labelLarge)
    if (g == null) {
      Text("No reading for this hour.")
      return@SurfaceCard
    }
    val way = g.wayToward
    Row(
      verticalAlignment = Alignment.CenterVertically,
      modifier =
        Modifier.semantics(mergeDescendants = true) {
          contentDescription = "$way, ${g.label}, ${confidenceLabel(g.confidence)} confidence"
        },
    ) {
      CurrentArrow(bearing = g.arrowBearing, color = colors.tone(g.tone), alpha = g.opacity, size = 72.dp)
      Spacer(Modifier.width(16.dp))
      Column {
        Text(
          g.label.replaceFirstChar { it.uppercase() },
          style = MaterialTheme.typography.headlineMedium,
          fontWeight = FontWeight.Bold,
          color = colors.tone(g.tone),
        )
        Text(way, style = MaterialTheme.typography.titleMedium)
        Text("${confidenceLabel(g.confidence).replaceFirstChar { it.uppercase() }} confidence", style = MaterialTheme.typography.bodyMedium)
      }
    }
    if (g.estimatedHeading) {
      Text(
        "The arrow's heading is an estimate: this site's bearing is not measured or taken from the atoll rim.",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.75f),
      )
    }
  }
}

@Composable
private fun HourPicker(forecast: ApiForecast, selected: Int, onSelect: (Int) -> Unit, onNow: () -> Unit) {
  val colors = CurrentTheme.colors
  val hours = forecast.hours
  SurfaceCard {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(MaldivesTime.dayLabel(hours[selected].time), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
      TextButton(onClick = onNow, modifier = Modifier.heightIn(min = 44.dp)) { Text("Now") }
    }
    ForecastStrip(
      hours = hours,
      glances = hours.map { glance(it) },
      seaState = forecast.seaState,
      selected = selected,
      onSelect = onSelect,
      colors = colors,
    )
    Slider(
      value = selected.toFloat(),
      onValueChange = { onSelect(Math.round(it)) },
      valueRange = 0f..(hours.lastIndex.coerceAtLeast(1)).toFloat(),
      steps = (hours.size - 2).coerceAtLeast(0),
      modifier = Modifier.semantics { contentDescription = "Forecast hour, ${MaldivesTime.label(hours[selected].time)}" },
    )
    Row {
      Text(MaldivesTime.label(hours.first().time), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
      Text(MaldivesTime.label(hours.last().time), style = MaterialTheme.typography.bodySmall)
    }
    Text(
      "Bars: current strength each hour. Line: the residual tide. Under them, the sea state.",
      style = MaterialTheme.typography.bodySmall,
      color = colors.foam.copy(alpha = 0.7f),
    )
  }
}

@Composable
private fun SeaStateCard(forecast: ApiForecast, time: String?) {
  val colors = CurrentTheme.colors
  val sea = forecast.seaState ?: return
  SurfaceCard {
    Text("Sea state", style = MaterialTheme.typography.titleSmall)
    if (forecast.seaStale) {
      Text(
        "From old wave or wind data: the server could not refresh it.",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.8f),
      )
    }
    val hour: ApiSeaStateHour? = sea.firstOrNull { it.time == time }
    if (hour == null) {
      Text(if (sea.isEmpty()) "The wave forecast did not load." else "No sea state for this hour.", style = MaterialTheme.typography.bodyMedium)
      return@SurfaceCard
    }
    val band = SeaBand.of(hour.band)
    Text(
      "${band?.let(::seaBandLabel)?.replaceFirstChar { it.uppercase() } ?: hour.band}, about ${heightLabel(hour.feltM)} felt",
      style = MaterialTheme.typography.titleMedium,
      color = if (band == SeaBand.Rough) colors.stop else colors.foam,
    )
    hour.swell?.let { s ->
      val period = s.periodS?.let { " at ${Math.round(it)} s" } ?: ""
      Text("Swell ${heightLabel(s.heightM)} from ${compassWord(s.fromDeg)}$period", style = MaterialTheme.typography.bodyMedium)
    }
    Text("Wind chop ${heightLabel(hour.windWaveM)}", style = MaterialTheme.typography.bodyMedium)
    hour.wind?.let { Text("Wind ${windLabel(it.speedMs, it.fromDeg)}", style = MaterialTheme.typography.bodyMedium) }
    if (hour.againstCurrent) {
      Text(
        "Swell runs into a strong outgoing current here: expect steep, breaking water at the channel mouth.",
        color = colors.stop,
        style = MaterialTheme.typography.bodyMedium,
      )
    }
  }
}

@Composable
private fun NoticeCard(forecast: ApiForecast) {
  val colors = CurrentTheme.colors
  if (forecast.notice.isBlank() && forecast.siteNote.isNullOrBlank()) return
  SurfaceCard {
    forecast.siteNote?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
    if (forecast.notice.isNotBlank()) {
      Text(forecast.notice, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.8f))
    }
    Text("Model ${forecast.modelVersion}", style = MaterialTheme.typography.labelSmall, color = colors.foam.copy(alpha = 0.6f))
  }
}

@Composable
private fun UnavailableCard(forecast: ApiForecast) {
  SurfaceCard {
    Text("No forecast for this site yet.", style = MaterialTheme.typography.titleMedium)
    Text(
      "The ocean data for it has not been fetched, or the site is outside the seeded atolls. Try again in a while.",
      style = MaterialTheme.typography.bodyMedium,
    )
    if (forecast.notice.isNotBlank()) Text(forecast.notice, style = MaterialTheme.typography.bodySmall)
  }
}

@Composable
private fun AboutCard(site: ApiSite, photoUrl: (String) -> String) {
  val colors = CurrentTheme.colors
  val uri = LocalUriHandler.current
  SurfaceCard {
    Text("About the site", style = MaterialTheme.typography.titleSmall)
    val facts = listOfNotNull(site.atollName, site.siteTypeLabel, depthLabel(site), if (site.userAdded) "added by a diver" else null)
    if (facts.isNotEmpty()) Text(facts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
    if (site.approximatePin) {
      Text(
        site.pinNote ?: "The pin was placed from imagery, so its position is approximate.",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.8f),
      )
    } else {
      site.pinNote?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
    }
    site.howToDive?.let {
      Text("How to dive it", style = MaterialTheme.typography.labelLarge)
      Text(it, style = MaterialTheme.typography.bodyMedium)
    }
    if (site.photoUrls.isNotEmpty()) {
      LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
        items(site.photoUrls) { path ->
          AsyncImage(
            model = photoUrl(path),
            contentDescription = "Photo of ${site.name}",
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(160.dp, 120.dp).clip(RoundedCornerShape(12.dp)),
          )
        }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedButton(onClick = { uri.openUri("${BuildConfig.WEB_URL}/sites/${site.id}") }, modifier = Modifier.heightIn(min = 44.dp)) {
        Text("Open on the web")
      }
      site.sourceUrl?.let { source ->
        OutlinedButton(onClick = { uri.openUri(source) }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Source") }
      }
    }
    Text(
      "Ratings and reviews are on the web site for now.",
      style = MaterialTheme.typography.bodySmall,
      color = colors.foam.copy(alpha = 0.7f),
    )
  }
}
