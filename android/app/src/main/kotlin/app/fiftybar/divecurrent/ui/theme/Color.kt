package app.fiftybar.divecurrent.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import app.fiftybar.divecurrent.data.api.GlanceTone

/*
 * "Tideline": deep water behind everything, so the colours that carry the answer stand out in sun. Incoming teal,
 * outgoing amber, the stop colour for very strong, foam along a reef (not in or out), and a pale sky blue kept for the
 * tide only, so tide and flow never share a colour. Night keeps the same roles a step darker.
 *
 * ink    the screen behind everything (abyss)
 * deep   cards that sit on it
 * reef   controls and chips on a card
 * glass  panels floating over the map
 */

@Immutable
data class CurrentColors(
  val ink: Color,
  val deep: Color,
  val reef: Color,
  val foam: Color,
  val glass: Color,
  val incoming: Color,
  val outgoing: Color,
  val stop: Color,
  val tide: Color,
) {
  /** Secondary text on the dark surfaces. */
  val mist: Color
    get() = foam.copy(alpha = 0.66f)

  /** Labels and hints that should recede. */
  val dim: Color
    get() = foam.copy(alpha = 0.44f)

  /** Hairlines between parts of a card. */
  val line: Color
    get() = foam.copy(alpha = 0.10f)

  /** Card and chip borders. */
  val edge: Color
    get() = foam.copy(alpha = 0.18f)

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
    ink = Color(0xFF04121A),
    deep = Color(0xFF0A2230),
    reef = Color(0xFF123445),
    foam = Color(0xFFEEF8FA),
    glass = Color(0xDB061822),
    incoming = Color(0xFF5EF0D6),
    outgoing = Color(0xFFFFC266),
    stop = Color(0xFFFF6B7F),
    tide = Color(0xFF9FD8FF),
  )

val NightColors =
  CurrentColors(
    ink = Color(0xFF020A0F),
    deep = Color(0xFF071822),
    reef = Color(0xFF0D2735),
    foam = Color(0xFFDCE8EE),
    glass = Color(0xE0030D13),
    incoming = Color(0xFF3ECFB8),
    outgoing = Color(0xFFE0A24A),
    stop = Color(0xFFD45266),
    tide = Color(0xFF7DB8E0),
  )

val LocalCurrentColors = staticCompositionLocalOf { DayColors }
