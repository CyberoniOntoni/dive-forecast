package app.fiftybar.divecurrent.ui.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.BuildConfig
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiMe
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.scoreboard.BadgeList
import app.fiftybar.divecurrent.ui.scoreboard.ProfileCard
import app.fiftybar.divecurrent.ui.scoreboard.Stat
import app.fiftybar.divecurrent.ui.scoreboard.StatGrid
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AccountUiState(
  val me: ApiMe? = null,
  val busy: Boolean = true,
  val error: String? = null,
  /** About me and the nickname as being typed; they start as saved. */
  val aboutDraft: String = "",
  val nicknameDraft: String = "",
  /** "About me saved.", "Nickname saved." */
  val note: String? = null,
  /** A save the server turned down, in its words, under the field it is about. */
  val aboutError: String? = null,
  val nicknameError: String? = null,
)

class AccountViewModel(private val account: AccountRepository) : ViewModel() {
  private val _state = MutableStateFlow(AccountUiState())
  val state: StateFlow<AccountUiState> = _state.asStateFlow()
  val session = account.sessions.session

  init {
    load()
  }

  fun load() =
    act {
      val me = account.me()
      _state.update { it.copy(me = me, aboutDraft = me?.about.orEmpty(), nicknameDraft = me?.nickname.orEmpty()) }
    }

  fun editAbout(text: String) {
    val max = _state.value.me?.aboutMaxChars ?: 300
    _state.update { it.copy(aboutDraft = text.take(max), aboutError = null, note = null) }
  }

  fun editNickname(text: String) = _state.update { it.copy(nicknameDraft = text.take(20), nicknameError = null, note = null) }

  fun saveAbout() =
    act(onRefused = { message -> _state.update { it.copy(aboutError = message) } }) {
      val saved = account.saveAbout(_state.value.aboutDraft)
      _state.update { it.copy(me = it.me?.copy(about = saved), aboutDraft = saved, note = "About me saved.") }
    }

  fun saveNickname() =
    act(onRefused = { message -> _state.update { it.copy(nicknameError = message) } }) {
      val saved = account.saveNickname(_state.value.nicknameDraft)
      _state.update { it.copy(me = it.me?.copy(nickname = saved), nicknameDraft = saved, note = "Nickname saved.") }
    }

  fun signOut() = account.signOut()

  fun signOutEverywhere() = act { account.signOutEverywhere() }

  fun deleteAccount() = act { account.deleteAccount() }

  /** Agrees to the content rules, for divers from before them. */
  fun acceptTerms() =
    act {
      account.acceptTerms()
      _state.update { it.copy(me = it.me?.copy(acceptedTerms = true), note = "Thanks. You can post reviews and photos.") }
    }

  fun unblock(nickname: String) =
    act {
      account.block(nickname, false)
      _state.update { it.copy(me = it.me?.let { me -> me.copy(blocked = me.blocked - nickname) }, note = "$nickname is unblocked.") }
    }

  private fun act(onRefused: ((String?) -> Unit)? = null, block: suspend () -> Unit) {
    _state.update { it.copy(busy = true, error = null, note = null) }
    viewModelScope.launch {
      try {
        block()
        _state.update { it.copy(busy = false) }
      } catch (_: SignedOutException) {
        _state.update { it.copy(busy = false) }
      } catch (e: ApiException) {
        val refused = onRefused != null && e is ApiException.Server && e.status == 400
        if (refused) onRefused(e.message)
        _state.update { it.copy(busy = false, error = if (refused) null else e.message) }
      }
    }
  }
}

