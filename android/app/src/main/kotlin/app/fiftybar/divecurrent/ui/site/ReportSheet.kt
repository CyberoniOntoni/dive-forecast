package app.fiftybar.divecurrent.ui.site

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.data.api.GlanceTone
import app.fiftybar.divecurrent.data.api.Strength
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.ReportTime
import app.fiftybar.divecurrent.domain.asForecastLabel
import app.fiftybar.divecurrent.domain.glance
import app.fiftybar.divecurrent.domain.strengthWord
import app.fiftybar.divecurrent.ui.components.CurrentArrow
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import app.fiftybar.divecurrent.ui.theme.Eyebrow
import java.time.LocalDate
import java.time.LocalTime

/** What the report sheet calls back to; all of it goes to [SiteViewModel]. */
internal class ReportActions(
  val timeOf: (ReportFormState) -> String?,
  val onQuick: (Int) -> Unit,
  val onOther: (String) -> Unit,
  val onDirection: (String) -> Unit,
  val onStrength: (Strength) -> Unit,
  val onSend: () -> Unit,
  val onAsForecast: () -> Unit,
  val onDone: () -> Unit,
)

/**
 * "Report the current" as a sheet over the site page: when you were in the water, then one tap if it ran as forecast,
 * or which way (two big halves) and how strong (four targets drawn as the day chart's bars), then Send. What a report
 * earns floats up as "+N". Signed out, it offers sign-in instead.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReportSheet(
  state: SiteUiState,
  nickname: String?,
  actions: ReportActions,
  reducedMotion: Boolean,
  onSignIn: () -> Unit,
  onDismiss: () -> Unit,
) {
  val colors = CurrentTheme.colors
  val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheet,
    containerColor = colors.deep,
    contentColor = colors.foam,
    shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
  ) {
    Column(
      Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 16.dp).navigationBarsPadding(),
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      Text("Report the current", style = MaterialTheme.typography.headlineSmall)
      if (nickname == null) {
        Text(
          "Sign in with your email to report what the current did on your dive. Reports sharpen the forecast for " +
            "everyone, and earn points on the scoreboard.",
          style = MaterialTheme.typography.bodyMedium,
          color = colors.mist,
        )
        state.report.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
        BigButton("Sign in to report", colors.incoming, colors.ink, onClick = onSignIn)
        return@Column
      }
      val saved = state.report.savedLine
      AnimatedContent(
        targetState = saved != null,
        transitionSpec = { if (reducedMotion) fadeIn(tween(0)) togetherWith fadeOut(tween(0)) else fadeIn(tween(220)) togetherWith fadeOut(tween(120)) },
        label = "report",
      ) { done ->
        if (done) Saved(state.report, reducedMotion, actions.onDone)
        else Form(state, nickname, actions, onSignIn)
      }
    }
  }
}

@Composable
private fun Form(state: SiteUiState, nickname: String, actions: ReportActions, onSignIn: () -> Unit) {
  val colors = CurrentTheme.colors
  val form = state.report
  val hours = state.forecast?.hours.orEmpty()
  val ways = state.forecast?.reportWays
  val incoming = ways?.incoming ?: "Incoming"
  val outgoing = ways?.outgoing ?: "Outgoing"
  // Along a reef "incoming" means toward the reef's heading, not into an atoll: no in/out colours there.
  val along = hours.firstNotNullOfOrNull { glance(it) }?.tone == GlanceTone.Along
  val time = actions.timeOf(form)
  val shown = time?.let { ReportTime.forecastAt(hours, it) }
  val busy = form.sending
  Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
    Text("Maldives time · reporting as $nickname", style = MaterialTheme.typography.bodySmall, color = colors.mist)

    Text("WHEN WERE YOU IN THE WATER?", style = Eyebrow, color = colors.dim)
    TimeChips(form, actions)

    shown?.let { hour ->
      val label = asForecastLabel(hour, incoming, outgoing) ?: return@let
      val tone =
        when {
          along -> colors.foam
          hour.strength == Strength.TooStrong.wire -> colors.stop
          hour.direction == "incoming" -> colors.incoming
          else -> colors.outgoing
        }
      Button(
        onClick = actions.onAsForecast,
        enabled = !busy,
        shape = RoundedCornerShape(18.dp),
        colors = ButtonDefaults.buttonColors(containerColor = tone, contentColor = colors.ink),
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
      ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
          Text("✓  ${label.substringBefore(":")}", style = MaterialTheme.typography.titleMedium)
          Text(label.substringAfter(": "), style = MaterialTheme.typography.bodySmall, color = colors.ink.copy(alpha = 0.75f))
        }
      }
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(1.dp).background(colors.line))
        Text("  or say how it was  ", style = MaterialTheme.typography.bodySmall, color = colors.dim)
        Box(Modifier.weight(1f).height(1.dp).background(colors.line))
      }
    }

    Text((ways?.legend ?: "Incoming or outgoing").uppercase(), style = Eyebrow, color = colors.dim)
    Row(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      listOf("incoming" to incoming, "outgoing" to outgoing).forEach { (value, words) ->
        val tone = if (along) colors.foam else if (value == "incoming") colors.incoming else colors.outgoing
        // The arrow this site shows for that way, from any hour of the week that runs it.
        val bearing = hours.firstOrNull { it.direction == value }?.let { glance(it)?.arrowBearing }
        WayHalf(words, tone, bearing, selected = form.direction == value, modifier = Modifier.weight(1f)) { actions.onDirection(value) }
      }
    }

    Text("HOW STRONG?", style = Eyebrow, color = colors.dim)
    Row(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Strength.entries.forEach { strength ->
        StrengthTarget(strength, selected = form.strength == strength, modifier = Modifier.weight(1f)) { actions.onStrength(strength) }
      }
    }

    BigButton(
      if (form.sending) "Sending…" else "Send report",
      colors.foam,
      colors.ink,
      enabled = !busy && time != null && form.direction != null && form.strength != null,
      onClick = actions.onSend,
    )
    form.error?.let {
      Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
    if (form.error == "Sign in again to report.") {
      TextButton(onClick = onSignIn) { Text("Sign in") }
    }
  }
}

/** This hour, 1 to 3 h ago, or a picked day and time (back 14 days). */
@Composable
private fun TimeChips(form: ReportFormState, actions: ReportActions) {
  var pickDate by remember { mutableStateOf(false) }
  var pickedDate by remember { mutableStateOf<LocalDate?>(null) }
  Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    ReportTime.QUICK_HOURS.forEach { hours ->
      Pill(ReportTime.quickLabel(hours), selected = form.quickHours == hours) { actions.onQuick(hours) }
    }
    Pill(form.otherWall?.takeIf { form.quickHours == null }?.let(MaldivesTime::label) ?: "Other…", selected = form.quickHours == null) { pickDate = true }
  }
  if (pickDate) {
    ReportDateDialog(
      initial = form.otherWall?.let(MaldivesTime::parse)?.toLocalDate() ?: ReportTime.today(),
      onPicked = {
        pickDate = false
        pickedDate = it
      },
      onDismiss = { pickDate = false },
    )
  }
  pickedDate?.let { date ->
    ReportClockDialog(
      initial = form.otherWall?.let(MaldivesTime::parse)?.toLocalTime() ?: LocalTime.of(9, 0),
      onPicked = { t ->
        pickedDate = null
        actions.onOther(ReportTime.wall(date, t))
      },
      onDismiss = { pickedDate = null },
    )
  }
}

