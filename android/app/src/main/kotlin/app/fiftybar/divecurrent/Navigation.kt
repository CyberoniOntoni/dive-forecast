package app.fiftybar.divecurrent

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import app.fiftybar.divecurrent.ui.map.MapScreen
import app.fiftybar.divecurrent.ui.site.SiteScreen

@Composable
fun MainNavigation() {
  val backStack = rememberNavBackStack(MapKey)

  NavDisplay(
    backStack = backStack,
    onBack = { backStack.removeLastOrNull() },
    entryDecorators =
      listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
    entryProvider =
      entryProvider {
        entry<MapKey> { MapScreen(onOpenSite = { id -> backStack.add(SiteKey(id)) }) }
        entry<SiteKey> { key -> SiteScreen(siteId = key.siteId, onBack = { backStack.removeLastOrNull() }) }
      },
  )
}