/**
 * The signed-in diver's own page, as the web's (app/account): points and ranks, badges, how points work, About me and
 * the nickname, and signing out. The email is never shown in the app.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
  onBack: (() -> Unit)?,
  onSignedOut: () -> Unit,
  onPlans: () -> Unit,
  onScoreboard: () -> Unit,
  onMyPage: (String) -> Unit,
) {
  val account = appAccount()
  val viewModel: AccountViewModel = viewModel { AccountViewModel(account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val session by viewModel.session.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  var confirmEverywhere by remember { mutableStateOf(false) }
  var confirmDelete by remember { mutableStateOf(false) }
  val uri = LocalUriHandler.current

  // Signed out here, everywhere, or by the server: nothing left to show.
  LaunchedEffect(session) { if (session == null) onSignedOut() }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text(session?.nickname ?: "Account") },
        navigationIcon = { onBack?.let { back -> IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    Column(
      Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
      state.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
      state.note?.let {
        Text(it, style = MaterialTheme.typography.bodyMedium, color = colors.incoming, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
      }
      state.me?.takeIf { !it.acceptedTerms }?.let {
        ProfileCard {
          Text("Agree to the content rules", style = MaterialTheme.typography.titleSmall)
          Text(
            "Before you post reviews, photos, sites or an About me: no nudity, hate, harassment or spam. Posts that break the rules " +
              "are removed and their divers banned.",
            style = MaterialTheme.typography.bodyMedium,
          )
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = viewModel::acceptTerms, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("I agree") }
            TextButton(onClick = { uri.openUri("${BuildConfig.WEB_URL}/terms") }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Read the rules") }
          }
        }
      }
      state.me?.let { me ->
        StatGrid(
          listOf(
            Stat("Points", me.points),
            Stat("This month", me.monthPoints, me.monthRank?.let { "#$it" }),
            Stat("Reports", me.reports, if (me.ratings > 0) "${me.ratings} rating${if (me.ratings == 1) "" else "s"}" else null),
            Stat("Sites", me.reportSites, if (me.atolls > 0) "${me.atolls} atoll${if (me.atolls == 1) "" else "s"}" else null),
          )
        )
        me.allRank?.let { Text("#$it all time", style = MaterialTheme.typography.bodyMedium, color = colors.foam.copy(alpha = 0.8f)) }
      }
      OutlinedButton(onClick = onScoreboard, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("See the scoreboard") }
      OutlinedButton(onClick = onPlans, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("My dive plans") }
      state.me?.let { me ->
        OutlinedButton(onClick = { onMyPage(me.nickname) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
          Text("My public page")
        }
        if (me.badges.isNotEmpty()) {
          Text("Badges", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          BadgeList(me.badges)
        }
        if (me.pointsRules.isNotEmpty()) {
          ProfileCard {
            Text("How points work", style = MaterialTheme.typography.titleSmall)
            me.pointsRules.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
          }
        }
        Text("About me", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(
          "Shown to everyone on your public page, which opens from your nickname on the scoreboard. Where you dive, how long, what you like to see.",
          style = MaterialTheme.typography.bodySmall,
          color = colors.foam.copy(alpha = 0.75f),
        )
        OutlinedTextField(
          value = state.aboutDraft,
          onValueChange = viewModel::editAbout,
          enabled = !state.busy,
          supportingText = { Text(state.aboutError ?: "${state.aboutDraft.length} of ${me.aboutMaxChars}", color = if (state.aboutError != null) colors.stop else colors.foam.copy(alpha = 0.7f)) },
          isError = state.aboutError != null,
          minLines = 3,
          modifier = Modifier.fillMaxWidth(),
        )
        if (state.aboutDraft.trim() != me.about) {
          Button(onClick = viewModel::saveAbout, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(if (state.aboutDraft.isBlank()) "Clear About me" else "Save About me")
          }
        }
        Text("Nickname", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
          value = state.nicknameDraft,
          onValueChange = viewModel::editNickname,
          enabled = !state.busy,
          singleLine = true,
          supportingText = { Text(state.nicknameError ?: "Shown with your reports and on the scoreboard.", color = if (state.nicknameError != null) colors.stop else colors.foam.copy(alpha = 0.7f)) },
          isError = state.nicknameError != null,
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
          modifier = Modifier.fillMaxWidth(),
        )
        if (state.nicknameDraft.trim() != me.nickname && state.nicknameDraft.isNotBlank()) {
          Button(onClick = viewModel::saveNickname, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Save nickname") }
        }
      }
      state.me?.blocked?.takeIf { it.isNotEmpty() }?.let { blocked ->
        Text("Divers you blocked", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        blocked.forEach { nickname ->
          Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text(nickname, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = { viewModel.unblock(nickname) }, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) { Text("Unblock") }
          }
        }
      }
      OutlinedButton(onClick = viewModel::signOut, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text("Sign out on this phone")
      }
      TextButton(onClick = { confirmEverywhere = true }, enabled = !state.busy) { Text("Sign out everywhere") }
      TextButton(onClick = { confirmDelete = true }, enabled = !state.busy) { Text("Delete account", color = colors.stop) }
      Row {
        TextButton(onClick = { uri.openUri("${BuildConfig.WEB_URL}/privacy") }) { Text("Privacy policy") }
        TextButton(onClick = { uri.openUri("${BuildConfig.WEB_URL}/terms") }) { Text("Content rules") }
      }
    }
  }

  if (confirmDelete) {
    AlertDialog(
      onDismissRequest = { confirmDelete = false },
      title = { Text("Delete your account?") },
      text = {
        Text(
          "This deletes your email, nickname, About me, dive plans, ratings, reviews and photos, and signs you out everywhere. " +
            "Your dive reports stay, with no name on them, because they teach the forecast. It cannot be undone."
        )
      },
      confirmButton = {
        TextButton(
          onClick = {
            confirmDelete = false
            viewModel.deleteAccount()
          }
        ) {
          Text("Delete account", color = colors.stop)
        }
      },
      dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
    )
  }

  if (confirmEverywhere) {
    AlertDialog(
      onDismissRequest = { confirmEverywhere = false },
      title = { Text("Sign out everywhere?") },
      text = { Text("This ends your sign-in on every phone and browser, this one too.") },
      confirmButton = {
        TextButton(
          onClick = {
            confirmEverywhere = false
            viewModel.signOutEverywhere()
          }
        ) {
          Text("Sign out everywhere")
        }
      },
      dismissButton = { TextButton(onClick = { confirmEverywhere = false }) { Text("Cancel") } },
    )
  }
}
