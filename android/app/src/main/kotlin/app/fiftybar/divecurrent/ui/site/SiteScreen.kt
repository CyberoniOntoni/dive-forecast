package app.fiftybar.divecurrent.ui.site

import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalDensity
import app.fiftybar.divecurrent.ui.components.TabIcons
import app.fiftybar.divecurrent.ui.components.rememberReducedMotion
import kotlinx.coroutines.launch
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.BuildConfig
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.ageLabel
import app.fiftybar.divecurrent.domain.depthLabel
import app.fiftybar.divecurrent.domain.glance
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay

@OptIn(ExperimentalFoundationApi::class)
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
  val scope = rememberCoroutineScope()
  val reducedMotion = rememberReducedMotion()
  val scroll = rememberScrollState()
  val forecast = state.forecast
  val hours = forecast?.hours.orEmpty()
  val week = remember(forecast) { forecast?.takeIf { it.hours.isNotEmpty() }?.let(::WeekView) }
  val selected = state.selected.coerceIn(0, hours.lastIndex.coerceAtLeast(0))
  val selectedGlance = week?.glances?.getOrNull(selected)
  val site = state.site?.takeIf { !state.notFound }
  // Past the header the page gets a solid strip with the site's name behind the floating buttons.
  val heroPx = with(LocalDensity.current) { HERO_HEIGHT.toPx() }
  val pastHero by remember { derivedStateOf { scroll.value > heroPx * 0.7f } }

  Scaffold(
    containerColor = colors.ink,
    contentWindowInsets = WindowInsets(0),
    bottomBar = {
      if (site != null) {
        Row(
          Modifier.fillMaxWidth()
            .background(Brush.verticalGradient(listOf(colors.ink.copy(alpha = 0f), colors.ink, colors.ink)))
            .navigationBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 12.dp),
          horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
          Button(
            onClick = { scope.launch { reportFocus.bringIntoView() } },
            shape = RoundedCornerShape(18.dp),
            colors = ButtonDefaults.buttonColors(containerColor = colors.incoming, contentColor = colors.ink),
            modifier = Modifier.weight(1f).height(56.dp),
          ) {
            Icon(Icons.Filled.Edit, contentDescription = null, modifier = Modifier.size(20.dp))
            Text("  Report current", style = MaterialTheme.typography.titleMedium)
          }
          Button(
            onClick = { onNavigate(site) },
            shape = RoundedCornerShape(18.dp),
            colors = ButtonDefaults.buttonColors(containerColor = colors.reef, contentColor = colors.foam),
            border = BorderStroke(1.dp, colors.edge),
            modifier = Modifier.weight(1f).height(56.dp),
          ) {
            Icon(TabIcons.heading, contentDescription = null, modifier = Modifier.size(20.dp))
            Text("  Go by boat", style = MaterialTheme.typography.titleMedium)
          }
        }
      }
    },
  ) { padding ->
    Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
      Column(Modifier.fillMaxSize().verticalScroll(scroll)) {
        SiteHero(site = state.site, glance = selectedGlance, reducedMotion = reducedMotion)
        Column(
          Modifier.fillMaxWidth().padding(horizontal = 16.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
          if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
          when {
            state.notFound -> Text("This site is not on the map any more.", color = colors.stop)
            forecast == null -> if (!state.loading) Text(state.error ?: "No forecast yet.", color = colors.stop)
            forecast.unavailable || week == null -> UnavailableCard(forecast)
            else -> {
              HourCard(week, selected, reducedMotion)
              if (selectedGlance?.estimatedHeading == true) {
                Text(
                  "The arrow's heading is an estimate: this site's bearing is not measured or taken from the atoll rim.",
                  style = MaterialTheme.typography.bodySmall,
                  color = colors.mist,
                )
              }
              StatusLine(state)
              DayChart(week, selected, onSelect = viewModel::select, onNow = viewModel::selectNow, reducedMotion = reducedMotion)
              SeaTiles(week, forecast, selected)
              NoticeCard(forecast)
            }
          }
          if (forecast == null || week == null) StatusLine(state)
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
          state.site?.let { s ->
            val photos: SitePhotosViewModel = viewModel(key = "site-photos/$siteId") { SitePhotosViewModel(siteId, account) }
            val photosState by photos.state.collectAsStateWithLifecycle()
            AboutCard(s, photoUrl = viewModel::photoUrl) {
              if (s.userAdded && photosState.isAdder && session != null) {
                AdderPhotos(s, photosState, onPick = { uris, room -> photos.add(context, uris, room, viewModel::showSite) })
              }
            }
          }
          if (!state.notFound) {
            val reviews: ReviewsViewModel = viewModel(key = "reviews/$siteId") { ReviewsViewModel(siteId, repository, account) }
            val reviewsState by reviews.state.collectAsStateWithLifecycle()
            ReviewsCard(reviewsState, signedIn = session != null, viewModel = reviews, onSignIn = onSignIn)
          }
          Spacer(Modifier.height(24.dp))
        }
      }
      // The buttons float over the header and stay put; once it has scrolled away a strip with the name backs them.
      AnimatedVisibility(visible = pastHero, enter = fadeIn(), exit = fadeOut()) {
        Box(Modifier.fillMaxWidth().background(colors.ink).statusBarsPadding().height(60.dp)) {
          Text(
            state.site?.name ?: "",
            style = MaterialTheme.typography.titleLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.CenterStart).padding(start = 72.dp, end = 120.dp),
          )
        }
      }
      Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        RoundButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Spacer(Modifier.weight(1f))
        RoundButton(onClick = viewModel::refresh) { Icon(Icons.Filled.Refresh, "Refresh the forecast") }
        Spacer(Modifier.width(8.dp))
        RoundButton(
          onClick = {
            val text = shareText(siteId, state.site?.name, hours.getOrNull(selected))
            val send =
              Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
              }
            context.startActivity(Intent.createChooser(send, "Share this hour"))
          }
        ) {
          Icon(Icons.Filled.Share, "Share this hour")
        }
      }
    }
  }
}

