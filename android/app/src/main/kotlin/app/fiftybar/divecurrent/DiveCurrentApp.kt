package app.fiftybar.divecurrent

import android.app.Application
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import app.fiftybar.divecurrent.data.db.CacheDatabase
import org.maplibre.android.MapLibre

/** Holds the app's single repository. No DI framework: there is one of each and nothing to swap at run time. */
class DiveCurrentApp : Application() {
  lateinit var repository: DataRepository
    private set

  override fun onCreate() {
    super.onCreate()
    MapLibre.getInstance(this)
    val api = DiveCurrentApi(BuildConfig.API_BASE_URL)
    repository = DataRepository(api, CacheDatabase.create(this).bodies())
  }
}
