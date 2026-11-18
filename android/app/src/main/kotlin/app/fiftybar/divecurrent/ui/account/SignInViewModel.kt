package app.fiftybar.divecurrent.ui.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.fiftybar.divecurrent.data.AccountRepository
import app.fiftybar.divecurrent.data.api.ApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class SignInStep {
  Email,
  Code,
  Done,
}

data class SignInUiState(
  val step: SignInStep = SignInStep.Email,
  val email: String = "",
  val code: String = "",
  val nickname: String = "",
  /** A new address: it picks its nickname with the code. */
  val newUser: Boolean = false,
  /** The "I agree to the content rules and privacy policy" box; signing in needs it. */
  val agreed: Boolean = false,
  val busy: Boolean = false,
  val error: String? = null,
)

/** The web's email-code sign-in: address, then the six digits from the email (and a nickname the first time). */
class SignInViewModel(private val account: AccountRepository) : ViewModel() {
  private val _state = MutableStateFlow(SignInUiState())
  val state: StateFlow<SignInUiState> = _state.asStateFlow()

  fun email(value: String) = _state.update { it.copy(email = value, error = null) }

  fun code(value: String) = _state.update { it.copy(code = value.filter(Char::isDigit).take(6), error = null) }

  fun nickname(value: String) = _state.update { it.copy(nickname = value.take(20), error = null) }

  fun agree(value: Boolean) = _state.update { it.copy(agreed = value, error = null) }

  /** Back to the address, to fix a typo. */
  fun changeEmail() = _state.update { it.copy(step = SignInStep.Email, code = "", error = null) }

  fun sendCode() {
    val email = _state.value.email.trim()
    if (email.isEmpty() || _state.value.busy) return
    run {
      val sent = account.requestCode(email)
      _state.update { it.copy(step = SignInStep.Code, newUser = sent.newUser, busy = false) }
    }
  }

  fun signIn() {
    val s = _state.value
    if (s.code.length != 6 || s.busy || !s.agreed) return
    run {
      account.signIn(s.email, s.code, s.nickname.takeIf { s.newUser }, acceptTerms = true)
      _state.update { it.copy(step = SignInStep.Done, busy = false) }
    }
  }

  private fun run(block: suspend () -> Unit) {
    _state.update { it.copy(busy = true, error = null) }
    viewModelScope.launch {
      try {
        block()
      } catch (e: ApiException) {
        // The server asks for a nickname when an address it thought known is new after all.
        val needsNickname = e is ApiException.Server && e.code == "needs_nickname"
        _state.update { it.copy(busy = false, error = e.message, newUser = it.newUser || needsNickname) }
      }
    }
  }
}
