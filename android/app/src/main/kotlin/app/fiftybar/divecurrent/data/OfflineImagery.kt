package app.fiftybar.divecurrent.data

import android.content.Context
import app.fiftybar.divecurrent.data.api.ApiBounds
import java.io.IOException
import kotlin.math.abs
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.offline.OfflineManager
import org.maplibre.android.offline.OfflineRegion
import org.maplibre.android.offline.OfflineRegionError
import org.maplibre.android.offline.OfflineRegionStatus
import org.maplibre.android.offline.OfflineTilePyramidRegionDefinition

/** Satellite imagery saved with an atoll, for the map without signal. */
interface OfflineImagery {
  /** Saves the imagery over [box] (or finds it already saved); [progress] gets 0 to 1. Answers the bytes it takes. */
  suspend fun save(atollId: String, box: ApiBounds, progress: (Float) -> Unit): Long

  suspend fun remove(atollId: String)
}

/**
 * Our Sentinel-2 tiles (lib/imagery.ts) in a MapLibre offline region per atoll, read from [styleUrl]. A region is kept
 * once complete: the tiles never change under one imagery version, so a saved atoll's 6-hourly refresh costs nothing
 * here. A region from another version (its style URL differs) or over another box is dropped and the new one
 * downloaded.
 */
class MapLibreOfflineImagery(
  private val context: Context,
  private val styleUrl: String,
  private val minZoom: Double,
  private val maxZoom: Double,
) : OfflineImagery {
  private val manager: OfflineManager
    get() = OfflineManager.getInstance(context)

  override suspend fun save(atollId: String, box: ApiBounds, progress: (Float) -> Unit): Long =
    withContext(Dispatchers.Main) {
      val mine = regions().filter { it.metadata.decodeToString() == atollId }
      // Kept only for the same imagery and the same box: an atoll whose outline changed downloads its new box.
      val (kept, stale) = mine.partition { region -> (region.definition as? OfflineTilePyramidRegionDefinition)?.let { it.styleURL == styleUrl && sameBox(it.bounds, box) } == true }
      stale.forEach { delete(it) }
      kept.drop(1).forEach { delete(it) }
      val region = kept.firstOrNull() ?: create(atollId, box)
      download(region, progress)
    }

  override suspend fun remove(atollId: String) =
    withContext(Dispatchers.Main) { regions().filter { it.metadata.decodeToString() == atollId }.forEach { delete(it) } }

  private fun sameBox(bounds: LatLngBounds?, box: ApiBounds): Boolean =
    bounds != null &&
      abs(bounds.latitudeNorth - box.north) < BOX_EPS &&
      abs(bounds.latitudeSouth - box.south) < BOX_EPS &&
      abs(bounds.longitudeEast - box.east) < BOX_EPS &&
      abs(bounds.longitudeWest - box.west) < BOX_EPS

  private suspend fun regions(): List<OfflineRegion> =
    suspendCancellableCoroutine { cont ->
      manager.listOfflineRegions(
        object : OfflineManager.ListOfflineRegionsCallback {
          override fun onList(offlineRegions: Array<OfflineRegion>?) = cont.resume(offlineRegions?.toList().orEmpty())

          override fun onError(error: String) = cont.resumeWithException(IOException(error))
        }
      )
    }

  private suspend fun create(atollId: String, box: ApiBounds): OfflineRegion =
    suspendCancellableCoroutine { cont ->
      val definition =
        OfflineTilePyramidRegionDefinition(
          styleUrl,
          LatLngBounds.from(box.north, box.east, box.south, box.west),
          minZoom,
          maxZoom,
          context.resources.displayMetrics.density,
        )
      manager.createOfflineRegion(
        definition,
        atollId.encodeToByteArray(),
        object : OfflineManager.CreateOfflineRegionCallback {
          override fun onCreate(offlineRegion: OfflineRegion) = cont.resume(offlineRegion)

          override fun onError(error: String) = cont.resumeWithException(IOException(error))
        },
      )
    }

  private suspend fun delete(region: OfflineRegion) =
    suspendCancellableCoroutine { cont ->
      region.setDownloadState(OfflineRegion.STATE_INACTIVE)
      region.delete(
        object : OfflineRegion.OfflineRegionDeleteCallback {
          override fun onDelete() = cont.resume(Unit)

          // Left on the phone; nothing draws from it.
          override fun onError(error: String) = cont.resume(Unit)
        }
      )
    }

  /**
   * Runs the region's download to the end. MapLibre retries a lost connection by itself, without end, so a run of
   * [GIVE_UP_AFTER] connection or server errors with no tile in between stops it as "no signal"; the next save
   * picks up where it stopped.
   */
  private suspend fun download(region: OfflineRegion, progress: (Float) -> Unit): Long =
    suspendCancellableCoroutine { cont ->
      var failures = 0
      var lastDone = -1L
      fun stop() {
        region.setObserver(null)
        region.setDownloadState(OfflineRegion.STATE_INACTIVE)
      }
      region.setObserver(
        object : OfflineRegion.OfflineRegionObserver {
          override fun onStatusChanged(status: OfflineRegionStatus) {
            if (!cont.isActive) return
            if (status.completedResourceCount != lastDone) {
              lastDone = status.completedResourceCount
              failures = 0
            }
            if (status.requiredResourceCount > 0) progress(status.completedResourceCount.toFloat() / status.requiredResourceCount)
            if (status.isComplete) {
              stop()
              cont.resume(status.completedResourceSize)
            }
          }

          override fun onError(error: OfflineRegionError) {
            if (!cont.isActive) return
            // A tile the server does not have is no reason to stop; open ocean answers 204 anyway.
            if (error.reason == OfflineRegionError.REASON_NOT_FOUND) return
            failures += 1
            if (failures >= GIVE_UP_AFTER) {
              stop()
              cont.resumeWithException(IOException("No signal: the satellite imagery stopped part way. Save again with signal."))
            }
          }

          override fun mapboxTileCountLimitExceeded(limit: Long) = Unit
        }
      )
      cont.invokeOnCancellation { stop() }
      region.setDownloadState(OfflineRegion.STATE_ACTIVE)
    }

  private companion object {
    const val GIVE_UP_AFTER = 5
    /** Degrees: the server rounds outline boxes to 4 decimals, so a real change is far bigger. */
    const val BOX_EPS = 1e-6
  }
}
