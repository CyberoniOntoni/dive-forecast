package app.fiftybar.divecurrent.domain

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The web's photo limits (lib/site-photos-limits.ts) and the sizes a picked photo is shrunk to, as lib/photo-shrink.ts
 * does it in the browser: no longer than 1600 px on its long edge, JPEG, quality stepped down until it fits 1.5 MB.
 */
object PhotoSize {
  const val LONG_EDGE_PX = 1600
  const val MAX_BYTES = 1_500_000
  /** What the picker takes from the phone, as the web's. */
  const val PICK_MAX_BYTES = 30_000_000L
  /** The web's 0.82, then lower until the photo fits. */
  val QUALITIES = listOf(82, 70, 60, 50)

  /** The shrunk photo's size: the long edge at most [LONG_EDGE_PX], never enlarged, at least 1 px. */
  fun target(width: Int, height: Int): Pair<Int, Int> {
    val scale = min(1.0, LONG_EDGE_PX.toDouble() / max(width, height))
    return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
  }

  /** The biggest power of two to decode at that still leaves the long edge at least [LONG_EDGE_PX]: saves memory. */
  fun sampleSize(width: Int, height: Int): Int {
    var sample = 1
    while (max(width, height) / (sample * 2) >= LONG_EDGE_PX) sample *= 2
    return sample
  }
}
