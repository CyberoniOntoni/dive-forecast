package app.fiftybar.divecurrent.ui.plan

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.fiftybar.divecurrent.ui.components.ClockDialog
import app.fiftybar.divecurrent.data.api.ApiPickerSite
import app.fiftybar.divecurrent.domain.DraftDay
import app.fiftybar.divecurrent.domain.DraftStop
import app.fiftybar.divecurrent.domain.PlanDraft
import app.fiftybar.divecurrent.ui.appAccount
import app.fiftybar.divecurrent.ui.appRepository
import app.fiftybar.divecurrent.ui.theme.CurrentColors
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale

private const val DAY_MS = 24L * 60 * 60 * 1000

/**
 * The plan editor, as on the web: a title, notes for the trip and the boat's speed, then days, each with its dives
 * (site, time, a note, and at a channel the way you want the current). [planId] null makes a new plan.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanEditScreen(
  planId: String?,
  onBack: () -> Unit,
  onSaved: (id: String) -> Unit,
  onDeleted: () -> Unit,
  onSignIn: () -> Unit,
) {
  val repository = appRepository()
  val account = appAccount()
  val viewModel: PlanEditViewModel = viewModel(key = "plan-edit/${planId ?: "new"}") { PlanEditViewModel(planId, repository, account) }
  val state by viewModel.state.collectAsStateWithLifecycle()
  val session by account.sessions.session.collectAsStateWithLifecycle()
  val colors = CurrentTheme.colors
  var confirmLeave by rememberSaveable { mutableStateOf(false) }
  var confirmDelete by rememberSaveable { mutableStateOf(false) }

  LaunchedEffect(state.savedId) { state.savedId?.let(onSaved) }
  LaunchedEffect(state.deleted) { if (state.deleted) onDeleted() }
  LaunchedEffect(session) { if (session != null) viewModel.signedInAgain() }

  val leave: () -> Unit = { if (state.dirty && state.savedId == null) confirmLeave = true else onBack() }
  BackHandler(enabled = state.dirty && state.savedId == null) { confirmLeave = true }

  Scaffold(
    containerColor = colors.ink,
    topBar = {
      TopAppBar(
        title = { Text(if (planId == null) "New dive plan" else "Edit plan") },
        navigationIcon = { IconButton(onClick = leave) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        actions = {
          if (state.draft != null) {
            TextButton(onClick = viewModel::save, enabled = !state.saving) { Text("Save") }
          }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.ink, titleContentColor = colors.foam),
      )
    },
  ) { padding ->
    val draft = state.draft
    LazyColumn(
      Modifier.fillMaxSize().padding(padding).imePadding(),
      contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      if (state.loading || state.saving) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
      if (draft == null) {
        state.loadError?.let { problem ->
          item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
              Text(problem, color = colors.stop)
              if (state.signedOut) OutlinedButton(onClick = onSignIn) { Text("Sign in") } else OutlinedButton(onClick = viewModel::load) { Text("Try again") }
            }
          }
        }
        return@LazyColumn
      }
      item {
        PlanFields(draft, state.limits.titleMax, colors) { change -> viewModel.edit(change) }
      }
      items(draft.days, key = { it.key }) { day ->
        DayEditor(
          day = day,
          index = draft.days.indexOf(day),
          canRemove = draft.days.size > 1,
          canAddDive = day.stops.size < state.limits.divesPerDayMax,
          years = state.limits.yearMin..state.limits.yearMax,
          sites = state.sites,
          site = state::site,
          colors = colors,
          onEdit = viewModel::edit,
          onChangeStop = viewModel::changeStop,
        )
      }
      item {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
          if (draft.days.size < state.limits.daysMax) {
            OutlinedButton(onClick = { viewModel.edit { it.addDay(state.today) } }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
              Text("Add a day")
            }
          }
          state.error?.let { Text(it, color = colors.stop, style = MaterialTheme.typography.bodyMedium) }
          if (state.signedOut) OutlinedButton(onClick = onSignIn) { Text("Sign in") }
          Button(onClick = viewModel::save, enabled = !state.saving, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text(if (planId == null) "Save the plan" else "Save changes")
          }
          if (planId != null) {
            TextButton(onClick = { confirmDelete = true }, enabled = !state.saving) { Text("Delete this plan", color = colors.stop) }
          }
        }
      }
    }
  }

  if (confirmLeave) {
    AlertDialog(
      onDismissRequest = { confirmLeave = false },
      title = { Text("Leave without saving?") },
      text = { Text("Your changes to this plan will be lost.") },
      confirmButton = {
        TextButton(onClick = {
          confirmLeave = false
          onBack()
        }) { Text("Leave") }
      },
      dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text("Keep editing") } },
    )
  }
  if (confirmDelete) {
    AlertDialog(
      onDismissRequest = { confirmDelete = false },
      title = { Text("Delete this plan?") },
      text = { Text("Its link stops working for everyone you shared it with. This cannot be undone.") },
      confirmButton = {
        TextButton(onClick = {
          confirmDelete = false
          viewModel.delete()
        }) { Text("Delete", color = colors.stop) }
      },
      dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
    )
  }
}

@Composable
private fun PlanFields(draft: PlanDraft, titleMax: Int, colors: CurrentColors, onEdit: ((PlanDraft) -> PlanDraft) -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    OutlinedTextField(
      value = draft.title,
      onValueChange = { value -> onEdit { it.withTitle(value.take(titleMax)) } },
      label = { Text("Title") },
      placeholder = { Text("North Malé week") },
      singleLine = true,
      modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
      value = draft.notes,
      onValueChange = { value -> onEdit { it.withNotes(value) } },
      label = { Text("Notes for the trip (optional)") },
      minLines = 2,
      modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
      value = draft.speed,
      onValueChange = { value -> onEdit { it.withSpeed(value.filter { c -> c.isDigit() || c == '.' || c == ',' }.take(5)) } },
      label = { Text("Boat speed, knots") },
      supportingText = { Text("For the times between dives.", color = colors.foam.copy(alpha = 0.7f)) },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
      modifier = Modifier.fillMaxWidth(),
    )
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DayEditor(
  day: DraftDay,
  index: Int,
  canRemove: Boolean,
  canAddDive: Boolean,
  years: IntRange,
  sites: List<ApiPickerSite>,
  site: (String) -> ApiPickerSite?,
  colors: CurrentColors,
  onEdit: ((PlanDraft) -> PlanDraft) -> Unit,
  onChangeStop: (Long, Long, (DraftStop) -> DraftStop) -> Unit,
) {
  var pickDate by rememberSaveable(day.key) { mutableStateOf(false) }
  Card(
    shape = RoundedCornerShape(24.dp),
    colors = CardDefaults.cardColors(containerColor = colors.deep, contentColor = colors.foam),
    border = BorderStroke(1.dp, colors.line),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
          "Day ${index + 1}",
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          modifier = Modifier.weight(1f).semantics { heading() },
        )
        if (canRemove) {
          IconButton(onClick = { onEdit { it.removeDay(day.key) } }) { Icon(Icons.Filled.Close, "Remove day ${index + 1}") }
        }
      }
      OutlinedButton(onClick = { pickDate = true }, modifier = Modifier.heightIn(min = 44.dp)) { Text(PlanDraft.dayLabel(day.date)) }
      if (day.stops.isEmpty()) Text("No dives yet.", style = MaterialTheme.typography.bodyMedium, color = colors.foam.copy(alpha = 0.75f))
      day.stops.forEachIndexed { at, stop ->
        HorizontalDivider(color = colors.foam.copy(alpha = 0.12f))
        StopEditor(
          number = at + 1,
          stop = stop,
          site = site(stop.siteId),
          sites = sites,
          canUp = at > 0,
          canDown = at + 1 < day.stops.size,
          colors = colors,
          onChange = { change -> onChangeStop(day.key, stop.key, change) },
          onMove = { by -> onEdit { it.moveStop(day.key, at, by) } },
          onRemove = { onEdit { it.removeStop(day.key, stop.key) } },
        )
      }
      if (canAddDive) {
        TextButton(onClick = { onEdit { it.addStop(day.key) } }) { Text("Add a dive") }
      }
    }
  }
  if (pickDate) {
    PlanDateDialog(
      initial = runCatching { LocalDate.parse(day.date) }.getOrElse { LocalDate.now() },
      years = years,
      onPicked = { date ->
        pickDate = false
        onEdit { it.setDate(day.key, date.toString()) }
      },
      onDismiss = { pickDate = false },
    )
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun StopEditor(
  number: Int,
  stop: DraftStop,
  site: ApiPickerSite?,
  sites: List<ApiPickerSite>,
  canUp: Boolean,
  canDown: Boolean,
  colors: CurrentColors,
  onChange: ((DraftStop) -> DraftStop) -> Unit,
  onMove: (Int) -> Unit,
  onRemove: () -> Unit,
) {
  var pickSite by rememberSaveable(stop.key) { mutableStateOf(false) }
  var pickTime by rememberSaveable(stop.key) { mutableStateOf(false) }
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text("Dive $number", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
      IconButton(onClick = { onMove(-1) }, enabled = canUp) { Icon(Icons.Filled.KeyboardArrowUp, "Move dive $number earlier") }
      IconButton(onClick = { onMove(1) }, enabled = canDown) { Icon(Icons.Filled.KeyboardArrowDown, "Move dive $number later") }
      IconButton(onClick = onRemove) { Icon(Icons.Filled.Close, "Remove dive $number") }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      OutlinedButton(onClick = { pickTime = true }, modifier = Modifier.heightIn(min = 44.dp)) { Text(stop.time) }
      OutlinedButton(onClick = { pickSite = true }, modifier = Modifier.heightIn(min = 44.dp)) {
        Text(site?.name ?: if (stop.siteId.isBlank()) "Pick a site" else "Site no longer listed")
      }
    }
    site?.atoll?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.7f)) }
    if (site?.channel == true) {
      Text("Current you want", style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.8f))
      FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(null to "Either", "incoming" to "Incoming", "outgoing" to "Outgoing").forEach { (value, label) ->
          FilterChip(selected = stop.want == value, onClick = { onChange { it.copy(want = value) } }, label = { Text(label) })
        }
      }
    }
    OutlinedTextField(
      value = stop.note,
      onValueChange = { value -> onChange { it.copy(note = value) } },
      label = { Text("Note (optional)") },
      modifier = Modifier.fillMaxWidth(),
    )
  }
  if (pickSite) {
    SitePickerDialog(
      sites = sites,
      onPicked = { picked ->
        pickSite = false
        onChange { it.copy(siteId = picked.id, want = if (picked.channel) it.want else null) }
      },
      onDismiss = { pickSite = false },
    )
  }
  if (pickTime) {
    PlanTimeDialog(
      initial = runCatching { LocalTime.parse(stop.time) }.getOrElse { LocalTime.of(9, 0) },
      onPicked = { time ->
        pickTime = false
        onChange { it.copy(time = String.format(Locale.ROOT, "%02d:%02d", time.hour, time.minute)) }
      },
      onDismiss = { pickTime = false },
    )
  }
}

/** Every site, searched by name or atoll. */
@Composable
private fun SitePickerDialog(sites: List<ApiPickerSite>, onPicked: (ApiPickerSite) -> Unit, onDismiss: () -> Unit) {
  var query by rememberSaveable { mutableStateOf("") }
  val shown =
    remember(query, sites) {
      val words = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
      sites.filter { site -> words.all { word -> site.name.lowercase().contains(word) || site.atoll?.lowercase()?.contains(word) == true } }
    }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("Dive site") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
          value = query,
          onValueChange = { query = it },
          label = { Text("Search by site or atoll") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )
        LazyColumn(Modifier.heightIn(max = 360.dp)) {
          items(shown, key = { it.id }) { site ->
            Column(Modifier.fillMaxWidth().clickable { onPicked(site) }.padding(vertical = 10.dp)) {
              Text(site.name, style = MaterialTheme.typography.bodyLarge)
              val detail = listOfNotNull(site.atoll, "channel".takeIf { site.channel }).joinToString(" · ")
              if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall)
            }
          }
          if (shown.isEmpty()) item { Text("No site by that name.", Modifier.padding(vertical = 10.dp)) }
        }
      }
    },
    confirmButton = {},
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  )
}

