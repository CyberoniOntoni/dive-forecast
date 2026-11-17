package app.fiftybar.divecurrent.ui.site

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.data.api.ApiHour
import app.fiftybar.divecurrent.data.api.ApiSeaStateHour
import app.fiftybar.divecurrent.data.api.SeaBand
import app.fiftybar.divecurrent.data.api.Strength
import app.fiftybar.divecurrent.domain.Glance
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.ui.theme.CurrentColors

/**
 * The week at a glance, as under the web slider: a bar per hour (height by strength, colour by way, faded by
 * confidence), the residual tide as a line, midnight ticks, a sea-state band along the bottom, and a marker on the
 * selected hour. Tap or drag to pick an hour.
 */
@Composable
fun ForecastStrip(
  hours: List<ApiHour>,
  glances: List<Glance?>,
  seaState: List<ApiSeaStateHour>?,
  selected: Int,
  onSelect: (Int) -> Unit,
  colors: CurrentColors,
) {
  val select by rememberUpdatedState(onSelect)
  val count = hours.size
  val seaByTime = seaState?.associateBy { it.time }.orEmpty()
  val levels = hours.map { it.levelM }
  val maxAbs = (levels.maxOfOrNull { kotlin.math.abs(it) } ?: 0.0).coerceAtLeast(0.05)

  fun indexAt(x: Float, width: Float): Int = ((x / width) * count).toInt().coerceIn(0, count - 1)

  Canvas(
    Modifier.fillMaxWidth()
      .height(96.dp)
      .pointerInput(count) { detectTapGestures { select(indexAt(it.x, size.width.toFloat())) } }
      .pointerInput(count) {
        detectHorizontalDragGestures { change, _ -> select(indexAt(change.position.x, size.width.toFloat())) }
      }
  ) {
    if (count == 0) return@Canvas
    val w = size.width
    val seaH = if (seaState != null) 8.dp.toPx() else 0f
    val barsH = size.height - seaH - 4.dp.toPx()
    val step = w / count

    hours.forEachIndexed { i, hour ->
      val g = glances[i]
      val x = i * step
      if (g != null) {
        val frac =
          when (g.strength) {
            Strength.Slack -> 0.12f
            Strength.Mild -> 0.4f
            Strength.Strong -> 0.72f
            Strength.TooStrong -> 1f
          }
        val h = barsH * frac
        // Fainter for lower confidence, but never so faint the colour turns muddy on the navy.
        drawRect(colors.tone(g.tone), Offset(x, barsH - h), Size(step.coerceAtLeast(1f), h), alpha = 0.45f + 0.5f * g.opacity)
      }
      if (MaldivesTime.parse(hour.time)?.hour == 0 && i > 0) {
        drawLine(colors.foam.copy(alpha = 0.35f), Offset(x, 0f), Offset(x, barsH), strokeWidth = 1.dp.toPx())
      }
      seaByTime[hour.time]?.let { s ->
        val band = SeaBand.of(s.band)
        val c =
          when (band) {
            SeaBand.Calm -> colors.incoming.copy(alpha = 0.35f)
            SeaBand.Moderate -> colors.foam.copy(alpha = 0.45f)
            SeaBand.Choppy -> colors.outgoing.copy(alpha = 0.8f)
            SeaBand.Rough -> colors.stop
            null -> colors.foam.copy(alpha = 0.1f)
          }
        drawRect(c, Offset(x, size.height - seaH), Size(step.coerceAtLeast(1f), seaH))
      }
    }

    // Residual tide, centred in the bar area.
    val mid = barsH / 2
    val tide = Path()
    levels.forEachIndexed { i, level ->
      val px = i * step + step / 2
      val py = (mid - (level / maxAbs) * (barsH * 0.45)).toFloat()
      if (i == 0) tide.moveTo(px, py) else tide.lineTo(px, py)
    }
    // A dark casing so the line still reads over foam bars along a reef.
    drawPath(tide, colors.ink, style = Stroke(width = 3.5.dp.toPx()))
    drawPath(tide, colors.tide, style = Stroke(width = 1.5.dp.toPx()))

    val sx = selected.coerceIn(0, count - 1) * step + step / 2
    drawLine(colors.foam, Offset(sx, 0f), Offset(sx, size.height), strokeWidth = 2.dp.toPx())
  }
}
