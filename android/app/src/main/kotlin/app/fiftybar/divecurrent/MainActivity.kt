package app.fiftybar.divecurrent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import app.fiftybar.divecurrent.domain.PlanLink
import app.fiftybar.divecurrent.ui.theme.DiveCurrentTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Opened from a shared https://50bar.app/plans/<id> link (AndroidManifest.xml); a restored activity keeps its own
    // back stack, so only a fresh start reads the link.
    val startPlanId = if (savedInstanceState == null) PlanLink.idOf(intent?.data?.path) else null

    // Edge to edge without enableEdgeToEdge(): bars and cutout mode are in the theme (android/README.md § Releasing
    // to Google Play).
    WindowCompat.setDecorFitsSystemWindows(window, false)
    setContent {
      DiveCurrentTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
          // A camera cutout on the side (landscape) is kept clear for every screen; the screens pad the status and
          // navigation bars themselves. In portrait the cutout sits in the status bar and this pads nothing.
          Box(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal))
          ) {
            MainNavigation(startPlanId = startPlanId)
          }
        }
      }
    }
  }
}
