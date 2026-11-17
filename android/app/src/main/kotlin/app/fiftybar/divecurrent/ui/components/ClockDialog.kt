package app.fiftybar.divecurrent.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import java.time.LocalTime

/**
 * A 24-hour clock in a dialog: the dive time on a plan and on a report.
 *
 * The stock TimePicker draws its hour and minute in displayLarge inside fixed 96 x 80 dp boxes. Tideline's
 * displayLarge is 84 sp (the site page's answer), which does not fit there: the digits were cut to slivers of "0".
 * So the clock gets Material's own size back (57 sp, still Space Grotesk), and colours that tell the picked field
 * from the other (both sat on `reef` before).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClockDialog(title: String, initial: LocalTime, onPicked: (LocalTime) -> Unit, onDismiss: () -> Unit) {
  val colors = CurrentTheme.colors
  val picker = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute, is24Hour = true)
  val type = MaterialTheme.typography
  MaterialTheme(typography = type.copy(displayLarge = type.displayLarge.copy(fontSize = 57.sp, lineHeight = 64.sp, letterSpacing = 0.sp))) {
    // Not the platform's narrow dialog width: the clock face alone is 256 dp, plus its padding.
    BasicAlertDialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false), modifier = Modifier.padding(16.dp)) {
      Surface(shape = RoundedCornerShape(28.dp), color = colors.deep, contentColor = colors.foam, border = BorderStroke(1.dp, colors.line)) {
        // Scrolls on a short screen rather than cutting off Done.
        Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
          Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.fillMaxWidth().padding(bottom = 20.dp))
          TimePicker(
            state = picker,
            colors =
              TimePickerDefaults.colors(
                clockDialColor = colors.reef,
                clockDialSelectedContentColor = colors.ink,
                clockDialUnselectedContentColor = colors.foam,
                selectorColor = colors.incoming,
                timeSelectorSelectedContainerColor = colors.incoming.copy(alpha = 0.22f),
                timeSelectorSelectedContentColor = colors.foam,
                timeSelectorUnselectedContainerColor = colors.reef,
                timeSelectorUnselectedContentColor = colors.mist,
              ),
          )
          Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onDismiss) { Text("Cancel") }
            TextButton(onClick = { onPicked(LocalTime.of(picker.hour, picker.minute)) }) { Text("Done") }
          }
        }
      }
    }
  }
}
