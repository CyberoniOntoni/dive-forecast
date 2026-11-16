package app.fiftybar.divecurrent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import app.fiftybar.divecurrent.domain.PlanLink
import app.fiftybar.divecurrent.ui.theme.DiveCurrentTheme

class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    // Opened from a shared https://50bar.app/plans/<id> link (AndroidManifest.xml); a restored activity keeps its own
    // back stack, so only a fresh start reads the link.
    val startPlanId = if (savedInstanceState == null) PlanLink.idOf(intent?.data?.path) else null

    enableEdgeToEdge()
    setContent {
      DiveCurrentTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
          MainNavigation(startPlanId = startPlanId)
        }
      }
    }
  }
}
