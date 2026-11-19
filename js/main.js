import { cacheProfile, isLocalDev, STORAGE_KEYS, USE_MOCK } from './config.js';
import { getFirebaseUser, setRememberSignIn, signOutFirebase } from './firebase.js';
import { initAuth, token } from './auth.js';
import { initInventory } from './inventory.js';
import { initInvoice } from './invoice.js';
import { initDashboard } from './dashboard.js';
import { initAnalytics } from './analytics.js';
import { api } from './api.js';
import { ensureEntryGateway, ensureCustomerCartDrawer, injectTopbarControls, getRole, renderCustomerDashboard } from './customer.js';

function toast(message) {
  let region = document.querySelector('[data-toast-region]');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.dataset.toastRegion = '';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('role', 'status');
    document.body.append(region);
  }
  region.textContent = message;
  region.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { region.hidden = true; region.textContent = ''; }, 4500);
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
if (!USE_MOCK && !isLocalDev) {
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
  if (!localStorage.getItem(STORAGE_KEYS.cookieChoice)) {
    open();
  }
}
if (page === 'auth') initCookieManager();
document.body.classList.add('page-enter');
window.setTimeout(() => document.body.classList.remove('page-enter'), 400);

const canShowPointerGlow = matchMedia('(pointer: fine) and (hover: hover)').matches
  && !matchMedia('(prefers-reduced-motion: reduce)').matches;
