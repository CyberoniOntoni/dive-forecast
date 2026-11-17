package app.fiftybar.divecurrent

import android.app.Application
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import app.fiftybar.divecurrent.data.db.CacheDatabase
import app.fiftybar.divecurrent.data.session.PrefsSessionStorage
import app.fiftybar.divecurrent.data.session.SessionStore
import app.fiftybar.divecurrent.data.OfflineAreas
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import org.maplibre.android.MapLibre
import org.maplibre.android.offline.OfflineManager

/** Holds the app's repositories. No DI framework: there is one of each and nothing to swap at run time. */
class DiveCurrentApp : Application() {
  lateinit var repository: DataRepository
    private set

  lateinit var account: AccountRepository
    private set

  lateinit var offline: OfflineAreas
    private set

  /** Work that outlives a screen: saving an atoll goes on when the diver leaves the map. */
  private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  override fun onCreate() {
    super.onCreate()
    MapLibre.getInstance(this)
    // Map tiles a diver has looked at stay on the phone for the boat, up to this much; the oldest go first. Esri's and
    // OpenStreetMap's terms allow keeping what was viewed, not downloading an area ahead of time.
    OfflineManager.getInstance(this).setMaximumAmbientCacheSize(MAP_CACHE_BYTES, null)
    val api = DiveCurrentApi(BuildConfig.API_BASE_URL)
    repository = DataRepository(api, CacheDatabase.create(this).bodies())
    account = AccountRepository(api, SessionStore(PrefsSessionStorage(this)))
    offline = OfflineAreas(repository, File(filesDir, "offline-areas.json"), appScope)
    offline.refreshStale()
  }

  private companion object {
    const val MAP_CACHE_BYTES = 512L * 1024 * 1024
  }
}
