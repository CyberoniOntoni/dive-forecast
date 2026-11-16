package app.fiftybar.divecurrent.ui.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalUriHandler
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
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AccountUiState(val me: ApiMe? = null, val busy: Boolean = true, val error: String? = null)

class AccountViewModel(private val account: AccountRepository) : ViewModel() {
  private val _state = MutableStateFlow(AccountUiState())
  val state: StateFlow<AccountUiState> = _state.asStateFlow()
  val session = account.sessions.session

  init {
    load()
  }

  fun load() = act { _state.update { it.copy(me = account.me()) } }

  fun signOut() = account.signOut()

  fun signOutEverywhere() = act { account.signOutEverywhere() }

  private fun act(block: suspend () -> Unit) {
    _state.update { it.copy(busy = true, error = null) }
    viewModelScope.launch {
      try {
        block()
        _state.update { it.copy(busy = false) }
      } catch (_: SignedOutException) {
        _state.update { it.copy(busy = false) }
      } catch (e: ApiException) {
        _state.update { it.copy(busy = false, error = e.message) }
      }
    }
  }
}

/** The signed-in diver: nickname, points, sign out. The rest of the account (About me, nickname) is on the web. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(onBack: () -> Unit) {
  val account = appAccount()
  val viewModel: AccountViewModel = viewModel { AccountViewModel(account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val session by viewModel.session.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  val uri = LocalUriHandler.current
  var confirmEverywhere by remember { mutableStateOf(false) }

  // Signed out here, everywhere, or by the server: nothing left to show.
  LaunchedEffect(session) { if (session == null) onBack() }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text(session?.nickname ?: "Account") },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    Column(
      Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
      state.me?.let { me ->
        Text("${me.points} points", style = MaterialTheme.typography.headlineMedium, color = colors.foam)
        val lines =
          buildList {
            add("${me.monthPoints} this month")
            add(if (me.reports == 1) "1 report" else "${me.reports} reports")
            me.monthRank?.let { add("#$it this month") }
            me.allRank?.let { add("#$it all time") }
          }
        Text(lines.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = colors.foam)
      }
      state.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
      OutlinedButton(
        onClick = { uri.openUri("${BuildConfig.WEB_URL}/scoreboard") },
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
      ) {
        Text("Scoreboard on the web")
      }
      OutlinedButton(
        onClick = { uri.openUri("${BuildConfig.WEB_URL}/account") },
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
      ) {
        Text("Nickname and About me on the web")
      }
      OutlinedButton(onClick = viewModel::signOut, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text("Sign out on this phone")
      }
      TextButton(onClick = { confirmEverywhere = true }, enabled = !state.busy) { Text("Sign out everywhere") }
    }
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
