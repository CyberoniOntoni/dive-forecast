package app.fiftybar.divecurrent.ui.site

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.session.Session
import app.fiftybar.divecurrent.domain.NewSite
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AddSiteUiState(
  val name: String = "",
  /** One of NewSite.KINDS, or null for "Not sure". */
  val kind: String? = null,
  val top: String = "",
  val max: String = "",
  val howToDive: String = "",
  val rating: Int? = null,
  /** Picked photos, not sent until the site is added. */
  val photos: List<Uri> = emptyList(),
  val busy: Boolean = false,
  /** "Adding…", "Sending photo 2 of 3…". */
  val progress: String? = null,
  val error: String? = null,
  /** Added, but some photos did not go up: the screen stays to say so. */
  val added: ApiSite? = null,
  val note: String? = null,
)

/**
 * The web map's "Add a site" form (components/AddSiteForm.tsx) for a pin: name, kind, depths, how to dive it, the
 * adder's rating and up to 6 photos, sent after the site is added. [onAdded] opens the new site's page.
 */
class AddSiteViewModel(
  private val lat: Double,
  private val lon: Double,
  private val repository: DataRepository,
  private val account: AccountRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(AddSiteUiState())
  val state: StateFlow<AddSiteUiState> = _state.asStateFlow()
  val session: StateFlow<Session?> = account.sessions.session

  fun edit(change: (AddSiteUiState) -> AddSiteUiState) {
    if (_state.value.busy || _state.value.added != null) return
    _state.update { change(it).copy(error = null) }
  }

  fun pick(uris: List<Uri>) = edit { it.copy(photos = (it.photos + uris).distinct().take(MAX_PHOTOS)) }

  fun unpick(uri: Uri) = edit { it.copy(photos = it.photos - uri) }

  fun submit(context: Context, onAdded: (ApiSite) -> Unit) {
    val form = _state.value
    if (form.busy || form.added != null) return
    val body =
      NewSite.body(form.name, lat, lon, form.kind, form.top, form.max, form.howToDive, form.rating).getOrElse { problem ->
        _state.update { it.copy(error = problem.message) }
        return
      }
    _state.update { it.copy(busy = true, progress = "Adding…", error = null) }
    viewModelScope.launch {
      val site =
        try {
          account.addSite(body)
        } catch (_: SignedOutException) {
          _state.update { it.copy(busy = false, progress = null, error = "Sign in again to add a site.") }
          return@launch
        } catch (e: ApiException) {
          _state.update { it.copy(busy = false, progress = null, error = e.message) }
          return@launch
        }
      repository.markSitesChanged()
      val sent =
        sendPhotos(context, form.photos, progress = { line -> _state.update { it.copy(progress = line) } }) { jpeg ->
          account.addSitePhoto(site.id, jpeg)
        }
      if (sent.saved == form.photos.size) {
        _state.update { it.copy(busy = false, progress = null, added = site) }
        onAdded(site)
        return@launch
      }
      val missing = form.photos.size - sent.saved
      _state.update {
        it.copy(
          busy = false,
          progress = null,
          added = site,
          note =
            "${if (missing == 1) "One photo was" else "$missing photos were"} not saved" +
              (sent.problem?.let { problem -> ": $problem" } ?: ".") +
              " You can add photos on the site page.",
        )
      }
    }
  }

  companion object {
    /** As MAX_PHOTOS_PER_SITE in lib/site-photos-limits.ts. */
    const val MAX_PHOTOS = 6
  }
}
