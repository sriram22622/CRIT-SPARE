import { api } from './api.js';
import { getRole, addToCart, openCartDrawer } from './customer.js';

const styles = { healthy: ['green', 'flare', 'PACK X9 CRYO'], low: ['gold', 'tune', 'VALVE CORE TSV'], critical: ['violet', 'diamond', 'PRISM CORE'], 'out-of-stock': ['red', 'sensors', 'FLUX COIL'] };
let parts = []; let activePart = null; let mode = 'dispense'; let opener = null; let pollTimer; let debounce; let drawerOpen = false;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function stateNode(grid, state, message) { grid.querySelectorAll('[data-state]').forEach(node => node.remove()); const node = document.createElement('p'); node.dataset.state = state; node.className = 'pill'; node.setAttribute('role', state === 'error' ? 'alert' : 'status'); node.textContent = message; grid.append(node); }
function render(grid) {
  const isCustomer = getRole() === 'customer';
  const headingTitle = document.querySelector('.inventory-heading h1');
  const headingBreadcrumb = document.querySelector('.inventory-heading .breadcrumb');
  const headingDesc = document.querySelector('.inventory-heading > div > p:last-child');
  if (isCustomer) {
    if (headingBreadcrumb) headingBreadcrumb.innerHTML = '<span class="pill pill--green">CUSTOMER PORTAL</span> / Spares Catalog';
    if (headingTitle) headingTitle.innerHTML = 'Browse Shop <em>Inventory</em>.';
    if (headingDesc) headingDesc.textContent = 'Check real-time stock, review unit prices, and add spare parts to your cart.';
    const billingSection = document.querySelector('.billing-preview');
    if (billingSection) {
      const title = billingSection.querySelector('h2');
      if (title) title.textContent = 'Customer Cart & Billing';
    }
  }

  grid.querySelectorAll('.part-card, .empty-inventory').forEach(card => card.remove());
  if (!parts.length) {
    grid.querySelectorAll('[data-state]').forEach(node => node.remove());
    const empty = document.createElement('div');
    empty.className = 'empty-inventory card-glass';
    empty.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 48px 24px; border-radius: 20px;';
    empty.innerHTML = `
      <span class="material-symbols-outlined" style="font-size: 52px; color: var(--gold); margin-bottom: 12px; display:inline-block;">inventory_2</span>
      <h3 style="font-size: 22px; margin: 0 0 8px; color: var(--white);">${isCustomer ? 'No spare parts found in this shop' : 'Your stock is currently empty'}</h3>
      <p style="color: var(--muted); max-width: 440px; margin: 0 auto 20px; font-size: 14px;">${isCustomer ? 'This shop has not published any parts yet or your search filter returned 0 results.' : 'New accounts start with 0 stock. Manually add spare parts to track quantities, make bills, and manage inventory.'}</p>
      ${isCustomer ? '' : '<button class="button button--gold" type="button" popovertarget="add-stock-drawer"><span class="material-symbols-outlined">add_circle</span> Add your first part</button>'}
    `;
    grid.append(empty);
    return;
  }
  grid.querySelectorAll('[data-state]').forEach(node => node.remove());
  for (const part of parts) {
    const [tone, icon, label] = styles[part.status] || styles.healthy;
    const priceFormatted = Number(part.unitPrice || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const customerAction = `<button class="button button--gold button--full" type="button" data-action="customer-add-cart" data-part="${esc(part.id)}" ${part.qty < 1 ? 'disabled' : ''}><span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;">add_shopping_cart</span> ${part.qty < 1 ? 'Out of Stock' : 'Add to Cart'}</button>`;
    const card = document.createElement('article'); card.className = 'part-card card-glass'; card.dataset.partCard = part.id;
    card.innerHTML = `<div class="part-card__meta"><span>${esc(part.sku)}</span><small>▦ Bin: ${esc(part.bin || '—')}</small><span class="pill pill--${tone}">● ${esc(part.status.replaceAll('-', ' '))}</span></div><h2>${esc(part.name)}</h2><div class="part-visual part-visual--${tone}"><span class="material-symbols-outlined">${icon}</span><small>${label}</small></div><div class="part-price" style="font-size:17px;font-weight:800;color:var(--gold);font-family:'JetBrains Mono',monospace;margin:6px 0 2px;">₹${priceFormatted} <small style="font-size:10px;color:var(--muted);font-weight:400;">/ unit</small></div><div class="part-quantity"><strong class="text-${tone}">${part.qty}</strong><span>In stock</span><small>${part.reserved || 0} reserved</small></div><div class="stockbar"><span style="width:${Math.max(0, Math.min(100, part.qty / 5))}%"></span></div><div class="spark-label"><span>Stock status</span><b class="text-${tone}">${esc(part.status.replaceAll('-', ' '))}</b></div><div class="part-actions">${customerAction}<button class="button button--muted" type="button" data-action="open-dispense" data-part="${esc(part.id)}" ${part.qty < 1 ? 'disabled' : ''}>− Issue</button><button class="button button--muted" type="button" data-action="open-restock" data-part="${esc(part.id)}">＋ Restock</button><button class="button button--muted" type="button" data-action="audit-part" data-part="${esc(part.id)}">Count stock</button>${part.qty <= 5 ? `<button class="button button--red" type="button" data-action="emergency-reorder" data-part="${esc(part.id)}">✱ Order more</button>` : ''}<button class="button button--muted" type="button" data-action="audit-scan" data-part="${esc(part.id)}">Scan part code</button></div>`;
    grid.append(card);
  }
}
async function load(grid, search = document.querySelector('[data-filter-parts]')?.value || '') {
  stateNode(grid, 'loading', 'Loading stock…');
  try { parts = await api.getParts(search); render(grid); }
  catch (error) { stateNode(grid, 'error', error.message); document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message })); }
}
function showDrawer(drawer, part, action, button) {
  activePart = part; mode = action === 'open-restock' ? 'restock' : 'dispense'; opener = button;
  drawer.querySelector('h2').textContent = mode === 'restock' ? 'Restock a part' : 'Issue a part';
  drawer.querySelector('[data-drawer-part]').textContent = `${part.name} • ${part.sku} • ${part.qty} in stock`;
  const destination = drawer.querySelector('[name="destination"]');
  drawer.querySelector('label[for="issue-destination"]').textContent = mode === 'restock' ? 'Note (optional)' : 'Who is receiving it?';
  destination.placeholder = mode === 'restock' ? 'Optional delivery note' : 'Name or container';
  destination.required = mode === 'dispense'; destination.value = '';
  drawer.querySelector('#qty-val').value = '1'; drawer.querySelector('[data-action="confirm-dispense"]').textContent = mode === 'restock' ? 'Restock parts' : 'Issue parts';
  drawerOpen = true;
  if (drawer.showPopover) drawer.showPopover(); else drawer.hidden = false;
  drawer.querySelector('#qty-val').focus();
}
export function initInventory() {
  const grid = document.querySelector('#parts'); if (!grid) return;
  grid.setAttribute('aria-live', 'polite');
  const drawer = document.querySelector('#dispense-drawer');
  const existing = [...grid.querySelectorAll('.part-card')]; existing.forEach(card => card.remove());
  load(grid, new URLSearchParams(location.search).get('search') || '');
  const searchBox = document.querySelector('[data-filter-parts]'); searchBox.value = new URLSearchParams(location.search).get('search') || '';
  const telemetryToggle = document.querySelector('[data-action="toggle-telemetry"]');
  telemetryToggle?.addEventListener('change', () => document.querySelectorAll('.sparkline').forEach(line => { line.hidden = !telemetryToggle.checked; }));
  searchBox.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => load(grid, searchBox.value.trim()), 300); });
  const chipTerms = { 'All': '', 'Micro-Sensors': 'sensor', 'Heavy Turbines': 'turbine', 'Optics': 'optical', 'Fasteners': 'fastener', 'Aisle A': 'A-', 'Aisle B': 'B-' };
  document.querySelectorAll('.filter-chip').forEach(chip => chip.addEventListener('click', event => {
    event.preventDefault(); const label = chip.textContent.trim(); if (!(label in chipTerms)) return;
    searchBox.value = chipTerms[label]; document.querySelectorAll('.filter-chip').forEach(item => item.classList.toggle('filter-chip--active', item === chip)); load(grid, searchBox.value);
  }));
  document.querySelectorAll('[data-search-inventory]').forEach(input => input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchBox.value = input.value.trim(); load(grid, searchBox.value); searchBox.focus(); } }));
  grid.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const action = button.dataset.action; const part = parts.find(p => p.id === button.dataset.part); if (!part) return;
    if (action === 'customer-add-cart') {
      event.preventDefault();
      addToCart(part, 1);
      openCartDrawer();
      return;
    }
    if (action === 'open-dispense' || action === 'open-restock') { event.preventDefault(); showDrawer(drawer, part, action, button); return; }
    if (action === 'audit-scan') { location.href = `scan.html?code=${encodeURIComponent(part.sku)}`; return; }
    button.disabled = true;
    try {
      if (action === 'emergency-reorder') { const result = await api.reorder(part.id); document.dispatchEvent(new CustomEvent('app:toast', { detail: `Order ${result.order.id} saved.` })); }
      if (action === 'audit-part') { const raw = prompt(`Enter how many you counted for ${part.sku}`, String(part.qty)); if (raw === null) return; const count = Number(raw); if (!Number.isInteger(count) || count < 0) throw new Error('Enter a whole number, zero or more.'); const result = await api.audit(part.id, count); document.dispatchEvent(new CustomEvent('app:toast', { detail: `Count saved. Difference: ${result.discrepancy}.` })); }
      if (action === 'reconcile-part') { const result = await api.reconcile(part.sku); document.dispatchEvent(new CustomEvent('app:toast', { detail: `${result.part.sku} code checked.` })); }
      await load(grid);
    } catch (error) { document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message })); }
    finally { button.disabled = false; }
  });
  drawer.addEventListener('click', event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    if (button.dataset.action === 'close-drawer') { event.preventDefault(); closeDrawer(drawer); return; }
    if (button.dataset.action === 'qty-minus' || button.dataset.action === 'qty-plus') { const input = drawer.querySelector('#qty-val'); input.value = Math.max(1, Number(input.value || 1) + (button.dataset.action === 'qty-plus' ? 1 : -1)); }
  });
  drawer.addEventListener('submit', async event => {
    if (!event.target.matches('form')) return; event.preventDefault();
    const qtyInput = drawer.querySelector('#qty-val'); const qty = Number(qtyInput.value); const destination = drawer.querySelector('[name="destination"]');
    if (!Number.isInteger(qty) || qty < 1 || (mode === 'dispense' && qty > activePart.qty) || (mode === 'dispense' && !destination.value.trim())) { qtyInput.setCustomValidity(mode === 'dispense' && qty > activePart.qty ? `Only ${activePart.qty} units are in stock.` : 'Enter a valid amount and who gets the parts.'); qtyInput.reportValidity(); qtyInput.setCustomValidity(''); return; }
    const submit = drawer.querySelector('[data-action="confirm-dispense"]'); submit.disabled = true;
    try { const result = mode === 'restock' ? await api.restock(activePart.id, qty) : await api.dispense(activePart.id, qty); closeDrawer(drawer); await load(grid); if (mode === 'dispense') location.href = `invoice.html?id=${encodeURIComponent(result.invoice.id)}`; else document.dispatchEvent(new CustomEvent('app:toast', { detail: `${result.part.name} added to stock.` })); }
    catch (error) { document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message })); }
    finally { submit.disabled = false; }
  });
  drawer.addEventListener('toggle', event => { drawerOpen = event.newState === 'open'; if (!drawerOpen) opener?.focus(); });
  function closeDrawer(element) {
    if (!drawerOpen) return;
    drawerOpen = false;
    if (element.hidePopover && element.matches(':popover-open')) element.hidePopover(); else element.hidden = true;
    opener?.focus();
  }
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && drawerOpen) closeDrawer(drawer); });
  const addForm = document.querySelector('[data-add-part-form]');
  const addDrawer = document.querySelector('#add-stock-drawer');
  addForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const submitBtn = addForm.querySelector('[data-action="confirm-add-part"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving part…'; }
    try {
      const formData = new FormData(addForm);
      if (formData.get('_hp_security')) throw new Error('Spam protection triggered. Submission blocked.');
      const name = String(formData.get('name') || '').trim();
      const sku = String(formData.get('sku') || '').trim();
      const bin = String(formData.get('bin') || '').trim();
      const qty = Number(formData.get('qty') || 0);
      const unitPrice = Number(formData.get('unitPrice') || 0);
      const result = await api.addPart({ name, sku, bin, qty, unitPrice });
      if (addDrawer?.hidePopover && addDrawer.matches(':popover-open')) addDrawer.hidePopover();
      else if (addDrawer) addDrawer.hidden = true;
      addForm.reset();
      document.dispatchEvent(new CustomEvent('app:toast', { detail: `Part ${result.part.name} added to stock.` }));
      await load(grid);
    } catch (error) {
      document.dispatchEvent(new CustomEvent('app:toast', { detail: error.message || 'Could not save part.' }));
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save to inventory'; }
    }
  });

  const sync = () => { if (!document.hidden) load(grid); };
  pollTimer = setInterval(sync, 10000); document.addEventListener('visibilitychange', sync);
}
