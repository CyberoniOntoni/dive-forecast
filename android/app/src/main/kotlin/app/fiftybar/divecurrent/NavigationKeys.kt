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

/** The plan editor: the diver's own plan, or a new one when `planId` is null. */
@Serializable data class PlanEditKey(val planId: String? = null) : NavKey

/** Pick where to take the boat: a site from the list. */
@Serializable data object NavigatePickKey : NavKey

/**
 * Boat navigation to a site, or to a point picked on the map (`destinationId` "lat,lon", as the web's ?navigate=).
 * The name and position come along, so the screen starts at once.
 */
@Serializable data class NavigateKey(val destinationId: String, val name: String, val lat: Double, val lon: Double) : NavKey