@Composable
private fun Pill(label: String, selected: Boolean, onClick: () -> Unit) {
  val colors = CurrentTheme.colors
  Box(
    Modifier.heightIn(min = 44.dp)
      .clip(CircleShape)
      .background(if (selected) colors.foam else colors.reef)
      .border(1.dp, if (selected) colors.foam else colors.edge, CircleShape)
      .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
      .padding(horizontal = 16.dp),
    contentAlignment = Alignment.Center,
  ) {
    Text(label, style = MaterialTheme.typography.labelLarge, color = if (selected) colors.ink else colors.foam, maxLines = 1)
  }
}

/** One half of the way picker: the site's arrow for that way and its words, lit in the way's colour when picked. */
@Composable
private fun WayHalf(words: String, tone: Color, bearing: Double?, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
  val colors = CurrentTheme.colors
  val lift by animateFloatAsState(if (selected) 1f else 0f, spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMediumLow), label = "way")
  Row(
    modifier
      .heightIn(min = 64.dp)
      .clip(RoundedCornerShape(18.dp))
      .background(tone.copy(alpha = 0.06f + 0.16f * lift))
      .border(BorderStroke((1 + lift).dp, if (selected) tone else colors.edge), RoundedCornerShape(18.dp))
      .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
      .padding(horizontal = 14.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    if (bearing != null) CurrentArrow(bearing = bearing, color = tone, alpha = 0.5f + 0.5f * lift, size = 28.dp, edge = colors.ink)
    Text(words.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleMedium, color = if (selected) tone else colors.foam)
  }
}

