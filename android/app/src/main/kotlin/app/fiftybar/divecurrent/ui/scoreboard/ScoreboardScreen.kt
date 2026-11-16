package app.fiftybar.divecurrent.ui.scoreboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.data.api.ApiScoreRow
import app.fiftybar.divecurrent.data.api.ApiScoreboard
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ScoreboardUiState(
  /** month | all | sites */
  val board: String = "month",
  /** The boards read so far, by name, so switching back is instant. */
  val boards: Map<String, ApiScoreboard> = emptyMap(),
  val loading: Boolean = true,
  val error: String? = null,
)

/** The web's scoreboard (app/scoreboard): this month, all time and new sites. */
class ScoreboardViewModel(private val account: AccountRepository) : ViewModel() {
  private val _state = MutableStateFlow(ScoreboardUiState())
  val state: StateFlow<ScoreboardUiState> = _state.asStateFlow()
  val session = account.sessions.session
  private var load: Job? = null

  init {
    // Signing in or out changes which row is "you": read the boards again.
    viewModelScope.launch {
      account.sessions.session.map { it?.token }.distinctUntilChanged().collect {
        _state.update { s -> s.copy(boards = emptyMap()) }
        show(_state.value.board)
      }
    }
  }

  fun show(board: String) {
    _state.update { it.copy(board = board, error = null) }
    load?.cancel()
    load =
      viewModelScope.launch {
        _state.update { it.copy(loading = true) }
        try {
          val read = account.scoreboard(board)
          _state.update { it.copy(boards = it.boards + (board to read), loading = false) }
        } catch (e: ApiException) {
          _state.update { it.copy(loading = false, error = e.message) }
        }
      }
  }
}

private val BOARDS = listOf("month" to "This month", "all" to "All time", "sites" to "New sites")

/**
 * The divers who make the forecast better, as the web's scoreboard shows them: reporters by points, and divers who
 * added sites with the newest sites. A nickname opens the diver's page, a site its forecast.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScoreboardScreen(onBack: () -> Unit, onDiver: (String) -> Unit, onSite: (String) -> Unit, onAccount: (signedIn: Boolean) -> Unit) {
  val account = appAccount()
  val viewModel: ScoreboardViewModel = viewModel { ScoreboardViewModel(account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val session by viewModel.session.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  val shown = state.boards[state.board]

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text("Scoreboard") },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    LazyColumn(Modifier.fillMaxSize().padding(padding), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      item {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text(
            "The divers who make this forecast better: every current report after a dive sharpens the next diver's forecast, every rating helps others pick a site, and every new site puts another reef on the map.",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.foam.copy(alpha = 0.85f),
          )
          SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            BOARDS.forEachIndexed { index, (id, label) ->
              SegmentedButton(
                selected = state.board == id,
                onClick = { viewModel.show(id) },
                shape = SegmentedButtonDefaults.itemShape(index, BOARDS.size),
              ) {
                Text(label, maxLines = 1)
              }
            }
          }
          if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
          state.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
          shown?.let {
            Text(it.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(it.note, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.75f))
            if (it.rows.isEmpty()) Text(it.empty, style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
      items(shown?.rows.orEmpty(), key = { "row/${it.nickname}" }) { row ->
        ScoreRow(row, onClick = { onDiver(row.nickname) })
        HorizontalDivider(color = colors.foam.copy(alpha = 0.08f))
      }
      if (!shown?.newest.isNullOrEmpty()) {
        item {
          Text(
            "Newest sites",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp),
          )
        }
        items(shown?.newest.orEmpty(), key = { "site/${it.siteId}" }) { site ->
          Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { onSite(site.siteId) }.padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(site.name, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(
              "added by ${site.nickname}",
              style = MaterialTheme.typography.bodySmall,
              color = colors.foam.copy(alpha = 0.75f),
              modifier = Modifier.clickable { onDiver(site.nickname) }.padding(start = 8.dp),
            )
          }
        }
      }
      item {
        OutlinedButton(
          onClick = { onAccount(session != null) },
          modifier = Modifier.fillMaxWidth().padding(16.dp).heightIn(min = 48.dp),
        ) {
          Text(if (session != null) "Your points and badges" else "Sign in to join")
        }
      }
    }
  }
}

@Composable
private fun ScoreRow(row: ApiScoreRow, onClick: () -> Unit) {
  val colors = CurrentTheme.colors
  val medal = listOf("🥇", "🥈", "🥉").getOrNull(row.rank - 1)
  val spoken =
    buildString {
      append("Rank ${row.rank}, ${row.nickname}")
      if (row.isMe) append(" (you)")
      append(", ${row.score} ${row.unit ?: "points"}")
      if (row.detail.isNotBlank()) append(", ${row.detail.replace("★", "badges")}")
    }
  Row(
    Modifier.fillMaxWidth()
      .heightIn(min = 56.dp)
      .clickable(onClick = onClick)
      // Your own row lit, as the web's.
      .then(if (row.isMe) Modifier.background(colors.incoming.copy(alpha = 0.15f)) else Modifier)
      .padding(horizontal = 16.dp, vertical = 8.dp)
      .semantics(mergeDescendants = true) { contentDescription = spoken },
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(
      medal ?: "${row.rank}",
      style = MaterialTheme.typography.bodyMedium,
      fontFamily = FontFamily.Monospace,
      textAlign = TextAlign.End,
      color = if (row.rank <= 3) colors.incoming else colors.foam.copy(alpha = 0.7f),
      modifier = Modifier.width(32.dp),
    )
    Column(Modifier.weight(1f).padding(start = 12.dp)) {
      Text(
        row.nickname + if (row.isMe) " (you)" else "",
        style = MaterialTheme.typography.bodyLarge,
        fontWeight = if (row.isMe) FontWeight.SemiBold else FontWeight.Normal,
        color = if (row.isMe) colors.incoming else colors.foam,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      if (row.detail.isNotBlank()) Text(row.detail, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.7f))
    }
    Text("${row.score}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace)
    row.unit?.let { Text(" $it", style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.7f)) }
  }
}
