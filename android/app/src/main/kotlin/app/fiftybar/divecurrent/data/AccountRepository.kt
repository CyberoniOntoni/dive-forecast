package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.data.api.ApiCodeSent
import app.fiftybar.divecurrent.data.api.ApiEditablePlan
import app.fiftybar.divecurrent.data.api.PlanBody
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiMe
import app.fiftybar.divecurrent.data.api.ApiPlanSummaries
import app.fiftybar.divecurrent.data.api.ApiReportSaved
import app.fiftybar.divecurrent.data.api.ApiReviews
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import app.fiftybar.divecurrent.data.api.ReportRequest
import app.fiftybar.divecurrent.data.session.Session
import app.fiftybar.divecurrent.data.session.SessionStore

/** Thrown for a write that needs a diver when none is signed in (or the token stopped working). */
class SignedOutException : Exception("Sign in first.")

/**
 * Sign-in and the diver's own writes (API.md § Sign-in and writes). A 401 from the server means the token no longer
 * works, expired or ended by "Sign out everywhere", so the phone forgets it and the screens show signed out.
 */
class AccountRepository(private val api: DiveCurrentApi, val sessions: SessionStore) {
  suspend fun requestCode(email: String): ApiCodeSent = api.requestCode(email.trim())

  /** Signs in with the emailed code; a new diver also gives a nickname. */
  suspend fun signIn(email: String, code: String, nickname: String?): Session {
    val token = api.token(email.trim(), code.filter(Char::isDigit), nickname?.trim()?.takeIf { it.isNotEmpty() })
    val session = Session(token.token, token.nickname, token.expiresAt)
    sessions.set(session)
    return session
  }

  /** The diver's nickname and points; null when signed out. */
  suspend fun me(): ApiMe? {
    val session = sessions.current() ?: return null
    val me = authed { api.me(session.token) }
    sessions.rename(me.nickname)
    return me
  }

  /** The diver's own plans; null when signed out. */
  suspend fun myPlans(): ApiPlanSummaries? {
    val session = sessions.current() ?: return null
    return authed { api.myPlans(session.token) }
  }

  /** The diver's own plan for the editor. */
  suspend fun editablePlan(id: String): ApiEditablePlan {
    val session = sessions.current() ?: throw SignedOutException()
    return authed { api.editablePlan(session.token, id) }
  }

  /** Saves a new plan (`id` null) or the diver's own; answers with the plan's id. */
  suspend fun savePlan(id: String?, plan: PlanBody): String {
    val session = sessions.current() ?: throw SignedOutException()
    return authed { if (id == null) api.createPlan(session.token, plan).id else api.updatePlan(session.token, id, plan).id }
  }

  suspend fun deletePlan(id: String) {
    val session = sessions.current() ?: throw SignedOutException()
    authed { api.deletePlan(session.token, id) }
  }

  suspend fun fileReport(siteId: String, report: ReportRequest): ApiReportSaved {
    val session = sessions.current() ?: throw SignedOutException()
    return authed { api.fileReport(session.token, siteId, report) }
  }

  /**
   * The site's ratings and reviews, with the diver's own when signed in. A token that stopped working is forgotten and
   * the card is read signed out, so it still shows.
   */
  suspend fun reviews(siteId: String): ApiReviews {
    val session = sessions.current() ?: return api.reviews(siteId, null)
    return try {
      authed { api.reviews(siteId, session.token) }
    } catch (_: SignedOutException) {
      api.reviews(siteId, null)
    }
  }

  suspend fun rate(siteId: String, score: Int): ApiReviews = signedIn { api.rate(it, siteId, score) }

  suspend fun removeRating(siteId: String): ApiReviews = signedIn { api.removeRating(it, siteId) }

  suspend fun saveReview(siteId: String, text: String): ApiReviews = signedIn { api.saveReview(it, siteId, text) }

  suspend fun addReviewPhoto(siteId: String, jpeg: ByteArray): ApiReviews = signedIn { api.addReviewPhoto(it, siteId, jpeg) }

  suspend fun removeReviewPhoto(siteId: String, photoId: String): ApiReviews = signedIn { api.removeReviewPhoto(it, siteId, photoId) }

  private suspend fun <T> signedIn(call: suspend (token: String) -> T): T {
    val session = sessions.current() ?: throw SignedOutException()
    return authed { call(session.token) }
  }

  /** Forgets the token on this phone only. */
  fun signOut() = sessions.set(null)

  /** Ends every session of the diver, the web's included, then forgets the token here. */
  suspend fun signOutEverywhere() {
    val session = sessions.current() ?: return
    try {
      api.signOutEverywhere(session.token)
    } catch (e: ApiException.Server) {
      if (!e.signedOut) throw e
    }
    sessions.set(null)
  }

  private suspend fun <T> authed(call: suspend () -> T): T =
    try {
      call()
    } catch (e: ApiException.Server) {
      if (e.signedOut) {
        sessions.set(null)
        throw SignedOutException()
      }
      throw e
    }
}
