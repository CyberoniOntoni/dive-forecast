package app.fiftybar.divecurrent.ui.site

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiSiteTexts
import app.fiftybar.divecurrent.data.session.Session
import app.fiftybar.divecurrent.domain.SiteTextsDraft
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SiteTextsUiState(
  val loading: Boolean = false,
  /** The form as the server last answered it; null until loaded. */
  val form: ApiSiteTexts? = null,
  /** Where the fields started (to tell an edited form), and what is in them now. */
  val start: SiteTextsDraft? = null,
  val draft: SiteTextsDraft = SiteTextsDraft("", "", ""),
  val busy: Boolean = false,
  val error: String? = null,
  /** What the last send or withdraw did: "Thanks. A moderator will look at your edit…". */
  val done: String? = null,
) {
  /** Typed something that leaving would lose. */
  val dirty: Boolean
    get() = start != null && draft != start

  /**
   * Why Send is held: a text it would send is past its limit ("About the site is 2040 characters…"), or null. Only
   * what goes out counts, as cleaned for the server: a long text the diver left alone does not hold an edit to another.
   */
  val tooLong: String?
    get() {
      val f = form ?: return null
      val out = body ?: return null
      val over =
        listOf(
            Triple("About the site", out.texts.description, f.limits.description),
            Triple("How to dive it", out.texts.howToDive, f.limits.howToDive),
            Triple("The note", out.note, f.limits.note),
          )
          .firstOrNull { (_, text, max) -> text != null && text.length > max } ?: return null
      val (label, text, max) = over
      return "$label is ${text!!.length} characters. Shorten it to $max to send."
    }

  /** The body Send would post, or null with nothing changed. */
  val body
    get() = form?.let { SiteTextsDraft.body(it, draft) }
}

/**
 * The web's "Suggest an edit" form (components/SiteWiki.tsx) for a site's About the site and How to dive it: an edit
 * a moderator approves before it shows, or that goes live at once from a moderator. API.md § Site texts.
 */
