package app.fiftybar.divecurrent.ui.site

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.fiftybar.divecurrent.data.api.ApiReview
import app.fiftybar.divecurrent.data.api.ApiReviewPhoto
import app.fiftybar.divecurrent.ui.components.BlockDialog
import app.fiftybar.divecurrent.ui.components.ContentActions
import app.fiftybar.divecurrent.ui.components.ReportDialog
import app.fiftybar.divecurrent.ui.theme.CurrentTheme
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.filled.Star
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import app.fiftybar.divecurrent.ui.components.InlineAction
import coil3.compose.AsyncImage
import androidx.compose.material.icons.filled.Add

/**
 * "Ratings and reviews", as the web site page's card: the average, the diver's own score (1 to 5), review and photos,
 * each changeable or removable, and other divers' reviews. Signed out, it offers sign-in. Reviews never change the
 * current.
 */
@Composable
internal fun ReviewsCard(state: ReviewsUiState, signedIn: Boolean, viewModel: ReviewsViewModel, onSignIn: () -> Unit) {
  val colors = CurrentTheme.colors
  val context = LocalContext.current
  val card = state.card
  val mine = card?.mine
  var confirmRemove by remember { mutableStateOf(false) }
  // The nickname whose review is being reported or blocked.
  var reportOf by remember { mutableStateOf<String?>(null) }
  var blockOf by remember { mutableStateOf<String?>(null) }
  val room = (card?.maxPhotos ?: 6) - (mine?.photos?.size ?: 0)
  val pick =
    rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(6)) { uris ->
      if (uris.isNotEmpty()) viewModel.addPhotos(context, uris)
    }

  SurfaceCard(title = "Ratings and reviews") {
    if (state.loading && card == null) LinearProgressIndicator(Modifier.fillMaxWidth())
    card?.let {
      Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(it.summaryLine, style = MaterialTheme.typography.titleMedium)
        Text("Reviews don't change the current.", style = MaterialTheme.typography.bodySmall, color = colors.dim)
      }
    }
    if (card != null) {
      if (!signedIn) {
        OutlinedButton(onClick = onSignIn, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Sign in to rate and review") }
      } else {
        Text(
          if (mine == null) "Tap a star to rate · +${card.ratingPoints} points" else "Your rating · ${mine.score} of 5",
          style = MaterialTheme.typography.bodyMedium,
          color = colors.mist,
        )
        StarRow(score = mine?.score, enabled = !state.busy, onRate = viewModel::rate)
        if (mine == null) {
          Text("Rate it, then you can write a review and add photos.", style = MaterialTheme.typography.bodySmall, color = colors.dim)
        } else {
          OutlinedTextField(
            value = state.draft,
            onValueChange = viewModel::edit,
            enabled = !state.busy,
            label = { Text("Your review (optional)") },
            placeholder = { Text("What was the dive like? Marine life, visibility, best time, things to know.") },
            supportingText = {
              Text("${state.draft.length} / ${card.reviewMaxChars}", color = colors.dim, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth())
            },
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
          )
          if (state.draft.trim() != (mine.review ?: "")) {
            Button(onClick = viewModel::saveReview, enabled = !state.busy, modifier = Modifier.heightIn(min = 48.dp)) {
              Text(if (state.draft.isBlank()) "Clear review" else if (mine.review != null) "Save changes" else "Save review")
            }
          }
          if (mine.photos.isNotEmpty()) {
            Text("Your photos", style = MaterialTheme.typography.labelLarge)
            PhotoRow(mine.photos, viewModel::photoUrl, label = { "Your photo ${it + 1}" }, onRemove = if (state.busy) null else viewModel::removePhoto)
          }
          if (room > 0) {
            LinkRow(
              Icons.Filled.Add,
              state.progress ?: if (mine.photos.isEmpty()) "Add your photos" else "Add more photos",
              detail = "Up to $room more",
              enabled = !state.busy,
            ) {
              pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
          }
          InlineAction("Remove my rating", color = colors.stop, enabled = !state.busy) { confirmRemove = true }
        }
      }
    }
    state.error?.let {
      Text(it, color = colors.stop, style = MaterialTheme.typography.bodySmall, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
    }
    state.note?.takeIf { state.error == null }?.let {
      Text(it, style = MaterialTheme.typography.bodySmall, color = colors.foam.copy(alpha = 0.85f), modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
    card?.reviews?.takeIf { it.isNotEmpty() }?.let { reviews ->
      HorizontalDivider(color = colors.foam.copy(alpha = 0.1f))
      reviews.forEach { review ->
        OtherReview(
          review,
          viewModel::photoUrl,
          actions = {
            ContentActions(
              onReport = { if (signedIn) reportOf = review.nickname else onSignIn() },
              onBlock = if (signedIn) ({ blockOf = review.nickname }) else null,
              enabled = !state.busy,
            )
          },
        )
      }
    }
  }

  reportOf?.let { nickname ->
    ReportDialog(
      what = "review",
      onDismiss = { reportOf = null },
      onSend = { reason, note ->
        reportOf = null
        viewModel.report(nickname, reason, note)
      },
    )
  }
  blockOf?.let { nickname ->
    BlockDialog(
      nickname = nickname,
      onDismiss = { blockOf = null },
      onBlock = {
        blockOf = null
        viewModel.block(nickname)
      },
    )
  }

  if (confirmRemove && mine != null) {
    AlertDialog(
      onDismissRequest = { confirmRemove = false },
      title = { Text("Remove your rating?") },
      text = {
        Text(
          buildString {
            append("Remove your rating")
            if (mine.review != null) append(", review")
            if (mine.photos.isNotEmpty()) append(" and photos")
            append("? You lose its ${card.ratingPoints} points; rating the site again gives them back.")
          }
        )
      },
      confirmButton = {
        TextButton(
          onClick = {
            confirmRemove = false
            viewModel.removeRating()
          }
        ) {
          Text("Remove", color = colors.stop)
        }
      },
      dismissButton = { TextButton(onClick = { confirmRemove = false }) { Text("Keep it") } },
    )
  }
}

/**
 * Five stars across the card, each a 48 dp target: lit up to the diver's score. Tapping one rates the site with it
 * (again to change it). TalkBack reads each as "Rate 3 of 5", selected on the current score.
 */
@Composable
private fun StarRow(score: Int?, enabled: Boolean, onRate: (Int) -> Unit) {
  val colors = CurrentTheme.colors
  Row(Modifier.fillMaxWidth().selectableGroup()) {
    for (n in 1..5) {
      val lit = score != null && n <= score
      Box(
        Modifier.weight(1f)
          .height(52.dp)
          .clip(RoundedCornerShape(12.dp))
          .selectable(selected = score == n, enabled = enabled, role = Role.RadioButton) { onRate(n) }
          .semantics { contentDescription = "Rate $n of 5" },
        contentAlignment = Alignment.Center,
      ) {
        Icon(
          Icons.Filled.Star,
          contentDescription = null,
          tint = if (lit) colors.tide else colors.foam.copy(alpha = 0.24f),
          modifier = Modifier.size(34.dp),
        )
      }
    }
  }
}

@Composable
private fun OtherReview(review: ApiReview, photoUrl: (String) -> String, actions: @Composable () -> Unit) {
  val colors = CurrentTheme.colors
  Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(review.nickname, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
      Text("${"★".repeat(review.score.coerceIn(0, 5))} · ${review.date}", style = MaterialTheme.typography.bodySmall, color = colors.mist, modifier = Modifier.semantics { contentDescription = "${review.score} of 5, ${review.date}" })
    }
    review.review?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
    if (review.photos.isNotEmpty()) PhotoRow(review.photos, photoUrl, label = { "Photo ${it + 1} by ${review.nickname}" }, onRemove = null)
    actions()
  }
}

/** A row of square photos; with [onRemove], each has a × to delete it. */
@Composable
private fun PhotoRow(photos: List<ApiReviewPhoto>, photoUrl: (String) -> String, label: (Int) -> String, onRemove: ((String) -> Unit)?) {
  val colors = CurrentTheme.colors
  LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
    itemsIndexed(photos, key = { _, photo -> photo.id }) { index, photo ->
      Box(Modifier.size(110.dp)) {
        AsyncImage(
          model = photoUrl(photo.url),
          contentDescription = label(index),
          contentScale = ContentScale.Crop,
          modifier = Modifier.size(110.dp).clip(RoundedCornerShape(10.dp)),
        )
        if (onRemove != null) {
          IconButton(
            onClick = { onRemove(photo.id) },
            modifier = Modifier.align(Alignment.TopEnd).padding(2.dp).size(36.dp).background(colors.ink.copy(alpha = 0.85f), CircleShape),
          ) {
            Icon(Icons.Filled.Close, contentDescription = "Delete ${label(index).replaceFirstChar { it.lowercase() }}")
          }
        }
      }
    }
  }
}
