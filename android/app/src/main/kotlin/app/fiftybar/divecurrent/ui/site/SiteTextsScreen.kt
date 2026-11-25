package app.fiftybar.divecurrent.ui.site

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.BuildConfig
import app.fiftybar.divecurrent.data.api.ApiSiteTexts
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/**
 * "Suggest an edit" for a site's About the site and How to dive it, as the web's card: a moderator approves each edit
 * before it shows with the diver's name; a moderator's own goes live at once. Signed out, it offers sign-in.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SiteTextsScreen(siteId: String, siteName: String, onBack: () -> Unit, onSignIn: () -> Unit) {
  val repository = appRepository()
  val account = appAccount()
  val viewModel: SiteTextsViewModel = viewModel(key = "site-texts/$siteId") { SiteTextsViewModel(siteId, repository, account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val session by viewModel.session.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  val uri = LocalUriHandler.current
  var confirmLeave by remember { mutableStateOf(false) }
  val leave: () -> Unit = { if (state.dirty) confirmLeave = true else onBack() }
  // Leaving while sending would drop the answer unseen; leaving a changed form asks first.
  BackHandler(enabled = state.busy || state.dirty) { if (!state.busy) confirmLeave = true }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text(siteName) },
        navigationIcon = {
          IconButton(onClick = leave, enabled = !state.busy) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to the site") }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    Column(
      Modifier.fillMaxSize()
        .padding(padding)
        .verticalScroll(rememberScrollState())
        .padding(horizontal = 16.dp)
        .navigationBarsPadding()
        .imePadding(),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Text("Write about this site", style = MaterialTheme.typography.titleMedium)
      Text(
        "Divers write these texts together. A moderator looks at each edit before it shows; once approved, your name shows under the texts.",
        style = MaterialTheme.typography.bodyMedium,
        color = colors.foam.copy(alpha = 0.85f),
      )
      if (session == null) {
        Text("Sign in with your email to suggest an edit.", style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Sign in") }
        return@Column
      }
      val form = state.form
      if (form == null) {
        if (state.loading) Text("Loading…", style = MaterialTheme.typography.bodyMedium)
        state.error?.let {
          Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium)
          OutlinedButton(onClick = viewModel::load, modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again") }
        }
        return@Column
      }
      if (form.needsTerms) {
        SurfaceCard {
          Text("Agree to the content rules", style = MaterialTheme.typography.titleSmall)
          Text(
            "Before you write about a site: no nudity, hate, harassment or spam. Posts that break the rules are removed and their divers banned.",
            style = MaterialTheme.typography.bodyMedium,
          )
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = viewModel::acceptTerms, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("I agree") }
            TextButton(onClick = { uri.openUri("${BuildConfig.WEB_URL}/terms") }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Read the rules") }
          }
        }
        state.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
        return@Column
      }
      if (!form.canEdit) {
        Text("This account cannot edit sites.", style = MaterialTheme.typography.bodyMedium, color = colors.stop)
        return@Column
      }
      MyEditCard(form, busy = state.busy, onWithdraw = viewModel::withdraw)
      val locked = state.busy
      OutlinedTextField(
        value = state.draft.description,
        onValueChange = { text -> viewModel.edit { it.copy(description = text.take(form.limits.description)) } },
        enabled = !locked,
        label = { Text("About the site") },
        placeholder = { Text("What the site is: reef, depth, what lives there, what makes it special.") },
        supportingText = { Text("${state.draft.description.length} of ${form.limits.description}") },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        minLines = 4,
        modifier = Modifier.fillMaxWidth(),
      )
      if (form.adderTextHidden) {
        Text(
          "You blocked the diver who added this site, so How to dive it is hidden and can't be edited here.",
          style = MaterialTheme.typography.bodySmall,
          color = colors.foam.copy(alpha = 0.8f),
        )
      } else {
        OutlinedTextField(
          value = state.draft.howToDive,
          onValueChange = { text -> viewModel.edit { it.copy(howToDive = text.take(form.limits.howToDive)) } },
          enabled = !locked,
          label = { Text("How to dive it") },
          placeholder = { Text("Where to drop in, which way to go on an incoming or outgoing current, hazards.") },
          supportingText = { Text("${state.draft.howToDive.length} of ${form.limits.howToDive}") },
          keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
          minLines = 4,
          modifier = Modifier.fillMaxWidth(),
        )
      }
      if (!form.moderator) {
        OutlinedTextField(
          value = state.draft.note,
          onValueChange = { text -> viewModel.edit { it.copy(note = text.take(form.limits.note)) } },
          enabled = !locked,
          label = { Text("Note to the moderators · optional") },
          placeholder = { Text("Why the change, or where it comes from.") },
          supportingText = { Text("${state.draft.note.length} of ${form.limits.note}") },
          keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
          modifier = Modifier.fillMaxWidth(),
        )
      }
      state.error?.let {
        Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
      }
      state.done?.let {
        Text(it, color = colors.incoming, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
      }
      Button(
        onClick = viewModel::send,
        // Untouched, a waiting edit would only be sent again as it is (and go to the back of the queue).
        enabled = !locked && state.dirty && state.body != null,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
      ) {
        Text(
          when {
            state.busy -> "Sending…"
            form.moderator -> "Save (goes live at once)"
            form.mine?.status == "pending" -> "Change my waiting edit"
            else -> "Send for review"
          },
        )
      }
      Spacer(Modifier.height(24.dp))
    }
  }
  if (confirmLeave) {
    AlertDialog(
      onDismissRequest = { confirmLeave = false },
      title = { Text("Leave without sending?") },
      text = { Text("Your changes to this site's texts will be lost.") },
      confirmButton = {
        TextButton(
          onClick = {
            confirmLeave = false
            onBack()
          },
        ) { Text("Leave") }
      },
      dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("Keep editing") } },
    )
  }
}

/** The diver's own edit: waiting (with Withdraw), or the last one a moderator looked at. */
@Composable
private fun MyEditCard(form: ApiSiteTexts, busy: Boolean, onWithdraw: () -> Unit) {
  val mine = form.mine ?: return
  val colors = CurrentTheme.colors
  SurfaceCard {
    when (mine.status) {
      "pending" -> {
        Text("Your edit is waiting for a moderator", style = MaterialTheme.typography.titleSmall)
        Text(
          "The form below shows it. Sending again changes it; setting a text back to what the site says drops that part.",
          style = MaterialTheme.typography.bodyMedium,
        )
        OutlinedButton(onClick = onWithdraw, enabled = !busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Withdraw my edit") }
      }
      "rejected" -> {
        Text("A moderator did not take your last edit", style = MaterialTheme.typography.titleSmall)
        mine.rejectReason?.let { Text("Reason: $it", style = MaterialTheme.typography.bodyMedium, color = colors.stop) }
      }
      else -> Text("Your last edit was approved. Thanks!", style = MaterialTheme.typography.titleSmall)
    }
  }
}
