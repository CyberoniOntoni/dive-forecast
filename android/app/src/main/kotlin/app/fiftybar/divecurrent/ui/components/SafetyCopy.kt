package app.fiftybar.divecurrent.ui.components

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/**
 * The safety words shown beside forecasts and boat routes, as the web's lib/safety-copy.ts: change both together, and
 * keep them true to the web's /terms § About the forecast.
 */
object SafetyCopy {
  /** Under a site's current forecast. */
  const val FORECAST_GUIDANCE =
    "A forecast to plan with, not a guarantee. Check with your dive guide or a local operator, and look at the water before you drop in."

  /** Inside the boat route screens, always shown. */
  const val ROUTE_LIMITATION =
    "Route preview, not for navigation. The line follows satellite outlines, not a nautical chart, and the current along it is a forecast. Keep a lookout and use proper charts."

  /** Beside the sea state, so it is not read as the current. */
  const val SEA_SURFACE_NOTE = "Waves and wind at the surface, not the current underwater."
}

/** The not-for-navigation notice: an amber bar down the left, so it reads as a caution without shouting over the readouts. */
@Composable
fun RouteLimitation(modifier: Modifier = Modifier) {
  val colors = CurrentTheme.colors
  Row(modifier.fillMaxWidth().height(IntrinsicSize.Min).clip(RoundedCornerShape(10.dp)).background(colors.outgoing.copy(alpha = 0.1f))) {
    Box(Modifier.width(3.dp).fillMaxHeight().background(colors.outgoing))
    Text(
      SafetyCopy.ROUTE_LIMITATION,
      style = MaterialTheme.typography.bodySmall,
      color = colors.foam.copy(alpha = 0.9f),
      modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
    )
  }
}

/** Whether the first-launch introduction was closed, in shared prefs "intro". Named on the web's /privacy as settings. */
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
    "What you see" to
      "Which way the current runs (in or out of the atoll at channels, a compass direction on walls and in lagoons), how strong it is, and how sure the forecast is.",
    "Confidence" to
      "High means the tide and ocean signals agree and no recent diver report says otherwise. Low means treat it as a rough guide. Fainter arrows are less sure.",
    "Limits" to
      "A model, not a measurement. Reef shape, weather and what divers find on the day can differ. Arrows are the current underwater; the Sheltered water layer is the waves on top.",
  )

/** The first-launch introduction, as the web's: what 50Bar forecasts, how to read confidence, its limits. One tap closes it for good. */
@Composable
fun ForecastIntroDialog(onClose: () -> Unit) {
  val colors = CurrentTheme.colors
  AlertDialog(
    onDismissRequest = onClose,
    containerColor = colors.deep,
    titleContentColor = colors.foam,
    textContentColor = colors.foam,
    title = { Text("Understand the forecast") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState())) {
        Text(
          "50Bar forecasts the current at Maldives dive sites, hour by hour for the week ahead, from tide and ocean models and divers' reports, to help you pick safer entries and better timing.",
          style = MaterialTheme.typography.bodyMedium,
        )
        for ((title, body) in INTRO_POINTS) {
          Text(
            buildAnnotatedString {
              withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("$title. ") }
              append(body)
            },
            style = MaterialTheme.typography.bodySmall,
            color = colors.foam.copy(alpha = 0.85f),
            modifier = Modifier.padding(top = 10.dp),
          )
        }
        Text(
          "Always check with your dive guide or a local operator, and the water itself, before you dive.",
          style = MaterialTheme.typography.bodySmall,
          fontStyle = FontStyle.Italic,
          color = colors.foam.copy(alpha = 0.85f),
          modifier = Modifier.padding(top = 12.dp),
        )
      }
    },
    confirmButton = { TextButton(onClick = onClose) { Text("Got it") } },
  )
}
