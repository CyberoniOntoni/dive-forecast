package app.fiftybar.divecurrent.ui.components

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/**
 * Whether the phone's network has been checked by Android to reach the internet (validated), followed as it changes.
 * Not just "a network is up": on a boat the Wi-Fi joins a moment before names resolve, and a fetch then fails.
 */
@Composable
fun rememberOnline(): Boolean {
  val context = LocalContext.current
  val connectivity = remember { context.getSystemService(ConnectivityManager::class.java) }
  var online by remember {
    mutableStateOf(connectivity?.let { reaches(it.getNetworkCapabilities(it.activeNetwork)) } ?: true)
  }
  DisposableEffect(connectivity) {
    val callback =
      object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
          online = reaches(capabilities)
        }

        override fun onLost(network: Network) {
          online = false
        }
      }
    connectivity?.registerDefaultNetworkCallback(callback)
    onDispose { connectivity?.unregisterNetworkCallback(callback) }
  }
  return online
}

private fun reaches(capabilities: NetworkCapabilities?): Boolean =
  capabilities != null &&
    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