if (canShowPointerGlow) {
  const glow = document.createElement('div');
  glow.className = 'pointer-glow';
  glow.setAttribute('aria-hidden', 'true');
  document.body.prepend(glow);
  let targetX = -500, targetY = -500, currentX = -500, currentY = -500;
  let rafId = 0;
  const renderGlow = () => {
    currentX += (targetX - currentX) * 0.2;
    currentY += (targetY - currentY) * 0.2;
    glow.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`;
    if (Math.abs(targetX - currentX) > 0.5 || Math.abs(targetY - currentY) > 0.5) {
      rafId = requestAnimationFrame(renderGlow);
    } else {
      rafId = 0;
    }
  };
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    targetX = event.clientX;
    targetY = event.clientY;
    if (currentX === -500) { currentX = targetX; currentY = targetY; }
    document.body.classList.add('pointer-glow-active');
    if (!rafId) rafId = requestAnimationFrame(renderGlow);
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
  try {
    const user = await getFirebaseUser();
    if (user) return true;
  } catch { /* ignore */ }
  if (isLocalDev) {
    try {
      const localUser = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}');
      if (localUser.id) return true;
    } catch { /* ignore */ }
  }
  return false;
}
document.addEventListener('click', async event => {
  const logout = event.target.closest('[data-action="logout"]');
  if (logout) {
    event.preventDefault(); logout.disabled = true;
    try { if (!USE_MOCK) await signOutFirebase(); }
    catch (error) {
      logout.disabled = false;
      document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message || 'Could not sign out. Try again.' }));
      return;
    }
    localStorage.removeItem(STORAGE_KEYS.token); localStorage.removeItem(STORAGE_KEYS.user); updateAuthControls(false);
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    location.href = `auth.html?loggedOut=1&return=${encodeURIComponent(allowedReturnPath(returnTo) || 'dashboard.html')}`;
    return;
  }
  const link = event.target.closest('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
  const destination = new URL(link.href, location.href);
  if (destination.origin !== location.origin || !/\.html$/i.test(destination.pathname) || destination.pathname === location.pathname) return;
  event.preventDefault();
  const targetPage = destination.pathname.split('/').pop().replace(/\.html$/i, '');
  if (protectedPages.includes(targetPage) && getRole() !== 'customer') {
    const signedIn = sessionKnown ? sessionActive : await hasActiveSession();
    updateAuthControls(signedIn);
    if (!signedIn) {
      location.href = authPage(`${destination.pathname}${destination.search}${destination.hash}`);
      return;
    }
  }
  location.href = destination.href;
});

function ensureHelpPopovers() {
  if (!document.getElementById('inventory-help-popover')) {
    const pop = document.createElement('div');
    pop.className = 'policy-popover'; pop.id = 'inventory-help-popover'; pop.setAttribute('popover', 'auto');
    pop.innerHTML = `
      <header class="policy-popover__header">
        <div><p class="eyebrow">HELP &amp; INVENTORY GUIDE</p><h2>Inventory Help</h2></div>
        <button class="icon-button" type="button" popovertarget="inventory-help-popover" popovertargetaction="hide" aria-label="Close">×</button>
      </header>
      <div class="policy-popover__body">
        <h3>Adding New Stock Items</h3>
        <p>New shops start with 0 stock items. Click the <strong>Add Stock</strong> button in the top bar or inventory heading to enter your part code (SKU), name, shelf location, and starting quantity.</p>
        <h3>Issuing Parts &amp; Receipts</h3>
        <p>Click <strong>− Issue</strong> on any item to dispense parts to engineers or stations. An instant thermal slip or bill is generated with full records.</p>
        <h3>Restocking &amp; Auditing</h3>
        <p>Click <strong>＋ Restock</strong> when fresh inventory arrives. Click <strong>Count stock</strong> to enter your counted shelf quantity; the system calculates any variance immediately.</p>
      </div>
      <footer class="policy-popover__footer"><a href="inventory.html">Go to Inventory Workspace →</a></footer>
    `;
    document.body.append(pop);
  }

  if (!document.getElementById('account-help-popover')) {
    const pop = document.createElement('div');
    pop.className = 'policy-popover'; pop.id = 'account-help-popover'; pop.setAttribute('popover', 'auto');
    pop.innerHTML = `
      <header class="policy-popover__header">
        <div><p class="eyebrow">HELP &amp; SECURITY</p><h2>Account Security Help</h2></div>
        <button class="icon-button" type="button" popovertarget="account-help-popover" popovertargetaction="hide" aria-label="Close">×</button>
      </header>
      <div class="policy-popover__body">
        <h3>Operator Sign In</h3>
        <p>Sign in using your authorized email and passkey. Your name, station ID, and shop identity are bound to every action you perform.</p>
        <h3>Session Storage</h3>
        <p>You can choose to remember your station sign-in on this device. If unchecked, your session clears when the browser closes.</p>
        <h3>Phone Verification</h3>
        <p>Mobile number verification via SMS code is available during setup to ensure only verified shop operators can register stations.</p>
      </div>
      <footer class="policy-popover__footer"><a href="auth.html">Manage Shop Account →</a></footer>
    `;
    document.body.append(pop);
  }

  if (!document.getElementById('device-help-popover')) {
    const pop = document.createElement('div');
    pop.className = 'policy-popover'; pop.id = 'device-help-popover'; pop.setAttribute('popover', 'auto');
    pop.innerHTML = `
      <header class="policy-popover__header">
        <div><p class="eyebrow">DEVICE &amp; SCANNING</p><h2>Device &amp; Scanner Help</h2></div>
        <button class="icon-button" type="button" popovertarget="device-help-popover" popovertargetaction="hide" aria-label="Close">×</button>
      </header>
      <div class="policy-popover__body">
        <h3>Mobile QR Scanner</h3>
        <p>The QR scanner is optimized for mobile smartphone cameras. When opened on mobile (or with phone camera emulation), it provides real-time barcode reconciliation.</p>
        <h3>Thermal Printer Simulation</h3>
        <p>The Billing section simulates an 80mm thermal receipt printer with interactive tear-off physics, printable PDF export, and direct WhatsApp invoice sharing.</p>
        <h3>Cross-Platform Support</h3>
        <p>Full responsive support on Windows, macOS, Android, and iOS devices.</p>
      </div>
      <footer class="policy-popover__footer"><a href="scan.html">Open Mobile Scanner →</a></footer>
    `;
    document.body.append(pop);
  }
}

function closeNotificationPopover() {
  const pop = document.getElementById('notification-popover');
  if (!pop) return;
  try {
    if (typeof pop.hidePopover === 'function') {
      pop.hidePopover();
    }
  } catch { /* ignore */ }
  pop.removeAttribute('open');
  pop.style.display = 'none';
}

function syncNotificationList() {
  const list = document.querySelector('[data-notif-list]');
  const countPill = document.querySelector('[data-notif-count]');
  const badges = document.querySelectorAll('.notification-badge');
  if (!list) return;

  const isAiSeed = p => {
    if (!p) return false;
    const id = String(p.id || '').toLowerCase();
    const sku = String(p.sku || '').toUpperCase();
    const name = String(p.name || '').toLowerCase();
    return (
      id === 'cryo-resistor' || id === 'titanium-solenoid' || id === 'optical-prism' || id === 'magnetic-flux' ||
      sku === 'CR-9041-B' || sku === 'TSV-882' || sku === 'OPC-404' || sku === 'MFS-109' ||
      name.includes('cryo-resistor') || name.includes('titanium solenoid') || name.includes('optical prism') || name.includes('magnetic flux')
    );
  };

  let parts = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.state);
    if (raw) {
      const parsed = JSON.parse(raw);
      let user = {};
      try { user = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); } catch {}
      const shopId = user?.shopId;
      if (shopId && parsed?.shops?.[shopId]?.parts) {
        parts = parsed.shops[shopId].parts;
      } else if (Array.isArray(parsed?.parts)) {
        parts = parsed.parts;
      }
    }
  } catch {}

  const userParts = parts.filter(p => !isAiSeed(p));
  const lowParts = userParts.filter(p => Number(p.qty) > 0 && (Number(p.qty) <= 20 || p.status === 'low' || p.status === 'critical'));
  const outParts = userParts.filter(p => Number(p.qty) === 0 || p.status === 'out-of-stock');
  const alertCount = lowParts.length + outParts.length;

  if (countPill) {
    countPill.textContent = alertCount > 0 ? `${alertCount} live` : 'All read';
    countPill.className = alertCount > 0 ? 'pill pill--gold' : 'pill pill--green';
  }
  badges.forEach(b => { b.hidden = alertCount === 0; });

  const esc = val => String(val ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let html = '';
  for (const part of outParts) {
    html += `
      <div class="notification-item notification-item--red">
        <div class="notification-item__icon"><span class="material-symbols-outlined">error</span></div>
        <div class="notification-item__content">
          <strong>Critical • Out of stock</strong>
          <p>${esc(part.name)} reached 0 units in Bin ${esc(part.bin || '—')}.</p>
          <span class="notification-item__time">Bin ${esc(part.bin || '—')} • Urgent</span>
        </div>
      </div>
    `;
  }
  for (const part of lowParts) {
    html += `
      <div class="notification-item notification-item--gold">
        <div class="notification-item__icon"><span class="material-symbols-outlined">warning</span></div>
        <div class="notification-item__content">
          <strong>Stock Alert • Reorder recommended</strong>
          <p>${esc(part.name)} is running low (${part.qty} units remaining).</p>
          <span class="notification-item__time">Bin ${esc(part.bin || '—')} • Low stock</span>
        </div>
      </div>
    `;
  }
  html += `
    <div class="notification-item notification-item--green">
      <div class="notification-item__icon"><span class="material-symbols-outlined">cloud_done</span></div>
      <div class="notification-item__content">
        <strong>Station Online</strong>
        <p>Shop inventory and billing ledger synchronized online.</p>
        <span class="notification-item__time">Just now</span>
      </div>
    </div>
  `;
  if (alertCount === 0) {
    html += `
      <div class="notification-item" style="background:rgba(255,255,255,0.02);border:1px dashed var(--line);text-align:center;padding:14px 10px;">
        <span class="material-symbols-outlined" style="color:var(--green);font-size:24px;margin-bottom:4px;display:inline-block;">check_circle</span>
        <p style="margin:0;font-size:12px;color:var(--white);font-weight:600;">No stock alerts</p>
        <span style="font-size:10px;color:var(--muted);display:block;margin-top:2px;">All added spare parts are at healthy levels.</span>
      </div>
    `;
  }
  list.innerHTML = html;
}

function ensureCookieBanner() {
  if (page === 'auth' || localStorage.getItem(STORAGE_KEYS.cookieChoice) || document.getElementById('cookie-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'cookie-banner';
  banner.className = 'cookie-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Cookie and storage choices');
  banner.innerHTML = `
    <div class="cookie-banner__content">
      <span class="material-symbols-outlined" style="color:var(--gold);font-size:22px;">cookie</span>
      <p>We use essential browser storage for authentication &amp; secure sync. No tracking cookies. <a href="privacy.html" class="text-link">Privacy Policy</a></p>
    </div>
    <div class="cookie-banner__actions">
      <button class="button button--gold button--small" type="button" data-action="accept-all-cookies">Accept All</button>
      <button class="button button--glass button--small" type="button" data-action="essential-only-cookies">Essential Only</button>
      <a class="button button--muted button--small" href="auth.html">Preferences</a>
    </div>
  `;
  document.body.append(banner);

  const choose = (persistent) => {
    localStorage.setItem(STORAGE_KEYS.rememberSignIn, String(persistent));
    localStorage.setItem(STORAGE_KEYS.cookieChoice, 'saved');
    banner.remove();
    document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Cookie preferences saved.' }));
  };

  banner.querySelector('[data-action="accept-all-cookies"]')?.addEventListener('click', () => choose(true));
  banner.querySelector('[data-action="essential-only-cookies"]')?.addEventListener('click', () => choose(false));
}

function ensureNotificationPopover() {
  let pop = document.getElementById('notification-popover');
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'notification-popover';
    pop.id = 'notification-popover';
    pop.setAttribute('popover', 'auto');
    pop.setAttribute('aria-labelledby', 'notification-popover-title');
    pop.innerHTML = `
      <div class="notification-popover__header">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined" style="color:var(--gold);font-size:20px;">notifications_active</span>
          <h3 id="notification-popover-title" style="margin:0;font-size:15px;font-weight:700;">Station Alerts</h3>
          <span class="pill pill--gold" data-notif-count style="font-size:10px;">Live</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="text-link" data-action="mark-notifs-read" style="font-size:11px;color:var(--muted);cursor:pointer;background:none;border:0;">Mark read</button>
          <button class="notification-close-button" type="button" data-action="close-notifications" popovertarget="notification-popover" popovertargetaction="hide" aria-label="Close notifications">✕</button>
        </div>
      </div>
      <div class="notification-popover__list" data-notif-list></div>
    `;
    document.body.append(pop);
  }

  // Populate dynamic alerts without AI sample items
  syncNotificationList();

  pop.querySelector('[data-action="close-notifications"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeNotificationPopover();
  });

  document.querySelectorAll('[data-action="mark-notifs-read"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.notification-badge').forEach(b => { b.hidden = true; });
      const countPill = document.querySelector('[data-notif-count]');
      if (countPill) countPill.textContent = 'All read';
      document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Notifications marked as read.' }));
    });
  });

  document.querySelectorAll('.notification-trigger, [data-action="toggle-notifications"]').forEach(btn => {
    btn.setAttribute('popovertarget', 'notification-popover');
    btn.addEventListener('click', () => {
      if (pop.style.display === 'none') pop.style.display = '';
      syncNotificationList();
    });
  });
}

// Global fail-safe delegated listeners for close button and Escape key
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="close-notifications"]')) {
    event.preventDefault();
    event.stopPropagation();
    closeNotificationPopover();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeNotificationPopover();
  }
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

function initCustomerPortalTools() {
  const searchInput = document.querySelector('[data-customer-part-search]');
  const resultsContainer = document.querySelector('[data-customer-parts-results]');
  const billForm = document.querySelector('[data-customer-bill-form]');
  const billInput = document.querySelector('[data-customer-bill-input]');
  const billOutput = document.querySelector('[data-customer-bill-output]');

  const esc = str => String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Live Spares Search
  if (searchInput && resultsContainer) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const query = searchInput.value.trim();
      if (!query) {
        resultsContainer.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px;">Type above to search live station parts...</div>';
        return;
      }
      debounceTimer = setTimeout(async () => {
        resultsContainer.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px;"><span class="material-symbols-outlined" style="animation:cs-spin 1s linear infinite;font-size:16px;vertical-align:middle;">sync</span> Checking stock...</div>';
        try {
          const res = await api.getParts(query);
          const parts = Array.isArray(res) ? res : (res?.parts || []);
          if (!parts.length) {
            resultsContainer.innerHTML = `<div style="font-size:12px;color:var(--muted);text-align:center;padding:16px;">No parts found matching "<strong>${esc(query)}</strong>".</div>`;
            return;
          }
          let html = '';
          parts.forEach(p => {
            const qty = Number(p.qty) || 0;
            const price = Number(p.unitPrice) || 0;
            const statusBadge = qty > 5 
              ? `<span class="pill pill--green" style="font-size:10px;">● In Stock (${qty})</span>`
              : qty > 0 
                ? `<span class="pill pill--gold" style="font-size:10px;">▲ Low Stock (${qty})</span>`
                : `<span class="pill pill--red" style="font-size:10px;">✕ Out of Stock</span>`;
            
            html += `
              <div class="customer-part-result">
                <div>
                  <div style="font-weight:700;font-size:13px;color:var(--white);">${esc(p.name)}</div>
                  <div style="font-size:11px;color:var(--muted);display:flex;gap:8px;margin-top:2px;">
                    <span>SKU: <strong style="color:var(--foreground);">${esc(p.sku)}</strong></span>
                    <span>Bin: <strong>${esc(p.bin || '—')}</strong></span>
                  </div>
                </div>
                <div style="text-align:right;">
                  <div style="font-weight:800;font-size:14px;color:var(--gold);font-family:'JetBrains Mono',monospace;">₹${price.toLocaleString()}</div>
                  <div style="margin-top:2px;">${statusBadge}</div>
                </div>
              </div>
            `;
          });
          resultsContainer.innerHTML = html;
        } catch (err) {
          resultsContainer.innerHTML = `<div style="font-size:12px;color:#ff80ab;text-align:center;padding:16px;">Could not load parts: ${esc(err.message)}</div>`;
        }
      }, 200);
    });
  }

  // Bill & Receipt Verification
  if (billForm && billInput && billOutput) {
    billForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawRef = billInput.value.trim();
      if (!rawRef) return;
      billOutput.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:10px;"><span class="material-symbols-outlined" style="animation:cs-spin 1s linear infinite;font-size:14px;vertical-align:middle;">sync</span> Verifying receipt authenticity with ledger...</div>';
      try {
        const res = await api.getInvoice(rawRef);
        const inv = res?.invoice;
        if (!inv) throw new Error('Invoice not found');
        const dateStr = inv.createdAt ? new Date(inv.createdAt).toLocaleString() : 'Recent';
        const itemsSummary = (inv.items || []).map(i => `${esc(i.name)} × ${i.qty}`).join(', ') || 'Parts dispensed';

        billOutput.innerHTML = `
          <div class="customer-bill-result">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <span class="pill pill--green" style="font-size:11px;font-weight:700;"><span class="material-symbols-outlined" style="font-size:13px;vertical-align:middle;">verified</span> Genuine Receipt Verified</span>
              <strong style="font-family:'JetBrains Mono',monospace;color:var(--gold);font-size:13px;">${esc(inv.number || inv.id)}</strong>
            </div>
            <p style="margin:0 0 6px;font-size:12px;color:var(--foreground);"><strong>Shop:</strong> ${esc(inv.shopName || 'CRIT-SPARE Station')} • <strong>Station:</strong> ${esc(inv.station || 'Dock-04')}</p>
            <p style="margin:0 0 6px;font-size:12px;color:var(--muted);"><strong>Date:</strong> ${esc(dateStr)} • <strong>Total:</strong> <strong style="color:var(--gold);">₹${Number(inv.total || 0).toLocaleString()}</strong></p>
            <p style="margin:0 0 10px;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><strong>Items:</strong> ${itemsSummary}</p>
            <div style="display:flex;gap:8px;">
              <a href="invoice.html?id=${encodeURIComponent(inv.id || inv.number)}" class="button button--gold button--small" style="text-decoration:none;">Open Full Thermal Slip ↗</a>
            </div>
          </div>
        `;
      } catch (err) {
        billOutput.innerHTML = `
          <div style="background:rgba(255,23,68,0.08);border:1px solid rgba(255,23,68,0.25);border-radius:12px;padding:12px;margin-top:6px;color:#ff80ab;font-size:12px;">
            <span class="material-symbols-outlined" style="font-size:15px;vertical-align:middle;margin-right:4px;">error</span>
            Receipt slip "<strong>${esc(rawRef)}</strong>" could not be verified in this shop's database. Please check the slip number on your receipt.
          </div>
        `;
      }
    });
  }
}

function initRoleGateway() {
  const gateway = document.getElementById('entry-gateway');
  const rolePills = document.querySelectorAll('[data-action="switch-role"]');
  const customerPortal = document.getElementById('customer-portal');

  const ROLE_KEY = 'crit-spare.role';
  const SEEN_KEY = 'crit-spare.gateway-seen';

  const getRole = () => localStorage.getItem(ROLE_KEY) || 'shopkeeper';

  const applyRole = (role, shouldScroll = false) => {
    localStorage.setItem(ROLE_KEY, role);
    const isCustomer = role === 'customer';

    rolePills.forEach(pill => {
      pill.classList.toggle('role-pill--customer', isCustomer);
      const label = pill.querySelector('[data-role-label]');
      if (label) label.textContent = isCustomer ? 'Customer' : 'Shopkeeper';
      const icon = pill.querySelector('.role-pill__icon');
      if (icon) icon.textContent = isCustomer ? 'person' : 'storefront';
      pill.title = isCustomer ? 'Customer Mode (Click to switch to Shopkeeper)' : 'Shopkeeper Mode (Click to switch to Customer)';
    });

    if (customerPortal) {
      customerPortal.hidden = !isCustomer;
      if (isCustomer && shouldScroll) {
        customerPortal.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    const heroPrimaryBtn = document.querySelector('.hero__copy .button-row a.button--gold');
    if (heroPrimaryBtn && page === 'home') {
      if (isCustomer) {
        heroPrimaryBtn.href = '#customer-portal';
        heroPrimaryBtn.innerHTML = 'Check parts &amp; prices <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>';
      } else {
        heroPrimaryBtn.href = 'auth.html';
        heroPrimaryBtn.innerHTML = 'Create your shop <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>';
      }
    }
  };

  const openGateway = () => {
    if (!gateway) return;
    gateway.hidden = false;
    requestAnimationFrame(() => {
      gateway.classList.add('entry-gateway--active');
    });
    document.body.style.overflow = 'hidden';
    const firstRoleCard = gateway.querySelector('.role-card');
    if (firstRoleCard) firstRoleCard.focus();
  };

  const closeGateway = () => {
    if (!gateway) return;
    gateway.classList.remove('entry-gateway--active');
    document.body.style.overflow = '';
    sessionStorage.setItem(SEEN_KEY, 'true');
    setTimeout(() => {
      if (!gateway.classList.contains('entry-gateway--active')) {
        gateway.hidden = true;
      }
    }, 400);
  };

  // Bind Switch Role pill clicks
  rolePills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      if (gateway) {
        openGateway();
      } else {
        const current = getRole();
        const next = current === 'customer' ? 'shopkeeper' : 'customer';
        applyRole(next);
        document.dispatchEvent(new CustomEvent('app:toast', {
          detail: `Switched to ${next === 'customer' ? 'Customer' : 'Shopkeeper'} Mode.`
        }));
      }
    });
  });

  if (gateway) {
    gateway.querySelector('.entry-gateway__backdrop-fx')?.addEventListener('click', closeGateway);
    gateway.querySelector('[data-action="close-gateway"]')?.addEventListener('click', closeGateway);

    gateway.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeGateway();
    });

    gateway.querySelectorAll('[data-select-role]').forEach(card => {
      const selectHandler = () => {
        const selectedRole = card.dataset.selectRole;
        applyRole(selectedRole, true);
        closeGateway();
        document.dispatchEvent(new CustomEvent('app:toast', {
          detail: selectedRole === 'customer'
            ? 'Welcome Customer! Spares checker and receipt verifier are ready.'
            : 'Welcome Shopkeeper! Operator workstation and inventory controls are ready.'
        }));
      };

      card.addEventListener('click', selectHandler);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectHandler();
        }
      });
    });

    // Auto-open on first visit to homepage
    if (page === 'home' && !sessionStorage.getItem(SEEN_KEY) && !localStorage.getItem(ROLE_KEY)) {
      setTimeout(() => {
        openGateway();
      }, 500);
    }
  }

  // Apply current role state immediately
  applyRole(getRole(), false);

  if (page === 'home') {
    initCustomerPortalTools();
  }
}

async function initializePage() {
  if (isLocalDev && !new URLSearchParams(location.search).has('loggedOut')) {
    let existingUser = null;
    try { existingUser = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); } catch { /* ignore */ }
    if (!existingUser || !existingUser.id) {
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
      localStorage.setItem(STORAGE_KEYS.token, `mock.local.${Date.now()}`);
    }
  }
  const signedIn = await hasActiveSession();
  updateAuthControls(signedIn);
  if (new URLSearchParams(location.search).has('loggedOut')) {
    document.dispatchEvent(new CustomEvent('app:toast', { detail: 'You are signed out. Sign in or create a shop to continue.' }));
  } else if (new URLSearchParams(location.search).has('needLogin')) {
    document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Please sign in or create a shop to continue.' }));
  }
  const isCustomer = getRole() === 'customer';
  if (!isCustomer && protectedPages.includes(page)) {
    if (!signedIn) { location.replace(authPage(`${location.pathname}${location.search}${location.hash}`)); return; }
    if (!USE_MOCK && !isLocalDev) {
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
  ensureHelpPopovers();
  ensureNotificationPopover();
  ensureCookieBanner();
  initAnalytics();
  syncProfile();
  injectTopbarControls();
  ensureCustomerCartDrawer();
  ensureEntryGateway();
  if (page !== 'inventory') {
    document.querySelectorAll('[data-search-inventory]').forEach(search => search.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); location.href = `inventory.html?search=${encodeURIComponent(search.value.trim())}`; }
    }));
  }
  if (page === 'inventory') initInventory();
  if (page === 'invoice') initInvoice();
  if (page === 'dashboard') {
    if (isCustomer) renderCustomerDashboard();
    else initDashboard();
  }
  if (page === 'scan') {
    const mobile = matchMedia('(max-width: 760px) and (pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && innerWidth <= 760);
    if (!mobile) { location.replace('inventory.html'); return; }
    const { initScan } = await import('./scan.js'); initScan();
  }
}
initializePage();
