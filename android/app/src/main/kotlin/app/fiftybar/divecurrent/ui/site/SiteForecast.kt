package app.fiftybar.divecurrent.ui.site

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.fiftybar.divecurrent.data.api.ApiForecast
import app.fiftybar.divecurrent.data.api.ApiSeaStateHour
import app.fiftybar.divecurrent.data.api.Confidence
import app.fiftybar.divecurrent.data.api.SeaBand
import app.fiftybar.divecurrent.data.api.Strength
import app.fiftybar.divecurrent.domain.Glance
import app.fiftybar.divecurrent.domain.MaldivesTime
import app.fiftybar.divecurrent.domain.SiteOutlook
import app.fiftybar.divecurrent.domain.TideTrend
import app.fiftybar.divecurrent.domain.TideTurn
import app.fiftybar.divecurrent.domain.compassWord
import app.fiftybar.divecurrent.domain.confidenceLabel
import app.fiftybar.divecurrent.domain.heightLabel
import app.fiftybar.divecurrent.domain.seaBandLabel
import app.fiftybar.divecurrent.ui.components.CurrentArrow
import app.fiftybar.divecurrent.ui.theme.CurrentColors
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import app.fiftybar.divecurrent.ui.theme.Eyebrow
import app.fiftybar.divecurrent.ui.theme.Inter
import kotlin.math.abs
import kotlin.math.roundToInt

/** The week read once per forecast: glances, tide turns, day starts and the hour that is now. */
internal class WeekView(forecast: ApiForecast) {
  val hours = forecast.hours
  val glances: List<Glance?> = hours.map { app.fiftybar.divecurrent.domain.glance(it) }
  val levels: List<Double> = hours.map { it.levelM }
  val turns: List<TideTurn> = SiteOutlook.tideTurns(levels)
  val dayStarts: List<Int> = SiteOutlook.dayStarts(hours.map { it.time })
  val nowIndex: Int = MaldivesTime.currentIndex(hours.map { it.time })
  val maxLevel: Double = (levels.maxOfOrNull { abs(it) } ?: 0.0).coerceAtLeast(0.05)
  val seaByTime: Map<String, ApiSeaStateHour> = forecast.seaState?.associateBy { it.time }.orEmpty()

  fun dayRange(day: Int): IntRange = dayStarts[day] until (dayStarts.getOrNull(day + 1) ?: hours.size)

  /** "13:00" the same day as [from], else "Wed 13:00". */
  fun whenLabel(index: Int, from: Int): String {
    val clock = MaldivesTime.clock(hours[index].time)
    return if (SiteOutlook.dayOf(dayStarts, index) == SiteOutlook.dayOf(dayStarts, from)) clock
    else "${MaldivesTime.dayLabel(hours[index].time).take(3)} $clock"
  }
}

/**
 * The hour's answer: the flow's strength in its colour, the arrow on a compass, which way, and how sure; under it the
 * tide (rising or falling, next high or low) beside when the flow next changes.
 */
@Composable
internal fun HourCard(week: WeekView, selected: Int, reducedMotion: Boolean) {
  val colors = CurrentTheme.colors
  val hour = week.hours.getOrNull(selected) ?: return
  val g = week.glances[selected]
  Card(
    shape = RoundedCornerShape(24.dp),
    colors = CardDefaults.cardColors(containerColor = colors.deep, contentColor = colors.foam),
    border = BorderStroke(1.dp, colors.line),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Box {
      Text(
        (if (selected == week.nowIndex) "Now · " else "${MaldivesTime.dayLabel(hour.time).take(3)} ") + MaldivesTime.clock(hour.time),
        style = MaterialTheme.typography.labelMedium,
        color = colors.dim,
        modifier = Modifier.align(Alignment.TopEnd).padding(top = 14.dp, end = 16.dp),
      )
      if (g == null) {
        Text("No reading for this hour.", modifier = Modifier.padding(20.dp))
      } else {
        Row(
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(18.dp),
          modifier =
            Modifier.padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 16.dp).semantics(mergeDescendants = true) {
              contentDescription = "${g.wayToward}, ${g.label}, ${confidenceLabel(g.confidence)} confidence"
            },
        ) {
          Compass(g, reducedMotion)
          Column(Modifier.weight(1f)) {
            StrengthWord(g, reducedMotion)
            val parts = g.wayToward.split(", ", limit = 2)
            Text(
              buildAnnotatedString {
                append(parts[0].replaceFirstChar { it.uppercase() })
                if (parts.size > 1) withStyle(SpanStyle(color = colors.mist, fontWeight = FontWeight.Medium)) { append(" · ${parts[1]}") }
              },
              style = MaterialTheme.typography.titleMedium,
              modifier = Modifier.padding(top = 6.dp),
            )
            ConfidenceMeter(g.confidence, Modifier.padding(top = 10.dp))
          }
        }
      }
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(colors.line))
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
      TideCell(week, selected, Modifier.weight(1f))
      Box(Modifier.width(1.dp).fillMaxHeight().background(colors.line))
      FlowNextCell(week, selected, Modifier.weight(1f))
    }
  }
}

