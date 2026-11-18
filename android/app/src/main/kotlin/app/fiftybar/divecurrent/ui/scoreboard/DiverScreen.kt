package app.fiftybar.divecurrent.ui.scoreboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.api.ApiBadge
import app.fiftybar.divecurrent.data.api.ApiDiver
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.data.SignedOutException
import app.fiftybar.divecurrent.data.api.FlagBody
import app.fiftybar.divecurrent.ui.components.BlockDialog
import app.fiftybar.divecurrent.ui.components.ContentActions
import app.fiftybar.divecurrent.ui.components.ReportDialog
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DiverUiState(
  val diver: ApiDiver? = null,
  val loading: Boolean = true,
  val error: String? = null,
  /** "Thanks. A moderator will look at it." */
  val note: String? = null,
)

class DiverViewModel(private val nickname: String, private val account: AccountRepository) : ViewModel() {
  private val _state = MutableStateFlow(DiverUiState())
  val state: StateFlow<DiverUiState> = _state.asStateFlow()

  init {
    load()
  }

  /**
   * Reads the page again, as on coming back from editing About me. The diver's own page follows their nickname, so a
   * rename made meanwhile does not turn it into "nobody goes by that".
   */
  fun load() {
    val name = if (_state.value.diver?.isMe == true) account.sessions.current()?.nickname ?: nickname else nickname
    viewModelScope.launch {
      try {
        val diver = account.diver(name)
        _state.update { it.copy(diver = diver, loading = false) }
      } catch (e: ApiException) {
        val gone = e is ApiException.Server && e.code == "not_found"
        _state.update { it.copy(loading = false, error = if (gone) "No diver goes by $name now." else e.message) }
      }
    }
  }

  val signedIn: Boolean
    get() = account.sessions.current() != null

  /** Reports this diver's nickname or About me to the moderators. */
  fun report(reason: String, note: String) =
    act("Thanks. A moderator will look at it.") {
      account.report(FlagBody("diver", nickname = _state.value.diver?.nickname ?: nickname, reason = reason, note = note.ifBlank { null }))
    }

  /** Blocks or unblocks this diver, then reads the page again. */
  fun block(blocked: Boolean) =
    act(if (blocked) "Blocked." else "Unblocked.") {
      account.block(_state.value.diver?.nickname ?: nickname, blocked)
      load()
    }

  private fun act(done: String, call: suspend () -> Unit) {
    viewModelScope.launch {
      _state.update { it.copy(error = null, note = null) }
      try {
        call()
        _state.update { it.copy(note = done) }
      } catch (_: SignedOutException) {
        _state.update { it.copy(error = "Sign in again first.") }
      } catch (e: ApiException) {
        _state.update { it.copy(error = e.message) }
      }
    }
  }
}

