package app.fiftybar.divecurrent.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import app.fiftybar.divecurrent.DiveCurrentApp
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.DataRepository
import app.fiftybar.divecurrent.data.OfflineAreas

/**
 * The app's repository, for a `viewModel { … }` initializer. Read from the application context: the Navigation 3
 * entry's ViewModelStore does not put the Application in its CreationExtras.
 */
@Composable
fun appRepository(): DataRepository = (LocalContext.current.applicationContext as DiveCurrentApp).repository

/** Sign-in and the diver's writes, like [appRepository]. */
@Composable
fun appAccount(): AccountRepository = (LocalContext.current.applicationContext as DiveCurrentApp).account

/** The atolls saved for use without signal, like [appRepository]. */
@Composable
fun appOffline(): OfflineAreas = (LocalContext.current.applicationContext as DiveCurrentApp).offline
