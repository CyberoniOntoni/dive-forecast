package app.fiftybar.divecurrent.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/** The reasons a diver can report content for: the server's wire values (lib/types.ts FLAG_REASONS) and their words. */
val FLAG_REASONS: List<Pair<String, String>> =
  listOf(
    "sexual" to "Nudity or sexual content",
    "violence" to "Violence or gore",
    "hate" to "Hate, harassment or bullying",
    "spam" to "Spam or advertising",
    "privacy" to "Someone's private information",
    "illegal" to "Illegal or dangerous",
    "other" to "Something else",
  )

/** Report (and, for another diver's content, Block) under a review, a site added in the app or a diver's page. */
@Composable
fun ContentActions(onReport: () -> Unit, onBlock: (() -> Unit)?, enabled: Boolean = true) {
  val colors = CurrentTheme.colors
  Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
    InlineAction("Report", color = colors.mist, enabled = enabled, onClick = onReport)
    onBlock?.let { block -> InlineAction("Block", color = colors.mist, enabled = enabled, onClick = block) }
  }
}

/**
 * A word to tap that starts flush with the text around it: a TextButton's minimum width and inner padding pushed
 * "Report" and "Remove my rating" in from the card's left edge. Still a 48 dp tall target.
 */
@Composable
fun InlineAction(text: String, color: Color, enabled: Boolean = true, onClick: () -> Unit) {
  Box(
    Modifier.heightIn(min = 48.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
    contentAlignment = Alignment.CenterStart,
  ) {
    Text(text, color = if (enabled) color else color.copy(alpha = 0.4f), style = MaterialTheme.typography.labelLarge)
  }
}

/** Picks a reason and an optional note, then sends the report to the moderators. */
@Composable
fun ReportDialog(what: String, onDismiss: () -> Unit, onSend: (reason: String, note: String) -> Unit) {
  var reason by remember { mutableStateOf<String?>(null) }
  var note by remember { mutableStateOf("") }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("Report this $what") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()).selectableGroup(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text("What is wrong with it? A moderator will look.", style = MaterialTheme.typography.bodyMedium)
        FLAG_REASONS.forEach { (value, label) ->
          Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = reason == value, role = Role.RadioButton) { reason = value },
          ) {
            RadioButton(selected = reason == value, onClick = null, modifier = Modifier.padding(end = 8.dp))
            Text(label, style = MaterialTheme.typography.bodyMedium)
          }
        }
        OutlinedTextField(
          value = note,
          onValueChange = { note = it.take(500) },
          label = { Text("Anything to add (optional)") },
          minLines = 2,
          modifier = Modifier.fillMaxWidth(),
        )
      }
    },
    confirmButton = { TextButton(onClick = { reason?.let { onSend(it, note.trim()) } }, enabled = reason != null) { Text("Send report") } },
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  )
}

/** Asks before blocking a diver. */
@Composable
fun BlockDialog(nickname: String, onDismiss: () -> Unit, onBlock: () -> Unit) {
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("Block $nickname?") },
    text = { Text("You will no longer see their reviews and photos. You can unblock them on your account screen.") },
    confirmButton = { TextButton(onClick = onBlock) { Text("Block") } },
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  )
}
