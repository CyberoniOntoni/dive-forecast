package app.fiftybar.divecurrent.ui.site

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.animation.core.tween
import androidx.compose.ui.graphics.Color
import androidx.compose.animation.core.animate
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Velocity
import app.fiftybar.divecurrent.ui.components.Tab
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
import androidx.compose.ui.platform.LocalDensity
import app.fiftybar.divecurrent.ui.components.TabIcons
import app.fiftybar.divecurrent.ui.components.rememberReducedMotion
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
import app.fiftybar.divecurrent.ui.components.ContentActions
import app.fiftybar.divecurrent.ui.components.BlockDialog
import app.fiftybar.divecurrent.ui.components.ReportDialog
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
  onShowOnMap: (ApiSite) -> Unit,
  onPeekMap: (ApiSite?) -> Unit,
  reportAt: String? = null,
) {
  val repository = appRepository()
  val account = appAccount()
  val viewModel: SiteViewModel = viewModel(key = "site/$siteId/${reportAt.orEmpty()}") { SiteViewModel(siteId, repository, account, reportAt) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val session by viewModel.session.collectAsStateWithLifecycle()
  // Opened from a plan's "Report the current": the sheet opens once, when the forecast has loaded under it.
  var reportOpen by rememberSaveable { mutableStateOf(false) }
  var reportAutoOpened by rememberSaveable { mutableStateOf(false) }
  // Sent to sign in from the sheet: it opens again on coming back signed in, with the form as it was.
  var reportAfterSignIn by rememberSaveable { mutableStateOf(false) }
  val signedIn = session != null
  LaunchedEffect(signedIn) {
    if (signedIn && reportAfterSignIn) reportOpen = true
    // Back signed in, or back without signing in: either way the request is spent, so signing in later from the You
    // tab does not pop the sheet up out of nowhere.
    reportAfterSignIn = false
  }
  val forecastShown = state.forecast != null
  LaunchedEffect(reportAt, forecastShown) {
    if (reportAt != null && forecastShown && !reportAutoOpened) {
      reportAutoOpened = true
      reportOpen = true
    }
  }
  val colors = CurrentTheme.colors
  val context = LocalContext.current
  val reducedMotion = rememberReducedMotion()
  val scroll = rememberScrollState()
  val forecast = state.forecast
  val hours = forecast?.hours.orEmpty()
  // "Now" moves on while the page stays open (a boat day): the week is re-read when the nearest Maldives hour (the
  // one the map shows) changes, at half past.
  var nowHour by remember { mutableStateOf(MaldivesTime.nearestHour()) }
  LaunchedEffect(Unit) {
    while (true) {
      delay(60_000)
      nowHour = MaldivesTime.nearestHour()
    }
  }
  val week = remember(forecast, nowHour) { forecast?.takeIf { it.hours.isNotEmpty() }?.let { WeekView(it) } }
  val selected = state.selected.coerceIn(0, hours.lastIndex.coerceAtLeast(0))
  val selectedGlance = week?.glances?.getOrNull(selected)
  val site = state.site?.takeIf { !state.notFound }
  // Past the header the page gets a solid strip with the site's name behind the floating buttons.
  val heroPx = with(LocalDensity.current) { HERO_HEIGHT.toPx() }
  val pastHero by remember { derivedStateOf { scroll.value > heroPx * 0.7f } }
  // Pulled down past the top of the page, the header gives way to the map, centred on this site.
  val showOnMap by rememberUpdatedState(site?.let { s -> { onShowOnMap(s) } })
  val peekMap by rememberUpdatedState(onPeekMap)
  val pull =
    rememberMapPull(
      enabled = site != null,
      reducedMotion = reducedMotion,
      onStart = { site?.let(peekMap) },
      onCancel = { peekMap(null) },
    ) { showOnMap?.invoke() }

  Scaffold(
    // See-through: the map lives under every screen, and a pull down shows it above the page. The page and its
    // bottom bar paint their own ink.
    containerColor = Color.Transparent,
    contentWindowInsets = WindowInsets(0),
    bottomBar = {
      if (site != null) {
        Row(
          Modifier.fillMaxWidth()
            // Holds still through the pull, then leaves with the page as it slides away to the map.
            .graphicsLayer { translationY = (pull.offset - pull.threshold * PULL_STRETCH).coerceAtLeast(0f) }
            .background(colors.ink)
            .navigationBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 12.dp),
          horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
          Button(
            onClick = { reportOpen = true },
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
    if (reportOpen && !state.notFound) {
      val close = {
        reportOpen = false
        // A thanks already read leaves the form fresh for the next dive.
        if (state.report.savedLine != null) viewModel.reportDone()
      }
      ReportSheet(
        state = state,
        nickname = session?.nickname,
        actions =
          ReportActions(
            timeOf = viewModel::reportTime,
            onQuick = viewModel::reportQuick,
            onOther = viewModel::reportOther,
            onDirection = viewModel::reportDirection,
            onStrength = viewModel::reportStrength,
            onSend = viewModel::sendReport,
            onAsForecast = viewModel::sendAsForecast,
            onDone = close,
          ),
        reducedMotion = reducedMotion,
        onSignIn = {
          reportOpen = false
          reportAfterSignIn = true
          onSignIn()
        },
        onDismiss = close,
      )
    }
    Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding()).onSizeChanged { pull.pageHeight = it.height.toFloat() }.nestedScroll(pull.connection)) {
      Column(Modifier.fillMaxSize().graphicsLayer { translationY = pull.offset }.background(colors.ink).verticalScroll(scroll)) {
        // The streaks stop once the header has scrolled away, so the page does not draw every frame for nothing.
        SiteHero(site = state.site, glance = selectedGlance, reducedMotion = reducedMotion || pastHero)
        Column(
          Modifier.fillMaxWidth().padding(horizontal = 16.dp),
          verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
          if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
          when {
            state.notFound -> Text("This site is not on the map any more.", color = colors.stop)
            forecast == null -> if (!state.loading) Text(state.error ?: "No forecast yet.", color = colors.stop)
            forecast.unavailable || week == null -> {
              UnavailableCard(forecast)
              StatusLine(state)
            }
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
          if (forecast == null) StatusLine(state)
          if (!state.notFound) RecentReportsCard(state.reports, state.reportsSavedAt)
          state.site?.let { s ->
            val photos: SitePhotosViewModel = viewModel(key = "site-photos/$siteId") { SitePhotosViewModel(siteId, account) }
            val photosState by photos.state.collectAsStateWithLifecycle()
            AboutCard(s, photoUrl = viewModel::photoUrl, adderBlocked = photosState.adderBlocked(s)) {
              if (s.userAdded && photosState.isAdder && session != null) {
                AdderPhotos(s, photosState, onPick = { uris, room -> photos.add(context, uris, room, viewModel::showSite) })
              }
              if (s.userAdded && !photosState.isAdder) {
                var reporting by remember { mutableStateOf(false) }
                var blocking by remember { mutableStateOf(false) }
                val adderName = s.adderNickname
                ContentActions(
                  onReport = { if (session != null) reporting = true else onSignIn() },
                  onBlock = if (session != null && adderName != null && !photosState.adderBlocked(s)) ({ blocking = true }) else null,
                )
                photosState.reportNote?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.85f)) }
                if (reporting) {
                  ReportDialog(
                    what = "site",
                    onDismiss = { reporting = false },
                    onSend = { reason, note ->
                      reporting = false
                      photos.report(reason, note)
                    },
                  )
                }
                if (blocking && adderName != null) {
                  BlockDialog(
                    nickname = adderName,
                    onDismiss = { blocking = false },
                    onBlock = {
                      blocking = false
                      photos.blockAdder(adderName)
                    },
                  )
                }
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
        // The pull's twin, for whoever does not find the gesture (and for TalkBack).
        if (site != null) {
          RoundButton(onClick = { onShowOnMap(site) }) { Icon(TabIcons.of(Tab.Now), "Show on the map", Modifier.size(22.dp)) }
          Spacer(Modifier.width(8.dp))
        }
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
      PullHint(pull, Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 64.dp))
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
private fun AboutCard(
  site: ApiSite,
  photoUrl: (String) -> String,
  adderBlocked: Boolean = false,
  adder: @Composable () -> Unit = {},
) {
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
    if (adderBlocked) {
      Text(
        "You blocked the diver who added this site, so their notes and photos are hidden. Unblock them on your account screen.",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.8f),
      )
    }
    site.description?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
    site.howToDive?.takeUnless { adderBlocked && site.howToDiveByAdder }?.let {
      Text("How to dive it", style = MaterialTheme.typography.labelLarge)
      Text(it, style = MaterialTheme.typography.bodyMedium)
    }
    site.writtenByLine?.let { credit ->
      Text(
        credit,
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.8f),
      )
    }
    if (site.photoUrls.isNotEmpty() && !adderBlocked) {
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
    // Divers write the site's texts together on the web; a moderator approves each edit.
    OutlinedButton(onClick = { uri.openUri("${BuildConfig.WEB_URL}/sites/${site.id}#about") }, modifier = Modifier.heightIn(min = 44.dp)) {
      Text(if (site.description == null && site.howToDive == null) "Write about this site on the web" else "Suggest an edit on the web")
    }
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

/** The pull-down from the top of a site page: how far it has gone, and the scroll hook that drives it. */
@Stable
internal class MapPull(val threshold: Float) {
  var offset by mutableFloatStateOf(0f)
    internal set

  val ready: Boolean
    get() = offset >= threshold

  /** The page's height, so a pull let go past the threshold can carry the page off the bottom of the screen. */
  var pageHeight = 0f

  /** The map under the page is previewing the site: put back if the pull ends short (or the page goes mid-pull). */
  internal var peeking = false

  lateinit var connection: NestedScrollConnection
    internal set
}

/**
 * Over-scrolling down at the top of the page drags it down (at half the finger's speed, like a rubber band), showing
 * the live map behind it; [onStart] runs as the pull begins, so the map can preview the site. Let go past
 * [PULL_TO_MAP] and the page slides away off the bottom, then [onPulled] runs; short of it the page springs back and
 * [onCancel] puts the map back as it was. A tick of haptics marks the point. With the phone's animations off the page
 * snaps rather than slides or springs.
 */
@Composable
internal fun rememberMapPull(enabled: Boolean, reducedMotion: Boolean, onStart: () -> Unit, onCancel: () -> Unit, onPulled: () -> Unit): MapPull {
  val threshold = with(LocalDensity.current) { PULL_TO_MAP.toPx() }
  val haptics = LocalHapticFeedback.current
  val pulled by rememberUpdatedState(onPulled)
  val started by rememberUpdatedState(onStart)
  val cancelled by rememberUpdatedState(onCancel)
  val on by rememberUpdatedState(enabled)
  val still by rememberUpdatedState(reducedMotion)
  val pull = remember(threshold) {
    MapPull(threshold).also { pull ->
      fun begin() {
        if (!pull.peeking) {
          pull.peeking = true
          started()
        }
      }
      fun end() {
        if (pull.peeking) {
          pull.peeking = false
          cancelled()
        }
      }
      suspend fun moveTo(target: Float, spec: AnimationSpec<Float>) {
        if (still) pull.offset = target else animate(pull.offset, target, animationSpec = spec) { value, _ -> pull.offset = value }
      }
      pull.connection =
        object : NestedScrollConnection {
          override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            // Scrolling back up while pulled: undo the pull first, then the page scrolls.
            if (pull.offset > 0f && available.y < 0f) {
              val used = maxOf(available.y, -pull.offset)
              pull.offset += used
              // Pushed all the way back: the map goes back as it was.
              if (pull.offset <= 0f) end()
              return Offset(0f, used)
            }
            return Offset.Zero
          }

          override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (!on || source != NestedScrollSource.UserInput || available.y <= 0f) return Offset.Zero
            val before = pull.offset
            begin()
            val after = (before + available.y * 0.5f).coerceAtMost(threshold * PULL_STRETCH)
            if (before < threshold && after >= threshold) haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            pull.offset = after
            return Offset(0f, available.y)
          }

          override suspend fun onPreFling(available: Velocity): Velocity {
            val was = pull.offset
            if (was <= 0f) return Velocity.Zero
            if (was >= threshold) {
              // The page carries on down and off the screen, leaving the map it was covering; then the stack pops.
              // No longer a preview: the map keeps the site.
              pull.peeking = false
              moveTo(maxOf(pull.pageHeight, was), tween(220))
              pulled()
            } else {
              end()
              moveTo(0f, spring(stiffness = Spring.StiffnessMediumLow))
            }
            return available
          }
        }
    }
  }
  // The page leaving mid-pull (a back gesture) must not leave the map previewing.
  DisposableEffect(pull) { onDispose { if (pull.peeking) { pull.peeking = false; cancelled() } } }
  return pull
}

/** "Pull down for the map", then "Release for the map": fades in with the pull, so it is gone when not pulling. */
@Composable
private fun PullHint(pull: MapPull, modifier: Modifier = Modifier) {
  val colors = CurrentTheme.colors
  // Fully there by a third of the way, so it reads over the busy header from early on.
  val shown = (pull.offset / (pull.threshold / 3f)).coerceIn(0f, 1f)
  if (shown <= 0f) return
  Row(
    modifier
      .graphicsLayer { alpha = shown }
      .clip(CircleShape)
      .background(colors.ink.copy(alpha = 0.92f))
      .border(1.dp, if (pull.ready) colors.incoming else colors.line, CircleShape)
      .padding(horizontal = 16.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Icon(TabIcons.of(Tab.Now), contentDescription = null, tint = if (pull.ready) colors.incoming else colors.foam, modifier = Modifier.size(18.dp))
    Text(
      if (pull.ready) "Release for the map" else "Pull down for the map",
      style = MaterialTheme.typography.labelLarge,
      color = if (pull.ready) colors.incoming else colors.foam,
    )
  }
}

/** How far the page is pulled down before letting go opens the map. */
private val PULL_TO_MAP = 96.dp

/** How far past [PULL_TO_MAP] the page can be dragged, as a multiple of it. */
private const val PULL_STRETCH = 1.6f
