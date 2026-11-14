import { api } from './api.js';
import { cacheProfile, STORAGE_KEYS, USE_MOCK } from './config.js';
import { beginPhoneLink, verifyPhoneCode } from './firebase.js';

const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderChart(metrics, chart) {
  const values = metrics.consumption || []; if (!values.length) throw new Error('No chart readings are in stock.');
  const max = Math.max(160, ...values); const points = values.map((value, i) => `${Math.round(i * 1000 / Math.max(1, values.length - 1))},${215 - Math.round(value * 185 / max)}`);
  const path = `M${points.join(' L')}`; chart.querySelector('.chart-line').setAttribute('d', path); chart.querySelector('.chart-area').setAttribute('d', `${path} V230 H0Z`); chart.querySelectorAll('.chart-point').forEach(p => p.remove());
  const [cx, cy] = points[Math.floor(values.length / 2)].split(','); const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); point.setAttribute('class', 'chart-point'); point.setAttribute('cx', cx); point.setAttribute('cy', cy); point.setAttribute('r', '6'); chart.append(point);
  const labels = metrics.labels || []; document.querySelector('.chart-x').innerHTML = labels.map(label => `<span>${safe(label)}</span>`).join('');
  document.querySelector('.planet-metric strong').innerHTML = `${Number(metrics.availability ?? 0).toFixed(1)}<span>%</span>`;
  document.querySelector('.metric-float--left strong').textContent = Number(metrics.trackedItems ?? 0).toLocaleString();
  document.querySelector('.metric-float--right strong').textContent = `${metrics.criticalDepletions ?? 0} SKU`;
  document.querySelector('.metric-float--lower strong').textContent = `${metrics.accuracy ?? 0}%`;
}
function renderList(container, items, type) {
  container.querySelectorAll(type === 'timeline' ? '.timeline__item' : '.shift-row').forEach(node => node.remove());
  if (!items.length) { const empty = document.createElement(type === 'timeline' ? 'li' : 'p'); empty.className = type === 'timeline' ? 'timeline__item' : 'pill'; empty.dataset.state = 'empty'; empty.textContent = 'No activity recorded yet.'; container.append(empty); return; }
  items.forEach(item => {
    const node = document.createElement(type === 'timeline' ? 'li' : 'div'); node.className = type === 'timeline' ? 'timeline__item timeline__item--green' : 'shift-row';
    const when = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (type === 'timeline') node.innerHTML = `<small>${safe(item.action.toUpperCase())} <span>${when}</span></small><b>${safe(item.action)} ${item.qty}× ${safe(item.partName)}</b><p>${safe(item.note || item.sku)}</p>`;
    else node.innerHTML = `<span class="feature-icon"><span class="material-symbols-outlined">inventory</span></span><div><b>${safe(item.action)} <i class="status-dot status-dot--green"></i> SKU: ${safe(item.sku)}</b><p>${safe(item.qty)}× ${safe(item.partName)} • ${safe(item.note)}</p></div><strong>Qty: ${safe(item.qty)}<small>${when}</small></strong>`;
    container.append(node);
  });
}
export async function initDashboard() {
  const chart = document.querySelector('[data-chart]'); const timeline = document.querySelector('[data-timeline]'); const shift = document.querySelector('[data-shift-log]');
  let profile = {}; try { profile = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); } catch { /* use an empty profile */ }
  const profileForm = document.querySelector('[data-profile-form]');
  if (profileForm) {
    for (const key of ['name', 'shopName', 'station']) profileForm.elements.namedItem(key).value = profile[key] || '';
    profileForm.addEventListener('submit', async event => {
      event.preventDefault(); if (!profileForm.reportValidity()) return;
      const button = profileForm.querySelector('[type="submit"]'); const feedback = profileForm.querySelector('[data-profile-feedback]');
      button.disabled = true; feedback.textContent = 'Saving…';
      try {
        const payload = Object.fromEntries(new FormData(profileForm));
        const result = await api.updateProfile(payload); profile = cacheProfile({ ...profile, ...result.user });
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(profile));
        const heading = document.querySelector('.operator-card h2'); if (heading) heading.textContent = `${profile.name} • ${profile.role || 'Shop operator'}`;
        const details = document.querySelector('.operator-card h2 + p');
        if (details) details.textContent = `${profile.shopName} • ${profile.station}`;
        document.querySelectorAll('.avatar').forEach(avatar => { avatar.textContent = profile.name.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(); avatar.setAttribute('aria-label', `${profile.name} profile`); avatar.title = profile.name; });
        feedback.textContent = 'Profile saved.'; document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Profile saved.' }));
      } catch (error) { feedback.textContent = error.message; document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message })); }
      finally { button.disabled = false; }
    });
  }
  const phonePanel = document.querySelector('[data-profile-phone]');
  if (phonePanel) {
    phonePanel.hidden = USE_MOCK || Boolean(profile.phoneVerified || profile.phone);
    phonePanel.querySelector('[data-action="send-profile-otp"]')?.addEventListener('click', async event => {
      const button = event.currentTarget; const input = phonePanel.querySelector('#profile-phone'); const status = phonePanel.querySelector('[data-profile-phone-status]');
      button.disabled = true; status.textContent = 'Sending a code…';
      try { input.value = await beginPhoneLink(input.value); phonePanel.querySelector('[data-profile-otp]').hidden = false; phonePanel.querySelector('#profile-otp').focus(); status.textContent = 'Code sent. Enter it to check your phone.'; }
      catch (error) { status.textContent = error.message; document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message })); }
      finally { button.disabled = false; }
    });
    phonePanel.querySelector('[data-action="verify-profile-otp"]')?.addEventListener('click', async event => {
      const button = event.currentTarget; const status = phonePanel.querySelector('[data-profile-phone-status]');
      button.disabled = true; status.textContent = 'Checking phone…';
      try {
        const phone = await verifyPhoneCode(phonePanel.querySelector('#profile-otp').value);
        const result = await api.verifyProfilePhone(phone);
        profile = cacheProfile(result.user); localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(profile));
        phonePanel.hidden = true; document.dispatchEvent(new CustomEvent('app:toast', { detail: 'Phone checked and added to your profile.' }));
        const details = document.querySelector('.operator-card h2 + p');
        if (details) details.textContent = `${profile.shopName || 'Your shop'} • ${profile.station || 'Station not set'}`;
      } catch (error) { status.textContent = error.message; document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message })); }
      finally { button.disabled = false; }
    });
  }
  renderList(timeline, [], 'timeline');
  renderList(shift, [], 'shift');
  const chartWrap = chart.closest('.chart-wrap');
  const status = document.createElement('p'); status.className = 'pill'; status.setAttribute('aria-live', 'polite'); chartWrap.before(status); status.textContent = 'Loading shop updates…';
  const jobs = await Promise.allSettled([api.getMetrics(), api.getTimeline(), api.getShiftLog()]);
  if (jobs[0].status === 'fulfilled') { try { renderChart(jobs[0].value, chart); status.textContent = 'Shop updates updated.'; } catch (error) { chartWrap.hidden = true; status.textContent = error.message; } }
  else { chartWrap.hidden = true; status.textContent = jobs[0].reason.message; }
  if (jobs[1].status === 'fulfilled') renderList(timeline, jobs[1].value, 'timeline'); else timeline.innerHTML = `<li class="timeline__item" data-state="error">${safe(jobs[1].reason.message)}</li>`;
  if (jobs[2].status === 'fulfilled') renderList(shift, jobs[2].value, 'shift'); else { shift.querySelectorAll('.shift-row').forEach(node => node.remove()); const err = document.createElement('p'); err.dataset.state = 'error'; err.className = 'pill'; err.textContent = jobs[2].reason.message; shift.append(err); }
  jobs.filter(job => job.status === 'rejected').forEach(job => document.dispatchEvent(new CustomEvent('app:toast', { detail: job.reason.message })));
  const user = JSON.parse(localStorage.getItem(STORAGE_KEYS.user) || '{}'); if (user.name) { const heading = document.querySelector('.operator-card h2'); if (heading) heading.textContent = `${user.name} • ${user.role || 'Shop operator'}`; }
  document.querySelectorAll('[data-orbit-tracking]').forEach(orbit => orbit.addEventListener('pointermove', event => {
    const box = orbit.getBoundingClientRect(); orbit.style.setProperty('--pointer-x', `${((event.clientX - box.left) / box.width * 100).toFixed(1)}%`); orbit.style.setProperty('--pointer-y', `${((event.clientY - box.top) / box.height * 100).toFixed(1)}%`);
  }));
}