/**
 * Any day in the years the server takes: plans can be made ahead, and past days kept for reports. The picker's dates
 * are UTC midnights.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PlanDateDialog(initial: LocalDate, years: IntRange, onPicked: (LocalDate) -> Unit, onDismiss: () -> Unit) {
  val picker =
    rememberDatePickerState(
      initialSelectedDateMillis = initial.toEpochDay() * DAY_MS,
      yearRange = years,
      selectableDates =
        object : SelectableDates {
          override fun isSelectableDate(utcTimeMillis: Long): Boolean =
            LocalDate.ofEpochDay(Math.floorDiv(utcTimeMillis, DAY_MS)).year in years

          override fun isSelectableYear(year: Int): Boolean = year in years
        },
    )
  DatePickerDialog(
    onDismissRequest = onDismiss,
    confirmButton = {
      TextButton(
        onClick = { picker.selectedDateMillis?.let { onPicked(LocalDate.ofEpochDay(Math.floorDiv(it, DAY_MS))) } },
        enabled = picker.selectedDateMillis != null,
      ) {
        Text("Done")
      }
    },
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  ) {
    DatePicker(state = picker, title = { Text("Day of the dives", Modifier.padding(start = 24.dp, top = 16.dp)) })
  }
}

@Composable
private fun PlanTimeDialog(initial: LocalTime, onPicked: (LocalTime) -> Unit, onDismiss: () -> Unit) =
  ClockDialog("Time in the water, Maldives time", initial, onPicked, onDismiss)
