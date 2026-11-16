package app.fiftybar.divecurrent.ui.site

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import app.fiftybar.divecurrent.domain.PhotoSize
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A photo the app could not get ready; [message] is for the diver. */
class PhotoException(message: String) : Exception(message)

/**
 * A picked photo shrunk as the web's photo picker does (lib/photo-shrink.ts): turned upright from its camera
 * orientation, no longer than 1600 px, re-encoded as JPEG, which also leaves the camera data (GPS) behind. The server
 * strips any it still finds.
 */
object PhotoShrink {
  suspend fun shrink(context: Context, uri: Uri): ByteArray =
    withContext(Dispatchers.IO) {
      val resolver = context.contentResolver
      val size = resolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
      if (size > PhotoSize.PICK_MAX_BYTES) throw PhotoException("That photo is over 30 MB.")
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw PhotoException("That file is not a photo the app can open.")
      val orientation =
        try {
          resolver.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
        } catch (_: Exception) {
          null
        } ?: ExifInterface.ORIENTATION_NORMAL
      val options = BitmapFactory.Options().apply { inSampleSize = PhotoSize.sampleSize(bounds.outWidth, bounds.outHeight) }
      val decoded =
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
          ?: throw PhotoException("That file is not a photo the app can open.")
      val (width, height) = PhotoSize.target(decoded.width, decoded.height)
      val scaled = if (width == decoded.width && height == decoded.height) decoded else Bitmap.createScaledBitmap(decoded, width, height, true)
      val upright = upright(scaled, orientation)
      try {
        for (quality in PhotoSize.QUALITIES) {
          val out = ByteArrayOutputStream()
          upright.compress(Bitmap.CompressFormat.JPEG, quality, out)
          if (out.size() <= PhotoSize.MAX_BYTES) return@withContext out.toByteArray()
        }
        throw PhotoException("Could not make that photo small enough.")
      } finally {
        upright.recycle()
        if (scaled !== upright) scaled.recycle()
        if (decoded !== scaled) decoded.recycle()
      }
    }

  /** The photo as the camera saw it: EXIF says how it was turned or mirrored, and re-encoding drops that note. */
  private fun upright(bitmap: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.postRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.postRotate(270f)
        matrix.postScale(-1f, 1f)
      }
      else -> return bitmap
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }
}
