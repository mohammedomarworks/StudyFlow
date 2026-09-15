/* ==========================================================================
   auth-page.js — Controller for pages/auth.html (StudyFlow v2.0)
   --------------------------------------------------------------------------
   Handles:
   - Tab switching (Sign In / Create Account / Forgot Password / Recovery)
   - Real-time client-side validation
   - Form submission states (loading spinner, disabled buttons)
   - Password visibility toggling
   - Supabase Auth API calls via Auth module
   - Safe internal return redirection
   - Password recovery / reset state detection
   ========================================================================== */

(function () {
  'use strict';

  // DOM Elements
  const tabSignIn = document.getElementById('tabSignIn');
  const tabSignUp = document.getElementById('tabSignUp');
  const authTabs = document.getElementById('authTabs');

  const viewSignIn = document.getElementById('viewSignIn');
  const viewSignUp = document.getElementById('viewSignUp');
  const viewForgot = document.getElementById('viewForgot');
  const viewResetPassword = document.getElementById('viewResetPassword');
  const viewVerifyNotice = document.getElementById('viewVerifyNotice');
  const viewResetSuccess = document.getElementById('viewResetSuccess');

  const authError = document.getElementById('authError');
  const authErrorText = document.getElementById('authErrorText');
  const authSuccess = document.getElementById('authSuccess');
  const authSuccessText = document.getElementById('authSuccessText');

  // Forms
  const signInForm = document.getElementById('signInForm');
  const signUpForm = document.getElementById('signUpForm');
  const forgotForm = document.getElementById('forgotForm');
  const resetPasswordForm = document.getElementById('resetPasswordForm');

  // Inputs
  const signInEmail = document.getElementById('signInEmail');
  const signInPassword = document.getElementById('signInPassword');

  const signUpName = document.getElementById('signUpName');
  const signUpEmail = document.getElementById('signUpEmail');
  const signUpPassword = document.getElementById('signUpPassword');
  const signUpConfirm = document.getElementById('signUpConfirm');

  const forgotEmail = document.getElementById('forgotEmail');

  const resetPasswordNew = document.getElementById('resetPasswordNew');
  const resetPasswordConfirm = document.getElementById('resetPasswordConfirm');

  // Switch Links
  const linkForgot = document.getElementById('linkForgot');
  const linkForgotBack = document.getElementById('linkForgotBack');
  const linkToSignUp = document.getElementById('linkToSignUp');
  const linkToSignIn = document.getElementById('linkToSignIn');
  const btnVerifyBackToSignIn = document.getElementById('btnVerifyBackToSignIn');
  const btnResetGoDashboard = document.getElementById('btnResetGoDashboard');

  // Submit Buttons
  const btnSignInSubmit = document.getElementById('btnSignInSubmit');
  const btnSignUpSubmit = document.getElementById('btnSignUpSubmit');
  const btnForgotSubmit = document.getElementById('btnForgotSubmit');
  const btnResetSubmit = document.getElementById('btnResetSubmit');

  /**
   * Reads URL search and hash parameters safely.
   */
  function getParams() {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));

    return {
      mode: searchParams.get('mode') || '',
      type: searchParams.get('type') || hashParams.get('type') || '',
      redirect: searchParams.get('redirect') || '',
      hasToken: Boolean(hashParams.get('access_token'))
    };
  }

  /**
   * Returns sanitized redirect target URL.
   */
  function getSafeRedirectUrl() {
    const params = getParams();
    if (window.Auth && typeof window.Auth.sanitizeRedirect === 'function') {
      return window.Auth.sanitizeRedirect(params.redirect, '../index.html');
    }
    return '../index.html';
  }

  /**
   * Displays or clears global error banner.
   */
  function showError(message) {
    hideSuccess();
    if (!message) {
      hideError();
      return;
    }
    authErrorText.textContent = message;
    authError.style.display = 'flex';
  }

  function hideError() {
    authError.style.display = 'none';
    authErrorText.textContent = '';
  }

  /**
   * Displays or clears global success banner.
   */
  function showSuccess(message) {
    hideError();
    if (!message) {
      hideSuccess();
      return;
    }
    authSuccessText.textContent = message;
    authSuccess.style.display = 'flex';
  }

  function hideSuccess() {
    authSuccess.style.display = 'none';
    authSuccessText.textContent = '';
  }

  /**
   * Field validation styling helper.
   */
  function setFieldValidity(fieldId, errorMsg) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    const errEl = field.querySelector('.field-error');

    if (errorMsg) {
      field.classList.add('invalid');
      if (errEl) errEl.textContent = errorMsg;
    } else {
      field.classList.remove('invalid');
    }
  }

  function clearAllFieldErrors() {
    document.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
  }

  /**
   * Sets loading spinner on submit button.
   */
  function setButtonLoading(btn, isLoading, customText) {
    if (!btn) return;
    btn.disabled = isLoading;
    const spinner = btn.querySelector('.btn-spinner');
    const label = btn.querySelector('.btn-label');

    if (spinner) spinner.style.display = isLoading ? 'inline-block' : 'none';
    if (label && customText) label.textContent = customText;
  }

  /**
   * Switches the active view.
   * Modes: 'signin' | 'signup' | 'forgot' | 'reset' | 'verifyNotice' | 'resetSuccess'
   */
  function switchView(mode) {
    hideError();
    hideSuccess();
    clearAllFieldErrors();

    // Views list
    const views = [
      viewSignIn,
      viewSignUp,
      viewForgot,
      viewResetPassword,
      viewVerifyNotice,
      viewResetSuccess
    ];
    views.forEach(v => {
      if (v) v.style.display = 'none';
    });

    // Control tabs visibility
    if (mode === 'signin' || mode === 'signup') {
      authTabs.style.display = 'grid';
      tabSignIn.classList.toggle('active', mode === 'signin');
      tabSignIn.setAttribute('aria-selected', mode === 'signin');
      tabSignUp.classList.toggle('active', mode === 'signup');
      tabSignUp.setAttribute('aria-selected', mode === 'signup');
    } else {
      authTabs.style.display = 'none';
    }

    if (mode === 'signin') {
      viewSignIn.style.display = 'block';
      setTimeout(() => signInEmail && signInEmail.focus(), 50);
    } else if (mode === 'signup') {
      viewSignUp.style.display = 'block';
      setTimeout(() => signUpName && signUpName.focus(), 50);
    } else if (mode === 'forgot') {
      viewForgot.style.display = 'block';
      setTimeout(() => forgotEmail && forgotEmail.focus(), 50);
    } else if (mode === 'reset') {
      viewResetPassword.style.display = 'block';
      setTimeout(() => resetPasswordNew && resetPasswordNew.focus(), 50);
    } else if (mode === 'verifyNotice') {
      viewVerifyNotice.style.display = 'block';
    } else if (mode === 'resetSuccess') {
      viewResetSuccess.style.display = 'block';
    }
  }

  /**
   * Initializes password visibility toggle buttons.
   */
  function initPasswordToggles() {
    document.querySelectorAll('.password-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';

        const eyeOpen = btn.querySelector('.eye-open');
        const eyeClosed = btn.querySelector('.eye-closed');
        if (eyeOpen && eyeClosed) {
          eyeOpen.style.display = isPassword ? 'none' : 'block';
          eyeClosed.style.display = isPassword ? 'block' : 'none';
        }

        btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      });
    });
  }

  /**
   * Form 1: Handle Sign In submission.
   */
  async function handleSignInSubmit(e) {
    e.preventDefault();
    hideError();
    clearAllFieldErrors();

    const email = signInEmail.value.trim();
    const pass = signInPassword.value;
    let hasErr = false;

    if (!email) {
      setFieldValidity('field-signin-email', 'Please enter your email address.');
      hasErr = true;
    } else if (!window.Auth.isValidEmail(email)) {
      setFieldValidity('field-signin-email', 'Please enter a valid email address.');
      hasErr = true;
    }

    if (!pass) {
      setFieldValidity('field-signin-password', 'Please enter your password.');
      hasErr = true;
    }

    if (hasErr) return;

    setButtonLoading(btnSignInSubmit, true, 'Signing in...');

    try {
      const result = await window.Auth.signIn({ email, password: pass });

      if (!result.success) {
        showError(result.error);
        setButtonLoading(btnSignInSubmit, false, 'Sign In');
        return;
      }

      showSuccess('Signed in successfully! Redirecting...');
      const target = getSafeRedirectUrl();
      setTimeout(() => {
        window.location.href = target;
      }, 500);
    } catch (err) {
      showError(window.Auth.formatAuthError(err));
      setButtonLoading(btnSignInSubmit, false, 'Sign In');
    }
  }

  /**
   * Form 2: Handle Sign Up submission.
   */
  async function handleSignUpSubmit(e) {
    e.preventDefault();
    hideError();
    clearAllFieldErrors();

    const name = signUpName.value.trim();
    const email = signUpEmail.value.trim();
    const pass = signUpPassword.value;
    const confirm = signUpConfirm.value;
    let hasErr = false;

    if (!name) {
      setFieldValidity('field-signup-name', 'Please enter your name.');
      hasErr = true;
    }

    if (!email) {
      setFieldValidity('field-signup-email', 'Please enter your email address.');
      hasErr = true;
    } else if (!window.Auth.isValidEmail(email)) {
      setFieldValidity('field-signup-email', 'Please enter a valid email address.');
      hasErr = true;
    }

    if (!pass) {
      setFieldValidity('field-signup-password', 'Please enter a password.');
      hasErr = true;
    } else if (pass.length < 6) {
      setFieldValidity('field-signup-password', 'Password must be at least 6 characters.');
      hasErr = true;
    }

    if (!confirm) {
      setFieldValidity('field-signup-confirm', 'Please confirm your password.');
      hasErr = true;
    } else if (pass !== confirm) {
      setFieldValidity('field-signup-confirm', 'Passwords do not match.');
      hasErr = true;
    }

    if (hasErr) return;

    setButtonLoading(btnSignUpSubmit, true, 'Creating account...');

    try {
      const result = await window.Auth.signUp({
        displayName: name,
        email: email,
        password: pass,
        confirmPassword: confirm
      });

      if (!result.success) {
        showError(result.error);
        setButtonLoading(btnSignUpSubmit, false, 'Create Account');
        return;
      }

      if (result.requiresEmailConfirmation) {
        // Switch to check email view
        switchView('verifyNotice');
      } else {
        showSuccess('Account created successfully! Redirecting...');
        const target = getSafeRedirectUrl();
        setTimeout(() => {
          window.location.href = target;
        }, 600);
      }
    } catch (err) {
      showError(window.Auth.formatAuthError(err));
      setButtonLoading(btnSignUpSubmit, false, 'Create Account');
    }
  }

  /**
   * Form 3: Handle Forgot Password submission.
   */
  async function handleForgotSubmit(e) {
    e.preventDefault();
    hideError();
    clearAllFieldErrors();

    const email = forgotEmail.value.trim();

    if (!email) {
      setFieldValidity('field-forgot-email', 'Please enter your email address.');
      return;
    }
    if (!window.Auth.isValidEmail(email)) {
      setFieldValidity('field-forgot-email', 'Please enter a valid email address.');
      return;
    }

    setButtonLoading(btnForgotSubmit, true, 'Sending link...');

    try {
      const result = await window.Auth.resetPassword(email);

      setButtonLoading(btnForgotSubmit, false, 'Send Reset Link');

      if (!result.success) {
        showError(result.error);
        return;
      }

      showSuccess('If an account exists with this email, a password reset link has been sent. Check your inbox.');
      forgotEmail.value = '';
    } catch (err) {
      showError(window.Auth.formatAuthError(err));
      setButtonLoading(btnForgotSubmit, false, 'Send Reset Link');
    }
  }

  /**
   * Form 4: Handle Reset Password submission.
   */
  async function handleResetPasswordSubmit(e) {
    e.preventDefault();
    hideError();
    clearAllFieldErrors();

    const pass = resetPasswordNew.value;
    const confirm = resetPasswordConfirm.value;
    let hasErr = false;

    if (!pass) {
      setFieldValidity('field-reset-new', 'Please enter a new password.');
      hasErr = true;
    } else if (pass.length < 6) {
      setFieldValidity('field-reset-new', 'Password must be at least 6 characters.');
      hasErr = true;
    }

    if (!confirm) {
      setFieldValidity('field-reset-confirm', 'Please confirm your new password.');
      hasErr = true;
    } else if (pass !== confirm) {
      setFieldValidity('field-reset-confirm', 'Passwords do not match.');
      hasErr = true;
    }

    if (hasErr) return;

    setButtonLoading(btnResetSubmit, true, 'Updating password...');

    try {
      const result = await window.Auth.updatePassword(pass, confirm);

      setButtonLoading(btnResetSubmit, false, 'Update Password');

      if (!result.success) {
        showError(result.error);
        return;
      }

      switchView('resetSuccess');
    } catch (err) {
      showError(window.Auth.formatAuthError(err));
      setButtonLoading(btnResetSubmit, false, 'Update Password');
    }
  }

  /**
   * Page Initialization.
   */
  async function init() {
    initPasswordToggles();

    // Event listeners for tabs and switch links
    tabSignIn.addEventListener('click', () => switchView('signin'));
    tabSignUp.addEventListener('click', () => switchView('signup'));
    linkToSignUp.addEventListener('click', (e) => { e.preventDefault(); switchView('signup'); });
    linkToSignIn.addEventListener('click', (e) => { e.preventDefault(); switchView('signin'); });
    linkForgot.addEventListener('click', (e) => { e.preventDefault(); switchView('forgot'); });
    linkForgotBack.addEventListener('click', (e) => { e.preventDefault(); switchView('signin'); });
    btnVerifyBackToSignIn.addEventListener('click', () => switchView('signin'));
    btnResetGoDashboard.addEventListener('click', () => { window.location.href = getSafeRedirectUrl(); });

    // Form submit handlers
    signInForm.addEventListener('submit', handleSignInSubmit);
    signUpForm.addEventListener('submit', handleSignUpSubmit);
    forgotForm.addEventListener('submit', handleForgotSubmit);
    resetPasswordForm.addEventListener('submit', handleResetPasswordSubmit);

    // Initial view routing based on URL params or hash
    const params = getParams();

    if (params.type === 'recovery' || params.hasToken) {
      switchView('reset');
    } else if (params.mode === 'signup') {
      switchView('signup');
    } else if (params.mode === 'forgot') {
      switchView('forgot');
    } else {
      switchView('signin');
    }

    // Initialize Auth
    if (window.Auth) {
      await window.Auth.init();

      // Listen for auth events (such as PASSWORD_RECOVERY)
      window.Auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
          switchView('reset');
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
