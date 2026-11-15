package app.fiftybar.divecurrent

import androidx.navigation3.runtime.NavKey
import kotlinx.serialization.Serializable

/** The map with every site's current hour. */
@Serializable data object MapKey : NavKey

/** A site's forecast for the week. */
@Serializable data class SiteKey(val siteId: String) : NavKey
