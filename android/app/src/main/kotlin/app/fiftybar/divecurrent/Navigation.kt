package app.fiftybar.divecurrent

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import app.fiftybar.divecurrent.ui.account.AccountScreen
import app.fiftybar.divecurrent.ui.account.SignInScreen
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.components.Tab
import app.fiftybar.divecurrent.ui.components.TabBar
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
  val session by appAccount().sessions.session.collectAsStateWithLifecycle()
  // A tab's top screen sits right on the map (Back from it goes to the map); only there is the bar shown.
  val tab = tabOf(backStack)
  fun isTabRoot(key: NavKey) = backStack.size == 2 && backStack[1] == key
  fun select(next: Tab) {
    if (next == tab) return
    while (backStack.size > 1) backStack.removeLastOrNull()
    rootOf(next, signedIn = session != null)?.let(backStack::add)
  }
  // Swap the You tab's screen between sign-in and the account without a trip through the map.
  fun swapYou(to: NavKey) {
    backStack.removeLastOrNull()
    backStack.add(to)
  }

  Scaffold(
    // Each screen keeps its own insets; the outer scaffold only makes room for the bar.
    contentWindowInsets = WindowInsets(0),
    bottomBar = {
      AnimatedVisibility(
        visible = tab != null,
        enter = slideInVertically { it },
        exit = slideOutVertically { it },
      ) {
        TabBar(selected = tab ?: Tab.Now, onSelect = ::select)
      }
    },
  ) { barPadding ->
    NavDisplay(
      backStack = backStack,
      modifier = Modifier.padding(barPadding).consumeWindowInsets(barPadding),
      onBack = { backStack.removeLastOrNull() },
      entryDecorators =
        listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
      entryProvider =
        entryProvider {
          entry<MapKey> {
            MapScreen(
              onOpenSite = { id -> backStack.add(SiteKey(id)) },
              onNavigateTo = { id, name, lat, lon -> backStack.add(NavigateKey(id, name, lat, lon)) },
              onAddSite = { lat, lon -> backStack.add(AddSiteKey(lat, lon)) },
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
              onBack = leave.takeUnless { isTabRoot(key) },
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
          entry<SignInKey> { key ->
            val root = isTabRoot(key)
            val toScoreboard: () -> Unit = { backStack.add(ScoreboardKey) }
            SignInScreen(
              onDone = { if (root) swapYou(AccountKey) else leave() },
              onBack = leave.takeUnless { root },
              onScoreboard = toScoreboard.takeIf { root },
            )
          }
          entry<AccountKey> { key ->
            val root = isTabRoot(key)
            AccountScreen(
              onBack = leave.takeUnless { root },
              onSignedOut = { if (backStack.lastOrNull() == key) { if (root) swapYou(SignInKey) else leave() } },
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
          entry<DiverKey> { key ->
            DiverScreen(
              key.nickname,
              onBack = leave,
              // Opened from the account screen ("My public page"): go back to it rather than stack a second one.
              onAccount = {
                if (backStack.getOrNull(backStack.size - 2) == AccountKey) leave() else backStack.add(AccountKey)
              },
            )
          }
          entry<PlansKey> { key ->
            PlansScreen(
              onBack = leave.takeUnless { isTabRoot(key) },
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
}

/** Which tab's top screen is showing, or null on any screen deeper than that (the bar hides there). */
internal fun tabOf(stack: List<NavKey>): Tab? =
  when {
    stack.size == 1 && stack[0] == MapKey -> Tab.Now
    stack.size == 2 && stack[0] == MapKey -> Tab.entries.firstOrNull { stack[1] in tabRoots(it) }
    else -> null
  }

/**
 * The one table of each tab's top screen, kept on the map: none for Now (the map itself); You has two, the account
 * when signed in and sign-in when not.
 */
internal fun tabRoots(tab: Tab): List<NavKey> =
  when (tab) {
    Tab.Now -> emptyList()
    Tab.Plans -> listOf(PlansKey)
    Tab.Navigate -> listOf(NavigatePickKey)
    Tab.You -> listOf(AccountKey, SignInKey)
  }

/** The screen a tab opens on: the first of its roots, or for You the second when signed out. */
internal fun rootOf(tab: Tab, signedIn: Boolean): NavKey? {
  val roots = tabRoots(tab)
  return if (tab == Tab.You && !signedIn) roots.getOrNull(1) else roots.firstOrNull()
}
