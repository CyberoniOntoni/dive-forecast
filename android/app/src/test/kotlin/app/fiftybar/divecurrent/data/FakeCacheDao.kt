package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.data.db.CachedBody
import app.fiftybar.divecurrent.data.db.CachedBodyDao

/** The phone's copies in a map, for tests. */
class FakeCacheDao : CachedBodyDao {
  val rows = java.util.concurrent.ConcurrentHashMap<String, CachedBody>()

  override suspend fun get(key: String) = rows[key]

  override suspend fun put(body: CachedBody) {
    rows[body.key] = body
  }

  override suspend fun delete(keys: List<String>) {
    keys.forEach { rows.remove(it) }
  }

  override suspend fun size(keys: List<String>): Long = keys.sumOf { rows[it]?.json?.length?.toLong() ?: 0L }
}
