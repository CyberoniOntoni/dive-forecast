package app.fiftybar.divecurrent.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * One dark scheme, day or night, like the site. Material roles map onto the Tideline tokens so stock components
 * (sliders, sheets, buttons, the navigation bar) pick them up: cards on `deep`, controls on `reef`, panels over the map
 * on `glass`.
 */
@Composable
fun DiveCurrentTheme(night: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
  val c = if (night) NightColors else DayColors
  val scheme =
    darkColorScheme(
      primary = c.incoming,
      onPrimary = c.ink,
      primaryContainer = c.reef,
      onPrimaryContainer = c.foam,
      secondary = c.outgoing,
      onSecondary = c.ink,
      secondaryContainer = c.incoming.copy(alpha = 0.16f),
      onSecondaryContainer = c.foam,
      tertiary = c.tide,
      onTertiary = c.ink,
      background = c.ink,
      onBackground = c.foam,
      surface = c.ink,
      onSurface = c.foam,
      surfaceVariant = c.reef,
      onSurfaceVariant = c.mist,
      surfaceContainerLowest = c.ink,
      surfaceContainerLow = c.deep,
      surfaceContainer = c.deep,
      surfaceContainerHigh = c.deep,
      surfaceContainerHighest = c.reef,
      inverseSurface = c.foam,
      inverseOnSurface = c.ink,
      outline = c.edge,
      outlineVariant = c.line,
      error = c.stop,
      onError = Color.Black,
    )
  CompositionLocalProvider(LocalCurrentColors provides c) {
    MaterialTheme(colorScheme = scheme, typography = Typography, shapes = TidelineShapes, content = content)
  }
}

/** Soft, generous corners: chips and fields 14, buttons and tiles 18, cards 24, sheets 28. */
val TidelineShapes =
  Shapes(
    extraSmall = RoundedCornerShape(10.dp),
    small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
  )

object CurrentTheme {
  val colors: CurrentColors
    @Composable get() = LocalCurrentColors.current
}