/** The arrow on a ring with N, E, S, W; it swings the short way round to a new heading with a little spring. */
@Composable
private fun Compass(g: Glance, reducedMotion: Boolean) {
  val colors = CurrentTheme.colors
  val tone = colors.tone(g.tone)
  val angle = remember { Animatable(g.arrowBearing.toFloat()) }
  LaunchedEffect(g.arrowBearing) {
    val delta = ((g.arrowBearing.toFloat() - angle.value) % 360 + 540) % 360 - 180
    val target = angle.value + delta
    if (reducedMotion) angle.snapTo(target)
    else angle.animateTo(target, spring(dampingRatio = 0.55f, stiffness = Spring.StiffnessLow))
  }
  Box(
    Modifier.size(118.dp)
      .clip(CircleShape)
      .background(Brush.radialGradient(listOf(tone.copy(alpha = 0.14f), tone.copy(alpha = 0.02f), Color.Transparent)))
      .border(1.5.dp, colors.edge, CircleShape),
    contentAlignment = Alignment.Center,
  ) {
    val mark = MaterialTheme.typography.labelSmall
    Text("N", style = mark, color = colors.dim, modifier = Modifier.align(Alignment.TopCenter).padding(top = 5.dp))
    Text("E", style = mark, color = colors.dim, modifier = Modifier.align(Alignment.CenterEnd).padding(end = 7.dp))
    Text("S", style = mark, color = colors.dim, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 5.dp))
    Text("W", style = mark, color = colors.dim, modifier = Modifier.align(Alignment.CenterStart).padding(start = 7.dp))
    CurrentArrow(bearing = angle.value.toDouble(), color = tone, alpha = g.opacity.coerceAtLeast(0.55f), size = 72.dp, edge = colors.ink)
  }
}

/** "Strong" in the flow's colour; a new word rolls up into place. */
@Composable
private fun StrengthWord(g: Glance, reducedMotion: Boolean) {
  val colors = CurrentTheme.colors
  AnimatedContent(
    targetState = g.label to g.tone,
    transitionSpec = {
      if (reducedMotion) EnterTransition.None togetherWith ExitTransition.None
      else (slideInVertically(tween(260)) { it / 3 } + fadeIn(tween(260))) togetherWith fadeOut(tween(120))
    },
    label = "strength",
  ) { (label, tone) ->
    Text(label.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.displaySmall, color = colors.tone(tone), maxLines = 1)
  }
}

/** One, two or three bars lit for low, medium, high. */
@Composable
private fun ConfidenceMeter(confidence: Confidence, modifier: Modifier = Modifier) {
  val colors = CurrentTheme.colors
  val lit =
    when (confidence) {
      Confidence.Low -> 1
      Confidence.Medium -> 2
      Confidence.High -> 3
    }
  Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
    repeat(3) { i ->
      Box(Modifier.size(18.dp, 5.dp).clip(RoundedCornerShape(3.dp)).background(if (i < lit) colors.foam else colors.edge))
    }
    Text(
      "${confidenceLabel(confidence).replaceFirstChar { it.uppercase() }} confidence",
      style = MaterialTheme.typography.bodySmall,
      color = colors.mist,
      modifier = Modifier.padding(start = 6.dp),
    )
  }
}

@Composable
private fun TideCell(week: WeekView, selected: Int, modifier: Modifier) {
  val colors = CurrentTheme.colors
  val trend = SiteOutlook.trend(week.levels, selected)
  val next = SiteOutlook.nextTurn(week.turns, selected)
  Column(modifier.padding(start = 20.dp, end = 16.dp, top = 12.dp, bottom = 12.dp)) {
    Text("TIDE", style = Eyebrow, color = colors.tide)
    Text(
      when (trend) {
        TideTrend.Rising -> "Rising ↗"
        TideTrend.Falling -> "Falling ↘"
        null -> "Turning"
      },
      style = MaterialTheme.typography.titleMedium,
      modifier = Modifier.padding(top = 4.dp),
    )
    Text(
      next?.let { "${if (it.high) "High" else "Low"} at ${week.whenLabel(it.index, selected)}" } ?: "No turn left this week",
      style = MaterialTheme.typography.bodySmall,
      color = colors.mist,
      modifier = Modifier.padding(top = 2.dp),
    )
  }
}

