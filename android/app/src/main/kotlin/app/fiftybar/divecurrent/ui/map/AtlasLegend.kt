package app.fiftybar.divecurrent.ui.map

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.domain.AtlasOverlay
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/**
 * A small key to an Atlas overlay's colours, as the web map's: its title, "Zoom in to see them" below its drawing zoom,
 * and a swatch per class. Tapping the title folds the list away, so it does not hold the map down on a small phone.
 */
@Composable
fun AtlasLegend(overlay: AtlasOverlay, zoomedOut: Boolean, modifier: Modifier = Modifier) {
  val colors = CurrentTheme.colors
  var open by rememberSaveable(overlay) { mutableStateOf(true) }
  val many = overlay.classes.size > 1
  Surface(modifier, shape = RoundedCornerShape(12.dp), color = colors.glass, contentColor = colors.foam) {
    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
      Row(
        Modifier.heightIn(min = 32.dp)
          .then(
            if (many)
              Modifier.clickable(role = Role.Button) { open = !open }.semantics { stateDescription = if (open) "Key shown" else "Key folded" }
            else Modifier
          ),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        if (!many) Swatch(overlay.classes.first().color, outline = overlay.outline)
        Text(
          overlay.title,
          style = MaterialTheme.typography.titleSmall,
          modifier = Modifier.padding(start = if (many) 0.dp else 8.dp),
        )
        if (many) Text(if (open) "  ▾" else "  ▸", style = MaterialTheme.typography.bodySmall)
      }
      if (zoomedOut) Text("Zoom in to see them", style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.8f))
      if (many && open) {
        for (item in overlay.classes) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Swatch(item.color, outline = false)
            Text(item.name, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 8.dp))
          }
        }
      }
      if (open || !many) Text(AtlasOverlay.CREDIT, style = MaterialTheme.typography.labelSmall, color = colors.foam.copy(alpha = 0.7f))
    }
  }
}

@Composable
private fun Swatch(hex: String, outline: Boolean) {
  val color = Color(android.graphics.Color.parseColor(hex))
  val shape = RoundedCornerShape(3.dp)
  Box(
    if (outline) Modifier.size(14.dp).border(2.dp, color, shape)
    else Modifier.size(14.dp).background(color.copy(alpha = 0.8f), shape)
  )
}
