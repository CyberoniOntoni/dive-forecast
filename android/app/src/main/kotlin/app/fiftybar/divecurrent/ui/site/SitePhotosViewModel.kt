package app.fiftybar.divecurrent.ui.site

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.data.api.FlagBody
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SitePhotosUiState(
  /** The signed-in diver added this site, so they may add its photos (only the adder does, as on the web). */
  val isAdder: Boolean = false,
  val busy: Boolean = false,
  val progress: String? = null,
  val error: String? = null,
  val note: String? = null,
  /** After reporting the site or blocking its adder: what happened, or why it failed. */
  val reportNote: String? = null,
  /** Nicknames (lower case) the signed-in diver blocked: a blocked adder's notes and photos are hidden, as on the web. */
  val blocked: Set<String> = emptySet(),
) {
  fun adderBlocked(site: ApiSite): Boolean = site.adderNickname?.lowercase()?.let { it in blocked } == true
}

/** "Add photos" on a site the signed-in diver added in the app, as the web's site page (components/SiteAbout.tsx). */
class SitePhotosViewModel(private val siteId: String, private val account: AccountRepository) : ViewModel() {
  private val _state = MutableStateFlow(SitePhotosUiState())
  val state: StateFlow<SitePhotosUiState> = _state.asStateFlow()

  init {
    // Whose site it is can change with who is signed in.
    viewModelScope.launch {
      account.sessions.session.map { it?.token }.distinctUntilChanged().collect { token ->
        val (adder, blocked) = if (token != null) account.siteViewer(siteId) else false to emptySet()
        _state.update { it.copy(isAdder = adder, blocked = blocked) }
      }
    }
  }

  /** Sends the picked photos, at most [room]; [onSaved] gets the site with them, to show at once. */
  fun add(context: Context, uris: List<Uri>, room: Int, onSaved: (ApiSite) -> Unit) {
    val picked = uris.take(room)
    if (picked.isEmpty() || _state.value.busy) return
    viewModelScope.launch {
      _state.update { it.copy(busy = true, error = null, note = null) }
      val sent =
        sendPhotos(context, picked, progress = { line -> _state.update { it.copy(progress = line) } }) { jpeg ->
          onSaved(account.addSitePhoto(siteId, jpeg))
        }
      _state.update {
        it.copy(
          busy = false,
          progress = null,
          error = sent.problem,
          note =
            if (sent.problem != null) null
            else
              listOfNotNull(
                  if (sent.saved == 1) "Photo added." else "${sent.saved} photos added.",
                  "A site holds 6 photos, so the other ${uris.size - picked.size} were left out.".takeIf { uris.size > picked.size },
                )
                .joinToString(" "),
        )
      }
    }
  }

  /** Reports this site (added in the app: its notes and photos) to the moderators. */
  fun report(reason: String, note: String) {
    viewModelScope.launch {
      val line =
        try {
          account.report(FlagBody("site", siteId = siteId, reason = reason, note = note.ifBlank { null }))
          "Thanks. A moderator will look at it."
        } catch (_: SignedOutException) {
          "Sign in again first."
        } catch (e: ApiException) {
          e.message ?: "Could not send the report."
        }
      _state.update { it.copy(reportNote = line) }
    }
  }

  /** Blocks the diver who added this site: their notes and photos are hidden from now on. */
  fun blockAdder(nickname: String) {
    viewModelScope.launch {
      try {
        account.block(nickname, true)
        _state.update {
          it.copy(blocked = it.blocked + nickname.lowercase(), reportNote = "$nickname is blocked. Unblock them on your account screen.")
        }
      } catch (_: SignedOutException) {
        _state.update { it.copy(reportNote = "Sign in again first.") }
      } catch (e: ApiException) {
        _state.update { it.copy(reportNote = e.message ?: "Could not block them.") }
      }
    }
  }
}
