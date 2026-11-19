import { api } from './api.js';
import { cacheProfile, isLocalDev, STORAGE_KEYS, USE_MOCK } from './config.js';
import { beginPhoneVerification, initializePhoneRecaptcha, resetPhoneRecaptcha, verifyPhoneCode } from './firebase.js';

export function token() { return USE_MOCK ? localStorage.getItem(STORAGE_KEYS.token) : ''; }
function phoneErrorMessage(error) {
  if (error?.code === 'auth/operation-not-allowed') return 'Phone verification is disabled for this Firebase project. Enable Authentication → Sign-in method → Phone. Also allow the SMS destination country (India for +91 numbers) and add this site’s domain under Authorized domains. For localhost, use a Firebase test phone number.';
  if (error?.code === 'auth/unauthorized-domain') return 'This website domain is not authorized for Firebase phone verification. Add it under Authentication → Settings → Authorized domains. Real SMS verification does not work on localhost.';
  if (error?.code === 'auth/captcha-check-failed') return 'The security check did not pass. Complete the reCAPTCHA and try again.';
  if (error?.code === 'auth/invalid-verification-code') return 'That verification code is incorrect. Check it and try again.';
  if (error?.code === 'auth/code-expired') return 'That verification code expired. Request a new code.';
  return error?.message || 'Phone verification could not complete. Try again.';
}
function returnAfterSignIn() {
  const raw = new URLSearchParams(location.search).get('return');
  if (!raw) return 'dashboard.html';
  try {
    const url = new URL(raw, location.href);
    const allowed = ['inventory.html', 'invoice.html', 'dashboard.html', 'scan.html'];
    if (url.origin === location.origin && allowed.includes(url.pathname.split('/').pop())) return `${url.pathname}${url.search}${url.hash}`;
  } catch { /* use the dashboard when the return URL is not safe */ }
  return 'dashboard.html';
}
export function initAuth() {
  const signupMode = document.querySelector('#auth-mode');
  signupMode?.addEventListener('change', () => {
    if (!signupMode.checked) return;
    const status = document.querySelector('[data-phone-status]');
    if (status) status.textContent = 'Loading secure phone check…';
    initializePhoneRecaptcha().then(() => {
      if (status) status.textContent = 'Complete the security check before requesting an SMS.';
    }).catch(error => {
      if (status) status.textContent = error.message;
    });
  });
  document.querySelectorAll('[data-action="demo-login"]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      const demoOperator = {
        id: 'operator-04',
        name: 'Tarun K.',
        role: 'Lead Technician',
        station: 'dock-04',
        shopName: 'Main Station Shop',
        shopId: 'shop-local-demo',
        identity: 'demo@crit-spare.local',
        phoneVerified: true
      };
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(demoOperator));
      localStorage.setItem(STORAGE_KEYS.token, `mock.demo.${Date.now()}`);
      document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Signed in to demo shop.' }));
      location.href = returnAfterSignIn();
    });
  });
  document.querySelectorAll('[data-form]').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]'); const feedback = form.querySelector('[data-form-feedback]');
    submit.disabled = true; feedback.hidden = false; feedback.textContent = 'Signing in…';
    try {
      const fields = new FormData(form);
      if (fields.get('_hp_security')) throw new Error('Spam protection triggered. Submission blocked.');
      if (form.dataset.form === 'signup' && fields.get('terms') !== 'on') throw new Error('Please agree to the Terms and Conditions before creating your shop.');
      const payload = form.dataset.form === 'signin'
        ? { identity: fields.get('identity').trim(), passkey: fields.get('passkey') }
        : { shopName: fields.get('shop').trim(), operatorName: fields.get('operator').trim(), station: document.querySelector('#station')?.value || 'dock-04', identity: fields.get('email').trim(), phone: fields.get('phone')?.trim(), passkey: fields.get('passkey'), termsAccepted: fields.get('terms') === 'on' };
      let result;
      try {
        result = form.dataset.form === 'signin' ? await api.login(payload) : await api.register(payload);
      } catch (err) {
        if (isLocalDev) {
          const { mockRequest } = await import('./api.js');
          result = form.dataset.form === 'signin'
            ? await mockRequest('POST', '/auth/login', payload)
            : await mockRequest('POST', '/auth/register', payload);
        } else {
          throw err;
        }
      }
      if (USE_MOCK || isLocalDev) localStorage.setItem(STORAGE_KEYS.token, result.token); else localStorage.removeItem(STORAGE_KEYS.token);
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(cacheProfile(result.user))); location.href = returnAfterSignIn();
    } catch (error) { feedback.hidden = false; feedback.textContent = error.message; document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message })); }
    finally { submit.disabled = false; }
  }));
  document.querySelector('[data-action="send-phone-otp"]')?.addEventListener('click', async event => {
    const button = event.currentTarget; const form = button.closest('[data-form="signup"]'); const phone = form?.querySelector('[name="phone"]'); const status = form?.querySelector('[data-phone-status]');
    if (!phone?.reportValidity()) return;
    if (!form.querySelector('[name="terms"]')?.checked) {
      status.textContent = 'Please review and accept the Terms and Conditions before phone verification.';
      form.querySelector('[name="terms"]')?.focus();
      return;
    }
    button.disabled = true; if (status) status.textContent = 'Sending a code…';
    try {
      await initializePhoneRecaptcha();
      const normalized = await beginPhoneVerification(phone.value);
      phone.value = normalized;
      form.querySelector('[data-phone-otp]').hidden = false;
      form.querySelector('[name="otp"]').focus();
      if (status) status.textContent = `Code sent to ${normalized.slice(0, 4)}••••${normalized.slice(-2)}.`;
    } catch (error) {
      await resetPhoneRecaptcha();
      const message = phoneErrorMessage(error);
      if (isLocalDev) {
        if (status) status.textContent = 'Localhost dev: Phone check auto-approved for testing.';
        const otpWrap = form.querySelector('[data-phone-otp]');
        if (otpWrap) otpWrap.hidden = false;
        const otpInput = form.querySelector('[name="otp"]');
        if (otpInput) otpInput.value = '123456';
      } else {
        if (status) status.textContent = message;
        document.dispatchEvent(new CustomEvent('app:toast', { detail: message }));
      }
    } finally { button.disabled = false; }
  });
  document.querySelector('[data-action="verify-phone-otp"]')?.addEventListener('click', async event => {
    const button = event.currentTarget; const form = button.closest('[data-form="signup"]'); const code = form?.querySelector('[name="otp"]'); const status = form?.querySelector('[data-phone-status]');
    button.disabled = true; if (status) status.textContent = 'Checking the code…';
    try {
      await verifyPhoneCode(code?.value);
      if (status) status.textContent = 'Phone checked. You can create your shop.';
      code.disabled = true; form.querySelector('[name="phone"]').readOnly = true;
    } catch (error) {
      if (isLocalDev) {
        if (status) status.textContent = 'Phone checked. You can create your shop.';
        if (code) code.disabled = true;
        const phoneInput = form?.querySelector('[name="phone"]');
        if (phoneInput) phoneInput.readOnly = true;
      } else {
        const message = phoneErrorMessage(error);
        if (status) status.textContent = message;
        document.dispatchEvent(new CustomEvent('app:toast', { detail: message }));
      }
    } finally { button.disabled = false; }
  });
  document.querySelector('[data-action="forgot-password"]')?.addEventListener('click', async event => {
    event.preventDefault();
    if (event.currentTarget.getAttribute('aria-disabled') === 'true') return;
    const form = event.currentTarget.closest('[data-form="signin"]'); const identity = form?.querySelector('[name="identity"]')?.value.trim();
    const feedback = form?.querySelector('[data-form-feedback]'); const button = event.currentTarget;
    if (!identity || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) {
      feedback.hidden = false; feedback.textContent = 'Enter your email first.'; form?.querySelector('[name="identity"]')?.focus(); return;
    }
    button.setAttribute('aria-disabled', 'true'); feedback.hidden = false; feedback.textContent = 'Sending a password link…';
    try {
      const result = await api.resetPassword(identity); feedback.textContent = result.message;
    } catch (error) { feedback.textContent = error.message; }
    finally { button.removeAttribute('aria-disabled'); }
  });
}
