package app.fiftybar.divecurrent.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.fiftybar.divecurrent.R

/*
 * Two families, both under the SIL Open Font License (android/licenses/): Space Grotesk, with tabular figures so
 * readouts do not jump, for the display, headline and titleLarge styles (the answer, big numbers, screen titles);
 * Inter for every other style (section titles, body, labels, lists and forms).
 */

val SpaceGrotesk =
  FontFamily(
    Font(R.font.space_grotesk_medium, FontWeight.Medium),
    Font(R.font.space_grotesk_semibold, FontWeight.SemiBold),
    Font(R.font.space_grotesk_bold, FontWeight.Bold),
  )

val Inter =
  FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
  )

private fun display(size: Int, line: Int, weight: FontWeight = FontWeight.Bold, tracking: Double = -0.02) =
  TextStyle(
    fontFamily = SpaceGrotesk,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = line.sp,
    letterSpacing = tracking.em,
    fontFeatureSettings = "tnum",
  )

private fun text(size: Double, line: Int, weight: FontWeight = FontWeight.Normal, tracking: Double = 0.0) =
  TextStyle(fontFamily = Inter, fontWeight = weight, fontSize = size.sp, lineHeight = line.sp, letterSpacing = tracking.em)

val Typography =
  Typography(
    displayLarge = display(84, 84, tracking = -0.04),
    displayMedium = display(56, 60, tracking = -0.03),
    displaySmall = display(44, 48, tracking = -0.03),
    headlineLarge = display(32, 38),
    headlineMedium = display(28, 34),
    headlineSmall = display(24, 30, FontWeight.SemiBold, -0.015),
    titleLarge = display(22, 28, FontWeight.SemiBold, -0.015),
    titleMedium = text(16.0, 22, FontWeight.SemiBold),
    titleSmall = text(14.0, 20, FontWeight.SemiBold),
    bodyLarge = text(16.0, 24),
    bodyMedium = text(14.0, 20),
    bodySmall = text(12.5, 17),
    labelLarge = text(14.0, 20, FontWeight.SemiBold),
    labelMedium = text(12.0, 16, FontWeight.SemiBold),
    labelSmall = text(11.0, 16, FontWeight.SemiBold, 0.1),
  )
