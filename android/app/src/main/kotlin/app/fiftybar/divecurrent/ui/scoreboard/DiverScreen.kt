package app.fiftybar.divecurrent.ui.scoreboard

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
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.api.ApiBadge
import app.fiftybar.divecurrent.data.api.ApiDiver
import app.fiftybar.divecurrent.data.api.ApiException
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DiverUiState(val diver: ApiDiver? = null, val loading: Boolean = true, val error: String? = null)

class DiverViewModel(private val nickname: String, private val account: AccountRepository) : ViewModel() {
  private val _state = MutableStateFlow(DiverUiState())
  val state: StateFlow<DiverUiState> = _state.asStateFlow()

  init {
    viewModelScope.launch {
      try {
        val diver = account.diver(nickname)
        _state.update { it.copy(diver = diver, loading = false) }
      } catch (e: ApiException) {
        val gone = e is ApiException.Server && e.code == "not_found"
        _state.update { it.copy(loading = false, error = if (gone) "No diver goes by $nickname now." else e.message) }
      }
    }
  }
}

/** A diver's public page, as the web's (app/divers): nickname, About me, numbers and earned badges. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiverScreen(nickname: String, onBack: () -> Unit, onAccount: () -> Unit) {
  val account = appAccount()
  val viewModel: DiverViewModel = viewModel(key = "diver/$nickname") { DiverViewModel(nickname, account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors

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
      if (diver.about.isNotBlank()) {
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
    }
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
    colors = CardDefaults.cardColors(containerColor = colors.glass, contentColor = colors.foam),
    modifier = modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) { content() }
  }
}
