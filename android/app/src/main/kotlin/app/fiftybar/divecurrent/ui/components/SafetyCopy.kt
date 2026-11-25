package app.fiftybar.divecurrent.ui.components

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/**
 * The safety words shown beside forecasts and boat routes, as the web's lib/safety-copy.ts: change both together, and
 * keep them true to the web's /terms § About the forecast.
 */
object SafetyCopy {
  /** Under a site's current forecast. */
  const val FORECAST_GUIDANCE =
    "A forecast to plan with, not a guarantee. Check with your dive guide or a local operator, and look at the water before you drop in."

  /** Inside the boat route screens, always shown: a short title and the reason. */
  const val ROUTE_LIMITATION_TITLE = "Not for navigation"
  const val ROUTE_LIMITATION =
    "A route preview drawn from satellite outlines, not a nautical chart, with forecast current. Keep a lookout and use proper charts."

  /** Beside the sea state, so it is not read as the current. */
  const val SEA_SURFACE_NOTE = "Waves and wind at the surface, not the current underwater."
}

/** Line icons for the notices and the introduction (the core icon set has none of these). 24 dp, 2 dp strokes. */
private object SafetyIcons {
  private fun line(name: String, block: PathBuilder.() -> Unit): ImageVector =
    ImageVector.Builder(name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
      .path(fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round, pathBuilder = block)
      .build()

  val waves: ImageVector by lazy {
    line("Waves") {
      for (y in listOf(8f, 13f, 18f)) {
        moveTo(3f, y)
        curveTo(6f, y - 2.5f, 9f, y + 2.5f, 12f, y)
        reflectiveCurveTo(18f, y + 2.5f, 21f, y)
      }
    }
  }

  val bars: ImageVector by lazy {
    line("Confidence") {
      moveTo(5f, 20f); verticalLineTo(17f)
      moveTo(10f, 20f); verticalLineTo(13f)
      moveTo(15f, 20f); verticalLineTo(9f)
      moveTo(20f, 20f); verticalLineTo(4f)
    }
  }

  val warning: ImageVector by lazy {
    line("Warning") {
      moveTo(12f, 3.5f); lineTo(21.5f, 20f); lineTo(2.5f, 20f); close()
      moveTo(12f, 10f); verticalLineTo(14.5f)
      moveTo(12f, 17.5f); lineTo(12.01f, 17.5f)
    }
  }

  val shield: ImageVector by lazy {
    line("Check") {
      moveTo(12f, 3f); lineTo(19f, 6f); verticalLineTo(11f)
      curveTo(19f, 15.5f, 16f, 19.2f, 12f, 21f)
      curveTo(8f, 19.2f, 5f, 15.5f, 5f, 11f)
      verticalLineTo(6f); close()
      moveTo(9f, 12f); lineTo(11f, 14f); lineTo(15f, 10f)
    }
  }
}

/** The not-for-navigation notice: one quiet amber line with a warning mark, so it costs no room; a tap shows the full reason. */
@Composable
fun RouteLimitation(modifier: Modifier = Modifier) {
  val colors = CurrentTheme.colors
  var open by remember { mutableStateOf(false) }
  Row(
    modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(8.dp)).clickable(onClickLabel = "Show why", role = Role.Button) { open = true }.padding(horizontal = 4.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(5.dp),
  ) {
    Icon(SafetyIcons.warning, contentDescription = null, tint = colors.outgoing, modifier = Modifier.size(14.dp))
    Text(
      SafetyCopy.ROUTE_LIMITATION_TITLE,
      style = MaterialTheme.typography.labelMedium.copy(textDecoration = TextDecoration.Underline),
      color = colors.outgoing,
    )
  }
  if (open) {
    AlertDialog(
      onDismissRequest = { open = false },
      containerColor = colors.deep,
      titleContentColor = colors.foam,
      textContentColor = colors.foam,
      title = { Text(SafetyCopy.ROUTE_LIMITATION_TITLE) },
      text = { Text(SafetyCopy.ROUTE_LIMITATION, style = MaterialTheme.typography.bodyMedium) },
      confirmButton = { TextButton(onClick = { open = false }) { Text("OK") } },
    )
  }
}

/** Whether the first-launch introduction was closed, in shared prefs "intro" (the web's /privacy counts it among settings). */
object IntroPrefs {
  private const val PREFS = "intro"
  private const val KEY = "forecast-intro-closed"

