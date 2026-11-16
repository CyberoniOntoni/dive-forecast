package app.fiftybar.divecurrent.ui.site

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.data.api.ApiSite
import app.fiftybar.divecurrent.domain.NewSite
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import coil3.compose.AsyncImage

/**
 * "Add a dive site" at a pin long-pressed on the map, as the web map's form: name, kind of site, depths, how to dive
 * it, the adder's rating and up to 6 photos. Signed out, it offers sign-in. [onAdded] opens the new site's page.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AddSiteScreen(lat: Double, lon: Double, onBack: () -> Unit, onSignIn: () -> Unit, onAdded: (ApiSite) -> Unit) {
  val repository = appRepository()
  val account = appAccount()
  val viewModel: AddSiteViewModel = viewModel(key = "add-site/$lat,$lon") { AddSiteViewModel(lat, lon, repository, account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val session by viewModel.session.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  val context = LocalContext.current
  val room = AddSiteViewModel.MAX_PHOTOS - state.photos.size
  val pick =
    rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(AddSiteViewModel.MAX_PHOTOS)) { uris ->
      if (uris.isNotEmpty()) viewModel.pick(uris)
    }
  val locked = state.busy || state.added != null
  // Leaving while the site or its photos are being sent would cancel the sending half way, unseen: stay until done.
  // Leaving a filled-in form asks first, as the plan editor does.
  var confirmLeave by remember { mutableStateOf(false) }
  val leave: () -> Unit = { if (state.dirty) confirmLeave = true else onBack() }
  BackHandler(enabled = state.busy || state.dirty) { if (!state.busy) confirmLeave = true }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text("Add a dive site") },
        navigationIcon = {
          IconButton(onClick = leave, enabled = !state.busy) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back to the map") }
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
      Text(
        "${NewSite.pinLine(lat, lon)} To move it, go back and long-press the map again.",
        style = MaterialTheme.typography.bodyMedium,
        color = colors.foam.copy(alpha = 0.85f),
      )
      if (session == null) {
        Text("Sign in with your email to add a dive site.", style = MaterialTheme.typography.bodyMedium)
        Button(onClick = onSignIn, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Sign in") }
        return@Column
      }
      state.added?.let { site ->
        // Added, but not every photo went up: say so, with the way to the page.
        SurfaceCard {
          Text("Site added.", style = MaterialTheme.typography.titleSmall)
          state.note?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onAdded(site) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Open site page") }
            OutlinedButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp)) { Text("Done") }
          }
        }
        return@Column
      }
      OutlinedTextField(
        value = state.name,
        onValueChange = { text -> viewModel.edit { it.copy(name = text.take(NewSite.NAME_MAX)) } },
        enabled = !locked,
        label = { Text("Site name") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
        modifier = Modifier.fillMaxWidth(),
      )
      Text("Kind of site", style = MaterialTheme.typography.labelLarge)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(
          selected = state.kind == null,
          onClick = { viewModel.edit { it.copy(kind = null) } },
          enabled = !locked,
          label = { Text("Not sure") },
          modifier = Modifier.heightIn(min = 48.dp),
        )
        for (kind in NewSite.KINDS) {
          FilterChip(
            selected = state.kind == kind.type,
            onClick = { viewModel.edit { it.copy(kind = kind.type) } },
            enabled = !locked,
            label = { Text(kind.label) },
            modifier = Modifier.heightIn(min = 48.dp),
          )
        }
      }
      NewSite.KINDS.firstOrNull { it.type == state.kind }?.let {
        Text(it.hint, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.75f))
      }
      Text("Depth (m)", style = MaterialTheme.typography.labelLarge)
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
          value = state.top,
          onValueChange = { text -> viewModel.edit { it.copy(top = text.take(6)) } },
          enabled = !locked,
          label = { Text("From") },
          placeholder = { Text("5") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
          modifier = Modifier.weight(1f),
        )
        OutlinedTextField(
          value = state.max,
          onValueChange = { text -> viewModel.edit { it.copy(max = text.take(6)) } },
          enabled = !locked,
          label = { Text("To") },
          placeholder = { Text("30") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
          modifier = Modifier.weight(1f),
        )
      }
      OutlinedTextField(
        value = state.howToDive,
        onValueChange = { text -> viewModel.edit { it.copy(howToDive = text.take(NewSite.HOW_TO_DIVE_MAX)) } },
        enabled = !locked,
        label = { Text("How to dive it") },
        placeholder = { Text("Where to drop in, which way to go on an incoming or outgoing current, what you see, hazards.") },
        supportingText = { Text("${state.howToDive.length} of ${NewSite.HOW_TO_DIVE_MAX}") },
        minLines = 4,
        modifier = Modifier.fillMaxWidth(),
      )
      Text("Your rating · optional", style = MaterialTheme.typography.labelLarge)
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (score in 1..5) {
          FilterChip(
            selected = state.rating == score,
            // A second tap on the picked score clears it, as on the web.
            onClick = { viewModel.edit { it.copy(rating = if (it.rating == score) null else score) } },
            enabled = !locked,
            label = { Text("$score") },
            modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = "Rate $score of 5" },
          )
        }
      }
      if (state.photos.isNotEmpty()) PickedPhotos(state.photos, onRemove = if (locked) null else viewModel::unpick)
      if (room > 0) {
        OutlinedButton(
          onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
          enabled = !locked,
          modifier = Modifier.heightIn(min = 48.dp),
        ) {
          Text(if (state.photos.isEmpty()) "Add photos (up to $room)" else "Add more photos (up to $room)")
        }
      }
      state.error?.let {
        Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
      }
      Button(
        onClick = { viewModel.submit(context, onAdded) },
        enabled = !locked && state.name.isNotBlank(),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
      ) {
        Text(state.progress ?: "Add site")
      }
      Text(
        "Everything but the name is optional. The pin's position picks the forecast; near the atoll rim, where it could be a channel or a wall, the kind you pick decides.",
        style = MaterialTheme.typography.bodySmall,
        color = colors.foam.copy(alpha = 0.7f),
      )
      Spacer(Modifier.height(24.dp))
    }
  }
  if (confirmLeave) {
    LeaveDialog(
      onLeave = {
        confirmLeave = false
        onBack()
      },
      onStay = { confirmLeave = false },
    )
  }
}

@Composable
private fun LeaveDialog(onLeave: () -> Unit, onStay: () -> Unit) {
  AlertDialog(
    onDismissRequest = onStay,
    title = { Text("Leave without adding?") },
    text = { Text("What you filled in for this site will be lost.") },
    confirmButton = { TextButton(onClick = onLeave) { Text("Leave") } },
    dismissButton = { TextButton(onClick = onStay) { Text("Keep editing") } },
  )
}

/** The photos picked for the new site, each with a × to drop it before sending. */
@Composable
private fun PickedPhotos(photos: List<Uri>, onRemove: ((Uri) -> Unit)?) {
  val colors = CurrentTheme.colors
  LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
    itemsIndexed(photos, key = { _, uri -> uri.toString() }) { index, uri ->
      Box(Modifier.size(110.dp)) {
        AsyncImage(
          model = uri,
          contentDescription = "Picked photo ${index + 1}",
          contentScale = ContentScale.Crop,
          modifier = Modifier.size(110.dp).clip(RoundedCornerShape(10.dp)),
        )
        if (onRemove != null) {
          IconButton(
            onClick = { onRemove(uri) },
            modifier = Modifier.align(Alignment.TopEnd).padding(2.dp).size(36.dp).background(colors.ink.copy(alpha = 0.85f), CircleShape),
          ) {
            Icon(Icons.Filled.Close, contentDescription = "Leave out picked photo ${index + 1}")
          }
        }
      }
    }
  }
}
