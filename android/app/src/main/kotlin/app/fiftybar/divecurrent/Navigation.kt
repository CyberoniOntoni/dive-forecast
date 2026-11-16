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
import app.fiftybar.divecurrent.ui.plan.PlanEditScreen
import app.fiftybar.divecurrent.ui.plan.PlanScreen
import app.fiftybar.divecurrent.ui.plan.PlansScreen
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
          )
        }
        entry<SiteKey> { key ->
          SiteScreen(
            siteId = key.siteId,
            reportAt = key.reportAt,
            onBack = leave,
            onSignIn = { backStack.add(SignInKey) },
          )
        }
        entry<SignInKey> {
          SignInScreen(onDone = leave, onBack = leave)
        }
        entry<AccountKey> { AccountScreen(onBack = leave, onPlans = { backStack.add(PlansKey) }) }
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