/** A 44 dp glass circle that reads over the satellite header and over the page alike. */
@Composable
private fun RoundButton(onClick: () -> Unit, content: @Composable () -> Unit) {
  val colors = CurrentTheme.colors
  IconButton(
    onClick = onClick,
    modifier = Modifier.size(44.dp).clip(CircleShape).background(colors.ink.copy(alpha = 0.6f)).border(1.dp, colors.line, CircleShape),
    colors = IconButtonDefaults.iconButtonColors(contentColor = colors.foam),
  ) {
    content()
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
    colors = CardDefaults.cardColors(containerColor = colors.deep, contentColor = colors.foam),
    border = BorderStroke(1.dp, colors.line),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
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
private fun AboutCard(site: ApiSite, photoUrl: (String) -> String, adder: @Composable () -> Unit = {}) {
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
    adder()
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedButton(onClick = { uri.openUri("${BuildConfig.WEB_URL}/sites/${site.id}") }, modifier = Modifier.heightIn(min = 44.dp)) {
        Text("Open on the web")
      }
      site.sourceUrl?.let { source ->
        OutlinedButton(onClick = { uri.openUri(source) }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Source") }
      }
    }
  }
}

/** The adder's "Add photos" on their own site, up to 6, with how the sending went. */
@Composable
private fun AdderPhotos(site: ApiSite, state: SitePhotosUiState, onPick: (List<Uri>, Int) -> Unit) {
  val colors = CurrentTheme.colors
  val room = SITE_MAX_PHOTOS - site.photoUrls.size
  val pick =
    rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(SITE_MAX_PHOTOS)) { uris ->
      if (uris.isNotEmpty()) onPick(uris, room)
    }
  if (room > 0) {
    OutlinedButton(
      onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
      enabled = !state.busy,
      modifier = Modifier.heightIn(min = 48.dp),
    ) {
      Text(state.progress ?: if (site.photoUrls.isEmpty()) "Add photos (up to $room)" else "Add more photos (up to $room)")
    }
  }
  state.error?.let {
    Text(it, color = colors.stop, style = MaterialTheme.typography.bodySmall, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
  }
  state.note?.takeIf { state.error == null }?.let {
    Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.85f), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
  }
}

/** As MAX_PHOTOS_PER_SITE in lib/site-photos-limits.ts. */
private const val SITE_MAX_PHOTOS = AddSiteViewModel.MAX_PHOTOS
