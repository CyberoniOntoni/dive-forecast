package app.fiftybar.divecurrent.data

import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.DiveCurrentApi
import app.fiftybar.divecurrent.data.api.ReportRequest
import app.fiftybar.divecurrent.data.session.Session
import app.fiftybar.divecurrent.data.session.SessionStorage
import app.fiftybar.divecurrent.data.session.SessionStore
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class AccountRepositoryTest {
  private val server = MockWebServer()
  private val storage = MemoryStorage()
  private var nowMs = 1_000L
  private lateinit var account: AccountRepository

  @Before
  fun setUp() {
    server.start()
    account = AccountRepository(DiveCurrentApi(server.url("/").toString()), SessionStore(storage) { nowMs })
  }

  @After fun tearDown() = server.shutdown()

  private fun reply(code: Int, body: String) = MockResponse().setResponseCode(code).setBody(body)

  @Test
  fun `signs in with the emailed code and keeps the token, never the email`() = runTest {
    server.enqueue(reply(200, """{"apiVersion":1,"newUser":true}"""))
    server.enqueue(reply(200, """{"apiVersion":1,"token":"t.sig","nickname":"Manta","expiresAt":9000}"""))
    assertTrue(account.requestCode(" diver@example.com ").newUser)
    val sent = server.takeRequest()
    assertEquals("/api/v1/sign-in/code", sent.path)
    assertTrue(sent.getHeader("Content-Type")!!.startsWith("application/json"))
    assertEquals("""{"email":"diver@example.com"}""", sent.body.readUtf8())

    account.signIn("diver@example.com", "12 34 56", "Manta")
    assertEquals("""{"email":"diver@example.com","code":"123456","nickname":"Manta"}""", server.takeRequest().body.readUtf8())
    assertEquals(Session("t.sig", "Manta", 9000), storage.saved)
    assertEquals("Manta", account.sessions.session.value?.nickname)
  }

  @Test
  fun `makes, changes and deletes a plan with the token, and forgets the token on a 401`() = runTest {
    account.sessions.set(Session("t.sig", "Manta", 9000))
    val body =
      app.fiftybar.divecurrent.data.api.PlanBody(
        title = "Ari weekend",
        notes = null,
        boatSpeedKn = 10.0,
        days = listOf(
          app.fiftybar.divecurrent.data.api.PlanDayBody(
            "2026-10-03",
            listOf(app.fiftybar.divecurrent.data.api.PlanStopBody("furana-south", "09:00", want = "incoming")),
          )
        ),
      )
    server.enqueue(reply(201, """{"apiVersion":1,"id":"Kq7vHtmWpdNrcXfa"}"""))
    assertEquals("Kq7vHtmWpdNrcXfa", account.savePlan(null, body))
    val created = server.takeRequest()
    assertEquals("POST", created.method)
    assertEquals("/api/v1/plans", created.path)
    assertEquals("Bearer t.sig", created.getHeader("Authorization"))
    assertEquals(
      """{"title":"Ari weekend","boatSpeedKn":10.0,"days":[{"date":"2026-10-03","stops":[{"siteId":"furana-south","time":"09:00","want":"incoming"}]}]}""",
      created.body.readUtf8(),
    )

    server.enqueue(reply(200, """{"apiVersion":1,"id":"Kq7vHtmWpdNrcXfa"}"""))
    account.savePlan("Kq7vHtmWpdNrcXfa", body)
    val changed = server.takeRequest()
    assertEquals("PUT", changed.method)
    assertEquals("/api/v1/plans/Kq7vHtmWpdNrcXfa", changed.path)

    server.enqueue(reply(200, """{"apiVersion":1,"id":"Kq7vHtmWpdNrcXfa","deleted":true}"""))
    account.deletePlan("Kq7vHtmWpdNrcXfa")
    val deleted = server.takeRequest()
    assertEquals("DELETE", deleted.method)
    assertEquals("/api/v1/plans/Kq7vHtmWpdNrcXfa", deleted.path)

    server.enqueue(reply(400, """{"error":{"code":"bad_request","message":"Give the plan a title"}}"""))
    try {
      account.savePlan(null, body)
      fail("expected bad_request")
    } catch (e: ApiException.Server) {
      assertEquals("Give the plan a title", e.message)
    }

    server.enqueue(reply(401, """{"error":{"code":"unauthorized","message":"Sign in again."}}"""))
    try {
      account.editablePlan("Kq7vHtmWpdNrcXfa")
      fail("expected signed out")
    } catch (_: SignedOutException) {
      assertNull(account.sessions.current())
    }
  }

  @Test
  fun `files a report with the bearer token`() = runTest {
    account.sessions.set(Session("t.sig", "Manta", 9000))
    server.enqueue(
      reply(
        201,
        """{"apiVersion":1,"report":{"id":"r1","siteId":"banana-reef","time":"2026-11-15T08:00","direction":"outgoing","strength":"mild"},
          "award":{"points":15,"reasons":["report","fresh"],"uncounted":null,"line":"+15 points: report 10, filed soon after the dive 5."}}""",
      )
    )
    val saved = account.fileReport("banana-reef", ReportRequest("2026-11-15T08:00", "outgoing", "mild"))
    assertEquals("+15 points: report 10, filed soon after the dive 5.", saved.award?.line)
    val request = server.takeRequest()
    assertEquals("/api/v1/sites/banana-reef/reports", request.path)
    assertEquals("Bearer t.sig", request.getHeader("Authorization"))
    assertEquals("""{"time":"2026-11-15T08:00","direction":"outgoing","strength":"mild"}""", request.body.readUtf8())
  }

  @Test
  fun `forgets the token when the server says it no longer works`() = runTest {
    account.sessions.set(Session("t.sig", "Manta", 9000))
    server.enqueue(reply(401, """{"error":{"code":"unauthorized","message":"Sign in again."}}"""))
    try {
      account.fileReport("banana-reef", ReportRequest("2026-11-15T08:00", "outgoing", "mild"))
      fail("expected SignedOutException")
    } catch (_: SignedOutException) {}
    assertNull(account.sessions.session.value)
    assertNull(storage.saved)
  }

  @Test
  fun `shows the server's words for a refused report and keeps the session`() = runTest {
    account.sessions.set(Session("t.sig", "Manta", 9000))
    server.enqueue(reply(400, """{"error":{"code":"bad_request","message":"Report dives from the last 14 days."}}"""))
    try {
      account.fileReport("banana-reef", ReportRequest("2026-10-01T08:00", "outgoing", "mild"))
      fail("expected ApiException")
    } catch (e: ApiException.Server) {
      assertEquals("Report dives from the last 14 days.", e.message)
    }
    assertEquals("Manta", account.sessions.session.value?.nickname)
  }

  @Test
  fun `an expired token reads as signed out without asking the server`() = runTest {
    account.sessions.set(Session("t.sig", "Manta", 9000))
    nowMs = 10_000L
    assertNull(account.me())
    assertNull(account.sessions.session.value)
    assertEquals(0, server.requestCount)
  }

  @Test
  fun `takes a nickname changed on the web`() = runTest {
    account.sessions.set(Session("t.sig", "Manta", 9000))
    server.enqueue(reply(200, """{"apiVersion":1,"nickname":"Manta Ray","points":40,"monthPoints":20,"reports":2}"""))
    assertEquals(40, account.me()?.points)
    assertEquals("Manta Ray", storage.saved?.nickname)
  }

  @Test
  fun `signs out everywhere, then forgets the token`() = runTest {
    account.sessions.set(Session("t.sig", "Manta", 9000))
    server.enqueue(reply(200, """{"apiVersion":1}"""))
    account.signOutEverywhere()
    assertEquals("/api/v1/sign-out-everywhere", server.takeRequest().path)
    assertNull(account.sessions.session.value)
  }

  private class MemoryStorage : SessionStorage {
    var saved: Session? = null

    override fun read(): Session? = saved

    override fun write(session: Session?) {
      saved = session
    }
  }
}
