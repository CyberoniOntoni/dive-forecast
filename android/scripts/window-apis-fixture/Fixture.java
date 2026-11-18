// Positive control for check-window-apis.sh: compiled with d8 and run through the same dexdump + awk on every check,
// so a change in dexdump's output format fails the check instead of silently finding nothing.
import android.view.Window;
import android.view.WindowManager;

class Fixture {
  @SuppressWarnings("deprecation")
  static void flagged(Window window) {
    window.setStatusBarColor(0);
    window.setNavigationBarColor(0);
    WindowManager.LayoutParams attrs = window.getAttributes();
    attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
    window.setAttributes(attrs);
  }

  static void fine(WindowManager.LayoutParams attrs) {
    attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
  }
}