@Composable
private fun FlowNextCell(week: WeekView, selected: Int, modifier: Modifier) {
  val colors = CurrentTheme.colors
  val now = week.glances[selected]
  val j = SiteOutlook.nextFlowChange(week.glances, selected)
  val next = j?.let { week.glances[it] }
  Column(modifier.padding(start = 16.dp, end = 20.dp, top = 12.dp, bottom = 12.dp)) {
    Text("FLOW NEXT", style = Eyebrow, color = next?.let { colors.tone(it.tone) } ?: colors.dim)
    if (j == null || next == null) {
      Text(if (now == null) "No reading" else "Holds", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp))
      Text("to the end of the forecast", style = MaterialTheme.typography.bodySmall, color = colors.mist, modifier = Modifier.padding(top = 2.dp))
    } else {
      val turns = now != null && next.tone != now.tone
      Text(
        next.label.replaceFirstChar { it.uppercase() } + if (turns) ", ${next.way}" else "",
        style = MaterialTheme.typography.titleMedium,
        maxLines = 1,
        modifier = Modifier.padding(top = 4.dp),
      )
      Text(
        "at ${week.whenLabel(j, selected)} · in ${j - selected} h",
        style = MaterialTheme.typography.bodySmall,
        color = colors.mist,
        modifier = Modifier.padding(top = 2.dp),
      )
    }
  }
}

/**
 * One day at a time: day chips over the day's 24 hours, a bar per hour for the flow (height by strength, colour by
 * way, faded by confidence) with the tide drawn over them as a line, its highs and lows marked, and a thin sea-state
 * band under the bars. Tap or drag to pick an hour; a new day's bars grow in and its tide line draws itself.
 */