/** A diver's public page, as the web's (app/divers): nickname, About me, numbers and earned badges. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiverScreen(nickname: String, onBack: () -> Unit, onAccount: () -> Unit, onSignIn: () -> Unit = onAccount) {
  val account = appAccount()
  val viewModel: DiverViewModel = viewModel(key = "diver/$nickname") { DiverViewModel(nickname, account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  var reporting by remember { mutableStateOf(false) }
  var blocking by remember { mutableStateOf(false) }
  // Back from the account screen: show the About me or nickname just saved.
  var shownOnce by remember { mutableStateOf(false) }
  LifecycleResumeEffect(viewModel) {
    if (shownOnce) viewModel.load() else shownOnce = true
    onPauseOrDispose {}
  }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text(state.diver?.nickname ?: nickname, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    Column(
      Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
      state.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
      val diver = state.diver ?: return@Column
      Text(diver.sinceLine, style = MaterialTheme.typography.bodyMedium, color = colors.foam.copy(alpha = 0.8f))
      state.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = colors.incoming) }
      if (diver.blockedByMe) {
        ProfileCard {
          Text("You blocked this diver. Their reviews and photos are hidden from you.", style = MaterialTheme.typography.bodyMedium)
          TextButton(onClick = { viewModel.block(false) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Unblock") }
        }
      } else if (diver.about.isNotBlank()) {
        ProfileCard { Text(diver.about, style = MaterialTheme.typography.bodyMedium) }
      } else if (diver.isMe) {
        Text("Nothing about you yet.", style = MaterialTheme.typography.bodyMedium, color = colors.foam.copy(alpha = 0.8f))
      }
      if (diver.isMe) {
        OutlinedButton(onClick = onAccount, modifier = Modifier.heightIn(min = 48.dp)) {
          Text(if (diver.about.isBlank()) "Add an About me" else "Edit your About me")
        }
      }
      StatGrid(
        listOf(
          Stat("Points", diver.points),
          Stat("Reports", diver.reports, if (diver.reportSites > 0) "at ${diver.reportSites} site${if (diver.reportSites == 1) "" else "s"}" else null),
          Stat("Ratings", diver.ratings),
          Stat("Sites added", diver.sitesAdded),
        )
      )
      if (diver.badges.isNotEmpty()) {
        Text("Badges", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        BadgeList(diver.badges)
      }
      if (!diver.isMe && !diver.blockedByMe) {
        ContentActions(
          onReport = { if (viewModel.signedIn) reporting = true else onSignIn() },
          onBlock = if (viewModel.signedIn) ({ blocking = true }) else null,
        )
      }
    }
  }

  if (reporting) {
    ReportDialog(
      what = "diver",
      onDismiss = { reporting = false },
      onSend = { reason, note ->
        reporting = false
        viewModel.report(reason, note)
      },
    )
  }
  if (blocking) {
    BlockDialog(
      nickname = state.diver?.nickname ?: nickname,
      onDismiss = { blocking = false },
      onBlock = {
        blocking = false
        viewModel.block(true)
      },
    )
  }
}

/** A number tile, as the web's Stat. */
data class Stat(val label: String, val value: Int, val note: String? = null)

/** Number tiles two to a row. */
@Composable
internal fun StatGrid(stats: List<Stat>) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    for (pair in stats.chunked(2)) {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (stat in pair) {
          ProfileCard(Modifier.weight(1f)) {
            Text(stat.label, style = MaterialTheme.typography.labelMedium, color = CurrentTheme.colors.foam.copy(alpha = 0.75f))
            Row {
              Text("${stat.value}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
              stat.note?.let {
                Text(
                  " $it",
                  style = MaterialTheme.typography.bodySmall,
                  color = CurrentTheme.colors.foam.copy(alpha = 0.75f),
                  modifier = Modifier.padding(top = 10.dp),
                )
              }
            }
          }
        }
        if (pair.size == 1) Column(Modifier.weight(1f)) {}
      }
    }
  }
}

/** Badges as the web's grid: earned ones lit (★), the rest dimmed (☆). */
@Composable
internal fun BadgeList(badges: List<ApiBadge>) {
  val colors = CurrentTheme.colors
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    for (badge in badges) {
      Row(Modifier.fillMaxWidth()) {
        Text(if (badge.earned) "★ " else "☆ ", color = if (badge.earned) colors.incoming else colors.foam.copy(alpha = 0.5f))
        Column(Modifier.weight(1f)) {
          Text(
            badge.label + if (badge.earned) "" else " (not yet)",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (badge.earned) colors.foam else colors.foam.copy(alpha = 0.6f),
          )
          Text(badge.detail, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = if (badge.earned) 0.8f else 0.5f))
        }
      }
    }
  }
}

@Composable
internal fun ProfileCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
  val colors = CurrentTheme.colors
  Card(
    shape = RoundedCornerShape(16.dp),
    colors = CardDefaults.cardColors(containerColor = colors.deep, contentColor = colors.foam),
    border = BorderStroke(1.dp, colors.line),
    modifier = modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) { content() }
  }
}
