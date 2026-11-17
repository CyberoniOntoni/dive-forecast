package app.fiftybar.divecurrent.ui.site

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.ui.components.ClockDialog
import app.fiftybar.divecurrent.data.api.ApiRecentReport
import app.fiftybar.divecurrent.domain.ReportTime
import app.fiftybar.divecurrent.domain.ageLabel
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import java.time.LocalDate
import java.time.LocalTime

private const val DAY_MS = 24L * 60 * 60 * 1000

/** Days from 14 days back to today, Maldives date. The picker's dates are UTC midnights. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReportDateDialog(initial: LocalDate, onPicked: (LocalDate) -> Unit, onDismiss: () -> Unit) {
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

@Composable
internal fun ReportClockDialog(initial: LocalTime, onPicked: (LocalTime) -> Unit, onDismiss: () -> Unit) =
  ClockDialog("Time in the water, Maldives time", initial, onPicked, onDismiss)

/** Divers' newest reports, as the site page lists them, with what the forecast said at that hour. */
@Composable
internal fun RecentReportsCard(reports: List<ApiRecentReport>?, offlineSavedAt: Long?) {
  val colors = CurrentTheme.colors
  if (reports == null) return
  SurfaceCard {
    Text("Recent reports", style = MaterialTheme.typography.titleSmall)
    offlineSavedAt?.let {
      Text(
        "Offline copy saved ${ageLabel(it)}; times ago are from then.",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.75f),
      )
    }
    if (reports.isEmpty()) {
      Text("No reports yet. Tap Report current after your dive.", style = MaterialTheme.typography.bodyMedium)
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
