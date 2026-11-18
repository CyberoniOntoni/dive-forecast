package app.fiftybar.divecurrent.ui.site

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiReviews
import app.fiftybar.divecurrent.data.api.FlagBody
import app.fiftybar.divecurrent.data.session.Session
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ReviewsUiState(
  val card: ApiReviews? = null,
  val loading: Boolean = true,
  /** The review being written; starts as the diver's saved one. */
  val draft: String = "",
  val busy: Boolean = false,
  /** "Sending photo 2 of 3…". */
  val progress: String? = null,
  val error: String? = null,
  /** "Rating saved.", "Photo added." */
  val note: String? = null,
)

/**
 * The site page's ratings and reviews, as the web's card (components/SiteReviews.tsx): the diver's own score, review
 * and photos, each changeable or removable, and other divers' reviews. Every write answers with the whole card.
 */
class ReviewsViewModel(
  private val siteId: String,
  private val repository: DataRepository,
  private val account: AccountRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(ReviewsUiState())
  val state: StateFlow<ReviewsUiState> = _state.asStateFlow()
  val session: StateFlow<Session?> = account.sessions.session
  private var loadJob: Job? = null
  /** Counts writes, so a read that started before one does not put the older card back. */
  private var writes = 0

  init {
    // Signing in or out changes whose review is "mine": read the card again.
    viewModelScope.launch { account.sessions.session.map { it?.token }.distinctUntilChanged().collect { load() } }
  }

  fun photoUrl(path: String): String = repository.photoUrl(path)

  fun load() {
    loadJob?.cancel()
    loadJob = viewModelScope.launch {
      _state.update { it.copy(loading = true) }
      val before = writes
      try {
        val card = account.reviews(siteId)
        _state.update {
          if (writes != before) it.copy(loading = false)
          else it.copy(card = card, loading = false, draft = card.mine?.review.orEmpty())
        }
      } catch (e: ApiException) {
        _state.update { it.copy(loading = false, error = if (it.card == null) e.message else null) }
      }
    }
  }

  fun edit(text: String) {
    val max = _state.value.card?.reviewMaxChars ?: 1500
    _state.update { it.copy(draft = text.take(max), note = null) }
  }

  fun rate(score: Int) {
    val first = _state.value.card?.mine == null
    run(if (first) "Rating saved." else "Rating changed.") { account.rate(siteId, score) }
  }

  fun saveReview() {
    val text = _state.value.draft
    run(if (text.isBlank()) "Review cleared." else "Review saved.", keepDraft = false) { account.saveReview(siteId, text) }
  }

  fun removePhoto(photoId: String) = run("Photo removed.") { account.removeReviewPhoto(siteId, photoId) }

  fun removeRating() = run("Your rating was removed.", keepDraft = false) { account.removeRating(siteId) }

  /** Shrinks and sends the picked photos one by one, as the web does; stops at the first refusal. */
  fun addPhotos(context: Context, uris: List<Uri>) {
    val room = (_state.value.card?.let { it.maxPhotos - (it.mine?.photos?.size ?: 0) }) ?: 0
    val picked = uris.take(room)
    if (picked.isEmpty() || _state.value.busy) return
    viewModelScope.launch {
      _state.update { it.copy(busy = true, error = null, note = null) }
      var saved = 0
      var problem: String? = null
      for ((index, uri) in picked.withIndex()) {
        _state.update { it.copy(progress = "Sending photo ${index + 1} of ${picked.size}…") }
        try {
          val jpeg = PhotoShrink.shrink(context, uri)
          val card = account.addReviewPhoto(siteId, jpeg)
          writes += 1
          saved += 1
          _state.update { it.copy(card = card, loading = false) }
        } catch (e: PhotoException) {
          problem = e.message
        } catch (_: SignedOutException) {
          problem = "Sign in again to add photos."
        } catch (e: ApiException) {
          problem = e.message
        }
        if (problem != null) break
      }
      _state.update {
        it.copy(
          busy = false,
          progress = null,
          error = problem,
          note =
            if (problem != null) null
            else
              listOfNotNull(
                  if (saved == 1) "Photo added." else "$saved photos added.",
                  "A review holds ${it.card?.maxPhotos ?: 6} photos, so the other ${uris.size - picked.size} were left out."
                    .takeIf { uris.size > picked.size },
                )
                .joinToString(" "),
        )
      }
    }
  }

  /** Reports another diver's review (and its photos) to the moderators. */
  fun report(nickname: String, reason: String, note: String) =
    act("Thanks. A moderator will look at it.") { account.report(FlagBody("review", siteId = siteId, nickname = nickname, reason = reason, note = note.ifBlank { null })) }

  /** Blocks a diver: the card comes back without their reviews. */
  fun block(nickname: String) =
    act("$nickname is blocked. Unblock them on your account screen.") {
      account.block(nickname, true)
      load()
    }

  private fun act(done: String, call: suspend () -> Unit) {
    if (_state.value.busy) return
    viewModelScope.launch {
      _state.update { it.copy(busy = true, error = null, note = null) }
      try {
        call()
        _state.update { it.copy(busy = false, note = done) }
      } catch (_: SignedOutException) {
        _state.update { it.copy(busy = false, error = "Sign in again first.") }
      } catch (e: ApiException) {
        _state.update { it.copy(busy = false, error = e.message) }
      }
    }
  }

  private fun run(done: String, keepDraft: Boolean = true, call: suspend () -> ApiReviews) {
    if (_state.value.busy) return
    viewModelScope.launch {
      _state.update { it.copy(busy = true, error = null, note = null) }
      try {
        val card = call()
        writes += 1
        _state.update { it.copy(card = card, loading = false, busy = false, note = done, draft = if (keepDraft) it.draft else card.mine?.review.orEmpty()) }
      } catch (_: SignedOutException) {
        _state.update { it.copy(busy = false, error = "Sign in again to rate and review.") }
      } catch (e: ApiException) {
        _state.update { it.copy(busy = false, error = e.message) }
      }
    }
  }
}
