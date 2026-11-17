package app.fiftybar.divecurrent.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/** The four places the app opens on: the map now, dive plans, boat navigation, and the diver. */
enum class Tab(val label: String) {
  Now("Now"),
  Plans("Plans"),
  Navigate("Navigate"),
  You("You"),
}

/**
 * The bottom bar on the four top screens. A thin line on top, the chosen tab in a soft teal pill; labels always shown,
 * since four words fit and an icon alone says less than "Navigate".
 */
@Composable
fun TabBar(selected: Tab, onSelect: (Tab) -> Unit, modifier: Modifier = Modifier) {
  val colors = CurrentTheme.colors
  Column(modifier) {
    Box(Modifier.fillMaxWidth().height(1.dp).background(colors.line))
    NavigationBar(containerColor = colors.ink.copy(alpha = 0.97f), contentColor = colors.foam, tonalElevation = 0.dp) {
      for (tab in Tab.entries) {
        NavigationBarItem(
          selected = tab == selected,
          onClick = { onSelect(tab) },
          icon = { Icon(TabIcons.of(tab), contentDescription = null) },
          label = { Text(tab.label) },
          colors =
            NavigationBarItemDefaults.colors(
              selectedIconColor = colors.foam,
              selectedTextColor = colors.foam,
              indicatorColor = colors.incoming.copy(alpha = 0.16f),
              unselectedIconColor = colors.dim,
              unselectedTextColor = colors.dim,
            ),
        )
      }
    }
  }
}

/** Line icons drawn for the bar (the core icon set has no map or boat arrow). 24 dp, 2 dp strokes, round joins. */
object TabIcons {
  fun of(tab: Tab): ImageVector =
    when (tab) {
      Tab.Now -> map
      Tab.Plans -> calendar
      Tab.Navigate -> heading
      Tab.You -> person
    }

  private fun line(name: String, block: PathBuilder.() -> Unit): ImageVector =
    ImageVector.Builder(name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
      .path(
        fill = null,
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 2f,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round,
        pathBuilder = block,
      )
      .build()

  val map: ImageVector by lazy {
    line("Map") {
      moveTo(9f, 4f)
      lineTo(3f, 6f)
      verticalLineTo(20f)
      lineTo(9f, 18f)
      lineTo(15f, 20f)
      lineTo(21f, 18f)
      verticalLineTo(4f)
      lineTo(15f, 6f)
      close()
      moveTo(9f, 4f)
      verticalLineTo(18f)
      moveTo(15f, 6f)
      verticalLineTo(20f)
    }
  }

  val calendar: ImageVector by lazy {
    line("Plans") {
      moveTo(6.5f, 5f)
      horizontalLineTo(17.5f)
      arcToRelative(3f, 3f, 0f, false, true, 3f, 3f)
      verticalLineTo(17.5f)
      arcToRelative(3f, 3f, 0f, false, true, -3f, 3f)
      horizontalLineTo(6.5f)
      arcToRelative(3f, 3f, 0f, false, true, -3f, -3f)
      verticalLineTo(8f)
      arcToRelative(3f, 3f, 0f, false, true, 3f, -3f)
      close()
      moveTo(3.5f, 10f)
      horizontalLineTo(20.5f)
      moveTo(8f, 3f)
      verticalLineTo(7f)
      moveTo(16f, 3f)
      verticalLineTo(7f)
    }
  }

  val heading: ImageVector by lazy {
    line("Navigate") {
      moveTo(12f, 2.5f)
      lineTo(19.5f, 21f)
      lineTo(12f, 17f)
      lineTo(4.5f, 21f)
      close()
    }
  }

  val person: ImageVector by lazy {
    line("You") {
      moveTo(16f, 8.5f)
      arcToRelative(4f, 4f, 0f, true, true, -8f, 0f)
      arcToRelative(4f, 4f, 0f, true, true, 8f, 0f)
      close()
      moveTo(4f, 21f)
      curveTo(5.2f, 17f, 8.3f, 15f, 12f, 15f)
      reflectiveCurveTo(18.8f, 17f, 20f, 21f)
    }
  }
}