@Composable
internal fun DayChart(week: WeekView, selected: Int, onSelect: (Int) -> Unit, onNow: () -> Unit, reducedMotion: Boolean) {
  val colors = CurrentTheme.colors
  val day = SiteOutlook.dayOf(week.dayStarts, selected)
  val range = week.dayRange(day)
  val select by rememberUpdatedState(onSelect)
  Card(
    shape = RoundedCornerShape(24.dp),
    colors = CardDefaults.cardColors(containerColor = colors.deep, contentColor = colors.foam),
    border = BorderStroke(1.dp, colors.line),
    modifier = Modifier.fillMaxWidth(),
  ) {
    DayChips(week, day) { d ->
      // Keep the hour of day when moving between days; today opens on now.
      val r = week.dayRange(d)
      val hourOfDay = MaldivesTime.parse(week.hours[selected].time)?.hour ?: 0
      val target =
        when {
          week.nowIndex in r -> week.nowIndex
          else -> r.firstOrNull { MaldivesTime.parse(week.hours[it].time)?.hour == hourOfDay } ?: r.first
        }
      select(target)
    }
    val grow = remember { Animatable(1f) }
    LaunchedEffect(day) {
      if (reducedMotion) grow.snapTo(1f)
      else {
        grow.snapTo(0f)
        grow.animateTo(1f, tween(650))
      }
    }
    val text = rememberTextMeasurer()
    val labelStyle = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Bold, fontSize = 10.5.sp, color = colors.tide)
    fun slotOf(i: Int) = MaldivesTime.parse(week.hours[i].time)?.hour ?: (i - range.first)
    fun indexAt(x: Float, width: Float): Int {
      val slot = ((x / width) * 24).toInt().coerceIn(0, 23)
      return range.minBy { abs(slotOf(it) - slot) }
    }
    Canvas(
      Modifier.fillMaxWidth()
        .height(140.dp)
        .padding(horizontal = 16.dp)
        .pointerInput(range) { detectTapGestures { select(indexAt(it.x, size.width.toFloat())) } }
        .pointerInput(range) { detectHorizontalDragGestures { change, _ -> select(indexAt(change.position.x, size.width.toFloat())) } }
        .semantics {
          contentDescription = "Forecast hour"
          stateDescription = MaldivesTime.label(week.hours[selected].time)
          progressBarRangeInfo = ProgressBarRangeInfo(selected.toFloat(), 0f..week.hours.lastIndex.toFloat().coerceAtLeast(1f))
          setProgress { v ->
            select(v.roundToInt().coerceIn(0, week.hours.lastIndex))
            true
          }
        }
    ) {
      val seaH = if (week.seaByTime.isEmpty()) 0f else 6.dp.toPx()
      val top = 20.dp.toPx()
      val barsBottom = size.height - seaH - 6.dp.toPx()
      val barsH = barsBottom - top
      val slot = size.width / 24
      val gap = 2.dp.toPx()
      for (i in range) {
        val g = week.glances[i] ?: continue
        val x = slotOf(i) * slot
        val frac =
          when (g.strength) {
            Strength.Slack -> 0.14f
            Strength.Mild -> 0.42f
            Strength.Strong -> 0.72f
            Strength.TooStrong -> 1f
          }
        val delay = (slotOf(i) / 24f) * 0.35f
        val p = ((grow.value - delay) / 0.65f).coerceIn(0f, 1f)
        val h = barsH * frac * p
        val sel = i == selected
        val tone = colors.tone(g.tone)
        drawRoundRect(
          tone,
          Offset(x + gap / 2, barsBottom - h),
          Size(slot - gap, h),
          CornerRadius(3.dp.toPx()),
          alpha = if (sel) 1f else 0.35f + 0.4f * g.opacity,
        )
        if (sel) {
          drawRoundRect(
            tone,
            Offset(x - gap / 2, barsBottom - h - gap * 1.5f),
            Size(slot + gap, h + gap * 3f),
            CornerRadius(5.dp.toPx()),
            style = Stroke(1.5.dp.toPx()),
          )
        }
        week.seaByTime[week.hours[i].time]?.let { s -> drawRect(seaColor(SeaBand.of(s.band), colors), Offset(x, size.height - seaH), Size(slot, seaH)) }
      }
      // The tide, on one scale for the whole week so days compare.
      val mid = top + barsH / 2
      fun yOf(level: Double) = (mid - (level / week.maxLevel) * (barsH / 2 - 8.dp.toPx())).toFloat()
      fun xOf(i: Int) = slotOf(i) * slot + slot / 2
      val line = Path()
      range.forEachIndexed { k, i -> if (k == 0) line.moveTo(xOf(i), yOf(week.levels[i])) else line.lineTo(xOf(i), yOf(week.levels[i])) }
      val drawn =
        if (grow.value >= 1f) line
        else Path().also { part ->
          val measure = PathMeasure()
          measure.setPath(line, false)
          measure.getSegment(0f, measure.length * grow.value, part, true)
        }
      drawPath(drawn, colors.ink, alpha = 0.6f, style = Stroke(5.dp.toPx()))
      drawPath(drawn, colors.tide, style = Stroke(2.5.dp.toPx()))
      if (grow.value >= 1f) {
        for (t in week.turns) {
          if (t.index !in range) continue
          val c = Offset(xOf(t.index), yOf(week.levels[t.index]))
          drawCircle(colors.tide, 3.5.dp.toPx(), c)
          val label = text.measure("${if (t.high) "H" else "L"} ${MaldivesTime.clock(week.hours[t.index].time)}", labelStyle)
          val lx = (c.x - label.size.width / 2).coerceIn(0f, size.width - label.size.width)
          val ly = if (t.high) c.y - 8.dp.toPx() - label.size.height else c.y + 6.dp.toPx()
          drawText(label, topLeft = Offset(lx, ly.coerceIn(0f, size.height - label.size.height)))
        }
        if (selected in range) {
          val c = Offset(xOf(selected), yOf(week.levels[selected]))
          drawCircle(colors.ink, 6.5.dp.toPx(), c)
          drawCircle(colors.foam, 5.dp.toPx(), c)
        }
      }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
      for (t in listOf("00", "06", "12", "18")) {
        Text(t, style = MaterialTheme.typography.labelSmall, color = colors.dim, modifier = Modifier.weight(1f))
      }
    }
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
      Box(Modifier.size(8.dp).clip(CircleShape).background(colors.outgoing))
      Text(" Bars: flow", style = MaterialTheme.typography.bodySmall, color = colors.mist)
      Box(Modifier.padding(start = 12.dp).size(14.dp, 2.5.dp).clip(RoundedCornerShape(2.dp)).background(colors.tide))
      Text(" Line: tide", style = MaterialTheme.typography.bodySmall, color = colors.mist, modifier = Modifier.weight(1f))
      if (selected != week.nowIndex) {
        TextButton(onClick = onNow, modifier = Modifier.heightIn(min = 44.dp)) { Text("Back to now") }
      } else {
        Text("Drag to scrub", style = MaterialTheme.typography.bodySmall, color = colors.dim, modifier = Modifier.padding(end = 12.dp, top = 14.dp, bottom = 14.dp))
      }
    }
  }
}