/** A strength as a tall target with its bar from the day chart inside, so the four read as a scale. */
@Composable
private fun StrengthTarget(strength: Strength, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
  val colors = CurrentTheme.colors
  val tone = if (strength == Strength.TooStrong) colors.stop else colors.foam
  val lift by animateFloatAsState(if (selected) 1f else 0f, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessMediumLow), label = "strength")
  Column(
    modifier
      .height(104.dp)
      .clip(RoundedCornerShape(16.dp))
      .background(if (selected) tone.copy(alpha = 0.14f) else colors.reef)
      .border(BorderStroke((1 + lift).dp, if (selected) tone else colors.edge), RoundedCornerShape(16.dp))
      .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
      .padding(vertical = 10.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Box(Modifier.weight(1f).width(14.dp), contentAlignment = Alignment.BottomCenter) {
      Box(
        Modifier.fillMaxWidth()
          .fillMaxHeight(strengthLevel(strength) * (0.85f + 0.15f * lift))
          .clip(RoundedCornerShape(4.dp))
          .background(tone.copy(alpha = 0.35f + 0.65f * lift))
      )
    }
    Spacer(Modifier.height(8.dp))
    Text(
      strengthWord(strength).replaceFirstChar { it.uppercase() },
      style = MaterialTheme.typography.labelMedium,
      color = if (selected) tone else colors.mist,
      textAlign = TextAlign.Center,
      maxLines = 1,
    )
  }
}

@Composable
private fun BigButton(label: String, container: Color, content: Color, enabled: Boolean = true, onClick: () -> Unit) {
  Button(
    onClick = onClick,
    enabled = enabled,
    shape = RoundedCornerShape(18.dp),
    colors = ButtonDefaults.buttonColors(containerColor = container, contentColor = content),
    modifier = Modifier.fillMaxWidth().height(56.dp),
  ) {
    Text(label, style = MaterialTheme.typography.titleMedium)
  }
}

/** After sending: what it earned floats up as "+N" and fades, over the thanks line and Done. */
@Composable
private fun Saved(form: ReportFormState, reducedMotion: Boolean, onDone: () -> Unit) {
  val colors = CurrentTheme.colors
  val rise = remember { Animatable(if (reducedMotion) 1f else 0f) }
  LaunchedEffect(Unit) { if (!reducedMotion) rise.animateTo(1f, tween(1400, easing = FastOutSlowInEasing)) }
  Column(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Box(Modifier.height(88.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
      Box(Modifier.size(64.dp).clip(CircleShape).background(colors.incoming.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
        Text("✓", style = MaterialTheme.typography.headlineMedium, color = colors.incoming)
      }
      form.savedPoints?.takeIf { it > 0 }?.let { points ->
        // Rises from the tick and fades out; with animations off it simply sits beside it.
        Text(
          "+$points",
          style = MaterialTheme.typography.headlineSmall,
          color = colors.incoming,
          modifier =
            Modifier.align(Alignment.Center)
              .offset(x = 52.dp, y = (-8 - 28 * rise.value).dp)
              .alpha(if (reducedMotion) 1f else (1.6f - 1.6f * rise.value).coerceIn(0f, 1f)),
        )
      }
    }
    Text(
      form.savedLine ?: "",
      style = MaterialTheme.typography.bodyLarge,
      textAlign = TextAlign.Center,
      modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
    BigButton("Done", colors.foam, colors.ink, onClick = onDone)
  }
}
