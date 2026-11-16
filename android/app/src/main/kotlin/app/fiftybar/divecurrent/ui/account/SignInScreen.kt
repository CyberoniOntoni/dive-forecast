package app.fiftybar.divecurrent.ui.account

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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.theme.CurrentTheme

/** Sign in with an emailed code, as on the web. Goes back where it came from once signed in. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignInScreen(onDone: () -> Unit, onBack: () -> Unit) {
  val account = appAccount()
  val viewModel: SignInViewModel = viewModel { SignInViewModel(account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors

  LaunchedEffect(state.step) { if (state.step == SignInStep.Done) onDone() }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text("Sign in") },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    Column(
      Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
      when (state.step) {
        SignInStep.Email -> {
          Text(
            "Sign in with your email to report what the current did on your dive. Reports sharpen the forecast for " +
              "everyone and earn points on the scoreboard. Only your nickname is ever shown.",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.foam,
          )
          OutlinedTextField(
            value = state.email,
            onValueChange = viewModel::email,
            label = { Text("Email") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { viewModel.sendCode() }),
            modifier = Modifier.fillMaxWidth(),
          )
          Button(
            onClick = viewModel::sendCode,
            enabled = !state.busy && state.email.isNotBlank(),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
          ) {
            Text("Email me a code")
          }
        }
        SignInStep.Code,
        SignInStep.Done -> {
          Text(
            "We emailed a 6-digit code to ${state.email.trim()}. It works for 15 minutes.",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.foam,
          )
          OutlinedTextField(
            value = state.code,
            onValueChange = viewModel::code,
            label = { Text("Code") },
            singleLine = true,
            keyboardOptions =
              KeyboardOptions(
                keyboardType = KeyboardType.NumberPassword,
                imeAction = if (state.newUser) ImeAction.Next else ImeAction.Done,
              ),
            keyboardActions = KeyboardActions(onDone = { viewModel.signIn() }),
            modifier = Modifier.fillMaxWidth(),
          )
          if (state.newUser) {
            OutlinedTextField(
              value = state.nickname,
              onValueChange = viewModel::nickname,
              label = { Text("Nickname") },
              supportingText = { Text("2 to 20 letters or numbers. Shown with your reports instead of your email.") },
              singleLine = true,
              keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
              keyboardActions = KeyboardActions(onDone = { viewModel.signIn() }),
              modifier = Modifier.fillMaxWidth(),
            )
          }
          Button(
            onClick = viewModel::signIn,
            enabled = !state.busy && state.code.length == 6 && (!state.newUser || state.nickname.isNotBlank()),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
          ) {
            Text("Sign in")
          }
          TextButton(onClick = viewModel::sendCode, enabled = !state.busy) { Text("Send a new code") }
          TextButton(onClick = viewModel::changeEmail, enabled = !state.busy) { Text("Use another email") }
        }
      }
      state.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
    }
  }
}