  fun closed(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

  fun close(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, true).apply()
  }
}

/** The web's ForecastIntro points (components/ForecastIntro.tsx): change both together. */
private val INTRO_POINTS =
  listOf(
    Triple(SafetyIcons.waves, "Direction and strength", "Which way the current runs at each site, and how hard, hour by hour for the week."),
    Triple(SafetyIcons.bars, "Confidence", "High when the signals agree and no recent diver report disagrees. Low is a rough guide. Fainter arrows are less sure."),
    Triple(SafetyIcons.warning, "Limits", "A model, not a measurement. Arrows show the current underwater; the Sheltered water layer shows waves on top."),
  )

/**
 * The first-launch welcome card, as the web's: what 50Bar forecasts, how to read confidence, its limits. A tap on
 * "Got it", Back or outside closes it for good.
 */
@Composable
fun ForecastIntroDialog(onClose: () -> Unit) {
  val colors = CurrentTheme.colors
  Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Surface(
      shape = RoundedCornerShape(28.dp),
      color = colors.deep,
      contentColor = colors.foam,
      border = BorderStroke(1.dp, colors.line),
      modifier = Modifier.padding(horizontal = 16.dp).widthIn(max = 480.dp).fillMaxWidth(),
    ) {
      Column(
        Modifier
          .background(Brush.radialGradient(listOf(colors.incoming.copy(alpha = 0.14f), Color.Transparent), center = Offset(900f, 0f), radius = 900f))
          .verticalScroll(rememberScrollState())
          .padding(horizontal = 22.dp, vertical = 24.dp)
      ) {
        Text("WELCOME TO 50BAR", style = MaterialTheme.typography.labelSmall, letterSpacing = 2.sp, fontWeight = FontWeight.SemiBold, color = colors.incoming)
        Text("Understand the forecast", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))
        Text(
          "Current forecasts for Maldives dive sites, from tide and ocean models and divers' reports, to help you plan safer entries and better timing.",
          style = MaterialTheme.typography.bodyMedium,
          color = colors.foam.copy(alpha = 0.8f),
          modifier = Modifier.padding(top = 6.dp),
        )
        HorizontalDivider(color = colors.line, modifier = Modifier.padding(top = 16.dp))
        for ((icon, title, body) in INTRO_POINTS) {
          Row(Modifier.padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(
              Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(colors.incoming.copy(alpha = 0.12f)).border(1.dp, colors.incoming.copy(alpha = 0.25f), RoundedCornerShape(12.dp)),
              contentAlignment = Alignment.Center,
            ) {
              Icon(icon, contentDescription = null, tint = colors.incoming, modifier = Modifier.size(20.dp))
            }
            Column {
              Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
              Text(body, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.75f))
            }
          }
          HorizontalDivider(color = colors.line)
        }
        Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Icon(SafetyIcons.shield, contentDescription = null, tint = colors.outgoing, modifier = Modifier.size(16.dp).padding(top = 2.dp))
          Text("Always check with your dive guide or a local operator before you dive.", style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.8f))
        }
        Button(
          onClick = onClose,
          shape = RoundedCornerShape(50),
          colors = ButtonDefaults.buttonColors(containerColor = colors.incoming, contentColor = colors.ink),
          modifier = Modifier.padding(top = 16.dp).fillMaxWidth().height(52.dp),
        ) {
          Text("Got it", style = MaterialTheme.typography.titleMedium)
        }
      }
    }
  }
}
