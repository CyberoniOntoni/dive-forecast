package app.fiftybar.divecurrent.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** The current's arrow, north up: [bearing] is degrees clockwise from north, the way the water runs. */
@Composable
fun CurrentArrow(
  bearing: Double,
  color: Color,
  modifier: Modifier = Modifier,
  alpha: Float = 1f,
  size: Dp = 32.dp,
  edge: Color = Color(0xFF07151D),
) {
  Canvas(modifier.size(size)) {
    val s = this.size.minDimension
    val path =
      Path().apply {
        moveTo(s * 0.5f, s * 0.06f)
        lineTo(s * 0.86f, s * 0.6f)
        lineTo(s * 0.6f, s * 0.55f)
        lineTo(s * 0.6f, s * 0.94f)
        lineTo(s * 0.4f, s * 0.94f)
        lineTo(s * 0.4f, s * 0.55f)
        lineTo(s * 0.14f, s * 0.6f)
        close()
      }
    rotate(bearing.toFloat(), pivot = Offset(s / 2, s / 2)) {
      drawPath(path, color, alpha = alpha)
      drawPath(path, edge, alpha = alpha, style = Stroke(width = s * 0.05f, join = StrokeJoin.Round))
    }
  }
}
