package app.fiftybar.divecurrent.ui.plan

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.BuildConfig
import app.fiftybar.divecurrent.data.api.ApiPlan
import app.fiftybar.divecurrent.data.api.ApiPlanDay
import app.fiftybar.divecurrent.data.api.ApiPlanLeg
import app.fiftybar.divecurrent.data.api.ApiPlanStop
import app.fiftybar.divecurrent.domain.ageLabel
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.components.CurrentArrow
import app.fiftybar.divecurrent.ui.theme.CurrentColors
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/**
 * A dive plan as its web page shows it: each day's dives with the forecast at the dive time and its warnings, and the
 * boat legs with when to leave. Kept on the phone, so it still opens out of signal. Changing it is on the web for now.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanScreen(
  planId: String,
  onBack: () -> Unit,
  onOpenSite: (siteId: String) -> Unit,
  onReport: (siteId: String, time: String) -> Unit,
) {
  val repository = appRepository()
  val account = appAccount()
  val viewModel: PlanViewModel = viewModel(key = "plan/$planId") { PlanViewModel(planId, repository, account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  val context = LocalContext.current
  val uri = LocalUriHandler.current
  val plan = state.plan
  val webUrl = "${BuildConfig.WEB_URL}/plans/$planId"

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text(plan?.title ?: "Dive plan", maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        actions = {
          IconButton(onClick = viewModel::refresh) { Icon(Icons.Filled.Refresh, "Refresh the plan") }
          IconButton(
            onClick = {
              val text = listOfNotNull(plan?.title, plan?.span?.takeIf { it.isNotBlank() }, webUrl).joinToString("\n")
              val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
              }
              context.startActivity(Intent.createChooser(send, "Share this plan"))
            }
          ) {
            Icon(Icons.Filled.Share, "Share this plan")
          }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    LazyColumn(
      Modifier.fillMaxSize().padding(padding),
      contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      item {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
          if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
          when {
            state.notFound -> Text("No plan at this link. It may have been deleted.", color = colors.stop)
            plan == null -> if (!state.loading) Text(state.error ?: "Could not load the plan.", color = colors.stop)
            else -> PlanHeader(plan, state, onEdit = { uri.openUri("$webUrl/edit") })
          }
        }
      }
      if (plan != null && !state.notFound) {
        itemsIndexed(plan.days, key = { _, day -> day.date }) { index, day ->
          DayCard(
            index = index,
            day = day,
            legs = state.legs[index],
            legsFailed = index in state.legsFailed,
            colors = colors,
            onOpenSite = onOpenSite,
            onReport = onReport,
          )
        }
      }
    }
  }
}

@Composable
private fun PlanHeader(plan: ApiPlan, state: PlanUiState, onEdit: () -> Unit) {
  val colors = CurrentTheme.colors
  val facts = listOfNotNull(plan.span.takeIf { it.isNotBlank() }, plan.ownerNickname?.let { "by $it" }, "boat ${trim(plan.boatSpeedKn)} kn")
  Text(facts.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = colors.foam)
  if (state.fromCache) {
    state.savedAt?.let {
      Text(
        "Offline copy saved ${ageLabel(it)}. The forecast in it is from then.",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.75f),
      )
    }
  }
  plan.notes?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = colors.foam) }
  if (plan.isOwner) {
    OutlinedButton(onClick = onEdit, modifier = Modifier.heightIn(min = 44.dp)) { Text("Edit on the web") }
  }
}

private fun trim(value: Double): String = if (value == Math.floor(value)) value.toInt().toString() else value.toString()

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DayCard(
  index: Int,
  day: ApiPlanDay,
  legs: List<ApiPlanLeg>?,
  legsFailed: Boolean,
  colors: CurrentColors,
  onOpenSite: (String) -> Unit,
  onReport: (String, String) -> Unit,
) {
  Card(
    shape = RoundedCornerShape(24.dp),
    colors = CardDefaults.cardColors(containerColor = colors.glass, contentColor = colors.foam),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
          "Day ${index + 1} · ${day.label}",
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          modifier = Modifier.semantics { heading() },
        )
        if (day.today) Badge("Today", colors.incoming)
        else if (day.past) Badge("Done", colors.foam.copy(alpha = 0.7f))
        if (day.toCheck > 0) Badge(if (day.toCheck == 1) "1 dive to check" else "${day.toCheck} dives to check", colors.stop)
      }
      if (day.stops.isEmpty()) Text("No dives planned yet.", style = MaterialTheme.typography.bodyMedium)
      day.stops.forEachIndexed { at, stop ->
        StopRow(at + 1, stop, colors, onOpenSite = { onOpenSite(stop.siteId) }, onReport = { t -> onReport(stop.siteId, t) })
        if (at + 1 < day.stops.size) LegRow(legs?.firstOrNull { it.from == at }, loading = legs == null && !legsFailed, colors)
      }
    }
  }
}

@Composable
private fun Badge(text: String, color: Color) {
  Text(
    text,
    style = MaterialTheme.typography.labelMedium,
    fontWeight = FontWeight.SemiBold,
    color = color,
    modifier = Modifier.background(color.copy(alpha = 0.15f), RoundedCornerShape(12.dp)).padding(horizontal = 10.dp, vertical = 2.dp),
  )
}

private fun toneColor(tone: String, colors: CurrentColors): Color =
  when (tone) {
    "incoming" -> colors.incoming
    "outgoing" -> colors.outgoing
    "stop" -> colors.stop
    else -> colors.foam
  }

@Composable
private fun StopRow(number: Int, stop: ApiPlanStop, colors: CurrentColors, onOpenSite: () -> Unit, onReport: (String) -> Unit) {
  val tone = toneColor(stop.tone, colors)
  var showHow by rememberSaveable(stop.siteId, stop.time) { mutableStateOf(false) }
  Row(
    Modifier.fillMaxWidth().background(colors.foam.copy(alpha = 0.06f), RoundedCornerShape(16.dp)).padding(12.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Box(Modifier.size(32.dp).background(tone, CircleShape), contentAlignment = Alignment.Center) {
      Text("$number", color = colors.ink, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clickable(onClickLabel = "Open the site", onClick = onOpenSite).heightIn(min = 32.dp),
      ) {
        Text(stop.time, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.width(10.dp))
        Text(stop.name, style = MaterialTheme.typography.titleMedium, color = colors.foam, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
      if (stop.facts.isNotBlank()) {
        Text(stop.facts, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.7f))
      }
      Outlook(stop, tone, colors)
      stop.want?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.8f)) }
      stop.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
      stop.howToDive?.let { how ->
        TextButton(onClick = { showHow = !showHow }) { Text(if (showHow) "Hide how to dive it" else "How to dive it") }
        if (showHow) Text(how, style = MaterialTheme.typography.bodyMedium)
      }
      stop.reportTime?.let { time ->
        FilledTonalButton(onClick = { onReport(time) }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Report the current") }
      }
    }
  }
}

@Composable
private fun Outlook(stop: ApiPlanStop, tone: Color, colors: CurrentColors) {
  if (stop.status != "forecast") {
    Text(stop.message ?: "No forecast for this dive.", style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.7f))
    return
  }
  val reading = listOfNotNull(stop.way, stop.strength).joinToString(", ")
  Row(
    verticalAlignment = Alignment.CenterVertically,
    modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "Forecast at the dive: $reading" },
  ) {
    stop.arrowBearing?.let {
      CurrentArrow(bearing = it, color = tone, size = 20.dp)
      Spacer(Modifier.width(6.dp))
    }
    Text(
      reading,
      style = MaterialTheme.typography.bodyMedium,
      fontWeight = FontWeight.Medium,
      color = if (stop.veryStrong) colors.stop else colors.foam,
    )
  }
  val extra = listOfNotNull(stop.sea, stop.confidenceLabel)
  if (extra.isNotEmpty()) {
    Text(
      extra.joinToString(" · "),
      style = MaterialTheme.typography.bodySmall,
      color = if (stop.seaRough) colors.stop else colors.foam.copy(alpha = 0.75f),
    )
  }
  if (stop.warnings.isNotEmpty()) {
    Column(
      Modifier.fillMaxWidth().background(colors.stop.copy(alpha = 0.1f), RoundedCornerShape(12.dp)).padding(10.dp),
      verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
      stop.warnings.forEach { Text("⚠ $it", color = colors.stop, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium) }
      stop.better?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.85f)) }
    }
  }
}

@Composable
private fun LegRow(leg: ApiPlanLeg?, loading: Boolean, colors: CurrentColors) {
  Column(Modifier.fillMaxWidth().padding(start = 28.dp, top = 2.dp, bottom = 2.dp)) {
    HorizontalDivider(color = colors.foam.copy(alpha = 0.12f))
    Spacer(Modifier.height(4.dp))
    if (leg == null) {
      Text(
        if (loading) "Planning the boat route…" else "Boat route unavailable",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.7f),
      )
      return@Column
    }
    leg.leaveBy?.let {
      Text(
        listOfNotNull(it, leg.tightNote).joinToString(" · "),
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.SemiBold,
        color = if (leg.tight) colors.stop else colors.foam,
      )
    }
    Text("⛵ ${leg.text}", style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.8f))
    leg.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.6f)) }
  }
}
