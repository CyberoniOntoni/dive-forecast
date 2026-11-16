package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.data.api.ApiCodeSent
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiMe
import app.fiftybar.divecurrent.data.api.ApiPlanSummaries
import app.fiftybar.divecurrent.data.api.ApiReportSaved
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import app.fiftybar.divecurrent.data.api.ReportRequest
import app.fiftybar.divecurrent.data.session.Session
import app.fiftybar.divecurrent.data.session.SessionStore

/** Thrown for a write that needs a diver when none is signed in (or the token stopped working). */
class SignedOutException : Exception("Sign in to report.")

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

  suspend fun fileReport(siteId: String, report: ReportRequest): ApiReportSaved {
    val session = sessions.current() ?: throw SignedOutException()
    return authed { api.fileReport(session.token, siteId, report) }
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
