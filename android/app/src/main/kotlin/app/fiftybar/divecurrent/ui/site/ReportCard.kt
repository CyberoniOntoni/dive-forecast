package app.fiftybar.divecurrent.ui.site

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.data.api.ApiRecentReport
import app.fiftybar.divecurrent.data.api.Strength
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.ReportTime
import app.fiftybar.divecurrent.domain.asForecastLabel
import app.fiftybar.divecurrent.domain.strengthWord
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import java.time.LocalDate
import java.time.LocalTime

private const val DAY_MS = 24L * 60 * 60 * 1000

/**
 * "Report the current", as on the web: pick when, then one tap if it ran as forecast, or which way and how strong.
 * Signed out, it offers sign-in instead.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ReportCard(
  state: SiteUiState,
  nickname: String?,
  timeOf: (ReportFormState) -> String?,
  onSignIn: () -> Unit,
  onQuick: (Int) -> Unit,
  onOther: (String) -> Unit,
  onDirection: (String) -> Unit,
  onStrength: (Strength) -> Unit,
  onSend: () -> Unit,
  onAsForecast: () -> Unit,
) {
  val colors = CurrentTheme.colors
  val form = state.report
  SurfaceCard {
    Text("Report the current", style = MaterialTheme.typography.titleSmall)
    if (nickname == null) {
      Text(
        "Sign in with your email to report what the current did on your dive. Reports sharpen the forecast for " +
          "everyone, and earn points on the scoreboard.",
        style = MaterialTheme.typography.bodyMedium,
      )
      form.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
      Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Sign in to report") }
      return@SurfaceCard
    }
    Text(
      "Pick when, then one tap if it ran as forecast, or which way and how strong. Times are Maldives time. " +
        "Reporting as $nickname.",
      style = MaterialTheme.typography.bodySmall,
      color = colors.foam.copy(alpha = 0.8f),
    )

    var pickDate by remember { mutableStateOf(false) }
    var pickedDate by remember { mutableStateOf<LocalDate?>(null) }
    Text("When were you in the water?", style = MaterialTheme.typography.labelLarge)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      ReportTime.QUICK_HOURS.forEach { hours ->
        FilterChip(
          selected = form.quickHours == hours,
          onClick = { onQuick(hours) },
          label = { Text(ReportTime.quickLabel(hours)) },
          modifier = Modifier.heightIn(min = 44.dp),
        )
      }
      FilterChip(
        selected = form.quickHours == null,
        onClick = { pickDate = true },
        label = { Text(form.otherWall?.takeIf { form.quickHours == null }?.let(MaldivesTime::label) ?: "Other") },
        modifier = Modifier.heightIn(min = 44.dp),
      )
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
        onPicked = { time ->
          pickedDate = null
          onOther(ReportTime.wall(date, time))
        },
        onDismiss = { pickedDate = null },
      )
    }

    val time = timeOf(form)
    val ways = state.forecast?.reportWays
    val incoming = ways?.incoming ?: "Incoming"
    val outgoing = ways?.outgoing ?: "Outgoing"
    val shown = time?.let { ReportTime.forecastAt(state.forecast?.hours.orEmpty(), it) }
    val busy = form.sending || form.savedLine != null
    shown?.let { asForecastLabel(it, incoming, outgoing) }?.let { label ->
      OutlinedButton(onClick = onAsForecast, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(label)
      }
    }
    Text(
      (if (shown != null) "Or say how it was: " else "") + (ways?.legend ?: "Incoming or outgoing"),
      style = MaterialTheme.typography.labelLarge,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      listOf("incoming" to incoming, "outgoing" to outgoing).forEach { (value, words) ->
        FilterChip(
          selected = form.direction == value,
          onClick = { onDirection(value) },
          label = { Text(words) },
          modifier = Modifier.weight(1f).heightIn(min = 44.dp),
        )
      }
    }
    Text("Slack, mild, strong, or very strong", style = MaterialTheme.typography.labelLarge)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Strength.entries.forEach { strength ->
        FilterChip(
          selected = form.strength == strength,
          onClick = { onStrength(strength) },
          label = { Text(strengthWord(strength).replaceFirstChar { it.uppercase() }) },
          modifier = Modifier.heightIn(min = 44.dp),
        )
      }
    }
    Button(
      onClick = onSend,
      enabled = !busy && time != null && form.direction != null && form.strength != null,
      modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) {
      Text(if (form.sending) "Sending…" else "Send report")
    }
    val outcome = form.error ?: form.savedLine
    outcome?.let {
      Text(
        it,
        color = if (form.error != null) colors.stop else colors.foam,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
      )
    }
    if (form.error == "Sign in again to report.") {
      TextButton(onClick = onSignIn) { Text("Sign in") }
    }
  }
}

/** Days from 14 days back to today, Maldives date. The picker's dates are UTC midnights. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReportDateDialog(initial: LocalDate, onPicked: (LocalDate) -> Unit, onDismiss: () -> Unit) {
  val today = ReportTime.today()
  val earliest = today.minusDays(ReportTime.MAX_AGE_DAYS)
  val picker =
    rememberDatePickerState(
      initialSelectedDateMillis = initial.toEpochDay() * DAY_MS,
      selectableDates =
        object : SelectableDates {
          override fun isSelectableDate(utcTimeMillis: Long): Boolean {
            val day = LocalDate.ofEpochDay(Math.floorDiv(utcTimeMillis, DAY_MS))
            return !day.isBefore(earliest) && !day.isAfter(today)
          }

          override fun isSelectableYear(year: Int): Boolean = year in earliest.year..today.year
        },
    )
  DatePickerDialog(
    onDismissRequest = onDismiss,
    confirmButton = {
      TextButton(
        onClick = { picker.selectedDateMillis?.let { onPicked(LocalDate.ofEpochDay(Math.floorDiv(it, DAY_MS))) } },
        enabled = picker.selectedDateMillis != null,
      ) {
        Text("Next")
      }
    },
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  ) {
    DatePicker(state = picker, title = { Text("Day of the dive", Modifier.padding(start = 24.dp, top = 16.dp)) })
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReportClockDialog(initial: LocalTime, onPicked: (LocalTime) -> Unit, onDismiss: () -> Unit) {
  val picker = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute, is24Hour = true)
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("Time in the water, Maldives time") },
    text = { TimePicker(state = picker) },
    confirmButton = { TextButton(onClick = { onPicked(LocalTime.of(picker.hour, picker.minute)) }) { Text("Done") } },
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  )
}

/** Divers' newest reports, as the site page lists them, with what the forecast said at that hour. */
@Composable
internal fun RecentReportsCard(reports: List<ApiRecentReport>?) {
  val colors = CurrentTheme.colors
  if (reports == null) return
  SurfaceCard {
    Text("Recent reports", style = MaterialTheme.typography.titleSmall)
    if (reports.isEmpty()) {
      Text("No reports yet. Add one above after your dive.", style = MaterialTheme.typography.bodyMedium)
      return@SurfaceCard
    }
    reports.forEachIndexed { index, report ->
      if (index > 0) HorizontalDivider(color = colors.foam.copy(alpha = 0.08f))
      Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("${report.way}, ${report.strength}", style = MaterialTheme.typography.bodyLarge)
        val meta = listOfNotNull(report.`when`, report.ago, report.by?.let { "by $it" })
        Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.75f))
        val f = report.forecast
        val verdict =
          when (f?.match) {
            "match" -> "forecast matched"
            "close" -> "right way, strength off"
            "miss" -> "forecast had the other way"
            else -> null
          }
        Text(
          if (f == null) "No forecast saved"
          else "Forecast: ${f.way}, ${f.strength}" + (verdict?.let { " · $it" } ?: ""),
          style = MaterialTheme.typography.bodySmall,
          color = if (f?.match == "miss") colors.stop else colors.foam.copy(alpha = 0.75f),
        )
        if (report.beforeAxis) {
          Text(
            "Filed when this site was still forecast as incoming or outgoing, before it showed a compass direction.",
            style = MaterialTheme.typography.bodySmall,
            color = colors.foam.copy(alpha = 0.6f),
          )
        }
      }
    }
  }
}