/** "Today", then weekday and date; the chosen day in foam. */
@Composable
private fun DayChips(week: WeekView, day: Int, onDay: (Int) -> Unit) {
  val colors = CurrentTheme.colors
  Row(
    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 4.dp),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    week.dayStarts.forEachIndexed { d, start ->
      val time = week.hours[start].time
      val on = d == day
      val today = week.nowIndex in week.dayRange(d)
      Column(
        Modifier.width(52.dp)
          .clip(RoundedCornerShape(12.dp))
          .background(if (on) colors.foam else Color.Transparent)
          .clickable { onDay(d) }
          .padding(vertical = 7.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Text(
          if (today) "Today" else MaldivesTime.dayLabel(time).take(3),
          style = MaterialTheme.typography.labelLarge,
          color = if (on) colors.ink else colors.mist,
          maxLines = 1,
        )
        Text(
          MaldivesTime.parse(time)?.dayOfMonth?.toString() ?: "",
          style = MaterialTheme.typography.labelSmall,
          color = if (on) colors.ink.copy(alpha = 0.6f) else colors.dim,
        )
      }
    }
  }
}

private fun seaColor(band: SeaBand?, colors: CurrentColors): Color =
  when (band) {
    SeaBand.Calm -> colors.incoming.copy(alpha = 0.35f)
    SeaBand.Moderate -> colors.foam.copy(alpha = 0.45f)
    SeaBand.Choppy -> colors.outgoing.copy(alpha = 0.8f)
    SeaBand.Rough -> colors.stop
    null -> colors.foam.copy(alpha = 0.1f)
  }

/** Sea, swell and wind for the hour as three tiles, then the warnings that go with them. */
@Composable
internal fun SeaTiles(week: WeekView, forecast: ApiForecast, selected: Int) {
  val colors = CurrentTheme.colors
  val sea = forecast.seaState ?: return
  val hour = week.hours.getOrNull(selected)?.let { week.seaByTime[it.time] }
  if (hour == null) {
    Text(
      if (sea.isEmpty()) "The wave forecast did not load." else "No sea state for this hour.",
      style = MaterialTheme.typography.bodyMedium,
      color = colors.mist,
    )
    return
  }
  val band = SeaBand.of(hour.band)
  Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    SeaTile(
      "SEA",
      heightLabel(hour.feltM),
      "${band?.let(::seaBandLabel)?.replaceFirstChar { it.uppercase() } ?: hour.band}, chop ${heightLabel(hour.windWaveM)}",
      valueColor = if (band == SeaBand.Rough) colors.stop else colors.foam,
      modifier = Modifier.weight(1f),
    )
    SeaTile(
      "SWELL",
      hour.swell?.let { heightLabel(it.heightM) } ?: "–",
      hour.swell?.let { s -> "from ${compassWord(s.fromDeg)}" + (s.periodS?.let { " · ${it.roundToInt()} s" } ?: "") } ?: "none",
      modifier = Modifier.weight(1f),
    )
    SeaTile(
      "WIND",
      hour.wind?.let { "${(it.speedMs * 1.943844).roundToInt()} kn" } ?: "–",
      hour.wind?.let { "from ${compassWord(it.fromDeg)}" } ?: "no data",
      modifier = Modifier.weight(1f),
    )
  }
  if (hour.againstCurrent) {
    Text(
      "Swell runs into a strong outgoing current here: expect steep, breaking water at the channel mouth.",
      color = colors.stop,
      style = MaterialTheme.typography.bodyMedium,
    )
  }
  if (forecast.seaStale) {
    Text("Sea state from old wave or wind data: the server could not refresh it.", style = MaterialTheme.typography.bodySmall, color = colors.mist)
  }
}

@Composable
private fun SeaTile(eyebrow: String, value: String, sub: String, modifier: Modifier, valueColor: Color = CurrentTheme.colors.foam) {
  val colors = CurrentTheme.colors
  Column(
    modifier.fillMaxHeight().clip(RoundedCornerShape(18.dp)).background(colors.deep).border(1.dp, colors.line, RoundedCornerShape(18.dp)).padding(12.dp)
  ) {
    Text(eyebrow, style = Eyebrow, color = colors.dim)
    Text(value, style = MaterialTheme.typography.titleLarge, color = valueColor, modifier = Modifier.padding(top = 4.dp))
    Text(sub, style = MaterialTheme.typography.bodySmall, color = colors.mist, modifier = Modifier.padding(top = 2.dp))
  }
}
