package app.fiftybar.divecurrent.ui.plan

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.BuildConfig
import app.fiftybar.divecurrent.domain.PlanLink
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/** Dive plans: open one from a shared link, and the signed-in diver's own. Making plans is on the web for now. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlansScreen(onBack: () -> Unit, onOpenPlan: (String) -> Unit, onSignIn: () -> Unit) {
  val account = appAccount()
  val viewModel: PlansViewModel = viewModel { PlansViewModel(account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val session by viewModel.session.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  val uri = LocalUriHandler.current
  val linkId = PlanLink.idOf(state.link)

  // Signed in on the sign-in screen and back here: load the list.
  LaunchedEffect(session) { if (session != null && state.plans == null && !state.loading) viewModel.refresh() }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text("Dive plans") },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    Column(
      Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      Text("Open a plan someone shared", style = MaterialTheme.typography.titleSmall, color = colors.foam)
      OutlinedTextField(
        value = state.link,
        onValueChange = viewModel::link,
        label = { Text("Plan link") },
        placeholder = { Text("${BuildConfig.WEB_URL}/plans/…") },
        singleLine = true,
        isError = state.link.isNotBlank() && linkId == null,
        supportingText = { if (state.link.isNotBlank() && linkId == null) Text("That is not a plan link.") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
        keyboardActions = KeyboardActions(onGo = { linkId?.let(onOpenPlan) }),
        modifier = Modifier.fillMaxWidth(),
      )
      Button(
        onClick = { linkId?.let(onOpenPlan) },
        enabled = linkId != null,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
      ) {
        Text("Open the plan")
      }

      HorizontalDivider(color = colors.foam.copy(alpha = 0.12f))
      Text("My plans", style = MaterialTheme.typography.titleSmall, color = colors.foam)
      if (session == null) {
        Text("Sign in to see the plans you made.", style = MaterialTheme.typography.bodyMedium, color = colors.foam)
        OutlinedButton(onClick = onSignIn, modifier = Modifier.heightIn(min = 44.dp)) { Text("Sign in") }
      } else {
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        state.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
        val plans = state.plans
        if (plans != null && plans.isEmpty()) {
          Text("No plans yet.", style = MaterialTheme.typography.bodyMedium, color = colors.foam)
        }
        plans?.forEach { plan ->
          Column(
            Modifier.fillMaxWidth().clickable(onClickLabel = "Open the plan") { onOpenPlan(plan.id) }.padding(vertical = 8.dp)
          ) {
            Text(plan.title, style = MaterialTheme.typography.titleMedium, color = colors.foam)
            Text(
              listOf(plan.span, plan.size).filter { it.isNotBlank() }.joinToString(" · "),
              style = MaterialTheme.typography.bodySmall,
              color = colors.foam.copy(alpha = 0.75f),
            )
          }
          HorizontalDivider(color = colors.foam.copy(alpha = 0.08f))
        }
      }
      OutlinedButton(
        onClick = { uri.openUri("${BuildConfig.WEB_URL}/plans/new") },
        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp),
      ) {
        Text("Make a plan on the web")
      }
    }
  }
}
