package app.fiftybar.divecurrent.ui.site

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.BuildConfig
import app.fiftybar.divecurrent.data.api.ApiSiteTexts
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.filled.Info
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign

/**
 * "Suggest an edit" for a site's About the site and How to dive it, as the web's card: a moderator approves each edit
 * before it shows with the diver's name; a moderator's own goes live at once. Signed out, it offers sign-in.
 */
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
  var confirmWithdraw by remember { mutableStateOf(false) }
  val leave: () -> Unit = { if (state.dirty) confirmLeave = true else onBack() }
  // Leaving while sending would drop the answer unseen; leaving a changed form asks first.
  BackHandler(enabled = state.busy || state.dirty) { if (!state.busy) confirmLeave = true }
  val form = state.form
  // The form proper, with Send held at the bottom above the keyboard.
  val editing = session != null && form != null && form.canEdit && !form.needsTerms

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      // As the site page's header: the round back button, then the screen's name over the site's.
      Row(
        Modifier.fillMaxWidth().background(colors.ink).statusBarsPadding().padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
      ) {
        RoundButton(onClick = { if (!state.busy) leave() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to the site") }
        Column(Modifier.weight(1f)) {
          val empty = form != null && form.texts.description.isEmpty() && form.texts.howToDive.isEmpty()
          Text(
            when {
              form?.moderator == true -> "Edit site texts"
              empty -> "Write about this site"
              else -> "Suggest an edit"
            },
            style = MaterialTheme.typography.titleLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { heading() },
          )
          Text(siteName, style = MaterialTheme.typography.bodyMedium, color = colors.mist, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (editing && state.dirty && !state.busy) {
          TextButton(onClick = viewModel::undo, modifier = Modifier.heightIn(min = 48.dp)) { Text("Undo", color = colors.incoming) }
        }
      }
    },
    bottomBar = {
      if (editing) {
        Column(
          Modifier.fillMaxWidth()
            .background(colors.ink)
            .drawBehind { drawLine(colors.line, Offset(0f, 0f), Offset(size.width, 0f), strokeWidth = 1.dp.toPx()) }
            .navigationBarsPadding()
            .imePadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 12.dp),
          verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
          state.error?.let {
            Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
          }
          // Why Send is off on a waiting edit: there is nothing new in it yet.
          if (!state.busy && !state.dirty && form?.mine?.status == "pending") {
            Text(
              "Change a text to update your edit.",
              style = MaterialTheme.typography.bodySmall,
              color = colors.mist,
              textAlign = TextAlign.Center,
              modifier = Modifier.fillMaxWidth(),
            )
          }
          Button(
            onClick = viewModel::send,
            // Untouched, a waiting edit would only be sent again as it is (and go to the back of the queue).
            enabled = !state.busy && state.dirty && state.body != null,
            shape = RoundedCornerShape(18.dp),
            colors =
              ButtonDefaults.buttonColors(
                containerColor = colors.incoming,
                contentColor = colors.ink,
                disabledContainerColor = colors.deep,
                disabledContentColor = colors.dim,
              ),
            border = if (state.dirty || state.busy) null else BorderStroke(1.dp, colors.line),
            modifier = Modifier.fillMaxWidth().height(56.dp),
          ) {
            Text(
              when {
                state.busy -> "Sending…"
                form?.moderator == true -> "Save · goes live at once"
                form?.mine?.status == "pending" -> "Update my waiting edit"
                else -> "Send for review"
              },
              style = MaterialTheme.typography.titleMedium,
            )
          }
        }
      }
    },
  ) { padding ->
    Column(
      Modifier.fillMaxSize()
        .padding(padding)
        .verticalScroll(rememberScrollState())
        .padding(horizontal = 16.dp)
        .then(if (editing) Modifier else Modifier.navigationBarsPadding()),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Filled.Info, contentDescription = null, tint = colors.dim, modifier = Modifier.padding(top = 1.dp).size(18.dp))
        Text(
          if (form?.moderator == true) {
            "You're a moderator: what you save shows on the site at once."
          } else {
            "Divers write these texts together. A moderator reads each edit before it shows; once approved, your name is in the credits."
          },
          style = MaterialTheme.typography.bodyMedium,
          color = colors.mist,
        )
      }
      if (session == null) {
        SurfaceCard {
          Text("Sign in to write about sites", style = MaterialTheme.typography.titleSmall)
          Text("It takes your email and a code we send you.", style = MaterialTheme.typography.bodyMedium, color = colors.mist)
          Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Sign in") }
        }
        return@Column
      }
      if (form == null) {
        if (state.loading) Text("Loading…", style = MaterialTheme.typography.bodyMedium, color = colors.mist)
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
        SurfaceCard {
          Text("This account can't edit sites", style = MaterialTheme.typography.titleSmall, color = colors.stop)
          Text("Write to support@50bar.app if you think that's a mistake.", style = MaterialTheme.typography.bodyMedium, color = colors.mist)
        }
        return@Column
      }
      // Withdrawing resets the form to what the site says: typed changes would go with it, so ask first.
      val waiting = form.mine?.status == "pending"
      MyEditCard(
        form,
        busy = state.busy,
        // Just sent: the thanks goes in the waiting card rather than a second line saying much the same.
        thanks = state.done.takeIf { waiting },
        onWithdraw = { if (state.dirty) confirmWithdraw = true else viewModel.withdraw() },
      )
      state.done?.takeUnless { waiting }?.let {
        StatusRow(color = colors.incoming, title = it, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
      }
      TextSection(
        label = "About the site",
        hint = "What the site is: the reef, its depth, what lives there, what makes it special.",
        value = state.draft.description,
        max = form.limits.description,
        changed = state.draft.description != state.start?.description,
        enabled = !state.busy,
        minLines = 5,
        onChange = { text -> viewModel.edit { it.copy(description = text) } },
      )
      if (form.adderTextHidden) {
        SurfaceCard(title = "How to dive it") {
          Text(
            "You blocked the diver who added this site, so How to dive it is hidden and can't be edited here.",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.mist,
          )
        }
      } else {
        TextSection(
          label = "How to dive it",
          hint = "Where to drop in, which way to go on an incoming or outgoing current, hazards.",
          value = state.draft.howToDive,
          max = form.limits.howToDive,
          changed = state.draft.howToDive != state.start?.howToDive,
          enabled = !state.busy,
          minLines = 5,
          onChange = { text -> viewModel.edit { it.copy(howToDive = text) } },
        )
      }
      if (!form.moderator) {
        TextSection(
          label = "Note to the moderators",
          tag = "Optional",
          hint = "Why the change, or where it comes from. Only moderators see it.",
          value = state.draft.note,
          max = form.limits.note,
          changed = false,
          enabled = !state.busy,
          minLines = 2,
          onChange = { text -> viewModel.edit { it.copy(note = text) } },
        )
      }
      Spacer(Modifier.height(8.dp))
    }
  }
  if (confirmWithdraw) {
    AlertDialog(
      onDismissRequest = { confirmWithdraw = false },
      title = { Text("Withdraw your edit?") },
      text = { Text("The form goes back to what the site says, and what you typed since is lost.") },
      confirmButton = {
        TextButton(
          onClick = {
            confirmWithdraw = false
            viewModel.withdraw()
          },
        ) { Text("Withdraw") }
      },
      dismissButton = { TextButton(onClick = { confirmWithdraw = false }) { Text("Keep editing") } },
    )
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

/**
 * One text in its own card: the heading with "Not sent" while it holds typing not sent yet and the count on the right
 * (warning near the limit), then the field.
 */
@Composable
private fun TextSection(
  label: String,
  tag: String? = null,
  hint: String,
  value: String,
  max: Int,
  changed: Boolean,
  enabled: Boolean,
  minLines: Int,
  onChange: (String) -> Unit,
) {
  val colors = CurrentTheme.colors
  SurfaceCard {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      CardTitle(label)
      tag?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.dim) }
      if (changed) Pill("Not sent")
      Spacer(Modifier.weight(1f))
      Text(
        "${value.length} / $max",
        style = MaterialTheme.typography.bodySmall,
        color = if (value.length > max * 0.9) colors.stop else colors.dim,
        modifier = Modifier.semantics { contentDescription = "${value.length} of $max characters" },
      )
    }
    OutlinedTextField(
      value = value,
      onValueChange = { onChange(it.take(max)) },
      enabled = enabled,
      placeholder = { Text(hint, color = colors.dim) },
      keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
      minLines = minLines,
      shape = RoundedCornerShape(14.dp),
      // Set into the card a shade darker, so the field reads as the place to type.
      colors =
        OutlinedTextFieldDefaults.colors(
          focusedBorderColor = colors.incoming,
          unfocusedBorderColor = colors.line,
          focusedContainerColor = colors.ink,
          unfocusedContainerColor = colors.ink,
          disabledContainerColor = colors.ink,
          cursorColor = colors.incoming,
        ),
      modifier = Modifier.fillMaxWidth(),
    )
  }
}