class SiteTextsViewModel(
  private val siteId: String,
  private val repository: DataRepository,
  private val account: AccountRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(SiteTextsUiState())
  val state: StateFlow<SiteTextsUiState> = _state.asStateFlow()
  val session: StateFlow<Session?> = account.sessions.session

  /** The nickname of the diver whose form (and typing) this is; null before the first sign-in. */
  private var owner: String? = account.sessions.current()?.nickname

  init {
    load()
    // Signed out (an expired sign-in on Send, or signed out elsewhere): keep what was typed, so signing in again picks
    // it up. Signed in as the same diver: read the form again under the typing. As someone else: their own edit and
    // whether they may send differ, and the typing was the last diver's, so start again.
    viewModelScope.launch {
      session.distinctUntilChangedBy { it?.token }.drop(1).collect { now ->
        when {
          // A send still on its way keeps the form busy until it answers; the screen hides Send while signed out.
          now == null -> _state.update { it.copy(loading = false) }
          now.nickname == owner -> load(keepTyping = true)
          else -> {
            owner = now.nickname
            _state.value = SiteTextsUiState()
            load()
          }
        }
      }
    }
  }

  fun load() = load(keepTyping = false)

  private fun load(keepTyping: Boolean) {
    val session = account.sessions.current()
    if (session == null || _state.value.loading) return
    if (owner == null) owner = session.nickname
    _state.update { it.copy(loading = true, error = null) }
    val token = session.token
    viewModelScope.launch {
      try {
        val form = account.siteTexts(siteId)
        if (stale(token)) return@launch
        show(form, done = null, typing = _state.value.takeIf { keepTyping && it.dirty }?.draft)
      } catch (_: SignedOutException) {
        _state.update { it.copy(loading = false) }
      } catch (e: ApiException) {
        _state.update { it.copy(loading = false, error = e.message) }
      }
    }
  }

  fun edit(change: (SiteTextsDraft) -> SiteTextsDraft) {
    if (_state.value.busy) return
    _state.update { it.copy(draft = change(it.draft), error = null, done = null) }
  }

  /** Puts the fields back to where the form started, dropping what was typed since. */
  fun undo() {
    val start = _state.value.start ?: return
    edit { start }
  }

  fun send() {
    val s = _state.value
    if (s.busy) return
    val body = s.body
    if (body == null) {
      _state.update { it.copy(error = "Change something first.") }
      return
    }
    s.tooLong?.let { why ->
      _state.update { it.copy(error = why) }
      return
    }
    act { token ->
      val saved = account.proposeSiteTexts(siteId, body)
      // A moderator's edit is live: the site page and map read the site again.
      if (saved.live) repository.markSitesChanged(siteId)
      if (stale(token)) return@act
      show(
        saved,
        done =
          if (saved.live) "Saved. Your edit is live."
          else "Thanks. A moderator will look at your edit; once approved it shows on the site page with your name, and earns points.",
      )
    }
  }

  fun withdraw() {
    val id = _state.value.form?.mine?.takeIf { it.status == "pending" }?.id ?: return
    act { token ->
      val form = account.withdrawSiteEdit(siteId, id)
      if (!stale(token)) show(form, done = "Your edit is withdrawn.")
    }
  }

  /** Agrees to the content rules, for divers from before them, then loads the form again. */
  fun acceptTerms() =
    act { token ->
      account.acceptTerms()
      val form = account.siteTexts(siteId)
      if (!stale(token)) show(form, done = null)
    }

  /** A send, withdraw or terms call on its way: the form stays busy until it answers, whoever is signed in by then. */
  private var acting = false

  /** Shows [form]; with [typing], the fields keep what the diver had typed rather than starting over. */
  private fun show(form: ApiSiteTexts, done: String?, typing: SiteTextsDraft? = null) {
    val start = SiteTextsDraft.start(form)
    _state.update {
      it.copy(loading = false, busy = acting, form = form, start = start, draft = typing ?: start, error = null, done = done)
    }
  }

  /** Another diver signed in (or out) while an answer was on its way: it is the last diver's form, so it is dropped. */
  private fun stale(token: String?): Boolean = account.sessions.current()?.token != token

  private fun act(block: suspend (token: String?) -> Unit) {
    if (_state.value.busy || acting) return
    acting = true
    _state.update { it.copy(busy = true, error = null, done = null) }
    val token = account.sessions.current()?.token
    viewModelScope.launch {
      try {
        block(token)
      } catch (_: SignedOutException) {
        // The sign-in expired: the typing stays, and signing in again as the same diver brings it back.
        _state.update { it.copy(busy = false, error = "Sign in again to send your edit. What you typed is kept.") }
      } catch (e: ApiException) {
        if (stale(token)) return@launch
        _state.update { it.copy(busy = false, error = e.message) }
        // Refused: often the edit changed under the form (a moderator looked at it, or it was withdrawn elsewhere).
        // Read the form again so the card and buttons are true, keeping what the diver typed.
        if (e is ApiException.Server && (e.status == 400 || e.status == 404)) catchUp(token)
      } finally {
        // Busy ends only when the call has answered, so the screen never sticks on "Sending…" (Back is held while
        // busy) and a sign-in in the meantime cannot let the same edit be sent twice.
        acting = false
        _state.update { it.copy(busy = false) }
        // The answer was the last sign-in's and was dropped: the diver signed in again (as the same diver, typing
        // kept) while it was on its way, so read the form again to show what the call did.
        if (stale(token) && account.sessions.current() != null) load(keepTyping = true)
      }
    }
  }

  private suspend fun catchUp(token: String?) {
    val form =
      try {
        account.siteTexts(siteId)
      } catch (_: ApiException) {
        return
      } catch (_: SignedOutException) {
        return
      }
    if (!stale(token)) _state.update { it.copy(form = form, start = SiteTextsDraft.start(form)) }
  }
}
