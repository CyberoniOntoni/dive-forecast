package app.fiftybar.divecurrent

import app.fiftybar.divecurrent.ui.components.Tab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TabOfTest {
  @Test
  fun `the map alone is the Now tab`() {
    assertEquals(Tab.Now, tabOf(listOf(MapKey)))
  }

  @Test
  fun `a tab's top screen right on the map shows its tab`() {
    assertEquals(Tab.Plans, tabOf(listOf(MapKey, PlansKey)))
    assertEquals(Tab.Navigate, tabOf(listOf(MapKey, NavigatePickKey)))
    assertEquals(Tab.You, tabOf(listOf(MapKey, AccountKey)))
    assertEquals(Tab.You, tabOf(listOf(MapKey, SignInKey)))
  }

  @Test
  fun `deeper screens hide the bar`() {
    assertNull(tabOf(listOf(MapKey, SiteKey("kandooma-thila"))))
    assertNull(tabOf(listOf(MapKey, PlansKey, PlanKey("abcdefghijklmnop"))))
    // Sign-in asked for from a site page is not the You tab.
    assertNull(tabOf(listOf(MapKey, SiteKey("kandooma-thila"), SignInKey)))
    // Plans opened from the account screen are a step inside You, not the Plans tab.
    assertNull(tabOf(listOf(MapKey, AccountKey, PlansKey)))
  }
}
