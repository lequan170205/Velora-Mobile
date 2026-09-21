package expo.modules.velorasystemcalls

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Best-effort avatar loading for the native call surfaces. Everything here is
 * allowed to fail: callers must already have an initial-letter fallback so a
 * missing or slow avatar never blocks the incoming call presentation.
 */
internal object VeloraCallAvatars {
  private const val CONNECT_TIMEOUT_MS = 4_000
  private const val READ_TIMEOUT_MS = 4_000
  private const val MAX_CACHE_ENTRIES = 8

  private val cache = LinkedHashMap<String, Bitmap>()

  /** Blocking network call — must run on a background thread. Returns null on any failure. */
  fun fetchAvatar(url: String): Bitmap? {
    val trimmedUrl = url.trim()
    if (trimmedUrl.isEmpty() || !trimmedUrl.startsWith("http")) return null

    synchronized(cache) {
      cache[trimmedUrl]?.let { return it }
    }

    val bitmap = try {
      downloadDecoded(trimmedUrl)
    } catch (_: Exception) {
      null
    } ?: return null

    synchronized(cache) {
      if (cache.size >= MAX_CACHE_ENTRIES) {
        cache.remove(cache.keys.first())
      }
      cache[trimmedUrl] = bitmap
    }
    return bitmap
  }

  private fun downloadDecoded(url: String): Bitmap? {
    val connection = URL(url).openConnection() as? HttpURLConnection ?: return null
    return try {
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.instanceFollowRedirects = true
      val responseCode = connection.responseCode
      if (responseCode !in 200..299) return null

      // HttpURLConnection streams cannot be reopened, so buffer the body
      // once and run both the bounds probe and the real decode from bytes.
      val bytes = connection.inputStream.use(InputStream::readBytes)
      if (bytes.isEmpty()) return null

      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

      // Avatars are only ever rendered at ~220dp; a half-size decode keeps
      // memory small while staying sharp enough for the blurred backdrop.
      val decodeOptions = BitmapFactory.Options().apply {
        inSampleSize = computeInSampleSize(bounds.outWidth, bounds.outHeight, 512)
      }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOptions)
    } finally {
      connection.disconnect()
    }
  }

  private fun computeInSampleSize(width: Int, height: Int, target: Int): Int {
    var sampleSize = 1
    var largestSide = maxOf(width, height)
    while (largestSide / 2 >= target) {
      sampleSize *= 2
      largestSide /= 2
    }
    return sampleSize
  }

  /** Renders [source] into a square, circular-clipped bitmap of [sizePx]. */
  fun circular(source: Bitmap, sizePx: Int): Bitmap {
    val output = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }

    val shaderScale = maxOf(
      sizePx.toFloat() / source.width,
      sizePx.toFloat() / source.height,
    )
    val matrix = Matrix().apply {
      setScale(shaderScale, shaderScale)
      postTranslate(
        (sizePx - source.width * shaderScale) / 2f,
        (sizePx - source.height * shaderScale) / 2f,
      )
    }
    paint.shader.setLocalMatrix(matrix)
    canvas.drawCircle(sizePx / 2f, sizePx / 2f, sizePx / 2f, paint)
    return output
  }

  /**
   * Cheap full-bleed "blur": shrink the source to a tiny bitmap and scale it
   * back up with bilinear filtering. Works on every API level without
   * RenderScript/RenderEffect and stays soft enough for a dimmed backdrop.
   */
  fun blurredBackdrop(source: Bitmap, widthPx: Int, heightPx: Int): Bitmap {
    if (widthPx <= 0 || heightPx <= 0) return source

    val tinyWidth = 24
    val tinyHeight = maxOf(1, (tinyWidth.toLong() * heightPx / widthPx).toInt())
    val tiny = Bitmap.createScaledBitmap(source, tinyWidth, tinyHeight, true)
    return Bitmap.createScaledBitmap(tiny, widthPx, heightPx, true)
  }
}
