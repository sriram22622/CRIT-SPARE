import { cacheProfile, STORAGE_KEYS, USE_MOCK } from './config.js';
import { getFirebaseUser, setRememberSignIn, signOutFirebase } from './firebase.js';
import { initAuth, token } from './auth.js';
import { initInventory } from './inventory.js';
import { initInvoice } from './invoice.js';
import { initDashboard } from './dashboard.js';
import { api } from './api.js';

function toast(message) {
  const region = document.querySelector('[data-toast-region]'); if (!region) return;
  region.textContent = message; region.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { region.hidden = true; region.textContent = ''; }, 4500);
}
document.addEventListener('app:toast', event => toast(event.detail));
const page = document.body.dataset.page;
// Handle password visibility at the document level so it remains reliable
// while auth/session initialization is still in progress.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action="toggle-password"]');
  if (!button) return;
  event.preventDefault();
  const input = document.getElementById(button.dataset.target);
  if (!input) return;
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(visible));
  button.setAttribute('aria-label', visible ? 'Hide passkey' : 'Show passkey');
  const icon = button.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = visible ? 'visibility_off' : 'visibility';
}, true);
if (!USE_MOCK) {
  localStorage.removeItem(STORAGE_KEYS.token);
  try {
    const savedProfile = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}');
    if (savedProfile.id) localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(cacheProfile(savedProfile)));
  } catch { localStorage.removeItem(STORAGE_KEYS.user); }
}
const protectedPages = ['inventory', 'invoice', 'dashboard', 'scan'];
let sessionKnown = false;
let sessionActive = false;
// Bind auth controls before Firebase's asynchronous session/profile checks so
// the sign-in form and password visibility button work immediately.
if (page === 'auth') initAuth();
function initCookieManager() {
  const dialog = document.querySelector('#cookie-dialog');
  if (!dialog) return;
  const remember = dialog.querySelector('[data-remember-signin]');
  const loadSavedChoice = () => { remember.checked = localStorage.getItem(STORAGE_KEYS.rememberSignIn) === 'true'; };
  const open = () => { loadSavedChoice(); if (!dialog.open) dialog.showModal(); };
  const save = async () => {
    const persistent = Boolean(remember.checked);
    localStorage.setItem(STORAGE_KEYS.rememberSignIn, String(persistent));
    localStorage.setItem(STORAGE_KEYS.cookieChoice, 'saved');
    dialog.close();
    try {
      if (!USE_MOCK) await setRememberSignIn(persistent);
    } catch (error) {
      document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message || 'Could not save the sign-in storage choice.' }));
    }
  };
  document.querySelector('[data-action="manage-cookies"]')?.addEventListener('click', open);
  dialog.querySelector('[data-action="save-cookie-preferences"]')?.addEventListener('click', save);
  dialog.querySelector('[data-action="dismiss-cookie-preferences"]')?.addEventListener('click', save);
  dialog.addEventListener('cancel', event => {
    if (!localStorage.getItem(STORAGE_KEYS.cookieChoice)) {
      event.preventDefault();
      remember.checked = false;
      save();
    }
  });
  open();
}
if (page === 'auth') initCookieManager();
document.body.classList.add('page-enter');
window.setTimeout(() => document.body.classList.remove('page-enter'), 900);
const canShowPointerGlow = matchMedia('(pointer: fine) and (hover: hover)').matches
  && !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (canShowPointerGlow) {
  const glow = document.createElement('div'); glow.className = 'pointer-glow'; glow.setAttribute('aria-hidden', 'true');
  document.body.prepend(glow);
  let glowFrame = 0;
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    if (glowFrame) cancelAnimationFrame(glowFrame);
    glowFrame = requestAnimationFrame(() => {
      glow.style.left = `${event.clientX}px`; glow.style.top = `${event.clientY}px`;
      document.body.classList.add('pointer-glow-active');
    });
  }, { passive: true });
  document.addEventListener('pointerleave', () => document.body.classList.remove('pointer-glow-active'));
}
function authPage(returnTo = '') {
  const query = new URLSearchParams();
  if (returnTo) query.set('return', returnTo);
  query.set('needLogin', '1');
  return `auth.html?${query}`;
}
function allowedReturnPath(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin || !protectedPages.includes(url.pathname.split('/').pop().replace(/\.html$/i, ''))) return '';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return ''; }
}
function updateAuthControls(signedIn) {
  sessionKnown = true; sessionActive = signedIn;
  document.querySelectorAll('[data-action="logout"]').forEach(button => { button.hidden = !signedIn; });
  document.querySelectorAll('[data-action="sign-in"]').forEach(link => { link.hidden = signedIn; });
}
async function hasActiveSession() {
  if (USE_MOCK) return Boolean(token());
  try { return Boolean(await getFirebaseUser()); } catch { return false; }
}
document.addEventListener('click', async event => {
  const logout = event.target.closest('[data-action="logout"]');
  if (logout) {
    event.preventDefault(); logout.disabled = true; document.body.classList.add('page-leaving');
    window.setTimeout(async () => {
      try { if (!USE_MOCK) await signOutFirebase(); }
      catch (error) {
        document.body.classList.remove('page-leaving'); logout.disabled = false;
        document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message || 'Could not sign out. Try again.' }));
        return;
      }
      localStorage.removeItem(STORAGE_KEYS.token); localStorage.removeItem(STORAGE_KEYS.user); updateAuthControls(false);
      const returnTo = `${location.pathname}${location.search}${location.hash}`;
      location.href = `auth.html?loggedOut=1&return=${encodeURIComponent(allowedReturnPath(returnTo) || 'dashboard.html')}`;
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240);
    return;
  }
  const link = event.target.closest('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
  const destination = new URL(link.href, location.href);
  if (destination.origin !== location.origin || !/\.html$/i.test(destination.pathname) || destination.pathname === location.pathname) return;
  event.preventDefault();
  const targetPage = destination.pathname.split('/').pop().replace(/\.html$/i, '');
  if (protectedPages.includes(targetPage)) {
    const signedIn = sessionKnown ? sessionActive : await hasActiveSession();
    updateAuthControls(signedIn);
    if (!signedIn) {
      document.body.classList.add('page-leaving');
      window.setTimeout(() => { location.href = authPage(`${destination.pathname}${destination.search}${destination.hash}`); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240);
      return;
    }
  }
  document.body.classList.add('page-leaving');
  window.setTimeout(() => { location.href = destination.href; }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 240);
});
function syncProfile() {
  let user = {};
  try { user = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); } catch { /* ignore malformed cached profile */ }
  if (!user.name) return;
  const initials = user.name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  document.querySelectorAll('.avatar').forEach(avatar => {
    avatar.textContent = initials || 'OP';
    avatar.setAttribute('aria-label', `${user.name} profile`);
    avatar.title = user.name;
  });
  const heading = document.querySelector('.operator-card h2');
  if (heading) heading.textContent = `${user.name} • ${user.role || 'Station Operator'}`;
  const details = document.querySelector('.operator-card h2 + p');
  if (details) {
    details.textContent = `${user.shopName || 'Your shop'} • ${user.station || 'Station not set'}`;
  }
  const firstName = user.name.trim().split(/\s+/)[0];
  const welcome = document.querySelector('.welcome-panel__copy h1 em'); if (welcome) welcome.textContent = firstName;
  const station = user.station || 'Station not set';
  const shift = document.querySelector('.welcome-panel__copy > .pill');
  if (shift) shift.textContent = `● Shift: Active • ${user.shopName || 'Your shop'} / ${station}`;
  document.querySelectorAll('.topbar__sync').forEach(sync => {
    const textNodes = [...sync.childNodes].filter(node => node.nodeType === Node.TEXT_NODE);
    const stationText = textNodes.length > 1 ? textNodes[textNodes.length - 1] : textNodes[0];
    if (!stationText) return;
    stationText.textContent = textNodes.length > 1
      ? ` • ${user.shopName || 'Your shop'} / ${station}`
      : ` LIVE SYNC • ${user.shopName || 'Your shop'} / ${station}`;
  });
  const portrait = document.querySelector('.operator-portrait small'); if (portrait) portrait.textContent = `${station} Active`;
  const miniReceiptShop = document.querySelector('.mini-receipt--large > p:first-child');
  if (miniReceiptShop) miniReceiptShop.textContent = `★ CRIT-SPARE ${user.shopName || 'INVENTORY STATION'} ★`;
  const hardwareStation = document.querySelector('.hardware-title p');
  if (hardwareStation) hardwareStation.textContent = `Serial #CRIT-REG-4491 • ${station}`;
}
async function initializePage() {
  const signedIn = await hasActiveSession();
  updateAuthControls(signedIn);
  if (new URLSearchParams(location.search).has('loggedOut')) {
    document.dispatchEvent(new CustomEvent('app:toast', { detail: 'You are signed out. Sign in or create a shop to continue.' }));
  } else if (new URLSearchParams(location.search).has('needLogin')) {
    document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Please sign in or create a shop to continue.' }));
  }
  if (protectedPages.includes(page)) {
    if (!signedIn) { location.replace(authPage(`${location.pathname}${location.search}${location.hash}`)); return; }
    if (!USE_MOCK) {
      try {
        const user = await getFirebaseUser();
        if (!user) { localStorage.removeItem(STORAGE_KEYS.token); localStorage.removeItem(STORAGE_KEYS.user); location.replace(authPage(`${location.pathname}${location.search}${location.hash}`)); return; }
        localStorage.removeItem(STORAGE_KEYS.token);
      } catch {
        localStorage.removeItem(STORAGE_KEYS.token); localStorage.removeItem(STORAGE_KEYS.user); location.replace(authPage(`${location.pathname}${location.search}${location.hash}`)); return;
      }
    }
    try {
      const freshProfile = await api.getProfile();
      if (freshProfile?.user) localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(cacheProfile(freshProfile.user)));
    } catch {
      localStorage.removeItem(STORAGE_KEYS.token); localStorage.removeItem(STORAGE_KEYS.user); location.replace(authPage(`${location.pathname}${location.search}${location.hash}`)); return;
    }
  }
  if (page === 'auth') {
    if (signedIn) {
      try {
        const result = await api.getProfile();
        if (result?.user) { location.replace(allowedReturnPath(new URLSearchParams(location.search).get('return')) || 'dashboard.html'); return; }
      } catch (error) {
        const user = USE_MOCK ? null : await getFirebaseUser().catch(() => null);
        if (user?.phoneNumber && error?.status === 404) {
          const signupForm = document.querySelector('[data-form="signup"]');
          const phone = signupForm?.querySelector('[name="phone"]');
          const otp = signupForm?.querySelector('[data-phone-otp]');
          const status = signupForm?.querySelector('[data-phone-status]');
          const send = signupForm?.querySelector('[data-action="send-phone-otp"]');
          const mode = document.querySelector('#auth-mode');
          if (mode) mode.checked = true;
          if (phone) { phone.value = user.phoneNumber; phone.readOnly = true; }
          if (send) send.hidden = true;
          if (otp) otp.hidden = true;
          if (status) status.textContent = 'Phone checked. Finish setting up your shop.';
          document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Finish setting up your shop to continue.' }));
        } else if (error?.status !== 404) {
          document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message || 'Could not check your sign-in. Try again.' }));
        }
      }
    }
  }
  syncProfile();
  if (page !== 'inventory') {
    document.querySelectorAll('[data-search-inventory]').forEach(search => search.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); location.href = `inventory.html?search=${encodeURIComponent(search.value.trim())}`; }
    }));
  }
  if (page === 'inventory') initInventory();
  if (page === 'invoice') initInvoice();
  if (page === 'dashboard') initDashboard();
  if (page === 'scan') {
    const mobile = matchMedia('(max-width: 760px) and (pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && innerWidth <= 760);
    if (!mobile) { location.replace('inventory.html'); return; }
    const { initScan } = await import('./scan.js'); initScan();
  }
}
initializePage();