/** A small rounded label. */
@Composable
private fun Pill(text: String) {
  val colors = CurrentTheme.colors
  Text(
    text,
    style = MaterialTheme.typography.labelMedium,
    color = colors.foam,
    modifier = Modifier.background(colors.tide.copy(alpha = 0.45f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 3.dp),
  )
}

/** A coloured dot and a line, with an optional second line under it. */
@Composable
private fun StatusRow(color: Color, title: String, detail: String? = null, modifier: Modifier = Modifier) {
  val colors = CurrentTheme.colors
  Row(modifier, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
    Box(Modifier.padding(top = 6.dp).size(8.dp).background(color, CircleShape))
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(title, style = MaterialTheme.typography.bodyMedium)
      detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.mist) }
    }
  }
}

/** The diver's own edit: waiting (with Withdraw), or the last one a moderator looked at. */
@Composable
private fun MyEditCard(form: ApiSiteTexts, busy: Boolean, thanks: String?, onWithdraw: () -> Unit) {
  val mine = form.mine ?: return
  val colors = CurrentTheme.colors
  SurfaceCard {
    when (mine.status) {
      "pending" -> {
        StatusRow(
          colors.tide,
          "Your edit is waiting for a moderator",
          thanks ?: "It's in the form below. Change it and send again, or set a text back to what the site says to drop that part.",
        )
        OutlinedButton(
          onClick = onWithdraw,
          enabled = !busy,
          border = BorderStroke(1.dp, colors.foam.copy(alpha = 0.5f)),
          colors = ButtonDefaults.outlinedButtonColors(contentColor = colors.foam),
          modifier = Modifier.heightIn(min = 48.dp),
        ) { Text("Withdraw my edit") }
      }
      "rejected" ->
        StatusRow(colors.stop, "A moderator didn't take your last edit", mine.rejectReason?.let { "Their reason: $it" })
      else -> StatusRow(colors.incoming, "Your last edit was approved", "Thanks! Your name is in the site's credits.")
    }
  }
}
