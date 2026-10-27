package expo.modules.velorasystemcalls

import android.content.Context
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class VeloraCallDeclineTest {
  private lateinit var context: Context
  private val requests = mutableListOf<Pair<String, String>>()

  @Before
  fun setUp() {
    context = RuntimeEnvironment.getApplication()
    context.getSharedPreferences("velora_system_calls", Context.MODE_PRIVATE)
      .edit()
      .clear()
      .commit()
    VeloraSystemCallStore.setAuthenticatedUserId(context, "user-1")
    VeloraSystemCallStore.setCallApiBaseUrl(context, "https://api.example.com/")
    requests.clear()
  }

  @After
  fun tearDown() {
    VeloraCallDecline.post = { _, _ -> 204 }
  }

  private fun ring(callId: String) {
    assertTrue(VeloraSystemCallStore.beginRingingCall(context, callId, System.currentTimeMillis() + 60_000L))
  }

  private fun reject(callId: String, token: String? = "signed-token", status: () -> Int = { 204 }) {
    VeloraCallDecline.post = { url, body ->
      requests.add(url to body)
      status()
    }
    val payload = buildMap<String, Any?> {
      put("callId", callId)
      put("type", "INCOMING_CALL")
      token?.let { put("declineToken", it) }
    }
    val finished = CountDownLatch(1)
    VeloraCallDecline.handleReject(context, payload) { finished.countDown() }
    assertTrue("decline did not finish", finished.await(5, TimeUnit.SECONDS))
  }

  @Test
  fun `a decline accepted by the server ends the call without opening the app`() {
    ring("call-1")

    reject("call-1")

    assertEquals(
      listOf("https://api.example.com/calls/call-1/decline" to "{\"token\":\"signed-token\"}"),
      requests,
    )
    assertNull(VeloraSystemCallStore.getCurrentCall(context))
    assertNull(VeloraSystemCallStore.pendingActionId(context, "call-1", "reject"))
  }

  @Test
  fun `a network failure keeps the reject journaled for the app to replay`() {
    ring("call-2")

    reject("call-2", status = { throw IOException("offline") })

    assertNotNull(VeloraSystemCallStore.pendingActionId(context, "call-2", "reject"))
  }

  @Test
  fun `a server error is retried through the app, a final refusal is not`() {
    ring("call-3")
    reject("call-3", status = { 503 })
    assertNotNull(VeloraSystemCallStore.pendingActionId(context, "call-3", "reject"))

    VeloraSystemCallStore.terminateCall(context, "call-3", System.currentTimeMillis())
    ring("call-4")
    reject("call-4", status = { 403 })
    assertNull(VeloraSystemCallStore.pendingActionId(context, "call-4", "reject"))
  }

  @Test
  fun `without a token or an API address no request is made and the reject stays pending`() {
    ring("call-5")
    reject("call-5", token = null)
    assertTrue(requests.isEmpty())
    assertNotNull(VeloraSystemCallStore.pendingActionId(context, "call-5", "reject"))

    VeloraSystemCallStore.terminateCall(context, "call-5", System.currentTimeMillis())
    ring("call-6")
    VeloraSystemCallStore.setCallApiBaseUrl(context, null)
    reject("call-6")
    assertTrue(requests.isEmpty())
    assertNotNull(VeloraSystemCallStore.pendingActionId(context, "call-6", "reject"))
  }

  @Test
  fun `the API address must be https and the token never reaches the journal`() {
    VeloraSystemCallStore.setCallApiBaseUrl(context, "http://api.example.com")
    assertNull(VeloraSystemCallStore.getCallApiBaseUrl(context))
    VeloraSystemCallStore.setCallApiBaseUrl(context, " https://api.example.com/v1/ ")
    assertEquals("https://api.example.com/v1", VeloraSystemCallStore.getCallApiBaseUrl(context))

    ring("call-7")
    reject("call-7", status = { 503 })
    val journal = context.getSharedPreferences("velora_system_calls", Context.MODE_PRIVATE)
      .getString("pendingActions", "")
      .orEmpty()
    assertFalse(journal.contains("signed-token"))
    assertFalse(journal.contains("declineToken"))
  }
}
