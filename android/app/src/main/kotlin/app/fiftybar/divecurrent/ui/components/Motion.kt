package app.fiftybar.divecurrent.ui.components

import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * True when the phone's "Remove animations" (animator duration scale 0) is on. Decorative motion (flow streaks, bars
 * growing, the arrow's spring) then stops or jumps straight to its end; nothing the app says depends on motion.
 */
@Composable
fun rememberReducedMotion(): Boolean {
  val context = LocalContext.current
  return remember(context) {
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
  }
}
