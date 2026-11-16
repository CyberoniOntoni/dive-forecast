package app.fiftybar.divecurrent.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import app.fiftybar.divecurrent.data.api.GlanceTone

/*
 * The web app's colour tokens (app/globals.css): a luminous navy by day so type holds up in sun, darker at night.
 * Incoming teal, outgoing amber, and the stop colour for very strong; along a reef the arrow is foam, not in or out.
 */

@Immutable
data class CurrentColors(
  val ink: Color,
  val foam: Color,
  val glass: Color,
  val incoming: Color,
  val outgoing: Color,
  val stop: Color,
) {
  fun tone(tone: GlanceTone): Color =
    when (tone) {
      GlanceTone.Incoming -> incoming
      GlanceTone.Outgoing -> outgoing
      GlanceTone.Along -> foam
      GlanceTone.Stop -> stop
    }
}

val DayColors =
  CurrentColors(
    ink = Color(0xFF16556E),
    foam = Color(0xFFF5FBFC),
    glass = Color(0xE60E3E52),
    incoming = Color(0xFF8EF6E4),
    outgoing = Color(0xFFFFD089),
    stop = Color(0xFFFF7A8A),
  )

val NightColors =
  CurrentColors(
    ink = Color(0xFF07151D),
    foam = Color(0xFFDCE8EE),
    glass = Color(0xE0081620),
    incoming = Color(0xFF3ECFB8),
    outgoing = Color(0xFFE0A24A),
    stop = Color(0xFFD45266),
  )

val LocalCurrentColors = staticCompositionLocalOf { DayColors }
