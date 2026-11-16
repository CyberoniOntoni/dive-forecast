package app.fiftybar.divecurrent.ui.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.data.api.ApiShelterScale
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.ShelterField
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/**
 * The sheltered-water legend, as the web map's: the hour shown with earlier, later and now, the colour scale with its
 * named points, the note (zoom in, still loading, old data), and the sea state at the last spot tapped.
 */
@Composable
fun ShelterLegend(
  state: ShelterUiState,
  onStep: (Int) -> Unit,
  onNow: () -> Unit,
  onCloseReadout: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val colors = CurrentTheme.colors
  val at = state.hours.indexOf(state.time)
  Surface(modifier, shape = RoundedCornerShape(12.dp), color = colors.glass, contentColor = colors.foam) {
    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Sea state", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        TextButton(onClick = onNow, enabled = at > 0) { Text("Now") }
      }
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onStep(-1) }, enabled = at > 0, modifier = Modifier.size(44.dp).semantics { contentDescription = "Earlier hour" }) {
          Text("‹", style = MaterialTheme.typography.titleLarge)
        }
        Text(
          state.time?.let(MaldivesTime::label) ?: "…",
          style = MaterialTheme.typography.bodyMedium,
          fontWeight = FontWeight.SemiBold,
          modifier = Modifier.weight(1f).semantics { contentDescription = "Hour shown: ${state.time?.let(MaldivesTime::label) ?: "loading"}" },
        )
        IconButton(
          onClick = { onStep(1) },
          enabled = at >= 0 && at < state.hours.size - 1,
          modifier = Modifier.size(44.dp).semantics { contentDescription = "Later hour" },
        ) {
          Text("›", style = MaterialTheme.typography.titleLarge)
        }
      }
      if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))
      state.scale?.let { ScaleBar(it) }
      state.note?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.8f), modifier = Modifier.padding(top = 4.dp))
      }
      state.readout?.let { readout ->
        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.Top) {
          Column(Modifier.weight(1f)) {
            Text(readout.head, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(readout.detail, style = MaterialTheme.typography.bodySmall)
          }
          IconButton(onClick = onCloseReadout, modifier = Modifier.size(36.dp)) { Icon(Icons.Filled.Close, "Close the sea state") }
        }
      }
    }
  }
}

/**
 * The colour bar over 0 to the scale's top, with its ends named at their heights (Calm and Rough), as the web's legend
 * does on a phone; the colours between speak for themselves.
 */
@Composable
private fun ScaleBar(scale: ApiShelterScale) {
  val colors = CurrentTheme.colors
  val stops =
    scale.stops
      .sortedBy { it.m }
      .map { stop ->
        val (r, g, b) = ShelterField.rgb(stop.color).toList()
        (stop.m / scale.maxM).toFloat().coerceIn(0f, 1f) to Color(r, g, b)
      }
  if (stops.size < 2) return
  Column(Modifier.padding(top = 4.dp)) {
    Box(
      Modifier.fillMaxWidth()
        .height(10.dp)
        .background(Brush.horizontalGradient(*stops.toTypedArray()), RoundedCornerShape(5.dp))
    )
    BoxWithConstraints(Modifier.fillMaxWidth().height(30.dp)) {
      val width = maxWidth
      listOfNotNull(scale.ticks.firstOrNull(), scale.ticks.lastOrNull()).distinct().forEach { tick ->
        val share = (tick.m / scale.maxM).toFloat().coerceIn(0f, 1f)
        // A name past the middle sits left of its mark, so it stays over the bar.
        val label = if (tick.m > 0) "${tick.label}\n${"%.1f".format(java.util.Locale.ROOT, tick.m)} m" else tick.label
        Text(
          label,
          style = MaterialTheme.typography.labelSmall,
          color = colors.foam.copy(alpha = 0.85f),
          modifier = Modifier.width(64.dp).offset(x = (width * share - if (share > 0.7f) 64.dp else 0.dp).coerceAtLeast(0.dp)),
        )
      }
    }
  }
}
