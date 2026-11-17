package app.fiftybar.divecurrent.ui.site

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.Strength
import app.fiftybar.divecurrent.domain.Glance
import app.fiftybar.divecurrent.domain.depthLabel
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import app.fiftybar.divecurrent.ui.theme.Eyebrow
import coil3.compose.AsyncImage
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.tan
import kotlin.random.Random

/** How tall the satellite header is, under the status bar. */
internal val HERO_HEIGHT = 260.dp

/**
 * The site page's header: the reef from above (Esri World Imagery, as the map's satellite base), faint streaks drifting
 * the way the hour's water runs, and the site's name over a fade into the page.
 */
@Composable
internal fun SiteHero(site: ApiSite?, glance: Glance?, reducedMotion: Boolean, modifier: Modifier = Modifier) {
  val colors = CurrentTheme.colors
  Box(modifier.fillMaxWidth().height(HERO_HEIGHT).clipToBounds().background(colors.deep)) {
    site?.let { SatelliteBackdrop(it.lat, it.lon, Modifier.fillMaxSize()) }
    glance?.let { FlowStreaks(it, reducedMotion, Modifier.fillMaxSize()) }
    Box(
      Modifier.fillMaxSize()
        .background(
          Brush.verticalGradient(
            0f to colors.ink.copy(alpha = 0.55f),
            0.3f to Color.Transparent,
            0.6f to colors.ink.copy(alpha = 0.2f),
            1f to colors.ink,
          )
        )
    )
    Column(Modifier.align(Alignment.BottomStart).padding(horizontal = 20.dp, vertical = 12.dp)) {
      site?.let { s ->
        val facts = listOfNotNull(s.siteTypeLabel, s.atollName, depthLabel(s))
        if (facts.isNotEmpty()) Text(facts.joinToString(" · ").uppercase(), style = Eyebrow, color = colors.mist)
      }
      Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
          site?.name ?: "",
          style = MaterialTheme.typography.headlineLarge,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.weight(1f).padding(top = 4.dp),
        )
        if (site != null) Text("Imagery © Esri", style = MaterialTheme.typography.labelSmall, color = colors.dim)
      }
    }
  }
}

/**
 * Web-Mercator tiles round the pin at zoom 16, each drawn 128 dp wide (about its pixel size on a phone), with the pin
 * at the centre. Tiles come through Coil's cache, so a site seen once still has its header offline.
 */
@Composable
private fun SatelliteBackdrop(lat: Double, lon: Double, modifier: Modifier) {
  BoxWithConstraints(modifier) {
    val zoom = 16
    val n = (1 shl zoom).toDouble()
    val latRad = lat * PI / 180
    val fx = (lon + 180) / 360 * n
    val fy = (1 - ln(tan(latRad) + 1 / cos(latRad)) / PI) / 2 * n
    val tile: Dp = 128.dp
    val cols = (maxWidth / tile / 2).toInt() + 2
    val rows = (maxHeight / tile / 2).toInt() + 2
    val x0 = floor(fx).toInt()
    val y0 = floor(fy).toInt()
    for (dx in -cols..cols) {
      for (dy in -rows..rows) {
        val tx = x0 + dx
        val ty = y0 + dy
        val left = maxWidth / 2 + tile * (tx - fx).toFloat()
        val top = maxHeight / 2 + tile * (ty - fy).toFloat()
        if (left > maxWidth || top > maxHeight || left + tile < 0.dp || top + tile < 0.dp) continue
        AsyncImage(
          model = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/$zoom/$ty/$tx",
          contentDescription = null,
          contentScale = ContentScale.FillBounds,
          modifier = Modifier.offset(left, top).size(tile),
        )
      }
    }
  }
}

/** A streak's place across the header (0..1 each way) and its own pace and brightness. */
private class Streak(var x: Float, var y: Float, val pace: Float, val glow: Float)

/**
 * Short lines drifting with the hour's flow: the arrow's heading, quicker the stronger it runs, in its colour and
 * faded by its confidence. Only this site's forecast drives them. With animations off they hold still.
 */
@Composable
private fun FlowStreaks(glance: Glance, reducedMotion: Boolean, modifier: Modifier) {
  val colors = CurrentTheme.colors
  val streaks = remember { List(56) { Streak(Random.nextFloat(), Random.nextFloat(), 0.7f + Random.nextFloat() * 0.6f, Random.nextFloat()) } }
  // The heading eases round when the hour changes, so the streaks turn with the arrow instead of snapping.
  val heading = remember { Animatable(glance.arrowBearing.toFloat()) }
  LaunchedEffect(glance.arrowBearing) {
    val target = glance.arrowBearing.toFloat()
    val delta = ((target - heading.value) % 360 + 540) % 360 - 180
    if (reducedMotion) heading.snapTo(heading.value + delta) else heading.animateTo(heading.value + delta)
  }
  val current by rememberUpdatedState(glance)
  var frame by remember { mutableLongStateOf(0L) }
  if (!reducedMotion) {
    LaunchedEffect(Unit) {
      var last = 0L
      while (true) {
        withFrameNanos { now ->
          val dt = if (last == 0L) 0f else ((now - last) / 1e9f).coerceAtMost(0.05f)
          last = now
          val speed = speedOf(current.strength)
          val rad = heading.value * PI.toFloat() / 180f
          val vx = sin(rad) * speed * dt
          val vy = -cos(rad) * speed * dt
          for (s in streaks) {
            s.x += vx * s.pace
            s.y += vy * s.pace * 1.6f // the header is wider than tall; keep the drift even on screen
            if (s.x < -0.1f || s.x > 1.1f || s.y < -0.1f || s.y > 1.1f) {
              s.x = Random.nextFloat()
              s.y = Random.nextFloat()
            }
          }
          frame = now
        }
      }
    }
  }
  Canvas(modifier) {
    if (frame < 0L) return@Canvas // reading the frame clock redraws the streaks every frame
    val rad = heading.value * PI.toFloat() / 180f
    val ux = sin(rad)
    val uy = -cos(rad)
    val length = (6f + 18f * speedOf(current.strength) / speedOf(Strength.TooStrong)) * density
    val color = colors.tone(current.tone)
    for (s in streaks) {
      val head = Offset(s.x * size.width, s.y * size.height)
      val tail = Offset(head.x - ux * length * s.pace, head.y - uy * length * s.pace)
      drawLine(
        Brush.linearGradient(listOf(color.copy(alpha = 0f), color.copy(alpha = (0.25f + 0.35f * s.glow) * (0.4f + 0.6f * current.opacity))), tail, head),
        tail,
        head,
        strokeWidth = 1.6f * density,
        cap = StrokeCap.Round,
      )
    }
  }
}

/** Header widths per second: slack barely moves, very strong crosses in about three seconds. */
private fun speedOf(strength: Strength): Float =
  when (strength) {
    Strength.Slack -> 0.03f
    Strength.Mild -> 0.1f
    Strength.Strong -> 0.2f
    Strength.TooStrong -> 0.32f
  }
