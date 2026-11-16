package app.fiftybar.divecurrent.data.session

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The signed-in diver on this phone. Only the nickname is ever shown; the email is not kept. */
data class Session(val token: String, val nickname: String, val expiresAt: Long)

/** Where the session lives between launches. A fake in tests. */
interface SessionStorage {
  fun read(): Session?

  fun write(session: Session?)
}

/**
 * Shared prefs file "session", kept out of cloud backups and device transfers (res/xml/data_extraction_rules.xml,
 * backup_rules.xml), so a restored phone signs in again rather than carrying the token over.
 */
class PrefsSessionStorage(context: Context) : SessionStorage {
  private val prefs = context.getSharedPreferences("session", Context.MODE_PRIVATE)

  override fun read(): Session? {
    val token = prefs.getString("token", null) ?: return null
    val nickname = prefs.getString("nickname", null) ?: return null
    return Session(token, nickname, prefs.getLong("expiresAt", 0L))
  }

  override fun write(session: Session?) {
    prefs
      .edit()
      .apply {
        if (session == null) clear()
        else putString("token", session.token).putString("nickname", session.nickname).putLong("expiresAt", session.expiresAt)
      }
      .apply()
  }
}

/** The session as a flow for the screens; an expired one reads as signed out. */
class SessionStore(private val storage: SessionStorage, private val now: () -> Long = System::currentTimeMillis) {
  private val _session = MutableStateFlow(storage.read()?.takeIf { it.expiresAt > now() })
  val session: StateFlow<Session?> = _session.asStateFlow()

  /** The live session, or null once it has expired. */
  fun current(): Session? {
    val session = _session.value ?: return null
    if (session.expiresAt > now()) return session
    set(null)
    return null
  }

  fun set(session: Session?) {
    storage.write(session)
    _session.value = session
  }

  /** The server has a new nickname for this diver (changed on the web). */
  fun rename(nickname: String) {
    val session = _session.value ?: return
    if (session.nickname != nickname) set(session.copy(nickname = nickname))
  }
}
