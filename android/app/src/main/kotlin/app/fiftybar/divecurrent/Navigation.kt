package app.fiftybar.divecurrent

import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import app.fiftybar.divecurrent.ui.account.AccountScreen
import app.fiftybar.divecurrent.ui.account.SignInScreen
import app.fiftybar.divecurrent.ui.map.MapScreen
import app.fiftybar.divecurrent.ui.nav.NavigatePickScreen
import app.fiftybar.divecurrent.ui.nav.NavigateScreen
import app.fiftybar.divecurrent.ui.plan.PlanEditScreen
import app.fiftybar.divecurrent.ui.plan.PlanScreen
import app.fiftybar.divecurrent.ui.plan.PlansScreen
import app.fiftybar.divecurrent.ui.scoreboard.DiverScreen
import app.fiftybar.divecurrent.ui.scoreboard.ScoreboardScreen
import app.fiftybar.divecurrent.ui.site.AddSiteScreen
import app.fiftybar.divecurrent.ui.site.SiteScreen

@Composable
fun MainNavigation(startPlanId: String? = null) {
  // A plan link the app was opened with goes on top of the map, so Back still reaches the map.
  val start: List<NavKey> = listOfNotNull(MapKey, startPlanId?.let(::PlanKey))
  val backStack = rememberNavBackStack(*start.toTypedArray())
  // A screen that leaves by itself (signed in, signed out) never pops the map: an empty back stack would crash.
  val leave: () -> Unit = { if (backStack.size > 1) backStack.removeLastOrNull() }

  NavDisplay(
    backStack = backStack,
    onBack = { backStack.removeLastOrNull() },
    entryDecorators =
      listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
    entryProvider =
      entryProvider {
        entry<MapKey> {
          MapScreen(
            onOpenSite = { id -> backStack.add(SiteKey(id)) },
            onAccount = { signedIn -> backStack.add(if (signedIn) AccountKey else SignInKey) },
            onPlans = { backStack.add(PlansKey) },
            onNavigate = { backStack.add(NavigatePickKey) },
            onNavigateTo = { id, name, lat, lon -> backStack.add(NavigateKey(id, name, lat, lon)) },
            onAddSite = { lat, lon -> backStack.add(AddSiteKey(lat, lon)) },
            onScoreboard = { backStack.add(ScoreboardKey) },
          )
        }
        entry<AddSiteKey> { key ->
          AddSiteScreen(
            lat = key.lat,
            lon = key.lon,
            onBack = leave,
            onSignIn = { backStack.add(SignInKey) },
            // The new site's page takes the form's place, so Back goes to the map.
            onAdded = { site ->
              if (backStack.lastOrNull() == key) {
                leave()
                backStack.add(SiteKey(site.id))
              }
            },
          )
        }
        entry<SiteKey> { key ->
          SiteScreen(
            siteId = key.siteId,
            reportAt = key.reportAt,
            onBack = leave,
            onSignIn = { backStack.add(SignInKey) },
            onNavigate = { site -> backStack.add(NavigateKey(site.id, site.name, site.lat, site.lon)) },
          )
        }
        entry<NavigatePickKey> { key ->
          NavigatePickScreen(
            onBack = leave,
            // The list makes way for the trip, so Back from navigating goes to the map.
            onPick = { site ->
              if (backStack.lastOrNull() == key) {
                leave()
                backStack.add(NavigateKey(site.id, site.name, site.lat, site.lon))
              }
            },
          )
        }
        entry<NavigateKey> { key -> NavigateScreen(key.destinationId, key.name, key.lat, key.lon, onBack = leave) }
        entry<SignInKey> {
          SignInScreen(onDone = leave, onBack = leave)
        }
        entry<AccountKey> {
          AccountScreen(
            onBack = leave,
            onPlans = { backStack.add(PlansKey) },
            onScoreboard = { backStack.add(ScoreboardKey) },
            onMyPage = { nickname -> backStack.add(DiverKey(nickname)) },
          )
        }
        entry<ScoreboardKey> {
          ScoreboardScreen(
            onBack = leave,
            onDiver = { nickname -> backStack.add(DiverKey(nickname)) },
            onSite = { id -> backStack.add(SiteKey(id)) },
            onAccount = { signedIn -> backStack.add(if (signedIn) AccountKey else SignInKey) },
          )
        }
        entry<DiverKey> { key -> DiverScreen(key.nickname, onBack = leave, onAccount = { backStack.add(AccountKey) }) }
        entry<PlansKey> {
          PlansScreen(
            onBack = leave,
            onOpenPlan = { id -> backStack.add(PlanKey(id)) },
            onNewPlan = { backStack.add(PlanEditKey()) },
            onSignIn = { backStack.add(SignInKey) },
          )
        }
        entry<PlanKey> { key ->
          PlanScreen(
            planId = key.planId,
            onBack = leave,
            onOpenSite = { id -> backStack.add(SiteKey(id)) },
            onReport = { id, time -> backStack.add(SiteKey(id, reportAt = time)) },
            onEdit = { backStack.add(PlanEditKey(key.planId)) },
          )
        }
        entry<PlanEditKey> { key ->
          PlanEditScreen(
            planId = key.planId,
            onBack = leave,
            // A new plan opens its page in the editor's place; a changed one goes back to its page, which reloads.
            onSaved = { id ->
              if (backStack.lastOrNull() == key) {
                leave()
                if (key.planId == null) backStack.add(PlanKey(id))
              }
            },
            // The deleted plan's page goes too.
            onDeleted = {
              if (backStack.lastOrNull() == key) {
                leave()
                if (backStack.lastOrNull() == key.planId?.let(::PlanKey)) leave()
              }
            },
            onSignIn = { backStack.add(SignInKey) },
          )
        }
      },
  )
}
