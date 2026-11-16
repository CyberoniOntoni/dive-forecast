package app.fiftybar.divecurrent.data.db

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * The last body the server sent for one endpoint ("sites", "nowcast", "forecast/<id>"), as raw JSON. Kept as text so
 * a field this app does not know yet survives too, and decoded on read like a fresh response (API.md § Caching).
 */
@Entity(tableName = "cached_body")
data class CachedBody(
  @PrimaryKey val key: String,
  val json: String,
  /** When this phone received it, Unix ms. */
  val savedAt: Long,
)

@Dao
interface CachedBodyDao {
  @Query("SELECT * FROM cached_body WHERE `key` = :key") suspend fun get(key: String): CachedBody?

  @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(body: CachedBody)
}

@Database(entities = [CachedBody::class], version = 1, exportSchema = true)
abstract class CacheDatabase : RoomDatabase() {
  abstract fun bodies(): CachedBodyDao

  companion object {
    fun create(context: Context): CacheDatabase =
      Room.databaseBuilder(context, CacheDatabase::class.java, "dive-current-cache.db")
        // A cache: losing it on a schema change only means one fetch.
        .fallbackToDestructiveMigration(dropAllTables = true)
        .build()
  }
}
