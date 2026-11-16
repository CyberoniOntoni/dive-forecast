package app.fiftybar.divecurrent.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color

/**
 * One dark-on-navy scheme, day or night, like the site. Material roles map onto the tokens so stock components
 * (sliders, sheets, buttons) pick them up.
 */
@Composable
fun DiveCurrentTheme(night: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
  val c = if (night) NightColors else DayColors
  val scheme =
    darkColorScheme(
      primary = c.incoming,
      onPrimary = c.ink,
      secondary = c.outgoing,
      onSecondary = c.ink,
      tertiary = c.foam,
      background = c.ink,
      onBackground = c.foam,
      surface = c.ink,
      onSurface = c.foam,
      surfaceVariant = c.glass,
      onSurfaceVariant = c.foam.copy(alpha = 0.78f),
      surfaceContainer = c.glass,
      surfaceContainerLow = c.glass,
      surfaceContainerHigh = c.glass,
      surfaceContainerHighest = c.glass,
      outline = c.foam.copy(alpha = 0.25f),
      outlineVariant = c.foam.copy(alpha = 0.12f),
      error = c.stop,
      onError = Color.Black,
    )
  CompositionLocalProvider(LocalCurrentColors provides c) {
    MaterialTheme(colorScheme = scheme, typography = Typography, content = content)
  }
}

object CurrentTheme {
  val colors: CurrentColors
    @Composable get() = LocalCurrentColors.current
}
