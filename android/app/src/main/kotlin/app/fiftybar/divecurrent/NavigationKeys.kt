package app.fiftybar.divecurrent

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/** The map with every site's current hour. */
@Serializable data object MapKey : NavKey

/** A site's forecast for the week. */
@Serializable data class SiteKey(val siteId: String) : NavKey

/** Email-code sign-in; goes back once signed in. */
@Serializable data object SignInKey : NavKey

/** The signed-in diver's nickname, points and sign-out. */
@Serializable data object AccountKey : NavKey
