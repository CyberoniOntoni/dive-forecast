package app.fiftybar.divecurrent

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/** The map with every site's current hour. */
@Serializable data object MapKey : NavKey

/** A site's forecast for the week. `reportAt`: a plan's dive time to start the report form on. */
@Serializable data class SiteKey(val siteId: String, val reportAt: String? = null) : NavKey

/** Email-code sign-in; goes back once signed in. */
@Serializable data object SignInKey : NavKey

/** The signed-in diver's nickname, points and sign-out. */
@Serializable data object AccountKey : NavKey

/** The signed-in diver's plans, and a box to open a shared plan link. */
@Serializable data object PlansKey : NavKey

/** One plan by its share id. */
@Serializable data class PlanKey(val planId: String) : NavKey
